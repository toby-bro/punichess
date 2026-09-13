/**
 * The move list, as a tree.
 *
 * The first continuation from each position runs inline; anything else played
 * from that position becomes an indented variation, so the shape of the list
 * is the shape of everything that was tried.
 */

import { scrollWithin } from './scroll.ts';
import type { GameTree, TreeNode } from './tree.ts';

export interface MovesView {
  render(): void;
}

export interface MovesOptions {
  readonly onSelect: (id: number) => void;
  /** Bot errors you have been shown, which are worth marking once known. */
  readonly revealed: ReadonlySet<number>;
}

export function mountMoves(root: HTMLElement, tree: GameTree, options: MovesOptions): MovesView {
  const view: MovesView = {
    render() {
      root.replaceChildren();
      writeLine(root, tree, tree.root, options, true);
      const current = root.querySelector('.current');
      // Scrolls the list, not the window: pressing an arrow key must not move
      // the board out from under you.
      if (current instanceof HTMLElement) scrollWithin(root, current);
    },
  };
  view.render();
  return view;
}

/**
 * Write the line starting at `from`.
 *
 * Iterative along the main continuation and recursive only into variations, so
 * a long game does not nest a stack frame per move.
 */
function writeLine(
  into: HTMLElement,
  tree: GameTree,
  from: TreeNode,
  options: MovesOptions,
  topLevel: boolean,
): void {
  let node = from;
  let first = true;
  while (node.children.length > 0) {
    // The longest line runs inline, matching where the arrow keys will go.
    const main = tree.mainChild(node);
    if (!main) break;
    const alternatives = node.children.filter(child => child !== main);

    into.append(moveElement(tree, main, options, first));
    first = false;

    for (const alternative of alternatives) {
      const block = document.createElement('div');
      block.className = 'variation';
      block.append(moveElement(tree, alternative, options, true));
      writeLine(block, tree, alternative, options, false);
      into.append(block);
      // A variation breaks the run of inline moves, so the next one needs its
      // move number again even though it is not the first of the line.
      first = true;
    }

    node = main;
  }
  if (topLevel && from === tree.root && tree.root.children.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'moves-empty';
    empty.textContent = 'No moves yet.';
    into.append(empty);
  }
}

function moveElement(
  tree: GameTree,
  node: TreeNode,
  options: MovesOptions,
  needsNumber: boolean,
): HTMLElement {
  const move = node.move;
  const span = document.createElement('span');
  span.className = 'move';
  if (node === tree.current) span.classList.add('current');
  if (move?.playedAnyway === true) span.classList.add('played-anyway');
  if (move?.deliberateError === true && options.revealed.has(node.id)) {
    span.classList.add('bot-error');
  }

  // White's moves carry "12.", Black's carry "12..." only when the run is broken.
  const number = Math.ceil(node.ply / 2);
  const white = node.ply % 2 === 1;
  const prefix = white ? `${number}.` : needsNumber ? `${number}…` : '';

  span.replaceChildren(document.createTextNode(`${prefix}${prefix ? ' ' : ''}${move?.san ?? '?'}`));
  // A superscript asterisk marks the ones you went into with the bot set to
  // punish, which is a different decision from shrugging and playing on. It sits
  // above the line like a footnote rather than sitting in the move itself, which
  // is what a glyph on the baseline would look like.
  if (move?.punished === true) {
    const mark = document.createElement('sup');
    mark.className = 'punished-mark';
    mark.textContent = '*';
    span.append(mark);
  }
  span.title =
    move?.punished === true
      ? 'You played this knowing it was wrong, and asked to be punished for it'
      : move?.playedAnyway === true
        ? 'You were warned about this move and played it'
        : '';
  span.onclick = () => {
    options.onSelect(node.id);
  };
  return span;
}
