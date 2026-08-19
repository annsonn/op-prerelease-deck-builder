import { describe, expect, it } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'

import {
  appendCard,
  appendCards,
  eligiblePoolCount,
  replaceCards,
  resolvePoolEntry,
  setQuantity,
  undoLast,
  type PoolState,
} from './pool.js'

function card(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  const isSpecialReprint = !cardNumber.startsWith('OP16-')
  return {
    cardNumber,
    name: `${cardNumber} Test Card`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: isSpecialReprint ? null : cardNumber.slice(-3),
    isSpecialReprint,
    ...overrides,
  }
}

function runtimeCatalog(cards: readonly PlayableCard[]): RuntimeCatalog {
  return {
    manifest: {
      schemaVersion: 1,
      setId: 'OP16',
      language: 'en',
      source: 'fixture.json',
      sourceType: 'local-json',
      readiness: 'needs-review',
    },
    cards,
    cardsByNumber: new Map(cards.map((item) => [item.cardNumber, item])),
    normalCardsByShortcut: new Map(
      cards.flatMap((item) =>
        item.entryShortcut === null ? [] : [[item.entryShortcut, item] as const],
      ),
    ),
    specialCards: cards.filter((item) => item.isSpecialReprint),
    strategySuggestions: [],
    suggestionsByCardNumber: new Map(),
    featuresByCardNumber: new Map(),
  }
}

const catalog = runtimeCatalog([
  card('OP16-005'),
  card('OP16-045'),
  card('OP16-001', { cardType: 'LEADER' }),
  card('OP16-002', { cardType: 'DON' }),
  card('OP10-045'),
  card('ST21-014'),
])

function emptyPool(): PoolState {
  return {
    events: [],
    counts: {},
    recentCardNumbers: [],
  }
}

describe('resolvePoolEntry', () => {
  it.each(['5', '05', '005'])(
    'pads numeric suffix %s and resolves the normal set card',
    (input) => {
      const result = resolvePoolEntry(input, catalog)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.card.cardNumber).toBe('OP16-005')
    },
  )

  it('resolves a normal card by case-insensitive full printed ID', () => {
    const result = resolvePoolEntry('  op16-005  ', catalog)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.cardNumber).toBe('OP16-005')
  })

  it('resolves a special reprint only by its case-insensitive full ID', () => {
    const result = resolvePoolEntry('st21-014', catalog)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.cardNumber).toBe('ST21-014')
  })

  it('resolves a normal card instead of guessing a special with the same suffix', () => {
    const result = resolvePoolEntry('45', catalog)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.cardNumber).toBe('OP16-045')
  })

  it('requires a full ID when a numeric suffix matches only a special reprint', () => {
    const specialOnlyCatalog = runtimeCatalog([card('ST21-014')])

    expect(resolvePoolEntry('14', specialOnlyCatalog)).toMatchObject({
      ok: false,
      reason: 'special-requires-full-id',
    })
  })

  it('distinguishes empty, invalid-format, and well-formed missing input', () => {
    expect(resolvePoolEntry('  ', catalog)).toMatchObject({
      ok: false,
      reason: 'empty',
    })
    expect(resolvePoolEntry('OP16-five', catalog)).toMatchObject({
      ok: false,
      reason: 'invalid-format',
    })
    expect(resolvePoolEntry('0005', catalog)).toMatchObject({
      ok: false,
      reason: 'invalid-format',
    })
    expect(resolvePoolEntry('999', catalog)).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(resolvePoolEntry('OP15-005', catalog)).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
  })
})

describe('pool event projection', () => {
  it('increments repeated copies without mutating or sharing state snapshots', () => {
    const initial = emptyPool()
    const once = appendCard(initial, 'OP16-005')
    const twice = appendCard(once, 'OP16-005')

    expect(initial).toEqual(emptyPool())
    expect(once.counts).toEqual({ 'OP16-005': 1 })
    expect(twice.counts).toEqual({ 'OP16-005': 2 })
    expect(twice.events).toEqual([
      { type: 'added', cardNumber: 'OP16-005' },
      { type: 'added', cardNumber: 'OP16-005' },
    ])
    expect(twice.events).not.toBe(once.events)
    expect(twice.counts).not.toBe(once.counts)
    expect(twice.recentCardNumbers).not.toBe(once.recentCardNumbers)
    expect(Object.isFrozen(twice.events)).toBe(true)
    expect(Object.isFrozen(twice.events[0])).toBe(true)
    expect(Object.isFrozen(twice.counts)).toBe(true)
    expect(Object.isFrozen(twice.recentCardNumbers)).toBe(true)
  })

  it('sets a quantity and removes the count when quantity is zero', () => {
    const added = appendCard(emptyPool(), 'OP16-005')
    const edited = setQuantity(added, 'OP16-005', 4)
    const removed = setQuantity(edited, 'OP16-005', 0)

    expect(added.counts).toEqual({ 'OP16-005': 1 })
    expect(edited.counts).toEqual({ 'OP16-005': 4 })
    expect(removed.counts).toEqual({})
    expect(removed.events.at(-1)).toEqual({
      type: 'quantity-set',
      cardNumber: 'OP16-005',
      quantity: 0,
    })
  })

  it('rejects invalid quantities without mutating the prior state', () => {
    const state = appendCard(emptyPool(), 'OP16-005')

    expect(() => setQuantity(state, 'OP16-005', -1)).toThrow(
      /non-negative integer/i,
    )
    expect(() => setQuantity(state, 'OP16-005', 1.5)).toThrow(
      /non-negative integer/i,
    )
    expect(state.counts).toEqual({ 'OP16-005': 1 })
    expect(state.events).toHaveLength(1)
  })

  it('undoes the last add and restores the prior projection', () => {
    const first = appendCard(emptyPool(), 'OP16-005')
    const second = appendCard(first, 'OP16-045')

    expect(undoLast(second)).toEqual(first)
    expect(undoLast(emptyPool())).toEqual(emptyPool())
  })

  it('undoes a quantity edit to restore the exact preceding count', () => {
    const twice = appendCard(appendCard(emptyPool(), 'OP16-005'), 'OP16-005')
    const edited = setQuantity(twice, 'OP16-005', 7)

    const undone = undoLast(edited)

    expect(undone.counts).toEqual({ 'OP16-005': 2 })
    expect(undone.events).toEqual(twice.events)
    expect(undone.recentCardNumbers).toEqual([
      'OP16-005',
      'OP16-005',
    ])
  })

  it('keeps only the last ten accepted add entries in chronological order', () => {
    const state = Array.from({ length: 12 }, (_, index) =>
      `OP16-${String(index + 1).padStart(3, '0')}`,
    ).reduce(appendCard, emptyPool())

    expect(state.recentCardNumbers).toEqual([
      'OP16-003',
      'OP16-004',
      'OP16-005',
      'OP16-006',
      'OP16-007',
      'OP16-008',
      'OP16-009',
      'OP16-010',
      'OP16-011',
      'OP16-012',
    ])

    const edited = setQuantity(state, 'OP16-003', 8)
    expect(edited.recentCardNumbers).toEqual(state.recentCardNumbers)
  })

  it('adds a normalized batch as one event and aggregates duplicate cards', () => {
    const state = appendCards(emptyPool(), [
      ' op16-005 ',
      'OP16-045',
      'op16-005',
    ])

    expect(state.counts).toEqual({
      'OP16-005': 2,
      'OP16-045': 1,
    })
    expect(state.events).toEqual([
      {
        type: 'batch-added',
        cardNumbers: ['OP16-005', 'OP16-045', 'OP16-005'],
      },
    ])
    expect(state.recentCardNumbers).toEqual([
      'OP16-005',
      'OP16-045',
      'OP16-005',
    ])
  })

  it('projects a realistic 60-card batch and undoes it atomically', () => {
    const prior = appendCard(emptyPool(), 'OP16-001')
    const cardNumbers = Array.from(
      { length: 60 },
      (_, index) => `OP16-${String((index % 12) + 1).padStart(3, '0')}`,
    )

    const state = appendCards(prior, cardNumbers)

    expect(state.events).toHaveLength(2)
    expect(state.counts['OP16-001']).toBe(6)
    expect(state.counts['OP16-012']).toBe(5)
    expect(Object.values(state.counts)).toHaveLength(12)
    expect(eligiblePoolCount(state, catalog)).toBe(5)
    expect(undoLast(state)).toEqual(prior)
  })

  it('copies and deeply freezes batch events instead of retaining caller input', () => {
    const cardNumbers = [' op16-005 ', 'op16-045']
    const state = appendCards(emptyPool(), cardNumbers)
    const event = state.events[0]

    cardNumbers[0] = 'OP16-999'
    cardNumbers.push('OP16-998')

    expect(event).toEqual({
      type: 'batch-added',
      cardNumbers: ['OP16-005', 'OP16-045'],
    })
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.events)).toBe(true)
    expect(Object.isFrozen(event)).toBe(true)
    expect(event.type).toBe('batch-added')
    if (event.type === 'batch-added') {
      expect(event.cardNumbers).not.toBe(cardNumbers)
      expect(Object.isFrozen(event.cardNumbers)).toBe(true)
    }
    expect(Object.isFrozen(state.counts)).toBe(true)
    expect(Object.isFrozen(state.recentCardNumbers)).toBe(true)
  })

  it('rejects an empty batch without changing the prior state', () => {
    const prior = appendCard(emptyPool(), 'OP16-005')

    expect(() => appendCards(prior, [])).toThrow(RangeError)
    expect(prior.events).toEqual([
      { type: 'added', cardNumber: 'OP16-005' },
    ])
    expect(prior.counts).toEqual({ 'OP16-005': 1 })
    expect(prior.recentCardNumbers).toEqual(['OP16-005'])
  })

  it('keeps the latest ten entries in order across manual and batch adds', () => {
    const beforeBatch = [
      'OP16-001',
      'OP16-002',
      'OP16-003',
      'OP16-004',
      'OP16-005',
    ].reduce(appendCard, emptyPool())
    const state = appendCards(
      beforeBatch,
      Array.from(
        { length: 7 },
        (_, index) => `op16-${String(index + 6).padStart(3, '0')}`,
      ),
    )

    expect(state.recentCardNumbers).toEqual([
      'OP16-003',
      'OP16-004',
      'OP16-005',
      'OP16-006',
      'OP16-007',
      'OP16-008',
      'OP16-009',
      'OP16-010',
      'OP16-011',
      'OP16-012',
    ])
  })

  it('supports quantity edits and removals after a batch', () => {
    const batch = appendCards(emptyPool(), [
      'OP16-005',
      'OP16-005',
      'OP16-045',
    ])
    const edited = setQuantity(batch, ' op16-005 ', 7)
    const removed = setQuantity(edited, 'op16-045', 0)

    expect(edited.counts).toEqual({ 'OP16-005': 7, 'OP16-045': 1 })
    expect(removed.counts).toEqual({ 'OP16-005': 7 })
    expect(eligiblePoolCount(removed, catalog)).toBe(7)
  })

  it('replays an older batch when undoing a later event', () => {
    const batch = appendCards(emptyPool(), [
      'OP16-005',
      'OP16-005',
      'OP16-045',
    ])
    const edited = setQuantity(batch, 'OP16-005', 9)

    expect(undoLast(edited)).toEqual(batch)
  })

  it('replaces the projected pool with one normalized event and undoes atomically', () => {
    const prior = setQuantity(
      appendCards(emptyPool(), ['OP16-001', 'OP16-045']),
      'OP16-045',
      4,
    )

    const replaced = replaceCards(prior, [
      ' op16-005 ',
      'OP16-045',
      'op16-005',
    ])

    expect(replaced.counts).toEqual({
      'OP16-005': 2,
      'OP16-045': 1,
    })
    expect(replaced.events).toEqual([
      ...prior.events,
      {
        type: 'batch-replaced',
        cardNumbers: ['OP16-005', 'OP16-045', 'OP16-005'],
      },
    ])
    expect(replaced.events).toHaveLength(prior.events.length + 1)
    expect(replaced.recentCardNumbers).toEqual([
      'OP16-005',
      'OP16-045',
      'OP16-005',
    ])
    expect(undoLast(replaced)).toEqual(prior)
  })

  it('copies and deeply freezes replacement events without mutating caller input', () => {
    const cardNumbers = [' op16-005 ', 'op16-045']
    const replaced = replaceCards(emptyPool(), cardNumbers)
    const event = replaced.events[0]

    expect(cardNumbers).toEqual([' op16-005 ', 'op16-045'])
    cardNumbers[0] = 'OP16-999'
    cardNumbers.push('OP16-998')

    expect(event).toEqual({
      type: 'batch-replaced',
      cardNumbers: ['OP16-005', 'OP16-045'],
    })
    expect(Object.isFrozen(replaced)).toBe(true)
    expect(Object.isFrozen(replaced.events)).toBe(true)
    expect(Object.isFrozen(event)).toBe(true)
    expect(event.type).toBe('batch-replaced')
    if (event.type === 'batch-replaced') {
      expect(event.cardNumbers).not.toBe(cardNumbers)
      expect(Object.isFrozen(event.cardNumbers)).toBe(true)
    }
    expect(Object.isFrozen(replaced.counts)).toBe(true)
    expect(Object.isFrozen(replaced.recentCardNumbers)).toBe(true)
  })

  it('rejects an empty replacement and preserves the prior immutable state', () => {
    const prior = appendCard(emptyPool(), 'OP16-005')

    expect(() => replaceCards(prior, [])).toThrow(
      new RangeError('Pool replacement must include at least one card.'),
    )
    expect(prior).toEqual({
      events: [{ type: 'added', cardNumber: 'OP16-005' }],
      counts: { 'OP16-005': 1 },
      recentCardNumbers: ['OP16-005'],
    })
    expect(Object.isFrozen(prior)).toBe(true)
    expect(Object.isFrozen(prior.events)).toBe(true)
    expect(Object.isFrozen(prior.events[0])).toBe(true)
    expect(Object.isFrozen(prior.counts)).toBe(true)
    expect(Object.isFrozen(prior.recentCardNumbers)).toBe(true)
  })
})

describe('eligiblePoolCount', () => {
  it('counts entered playable copies while excluding Leader and DON!! cards', () => {
    const state = setQuantity(
      setQuantity(
        setQuantity(
          setQuantity(emptyPool(), 'OP16-005', 3),
          'OP16-001',
          2,
        ),
        'OP16-002',
        4,
      ),
      'MISSING-999',
      10,
    )

    expect(eligiblePoolCount(state, catalog)).toBe(3)
  })
})
