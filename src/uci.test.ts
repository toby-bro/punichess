import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MATE_CP, collectLines, mateToCp, parseInfo } from './uci.ts';

describe('parseInfo', () => {
  it('reads a centipawn line', () => {
    const pv = parseInfo('info depth 18 seldepth 24 multipv 2 score cp -31 nodes 12 pv e2e4 e7e5');
    assert.deepEqual(pv, {
      multipv: 2,
      cp: -31,
      mate: undefined,
      depth: 18,
      moves: ['e2e4', 'e7e5'],
    });
  });

  it('defaults to the first slot when multipv is absent', () => {
    const pv = parseInfo('info depth 5 score cp 12 pv d2d4');
    assert.equal(pv?.multipv, 1);
  });

  it('folds mate scores onto the centipawn scale', () => {
    const pv = parseInfo('info depth 7 multipv 1 score mate 3 pv a1a8 g8h7 a8h8');
    assert.ok(pv);
    assert.equal(pv.mate, 3);
    assert.equal(pv.cp, MATE_CP - 300);
  });

  it('makes being mated a large negative score', () => {
    const pv = parseInfo('info depth 7 multipv 1 score mate -2 pv a1a8');
    assert.ok(pv);
    assert.ok(pv.cp < -(MATE_CP - 1000));
  });

  it('ranks a faster mate above a slower one', () => {
    assert.ok(mateToCp(1) > mateToCp(5));
    assert.ok(mateToCp(-1) < mateToCp(-5));
  });

  for (const line of [
    'info depth 1 currmove e2e4 currmovenumber 1',
    'info string NNUE evaluation using nn-9067e33176e.nnue',
    'info depth 12 multipv 1 score cp 20',
    'info multipv 1 score cp 20 pv e2e4',
    'info depth 12 multipv 1 pv e2e4',
    'info depth 12 multipv 1 score cp pv e2e4',
    'bestmove e2e4 ponder e7e5',
    '',
  ]) {
    it(`ignores non-variation output: ${JSON.stringify(line)}`, () => {
      assert.equal(parseInfo(line), undefined);
    });
  }

  it('ignores score kinds it does not understand', () => {
    assert.equal(parseInfo('info depth 4 multipv 1 score lowerbound 3 pv e2e4'), undefined);
  });
});

describe('collectLines', () => {
  const output = [
    'info string starting',
    'info depth 4 multipv 1 score cp 30 pv e2e4',
    'info depth 4 multipv 2 score cp 20 pv d2d4',
    'info depth 18 multipv 1 score cp 33 pv e2e4 e7e5',
    'info depth 18 multipv 2 score cp 27 pv g1f3 d7d5',
    'bestmove e2e4',
  ];

  it('keeps only the deepest report per slot', () => {
    const lines = collectLines(output);
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map(l => [l.multipv, l.depth, l.cp]),
      [
        [1, 18, 33],
        [2, 18, 27],
      ],
    );
  });

  it('orders lines best first regardless of arrival order', () => {
    const lines = collectLines([...output].reverse());
    assert.deepEqual(
      lines.map(l => l.multipv),
      [1, 2],
    );
  });

  it('returns nothing for a search that produced no variation', () => {
    assert.deepEqual(collectLines(['info depth 0 score cp 0', 'bestmove (none)']), []);
  });
});
