/**
 * Remembered searches, keyed by position.
 *
 * The engine analyses every position once during play, so the post-game review
 * mostly asks for work that has already been done. Forking back into a line
 * that was already played should cost nothing at all.
 */

import type { PvLine } from './uci.ts';

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
}
