# Collapsible Pool Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Review your pool after a successful deck build and reopen it whenever the selected set or pool changes, without changing pool data or existing controls.

**Architecture:** `App` owns a controlled `isPoolReviewOpen` boolean because it already owns every build, set-selection, and pool-mutation transition. `PoolReview` renders a native `<details>`/`<summary>` disclosure and reports manual toggles through `onOpenChange`; the existing pool content remains mounted inside the expanded body. A small `DeckSolver` prop seam lets integration tests prove that failed builds preserve disclosure state while production continues to use `StrategyDeckSolver`.

**Tech Stack:** React 19, TypeScript 6, native HTML disclosure semantics, Testing Library/user-event, Vitest, CSS

---

## File map

- Modify `src/components/PoolReview.tsx`: render the controlled native disclosure and keep Undo outside the interactive summary.
- Modify `src/components/PoolReview.test.tsx`: cover open/closed presentation, manual toggling, summary context, and unchanged pool controls.
- Modify `src/App.tsx`: own disclosure state, apply successful/failing transition rules, and provide the solver test seam.
- Modify `src/App.test.tsx`: prove build collapse, all automatic reopen paths, and failure-state preservation.
- Modify `src/App.css`: provide the summary layout, 48 px touch target, focus treatment, and expanded-body spacing.
- Update `docs/superpowers/plans/2026-08-20-collapsible-pool-review.md`: record completed automated and browser verification.

### Task 1: Build the controlled pool disclosure

**Files:**
- Modify: `src/components/PoolReview.test.tsx`
- Modify: `src/components/PoolReview.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [x] **Step 1: Add failing component tests for the controlled disclosure**

Add `useState` and `waitFor` imports, then add this stateful test wrapper below `emptyPool` in `src/components/PoolReview.test.tsx`:

```tsx
function ControlledPoolReview({
  pool,
  initialOpen = true,
}: {
  pool: PoolState
  initialOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(initialOpen)

  return (
    <PoolReview
      catalog={catalog}
      pool={pool}
      eligibleCount={Object.values(pool.counts).reduce(
        (total, quantity) => total + quantity,
        0,
      )}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onQuantity={vi.fn()}
      onUndo={vi.fn()}
      onReveal={vi.fn()}
    />
  )
}

function poolDisclosure(): HTMLDetailsElement {
  const disclosure = screen.getByText('Review your pool').closest('details')
  if (!(disclosure instanceof HTMLDetailsElement)) {
    throw new Error('Expected Review your pool inside a details disclosure.')
  }
  return disclosure
}
```

Add focused tests that establish the contract:

```tsx
it('keeps the heading and totals visible while the pool controls are collapsed', () => {
  const pool = appendCards(emptyPool, [playableCard.cardNumber])
  render(<ControlledPoolReview pool={pool} initialOpen={false} />)

  expect(poolDisclosure()).not.toHaveAttribute('open')
  expect(screen.getByRole('heading', { name: 'Review your pool' })).toBeVisible()
  expect(screen.getByLabelText('Pool totals')).toHaveTextContent('1 copies')
  expect(screen.getByLabelText('Pool totals')).toHaveTextContent('1 eligible')
  expect(
    screen.getByRole('button', { name: 'Undo last change', hidden: true }),
  ).not.toBeVisible()
})

it('lets the native summary manually open and close the controlled pool', async () => {
  const user = userEvent.setup()
  const pool = appendCards(emptyPool, [playableCard.cardNumber])
  render(<ControlledPoolReview pool={pool} initialOpen={false} />)
  const summary = screen.getByText('Review your pool').closest('summary')
  if (summary === null) throw new Error('Expected a pool disclosure summary.')

  await user.click(summary)
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))
  expect(screen.getByLabelText('Latest accepted card')).toBeVisible()

  await user.click(summary)
  await waitFor(() => expect(poolDisclosure()).not.toHaveAttribute('open'))
})

it('does not echo programmatic open state back through onOpenChange', async () => {
  const onOpenChange = vi.fn()
  const pool = appendCards(emptyPool, [playableCard.cardNumber])
  const view = render(
    <PoolReview
      catalog={catalog}
      pool={pool}
      eligibleCount={1}
      isOpen
      onOpenChange={onOpenChange}
      onQuantity={vi.fn()}
      onUndo={vi.fn()}
      onReveal={vi.fn()}
    />,
  )
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))
  expect(onOpenChange).not.toHaveBeenCalled()

  view.rerender(
    <PoolReview
      catalog={catalog}
      pool={pool}
      eligibleCount={1}
      isOpen={false}
      onOpenChange={onOpenChange}
      onQuantity={vi.fn()}
      onUndo={vi.fn()}
      onReveal={vi.fn()}
    />,
  )
  await waitFor(() => expect(poolDisclosure()).not.toHaveAttribute('open'))
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('keeps Undo separate from the summary and preserves expanded controls', async () => {
  const user = userEvent.setup()
  const onUndo = vi.fn()
  const pool = appendCards(emptyPool, [playableCard.cardNumber])
  render(
    <PoolReview
      catalog={catalog}
      pool={pool}
      eligibleCount={1}
      isOpen
      onOpenChange={vi.fn()}
      onQuantity={vi.fn()}
      onUndo={onUndo}
      onReveal={vi.fn()}
    />,
  )

  const undo = screen.getByRole('button', { name: 'Undo last change' })
  expect(undo.closest('summary')).toBeNull()
  expect(screen.getByRole('spinbutton')).toBeVisible()
  await user.click(undo)
  expect(onUndo).toHaveBeenCalledOnce()
  expect(poolDisclosure()).toHaveAttribute('open')
})
```

Add `isOpen` and `onOpenChange={vi.fn()}` to the two existing `PoolReview` renders so their current stats/reveal assertions continue to run against expanded content.

- [x] **Step 2: Run the component test to verify RED**

Run:

```bash
npx vitest run --project browser src/components/PoolReview.test.tsx
```

Expected: FAIL because `PoolReview` does not accept `isOpen`/`onOpenChange`, does not render `<details>`, and leaves content visible.

- [x] **Step 3: Implement the controlled native disclosure**

Extend `PoolReviewProps` in `src/components/PoolReview.tsx`:

```tsx
interface PoolReviewProps {
  catalog: RuntimeCatalog
  pool: PoolState
  eligibleCount: number
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onQuantity: (cardNumber: string, quantity: number) => void
  onUndo: () => void
  onReveal: (card: PlayableCard) => void
}
```

Destructure the two new props and replace the current return value with this complete disclosure structure:

```tsx
<details
  className="panel pool-review"
  aria-labelledby="pool-heading"
  open={isOpen}
  onToggle={(event) => {
    const nextOpen = event.currentTarget.open
    if (nextOpen !== isOpen) onOpenChange(nextOpen)
  }}
>
  <summary className="pool-review__summary">
    <span className="step-number" aria-hidden="true">3</span>
    <span className="pool-review__summary-copy">
      <span
        id="pool-heading"
        className="pool-review__heading"
        role="heading"
        aria-level={2}
      >
        Review your pool
      </span>
      <span className="pool-totals" aria-label="Pool totals">
        <span>{totalCopies} copies</span>
        <span>{eligibleCount} eligible</span>
      </span>
    </span>
  </summary>

  <div className="pool-review__content">
    <div className="pool-review__actions">
      <button
        type="button"
        className="text-button"
        disabled={pool.events.length === 0}
        onClick={onUndo}
      >
        Undo last change
      </button>
    </div>

    {latestCard !== undefined ? (
      <div className="latest-card" aria-label="Latest accepted card">
        <span className="latest-card__identity">
          <span>Latest accepted card</span>
          <strong>
            {latestCard.name} · {latestCard.cardNumber}
          </strong>
        </span>
        <CardRevealButton card={latestCard} onReveal={onReveal} />
      </div>
    ) : null}

    {lines.length === 0 ? (
      <div className="empty-state">
        <strong>No cards entered yet</strong>
        <span>Your accepted entries will appear here.</span>
      </div>
    ) : (
      <ul className="pool-list">
        {lines.map(({ card, cardNumber, quantity }) => (
          <li key={cardNumber} className="pool-line">
            <div className="card-identity">
              <strong>{card.name}</strong>
              <span>
                {card.cardNumber} · {card.cardType}
              </span>
              <CardStats
                cost={card.cost}
                power={card.power}
                counter={card.counter}
              />
            </div>
            <div className="quantity-actions">
              <QuantityEditor
                cardNumber={cardNumber}
                cardName={card.name}
                quantity={quantity}
                onQuantity={onQuantity}
              />
              <button
                type="button"
                className="remove-button"
                aria-label={`Remove ${card.name} (${cardNumber})`}
                onClick={() => onQuantity(cardNumber, 0)}
              >
                Remove
              </button>
            </div>
            <CardRevealButton card={card} onReveal={onReveal} />
          </li>
        ))}
      </ul>
    )}

    {pool.recentCardNumbers.length > 0 ? (
      <details className="recent-entries">
        <summary>Recent accepted entries</summary>
        <ol>
          {pool.recentCardNumbers.map((cardNumber, index) => {
            const card = catalog.cardsByNumber.get(cardNumber)
            return (
              <li key={`${cardNumber}-${index}`}>
                {card?.name ?? cardNumber}
              </li>
            )
          })}
        </ol>
      </details>
    ) : null}
  </div>
</details>
```

Give `App` a temporary always-open controlled state so the new required props compile without changing build behavior yet:

```tsx
const [isPoolReviewOpen, setIsPoolReviewOpen] = useState(true)
```

Pass it to `PoolReview`:

```tsx
isOpen={isPoolReviewOpen}
onOpenChange={setIsPoolReviewOpen}
```

Add these styles next to `.pool-totals` in `src/App.css`:

```css
.pool-review__summary {
  display: grid;
  min-height: 48px;
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 12px;
  color: var(--navy-dark);
  cursor: pointer;
  list-style: none;
}

.pool-review__summary::-webkit-details-marker {
  display: none;
}

.pool-review__summary::after {
  color: var(--red-dark);
  content: '+';
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1;
  text-align: center;
}

.pool-review[open] > .pool-review__summary::after {
  content: '−';
}

.pool-review__summary:focus-visible {
  border-radius: 8px;
  outline: 3px solid rgb(37 99 184 / 42%);
  outline-offset: 3px;
}

.pool-review__summary-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.pool-review__heading {
  color: var(--navy-dark);
  font-size: 1.12rem;
  font-weight: 800;
  line-height: 1.25;
}

.pool-review__content {
  padding-top: 12px;
}

.pool-review__actions {
  display: flex;
  min-height: 48px;
  justify-content: flex-end;
  align-items: center;
}
```

- [x] **Step 4: Run focused tests and type checking to verify GREEN**

Run:

```bash
npx vitest run --project browser src/components/PoolReview.test.tsx src/App.test.tsx
npm run typecheck
```

Expected: all focused tests pass; app and tools TypeScript checks exit 0.

- [x] **Step 5: Commit the controlled disclosure**

```bash
git add src/components/PoolReview.tsx src/components/PoolReview.test.tsx src/App.tsx src/App.css
git commit -m "feat: make pool review collapsible"
```

### Task 2: Apply build and pool-change transitions

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add App integration helpers and failing transition tests**

Import `DeckSolver` from `src/solver/types.ts`, then add:

```tsx
function poolDisclosure(): HTMLDetailsElement {
  const disclosure = screen.getByText('Review your pool').closest('details')
  if (!(disclosure instanceof HTMLDetailsElement)) {
    throw new Error('Expected Review your pool inside a details disclosure.')
  }
  return disclosure
}

async function generateDevelopmentPool(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(
    await screen.findByRole('button', {
      name: 'Generate 60-card development pool',
    }),
  )
}
```

Add a successful-build test:

```tsx
it('collapses the pool after a successful build and lets the user reopen it', async () => {
  const user = userEvent.setup()
  render(
    <App
      catalogApi={catalogApi()}
      testPoolApi={{ generate: () => testPoolGeneration() }}
    />,
  )

  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Card set' }),
    'OP16',
  )
  await generateDevelopmentPool(user)
  expect(poolDisclosure()).toHaveAttribute('open')

  await user.click(screen.getByRole('button', { name: 'Build deck' }))

  expect(poolDisclosure()).not.toHaveAttribute('open')
  expect(screen.getByRole('heading', { name: 'Review your pool' })).toBeVisible()
  expect(screen.getByLabelText('Pool totals')).toHaveTextContent('60 copies')
  expect(screen.getByRole('heading', { name: 'Strategy sealed build' })).toBeVisible()

  await user.click(screen.getByText('Review your pool').closest('summary')!)
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))
  expect(screen.getByRole('button', { name: 'Undo last change' })).toBeVisible()
})
```

Add one sequential test for all mutation routes. It should repeatedly build to close, perform the named mutation, and assert the disclosure reopened. Use normal user actions for card entry, test-pool replacement, and set selection. For controls that correctly become inaccessible inside a closed native disclosure, dispatch their existing DOM events directly to verify the App state transition:

```tsx
it('reopens the pool after accepted cards, test replacement, quantity, Undo, and set changes', async () => {
  const user = userEvent.setup()
  render(
    <App
      catalogApi={catalogApi()}
      testPoolApi={{ generate: () => testPoolGeneration() }}
    />,
  )
  const picker = await screen.findByRole('combobox', { name: 'Card set' })
  await user.selectOptions(picker, 'OP16')
  await generateDevelopmentPool(user)

  await user.click(screen.getByRole('button', { name: 'Build deck' }))
  const suffixInput = screen.getByRole('textbox', {
    name: 'Card number (1–3 digits)',
  })
  await user.type(suffixInput, '5')
  await user.click(screen.getByRole('button', { name: 'Add number' }))
  expect(poolDisclosure()).toHaveAttribute('open')

  await user.click(screen.getByRole('button', { name: 'Build deck' }))
  await generateDevelopmentPool(user)
  expect(poolDisclosure()).toHaveAttribute('open')

  await user.click(screen.getByRole('button', { name: 'Build deck' }))
  const quantity = document.querySelector<HTMLInputElement>(
    'input[aria-label="Quantity for OP16-005 Test Card (OP16-005)"]',
  )
  if (quantity === null) throw new Error('Expected hidden pool quantity input.')
  fireEvent.change(quantity, { target: { value: '36' } })
  fireEvent.blur(quantity)
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))

  await user.click(screen.getByRole('button', { name: 'Build deck' }))
  const undo = document.querySelector<HTMLButtonElement>(
    '.pool-review__actions .text-button',
  )
  if (undo === null) throw new Error('Expected hidden Undo button.')
  fireEvent.click(undo)
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))

  await user.click(screen.getByRole('button', { name: 'Build deck' }))
  const remove = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove OP16-012 Test Card (OP16-012)"]',
  )
  if (remove === null) throw new Error('Expected hidden pool Remove button.')
  fireEvent.click(remove)
  await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))

  await user.click(screen.getByText('Review your pool').closest('summary')!)
  await waitFor(() => expect(poolDisclosure()).not.toHaveAttribute('open'))
  await user.selectOptions(picker, 'OP17')
  expect(await screen.findByText('OP17 is ready for pool entry.')).toBeVisible()
  expect(poolDisclosure()).toHaveAttribute('open')
  expect(screen.getByLabelText('Pool totals')).toHaveTextContent('0 copies')
})
```

Add failure tests. A failed build should be tested once while open and once while manually closed; a failed test-pool replacement should be attempted after a successful build has closed the pool:

```tsx
it.each([true, false])(
  'preserves pool disclosure state when deck building fails (open=%s)',
  async (startsOpen) => {
    const user = userEvent.setup()
    const deckSolver: DeckSolver = {
      solve: () => {
        throw new Error('solver failed')
      },
    }
    render(
      <App
        catalogApi={catalogApi()}
        testPoolApi={{ generate: () => testPoolGeneration() }}
        deckSolver={deckSolver}
      />,
    )
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await generateDevelopmentPool(user)
    if (!startsOpen) {
      await user.click(screen.getByText('Review your pool').closest('summary')!)
      await waitFor(() => expect(poolDisclosure()).not.toHaveAttribute('open'))
    }

    await user.click(screen.getByRole('button', { name: 'Build deck' }))

    expect(screen.getByRole('alert')).toHaveTextContent('solver failed')
    expect(poolDisclosure().open).toBe(startsOpen)
  },
)
```

Extend the existing `preserves the pool and solution when test-pool generation throws` test with assertions that the first successful Build deck closes the disclosure and the failing generator leaves it closed.

Extend `preserves the pool and solution when generated replacement is empty` by manually reopening the pool before the invalid replacement, then asserting that the failed replacement leaves it open. Together, the two existing failure tests prove both closed and open disclosure states are preserved.

Update existing tests whose intended pool interaction follows a successful build:

- In `generates a deterministic 60-card pool with rarity details and one-step Undo`, assert the successful build closed `poolDisclosure()`, click its summary, wait for `open`, and only then click Undo.
- In `owns one card dialog without letting image failure mutate the pool or solution`, click the pool summary and wait for `open` after Build deck and before locating the first pool row.

These are user-flow updates, not weakened assertions: closed native disclosure content must not be queried as though it were currently interactive.

- [ ] **Step 2: Run the App test to verify RED**

Run:

```bash
npx vitest run --project browser src/App.test.tsx
```

Expected: FAIL because a successful build does not close the disclosure, mutations do not explicitly reopen it, and `App` does not yet accept an injected `deckSolver`.

- [ ] **Step 3: Implement App-owned transition rules**

Import `DeckSolver` beside `DeckSolution`, replace the module solver with a typed default, and extend the app boundary:

```tsx
import type { DeckSolution, DeckSolver } from './solver/types.js'

interface AppProps {
  catalogApi?: CatalogApi
  testPoolApi?: TestPoolApi
  deckSolver?: DeckSolver
}

const defaultDeckSolver: DeckSolver = new StrategyDeckSolver()

function App({
  catalogApi = defaultCatalogApi,
  testPoolApi = defaultTestPoolApi,
  deckSolver = defaultDeckSolver,
}: AppProps) {
```

Keep the existing `isPoolReviewOpen` state. Add `setIsPoolReviewOpen(true)` to the catalog API reset effect, `handleSelect`, `handleCard`, the successful branch of `handleGenerateTestPool`, `handleUndo`, and `handleQuantity`. Do not add it to either failure branch.

Update `handleBuild` so closure happens only after the injected solver returns:

```tsx
const handleBuild = useCallback(() => {
  if (catalog === null) return
  try {
    const nextSolution = deckSolver.solve(catalog, pool.counts)
    setRevealedCard(null)
    setSolution(nextSolution)
    setIsPoolReviewOpen(false)
    setError(null)
    setConfirmation('Built a 40-card main deck.')
  } catch (cause) {
    setError(errorMessage(cause))
    setConfirmation('')
  }
}, [catalog, deckSolver, pool.counts])
```

Do not clear or mutate the pool when toggling, and do not change any existing `revealedCard` behavior.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
npx vitest run --project browser src/App.test.tsx src/components/PoolReview.test.tsx src/components/CardImageDialog.test.tsx
```

Expected: all focused tests pass, including existing card-image ownership and reset behavior.

- [ ] **Step 5: Commit the transition behavior**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: collapse pool after deck build"
```

### Task 3: Verify behavior and record browser QA

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-collapsible-pool-review.md`

- [ ] **Step 1: Run the complete automated quality gate**

Run:

```bash
npm run verify
npm run build -- --base=/op-prerelease-deck-builder/
git diff --check
```

Expected: lint, app/tools TypeScript, all Vitest tests, 17-set/85-file catalog validation, production build, and whitespace checks all exit 0.

- [ ] **Step 2: Run mobile browser QA at 412×915**

Start the app with `npm run dev -- --host 127.0.0.1`, load OP16, generate a 60-card development pool, and Build deck. Verify:

- Review your pool is collapsed when Strategy sealed build appears.
- The closed summary still shows copies and eligible totals.
- The summary is at least 48 px high and has a visible keyboard focus ring.
- Keyboard Enter/Space and touch/click reopen the pool.
- Undo, quantities, remove, latest card, recent entries, and View card controls remain usable when expanded.
- Adding a card after another build reopens the pool automatically.
- There is no horizontal overflow and no unexpected console warning/error.

- [ ] **Step 3: Run desktop browser QA at 1440×900**

Repeat the successful build/collapse, manual reopen, and card-entry reopen flow. Verify the summary, pool content, sticky Build deck panel, generated deck, and card-image dialog remain visually separated and usable with no horizontal overflow or unexpected console warning/error.

- [ ] **Step 4: Record verification evidence in this plan**

Append a `## Verification evidence` section containing the exact test/build counts, the two viewport sizes, the exercised transitions, any saved screenshot paths under ignored `tmp/`, and any honestly qualified tooling limitation. Check off only steps actually completed.

- [ ] **Step 5: Commit the verification record**

```bash
git add docs/superpowers/plans/2026-08-20-collapsible-pool-review.md
git commit -m "docs: complete collapsible pool review plan"
```
