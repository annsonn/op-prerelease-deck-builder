# Card Kaizoku EB0304 Normalization Design

## Context

The Card Kaizoku snapshot dated 2026-08-19 changes the product-level set code
for One Piece Heroines Edition from `EB03` to `EB0304`. Official Bandai card
data identifies the product as `EB-03`. The catalog adapter currently accepts
only canonical two-digit set identifiers, so it silently drops `EB0304` and
removes valid `EB03` reprint membership from `OP05-006` and `OP09-034`.

## Decision

Normalize the exact Card Kaizoku alias `EB0304` to canonical set ID `EB03`
before applying the existing membership validation. Do not split the alias into
both `EB03` and `EB04`, and do not relax the general set-ID pattern. Other
malformed or unknown source set codes remain excluded.

## Data Flow

1. Read the top-level `cardSet` and each product-level `cardSet` value.
2. Trim and uppercase the source value.
3. Replace the exact value `EB0304` with `EB03`.
4. Validate the resulting value using the existing canonical membership
   pattern.
5. Deduplicate and sort memberships through the existing `Set` flow.
6. Regenerate the OP01-OP17 runtime catalogs from the pinned snapshot.

This preserves `EB03` membership on Koala `OP05-006` and Perona `OP09-034`
without changing their gameplay data or admitting arbitrary combined codes.

## Error Handling and Scope

The alias is deliberately narrow and source-specific. Values other than
`EB0304` continue through the existing validation unchanged. The update does
not add EB catalog support, change deck-building rules, retain raw source data
in Git, or alter how catalog publication handles validation failures.

## Testing and Verification

- Add a focused adapter test proving `EB0304` normalizes to `EB03`, combines
  with canonical memberships, and remains deduplicated.
- Confirm the test fails before the parser change and passes afterward.
- Regenerate the catalog twice and confirm deterministic output.
- Verify only source provenance and derived checksums change; `OP05-006` and
  `OP09-034` retain their prior `EB03` membership.
- Run the full repository verification suite, runtime catalog validation, and
  the GitHub Pages production build.
