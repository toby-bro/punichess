import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NewGame } from './library.ts';
import { dropSession, keepSession, takeSession } from './session.ts';

/** A localStorage that behaves, and one that is full. */
function fakeStorage(limit = Infinity): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException('quota', 'QuotaExceededError');
      map.set(k, v);
    },
  };
}

const game = (moves = 1): NewGame => ({
  name: 'Test',
  playedAs: 'white',
  settings: {} as NewGame['settings'],
  metrics: {
    moves,
    youAcpl: 10,
    botAcpl: 20,
    spotted: 1,
    missed: 2,
    made: 3,
    dodged: 0,
    bitten: 0,
  },
  start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  nodes: Array.from({ length: moves }, (_, i) => ({
    id: i + 1,
    parent: i,
    uci: 'e2e4',
    san: 'e4',
    by: 'white' as const,
  })),
  mistakes: {},
  cache: {},
});

test('a game in progress survives the trip through storage', () => {
  const storage = fakeStorage();
  keepSession(game(3), storage);
  const back = takeSession(storage);
  assert.ok(back);
  assert.equal(back.nodes.length, 3);
  assert.equal(back.metrics.made, 3);
  assert.equal(back.playedAs, 'white');
});

test('a game with no moves in it is not worth resuming', () => {
  const storage = fakeStorage();
  keepSession({ ...game(0), nodes: [] }, storage);
  assert.equal(takeSession(storage), undefined);
});

test('nothing stored means nothing to resume', () => {
  assert.equal(takeSession(fakeStorage()), undefined);
});

test('rubbish in storage is not a reason to fail to start', () => {
  const storage = fakeStorage();
  storage.setItem('punichess.session', 'not json at all');
  assert.equal(takeSession(storage), undefined);
});

test('the analysis is dropped before the game is', () => {
  // The cache is the largest part of a game and the least missed: without it a
  // resumed game still knows every move, and has to search again to say what
  // they were worth.
  const big: NewGame = {
    ...game(2),
    cache: {
      [game().start]: {
        nodes: 1,
        multiPV: 1,
        lines: [
          {
            multipv: 1,
            cp: 0,
            mate: undefined,
            depth: 20,
            // Typed as a non-empty list, so the first one is written out.
            moves: ['e2e4', ...Array.from({ length: 400 }, () => 'e7e5')] as const,
          },
        ],
      },
    },
  };
  const storage = fakeStorage(2000);
  keepSession(big, storage);
  const back = takeSession(storage);
  assert.ok(back, 'the game itself must survive a cache that does not');
  assert.equal(back.nodes.length, 2);
});

test('storage that refuses everything is survivable', () => {
  const storage = fakeStorage(0);
  keepSession(game(2), storage);
  assert.equal(takeSession(storage), undefined);
});

test('dropping it leaves nothing behind', () => {
  const storage = fakeStorage();
  keepSession(game(2), storage);
  dropSession(storage);
  assert.equal(takeSession(storage), undefined);
});
