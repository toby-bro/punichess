import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type Policy,
  type Search,
  chooseMove,
  desiredLoss,
  pickBlunder,
  pickHonest,
  pickMateTrap,
} from './bot.ts';
import { INITIAL_FEN } from './chess.ts';
import { DECIDED_CP } from './referee.ts';
import { DEFAULT_SETTINGS, type Settings, parseSettings } from './settings.ts';
import { type PvLine, mateToCp } from './uci.ts';

const search = (...moves: [string, number][]): PvLine[] =>
  moves.map(([move, cp], index) => ({
    multipv: index + 1,
    cp,
    mate: undefined,
    depth: 18,
    moves: [move],
  }));

const mateLine = (move: string, mate: number, multipv: number): PvLine => ({
  multipv,
  cp: mateToCp(mate),
  mate,
  depth: 18,
  moves: [move],
});

const replying = (...moves: [string, number][]): Search => {
  const replies = search(...moves);
  return () => Promise.resolve(replies);
};

const settingsWith = (overrides: Partial<Settings>): Settings =>
  parseSettings({ ...DEFAULT_SETTINGS, ...overrides });

const policy = (overrides: Partial<Policy> = {}): Policy => ({
  search: replying(),
  settings: DEFAULT_SETTINGS,
  ...overrides,
});

describe('desiredLoss', () => {
  it('aims at the target when the average is already there', () => {
    assert.equal(desiredLoss(30, 30, 200), 30);
  });

  it('overshoots while the average is below target', () => {
    assert.ok(desiredLoss(30, 0, 200) > 30);
  });

  it('plays the best move while the average is above target', () => {
    assert.equal(desiredLoss(30, 90, 200), 0);
  });

  it('never asks for more than the hard band allows', () => {
    assert.equal(desiredLoss(200, 0, 50), 50);
  });

  it('never asks for a negative loss', () => {
    assert.ok(desiredLoss(0, 500, 100) >= 0);
  });
});

describe('pickHonest', () => {
  const lines = search(['a', 0], ['b', -25], ['c', -50], ['d', -90], ['e', -400]);

  it('never plays a move outside the hard band', () => {
    for (let i = 0; i < 200; i++) {
      assert.notEqual(pickHonest(lines, DEFAULT_SETTINGS, 0), 'e');
    }
  });

  it('converges on the requested average loss', () => {
    const settings = settingsWith({ targetAcpl: 50, quietBand: 100 });
    let total = 0;
    const losses: Record<string, number> = { a: 0, b: 25, c: 50, d: 90 };
    for (let i = 0; i < 4000; i++) {
      const move = pickHonest(lines, settings, total / Math.max(1, i));
      total += losses[move ?? 'a'] ?? 0;
    }
    const average = total / 4000;
    assert.ok(Math.abs(average - 50) < 12, `average loss was ${average}, wanted about 50`);
  });

  it('plays close to best when asked for a low average', () => {
    const settings = settingsWith({ targetAcpl: 0, quietBand: 100 });
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const move = pickHonest(lines, settings, total / Math.max(1, i));
      total += { a: 0, b: 25, c: 50, d: 90 }[move ?? 'a'] ?? 0;
    }
    assert.ok(total / 1000 < 15, `average loss was ${total / 1000}, wanted near 0`);
  });

  it('returns nothing when there are no moves', () => {
    assert.equal(pickHonest([], DEFAULT_SETTINGS, 0), undefined);
  });
});

describe('pickBlunder', () => {
  const lines = search(['e2e4', 30], ['e2e3', -120], ['a2a3', -900]);

  it('picks an error inside the band when it is punishable', async () => {
    const found = await pickBlunder(
      policy({ search: replying(['d7d5', 200], ['b8c6', 20]) }),
      INITIAL_FEN,
      lines,
    );
    assert.ok(found);
    assert.equal(found.uci, 'e2e3');
    assert.equal(found.cpLoss, 150);
  });

  it('refuses an error whose refutation is not clear-cut', async () => {
    const found = await pickBlunder(
      policy({ search: replying(['d7d5', 200], ['b8c6', 130]) }),
      INITIAL_FEN,
      lines,
    );
    assert.equal(found, undefined);
  });

  it('respects a widened band from the settings', async () => {
    const wide = policy({
      search: replying(['d7d5', 500], ['b8c6', 0]),
      settings: settingsWith({ blunderMin: 500, blunderMax: 1000 }),
    });
    const found = await pickBlunder(wide, INITIAL_FEN, lines);
    assert.equal(found?.uci, 'a2a3', 'only the 9.30 drop is in this band');
  });

  it('does not throw the game when it is already decided', async () => {
    const won = search(['e2e4', DECIDED_CP + 1], ['e2e3', DECIDED_CP - 150]);
    const found = await pickBlunder(
      policy({ search: replying(['d7d5', 500], ['b8c6', 0]) }),
      INITIAL_FEN,
      won,
    );
    assert.equal(found, undefined);
  });
});

describe('pickMateTrap', () => {
  const level = search(['e2e4', 20], ['d2d4', 10]);
  // A wide search turns up the moves that hand over a forced mate.
  const wide = (): Search => () =>
    Promise.resolve([
      ...search(['e2e4', 20], ['d2d4', 10]),
      mateLine('g1h3', -3, 3),
      mateLine('f2f3', -1, 4),
      mateLine('h2h4', -6, 5),
    ]);

  it('finds a move that allows mate within the configured depth', async () => {
    const found = await pickMateTrap(
      policy({ searchWide: wide(), settings: settingsWith({ maxMateDepth: 3 }) }),
      INITIAL_FEN,
      level,
    );
    assert.ok(found);
    assert.ok(['g1h3', 'f2f3'].includes(found.uci), `unexpected trap ${found.uci}`);
  });

  it('never offers a mate deeper than allowed', async () => {
    for (let i = 0; i < 50; i++) {
      const found = await pickMateTrap(
        policy({ searchWide: wide(), settings: settingsWith({ maxMateDepth: 1 }) }),
        INITIAL_FEN,
        level,
      );
      assert.equal(found?.uci, 'f2f3', 'only mate in 1 is allowed here');
    }
  });

  it('finds nothing when no move allows a short enough mate', async () => {
    const found = await pickMateTrap(
      policy({ searchWide: () => Promise.resolve(search(['e2e4', 20], ['d2d4', 10])) }),
      INITIAL_FEN,
      level,
    );
    assert.equal(found, undefined);
  });

  it('does not call it an error when the bot is getting mated anyway', async () => {
    const lost = [mateLine('g1h1', -4, 1), mateLine('g1f1', -2, 2)];
    const found = await pickMateTrap(policy({ searchWide: wide() }), INITIAL_FEN, lost);
    assert.equal(found, undefined);
  });
});

describe('chooseMove', () => {
  const lines = search(['e2e4', 30], ['e2e3', -120]);

  it('plays honestly when it is not trying to err', async () => {
    const move = await chooseMove(policy(), INITIAL_FEN, lines, { wantsError: false, acpl: 0 });
    assert.ok(move);
    assert.equal(move.kind, 'quiet');
    assert.equal(move.deliberateError, false);
  });

  it('marks a deliberate error so the referee can arm the strict rule', async () => {
    const move = await chooseMove(
      policy({
        search: replying(['d7d5', 300], ['b8c6', 0]),
        settings: settingsWith({ mateTrapShare: 0 }),
      }),
      INITIAL_FEN,
      lines,
      { wantsError: true, acpl: 0 },
    );
    assert.ok(move);
    assert.equal(move.kind, 'blunder');
    assert.equal(move.deliberateError, true);
    assert.equal(move.cpLoss, 150);
  });

  it('prefers a mate trap when the settings ask for one', async () => {
    const move = await chooseMove(
      policy({
        search: replying(['d7d5', 300], ['b8c6', 0]),
        searchWide: () => Promise.resolve([...lines, mateLine('g1h3', -2, 3)]),
        settings: settingsWith({ mateTrapShare: 1 }),
      }),
      INITIAL_FEN,
      lines,
      { wantsError: true, acpl: 0 },
    );
    assert.ok(move);
    assert.equal(move.kind, 'mate-trap');
    assert.equal(move.uci, 'g1h3');
  });

  it('falls back to an ordinary error when no mate trap exists', async () => {
    const move = await chooseMove(
      policy({
        search: replying(['d7d5', 300], ['b8c6', 0]),
        searchWide: () => Promise.resolve(lines),
        settings: settingsWith({ mateTrapShare: 1 }),
      }),
      INITIAL_FEN,
      lines,
      { wantsError: true, acpl: 0 },
    );
    assert.equal(move?.kind, 'blunder');
  });

  it('returns nothing when the engine offered no moves', async () => {
    const move = await chooseMove(policy(), INITIAL_FEN, [], { wantsError: false, acpl: 0 });
    assert.equal(move, undefined);
  });
});
