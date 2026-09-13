/**
 * Saved games.
 *
 * A game is stored as its whole tree, every variation included, with the
 * evaluation of each position alongside. That is what makes a reopened game
 * usable rather than merely readable: the graph, the per-move costs and the
 * review all come back without the engine running again.
 *
 * The result is not kept -- won or lost is a fact about one line, and every line
 * is here.
 */

import type { StoredCache } from './cache.ts';
import { INITIAL_FEN } from './chess.ts';
import type { StoredMistakes } from './memory.ts';
import type { Settings } from './settings.ts';
import { GameTree, type TreeNode } from './tree.ts';

const STORAGE_KEY = 'punichess.games';

/** Enough to keep two games saved in the same millisecond apart. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Games kept before the oldest is dropped. */
const DEFAULT_CAPACITY = 40;

export interface SavedEval {
  /** Centipawns, from the point of view of the side to move. */
  readonly cp: number;
  readonly mate?: number | undefined;
}

export interface SavedNode {
  readonly id: number;
  /** The node this move was played from. The root is 0. */
  readonly parent: number;
  readonly uci: string;
  readonly deliberateError?: boolean;
  readonly playedAnyway?: boolean;
  /** Punishment was switched on here. */
  readonly punished?: boolean;
  /** The evaluation of the position this move reaches. */
  readonly eval?: SavedEval | undefined;
}

export interface GameMetrics {
  readonly moves: number;
  readonly youAcpl: number;
  readonly botAcpl: number;
  readonly spotted: number;
  readonly missed: number;
  readonly made: number;
}

export interface SavedGame {
  readonly id: string;
  readonly name: string;
  readonly saved: number;
  /** Kept back from any purge for as long as there is anything else to drop. */
  readonly favourite?: boolean;
  /** The colour you had. */
  readonly playedAs: 'white' | 'black';
  /** What the bot was set to at the time. */
  readonly settings: Settings;
  readonly metrics: GameMetrics;
  readonly start: string;
  readonly rootEval?: SavedEval | undefined;
  readonly nodes: readonly SavedNode[];
  /**
   * What you got wrong in this game, by position.
   *
   * Part of the game rather than a store of its own, so reopening one brings
   * back what you tried in it and nothing from anywhere else.
   */
  readonly mistakes?: StoredMistakes | undefined;
  /**
   * Everything the engine worked out while the game was played.
   *
   * By far the largest part of a saved game, and the reason reopening one costs
   * nothing: the review, the arrows and the graph all come back without a single
   * search. `clearAnalysis` gives the space back when it is wanted elsewhere.
   */
  readonly cache?: StoredCache | undefined;
}

export type NewGame = Omit<SavedGame, 'id' | 'saved'>;

/** Flatten a tree for storage, asking `evalOf` what each position was worth. */
export function serialiseTree(
  tree: GameTree,
  evalOf: (node: TreeNode) => SavedEval | undefined,
): SavedNode[] {
  return (
    tree.nodes
      .filter((node): node is TreeNode & { move: NonNullable<TreeNode['move']> } => !!node.move)
      // Parents before children, so restoring can replay in one pass.
      .sort((a, b) => a.ply - b.ply || a.id - b.id)
      .map(node => {
        const saved: SavedNode = {
          id: node.id,
          parent: node.parent?.id ?? 0,
          uci: node.move.uci,
          ...(node.move.deliberateError ? { deliberateError: true } : {}),
          ...(node.move.playedAnyway ? { playedAnyway: true } : {}),
          ...(node.move.punished ? { punished: true } : {}),
          ...(evalOf(node) ? { eval: evalOf(node) } : {}),
        };
        return saved;
      })
  );
}

export interface RestoredGame {
  readonly tree: GameTree;
  /** Evaluations by the id of the node in the *restored* tree. */
  readonly evals: Map<number, SavedEval>;
}

/**
 * Rebuild a tree from storage.
 *
 * Node ids are reassigned on replay, so stored ids are mapped to new ones as we
 * go. A move that will not play -- a corrupted file, a rule change -- is skipped
 * along with everything below it, rather than losing the whole game.
 */
export function restoreTree(game: SavedGame): RestoredGame {
  const tree = new GameTree(game.start);
  const idMap = new Map<number, number>([[0, tree.root.id]]);
  const evals = new Map<number, SavedEval>();

  for (const saved of game.nodes) {
    const parentId = idMap.get(saved.parent);
    if (parentId === undefined) continue; // its parent was skipped
    tree.goTo(parentId);
    try {
      const node = tree.play(saved.uci, {
        deliberateError: saved.deliberateError === true,
        playedAnyway: saved.playedAnyway === true,
      });
      if (saved.punished === true && node.move) node.move.punished = true;
      idMap.set(saved.id, node.id);
      if (saved.eval) evals.set(node.id, saved.eval);
    } catch {
      // Unplayable here; this branch stops, the rest of the game survives.
    }
  }

  tree.first();
  tree.last();
  return { tree, evals };
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseEval(raw: unknown): SavedEval | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (!isFiniteNumber(value['cp'])) return undefined;
  return { cp: value['cp'], mate: isFiniteNumber(value['mate']) ? value['mate'] : undefined };
}

function parseNode(raw: unknown): SavedNode | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const { id, parent, uci } = value;
  if (!isFiniteNumber(id) || !isFiniteNumber(parent)) return undefined;
  if (typeof uci !== 'string' || uci.length < 4) return undefined;

  return {
    id,
    parent,
    uci,
    ...(value['deliberateError'] === true ? { deliberateError: true } : {}),
    ...(value['playedAnyway'] === true ? { playedAnyway: true } : {}),
    ...(value['punished'] === true ? { punished: true } : {}),
    ...(parseEval(value['eval']) ? { eval: parseEval(value['eval']) } : {}),
  };
}

const ZERO_METRICS: GameMetrics = {
  moves: 0,
  youAcpl: 0,
  botAcpl: 0,
  spotted: 0,
  missed: 0,
  made: 0,
};

function parseMetrics(raw: unknown): GameMetrics {
  if (typeof raw !== 'object' || raw === null) return ZERO_METRICS;
  const value = raw as Record<string, unknown>;
  const read = (key: keyof GameMetrics): number =>
    isFiniteNumber(value[key]) ? Math.max(0, Math.round(value[key])) : 0;
  return {
    moves: read('moves'),
    youAcpl: read('youAcpl'),
    botAcpl: read('botAcpl'),
    spotted: read('spotted'),
    missed: read('missed'),
    made: read('made'),
  };
}

/**
 * Rebuild one saved game, or reject it.
 *
 * Settings are taken as they come and not validated here: they are a record of
 * what the bot was set to, not something about to be used.
 */
export function parseGame(raw: unknown): SavedGame | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const { id, name, start, nodes } = value;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (!Array.isArray(nodes)) return undefined;

  const parsed = nodes.map(parseNode).filter((node): node is SavedNode => !!node);
  if (parsed.length === 0) return undefined;

  return {
    id,
    name: typeof name === 'string' && name.trim().length > 0 ? name : 'Game',
    saved: isFiniteNumber(value['saved']) ? value['saved'] : 0,
    ...(value['favourite'] === true ? { favourite: true } : {}),
    playedAs: value['playedAs'] === 'black' ? 'black' : 'white',
    settings: (typeof value['settings'] === 'object' && value['settings'] !== null
      ? value['settings']
      : {}) as Settings,
    metrics: parseMetrics(value['metrics']),
    start: typeof start === 'string' && start.length > 0 ? start : INITIAL_FEN,
    rootEval: parseEval(value['rootEval']),
    nodes: parsed,
    // Checked when it is handed to the memory, which is what knows the shape.
    ...(typeof value['mistakes'] === 'object' && value['mistakes'] !== null
      ? { mistakes: value['mistakes'] as StoredMistakes }
      : {}),
    // Both are checked by whoever knows their shape, not here.
    ...(typeof value['cache'] === 'object' && value['cache'] !== null
      ? { cache: value['cache'] as StoredCache }
      : {}),
  };
}

export class GameLibrary {
  #games: SavedGame[] = [];
  readonly #storage: Storage | undefined;
  readonly #capacity: number;

  constructor(storage: Storage | undefined = globalThis.localStorage, capacity = DEFAULT_CAPACITY) {
    this.#storage = storage;
    this.#capacity = Math.max(1, capacity);
    this.#load();
  }

  /** Newest first. */
  get games(): readonly SavedGame[] {
    return this.#games;
  }

  get size(): number {
    return this.#games.length;
  }

  find(id: string): SavedGame | undefined {
    return this.#games.find(game => game.id === id);
  }

  save(game: NewGame, now = Date.now()): SavedGame {
    const stored: SavedGame = { ...game, id: `g${String(now)}-${randomSuffix()}`, saved: now };
    this.#games = [stored, ...this.#games];
    this.#trim(this.#capacity, stored.id);
    this.#write();
    return stored;
  }

  /** Mark a game as one to keep, or stop doing so. */
  setFavourite(id: string, favourite: boolean): void {
    this.#games = this.#games.map(game =>
      game.id === id
        ? { ...game, ...(favourite ? { favourite: true } : { favourite: false }) }
        : game,
    );
    this.#write();
  }

  /**
   * Bring a saved game up to date with how it is being played now.
   *
   * Keeps what is yours -- its name, and whether it is a favourite -- and
   * replaces what is the game's. Touching it moves it to the front, so the list
   * reads most recently played first and a game being played is never the one
   * purged to make room.
   */
  update(id: string, game: NewGame, now = Date.now()): SavedGame | undefined {
    const existing = this.#games.find(saved => saved.id === id);
    if (!existing) return undefined;

    const updated: SavedGame = {
      ...game,
      id: existing.id,
      name: existing.name,
      saved: now,
      ...(existing.favourite === true ? { favourite: true } : {}),
    };
    this.#games = [updated, ...this.#games.filter(saved => saved.id !== id)];
    this.#write();
    return updated;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    this.#games = this.#games.map(game => (game.id === id ? { ...game, name: trimmed } : game));
    this.#write();
  }

  remove(id: string): void {
    this.#games = this.#games.filter(game => game.id !== id);
    this.#write();
  }

  clear(): void {
    this.#games = [];
    this.#write();
  }

  /**
   * Drop the stored analysis from every game, keeping the games themselves.
   *
   * The analysis is most of the bulk. Giving it up costs a re-search the next
   * time a game is opened; giving up the games costs the games.
   */
  clearAnalysis(): void {
    this.#games = this.#games.map(({ cache: _cache, ...game }) => game);
    this.#write();
  }

  #load(): void {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.#games = parsed.map(parseGame).filter((game): game is SavedGame => !!game);
      this.#trim(this.#capacity);
    } catch {
      this.#games = [];
    }
  }

  /**
   * Keep the best `limit` games: the one just saved, then favourites, then the
   * most recent.
   *
   * `keepId` is not a nicety. Without it, saving a game into a full shelf of
   * favourites throws away the game being saved, so pressing save does nothing
   * at all -- which is the one outcome nobody would expect.
   *
   * Selection is by worth; the list itself stays in its own order, newest
   * first, favourite or not.
   */
  #trim(limit: number, keepId?: string): void {
    if (this.#games.length <= limit) return;
    const keeping = new Set(
      [...this.#games]
        // Stable, so recency still decides within each group.
        .sort((a, b) => {
          if (a.id === keepId) return -1;
          if (b.id === keepId) return 1;
          return Number(b.favourite ?? false) - Number(a.favourite ?? false);
        })
        .slice(0, limit),
    );
    this.#games = this.#games.filter(game => keeping.has(game));
  }

  #write(): void {
    if (this.#persist(this.#games)) return;

    // Out of room. Before giving anything up, check that storage works at all:
    // if it does not, shedding games would destroy the session's record to fix
    // a problem it cannot fix.
    if (!this.#persist([])) return;

    // Give up games one at a time, least loved and oldest first, until it fits.
    while (this.#games.length > 1) {
      const victim = this.#expendable();
      this.#games = this.#games.filter((_, index) => index !== victim);
      if (this.#persist(this.#games)) return;
    }
    this.#persist(this.#games);
  }

  /** The game to give up first: the oldest that is not a favourite. */
  #expendable(): number {
    for (let index = this.#games.length - 1; index >= 0; index--) {
      if (this.#games[index]?.favourite !== true) return index;
    }
    // All of them are favourites, so the oldest has to go after all.
    return this.#games.length - 1;
  }

  #persist(games: readonly SavedGame[]): boolean {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(games));
      return true;
    } catch {
      return false;
    }
  }
}
