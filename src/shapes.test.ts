import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DrawShape } from 'chessground/draw';

import { LEGIBLE_LABEL, arrow, costLabel, readable, rememberedArrow, square } from './shapes.ts';

const labels = (shapes: readonly DrawShape[]): (string | undefined)[] =>
  shapes.map(shape => shape.label?.text);

test('square reads either end of a uci move', () => {
  assert.equal(square('g1f3', 0), 'g1');
  assert.equal(square('g1f3', 2), 'f3');
  // Promotions carry a fifth character that is not part of the square.
  assert.equal(square('e7e8q', 2), 'e8');
});

test('an arrow without a label carries no label field at all', () => {
  assert.equal('label' in arrow('g1f3', 'red'), false);
  assert.deepEqual(arrow('g1f3', 'red', '−2.0').label, { text: '−2.0' });
});

test('costLabel says mate rather than a hundred pawns', () => {
  assert.equal(costLabel({ cpLoss: 250 }), '−2.5');
  assert.equal(costLabel({ cpLoss: 999 }), '−10', 'rounding up crosses into whole pawns');
  assert.equal(costLabel({ cpLoss: 994 }), '−9.9');
  assert.equal(costLabel({ cpLoss: 10_000 }), '−100');
  assert.equal(costLabel({ cpLoss: 9999, missesMate: true, mateIn: 3 }), '#3');
  assert.equal(costLabel({ cpLoss: 9999, missesMate: true, mateLater: 4 }), '#Δ4');
  assert.equal(costLabel({ cpLoss: 9999, hangsMate: true }), '#');
  assert.equal(costLabel({ cpLoss: 9999, stalemate: true, missesMate: true, mateIn: 2 }), '½');
});

test('the same move drawn twice is drawn once', () => {
  const kept = readable([arrow('g1f3', 'red', '−2.0'), arrow('g1f3', 'paleRed', '−2.0 ×2')]);
  assert.equal(kept.length, 1);
  assert.deepEqual(labels(kept), ['−2.0']);
});

test('two moves onto one square keep both arrows but one label', () => {
  // The reported bug: try a bad knight move, get stopped, try a bad bishop move
  // to the same square. Both arrows are worth seeing; both labels are printed in
  // the same corner of f3 and read as one smear.
  const kept = readable([arrow('g1f3', 'red', '−2.0'), arrow('c1f3', 'red', '−3.1')]);
  assert.equal(kept.length, 2, 'both arrows are still drawn');
  assert.deepEqual(labels(kept), ['−2.0', undefined]);
});

test('the live mistake keeps its label when the engine answer lands on the same square', () => {
  // Asking to be shown adds the engine's favourites, and a refutation very often
  // ends on the square the mistake ended on -- a recapture. What you did wrong
  // is the label worth keeping, so it is passed first.
  const kept = readable([arrow('d1h5', 'red', '−4.2'), arrow('g6h5', 'green', '+4.2')]);
  assert.deepEqual(labels(kept), ['−4.2', undefined]);
});

test('two engine answers onto one square do not stack either', () => {
  // Recaptures: Nxd5 and exd5 are routinely both in the top three.
  const kept = readable([arrow('c3d5', 'green', '+0.3'), arrow('e4d5', 'blue', '+0.1')]);
  assert.equal(kept.length, 2);
  assert.deepEqual(labels(kept), ['+0.3', undefined]);
});

test('an unlabelled shape never costs a labelled one its text', () => {
  // rejectedShapes rings the destination square as well as drawing the arrow.
  const ring: DrawShape = { orig: 'f3', brush: 'red' };
  const kept = readable([ring, arrow('g1f3', 'red', '−2.0')]);
  assert.deepEqual(labels(kept), [undefined, '−2.0']);
});

test('a circle counts as labelling the square it sits on', () => {
  const kept = readable([
    { orig: 'f3', brush: 'red', label: { text: '½' } },
    arrow('g1f3', 'red', '−2.0'),
  ]);
  assert.deepEqual(labels(kept), ['½', undefined]);
});

test('labels on different squares are all kept', () => {
  const kept = readable([arrow('g1f3', 'red', '−2.0'), arrow('b1c3', 'red', '−1.4')]);
  assert.deepEqual(labels(kept), ['−2.0', '−1.4']);
});

test('dropping a label does not mutate the shape it was given', () => {
  const original = arrow('c1f3', 'red', '−3.1');
  readable([arrow('g1f3', 'red', '−2.0'), original]);
  assert.deepEqual(original.label, { text: '−3.1' });
});

test('every label a mistake can produce stays legible', () => {
  // Chessground picks the font as 0.4 * 0.75 ** length inside a fixed circle, so
  // a long label is not merely cramped, it is smaller than the eye can resolve.
  // This is the invariant the "x2" suffix broke: seven characters rendered at a
  // third the size of four, which read as a rendering fault rather than as text.
  const costs = [
    { cpLoss: 0 },
    { cpLoss: 50 },
    { cpLoss: 9999 },
    { cpLoss: 12_345 },
    { cpLoss: 9999, missesMate: true, mateIn: 12 },
    { cpLoss: 9999, missesMate: true, mateLater: 15 },
    { cpLoss: 9999, hangsMate: true },
    { cpLoss: 9999, stalemate: true },
  ];
  for (const cost of costs) {
    const text = costLabel(cost);
    assert.ok(
      text.length <= LEGIBLE_LABEL,
      `${text} is ${String(text.length)} characters, over ${String(LEGIBLE_LABEL)}`,
    );
  }
});

test('a remembered mistake looks the same however often it was made', () => {
  // The whole point: nothing about how many times you fell for it may reach the
  // arrow, in the text or anywhere else. It changed size as you moved around the
  // game, which reads as the board glitching rather than as information.
  const once = rememberedArrow('g1f3', { cpLoss: 200 });
  assert.deepEqual(once.label, { text: '−2.0' });
  assert.equal(once.modifiers, undefined);
});
