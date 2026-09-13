import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GameLibrary, type NewGame, restoreTree, serialiseTree } from './library.ts';
import type { Mistake } from './memory.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import { GameTree } from './tree.ts';

const fakeStorage = (initial: Record<string, string> = {}): Storage => {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
};

/** 1. e4 e5 2. Nf3, with 1... c5 as a variation. */
const branched = (): GameTree => {
  const tree = new GameTree();
  tree.play('e2e4');
  tree.play('e7e5');
  tree.play('g1f3');
  tree.first();
  tree.forward();
  tree.play('c7c5');
  return tree;
};

const gameFrom = (tree: GameTree, evals = new Map<number, number>()): NewGame => ({
  name: 'Test game',
  playedAs: 'white',
  settings: DEFAULT_SETTINGS,
  metrics: { moves: 4, youAcpl: 30, botAcpl: 45, spotted: 1, missed: 2, made: 3 },
  start: tree.root.fen,
  nodes: serialiseTree(tree, node => {
    const cp = evals.get(node.id);
    return cp === undefined ? undefined : { cp };
  }),
});

const sansOf = (tree: GameTree): string[] =>
  tree.mainline.flatMap(node => (node.move ? [node.move.san] : []));

describe('serialise and restore', () => {
  it('brings a branched game back whole', () => {
    const original = branched();
    const restored = restoreTree({ ...gameFrom(original), id: 'x', saved: 0 });
    assert.deepEqual(sansOf(restored.tree), sansOf(original));

    const afterE4 = restored.tree.mainline[1];
    assert.ok(afterE4);
    assert.deepEqual(
      afterE4.children.map(child => child.move?.san),
      ['e5', 'c5'],
      'the variation survives too',
    );
  });

  it('keeps the marks that matter', () => {
    const tree = new GameTree();
    tree.play('e2e4');
    tree.play('e7e5', { deliberateError: true });
    tree.markPlayedAnyway();

    const restored = restoreTree({ ...gameFrom(tree), id: 'x', saved: 0 });
    const second = restored.tree.mainline[2];
    assert.ok(second?.move);
    assert.equal(second.move.deliberateError, true);
    assert.equal(second.move.playedAnyway, true);
  });

  it('brings the evaluations back, keyed to the rebuilt nodes', () => {
    const tree = branched();
    const [, afterE4] = tree.mainline;
    assert.ok(afterE4);
    const restored = restoreTree({
      ...gameFrom(tree, new Map([[afterE4.id, 42]])),
      id: 'x',
      saved: 0,
    });
    const rebuilt = restored.tree.mainline[1];
    assert.ok(rebuilt);
    assert.equal(restored.evals.get(rebuilt.id)?.cp, 42);
  });

  it('starts from a stored position', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const tree = new GameTree(fen);
    tree.play('e2e4');
    const restored = restoreTree({ ...gameFrom(tree), id: 'x', saved: 0 });
    assert.equal(restored.tree.root.fen, fen);
    assert.deepEqual(sansOf(restored.tree), ['e4']);
  });

  it('drops a branch it cannot replay and keeps the rest', () => {
    const tree = branched();
    const game = { ...gameFrom(tree), id: 'x', saved: 0 };
    const damaged = {
      ...game,
      nodes: game.nodes.map(node => (node.uci === 'e7e5' ? { ...node, uci: 'e7e9' } : node)),
    };
    const restored = restoreTree(damaged);
    assert.deepEqual(sansOf(restored.tree), ['e4', 'c5'], 'the good branch is still there');
  });
});

describe('GameLibrary', () => {
  it('starts empty', () => {
    assert.equal(new GameLibrary(fakeStorage()).size, 0);
  });

  it('saves a game and hands back what it stored', () => {
    const library = new GameLibrary(fakeStorage());
    const saved = library.save(gameFrom(branched()), 1_700_000_000_000);
    assert.equal(saved.name, 'Test game');
    assert.equal(saved.saved, 1_700_000_000_000);
    assert.ok(saved.id.length > 0);
    assert.equal(library.find(saved.id)?.metrics.missed, 2);
  });

  it('lists the newest first', () => {
    const library = new GameLibrary(fakeStorage());
    library.save({ ...gameFrom(branched()), name: 'older' }, 1000);
    library.save({ ...gameFrom(branched()), name: 'newer' }, 2000);
    assert.deepEqual(
      library.games.map(game => game.name),
      ['newer', 'older'],
    );
  });

  it('renames, ignoring a name that says nothing', () => {
    const library = new GameLibrary(fakeStorage());
    const saved = library.save(gameFrom(branched()));
    library.rename(saved.id, '  Sicilian mess  ');
    assert.equal(library.find(saved.id)?.name, 'Sicilian mess');
    library.rename(saved.id, '   ');
    assert.equal(library.find(saved.id)?.name, 'Sicilian mess');
  });

  it('removes one, and all', () => {
    const library = new GameLibrary(fakeStorage());
    const first = library.save({ ...gameFrom(branched()), name: 'a' });
    library.save({ ...gameFrom(branched()), name: 'b' });
    library.remove(first.id);
    assert.equal(library.size, 1);
    library.clear();
    assert.equal(library.size, 0);
  });

  it('drops the oldest once full', () => {
    const library = new GameLibrary(fakeStorage(), 2);
    library.save({ ...gameFrom(branched()), name: 'a' }, 1);
    library.save({ ...gameFrom(branched()), name: 'b' }, 2);
    library.save({ ...gameFrom(branched()), name: 'c' }, 3);
    assert.deepEqual(
      library.games.map(game => game.name),
      ['c', 'b'],
    );
  });

  describe('persistence', () => {
    it('survives being reopened', () => {
      const storage = fakeStorage();
      const saved = new GameLibrary(storage).save({ ...gameFrom(branched()), name: 'kept' });

      const reopened = new GameLibrary(storage);
      assert.equal(reopened.size, 1);
      const found = reopened.find(saved.id);
      assert.equal(found?.name, 'kept');
      assert.deepEqual(sansOf(restoreTree(found).tree), ['e4', 'e5', 'Nf3']);
    });

    it('starts empty rather than failing on corrupt storage', () => {
      assert.equal(new GameLibrary(fakeStorage({ 'punichess.games': '{not json' })).size, 0);
    });

    it('drops entries that are not usable, keeping the rest', () => {
      const storage = fakeStorage();
      const library = new GameLibrary(storage);
      const good = library.save({ ...gameFrom(branched()), name: 'good' });

      const raw = JSON.parse(storage.getItem('punichess.games') ?? '[]') as unknown[];
      storage.setItem(
        'punichess.games',
        JSON.stringify([{ id: 'broken' }, 42, null, ...raw, { nodes: [] }]),
      );

      const reopened = new GameLibrary(storage);
      assert.equal(reopened.size, 1);
      assert.equal(reopened.find(good.id)?.name, 'good');
    });

    it('sheds older games rather than losing the one just played', () => {
      let allow = 400;
      const storage: Storage = {
        length: 0,
        clear: () => undefined,
        getItem: () => null,
        key: () => null,
        removeItem: () => undefined,
        // Stand in for a quota: anything long is refused.
        setItem: (_key, value) => {
          if (value.length > allow) throw new Error('quota');
        },
      };
      const library = new GameLibrary(storage, 10);
      for (let i = 0; i < 6; i++) library.save({ ...gameFrom(branched()), name: `g${i}` }, i);
      allow = Number.POSITIVE_INFINITY;
      assert.ok(library.size < 6, 'it gave ground');
      assert.equal(library.games[0]?.name, 'g5', 'and kept the newest');
    });
  });
});

describe('favourites', () => {
  const library = (capacity: number): GameLibrary => new GameLibrary(fakeStorage(), capacity);

  it('marks and unmarks a game', () => {
    const shelf = library(10);
    const saved = shelf.save(gameFrom(branched()));
    assert.equal(shelf.find(saved.id)?.favourite, undefined);

    shelf.setFavourite(saved.id, true);
    assert.equal(shelf.find(saved.id)?.favourite, true);

    shelf.setFavourite(saved.id, false);
    assert.equal(shelf.find(saved.id)?.favourite, false);
  });

  it('purges an ordinary game before a favourite, however old', () => {
    const shelf = library(2);
    const keeper = shelf.save({ ...gameFrom(branched()), name: 'keeper' }, 1);
    shelf.setFavourite(keeper.id, true);
    shelf.save({ ...gameFrom(branched()), name: 'b' }, 2);
    shelf.save({ ...gameFrom(branched()), name: 'c' }, 3);

    assert.deepEqual(
      shelf.games.map(game => game.name),
      ['c', 'keeper'],
      'the oldest survived because it was kept',
    );
  });

  it('still lists the newest first, favourite or not', () => {
    const shelf = library(10);
    const old = shelf.save({ ...gameFrom(branched()), name: 'old' }, 1);
    shelf.setFavourite(old.id, true);
    shelf.save({ ...gameFrom(branched()), name: 'new' }, 2);
    assert.deepEqual(
      shelf.games.map(game => game.name),
      ['new', 'old'],
    );
  });

  it('gives up a favourite only when there is nothing else left', () => {
    const shelf = library(2);
    const first = shelf.save({ ...gameFrom(branched()), name: 'a' }, 1);
    const second = shelf.save({ ...gameFrom(branched()), name: 'b' }, 2);
    shelf.setFavourite(first.id, true);
    shelf.setFavourite(second.id, true);
    shelf.save({ ...gameFrom(branched()), name: 'c' }, 3);

    assert.equal(shelf.size, 2);
    assert.deepEqual(
      shelf.games.map(game => game.name),
      ['c', 'b'],
      'the oldest favourite went, since everything was a favourite',
    );
  });

  it('survives being reopened', () => {
    const storage = fakeStorage();
    const shelf = new GameLibrary(storage);
    const saved = shelf.save(gameFrom(branched()));
    shelf.setFavourite(saved.id, true);
    assert.equal(new GameLibrary(storage).find(saved.id)?.favourite, true);
  });

  it('sheds ordinary games first when storage runs out', () => {
    let allow = 400;
    const storage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: (_key, value) => {
        if (value.length > allow) throw new Error('quota');
      },
    };
    const shelf = new GameLibrary(storage, 10);
    const keeper = shelf.save({ ...gameFrom(branched()), name: 'keeper' }, 1);
    shelf.setFavourite(keeper.id, true);
    for (let i = 0; i < 5; i++) shelf.save({ ...gameFrom(branched()), name: `g${i}` }, i + 2);
    allow = Number.POSITIVE_INFINITY;

    assert.ok(
      shelf.games.some(game => game.name === 'keeper'),
      'the kept game outlasted the ordinary ones',
    );
  });

  it('keeps the whole list when storage is simply unavailable', () => {
    const deny = (): never => {
      throw new Error('denied');
    };
    const storage: Storage = {
      length: 0,
      clear: deny,
      getItem: deny,
      key: deny,
      removeItem: deny,
      setItem: deny,
    };
    const shelf = new GameLibrary(storage, 10);
    for (let i = 0; i < 4; i++) shelf.save({ ...gameFrom(branched()), name: `g${i}` }, i);
    assert.equal(shelf.size, 4, 'shedding games cannot fix a storage that never works');
  });
});

describe('a game carries its own mistakes', () => {
  const mistake: Mistake = {
    uci: 'e2e4',
    san: 'e4',
    cpLoss: 150,
    missesMate: false,
    hangsMate: false,
    stalemate: false,
    times: 1,
    last: 0,
  };

  it('stores and returns them', () => {
    const shelf = new GameLibrary(fakeStorage());
    const saved = shelf.save({
      ...gameFrom(branched()),
      mistakes: { 'some fen': [mistake] },
    });
    const found = shelf.find(saved.id);
    assert.ok(found?.mistakes);
    assert.equal(Object.keys(found.mistakes).length, 1);
  });

  it('survives being reopened', () => {
    const storage = fakeStorage();
    const saved = new GameLibrary(storage).save({
      ...gameFrom(branched()),
      mistakes: { 'some fen': [mistake] },
    });
    assert.ok(new GameLibrary(storage).find(saved.id)?.mistakes);
  });

  it('is simply absent on a game that had none', () => {
    const shelf = new GameLibrary(fakeStorage());
    const saved = shelf.save(gameFrom(branched()));
    assert.equal(shelf.find(saved.id)?.mistakes, undefined);
  });

  it('ignores a stored value that is not a record', () => {
    const storage = fakeStorage();
    const shelf = new GameLibrary(storage);
    const saved = shelf.save(gameFrom(branched()));
    const raw = JSON.parse(storage.getItem('punichess.games') ?? '[]') as Record<string, unknown>[];
    storage.setItem('punichess.games', JSON.stringify(raw.map(g => ({ ...g, mistakes: 'nope' }))));
    assert.equal(new GameLibrary(storage).find(saved.id)?.mistakes, undefined);
  });
});

describe('keeping a saved game up to date', () => {
  it('replaces the game and leaves the name alone', () => {
    const shelf = new GameLibrary(fakeStorage());
    const saved = shelf.save({ ...gameFrom(branched()), name: 'my game' });
    shelf.rename(saved.id, 'Sicilian mess');

    const longer = branched();
    // branched() leaves the cursor on the short side line, so go to the start
    // before running out along the main one.
    longer.first();
    longer.last();
    longer.play('b8c6');
    shelf.update(saved.id, { ...gameFrom(longer), name: 'ignored' });

    const found = shelf.find(saved.id);
    assert.ok(found);
    assert.equal(found.name, 'Sicilian mess', 'the name is yours, not the game’s');
    assert.equal(found.nodes.length, 5);
  });

  it('keeps a favourite a favourite', () => {
    const shelf = new GameLibrary(fakeStorage());
    const saved = shelf.save(gameFrom(branched()));
    shelf.setFavourite(saved.id, true);
    shelf.update(saved.id, gameFrom(branched()));
    assert.equal(shelf.find(saved.id)?.favourite, true);
  });

  it('moves the game it touched to the front', () => {
    const shelf = new GameLibrary(fakeStorage());
    const first = shelf.save({ ...gameFrom(branched()), name: 'a' }, 1);
    shelf.save({ ...gameFrom(branched()), name: 'b' }, 2);
    shelf.update(first.id, gameFrom(branched()), 3);
    assert.deepEqual(
      shelf.games.map(game => game.name),
      ['a', 'b'],
      'the one being played is never the one purged to make room',
    );
  });

  it('adds nothing for an id it does not know', () => {
    const shelf = new GameLibrary(fakeStorage());
    assert.equal(shelf.update('nope', gameFrom(branched())), undefined);
    assert.equal(shelf.size, 0);
  });

  it('survives being reopened', () => {
    const storage = fakeStorage();
    const shelf = new GameLibrary(storage);
    const saved = shelf.save(gameFrom(branched()));
    const longer = branched();
    // branched() leaves the cursor on the short side line, so go to the start
    // before running out along the main one.
    longer.first();
    longer.last();
    longer.play('b8c6');
    shelf.update(saved.id, gameFrom(longer));
    assert.equal(new GameLibrary(storage).find(saved.id)?.nodes.length, 5);
  });
});

describe('clearing the stored analysis', () => {
  const withCache = (name: string): NewGame => ({
    ...gameFrom(branched()),
    name,
    cache: { 'some fen': { nodes: 350_000, multiPV: 8, lines: [] } },
  });

  it('strips it from every saved game at once', () => {
    const shelf = new GameLibrary(fakeStorage());
    shelf.save(withCache('a'));
    shelf.save(withCache('b'));
    shelf.save(withCache('c'));

    shelf.clearAnalysis();
    assert.ok(
      shelf.games.every(game => game.cache === undefined),
      'all of them, not one',
    );
  });

  it('keeps the games themselves, and everything else about them', () => {
    const shelf = new GameLibrary(fakeStorage());
    const saved = shelf.save({
      ...withCache('keeper'),
      mistakes: { 'some fen': [] },
    });
    shelf.setFavourite(saved.id, true);
    shelf.clearAnalysis();

    const found = shelf.find(saved.id);
    assert.ok(found);
    assert.equal(found.name, 'keeper');
    assert.equal(found.favourite, true);
    assert.equal(found.nodes.length, 4, 'the moves are the game; the analysis is not');
    assert.equal(found.metrics.missed, 2);
  });

  it('sticks, so the space is actually given back', () => {
    const storage = fakeStorage();
    const shelf = new GameLibrary(storage);
    shelf.save(withCache('a'));
    shelf.clearAnalysis();
    assert.equal(new GameLibrary(storage).games[0]?.cache, undefined);
  });

  it('does nothing embarrassing on an empty shelf', () => {
    const shelf = new GameLibrary(fakeStorage());
    assert.doesNotThrow(() => {
      shelf.clearAnalysis();
    });
  });
});

describe('punishing survives a save', () => {
  it('comes back on the branch it was switched on at', () => {
    const tree = branched();
    tree.first();
    tree.forward();
    tree.forward();
    tree.startPunishing();

    const restored = restoreTree({ ...gameFrom(tree), id: 'x', saved: 0 });
    restored.tree.first();
    restored.tree.last();
    assert.equal(restored.tree.punishing, true);

    restored.tree.first();
    restored.tree.forward();
    assert.equal(restored.tree.punishing, false, 'and only on that branch');
  });

  it('is absent when it was never switched on', () => {
    const restored = restoreTree({ ...gameFrom(branched()), id: 'x', saved: 0 });
    restored.tree.last();
    assert.equal(restored.tree.punishing, false);
  });
});
