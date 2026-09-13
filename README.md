# Punichess

## Disclaimer

_This is pure AI-slop, I have absolutely no knowledge of typescript, I just wanted this bot to exist and made it with Claude without ever reading one line of code._

This is provided under GPL3 license, as it seems Claude (intelligently) reused GPL3 code.
The code is provided to comply with the license, as it is possible to interact with it from internet.

## Presentation

Play chess against a bot that makes mistakes **on purpose** — and get stopped the
moment you fail to notice one, while the game is still going, not in a post-mortem
you read after you already lost.

Two interruptions, armed by different rules:

| When                             | Trigger                      | What happens                            |
| -------------------------------- | ---------------------------- | --------------------------------------- |
| The bot just erred on purpose    | your reply loses ≥ 0.5 pawns | "Are you sure?" → take back → try again |
| Any other move of yours          | your move loses ≥ 1.1 pawns  | same                                    |
| Either side, a forced mate is on | mate missed or walked into   | always fires, never suppressed          |

The bot never announces its errors. Spotting them is the entire point. Three
counters keep score: **spotted** (you punished one), **missed** (you let one go),
and **made** (your own moves that got you stopped, counted once each however many
times you tried them).

## It remembers what you got wrong

Every move you are stopped for is remembered **against the position it was made
in**, and kept between sessions. Come back to that position — later in the game,
next week, in a different game entirely — and your past mistakes are drawn on the
board in pale red, each labelled with what it cost and how many times you have
fallen for it.

Pale red for what you have done before, full red for what you are doing now. A
FEN includes the side to move, so a remembered mistake can only ever resurface in
the position it actually belongs to. _Forget my mistakes_, under bot settings,
wipes the record.

When it stops you, your move is drawn as a **red arrow labelled with what it
cost** and the position is put back. Nothing is explained yet. Every attempt you
make stays on the board, so two wrong tries show as two red arrows.

Three ways out:

- **Show me** — a toggle, not a mode: the three best answers appear on the board
  with their evaluations and the board stays yours, so you can just play one.
- **Punish me** — play your move and let the bot answer with _best moves only_,
  so you watch the refutation land instead of being told about it.
- **Ignore** — play it and carry on as normal.

The last two mark the move red in the move tree, because the reason to play a
bad move on purpose is to come back later and try again. Punishment is scoped to
the branch it started on: step back above it and the bot goes back to normal.

Everything runs on the phone: Stockfish 18 compiled to WebAssembly, no server, no
network after the first load.

## Choosing sides

_Play as_ takes White or Black. Picking Black flips the board and the bot opens.
The choice is remembered, and switching sides starts a fresh game, since carrying
a half-played position across colours would mean nothing.

## Settings

Everything the bot decides from is a slider, and it is remembered between games.
Four presets cover the usual ground; _Mate hunt_ is the one that mostly hands you
forced mates to find.

The important dial is **bot average loss**: the average centipawn loss it aims
for across its honest moves. That is the strength control. It is a target for the
_average_, not a cap on any single move, so the bot drifts the way a human does
rather than playing perfectly until it suddenly does not.

The rest control how often it errs on purpose, how big those errors are, what
share of them hand you a forced mate instead of material, how long a mate it will
offer, and how bad one of your own moves has to be before you get stopped.

Your average loss and the bot's are shown as you play.

## Game review

_Review game_ analyses every position and shows:

- an **evaluation graph** across the whole game, with every inaccuracy, mistake
  and blunder marked. Drag along it to scrub through the game, and
  moving the board draws a marker back at the matching point
- an **evaluation bar** beside the board, and the engine's **three best moves**
  drawn as arrows with their evaluations
- a summary with **two columns per player**: the game as it finally stands, and
  everything you actually tried. The gap between them is the part a game you were
  stopped during does not otherwise show.
- **every move** labelled and costed, next to the **three best moves** that were
  available in that position

Clicking a move, or a dot on the graph, jumps the board there — where the
navigation below lets you play on and see how it should have gone.

The bar and the arrows appear **only with the review open**. During a game they
would answer the question the game is asking you. They also vanish the moment you
branch into a position the review has not seen, since working a line out for
yourself is usually the point; the _Evaluate new positions_ switch turns that off
when you would rather just be told.

Reviewing a game you just played is nearly instant: the engine analysed every
position while you were playing, and those searches are remembered, so the review
mostly asks for work already done. Only positions it has never seen cost
anything.

## Moving around the game

`◀` `▶` step through the moves, `⏮` `⏭` jump to either end, and the arrow, Home
and End keys do the same. Any move in the list can be clicked to jump to it.

Going back is not just for looking. Play a move from an earlier position and the
game **forks** there: the continuation is discarded and you carry on down the new
line. Use _Play from here_ to branch without moving first — handy for handing an
earlier position back to the bot.

During the reveal the same controls walk the engine's variation instead of the
game, and _Back to game_ returns you to your move so you can try again.

## Running it

Everything happens in Docker; nothing is installed on the host.

```sh
docker compose up -d dev        # http://localhost:8888, hot reload
docker compose --profile tools run --rm check    # lint + typecheck + unit tests
docker compose --profile tools run --rm build    # static site into ./dist
docker compose --profile tools run --rm serve    # serve ./dist like a real host
```

To play on the phone, put it on the same network and open `http://<pc-ip>:8888`.

### Publishing it

The site is built for a custom domain at the root, and `public/CNAME` names it.
That file matters: an Actions deploy publishes an artifact rather than a branch,
so a CNAME that is not part of the build is not part of the site, and GitHub
unsets the domain on the next deploy.

For a subdomain, DNS needs one record — a CNAME, not the A records an apex
domain uses:

```
punichess   CNAME   <your-github-username>.github.io.
```

It points at GitHub's Pages host, not at the repository; the repository is
identified by the CNAME file in the published site. Then set the same name under
Settings → Pages → Custom domain, and tick _Enforce HTTPS_ once the certificate
has been issued, which takes a few minutes after DNS resolves.

To serve from `<user>.github.io/<repo>/` instead, delete `public/CNAME` and set a
`BASE_PATH` repository variable of `/<repo>/`.

### Installing on the phone

Build, publish `dist/` as a static site, open it in Chrome, and use _Add to home
screen_. It then works fully offline: the service worker precaches the engine
(~7.3 MB) along with everything else.

### Changing dependencies

`node_modules` deliberately lives only inside the container. After editing
`package.json`, regenerate the lockfile and rebuild without ever installing on the
host:

```sh
docker run --rm -u 1000:1000 -v "$PWD":/w -w /w node:24-slim \
  npm install --package-lock-only --ignore-scripts
docker compose build dev
docker compose up -d --force-recreate --renew-anon-volumes dev
```

The last flag matters: the container-only `node_modules` volume survives image
rebuilds, so without it the container keeps mounting the old dependency tree.

## How it works

```txt
uci.ts       parse Stockfish's output into scored variations
memory.ts    what you got wrong in a position, kept between sessions
engine.ts    drive the WASM worker; one search at a time, abortable
cache.ts     remember searches by position
chess.ts     rules, FEN/SAN/UCI conversions (wraps chessops)
tree.ts      the game as a tree of variations
pgn.ts       read and write that tree as PGN
settings.ts  every tunable, with clamping and persistence
referee.ts   decide whether a move was an error, and how bad
stats.ts     average centipawn loss and per-move labels
bot.ts       choose the bot's move: honest at a target average, or wrong on purpose
review.ts    score a whole game, once per position
chart.ts     evaluation-graph geometry
main.ts      the game loop and the board
```

Everything rests on one primitive: a **MultiPV** search of every position, giving
the top N moves with a score each. A move's cost is then just its distance from
the best move _inside that same search_.

Three decisions carry most of the weight:

**Compare within one search.** Re-searching the resulting position at a different
depth is what makes engines contradict themselves. A false accusation is the worst
thing this app can do, so a move is only ever judged against the list it appeared
in — and any alarm is re-verified at four times the node budget before it fires.

**Judge in winning chances, not just pawns.** Dropping 1.00 at a level 0.00 is
catastrophic; dropping 1.00 at +7.00 is noise. Scores are converted through
lichess's win-probability curve, and a move must lose both material _and_ real
winning chances to count. Mate bypasses this entirely — a missed mate always fires.

**Never guess about a mate.** A move the engine did not list used to be charged
the worst listed score — and when several moves mate, that fallback is itself a
mate score, so a missed mate in 1 could be read as a mate you found. An unlisted
move is now looked up on the same budget as its parent before anything is
claimed.

**Only make punishable mistakes.** A deliberate error must cost 1–3 pawns _and_
have a refutation that clearly beats the second-best reply. Otherwise there is
nothing to spot, and stopping you for missing it would be unfair.

## How long the bot thinks

`npm run bench` prints what each search budget actually costs on the lite
single-threaded engine. Measured there:

| budget                                                      | time   | depth |
| ----------------------------------------------------------- | ------ | ----- |
| MultiPV 8 @ 350k — every move                               | 0.8 s  | 15    |
| MultiPV 40 @ 400k — only when erring on purpose             | 0.8 s  | 11    |
| MultiPV 2 @ 250k — punishability probe, at most three       | 0.55 s | 17    |
| MultiPV 8 @ 1.2M — only when a verdict is too close to call | 2.7 s  | 18    |

So an ordinary move is about a second, and a move where the bot goes hunting for
an error is two to three. Budgets are counted in nodes rather than time so the
same position always scores the same, whatever else the phone is doing.

The numbers also explain a design constraint: a million nodes takes 2.3 seconds
and reaches _depth 14_, while 350k reaches depth 15 in 0.8. Past a point the
extra nodes go into widening the MultiPV window rather than seeing further, and
for judging whether a move dropped a pawn that is wasted.

## Tests

```sh
docker compose --profile tools run --rm check                       # unit tests, fast
docker compose exec dev npm run test:engine                         # against real Stockfish, slow
```

Unit tests feed fabricated search output to the pure logic. The engine test proves
Stockfish actually emits what the parser expects, and that the thresholds behave on
real positions.

## Pieces

Eight piece sets ship with the app; pick one under _Bot settings_ and it is
remembered on that device. They are **bundled, not fetched**: pieces that arrive
over the network are pieces that do not arrive on a train, and playing offline is
the point. All eight together cost about 266 KB next to the engine's 7.1 MB.

All come from the
[lichess piece sets](https://github.com/lichess-org/lila/tree/master/public/piece),
and each keeps its own licence:

| set                                                          | author                                                            | licence         |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | --------------- |
| merida                                                       | Armando Hernandez Marroquin                                       | GPLv2+          |
| cburnett                                                     | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | GPLv2+          |
| chessnut                                                     | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces)   | Apache-2.0      |
| fantasy, celtic, spatial                                     | [Maurizio Monge](https://github.com/maurimo/chess-art)            | MIT             |
| mpchess                                                      | [Maxime Chupin](https://github.com/chupinmaxime)                  | GPLv3+          |
| kiwen-suwi                                                   | [neverRare](https://github.com/neverRare)                         | CC BY 4.0       |
| staunty, maestro, gioco, cardinal, fresca, dubrovny, tatiana | sadsnake1                                                         | CC BY-NC-SA 4.0 |
| california                                                   | [Jerry S.](https://sites.google.com/view/jerrychess/home)         | CC BY-NC-SA 4.0 |

**The last two rows are non-commercial.** The code stays GPL-3.0 and the images
keep their own licences — the program merely displays them, which is aggregation
rather than derivation, and it is exactly how lichess itself ships them: lila is
AGPL and its `COPYING.md` lists each asset separately.

The practical consequence is that _this bundle as a whole_ cannot be used
commercially. Fine for a game you host for yourself; if that ever changed,
deleting those eight directories and rerunning `scripts/vendor-pieces.mjs` leaves
everything else untouched.

## Licence

**GPL-3.0-or-later** ([LICENSE](LICENSE)), and not by choice: Stockfish,
chessground and chessops are all GPL and all get bundled into the page, which
makes this a combined work.

The piece images are third-party assets under the licences listed above, each
retaining its own; everything else is this project's.

No lichess source code was copied — everything under `src/` was written here.
Two of the libraries (chessground, chessops) come from the lichess project and
are used unmodified from npm; their server, lila, is AGPL and is not used in any
form, so that licence never enters into it. Two ideas were borrowed and
reimplemented: the centipawn-to-win-probability curve, and the
inaccuracy/mistake/blunder boundaries at 10/20/30% of winning chances.

Running it privately carries no obligation. Publishing it — which for a web app
means letting anyone load the page — means keeping it GPL and offering the
source.
