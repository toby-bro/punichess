/**
 * Position helpers. All pure: chessops owns the rules, this only wraps it in
 * the vocabulary the rest of the app speaks (FEN strings and UCI moves).
 */

import type { Dests, Key } from 'chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import type { Color, Move } from 'chessops/types';
import { makeUci, parseUci } from 'chessops/util';

export { INITIAL_FEN };

/** Parse a FEN, throwing if it does not describe a legal position. */
export const position = (fen: string): Chess => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

/** Whether a FEN parses and describes a position the rules allow. */
export function isLegal(fen: string): boolean {
  try {
    return Chess.fromSetup(parseFen(fen).unwrap()).isOk;
  } catch {
    return false;
  }
}

/** Play `uci` and return the resulting FEN. Throws if the move is not legal. */
export function fenAfter(fen: string, uci: string): string {
  const pos = position(fen);
  pos.play(legalMove(pos, uci));
  return makeFen(pos.toSetup());
}

/** Render a UCI move as SAN in the context of `fen`. */
export function sanOf(fen: string, uci: string): string {
  const pos = position(fen);
  return makeSan(pos, legalMove(pos, uci));
}

/**
 * Render a variation as SAN, for the explanation view.
 *
 * A principal variation can run past the point where it stays legal (the engine
 * truncates, the position was edited), so this stops at the first move it
 * cannot play rather than throwing away the readable prefix.
 */
export function sanLine(fen: string, ucis: readonly string[]): string[] {
  const pos = position(fen);
  const sans: string[] = [];
  for (const uci of ucis) {
    let move: Move;
    try {
      move = legalMove(pos, uci);
    } catch {
      break;
    }
    sans.push(makeSan(pos, move));
    pos.play(move);
  }
  return sans;
}

/**
 * Convert a move written in SAN to UCI, for reading PGN.
 *
 * Returns undefined rather than throwing: a PGN can contain moves that are not
 * legal in the position, and skipping such a branch beats losing the whole game.
 */
export function uciOfSan(fen: string, san: string): string | undefined {
  try {
    const pos = position(fen);
    const move = parseSan(pos, san);
    return move ? makeUci(move) : undefined;
  } catch {
    return undefined;
  }
}

/** Legal destinations per origin square, in the shape chessground wants. */
export const legalDests = (fen: string): Dests => chessgroundDests(position(fen));

/** An empty move map, which is how the board is locked while the bot thinks. */
export const noDests = (): Dests => new Map<Key, Key[]>();

export const turnOf = (fen: string): Color => position(fen).turn;

export interface GameOver {
  readonly reason: 'checkmate' | 'stalemate' | 'insufficient material' | 'draw';
  readonly winner?: Color | undefined;
}

/** The result, if the game has ended in this position. */
export function outcomeOf(fen: string): GameOver | undefined {
  const pos = position(fen);
  if (!pos.isEnd()) return undefined;
  if (pos.isCheckmate()) {
    return { reason: 'checkmate', winner: pos.turn === 'white' ? 'black' : 'white' };
  }
  if (pos.isStalemate()) return { reason: 'stalemate' };
  if (pos.isInsufficientMaterial()) return { reason: 'insufficient material' };
  return { reason: 'draw' };
}

/**
 * Decode a UCI move and check it against the position.
 *
 * Stockfish encodes castling as the king's two-square move, while chessops
 * wants king-takes-own-rook, so that one case is translated here.
 */
function legalMove(pos: Chess, uci: string): Move {
  const parsed = parseUci(uci);
  if (!parsed) throw new Error(`unparseable uci move: ${uci}`);

  const move = 'from' in parsed && pos.board.king.has(parsed.from) ? asCastle(pos, parsed) : parsed;
  if (!pos.isLegal(move)) throw new Error(`illegal move for this position: ${uci}`);
  return move;
}

function asCastle(pos: Chess, move: Move & { from: number; to: number }): Move {
  const delta = move.to - move.from;
  if (Math.abs(delta) !== 2) return move;
  const rook = pos.castles.rook[pos.turn][delta > 0 ? 'h' : 'a'];
  return rook === undefined ? move : { ...move, to: rook };
}
