import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DECIDED_CP,
  MISSED_PUNISH,
  OWN_BLUNDER,
  isError,
  isMateScore,
  judge,
  winPercent,
} from './referee.ts';
import { type PvLine, mateToCp } from './uci.ts';

/** Build a search result from (move, centipawn) pairs, best first. */
const search = (...moves: [string, number][]): PvLine[] =>
  moves.map(([move, cp], index) => ({
    multipv: index + 1,
    cp,
    mate: undefined,
    depth: 18,
    moves: [move],
  }));

describe('winPercent', () => {
  it('is 50% at a dead level position', () => {
    assert.equal(Math.round(winPercent(0)), 50);
  });

  it('is monotonic', () => {
    assert.ok(winPercent(-100) < winPercent(0));
    assert.ok(winPercent(0) < winPercent(100));
  });

  it('saturates, so a pawn matters far less when already winning', () => {
    const nearLevel = winPercent(100) - winPercent(0);
    const nearWon = winPercent(800) - winPercent(700);
    assert.ok(nearLevel > nearWon * 3, `${nearLevel} should dwarf ${nearWon}`);
  });

  it('stays within bounds for absurd inputs', () => {
    for (const cp of [-1e9, -5000, 0, 5000, 1e9]) {
      const w = winPercent(cp);
      assert.ok(w >= 0 && w <= 100, `${cp} -> ${w}`);
    }
  });
});

describe('judge', () => {
  it('returns nothing when there is no search to judge against', () => {
    assert.equal(judge([], 'e2e4'), undefined);
  });

  it('charges nothing for the best move', () => {
    const verdict = judge(search(['e2e4', 30], ['d2d4', -80]), 'e2e4');
    assert.ok(verdict);
    assert.equal(verdict.cpLoss, 0);
    assert.equal(verdict.winLoss, 0);
  });

  it('measures loss against the best move, not against zero', () => {
    const verdict = judge(search(['e2e4', -200], ['d2d4', -350]), 'd2d4');
    assert.equal(verdict?.cpLoss, 150);
  });

  it('never reports a negative loss', () => {
    const verdict = judge(search(['a', 10], ['b', -10]), 'b');
    assert.ok((verdict?.cpLoss ?? -1) >= 0);
    assert.ok((verdict?.winLoss ?? -1) >= 0);
  });

  it('charges an unlisted move the worst listed loss rather than guessing', () => {
    const lines = search(['e2e4', 30], ['d2d4', 10], ['h2h4', -120]);
    const verdict = judge(lines, 'g1h3');
    assert.ok(verdict);
    assert.equal(verdict.cpLoss, 150);
    assert.equal(verdict.played, undefined);
  });

  it('flags letting a forced mate slip', () => {
    const lines: PvLine[] = [
      { multipv: 1, cp: mateToCp(1), mate: 1, depth: 12, moves: ['a1a8'] },
      { multipv: 2, cp: 300, mate: undefined, depth: 12, moves: ['g1f1'] },
    ];
    const verdict = judge(lines, 'g1f1');
    assert.ok(verdict);
    assert.equal(verdict.missesMate, true);
    assert.equal(verdict.hangsMate, false);
  });

  it('does not flag actually delivering the mate', () => {
    const lines: PvLine[] = [
      { multipv: 1, cp: mateToCp(1), mate: 1, depth: 12, moves: ['a1a8'] },
      { multipv: 2, cp: mateToCp(4), mate: 4, depth: 12, moves: ['a1a7'] },
    ];
    assert.equal(judge(lines, 'a1a7')?.missesMate, false);
  });

  it('flags walking into a mate', () => {
    const lines: PvLine[] = [
      { multipv: 1, cp: -50, mate: undefined, depth: 12, moves: ['g1h1'] },
      { multipv: 2, cp: mateToCp(-2), mate: -2, depth: 12, moves: ['g1f1'] },
    ];
    assert.equal(judge(lines, 'g1f1')?.hangsMate, true);
  });

  it('does not blame a move for a mate that was unavoidable anyway', () => {
    const lines: PvLine[] = [
      { multipv: 1, cp: mateToCp(-3), mate: -3, depth: 12, moves: ['g1h1'] },
      { multipv: 2, cp: mateToCp(-1), mate: -1, depth: 12, moves: ['g1f1'] },
    ];
    assert.equal(judge(lines, 'g1f1')?.hangsMate, false);
  });
});

describe('isError', () => {
  const verdictFor = (bestCp: number, playedCp: number) => {
    const verdict = judge(search(['best', bestCp], ['played', playedCp]), 'played');
    assert.ok(verdict);
    return verdict;
  };

  it('ignores a move that only loses a little', () => {
    assert.equal(isError(verdictFor(20, -20), OWN_BLUNDER), false);
  });

  it('catches a clear blunder in a level position', () => {
    assert.equal(isError(verdictFor(20, -150), OWN_BLUNDER), true);
  });

  it('holds you to a stricter standard right after the bot errs', () => {
    const slip = verdictFor(150, 80);
    assert.equal(isError(slip, OWN_BLUNDER), false, 'not a blunder by the normal rule');
    assert.equal(isError(slip, MISSED_PUNISH), true, 'but it is a missed punishment');
  });

  it('stays quiet once the game is decided on material', () => {
    const verdict = verdictFor(DECIDED_CP + 300, DECIDED_CP - 100);
    assert.ok(verdict.cpLoss > OWN_BLUNDER.cp, 'the loss is large in raw centipawns');
    assert.equal(isError(verdict, OWN_BLUNDER), false, 'but nagging here is noise');
  });

  it('never suppresses a missed mate as "already decided"', () => {
    const lines: PvLine[] = [
      { multipv: 1, cp: mateToCp(1), mate: 1, depth: 12, moves: ['a1a8'] },
      { multipv: 2, cp: 900, mate: undefined, depth: 12, moves: ['g1f1'] },
    ];
    const verdict = judge(lines, 'g1f1');
    assert.ok(verdict);
    assert.ok(Math.abs(verdict.best.cp) > DECIDED_CP, 'the suppression rule would otherwise apply');
    assert.equal(isError(verdict, OWN_BLUNDER), true);
  });

  it('requires both a material loss and a real loss of winning chances', () => {
    // A big centipawn drop that barely moves the win curve must not fire.
    const verdict = verdictFor(1900, 1900 - OWN_BLUNDER.cp - 1);
    assert.ok(verdict.winLoss < OWN_BLUNDER.win);
    assert.equal(isError(verdict, OWN_BLUNDER), false);
  });
});

describe('isMateScore', () => {
  it('separates mates from ordinary evaluations', () => {
    assert.equal(isMateScore(mateToCp(30)), true);
    assert.equal(isMateScore(mateToCp(-30)), true);
    assert.equal(isMateScore(2000), false);
    assert.equal(isMateScore(0), false);
  });
});
