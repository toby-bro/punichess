/**
 * The game as a tree of variations.
 *
 * Going back and playing something else keeps both lines rather than throwing
 * one away, so a game becomes a record of everything that was tried and any of
 * it can be replayed.
 */

import type { Color } from 'chessops/types';

import { INITIAL_FEN, fenAfter, sanOf, turnOf } from './chess.ts';

export interface MoveInfo {
  readonly uci: string;
  readonly san: string;
  readonly by: Color;
  /** The bot played this one wrong on purpose. */
  readonly deliberateError: boolean;
  /**
   * You were warned about this move and played it anyway. Marked so the move
   * list can show where to come back to and try again.
   */
  playedAnyway: boolean;
  /** You played it with the bot set to punish, rather than merely ignoring it. */
  punished: boolean;
}

export interface TreeNode {
  readonly id: number;
  /** The position at this node. */
  readonly fen: string;
  /** Distance from the start. The root is 0. */
  readonly ply: number;
  /** The move that reached this node. Absent only at the root. */
  readonly move: MoveInfo | undefined;
  readonly parent: TreeNode | undefined;
  /** Continuations, in the order they were first played. */
  readonly children: TreeNode[];
}

export interface PlayOptions {
  readonly deliberateError?: boolean;
  readonly playedAnyway?: boolean;
}

export class GameTree {
  readonly root: TreeNode;
  readonly #byId = new Map<number, TreeNode>();
  /** Subtree heights, rebuilt whenever the shape of the tree changes. */
  #heights = new Map<number, number>();
  #current: TreeNode;
  #nextId = 1;

  constructor(start: string = INITIAL_FEN) {
    this.root = { id: 0, fen: start, ply: 0, move: undefined, parent: undefined, children: [] };
    this.#byId.set(0, this.root);
    this.#current = this.root;
  }

  get current(): TreeNode {
    return this.#current;
  }

  get fen(): string {
    return this.#current.fen;
  }

  get turn(): Color {
    return turnOf(this.#current.fen);
  }

  /** The move that produced the current position, if any. */
  get lastMove(): MoveInfo | undefined {
    return this.#current.move;
  }

  /** True when there is nothing after the current position on any branch. */
  get atLeaf(): boolean {
    return this.#current.children.length === 0;
  }

  get atStart(): boolean {
    return this.#current === this.root;
  }

  /**
   * True when the move about to be played answers an error the bot made on
   * purpose, and so should be judged strictly.
   */
  get punishArmed(): boolean {
    return this.#current.move?.deliberateError ?? false;
  }

  /** Root to current, inclusive. */
  get path(): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (let node: TreeNode | undefined = this.#current; node; node = node.parent) nodes.push(node);
    return nodes.reverse();
  }

  /** The moves leading to the current position. */
  get moves(): MoveInfo[] {
    return this.path.flatMap(node => (node.move ? [node.move] : []));
  }

  /**
   * The main line: root, then the longest continuation at every fork.
   *
   * Length rather than order of play, because a two-move sideline you tried once
   * should not take over the arrow keys from the game you actually played. Ties
   * go to whichever was played first.
   */
  get mainline(): TreeNode[] {
    const nodes: TreeNode[] = [this.root];
    for (let node = this.mainChild(this.root); node; node = this.mainChild(node)) {
      nodes.push(node);
    }
    return nodes;
  }

  /**
   * The continuation to follow from a node: the one with the longest line below
   * it. Undefined at the end of a branch.
   */
  mainChild(node: TreeNode): TreeNode | undefined {
    let best: TreeNode | undefined;
    let tallest = -1;
    for (const child of node.children) {
      const height = this.#height(child);
      // Strictly taller, so an equal-length branch never displaces the earlier one.
      if (height > tallest) {
        best = child;
        tallest = height;
      }
    }
    return best;
  }

  /** How many plies the longest line below a node runs to. */
  #height(node: TreeNode): number {
    const known = this.#heights.get(node.id);
    if (known !== undefined) return known;

    // Iterative: a long game is deeper than the stack is comfortable with.
    const stack: TreeNode[] = [node];
    const order: TreeNode[] = [];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      order.push(next);
      for (const child of next.children) stack.push(child);
    }
    for (const visited of order.reverse()) {
      let tallest = 0;
      for (const child of visited.children) {
        tallest = Math.max(tallest, (this.#heights.get(child.id) ?? 0) + 1);
      }
      this.#heights.set(visited.id, tallest);
    }
    return this.#heights.get(node.id) ?? 0;
  }

  /** Every node, in the order they were created. */
  get nodes(): TreeNode[] {
    return [...this.#byId.values()];
  }

  node(id: number): TreeNode | undefined {
    return this.#byId.get(id);
  }

  /**
   * Play a move from the current position.
   *
   * Replaying a move that has been played from here before follows the existing
   * branch rather than duplicating it, so wandering back and forth through a
   * line does not grow the tree.
   */
  play(uci: string, options: PlayOptions = {}): TreeNode {
    const from = this.#current;
    const existing = from.children.find(child => child.move?.uci === uci);
    if (existing) {
      this.#current = existing;
      return existing;
    }

    const node: TreeNode = {
      id: this.#nextId++,
      fen: fenAfter(from.fen, uci),
      ply: from.ply + 1,
      move: {
        uci,
        san: sanOf(from.fen, uci),
        by: turnOf(from.fen),
        deliberateError: options.deliberateError ?? false,
        playedAnyway: options.playedAnyway ?? false,
        punished: false,
      },
      parent: from,
      children: [],
    };
    from.children.push(node);
    this.#byId.set(node.id, node);
    this.#heights.clear();
    this.#current = node;
    return node;
  }

  /**
   * Whether `id` is the given node or sits below it.
   *
   * Used to scope a mode to a branch: stepping back above where it started
   * leaves it behind, which is the only sensible meaning for "punish me from
   * here".
   */
  isWithin(id: number, ancestorId: number): boolean {
    for (let node = this.#byId.get(id); node; node = node.parent) {
      if (node.id === ancestorId) return true;
    }
    return false;
  }

  /**
   * Mark the current move as one you were warned about and played regardless,
   * and whether you asked to be punished for it.
   */
  markPlayedAnyway(punished = false): void {
    if (!this.#current.move) return;
    this.#current.move.playedAnyway = true;
    if (punished) this.#current.move.punished = true;
  }

  /**
   * Whether the position being looked at sits inside a branch where punishment
   * was asked for.
   *
   * Read off the tree rather than held as loose state, so it survives navigating
   * away and back, and is saved with the game. Going back above the move where
   * it started leaves it behind, which is the only sensible meaning for "punish
   * me from here".
   */
  get punishing(): boolean {
    for (let node: TreeNode | undefined = this.#current; node; node = node.parent) {
      if (node.move?.punished === true) return true;
    }
    return false;
  }

  /** Start punishing from the move being looked at. */
  startPunishing(): void {
    if (this.#current.move) this.#current.move.punished = true;
  }

  /** Stop punishing, here and anywhere above that switched it on. */
  stopPunishing(): void {
    for (let node: TreeNode | undefined = this.#current; node; node = node.parent) {
      if (node.move) node.move.punished = false;
    }
  }

  /** Move the viewpoint. Unknown ids are ignored rather than throwing. */
  goTo(id: number): void {
    const node = this.#byId.get(id);
    if (node) this.#current = node;
  }

  back(): void {
    if (this.#current.parent) this.#current = this.#current.parent;
  }

  /** Forward along the longest line from here. */
  forward(): void {
    const next = this.mainChild(this.#current);
    if (next) this.#current = next;
  }

  first(): void {
    this.#current = this.root;
  }

  /** To the end of the line, following the longest branch at each fork. */
  last(): void {
    for (let next = this.mainChild(this.#current); next; next = this.mainChild(next)) {
      this.#current = next;
    }
  }

  /**
   * Put the current branch first among its siblings at every step back to the
   * root.
   *
   * Ordering decides ties only: navigation follows the longest line, so this
   * settles which of two equally long branches leads, and fixes the order
   * variations are listed in.
   */
  promote(): void {
    for (let node = this.#current; node.parent; node = node.parent) {
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index > 0) {
        siblings.splice(index, 1);
        siblings.unshift(node);
      }
    }
  }

  /** Discard a branch and everything below it. The root cannot be removed. */
  remove(id: number): void {
    const node = this.#byId.get(id);
    if (!node?.parent) return;

    const siblings = node.parent.children;
    const index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);

    // If the viewpoint was inside what just went, fall back to the parent.
    const doomed = new Set<number>();
    const visit = (subtree: TreeNode): void => {
      doomed.add(subtree.id);
      for (const child of subtree.children) visit(child);
    };
    visit(node);
    for (const id of doomed) this.#byId.delete(id);
    this.#heights.clear();
    if (doomed.has(this.#current.id)) this.#current = node.parent;
  }
}
