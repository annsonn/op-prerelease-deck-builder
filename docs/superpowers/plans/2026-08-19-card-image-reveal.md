# Card Image Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-friendly eye button to eligible pool and deck card rows that opens one accessible dialog containing the card's standard English reference image.

**Architecture:** Keep `PlayableCard` and the generated runtime catalogs unchanged. A pure resolver derives the Card Kaizoku image URL from a validated printed card ID; reusable reveal controls own presentation and modal behavior; `App` owns the single active card and passes an explicit `onReveal(card)` callback into pool and deck views.

**Tech Stack:** React 19, TypeScript 6, Zod 4, Vite 8, Vitest 4, Testing Library, Card Kaizoku English image CDN

---

## File map

- Create `src/card-image/card-image-url.ts`: validate printed card IDs and derive the English CDN URL.
- Create `src/card-image/card-image-url.test.ts`: cover OP, ST, EB, PRB, and malformed identifiers.
- Create `src/components/CardRevealButton.tsx`: render the reusable 48×48 eye action.
- Create `src/components/CardRevealButton.test.tsx`: lock down labeling and activation.
- Create `src/components/CardImageDialog.tsx`: render the single lazy image dialog and own loading, failure, dismissal, focus, and scroll behavior.
- Create `src/components/CardImageDialog.test.tsx`: exercise the complete modal behavior.
- Modify `src/components/PoolReview.tsx`: add reveal actions to latest accepted and pool rows only.
- Modify `src/components/PoolReview.test.tsx`: verify pool placement and recent-history exclusion.
- Modify `src/components/DeckResult.tsx`: add reveal actions to main and actual Sideboard rows only.
- Modify `src/components/DeckResult.test.tsx`: verify Main/Sideboard placement and suggestion exclusion.
- Modify `src/App.tsx`: own one active card, one dialog host, and closure on relevant app-state replacement.
- Modify `src/App.test.tsx`: verify dialog integration, state reset, and duplicate-name labels.
- Modify `src/App.css`: style the approved row-edge button and responsive dialog.
- Modify this plan: check completed steps and record final verification evidence.

### Task 1: Derive card image URLs without changing catalogs

**Files:**
- Create: `src/card-image/card-image-url.test.ts`
- Create: `src/card-image/card-image-url.ts`

- [x] **Step 1: Write the failing resolver tests**

Create `src/card-image/card-image-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveCardImageUrl } from './card-image-url.js'

describe('resolveCardImageUrl', () => {
  it.each([
    ['OP17-005', 'OP17'],
    ['ST15-005', 'ST15'],
    ['EB03-004', 'EB03'],
    ['PRB01-001', 'PRB01'],
  ])('derives the English image URL for %s', (cardNumber, prefix) => {
    expect(resolveCardImageUrl(cardNumber)).toBe(
      `https://cdn.cardkaizoku.com/cards_en/${prefix}/${cardNumber}.png`,
    )
  })

  it.each(['op17-005', 'OP17-5', 'OP17-0005', 'OP17/005', ''])(
    'rejects malformed printed card ID %j',
    (cardNumber) => {
      expect(() => resolveCardImageUrl(cardNumber)).toThrow(
        `Invalid printed card ID for image: ${cardNumber}`,
      )
    },
  )
})
```

- [x] **Step 2: Run the focused test and confirm the missing module fails**

Run:

```bash
npm test -- src/card-image/card-image-url.test.ts
```

Expected: FAIL because `card-image-url.ts` does not exist.

- [x] **Step 3: Implement the validated resolver**

Create `src/card-image/card-image-url.ts`:

```ts
import { printedCardIdSchema } from '../../shared/catalog.js'

const CARD_IMAGE_ORIGIN = 'https://cdn.cardkaizoku.com'

export function resolveCardImageUrl(cardNumber: string): string {
  const parsed = printedCardIdSchema.safeParse(cardNumber)
  if (!parsed.success) {
    throw new Error(`Invalid printed card ID for image: ${cardNumber}`)
  }

  const [prefix] = parsed.data.split('-')
  return `${CARD_IMAGE_ORIGIN}/cards_en/${prefix}/${parsed.data}.png`
}
```

- [x] **Step 4: Run the resolver tests and type-check the app**

Run:

```bash
npm test -- src/card-image/card-image-url.test.ts
npx tsc -b
```

Expected: resolver tests PASS and TypeScript exits zero.

- [x] **Step 5: Commit the resolver**

```bash
git add src/card-image/card-image-url.ts src/card-image/card-image-url.test.ts
git commit -m "feat: resolve card image URLs"
```

### Task 2: Build the reusable reveal button and accessible dialog

**Files:**
- Create: `src/components/CardRevealButton.test.tsx`
- Create: `src/components/CardRevealButton.tsx`
- Create: `src/components/CardImageDialog.test.tsx`
- Create: `src/components/CardImageDialog.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing button tests**

Use a `PlayableCard` fixture named `Edward.Newgate` with ID `OP17-005`. Test that `CardRevealButton`:

- renders a native `button` named `View Edward.Newgate, OP17-005`;
- has `type="button"` and `aria-haspopup="dialog"`;
- invokes `onReveal` with the complete card after pointer activation; and
- invokes the same callback through native Enter and Space activation.

The core render assertion is:

```tsx
const onReveal = vi.fn()
render(<CardRevealButton card={card} onReveal={onReveal} />)
const button = screen.getByRole('button', {
  name: 'View Edward.Newgate, OP17-005',
})
expect(button).toHaveAttribute('type', 'button')
expect(button).toHaveAttribute('aria-haspopup', 'dialog')
await user.click(button)
expect(onReveal).toHaveBeenLastCalledWith(card)
```

- [ ] **Step 2: Run the button test and confirm the missing module fails**

Run:

```bash
npm test -- src/components/CardRevealButton.test.tsx
```

Expected: FAIL because `CardRevealButton.tsx` does not exist.

- [ ] **Step 3: Implement the button**

Create `src/components/CardRevealButton.tsx` with this public interface:

```tsx
import type { PlayableCard } from '../../shared/catalog.js'

interface CardRevealButtonProps {
  card: PlayableCard
  onReveal: (card: PlayableCard) => void
}

export function CardRevealButton({
  card,
  onReveal,
}: CardRevealButtonProps) {
  return (
    <button
      type="button"
      className="card-reveal-button"
      aria-label={`View ${card.name}, ${card.cardNumber}`}
      aria-haspopup="dialog"
      onClick={() => onReveal(card)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        focusable="false"
      >
        <path d="M2.4 12s3.5-6 9.6-6 9.6 6 9.6 6-3.5 6-9.6 6-9.6-6-9.6-6Z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    </button>
  )
}
```

The SVG must use CSS-driven `fill="none"`, `stroke="currentColor"`, rounded line caps, and rounded line joins so it does not depend on an icon package.

- [ ] **Step 4: Run the button tests**

Run:

```bash
npm test -- src/components/CardRevealButton.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing dialog tests**

Create `src/components/CardImageDialog.test.tsx` around this interface:

```ts
interface CardImageDialogProps {
  card: PlayableCard
  onClose: () => void
}
```

Use `userEvent`, `fireEvent`, and Testing Library role queries to cover:

1. The dialog is named `Edward.Newgate, OP17-005`, renders exactly one image request, and the image has `alt="Edward.Newgate (OP17-005) card"`, the derived CDN `src`, and `referrerpolicy="no-referrer"`.
2. The loading status is initially visible; firing `load` on the image removes it and reveals the image.
3. Firing `error` shows `Card image unavailable` and a 48px Retry button; Retry replaces the image DOM node with a fresh request and returns to loading state.
4. Close button, Escape, and a click whose target is the backdrop call `onClose`; a click inside the dialog does not.
5. Initial focus moves to Close, Tab wraps from the last focusable control to the first, and Shift+Tab wraps from the first to the last.
6. Mounting stores and sets `document.body.style.overflow` to `hidden`; unmount restores the exact previous value.
7. Unmount restores focus to the element that was active before the dialog mounted.
8. Rerendering with another card resets loading/error state and updates title, ID, alt text, and URL without producing a second dialog.

The focus-return test must mount from a real trigger:

```tsx
const origin = document.createElement('button')
origin.textContent = 'origin'
document.body.append(origin)
origin.focus()
const view = render(<CardImageDialog card={card} onClose={vi.fn()} />)
expect(screen.getByRole('button', { name: 'Close card image' })).toHaveFocus()
view.unmount()
expect(origin).toHaveFocus()
origin.remove()
```

- [ ] **Step 6: Run the dialog test and confirm the missing module fails**

Run:

```bash
npm test -- src/components/CardImageDialog.test.tsx
```

Expected: FAIL because `CardImageDialog.tsx` does not exist.

- [ ] **Step 7: Implement the dialog**

Create `src/components/CardImageDialog.tsx` using `createPortal` into `document.body`. Required internal state and refs:

```ts
type ImageStatus = 'loading' | 'loaded' | 'failed'

const dialogRef = useRef<HTMLDivElement>(null)
const closeButtonRef = useRef<HTMLButtonElement>(null)
const originRef = useRef<HTMLElement | null>(null)
const [imageStatus, setImageStatus] = useState<ImageStatus>('loading')
const [retryKey, setRetryKey] = useState(0)
```

On initial mount:

- capture `document.activeElement` when it is an `HTMLElement`;
- store the previous inline `document.body.style.overflow` value;
- set body overflow to `hidden`;
- focus Close;
- on cleanup, restore overflow and focus the captured origin when it is still connected.

On `card.cardNumber` change, set image status to `loading` and reset the retry key to `0`. Handle a document `keydown` listener while mounted:

- Escape calls `onClose`;
- Tab queries enabled buttons/links/inputs inside `dialogRef` and wraps at the first and last element;
- no other keystroke is intercepted.

Render this hierarchy through the portal:

```tsx
<div
  className="card-image-backdrop"
  onClick={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}
>
  <div
    ref={dialogRef}
    className="card-image-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
  >
    <header className="card-image-dialog__header">
      <span id={titleId}>
        <strong>{card.name}</strong>
        <small>{card.cardNumber}</small>
      </span>
      <button
        ref={closeButtonRef}
        type="button"
        className="card-image-dialog__close"
        aria-label="Close card image"
        onClick={onClose}
      >
        Close
      </button>
    </header>
    <div className="card-image-dialog__media">
      {imageStatus === 'loading' ? (
        <p role="status">Loading card image…</p>
      ) : null}
      {imageStatus === 'failed' ? (
        <div className="card-image-dialog__error" role="alert">
          <strong>Card image unavailable</strong>
          <button
            type="button"
            onClick={() => {
              setImageStatus('loading')
              setRetryKey((current) => current + 1)
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <img
          key={`${card.cardNumber}-${retryKey}`}
          className="card-image-dialog__image"
          src={resolveCardImageUrl(card.cardNumber)}
          alt={`${card.name} (${card.cardNumber}) card`}
          referrerPolicy="no-referrer"
          hidden={imageStatus !== 'loaded'}
          onLoad={() => setImageStatus('loaded')}
          onError={() => setImageStatus('failed')}
        />
      )}
    </div>
    <p className="card-image-dialog__note">
      Standard reference printing; alternate art may look different.
    </p>
  </div>
</div>
```

Use `useId()` for `titleId`. Retain the exact target/currentTarget guard on the backdrop click.

- [ ] **Step 8: Add the approved button and dialog CSS**

Add to `src/App.css`:

```css
.card-reveal-button,
.card-image-dialog__close,
.card-image-dialog__error button {
  min-width: 48px;
  min-height: 48px;
}

.card-reveal-button {
  display: inline-grid;
  flex: 0 0 48px;
  place-items: center;
  padding: 0;
  border: 1px solid #b8c4d3;
  border-radius: 999px;
  background: #fff;
  color: var(--navy);
}

.card-reveal-button svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.card-image-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(10 24 48 / 72%);
}

.card-image-dialog {
  display: grid;
  width: min(100%, 420px);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 24px 64px rgb(0 0 0 / 35%);
}

.card-image-dialog__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-image-dialog__header span {
  display: grid;
  min-width: 0;
}

.card-image-dialog__header strong,
.card-image-dialog__header small {
  overflow-wrap: anywhere;
}

.card-image-dialog__media {
  position: relative;
  display: grid;
  width: min(100%, 350px);
  aspect-ratio: 5 / 7;
  place-items: center;
  justify-self: center;
  overflow: hidden;
  border-radius: 12px;
  background: #edf1f6;
}

.card-image-dialog__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.card-image-dialog__error {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 20px;
  text-align: center;
}

.card-image-dialog__note {
  margin: 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.45;
  text-align: center;
}
```

Add hover styling only as enhancement; the button must remain understandable and usable without hover.

- [ ] **Step 9: Run the component tests, lint, and app type-check**

Run:

```bash
npm test -- src/components/CardRevealButton.test.tsx src/components/CardImageDialog.test.tsx
npm run lint
npx tsc -b
```

Expected: all commands PASS.

- [ ] **Step 10: Commit the reveal controls**

```bash
git add src/components/CardRevealButton.tsx src/components/CardRevealButton.test.tsx src/components/CardImageDialog.tsx src/components/CardImageDialog.test.tsx src/App.css
git commit -m "feat: add accessible card image dialog"
```

### Task 3: Integrate reveal actions into the pool, deck, and App

**Files:**
- Modify: `src/components/PoolReview.test.tsx`
- Modify: `src/components/PoolReview.tsx`
- Modify: `src/components/DeckResult.test.tsx`
- Modify: `src/components/DeckResult.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing pool integration tests**

Expand the pool fixture with a second card, render a pool containing both cards, and pass `onReveal={vi.fn()}`. Verify:

- latest accepted card contains one button named with the latest card;
- each unique pool row contains its own correctly named button;
- clicking the latest or row button passes that exact `PlayableCard` to `onReveal`; and
- `Recent accepted entries` contains no reveal buttons even after opening the disclosure.

Use the latest-card container and row as query scopes so duplicate controls remain unambiguous:

```tsx
const latest = screen.getByLabelText('Latest accepted card')
await user.click(
  within(latest).getByRole('button', {
    name: `View ${playableCard.name}, ${playableCard.cardNumber}`,
  }),
)
expect(onReveal).toHaveBeenLastCalledWith(playableCard)
```

- [ ] **Step 2: Run the pool test and confirm the missing prop/control fails**

Run:

```bash
npm test -- src/components/PoolReview.test.tsx
```

Expected: FAIL because `PoolReview` does not accept `onReveal` and renders no reveal buttons.

- [ ] **Step 3: Integrate pool reveal controls**

Add the explicit prop:

```ts
onReveal: (card: PlayableCard) => void
```

Import `PlayableCard` and `CardRevealButton`. Change the latest card to:

```tsx
<div className="latest-card" aria-label="Latest accepted card">
  <span className="latest-card__identity">
    <span>Latest accepted card</span>
    <strong>
      {latestCard.name} · {latestCard.cardNumber}
    </strong>
  </span>
  <CardRevealButton card={latestCard} onReveal={onReveal} />
</div>
```

Add one `<CardRevealButton card={card} onReveal={onReveal} />` after each pool row's `.quantity-actions`, at the row's far edge. Do not add a button inside `.recent-entries`.

- [ ] **Step 4: Run the pool tests**

Run:

```bash
npm test -- src/components/PoolReview.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing deck integration tests**

Pass `onReveal={vi.fn()}` in every `DeckResult` render helper/call. Add assertions that:

- each Main row has one button labeled from its card name and printed ID;
- activating that button passes the complete Main card;
- no Sideboard row button is visible while the native disclosure is collapsed;
- opening Sideboard reveals one button per actual Sideboard row;
- activating a Sideboard row button passes that complete Sideboard card; and
- `.sideboard-suggestions` contains no reveal buttons.

Use row-scoped queries:

```tsx
const mainDeck = screen.getByRole('region', { name: 'Main deck' })
const mainRow = within(mainDeck).getByText(mainCard.name).closest('li')
if (mainRow === null) throw new Error('Expected Main deck card row.')
await user.click(
  within(mainRow).getByRole('button', {
    name: `View ${mainCard.name}, ${mainCard.cardNumber}`,
  }),
)
expect(onReveal).toHaveBeenLastCalledWith(mainCard)
```

- [ ] **Step 6: Run the deck test and confirm the missing prop/control fails**

Run:

```bash
npm test -- src/components/DeckResult.test.tsx
```

Expected: FAIL because `DeckResult` and `DeckList` do not accept `onReveal` and render no reveal actions.

- [ ] **Step 7: Integrate deck reveal controls**

Add this required prop to `DeckResultProps` and the internal `DeckList` props:

```ts
onReveal: (card: PlayableCard) => void
```

Import `PlayableCard` and `CardRevealButton`, render one button after `.score` at the row's far edge, and pass `onReveal` through both calls:

```tsx
<DeckList
  lines={solution.mainDeck}
  showColors
  onReveal={onReveal}
/>
```

```tsx
<DeckList lines={solution.sideboard} onReveal={onReveal} />
```

Do not change `SideboardSuggestions`.

- [ ] **Step 8: Run the deck tests**

Run:

```bash
npm test -- src/components/DeckResult.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Write failing App integration tests**

Add tests using the existing catalog API fixtures and real entry/build flows to verify:

1. Clicking a pool reveal button creates exactly one dialog named with the unique card name and ID; loading the image does not alter pool quantity.
2. Closing and opening another card replaces the dialog's active image and still leaves exactly one dialog.
3. Selecting another set while a dialog is open closes it and restores the normal set-loading flow.
4. Generating a replacement test pool while a dialog is open closes it.
5. Two cards with the same name expose distinct button names because the printed IDs differ.

Use `screen.getAllByRole('dialog')` only after a reveal action; assert length `1`. Use full labels such as `View Shared Name, OP16-005` and `View Shared Name, OP16-006` for duplicate-name coverage.

- [ ] **Step 10: Run the App test and confirm the missing state/host fails**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: FAIL because App does not provide `onReveal` or render `CardImageDialog`.

- [ ] **Step 11: Add one active-card state and one dialog host to App**

Import `CardImageDialog` and add:

```ts
const [revealedCard, setRevealedCard] = useState<PlayableCard | null>(null)

const handleReveal = useCallback((card: PlayableCard) => {
  setRevealedCard(card)
}, [])

const handleCloseReveal = useCallback(() => {
  setRevealedCard(null)
}, [])
```

Pass `onReveal={handleReveal}` to `PoolReview` and `DeckResult`. Render one host as the final child of `<main>`:

```tsx
{revealedCard === null ? null : (
  <CardImageDialog card={revealedCard} onClose={handleCloseReveal} />
)}
```

Call `setRevealedCard(null)` in:

- the catalog API reset effect before loading the index;
- `handleSelect`;
- `handleCard`;
- successful `handleGenerateTestPool`;
- `handleUndo`;
- `handleQuantity`; and
- `handleBuild` before replacing the current solution.

Do not close the dialog for a failed remote image request; the dialog owns that state. Do not mutate pool or solution from image callbacks.

- [ ] **Step 12: Adapt row layouts for the 48px edge action**

Update `src/App.css`:

```css
.latest-card {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
}

.latest-card__identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.latest-card__identity > span {
  color: var(--red-dark);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pool-line {
  grid-template-columns: minmax(0, 1fr) auto 48px;
}

.deck-list li {
  grid-template-columns: auto minmax(0, 1fr) auto 48px;
}
```

At `max-width: 520px`, keep the reveal button at 48px and allow pool actions to use their current compact vertical layout. Add `min-width: 0` and `overflow-wrap: anywhere` where needed; do not shrink the button below 48px and do not hide the score, quantity editor, or Remove action.

- [ ] **Step 13: Run all integration tests, lint, and type-check**

Run:

```bash
npm test -- src/components/PoolReview.test.tsx src/components/DeckResult.test.tsx src/App.test.tsx
npm run lint
npx tsc -b
```

Expected: all commands PASS with no accessibility or act warnings.

- [ ] **Step 14: Commit the application integration**

```bash
git add src/components/PoolReview.tsx src/components/PoolReview.test.tsx src/components/DeckResult.tsx src/components/DeckResult.test.tsx src/App.tsx src/App.test.tsx src/App.css
git commit -m "feat: reveal card images from pool and deck"
```

### Task 4: Verify responsive behavior and repository gates

**Files:**
- Modify: `docs/superpowers/plans/2026-08-19-card-image-reveal.md`

- [ ] **Step 1: Run the full automated verification**

Run:

```bash
npm run verify
VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run build
git diff --check
git status --short --branch
```

Expected:

- lint passes;
- app and tool TypeScript checks pass;
- every Vitest test passes;
- runtime catalog validation reports 17 sets and 85 files;
- the GitHub Pages base-path build succeeds; and
- the worktree contains only the intended plan evidence update before the final documentation commit.

- [ ] **Step 2: Run browser QA at Pixel 9 width**

Start the app with `npm run dev -- --host 127.0.0.1`, then verify at `412×915`:

- latest-card, pool, Main, and expanded-Sideboard reveal buttons are 48×48;
- recent history and textual Sideboard suggestions have no reveal buttons;
- pool quantity and Remove controls still work;
- rows and page have no horizontal overflow;
- the dialog fits inside the viewport and reserves a 5:7 image area;
- image load, error, and Retry states are readable;
- Close, backdrop, Escape, Tab wrap, Shift+Tab wrap, and focus return work;
- opening only one card causes only one image request; and
- no console warnings or errors appear.

- [ ] **Step 3: Run browser QA at desktop width**

Repeat the same interaction checks at `1440×900`. Confirm the dialog is centered, internally bounded, and does not alter the surrounding pool/deck layout.

- [ ] **Step 4: Record evidence and check every completed step**

Append the exact test count, catalog count, build result, viewport dimensions, overflow measurements, focus behavior, image behavior, and console result to this plan. Mark completed checkboxes only after the associated evidence exists.

- [ ] **Step 5: Commit the completed plan**

```bash
git add docs/superpowers/plans/2026-08-19-card-image-reveal.md
git commit -m "docs: complete card image reveal plan"
```

- [ ] **Step 6: Perform final review without pushing**

Review the complete feature against `docs/superpowers/specs/2026-08-19-card-image-reveal-design.md`, confirm `git status --short --branch` is clean, and report the local commits. Do not push unless the user explicitly asks.
