/**
 * Thin UCI wrapper around the Stockfish WASM worker.
 *
 * One engine can only think about one position at a time, so every search is
 * queued rather than raced.
 */

import { type PvLine, collectLines } from './uci.ts';

export { MATE_CP, type PvLine } from './uci.ts';

export interface AnalyseOptions {
  readonly multiPV?: number;
  /**
   * Fixed node budget. Far more reproducible than a time budget, which makes
   * the same position score differently depending on what else the phone is
   * doing -- and inconsistent scores mean false accusations.
   */
  readonly nodes?: number;
  readonly depth?: number;
}

/** How long to wait for the engine to answer before giving up on a search. */
const TIMEOUT_MS = 60_000;

/** Thrown by searches abandoned through `abort`. Not a failure: a change of mind. */
export class Cancelled extends Error {
  constructor() {
    super('search cancelled');
    this.name = 'Cancelled';
  }
}

export const isCancelled = (error: unknown): boolean =>
  error instanceof Cancelled || (error instanceof Error && error.name === 'Cancelled');

export class Engine {
  readonly #worker: Worker;
  readonly #listeners = new Set<(line: string) => void>();
  #queue: Promise<unknown> = Promise.resolve();
  #multiPV = 1;
  /**
   * Bumped by `abort`. Work started under an older generation throws `Cancelled`
   * instead of returning, so a caller that has moved on never acts on it.
   */
  #generation = 0;

  constructor(url: string) {
    this.#worker = new Worker(url);
    this.#worker.onmessage = (event: MessageEvent<unknown>) => {
      // The engine posts plain UCI text lines; anything else is not ours.
      if (typeof event.data !== 'string') return;
      for (const listener of [...this.#listeners]) listener(event.data);
    };
  }

  /** Boot the engine and wait until it can accept positions. */
  async init(): Promise<void> {
    await this.#collect('uci', line => line === 'uciok');
    await this.#ready();
  }

  async newGame(): Promise<void> {
    this.#send('ucinewgame');
    await this.#ready();
  }

  /**
   * Search `fen` and return the top lines, best first.
   *
   * Callers compare moves *within* one returned list rather than re-searching
   * child positions, so the scores are always mutually consistent.
   */
  analyse(fen: string, options: AnalyseOptions = {}): Promise<PvLine[]> {
    const multiPV = options.multiPV ?? 1;
    const generation = this.#generation;
    return this.#enqueue(async () => {
      // Queued behind a search that has since been abandoned.
      if (generation !== this.#generation) throw new Cancelled();
      if (multiPV !== this.#multiPV) {
        this.#send(`setoption name MultiPV value ${multiPV}`);
        this.#multiPV = multiPV;
        await this.#ready();
      }
      this.#send(`position fen ${fen}`);

      const go = options.depth ? `go depth ${options.depth}` : `go nodes ${options.nodes ?? 1e6}`;
      const output = await this.#collect(go, line => line.startsWith('bestmove'));
      // Aborting makes the engine answer early with whatever it has; that
      // half-finished answer must not be mistaken for a completed search.
      if (generation !== this.#generation) throw new Cancelled();
      return collectLines(output);
    });
  }

  /**
   * Abandon the running search and everything queued behind it.
   *
   * The engine answers a `stop` promptly, so the in-flight search settles on its
   * own; marking the generation is what stops its result being used.
   */
  abort(): void {
    this.#generation++;
    this.#send('stop');
  }

  destroy(): void {
    this.#send('quit');
    this.#worker.terminate();
  }

  #send(command: string): void {
    this.#worker.postMessage(command);
  }

  #ready(): Promise<string[]> {
    return this.#collect('isready', line => line === 'readyok');
  }

  /** Send `command` and gather output lines until `done` matches. */
  #collect(command: string, done: (line: string) => boolean): Promise<string[]> {
    const listeners = this.#listeners;
    return new Promise((resolve, reject) => {
      const output: string[] = [];
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`engine did not answer "${command}" within ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      // Declarations rather than consts: the two refer to each other, and
      // hoisting is what makes that safe rather than merely lucky.
      function finish(): void {
        clearTimeout(timer);
        listeners.delete(listener);
      }

      function listener(line: string): void {
        output.push(line);
        if (done(line)) {
          finish();
          resolve(output);
        }
      }

      listeners.add(listener);
      this.#send(command);
    });
  }

  /** Serialise searches; a UCI engine holds exactly one position at a time. */
  #enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(job, job);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
