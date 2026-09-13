/**
 * What *kind* of error does the bot actually make?
 *
 * Not how often -- blunderrate.mjs answers that -- but what the player has to
 * see in order to punish it. A hanging piece and a discovered check both cost
 * two pawns and are not remotely the same lesson.
 *
 * Each deliberate error is classified by its refutation:
 *   mate     the punishment is a forced mate
 *   quiet    the punishment captures nothing and gives no check -- the hardest
 *            thing there is to see
 *   check    the punishment is a check that takes nothing: a discovered check,
 *            a double check, a king hunt
 *   sac      a capture into a defended square, which is to say a real tactic
 *   grab     a capture of something undefended (pickBlunder rejects these; if
 *            any show up here, that filter has a hole in it)
 *
 * Usage: npm run bot:kinds [-- plies games]
 */
import { chooseMove } from '../src/bot.ts';
import { PROBE, SEARCH, WIDE } from '../src/budgets.ts';
import { INITIAL_FEN, fenAfter, moveKind, sanOf } from '../src/chess.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.ts';
import { collectLines } from '../src/uci.ts';

import initEngine from 'stockfish';

const PLIES = Number(process.argv[2] ?? 40);
const GAMES = Number(process.argv[3] ?? 3);

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

const settings = parseSettings({ ...DEFAULT_SETTINGS, blunderFromPly: 0, blundersPerGame: 99 });
const policy = {
  search: fen => search(fen, SEARCH),
  searchWide: fen => search(fen, WIDE),
  probe: fen => search(fen, PROBE),
  settings,
};

/** How hard is the punishment to see? */
function classify(after, punish) {
  if (punish.mate !== undefined && punish.mate > 0) return 'mate';
  const kind = moveKind(after, punish.moves[0]);
  if (!kind.capture) return kind.check ? 'check' : 'quiet';
  return kind.defended ? 'sac' : 'grab';
}

const tally = { mate: 0, quiet: 0, check: 0, sac: 0, grab: 0 };
const examples = [];
let asked = 0;
let erred = 0;

for (let game = 0; game < GAMES; game++) {
  let fen = INITIAL_FEN;
  // The bot plays one side and is asked to err; the other side plays the best
  // move. Letting both sides blunder produces positions no game ever reaches --
  // lopsided ones, where every "error" is meaningless and every "refutation" is
  // just the best move in a position that was already won. The first version of
  // this script did that, and its numbers were worthless.
  const botPlays = game % 2 === 0 ? 0 : 1;
  for (let ply = 0; ply < PLIES; ply++) {
    const lines = await search(fen, SEARCH);
    if (lines.length === 0) break;
    if (ply % 2 !== botPlays) {
      fen = fenAfter(fen, lines[0].moves[0]);
      continue;
    }
    asked++;
    const move = await chooseMove(policy, fen, lines, { wantsError: true, acpl: 0 });
    if (!move) break;
    if (move.deliberateError) {
      erred++;
      const after = fenAfter(fen, move.uci);
      const [punish] = await search(after, PROBE);
      if (punish) {
        const kind = classify(after, punish);
        tally[kind]++;
        if (examples.length < 14) {
          examples.push(
            `${kind.padEnd(6)} ${sanOf(fen, move.uci).padEnd(7)} punished by ` +
              `${sanOf(after, punish.moves[0]).padEnd(7)} ` +
              `(${punish.mate !== undefined ? `#${punish.mate}` : `${(punish.cp / 100).toFixed(1)}`})`,
          );
        }
      }
    }
    fen = fenAfter(fen, move.uci);
  }
  process.stderr.write(`game ${game + 1}/${GAMES} done\n`);
}

const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
console.log(`\nasked ${asked} times, erred ${erred} (${((erred / asked) * 100).toFixed(0)}%)\n`);
for (const [kind, n] of Object.entries(tally)) {
  const bar = '#'.repeat(Math.round((n / total) * 40));
  console.log(
    `${kind.padEnd(6)} ${String(n).padStart(3)}  ${((n / total) * 100).toFixed(0).padStart(3)}%  ${bar}`,
  );
}
console.log('\nexamples:');
for (const line of examples) console.log('  ' + line);
process.exit(0);
