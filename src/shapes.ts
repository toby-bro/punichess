/**
 * What gets drawn on the board, as plain data.
 *
 * Separated from the board so the overlapping cases can be tested. They keep
 * coming back, and they all look the same from the outside -- a label with
 * another label printed through it -- while having quite different causes.
 */

import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';

/** Anything that can be put on an arrow: a verdict, or a remembered mistake. */
export interface Cost {
  readonly stalemate?: boolean;
  readonly missesMate?: boolean;
  readonly hangsMate?: boolean;
  readonly mateIn?: number | undefined;
  readonly mateLater?: number | undefined;
  readonly cpLoss: number;
}

export const square = (uci: string, end: 0 | 2): Key => uci.slice(end, end + 2) as Key;

export const arrow = (uci: string, brush: string, label?: string): DrawShape => ({
  orig: square(uci, 0),
  dest: square(uci, 2),
  brush,
  ...(label === undefined ? {} : { label: { text: label } }),
});

/**
 * How much a move cost, short enough to sit on an arrow.
 *
 * Mate gets a # rather than a centipawn count, because a mate score is a hundred
 * pawns and "-99.9" says nothing anyone wants to read. Stalemate gets the draw
 * sign: it is neither a loss nor a missed mate, and calling it either was the
 * most confusing thing the app did.
 */
export function costLabel(cost: Cost): string {
  if (cost.stalemate === true) return '½';
  if (cost.missesMate === true) {
    // A slower mate is still mate, so say how much slower rather than how much
    // it "lost": nothing was lost, it took longer.
    if (cost.mateLater !== undefined) return `#Δ${cost.mateLater}`;
    return cost.mateIn === undefined ? '#' : `#${cost.mateIn}`;
  }
  if (cost.hangsMate === true) return '#';
  return `−${(cost.cpLoss / 100).toFixed(1)}`;
}

/**
 * Keep one shape per pair of squares, and one *label* per square.
 *
 * Two different moves can end on the same square -- a knight and a bishop both
 * going to f3, say -- and chessground writes every label in the corner of the
 * square the shape ends on. Two arrows there are informative; two labels there
 * are one smear. The later arrow keeps its line and loses its text, and the
 * first shape drawn is the one that keeps it, which is why the live attempt is
 * always passed before anything remembered.
 */
export function readable(shapes: readonly DrawShape[]): DrawShape[] {
  const drawn = new Set<string>();
  const labelled = new Set<string>();
  const kept: DrawShape[] = [];

  for (const shape of shapes) {
    const path = `${shape.orig}|${shape.dest ?? ''}`;
    if (drawn.has(path)) continue;
    drawn.add(path);

    // A label belongs to the square the shape ends on, which for a circle is
    // the square it sits on.
    const at = shape.dest ?? shape.orig;
    if (shape.label === undefined) {
      kept.push(shape);
      continue;
    }
    if (labelled.has(at)) {
      const { label: _label, ...unlabelled } = shape;
      kept.push(unlabelled);
      continue;
    }
    labelled.add(at);
    kept.push(shape);
  }
  return kept;
}
