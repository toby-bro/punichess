/**
 * Remembered searches, keyed by position.
 *
 * The engine analyses every position once during play, so the post-game review
 * mostly asks for work that has already been done. Forking back into a line
 * that was already played should cost nothing at all.
 */

import type { PvLine } from './uci.ts';

/**
 * How much of each variation to keep when storing a search.
 *
 * The app never reads further than the reveal steps, and a principal variation
 * can run thirty moves deep, most of which nothing will ever look at.
 */
const STORED_PV_DEPTH = 8;

/** A remembered search, in the shape a saved game stores. */
export interface StoredSearch {
  readonly nodes: number;
  readonly multiPV: number;
  readonly lines: readonly PvLine[];
}

export type StoredCache = Record<string, StoredSearch>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Rebuild one variation from storage, or reject it. */
function parseLine(raw: unknown): PvLine | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (!isFiniteNumber(value['cp']) || !isFiniteNumber(value['depth'])) return undefined;

  const moves = Array.isArray(value['moves'])
    ? value['moves'].filter((move): move is string => typeof move === 'string' && move.length >= 4)
    : [];
  const [first, ...rest] = moves;
  // A variation with no moves in it says nothing and breaks the non-empty
  // guarantee everything downstream relies on.
  if (first === undefined) return undefined;

  return {
    multipv: isFiniteNumber(value['multipv']) ? value['multipv'] : 1,
    cp: value['cp'],
    mate: isFiniteNumber(value['mate']) ? value['mate'] : undefined,
    depth: value['depth'],
    moves: [first, ...rest],
  };
}

export interface CachedSearch {
  readonly lines: readonly PvLine[];
  /** The budget that produced these lines, so a weaker search cannot displace a stronger one. */
  readonly nodes: number;
  readonly multiPV: number;
}

/** Positions kept before the oldest are dropped. A long game is ~200 plies. */
const DEFAULT_CAPACITY = 2000;

export class PositionCache {
  readonly #entries = new Map<string, CachedSearch>();
  readonly #capacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.#capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.#entries.size;
  }

  /** A remembered search at least as thorough as the one asked for, if there is one. */
  get(fen: string, nodes: number, multiPV: number): readonly PvLine[] | undefined {
    const entry = this.#entries.get(fen);
    if (!entry) return undefined;
    if (entry.nodes < nodes || entry.multiPV < multiPV) return undefined;
    // Refresh recency so positions being revisited survive eviction.
    this.#entries.delete(fen);
    this.#entries.set(fen, entry);
    return entry.lines;
  }

  /**
   * Whatever is remembered for a position, however thorough it was.
   *
   * For showing what is known rather than for judging: a display has no standard
   * to fall short of, so any search beats none.
   */
  lines(fen: string): readonly PvLine[] | undefined {
    return this.#entries.get(fen)?.lines;
  }

  /** The best evaluation known for a position, from the side to move's view. */
  best(fen: string): PvLine | undefined {
    return this.#entries.get(fen)?.lines[0];
  }

  has(fen: string): boolean {
    return this.#entries.has(fen);
  }

  set(fen: string, lines: readonly PvLine[], nodes: number, multiPV: number): void {
    const existing = this.#entries.get(fen);
    // Never let a cheaper search overwrite a more thorough one.
    if (existing && existing.nodes >= nodes && existing.multiPV >= multiPV) return;

    this.#entries.delete(fen);
    this.#entries.set(fen, { lines, nodes, multiPV });

    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  /**
   * Everything known, in the shape a saved game stores.
   *
   * Kept in full rather than reduced to one number per position: an evaluation
   * without its variations is enough to draw a graph and nothing else, and
   * reopening a game should not mean searching it all over again.
   */
  toStored(): StoredCache {
    return Object.fromEntries(
      [...this.#entries].map(([fen, entry]) => [
        fen,
        {
          nodes: entry.nodes,
          multiPV: entry.multiPV,
          lines: entry.lines.map(line => ({
            ...line,
            moves: line.moves.slice(0, STORED_PV_DEPTH) as [string, ...string[]],
          })),
        },
      ]),
    );
  }

  /**
   * Load what a saved game knew.
   *
   * Every entry is checked on the way in: a stored search outlives the code that
   * wrote it, and a malformed one would go on to be treated as the engine's own
   * word about a position.
   */
  restore(raw: unknown): void {
    this.#entries.clear();
    if (typeof raw !== 'object' || raw === null) return;

    for (const [fen, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const search = entry as Record<string, unknown>;
      if (!isFiniteNumber(search['nodes']) || !isFiniteNumber(search['multiPV'])) continue;
      if (!Array.isArray(search['lines'])) continue;

      const lines = search['lines'].map(parseLine).filter((line): line is PvLine => !!line);
      if (lines.length === 0) continue;
      this.set(fen, lines, search['nodes'], search['multiPV']);
    }
  }
}
