/**
 * Per-move accuracy bookkeeping.
 *
 * Average centipawn loss is the headline number, and each move also gets a
 * lichess-style label so a game can be summarised as counts rather than one
 * abstract average.
 */

/**
 * Who played a move. Not a colour: sides can be swapped mid-game, and your
 * record should follow you rather than stay with the pieces.
 */
export type Actor = 'you' | 'bot';

export type Judgement = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/**
 * Loss of winning chances, in percentage points, at which a move earns each
 * label. These are lichess's boundaries.
 */
export const JUDGEMENT_BANDS = {
  inaccuracy: 10,
  mistake: 20,
  blunder: 30,
} as const;

/**
 * Label a move from what it cost.
 *
 * Winning chances rather than centipawns, so that a move is not called a
 * blunder for dropping three pawns in a position that was already resigned.
 */
export function classify(cpLoss: number, winLoss: number): Judgement {
  if (winLoss >= JUDGEMENT_BANDS.blunder) return 'blunder';
  if (winLoss >= JUDGEMENT_BANDS.mistake) return 'mistake';
  if (winLoss >= JUDGEMENT_BANDS.inaccuracy) return 'inaccuracy';
  return cpLoss <= 0 ? 'best' : 'good';
}

/** A judged move, whoever played it. */
export interface Scored {
  readonly cpLoss: number;
  readonly winLoss: number;
  readonly judgement: Judgement;
}

export interface Entry extends Scored {
  readonly by: Actor;
}

export interface Summary {
  readonly moves: number;
  /** Average centipawn loss across those moves, 0 when there are none. */
  readonly acpl: number;
  readonly best: number;
  readonly good: number;
  readonly inaccuracy: number;
  readonly mistake: number;
  readonly blunder: number;
}

const EMPTY: Summary = {
  moves: 0,
  acpl: 0,
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
};

/**
 * Running accuracy for both players.
 *
 * Every move you submit is recorded, including ones you were sent back for.
 * An average that quietly forgets the blunders you took back would flatter you
 * about exactly the thing this app is for.
 */
export class Stats {
  #entries: Entry[] = [];

  get entries(): readonly Entry[] {
    return this.#entries;
  }

  add(by: Actor, cpLoss: number, winLoss: number): Entry {
    const entry: Entry = {
      by,
      cpLoss: Math.max(0, cpLoss),
      winLoss: Math.max(0, winLoss),
      judgement: classify(cpLoss, winLoss),
    };
    this.#entries.push(entry);
    return entry;
  }

  reset(): void {
    this.#entries = [];
  }

  /** Average centipawn loss for one side. */
  acpl(by: Actor): number {
    return summarise(this.#entries.filter(entry => entry.by === by)).acpl;
  }

  summary(by: Actor): Summary {
    return summarise(this.#entries.filter(entry => entry.by === by));
  }
}

export function summarise(entries: readonly Scored[]): Summary {
  if (entries.length === 0) return EMPTY;
  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let total = 0;
  for (const entry of entries) {
    total += entry.cpLoss;
    counts[entry.judgement]++;
  }
  return {
    moves: entries.length,
    // Rounded because a fractional centipawn is noise pretending to be precision.
    acpl: Math.round(total / entries.length),
    ...counts,
  };
}
