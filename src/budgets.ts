/**
 * Search budgets, in nodes.
 *
 * Nodes rather than milliseconds, so the same position always scores the same
 * whatever else the phone is doing. Inconsistent scores are what produce false
 * accusations.
 *
 * Measured on the lite single-threaded engine (`npm run bench`), these cost
 * roughly: play 0.5s, wide 0.5s, probe 0.33s, verify 2.7s. The numbers matter
 * enough to be tested rather than tuned by feel -- see budgets.test.ts.
 */

export interface Budget {
  readonly multiPV: number;
  readonly nodes: number;
}

/**
 * Every move.
 *
 * A million nodes takes 2.3 seconds and reaches depth 14; 350k reaches depth 15
 * in 0.8. Past a point the extra nodes widen the MultiPV window rather than see
 * further, and for judging whether a move dropped a pawn that is wasted.
 */
export const SEARCH: Budget = { multiPV: 8, nodes: 350_000 };

/** Deeper, and only reached when a verdict is too close to call. */
export const VERIFY: Budget = { multiPV: 8, nodes: 1_200_000 };

/**
 * Every legal move, used only when hunting for an error worth making.
 *
 * Not an optimisation: in a normal middlegame the top two dozen moves are all
 * within a pawn of best, so anything narrower contains nothing that loses enough
 * to be worth spotting and the bot never errs at all.
 */
export const WIDE: Budget = { multiPV: 40, nodes: 250_000 };

/** Just enough to see whether an error has one clear refutation. */
export const PROBE: Budget = { multiPV: 2, nodes: 150_000 };

/** Looking up a single move the narrow search did not list. */
export const LOOKUP: Budget = { multiPV: 1, nodes: 350_000 };

/** Per position in the post-game review. */
export const REVIEW: Budget = { multiPV: 3, nodes: 350_000 };

/**
 * The most the bot may spend choosing one move.
 *
 * One wide search plus the punishability probes. About two seconds at the
 * measured rate -- which costs nothing in practice, since the bot waits out its
 * minimum move time anyway, and that defaults to longer than this.
 *
 * A bot that thinks for ten seconds is worse company than one that occasionally
 * fails to find an error worth making, so this is a bound the code is tested
 * against rather than an aspiration.
 */
export const MOVE_CEILING_NODES = 900_000;

/** Whether a remembered search at `have` answers a request for `want`. */
export const satisfies = (have: Budget, want: Budget): boolean =>
  have.nodes >= want.nodes && have.multiPV >= want.multiPV;
