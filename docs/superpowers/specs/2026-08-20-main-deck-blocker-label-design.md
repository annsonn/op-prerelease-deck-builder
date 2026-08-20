# Main Deck Blocker Label Design

## Goal

Make printed Blocker cards immediately recognizable in the generated Main deck
list by showing a `Blocker` label beside the card's color metadata.

## Scope

This change affects only generated Main deck card rows. A card receives the
label when its catalog feature record reports `flags.blocker === true`, meaning
the card itself has the printed Blocker keyword.

The label does not represent whether Rainbow Luffy can satisfy a conditional
requirement, whether the solver allocated the card to the blocker role, or how
many blocker copies contribute to role coverage.

Non-blocker cards show no blocker label. Sideboard rows remain unchanged because
they do not currently show color metadata.

## Data Flow

`App` already owns the loaded runtime catalog and passes the generated solution
to `DeckResult`. It will also pass the catalog's authoritative
`featuresByCardNumber` map.

`DeckResult` forwards that map to the Main deck list. Each Main deck row looks up
its card number and reads `features.flags.blocker`. It must not infer blocker
status from `allocatedRoles.blocker`, reclassify card text in the component, or
use `rainbowUsableFlags.blocker`.

Every solution card is sourced from the same runtime catalog, so a missing
feature entry is an invariant violation. The UI should fail with a descriptive
missing-feature error instead of silently labeling the card incorrectly.

## Presentation and Accessibility

The existing `CardColorRail` remains responsible only for normalized color
display. `DeckResult` places the color display and blocker label in a wrapping
metadata row.

When `features.flags.blocker` is true, the row renders a visible,
non-interactive `Blocker` pill beside the color names. The pill uses text rather
than only color or an icon, requires no tooltip, and is included in the row's
accessible text. When the flag is false, no blocker pill or placeholder is
rendered.

The metadata row may wrap on narrow mobile screens and must not introduce
horizontal overflow. Existing multicolor rails, card statistics, reveal
controls, colored row backgrounds, and sideboard presentation remain unchanged.

## Component Boundaries

- `App` supplies the runtime feature map alongside the solution.
- `DeckResult` owns presentation of the Main deck blocker label.
- `CardColorRail` stays color-only.
- Shared card classification and solver modules remain unchanged.

No new interactive component is required for a static text label.

## Testing and Verification

- `DeckResult` tests provide feature records for all fixture cards.
- A printed blocker Main deck card shows `Blocker` beside its color metadata.
- A non-blocker Main deck card has no blocker label.
- Tests scope assertions to individual deck rows so the Role coverage heading
  `Blockers` cannot satisfy the assertion accidentally.
- Sideboard rows continue to omit both color metadata and blocker labels.
- An absent feature record produces the descriptive invariant error.
- An `App` integration test proves the loaded catalog feature map reaches the
  generated deck review.
- Full lint, TypeScript, Vitest, catalog validation, and production build gates
  remain required.
- Browser QA at 412×915 and 1440×900 verifies the badge placement, wrapping,
  and absence of horizontal overflow or unexpected console messages.

## Out of Scope

- Showing `Not a blocker` on other cards.
- Labeling Rainbow Luffy compatibility or conditional usability.
- Changing blocker detection, solver scoring, role allocation, role coverage,
  deck composition, or play-guide logic.
- Adding color or blocker metadata to Sideboard rows.
