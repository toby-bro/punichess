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
 * The circle a label sits in is a fixed fraction of a square and style.css
 * overrides chessground's own type size to fill it. That override is one size
 * for every label, so what fits is a fixed number of characters rather than a
 * curve: four fills the circle and five runs out of it.
 *
 * Anything a label wants to say beyond this has to be said some other way.
 */
export const LEGIBLE_LABEL = 4;

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
  arrow(uci, 'paleRed', costLabelHtml(cost));

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
 * What an engine line is worth, short enough to sit on an arrow.
 *
 * The same numbers the evaluation bar shows, with one decimal rather than two
 * and whole pawns once there are ten of them. Two decimals is six characters
 * for a position that is already lost, and that precision answers a question
 * nobody looking at an arrow is asking.
 */
export function evalLabel(cp: number, mate?: number): string {
  if (mate !== undefined) return `#${mate > 0 ? '' : '-'}${Math.abs(mate)}`;
  const pawns = cp / 100;
  const text = Math.abs(pawns) >= 9.95 ? Math.round(pawns).toFixed(0) : pawns.toFixed(1);
  return pawns > 0 ? `+${text}` : text;
}

/**
 * The same label, with a mate you let slip struck through.
 *
 * Both halves of a mate read "#": the one you had and did not play, and the one
 * you have just allowed against yourself. They are opposite things and the arrow
 * said the same word for each. A line through it says which.
 *
 * Chessground writes a label with innerHTML, and since style.css took the type
 * size off the character count, markup in here costs nothing. Everything in it
 * is written by this file; none of it comes from anywhere else.
 */
export function costLabelHtml(cost: Cost): string {
  const text = costLabel(cost);
  // A mate that arrived late is already marked "#Δn" and is not a mate
  // missed -- it was found, slowly.
  const missed = cost.missesMate === true && cost.mateLater === undefined;
  if (!missed || !text.startsWith('#')) return text;
  return `<tspan style="text-decoration:line-through">${text}</tspan>`;
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
