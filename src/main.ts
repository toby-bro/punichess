import './style.css';

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';

import { type Policy, chooseMove } from './bot.ts';
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
import { Engine } from './engine.ts';
import {
  MISSED_PUNISH,
  OWN_BLUNDER,
  type Thresholds,
  type Verdict,
  isError,
  judge,
} from './referee.ts';
import type { PvLine } from './uci.ts';

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

interface State {
  fen: string;
  ply: number;
  /** Analysis of the current position, started while you are thinking. */
  pending: Promise<PvLine[]>;
  /** Armed after the bot erred on purpose: your next move is judged strictly. */
  punishArmed: boolean;
  /** How many times you have been sent back on this move. */
  retries: number;
  blundersLeft: number;
  spotted: number;
  missed: number;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found;
}

const statusEl = element('status');
const scoreEl = element('score');
const revealButton = element('giveup');

const status = (text: string): void => {
  statusEl.textContent = text;
};

async function main(): Promise<void> {
  const engine = new Engine(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`);
  const policy: Policy = { search: fen => engine.analyse(fen, SEARCH) };

  const board = Chessground(element('board'), {
    fen: INITIAL_FEN,
    orientation: YOU,
    movable: { free: false, showDests: true, dests: noDests() },
    animation: { duration: 200 },
    draggable: { showGhost: true },
  });

  status('Loading engine…');
  await engine.init();
  await engine.newGame();

  const state: State = {
    fen: INITIAL_FEN,
    ply: 0,
    pending: engine.analyse(INITIAL_FEN, SEARCH),
    punishArmed: false,
    retries: 0,
    blundersLeft: BLUNDERS_PER_GAME,
    spotted: 0,
    missed: 0,
  };

  board.set({
    movable: { events: { after: (from, to) => void onUserMove(from, to) } },
  });
  yourTurn();

  /** Hand the board back to you, and start thinking about the position meanwhile. */
  function yourTurn(): void {
    if (finished()) return;
    state.pending = engine.analyse(state.fen, SEARCH);
    board.set({
      fen: state.fen,
      turnColor: YOU,
      movable: { color: YOU, dests: legalDests(state.fen) },
    });
  }

  async function onUserMove(from: Key, to: Key): Promise<void> {
    board.set({ movable: { dests: noDests() } });
    const uci = withPromotion(from, to);
    const lines = await state.pending;

    const thresholds: Thresholds = state.punishArmed ? MISSED_PUNISH : OWN_BLUNDER;
    const quick = judge(lines, uci);

    if (quick && isError(quick, thresholds)) {
      // Never accuse on a shallow search. A false alarm is the worst failure
      // this app has, so confirm it deeper before interrupting.
      status('Hmm — let me look again…');
      const deep = judge(await engine.analyse(state.fen, VERIFY), uci);
      if (deep && isError(deep, thresholds)) {
        stopYou(uci, deep);
        return;
      }
    }

    if (state.punishArmed) {
      state.spotted++;
      status(`Good — you saw it. (${sanOf(state.fen, uci)})`);
    }
    commit(uci);
    state.punishArmed = false;
    state.retries = 0;
    await botTurn();
  }

  /** The interruption: first a nudge carrying no information, then the reveal. */
  function stopYou(uci: string, verdict: Verdict): void {
    state.retries++;
    board.set({ fen: state.fen });

    if (state.retries === 1) {
      status(
        state.punishArmed
          ? 'Wait. I just gave you something — are you sure about that move?'
          : 'Wait. Are you sure about that move? Have another look.',
      );
      showReveal(() => {
        reveal(uci, verdict);
      });
      yourTurn();
      return;
    }
    reveal(uci, verdict);
  }

  function reveal(uci: string, verdict: Verdict): void {
    if (state.punishArmed) state.missed++;
    const best = verdict.best;
    const line = sanLine(state.fen, best.moves.slice(0, 8));
    status(
      `${sanOf(state.fen, uci)}: ${describeCost(verdict)} ` +
        `Best was ${line[0] ?? '?'} — ${line.join(' ')}`,
    );
    board.setShapes([
      {
        orig: best.moves[0].slice(0, 2) as Key,
        dest: best.moves[0].slice(2, 4) as Key,
        brush: 'green',
      },
    ]);
    showReveal(undefined);
    yourTurn();
  }

  async function botTurn(): Promise<void> {
    if (finished()) return;
    board.setShapes([]);
    status('Thinking…');

    const lines = await engine.analyse(state.fen, SEARCH);
    const move = await chooseMove(policy, state.fen, lines, wantsError());
    if (!move) {
      status('The engine sees no move here.');
      return;
    }
    if (move.deliberateError) state.blundersLeft--;

    commit(move.uci);
    // Say nothing about it. Spotting it is the whole point.
    state.punishArmed = move.deliberateError;
    status('Your move.');
    yourTurn();
  }

  function wantsError(): boolean {
    if (state.blundersLeft <= 0 || state.ply < BLUNDER_FROM_PLY) return false;
    return Math.random() < BLUNDER_CHANCE;
  }

  function commit(uci: string): void {
    state.fen = fenAfter(state.fen, uci);
    state.ply++;
    board.set({ fen: state.fen, turnColor: turnOf(state.fen) });
    scoreEl.textContent = `spotted ${state.spotted} · missed ${state.missed}`;
  }

  function finished(): boolean {
    const over = outcomeOf(state.fen);
    if (!over) return false;
    status(over.winner ? `${over.reason} — ${over.winner} wins.` : `Draw: ${over.reason}.`);
    board.set({ movable: { dests: noDests() } });
    return true;
  }

  function withPromotion(from: Key, to: Key): string {
    // Auto-queen for now; a promotion picker is a later refinement.
    const piece = board.state.pieces.get(to);
    const lastRank = to.endsWith('8') || to.endsWith('1');
    return from + to + (piece?.role === 'pawn' && lastRank ? 'q' : '');
  }
}

/** Say what the move cost in the terms that actually fit the position. */
function describeCost(verdict: Verdict): string {
  if (verdict.missesMate) return 'That lets a forced mate slip.';
  if (verdict.hangsMate) return 'That walks into a forced mate.';
  return (
    `That costs ${(verdict.cpLoss / 100).toFixed(1)} pawns, ` +
    `about ${verdict.winLoss.toFixed(0)}% of your winning chances.`
  );
}

function showReveal(onReveal: (() => void) | undefined): void {
  revealButton.hidden = !onReveal;
  revealButton.onclick = onReveal ?? null;
}

main().catch((error: unknown) => {
  status(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error);
});
