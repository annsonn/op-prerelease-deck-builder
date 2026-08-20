# Collapse Workflow Steps and Descending Set Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse all three workflow steps only after a successful deck build, preserve their state on build errors, reopen entry and pool for a new set, and display OP sets newest-first.

**Architecture:** Add a small controlled `WorkflowStep` native disclosure for steps 1 and 2 while retaining the specialized `PoolReview` disclosure for step 3. `App` owns all three open states and changes them only at explicit workflow transitions; `CatalogPicker` derives a descending presentation copy without mutating the validated ascending catalog index.

**Tech Stack:** React 19, TypeScript 6, native `<details>/<summary>`, Testing Library, Vitest, Vite, CSS.

---

## File Map

- Create `src/components/WorkflowStep.tsx`: controlled native disclosure shared only by setup and entry.
- Create `src/components/WorkflowStep.test.tsx`: disclosure semantics, controlled state, mounted-content, and interaction coverage.
- Create `src/components/CatalogPicker.test.tsx`: descending numeric ordering and input immutability.
- Modify `src/components/CatalogPicker.tsx`: sort a copied list for presentation.
- Modify `src/App.tsx`: own setup/entry disclosure state, render `WorkflowStep`, move the shared error alert, and close all three disclosures after a successful solve.
- Modify `src/App.test.tsx`: integration coverage and existing workflows adjusted to reopen closed steps through their summaries.
- Modify `src/App.css`: generic workflow disclosure styles and setup-content spacing.
- Modify `docs/superpowers/plans/2026-08-20-collapse-workflow-steps.md`: check completed steps and record final browser QA evidence.

### Task 1: Add the reusable controlled workflow disclosure

**Files:**
- Create: `src/components/WorkflowStep.tsx`
- Create: `src/components/WorkflowStep.test.tsx`
- Modify: `src/App.css`

- [x] **Step 1: Write failing component tests**

Create `src/components/WorkflowStep.test.tsx` with a controlled harness and these assertions:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowStep } from './WorkflowStep.js'

function ControlledStep({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <WorkflowStep
      stepNumber={1}
      headingId="test-heading"
      title="Choose your set"
      description="Your pool resets when you change sets."
      isOpen={open}
      onOpenChange={setOpen}
      className="setup-panel"
    >
      <button type="button">Child action</button>
    </WorkflowStep>
  )
}

describe('WorkflowStep', () => {
  it('renders an accessible controlled disclosure and keeps closed content mounted', () => {
    render(<ControlledStep initiallyOpen={false} />)

    const details = screen.getByRole('heading', { name: 'Choose your set' })
      .closest('details')
    expect(details).toBeInstanceOf(HTMLDetailsElement)
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'Choose your set' })).toBeVisible()
    expect(document.querySelector('button')).toBeInTheDocument()
    expect(document.querySelector('button')).not.toBeVisible()
    expect(details?.querySelector('.workflow-step__indicator')).toHaveTextContent('+')
  })

  it('opens and closes through the native summary without duplicate callback echoes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const view = render(
      <WorkflowStep
        stepNumber={2}
        headingId="entry-heading"
        title="Enter your cards"
        description="Enter card numbers."
        isOpen={false}
        onOpenChange={onOpenChange}
      >
        <button type="button">Child action</button>
      </WorkflowStep>,
    )
    const summary = screen.getByText('Enter your cards').closest('summary')
    if (summary === null) throw new Error('Expected workflow summary.')

    await user.click(summary)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    view.rerender(
      <WorkflowStep
        stepNumber={2}
        headingId="entry-heading"
        title="Enter your cards"
        description="Enter card numbers."
        isOpen
        onOpenChange={onOpenChange}
      >
        <button type="button">Child action</button>
      </WorkflowStep>,
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1))
    await user.click(summary)
    expect(onOpenChange).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/components/WorkflowStep.test.tsx
```

Expected: FAIL because `./WorkflowStep.js` does not exist.

- [x] **Step 3: Implement the minimal controlled component**

Create `src/components/WorkflowStep.tsx`:

```tsx
import type { ReactNode } from 'react'

interface WorkflowStepProps {
  stepNumber: number
  headingId: string
  title: string
  description: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  children: ReactNode
}

export function WorkflowStep({
  stepNumber,
  headingId,
  title,
  description,
  isOpen,
  onOpenChange,
  className = '',
  children,
}: WorkflowStepProps) {
  return (
    <details
      className={`panel workflow-step ${className}`.trim()}
      aria-labelledby={headingId}
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (nextOpen !== isOpen) onOpenChange(nextOpen)
      }}
    >
      <summary className="workflow-step__summary">
        <span className="step-number" aria-hidden="true">
          {stepNumber}
        </span>
        <span className="workflow-step__summary-copy">
          <span
            id={headingId}
            className="workflow-step__heading"
            role="heading"
            aria-level={2}
          >
            {title}
          </span>
          <span className="workflow-step__description">{description}</span>
        </span>
        <span className="workflow-step__indicator" aria-hidden="true">
          {isOpen ? '−' : '+'}
        </span>
      </summary>
      <div className="workflow-step__content">{children}</div>
    </details>
  )
}
```

- [x] **Step 4: Add generic disclosure styling**

In `src/App.css`, add the generic workflow styles beside the existing PoolReview disclosure styles:

```css
.workflow-step__summary {
  display: grid;
  min-height: 48px;
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 12px;
  color: var(--navy-dark);
  cursor: pointer;
  list-style: none;
}

.workflow-step__summary::-webkit-details-marker {
  display: none;
}

.workflow-step__summary:focus-visible {
  border-radius: 8px;
  outline: 3px solid rgb(37 99 184 / 42%);
  outline-offset: 3px;
}

.workflow-step__summary-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.workflow-step__heading {
  color: var(--navy-dark);
  font-size: 1.12rem;
  font-weight: 800;
  line-height: 1.25;
}

.workflow-step__description {
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.45;
}

.workflow-step__indicator {
  color: var(--red-dark);
  font-size: 1.35rem;
  font-weight: 800;
  justify-self: center;
  line-height: 1;
  text-align: center;
}

.workflow-step__content {
  padding-top: 12px;
}

.setup-panel .workflow-step__content > .field {
  margin-top: 6px;
}
```

Remove the obsolete direct-child rule:

```css
.setup-panel > .field {
  margin-top: 18px;
}
```

- [x] **Step 5: Run the component test, lint, and typecheck**

Run:

```bash
npx vitest run src/components/WorkflowStep.test.tsx
npm run lint
npm run typecheck
```

Expected: the WorkflowStep test file passes; lint and typecheck exit 0.

- [x] **Step 6: Commit Task 1**

```bash
git add src/components/WorkflowStep.tsx src/components/WorkflowStep.test.tsx src/App.css
git commit -m "feat: add workflow step disclosure"
```

### Task 2: Present OP sets in descending numeric order

**Files:**
- Create: `src/components/CatalogPicker.test.tsx`
- Modify: `src/components/CatalogPicker.tsx`

- [x] **Step 1: Write failing ordering and immutability tests**

Create `src/components/CatalogPicker.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeCatalogIndexEntry } from '../../shared/catalog-index.js'
import { CatalogPicker } from './CatalogPicker.js'

const sourceSha256 = 'a'.repeat(64)

function entry(setNumber: number): RuntimeCatalogIndexEntry {
  const setId = `OP${String(setNumber).padStart(2, '0')}`
  return {
    setId,
    label: `OP-${String(setNumber).padStart(2, '0')}`,
    manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
    sourceSha256,
    readiness: 'tournament-ready',
  }
}

describe('CatalogPicker', () => {
  it('shows OP sets in descending numeric order', () => {
    render(
      <CatalogPicker
        entries={[entry(1), entry(16), entry(2), entry(17), entry(10)]}
        selectedSetId=""
        onSelect={vi.fn()}
      />,
    )
    const options = within(screen.getByRole('combobox', { name: 'Card set' }))
      .getAllByRole('option')
      .slice(1)
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'OP17',
      'OP16',
      'OP10',
      'OP02',
      'OP01',
    ])
  })

  it('does not mutate the supplied catalog index entries', () => {
    const entries = [entry(1), entry(17), entry(2)]
    const originalOrder = entries.map(({ setId }) => setId)
    render(
      <CatalogPicker entries={entries} selectedSetId="" onSelect={vi.fn()} />,
    )
    expect(entries.map(({ setId }) => setId)).toEqual(originalOrder)
  })
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/components/CatalogPicker.test.tsx
```

Expected: the order test FAILS with the original input order.

- [x] **Step 3: Sort a copied list in `CatalogPicker`**

Add above `CatalogPicker` in `src/components/CatalogPicker.tsx`:

```ts
function opSetNumber(setId: string): number {
  const match = /^OP(\d+)$/.exec(setId)
  return match === null ? Number.NEGATIVE_INFINITY : Number(match[1])
}
```

Inside the component, before `return`, derive the presentation list:

```ts
const orderedEntries = [...entries].sort(
  (left, right) =>
    opSetNumber(right.setId) - opSetNumber(left.setId) ||
    right.setId.localeCompare(left.setId),
)
```

Replace `entries.map(...)` with `orderedEntries.map(...)` in the `<select>`.

- [x] **Step 4: Run focused and App catalog-picker tests**

Run:

```bash
npx vitest run src/components/CatalogPicker.test.tsx src/App.test.tsx
```

Expected: both test files pass, and existing option lookup remains valid.

- [x] **Step 5: Commit Task 2**

```bash
git add src/components/CatalogPicker.tsx src/components/CatalogPicker.test.tsx
git commit -m "feat: order OP sets newest first"
```

### Task 3: Control setup and entry disclosures from App

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Add reusable disclosure test helpers**

In `src/App.test.tsx`, replace the pool-only DOM helpers with generic workflow helpers:

```ts
function workflowDisclosure(name: string): HTMLDetailsElement {
  const disclosure = screen.getByRole('heading', { name }).closest('details')
  if (!(disclosure instanceof HTMLDetailsElement)) {
    throw new Error(`Expected ${name} inside a details disclosure.`)
  }
  return disclosure
}

function workflowSummary(name: string): HTMLElement {
  const summary = screen.getByRole('heading', { name }).closest('summary')
  if (summary === null) throw new Error(`Expected summary for ${name}.`)
  return summary
}

const setDisclosure = () => workflowDisclosure('Choose your set')
const entryDisclosure = () => workflowDisclosure('Enter your cards')
const poolDisclosure = () => workflowDisclosure('Review your pool')
const poolSummary = () => workflowSummary('Review your pool')

async function openWorkflowStep(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  const disclosure = workflowDisclosure(name)
  if (!disclosure.open) {
    await user.click(workflowSummary(name))
    await waitFor(() => expect(disclosure).toHaveAttribute('open'))
  }
}
```

Update `generateDevelopmentPool` so every existing test reaches the Testing
Utility through the visible disclosure:

```ts
async function generateDevelopmentPool(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await openWorkflowStep(user, 'Enter your cards')
  await user.click(
    await screen.findByRole('button', {
      name: 'Generate 60-card development pool',
    }),
  )
}
```

- [x] **Step 2: Write failing successful-build disclosure tests**

Extend the successful build test to assert all three disclosures start open, close only after the build succeeds, retain visible headings, reopen independently, and close again on a later successful build:

```ts
expect(setDisclosure()).toHaveAttribute('open')
expect(entryDisclosure()).toHaveAttribute('open')
expect(poolDisclosure()).toHaveAttribute('open')

await user.click(screen.getByRole('button', { name: 'Build deck' }))

expect(setDisclosure()).not.toHaveAttribute('open')
expect(entryDisclosure()).not.toHaveAttribute('open')
expect(poolDisclosure()).not.toHaveAttribute('open')
for (const name of ['Choose your set', 'Enter your cards', 'Review your pool']) {
  expect(screen.getByRole('heading', { name })).toBeVisible()
}

await user.click(workflowSummary('Choose your set'))
await waitFor(() => expect(setDisclosure()).toHaveAttribute('open'))
expect(entryDisclosure()).not.toHaveAttribute('open')
expect(poolDisclosure()).not.toHaveAttribute('open')
await user.click(workflowSummary('Enter your cards'))
await user.click(workflowSummary('Review your pool'))
await waitFor(() => {
  expect(entryDisclosure()).toHaveAttribute('open')
  expect(poolDisclosure()).toHaveAttribute('open')
})

await user.click(screen.getByRole('button', { name: 'Build deck' }))
expect(setDisclosure()).not.toHaveAttribute('open')
expect(entryDisclosure()).not.toHaveAttribute('open')
expect(poolDisclosure()).not.toHaveAttribute('open')
```

Update workflows that interact with CardEntry or Testing Utility after a successful build to call:

```ts
await openWorkflowStep(user, 'Enter your cards')
```

before querying those now-hidden controls.

- [x] **Step 3: Write failing build-error state tests**

Replace the pool-only failure matrix with a matrix that controls all three disclosures. For each row, manually put the disclosures into the requested state, trigger the throwing solver, then assert the states are unchanged and the external alert is visible:

```ts
it.each([
  { setOpen: true, entryOpen: true, poolOpen: true },
  { setOpen: false, entryOpen: false, poolOpen: false },
  { setOpen: false, entryOpen: true, poolOpen: false },
])('preserves workflow disclosure state when deck building fails: %o', async (state) => {
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

  for (const [name, shouldOpen] of [
    ['Choose your set', state.setOpen],
    ['Enter your cards', state.entryOpen],
    ['Review your pool', state.poolOpen],
  ] as const) {
    if (workflowDisclosure(name).open !== shouldOpen) {
      await user.click(workflowSummary(name))
      await waitFor(() => expect(workflowDisclosure(name).open).toBe(shouldOpen))
    }
  }

  fireEvent.click(screen.getByRole('button', { name: 'Build deck' }))

  expect(screen.getByRole('alert')).toHaveTextContent('solver failed')
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('alert').closest('details')).toBeNull()
  expect(setDisclosure().open).toBe(state.setOpen)
  expect(entryDisclosure().open).toBe(state.entryOpen)
  expect(poolDisclosure().open).toBe(state.poolOpen)
  expect(document.querySelector('.result-panel')).toBeNull()
})
```

Keep the existing dialog-preservation assertion in the all-open case: reveal a
pool card before triggering the throwing solver, then assert the same dialog is
still visible after the alert appears.

- [x] **Step 4: Write the failing set-change transition test**

After a successful OP16 build, reopen only setup, select OP17, and assert the setup state is preserved while Entry and Pool reopen after the OP17 catalog resolves:

```ts
await user.click(screen.getByRole('button', { name: 'Build deck' }))
await user.click(workflowSummary('Choose your set'))
await waitFor(() => expect(setDisclosure()).toHaveAttribute('open'))
await user.selectOptions(screen.getByRole('combobox', { name: 'Card set' }), 'OP17')
resolveOp17(runtimeCatalog(17, []))
await screen.findByText('OP17 is ready for pool entry.')

expect(setDisclosure()).toHaveAttribute('open')
expect(entryDisclosure()).toHaveAttribute('open')
expect(poolDisclosure()).toHaveAttribute('open')
expect(poolTotals()).toHaveTextContent('0 copies')
expect(document.querySelector('.result-panel')).toBeNull()
```

Extend the existing replacement-`catalogApi` test so it asserts setup is open
after the API reset and Entry plus Pool are open after the replacement catalog
loads:

```ts
expect(setDisclosure()).toHaveAttribute('open')
resolveReplacement(op16Catalog())
await screen.findByRole('button', { name: 'Build deck' })
expect(setDisclosure()).toHaveAttribute('open')
expect(entryDisclosure()).toHaveAttribute('open')
expect(poolDisclosure()).toHaveAttribute('open')
```

- [x] **Step 5: Run App tests and verify RED**

Run:

```bash
npx vitest run src/App.test.tsx
```

Expected: new tests FAIL because steps 1 and 2 are not disclosures, successful builds do not close them, and the catalog-loaded error alert is nested inside Entry.

- [x] **Step 6: Add App-owned setup and entry state**

Import the component:

```ts
import { WorkflowStep } from './components/WorkflowStep.js'
```

Add state beside `isPoolReviewOpen`:

```ts
const [isSetStepOpen, setIsSetStepOpen] = useState(true)
const [isEntryStepOpen, setIsEntryStepOpen] = useState(true)
```

In the `catalogApi` reset effect, restore all three:

```ts
setIsSetStepOpen(true)
setIsEntryStepOpen(true)
setIsPoolReviewOpen(true)
```

In `handleSelect`, preserve the current setup state and reopen Entry and Pool:

```ts
setIsEntryStepOpen(true)
setIsPoolReviewOpen(true)
```

In the successful `handleBuild` path, add the two close operations only after `deckSolver.solve(...)` returns:

```ts
const nextSolution = deckSolver.solve(catalog, pool.counts)
setRevealedCard(null)
setSolution(nextSolution)
setIsSetStepOpen(false)
setIsEntryStepOpen(false)
setIsPoolReviewOpen(false)
setError(null)
setConfirmation('Built a 40-card main deck.')
```

Do not add disclosure setters to the `catch` block.

- [x] **Step 7: Replace setup and entry sections with controlled disclosures**

Replace the setup `<section>` wrapper with:

```tsx
<WorkflowStep
  stepNumber={1}
  headingId="set-heading"
  title="Choose your set"
  description="Your pool resets when you change sets."
  isOpen={isSetStepOpen}
  onOpenChange={setIsSetStepOpen}
  className="setup-panel"
>
  {loadingIndex ? (
    <p className="loading-status" role="status">
      Loading card sets…
    </p>
  ) : index === null ? null : (
    <CatalogPicker
      entries={index.sets}
      selectedSetId={selectedSetId}
      onSelect={handleSelect}
    />
  )}

  {loadingSetId !== null && selectedEntry !== null ? (
    <p className="loading-status" role="status">
      Loading {selectedEntry.label}…
    </p>
  ) : null}

  {catalog !== null && selectedEntry !== null ? (
    <div className="catalog-summary">
      <div className="leader-summary">
        <span className="leader-mark" aria-hidden="true">
          L
        </span>
        <span>
          <strong>Rainbow Luffy</strong>
          <small>Fixed all-color leader</small>
        </span>
      </div>
      <div className="catalog-status">
        <span className={`readiness readiness--${selectedEntry.readiness}`}>
          {selectedEntry.readiness === 'tournament-ready'
            ? 'Tournament ready'
            : selectedEntry.readiness === 'needs-review'
              ? 'Needs review'
              : 'Provisional'}
        </span>
        <span>{catalog.cards.length} card records loaded</span>
      </div>
    </div>
  ) : null}
</WorkflowStep>
```

Replace the entry `<section>` wrapper with:

```tsx
<WorkflowStep
  stepNumber={2}
  headingId="entry-heading"
  title="Enter your cards"
  description="Use the short number for normal cards or a full reprint ID."
  isOpen={isEntryStepOpen}
  onOpenChange={setIsEntryStepOpen}
  className="entry-panel"
>
  <p
    className={`entry-message confirmation-status${
      confirmation === '' ? ' confirmation-status--empty' : ''
    }`}
    role="status"
    aria-label="Entry confirmation"
  >
    {confirmation}
  </p>
  <CardEntry
    key={catalog.manifest.setId}
    catalog={catalog}
    onCard={handleCard}
    onError={handleEntryError}
  />
  <TestPoolButton onGenerate={handleGenerateTestPool} />
</WorkflowStep>
```

The snippets above are the complete replacement bodies for setup and entry;
remove the old duplicated `.section-heading` markup.

- [x] **Step 8: Move the shared error alert outside every disclosure**

Delete both conditional error renderings and add one unconditional shared location immediately after the setup `WorkflowStep`:

```tsx
{error !== null ? (
  <p className="message message--error" role="alert">
    {error}
  </p>
) : null}
```

This single alert covers index, catalog, card-entry, Testing Utility, and solver failures and remains visible even when setup or entry is closed.

- [x] **Step 9: Run focused disclosure regressions**

Run:

```bash
npx vitest run src/components/WorkflowStep.test.tsx src/components/CatalogPicker.test.tsx src/components/PoolReview.test.tsx src/App.test.tsx
```

Expected: all focused files pass. Confirm failures are not bypassed with hidden DOM clicks except tests explicitly checking state-owner transitions.

- [x] **Step 10: Commit Task 3**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: collapse workflow after successful builds"
```

### Task 4: Full verification, browser QA, and plan readback

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-collapse-workflow-steps.md`

- [x] **Step 1: Run repository gates**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
git diff --check
```

Expected: lint and TypeScript exit 0; all Vitest files pass; catalog check reports all 17 OP sets and 85 catalog files; the Vite production build completes; `git diff --check` prints no output.

- [x] **Step 2: Run mobile browser QA at 412×915**

Start the app with `npm run dev -- --host 127.0.0.1`, open the reported local URL, set the viewport to 412×915, and verify:

1. Card set options are OP-17 through OP-01 in descending numeric order.
2. Setup, Entry, and Pool begin open and each summary is at least 48px high.
3. Generate a valid test pool and Build deck; all three summaries remain visible while all three bodies close and the deck result is visible below them.
4. Reopen each summary independently by tap; the other disclosure states do not change.
5. Build again; all three close again.
6. Use a solver-error fixture in automated coverage to confirm errors preserve state; browser QA must at least confirm the shared alert position remains outside the disclosures for an invalid card entry.
7. Reopen setup, select another set, and confirm Entry and Pool reopen after loading while setup remains open.
8. No horizontal overflow, unexpected console errors, or focus loss on summary activation.

- [x] **Step 3: Run desktop browser QA at 1440×900**

Repeat the successful build, independent reopening, set ordering, set-change, keyboard Enter/Space summary activation, visible `:focus-visible` ring, and no-overflow checks at 1440×900.

- [x] **Step 4: Record evidence and check off the plan**

Update this plan’s checkboxes and append a short `## Verification Evidence` section containing the exact passing test count, catalog count, build result, QA viewports, and any environment-qualified interaction result. Do not mark an unsupported browser interaction as passed.

- [x] **Step 5: Commit verification evidence**

```bash
git add docs/superpowers/plans/2026-08-20-collapse-workflow-steps.md
git commit -m "docs: verify collapsible workflow steps"
```

- [x] **Step 6: Request standards and spec review**

Dispatch independent reviewers against the feature branch’s merge-base with `main`. Resolve every Critical or Important finding, rerun the affected focused tests, and repeat review until both axes approve.

- [x] **Step 7: Merge locally to `main` and verify the integrated tree**

After review approval, use the finishing-a-development-branch workflow, merge the feature branch into local `main` without pushing, then rerun:

```bash
npm run verify
npm run build
git status --short --branch
```

Expected: verification and build pass; local `main` is clean and ahead of `origin/main` by the new commits.

## Verification Evidence

Verified in the `codex/collapse-workflow-steps` worktree on 2026-08-20.

- Repository gates, run in the documented order:
  - `npm run lint`: exit 0; `oxlint` reported no diagnostics.
  - `npm run typecheck`: exit 0; both `tsc -b` and `tsc -p tsconfig.tools.json` completed.
  - `npm test`: exit 0; 53/53 test files and 791/791 tests passed in 9.62 seconds.
  - `npm run catalog:check`: exit 0; `Runtime catalogs ready: 17 sets, 85 files`.
  - `npm run build`: exit 0; the prebuild catalog check again reported 17 sets / 85 files, TypeScript completed, and Vite 8.2.1 transformed 127 modules and produced `dist/index.html` (0.59 kB), CSS (23.31 kB), and JavaScript (337.39 kB) in 241 ms.
  - `git diff --check`: exit 0 with no output.
  - Environment qualification: the first sandboxed catalog and build attempts could not create the temporary `tsx` IPC socket (`listen EPERM`). Re-running those same commands with the required temporary IPC permission produced the passing results above.
- In-app-browser QA at 412×915:
  - The set options were exactly OP17, OP16, OP15, OP14, OP13, OP12, OP11, OP10, OP09, OP08, OP07, OP06, OP05, OP04, OP03, OP02, OP01 after the disabled prompt: numeric descending, OP17 first and OP01 last.
  - After OP16 loaded, Setup, Entry, and Pool were all open. Their summary heights were 48 px, 67.21 px, and 48 px respectively.
  - A generated 60-card development pool enabled Build deck. A successful build closed all three disclosures, left all three summary headings rendered and visible, retained focus on Build deck, and moved the visible Strategy sealed build result into the viewport (`scrollY` 783).
  - Tapping Setup, Entry, and Pool reopened each independently without changing the other two states. A second successful build closed all three again.
  - Entering short card number `999` showed the visible shared alert `No normally numbered card 999 exists in OP16.`; the alert had no enclosing `details` element. The error did not change the other disclosure states.
  - After another successful build, reopening Setup and selecting OP17 kept Setup open, reopened Entry and Pool after load, reset Pool to 0 copies / 0 eligible, cleared the alert, and removed the stale deck result.
  - At every measured state, `documentElement.scrollWidth === clientWidth === 412`. Pointer activation retained focus on the activated summary, and captured console warning/error logs were empty.
- In-app-browser QA at 1440×900:
  - The same exact OP17-through-OP01 ordering was present. After OP16 loaded, all three disclosures were open and every summary measured 48 px high.
  - A generated 60-card development pool built successfully; all three disclosures closed, all summary headings remained rendered and visible, Build deck retained focus, and the visible Strategy sealed build result moved into the viewport (`scrollY` 745.5).
  - Pointer activation reopened Setup, Entry, and Pool independently, preserving every other state; a second successful build closed all three again. Reopening Setup and selecting OP17 then kept Setup open, reopened Entry and Pool, reset Pool to 0 copies / 0 eligible, and removed the stale result.
  - Keyboard qualification: the in-app browser's Playwright `press`, coordinate-keypress, and DOM-keypress surfaces focused the native summaries but did not trigger their default Enter/Space toggle behavior, so keyboard activation is not claimed from rendered QA. The focused summaries did match `:focus-visible` and rendered the expected solid 3 px `rgba(37, 99, 184, 0.42)` outline; the visible ring was also confirmed in the rendered capture. Native summary pointer behavior and automated disclosure integration tests passed, but physical Enter/Space activation remains unverified in this environment.
  - At every measured state, `documentElement.scrollWidth === clientWidth === 1440`. Supported activations retained focus on the invoked summary or button, and captured console warning/error logs were empty.
- Aggregate review against merge-base `239382e`:
  - Spec axis: approved with no missing, partial, incorrect, or extra behavior.
  - Standards axis: no documented-standard violations; one non-blocking duplication judgement call for the intentionally specialized WorkflowStep and PoolReview disclosure shells.
- Local `main` integration:
  - Fast-forwarded `codex/collapse-workflow-steps` into `main` without pushing.
  - `npm run verify`: exit 0; lint and both TypeScript projects passed, 53/53 test files and 791/791 tests passed, and catalog validation reported 17 sets / 85 files.
  - `npm run build`: exit 0; Vite 8.2.1 transformed 127 modules and produced the production artifact successfully.
