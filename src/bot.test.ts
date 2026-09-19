import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HOLD_FOR_DRAW_CP,
  MAX_PROBES,
  MAX_TRAP_SEARCHES,
  type Policy,
  type Search,
  chooseMove,
  desiredLoss,
  pickBlunder,
  pickHonest,
  pickMateTrap,
  pickTrap,
  punishKind,
} from './bot.ts';
import { INITIAL_FEN, fenAfter, moveKind, positionHash } from './chess.ts';
import { DECIDED_CP } from './referee.ts';
import { DEFAULT_SETTINGS, type Settings, parseSettings } from './settings.ts';
import { type PvLine, mateToCp } from './uci.ts';

const line = (move: string, cp: number): PvLine => ({
  multipv: 1,
  cp,
  mate: undefined,
  depth: 18,
  moves: [move],
});

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
    //
    // The rook is here to give White something idle to do: the error has to be
    // a move the bot would actually be offered, and a king move is not one of
    // those any more.
    const fen = '4k3/8/8/7q/8/5N2/4P3/R3K3 w - - 0 1';
    const candidates = search(['f3g1', 0], ['a1b1', -150]);
    const best = candidates[0];
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['h5f3', 400], ['e8d8', 0]) }),
      fen,
      best,
      candidates,
    );
    assert.equal(found?.uci, 'a1b1');
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

describe('staying out of positions this line has already been through', () => {
  // After 1. Nf3 Nf6 2. Ng1, Black to move: Ng8 puts the board back exactly as
  // it started, which is the repetition worth refusing.
  const backAgain = 'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 3 2';
  const lines = search(['f6g8', 30], ['d7d5', 20], ['e7e5', 10]);
  const seen = new Set([positionHash(INITIAL_FEN)]);

  it('declines the move that walks back into one', async () => {
    for (let i = 0; i < 40; i++) {
      const move = await chooseMove(policy(), backAgain, lines, {
        wantsError: false,
        acpl: 0,
        avoid: seen,
      });
      assert.notEqual(move?.uci, 'f6g8', 'that is the repetition');
    }
  });

  it('plays it anyway when it is the only move there is', async () => {
    const forced = search(['f6g8', 30]);
    const move = await chooseMove(policy(), backAgain, forced, {
      wantsError: false,
      acpl: 0,
      avoid: seen,
    });
    assert.equal(move?.uci, 'f6g8', 'refusing to move is not an option');
  });

  it('is happy to play it when the position is new', async () => {
    const seenMoves = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const move = await chooseMove(policy(), backAgain, lines, { wantsError: false, acpl: 40 });
      if (move) seenMoves.add(move.uci);
    }
    assert.ok(seenMoves.has('f6g8'), 'nothing wrong with the move itself');
  });

  it('keeps deliberate errors out of a repetition too', async () => {
    const wide = search(['d7d5', 30], ['f6g8', -150]);
    const move = await chooseMove(
      policy({
        searchWide: () => Promise.resolve(wide),
        probe: replying(['e2e4', 300], ['d2d4', 0]),
        settings: settingsWith({ mateTrapShare: 0 }),
      }),
      backAgain,
      wide,
      { wantsError: true, acpl: 0, avoid: seen },
    );
    assert.notEqual(move?.uci, 'f6g8');
  });
});

describe('repeating when losing', () => {
  const backAgain = 'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 3 2';
  const seen = new Set([positionHash(INITIAL_FEN)]);

  it('takes the repetition when it is behind', async () => {
    // Every move loses; going back to a position already seen is a draw, and a
    // draw is the best thing available.
    const losing = search(['f6g8', HOLD_FOR_DRAW_CP - 200], ['d7d5', HOLD_FOR_DRAW_CP - 300]);
    const seenMoves = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const move = await chooseMove(policy(), backAgain, losing, {
        wantsError: false,
        acpl: 0,
        avoid: seen,
      });
      if (move) seenMoves.add(move.uci);
    }
    assert.ok(seenMoves.has('f6g8'), 'holding a draw is the right move from behind');
  });

  it('still refuses it from a level position', async () => {
    const level = search(['f6g8', 0], ['d7d5', -10]);
    for (let i = 0; i < 40; i++) {
      const move = await chooseMove(policy(), backAgain, level, {
        wantsError: false,
        acpl: 0,
        avoid: seen,
      });
      assert.notEqual(move?.uci, 'f6g8', 'shuffling a level game away is just wasting it');
    }
  });

  it('still refuses it from a winning position', async () => {
    const winning = search(['f6g8', 400], ['d7d5', 380]);
    for (let i = 0; i < 40; i++) {
      const move = await chooseMove(policy(), backAgain, winning, {
        wantsError: false,
        acpl: 0,
        avoid: seen,
      });
      assert.notEqual(move?.uci, 'f6g8');
    }
  });
});

describe('punishKind', () => {
  // Bare positions rather than openings: the classification is about the move,
  // and a stripped board makes what is defended and what is not unarguable.
  const rookEndgame = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
  const looseRook = '4k3/8/8/8/8/8/r7/R3K3 w - - 0 1';
  const italian = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

  it('calls a forced mate a mate whatever the move looks like', () => {
    assert.equal(punishKind(rookEndgame, mateLine('a1a8', 3, 1)), 'mate');
  });

  it('picks out a check that captures nothing', () => {
    // Ra8+. This is the shape the ranking exists for: a discovered or double
    // check wins material without touching anything on the way.
    assert.equal(punishKind(rookEndgame, line('a1a8', 400)), 'check');
  });

  it('calls a move that takes nothing and checks nothing quiet', () => {
    assert.equal(punishKind(rookEndgame, line('e1e2', 0)), 'quiet');
  });

  it('separates a capture into a defended square from a free lunch', () => {
    // Nxe5 walks into ...Nxe5: taking is a decision, so it is a tactic.
    assert.equal(punishKind(italian, line('f3e5', 200)), 'sac');
    // Rxa2 takes a rook nothing is defending. There is nothing to see.
    assert.equal(punishKind(looseRook, line('a1a2', 500)), 'grab');
  });
});

describe('pickBlunder ranking', () => {
  // Two errors in the band. Which one is offered used to come down to shuffle
  // order; it should come down to which one teaches something.
  const wide = search(['e2e4', 30], ['e2e3', -120], ['d2d3', -130], ['a2a3', -140]);
  const [best] = wide;
  assert.ok(best);

  it('prefers a forced mate to a merely good position', async () => {
    // e3 is answered by a crushing but ordinary move; a3 hands over mate in 2.
    const probe: Search = fen =>
      Promise.resolve(
        // After a3 it is Black to move with a mate; after anything else, not.
        fen.startsWith('rnbqkbnr/pppppppp/8/8/8/P7/')
          ? [mateLine('d8h4', 2, 1), line('b8c6', 0)]
          : search(['d7d5', 300], ['b8c6', 20]),
      );
    const found = await pickBlunder(policy({ probe, random: () => 0.5 }), INITIAL_FEN, best, wide);
    assert.ok(found);
    assert.equal(found.uci, 'a2a3', 'the mate should win over the good position');
  });

  it('still returns something when nothing is a mate', async () => {
    const found = await pickBlunder(
      policy({ probe: replying(['d7d5', 300], ['b8c6', 20]), random: () => 0.5 }),
      INITIAL_FEN,
      best,
      wide,
    );
    assert.ok(found, 'a ranked search must not become a pickier one');
  });

  it('does not spend probes once a mate has turned up', async () => {
    let count = 0;
    const probe: Search = () => {
      count++;
      return Promise.resolve([mateLine('d8h4', 2, 1), line('b8c6', 0)]);
    };
    await pickBlunder(policy({ probe, random: () => 0.5 }), INITIAL_FEN, best, wide);
    assert.equal(count, 1, 'nothing beats a mate, so there is nothing left to look for');
  });
});

describe('which errors get probed', () => {
  it('leans towards the costly ones without ever excluding the rest', async () => {
    // Fourteen mild errors and one disaster. Drawn uniformly the disaster is
    // looked at about a third of the time; the point of weighting by cost is
    // that it is looked at nearly always, because that is where the mates and
    // the real tactics live.
    const mild = [
      'a2a3',
      'b2b3',
      'c2c3',
      'd2d3',
      'f2f3',
      'g2g3',
      'h2h3',
      'a2a4',
      'b2b4',
      'c2c4',
      'd2d4',
      'f2f4',
      'g2g4',
      'h2h4',
    ];
    const disaster = 'b1a3';
    const wide = [
      ...search(['e2e4', 0]),
      ...mild.map(move => line(move, -110)),
      line(disaster, -400),
    ];
    const [best] = wide;
    assert.ok(best);
    const afterDisaster = fenAfter(INITIAL_FEN, disaster);

    let probedTheDisaster = 0;
    const runs = 60;
    for (let seed = 1; seed <= runs; seed++) {
      let n = seed;
      const random = (): number => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      const probe: Search = fen => {
        if (fen === afterDisaster) probedTheDisaster++;
        // Nothing is punishable, so every drawn candidate is probed and what is
        // being measured is the draw itself.
        return Promise.resolve(search(['d7d5', 10], ['b8c6', 5]));
      };
      await pickBlunder(policy({ probe, random }), INITIAL_FEN, best, wide);
    }
    const share = probedTheDisaster / runs;
    // Uniform would be 5/15 = 33%.
    assert.ok(
      share > 0.6,
      `the worst move was probed in only ${(share * 100).toFixed(0)}% of runs`,
    );
  });
});

describe('a piece you just hung', () => {
  // 1. e4 e5 2. Bc4, and Black has just played ...Nf6?? -- no. Built plainly:
  // White to move, Black's queen sits undefended on d5 having just moved there.
  const hungQueen = 'rnb1kbnr/ppp1pppp/8/3q4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1';
  const hungPawn = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

  const wide = (best: string) => search([best, 900], ['f3g5', -200], ['h2h4', -250]);

  it('is taken rather than ignored, when it is a piece', async () => {
    const lines = wide('f3e5');
    const move = await chooseMove(
      policy({ searchWide: replying(...lines.map(l => [l.moves[0], l.cp] as [string, number])) }),
      hungQueen,
      lines,
      { wantsError: true, acpl: 0, lastMove: 'd8d5' },
    );
    assert.ok(move);
    assert.equal(move.deliberateError, false, 'a hung queen is not an opportunity to err');
  });

  it('is left alone when it is only a pawn', () => {
    // Taking on d5 is available and free, but a pawn is a judgement call, and
    // declining one is the sort of thing people do all the time.
    const kind = moveKind(hungPawn, 'e4d5');
    assert.equal(kind.capture, true);
    assert.ok(kind.value < 300, 'a pawn is below the line');
  });

  it('only counts the piece you moved this very turn', async () => {
    const lines = wide('f3e5');
    const move = await chooseMove(
      policy({ searchWide: replying(...lines.map(l => [l.moves[0], l.cp] as [string, number])) }),
      hungQueen,
      lines,
      // The queen is hanging, but you moved something else: it has been hanging
      // a while, and that is part of the position now.
      { wantsError: true, acpl: 0, lastMove: 'a7a6' },
    );
    assert.ok(move);
    assert.notEqual(move.uci, undefined);
  });
});

describe('ignoring what you just threatened', () => {
  /*
   * You are White and have just played b2-b4, attacking the bishop on c5. It is
   * the bot's move and it leaves the bishop there.
   *
   * The pawn on d6 defends c5, so bxc5 is a trade on paper: the older filter,
   * which throws out an answer that takes something undefended, lets this
   * straight through. It is still nothing but "take the bishop you attacked last
   * move".
   */
  const attacked = 'rnbqk1nr/ppp2ppp/3p4/2b1p3/1P6/8/P1PPPPPP/RNBQKBNR b KQkq - 0 4';
  const wide = search(['c5b6', 120], ['g8f6', -150], ['a7a6', -160]);

  it('is not an error worth making', async () => {
    const [best] = wide;
    assert.ok(best);
    const probe: Search = () => Promise.resolve(search(['b4c5', 320], ['g1f3', 10]));
    const found = await pickBlunder(
      policy({ probe, random: () => 0.5 }),
      attacked,
      best,
      wide,
      'b2b4',
    );
    assert.equal(found, undefined, 'the bishop it forgot to move is not a lesson');
  });

  it('is still an error when that piece does something other than take', async () => {
    // The same pawn pushing on is a move in its own right, not the threat you
    // made last turn being collected.
    const [best] = wide;
    assert.ok(best);
    const probe: Search = () => Promise.resolve(search(['b4b5', 300], ['g1f3', 10]));
    const found = await pickBlunder(
      policy({ probe, random: () => 0.5 }),
      attacked,
      best,
      wide,
      'b2b4',
    );
    assert.ok(found);
  });

  it('is still an error when the capture is by a piece you moved earlier', async () => {
    // A pawn that has been eyeing that bishop for six moves is part of the
    // position. Forgetting about it is a real thing to be caught doing.
    const [best] = wide;
    assert.ok(best);
    const probe: Search = () => Promise.resolve(search(['b4c5', 320], ['g1f3', 10]));
    const found = await pickBlunder(
      policy({ probe, random: () => 0.5 }),
      attacked,
      best,
      wide,
      'a2a3',
    );
    assert.ok(found);
  });
});

describe('pickTrap', () => {
  /*
   * A knight sitting on e5 where either the d6 or the f6 pawn can take it.
   * Undefended, worth a piece: as tempting as an offer gets.
   */
  const offering = 'rnbqkbnr/ppp2ppp/3p1p2/4N3/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 4';
  const beforeOffer = 'rnbqkbnr/ppp2ppp/3p1p2/8/8/4N3/PPPPPPPP/RNBQKB1R w KQkq - 0 4';

  it('offers a piece when every way of taking it loses', async () => {
    const wide = search(['e3g4', 20], ['e3d5', 10], ['e3f5', 0]);
    const [best] = wide;
    assert.ok(best);
    // Leaving it alone is level; taking it is worth -250 to you, which is the
    // bot's +250 seen from the other side.
    const probe: Search = fen =>
      Promise.resolve(
        search([fen.includes(' w ') ? 'a2a3' : 'a7a6', fen.includes(' w ') ? 250 : 0]),
      );
    const found = await pickTrap(policy({ probe, random: () => 0.5 }), beforeOffer, best, wide);
    assert.ok(found, 'a piece nobody can profitably take is worth offering');
  });

  it('declines to offer when one way of taking is fine', async () => {
    const wide = search(['e3g4', 20], ['e3d5', 10], ['e3f5', 0]);
    const [best] = wide;
    assert.ok(best);
    // Nothing is gained by taking or declining, so it is just a piece given away.
    const probe: Search = () => Promise.resolve(search(['a2a3', 0]));
    const found = await pickTrap(policy({ probe, random: () => 0.5 }), beforeOffer, best, wide);
    assert.equal(found, undefined, 'a piece that can be taken for free is not a trap');
  });

  it('offers nothing when nothing can be taken', async () => {
    const quiet = search(['a2a3', 0], ['h2h3', 0]);
    const [best] = quiet;
    assert.ok(best);
    let searched = 0;
    const probe: Search = () => {
      searched++;
      return Promise.resolve(search(['a7a6', 0]));
    };
    const found = await pickTrap(policy({ probe, random: () => 0.5 }), offering, best, quiet);
    assert.equal(found, undefined);
    assert.equal(searched, 0, 'no offer, no searching');
  });

  it('never spends more searches than it is allowed', async () => {
    const wide = search(['e3g4', 20], ['e3d5', 10], ['e3f5', 0]);
    const [best] = wide;
    assert.ok(best);
    let searched = 0;
    const probe: Search = () => {
      searched++;
      return Promise.resolve(search(['a2a3', 0]));
    };
    await pickTrap(policy({ probe, random: () => 0.5 }), beforeOffer, best, wide);
    assert.ok(
      searched <= MAX_TRAP_SEARCHES,
      `spent ${String(searched)} searches, allowed ${String(MAX_TRAP_SEARCHES)}`,
    );
  });
});

describe('king moves are not errors worth making', () => {
  it('is never offered one, however well it scores as an error', async () => {
    // Every candidate in the band is a king move. Walking off the castling
    // square for nothing is the bot shuffling, not a mistake to be shown.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const wide = search(['e2e4', 0], ['e1e2', -200]);
    const [best] = wide;
    assert.ok(best);
    let probed = 0;
    const probe: Search = () => {
      probed++;
      return Promise.resolve(search(['d7d5', 400], ['b8c6', 0]));
    };
    const found = await pickBlunder(policy({ probe, random: () => 0.5 }), fen, best, wide);
    assert.equal(found, undefined);
    assert.equal(probed, 0, 'and not a search spent finding that out');
  });

  it('still offers everything else in the band', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const wide = search(['e2e4', 0], ['e1e2', -200], ['g1h3', -210]);
    const [best] = wide;
    assert.ok(best);
    const found = await pickBlunder(
      policy({ probe: replying(['d7d5', 400], ['b8c6', 0]), random: () => 0.5 }),
      fen,
      best,
      wide,
    );
    assert.equal(found?.uci, 'g1h3', 'the knight is still fair game');
  });
});
