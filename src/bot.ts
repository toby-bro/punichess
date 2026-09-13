/**
 * Bot move policy.
 *
 * Honest play aims at a chosen average centipawn loss rather than at the best
 * move, so the bot drifts the way a human does instead of playing perfectly
 * until it suddenly does not. Errors are made on purpose, and only when they
 * are punishable -- see `pickBlunder` and `pickMateTrap`.
 */

import { fenAfter, moveKind, positionHash } from './chess.ts';
import { DECIDED_CP } from './referee.ts';
import type { Settings } from './settings.ts';
import type { PvLine } from './uci.ts';

/**
 * Narrowest spread of candidate losses, in centipawns.
 *
 * The spread widens with the target so a sloppy bot stays varied, but at a low
 * target it has to clamp down hard: anything looser and the weaker moves keep
 * enough weight to hold the average well above zero however the controller
 * pushes, since it cannot ask for a negative loss.
 */
const MIN_SPREAD_CP = 8;
const SPREAD_RATIO = 0.6;

/**
 * The refutation of a deliberate error must beat the second-best reply by this
 * much, or there is nothing to spot and stopping the player would be unfair.
 */
export const PUNISH_MARGIN = 60;

/**
 * How many candidate errors to test for punishability before giving up.
 *
 * Each test is a search, and a bot that thinks for ten seconds is worse company
 * than one that occasionally fails to find an error worth making.
 */
export const MAX_PROBES = 5;

/**
 * How far behind the bot must be before a repetition becomes fair play.
 *
 * Shuffling into a draw from a level or better position is just a way of
 * wasting a game. From a worse one it is the right move, and being held to a
 * draw you thought you were winning says something true about the position --
 * which is the sort of thing worth finding out.
 */
export const HOLD_FOR_DRAW_CP = -50;

/** Analyse a position. Injected so the policy can be tested without an engine. */
export type Search = (fen: string) => Promise<readonly PvLine[]>;

export interface Policy {
  readonly search: Search;
  /**
   * A search over *every* legal move, used only when hunting for an error worth
   * making.
   *
   * This is not an optimisation but a requirement. In a normal middlegame the
   * top two dozen moves are all within a pawn of best, so a narrow search
   * contains nothing that loses enough to be worth spotting, and the bot simply
   * never errs.
   */
  readonly searchWide?: Search | undefined;
  /**
   * A cheap search used only to check whether an error has a clear refutation.
   * Two lines and a shallow budget answer that; a full search is wasted on it.
   */
  readonly probe?: Search | undefined;
  readonly settings: Settings;
  /** Injectable for deterministic tests; defaults to Math.random. */
  readonly random?: (() => number) | undefined;
}

export interface MoveContext {
  readonly wantsError: boolean;
  /** The bot's average centipawn loss so far, which steers honest play. */
  readonly acpl: number;
  /**
   * Moves not to play, so asking for a different move in a position actually
   * gives you one.
   */
  readonly exclude?: ReadonlySet<string> | undefined;
  /**
   * Positions already reached in this line, hashed.
   *
   * The bot steers away from them, so a won game is not shuffled into a draw by
   * repetition while the player is trying to convert it. Only this line: the
   * same position down some other branch was never repeated here.
   */
  readonly avoid?: ReadonlySet<number> | undefined;
}

export type MoveKind = 'quiet' | 'blunder' | 'mate-trap';

export interface BotMove {
  readonly uci: string;
  readonly kind: MoveKind;
  /** True when the bot went wrong on purpose, arming the strict rule. */
  readonly deliberateError: boolean;
  /** What this move cost against the best move, in centipawns. */
  readonly cpLoss: number;
}

const lossOf = (best: PvLine, line: PvLine): number => Math.max(0, best.cp - line.cp);

/** The square a move ends on. */
const destOf = (uci: string): string => uci.slice(2, 4);

/**
 * Lines whose move is still on the table.
 *
 * Never empties the list: if every candidate has been ruled out, the position
 * still needs a move, and the best one is a better answer than none. That
 * matters for repetition in particular -- sometimes every legal move goes back
 * somewhere you have been, and refusing to move is not an option.
 */
function allowed(
  lines: readonly PvLine[],
  fen: string,
  exclude: ReadonlySet<string>,
  avoid: ReadonlySet<number>,
): readonly PvLine[] {
  const left = lines.filter(line => {
    if (exclude.has(line.moves[0])) return false;
    if (avoid.size === 0) return true;
    try {
      return !avoid.has(positionHash(fenAfter(fen, line.moves[0])));
    } catch {
      // A move that will not play is not a move to worry about repeating.
      return true;
    }
  });
  return left.length > 0 ? left : lines;
}

const honestLoss = (lines: readonly PvLine[], uci: string): number => {
  const [best] = lines;
  const played = lines.find(line => line.moves[0] === uci);
  return best && played ? lossOf(best, played) : 0;
};

const shuffle = <T>(items: readonly T[], random: () => number): T[] =>
  items
    .map(item => ({ item, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.item);

/**
 * The loss to aim for on this move so the running average approaches the target.
 *
 * Overshoots when the average is below target and undershoots when above, which
 * converges without needing to remember anything but the average.
 */
export function desiredLoss(target: number, acpl: number, band: number): number {
  return Math.max(0, Math.min(2 * target - acpl, band));
}

/** Choose the bot's move, or nothing when there is no move to make. */
export async function chooseMove(
  policy: Policy,
  fen: string,
  lines: readonly PvLine[],
  context: MoveContext,
): Promise<BotMove | undefined> {
  const [best] = lines;
  if (!best) return undefined;
  const random = policy.random ?? Math.random;
  const exclude = context.exclude ?? new Set<string>();
  // A side that is losing is entitled to repeat.
  const avoid = best.cp <= HOLD_FOR_DRAW_CP ? new Set<number>() : (context.avoid ?? new Set());

  if (context.wantsError && Math.abs(best.cp) <= DECIDED_CP) {
    // One wide search serves both kinds of error, so erring costs a single
    // extra think rather than one per candidate.
    const wide = await (policy.searchWide ?? policy.search)(fen);

    // A mate to find is a better lesson than a dropped piece, so try for one
    // first when the settings ask for it.
    if (random() < policy.settings.mateTrapShare) {
      const trap = pickMateTrap(allowed(wide, fen, exclude, avoid), best, policy.settings, random);
      if (trap) {
        return { uci: trap.uci, kind: 'mate-trap', deliberateError: true, cpLoss: trap.cpLoss };
      }
    }
    const blunder = await pickBlunder(policy, fen, best, allowed(wide, fen, exclude, avoid));
    if (blunder) {
      return { uci: blunder.uci, kind: 'blunder', deliberateError: true, cpLoss: blunder.cpLoss };
    }
  }

  const quiet = pickHonest(
    allowed(lines, fen, exclude, avoid),
    policy.settings,
    context.acpl,
    random,
  );
  if (!quiet) return undefined;
  return { uci: quiet, kind: 'quiet', deliberateError: false, cpLoss: honestLoss(lines, quiet) };
}

/**
 * Pick an honest move, biased towards the loss that keeps the average on target.
 *
 * Candidates are weighted rather than filtered, so the bot still sometimes finds
 * the best move and sometimes the sloppiest one in range.
 */
export function pickHonest(
  lines: readonly PvLine[],
  settings: Settings,
  acpl: number,
  random: () => number = Math.random,
): string | undefined {
  const [best] = lines;
  if (!best) return undefined;

  const candidates = lines.filter(line => lossOf(best, line) <= settings.quietBand);
  const target = desiredLoss(settings.targetAcpl, acpl, settings.quietBand);
  const spread = Math.max(MIN_SPREAD_CP, target * SPREAD_RATIO);
  const weights = candidates.map(line => Math.exp(-Math.abs(lossOf(best, line) - target) / spread));
  return (weighted(candidates, weights, random) ?? best).moves[0];
}

/** Sample one item in proportion to its weight. */
function weighted<T>(
  items: readonly T[],
  weights: readonly number[],
  random: () => number,
): T | undefined {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[0];
  let ticket = random() * total;
  for (const [index, item] of items.entries()) {
    ticket -= weights[index] ?? 0;
    if (ticket <= 0) return item;
  }
  return items.at(-1);
}

export interface Candidate {
  readonly uci: string;
  readonly cpLoss: number;
}

/** What the player has to see in order to punish an error. */
export type PunishKind = 'mate' | 'check' | 'sac' | 'quiet' | 'grab';

/**
 * How much of a lesson each kind of refutation is.
 *
 * A forced mate is unarguable and it is the thing people most want to be shown.
 * A check that captures nothing is a discovered or double check -- the whole
 * reason this ranking exists, since those are exactly the errors that never came
 * up when the first passable candidate won. A capture into a defended square is
 * a real sacrifice. A quiet move at the end is often not a refutation at all but
 * a position that was simply better, so it goes last.
 */
const PUNISH_RANK: Record<PunishKind, number> = { mate: 4, check: 3, sac: 2, quiet: 1, grab: 0 };

/** Classify a refutation by what makes it work. */
export function punishKind(after: string, punish: PvLine): PunishKind {
  if (punish.mate !== undefined && punish.mate > 0) return 'mate';
  const kind = moveKind(after, punish.moves[0]);
  if (!kind.capture) return kind.check ? 'check' : 'quiet';
  return kind.defended ? 'sac' : 'grab';
}

/**
 * Find an error worth making: costly enough to matter, cheap enough to recover
 * from, and above all one with a clear refutation for the player to find.
 *
 * `wide` must come from a search over every legal move. The moves that lose a
 * pawn or two are never in the top handful.
 */
export async function pickBlunder(
  policy: Policy,
  fen: string,
  best: PvLine,
  wide: readonly PvLine[],
): Promise<Candidate | undefined> {
  const random = policy.random ?? Math.random;
  const { blunderMin, blunderMax } = policy.settings;
  const band = wide.filter(line => {
    const loss = lossOf(best, line);
    return loss >= blunderMin && loss <= blunderMax;
  });
  const candidates = sampleByCost(band, best, MAX_PROBES, random);

  const probe = policy.probe ?? policy.search;

  let chosen: { candidate: Candidate; rank: number; margin: number } | undefined;

  for (const candidate of candidates) {
    const uci = candidate.moves[0];
    const after = fenAfter(fen, uci);
    const [punish, second] = await probe(after);

    // A punishable error is one where the right reply stands out. If every reply
    // is about as good there is no insight to have, so try another error.
    if (!punish || !second) continue;
    const margin = punish.mate !== undefined ? Number.POSITIVE_INFINITY : punish.cp - second.cp;
    if (margin < PUNISH_MARGIN) continue;

    // "I move this piece somewhere it gets taken" is not a mistake worth
    // spotting, it is one worth ignoring, so an answer that just takes the piece
    // that moved is not an answer worth setting up.
    if (destOf(punish.moves[0]) === destOf(uci)) continue;

    const kind = punishKind(after, punish);
    // Picking up something left hanging elsewhere is not a tactic either. The
    // refutation has to be a move rather than a helping. Measured over a real
    // game, this keeps five of every six clear-cut refutations and throws away
    // exactly the free lunches.
    if (kind === 'grab') continue;

    // Every probe is spent whether or not the first candidate passed, so there
    // is nothing to save by stopping at the first one that does -- and plenty to
    // gain by looking at the rest. Taking the first meant the choice between a
    // forced mate and a vaguely better position came down to shuffle order.
    const rank = PUNISH_RANK[kind];
    if (!chosen || rank > chosen.rank || (rank === chosen.rank && margin > chosen.margin)) {
      chosen = { candidate: { uci, cpLoss: lossOf(best, candidate) }, rank, margin };
    }
    // Nothing beats a forced mate, so stop paying for probes once one turns up.
    if (kind === 'mate') break;
  }
  return chosen?.candidate;
}

/**
 * Choose which errors to spend a probe on, leaning towards the worse ones.
 *
 * A normal middlegame offers a dozen or more moves inside the band, and only
 * five can be afforded. Drawing them uniformly means the bot mostly examines the
 * mildest ones, because there are more of them -- so it kept finding errors that
 * cost a pawn and answering them with something obvious, and the four-pawn
 * disasters it could have played went unexamined.
 *
 * Weight is the square of the loss, which is enough to make the bottom of the
 * band the exception rather than the rule without ever excluding it. The moves
 * that walk into a forced mate live at the very top of the band, so this is also
 * what makes mate traps turn up at all.
 */
function sampleByCost(
  band: readonly PvLine[],
  best: PvLine,
  count: number,
  random: () => number,
): PvLine[] {
  const left = [...band];
  const chosen: PvLine[] = [];
  while (chosen.length < count && left.length > 0) {
    const weights = left.map(line => (lossOf(best, line) / 100) ** 2);
    const pick = weighted(left, weights, random);
    if (!pick) break;
    chosen.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return chosen;
}

/**
 * Find a move that hands the player a forced mate within the configured depth.
 *
 * Needs the same wide search: allowing mate is the worst thing available in a
 * position, so it is the last move a narrow search would ever report.
 */
export function pickMateTrap(
  wide: readonly PvLine[],
  best: PvLine,
  settings: Settings,
  random: () => number = Math.random,
): Candidate | undefined {
  // If the bot is getting mated whatever it does, allowing it is not an error.
  if (best.mate !== undefined && best.mate < 0) return undefined;

  const traps = wide.filter(
    line => line.mate !== undefined && line.mate < 0 && -line.mate <= settings.maxMateDepth,
  );
  const chosen = shuffle(traps, random)[0];
  return chosen ? { uci: chosen.moves[0], cpLoss: lossOf(best, chosen) } : undefined;
}
