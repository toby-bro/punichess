import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRAND_FONTS, brandFontStack, brandFontUrl, pickBrandFont } from './brand.ts';

test('the list is a list of distinct, usable family names', () => {
  assert.ok(BRAND_FONTS.length > 50);
  assert.equal(new Set(BRAND_FONTS).size, BRAND_FONTS.length, 'no family listed twice');
  for (const name of BRAND_FONTS) {
    assert.ok(name.length > 0);
    assert.equal(name, name.trim(), `${name} has stray whitespace`);
    // The name goes straight into a URL and into a quoted CSS string, so
    // anything that would need escaping in either has no business being here.
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9 ]*$/, `${name} is not a plain family name`);
  }
});

test('a family name survives the trip into a Google Fonts URL', () => {
  assert.equal(
    brandFontUrl('Luckiest Guy'),
    'https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap',
  );
  assert.equal(
    brandFontUrl('Love Ya Like A Sister'),
    'https://fonts.googleapis.com/css2?family=Love+Ya+Like+A+Sister&display=swap',
  );
});

test('the stack always ends somewhere real', () => {
  // The font arrives over the network or not at all, and "not at all" is the
  // normal case for an app whose point is working offline.
  const stack = brandFontStack('Bangers');
  assert.ok(stack.startsWith("'Bangers', "));
  assert.ok(stack.includes('sans-serif'));
});

test('picking uses the whole list and only the list', () => {
  assert.equal(
    pickBrandFont(() => 0),
    BRAND_FONTS[0],
  );
  assert.equal(
    pickBrandFont(() => 0.999999),
    BRAND_FONTS.at(-1),
  );
  // Math.random can in principle return exactly 1; a font must still come back.
  assert.ok(BRAND_FONTS.includes(pickBrandFont(() => 1)));
});

test('every font gets a turn', () => {
  // A modulo or a rounding slip that quietly never reaches the ends of the list
  // is invisible in use: you would just never see those faces.
  // Sampled at the middle of each bucket rather than its edge: i / n * n lands
  // a hair under i for some i, which would make this fail on the arithmetic
  // rather than on anything pickBrandFont did.
  const seen = new Set(
    Array.from({ length: BRAND_FONTS.length }, (_, i) =>
      pickBrandFont(() => (i + 0.5) / BRAND_FONTS.length),
    ),
  );
  assert.equal(seen.size, BRAND_FONTS.length);
});
