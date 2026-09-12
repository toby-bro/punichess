import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN, turnOf } from './chess.ts';
import { History } from './history.ts';

const opening = (): History => {
  const history = new History();
  history.play('e2e4');
  history.play('e7e5');
  history.play('g1f3');
  return history;
};

describe('History', () => {
  it('starts empty, at the initial position', () => {
    const history = new History();
    assert.equal(history.fen, INITIAL_FEN);
    assert.equal(history.length, 0);
    assert.equal(history.cursor, 0);
    assert.ok(history.atLive);
    assert.ok(history.atStart);
    assert.equal(history.lastMove, undefined);
  });

  it('records moves with their SAN and resulting position', () => {
    const history = new History();
    const ply = history.play('e2e4');
    assert.equal(ply.san, 'e4');
    assert.equal(ply.by, 'white');
    assert.equal(history.fen, ply.fen);
    assert.equal(turnOf(history.fen), 'black');
  });

  it('rejects an illegal move without changing anything', () => {
    const history = opening();
    const before = history.fen;
    assert.throws(() => history.play('e2e9'));
    assert.equal(history.fen, before);
    assert.equal(history.length, 3);
  });

  describe('navigation', () => {
    it('steps backwards and forwards through the game', () => {
      const history = opening();
      assert.equal(history.cursor, 3);

      history.back();
      assert.equal(history.cursor, 2);
      assert.equal(history.lastMove?.san, 'e5');
      assert.ok(!history.atLive);

      history.forward();
      assert.equal(history.cursor, 3);
      assert.ok(history.atLive);
    });

    it('jumps to the start and back to the end', () => {
      const history = opening();
      history.first();
      assert.equal(history.fen, INITIAL_FEN);
      assert.ok(history.atStart);

      history.last();
      assert.equal(history.cursor, 3);
      assert.ok(history.atLive);
    });

    it('clamps rather than running off either end', () => {
      const history = opening();
      for (let i = 0; i < 10; i++) history.back();
      assert.equal(history.cursor, 0);
      for (let i = 0; i < 10; i++) history.forward();
      assert.equal(history.cursor, 3);
      history.goTo(-5);
      assert.equal(history.cursor, 0);
      history.goTo(99);
      assert.equal(history.cursor, 3);
    });

    it('reports the position after any number of plies', () => {
      const history = opening();
      assert.equal(history.at(0), INITIAL_FEN);
      assert.equal(history.at(1), history.plies[0]?.fen);
      assert.equal(history.at(3), history.plies[2]?.fen);
      assert.equal(history.at(99), history.plies[2]?.fen, 'clamps past the end');
    });

    it('tracks whose turn it is in the position being viewed', () => {
      const history = opening();
      assert.equal(history.turn, 'black');
      history.back();
      assert.equal(history.turn, 'white');
    });
  });

  describe('forking', () => {
    it('discards the continuation when you play from an earlier position', () => {
      const history = opening();
      history.goTo(1); // after 1. e4
      const ply = history.play('c7c5');

      assert.equal(ply.san, 'c5');
      assert.equal(history.length, 2, 'e5 and Nf3 are gone');
      assert.deepEqual(
        history.plies.map(p => p.san),
        ['e4', 'c5'],
      );
      assert.ok(history.atLive);
    });

    it('can restart the game from the very beginning', () => {
      const history = opening();
      history.first();
      history.play('d2d4');
      assert.deepEqual(
        history.plies.map(p => p.san),
        ['d4'],
      );
    });

    it('truncate makes the viewed position the end of the game', () => {
      const history = opening();
      history.goTo(1);
      history.truncate();
      assert.equal(history.length, 1);
      assert.ok(history.atLive);
      assert.deepEqual(
        history.plies.map(p => p.san),
        ['e4'],
      );
    });

    it('truncate at the live position changes nothing', () => {
      const history = opening();
      history.truncate();
      assert.equal(history.length, 3);
    });

    it('leaves the game alone when replaying the same move', () => {
      const history = opening();
      history.goTo(1);
      history.play('e7e5');
      assert.deepEqual(
        history.plies.map(p => p.san),
        ['e4', 'e5'],
      );
    });
  });

  describe('punishArmed', () => {
    it('is off during ordinary play', () => {
      assert.equal(opening().punishArmed, false);
    });

    it('arms only the reply to a deliberate error', () => {
      const history = new History();
      history.play('e2e4');
      history.play('e7e5', { deliberateError: true });
      assert.equal(history.punishArmed, true, 'it is now the punisher to move');

      history.play('g1f3');
      assert.equal(history.punishArmed, false, 'and disarms once replied to');
    });

    it('re-arms when you navigate back to the position', () => {
      const history = new History();
      history.play('e2e4');
      history.play('e7e5', { deliberateError: true });
      history.play('g1f3');

      history.back();
      assert.equal(history.punishArmed, true, 'going back restores the chance to punish');
    });
  });
});
