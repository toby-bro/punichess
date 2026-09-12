/**
 * The moves played, and where we are looking.
 *
 * Kept separate from the board so that navigating, forking and replaying are
 * plain data operations that can be tested without a DOM.
 */

import { INITIAL_FEN, fenAfter, sanOf, turnOf } from './chess.ts';
import type { Color } from 'chessops/types';

export interface Ply {
  readonly uci: string;
  readonly san: string;
  /** The position *after* this move. */
  readonly fen: string;
  readonly by: Color;
  /** The bot played this one wrong on purpose. */
  readonly deliberateError: boolean;
}

export interface PlayOptions {
  readonly deliberateError?: boolean;
}

export class History {
  readonly #start: string;
  #plies: Ply[] = [];
  /** How many plies of `#plies` are on the board. 0 is the starting position. */
  #cursor = 0;

  constructor(start: string = INITIAL_FEN) {
    this.#start = start;
  }

  get plies(): readonly Ply[] {
    return this.#plies;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get length(): number {
    return this.#plies.length;
  }

  /** The position currently being looked at. */
  get fen(): string {
    return this.at(this.#cursor);
  }

  /** The move that produced the current position, if any. */
  get lastMove(): Ply | undefined {
    return this.#cursor > 0 ? this.#plies[this.#cursor - 1] : undefined;
  }

  /** True when we are looking at the end of the game rather than browsing. */
  get atLive(): boolean {
    return this.#cursor === this.#plies.length;
  }

  get atStart(): boolean {
    return this.#cursor === 0;
  }

  /** Whose turn it is in the position being looked at. */
  get turn(): Color {
    return turnOf(this.fen);
  }

  /**
   * True when the move about to be played is a reply to an error the bot made
   * on purpose, and so should be judged strictly.
   */
  get punishArmed(): boolean {
    return this.lastMove?.deliberateError ?? false;
  }

  /** The position after `index` plies. */
  at(index: number): string {
    if (index <= 0) return this.#start;
    const ply = this.#plies[Math.min(index, this.#plies.length) - 1];
    return ply ? ply.fen : this.#start;
  }

  /**
   * Play a move from the position being looked at.
   *
   * Playing while browsing an earlier position discards everything after it:
   * that is the fork, and it is the whole point of being able to go back.
   */
  play(uci: string, options: PlayOptions = {}): Ply {
    const from = this.fen;
    const ply: Ply = {
      uci,
      san: sanOf(from, uci),
      fen: fenAfter(from, uci),
      by: turnOf(from),
      deliberateError: options.deliberateError ?? false,
    };
    this.#plies = [...this.#plies.slice(0, this.#cursor), ply];
    this.#cursor = this.#plies.length;
    return ply;
  }

  /**
   * Discard everything after the position being looked at, making it the end of
   * the game, so play can continue from here without playing a move first.
   */
  truncate(): void {
    this.#plies = this.#plies.slice(0, this.#cursor);
  }

  /** Move the viewpoint, clamped to the moves that exist. */
  goTo(index: number): void {
    this.#cursor = Math.max(0, Math.min(index, this.#plies.length));
  }

  back(): void {
    this.goTo(this.#cursor - 1);
  }

  forward(): void {
    this.goTo(this.#cursor + 1);
  }

  first(): void {
    this.goTo(0);
  }

  last(): void {
    this.goTo(this.#plies.length);
  }
}
