/**
 * When the bot is asked for an error and does not make one, why not?
 *
 * blunderkind.mjs says what kind of errors get made; this says what stops the
 * rest. It re-runs the gates chooseMove applies, in the same order, and counts
 * where each attempt dies.
 *
 * Usage: npm run bot:why [-- plies games]
 */
import { MAX_PROBES, PUNISH_MARGIN, punishKind } from '../src/bot.ts';
import { PROBE, SEARCH, WIDE } from '../src/budgets.ts';
import { INITIAL_FEN, fenAfter } from '../src/chess.ts';
import { DECIDED_CP } from '../src/referee.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.ts';
import { collectLines } from '../src/uci.ts';

import initEngine from 'stockfish';

const PLIES = Number(process.argv[2] ?? 30);
const GAMES = Number(process.argv[3] ?? 2);

const engine = await initEngine('lite-single');
const out = [];
engine.listener = l => out.push(l);
const send = c => {
  engine.sendCommand(c);
};
const until = p =>
  new Promise(r => {
    const t = () => {
      const i = out.findIndex(p);
      if (i !== -1) return r(out.splice(0, i + 1));
      setTimeout(t, 5);
    };
    t();
  });
send('uci');
await until(l => l === 'uciok');

let pv = 0;
const search = async (fen, budget) => {
  if (pv !== budget.multiPV) {
    send(`setoption name MultiPV value ${budget.multiPV}`);
    send('isready');
    await until(l => l === 'readyok');
    pv = budget.multiPV;
  }
  send(`position fen ${fen}`);
  send(`go nodes ${budget.nodes}`);
  return collectLines(await until(l => l.startsWith('bestmove')));
};

const settings = parseSettings(DEFAULT_SETTINGS);
const lossOf = (best, line) => Math.max(0, best.cp - line.cp);

const why = {
  decided: 0,
  noBand: 0,
  noClearAnswer: 0,
  justRecapture: 0,
  freeLunch: 0,
  found: 0,
};
const bandSizes = [];

for (let game = 0; game < GAMES; game++) {
  let fen = INITIAL_FEN;
  const botPlays = game % 2 === 0 ? 0 : 1;
  for (let ply = 0; ply < PLIES; ply++) {
    const lines = await search(fen, SEARCH);
    if (lines.length === 0) break;
    if (ply % 2 !== botPlays) {
      fen = fenAfter(fen, lines[0].moves[0]);
      continue;
    }
    const best = lines[0];

    if (Math.abs(best.cp) > DECIDED_CP) {
      why.decided++;
      fen = fenAfter(fen, best.moves[0]);
      continue;
    }

    const wide = await search(fen, WIDE);
    const band = wide.filter(line => {
      const loss = lossOf(wide[0], line);
      return loss >= settings.blunderMin && loss <= settings.blunderMax;
    });
    bandSizes.push(band.length);
    if (band.length === 0) {
      why.noBand++;
      fen = fenAfter(fen, best.moves[0]);
      continue;
    }

    let verdict = 'noClearAnswer';
    for (const candidate of band.slice(0, MAX_PROBES)) {
      const uci = candidate.moves[0];
      const after = fenAfter(fen, uci);
      const [punish, second] = await search(after, PROBE);
      if (!punish || !second) continue;
      const margin = punish.mate !== undefined ? Infinity : punish.cp - second.cp;
      if (margin < PUNISH_MARGIN) continue;
      if (punish.moves[0].slice(2, 4) === uci.slice(2, 4)) {
        verdict = 'justRecapture';
        continue;
      }
      if (punishKind(after, punish) === 'grab') {
        verdict = 'freeLunch';
        continue;
      }
      verdict = 'found';
      break;
    }
    why[verdict]++;
    fen = fenAfter(fen, best.moves[0]);
  }
  process.stderr.write(`game ${game + 1}/${GAMES} done\n`);
}

const asked = Object.values(why).reduce((a, b) => a + b, 0) || 1;
console.log(`\nasked ${asked} times\n`);
for (const [reason, n] of Object.entries(why)) {
  console.log(
    `${reason.padEnd(15)} ${String(n).padStart(3)}  ${((n / asked) * 100).toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round((n / asked) * 40))}`,
  );
}
const sorted = [...bandSizes].sort((a, b) => a - b);
console.log(
  `\nmoves in the ${settings.blunderMin}-${settings.blunderMax}cp band, out of ${WIDE.multiPV} searched:` +
    `\n  none in ${bandSizes.filter(n => n === 0).length} of ${bandSizes.length} positions` +
    `\n  median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted.at(-1)}`,
);
process.exit(0);
