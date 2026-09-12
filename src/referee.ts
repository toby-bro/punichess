/**
 * Turns a MultiPV search into a verdict about a single move.
 *
 * Centipawns are not linear in "how much did that hurt": dropping 1.00 at a
 * dead-level 0.00 is catastrophic, dropping 1.00 at +7.00 is noise. So every
 * threshold is checked in centipawns *and* in winning chances, and a move is an
 * error only when it fails both.
 */

import { MATE_CP, type PvLine } from './uci.ts';

/**
 * Lichess's fitted centipawn -> expected-score curve. Clamped because the curve
 * is flat past a few pawns and mate scores would otherwise dominate it.
 */
export const winPercent = (cp: number): number =>
  50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp, -2000, 2000))) - 1);

/** Mate scores sit far above any real evaluation; treat them as a separate kind. */
export const isMateScore = (cp: number): boolean => Math.abs(cp) > MATE_CP - 10_000;

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
}

export interface Thresholds {
  /** Minimum centipawn loss before the move counts as an error. */
  readonly cp: number;
  /** Minimum loss of winning chances, in percentage points. */
  readonly win: number;
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
 * Score `playedUci` against the search that produced `lines`.
 *
 * The comparison deliberately stays *within one search*: re-searching the
 * resulting position at a different depth is what makes engines contradict
 * themselves and produce false accusations.
 */
export function judge(lines: readonly PvLine[], playedUci: string): Verdict | undefined {
  const [best] = lines;
  const worst = lines.at(-1);
  if (!best || !worst) return undefined;

  const played = lines.find(line => line.moves[0] === playedUci);
  // The move fell outside the MultiPV window, so it is at least as bad as the
  // worst line we do have. Attribute exactly that, rather than inventing a
  // number we cannot justify.
  const playedCp = played ? played.cp : worst.cp;

  const bestMates = isMateScore(best.cp) && best.cp > 0;
  const playedMates = isMateScore(playedCp) && playedCp > 0;
  const bestIsMated = isMateScore(best.cp) && best.cp < 0;
  const playedIsMated = isMateScore(playedCp) && playedCp < 0;

  return {
    cpLoss: Math.max(0, best.cp - playedCp),
    winLoss: Math.max(0, winPercent(best.cp) - winPercent(playedCp)),
    missesMate: bestMates && !playedMates,
    // Being mated anyway is not this move's fault.
    hangsMate: playedIsMated && !bestIsMated,
    best,
    played,
  };
}

/** Whether a verdict is bad enough to interrupt the game for. */
export function isError(verdict: Verdict, thresholds: Thresholds): boolean {
  // Mate, in either direction, is always worth stopping for: seeing mates is the
  // entire reason this app exists. Checked before any suppression rule.
  if (verdict.missesMate || verdict.hangsMate) return true;
  if (Math.abs(verdict.best.cp) > DECIDED_CP) return false;
  return verdict.cpLoss >= thresholds.cp && verdict.winLoss >= thresholds.win;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
