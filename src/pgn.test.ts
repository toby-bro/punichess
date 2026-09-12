import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_FEN } from './chess.ts';
import { PgnImportError, fromPgn, pgnDate, toPgn } from './pgn.ts';
import { GameTree } from './tree.ts';

const opening = (): GameTree => {
  const tree = new GameTree();
  tree.play('e2e4');
  tree.play('e7e5');
  tree.play('g1f3');
  return tree;
};

const mainlineSans = (tree: GameTree): string[] =>
  tree.mainline.flatMap(node => (node.move ? [node.move.san] : []));

describe('toPgn', () => {
  it('writes the moves', () => {
    assert.match(toPgn(opening()), /1\. e4 e5 2\. Nf3/);
  });

  it('writes the headers it was given', () => {
    const pgn = toPgn(opening(), { white: 'Me', black: 'Bot', result: '1-0' });
    assert.match(pgn, /\[White "Me"\]/);
    assert.match(pgn, /\[Black "Bot"\]/);
    assert.match(pgn, /\[Result "1-0"\]/);
  });

  it('writes branches as variations', () => {
    const tree = opening();
    tree.first();
    tree.forward();
    tree.play('c7c5');
    assert.match(toPgn(tree), /\(\s*1\.\.\. c5\s*\)/);
  });

  it('does not claim a custom start for an ordinary game', () => {
    assert.doesNotMatch(toPgn(opening()), /SetUp|FEN/);
  });

  it('records a custom start when there is one', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const tree = new GameTree(fen);
    tree.play('e2e4');
    const pgn = toPgn(tree);
    assert.match(pgn, /\[SetUp "1"\]/);
    assert.match(pgn, new RegExp(`\\[FEN "${fen.replace(/\//g, '\\/')}"\\]`));
  });

  it('writes an empty game without falling over', () => {
    assert.ok(toPgn(new GameTree()).length > 0);
  });
});

describe('fromPgn', () => {
  it('reads a plain game', () => {
    const tree = fromPgn('1. e4 e5 2. Nf3 Nc6 *');
    assert.deepEqual(mainlineSans(tree), ['e4', 'e5', 'Nf3', 'Nc6']);
    assert.equal(tree.root.fen, INITIAL_FEN);
  });

  it('lands at the end of the mainline', () => {
    const tree = fromPgn('1. e4 e5 2. Nf3 *');
    assert.ok(tree.atLeaf);
    assert.equal(tree.lastMove?.san, 'Nf3');
  });

  it('reads variations as branches', () => {
    const tree = fromPgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *');
    const afterE4 = tree.mainline[1];
    assert.ok(afterE4);
    assert.equal(afterE4.children.length, 2);
    assert.deepEqual(
      afterE4.children.map(child => child.move?.san),
      ['e5', 'c5'],
    );
  });

  it('reads a game that starts from a position', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const tree = fromPgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 *`);
    assert.equal(tree.root.fen, fen);
    assert.deepEqual(mainlineSans(tree), ['e4']);
  });

  it('survives headers, comments and result markers', () => {
    const pgn = `[Event "Test"]\n[Result "1-0"]\n\n1. e4 {good} e5 2. Nf3 $1 Nc6 1-0`;
    assert.deepEqual(mainlineSans(fromPgn(pgn)), ['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('stops at an illegal move rather than losing the game', () => {
    const tree = fromPgn('1. e4 e5 2. Qh8 Nc6 *');
    assert.deepEqual(mainlineSans(tree), ['e4', 'e5']);
  });

  it('refuses input with no game in it', () => {
    assert.throws(() => fromPgn(''), PgnImportError);
    assert.throws(() => fromPgn('not a pgn at all'), PgnImportError);
  });

  it('refuses a start position that is not legal', () => {
    // Black is in check with White to move.
    const fen = '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1';
    assert.throws(() => fromPgn(`[FEN "${fen}"]\n\n1. Qe4 *`), PgnImportError);
  });
});

describe('round trip', () => {
  it('survives moves and variations intact', () => {
    const tree = opening();
    tree.first();
    tree.forward();
    tree.play('c7c5');
    tree.play('g1f3');

    const reread = fromPgn(toPgn(tree));
    assert.deepEqual(mainlineSans(reread), mainlineSans(tree));

    const afterE4 = reread.mainline[1];
    assert.deepEqual(
      afterE4?.children.map(child => child.move?.san),
      ['e5', 'c5'],
    );
  });

  it('survives castling and promotion', () => {
    const tree = new GameTree('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    tree.play('e1g1');
    tree.play('e8c8');
    const reread = fromPgn(toPgn(tree));
    assert.deepEqual(mainlineSans(reread), ['O-O', 'O-O-O']);
  });
});

describe('pgnDate', () => {
  it('writes the date the way PGN does', () => {
    assert.equal(pgnDate(new Date(2026, 8, 12)), '2026.09.12');
  });
});
