# Product roadmap

This checklist records the current user-facing scope and the remaining work.

## Completed foundation

- [x] Create the React 19, TypeScript, and Vite project scaffold.
- [x] Add deterministic catalog models, canonicalization, validation, checksums,
  and reports.
- [x] Add checksum-verified Card Kaizoku snapshot download and offline cache
  reuse.
- [x] Configure exact OP-01 through OP-17 normal ranges and special-reprint
  inventories.
- [x] Add preservation-only single-set and transactional all-set publication.
- [x] Add candidate snapshot gameplay and inventory diff reports.
- [x] Verify the pinned snapshot with OP-16's six specials and OP-17's seven
  unknown-rarity warnings.

## First usable app slice

- [x] Replace `private/` with ignored `tmp/catalog/` raw and intermediate paths.
- [x] Export sanitized OP-01 through OP-17 runtime catalogs to tracked
  `public/catalogs/`.
- [x] Add network-free `catalog:check`, `predev`, and `prebuild` gates.
- [x] Share browser-safe catalog contracts between tooling and application code.
- [x] Load and validate the static catalog index and selected set in the browser.
- [x] Replace the Vite starter with the Pixel 9-oriented set and entry interface.
- [x] Support suffix entry, full-ID special entry, repeated copies, recent
  entries, and Undo.
- [x] Add 60-card development and 72-card tournament test-pool modes with atomic
  Undo and explicit DON!! exclusion.
- [x] Add in-memory pool review, quantity editing, removal, and eligibility
  totals.
- [x] Generate and display a deterministic legal 40-card main deck and sideboard.
- [x] Show printed Cost, Power, Counter, and color details in pool and deck card
  lists.
- [x] Add cost/color analysis, strengths and weaknesses, main-deck color rails,
  and a collapsed sideboard.
- [x] Verify OP-16 end to end in a production build.

## Persistent pool workflow

- [ ] Design the persistence milestone.
- [ ] Add Dexie and versioned IndexedDB schemas.
- [ ] Persist sessions and entry events transactionally.
- [ ] Resume the latest unfinished session.
- [ ] Preserve confirmed entries across refresh and immediate closure.
- [ ] Add complete pool search, special-card selection, and quantity editing.
- [ ] Store immutable deck builds against pool and catalog revisions.

## Strategy and synergy engine

- [x] Design the Strategy V2 optimizer, analysis, play-guide, and evaluation
  approach.
- [ ] Define format, generic sealed, Rainbow Luffy, set, card, and synergy
  profiles.
- [x] Add independent overlapping role measurements without double-counting
  interaction cards.
- [x] Add marginal curve, defense, interaction, finisher, and turn-order
  evidence.
- [x] Add searcher/combo support, saturation, redundancy, unsupported-piece,
  and anti-synergy rules.
- [x] Add deterministic OP-16/OP-17 baseline-versus-V2 evaluation over identical
  six-pack pools.
- [ ] Evaluate balanced, pressure, control, and supported set-specific plans.
- [ ] Add deterministic multi-seed improvement and runner-up selection.
- [ ] Add locks, exclusions, and ranked one-for-one sideboard swaps.

## OP-16 strategy and play guide

- [x] Design the Strategy V2 analysis and play-guide work for OP-16.
- [ ] Curate OP-16 card ratings, roles, relationships, and plan affinities.
- [ ] Add OP-16 golden-pool and counterfactual-synergy tests.
- [x] Add structured inclusion scores, overlapping advisory targets, and
  uncapped warning evidence.
- [x] Render turn-order choice, opening priorities, core plan, counter plan,
  finishers, and attack sequencing.
- [x] Render evidence-based strengths, weaknesses, and ranked sideboard
  suggestions.
- [ ] Render explicit one-for-one swaps and runner-up deck details.

## OP-17 strategy guide overlay

- [ ] Design the OP-17 strategy milestone.
- [ ] Encode the supplied OP-17 sealed guide as versioned profile data.
- [ ] Review priority cards, ratios, leader interactions, and supported plans.
- [ ] Resolve or explicitly preserve the seven unknown-rarity warnings.
- [ ] Add OP-17 guide scenarios and stable golden outputs.

## Tournament readiness

- [ ] Design the offline PWA milestone.
- [ ] Add Home, Entry, Pool, and Deck routes.
- [ ] Add a manifest, Pixel 9 icons, service worker, and prompt-based updates.
- [ ] Precache application assets, catalogs, and strategy profiles.
- [ ] Add selected-set offline-readiness verification.
- [ ] Add component and Playwright browser coverage.
- [ ] Complete a Pixel 9 airplane-mode tournament rehearsal.

## Definition of app complete

- [x] No active tooling or generated artifact uses `private/`.
- [x] The Vite starter is gone.
- [ ] A representative physical sealed pool can be entered without pointer use
  between normal cards.
- [ ] Confirmed entries survive closure.
- [x] Every recommended main deck contains exactly 40 eligible entered copies.
- [x] Every generated explanation and guide statement traces to structured
  evidence.
- [ ] The installed Pixel 9 app completes the workflow in airplane mode.
