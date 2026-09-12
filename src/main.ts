import './style.css';

import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';

import { type Policy, chooseMove } from './bot.ts';
import { INITIAL_FEN, fenAfter, legalDests, noDests, outcomeOf, sanLine, turnOf } from './chess.ts';
import { Engine } from './engine.ts';
import { History } from './history.ts';
import { MISSED_PUNISH, OWN_BLUNDER, type Verdict, isError, judge } from './referee.ts';

/** The colour you play. */
const YOU = 'white';
/** Budget for move selection and for judging your move. */
const SEARCH = { multiPV: 8, nodes: 1_000_000 } as const;
/** A deeper budget, used before accusing you of anything. */
const VERIFY = { multiPV: 8, nodes: 4_000_000 } as const;
/** Deliberate errors start once the opening is over. */
const BLUNDER_FROM_PLY = 16;
/** Roughly this many deliberate errors per game. */
const BLUNDERS_PER_GAME = 3;
/** Chance of erring on any given eligible move. */
const BLUNDER_CHANCE = 0.25;
/** How many moves of the best line the reveal lets you step through. */
const REVEAL_DEPTH = 8;

/**
 * What the board is showing.
 *
 * `rejected` is your move taken back and drawn in red, with nothing explained
 * yet. `analysis` is the reveal: the best line, steppable move by move.
 */
type Mode =
  | { readonly kind: 'play' }
  | { readonly kind: 'rejected'; readonly uci: string; readonly verdict: Verdict }
  | {
      readonly kind: 'analysis';
      readonly base: string;
      readonly yourMove: string;
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
const movesEl = element('moves');
const buttons = {
  first: element('first'),
  back: element('back'),
  forward: element('forward'),
  last: element('last'),
  reveal: element('reveal'),
  resume: element('resume'),
  fork: element('fork'),
};

const square = (uci: string, end: 0 | 2): Key => uci.slice(end, end + 2) as Key;
const arrow = (uci: string, brush: string): DrawShape => ({
  orig: square(uci, 0),
  dest: square(uci, 2),
  brush,
});

function status(text: string, alarm = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('alarm', alarm);
}

async function main(): Promise<void> {
  const engine = new Engine(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`);
  const policy: Policy = { search: fen => engine.analyse(fen, SEARCH) };
  const history = new History(INITIAL_FEN);

  let mode: Mode = { kind: 'play' };
  let thinking = true;
  let blundersLeft = BLUNDERS_PER_GAME;
  let retries = 0;
  let spotted = 0;
  let missed = 0;
  /** Indices of the bot's errors you have been shown, for the move list. */
  const revealed = new Set<number>();
  /** Analysis of the live position, started while you are thinking. */
  let pending = Promise.resolve<Awaited<ReturnType<typeof engine.analyse>>>([]);

  const board: Api = Chessground(element('board'), {
    fen: INITIAL_FEN,
    orientation: YOU,
    movable: {
      free: false,
      showDests: true,
      dests: noDests(),
      events: { after: (orig, dest) => void onUserMove(orig, dest) },
    },
    animation: { duration: 200 },
    draggable: { showGhost: true },
    drawable: { enabled: true },
  });

  status('Loading engine…');
  await engine.init();
  await engine.newGame();
  thinking = false;
  pending = engine.analyse(history.fen, SEARCH);
  status('Your move.');
  render();

  wireControls();

  // ---------------------------------------------------------------- rendering

  function render(): void {
    if (mode.kind === 'analysis') renderAnalysis(mode);
    else renderGame();
    renderMoves();
    renderButtons();
  }

  function renderGame(): void {
    const fen = history.fen;
    const last = history.lastMove;
    const movable = canMove();
    board.set({
      fen,
      turnColor: turnOf(fen),
      // Highlight whichever side just moved, not only yours.
      ...(last ? { lastMove: [square(last.uci, 0), square(last.uci, 2)] } : { lastMove: [] }),
      movable: { color: YOU, dests: movable ? legalDests(fen) : noDests() },
      // Shapes must go in the same call as the fen: chessground clears them
      // whenever a position is set.
      drawable: { shapes: mode.kind === 'rejected' ? rejectedShapes(mode.uci) : [] },
    });
  }

  /** Your move in red, so it is unmistakably the thing being complained about. */
  function rejectedShapes(uci: string): DrawShape[] {
    return [arrow(uci, 'red'), { orig: square(uci, 2), brush: 'red' }];
  }

  function renderAnalysis(view: Extract<Mode, { kind: 'analysis' }>): void {
    const played = view.line.slice(0, view.step);
    const fen = played.reduce((position, uci) => fenAfter(position, uci), view.base);
    const next = view.line[view.step];
    const previous = view.step > 0 ? view.line[view.step - 1] : undefined;

    const shapes: DrawShape[] = [];
    // At the start, show the mistake and the answer side by side.
    if (view.step === 0) shapes.push(...rejectedShapes(view.yourMove));
    if (next) shapes.push(arrow(next, view.step === 0 ? 'green' : 'blue'));

    board.set({
      fen,
      turnColor: turnOf(fen),
      ...(previous ? { lastMove: [square(previous, 0), square(previous, 2)] } : { lastMove: [] }),
      movable: { color: YOU, dests: noDests() },
      drawable: { shapes },
    });
  }

  function renderMoves(): void {
    movesEl.replaceChildren();
    history.plies.forEach((ply, index) => {
      if (ply.by === 'white') {
        const number = document.createElement('li');
        number.className = 'number';
        number.textContent = `${Math.floor(index / 2) + 1}.`;
        movesEl.append(number);
      }
      const item = document.createElement('li');
      item.textContent = ply.san;
      if (index + 1 === history.cursor && mode.kind !== 'analysis') item.classList.add('current');
      // Only mark an error you have actually been shown.
      if (ply.deliberateError && revealed.has(index)) item.classList.add('error');
      item.onclick = () => {
        goTo(index + 1);
      };
      movesEl.append(item);
    });
    movesEl.scrollTop = movesEl.scrollHeight;
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
      buttons.first.toggleAttribute('disabled', history.atStart);
      buttons.back.toggleAttribute('disabled', history.atStart);
      buttons.forward.toggleAttribute('disabled', history.atLive);
      buttons.last.toggleAttribute('disabled', history.atLive);
    }
    buttons.reveal.hidden = mode.kind !== 'rejected';
    buttons.resume.hidden = !analysing;
    // Offer to continue from an earlier position only when there is something
    // to discard and you are not in the middle of being corrected.
    buttons.fork.hidden = analysing || history.atLive || thinking;
  }

  /** Stop accepting moves without touching the position already on the board. */
  function lockBoard(): void {
    board.set({ movable: { color: YOU, dests: noDests() } });
    renderButtons();
  }

  function updateScore(): void {
    scoreEl.textContent = `spotted ${spotted} · missed ${missed}`;
  }

  // ---------------------------------------------------------------- navigation

  function canMove(): boolean {
    return !thinking && mode.kind !== 'analysis' && history.turn === YOU && !outcomeOf(history.fen);
  }

  function goTo(index: number): void {
    if (mode.kind === 'analysis') return;
    // Leaving the position drops the correction; the red arrow belongs to it.
    mode = { kind: 'play' };
    retries = 0;
    history.goTo(index);
    status(
      history.atLive ? liveStatus() : `Browsing — move ${history.cursor} of ${history.length}.`,
    );
    render();
  }

  function liveStatus(): string {
    const over = outcomeOf(history.fen);
    if (over)
      return over.winner ? `${over.reason} — ${over.winner} wins.` : `Draw: ${over.reason}.`;
    return history.turn === YOU ? 'Your move.' : 'Thinking…';
  }

  function step(delta: number): void {
    if (mode.kind === 'analysis') {
      const next = Math.max(0, Math.min(mode.step + delta, mode.line.length));
      mode = { ...mode, step: next };
      render();
      return;
    }
    goTo(history.cursor + delta);
  }

  function wireControls(): void {
    buttons.first.onclick = () => {
      if (mode.kind === 'analysis') mode = { ...mode, step: 0 };
      else history.first();
      goToRendered();
    };
    buttons.last.onclick = () => {
      if (mode.kind === 'analysis') mode = { ...mode, step: mode.line.length };
      else history.last();
      goToRendered();
    };
    buttons.back.onclick = () => {
      step(-1);
    };
    buttons.forward.onclick = () => {
      step(1);
    };
    buttons.reveal.onclick = () => {
      if (mode.kind === 'rejected') reveal(mode.uci, mode.verdict);
    };
    buttons.resume.onclick = () => {
      mode = { kind: 'play' };
      status('Your move — try again.');
      render();
    };
    buttons.fork.onclick = () => {
      void forkHere();
    };

    document.addEventListener('keydown', event => {
      const keys: Record<string, () => void> = {
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
      const action = keys[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    });
  }

  /** Apply a navigation that has already been made to the model. */
  function goToRendered(): void {
    if (mode.kind !== 'analysis') {
      mode = { kind: 'play' };
      retries = 0;
      status(
        history.atLive ? liveStatus() : `Browsing — move ${history.cursor} of ${history.length}.`,
      );
    }
    render();
  }

  /** Abandon everything after the position you are looking at and play on. */
  async function forkHere(): Promise<void> {
    history.truncate();
    mode = { kind: 'play' };
    retries = 0;
    status('Playing on from here.');
    render();
    if (history.turn === YOU) {
      pending = engine.analyse(history.fen, SEARCH);
      status('Your move.');
      render();
      return;
    }
    await botTurn();
  }

  // ----------------------------------------------------------------- the game

  async function onUserMove(orig: Key, dest: Key): Promise<void> {
    if (!canMove()) return;
    const uci = withPromotion(orig, dest);
    thinking = true;
    lockBoard();

    // Forking: playing from an earlier position discards the continuation, so
    // the analysis started for the live position no longer applies.
    const lines = history.atLive ? await pending : await engine.analyse(history.fen, SEARCH);
    const thresholds = history.punishArmed ? MISSED_PUNISH : OWN_BLUNDER;
    const quick = judge(lines, uci);

    if (quick && isError(quick, thresholds)) {
      // Never accuse on a shallow search. A false alarm is the worst failure
      // this app has, so confirm it deeper before interrupting.
      status('Hmm — let me look again…');
      const deep = judge(await engine.analyse(history.fen, VERIFY), uci);
      if (deep && isError(deep, thresholds)) {
        thinking = false;
        stopYou(uci, deep);
        return;
      }
    }

    if (history.punishArmed) {
      spotted++;
      updateScore();
    }
    history.play(uci);
    retries = 0;
    await botTurn();
  }

  /** The interruption: first a nudge carrying nothing, then the reveal. */
  function stopYou(uci: string, verdict: Verdict): void {
    retries++;
    mode = { kind: 'rejected', uci, verdict };
    status(
      retries === 1
        ? verdict.missesMate || verdict.hangsMate
          ? 'Wait — look again. There is something forced here.'
          : history.punishArmed
            ? 'Wait. I just gave you something, and that move lets it go. Look again.'
            : 'Wait. Are you sure about that move? Have another look.'
        : 'Still not it. Take the hint, or ask to be shown.',
      true,
    );
    render();
  }

  /** Show what the move cost and let the best line be played out on the board. */
  function reveal(uci: string, verdict: Verdict): void {
    if (history.punishArmed) {
      missed++;
      updateScore();
      revealed.add(history.cursor - 1);
    }
    const line = verdict.best.moves.slice(0, REVEAL_DEPTH);
    const sans = sanLine(history.fen, line);
    status(`${describeCost(verdict)} Best was ${sans[0] ?? '?'} — ${sans.join(' ')}`);
    mode = { kind: 'analysis', base: history.fen, yourMove: uci, line, step: 0 };
    render();
  }

  async function botTurn(): Promise<void> {
    thinking = true;
    mode = { kind: 'play' };
    status('Thinking…');
    render();

    if (outcomeOf(history.fen)) {
      thinking = false;
      status(liveStatus());
      render();
      return;
    }

    const lines = await engine.analyse(history.fen, SEARCH);
    const move = await chooseMove(policy, history.fen, lines, wantsError());
    if (!move) {
      thinking = false;
      status('The engine sees no move here.');
      render();
      return;
    }
    if (move.deliberateError) blundersLeft--;

    // Say nothing about it. Spotting it is the whole point.
    history.play(move.uci, { deliberateError: move.deliberateError });
    thinking = false;
    pending = engine.analyse(history.fen, SEARCH);
    status(liveStatus());
    render();
  }

  function wantsError(): boolean {
    if (blundersLeft <= 0 || history.length < BLUNDER_FROM_PLY) return false;
    return Math.random() < BLUNDER_CHANCE;
  }

  function withPromotion(orig: Key, dest: Key): string {
    // Auto-queen for now; a promotion picker is a later refinement.
    const piece = board.state.pieces.get(dest);
    const lastRank = dest.endsWith('8') || dest.endsWith('1');
    return orig + dest + (piece?.role === 'pawn' && lastRank ? 'q' : '');
  }
}

/** Say what the move cost, in the terms that actually fit the position. */
function describeCost(verdict: Verdict): string {
  if (verdict.missesMate) return 'That lets a forced mate slip.';
  if (verdict.hangsMate) return 'That walks into a forced mate.';
  return (
    `That costs ${(verdict.cpLoss / 100).toFixed(1)} pawns, ` +
    `about ${verdict.winLoss.toFixed(0)}% of your winning chances.`
  );
}

main().catch((error: unknown) => {
  status(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});
