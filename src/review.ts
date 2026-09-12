/**
 * Full-game analysis, the way a post-game review reads on lichess: every move
 * scored, labelled, and shown next to the alternatives that were available.
 *
 * The engine is analysed once per *position* rather than once per move. A move's
 * cost then falls out of two consecutive searches, which keeps both sides of the
 * comparison at the same depth -- the same reason the live referee never
 * re-searches a child position on its own.
 */

import type { Color } from 'chessops/types';

import { sanOf } from './chess.ts';
import type { TreeNode } from './tree.ts';
import { scorePosition, winPercent } from './referee.ts';
import { type Judgement, type Summary, classify, summarise } from './stats.ts';
import { MATE_CP, type PvLine } from './uci.ts';

/** How many alternatives to keep for each position. */
export const ALTERNATIVES = 3;

export interface Alternative {
  readonly uci: string;
  readonly san: string;
  readonly cp: number;
  readonly mate?: number | undefined;
  /** True when this is the move that was actually played. */
  readonly played: boolean;
}

export interface ReviewedMove {
  /** The node this move reaches, so clicking a row can put it on the board. */
  readonly nodeId: number;
  /** 1-based move number in plies. */
  readonly ply: number;
  readonly by: Color;
  readonly uci: string;
  readonly san: string;
  readonly cpLoss: number;
  readonly winLoss: number;
  readonly judgement: Judgement;
  /** Evaluation after the move, in centipawns from White's point of view. */
  readonly evalAfter: number;
  /** The best moves in the position before this one, best first. */
  readonly alternatives: readonly Alternative[];
}

export interface Review {
  readonly moves: readonly ReviewedMove[];
  /** Evaluation after each position including the start, from White's view. */
  readonly evals: readonly number[];
  readonly white: Summary;
  readonly black: Summary;
}

export type Analyse = (fen: string) => Promise<readonly PvLine[]>;

/** The position's evaluation from the side to move's point of view. */
export function scoreOf(lines: readonly PvLine[], fen: string): number {
  return scorePosition(lines, fen).cp;
}

export interface ReviewProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * Score every move of a game.
 *
 * `onProgress` is called as each position is searched, because this takes a
 * second or so per move and silence would look like a hang.
 */
export async function reviewGame(
  start: string,
  line: readonly TreeNode[],
  analyse: Analyse,
  onProgress?: (progress: ReviewProgress) => void,
): Promise<Review> {
  const plies = line.flatMap(node => (node.move ? [{ node, move: node.move }] : []));
  const positions = [start, ...plies.map(entry => entry.node.fen)];
  const searches: (readonly PvLine[])[] = [];

  for (const [index, fen] of positions.entries()) {
    searches.push(await analyse(fen));
    onProgress?.({ done: index + 1, total: positions.length });
  }

  const moves: ReviewedMove[] = [];
  for (const [index, { node, move }] of plies.entries()) {
    const before = positions[index];
    const after = positions[index + 1];
    const search = searches[index];
    const nextSearch = searches[index + 1];
    if (before === undefined || after === undefined || !search || !nextSearch) continue;

    // Both scores are from the mover's point of view, so they subtract directly.
    const bestScore = scoreOf(search, before);
    const playedScore = -scoreOf(nextSearch, after);
    const cpLoss = Math.max(0, Math.min(bestScore - playedScore, MATE_CP));
    const winLoss = Math.max(0, winPercent(bestScore) - winPercent(playedScore));

    moves.push({
      nodeId: node.id,
      ply: index + 1,
      by: move.by,
      uci: move.uci,
      san: move.san,
      cpLoss,
      winLoss,
      judgement: classify(cpLoss, winLoss),
      evalAfter: move.by === 'white' ? playedScore : -playedScore,
      alternatives: alternativesOf(search, before, move.uci),
    });
  }

  const entries = moves.map(move => ({
    by: move.by,
    cpLoss: move.cpLoss,
    winLoss: move.winLoss,
    judgement: move.judgement,
  }));

  return {
    moves,
    evals: [0, ...moves.map(move => move.evalAfter)],
    white: summarise(entries.filter(entry => entry.by === 'white')),
    black: summarise(entries.filter(entry => entry.by === 'black')),
  };
}

function alternativesOf(lines: readonly PvLine[], fen: string, playedUci: string): Alternative[] {
  return lines.slice(0, ALTERNATIVES).map(line => ({
    uci: line.moves[0],
    san: sanOf(fen, line.moves[0]),
    cp: line.cp,
    mate: line.mate,
    played: line.moves[0] === playedUci,
  }));
}
