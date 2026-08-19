# Architecture

## Application flow

The browser app is a React and TypeScript single-page application built by
Vite. It loads the catalog index, lets the user choose a set, and then fetches
that set's static runtime files. The selected pool is represented as an ordered
in-memory event stream plus copy counts, which supports card entry, quantity
editing, removal, and atomic Undo without a server.

Pool state, deck results, and UI state are intentionally not persisted yet. A
refresh starts a new session.

## Static runtime catalogs

`public/catalogs/index.json` describes the committed OP-01 through OP-17
catalogs. Each set directory contains the playable cards, set membership,
strategy suggestions, provenance manifest, and checksums used by the browser.
The loader validates the index and set payloads at the browser boundary before
the app treats them as trusted data.

The tracked catalogs make the app independent of the source website at runtime.
Development and production builds validate them locally before Vite starts.

## Catalog pipeline

The catalog pipeline is a one-way projection:

```text
ignored pinned source snapshot
  -> validated and normalized intermediate bundles
  -> sanitized deterministic runtime catalogs
  -> tracked public/catalogs snapshot
```

`catalog-sources.json` identifies the pinned raw snapshot by URL and SHA-256 and
defines each target set's expected inventory. Source adapters parse the raw
representation; canonicalization combines variants and set membership;
validation checks schema, inventory, cross-references, provenance, forbidden
fields, and checksums.

Publication is staged and validated before it claims the stable
`public/catalogs` directory. Files are copied without replacement, the index is
published last, and failures retain recovery diagnostics. Catalog sync is a
maintenance operation and is not safe to run concurrently with dev or preview.

## Strategy, analysis, and play guide

The solver is a deterministic module over a validated runtime catalog and pool
copy counts. It builds an immutable 40-card main deck for the fixed Rainbow
Luffy leader and records structured score evidence for every inclusion.

Analysis is computed from the selected deck rather than from UI labels. It
measures the cost/color distribution, counter total, overlapping card roles,
turn-order curve, and profile thresholds. The play-guide module consumes that
analysis and the ranked sideboard to produce opening priorities, a core plan,
counter guidance, finishers, attack sequencing, strengths, weaknesses, and
possible adjustments. React components render these results but do not decide
strategy.

## Validation and trust boundaries

- The downloaded Card Kaizoku JSON is untrusted, ignored source input.
- Adapters accept only the documented source schema; unrelated fields are not
  propagated automatically.
- Intermediate bundles stay ignored and may contain diagnostics that are not
  suitable for publication.
- Runtime export permits only the exact expected files and schemas, rejects URLs
  from card data and forbidden source-only keys throughout, and retains the
  pinned source URL only in manifests as provenance.
- Runtime checks verify byte checksums and cross-file references without network
  access.
- The browser validates fetched JSON again before passing it to pool and solver
  modules.
- The deterministic solver is advisory; official rules and human review remain
  authoritative.
