import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN } from './chess.ts';
import { GameTree } from './tree.ts';
import { type Analyse, reviewGame, scoreOf } from './review.ts';
import { type PvLine, mateToCp } from './uci.ts';

/** Legal moves for each position of the little game below, best first. */
const MOVES = [
  ['e2e4', 'd2d4', 'g1f3'],
  ['e7e5', 'c7c5', 'e7e6'],
  ['g1f3', 'f1c4', 'b1c3'],
  ['b8c6', 'g8f6', 'd7d6'],
];

const game = (): GameTree => {
  const history = new GameTree();
  history.play('e2e4');
  history.play('e7e5');
  history.play('g1f3');
  return history;
};

/**
 * An engine stub: `scores[i]` is the best score at position i, from the point of
 * view of whoever is to move there.
 */
const stub = (history: GameTree, scores: readonly number[]): Analyse => {
  const positions = history.mainline.map(node => node.fen);
  return fen => {
    const index = positions.indexOf(fen);
    const best = scores[index] ?? 0;
    const lines: PvLine[] = (MOVES[index] ?? ['e2e4']).map((move, rank) => ({
      multipv: rank + 1,
      cp: best - rank * 40,
      mate: undefined,
      depth: 18,
      moves: [move],
    }));
    return Promise.resolve(lines);
  };
};

describe('reviewGame', () => {
  it('scores every move of the game', async () => {
    const history = game();
    const review = await reviewGame(
      INITIAL_FEN,
      history.mainline,
      stub(history, [30, -30, 30, -30]),
    );
    assert.equal(review.moves.length, 3);
    assert.deepEqual(
      review.moves.map(move => move.san),
      ['e4', 'e5', 'Nf3'],
    );
    assert.deepEqual(
      review.moves.map(move => move.by),
      ['white', 'black', 'white'],
    );
  });

  it('charges a move the difference between consecutive searches', async () => {
    const history = game();
    // White to move sees +0.30; after e4, Black to move sees +0.50, meaning
    // White stands at -0.50. e4 therefore cost 0.80.
    const review = await reviewGame(INITIAL_FEN, history.mainline, stub(history, [30, 50, 0, 0]));
    assert.equal(review.moves[0]?.cpLoss, 80);
  });

  it('charges nothing when the evaluation is unchanged', async () => {
    const history = game();
    const review = await reviewGame(
      INITIAL_FEN,
      history.mainline,
      stub(history, [30, -30, 30, -30]),
    );
    const [first] = review.moves;
    assert.ok(first);
    assert.equal(first.cpLoss, 0);
    assert.equal(first.judgement, 'best');
  });

  it('reports the evaluation from White’s point of view throughout', async () => {
    const history = game();
    const review = await reviewGame(
      INITIAL_FEN,
      history.mainline,
      stub(history, [30, -80, 30, -80]),
    );
    const [first, second] = review.moves;
    assert.ok(first && second);
    // After e4 Black sees -0.80, so White stands at +0.80.
    assert.equal(first.evalAfter, 80);
    // After e5 White sees +0.30, which is already White's point of view.
    assert.equal(second.evalAfter, 30);
  });

  it('starts the evaluation series level and covers every position', async () => {
    const history = game();
    const review = await reviewGame(
      INITIAL_FEN,
      history.mainline,
      stub(history, [30, -30, 30, -30]),
    );
    assert.equal(review.evals.length, history.mainline.length);
    assert.equal(review.evals[0], 0);
  });

  it('keeps the top alternatives and marks the move actually played', async () => {
    const history = game();
    const review = await reviewGame(
      INITIAL_FEN,
      history.mainline,
      stub(history, [30, -30, 30, -30]),
    );
    const first = review.moves[0];
    assert.ok(first);
    assert.equal(first.alternatives.length, 3);
    assert.deepEqual(
      first.alternatives.map(alt => alt.san),
      ['e4', 'd4', 'Nf3'],
    );
    assert.equal(first.alternatives[0]?.played, true);
    assert.equal(first.alternatives[1]?.played, false);
  });

  it('summarises each side separately', async () => {
    const history = game();
    const review = await reviewGame(INITIAL_FEN, history.mainline, stub(history, [30, 50, 0, 0]));
    assert.equal(review.white.moves, 2);
    assert.equal(review.black.moves, 1);
    assert.ok(review.white.acpl >= 0);
  });

  it('reports progress for every position', async () => {
    const history = game();
    const seen: number[] = [];
    await reviewGame(INITIAL_FEN, history.mainline, stub(history, [0, 0, 0, 0]), progress => {
      seen.push(progress.done);
      assert.equal(progress.total, 4);
    });
    assert.deepEqual(seen, [1, 2, 3, 4]);
  });

  it('handles a game with no moves', async () => {
    const review = await reviewGame(INITIAL_FEN, [], stub(new GameTree(), [0]));
    assert.deepEqual(review.moves, []);
    assert.equal(review.white.moves, 0);
  });
});

describe('scoreOf', () => {
  it('takes the best line when there is one', () => {
    const lines: PvLine[] = [{ multipv: 1, cp: 42, mate: undefined, depth: 10, moves: ['e2e4'] }];
    assert.equal(scoreOf(lines, INITIAL_FEN), 42);
  });

  it('reads checkmate off the position when the search has nothing to say', () => {
    // Fool's mate: White to move and mated.
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    assert.ok(scoreOf([], mated) <= mateToCp(-1));
  });

  it('reads a stalemate as level', () => {
    assert.equal(scoreOf([], '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 0);
  });
});
