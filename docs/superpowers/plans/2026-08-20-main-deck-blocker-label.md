# Main Deck Blocker Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a positive-only `Blocker` label beside the color metadata of each generated Main deck card that has the printed Blocker keyword.

**Architecture:** `App` passes the runtime catalog's authoritative `featuresByCardNumber` map into `DeckResult`. Main deck rows read `features.flags.blocker` and render a static wrapping label beside `CardColorRail`; non-blockers and Sideboard rows remain unchanged.

**Tech Stack:** React 19, TypeScript 6, shared card-feature records, Testing Library, Vitest, Vite, CSS.

---

## File Map

- Modify `src/components/DeckResult.tsx`: accept the catalog feature map, enforce the feature-entry invariant, and render the Main deck label.
- Modify `src/components/DeckResult.test.tsx`: supply realistic feature fixtures and cover positive-only, raw-feature, sideboard, and invariant behavior.
- Modify `src/App.css`: add a wrapping Main deck metadata row and static Blocker pill styling.
- Modify `src/App.tsx`: pass the loaded catalog feature map to `DeckResult`.
- Modify `src/App.test.tsx`: prove the runtime feature map reaches generated Main deck rows.
- Modify `docs/superpowers/plans/2026-08-20-main-deck-blocker-label.md`: record completed verification and browser QA evidence.

### Task 1: Render printed Blocker status in Main deck rows

**Files:**
- Modify: `src/components/DeckResult.test.tsx`
- Modify: `src/components/DeckResult.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Add authoritative feature fixtures to DeckResult tests**

Import the shared classifier and feature type in `src/components/DeckResult.test.tsx`:

```ts
import {
  classifyCardFeatures,
  type CardFeatures,
} from '../../shared/card-features.js'
```

Replace `mainCard`'s existing `effect: ''` line with a conditional printed
Blocker that Rainbow Luffy cannot satisfy:

```ts
effect: 'If your Leader is [Nami], this Character gains [Blocker].',
```

Replace `sideboardCard`'s existing `effect: 'Test effect.'` line so the
Sideboard exclusion is tested with a printed Blocker:

```ts
effect: '[Blocker]',
```

Because the secondary fixtures spread the first fixtures, add an explicit
non-blocker effect to each secondary object:

```ts
const secondMainCard: PlayableCard = {
  ...mainCard,
  cardNumber: 'OP16-007',
  name: 'Second Main Card',
  colors: ['Green'],
  cost: 6,
  effect: '',
  entryShortcut: '007',
}

const secondSideboardCard: PlayableCard = {
  ...sideboardCard,
  cardNumber: 'OP16-008',
  name: 'Second Sideboard Card',
  colors: ['Purple'],
  cost: 2,
  effect: '',
  entryShortcut: '008',
}
```

After all four card fixtures are declared, create a complete feature map:

```ts
const featuresByCardNumber: ReadonlyMap<string, CardFeatures> = new Map(
  [mainCard, secondMainCard, sideboardCard, secondSideboardCard].map(
    (card) => [card.cardNumber, classifyCardFeatures(card)] as const,
  ),
)
```

Add `featuresByCardNumber={featuresByCardNumber}` to every existing
`<DeckResult>` render in this test file, including renders with overridden
solutions.

- [ ] **Step 2: Write failing Main deck label tests**

Extend the existing `keeps Main deck full width with colors...` test after it
resolves `mainRows`:

```ts
expect(featuresByCardNumber.get(mainCard.cardNumber)?.flags.blocker).toBe(true)
expect(
  featuresByCardNumber.get(mainCard.cardNumber)?.rainbowUsableFlags.blocker,
).toBe(false)
expect(
  within(mainRows[0]).getByText('Blocker', {
    selector: '.deck-line__blocker-label',
  }),
).toBeVisible()
expect(
  within(mainRows[1]).queryByText('Blocker', {
    selector: '.deck-line__blocker-label',
  }),
).not.toBeInTheDocument()
expect(
  within(mainRows[0]).getByRole('group', { name: 'Card colors' })
    .parentElement,
).toHaveClass('deck-line__metadata')
```

Extend the Sideboard disclosure test after resolving `sideboardRows`:

```ts
expect(
  featuresByCardNumber.get(sideboardCard.cardNumber)?.flags.blocker,
).toBe(true)
expect(
  within(sideboardRows[0]).queryByText('Blocker', {
    selector: '.deck-line__blocker-label',
  }),
).not.toBeInTheDocument()
```

This proves the visible label uses the raw printed flag rather than Rainbow
Luffy usability and remains limited to the color-bearing Main deck rows.

- [ ] **Step 3: Write the failing missing-feature invariant test**

Add this focused test:

```tsx
it('rejects a Main deck card without an authoritative feature record', () => {
  const incompleteFeatures = new Map(featuresByCardNumber)
  incompleteFeatures.delete(mainCard.cardNumber)

  expect(() =>
    render(
      <DeckResult
        solution={solution}
        featuresByCardNumber={incompleteFeatures}
        onReveal={vi.fn()}
      />,
    ),
  ).toThrowError('Missing card features for OP16-005.')
})
```

- [ ] **Step 4: Run the DeckResult test and verify RED**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx
```

Expected: FAIL because `DeckResult` does not accept `featuresByCardNumber`, no
Blocker label is rendered, and the missing-feature invariant does not exist.

- [ ] **Step 5: Add the required feature-map prop and invariant helper**

In `src/components/DeckResult.tsx`, import `CardFeatures`:

```ts
import type { CardFeatures } from '../../shared/card-features.js'
```

Extend the public props:

```ts
interface DeckResultProps {
  solution: DeckSolution
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>
  onReveal: (card: PlayableCard) => void
}
```

Add this helper beside the existing label helpers:

```ts
function printedBlocker(
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  cardNumber: string,
): boolean {
  const features = featuresByCardNumber.get(cardNumber)
  if (features === undefined) {
    throw new Error(`Missing card features for ${cardNumber}.`)
  }
  return features.flags.blocker
}
```

- [ ] **Step 6: Forward features into the Main deck list only**

Extend `DeckList`'s arguments and local props:

```ts
function DeckList({
  lines,
  showColors = false,
  featuresByCardNumber,
  onReveal,
}: {
  lines: readonly DeckLine[]
  showColors?: boolean
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>
  onReveal: (card: PlayableCard) => void
}) {
```

Inside the `lines.map`, resolve printed status only for color-bearing Main deck
rows:

```ts
const isBlocker =
  showColors
    ? printedBlocker(featuresByCardNumber, line.card.cardNumber)
    : false
```

Replace the Main deck color node with the complete metadata row:

```tsx
{showColors ? (
  <span className="deck-line__metadata">
    <CardColorRail colors={line.card.colors} />
    {isBlocker ? (
      <span className="deck-line__blocker-label">Blocker</span>
    ) : null}
  </span>
) : null}
```

Extend `DeckResult`'s signature and Main deck call:

```tsx
export function DeckResult({
  solution,
  featuresByCardNumber,
  onReveal,
}: DeckResultProps) {
  const mainSize = quantity(solution.mainDeck)
  const sideboardSize = quantity(solution.sideboard)
}

<DeckList
  lines={solution.mainDeck}
  showColors
  featuresByCardNumber={featuresByCardNumber}
  onReveal={onReveal}
/>
```

Pass the same required map to the Sideboard list, while leaving `showColors`
false so Sideboard performs no lookup and renders no metadata:

```tsx
<DeckList
  lines={solution.sideboard}
  featuresByCardNumber={featuresByCardNumber}
  onReveal={onReveal}
/>
```

The implementer must use a block-bodied `lines.map` callback so `isBlocker` is
computed before returning each `<li>`; no placeholder comments belong in the
production code.

- [ ] **Step 7: Add wrapping, non-interactive label styles**

Add beside the existing `.card-colors` styles in `src/App.css`:

```css
.deck-line__metadata {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.deck-line__blocker-label {
  display: inline-flex;
  min-height: 20px;
  align-items: center;
  padding: 2px 7px;
  border: 1px solid rgb(18 40 76 / 22%);
  border-radius: 999px;
  color: var(--navy-dark);
  background: #eef3f9;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}
```

Do not add a tooltip, button, icon, `Not a blocker` placeholder, or styles to
`CardColorRail`.

- [ ] **Step 8: Run focused tests, lint, and typecheck**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx
npm run lint
npm run typecheck
```

Expected: DeckResult tests pass; lint and both TypeScript projects exit 0.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/components/DeckResult.tsx src/components/DeckResult.test.tsx src/App.css
git commit -m "feat: label printed blockers in deck review"
```

### Task 2: Wire catalog features from App

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing App integration assertion**

In the existing `enters and corrects an OP-16 pool, then builds an exact legal
deck` test, after the generated Main deck is visible, resolve one printed
Blocker row and one non-blocker row:

```ts
const mainDeck = screen.getByRole('region', { name: 'Main deck' })
const blockerRow = within(mainDeck)
  .getByText('OP16-006 Test Card')
  .closest('li')
const nonBlockerRow = within(mainDeck)
  .getByText('OP16-005 Test Card')
  .closest('li')
if (blockerRow === null || nonBlockerRow === null) {
  throw new Error('Expected generated Main deck card rows.')
}
expect(
  within(blockerRow).getByText('Blocker', {
    selector: '.deck-line__blocker-label',
  }),
).toBeVisible()
expect(
  within(nonBlockerRow).queryByText('Blocker', {
    selector: '.deck-line__blocker-label',
  }),
).not.toBeInTheDocument()
```

The existing App fixture defines OP16-006 with `effect: '[Blocker]'`, so this
assertion exercises the runtime catalog classifier and public component wiring.

- [ ] **Step 2: Run the App test and verify RED**

Run:

```bash
npx vitest run src/App.test.tsx
```

Expected: FAIL at TypeScript/transform or render time because App has not supplied
the required `featuresByCardNumber` prop, and the generated row has no label.

- [ ] **Step 3: Pass the runtime feature map to DeckResult**

Replace the existing result render in `src/App.tsx` with:

```tsx
{solution !== null ? (
  <DeckResult
    solution={solution}
    featuresByCardNumber={catalog.featuresByCardNumber}
    onReveal={handleReveal}
  />
) : null}
```

Do not derive features from the solution or call `classifyCardFeatures` in App.

- [ ] **Step 4: Run focused integration and component tests**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx src/App.test.tsx
```

Expected: both test files pass, including raw printed Blocker, non-blocker,
sideboard exclusion, missing-feature invariant, and App wiring coverage.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire blocker features into deck review"
```

### Task 3: Full verification and rendered QA

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-main-deck-blocker-label.md`

- [ ] **Step 1: Run repository gates**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
git diff --check
```

Expected: lint and TypeScript exit 0; every Vitest file passes; catalog check
reports 17 sets and 85 files; Vite completes the production build; diff check
prints no output.

- [ ] **Step 2: Run mobile browser QA at 412×915**

Start the app with `npm run dev -- --host 127.0.0.1`, open the reported local
URL, select OP16, generate a valid development test pool, and build a deck.
Verify:

1. OP16-006 shows a visible `Blocker` pill beside its color metadata.
2. OP16-005 shows color metadata and no Blocker pill.
3. The Role coverage `Blockers` metric remains unchanged.
4. Sideboard rows show neither color metadata nor Blocker pills after expansion.
5. The label is static text with no tooltip or interactive role.
6. Main deck rows wrap without overlap or horizontal overflow.
7. Captured console warning/error logs are empty.

- [ ] **Step 3: Run desktop browser QA at 1440×900**

Repeat the printed blocker, non-blocker, Sideboard exclusion, layout, overflow,
and console checks at 1440×900.

- [ ] **Step 4: Record exact evidence**

Check completed plan steps and append `## Verification Evidence` with exact test
counts, catalog/build results, both viewports, observed card IDs, blocker label
placement, Sideboard result, overflow measurements, console result, and any
environment qualification. Do not claim an interaction the browser surface did
not prove.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/superpowers/plans/2026-08-20-main-deck-blocker-label.md
git commit -m "docs: verify main deck blocker label"
```

- [ ] **Step 6: Request aggregate Spec and Standards review**

Dispatch independent reviewers against the feature branch's merge-base with
`main`. Resolve every Critical or Important finding and repeat affected tests
and review until both axes approve.

- [ ] **Step 7: Merge locally and verify final main**

Use the finishing-a-development-branch workflow to merge into local `main`
without pushing. Run on the final integrated tree:

```bash
npm run verify
npm run build
git status --short --branch
```

Expected: verification and build pass; local `main` is clean and ahead of
`origin/main` by the new commits.
