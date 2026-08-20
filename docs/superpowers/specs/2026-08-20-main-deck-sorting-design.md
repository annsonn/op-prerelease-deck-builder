# Main Deck Sorting Design

## Goal

Let a user reorder the generated Main deck by score, name, cost, or power so
the same deck review can support both strategic evaluation and physically
assembling the cards.

Score remains the default order. Sorting is presentation-only and must not
change which cards are selected, their quantities, their scores, deck analysis,
play guidance, or the Sideboard.

## Interaction

The Main deck header gains a compact sorting toolbar above the card list:

- a native `Sort by` select with `Score`, `Name`, `Cost`, and `Power` options;
- an adjacent direction button that shows the current direction and changes to
  the opposite direction when activated.

Each field starts in its most useful natural direction when selected:

- Score: highest to lowest;
- Name: A to Z;
- Cost: lowest to highest;
- Power: highest to lowest.

The direction button can reverse any of those orders. Its visible state must be
clear, and its accessible name must describe the action, such as `Change sort
direction to ascending` while the current order is descending.

The initial state for every newly generated deck is Score, highest to lowest.
Changing the sort field selects that field's natural direction. The chosen sort
remains active while reviewing the current generated deck and resets when a new
deck solution replaces it.

## Ordering Contract

`DeckResult` owns the sort preference and derives an ordered copy of
`solution.mainDeck`. It must never sort or otherwise mutate the readonly solver
array.

Comparisons use these card or deck-line values:

- Score uses `DeckLine.score`.
- Name uses `PlayableCard.name` with a case-insensitive English comparison.
- Cost uses `PlayableCard.cost`.
- Power uses `PlayableCard.power`.

Cards with a missing cost or power remain last in both directions so unknown
printed stats never obscure the useful numeric sequence. Equal primary values
are ordered by printed card number ascending, regardless of direction, to keep
the result deterministic. Copies remain grouped in their existing single card
row.

Only the Main deck receives the derived order. The Sideboard continues to use
the solver-provided order.

## Component Boundaries and Data Flow

- `DeckResult` owns the selected field and direction because they affect only
  this view.
- A pure comparison/sorting helper copies and orders Main deck lines according
  to the explicit ordering contract.
- `DeckList` remains responsible only for rendering the ordered rows it
  receives.
- `App`, the solver, deck analysis, catalog data, and shared card types remain
  unchanged except for an integration assertion that the control appears after
  a successful build.

No preference is stored in local storage or encoded in the generated deck. The
feature does not add a general table abstraction or sorting API to the solver.

## Responsive and Accessible Presentation

The sorting toolbar sits between the `Main deck` heading and card list. It may
wrap on a narrow viewport, but it must not add a column to the already dense
card rows or cause horizontal scrolling.

The select uses a visible label, native keyboard and touch behavior, and a
minimum 48px control height. The direction button also has at least a 48px touch
target, visible focus treatment, visible current direction, and an accessible
action name. Reordering does not move focus away from either control.

No live region is required: the selected field and direction remain visible,
and the reordered list immediately follows the controls in document order.

## Error Handling

Sort fields and directions are closed typed values selected through controlled
UI elements, so no user-facing error state is needed. Missing cost and power are
handled by the explicit null-last rule. An unsupported internal sort value is a
programming error and should not silently choose an unrelated order.

## Testing and Verification

- `DeckResult` tests begin with deliberately scrambled Main deck fixtures and
  prove the initial Score-descending order rather than relying on solver fixture
  order.
- Tests exercise Score, Name, Cost, and Power in both directions.
- Tie cases prove printed card number is the deterministic secondary key.
- Numeric cases prove missing cost and power remain last in both directions.
- Tests prove the original readonly Main deck array is unchanged.
- Changing fields applies each field's natural direction, while the direction
  button reverses the current field.
- A replacement deck solution resets the controls and list to Score,
  highest-first.
- Sideboard tests prove Main deck sorting does not reorder Sideboard rows.
- Existing card color, Blocker, printed-stat, score, quantity, and reveal
  controls remain present and usable after reordering.
- An `App` integration test confirms the sorting controls appear only with a
  generated deck and retain working row reveal controls.
- Full lint, TypeScript, Vitest, catalog validation, and production build gates
  remain required.
- Browser QA at 412x915 and 1440x900 verifies touch targets, wrapping, focus,
  every field and direction, no horizontal overflow, unchanged Sideboard
  ordering, working reveal controls, and an empty warning/error console.

## Out of Scope

- Sorting the Sideboard, pool review, recent entries, or card catalog.
- Changing solver ranking, scoring, selection, analysis, or play guidance.
- Persisting a sort preference between generated decks or browser sessions.
- Expanding grouped quantities into individual physical-card rows.
- Filtering, searching, or dragging Main deck rows.
