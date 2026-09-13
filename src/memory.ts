/**
 * What you got wrong in this game.
 *
 * Keyed by position, and scoped to one game rather than kept globally. That
 * scope is the whole point: openings repeat, so a store shared across games
 * paints last week's blunders onto a board you have only just set up, which
 * tells you nothing about the game you are playing and gives away that the
 * position is worth worrying about.
 *
 * It travels with the game instead, saved and reopened along with the tree, so
 * a game you come back to still knows what you tried in it.
 */

/** Positions remembered before the least recently seen are dropped. */
const DEFAULT_CAPACITY = 500;

export interface Mistake {
  readonly uci: string;
  readonly san: string;
  /** What it cost, in centipawns, the worst time you played it. */
  readonly cpLoss: number;
  readonly missesMate: boolean;
  readonly hangsMate: boolean;
  readonly mateIn?: number | undefined;
  /** How many moves longer your mate was than the one available. */
  readonly mateLater?: number | undefined;
  readonly stalemate: boolean;
  /** How many times you have played it here. */
  readonly times: number;
  /** When you last played it, as epoch milliseconds. */
  readonly last: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Rebuild one remembered mistake from storage, or reject it. */
function parseMistake(raw: unknown): Mistake | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const { uci, san } = value;
  if (typeof uci !== 'string' || uci.length < 4) return undefined;

  return {
    uci,
    san: typeof san === 'string' && san.length > 0 ? san : uci,
    cpLoss: isFiniteNumber(value['cpLoss']) ? Math.max(0, value['cpLoss']) : 0,
    missesMate: value['missesMate'] === true,
    hangsMate: value['hangsMate'] === true,
    stalemate: value['stalemate'] === true,
    mateIn: isFiniteNumber(value['mateIn']) ? value['mateIn'] : undefined,
    mateLater: isFiniteNumber(value['mateLater']) ? value['mateLater'] : undefined,
    times: isFiniteNumber(value['times']) ? Math.max(1, Math.floor(value['times'])) : 1,
    last: isFiniteNumber(value['last']) ? value['last'] : 0,
  };
}

/** The shape a game's mistakes are stored in. */
export type StoredMistakes = Record<string, Mistake[]>;

export class MistakeMemory {
  /** Insertion order is recency: the oldest entry is the first one out. */
  #positions = new Map<string, Mistake[]>();
  readonly #capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.#capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.#positions.size;
  }

  /** Everything you have got wrong here, worst first. */
  at(fen: string): readonly Mistake[] {
    return this.#positions.get(fen) ?? [];
  }

  /**
   * Record a mistake.
   *
   * Playing the same wrong move twice counts it twice rather than adding a
   * duplicate, and keeps the worst valuation of it: a move is as bad as the
   * deepest look you have taken at it.
   */
  record(fen: string, mistake: Omit<Mistake, 'times' | 'last'>, now = Date.now()): void {
    const existing = this.#positions.get(fen) ?? [];
    const previous = existing.find(entry => entry.uci === mistake.uci);

    const updated: Mistake = {
      ...mistake,
      cpLoss: Math.max(mistake.cpLoss, previous?.cpLoss ?? 0),
      missesMate: mistake.missesMate || (previous?.missesMate ?? false),
      hangsMate: mistake.hangsMate || (previous?.hangsMate ?? false),
      stalemate: mistake.stalemate || (previous?.stalemate ?? false),
      times: (previous?.times ?? 0) + 1,
      last: now,
    };

    const others = existing.filter(entry => entry.uci !== mistake.uci);
    const merged = [...others, updated].sort((a, b) => b.cpLoss - a.cpLoss);

    // Re-insert so the position counts as recently seen.
    this.#positions.delete(fen);
    this.#positions.set(fen, merged);
    this.#evict();
  }

  forget(fen: string): void {
    this.#positions.delete(fen);
  }

  clear(): void {
    this.#positions.clear();
  }

  /** Everything, in the shape a saved game stores. */
  toStored(): StoredMistakes {
    return Object.fromEntries(this.#positions);
  }

  /**
   * Replace everything with what a saved game held.
   *
   * Stored history outlives the code that wrote it, so each entry is checked on
   * the way in and an unusable one is dropped without taking the rest with it.
   */
  restore(raw: unknown): void {
    this.#positions = new Map();
    if (typeof raw !== 'object' || raw === null) return;

    for (const [fen, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const mistakes = list.map(parseMistake).filter((entry): entry is Mistake => !!entry);
      if (mistakes.length > 0) this.#positions.set(fen, mistakes);
    }
    this.#evict();
  }

  #evict(): void {
    while (this.#positions.size > this.#capacity) {
      const oldest = this.#positions.keys().next();
      if (oldest.done === true) break;
      this.#positions.delete(oldest.value);
    }
  }
}
