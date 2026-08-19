# One Piece TCG Sealed Tournament Builder

A local-first, personal-use web app for turning an entered One Piece Card Game
sealed pool into a deterministic 40-card deck, deck analysis, and a short play
guide. It runs from committed static catalogs; installable PWA and airplane-mode
support are still planned.

**Live app:** [Open the deck builder](https://annsonn.github.io/op-prerelease-deck-builder/)

## What it does

Choose a supported booster set, enter each opened card by its printed card
number, review the pool, and build a legal 40-card recommendation. The result
includes a cost-and-color curve, card roles, strengths and weaknesses, a
collapsed sideboard, and practical opening, sequencing, and finishing advice.

The app can also generate a synthetic 60-card or 72-card pool for development
and testing. Test pools exclude DON!! cards and replace the current pool.

## Current scope

- OP-01 through OP-17 catalogs are committed with the app.
- Rainbow Luffy is the fixed leader for every generated deck.
- Pool entry accepts a set-relative number such as `005` and full card IDs for
  special reprints.
- Pool and deck state live in memory; refreshing or closing the page clears the
  session.
- The app is designed for an English-language mobile browser and has been
  developed around a Pixel 9-sized screen.

This is a personal deck-building aid, not tournament software or a substitute
for official card lists, rulings, or deck-construction rules.

## Quick start

Prerequisites:

- Node.js 24 (the exact development version is in `.node-version`)
- npm 11

Install the pinned dependencies and start the local app:

```bash
npm ci
npm run dev
```

Vite prints the local URL. The development preflight validates the committed
catalogs before starting.

## GitHub Pages

The latest verified `main` build is published at
<https://annsonn.github.io/op-prerelease-deck-builder/>. Pushes to `main`
deploy automatically, and **Actions -> CI -> Run workflow** starts the same
deployment when run on `main`; selecting another branch only verifies and
builds.

Before the first deployment, set **Settings -> Pages -> Build and deployment ->
Source** to **GitHub Actions**. The workflow deploys with GitHub's built-in
`GITHUB_TOKEN`; no personal access token or repository secret is required.
Pull requests verify and build the Pages configuration without deploying it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Validate the catalogs and start the Vite development server. |
| `npm test` | Run the Vitest unit and component suites. |
| `npm run lint` | Run Oxlint. |
| `npm run typecheck` | Type-check the browser app and Node catalog tools. |
| `npm run verify` | Run lint, type checks, tests, and the runtime catalog check. |
| `npm run build` | Validate catalogs, type-check the app, and build production assets. |
| `npm run preview` | Serve an existing production build locally. |
| `npm run catalog:check` | Validate the tracked catalog snapshot without network access. |
| `npm run catalog:sync` | Build and publish catalogs from the pinned source snapshot. |
| `npm run strategy:evaluate` | Run deterministic strategy evaluation fixtures. |

## Catalogs and offline use

`public/catalogs` is the browser-facing, tracked runtime snapshot. It contains
an `index.json` plus an `op01` through `op17` directory. Each set contains
`manifest.json`, `cards.json`, `set-contents.json`,
`strategy-suggestions.json`, and `checksums.json`.

These files are sanitized, deterministic build products. They intentionally
exclude source image URLs, prices, market data, Japanese-only fields, product
records, and import diagnostics. `npm run catalog:check`, `npm run dev`, and
`npm run build` use the committed files and do not download Card Kaizoku data.
After dependencies are installed, a fresh clone does not need the raw source
snapshot to validate, build, or run the app.

Raw downloads and intermediate build data remain ignored under
`tmp/catalog/source`, `tmp/catalog/bundles`, `tmp/catalog/reports`, and
`tmp/catalog/staging`.

## Updating the catalogs

The default sync is the publication path. It reads the pinned URL and SHA-256
from `catalog-sources.json`, reuses a checksum-matching ignored cache when
available, normalizes every configured set, validates the result, and publishes
the sanitized snapshot to `public/catalogs`:

```bash
npm run catalog:sync
npm run catalog:check
git diff -- catalog-sources.json public/catalogs
```

Catalog sync is a maintenance operation. It must not run concurrently with `npm run dev` or `npm run preview`.
The publisher preserves
diagnostic generations when promotion fails, but portable filesystem APIs
cannot make the entire directory replacement atomic for every competing
process.

To evaluate a new version without changing the runtime catalogs, use a source
override:

```bash
npm run catalog:sync -- --source <versioned-json-url>
```

The candidate flow does not publish. Review its ignored semantic report under
`tmp/catalog/reports`. If the update is acceptable, change the URL, SHA-256,
and cache path in `catalog-sources.json`; then run the default pinned
`npm run catalog:sync` and review the resulting Git diff. Repeating a sync with
the same pinned snapshot should produce no catalog diff.

## Raw Card Kaizoku JSON format

The Card Kaizoku JSON adapter expects a top-level array. Every selected card row
uses string-encoded source fields in this shape (the values below are entirely
synthetic):

```json
[
  {
    "cardNumber": "OP16-001",
    "cardName": "Example Leader",
    "cost": "5",
    "attribute": "Special",
    "cardType": "LEADER",
    "power": "5000",
    "counter": "-",
    "color": "Red / Green",
    "feature": "Example Crew / Example Trait",
    "text": "Example effect text",
    "rarity": "L",
    "trigger": "-",
    "cardSet": "OP16",
    "products": [{ "cardSet": "OP16" }]
  }
]
```

Required row fields are `cardNumber`, `cardName`, `cost`, `attribute`,
`cardType`, `power`, `counter`, `color`, `feature`, `text`, `rarity`, `trigger`,
and `cardSet`. `products` is optional. When present, only the optional
`cardSet` on each product participates in set membership. Other source fields
may exist, but the adapter ignores them and never automatically copies them to
runtime artifacts.

Normalization rules:

- `cardNumber` must be a printed card ID such as `OP16-005`.
- Numeric values are decimal strings. Blank strings and `-` become `null` only
  where the runtime model allows a null value.
- A leader's source `cost` becomes its life value; its runtime cost is `null`.
- Colors and traits split on `/`, trim whitespace, and discard blank or `-`
  tokens.
- `cardSet` and every `products[].cardSet` combine into sorted set membership.
- Invalid non-card rows are skipped. A row selected for a target set must pass
  the complete required-field schema.
- Variants with the same printed card number are canonicalized into one
  playable runtime card.

The downloaded source snapshot is local input only. Do not commit it or use it
as a test fixture.

## Strategy engine

The deterministic Strategy V2 solver ranks only eligible copies in the entered
pool, selects exactly 40 cards, and returns the remaining eligible copies as a
sideboard. It measures cost curve, counter value, blockers, broadly usable
interaction, vanilla-like pressure, bosses, draw, removal, Rush, Banish, and
high-cost bricks. Structured evidence also drives synergy bonuses, unsupported
piece penalties, strengths, weaknesses, and the Rainbow Luffy play guide.

The recommendation is heuristic rather than a predicted win percentage. It
does not model a tournament metagame, opponent deck, opening-hand probability,
or every card-specific interaction. Set-specific ratings and relationships are
still incomplete, there is no runner-up or one-for-one swap engine yet, and
users cannot lock or exclude cards. Always review the suggested list and current
official rules before playing.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/` | React interface, pool model, deterministic solver, analysis, and play guide. |
| `shared/` | Browser- and tooling-safe catalog contracts. |
| `public/catalogs/` | Tracked, sanitized OP-01 through OP-17 runtime catalogs. |
| `tools/catalog/` | Source adapters, normalization, validation, comparison, and publication tooling. |
| `tools/evaluate-strategy.ts` | Deterministic strategy evaluation command. |
| `catalog-sources.json` | Pinned source checksum and per-set inventory configuration. |
| `tmp/catalog/` | Ignored raw downloads, intermediate bundles, reports, and recovery artifacts. |
| `docs/` | Current architecture and product roadmap. |

## Data, trademarks, and attribution

The committed catalog files are derived from data obtained from Card Kaizoku;
the pinned source and checksum are recorded in `catalog-sources.json`. They are
included so this personal tool can run without fetching the raw dataset at
runtime.

This is an unofficial fan project. It is not affiliated with or endorsed by
Bandai, Shueisha, Toei Animation, Eiichiro Oda, or Card Kaizoku. One Piece and
One Piece Card Game names, trademarks, card text, and related material belong
to their respective owners.

## License

Original source code is available under the [MIT License](LICENSE). Third-party
names, trademarks, card text, and derived card data are excluded from that
license; see [NOTICE](NOTICE).
