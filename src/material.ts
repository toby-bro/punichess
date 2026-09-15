/**
 * Who has taken what, and who is up.
 *
 * Counted from the position rather than from the moves, so it is right whichever
 * branch of the tree you are standing on and needs no history to be kept.
 */

import type { Color, Role } from 'chessops/types';

import { position } from './chess.ts';

/** The classic values. Not the engine's -- these are for arithmetic you do in your head. */
export const PIECE_VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

/** What each side starts with. */
const FULL_SET: Record<Role, number> = {
  pawn: 8,
  knight: 2,
  bishop: 2,
  rook: 2,
  queen: 1,
  king: 1,
};

/** Biggest first, which is the order they are worth looking at in. */
export const ROLE_ORDER: readonly Role[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

export type RoleCount = Partial<Record<Role, number>>;

export interface Material {
  /** Black pieces White has taken, and white pieces Black has taken. */
  readonly taken: Record<Color, RoleCount>;
  /**
   * How far ahead White is, in pawns. Negative when Black is ahead.
   *
   * Summed from what is actually on the board rather than from the lists above,
   * which is the only way to be right about promotions: a promoted queen leaves
   * a pawn missing without anybody having taken it.
   */
  readonly delta: number;
}

const countBy = (fen: string): Record<Color, RoleCount> => {
  const board = position(fen).board;
  const counts: Record<Color, RoleCount> = { white: {}, black: {} };
  for (const square of board.occupied) {
    const piece = board.get(square);
    if (!piece) continue;
    const side = counts[piece.color];
    side[piece.role] = (side[piece.role] ?? 0) + 1;
  }
  return counts;
};

const worth = (counts: RoleCount): number =>
  ROLE_ORDER.reduce((sum, role) => sum + (counts[role] ?? 0) * PIECE_VALUE[role], 0);

/** What is missing from each side, and who that leaves ahead. */
export function material(fen: string): Material {
  const left = countBy(fen);

  const missing = (side: Color): RoleCount => {
    const gone: RoleCount = {};
    for (const role of ROLE_ORDER) {
      // Clamped at zero: promotion can leave a side with three knights, and
      // nobody has captured a knight from the other player to make that happen.
      const count = Math.max(0, FULL_SET[role] - (left[side][role] ?? 0));
      if (count > 0) gone[role] = count;
    }
    return gone;
  };

  return {
    taken: { white: missing('black'), black: missing('white') },
    delta: worth(left.white) - worth(left.black),
  };
}
