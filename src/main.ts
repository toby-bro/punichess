import './style.css';

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';

import { type Policy, chooseMove } from './bot.ts';
import { LOOKUP, PROBE, REVIEW, SEARCH, VERIFY, WIDE } from './budgets.ts';
import { PositionCache } from './cache.ts';
import {
  INITIAL_FEN,
  fenAfter,
  legalDests,
  noDests,
  outcomeOf,
  sanLine,
  sanOf,
  turnOf,
} from './chess.ts';
import { Engine, isCancelled } from './engine.ts';
import { MistakeMemory } from './memory.ts';
import { mountMoves } from './moves-view.ts';
import { PgnImportError, fromPgn, pgnDate, toPgn } from './pgn.ts';
import {
  type Verdict,
  isError,
  judge,
  needsVerification,
  scoreOfMove,
  thresholdsFor,
  winPercent,
} from './referee.ts';
import { formatEval, renderReview } from './review-view.ts';
import { reviewGame } from './review.ts';
import { mountSettings } from './settings-panel.ts';
import { loadSettings, saveSettings, withColour } from './settings.ts';
import { Stats } from './stats.ts';
import { GameTree } from './tree.ts';
import type { PvLine } from './uci.ts';

/** How many moves of the best line the reveal lets you step through. */
const REVEAL_DEPTH = 8;
/** How many alternatives to draw on the board during a reveal. */
const REVEAL_ARROWS = 3;

/** A move of yours that was rejected, and why. */
interface Attempt {
  readonly uci: string;
  readonly verdict: Verdict;
}

/**
 * What the board is showing.
 *
 * `rejected` is your move or moves taken back and drawn in red, with nothing
 * explained. `analysis` is the reveal: the best line, steppable move by move.
 */
type Mode =
  | { readonly kind: 'play' }
  | { readonly kind: 'rejected'; readonly attempts: readonly Attempt[] }
  | {
      readonly kind: 'analysis';
      readonly base: string;
      readonly attempts: readonly Attempt[];
      readonly line: readonly string[];
      readonly step: number;
    };

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found;
}

const statusEl = element('status');
const scoreEl = element('score');
const acplEl = element('acpl');
const reviewEl = element('review');
const pgnText = element('pgn-text') as HTMLTextAreaElement;
const pgnStatusEl = element('pgn-status');
const pgnFile = element('pgn-file') as HTMLInputElement;
const evaluateBox = element('evaluate-box');
const evaluateToggle = element('evaluate') as HTMLInputElement;
const evalBar = element('eval-bar');
const evalFill = element('eval-fill');
const evalText = element('eval-text');

const buttons = {
  first: element('first'),
  back: element('back'),
  forward: element('forward'),
  last: element('last'),
  reveal: element('reveal'),
  punish: element('punish'),
  ignore: element('ignore'),
  resume: element('resume'),
  fork: element('fork'),
  swap: element('swap'),
  review: element('review-run'),
  newGame: element('new-game'),
  pgnExport: element('pgn-export'),
  pgnImport: element('pgn-import'),
  pgnCopy: element('pgn-copy'),
  forget: element('forget'),
};

const other = (colour: Color): Color => (colour === 'white' ? 'black' : 'white');
const square = (uci: string, end: 0 | 2): Key => uci.slice(end, end + 2) as Key;

const arrow = (uci: string, brush: string, label?: string): DrawShape => ({
  orig: square(uci, 0),
  dest: square(uci, 2),
  brush,
  ...(label === undefined ? {} : { label: { text: label } }),
});

function status(text: string, alarm = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('alarm', alarm);
}

/** How much a rejected move cost, written short enough to sit on an arrow. */
function costLabel(verdict: Verdict): string {
  if (verdict.missesMate) return verdict.mateIn === undefined ? 'mate' : `#${verdict.mateIn}`;
  if (verdict.hangsMate) return '#';
  return `−${(verdict.cpLoss / 100).toFixed(1)}`;
}

/** Say what a move cost, in the terms that actually fit the position. */
function describeCost(verdict: Verdict): string {
  if (verdict.missesMate) {
    return verdict.mateIn === undefined
      ? 'That lets a forced mate slip.'
      : `That misses mate in ${verdict.mateIn}.`;
  }
  if (verdict.hangsMate) return 'That walks into a forced mate.';
  return (
    `That costs ${(verdict.cpLoss / 100).toFixed(1)} pawns, ` +
    `about ${verdict.winLoss.toFixed(0)}% of your winning chances.`
  );
}

async function main(): Promise<void> {
  const engine = new Engine(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`);
  const cache = new PositionCache();
  const stats = new Stats();
  /** Positions you have gone wrong in before, kept between sessions. */
  const memory = new MistakeMemory();
  let settings = loadSettings();
  let tree = new GameTree();

  /** The colour you play. The bot takes the other one. */
  let you: Color = settings.playAs;

  let mode: Mode = { kind: 'play' };
  let thinking = true;
  let blundersLeft = settings.blundersPerGame;
  let spotted = 0;
  let missed = 0;
  /** Bot errors you have been shown, so the move list can mark them. */
  const revealed = new Set<number>();
  /**
   * While set, the bot plays only best moves, but only below this node: step
   * back above where you asked to be punished and it goes back to normal.
   */
  let punishFrom: number | undefined;
  /**
   * The review, once it has been run. Declared here rather than beside the
   * review code because the game starts before that point is reached, and the
   * navigation it performs already wants to tell the review where the board is.
   */
  let reviewView: ReturnType<typeof renderReview> | undefined;
  /**
   * Whether the review is open, which is the only time the evaluation and the
   * engine's preferred moves may be shown. During a game they would hand you the
   * answer to the question the game is asking.
   */
  let reviewing = false;
  /**
   * Whether to evaluate positions the review has not already seen.
   *
   * Off by default: stepping off the reviewed game into a line of your own is
   * usually you working something out, and answering it unasked spoils that.
   * On, when you would rather just be told.
   */
  let evaluateNew = false;
  /**
   * Bumped whenever the world changes under a move in progress.
   *
   * Aborting a search is not enough on its own: the bot also waits out its
   * minimum move time, and a plain timer knows nothing about being cancelled.
   * Work started under an older generation checks this and gives up.
   */
  let generation = 0;
  /** Searches running right now, so the same position is never searched twice at once. */
  const inFlight = new Map<string, Promise<readonly PvLine[]>>();
  /** Positions being looked at for display, so a redraw does not queue one twice. */
  const evaluating = new Set<string>();

  const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

  // Everything the game reads lives above this line. Setting up runs below it
  // and calls into the functions further down, so any state declared after this
  // point is read before it exists -- a temporal dead zone the compiler cannot
  // see, because the order that matters is the order things are *called* in,
  // not the order they are written in.

  const board: Api = Chessground(element('board'), {
    fen: INITIAL_FEN,
    orientation: you,
    movable: {
      free: false,
      showDests: true,
      dests: noDests(),
      events: { after: (orig, dest) => void onUserMove(orig, dest) },
    },
    // Moving while the bot thinks queues the move rather than doing nothing.
    premovable: { enabled: true, showDests: true },
    animation: { duration: 200 },
    draggable: { showGhost: true },
    drawable: { enabled: true },
  });

  let moves = mountMoves(element('moves'), tree, { onSelect: goTo, revealed });
  const panel = mountSettings(element('settings'), settings, changed => {
    // Raising the allowance mid-game should make more errors possible, not fewer.
    blundersLeft += changed.blundersPerGame - settings.blundersPerGame;
    settings = changed;
    saveSettings(settings);
  });

  status('Loading engine…');
  await engine.init();
  wireControls();
  await startGame();

  // --------------------------------------------------------------- searching

  /**
   * Search a position, reusing anything already known about it.
   *
   * The position you are about to move in is searched while you think, so by
   * the time you move the answer is usually already here. Sharing the in-flight
   * search is what makes that work: without it, moving quickly would queue a
   * second identical search behind the first.
   */
  async function analyse(
    fen: string,
    options: { multiPV: number; nodes: number },
  ): Promise<readonly PvLine[]> {
    const remembered = cache.get(fen, options.nodes, options.multiPV);
    if (remembered) return remembered;

    const key = `${fen}|${options.multiPV}|${options.nodes}`;
    const running = inFlight.get(key);
    if (running) return running;

    const search = engine
      .analyse(fen, options)
      .then(lines => {
        cache.set(fen, lines, options.nodes, options.multiPV);
        return lines;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, search);
    return search;
  }

  /** Start thinking about a position nobody has asked about yet. */
  function warm(fen: string): void {
    void analyse(fen, SEARCH).catch(() => undefined);
  }

  /**
   * Score a move that the engine did not list.
   *
   * Searched on the same budget as its parent, so the two numbers are
   * comparable; a cheaper look here is how false accusations get made.
   */
  async function scoreUnlisted(fen: string, uci: string): Promise<ReturnType<typeof scoreOfMove>> {
    const child = fenAfter(fen, uci);
    return scoreOfMove(await analyse(child, LOOKUP), child);
  }

  /** Abandon whatever the engine is doing; the caller is about to change the world. */
  function interrupt(): void {
    generation++;
    engine.abort();
    board.cancelPremove();
    thinking = false;
  }

  /**
   * Recover from something unexpected.
   *
   * Anything thrown mid-move used to escape as an unhandled rejection, leaving
   * the board locked, the arrows gone and nothing on screen to say why. Whatever
   * went wrong, the position is still valid and the board should come back.
   */
  function fail(error: unknown): void {
    thinking = false;
    mode = { kind: 'play' };
    status(
      `Something went wrong: ${error instanceof Error ? error.message : String(error)}. The board is yours again.`,
      true,
    );
    render();
    console.error(error);
  }

  // --------------------------------------------------------------- rendering

  function render(): void {
    if (mode.kind === 'analysis') renderAnalysis(mode);
    else renderGame();
    moves.render();
    renderButtons();
  }

  function renderGame(): void {
    const fen = tree.fen;
    const last = tree.lastMove;
    board.set({
      fen,
      turnColor: turnOf(fen),
      // Highlight whichever side just moved, not only yours.
      ...(last ? { lastMove: [square(last.uci, 0), square(last.uci, 2)] } : { lastMove: [] }),
      movable: { color: you, dests: canMove() ? legalDests(fen) : noDests() },
      // Shapes must go in the same call as the fen: chessground clears them
      // whenever a position is set.
      drawable: {
        shapes: [
          ...(mode.kind === 'rejected' ? rejectedShapes(mode.attempts) : []),
          ...rememberedShapes(fen, mode.kind === 'rejected' ? mode.attempts : []),
          ...(reviewing ? bestArrows(fen) : []),
        ],
      },
    });
    renderEval(fen);
  }

  /**
   * The engine's favourite moves from the position on the board, best first.
   *
   * Only ever from what is already known. A position reached by branching off
   * during the review has not been searched, and searching it would answer a
   * question you have just started asking yourself -- so it shows nothing at all
   * rather than spoiling the line you are exploring.
   */
  function bestArrows(fen: string): DrawShape[] {
    const known = cache.lines(fen);
    if (!known) {
      if (evaluateNew) evaluateSoon(fen);
      return [];
    }
    return known
      .slice(0, REVEAL_ARROWS)
      .map((line, rank) =>
        arrow(line.moves[0], rank === 0 ? 'green' : 'blue', formatEval(line.cp, line.mate)),
      );
  }

  /** Search a position for display only, and redraw when it lands. */
  function evaluateSoon(fen: string): void {
    if (evaluating.has(fen)) return;
    evaluating.add(fen);
    void analyse(fen, REVIEW)
      .then(() => {
        if (tree.fen === fen) render();
      })
      .catch(() => undefined)
      .finally(() => {
        evaluating.delete(fen);
      });
  }

  /**
   * The evaluation bar beside the board.
   *
   * Shown only with the review open, and only for a position already searched.
   * Step off the reviewed game into something new and it goes away, because the
   * alternative is either a stale number from the wrong position or a fresh one
   * that answers the question you are in the middle of asking.
   */
  function renderEval(fen: string): void {
    evaluateBox.hidden = !reviewing;
    const best = reviewing ? cache.best(fen) : undefined;
    evalBar.hidden = !best;
    if (!best) {
      if (reviewing && evaluateNew) evaluateSoon(fen);
      return;
    }
    // Everything here is said from White's point of view, then flipped to match
    // whichever way the board is facing.
    const whiteCp = turnOf(fen) === 'white' ? best.cp : -best.cp;
    const whiteMate =
      best.mate === undefined ? undefined : turnOf(fen) === 'white' ? best.mate : -best.mate;
    const whiteShare = winPercent(whiteCp);
    const share = you === 'white' ? whiteShare : 100 - whiteShare;

    evalFill.style.height = `${share}%`;
    evalText.textContent = formatEval(whiteCp, whiteMate);
    // The label sits on the dark part of the bar, wherever that currently is.
    evalText.classList.toggle('low', share > 60);
  }

  /**
   * Every rejected move in red, each labelled with what it cost.
   *
   * All of them, not just the last: two wrong tries are two different
   * misunderstandings, and seeing them together is the point.
   */
  function rejectedShapes(attempts: readonly Attempt[]): DrawShape[] {
    return attempts.flatMap(attempt => [
      arrow(attempt.uci, 'red', costLabel(attempt.verdict)),
      { orig: square(attempt.uci, 2), brush: 'red' },
    ]);
  }

  /**
   * What you have got wrong here before, in pale red.
   *
   * Paler than the move you are being stopped for right now, because the two
   * mean different things: one is a mistake you are making, the others are
   * mistakes you have made. Anything you have just tried is left out, since it
   * is already on the board in full red.
   */
  function rememberedShapes(fen: string, current: readonly Attempt[]): DrawShape[] {
    const showing = new Set(current.map(attempt => attempt.uci));
    return memory
      .at(fen)
      .filter(mistake => !showing.has(mistake.uci))
      .map(mistake => {
        const cost = mistake.missesMate
          ? mistake.mateIn === undefined
            ? 'mate'
            : `#${mistake.mateIn}`
          : `−${(mistake.cpLoss / 100).toFixed(1)}`;
        // "x3" is the part worth seeing: falling for the same move repeatedly is
        // a different problem from getting it wrong once.
        const times = mistake.times > 1 ? ` ×${mistake.times}` : '';
        return arrow(mistake.uci, 'paleRed', `${cost}${times}`);
      });
  }

  function renderAnalysis(view: Extract<Mode, { kind: 'analysis' }>): void {
    const played = view.line.slice(0, view.step);
    const fen = played.reduce((position, uci) => fenAfter(position, uci), view.base);
    const next = view.line[view.step];
    const previous = view.step > 0 ? view.line[view.step - 1] : undefined;

    const shapes: DrawShape[] = [];
    if (view.step === 0) {
      // At the start, the mistakes and the answers side by side.
      shapes.push(...rejectedShapes(view.attempts));
      const best = cache.get(view.base, SEARCH.nodes, SEARCH.multiPV) ?? [];
      const top = best[0];
      for (const [rank, line] of best.slice(0, REVEAL_ARROWS).entries()) {
        const loss = top ? Math.max(0, top.cp - line.cp) : 0;
        shapes.push(
          arrow(
            line.moves[0],
            rank === 0 ? 'green' : 'blue',
            rank === 0 ? 'best' : `−${(loss / 100).toFixed(1)}`,
          ),
        );
      }
    } else if (next) {
      shapes.push(arrow(next, 'blue'));
    }

    board.set({
      fen,
      turnColor: turnOf(fen),
      ...(previous ? { lastMove: [square(previous, 0), square(previous, 2)] } : { lastMove: [] }),
      movable: { color: you, dests: noDests() },
      drawable: { shapes },
    });
  }

  function renderButtons(): void {
    const analysing = mode.kind === 'analysis';
    if (mode.kind === 'analysis') {
      // In the reveal the arrows walk the variation instead of the game.
      buttons.first.toggleAttribute('disabled', mode.step === 0);
      buttons.back.toggleAttribute('disabled', mode.step === 0);
      buttons.forward.toggleAttribute('disabled', mode.step >= mode.line.length);
      buttons.last.toggleAttribute('disabled', mode.step >= mode.line.length);
    } else {
      buttons.first.toggleAttribute('disabled', tree.atStart);
      buttons.back.toggleAttribute('disabled', tree.atStart);
      buttons.forward.toggleAttribute('disabled', tree.atLeaf);
      buttons.last.toggleAttribute('disabled', tree.atLeaf);
    }

    const stopped = mode.kind === 'rejected' || analysing;
    buttons.reveal.hidden = mode.kind !== 'rejected';
    buttons.punish.hidden = !stopped;
    buttons.ignore.hidden = !stopped;
    buttons.resume.hidden = !analysing;
    // Offered whenever the position in view needs someone to act on it: there is
    // a continuation to leave behind, or it is the bot's move and the bot is not
    // going to make it on its own because the search was interrupted. Without
    // the second case, stepping back into the bot's turn is a dead end with no
    // button, no true message and nothing to click.
    const needsAction = !tree.atLeaf || tree.turn !== you;
    buttons.fork.hidden = stopped || thinking || !needsAction || Boolean(outcomeOf(tree.fen));
    buttons.review.toggleAttribute('disabled', tree.root.children.length === 0 && !reviewing);
    buttons.review.textContent = reviewing ? 'Close review' : 'Review game';
  }

  function updateScore(): void {
    scoreEl.textContent = `spotted ${spotted} · missed ${missed}`;
    const yours = stats.summary('you');
    const theirs = stats.summary('bot');
    acplEl.textContent = yours.moves === 0 ? '' : `you ${yours.acpl} cp · bot ${theirs.acpl} cp`;
  }

  // -------------------------------------------------------------- navigation

  /**
   * Being stopped does not take the board away.
   *
   * The whole point of the interruption is that you try something else, so a
   * rejected move leaves the position exactly as it was and you simply play a
   * different one. Having to press a button first to get the board back made
   * the correction feel like a punishment rather than a second chance.
   */
  function canMove(): boolean {
    if (thinking || mode.kind === 'analysis') return false;
    return tree.turn === you && !outcomeOf(tree.fen);
  }

  function liveStatus(): string {
    const over = outcomeOf(tree.fen);
    if (over)
      return over.winner ? `${over.reason} — ${over.winner} wins.` : `Draw: ${over.reason}.`;
    if (thinking) return 'Thinking…';
    // Never claim you can move in a position where it is not your turn: that is
    // the difference between browsing and being stuck.
    if (tree.turn !== you) return 'Bot to move here — press “Play from here”.';
    return tree.atLeaf ? 'Your move.' : 'Browsing. Play a move to branch from here.';
  }

  /** Put a position on the board, leaving whatever the engine was doing behind. */
  function goTo(id: number): void {
    interrupt();
    tree.goTo(id);
    // Asking to be punished applies to a branch, so leaving that branch ends it.
    if (punishFrom !== undefined && !tree.isWithin(tree.current.id, punishFrom)) {
      punishFrom = undefined;
    }
    mode = { kind: 'play' };
    afterNavigation();
  }

  function afterNavigation(): void {
    status(liveStatus());
    if (tree.turn === you && !outcomeOf(tree.fen)) warm(tree.fen);
    render();
    reviewView?.setSelected(tree.current.id);
  }

  function step(delta: number): void {
    if (mode.kind === 'analysis') {
      mode = { ...mode, step: Math.max(0, Math.min(mode.step + delta, mode.line.length)) };
      render();
      return;
    }
    interrupt();
    if (delta < 0) tree.back();
    else tree.forward();
    goTo(tree.current.id);
  }

  // ------------------------------------------------------------------- game

  async function startGame(): Promise<void> {
    interrupt();
    thinking = true;
    you = settings.playAs;

    tree = new GameTree();
    cache.clear();
    stats.reset();
    revealed.clear();
    punishFrom = undefined;
    blundersLeft = settings.blundersPerGame;
    spotted = 0;
    missed = 0;
    mode = { kind: 'play' };
    closeReview();
    moves = mountMoves(element('moves'), tree, { onSelect: goTo, revealed });
    panel.update(settings);
    updateScore();

    await engine.newGame();
    board.set({ orientation: you });
    await handOver();
  }

  /** Whoever is to move gets the move: you get the board, the bot gets to think. */
  async function handOver(): Promise<void> {
    if (tree.turn === you || outcomeOf(tree.fen)) {
      thinking = false;
      if (!outcomeOf(tree.fen)) warm(tree.fen);
      status(liveStatus());
      render();
      board.playPremove();
      return;
    }
    render();
    await botTurn();
  }

  async function onUserMove(orig: Key, dest: Key): Promise<void> {
    if (!canMove()) {
      // The board let a move through that the game will not accept. Put the
      // position back rather than leaving a piece somewhere it never went.
      render();
      return;
    }
    const uci = withPromotion(orig, dest);
    const fen = tree.fen;
    thinking = true;
    lockBoard();

    try {
      const lines = await analyse(fen, SEARCH);
      // In punish mode the position is lost by construction, so the "already
      // decided" silence has to be lifted or nothing you do afterwards is judged.
      const thresholds = thresholdsFor(settings, tree.punishArmed, punishing());
      // A move the engine did not list has to be looked up, or a mate you missed
      // can be mistaken for one you found.
      const listed = lines.some(line => line.moves[0] === uci);
      const played = listed ? undefined : await scoreUnlisted(fen, uci);
      let verdict = judge(lines, uci, played);

      if (verdict && isError(verdict, thresholds) && needsVerification(verdict, thresholds)) {
        // Only a marginal call is worth the pause; anything clear-cut or forced
        // is acted on immediately.
        status('Let me look again…');
        const deep = await analyse(fen, VERIFY);
        const deepPlayed = deep.some(line => line.moves[0] === uci)
          ? undefined
          : await scoreUnlisted(fen, uci);
        verdict = judge(deep, uci, deepPlayed) ?? verdict;
      }

      // Every attempt counts towards your accuracy, including this one if it is
      // about to be sent back.
      if (verdict) stats.add('you', verdict.cpLoss, verdict.winLoss);

      if (verdict && isError(verdict, thresholds)) {
        thinking = false;
        stopYou(uci, verdict);
        updateScore();
        return;
      }

      if (tree.punishArmed) {
        spotted++;
        status('Good — you saw it.');
      }
      accept(uci);
    } catch (error) {
      if (!isCancelled(error)) fail(error);
    }
  }

  /** Play your move and hand over to the bot. */
  function accept(uci: string, playedAnyway = false): void {
    tree.play(uci);
    if (playedAnyway) tree.markPlayedAnyway();
    mode = { kind: 'play' };
    updateScore();
    void botTurn();
  }

  /** The interruption: the move comes back, drawn in red, with nothing explained. */
  function stopYou(uci: string, verdict: Verdict): void {
    const previous = mode.kind === 'rejected' ? mode.attempts : [];
    // Keep every attempt: two wrong tries are two different misunderstandings.
    const attempts = [...previous.filter(attempt => attempt.uci !== uci), { uci, verdict }];
    mode = { kind: 'rejected', attempts };

    // Remembered against the position, so it comes back the next time you are
    // here -- next game, or next month.
    memory.record(tree.fen, {
      uci,
      san: sanOf(tree.fen, uci),
      cpLoss: verdict.cpLoss,
      missesMate: verdict.missesMate,
      hangsMate: verdict.hangsMate,
      mateIn: verdict.mateIn,
    });

    const forced = verdict.missesMate || verdict.hangsMate;
    status(
      attempts.length === 1
        ? forced
          ? 'Wait — look again. There is something forced here.'
          : tree.punishArmed
            ? 'Wait. I just gave you something, and that move lets it go. Look again.'
            : 'Wait. Are you sure about that move? Have another look.'
        : `Still not it — ${attempts.length} tries now. Look again, or ask to be shown.`,
      true,
    );
    render();
  }

  /** Show what the move cost, the best answers, and the line that follows. */
  function reveal(): void {
    if (mode.kind !== 'rejected') return;
    const attempts = mode.attempts;
    const worst = attempts.reduce((a, b) => (b.verdict.cpLoss > a.verdict.cpLoss ? b : a));
    if (tree.punishArmed) {
      missed++;
      if (tree.current.move) revealed.add(tree.current.id);
      updateScore();
    }

    const line = worst.verdict.best.moves.slice(0, REVEAL_DEPTH);
    const sans = sanLine(tree.fen, line);
    status(`${describeCost(worst.verdict)} Best was ${sans[0] ?? '?'} — ${sans.join(' ')}`);
    mode = { kind: 'analysis', base: tree.fen, attempts, line, step: 0 };
    render();
  }

  /**
   * Play the move you were stopped for anyway.
   *
   * `punish` makes the bot answer with best moves from here on, so you get to
   * watch the refutation actually land instead of being told about it.
   */
  function playAnyway(punish: boolean): void {
    const attempts = mode.kind === 'rejected' || mode.kind === 'analysis' ? mode.attempts : [];
    const chosen = attempts.at(-1);
    if (!chosen) return;
    const node = tree.play(chosen.uci);
    tree.markPlayedAnyway();
    punishFrom = punish ? node.id : undefined;
    mode = { kind: 'play' };
    status(punish ? 'Right — watch how that gets punished.' : 'Playing it anyway.');
    void botTurn();
  }

  async function botTurn(): Promise<void> {
    thinking = true;
    mode = { kind: 'play' };
    status(outcomeOf(tree.fen) ? liveStatus() : 'Thinking…');
    render();

    if (outcomeOf(tree.fen)) {
      thinking = false;
      render();
      return;
    }

    const mine = generation;
    const startedAt = Date.now();
    try {
      const fen = tree.fen;
      const lines = await analyse(fen, SEARCH);
      const move = await chooseMove(
        {
          search: position => analyse(position, SEARCH),
          searchWide: position => analyse(position, WIDE),
          probe: position => analyse(position, PROBE),
          settings,
        } satisfies Policy,
        fen,
        lines,
        // While punishing, the bot plays the best move and nothing else.
        punishing()
          ? { wantsError: false, acpl: Number.POSITIVE_INFINITY }
          : { wantsError: wantsError(), acpl: stats.acpl('bot') },
      );
      if (!move) {
        thinking = false;
        status('The engine sees no move here.');
        render();
        return;
      }
      if (move.deliberateError) blundersLeft--;

      const best = lines[0];
      stats.add(
        'bot',
        move.cpLoss,
        best ? Math.max(0, winPercent(best.cp) - winPercent(best.cp - move.cpLoss)) : 0,
      );
      // Hold the move back until the bot has taken as long as it is meant to.
      // A search that ran quickly should not make the reply arrive quickly.
      await sleep(settings.minMoveMs - (Date.now() - startedAt));
      if (mine !== generation) return;

      // Say nothing about it. Spotting it is the whole point.
      tree.play(move.uci, { deliberateError: move.deliberateError });
      thinking = false;
      updateScore();
      if (!outcomeOf(tree.fen)) warm(tree.fen);
      status(liveStatus());
      render();
      reviewView?.setSelected(tree.current.id);
      // Whatever you lined up while it was thinking, play it now.
      board.playPremove();
    } catch (error) {
      if (!isCancelled(error)) fail(error);
    }
  }

  /** Whether the bot is currently answering with best moves only. */
  function punishing(): boolean {
    return punishFrom !== undefined && tree.isWithin(tree.current.id, punishFrom);
  }

  function wantsError(): boolean {
    if (blundersLeft <= 0 || tree.current.ply < settings.blunderFromPly) return false;
    return Math.random() < settings.blunderChance;
  }

  /** Stop accepting moves without touching the position already on the board. */
  function lockBoard(): void {
    board.set({ movable: { color: you, dests: noDests() } });
    renderButtons();
  }

  function withPromotion(orig: Key, dest: Key): string {
    // Auto-queen for now; a promotion picker is a later refinement.
    const piece = board.state.pieces.get(dest);
    const lastRank = dest.endsWith('8') || dest.endsWith('1');
    return orig + dest + (piece?.role === 'pawn' && lastRank ? 'q' : '');
  }

  // ----------------------------------------------------------------- review

  /** Put the review away and stop showing what the engine thinks. */
  function closeReview(): void {
    reviewing = false;
    reviewView = undefined;
    reviewEl.hidden = true;
    reviewEl.replaceChildren();
    render();
  }

  async function runReview(): Promise<void> {
    if (tree.root.children.length === 0) return;
    interrupt();
    thinking = true;
    renderButtons();
    reviewEl.hidden = false;
    reviewEl.textContent = 'Reviewing…';

    // The line being looked at, carried on to the end of its branch.
    const line = [...tree.path];
    for (let node = line.at(-1); node?.children[0]; node = node.children[0]) {
      line.push(node.children[0]);
    }

    try {
      const review = await reviewGame(
        tree.root.fen,
        line,
        fen => analyse(fen, REVIEW),
        progress => {
          // Most positions were analysed while playing, so this usually flies by.
          reviewEl.textContent = `Reviewing… ${progress.done}/${progress.total}`;
        },
      );
      reviewView = renderReview(reviewEl, review, {
        you,
        rootId: tree.root.id,
        attempts: { you: stats.summary('you'), bot: stats.summary('bot') },
        // No scrolling: you clicked a point on a graph you were already looking
        // at, and hauling the page somewhere else is not what you asked for.
        onSelect: goTo,
      });
      reviewing = true;
      reviewView.setSelected(tree.current.id);
    } catch (error) {
      if (isCancelled(error)) {
        closeReview();
        return;
      }
      reviewEl.textContent = `Review failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      thinking = false;
      render();
    }
  }

  // -------------------------------------------------------------------- pgn

  function exportPgn(): void {
    const result = outcomeOf(tree.fen);
    pgnText.value = toPgn(tree, {
      white: you === 'white' ? 'You' : 'Punichess',
      black: you === 'black' ? 'You' : 'Punichess',
      date: pgnDate(),
      result:
        result?.winner === 'white'
          ? '1-0'
          : result?.winner === 'black'
            ? '0-1'
            : result
              ? '1/2-1/2'
              : '*',
    });
    pgnNote(`Exported ${tree.nodes.length - 1} moves.`);
  }

  function importPgn(text: string): void {
    interrupt();
    try {
      const loaded = fromPgn(text);
      tree = loaded;
      // An imported game was not played here, so none of this session's
      // bookkeeping applies to it.
      cache.clear();
      stats.reset();
      revealed.clear();
      punishFrom = undefined;
      spotted = 0;
      missed = 0;
      mode = { kind: 'play' };
      closeReview();
      moves = mountMoves(element('moves'), tree, { onSelect: goTo, revealed });
      updateScore();
      pgnNote(`Loaded ${tree.nodes.length - 1} moves. Play on from anywhere.`);
      afterNavigation();
    } catch (error) {
      pgnNote(
        error instanceof PgnImportError ? error.message : 'That PGN could not be read.',
        true,
      );
    }
  }

  function pgnNote(text: string, bad = false): void {
    pgnStatusEl.textContent = text;
    pgnStatusEl.classList.toggle('bad', bad);
  }

  // --------------------------------------------------------------- controls

  /** Take over the other side, keeping the position exactly as it stands. */
  async function swapSides(): Promise<void> {
    interrupt();
    settings = withColour(settings, other(you));
    saveSettings(settings);
    you = settings.playAs;
    panel.update(settings);
    mode = { kind: 'play' };
    board.set({ orientation: you });
    status(`You are ${you} now.`);
    await handOver();
  }

  /** Abandon the continuation and carry on from the position in view. */
  async function forkHere(): Promise<void> {
    interrupt();
    tree.promote();
    mode = { kind: 'play' };
    status('Playing on from here.');
    await handOver();
  }

  function wireControls(): void {
    buttons.first.onclick = () => {
      if (mode.kind === 'analysis') {
        mode = { ...mode, step: 0 };
        render();
        return;
      }
      interrupt();
      tree.first();
      goTo(tree.current.id);
    };
    buttons.last.onclick = () => {
      if (mode.kind === 'analysis') {
        mode = { ...mode, step: mode.line.length };
        render();
        return;
      }
      interrupt();
      tree.last();
      goTo(tree.current.id);
    };
    buttons.back.onclick = () => {
      step(-1);
    };
    buttons.forward.onclick = () => {
      step(1);
    };
    buttons.reveal.onclick = reveal;
    buttons.punish.onclick = () => {
      playAnyway(true);
    };
    buttons.ignore.onclick = () => {
      playAnyway(false);
    };
    buttons.resume.onclick = () => {
      mode = { kind: 'play' };
      status('Your move — try again.');
      render();
    };
    buttons.fork.onclick = () => {
      void forkHere();
    };
    buttons.swap.onclick = () => {
      void swapSides();
    };
    evaluateToggle.onchange = () => {
      evaluateNew = evaluateToggle.checked;
      render();
    };
    buttons.review.onclick = () => {
      if (reviewing) closeReview();
      else void runReview();
    };
    buttons.newGame.onclick = () => {
      void startGame();
    };
    buttons.pgnExport.onclick = exportPgn;
    buttons.pgnImport.onclick = () => {
      importPgn(pgnText.value);
    };
    buttons.forget.onclick = () => {
      memory.clear();
      status('Forgotten. Nothing held against you.');
      render();
    };
    buttons.pgnCopy.onclick = () => {
      pgnText.select();
      navigator.clipboard
        .writeText(pgnText.value)
        .then(() => {
          pgnNote('Copied.');
        })
        .catch(() => {
          pgnNote('Could not copy; the text is selected, so copy it by hand.', true);
        });
    };
    pgnFile.onchange = () => {
      const file = pgnFile.files?.[0];
      if (!file) return;
      file
        .text()
        .then(text => {
          pgnText.value = text;
          importPgn(text);
        })
        .catch(() => {
          pgnNote('That file could not be read.', true);
        });
    };

    document.addEventListener('keydown', event => {
      // Let the PGN box have its own keyboard.
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }
      const actions: Record<string, () => void> = {
        ArrowLeft: () => {
          step(-1);
        },
        ArrowRight: () => {
          step(1);
        },
        Home: () => {
          buttons.first.click();
        },
        End: () => {
          buttons.last.click();
        },
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    });
  }
}

main().catch((error: unknown) => {
  status(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});
