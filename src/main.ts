import './style.css';
import './boards.css';
import './pieces.css';

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color } from 'chessops/types';

import { type Policy, chooseMove } from './bot.ts';
import { applyBrandFont, pickBrandFont } from './brand.ts';
import {
  type Budget,
  LOOKUP,
  OPENING,
  OPENING_PLIES,
  PROBE,
  REVIEW,
  SEARCH,
  VERIFY,
  WIDE,
} from './budgets.ts';
import { PositionCache } from './cache.ts';
import {
  INITIAL_FEN,
  fenAfter,
  legalDests,
  noDests,
  halfmoveClock,
  outcomeOf,
  positionHash,
  sanLine,
  sanOf,
  stalemateCage,
  turnOf,
} from './chess.ts';
import { Engine, isCancelled } from './engine.ts';
import {
  GameLibrary,
  type NewGame,
  type SavedEval,
  restoreTree,
  serialiseTree,
} from './library.ts';
import { mountLibrary } from './library-view.ts';
import { MistakeMemory } from './memory.ts';
import { mountMoves } from './moves-view.ts';
import { PgnImportError, fromPgn, pgnDate, toPgn } from './pgn.ts';
import { arrow, costLabel, readable, rememberedArrow, square } from './shapes.ts';
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
import { mountAppearance } from './appearance-panel.ts';
import { mountSettings } from './settings-panel.ts';
import {
  BOARD_THEMES,
  PIECE_SETS,
  loadSettings,
  saveSettings,
  withColour,
  withSaveOnNew,
} from './settings.ts';
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
 * explained, though the board is still yours -- being stopped is an invitation to
 * try something else, not a room you are locked in.
 */
type Mode =
  | { readonly kind: 'play' }
  | {
      readonly kind: 'rejected';
      readonly attempts: readonly Attempt[];
      /** Whether the explanation is showing. The board stays yours either way. */
      readonly shown: boolean;
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
const punishToggle = element('punish-toggle') as HTMLInputElement;
const keepToggle = element('keep') as HTMLInputElement;
const evaluateBox = element('evaluate-box');
const evaluateToggle = element('evaluate') as HTMLInputElement;
const promotionBox = element('promotion');
const promotionChoices = element('promotion-choices');
const promotionVeil = element('promotion-veil');
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
  another: element('another'),
  swap: element('swap'),
  review: element('review-run'),
  newGame: element('new-game'),
  pgnExport: element('pgn-export'),
  pgnImport: element('pgn-import'),
  pgnCopy: element('pgn-copy'),
  clearAnalysis: element('clear-analysis'),
  forget: element('forget'),
  expandMoves: element('expand-moves'),
  saveGame: element('save-game'),
};

// Before anything else draws: the title's face is decided per load, and asking
// for it early is the difference between the name appearing in it and the name
// appearing in the fallback and then jumping.
applyBrandFont(pickBrandFont());

const other = (colour: Color): Color => (colour === 'white' ? 'black' : 'white');
function status(text: string, alarm = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('alarm', alarm);
}

/** Say what a move cost, in the terms that actually fit the position. */
function describeCost(verdict: Verdict): string {
  if (verdict.stalemate) {
    return verdict.mateIn === undefined
      ? 'That is stalemate — a draw, not a win.'
      : `That is stalemate. It is a draw, and mate in ${verdict.mateIn} was there.`;
  }
  if (verdict.missesMate) {
    if (verdict.mateLater !== undefined) {
      return `That mates ${verdict.mateLater} moves slower than it needed to.`;
    }
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

/** The piece a promotion button stands for, as chessground names roles. */
function roleOf(button: Element): string {
  return button.getAttribute('data-role') === 'r'
    ? 'rook'
    : button.getAttribute('data-role') === 'b'
      ? 'bishop'
      : button.getAttribute('data-role') === 'n'
        ? 'knight'
        : 'queen';
}

/** The same choice as UCI writes it. */
function roleLetter(button: Element): string {
  return button.getAttribute('data-role') ?? 'q';
}

async function main(): Promise<void> {
  const engine = new Engine(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`);
  const cache = new PositionCache();
  const stats = new Stats();
  /** What you got wrong in *this* game, saved and reopened along with it. */
  const memory = new MistakeMemory();
  const library = new GameLibrary();
  let settings = loadSettings();
  let tree = new GameTree();

  /** The colour you play. The bot takes the other one. */
  let you: Color = settings.playAs;

  let mode: Mode = { kind: 'play' };
  let thinking = true;
  let blundersLeft = settings.blundersPerGame;
  let spotted = 0;
  let missed = 0;
  /** Your own moves that got you stopped, counted once each however often tried. */
  let made = 0;
  /** Bot errors you have been shown, so the move list can mark them. */
  const revealed = new Set<number>();
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
   * Evaluations that came back with a loaded game, by node.
   *
   * Kept apart from the search cache rather than poured into it: a stored
   * evaluation is a number without a line behind it, and the cache is what the
   * arrows and the judging read from.
   */
  let savedEvals = new Map<number, SavedEval>();
  /**
   * The saved game this one *is*, when it came from the library.
   *
   * While set, playing on keeps the stored copy in step, so a branch you explore
   * after reopening a game is still there the next time you open it.
   */
  let openGameId: string | undefined;
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
  const games = mountLibrary(element('games'), library, {
    onLoad: id => {
      void openGame(id);
    },
    onRename: (id, name) => {
      library.rename(id, name);
      games.render();
    },
    onDelete: id => {
      library.remove(id);
      if (openGameId === id) openGameId = undefined;
      games.render();
    },
    onFavourite: (id, favourite) => {
      library.setFavourite(id, favourite);
      games.render();
    },
  });
  const appearance = mountAppearance(element('appearance'), settings, changed => {
    settings = changed;
    saveSettings(settings);
    applyAppearance();
  });
  const panel = mountSettings(element('settings'), settings, changed => {
    // Raising the allowance mid-game should make more errors possible, not fewer.
    blundersLeft += changed.blundersPerGame - settings.blundersPerGame;
    settings = changed;
    saveSettings(settings);
  });

  applyAppearance();

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

  /**
   * What to spend on the position in front of us.
   *
   * Less in the opening, where the first search of the game is also the slowest
   * one anybody waits for and the one a shallow look serves best.
   */
  function budget(): Budget {
    return tree.current.ply < OPENING_PLIES ? OPENING : SEARCH;
  }

  /** Start thinking about a position nobody has asked about yet. */
  function warm(fen: string): void {
    void analyse(fen, budget()).catch(() => undefined);
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
    renderGame();
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
      // autoShapes, not shapes: the plain kind is the player's own drawing and
      // chessground wipes it the moment a piece is touched, which took the
      // remembered mistakes off the board as soon as you reached for a reply.
      // These also have to travel in the same call as the fen, since setting a
      // position clears what is drawn on it.
      drawable: {
        autoShapes: readable([
          ...(mode.kind === 'rejected' ? rejectedShapes(mode.attempts) : []),
          ...rememberedShapes(fen, mode.kind === 'rejected' ? mode.attempts : []),
          // The explanation and the review both draw the engine's answers; the
          // difference is that one of them you asked for a moment ago.
          ...(reviewing || (mode.kind === 'rejected' && mode.shown) ? bestArrows(fen) : []),
          ...(mode.kind === 'rejected' && mode.shown ? cageShapes(mode.attempts) : []),
        ]),
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
   * The evaluation bar above the board.
   *
   * Shown only with the review open, and only for a position already searched.
   * Step off the reviewed game into something new and it goes away, because the
   * alternative is either a stale number from the wrong position or a fresh one
   * that answers the question you are in the middle of asking.
   */
  function renderEval(fen: string): void {
    evaluateBox.hidden = !reviewing;
    const best = reviewing ? (evalOf(fen) ?? savedEvals.get(tree.current.id)) : undefined;
    evalBar.classList.toggle('showing', !!best);
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

    evalFill.style.width = `${share}%`;
    evalText.textContent = formatEval(whiteCp, whiteMate);
    // The label sits at the right-hand end, which is dark until your share grows
    // far enough to reach it.
    evalText.classList.toggle('over', share > 85);
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
      .map(mistake => rememberedArrow(mistake.uci, mistake));
  }

  /**
   * The ring of squares around the stalemated king.
   *
   * Told "that misses mate in 2" while every arrow on the board says #2, a
   * stalemate is baffling. Drawing the squares the king cannot go to says what
   * actually happened.
   */
  function cageShapes(attempts: readonly Attempt[]): DrawShape[] {
    const stalemated = attempts.find(attempt => attempt.verdict.stalemate);
    if (!stalemated) return [];
    try {
      const cage = stalemateCage(fenAfter(tree.fen, stalemated.uci));
      if (!cage) return [];
      return [
        { orig: cage.king as Key, brush: 'blue' },
        ...cage.blocked.map((square): DrawShape => ({ orig: square as Key, brush: 'paleBlue' })),
      ];
    } catch {
      return [];
    }
  }

  function renderButtons(): void {
    buttons.first.toggleAttribute('disabled', tree.atStart);
    buttons.back.toggleAttribute('disabled', tree.atStart);
    // Forward still has something to do at the end of a line when the bot owes a
    // move; without that, stepping back into the bot's turn is a dead end.
    const botOwesAMove = tree.atLeaf && tree.turn !== you && !outcomeOf(tree.fen) && !thinking;
    buttons.forward.toggleAttribute('disabled', tree.atLeaf && !botOwesAMove);
    buttons.last.toggleAttribute('disabled', tree.atLeaf);

    const stopped = mode.kind === 'rejected';
    const showing = mode.kind === 'rejected' && mode.shown;
    // The stamp follows the mode rather than the other way round, so stepping
    // out of the branch it was asked for turns it off here too.
    punishToggle.checked = punishing();
    keepToggle.checked = settings.saveOnNew;
    buttons.reveal.hidden = !stopped;
    // A toggle, not a door: the board stays yours while the answer is showing.
    buttons.reveal.textContent = showing ? 'Hide' : 'Show me';
    buttons.punish.hidden = !stopped;
    buttons.ignore.hidden = !stopped;

    // Only meaningful standing on a move the bot made: that is the one to replace.
    const onBotMove = tree.current.move !== undefined && tree.current.move.by !== you;
    buttons.another.hidden = stopped || thinking || !onBotMove;
    buttons.review.toggleAttribute('disabled', tree.root.children.length === 0 && !reviewing);
    buttons.review.textContent = reviewing ? 'Close review' : 'Review game';
  }

  function updateScore(): void {
    scoreEl.textContent = `spotted ${spotted} · missed ${missed} · made ${made}`;
    const yours = stats.summary('you');
    const theirs = stats.summary('bot');
    const mates =
      yours.mates === 0 ? '' : ` · ${yours.mates} mate${yours.mates === 1 ? '' : 's'} missed`;
    acplEl.textContent =
      yours.moves === 0 ? '' : `you ${yours.acpl} cp${mates} · bot ${theirs.acpl} cp`;
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
    if (thinking) return false;
    return tree.turn === you && !outcomeOf(tree.fen);
  }

  function liveStatus(): string {
    const over = outcomeOf(tree.fen);
    if (over)
      return over.winner ? `${over.reason} — ${over.winner} wins.` : `Draw: ${over.reason}.`;
    if (thinking) return 'Thinking…';
    // Never claim you can move in a position where it is not your turn: that is
    // the difference between browsing and being stuck.
    if (tree.turn !== you) return 'Bot to move here — press ▶ to let it play.';
    return tree.atLeaf ? 'Your move.' : 'Browsing. Play a move to branch from here.';
  }

  /** Put a position on the board, leaving whatever the engine was doing behind. */
  function goTo(id: number): void {
    interrupt();
    tree.goTo(id);
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
    // Forward at the end of a line where the bot has not moved yet: there is no
    // recorded next move, so playing one is the only thing forward can mean.
    if (delta > 0 && !thinking && tree.atLeaf && tree.turn !== you && !outcomeOf(tree.fen)) {
      void botTurn();
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
    savedEvals = new Map();
    openGameId = undefined;
    stats.reset();
    // Last game's mistakes belong to last game. Openings repeat, and painting
    // them onto a board you have only just set up says nothing about this game.
    memory.clear();
    revealed.clear();
    blundersLeft = settings.blundersPerGame;
    spotted = 0;
    missed = 0;
    made = 0;
    mode = { kind: 'play' };
    closeReview();
    moves = mountMoves(element('moves'), tree, { onSelect: goTo, revealed });
    panel.update(settings);
    appearance.update(settings);
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
    const fen = tree.fen;
    thinking = true;
    lockBoard();
    const uci = await withPromotion(orig, dest);
    if (uci === undefined) {
      // Changed your mind at the promotion picker. The pawn is already on the
      // last rank as far as the board is concerned, so put it back.
      thinking = false;
      render();
      return;
    }

    // Say so at once. Judging takes a moment even when it is quick, and on a
    // cold engine on a phone it takes several -- during which the board was
    // locked, the piece had moved, and the status still read "Your move".
    status('Checking…');

    try {
      const lines = await analyse(fen, budget());
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
      if (verdict) {
        stats.add(
          'you',
          verdict.cpLoss,
          verdict.winLoss,
          verdict.missesMate || verdict.hangsMate || verdict.stalemate,
        );
      }

      if (verdict && isError(verdict, thresholds)) {
        thinking = false;
        stopYou(uci, verdict);
        updateScore();
        return;
      }

      if (tree.punishArmed) {
        spotted++;
        // You found it, so marking it in the list gives nothing away, and it is
        // the position you will want to come back to.
        revealed.add(tree.current.id);
        status('Good — you saw it.');
      }
      accept(uci);
    } catch (error) {
      if (!isCancelled(error)) fail(error);
    }
  }

  /** Play your move and hand over to the bot. */
  function accept(uci: string, playedAnyway = false): void {
    // Carrying on from a reviewed position puts you back in a game, and the
    // engine's answers must stop being drawn the moment that happens.
    if (reviewing) closeReview();
    tree.play(uci);
    if (playedAnyway) tree.markPlayedAnyway();
    mode = { kind: 'play' };
    updateScore();
    syncSaved();
    void botTurn();
  }

  /** The interruption: the move comes back, drawn in red, with nothing explained. */
  function stopYou(uci: string, verdict: Verdict): void {
    const previous = mode.kind === 'rejected' ? mode.attempts : [];
    // Counted per move rather than per try: playing the same wrong move twice is
    // one mistake made twice, and the memory already counts the repetition.
    if (!previous.some(attempt => attempt.uci === uci)) made++;
    // Keep every attempt: two wrong tries are two different misunderstandings.
    const attempts = [...previous.filter(attempt => attempt.uci !== uci), { uci, verdict }];
    // A fresh mistake hides the previous explanation: it was about another move.
    mode = { kind: 'rejected', attempts, shown: false };

    // Remembered against the position, so it comes back the next time you are
    // here -- next game, or next month.
    memory.record(tree.fen, {
      uci,
      san: sanOf(tree.fen, uci),
      cpLoss: verdict.cpLoss,
      missesMate: verdict.missesMate,
      hangsMate: verdict.hangsMate,
      stalemate: verdict.stalemate,
      mateIn: verdict.mateIn,
      mateLater: verdict.mateLater,
    });
    // The mistake is part of the game's record, so the stored copy wants it too.
    syncSaved();

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
    if (mode.shown) {
      mode = { ...mode, shown: false };
      status('Your move — try again.');
      render();
      return;
    }
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
    mode = { kind: 'rejected', attempts, shown: true };
    render();
  }

  /**
   * Play the move you were stopped for anyway.
   *
   * `punish` makes the bot answer with best moves from here on, so you get to
   * watch the refutation actually land instead of being told about it.
   */
  function playAnyway(punish: boolean): void {
    const attempts = mode.kind === 'rejected' ? mode.attempts : [];
    const chosen = attempts.at(-1);
    if (!chosen) return;
    tree.play(chosen.uci);
    tree.markPlayedAnyway(punish);
    if (!punish) tree.stopPunishing();
    mode = { kind: 'play' };
    syncSaved();
    status(punish ? 'Right — watch how that gets punished.' : 'Playing it anyway.');
    void botTurn();
  }

  /**
   * Ask for a different move in this position.
   *
   * Steps back over the bot's move and asks again, excluding everything already
   * played from there, so each press opens another branch rather than repeating
   * itself or quietly returning the same move.
   */
  async function anotherMove(): Promise<void> {
    const replacing = tree.current;
    if (!replacing.move || replacing.move.by === you) return;

    interrupt();
    const from = replacing.parent ?? tree.root;
    tree.goTo(from.id);
    const tried = new Set(from.children.flatMap(child => (child.move ? [child.move.uci] : [])));
    await botTurn(tried);
  }

  async function botTurn(exclude?: ReadonlySet<string>): Promise<void> {
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
      const lines = await analyse(fen, budget());
      const move = await chooseMove(
        {
          search: position => analyse(position, budget()),
          searchWide: position => analyse(position, WIDE),
          probe: position => analyse(position, PROBE),
          settings,
        } satisfies Policy,
        fen,
        lines,
        // While punishing, the bot plays the best move and nothing else.
        punishing()
          ? { wantsError: false, acpl: Number.POSITIVE_INFINITY, exclude, avoid: seenPositions() }
          : {
              wantsError: wantsError(),
              acpl: stats.acpl('bot'),
              exclude,
              avoid: seenPositions(),
            },
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
      syncSaved();
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
    return tree.punishing;
  }

  /**
   * The positions this line could still repeat.
   *
   * Only this line -- the same position down another branch was never repeated
   * here -- and only back as far as the last pawn move or capture. Both are
   * irreversible, so nothing before the last one can come round again, and the
   * halfmove clock in the FEN says exactly how many plies that is. In an
   * ordinary middlegame that is a handful of positions rather than the game.
   */
  function seenPositions(): Set<number> {
    const path = tree.path;
    const reversible = halfmoveClock(tree.fen);
    return new Set(
      path.slice(Math.max(0, path.length - 1 - reversible)).map(node => positionHash(node.fen)),
    );
  }

  function wantsError(): boolean {
    if (blundersLeft <= 0 || tree.current.ply < settings.blunderFromPly) return false;
    return Math.random() < settings.blunderChance;
  }

  /**
   * Put the chosen set on the board.
   *
   * A class rather than a stylesheet swap: chessground only ever adds classes to
   * the element it was given, so this survives everything it does to the board.
   */
  function applyAppearance(): void {
    const board = element('board');
    for (const set of PIECE_SETS) board.classList.toggle(`set-${set}`, set === settings.pieceSet);
    for (const theme of BOARD_THEMES) {
      board.classList.toggle(`board-${theme}`, theme === settings.boardTheme);
    }
  }

  /** Stop accepting moves without touching the position already on the board. */
  function lockBoard(): void {
    board.set({ movable: { color: you, dests: noDests() } });
    renderButtons();
  }

  /**
   * Work out the move, asking which piece to promote to when it matters.
   *
   * Chessground has already moved the pawn by the time this runs, so the board
   * shows the square in question while you choose.
   */
  async function withPromotion(orig: Key, dest: Key): Promise<string | undefined> {
    const piece = board.state.pieces.get(dest);
    const lastRank = dest.endsWith('8') || dest.endsWith('1');
    if (piece?.role !== 'pawn' || !lastRank) return orig + dest;
    const role = await askPromotion(dest);
    return role === undefined ? undefined : orig + dest + role;
  }

  /**
   * Show the pieces on the file the pawn reached and wait.
   *
   * Resolves with the piece letter, or undefined if you changed your mind --
   * the pawn is already sitting on the last rank by now, so backing out has to
   * be possible.
   */
  function askPromotion(dest: Key): Promise<string | undefined> {
    // Files run left to right from White's side and the other way from Black's.
    const file = dest.charCodeAt(0) - 'a'.charCodeAt(0);
    const column = you === 'white' ? file : 7 - file;
    // The choices hang from whichever edge the pawn just reached.
    const atTop = you === 'white' ? dest.endsWith('8') : dest.endsWith('1');

    promotionChoices.style.setProperty('--promotion-file', String(column));
    promotionChoices.classList.toggle('from-top', atTop);
    promotionChoices.classList.toggle('from-bottom', !atTop);

    const buttons = [...promotionChoices.querySelectorAll('button')];
    for (const button of buttons) {
      // The promoting side's pieces, not always White's.
      button.querySelector('piece')?.setAttribute('class', `${roleOf(button)} ${you}`);
    }
    promotionBox.hidden = false;

    return new Promise(resolve => {
      const finish = (role: string | undefined) => () => {
        promotionBox.hidden = true;
        for (const button of buttons) button.onclick = null;
        promotionVeil.onclick = null;
        resolve(role);
      };
      for (const button of buttons) button.onclick = finish(roleLetter(button));
      promotionVeil.onclick = finish(undefined);
    });
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

  // ------------------------------------------------------------ saved games

  /** The game as it stands, in the shape the library stores. */
  function currentGame(): NewGame {
    const yours = stats.summary('you');
    const theirs = stats.summary('bot');
    const rootEval = evalOf(tree.root.fen);
    return {
      name: defaultName(),
      playedAs: you,
      settings,
      metrics: {
        moves: tree.nodes.length - 1,
        youAcpl: yours.acpl,
        botAcpl: theirs.acpl,
        spotted,
        missed,
        made,
      },
      start: tree.root.fen,
      ...(rootEval ? { rootEval } : {}),
      nodes: serialiseTree(tree, node => evalOf(node.fen) ?? savedEvals.get(node.id)),
      // Every position you were stopped in, so reopening the game draws them
      // back onto the board exactly where they happened.
      mistakes: memory.toStored(),
      // And everything the engine worked out, so reopening costs no searching.
      cache: cache.toStored(),
    };
  }

  /** Store the game as it stands, evaluations and all. */
  function saveGame(): void {
    if (tree.root.children.length === 0) {
      status('Nothing to save yet.');
      return;
    }
    const saved = library.save(currentGame());
    // From here on it keeps itself up to date.
    openGameId = saved.id;
    games.render();
    status(`Saved as “${saved.name}”. Rename it under Saved games.`);
  }

  /**
   * Keep the stored copy in step with the game being played.
   *
   * Called whenever the game changes rather than on a timer: a branch explored
   * after reopening a game should be there next time without anyone having to
   * remember to press save.
   */
  function syncSaved(): void {
    if (openGameId === undefined || tree.root.children.length === 0) return;
    if (!library.update(openGameId, currentGame())) {
      // It was deleted while being played; stop pretending it is still there.
      openGameId = undefined;
      return;
    }
    games.render();
  }

  /** What a position is worth, from whatever the engine happens to have said. */
  function evalOf(fen: string): SavedEval | undefined {
    const best = cache.best(fen);
    return best ? { cp: best.cp, mate: best.mate } : undefined;
  }

  function defaultName(): string {
    const opening = tree.mainline
      .slice(1, 5)
      .flatMap(node => (node.move ? [node.move.san] : []))
      .join(' ');
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return opening.length > 0 ? `${opening} — ${date}` : `Game — ${date}`;
  }

  /** Reopen a saved game, with everything that was known about it. */
  async function openGame(id: string): Promise<void> {
    const game = library.find(id);
    if (!game) return;
    interrupt();

    const restored = restoreTree(game);
    tree = restored.tree;
    savedEvals = restored.evals;
    openGameId = game.id;
    // Everything the engine knew about this game, back as it was.
    cache.restore(game.cache);
    stats.reset();
    memory.restore(game.mistakes);
    revealed.clear();
    spotted = game.metrics.spotted;
    missed = game.metrics.missed;
    made = game.metrics.made;
    you = game.playedAs;
    mode = { kind: 'play' };
    closeReview();
    moves = mountMoves(element('moves'), tree, { onSelect: goTo, revealed });
    board.set({ orientation: you });
    updateScore();
    status(`Opened “${game.name}”. Play on from anywhere.`);
    await handOver();
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
      savedEvals = new Map();
      openGameId = undefined;
      stats.reset();
      memory.clear();
      revealed.clear();
      spotted = 0;
      missed = 0;
      made = 0;
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

  function wireControls(): void {
    buttons.first.onclick = () => {
      interrupt();
      tree.first();
      goTo(tree.current.id);
    };
    buttons.last.onclick = () => {
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
    buttons.another.onclick = () => {
      void anotherMove();
    };
    buttons.swap.onclick = () => {
      void swapSides();
    };
    punishToggle.onchange = () => {
      // Switching it on means "from here", the same as asking to be punished;
      // switching it off means now, wherever you are.
      if (punishToggle.checked) tree.startPunishing();
      else tree.stopPunishing();
      syncSaved();
      status(
        punishToggle.checked ? 'Punishing: best moves only from here.' : 'Back to normal play.',
      );
      render();
    };
    keepToggle.onchange = () => {
      settings = withSaveOnNew(settings, keepToggle.checked);
      saveSettings(settings);
      status(
        keepToggle.checked
          ? 'New games will keep the one before.'
          : 'New games will discard the one before.',
      );
      render();
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
    buttons.saveGame.onclick = saveGame;
    buttons.clearAnalysis.onclick = () => {
      library.clearAnalysis();
      games.render();
      status('Stored analysis cleared. Saved games will re-search when reopened.');
    };
    buttons.pgnExport.onclick = exportPgn;
    buttons.pgnImport.onclick = () => {
      importPgn(pgnText.value);
    };
    buttons.expandMoves.onclick = () => {
      const movesEl = element('moves');
      const expanded = movesEl.classList.toggle('expanded');
      buttons.expandMoves.textContent = expanded ? 'Show less' : 'Show more';
      buttons.expandMoves.setAttribute('aria-expanded', String(expanded));
      // Bring the current move back into view: the box just changed height
      // underneath it.
      moves.render();
    };
    buttons.forget.onclick = () => {
      memory.clear();
      status('Forgotten. Nothing held against you in this game.');
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
