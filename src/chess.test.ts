import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INITIAL_FEN,
  fenAfter,
  isLegal,
  legalDests,
  halfmoveClock,
  outcomeOf,
  positionHash,
  sanLine,
  sanOf,
  stalemateCage,
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

describe('stalemateCage', () => {
  it('describes nothing for a position that is still a game', () => {
    assert.equal(stalemateCage(INITIAL_FEN), undefined);
  });

  it('names the trapped king and the ring around it', () => {
    // Black king h8, white queen f7, white king g6: stalemate.
    const cage = stalemateCage('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.ok(cage);
    assert.equal(cage.king, 'h8');
    assert.deepEqual([...cage.blocked].sort(), ['g7', 'g8', 'h7']);
  });

  it('says nothing about a checkmate, which is a different thing entirely', () => {
    assert.equal(stalemateCage('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), undefined);
  });
});

describe('positionHash', () => {
  it('ignores the move clocks, which always differ', () => {
    const early = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const later = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 8 12';
    assert.equal(positionHash(early), positionHash(later));
  });

  it('separates positions that differ in whose move it is', () => {
    const white = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const black = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    assert.notEqual(positionHash(white), positionHash(black));
  });

  it('separates positions that differ in castling rights', () => {
    const both = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const lost = 'r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1';
    assert.notEqual(positionHash(both), positionHash(lost));
  });

  it('separates positions that differ in en passant', () => {
    const available = 'rnbqkbnr/pp1ppppp/8/2p5/8/8/PPPPPPPP/RNBQKBNR w KQkq c6 0 2';
    const gone = 'rnbqkbnr/pp1ppppp/8/2p5/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
    assert.notEqual(positionHash(available), positionHash(gone));
  });

  it('is a plain unsigned number', () => {
    const hash = positionHash(INITIAL_FEN);
    assert.ok(Number.isInteger(hash) && hash >= 0);
  });

  it('does not collide across a whole game of positions', () => {
    // Not a proof, but the only failure mode worth checking: a collision would
    // cost a move needlessly declined.
    const seen = new Set<number>();
    let fen = INITIAL_FEN;
    for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6']) {
      seen.add(positionHash(fen));
      fen = fenAfter(fen, uci);
    }
    assert.equal(seen.size, 8);
  });
});

describe('halfmoveClock', () => {
  it('reads the count of plies since the last pawn move or capture', () => {
    assert.equal(halfmoveClock('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 12'), 7);
  });

  it('is zero right after a pawn move', () => {
    assert.equal(halfmoveClock(fenAfter(INITIAL_FEN, 'e2e4')), 0);
  });

  it('counts up over moves that can be taken back', () => {
    const after = fenAfter(fenAfter(INITIAL_FEN, 'g1f3'), 'g8f6');
    assert.equal(halfmoveClock(after), 2);
  });

  it('reads nonsense as zero rather than going wrong quietly', () => {
    assert.equal(halfmoveClock('not a fen'), 0);
    assert.equal(halfmoveClock('a b c d e f'), 0);
  });
});
