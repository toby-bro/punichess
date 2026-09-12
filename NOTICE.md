# Licence and credits

Punichess is **GPL-3.0-or-later**. The full text is in [LICENSE](LICENSE).

## Why it has to be

This project is not licensed that way by preference — it has no choice. Every
chess component it depends on is GPL, and they are _bundled into the page that
gets served_, not merely called over a network. That makes the published app a
combined work, and GPL-3.0-or-later is the only licence it can carry.

| Component                                                                   | Licence          | Used for                                |
| --------------------------------------------------------------------------- | ---------------- | --------------------------------------- |
| [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish 18, WASM) | GPL-3.0          | the engine, bundled as `public/engine/` |
| [chessground](https://github.com/lichess-org/chessground)                   | GPL-3.0-or-later | the board: rendering, dragging, arrows  |
| [chessops](https://github.com/niklasf/chessops)                             | GPL-3.0-or-later | rules, FEN/SAN/UCI, PGN                 |

Build tooling (Vite, TypeScript, ESLint, Prettier) is MIT or Apache-2.0 and does
not ship in the output, so it places no obligation on the result.

## What was and was not taken from lichess

**No lichess source code was copied into this project.** Every line under `src/`
was written for it.

Two of the three chess libraries above come from the lichess project and are used
as ordinary dependencies, unmodified, from npm. lichess's server
([lila](https://github.com/lichess-org/lila)) is AGPL-3.0 and is **not** used
here in any form — nothing was forked from it, and this app has no server at all,
so the AGPL's network clause never comes into play.

Two ideas were taken from lichess, and ideas are not what copyright covers:

- the centipawn-to-win-probability curve, `50 + 50 × (2 / (1 + e^(−0.00368208 ×
cp)) − 1)`, which is a fitted formula
- the move labels — inaccuracy at 10%, mistake at 20%, blunder at 30% of winning
  chances

Both are reimplemented in [`src/referee.ts`](src/referee.ts) and
[`src/stats.ts`](src/stats.ts).

## What this means for you

Running it privately, on your own machine or phone, carries no obligation at all.
The GPL is triggered by _distribution_.

Publishing it — which for a web app means anyone can load the page — counts as
distributing the bundled engine and libraries. You then have to:

- keep it under GPL-3.0-or-later
- offer the corresponding source to anyone who has the app, in practice by
  linking the repository from the page or the README
- keep these notices intact

Nothing here stops you publishing it. It only stops you making it proprietary.

_This is a plain-language summary written by a programmer, not legal advice._
