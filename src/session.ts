/**
 * The game you are in the middle of, kept across a reload.
 *
 * Separate from the library, and deliberately so: a game in progress is not
 * something you asked to save, and putting it in the list would fill that list
 * with every game you ever abandoned. This is one slot, overwritten on every
 * move, and it holds whatever was last on the board.
 *
 * It is the same shape a saved game has, so the same parser checks it and the
 * same code rebuilds the tree from it.
 */

import { type NewGame, type SavedGame, parseGame } from './library.ts';

const STORAGE_KEY = 'punichess.session';

/**
 * The id and timestamp a saved game would carry.
 *
 * Neither means anything here -- there is one slot and nothing to sort -- but
 * the stored shape wants them, and reusing that shape is what lets the library's
 * own parser vet this on the way back in.
 */
const SLOT = { id: 'session', saved: 0 };

/**
 * Write the game in progress.
 *
 * The analysis cache is by far the largest part of a game and by far the least
 * missed: without it a reopened game knows every move that was played and has to
 * search again to say what they were worth. So when the write does not fit, it
 * goes again without it rather than losing the game itself.
 */
export function keepSession(game: NewGame, storage: Storage = globalThis.localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...SLOT, ...game }));
  } catch {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...SLOT, ...game, cache: undefined }));
    } catch {
      // Storage is full or refused. A game that cannot be kept is not a reason
      // to stop playing it.
    }
  }
}

/** Whatever was in progress, or nothing if there was nothing usable. */
export function takeSession(storage: Storage = globalThis.localStorage): SavedGame | undefined {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored === null) return undefined;
    const game = parseGame(JSON.parse(stored));
    // A game with no moves in it is a new game, and restoring one gains nothing.
    return game && game.nodes.length > 0 ? game : undefined;
  } catch {
    return undefined;
  }
}

export function dropSession(storage: Storage = globalThis.localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do about it, and nothing that depends on it.
  }
}
