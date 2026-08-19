# Card Image Reveal Design

## Goal

Let users reveal the standard English image for a listed card from the pool or
generated deck without changing the gameplay catalog schema or eagerly loading
images.

## Image Source

Card Kaizoku exposes a stable English image pattern for every OP01-OP17 runtime
card in the pinned 2026-08-19 snapshot:

```text
https://cdn.cardkaizoku.com/cards_en/<printed-prefix>/<card-number>.png
```

A focused resolver module derives this URL from a validated printed card ID.
For example, `OP17-005` resolves to
`https://cdn.cardkaizoku.com/cards_en/OP17/OP17-005.png`; a special reprint such
as `ST15-005` uses the `ST15` prefix.

The app does not add image URLs to `PlayableCard`, weaken runtime catalog
privacy validation, generate another catalog artifact, or commit downloaded
images. Card reveal therefore requires an internet connection and remains
independent from offline gameplay catalog loading.

## Module Design

### Image resolver

`resolveCardImageUrl(cardNumber)` owns the Card Kaizoku host and path pattern.
Callers provide a full `PlayableCard` to the reveal interface; callers do not
construct URLs themselves. The resolver validates the input with the existing
printed-card schema and throws a descriptive error for malformed IDs.

### Reveal controls

A reusable `CardRevealButton` renders a 48×48 eye button with an accessible
label such as `View Edward.Newgate, OP17-005`. The card row itself remains
non-interactive so quantity editing, removal, and row review do not open images
accidentally.

The control appears on:

- the latest accepted card;
- every pool-review card row;
- every main-deck row; and
- every Sideboard row while the Sideboard disclosure is expanded.

It does not appear in recent-entry history, textual Sideboard suggestions,
free-form play-guide text, or the hard-coded Rainbow Luffy leader panel.

### Dialog host

The App owns one active card and one `CardImageDialog` host. `PoolReview` and
`DeckResult` receive an explicit `onReveal(card)` dependency. Their existing
row implementations remain local because they have different responsibilities
and layouts.

The dialog owns image loading, loading/error presentation, dismissal, focus
management, and page-scroll locking. This concentrates remote-image behavior
behind one small interface and prevents duplicate dialogs or eager image loads.

## Interaction and Accessibility

- Activating the eye button opens a modal dialog named with the card name and
  printed ID.
- Only the active card image is rendered and requested.
- The dialog contains an explicit 48px Close button.
- Close, Escape, or backdrop activation dismisses the dialog.
- Focus moves into the dialog on open and returns to the originating eye button
  on close.
- Tab and Shift+Tab remain contained within the modal while it is open.
- Background page scrolling is locked while the dialog is open and restored on
  close or unmount.
- A reserved 5:7 portrait area prevents layout shift.
- The image uses descriptive alt text and `referrerPolicy="no-referrer"`.
- The displayed image is the standard reference printing; it is not guaranteed
  to match an alternate-art card physically opened by the user.

## Loading and Failure Behavior

The dialog begins with a neutral loading placeholder. Successful image load
reveals the image. A failed request replaces the placeholder with `Card image
unavailable` and a Retry button. Retrying remounts the image request without
closing the dialog. Image failure never changes pool or deck state.

Changing sets, clearing the relevant app state, or replacing the current view
closes any active card dialog so stale cards are not displayed.

## Responsive Layout

The row-edge eye button uses the approved option A layout. It remains a 48×48
target at Pixel 9 width and sits beside, rather than inside, the card identity.
Pool quantity and removal actions keep their existing behavior. The dialog fits
within the viewport, limits the image height, and scrolls internally when
needed. Desktop uses the same dialog and control hierarchy.

## Testing and Verification

- Resolver tests cover OP, ST, EB, and PRB printed prefixes and reject malformed
  IDs through the existing printed-card schema.
- Reveal-module tests cover accessible labels, click/tap, Enter and Space,
  dialog naming, alt text, lazy image creation, successful load, failure,
  Retry, Close, Escape, backdrop dismissal, focus return, and scroll-lock
  cleanup.
- Pool tests cover latest-card and pool-row controls while confirming recent
  history does not gain controls.
- Deck tests cover main-deck and expanded-Sideboard controls while confirming
  collapsed Sideboard content remains hidden.
- App integration tests cover one active dialog, switching cards, state/set
  changes, and duplicate card names.
- Browser QA runs at Pixel 9 and desktop widths, checking row overflow, dialog
  containment, touch targets, focus behavior, image loading/failure, and a
  clean console.
- Full lint, TypeScript, Vitest, runtime catalog, and GitHub Pages production
  build gates remain required.
