import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PROBES,
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
  // A wide search: the errors worth making are never in the top few lines.
  const wide = search(['e2e4', 30], ['g1f3', 20], ['e2e3', -120], ['a2a3', -900]);
  const best = wide[0];

  it('picks an error inside the band when it is punishable', async () => {
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['d7d5', 200], ['b8c6', 20]) }),
      INITIAL_FEN,
      best,
      wide,
    );
    assert.ok(found);
    assert.equal(found.uci, 'e2e3');
    assert.equal(found.cpLoss, 150);
  });

  it('refuses an error whose only answer is taking the piece that just moved', async () => {
    // After 1. e4 e5, d4 walks the pawn onto a square the e5 pawn takes. "I put
    // this where it gets eaten" is not a mistake worth being stopped for.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const candidates = search(['g1f3', 0], ['d2d4', -150]);
    const best = candidates[0];
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['e5d4', 400], ['b8c6', 0]) }),
      fen,
      best,
      candidates,
    );
    assert.equal(found, undefined);
  });

  it('refuses an error whose answer is picking up something undefended', async () => {
    // White's knight on g4 is hanging. Any move at all leaves Qxg4 available,
    // and taking a free piece is a helping, not a refutation.
    const fen = '4k3/8/8/7q/6N1/8/4P3/4K3 w - - 0 1';
    const candidates = search(['e2e3', 0], ['e2e4', -150]);
    const best = candidates[0];
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['h5g4', 400], ['e8d8', 0]) }),
      fen,
      best,
      candidates,
    );
    assert.equal(found, undefined, 'taking a free piece is not worth finding');
  });

  it('accepts one whose answer is a capture into a defended square', async () => {
    // Same shape, but the knight is defended by the e2 pawn after Qxf3, so the
    // reply is a real decision rather than a free lunch.
    const fen = '4k3/8/8/7q/8/5N2/4P3/4K3 w - - 0 1';
    const candidates = search(['f3g1', 0], ['e1f1', -150]);
    const best = candidates[0];
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['h5f3', 400], ['e8d8', 0]) }),
      fen,
      best,
      candidates,
    );
    assert.equal(found?.uci, 'e1f1');
  });

  it('refuses an error whose refutation is not clear-cut', async () => {
    assert.ok(best);
    const found = await pickBlunder(
      // Two replies within a quarter-pawn of each other: no single right answer.
      policy({ probe: replying(['d7d5', 200], ['b8c6', 180]) }),
      INITIAL_FEN,
      best,
      wide,
    );
    assert.equal(found, undefined);
  });

  it('respects a widened band from the settings', async () => {
    assert.ok(best);
    const found = await pickBlunder(
      policy({
        probe: replying(['d7d5', 500], ['b8c6', 0]),
        settings: settingsWith({ blunderMin: 500, blunderMax: 1000 }),
      }),
      INITIAL_FEN,
      best,
      wide,
    );
    assert.equal(found?.uci, 'a2a3', 'only the 9.30 drop is in this band');
  });

  it('gives up rather than searching every candidate', async () => {
    assert.ok(best);
    let probes = 0;
    // Real moves: the candidates get played out to check the refutation.
    const spare = ['a2a3', 'a2a4', 'b2b3', 'b2b4', 'c2c3', 'c2c4', 'd2d3', 'd2d4', 'f2f3', 'f2f4'];
    const many = search(['g1f3', 0], ...spare.map((uci, i) => [uci, -150 - i] as [string, number]));
    await pickBlunder(
      policy({
        probe: () => {
          probes++;
          // Never punishable, so every candidate gets tried.
          return Promise.resolve(search(['a', 10], ['b', 10]));
        },
      }),
      INITIAL_FEN,
      many[0] ?? best,
      many,
    );
    assert.equal(probes, MAX_PROBES, 'a bot that thinks for ten seconds is worse company');
  });
});

describe('pickMateTrap', () => {
  const level = search(['e2e4', 20], ['d2d4', 10]);
  // A wide search turns up the moves that hand over a forced mate.
  const wide = [
    ...level,
    mateLine('g1h3', -3, 3),
    mateLine('f2f3', -1, 4),
    mateLine('h2h4', -6, 5),
  ];

  it('finds a move that allows mate within the configured depth', () => {
    const best = level[0];
    assert.ok(best);
    const found = pickMateTrap(wide, best, settingsWith({ maxMateDepth: 3 }));
    assert.ok(found);
    assert.ok(['g1h3', 'f2f3'].includes(found.uci), `unexpected trap ${found.uci}`);
  });

  it('never offers a mate deeper than allowed', () => {
    const best = level[0];
    assert.ok(best);
    for (let i = 0; i < 50; i++) {
      const found = pickMateTrap(wide, best, settingsWith({ maxMateDepth: 1 }));
      assert.equal(found?.uci, 'f2f3', 'only mate in 1 is allowed here');
    }
  });

  it('finds nothing when no move allows a short enough mate', () => {
    const best = level[0];
    assert.ok(best);
    assert.equal(pickMateTrap(level, best, DEFAULT_SETTINGS), undefined);
  });

  it('does not call it an error when the bot is getting mated anyway', () => {
    const lost = mateLine('g1h1', -4, 1);
    assert.equal(pickMateTrap(wide, lost, DEFAULT_SETTINGS), undefined);
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
        searchWide: () => Promise.resolve(search(['e2e4', 30], ['e2e3', -120])),
        probe: replying(['d7d5', 300], ['b8c6', 0]),
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
        probe: replying(['d7d5', 300], ['b8c6', 0]),
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
        probe: replying(['d7d5', 300], ['b8c6', 0]),
        searchWide: () => Promise.resolve(search(['e2e4', 30], ['e2e3', -120])),
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

  it('does not throw an already decided game, and does not pay to find out', async () => {
    let wideSearches = 0;
    const decided = search(['e2e4', DECIDED_CP + 200], ['e2e3', DECIDED_CP]);
    const move = await chooseMove(
      policy({
        searchWide: () => {
          wideSearches++;
          return Promise.resolve(decided);
        },
      }),
      INITIAL_FEN,
      decided,
      { wantsError: true, acpl: 0 },
    );
    assert.equal(move?.deliberateError, false);
    assert.equal(wideSearches, 0, 'the wide search is the expensive one; skip it entirely');
  });
});
