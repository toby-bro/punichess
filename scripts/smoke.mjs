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

import { chooseMove } from '../src/bot.ts';
import { INITIAL_FEN, fenAfter, sanOf } from '../src/chess.ts';
import { OWN_BLUNDER, isError, isMateScore, judge } from '../src/referee.ts';
import { collectLines } from '../src/uci.ts';

const MULTI_PV = 8;
const NODES = 400_000;

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
send(`setoption name MultiPV value ${MULTI_PV}`);
send('isready');
await until(line => line === 'readyok');

const analyse = async fen => {
  send(`position fen ${fen}`);
  send(`go nodes ${NODES}`);
  return collectLines(await until(line => line.startsWith('bestmove')));
};

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

// 4. The bot's deliberate error is inside the band and really is punishable.
const midgame = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const lines = await analyse(midgame);
const blunder = await chooseMove({ search: analyse }, midgame, lines, true);
console.log(`bot chose ${sanOf(midgame, blunder.uci)} (deliberate: ${blunder.deliberateError})`);
if (blunder.deliberateError) {
  const cost = judge(lines, blunder.uci).cpLoss;
  assert.ok(cost >= 100 && cost <= 300, `a deliberate error must stay in band, got ${cost}`);

  const replies = await analyse(fenAfter(midgame, blunder.uci));
  assert.ok(replies[0].cp - replies[1].cp >= 80, 'and must have a clear refutation');
  console.log(`  punishment: ${sanOf(fenAfter(midgame, blunder.uci), replies[0].moves[0])}`);
}

// 5. Honest play never strays outside the quiet band.
for (let i = 0; i < 5; i++) {
  const move = await chooseMove({ search: analyse }, midgame, lines, false);
  const cost = judge(lines, move.uci).cpLoss;
  assert.ok(cost <= 100, `honest move ${move.uci} cost ${cost}`);
}
console.log('honest moves stayed inside the quiet band');

console.log('\nall engine checks passed');
process.exit(0);
