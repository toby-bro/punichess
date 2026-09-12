import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN, turnOf } from './chess.ts';
import { GameTree } from './tree.ts';

const opening = (): GameTree => {
  const tree = new GameTree();
  tree.play('e2e4');
  tree.play('e7e5');
  tree.play('g1f3');
  return tree;
};

const sans = (tree: GameTree): string[] => tree.moves.map(move => move.san);

describe('GameTree', () => {
  it('starts at the initial position with nothing played', () => {
    const tree = new GameTree();
    assert.equal(tree.fen, INITIAL_FEN);
    assert.equal(tree.current, tree.root);
    assert.ok(tree.atStart);
    assert.ok(tree.atLeaf);
    assert.equal(tree.lastMove, undefined);
  });

  it('records moves with SAN, mover and resulting position', () => {
    const tree = new GameTree();
    const node = tree.play('e2e4');
    assert.ok(node.move);
    assert.equal(node.move.san, 'e4');
    assert.equal(node.move.by, 'white');
    assert.equal(node.ply, 1);
    assert.equal(turnOf(node.fen), 'black');
  });

  it('rejects an illegal move without changing anything', () => {
    const tree = opening();
    const before = tree.fen;
    assert.throws(() => tree.play('e2e9'));
    assert.equal(tree.fen, before);
    assert.deepEqual(sans(tree), ['e4', 'e5', 'Nf3']);
  });

  describe('navigation', () => {
    it('steps backwards and forwards', () => {
      const tree = opening();
      tree.back();
      assert.deepEqual(sans(tree), ['e4', 'e5']);
      assert.ok(!tree.atLeaf);
      tree.forward();
      assert.deepEqual(sans(tree), ['e4', 'e5', 'Nf3']);
      assert.ok(tree.atLeaf);
    });

    it('jumps to either end of the branch', () => {
      const tree = opening();
      tree.first();
      assert.ok(tree.atStart);
      tree.last();
      assert.deepEqual(sans(tree), ['e4', 'e5', 'Nf3']);
    });

    it('stays put rather than running off either end', () => {
      const tree = opening();
      for (let i = 0; i < 10; i++) tree.back();
      assert.ok(tree.atStart);
      for (let i = 0; i < 10; i++) tree.forward();
      assert.deepEqual(sans(tree), ['e4', 'e5', 'Nf3']);
    });

    it('ignores an unknown node id', () => {
      const tree = opening();
      tree.goTo(9999);
      assert.deepEqual(sans(tree), ['e4', 'e5', 'Nf3']);
    });

    it('jumps straight to any node by id', () => {
      const tree = opening();
      const [, afterE4] = tree.mainline;
      assert.ok(afterE4);
      tree.goTo(afterE4.id);
      assert.deepEqual(sans(tree), ['e4']);
    });
  });

  describe('branching', () => {
    it('keeps the old line when you play something else', () => {
      const tree = opening();
      tree.first();
      tree.forward(); // after 1. e4
      tree.play('c7c5');

      assert.deepEqual(sans(tree), ['e4', 'c5']);
      const [, afterE4] = tree.mainline;
      assert.ok(afterE4);
      assert.equal(afterE4.children.length, 2, 'both replies are kept');
      assert.deepEqual(
        afterE4.children.map(child => child.move?.san),
        ['e5', 'c5'],
      );
    });

    it('follows an existing branch instead of duplicating it', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('e7e5');
      const [, afterE4] = tree.mainline;
      assert.equal(afterE4?.children.length, 1, 'replaying the same move adds nothing');
      assert.deepEqual(sans(tree), ['e4', 'e5']);
    });

    it('branches at the very start too', () => {
      const tree = opening();
      tree.first();
      tree.play('d2d4');
      assert.deepEqual(sans(tree), ['d4']);
      assert.equal(tree.root.children.length, 2);
    });

    it('follows the longest line, not the one played first', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5'); // a one-move sideline against a two-move main line
      assert.deepEqual(
        tree.mainline.flatMap(node => (node.move ? [node.move.san] : [])),
        ['e4', 'e5', 'Nf3'],
        'a short experiment must not take over the arrow keys',
      );
    });

    it('hands the main line over once the branch outgrows it', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5');
      tree.play('g1f3');
      tree.play('d7d6'); // now three moves against the original two
      assert.deepEqual(
        tree.mainline.flatMap(node => (node.move ? [node.move.san] : [])),
        ['e4', 'c5', 'Nf3', 'd6'],
      );
    });

    it('keeps the earlier branch on a tie', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5');
      tree.play('g1f3'); // equal length to e5 Nf3
      assert.deepEqual(
        tree.mainline.flatMap(node => (node.move ? [node.move.san] : [])),
        ['e4', 'e5', 'Nf3'],
      );
    });

    it('promote settles a tie in favour of the current branch', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5');
      tree.play('g1f3');
      tree.promote();
      assert.deepEqual(
        tree.mainline.flatMap(node => (node.move ? [node.move.san] : [])),
        ['e4', 'c5', 'Nf3'],
      );
    });

    it('steps forward along the longest line', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5');
      tree.goTo(tree.mainline[1]?.id ?? 0);
      tree.forward();
      assert.equal(tree.lastMove?.san, 'e5', 'the longer continuation wins');
    });

    it('runs to the end of the longest line', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      tree.play('c7c5');
      tree.first();
      tree.last();
      assert.equal(tree.lastMove?.san, 'Nf3');
    });
  });

  describe('removing', () => {
    it('discards a branch and everything under it', () => {
      const tree = opening();
      tree.first();
      tree.forward();
      const sideline = tree.play('c7c5');
      tree.play('g1f3');

      tree.remove(sideline.id);
      const [, afterE4] = tree.mainline;
      assert.equal(afterE4?.children.length, 1);
      assert.deepEqual(sans(tree), ['e4'], 'the viewpoint falls back to the parent');
      assert.equal(tree.node(sideline.id), undefined);
    });

    it('refuses to remove the root', () => {
      const tree = opening();
      tree.remove(tree.root.id);
      assert.equal(tree.node(0), tree.root);
    });
  });

  describe('punishArmed', () => {
    it('is off during ordinary play', () => {
      assert.equal(opening().punishArmed, false);
    });

    it('arms only the reply to a deliberate error', () => {
      const tree = new GameTree();
      tree.play('e2e4');
      tree.play('e7e5', { deliberateError: true });
      assert.equal(tree.punishArmed, true);
      tree.play('g1f3');
      assert.equal(tree.punishArmed, false);
    });

    it('re-arms when you navigate back to the position', () => {
      const tree = new GameTree();
      tree.play('e2e4');
      tree.play('e7e5', { deliberateError: true });
      tree.play('g1f3');
      tree.back();
      assert.equal(tree.punishArmed, true);
    });
  });
});

describe('scoping a mode to a branch', () => {
  it('knows whether a node sits below another', () => {
    const tree = opening();
    const [, afterE4, afterE5] = tree.mainline;
    assert.ok(afterE4 && afterE5);
    assert.equal(tree.isWithin(afterE5.id, afterE4.id), true);
    assert.equal(tree.isWithin(afterE4.id, afterE5.id), false, 'a parent is not below its child');
    assert.equal(tree.isWithin(afterE4.id, afterE4.id), true, 'a node is within itself');
    assert.equal(tree.isWithin(afterE4.id, tree.root.id), true);
  });

  it('says a sibling branch is outside', () => {
    const tree = opening();
    tree.first();
    tree.forward();
    const sideline = tree.play('c7c5');
    const [, , afterE5] = tree.mainline;
    assert.ok(afterE5);
    assert.equal(tree.isWithin(sideline.id, afterE5.id), false);
  });
});

describe('marking a move you were warned about', () => {
  it('is off by default', () => {
    assert.equal(opening().lastMove?.playedAnyway, false);
  });

  it('marks the move currently in view', () => {
    const tree = opening();
    tree.markPlayedAnyway();
    const marked = tree.lastMove;
    assert.ok(marked);
    assert.equal(marked.playedAnyway, true);
    tree.back();
    const earlier = tree.lastMove;
    assert.ok(earlier);
    assert.equal(earlier.playedAnyway, false, 'only that move is marked');
  });

  it('does nothing at the root', () => {
    const tree = new GameTree();
    assert.doesNotThrow(() => {
      tree.markPlayedAnyway();
    });
  });
});

describe('longest-branch navigation at scale', () => {
  it('stays correct through several nested forks', () => {
    const tree = new GameTree();
    // Main line: 1. e4 e5 2. Nf3 Nc6 3. Bb5
    for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']) tree.play(uci);

    // A short branch at move 2, and a longer one at move 1.
    tree.goTo(tree.mainline[3]?.id ?? 0); // after 2. Nf3
    tree.play('g8f6');

    tree.goTo(tree.mainline[1]?.id ?? 0); // after 1. e4
    for (const uci of ['c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4']) tree.play(uci);

    tree.first();
    tree.last();
    assert.deepEqual(
      tree.mainline.flatMap(node => (node.move ? [node.move.san] : [])),
      ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'],
      'the Sicilian branch is now the longest, so it leads',
    );
  });

  it('does not fall over on a long game', () => {
    const tree = new GameTree();
    // A legal shuffle that can repeat indefinitely.
    const loop = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (let i = 0; i < 200; i++) tree.play(loop[i % loop.length] ?? 'g1f3');
    tree.first();
    assert.doesNotThrow(() => {
      tree.last();
    });
    assert.equal(tree.mainline.length, 201, 'root plus every ply');
  });
});
