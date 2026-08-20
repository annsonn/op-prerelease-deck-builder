import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import { appendCards, type PoolState } from '../pool/pool.js'
import { PoolReview } from './PoolReview.js'

const playableCard: PlayableCard = {
  cardNumber: 'OP16-005',
  name: 'Test Character',
  rarity: 'C',
  cardType: 'CHARACTER',
  colors: ['Red'],
  cost: 3,
  life: null,
  power: 5000,
  counter: 1000,
  attribute: 'Strike',
  traits: ['Test Crew'],
  effect: '',
  trigger: '',
  setMembership: ['OP16'],
  variantsCollapsed: 1,
  entryShortcut: '005',
  isSpecialReprint: false,
}

const secondPlayableCard: PlayableCard = {
  ...playableCard,
  cardNumber: 'OP16-006',
  name: 'Second Character',
  entryShortcut: '006',
}

const catalog: RuntimeCatalog = {
  manifest: {
    schemaVersion: 1,
    setId: 'OP16',
    language: 'en',
    source: 'fixture.json',
    sourceType: 'local-json',
    readiness: 'needs-review',
  },
  cards: [playableCard, secondPlayableCard],
  cardsByNumber: new Map([
    [playableCard.cardNumber, playableCard],
    [secondPlayableCard.cardNumber, secondPlayableCard],
  ]),
  normalCardsByShortcut: new Map([
    ['005', playableCard],
    ['006', secondPlayableCard],
  ]),
  specialCards: [],
  strategySuggestions: [],
  suggestionsByCardNumber: new Map(),
  featuresByCardNumber: new Map(),
}

const emptyPool: PoolState = {
  events: Object.freeze([]),
  counts: Object.freeze({}),
  recentCardNumbers: Object.freeze([]),
}

function ControlledPoolReview({
  pool,
  initialOpen = true,
  onOpenChange,
}: {
  pool: PoolState
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
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
      onOpenChange={(open) => {
        onOpenChange?.(open)
        setIsOpen(open)
      }}
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

function nextNativeToggle(disclosure: HTMLDetailsElement): Promise<void> {
  return new Promise((resolve) => {
    disclosure.addEventListener('toggle', () => resolve(), { once: true })
  })
}

describe('PoolReview', () => {
  it('keeps the heading and totals visible while the pool controls are collapsed', () => {
    const pool = appendCards(emptyPool, [playableCard.cardNumber])
    render(<ControlledPoolReview pool={pool} initialOpen={false} />)

    expect(poolDisclosure()).not.toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'Review your pool' })).toBeVisible()
    const summary = screen.getByText('Review your pool').closest('summary')
    expect(summary).toHaveAccessibleName(
      'Review your pool Pool totals: 1 copies, 1 eligible',
    )
    const totals = screen.getByLabelText(/^Pool totals:/)
    expect(totals).toBeVisible()
    expect(totals).toHaveTextContent('1 copies')
    expect(totals).toHaveTextContent('1 eligible')

    const hiddenControls = [
      screen.getByRole('button', { name: 'Undo last change', hidden: true }),
      screen.getByLabelText('Latest accepted card'),
      screen.getByRole('spinbutton', {
        name: 'Quantity for Test Character (OP16-005)',
        hidden: true,
      }),
      screen.getByRole('button', {
        name: 'Remove Test Character (OP16-005)',
        hidden: true,
      }),
      ...screen.getAllByRole('button', {
        name: 'View Test Character, OP16-005',
        hidden: true,
      }),
    ]
    expect(hiddenControls).toHaveLength(6)
    hiddenControls.forEach((control) => expect(control).not.toBeVisible())
  })

  it('lets the native summary manually open and close the controlled pool', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const pool = appendCards(emptyPool, [playableCard.cardNumber])
    render(
      <ControlledPoolReview
        pool={pool}
        initialOpen={false}
        onOpenChange={onOpenChange}
      />,
    )
    const summary = screen.getByText('Review your pool').closest('summary')
    if (summary === null) throw new Error('Expected a pool disclosure summary.')

    await user.click(summary)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(true))
    await waitFor(() => expect(poolDisclosure()).toHaveAttribute('open'))
    expect(screen.getByLabelText('Latest accepted card')).toBeVisible()
    expect(screen.getByRole('spinbutton')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Remove Test Character/ }),
    ).toBeVisible()

    await user.click(summary)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false))
    await waitFor(() => expect(poolDisclosure()).not.toHaveAttribute('open'))
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false])
  })

  it('does not echo programmatic open state back through onOpenChange', async () => {
    const onOpenChange = vi.fn()
    const pool = appendCards(emptyPool, [playableCard.cardNumber])
    const view = render(
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
    const disclosure = poolDisclosure()
    await waitFor(() => expect(disclosure).not.toHaveAttribute('open'))
    expect(onOpenChange).not.toHaveBeenCalled()

    const openingToggle = nextNativeToggle(disclosure)
    view.rerender(
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
    await openingToggle
    expect(disclosure).toHaveAttribute('open')
    expect(onOpenChange).not.toHaveBeenCalled()

    const closingToggle = nextNativeToggle(disclosure)
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
    await closingToggle
    expect(disclosure).not.toHaveAttribute('open')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps Undo separate from the summary and preserves expanded controls', async () => {
    const user = userEvent.setup()
    const onQuantity = vi.fn()
    const onReveal = vi.fn()
    const onUndo = vi.fn()
    const pool = appendCards(emptyPool, [playableCard.cardNumber])
    render(
      <PoolReview
        catalog={catalog}
        pool={pool}
        eligibleCount={1}
        isOpen
        onOpenChange={vi.fn()}
        onQuantity={onQuantity}
        onUndo={onUndo}
        onReveal={onReveal}
      />,
    )

    const undo = screen.getByRole('button', { name: 'Undo last change' })
    expect(undo.closest('summary')).toBeNull()
    await user.click(undo)
    expect(onUndo).toHaveBeenCalledOnce()
    expect(poolDisclosure()).toHaveAttribute('open')

    const quantity = screen.getByRole('spinbutton', {
      name: 'Quantity for Test Character (OP16-005)',
    })
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.tab()
    expect(onQuantity).toHaveBeenCalledWith(playableCard.cardNumber, 2)

    await user.click(
      screen.getByRole('button', {
        name: 'Remove Test Character (OP16-005)',
      }),
    )
    expect(onQuantity).toHaveBeenLastCalledWith(playableCard.cardNumber, 0)

    const metadata = screen.getByText('OP16-005 · CHARACTER')
    const row = metadata.closest('li')
    if (row === null) throw new Error('Expected card metadata inside a pool row')
    await user.click(
      within(row).getByRole('button', {
        name: 'View Test Character, OP16-005',
      }),
    )
    expect(onReveal).toHaveBeenCalledWith(playableCard)
  })

  it('shows printed card stats once for a pool row with two copies', () => {
    const pool = appendCards(emptyPool, [
      playableCard.cardNumber,
      playableCard.cardNumber,
    ])

    render(
      <PoolReview
        catalog={catalog}
        pool={pool}
        eligibleCount={2}
        isOpen
        onOpenChange={vi.fn()}
        onQuantity={vi.fn()}
        onUndo={vi.fn()}
        onReveal={vi.fn()}
      />,
    )

    const metadata = screen.getByText('OP16-005 · CHARACTER')
    const row = metadata.closest('li')
    if (row === null) throw new Error('Expected card metadata inside a pool row')
    const stats = within(row).getByRole('group', { name: 'Card stats' })
    const values = within(stats).getAllByTestId('card-stat-value')

    expect(metadata.nextElementSibling).toBe(stats)
    expect(values.map((value) => value.textContent)).toEqual([
      'Cost 3',
      'Power 5,000',
      'Counter 1,000',
    ])
    expect(
      within(row).getByRole('spinbutton', {
        name: 'Quantity for Test Character (OP16-005)',
      }),
    ).toHaveValue(2)
  })

  it('reveals cards from the latest card and pool rows but not recent entries', async () => {
    const user = userEvent.setup()
    const onReveal = vi.fn()
    const pool = appendCards(emptyPool, [
      playableCard.cardNumber,
      secondPlayableCard.cardNumber,
    ])

    render(
      <PoolReview
        catalog={catalog}
        pool={pool}
        eligibleCount={2}
        isOpen
        onOpenChange={vi.fn()}
        onQuantity={vi.fn()}
        onUndo={vi.fn()}
        onReveal={onReveal}
      />,
    )

    const latest = screen.getByLabelText('Latest accepted card')
    await user.click(
      within(latest).getByRole('button', {
        name: 'View Second Character, OP16-006',
      }),
    )
    expect(onReveal).toHaveBeenLastCalledWith(secondPlayableCard)

    for (const card of [playableCard, secondPlayableCard]) {
      const metadata = screen.getByText(
        `${card.cardNumber} · ${card.cardType}`,
      )
      const row = metadata.closest('li')
      if (row === null) throw new Error('Expected card metadata inside a pool row')
      const reveal = within(row).getByRole('button', {
        name: `View ${card.name}, ${card.cardNumber}`,
      })
      await user.click(reveal)
      expect(onReveal).toHaveBeenLastCalledWith(card)
    }

    const recentEntries = screen
      .getByText('Recent accepted entries')
      .closest('details')
    if (recentEntries === null) {
      throw new Error('Expected recent accepted entries disclosure')
    }
    await user.click(within(recentEntries).getByText('Recent accepted entries'))
    expect(recentEntries).toHaveAttribute('open')
    expect(within(recentEntries).getByText('Test Character')).toBeVisible()
    expect(poolDisclosure()).toHaveAttribute('open')
    expect(within(recentEntries).queryAllByRole('button')).toHaveLength(0)
  })
})
