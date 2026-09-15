import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Every element the app reaches for has to be in the page.
 *
 * `element()` throws when an id is missing, and it is called while the module is
 * still being evaluated, so one absent id means the app does not start at all --
 * a blank page, no board, nothing. None of the other tests would notice: they
 * exercise pure functions and never look at the markup, and neither the compiler
 * nor the linter has any idea that a string in TypeScript names a tag in HTML.
 *
 * That is exactly how a control got wired up in main.ts, styled in style.css, and
 * never added to index.html, while the compiler, the linter and 399 tests all
 * said yes.
 */
const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const html = read('index.html');
const main = read('src/main.ts');

const wanted = [...main.matchAll(/\belement\('([^']+)'\)/g)].map(match => match[1]);
const present = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));

test('the page has every element main.ts looks up', () => {
  // A guard on the guard: if the pattern ever stops matching, this test would
  // pass by finding nothing to check, which is the most comfortable way for a
  // test to be useless.
  assert.ok(
    wanted.length > 15,
    `only found ${String(wanted.length)} lookups -- has the call changed?`,
  );

  const missing = wanted.filter(id => !present.has(id));
  assert.deepEqual(
    missing,
    [],
    `main.ts looks up ${missing.map(id => `#${id}`).join(', ')}, which index.html does not have`,
  );
});

test('no id is declared twice', () => {
  // getElementById takes the first, silently, so a duplicate is a control that
  // is wired to something other than the one you can see.
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(all).size, all.length, 'index.html declares an id more than once');
});
