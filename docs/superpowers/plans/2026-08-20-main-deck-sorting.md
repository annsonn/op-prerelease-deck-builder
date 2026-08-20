# Main Deck Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mobile-friendly Main deck sorting by score, name, cost, and power, with Score descending as the default and a reversible direction control.

**Architecture:** Keep sorting as presentation-only behavior. A focused pure module defines the typed ordering contract and returns a sorted copy of readonly deck lines; `DeckResult` owns the current field and direction, resets them when its solution changes, and passes only the ordered Main deck lines to the existing renderer. The solver, analysis, Sideboard order, and catalog stay unchanged.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, CSS, Vite 8

**Approved design:** `docs/superpowers/specs/2026-08-20-main-deck-sorting-design.md`

---

## File Map

- Create `src/components/main-deck-sort.ts`: typed sort fields, natural directions, strict field parsing, deterministic comparison, and immutable ordering.
- Create `src/components/main-deck-sort.test.ts`: direct ordering-contract tests for all fields, both directions, ties, nulls, invalid fields, and input immutability.
- Modify `src/components/DeckResult.tsx`: local solution-scoped sort preference, labelled controls, and ordered Main deck data flow.
- Modify `src/components/DeckResult.test.tsx`: interaction, reset, Sideboard isolation, focus, metadata, and reveal-control coverage.
- Modify `src/App.test.tsx`: successful-build smoke coverage for the new controls.
- Modify `src/App.css`: responsive toolbar, 48px controls, and focus-visible presentation.
- Modify `docs/superpowers/plans/2026-08-20-main-deck-sorting.md`: check completed steps and record final automated/browser evidence.

### Task 1: Define and test the immutable ordering contract

**Files:**
- Create: `src/components/main-deck-sort.test.ts`
- Create: `src/components/main-deck-sort.ts`

- [x] **Step 1: Write the failing pure-function tests**

Create `src/components/main-deck-sort.test.ts` with complete fixtures that make every ordering decision observable:

```ts
import { describe, expect, it } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { DeckLine } from '../solver/types.js'
import {
  defaultDirectionFor,
  parseMainDeckSortField,
  sortMainDeck,
} from './main-deck-sort.js'

function card(
  cardNumber: string,
  name: string,
  cost: number | null,
  power: number | null,
): PlayableCard {
  return {
    cardNumber,
    name,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost,
    life: null,
    power,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: cardNumber.slice(-3),
    isSpecialReprint: false,
  }
}

function line(
  cardNumber: string,
  name: string,
  cost: number | null,
  power: number | null,
  score: number,
): DeckLine {
  return {
    card: card(cardNumber, name, cost, power),
    quantity: 1,
    allocatedRoles: {
      twoKCounter: 0,
      blocker: 0,
      interaction: 0,
      pressure: 1,
      boss: 0,
      curve: 0,
    },
    score,
    reasons: [],
  }
}

const beta = line('OP16-010', 'beta', 5, 7000, 10)
const alphaTwo = line('OP16-002', 'Alpha', 2, 4000, 20)
const alphaThree = line('OP16-003', 'alpha', 2, null, 20)
const gamma = line('OP16-004', 'Gamma', null, 9000, 5)
const scrambled = Object.freeze([beta, gamma, alphaThree, alphaTwo])

function cardNumbers(lines: readonly DeckLine[]): readonly string[] {
  return lines.map((entry) => entry.card.cardNumber)
}

describe('Main deck sorting', () => {
  it.each([
    ['score', 'descending'],
    ['name', 'ascending'],
    ['cost', 'ascending'],
    ['power', 'descending'],
  ] as const)('uses the natural %s direction', (field, direction) => {
    expect(defaultDirectionFor(field)).toBe(direction)
  })

  it.each([
    ['score', 'descending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['score', 'ascending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
    ['name', 'ascending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['name', 'descending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
    ['cost', 'ascending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['cost', 'descending', ['OP16-010', 'OP16-002', 'OP16-003', 'OP16-004']],
    ['power', 'ascending', ['OP16-002', 'OP16-010', 'OP16-004', 'OP16-003']],
    ['power', 'descending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
  ] as const)(
    'sorts %s %s with deterministic ties and nulls last',
    (field, direction, expected) => {
      expect(cardNumbers(sortMainDeck(scrambled, field, direction))).toEqual(
        expected,
      )
    },
  )

  it('returns a new array without changing the readonly solver order', () => {
    const originalOrder = cardNumbers(scrambled)
    const ordered = sortMainDeck(scrambled, 'score', 'descending')

    expect(ordered).not.toBe(scrambled)
    expect(cardNumbers(scrambled)).toEqual(originalOrder)
  })

  it.each(['score', 'name', 'cost', 'power'] as const)(
    'parses the supported %s field',
    (field) => {
      expect(parseMainDeckSortField(field)).toBe(field)
    },
  )

  it('throws instead of silently accepting an unsupported field', () => {
    expect(() => parseMainDeckSortField('rarity')).toThrowError(
      'Unsupported Main deck sort field: rarity.',
    )
  })
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/components/main-deck-sort.test.ts
```

Expected: FAIL because `./main-deck-sort.js` does not exist.

- [x] **Step 3: Implement the minimal typed sorting module**

Create `src/components/main-deck-sort.ts`:

```ts
import type { DeckLine } from '../solver/types.js'

export const MAIN_DECK_SORT_FIELDS = [
  'score',
  'name',
  'cost',
  'power',
] as const

export type MainDeckSortField = (typeof MAIN_DECK_SORT_FIELDS)[number]
export type MainDeckSortDirection = 'ascending' | 'descending'

const NAME_COLLATOR = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
})

const NATURAL_DIRECTIONS: Readonly<
  Record<MainDeckSortField, MainDeckSortDirection>
> = {
  score: 'descending',
  name: 'ascending',
  cost: 'ascending',
  power: 'descending',
}

export function defaultDirectionFor(
  field: MainDeckSortField,
): MainDeckSortDirection {
  return NATURAL_DIRECTIONS[field]
}

export function parseMainDeckSortField(value: string): MainDeckSortField {
  switch (value) {
    case 'score':
    case 'name':
    case 'cost':
    case 'power':
      return value
    default:
      throw new Error(`Unsupported Main deck sort field: ${value}.`)
  }
}

function applyDirection(
  comparison: number,
  direction: MainDeckSortDirection,
): number {
  return direction === 'ascending' ? comparison : -comparison
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: MainDeckSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return applyDirection(left - right, direction)
}

function comparePrimary(
  left: DeckLine,
  right: DeckLine,
  field: MainDeckSortField,
  direction: MainDeckSortDirection,
): number {
  switch (field) {
    case 'score':
      return applyDirection(left.score - right.score, direction)
    case 'name':
      return applyDirection(
        NAME_COLLATOR.compare(left.card.name, right.card.name),
        direction,
      )
    case 'cost':
      return compareNullableNumbers(left.card.cost, right.card.cost, direction)
    case 'power':
      return compareNullableNumbers(
        left.card.power,
        right.card.power,
        direction,
      )
  }
}

export function sortMainDeck(
  lines: readonly DeckLine[],
  field: MainDeckSortField,
  direction: MainDeckSortDirection,
): readonly DeckLine[] {
  return [...lines].sort((left, right) => {
    const primary = comparePrimary(left, right, field, direction)
    return (
      primary || left.card.cardNumber.localeCompare(right.card.cardNumber, 'en')
    )
  })
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/components/main-deck-sort.test.ts
```

Expected: PASS with all ordering, null, parsing, and immutability cases green.

- [x] **Step 5: Run static checks for the new module**

Run:

```bash
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands exit 0 with no diagnostics for the new files.

- [x] **Step 6: Commit the ordering contract**

```bash
git add src/components/main-deck-sort.ts src/components/main-deck-sort.test.ts
git commit -m "feat: define main deck sorting"
```

### Task 2: Add the Main deck sorting controls and presentation state

**Files:**
- Modify: `src/components/DeckResult.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/DeckResult.tsx`
- Modify: `src/App.css`

- [x] **Step 1: Make the component fixtures distinguish Power ordering**

In `src/components/DeckResult.test.tsx`, add an explicit power to
`secondMainCard`:

```ts
const secondMainCard: PlayableCard = {
  ...mainCard,
  cardNumber: 'OP16-007',
  name: 'Second Main Card',
  colors: ['Green'],
  cost: 6,
  power: 6000,
  effect: '',
  entryShortcut: '007',
}
```

- [x] **Step 2: Add failing toolbar, ordering, reset, isolation, and focus tests**

Add this helper above `describe('DeckResult', ...)` in
`src/components/DeckResult.test.tsx`:

```ts
function mainDeckCardNumbers(): readonly string[] {
  const mainDeck = screen.getByRole('region', { name: 'Main deck' })
  return [...mainDeck.querySelectorAll('.deck-line__identity > small')].map(
    (cardNumber) => cardNumber.textContent ?? '',
  )
}
```

Add these tests inside the existing `DeckResult` suite:

```tsx
it('starts with labelled Score descending controls and orders a scrambled deck', () => {
  render(
    <DeckResult
      solution={{ ...solution, mainDeck: [...solution.mainDeck].reverse() }}
      featuresByCardNumber={featuresByCardNumber}
      onReveal={vi.fn()}
    />,
  )

  const mainDeck = screen.getByRole('region', { name: 'Main deck' })
  const field = within(mainDeck).getByRole('combobox', { name: 'Sort by' })
  const direction = within(mainDeck).getByRole('button', {
    name: 'Change sort direction to ascending',
  })

  expect(field).toHaveValue('score')
  expect(direction).toHaveTextContent('Descending')
  expect(mainDeckCardNumbers()).toEqual(['OP16-005', 'OP16-007'])
})

it('applies each field natural direction and reverses it without losing focus', async () => {
  const user = userEvent.setup()
  render(
    <DeckResult
      solution={solution}
      featuresByCardNumber={featuresByCardNumber}
      onReveal={vi.fn()}
    />,
  )

  const mainDeck = screen.getByRole('region', { name: 'Main deck' })
  const field = within(mainDeck).getByRole('combobox', { name: 'Sort by' })

  await user.selectOptions(field, 'cost')
  expect(field).toHaveFocus()
  expect(mainDeckCardNumbers()).toEqual(['OP16-005', 'OP16-007'])

  const descending = within(mainDeck).getByRole('button', {
    name: 'Change sort direction to descending',
  })
  expect(descending).toHaveTextContent('Ascending')
  await user.click(descending)
  expect(descending).toHaveFocus()
  expect(mainDeckCardNumbers()).toEqual(['OP16-007', 'OP16-005'])

  await user.selectOptions(field, 'power')
  expect(mainDeckCardNumbers()).toEqual(['OP16-005', 'OP16-007'])
  expect(
    within(mainDeck).getByRole('button', {
      name: 'Change sort direction to ascending',
    }),
  ).toHaveTextContent('Descending')

  await user.selectOptions(field, 'name')
  expect(mainDeckCardNumbers()).toEqual(['OP16-005', 'OP16-007'])
  expect(
    within(mainDeck).getByRole('button', {
      name: 'Change sort direction to descending',
    }),
  ).toHaveTextContent('Ascending')
})

it('resets to Score descending when a replacement solution arrives', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <DeckResult
      solution={solution}
      featuresByCardNumber={featuresByCardNumber}
      onReveal={vi.fn()}
    />,
  )

  const mainDeck = screen.getByRole('region', { name: 'Main deck' })
  const field = within(mainDeck).getByRole('combobox', { name: 'Sort by' })
  await user.selectOptions(field, 'cost')
  await user.click(
    within(mainDeck).getByRole('button', {
      name: 'Change sort direction to descending',
    }),
  )
  expect(mainDeckCardNumbers()).toEqual(['OP16-007', 'OP16-005'])

  rerender(
    <DeckResult
      solution={{ ...solution, mainDeck: [...solution.mainDeck].reverse() }}
      featuresByCardNumber={featuresByCardNumber}
      onReveal={vi.fn()}
    />,
  )

  expect(field).toHaveValue('score')
  expect(mainDeckCardNumbers()).toEqual(['OP16-005', 'OP16-007'])
  expect(
    within(mainDeck).getByRole('button', {
      name: 'Change sort direction to ascending',
    }),
  ).toHaveTextContent('Descending')
})

it('keeps Sideboard order and Main deck reveal controls intact after sorting', async () => {
  const user = userEvent.setup()
  const onReveal = vi.fn()
  render(
    <DeckResult
      solution={solution}
      featuresByCardNumber={featuresByCardNumber}
      onReveal={onReveal}
    />,
  )

  const mainDeck = screen.getByRole('region', { name: 'Main deck' })
  await user.selectOptions(
    within(mainDeck).getByRole('combobox', { name: 'Sort by' }),
    'cost',
  )
  await user.click(
    within(mainDeck).getByRole('button', {
      name: 'Change sort direction to descending',
    }),
  )
  await user.click(
    within(mainDeck).getByRole('button', {
      name: 'View Second Main Card, OP16-007',
    }),
  )
  expect(onReveal).toHaveBeenLastCalledWith(secondMainCard)

  await user.click(screen.getByText('Sideboard · 2 cards'))
  const sideboard = screen.getByRole('region', { name: 'Sideboard' })
  expect(
    [...sideboard.querySelectorAll('.deck-line__identity > small')].map(
      (cardNumber) => cardNumber.textContent,
    ),
  ).toEqual(['OP16-006', 'OP16-008'])
})
```

- [x] **Step 3: Add a failing successful-build smoke assertion**

In the existing `src/App.test.tsx` full build-flow test, before activating
`Build deck`, prove the controls do not exist without a generated result:

```ts
expect(
  screen.queryByRole('combobox', { name: 'Sort by' }),
).not.toBeInTheDocument()
```

Then, immediately after:

```ts
const mainDeck = screen.getByRole('region', { name: 'Main deck' })
```

add:

```ts
expect(
  within(mainDeck).getByRole('combobox', { name: 'Sort by' }),
).toHaveValue('score')
expect(
  within(mainDeck).getByRole('button', {
    name: 'Change sort direction to ascending',
  }),
).toHaveTextContent('Descending')
```

At the end of that same successful-build test, prove a second successful build
replaces the solution and resets the still-mounted `DeckResult`:

```ts
const sortField = within(mainDeck).getByRole('combobox', { name: 'Sort by' })
await user.selectOptions(sortField, 'cost')
await user.click(
  within(mainDeck).getByRole('button', {
    name: 'Change sort direction to descending',
  }),
)
expect(sortField).toHaveValue('cost')

await user.click(buildButton)

expect(sortField).toHaveValue('score')
expect(
  within(mainDeck).getByRole('button', {
    name: 'Change sort direction to ascending',
  }),
).toHaveTextContent('Descending')
```

- [x] **Step 4: Run the component tests and verify RED**

Run:

```bash
npm test -- src/components/DeckResult.test.tsx src/App.test.tsx
```

Expected: FAIL because the Main deck toolbar and local ordering state do not yet
exist. Existing unrelated tests remain green.

- [x] **Step 5: Implement solution-scoped sort state and the toolbar**

Update the React import at the top of `src/components/DeckResult.tsx`:

```ts
import { useMemo, useState } from 'react'
```

Add these imports:

```ts
import {
  defaultDirectionFor,
  type MainDeckSortDirection,
  type MainDeckSortField,
  parseMainDeckSortField,
  sortMainDeck,
} from './main-deck-sort.js'
```

Add these local types and helpers before `DeckResult`:

```ts
interface StoredMainDeckSort {
  readonly solution: DeckSolution
  readonly field: MainDeckSortField
  readonly direction: MainDeckSortDirection
}

function initialMainDeckSort(solution: DeckSolution): StoredMainDeckSort {
  return {
    solution,
    field: 'score',
    direction: defaultDirectionFor('score'),
  }
}

function oppositeDirection(
  direction: MainDeckSortDirection,
): MainDeckSortDirection {
  return direction === 'ascending' ? 'descending' : 'ascending'
}

function directionText(direction: MainDeckSortDirection): string {
  return direction === 'ascending' ? 'Ascending ↑' : 'Descending ↓'
}
```

At the start of `DeckResult`, add solution-scoped local state. Comparing the
stored solution reference makes a replacement solution use the default during
that same render without an effect or a one-frame stale order:

```ts
const [storedSort, setStoredSort] = useState<StoredMainDeckSort>(() =>
  initialMainDeckSort(solution),
)
const activeSort =
  storedSort.solution === solution ? storedSort : initialMainDeckSort(solution)
const orderedMainDeck = useMemo(
  () =>
    sortMainDeck(
      solution.mainDeck,
      activeSort.field,
      activeSort.direction,
    ),
  [solution.mainDeck, activeSort.field, activeSort.direction],
)
const nextDirection = oppositeDirection(activeSort.direction)

function handleSortFieldChange(value: string): void {
  const field = parseMainDeckSortField(value)
  setStoredSort({
    solution,
    field,
    direction: defaultDirectionFor(field),
  })
}

function handleDirectionChange(): void {
  setStoredSort({
    solution,
    field: activeSort.field,
    direction: nextDirection,
  })
}
```

Replace the plain Main deck heading with this header and toolbar:

```tsx
<div className="main-deck__header">
  <h3 id="main-deck-heading">Main deck</h3>
  <div className="main-deck-sort" role="group" aria-label="Main deck sorting">
    <label className="main-deck-sort__field">
      <span>Sort by</span>
      <select
        value={activeSort.field}
        onChange={(event) => handleSortFieldChange(event.currentTarget.value)}
      >
        <option value="score">Score</option>
        <option value="name">Name</option>
        <option value="cost">Cost</option>
        <option value="power">Power</option>
      </select>
    </label>
    <button
      type="button"
      className="main-deck-sort__direction"
      aria-label={`Change sort direction to ${nextDirection}`}
      onClick={handleDirectionChange}
    >
      {directionText(activeSort.direction)}
    </button>
  </div>
</div>
```

Change only the Main deck list input:

```tsx
<DeckList
  lines={orderedMainDeck}
  featuresByCardNumber={featuresByCardNumber}
  showMainDeckMetadata
  onReveal={onReveal}
/>
```

Leave the Sideboard `DeckList` input as `solution.sideboard`.

- [x] **Step 6: Add responsive, touch-target CSS**

Add this block after `.main-deck` in `src/App.css`:

```css
.main-deck__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-bottom: 12px;
}

.main-deck__header h3 {
  margin-bottom: 0;
}

.main-deck-sort {
  display: flex;
  min-width: 0;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
}

.main-deck-sort__field {
  display: grid;
  min-width: 112px;
  gap: 4px;
}

.main-deck-sort__field > span {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 750;
}

.main-deck-sort__field select,
.main-deck-sort__direction {
  min-height: 48px;
  border: 1px solid #bac4d1;
  border-radius: 12px;
  color: var(--ink);
  background: #fff;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
}

.main-deck-sort__field select {
  width: 100%;
  padding: 0 34px 0 12px;
}

.main-deck-sort__direction {
  padding: 0 12px;
  cursor: pointer;
  white-space: nowrap;
}

.main-deck-sort__direction:hover {
  border-color: var(--red-dark);
  color: var(--red-dark);
}

.main-deck-sort__field select:focus-visible,
.main-deck-sort__direction:focus-visible {
  outline: 3px solid rgb(37 99 184 / 42%);
  outline-offset: 2px;
}
```

Add this inside the existing narrow-screen media query so the controls have an
explicit wrapping contract at mobile widths:

```css
.main-deck-sort {
  width: 100%;
}

.main-deck-sort__field {
  flex: 1 1 112px;
}
```

- [x] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- src/components/main-deck-sort.test.ts src/components/DeckResult.test.tsx src/App.test.tsx
```

Expected: PASS. Confirm the new tests prove field defaults, direction reversal,
replacement reset, focus retention, reveal controls, and Sideboard isolation.

- [x] **Step 8: Run static checks**

Run:

```bash
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 9: Commit the toolbar integration**

```bash
git add src/components/DeckResult.tsx src/components/DeckResult.test.tsx src/App.test.tsx src/App.css
git commit -m "feat: sort main deck cards"
```

### Task 3: Run the complete gate and browser QA

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-main-deck-sorting.md`
- Modify only if a defect is found: the smallest source/test file that owns it

- [x] **Step 1: Run the complete repository verification gate**

Run:

```bash
npm run verify
npm run build
git diff --check
git status --short
```

Expected:

- lint exits 0;
- both app and tools TypeScript projects exit 0;
- the complete Vitest suite passes;
- all runtime catalogs pass `catalog:check`;
- the production Vite build completes;
- diff check emits no output;
- the worktree contains only intended plan evidence before its final commit.

If the sandbox blocks the known `tsx` IPC socket used by catalog validation,
rerun only that command with the required approval rather than weakening or
skipping the gate.

- [x] **Step 2: Start a clean local app for browser QA**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local `http://127.0.0.1:<port>/` URL after the predev
catalog check succeeds. Keep the process running in its terminal session.

- [x] **Step 3: Verify the mobile workflow at exactly 412x915**

Use the in-app browser against the fresh local URL:

1. Select OP16 and use the development Testing Utility to replace the pool.
2. Build a valid deck and confirm Setup, Enter your cards, and Review your pool
   collapse only after the successful build.
3. Confirm Main deck initially reads `Score` and `Descending` and matches
   highest-score-first order.
4. Select Name, Cost, and Power in turn and confirm their natural directions.
5. Reverse each field and verify visible row order changes correctly.
6. For Cost, confirm the visible printed costs progress low-to-high before
   reversing to high-to-low; any missing cost remains last.
7. For Power, confirm any missing power remains last in both directions.
8. Confirm a tie is resolved by printed card number ascending.
9. Activate a reordered card's reveal button and close the image dialog.
10. Expand Sideboard and confirm its order does not change while Main deck is
    sorted.
11. Focus both sorting controls and confirm the visible focus outline. Attempt
    native keyboard activation in the browser. An in-app Browser limitation is
    acceptable only when the same injected key also fails on an unrelated
    focused native control, the limitation is documented without claiming
    browser keyboard success, and automated coverage proves both native Enter
    and literal Space activation.
12. Measure both controls at a minimum 48px height and verify
    `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
    Record `window.innerWidth` separately so the browser's vertical-scrollbar
    width is not misclassified as horizontal overflow.
13. Also verify the Main deck and sorting toolbar each satisfy
    `scrollWidth === clientWidth`, and both control rectangles remain inside the
    Main deck; the result panel's overflow styling can otherwise conceal
    internal clipping.
14. Confirm the warning/error console is empty.

- [x] **Step 4: Verify the desktop workflow at exactly 1440x900**

Repeat the build and sorting checks at 1440x900. Confirm the toolbar remains
aligned with the Main deck heading, the controls do not crowd card metadata,
focus remains on the control used after each reorder, the Sideboard remains
unchanged, reveal still works, there is no horizontal overflow, and the
warning/error console is empty. Measure document, Main deck, and toolbar widths
separately so clipped internal overflow cannot pass unnoticed.

- [x] **Step 5: Verify replacement-solution reset in the browser**

With a built deck sorted by Cost descending, activate `Build deck` again without
changing the pool. This replaces the solution while `DeckResult` stays mounted.
Confirm the replacement deck returns to Score descending rather than retaining
Cost descending.

- [x] **Step 6: Fix any QA defect with a new failing regression test** — Not
  applicable: QA found no product defect, so no source or regression-test change
  was required.

If QA finds a defect, stop and use systematic debugging. Add a focused failing
test that reproduces the observed behavior, run it to prove RED, make the
smallest owning change, rerun it to prove GREEN, then repeat the full automated
and browser gates. Do not broaden sorting into the solver or Sideboard as a
shortcut.

- [x] **Step 7: Record evidence and commit verification documentation**

Check completed boxes in this plan and add a `## Verification Evidence` section
with the actual test totals, catalog totals, build module count, measured mobile
and desktop control sizes, overflow results, ordering observations, reset
observation, reveal/Sideboard results, and console results.

Then run:

```bash
git diff --check
git add docs/superpowers/plans/2026-08-20-main-deck-sorting.md
git commit -m "docs: verify main deck sorting"
git status --short --branch
```

Expected: the documentation commit succeeds and the final worktree is clean on
the feature branch, ready for a local merge into `main`. Do not push unless the
user explicitly asks.

## Verification Evidence

### Branch and automated gate

- Initial browser verification ran from `codex/main-deck-sorting` at `7b5e193`.
  Task 1 and Task 2 artifacts are present in `fd0fdcb`, `045b806`, `2153b42`,
  and `7b5e193`; the fresh Task 3 run verified their resulting behavior but did
  not recreate the historical RED states. Follow-up commit `95a4454` adds only
  the mutation-sensitive keyboard tests described below.
- `npm run verify` initially reached catalog validation after lint, typecheck,
  and tests, then hit the known sandbox-only `tsx` IPC `EPERM`. The exact
  command was rerun with approval and exited 0: lint 0 diagnostics; app and
  tools TypeScript 0 diagnostics; Vitest **54/54 files and 816/816 tests** in
  **8.00s**; runtime catalogs **17 sets / 85 files**.
- `npm run build` initially hit the same sandbox-only `tsx` IPC `EPERM` in its
  catalog prehook. The exact command was rerun with approval and exited 0:
  catalogs **17 sets / 85 files**, Vite 8.2.1, **128 modules transformed**, and
  production build in **111ms**. Output was `index.html` 0.59 kB (0.35 kB
  gzip), CSS 24.59 kB (5.70 kB gzip), and JS 339.90 kB (102.00 kB gzip).
- Before the full gate, the focused sorting suite passed **3/3 files and 59/59
  tests**. For mutation sensitivity, temporarily neutralizing the direction
  button `onClick` made both parameterized keyboard cases fail: **1 file, 2
  failed, 11 skipped**, each because `Ascending` was expected but `Descending`
  remained visible. After fully restoring production, the same focused cases
  passed: **1 file, 2 passed, 11 skipped**. No production diff remained.
- Pre-QA `git diff --check` exited 0 and `git status --short` was empty. The
  fresh development server passed its catalog prehook and started at
  `http://127.0.0.1:5173/` in **82ms**.

### Browser QA — 412x915

- A fresh local tab had no `.main-deck` or `.main-deck-sort` before build.
  OP16 was selected; **Generate 60-card development pool** replaced the pool
  (60 copies, 58 eligible); the build produced **Strategy sealed build**, Main
  **40**, Sideboard **18**, and collapsed all three workflow disclosures.
- Default Score/Descending order passed across all visible Main rows. The first
  scores were `OP16-017:27`, `OP16-010:26`, `OP16-006:24.9`, then the 23.5 tie
  `OP16-004` before `OP16-102`; the 6.0 tie was `OP16-051` before `OP16-105`.
- Name defaulted ascending and reversed descending; the equal-name
  `Monkey.D.Luffy` tie stayed `OP16-015` before `OP16-034` in both directions.
  Cost defaulted ascending and reversed descending; Power defaulted descending
  and reversed ascending. Every adjacent primary comparison passed, and all
  equal Cost/Power groups used ascending printed card number (for example,
  Cost 8 `OP16-086` before `OP16-096`, and Power 8,000 `OP16-004`, `007`,
  `013`, `017`, `096`, `112`). The randomized Main deck exposed **0 null Cost**
  and **0 null Power** rows, so null-last was not claimed from browser data;
  the passing pure-function suite covers nulls last in both numeric directions.
- Baseline Main card-number/quantity set (40 copies) was:
  `017:1, 010:1, 006:1, 004:2, 102:1, 062:1, 067:1, 086:3, 088:1,
  018:1, 028:1, 025:1, 029:2, 027:1, 042:1, 023:1, 112:1, 026:1,
  094:1, 092:1, 072:1, 064:1, 007:1, 114:2, 033:1, 034:1, 071:2,
  051:2, 105:1, 068:1, 096:1, 015:1, 013:1` (all `OP16-`). Every sort and
  rebuild retained this exact set and copy count.
- Expanded Sideboard order stayed exactly
  `OP16-089:3, 035:2, 014:2, 053:1, 069:1, 059:2, 099:1, 039:1,
  076:1, 117:1, 019:3`. Role coverage (`17` 2K counters, `3` blockers,
  `6` vanilla-like bodies, `10` interaction, `7` bosses, `4` draw, `6`
  removal, `0` rush, `0` banish, `5` bricks), strengths/weaknesses, and the
  complete play guide were unchanged after every sort.
- From Power ascending, the reordered first card `OP16-034 Monkey.D.Luffy`
  opened a dialog with the correct identity, alt text, and `OP16-034_EN.webp`;
  closing removed the dialog and left both sorting controls enabled.
- The select retained focus after the click-plus-select operation and showed a
  **3px** visible outline. The direction button retained focus after pointer
  activation and showed the same **3px** outline. In-app Browser injected
  Enter/Space did not activate the focused button; the same injection also did
  not activate an unrelated focused native Sideboard `<summary>`, while pointer
  activation worked for both. This is recorded as a browser-automation
  limitation, not as observed browser keyboard success or a product defect.
  Parameterized Testing Library coverage independently proves native Enter and
  literal Space activation exactly once: Score/Descending changes to
  Score/Ascending, the action label changes to `Change sort direction to
  descending`, rows change from `OP16-005, OP16-007` to
  `OP16-007, OP16-005`, and the button retains focus. Neutralizing the production
  `onClick` made both cases fail at the unchanged `Descending` assertion before
  production was fully restored and both cases passed.
- Measured select **48px** high and button **48px** high. Document
  `397/397`, Main `347/347`, and toolbar `347/347` scroll/client widths were
  equal at exact `window.innerWidth=412`. The 15px difference between viewport
  inner width and document client width was the vertical scrollbar, not
  horizontal overflow. Both control rectangles were inside Main, and the
  controls ended at y=391.65625 before the first row began at y=402.65625 (no
  overlap).
- With Cost ascending selected, a second Build deck activation without pool
  mutation reset to Score/Descending. Main 40, Sideboard 18, exact card sets,
  Sideboard order, and analysis remained unchanged. Console warning/error log:
  **0 entries**.

### Browser QA — 1440x900

- A separate fresh local tab confirmed exact `innerWidth=1440` and
  `innerHeight=900`, no pre-build Main/sorting controls, OP16 development-pool
  replacement, successful Strategy build, Main **40**, Sideboard **18**, and
  all three workflow disclosures collapsed.
- Default Score/Descending passed; the first rows were `OP16-006:26`,
  `OP16-086:24.7`, `OP16-083:23.2`, and the browser exposed Score ties including
  `OP16-091` before `OP16-103` at 8.0. Name ascending/descending, Cost
  ascending/descending, and Power descending/ascending all passed every
  adjacent primary comparison. Cost/Power ties stayed printed-card-number
  ascending (for example Cost 7 `OP16-007` before `OP16-035`, Power 9,000
  `OP16-035` before `OP16-086`). No equal-name pair and **0 null Cost/Power**
  rows occurred in this randomized Main deck; mobile evidence and the passing
  pure-function tests cover those unavailable observations.
- Baseline Main set (40 copies) was:
  `OP16-006:1, 086:1, 083:1, 062:3, 018:1, 028:1, 043:1, 027:1,
  042:1, 029:2, 007:1, 112:1, 070:1, 092:1, 009:3, 094:2, 109:2,
  075:1, 110:1, 106:1, 091:1, 103:1, 035:1, 034:1, 051:1, 105:1,
  008:1, 011:1, 111:2, 013:1, 054:1, 071:1`. All sorts/rebuilds retained it.
  Expanded Sideboard order stayed exactly
  `OP16-068:1, 098:1, 107:1, 111:1, 036:1, 049:1, 078:1, 047:2,
  039:2, 055:1, 057:2, 115:1, 100:1, 117:1, 101:1`.
- Role coverage (`13` 2K counters, `6` blockers, `5` vanilla-like bodies,
  `12` interaction, `3` bosses, `6` draw, `8` removal, `3` rush, `0` banish,
  `8` bricks), strengths/weaknesses, and the complete play guide stayed
  unchanged. Reordered `OP16-034 Monkey.D.Luffy` reveal/identity/image/close
  passed and left controls usable.
- Select and button focus each showed a **3px** outline; the same keyboard
  injection limitation and native-summary comparison reproduced at desktop.
  Pointer operation remained successful.
- Select and button were each **48px** high. Document `1425/1425`, Main
  `650/650`, and toolbar `243/243` scroll/client widths were equal at exact
  `window.innerWidth=1440`. The 15px viewport/client difference was the vertical
  scrollbar, not horizontal overflow. Both controls were inside Main; controls
  ended at y=400.9375 and the first row began at y=411.9375, so there was no
  toolbar/row overlap or metadata crowding.
- Second builds without pool mutation reset both Cost/Ascending and, in an
  additional check, Cost/Descending to Score/Descending while retaining Main,
  Sideboard, and analysis. Console warning/error log: **0 entries**.

### Outcome

No product defect was observed and no production file was changed during
verification. The follow-up change is test-only, and all automated, pointer
activation and touch-target sizing, ordering, invariance, reveal, reset, sizing,
overflow, and console gates passed. The sole concern is that in-app Browser
keyboard injection could not demonstrate activation even on an unrelated native
disclosure; focus retention and visible focus styling were observed, automated
Enter/Space activation coverage passed, and the browser limitation is explicitly
not counted as browser keyboard-activation evidence.
