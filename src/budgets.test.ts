import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_PROBES } from './bot.ts';
import {
  LOOKUP,
  MOVE_CEILING_NODES,
  PROBE,
  REVIEW,
  SEARCH,
  VERIFY,
  WIDE,
  satisfies,
} from './budgets.ts';

/**
 * These are timing tests without the timing.
 *
 * Wall-clock assertions are machine-dependent and go flaky the moment they run
 * somewhere slower. Node counts are not: the engine does the work it is asked
 * for, so bounding the work bounds the wait, and a regression that quietly adds
 * a search fails here rather than on someone's phone.
 */
describe('search budgets', () => {
  it('keeps the cost of choosing a move bounded', () => {
    const worstCase = WIDE.nodes + MAX_PROBES * PROBE.nodes;
    assert.ok(
      worstCase <= MOVE_CEILING_NODES,
      `erring on purpose costs up to ${worstCase} nodes, ceiling is ${MOVE_CEILING_NODES}`,
    );
  });

  it('never spends more on an ordinary move than on hunting for an error', () => {
    // An ordinary move is the common case and must be the cheap one.
    assert.ok(SEARCH.nodes <= WIDE.nodes + PROBE.nodes);
  });

  it('lets the review reuse what playing already computed', () => {
    // The whole point of caching: a game just played needs no new searching.
    assert.ok(
      satisfies(SEARCH, REVIEW),
      'a review request must be answerable by the search done while playing',
    );
  });

  it('lets an ordinary search reuse a wide one', () => {
    assert.ok(satisfies(WIDE, SEARCH) === WIDE.nodes >= SEARCH.nodes);
  });

  it('verifies more deeply than it judges, or the second look is pointless', () => {
    assert.ok(VERIFY.nodes > SEARCH.nodes);
    assert.ok(VERIFY.multiPV >= SEARCH.multiPV);
  });

  it('looks a single move up cheaply', () => {
    assert.equal(LOOKUP.multiPV, 1, 'one line is all a lookup needs');
    assert.ok(LOOKUP.nodes <= SEARCH.nodes, 'and it must not cost more than the search it serves');
  });

  it('probes cheaply enough to afford several', () => {
    assert.ok(PROBE.nodes * MAX_PROBES <= WIDE.nodes * 3);
    assert.equal(PROBE.multiPV, 2, 'best versus second best is the whole question');
  });

  it('searches wide enough to contain moves worth punishing', () => {
    // Measured: at MultiPV 24 a normal middlegame yields zero candidates in the
    // 1-3 pawn band. This is the number that makes the bot able to err at all.
    assert.ok(WIDE.multiPV >= 32, 'narrower than this and the bot never errs');
  });
});

describe('satisfies', () => {
  it('accepts a search that was at least as thorough', () => {
    assert.equal(satisfies({ multiPV: 8, nodes: 1000 }, { multiPV: 3, nodes: 500 }), true);
    assert.equal(satisfies({ multiPV: 8, nodes: 1000 }, { multiPV: 8, nodes: 1000 }), true);
  });

  it('refuses one that was weaker in either dimension', () => {
    assert.equal(satisfies({ multiPV: 8, nodes: 400 }, { multiPV: 8, nodes: 500 }), false);
    assert.equal(satisfies({ multiPV: 2, nodes: 1000 }, { multiPV: 8, nodes: 500 }), false);
  });
});
