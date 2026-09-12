/**
 * Geometry for the evaluation graph.
 *
 * Kept apart from the SVG it ends up in so the shape of the curve can be tested
 * without a DOM.
 */

import { winPercent } from './referee.ts';

/** Two decimals is plenty for a path coordinate, and keeps the markup small. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const yOf = (cp: number, height: number): number => height * (1 - winPercent(cp) / 100);

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Map evaluations to plot coordinates.
 *
 * Plotted in winning chances rather than centipawns: the centipawn scale spends
 * most of its range on positions that are already decided, which flattens the
 * part of the graph anyone actually looks at. White up is up.
 */
export function chartPoints(evals: readonly number[], width: number, height: number): Point[] {
  if (evals.length === 0) return [];
  if (evals.length === 1) {
    return [
      { x: 0, y: yOf(evals[0] ?? 0, height) },
      { x: width, y: yOf(evals[0] ?? 0, height) },
    ];
  }
  const step = width / (evals.length - 1);
  return evals.map((cp, index) => ({ x: index * step, y: yOf(cp, height) }));
}

/** An open polyline through the points. */
export const linePath = (points: readonly Point[]): string =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ');

/** The same curve closed down to the halfway line, to shade White's advantage. */
export function areaPath(points: readonly Point[], height: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return '';
  const middle = round(height / 2);
  return `M${round(first.x)} ${middle} ${linePath(points).slice(1)} L${round(last.x)} ${middle} Z`;
}
