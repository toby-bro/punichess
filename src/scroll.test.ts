import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nextScrollTop } from './scroll.ts';

/** A container occupying 100..200 on screen, currently scrolled to 50. */
const container = { top: 100, bottom: 200 };
const at = 50;

describe('nextScrollTop', () => {
  it('leaves a visible item alone', () => {
    assert.equal(nextScrollTop(at, container, { top: 120, bottom: 140 }), at);
  });

  it('leaves an item flush with either edge alone', () => {
    assert.equal(nextScrollTop(at, container, { top: 100, bottom: 120 }), at);
    assert.equal(nextScrollTop(at, container, { top: 180, bottom: 200 }), at);
  });

  it('scrolls up just enough to reach an item above', () => {
    assert.equal(nextScrollTop(at, container, { top: 70, bottom: 90 }), 20);
  });

  it('scrolls down just enough to reach an item below', () => {
    assert.equal(nextScrollTop(at, container, { top: 210, bottom: 230 }), 80);
  });

  it('prefers the top edge for an item taller than the container', () => {
    assert.equal(nextScrollTop(at, container, { top: 50, bottom: 400 }), 0);
  });

  it('never reports a change for an item exactly filling the container', () => {
    assert.equal(nextScrollTop(at, container, { top: 100, bottom: 200 }), at);
  });
});
