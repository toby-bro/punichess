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

/**
 * The longest label that can still be read.
 *
 * Chessground draws every label in a circle of fixed size and picks the font as
 * `0.4 * 0.75 ** text.length` -- so each extra character shrinks the type by a
 * quarter, compounding. Four characters is comfortable, five is small, and
 * seven ("−2.0 ×2") is a third the size of four inside the same circle: present,
 * legible to nobody, and indistinguishable from a rendering fault.
 *
 * Anything a label wants to say beyond this has to be said some other way.
 */
export const LEGIBLE_LABEL = 5;

export const square = (uci: string, end: 0 | 2): Key => uci.slice(end, end + 2) as Key;

export const arrow = (uci: string, brush: string, label?: string): DrawShape => ({
  orig: square(uci, 0),
  dest: square(uci, 2),
  brush,
  ...(label === undefined ? {} : { label: { text: label } }),
});

/**
 * A mistake you have made here before, drawn paler than one you are making now.
 *
 * Deliberately identical however many times you have fallen for it. Counting the
 * repeats on the arrow made its text longer, and a longer label is a smaller
 * label -- so the same mistake was legible or illegible depending on how often
 * you had made it, and flipped between the two as you moved around the game.
 * Drawing the repeat differently instead only moved the flicker somewhere else.
 * An arrow that means one thing and always looks like it beats an arrow that
 * carries a statistic nobody can read.
 */
export const rememberedArrow = (uci: string, cost: Cost): DrawShape =>
  arrow(uci, 'paleRed', costLabel(cost));

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
  // Past ten pawns the tenth of a pawn is noise, and the character it costs is
  // not free: it shrinks the whole label. "-100.0" is unreadable; "-100" is not,
  // and says everything "-100.0" did.
  // Decided on the rendered text rather than the number, so a value that rounds
  // up into two digits ("10.0") is caught along with one that started there.
  const pawns = cost.cpLoss / 100;
  const tenths = pawns.toFixed(1);
  return `−${tenths.length > 3 ? Math.round(pawns).toFixed(0) : tenths}`;
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
