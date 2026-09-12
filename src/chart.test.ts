import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { areaPath, chartPoints, linePath } from './chart.ts';
import { mateToCp } from './uci.ts';

describe('chartPoints', () => {
  it('is empty for no data', () => {
    assert.deepEqual(chartPoints([], 100, 50), []);
  });

  it('draws a single evaluation as a flat line across the width', () => {
    const points = chartPoints([0], 100, 50);
    assert.equal(points.length, 2);
    const [start, end] = points;
    assert.ok(start && end);
    assert.equal(start.x, 0);
    assert.equal(end.x, 100);
    assert.equal(start.y, end.y);
  });

  it('spreads points evenly across the width', () => {
    const points = chartPoints([0, 0, 0, 0, 0], 100, 50);
    assert.deepEqual(
      points.map(p => p.x),
      [0, 25, 50, 75, 100],
    );
  });

  it('puts a level position on the halfway line', () => {
    assert.equal(chartPoints([0], 100, 50)[0]?.y, 25);
  });

  it('puts White up above the middle and Black up below', () => {
    const [white] = chartPoints([300], 100, 50);
    const [black] = chartPoints([-300], 100, 50);
    assert.ok((white?.y ?? 0) < 25, 'White winning should plot upwards');
    assert.ok((black?.y ?? 0) > 25, 'Black winning should plot downwards');
  });

  it('stays inside the box even for mate scores', () => {
    for (const cp of [mateToCp(1), mateToCp(-1), 1e9, -1e9]) {
      const [point] = chartPoints([cp], 100, 50);
      assert.ok((point?.y ?? -1) >= 0 && (point?.y ?? 99) <= 50, `${cp} plotted outside`);
    }
  });

  it('is monotonic in the evaluation', () => {
    const ys = [-800, -200, 0, 200, 800].map(cp => chartPoints([cp], 100, 50)[0]?.y ?? 0);
    for (let i = 1; i < ys.length; i++) {
      assert.ok((ys[i] ?? 0) < (ys[i - 1] ?? 0), 'higher evaluation must plot higher');
    }
  });
});

describe('paths', () => {
  it('draws a polyline through every point', () => {
    const path = linePath(chartPoints([0, 100, -100], 100, 50));
    assert.match(path, /^M0 /);
    assert.equal(path.split('L').length, 3, 'two segments after the move-to');
  });

  it('closes the area back to the halfway line', () => {
    const path = areaPath(chartPoints([0, 100], 100, 50), 50);
    assert.match(path, /^M0 25/);
    assert.match(path, /Z$/);
  });

  it('produces nothing for no points', () => {
    assert.equal(areaPath([], 50), '');
    assert.equal(linePath([]), '');
  });
});
