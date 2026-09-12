/**
 * PGN in and out, variations included.
 *
 * A game here is a tree, and PGN is the standard way to write a tree of chess
 * moves down, so the two map onto each other directly.
 */

import { ChildNode, Node, type PgnNodeData, makePgn, parsePgn } from 'chessops/pgn';

import { INITIAL_FEN, isLegal, uciOfSan } from './chess.ts';
import { GameTree, type TreeNode } from './tree.ts';

export interface PgnHeaders {
  readonly event: string;
  readonly white: string;
  readonly black: string;
  readonly result: string;
  readonly date: string;
}

const DEFAULT_HEADERS: PgnHeaders = {
  event: 'Punichess',
  white: 'White',
  black: 'Black',
  result: '*',
  date: '????.??.??',
};

/** Today as PGN writes it. */
export const pgnDate = (now: Date = new Date()): string =>
  [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('.');

/** Write the whole tree, with every branch as a PGN variation. */
export function toPgn(tree: GameTree, headers: Partial<PgnHeaders> = {}): string {
  const merged = { ...DEFAULT_HEADERS, ...headers };
  const head = new Map<string, string>([
    ['Event', merged.event],
    ['Site', '-'],
    ['Date', merged.date],
    ['Round', '-'],
    ['White', merged.white],
    ['Black', merged.black],
    ['Result', merged.result],
  ]);
  // Only claim a custom start when there is one, so ordinary games stay plain.
  if (tree.root.fen !== INITIAL_FEN) {
    head.set('SetUp', '1');
    head.set('FEN', tree.root.fen);
  }

  const root = new Node<PgnNodeData>();
  copyInto(tree.root, root);
  return makePgn({ headers: head, moves: root });
}

function copyInto(from: TreeNode, into: Node<PgnNodeData>): void {
  for (const child of from.children) {
    if (!child.move) continue;
    const node = new ChildNode<PgnNodeData>({ san: child.move.san });
    into.children.push(node);
    copyInto(child, node);
  }
}

export class PgnImportError extends Error {}

/**
 * Read a PGN into a tree, keeping its variations.
 *
 * Moves that are not legal in the position they appear in are skipped along
 * with everything after them: a PGN is only as trustworthy as whoever wrote it,
 * and losing one branch beats refusing the whole game.
 */
export function fromPgn(text: string): GameTree {
  const [game] = parsePgn(text);
  if (!game) throw new PgnImportError('No game found in that PGN.');

  const start = game.headers.get('FEN') ?? INITIAL_FEN;
  if (!isLegal(start))
    throw new PgnImportError('That PGN starts from a position that is not legal.');

  const tree = new GameTree(start);
  readInto(tree, game.moves, tree.root.id);

  if (tree.root.children.length === 0) throw new PgnImportError('That PGN contains no moves.');

  tree.first();
  tree.last();
  return tree;
}

function readInto(tree: GameTree, from: Node<PgnNodeData>, atId: number): void {
  for (const child of from.children) {
    tree.goTo(atId);
    const uci = uciOfSan(tree.fen, child.data.san);
    if (!uci) continue;
    const node = tree.play(uci);
    readInto(tree, child, node.id);
  }
}
