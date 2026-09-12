# Spot the Blunder

Play chess against a bot that makes mistakes **on purpose** — and get stopped the
moment you fail to notice one, while the game is still going, not in a post-mortem
you read after you already lost.

Two interruptions, armed by different rules:

| When                             | Trigger                      | What happens                            |
| -------------------------------- | ---------------------------- | --------------------------------------- |
| The bot just erred on purpose    | your reply loses ≥ 0.5 pawns | "Are you sure?" → take back → try again |
| Any other move of yours          | your move loses ≥ 1.1 pawns  | same                                    |
| Either side, a forced mate is on | mate missed or walked into   | always fires, never suppressed          |

The bot never announces its errors. Spotting them is the entire point. A counter
tracks how many you caught versus missed.

Everything runs on the phone: Stockfish 18 compiled to WebAssembly, no server, no
network after the first load.

## Running it

Everything happens in Docker; nothing is installed on the host.

```sh
docker compose up -d dev        # http://localhost:8888, hot reload
docker compose --profile tools run --rm check    # lint + typecheck + unit tests
docker compose --profile tools run --rm build    # static site into ./dist
docker compose --profile tools run --rm serve    # serve ./dist like a real host
```

To play on the phone, put it on the same network and open `http://<pc-ip>:8888`.

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

```
uci.ts       parse Stockfish's output into scored variations
engine.ts    drive the WASM worker; one search at a time, fixed node budgets
chess.ts     rules, FEN/SAN/UCI conversions (wraps chessops)
referee.ts   decide whether a move was an error, and how bad
bot.ts       choose the bot's move: honest, or deliberately wrong but punishable
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

**Only make punishable mistakes.** A deliberate error must cost 1–3 pawns _and_
have a refutation that clearly beats the second-best reply. Otherwise there is
nothing to spot, and stopping you for missing it would be unfair.

## Tests

```sh
docker compose --profile tools run --rm check                       # unit tests, fast
docker compose exec dev npm run test:engine                         # against real Stockfish, slow
```

Unit tests feed fabricated search output to the pure logic. The engine test proves
Stockfish actually emits what the parser expects, and that the thresholds behave on
real positions.

## Licence

GPL-3.0, because Stockfish is.
