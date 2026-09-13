import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JUDGEMENT_BANDS, Stats, classify, summarise } from './stats.ts';

describe('classify', () => {
  it('calls a free move best', () => {
    assert.equal(classify(0, 0), 'best');
  });

  it('calls a small slip good rather than an error', () => {
    assert.equal(classify(15, 2), 'good');
  });

  it('uses the lichess boundaries', () => {
    assert.equal(classify(100, JUDGEMENT_BANDS.inaccuracy), 'inaccuracy');
    assert.equal(classify(100, JUDGEMENT_BANDS.mistake), 'mistake');
    assert.equal(classify(100, JUDGEMENT_BANDS.blunder), 'blunder');
    assert.equal(classify(100, JUDGEMENT_BANDS.inaccuracy - 0.01), 'good');
  });

  it('judges on winning chances, not raw centipawns', () => {
    // Three pawns thrown away in a position that is already lost anyway.
    assert.equal(classify(300, 1), 'good');
  });
});

describe('summarise', () => {
  it('is empty for no moves', () => {
    const summary = summarise([]);
    assert.equal(summary.moves, 0);
    assert.equal(summary.acpl, 0);
  });

  it('averages the centipawn loss and counts the labels', () => {
    const stats = new Stats();
    stats.add('you', 0, 0);
    stats.add('you', 40, 4);
    stats.add('you', 200, 25);
    const summary = stats.summary('you');
    assert.equal(summary.moves, 3);
    assert.equal(summary.acpl, 80);
    assert.equal(summary.best, 1);
    assert.equal(summary.good, 1);
    assert.equal(summary.mistake, 1);
  });
});

describe('Stats', () => {
  it('keeps the two players apart', () => {
    const stats = new Stats();
    stats.add('you', 10, 1);
    stats.add('bot', 200, 20);
    assert.equal(stats.acpl('you'), 10);
    assert.equal(stats.acpl('bot'), 200);
    assert.equal(stats.summary('you').moves, 1);
  });

  it('reports zero for a side that has not moved', () => {
    assert.equal(new Stats().acpl('you'), 0);
  });

  it('never records a negative loss', () => {
    const stats = new Stats();
    const entry = stats.add('you', -50, -5);
    assert.equal(entry.cpLoss, 0);
    assert.equal(entry.winLoss, 0);
  });

  it('keeps every attempt, including ones that were taken back', () => {
    const stats = new Stats();
    stats.add('you', 0, 0);
    stats.add('you', 400, 45);
    stats.add('you', 0, 0);
    const summary = stats.summary('you');
    assert.equal(summary.moves, 3, 'the retry does not erase the blunder');
    assert.equal(summary.blunder, 1);
    assert.ok(summary.acpl > 100, 'and it still counts towards the average');
  });

  it('starts over on reset', () => {
    const stats = new Stats();
    stats.add('you', 10, 1);
    stats.reset();
    assert.equal(stats.entries.length, 0);
    assert.equal(stats.acpl('you'), 0);
  });
});

describe('mates are counted, not averaged', () => {
  it('keeps a missed mate out of the centipawn average', () => {
    const stats = new Stats();
    stats.add('you', 20, 2);
    stats.add('you', 40, 4);
    stats.add('you', 99_900, 50, true);
    const summary = stats.summary('you');
    assert.equal(summary.acpl, 30, 'a mate score would otherwise bury every real number');
    assert.equal(summary.mates, 1);
    assert.equal(summary.moves, 3, 'it still happened, and still counts as a move');
  });

  it('reports no average at all when every move was about mate', () => {
    const stats = new Stats();
    stats.add('you', 99_900, 50, true);
    assert.equal(stats.summary('you').acpl, 0);
    assert.equal(stats.summary('you').mates, 1);
  });

  it('still labels a missed mate as a blunder', () => {
    const stats = new Stats();
    assert.equal(stats.add('you', 99_900, 50, true).judgement, 'blunder');
  });
});
