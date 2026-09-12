/**
 * What the search budgets actually cost, on this machine.
 *
 * Deliberately not a test. Wall-clock moves with the hardware, so an assertion
 * on it fails on a slower box and proves nothing on a faster one. The budgets
 * themselves are bounded in src/budgets.test.ts, where node counts make the
 * check deterministic; this is here to tell you what those bounds feel like.
 */
import { MAX_PROBES } from '../src/bot.ts';
import { LOOKUP, PROBE, REVIEW, SEARCH, VERIFY, WIDE } from '../src/budgets.ts';
import { collectLines } from '../src/uci.ts';

import initEngine from 'stockfish';

const engine = await initEngine('lite-single');
const out = [];
engine.listener = line => out.push(line);
const send = command => {
  engine.sendCommand(command);
};
const until = predicate =>
  new Promise(resolve => {
    const poll = () => {
      const hit = out.findIndex(predicate);
      if (hit !== -1) return resolve(out.splice(0, hit + 1));
      setTimeout(poll, 5);
    };
    poll();
  });

send('uci');
await until(line => line === 'uciok');

let currentMultiPV = 0;
const search = async (fen, budget) => {
  if (currentMultiPV !== budget.multiPV) {
    send(`setoption name MultiPV value ${budget.multiPV}`);
    send('isready');
    await until(line => line === 'readyok');
    currentMultiPV = budget.multiPV;
  }
  send(`position fen ${fen}`);
  const started = Date.now();
  send(`go nodes ${budget.nodes}`);
  const lines = collectLines(await until(line => line.startsWith('bestmove')));
  return { ms: Date.now() - started, lines };
};

const MIDGAME = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5';
const MATE = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';

console.log('budget                         multiPV     nodes     time  depth  lines');
const timings = new Map();
for (const [label, budget] of [
  ['SEARCH  (every move)', SEARCH],
  ['WIDE    (hunting an error)', WIDE],
  ['PROBE   (is it punishable)', PROBE],
  ['LOOKUP  (one unlisted move)', LOOKUP],
  ['REVIEW  (per position)', REVIEW],
  ['VERIFY  (too close to call)', VERIFY],
]) {
  const { ms, lines } = await search(MIDGAME, budget);
  timings.set(label.split(' ')[0], ms);
  console.log(
    `${label.padEnd(30)} ${String(budget.multiPV).padStart(4)} ${String(budget.nodes).padStart(9)} ` +
      `${String(ms).padStart(6)}ms ${String(lines[0]?.depth ?? 0).padStart(5)} ${String(lines.length).padStart(6)}`,
  );
}

const ordinary = timings.get('SEARCH') ?? 0;
const hunting = (timings.get('WIDE') ?? 0) + MAX_PROBES * (timings.get('PROBE') ?? 0);
console.log(`\nan ordinary move:        about ${ordinary}ms`);
console.log(`erring on purpose:       up to ${hunting}ms (wide + ${MAX_PROBES} probes)`);

// Mate is the case that has to feel immediate, and it does: Stockfish stops as
// soon as a mate is proven, long before the node budget runs out.
const mate = await search(MATE, SEARCH);
console.log(`spotting a forced mate:  ${mate.ms}ms (mate in ${mate.lines[0]?.mate})`);

process.exit(0);
