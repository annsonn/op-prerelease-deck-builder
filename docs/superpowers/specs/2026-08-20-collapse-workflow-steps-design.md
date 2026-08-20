# Collapse Workflow Steps and Descending Set Order Design

## Goal

After a successful deck build, collapse Choose your set, Enter your cards, and
Review your pool so the generated deck moves into view. Keep every step easy to
reopen, preserve disclosure state when a build fails, and list OP sets newest
first in the set picker.

## Scope

This change extends the existing controlled native disclosure pattern to steps
1 and 2. It does not change card entry, pool mutation, catalog loading, solver
logic, card images, or generated deck contents.

The Card set dropdown presents OP entries in descending numeric order, from
OP-17 through OP-01. The runtime catalog index remains unchanged.

## Component Boundaries

Add a small `WorkflowStep` component for the common step 1 and step 2 panel
structure. It receives a step number, heading ID, title, description, controlled
`open` state, an `onOpenChange(open)` callback, panel classes, and children.

`WorkflowStep` renders a native `<details>` element. Its `<summary>` is the only
disclosure control and contains the step number, semantic level-2 heading,
description, and an `aria-hidden` plus/minus indicator. The panel children stay
mounted inside the expanded body so form values and component state are not
discarded merely by collapsing a step.

`PoolReview` keeps its existing specialized disclosure because its summary also
owns live copy and eligibility totals. The new component does not refactor or
broaden `PoolReview`.

`CatalogPicker` owns presentation ordering. It sorts a copy of its readonly
entries by the numeric OP suffix in descending order, with a deterministic
fallback for unexpected identifiers. It must not mutate the catalog index
array supplied by `App`.

## State Ownership and Transitions

`App` adds `isSetStepOpen` and `isEntryStepOpen` beside the existing
`isPoolReviewOpen` state.

- Initial load or replacement catalog API reset opens the set step. The entry
  state also resets open and is applied when a catalog makes that step mount.
- Manual summary activation changes only the selected disclosure's presentation
  state. It does not mutate the selected set, pool, solution, or card dialog.
- A successful Build deck closes all three disclosures only after
  `deckSolver.solve(...)` returns a solution.
- Any build error preserves the current open or closed state of all three
  disclosures.
- Selecting a new set preserves the set step's manual state, reopens Enter your
  cards, reopens Review your pool, resets the pool, and clears the stale deck.
  The entry step appears open when the new catalog finishes loading.
- Card entry and Testing Utility actions leave Enter your cards open because
  those actions are initiated from its expanded body. Existing pool mutations
  continue reopening Review your pool without unnecessarily reopening the set
  or entry steps.
- A later successful build closes all three again, regardless of which steps
  the user manually reopened before building.

## Errors and Status

The shared error alert moves outside the collapsible workflow steps. This keeps
catalog, entry, Testing Utility, and solver errors visible and announced even
when a related step is manually closed.

A failed build updates the error alert but does not close any disclosure, clear
an existing card-image dialog, or create a deck solution. Successful build
ordering remains: solve first, then close the dialog, store the solution, close
all three disclosures, and publish the existing success confirmation.

Loading and confirmation content otherwise remains in the step that owns it.

## Presentation and Accessibility

Choose your set and Enter your cards preserve their current step number, title,
description, panel styling, and expanded content. Their closed summaries remain
visible and identify the collapsed step without adding extra selected-set or
pool metadata.

Each summary has at least a 48px touch target, visible focus styling, native
Enter/Space activation, and no nested interactive controls. The custom
plus/minus indicator is hidden from assistive technology. CSS shared by steps 1
and 2 follows the existing PoolReview disclosure layout while keeping class
names generic to workflow steps.

The setup panel's field spacing is updated for the new content wrapper without
changing the Card set control's visual layout. Mobile and desktop layouts must
not introduce horizontal overflow or scroll-jump regressions.

## Testing and Verification

- `WorkflowStep` component tests cover controlled open/closed rendering, native
  manual toggling, programmatic-toggle echo protection, visible headings, hidden
  body controls, and preserved mounted content.
- `CatalogPicker` tests prove OP-17 appears first, OP-01 appears last, intermediate
  sets are numerically descending, and the readonly input array is not mutated.
- `App` integration tests prove a successful build collapses all three steps and
  leaves their summaries visible.
- Integration tests prove each step can reopen independently and a later
  successful build closes all three again.
- A failed build is tested with disclosures both open and manually closed; it
  preserves their state and shows the error alert outside the disclosures.
- Selecting another set after a build reopens entry and pool when the catalog
  loads while preserving the set disclosure's manual state.
- Existing tests that interact with entry or pool controls after a build reopen
  the appropriate step through its visible summary rather than clicking hidden
  controls, except for focused state-owner tests that explicitly exercise a
  transition unavailable through the closed UI.
- Full lint, TypeScript, Vitest, catalog validation, and GitHub Pages base-path
  production build gates remain required.
- Browser QA at 412×915 and 1440×900 verifies all three closed summaries,
  independent reopening, 48px touch targets, keyboard focus/activation where
  the browser surface supports it, descending set order, no horizontal overflow,
  no unexpected console messages, and the generated deck moving into view.

## Out of Scope

- Refactoring all three steps into one reducer or one universal disclosure.
- Changing solver scoring, deck composition, pool rules, or catalog generation.
- Automatically expanding setup or entry for pool-only quantity, Remove, or
  Undo actions.
- Adding selected-set or pool-total metadata to the new closed summaries.
