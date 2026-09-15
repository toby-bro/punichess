import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INITIAL_FEN } from './chess.ts';
import { material } from './material.ts';

test('nobody has taken anything at the start', () => {
  const { taken, delta } = material(INITIAL_FEN);
  assert.deepEqual(taken.white, {});
  assert.deepEqual(taken.black, {});
  assert.equal(delta, 0);
});

test('a pawn each leaves the count level', () => {
  // 1. e4 d5 2. exd5 Qxd5.
  const fen = 'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3';
  const { taken, delta } = material(fen);
  assert.deepEqual(taken.white, { pawn: 1 });
  assert.deepEqual(taken.black, { pawn: 1 });
  assert.equal(delta, 0);
});

test('a queen down is nine down', () => {
  const fen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const { taken, delta } = material(fen);
  assert.deepEqual(taken.white, { queen: 1 });
  assert.equal(delta, 9);
});

test('a promotion cannot make a side look richer than it is', () => {
  // White has promoted: seven pawns, two queens, everything else untouched.
  const fen = 'rnbqkbnr/pppppppp/8/8/4Q3/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1';
  const { taken, delta } = material(fen);

  // The extra queen must not show up as one White has taken from Black. Black
  // still has hers.
  assert.equal(taken.white.queen, undefined);
  assert.deepEqual(taken.white, {});

  // 7 pawns + 18 queens + 10 rooks + 6 + 6 = 47 against 39.
  assert.equal(delta, 8);
});

test('a promoted pawn is the one thing the board cannot tell you about', () => {
  // The same position. The missing pawn is listed as taken by Black, because it
  // is missing and nothing in the position says it left by promoting rather than
  // by being captured. Counting moves instead would fix the list and break on
  // every branch of the tree, which is a worse trade: the number beside it, the
  // one people actually read, is right either way.
  const fen = 'rnbqkbnr/pppppppp/8/8/4Q3/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1';
  assert.deepEqual(material(fen).taken.black, { pawn: 1 });
});

test('the delta is read from the board, not from the lists', () => {
  // Black is a rook up and a pawn down.
  const fen = 'rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1';
  const { delta } = material(fen);
  assert.equal(delta, -4);
});
