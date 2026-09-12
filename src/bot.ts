/**
 * Bot move policy.
 *
 * Honest play aims at a chosen average centipawn loss rather than at the best
 * move, so the bot drifts the way a human does instead of playing perfectly
 * until it suddenly does not. Errors are made on purpose, and only when they
 * are punishable -- see `pickBlunder` and `pickMateTrap`.
 */

import { fenAfter } from './chess.ts';
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
export const PUNISH_MARGIN = 80;

/**
 * How many candidate errors to test for punishability before giving up.
 *
 * Each test is a search, and a bot that thinks for ten seconds is worse company
 * than one that occasionally fails to find an error worth making.
 */
export const MAX_PROBES = 3;

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

  if (context.wantsError && Math.abs(best.cp) <= DECIDED_CP) {
    // One wide search serves both kinds of error, so erring costs a single
    // extra think rather than one per candidate.
    const wide = await (policy.searchWide ?? policy.search)(fen);

    // A mate to find is a better lesson than a dropped piece, so try for one
    // first when the settings ask for it.
    if (random() < policy.settings.mateTrapShare) {
      const trap = pickMateTrap(wide, best, policy.settings, random);
      if (trap) {
        return { uci: trap.uci, kind: 'mate-trap', deliberateError: true, cpLoss: trap.cpLoss };
      }
    }
    const blunder = await pickBlunder(policy, fen, best, wide);
    if (blunder) {
      return { uci: blunder.uci, kind: 'blunder', deliberateError: true, cpLoss: blunder.cpLoss };
    }
  }

  const quiet = pickHonest(lines, policy.settings, context.acpl, random);
  if (!quiet) return undefined;
  return { uci: quiet, kind: 'quiet', deliberateError: false, cpLoss: honestLoss(lines, quiet) };
}

const honestLoss = (lines: readonly PvLine[], uci: string): number => {
  const [best] = lines;
  const played = lines.find(line => line.moves[0] === uci);
  return best && played ? lossOf(best, played) : 0;
};

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
  const candidates = shuffle(
    wide.filter(line => {
      const loss = lossOf(best, line);
      return loss >= blunderMin && loss <= blunderMax;
    }),
    random,
  ).slice(0, MAX_PROBES);

  const probe = policy.probe ?? policy.search;
  for (const candidate of candidates) {
    const uci = candidate.moves[0];
    const replies = await probe(fenAfter(fen, uci));
    const [punish, second] = replies;
    // A punishable error is one where the right reply stands out. If every reply
    // is about as good there is no insight to have, so try another error.
    if (punish && second && punish.cp - second.cp >= PUNISH_MARGIN) {
      return { uci, cpLoss: lossOf(best, candidate) };
    }
  }
  return undefined;
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

const shuffle = <T>(items: readonly T[], random: () => number): T[] =>
  items
    .map(item => ({ item, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.item);
