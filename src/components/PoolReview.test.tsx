import { render, screen, within } from '@testing-library/react'
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

const catalog: RuntimeCatalog = {
  manifest: {
    schemaVersion: 1,
    setId: 'OP16',
    language: 'en',
    source: 'fixture.json',
    sourceType: 'local-json',
    readiness: 'needs-review',
  },
  cards: [playableCard],
  cardsByNumber: new Map([[playableCard.cardNumber, playableCard]]),
  normalCardsByShortcut: new Map([['005', playableCard]]),
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

describe('PoolReview', () => {
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
        onQuantity={vi.fn()}
        onUndo={vi.fn()}
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
})
