/**
 * Turns a MultiPV search into a verdict about a single move.
 *
 * Centipawns are not linear in "how much did that hurt": dropping 1.00 at a
 * dead-level 0.00 is catastrophic, dropping 1.00 at +7.00 is noise. So every
 * threshold is checked in centipawns *and* in winning chances, and a move is an
 * error only when it fails both.
 */

import { outcomeOf } from './chess.ts';
import type { Settings } from './settings.ts';
import { MATE_CP, type PvLine } from './uci.ts';

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Lichess's fitted centipawn -> expected-score curve. Clamped because the curve
 * is flat past a few pawns and mate scores would otherwise dominate it.
 */
export const winPercent = (cp: number): number =>
  50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -2000, 2000))) - 1);

/** Mate scores sit far above any real evaluation; treat them as a separate kind. */
export const isMateScore = (cp: number): boolean => Math.abs(cp) > MATE_CP - 10_000;

/**
 * How much slower a mate has to be before taking it counts as missing the fast
 * one: at least this many moves longer, *and* at least twice as long.
 *
 * Mate in 1 played as mate in 4 is still mate and not worth an interruption.
 * Mate in 2 played as mate in 8 is a different move, and missing the short one
 * is exactly the kind of blindness this app exists to catch.
 */
export const MATE_SLACK = 4;

const muchSlower = (played: number, best: number): boolean =>
  played - best >= MATE_SLACK && played >= best * 2;

export interface PositionScore {
  readonly cp: number;
  readonly mate?: number | undefined;
}

/**
 * A position's value from the side to move's point of view.
 *
 * A search returns nothing when there are no legal moves, which is not a
 * failure but the end of the game, so read the result off the position instead.
 */
export function scorePosition(lines: readonly PvLine[], fen: string): PositionScore {
  const [best] = lines;
  if (best) return { cp: best.cp, mate: best.mate };
  if (outcomeOf(fen)?.reason === 'checkmate') return { cp: -MATE_CP, mate: -0 };
  return { cp: 0 };
}

/** The same score seen from the other side of the board. */
export const negate = (score: PositionScore): PositionScore => ({
  cp: -score.cp,
  mate: score.mate === undefined ? undefined : -score.mate,
});

/**
 * What a move was worth, given the search of the position it led to.
 *
 * Used when the move played is not among the lines the engine reported, which
 * is common precisely when the move is bad. The budget must match the parent
 * search, or the two scores are not comparable.
 */
export function scoreOfMove(childLines: readonly PvLine[], childFen: string): PositionScore {
  // Delivering mate leaves the opponent with nothing to search.
  if (childLines.length === 0 && outcomeOf(childFen)?.reason === 'checkmate') {
    return { cp: MATE_CP, mate: 1 };
  }
  return negate(scorePosition(childLines, childFen));
}

export interface Verdict {
  /** Centipawns thrown away versus the best move. Never negative. */
  readonly cpLoss: number;
  /** Winning chances thrown away, in percentage points. Never negative. */
  readonly winLoss: number;
  /** A forced mate was available and the move let it slip. */
  readonly missesMate: boolean;
  /** The move walks into a forced mate that the best move avoided. */
  readonly hangsMate: boolean;
  readonly best: PvLine;
  /** The played line, when it was inside the search's MultiPV window. */
  readonly played?: PvLine | undefined;
  /**
   * The forced mate that was available, in moves, when one was and the played
   * move let it go. This is what turns "that was bad" into "that was mate in 2".
   */
  readonly mateIn?: number | undefined;
}

export interface Thresholds {
  /** Minimum centipawn loss before the move counts as an error. */
  readonly cp: number;
  /** Minimum loss of winning chances, in percentage points. */
  readonly win: number;
  /**
   * Keep judging even when the game is already decided, on material alone.
   *
   * Normally a decided position silences the alarm and winning chances gate the
   * centipawn bar, because nagging about a half-pawn when you are three down is
   * noise. Once you have deliberately played a losing move to see it punished,
   * both of those work against you: the position is lost by construction, so
   * nothing you do afterwards moves the win curve enough to register, and you
   * would fight the whole refutation in silence. In there, material lost is the
   * thing worth hearing about.
   */
  readonly evenWhenDecided?: boolean | undefined;
}

/** Failing to punish an error the bot made on purpose: a deliberately low bar. */
export const MISSED_PUNISH: Thresholds = { cp: 50, win: 4 };

/** Your own blunder. Always armed. */
export const OWN_BLUNDER: Thresholds = { cp: 110, win: 8 };

/**
 * Past this evaluation the game is decided on material and further nagging is
 * noise. Mates bypass this entirely -- see `isError`.
 */
export const DECIDED_CP = 500;

/**
 * The thresholds in force for the move about to be judged.
 *
 * The centipawn bar is configurable because how much of a slip is worth being
 * stopped for is a matter of taste; the winning-chances bar is not, because it
 * is what stops the centipawn bar from firing in already-decided positions.
 */
export const thresholdsFor = (
  settings: Settings,
  punishArmed: boolean,
  evenWhenDecided = false,
): Thresholds =>
  punishArmed
    ? { cp: settings.missedPunishCp, win: MISSED_PUNISH.win, evenWhenDecided }
    : { cp: settings.ownBlunderCp, win: OWN_BLUNDER.win, evenWhenDecided };

/**
 * Score `playedUci` against the search that produced `lines`.
 *
 * The comparison deliberately stays *within one search*: re-searching the
 * resulting position at a different depth is what makes engines contradict
 * themselves and produce false accusations.
 */
/**
 * Score `playedUci` against the search that produced `lines`.
 *
 * The comparison stays *within one search*: re-searching a child position at a
 * different depth is what makes engines contradict themselves and produce false
 * accusations. When the move is not among the reported lines -- which is common
 * precisely when it is bad -- the caller should pass `playedScore`, obtained by
 * searching the resulting position on the same budget.
 */
export function judge(
  lines: readonly PvLine[],
  playedUci: string,
  playedScore?: PositionScore,
): Verdict | undefined {
  const [best] = lines;
  const worst = lines.at(-1);
  if (!best || !worst) return undefined;

  const listed = lines.find(line => line.moves[0] === playedUci);
  // Known exactly if the engine listed it or the caller looked it up. Otherwise
  // it is at least as bad as the worst line we have, which is all we can justify.
  const known = listed ? { cp: listed.cp, mate: listed.mate } : playedScore;
  const score: PositionScore = known ?? { cp: worst.cp, mate: worst.mate };

  const bestMate = isMateScore(best.cp) && best.cp > 0 ? (best.mate ?? 1) : undefined;
  const playedMate = isMateScore(score.cp) && score.cp > 0 ? (score.mate ?? 1) : undefined;

  // A mate was there and this move either does not mate at all, or mates so much
  // later that it is a different move. Only claimed when the move's own score is
  // known: guessing here is how a player gets accused of missing a mate they in
  // fact played.
  const missesMate =
    bestMate !== undefined &&
    known !== undefined &&
    (playedMate === undefined || muchSlower(playedMate, bestMate));

  const bestIsMated = isMateScore(best.cp) && best.cp < 0;
  const playedIsMated = isMateScore(score.cp) && score.cp < 0;

  return {
    cpLoss: Math.max(0, best.cp - score.cp),
    winLoss: Math.max(0, winPercent(best.cp) - winPercent(score.cp)),
    missesMate,
    ...(missesMate ? { mateIn: bestMate } : {}),
    // Being mated anyway is not this move's fault.
    hangsMate: playedIsMated && !bestIsMated,
    best,
    played: listed,
  };
}

/**
 * Whether a verdict is worth confirming with a deeper search before
 * interrupting.
 *
 * Only marginal calls are: a move that loses far more than the bar, or a mate
 * either way, is not going to be talked out of it by more thinking, and the
 * pause to double-check is itself a tell that something is wrong.
 */
export const VERIFY_MARGIN = 1.8;

export function needsVerification(verdict: Verdict, thresholds: Thresholds): boolean {
  // Mate scores are proofs, not estimates. Nothing to re-check.
  if (verdict.missesMate || verdict.hangsMate) return false;
  return verdict.cpLoss < thresholds.cp * VERIFY_MARGIN;
}

/** Whether a verdict is bad enough to interrupt the game for. */
export function isError(verdict: Verdict, thresholds: Thresholds): boolean {
  // Mate, in either direction, is always worth stopping for: seeing mates is the
  // entire reason this app exists. Checked before any suppression rule.
  if (verdict.missesMate || verdict.hangsMate) return true;
  if (thresholds.evenWhenDecided === true) return verdict.cpLoss >= thresholds.cp;
  if (Math.abs(verdict.best.cp) > DECIDED_CP) return false;
  return verdict.cpLoss >= thresholds.cp && verdict.winLoss >= thresholds.win;
}
