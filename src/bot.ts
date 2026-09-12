/**
 * Bot move policy.
 *
 * Honest play means "any move that does not actually cost anything", picked at
 * random so the bot is not a repeatable top-move machine. Errors are made on
 * purpose, and only when they are *punishable* -- see `pickBlunder`.
 */

import { fenAfter } from './chess.ts';
import { DECIDED_CP } from './referee.ts';
import type { PvLine } from './uci.ts';

/** Widest centipawn loss the bot accepts while playing honestly. */
export const QUIET_BAND = 100;
/** A deliberate error must cost at least this much... */
export const BLUNDER_MIN = 100;
/** ...and at most this much, so the game stays a game. */
export const BLUNDER_MAX = 300;
/**
 * ...and the refutation must beat the second-best reply by this margin, or
 * there is nothing for you to spot and stopping you would be unfair.
 */
export const PUNISH_MARGIN = 80;

/** Analyse a position. Injected so the policy can be tested without an engine. */
export type Search = (fen: string) => Promise<readonly PvLine[]>;

export interface Policy {
  readonly search: Search;
  /** Injectable for deterministic tests; defaults to Math.random. */
  readonly random?: (() => number) | undefined;
}

export interface BotMove {
  readonly uci: string;
  /** True when the bot chose to go wrong here, so the referee can arm the strict rule. */
  readonly deliberateError: boolean;
}

/**
 * Choose the bot's move. Returns undefined only when there is nothing to play,
 * which callers should have detected as game over first.
 */
export async function chooseMove(
  policy: Policy,
  fen: string,
  lines: readonly PvLine[],
  wantsError: boolean,
): Promise<BotMove | undefined> {
  if (lines.length === 0) return undefined;

  if (wantsError) {
    const blunder = await pickBlunder(policy, fen, lines);
    if (blunder) return { uci: blunder, deliberateError: true };
  }

  const quiet = pickQuiet(lines, policy.random ?? Math.random);
  return quiet ? { uci: quiet, deliberateError: false } : undefined;
}

/** Any move that costs at most QUIET_BAND, chosen uniformly at random. */
export function pickQuiet(
  lines: readonly PvLine[],
  random: () => number = Math.random,
): string | undefined {
  const [best] = lines;
  if (!best) return undefined;

  const band = lines.filter(line => best.cp - line.cp <= QUIET_BAND);
  const chosen = band[Math.min(band.length - 1, Math.floor(random() * band.length))];
  return (chosen ?? best).moves[0];
}

/**
 * Find an error worth making: costly enough to matter, cheap enough to recover
 * from, and above all one with a clear refutation for you to find.
 */
export async function pickBlunder(
  policy: Policy,
  fen: string,
  lines: readonly PvLine[],
): Promise<string | undefined> {
  const [best] = lines;
  if (!best) return undefined;
  // Erring on purpose in an already decided game teaches nothing.
  if (Math.abs(best.cp) > DECIDED_CP) return undefined;

  const random = policy.random ?? Math.random;
  const candidates = lines
    .filter(line => {
      const loss = best.cp - line.cp;
      return loss >= BLUNDER_MIN && loss <= BLUNDER_MAX;
    })
    .map(line => ({ line, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.line);

  for (const candidate of candidates) {
    const move = candidate.moves[0];
    const replies = await policy.search(fenAfter(fen, move));
    const [punish, second] = replies;
    // A punishable error is one where the right reply stands out. If every reply
    // is about as good there is no insight to have, so look for another error.
    if (punish && second && punish.cp - second.cp >= PUNISH_MARGIN) return move;
  }
  return undefined;
}
