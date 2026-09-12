import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PositionCache } from './cache.ts';
import type { PvLine } from './uci.ts';

const lines = (cp: number): PvLine[] => [
  { multipv: 1, cp, mate: undefined, depth: 20, moves: ['e2e4'] },
];

describe('PositionCache', () => {
  it('returns nothing for a position it has not seen', () => {
    assert.equal(new PositionCache().get('fen', 1000, 1), undefined);
  });

  it('returns a search that was at least as thorough as the one asked for', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(30), 1_000_000, 8);
    assert.deepEqual(cache.get('fen', 1_000_000, 8), lines(30));
    assert.deepEqual(cache.get('fen', 700_000, 3), lines(30), 'a cheaper ask is satisfied');
  });

  it('refuses a search that was weaker than the one asked for', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(30), 700_000, 3);
    assert.equal(cache.get('fen', 1_000_000, 3), undefined, 'too few nodes');
    assert.equal(cache.get('fen', 700_000, 8), undefined, 'too few lines');
  });

  it('never lets a cheaper search displace a better one', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(30), 1_000_000, 8);
    cache.set('fen', lines(99), 100_000, 1);
    assert.deepEqual(cache.get('fen', 1_000_000, 8), lines(30));
  });

  it('replaces an entry with a more thorough one', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(30), 700_000, 3);
    cache.set('fen', lines(99), 4_000_000, 8);
    assert.deepEqual(cache.get('fen', 4_000_000, 8), lines(99));
  });

  it('hands back whatever it has when the question is only what is known', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(30), 1000, 1);
    // Too weak to judge with, but a display has no standard to fall short of.
    assert.equal(cache.get('fen', 500_000, 8), undefined);
    assert.deepEqual(cache.lines('fen'), lines(30));
    assert.equal(cache.lines('unseen'), undefined);
  });

  it('exposes the best line for a quick evaluation', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(42), 1000, 1);
    assert.equal(cache.best('fen')?.cp, 42);
    assert.equal(cache.best('missing'), undefined);
  });

  it('drops the oldest positions once full', () => {
    const cache = new PositionCache(3);
    for (const fen of ['a', 'b', 'c', 'd']) cache.set(fen, lines(0), 1000, 1);
    assert.equal(cache.size, 3);
    assert.equal(cache.has('a'), false, 'the oldest went');
    assert.equal(cache.has('d'), true);
  });

  it('keeps positions that are being revisited', () => {
    const cache = new PositionCache(3);
    cache.set('a', lines(0), 1000, 1);
    cache.set('b', lines(0), 1000, 1);
    cache.set('c', lines(0), 1000, 1);
    cache.get('a', 1000, 1);
    cache.set('d', lines(0), 1000, 1);
    assert.equal(cache.has('a'), true, 'recently read, so not the one to drop');
    assert.equal(cache.has('b'), false);
  });

  it('empties on clear', () => {
    const cache = new PositionCache();
    cache.set('fen', lines(0), 1000, 1);
    cache.clear();
    assert.equal(cache.size, 0);
  });
});
