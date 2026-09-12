/** How often does the bot actually manage a deliberate error, over a real game? */
import { chooseMove } from '../src/bot.ts';
import { PROBE, SEARCH, WIDE } from '../src/budgets.ts';
import { INITIAL_FEN, fenAfter } from '../src/chess.ts';
import { DECIDED_CP } from '../src/referee.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.ts';
import { collectLines } from '../src/uci.ts';

import initEngine from 'stockfish';

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

const settings = parseSettings({ ...DEFAULT_SETTINGS, blunderFromPly: 0 });
const policy = {
  search: fen => search(fen, SEARCH),
  searchWide: fen => search(fen, WIDE),
  probe: fen => search(fen, PROBE),
  settings,
};

// Walk a real game, asking for an error at every move.
let fen = INITIAL_FEN;
let asked = 0,
  erred = 0,
  noBand = 0,
  notPunishable = 0,
  decided = 0;
for (let ply = 0; ply < 30; ply++) {
  const lines = await search(fen, SEARCH);
  if (lines.length === 0) break;
  const best = lines[0];

  if (Math.abs(best.cp) > DECIDED_CP) {
    decided++;
  } else {
    asked++;
    const wide = await search(fen, WIDE);
    const band = wide.filter(l => {
      const loss = best.cp - l.cp;
      return loss >= settings.blunderMin && loss <= settings.blunderMax;
    });
    if (band.length === 0) noBand++;

    const move = await chooseMove(policy, fen, lines, { wantsError: true, acpl: 0 });
    if (move.deliberateError) erred++;
    else if (band.length > 0) notPunishable++;
  }

  const move = await chooseMove(policy, fen, lines, { wantsError: false, acpl: 30 });
  fen = fenAfter(fen, move.uci);
}

console.log(`asked for an error ${asked} times`);
console.log(`  managed one:               ${erred}`);
console.log(`  nothing in the 1-3 band:   ${noBand}`);
console.log(`  in band but not punishable:${notPunishable}`);
console.log(`  position already decided:  ${decided}`);
process.exit(0);
