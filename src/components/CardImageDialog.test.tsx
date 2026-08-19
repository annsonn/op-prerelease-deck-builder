/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import { CARD_IMAGE_PROVIDER_URL } from '../card-image/card-image-url.js'
import { CardImageDialog } from './CardImageDialog.js'
import { CardRevealButton } from './CardRevealButton.js'

const appCss = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

const card: PlayableCard = {
  cardNumber: 'OP17-005',
  name: 'Edward.Newgate',
  rarity: 'SR',
  cardType: 'CHARACTER',
  colors: ['Red'],
  cost: 6,
  life: null,
  power: 7000,
  counter: 1000,
  attribute: 'Special',
  traits: ['The Four Emperors', 'Whitebeard Pirates'],
  effect: 'Test effect',
  trigger: '',
  setMembership: ['OP17'],
  variantsCollapsed: 1,
  entryShortcut: '005',
  isSpecialReprint: false,
}

const replacementCard: PlayableCard = {
  ...card,
  cardNumber: 'OP16-005',
  name: 'Charlotte Linlin',
  setMembership: ['OP16'],
}

interface DialogHarnessProps {
  readonly onClose?: () => void
}

function DialogHarness({ onClose }: DialogHarnessProps) {
  const [activeCard, setActiveCard] = useState<PlayableCard | null>(null)

  return (
    <>
      <CardRevealButton card={card} onReveal={setActiveCard} />
      {activeCard ? (
        <CardImageDialog
          card={activeCard}
          onClose={() => {
            onClose?.()
            setActiveCard(null)
          }}
        />
      ) : null}
    </>
  )
}

function getDialog() {
  return screen.getByRole('dialog', {
    name: 'Edward.Newgate, OP17-005',
  })
}

function getImage(container: HTMLElement) {
  const image = container.querySelector<HTMLImageElement>(
    '.card-image-dialog__image',
  )
  expect(image).not.toBeNull()
  return image as HTMLImageElement
}

function expectAttribution() {
  const attribution = screen.getByRole('link', {
    name: 'Images served by Limitless TCG',
  })
  expect(attribution).toHaveAttribute('href', CARD_IMAGE_PROVIDER_URL)
  expect(attribution).toHaveAttribute('target', '_blank')
  expect(attribution).toHaveAttribute('rel', 'noreferrer')
  return attribution
}

describe('CardImageDialog', () => {
  it('uses a centered viewport-bounded 5:7 modal with global focus visibility', () => {
    expect(appCss).toMatch(
      /\.card-image-backdrop\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*1000;[^}]*inset:\s*0;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s,
    )
    expect(appCss).toMatch(
      /\.card-image-dialog\s*\{[^}]*width:\s*min\(100%, 420px\);[^}]*max-height:\s*calc\(100dvh - 32px\);[^}]*overflow:\s*auto;/s,
    )
    expect(appCss).toMatch(
      /\.card-image-dialog__media\s*\{[^}]*width:\s*min\(100%, 350px\);[^}]*aspect-ratio:\s*5 \/ 7;/s,
    )
    expect(indexCss).toMatch(/:focus-visible\s*\{[^}]*outline:/s)
  })

  it('creates one named dialog and one image request only after activation', async () => {
    const user = userEvent.setup()
    const { container } = render(<DialogHarness />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'View Edward.Newgate, OP17-005',
      }),
    )

    const dialog = getDialog()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const image = getImage(document.body)
    expect(document.body.querySelectorAll('img')).toHaveLength(1)
    expect(image).toHaveAttribute(
      'src',
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/OP17/OP17-005_EN.webp',
    )
    expect(image).toHaveAttribute(
      'alt',
      'Edward.Newgate (OP17-005) card',
    )
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('reserves a loading state until the image loads, then reveals it', () => {
    const { container } = render(
      <CardImageDialog card={card} onClose={vi.fn()} />,
    )

    const media = document.body.querySelector('.card-image-dialog__media')
    expect(media).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading card image…')
    const image = getImage(container.ownerDocument.body)
    expect(image).toHaveAttribute('hidden')

    fireEvent.load(image)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(image).not.toHaveAttribute('hidden')
    expectAttribution()
  })

  it('removes a failed image and Retry mounts a fresh loading request', async () => {
    const user = userEvent.setup()
    render(<CardImageDialog card={card} onClose={vi.fn()} />)

    const firstImage = getImage(document.body)
    fireEvent.error(firstImage)

    expect(firstImage).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Card image unavailable',
    )
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toHaveClass('card-image-dialog__retry')
    expectAttribution()

    await user.click(retry)

    const retriedImage = getImage(document.body)
    expect(retriedImage).not.toBe(firstImage)
    expect(screen.getByRole('status')).toHaveTextContent('Loading card image…')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(retriedImage).toHaveAttribute('hidden')
    expectAttribution()
  })

  it('keeps attribution visible while loading, loaded, and failed', () => {
    render(<CardImageDialog card={card} onClose={vi.fn()} />)

    const image = getImage(document.body)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expectAttribution()

    fireEvent.load(image)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expectAttribution()

    fireEvent.error(image)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Card image unavailable',
    )
    expectAttribution()
  })

  it('unmounts from the explicit Close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogHarness onClose={onClose} />)
    await user.click(
      screen.getByRole('button', {
        name: 'View Edward.Newgate, OP17-005',
      }),
    )

    await user.click(
      screen.getByRole('button', { name: 'Close card image' }),
    )

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('unmounts from Escape and cleans up its document listener', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogHarness onClose={onClose} />)
    await user.click(
      screen.getByRole('button', {
        name: 'View Edward.Newgate, OP17-005',
      }),
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('unmounts only when the backdrop itself is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogHarness onClose={onClose} />)
    await user.click(
      screen.getByRole('button', {
        name: 'View Edward.Newgate, OP17-005',
      }),
    )

    const dialog = getDialog()
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()

    const backdrop = dialog.parentElement
    expect(backdrop).toHaveClass('card-image-backdrop')
    fireEvent.click(backdrop as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses Close and traps Tab in both directions across loading controls', async () => {
    const user = userEvent.setup()
    render(<CardImageDialog card={card} onClose={vi.fn()} />)

    const close = screen.getByRole('button', { name: 'Close card image' })
    const attribution = expectAttribution()
    expect(close).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(attribution).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(close).toHaveFocus()
  })

  it('includes conditional Retry in the focus order and keeps the error dialog trapped', async () => {
    const user = userEvent.setup()
    render(<CardImageDialog card={card} onClose={vi.fn()} />)

    fireEvent.error(getImage(document.body))
    const close = screen.getByRole('button', { name: 'Close card image' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    const attribution = expectAttribution()

    close.focus()
    await user.keyboard('{Tab}')
    expect(retry).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(attribution).toHaveFocus()

    await user.keyboard('{Tab}')
    expect(close).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(attribution).toHaveFocus()
  })

  it('locks body scroll and restores the exact previous inline overflow', () => {
    document.body.style.overflow = 'clip'
    const view = render(<CardImageDialog card={card} onClose={vi.fn()} />)

    expect(document.body.style.overflow).toBe('hidden')

    view.unmount()
    expect(document.body.style.overflow).toBe('clip')
    document.body.style.overflow = ''
  })

  it('returns focus to the connected activation origin after close unmounts', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const origin = screen.getByRole('button', {
      name: 'View Edward.Newgate, OP17-005',
    })

    await user.click(origin)
    expect(
      screen.getByRole('button', { name: 'Close card image' }),
    ).toHaveFocus()

    await user.click(
      screen.getByRole('button', { name: 'Close card image' }),
    )
    expect(origin).toHaveFocus()
  })

  it('does not focus a disconnected activation origin on unmount', () => {
    const origin = document.createElement('button')
    origin.textContent = 'origin'
    document.body.append(origin)
    origin.focus()
    const view = render(<CardImageDialog card={card} onClose={vi.fn()} />)
    origin.remove()

    view.unmount()

    expect(document.activeElement).not.toBe(origin)
  })

  it('replaces the active card and resets failed image state without another dialog', () => {
    const onClose = vi.fn()
    const view = render(<CardImageDialog card={card} onClose={onClose} />)
    const failedImage = getImage(document.body)
    fireEvent.error(failedImage)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    view.rerender(
      <CardImageDialog card={replacementCard} onClose={onClose} />,
    )

    const dialog = screen.getByRole('dialog', {
      name: 'Charlotte Linlin, OP16-005',
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Loading card image…',
    )
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    const replacementImage = getImage(document.body)
    expect(replacementImage).not.toBe(failedImage)
    expect(replacementImage).toHaveAttribute(
      'src',
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/OP16/OP16-005_EN.webp',
    )
    expect(replacementImage).toHaveAttribute(
      'alt',
      'Charlotte Linlin (OP16-005) card',
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
