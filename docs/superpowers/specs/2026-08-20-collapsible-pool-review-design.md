# Collapsible Pool Review Design

## Goal

Collapse the Review your pool section after a successful deck build so the
generated deck moves into view, while keeping the pool easy to reopen and
automatically reopening it whenever the pool or selected set changes.

## State Ownership

`App` owns one `isPoolReviewOpen` boolean because the events that control the
disclosure span pool entry, test-pool generation, deck building, and set
selection. `PoolReview` remains responsible for rendering pool content and
receives the disclosure state plus an `onOpenChange(open)` callback.

The implementation uses a native `<details>` disclosure. Its `<summary>` is the
only disclosure control and contains the existing Review your pool heading and
pool totals. The Undo button remains a separate control at the start of the
expanded content so it is not nested inside another interactive control. Users
can manually expand or collapse the section at any time.

## State Transitions

The disclosure closes only after the solver returns a successful deck solution.
A failed build leaves the current disclosure state unchanged.

The disclosure opens when any action makes the displayed pool or its context
different from the successfully built state:

- selecting or loading a different set;
- accepting a card entry;
- successfully replacing the pool through Testing Utility;
- undoing the last pool change; or
- changing or removing a card quantity.

A failed Testing Utility generation leaves the disclosure state unchanged.
Manually opening or closing the disclosure changes only presentation; it does
not alter the pool, generated deck, or card-image dialog.

## Presentation and Accessibility

The closed summary continues to identify the section as Review your pool and
shows total copies and eligible cards, so users retain important pool context.
The native disclosure supplies keyboard activation and expanded/collapsed
semantics without a custom ARIA widget. The summary keeps at least a 48px touch
target and visible focus styling at Pixel 9 and desktop widths.

The pool list, latest accepted card, recent entries, quantity controls, Undo,
and card-image reveal controls remain unchanged inside the expanded content.
Collapsing the section does not remove or reset any pool data.

## Testing and Verification

- `PoolReview` component tests cover controlled open/closed rendering, manual
  summary toggling, heading/totals visibility, and preserved pool controls.
- `App` integration tests prove successful Build deck collapses the section.
- Integration tests prove set changes, accepted cards, successful test-pool
  replacement, Undo, and quantity changes reopen it.
- Failure tests prove failed build and failed test-pool generation preserve the
  current open state.
- Full lint, TypeScript, Vitest, catalog validation, and production build gates
  remain required.
- Browser QA at 412×915 and 1440×900 checks touch target size, keyboard
  operation, focus styling, no horizontal overflow, and that the pool is closed
  when the generated deck appears after a successful build.
