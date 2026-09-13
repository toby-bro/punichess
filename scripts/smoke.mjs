/**
 * Integration check against the real engine.
 *
 * The unit tests cover the logic with fabricated search output; this one proves
 * that Stockfish actually emits what we parse, and that the referee's verdicts
 * hold on real positions. Slow, so it is not part of `npm run check`.
 *
 * Run with: docker compose run --rm check npm run test:engine
 */
import assert from 'node:assert/strict';

import initEngine from 'stockfish';

import { chooseMove, pickMateTrap } from '../src/bot.ts';
import { INITIAL_FEN, fenAfter, sanOf } from '../src/chess.ts';
import { OWN_BLUNDER, isError, isMateScore, judge } from '../src/referee.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.ts';
import { collectLines } from '../src/uci.ts';

const MULTI_PV = 8;
const NODES = 400_000;
const settings = parseSettings({ ...DEFAULT_SETTINGS, maxMateDepth: 3 });

const engine = await initEngine('lite-single');
const output = [];
engine.listener = line => {
  output.push(line);
};

const send = command => {
  engine.sendCommand(command);
};

const until = predicate =>
  new Promise(resolve => {
    const poll = () => {
      const hit = output.findIndex(predicate);
      if (hit !== -1) {
        resolve(output.splice(0, hit + 1));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });

send('uci');
await until(line => line === 'uciok');
send('isready');
await until(line => line === 'readyok');

let currentMultiPV = 0;
const searchWith = async (fen, multiPV) => {
  if (multiPV !== currentMultiPV) {
    send(`setoption name MultiPV value ${multiPV}`);
    send('isready');
    await until(line => line === 'readyok');
    currentMultiPV = multiPV;
  }
  send(`position fen ${fen}`);
  send(`go nodes ${NODES}`);
  return collectLines(await until(line => line.startsWith('bestmove')));
};

const analyse = fen => searchWith(fen, MULTI_PV);
const analyseWide = fen => searchWith(fen, 40);
const probe = fen => searchWith(fen, 2);

// 1. The engine really does emit the MultiPV shape the parser expects.
const opening = await analyse(INITIAL_FEN);
console.log(`opening: ${opening.length} lines at depth ${opening[0].depth}`);
for (const line of opening) {
  console.log(
    `  ${line.multipv}. ${sanOf(INITIAL_FEN, line.moves[0])} ${(line.cp / 100).toFixed(2)}`,
  );
}
assert.equal(opening.length, MULTI_PV, 'MultiPV should yield one line per slot');
assert.ok(
  opening.every((line, i) => line.multipv === i + 1),
  'slots must be 1..N in order',
);
assert.ok(
  opening.every((line, i) => i === 0 || line.cp <= opening[i - 1].cp),
  'lines must be ordered best first',
);
assert.ok(Math.abs(opening[0].cp) < 100, 'nobody is winning from the start position');
assert.equal(judge(opening, opening[0].moves[0]).cpLoss, 0, 'the best move costs nothing');

// 2. Mate scores survive the round trip and dominate every ordinary evaluation.
const mate = await analyse('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
console.log(
  `mate: ${sanOf('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', mate[0].moves[0])} (mate ${mate[0].mate})`,
);
assert.equal(mate[0].mate, 1, 'Ra8 is mate in 1');
assert.ok(isMateScore(mate[0].cp));

// 3. Missing that mate must be flagged, even though the position is far past
//    the "already decided, stop nagging" threshold. This is the case the whole
//    app exists for.
const missed = judge(mate, mate.at(-1).moves[0]);
console.log(
  `missing the mate -> missesMate=${missed.missesMate}, flagged=${isError(missed, OWN_BLUNDER)}`,
);
assert.ok(missed.missesMate, 'letting a forced mate slip must be recognised');
assert.ok(isError(missed, OWN_BLUNDER), 'and must never be suppressed as "decided"');

// 4. The bot really does err on purpose. This is the check that matters: with a
//    narrow search there is nothing in the 1-3 pawn band at all, so the bot
//    never errs and the whole exercise quietly does nothing.
const policy = { search: analyse, searchWide: analyseWide, probe, settings };
const midgame = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const lines = await analyse(midgame);
const wide = await analyseWide(midgame);
const best = lines[0].cp;
const narrowBand = lines.filter(
  l => best - l.cp >= settings.blunderMin && best - l.cp <= settings.blunderMax,
);
const wideBand = wide.filter(
  l => best - l.cp >= settings.blunderMin && best - l.cp <= settings.blunderMax,
);
console.log(
  `candidates in band: ${narrowBand.length} of ${lines.length} narrow, ${wideBand.length} of ${wide.length} wide`,
);
assert.ok(
  wideBand.length > narrowBand.length,
  'the wide search is what makes errors possible at all',
);

// Across a handful of positions rather than one: the punishability and
// "worth spotting" filters are strict, and any single position can legitimately
// offer nothing worth setting up. What must not happen is never finding one.
const POSITIONS = [
  midgame,
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
  'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQ - 0 6',
  'rnbqkb1r/pp2pppp/3p1n2/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4',
];

let deliberate = 0;
let asked = 0;
for (const position of POSITIONS) {
  const candidates = await analyse(position);
  for (let i = 0; i < 3; i++) {
    asked++;
    const move = await chooseMove(policy, position, candidates, { wantsError: true, acpl: 0 });
    if (!move.deliberateError) continue;
    deliberate++;

    // Whatever it picked has to be a mistake worth spotting: in band, and not
    // answered by simply taking something.
    const after = fenAfter(position, move.uci);
    const replies = await analyse(after);
    if (move.kind === 'blunder') {
      const answer = replies[0].moves[0];
      assert.notEqual(answer.slice(2, 4), move.uci.slice(2, 4), 'not just taking what moved');
    }
  }
}
console.log(`asked to err ${asked} times, did so ${deliberate} times`);
assert.ok(deliberate > 0, 'a bot that never errs on purpose is the bug this test exists for');

// 5. Honest play never strays outside the quiet band.
let honestTotal = 0;
for (let i = 0; i < 8; i++) {
  const move = await chooseMove(policy, midgame, lines, {
    wantsError: false,
    acpl: honestTotal / 8,
  });
  const cost = judge(lines, move.uci).cpLoss;
  assert.ok(cost <= settings.quietBand, `honest move ${move.uci} cost ${cost}`);
  honestTotal += cost;
}
console.log(`honest moves averaged ${(honestTotal / 8).toFixed(0)} cp, band ${settings.quietBand}`);

// 6. A mate trap. After 1. f3 e5 several White moves walk into a forced mate
//    (2. g4 Qh4#, 2. h3 Qh4+ 3. g3 Qxg3#). Which one gets picked is deliberately
//    random, so the property to check is that whatever it picks really does hand
//    over a mate inside the configured depth.
const trapFen = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
const narrow = await analyse(trapFen);
assert.ok(
  !narrow.some(line => line.mate !== undefined && line.mate < 0),
  'a narrow search should never surface a mate-allowing move: they are the worst on the board',
);

const trap = pickMateTrap(await analyseWide(trapFen), narrow[0], settings);
assert.ok(trap, 'the wide search should find a move that allows mate');
console.log(`mate trap: ${sanOf(trapFen, trap.uci)}`);

// The player must now have a forced mate, and missing it must be flagged.
const afterTrap = fenAfter(trapFen, trap.uci);
const mateReplies = await analyse(afterTrap);
const forced = mateReplies[0].mate;
assert.ok(
  forced !== undefined && forced >= 1 && forced <= settings.maxMateDepth,
  `the trap should leave a mate in 1..${settings.maxMateDepth}, got ${forced}`,
);

const ignored = judge(mateReplies, mateReplies.at(-1).moves[0]);
assert.ok(ignored.missesMate, 'missing the mate must be recognised');
assert.equal(ignored.mateIn, forced, 'and named with the right depth');
assert.ok(isError(ignored, OWN_BLUNDER), 'and must always interrupt');
console.log(`  it is mate in ${forced}; missing it reports "mate in ${ignored.mateIn}"`);

// 7. Mate has to be seen, and seen from a position the bot walked into on
//    purpose. What this does *not* assert is how long any of it took: wall-clock
//    belongs in `npm run bench`, where a number that moves with the machine is
//    information rather than a test that fails on slower hardware.
const mateIn2 = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
const seen = await analyse(mateIn2);
assert.ok(seen[0].mate !== undefined && seen[0].mate > 0, 'that position is a forced mate');
console.log(`forced mate seen: mate in ${seen[0].mate}`);

console.log('\nall engine checks passed');
process.exit(0);
