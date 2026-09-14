/**
 * Position helpers. All pure: chessops owns the rules, this only wraps it in
 * the vocabulary the rest of the app speaks (FEN strings and UCI moves).
 */

import type { Dests, Key } from 'chessground/types';
import { Chess } from 'chessops/chess';
import { kingAttacks } from 'chessops/attacks';
import { chessgroundDests } from 'chessops/compat';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import type { Color, Move, Role } from 'chessops/types';
import { makeSquare, makeUci, parseSquare, parseUci } from 'chessops/util';

export { INITIAL_FEN };

/** Parse a FEN, throwing if it does not describe a legal position. */
export const position = (fen: string): Chess => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

/**
 * A position's identity for repetition purposes, as a number.
 *
 * FNV-1a over the first four FEN fields: the pieces, the side to move, the
 * castling rights and the en passant square. The move clocks are skipped
 * because they differ by definition, and comparing whole FENs would therefore
 * never find a repetition at all.
 *
 * A number rather than the string it came from, and computed without cutting
 * one out, because this runs for every candidate move of every search. A
 * collision would cost a move needlessly declined, which is not worth a byte
 * more than 32 bits to avoid.
 */
export function positionHash(fen: string): number {
  let hash = 0x811c9dc5;
  let fields = 0;
  for (let i = 0; i < fen.length; i++) {
    const code = fen.charCodeAt(i);
    if (code === 32 && ++fields === 4) break;
    hash = Math.imul(hash ^ code, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Plies since the last pawn move or capture, as the FEN records it.
 *
 * Both of those are irreversible, so no position before the last one can ever
 * come round again: this is exactly how far back a repetition check needs to
 * look, and usually it is only a handful of moves.
 */
export function halfmoveClock(fen: string): number {
  const clock = Number(fen.split(' ')[4]);
  return Number.isFinite(clock) && clock >= 0 ? clock : 0;
}

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

export interface MoveKind {
  /** The move takes something. */
  readonly capture: boolean;
  /** It gives check. */
  readonly check: boolean;
  /**
   * The square it lands on is defended, so taking there is a trade or a
   * sacrifice rather than picking up something free.
   */
  readonly defended: boolean;
  /**
   * What the move takes, in centipawns, or 0 if it takes nothing.
   *
   * Rough on purpose: it answers "is that a piece or a pawn", which is the only
   * question anyone asks of it.
   */
  readonly value: number;
}

/** What each piece is worth, for the one question above and nothing else. */
const VALUE: Record<Role, number> = {
  pawn: 100,
  knight: 300,
  bishop: 320,
  rook: 500,
  queen: 900,
  king: 0,
};

/**
 * What a move does, in the terms needed to tell a tactic from a free lunch.
 *
 * Whether the destination is defended is judged *after* the move, by asking
 * whether the opponent could take back -- which is the question that actually
 * matters and costs nothing extra to answer.
 */
export function moveKind(fen: string, uci: string): MoveKind {
  const before = position(fen);
  const move = legalMove(before, uci);
  const target = 'to' in move ? move.to : undefined;
  const capture = target !== undefined && before.board.occupied.has(target);

  const taken = target === undefined ? undefined : before.board.get(target);

  const after = position(fen);
  after.play(move);
  const defended =
    target !== undefined && [...after.allDests()].some(([, targets]) => targets.has(target));

  return {
    capture,
    check: after.isCheck(),
    defended,
    value: taken ? VALUE[taken.role] : 0,
  };
}

/**
 * Every legal way to capture whatever stands on a square.
 *
 * Used to find out what a piece is being offered to, and at what. A trap is only
 * a trap if taking is possible, and only a fair one if every way of taking is
 * bad -- so this returns all of them, not the first.
 */
export function capturesTo(fen: string, square: string): string[] {
  const pos = position(fen);
  const target = parseSquare(square);
  if (target === undefined || !pos.board.occupied.has(target)) return [];
  const taking: string[] = [];
  for (const [from, targets] of pos.allDests()) {
    if (targets.has(target)) taking.push(makeSquare(from) + square);
  }
  return taking;
}

/** Legal destinations per origin square, in the shape chessground wants. */
export const legalDests = (fen: string): Dests => chessgroundDests(position(fen));

/** An empty move map, which is how the board is locked while the bot thinks. */
export const noDests = (): Dests => new Map<Key, Key[]>();

export const turnOf = (fen: string): Color => position(fen).turn;

/**
 * The squares that explain a stalemate: the king, and everywhere it cannot go.
 *
 * Being told "that was stalemate" is one thing; seeing the ring of squares that
 * are all covered is what makes it obvious next time.
 */
export function stalemateCage(fen: string): { king: string; blocked: string[] } | undefined {
  const pos = position(fen);
  if (!pos.isStalemate()) return undefined;

  const king = pos.board.kingOf(pos.turn);
  if (king === undefined) return undefined;

  // In stalemate the king has no legal move at all, so every square around it is
  // either covered or occupied by its own side.
  const blocked = [...kingAttacks(king)].map(makeSquare);
  return { king: makeSquare(king), blocked };
}

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
