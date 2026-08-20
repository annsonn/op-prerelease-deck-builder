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

- [x] **Step 1: Add authoritative feature fixtures to DeckResult tests**

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

- [x] **Step 2: Write failing Main deck label tests**

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

- [x] **Step 3: Write the failing missing-feature invariant test**

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

- [x] **Step 4: Run the DeckResult test and verify RED**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx
```

Expected: FAIL because `DeckResult` does not accept `featuresByCardNumber`, no
Blocker label is rendered, and the missing-feature invariant does not exist.

- [x] **Step 5: Add the required feature-map prop and invariant helper**

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

- [x] **Step 6: Forward features into the Main deck list only**

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

- [x] **Step 7: Add wrapping, non-interactive label styles**

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

- [x] **Step 8: Run focused tests, lint, and typecheck**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx
npm run lint
npm run typecheck
```

Expected: DeckResult tests pass; lint and both TypeScript projects exit 0.

- [x] **Step 9: Commit Task 1**

```bash
git add src/components/DeckResult.tsx src/components/DeckResult.test.tsx src/App.css
git commit -m "feat: label printed blockers in deck review"
```

### Task 2: Wire catalog features from App

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Write the failing App integration assertion**

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

- [x] **Step 2: Run the App test and verify RED**

Run:

```bash
npx vitest run src/App.test.tsx
```

Expected: FAIL at TypeScript/transform or render time because App has not supplied
the required `featuresByCardNumber` prop, and the generated row has no label.

- [x] **Step 3: Pass the runtime feature map to DeckResult**

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

- [x] **Step 4: Run focused integration and component tests**

Run:

```bash
npx vitest run src/components/DeckResult.test.tsx src/App.test.tsx
```

Expected: both test files pass, including raw printed Blocker, non-blocker,
sideboard exclusion, missing-feature invariant, and App wiring coverage.

- [x] **Step 5: Commit Task 2**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire blocker features into deck review"
```

### Task 3: Full verification and rendered QA

**Files:**
- Modify: `docs/superpowers/plans/2026-08-20-main-deck-blocker-label.md`

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

Expected: lint and TypeScript exit 0; every Vitest file passes; catalog check
reports 17 sets and 85 files; Vite completes the production build; diff check
prints no output.

- [x] **Step 2: Run mobile browser QA at 412×915**

Start the app with `npm run dev -- --host 127.0.0.1`, open the reported local
URL, select OP16, generate a valid development test pool, and build a deck.
Verify:

1. OP16-005 shows a visible `Blocker` pill beside its Red color metadata.
2. OP16-006 shows Red color metadata and no Blocker pill.
3. The Role coverage `Blockers` metric remains separately visible; prove its
   value is unchanged with the deterministic App integration fixture.
4. Sideboard rows show neither color metadata nor Blocker pills after expansion.
5. The label is static text with no tooltip or interactive role.
6. Main deck rows wrap without overlap or horizontal overflow.
7. Captured console warning/error logs are empty.

- [x] **Step 3: Run desktop browser QA at 1440×900**

Repeat the OP16-005 printed blocker, OP16-006 non-blocker, Sideboard exclusion,
layout, overflow, and console checks at 1440×900.

- [x] **Step 4: Record exact evidence**

Check completed plan steps and append `## Verification Evidence` with exact test
counts, catalog/build results, both viewports, observed card IDs, blocker label
placement, Sideboard result, overflow measurements, console result, and any
environment qualification. Do not claim an interaction the browser surface did
not prove.

- [x] **Step 5: Commit verification evidence**

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

## Verification Evidence

Verified on 2026-08-20 from feature tip `1465a29` before this documentation
commit.

### Repository gates

- `npm run lint`: exit 0 (`oxlint`, no findings).
- `npm run typecheck`: exit 0 (`tsc -b && tsc -p tsconfig.tools.json`).
- `npm test`: exit 0; 53/53 test files and 792/792 tests passed.
- `npm run catalog:check`: exit 0; `Runtime catalogs ready: 17 sets, 85 files`.
- `npm run build`: exit 0; catalog prebuild passed and Vite transformed 127
  modules, then completed the production build in 259 ms.
- `git diff --check`: exit 0 with no output.

The first sandboxed `catalog:check` and `build` attempts hit the known `tsx`
local IPC `listen EPERM` restriction. Both commands passed immediately when
rerun with approved access outside that sandbox restriction; this is an
environment qualification, not an application failure.

The pre-existing deterministic App integration assertion expects
`Blockers5 / 10` from its fixed catalog and pool fixture. That same assertion
passed in the 791/791-test baseline run and the 792/792-test post-change run.
The identical assertion result for identical fixture inputs is the
reproducible proof that this feature did not change the Role coverage metric;
the randomized browser-pool values below are observations only.

### In-app browser QA

The app ran at `http://127.0.0.1:5173/`. Each viewport used a fresh OP16 load,
a newly generated 60-card development pool, and `Build deck`; the Sideboard was
expanded before measurements.

- At 412×915, OP16-005 Thatch showed Red plus one visible `Blocker` label;
  OP16-006 Shanks showed Red and no label. The separate Role coverage
  `Blockers` metric remained visible and showed `8 / 10` in this post-change
  randomized pool; this value is not used as a cross-run equality check. The
  40-card Main deck had 30 distinct rows and eight printed-Blocker labels. The
  19-card Sideboard had 15 distinct rows, zero Card color groups, and zero
  Blocker labels.
- At 1440×900, a fresh randomized pool again showed Red plus one visible
  `Blocker` label for OP16-005 and Red with no label for OP16-006. The separate
  Role coverage `Blockers` metric remained visible and showed `10 / 10` in this
  post-change randomized pool; this value is also observational only. The
  40-card Main deck had 31 distinct rows and eight printed-Blocker labels. The
  19-card Sideboard had 14 distinct rows, zero Card color groups, and zero
  Blocker labels.
- At both viewports, every Main metadata container computed to
  `flex-wrap: wrap`; measured overflowing Main rows and color/label rectangle
  intersections were both zero. Document `scrollWidth === clientWidth` was
  `412 === 412` and `1440 === 1440`, respectively.
- The rendered label was a plain `SPAN` with `cursor: auto`, no `role`, no
  `title`, no `aria-describedby`, `tabIndex === -1`, and no interactive
  descendants. It was therefore proven as visible static text, with no button,
  tooltip hook, or interactive role.
- Captured console warning/error logs were empty in both viewport passes.

The original QA examples named OP16-006 as the blocker and OP16-005 as the
non-blocker because the App integration test intentionally uses synthetic
catalog fixtures for wiring coverage. The authoritative runtime OP16 catalog
has `[Blocker]` on OP16-005 Thatch and removal text on OP16-006 Shanks, with the
reviewed feature flags set to `true` and `false`, respectively. The rendered QA
expectations above follow those authoritative production records; the
synthetic integration fixture remains unchanged.
