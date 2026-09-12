import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BLUNDER_MAX,
  BLUNDER_MIN,
  PUNISH_MARGIN,
  QUIET_BAND,
  type Search,
  chooseMove,
  pickBlunder,
  pickQuiet,
} from './bot.ts';
import { INITIAL_FEN } from './chess.ts';
import { DECIDED_CP } from './referee.ts';
import type { PvLine } from './uci.ts';

const search = (...moves: [string, number][]): PvLine[] =>
  moves.map(([move, cp], index) => ({
    multipv: index + 1,
    cp,
    mate: undefined,
    depth: 18,
    moves: [move],
  }));

/** A search stub that returns fixed replies regardless of position. */
const replying = (...moves: [string, number][]): Search => {
  const replies = search(...moves);
  return () => Promise.resolve(replies);
};

describe('pickQuiet', () => {
  // Losses from the best move: 0, 5, 90 (all inside the band) and 430 (outside).
  const lines = search(['e2e4', 30], ['d2d4', 25], ['g1f3', -60], ['a2a4', -400]);

  it('never picks a move outside the quiet band', () => {
    for (let i = 0; i < 50; i++) {
      const move = pickQuiet(lines, Math.random);
      assert.notEqual(move, 'a2a4', 'a 4.30 drop is not a quiet move');
    }
  });

  it('includes every move within the band', () => {
    const seen = new Set<string>();
    for (const r of [0, 0.34, 0.67, 0.99]) seen.add(pickQuiet(lines, () => r) ?? '');
    assert.deepEqual([...seen].sort(), ['d2d4', 'e2e4', 'g1f3']);
  });

  it('respects the band boundary exactly', () => {
    const edge = search(['best', 0], ['edge', -QUIET_BAND], ['past', -QUIET_BAND - 1]);
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.05) seen.add(pickQuiet(edge, () => r) ?? '');
    assert.ok(seen.has('edge'));
    assert.ok(!seen.has('past'));
  });

  it('tolerates a random() that returns exactly 1', () => {
    assert.ok(pickQuiet(lines, () => 1));
  });

  it('returns nothing when there are no moves', () => {
    assert.equal(pickQuiet([]), undefined);
  });
});

describe('pickBlunder', () => {
  // e2e4 is best; e2e3 loses 1.50, which is inside the blunder band.
  const lines = search(['e2e4', 30], ['e2e3', -120], ['a2a3', -900]);

  it('picks an error inside the band when it is punishable', async () => {
    const move = await pickBlunder(
      { search: replying(['d7d5', 200], ['b8c6', 20]) },
      INITIAL_FEN,
      lines,
    );
    assert.equal(move, 'e2e3');
  });

  it('refuses an error whose refutation is not clear-cut', async () => {
    // Every reply is about as good, so there is nothing for the player to spot.
    const move = await pickBlunder(
      { search: replying(['d7d5', 200], ['b8c6', 200 - PUNISH_MARGIN + 1]) },
      INITIAL_FEN,
      lines,
    );
    assert.equal(move, undefined);
  });

  it('ignores moves that are too cheap or too expensive to be useful', async () => {
    const tooCheap = search(['e2e4', 30], ['d2d4', 30 - BLUNDER_MIN + 1]);
    const tooDear = search(['e2e4', 30], ['a2a4', 30 - BLUNDER_MAX - 1]);
    const policy = { search: replying(['d7d5', 500], ['b8c6', 0]) };
    assert.equal(await pickBlunder(policy, INITIAL_FEN, tooCheap), undefined);
    assert.equal(await pickBlunder(policy, INITIAL_FEN, tooDear), undefined);
  });

  it('does not throw the game when it is already decided', async () => {
    const won = search(['e2e4', DECIDED_CP + 1], ['e2e3', DECIDED_CP + 1 - BLUNDER_MIN - 10]);
    const move = await pickBlunder(
      { search: replying(['d7d5', 500], ['b8c6', 0]) },
      INITIAL_FEN,
      won,
    );
    assert.equal(move, undefined);
  });

  it('returns nothing when there is no search to work from', async () => {
    assert.equal(await pickBlunder({ search: replying() }, INITIAL_FEN, []), undefined);
  });
});

describe('chooseMove', () => {
  const lines = search(['e2e4', 30], ['e2e3', -120]);

  it('plays honestly when it is not trying to err', async () => {
    const move = await chooseMove({ search: replying() }, INITIAL_FEN, lines, false);
    assert.deepEqual(move, { uci: 'e2e4', deliberateError: false });
  });

  it('marks a deliberate error so the referee can arm the strict rule', async () => {
    const policy = { search: replying(['d7d5', 300], ['b8c6', 0]) };
    const move = await chooseMove(policy, INITIAL_FEN, lines, true);
    assert.deepEqual(move, { uci: 'e2e3', deliberateError: true });
  });

  it('falls back to honest play when no punishable error exists', async () => {
    const policy = { search: replying(['d7d5', 10], ['b8c6', 5]) };
    const move = await chooseMove(policy, INITIAL_FEN, lines, true);
    assert.equal(move?.deliberateError, false);
  });

  it('returns nothing when the engine offered no moves', async () => {
    assert.equal(await chooseMove({ search: replying() }, INITIAL_FEN, [], false), undefined);
  });
});
