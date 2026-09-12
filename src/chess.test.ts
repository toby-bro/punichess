import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INITIAL_FEN,
  fenAfter,
  isLegal,
  legalDests,
  outcomeOf,
  sanLine,
  sanOf,
  turnOf,
} from './chess.ts';

describe('fenAfter', () => {
  it('plays a move and hands the turn over', () => {
    const after = fenAfter(INITIAL_FEN, 'e2e4');
    assert.match(after, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);
    assert.equal(turnOf(after), 'black');
  });

  it('handles castling, which UCI and chessops encode differently', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
    const short = fenAfter(fen, 'e1g1');
    assert.match(short, /^r3k2r\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/R4RK1 b kq/);
    const long = fenAfter(fen, 'e1c1');
    assert.match(long, /^r3k2r\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/2KR3R b kq/);
  });

  it('handles promotion', () => {
    const after = fenAfter('8/P6k/8/8/8/8/8/7K w - - 0 1', 'a7a8q');
    assert.match(after, /^Q7\/7k/);
  });

  it('handles en passant', () => {
    const after = fenAfter('8/8/8/3pP3/8/8/8/k6K w - d6 0 2', 'e5d6');
    assert.match(after, /^8\/8\/3P4\/8\/8\/8\/8\/k6K b/);
  });

  it('rejects an illegal move rather than corrupting the position', () => {
    assert.throws(() => fenAfter(INITIAL_FEN, 'e2e5'));
    assert.throws(() => fenAfter(INITIAL_FEN, 'zzzz'));
  });
});

describe('sanOf and sanLine', () => {
  it('renders a move the way a human reads it', () => {
    assert.equal(sanOf(INITIAL_FEN, 'g1f3'), 'Nf3');
  });

  it('marks mate', () => {
    assert.equal(sanOf('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8'), 'Ra8#');
  });

  it('renders a whole variation in sequence', () => {
    assert.deepEqual(sanLine(INITIAL_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6']), [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
    ]);
  });

  it('stops cleanly on a variation that goes illegal', () => {
    assert.deepEqual(sanLine(INITIAL_FEN, ['e2e4', 'e7e5', 'e4e5']), ['e4', 'e5']);
  });
});

describe('outcomeOf', () => {
  it('says nothing about a game still in progress', () => {
    assert.equal(outcomeOf(INITIAL_FEN), undefined);
  });

  it('detects checkmate and who won', () => {
    assert.deepEqual(outcomeOf('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), {
      reason: 'checkmate',
      winner: 'white',
    });
  });

  it('detects stalemate', () => {
    assert.deepEqual(outcomeOf('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), { reason: 'stalemate' });
  });

  it('detects insufficient material', () => {
    assert.deepEqual(outcomeOf('7k/8/6K1/8/8/8/8/8 w - - 0 1'), {
      reason: 'insufficient material',
    });
  });
});

describe('legalDests', () => {
  it('offers exactly the twenty opening moves', () => {
    const dests = legalDests(INITIAL_FEN);
    const total = [...dests.values()].reduce((sum, targets) => sum + targets.length, 0);
    assert.equal(total, 20);
  });
});

describe('isLegal', () => {
  it('accepts a real position', () => {
    assert.equal(isLegal(INITIAL_FEN), true);
  });

  it('rejects a position with the wrong side to move while the other is in check', () => {
    // Black king on e8 is in check from Qe2, yet it is White to move.
    assert.equal(isLegal('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1'), false);
  });

  it('rejects nonsense', () => {
    assert.equal(isLegal('not a fen'), false);
  });
});
