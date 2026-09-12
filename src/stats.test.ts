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
    stats.add('white', 0, 0);
    stats.add('white', 40, 4);
    stats.add('white', 200, 25);
    const summary = stats.summary('white');
    assert.equal(summary.moves, 3);
    assert.equal(summary.acpl, 80);
    assert.equal(summary.best, 1);
    assert.equal(summary.good, 1);
    assert.equal(summary.mistake, 1);
  });
});

describe('Stats', () => {
  it('keeps the two sides apart', () => {
    const stats = new Stats();
    stats.add('white', 10, 1);
    stats.add('black', 200, 20);
    assert.equal(stats.acpl('white'), 10);
    assert.equal(stats.acpl('black'), 200);
    assert.equal(stats.summary('white').moves, 1);
  });

  it('reports zero for a side that has not moved', () => {
    assert.equal(new Stats().acpl('white'), 0);
  });

  it('never records a negative loss', () => {
    const stats = new Stats();
    const entry = stats.add('white', -50, -5);
    assert.equal(entry.cpLoss, 0);
    assert.equal(entry.winLoss, 0);
  });

  it('drops entries past a fork', () => {
    const stats = new Stats();
    stats.add('white', 10, 1);
    stats.add('black', 20, 2);
    stats.add('white', 300, 40);
    stats.truncate(2);
    assert.equal(stats.entries.length, 2);
    assert.equal(stats.summary('white').blunder, 0);
  });

  it('starts over on reset', () => {
    const stats = new Stats();
    stats.add('white', 10, 1);
    stats.reset();
    assert.equal(stats.entries.length, 0);
    assert.equal(stats.acpl('white'), 0);
  });
});
