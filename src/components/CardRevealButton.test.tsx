/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import { CardRevealButton } from './CardRevealButton.js'

const appCss = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

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

function getRevealButton() {
  return screen.getByRole('button', {
    name: 'View Edward.Newgate, OP17-005',
  })
}

describe('CardRevealButton', () => {
  it('renders an exact native dialog trigger with a decorative eye icon', () => {
    render(<CardRevealButton card={card} onReveal={vi.fn()} />)

    const button = getRevealButton()
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveClass('card-reveal-button')

    const icon = button.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('focusable', 'false')
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(icon).toHaveAttribute('width', '22')
    expect(icon).toHaveAttribute('height', '22')
    expect(icon?.querySelector('path')).toBeInTheDocument()
    expect(icon?.querySelector('circle')).toBeInTheDocument()
  })

  it('keeps the reveal action at an exact 48px touch target', () => {
    expect(appCss).toMatch(
      /\.card-reveal-button,[^}]*\.card-image-dialog__close,[^}]*\.card-image-dialog__retry\s*\{[^}]*min-width:\s*48px;[^}]*min-height:\s*48px;/s,
    )
    expect(appCss).toMatch(
      /\.card-reveal-button\s*\{[^}]*flex:\s*0 0 48px;[^}]*width:\s*48px;[^}]*height:\s*48px;[^}]*padding:\s*0;/s,
    )
  })

  it('reveals the exact card from a click', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    render(<CardRevealButton card={card} onReveal={onReveal} />)

    await user.click(getRevealButton())

    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(onReveal).toHaveBeenLastCalledWith(card)
  })

  it('reveals the exact card from one touch pointer sequence', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    render(<CardRevealButton card={card} onReveal={onReveal} />)

    const button = getRevealButton()
    await user.pointer([
      { keys: '[TouchA>]', target: button },
      { keys: '[/TouchA]', target: button },
    ])

    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(onReveal).toHaveBeenLastCalledWith(card)
  })

  it('uses native Enter activation', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    render(<CardRevealButton card={card} onReveal={onReveal} />)

    getRevealButton().focus()
    await user.keyboard('{Enter}')

    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(onReveal).toHaveBeenLastCalledWith(card)
  })

  it('uses native Space activation', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    render(<CardRevealButton card={card} onReveal={onReveal} />)

    getRevealButton().focus()
    await user.keyboard(' ')

    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(onReveal).toHaveBeenLastCalledWith(card)
  })
})
