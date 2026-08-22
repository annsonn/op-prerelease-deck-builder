import { describe, expect, it } from 'vitest'

import { classifyCardFeatures } from '../../shared/card-features.js'
import type {
  PlayableCard,
  StrategySuggestion,
  SuggestedRole,
} from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'

import { BasicDeckSolver } from './basic-solver.js'

function card(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  return {
    cardNumber,
    name: `${cardNumber} Test Card`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4000,
    counter: 0,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: cardNumber.startsWith('OP16-')
      ? cardNumber.slice(-3)
      : null,
    isSpecialReprint: !cardNumber.startsWith('OP16-'),
    ...overrides,
  }
}

function suggestion(
  cardNumber: string,
  roles: readonly SuggestedRole[] = [],
): StrategySuggestion {
  return {
    cardNumber,
    roles: [...roles],
    reviewStatus: 'suggested',
  }
}

function runtimeCatalog(
  cards: readonly PlayableCard[],
  roleAssignments: Readonly<Record<string, readonly SuggestedRole[]>> = {},
): RuntimeCatalog {
  const suggestions = cards.map((item) =>
    suggestion(item.cardNumber, roleAssignments[item.cardNumber]),
  )
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
    strategySuggestions: suggestions,
    suggestionsByCardNumber: new Map(
      suggestions.map((item) => [item.cardNumber, item]),
    ),
    featuresByCardNumber: new Map(
      cards.map((item) => {
        const classified = classifyCardFeatures(item)
        const roles = new Set(roleAssignments[item.cardNumber] ?? [])
        const roleFlags = {
          ...classified.flags,
          blocker: roles.has('blocker') || classified.flags.blocker,
          vanillaLike: roles.has('pressure') || classified.flags.vanillaLike,
          draw: roles.has('draw') || classified.flags.draw,
          removal: roles.has('removal') || classified.flags.removal,
          boss: roles.has('boss') || classified.flags.boss,
        }
        return [
          item.cardNumber,
          {
            ...classified,
            flags: roleFlags,
            rainbowUsableFlags: { ...roleFlags },
          },
        ] as const
      }),
    ),
  }
}

function quantities(
  lines: readonly { card: PlayableCard; quantity: number }[],
): Record<string, number> {
  return Object.fromEntries(
    lines.map((line) => [line.card.cardNumber, line.quantity]),
  )
}

const solver = new BasicDeckSolver()

describe('BasicDeckSolver', () => {
  it('throws an actionable shortage error below 40 eligible copies', () => {
    const catalog = runtimeCatalog([card('OP16-001')])

    expect(() => solver.solve(catalog, { 'OP16-001': 39 })).toThrow(
      'A legal sealed deck needs 40 eligible cards; only 39 were entered. Add 1 more eligible card.',
    )
  })

  it('builds exactly 40 cards while excluding Leader and DON!! copies', () => {
    const playable = card('OP16-003')
    const leader = card('OP16-001', { cardType: 'LEADER' })
    const don = card('OP16-002', { cardType: 'DON' })
    const catalog = runtimeCatalog([leader, don, playable])

    const result = solver.solve(catalog, {
      'OP16-001': 2,
      'OP16-002': 10,
      'OP16-003': 40,
    })

    expect(result.mainDeckSize).toBe(40)
    expect(quantities(result.mainDeck)).toEqual({ 'OP16-003': 40 })
    expect(result.sideboard).toEqual([])
    expect(result.mainDeck).not.toContainEqual(
      expect.objectContaining({ card: leader }),
    )
    expect(result.mainDeck).not.toContainEqual(expect.objectContaining({ card: don }))
  })

  it('allocates every eligible pool copy exactly once without exceeding counts', () => {
    const cards = [card('OP16-010'), card('OP16-011'), card('OP16-012')]
    const catalog = runtimeCatalog(cards)
    const counts = {
      'OP16-010': 22,
      'OP16-011': 17,
      'OP16-012': 6,
    }

    const result = solver.solve(catalog, counts)
    const main = quantities(result.mainDeck)
    const side = quantities(result.sideboard)

    expect(result.mainDeck.reduce((sum, line) => sum + line.quantity, 0)).toBe(
      40,
    )
    for (const [cardNumber, poolQuantity] of Object.entries(counts)) {
      expect((main[cardNumber] ?? 0) + (side[cardNumber] ?? 0)).toBe(
        poolQuantity,
      )
      expect(main[cardNumber] ?? 0).toBeLessThanOrEqual(poolQuantity)
    }
  })

  it('allocates huge valid quantities without materializing one object per copy', () => {
    const best = card('OP16-001', { counter: 2000 })
    const lower = card('OP16-002')
    const catalog = runtimeCatalog([best, lower])

    const result = solver.solve(catalog, {
      'OP16-001': 1_000_000_000,
      'OP16-002': 1,
    })

    expect(quantities(result.mainDeck)).toEqual({ 'OP16-001': 40 })
    expect(quantities(result.sideboard)).toEqual({
      'OP16-001': 999_999_960,
      'OP16-002': 1,
    })
  })

  it('uses card number then copy ordinal to break equal-score ties deterministically', () => {
    const high = card('OP16-900', { counter: 2000 })
    const firstTie = card('OP16-010')
    const secondTie = card('OP16-011')
    const catalog = runtimeCatalog([secondTie, high, firstTie])

    const first = solver.solve(catalog, {
      'OP16-011': 1,
      'OP16-010': 2,
      'OP16-900': 39,
    })
    const second = solver.solve(catalog, {
      'OP16-900': 39,
      'OP16-010': 2,
      'OP16-011': 1,
    })

    expect(quantities(first.mainDeck)).toEqual({
      'OP16-900': 39,
      'OP16-010': 1,
    })
    expect(quantities(first.sideboard)).toEqual({
      'OP16-010': 1,
      'OP16-011': 1,
    })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('applies the exact transparent score and primary-role priority per copy', () => {
    const cards = [
      card('OP16-101', { cost: 8, counter: 2000 }),
      card('OP16-102', { cost: 3, counter: 1000 }),
      card('OP16-103', { cost: 5 }),
      card('OP16-104', { cost: 7 }),
      card('OP16-105', { cost: 2 }),
      card('OP16-106', { cost: null }),
    ]
    const catalog = runtimeCatalog(cards, {
      'OP16-101': ['blocker', 'removal', 'draw', 'pressure', 'boss'],
      'OP16-102': ['blocker', 'removal'],
      'OP16-103': ['removal'],
      'OP16-104': ['boss'],
      'OP16-105': ['pressure'],
      'OP16-106': ['draw'],
    })

    const result = solver.solve(catalog, {
      'OP16-101': 8,
      'OP16-102': 8,
      'OP16-103': 4,
      'OP16-104': 4,
      'OP16-105': 4,
      'OP16-106': 12,
    })
    const byNumber = new Map(
      result.mainDeck.map((line) => [line.card.cardNumber, line]),
    )

    expect(byNumber.get('OP16-101')).toMatchObject({
      quantity: 8,
      score: 94,
      allocatedRoles: { twoKCounter: 8 },
    })
    expect(byNumber.get('OP16-102')).toMatchObject({
      quantity: 8,
      score: 54,
      allocatedRoles: { blocker: 8 },
    })
    expect(byNumber.get('OP16-103')).toMatchObject({
      quantity: 4,
      score: 26,
      allocatedRoles: { interaction: 4 },
    })
    expect(byNumber.get('OP16-104')).toMatchObject({
      quantity: 4,
      score: 10,
      allocatedRoles: { boss: 4 },
    })
    expect(byNumber.get('OP16-105')).toMatchObject({
      quantity: 4,
      score: 20,
      allocatedRoles: { pressure: 4 },
    })
    expect(byNumber.get('OP16-106')).toMatchObject({
      quantity: 12,
      score: 14,
      allocatedRoles: { curve: 12 },
    })
    expect(result.curve).toEqual({
      '0-2': 16,
      '3-4': 8,
      '5-6': 4,
      '7+': 12,
    })
    expect(result.totalCounter).toBe(24_000)
    expect(result.roleCoverage).toEqual({
      twoKCounter: 8,
      blocker: 16,
      interaction: 0,
      pressure: 12,
      boss: 12,
      curve: 28,
    })
    expect(result.warnings).toEqual([
      'Only 8 2K counters; aim for at least 10.',
      'Only 0 interaction cards; aim for at least 5.',
    ])
    expect(result.label).toBe('Basic sealed build')
    expect(result.solverVersion).toBe('basic-v1')
    expect(result.profileId).toBe('baseline-v1')
    expect(result.profileVersion).toBe(1)
  })

  it('warns when the selected deck is below each role threshold', () => {
    const catalog = runtimeCatalog([card('OP16-001')])

    const result = solver.solve(catalog, { 'OP16-001': 40 })

    expect(result.warnings).toEqual([
      'Only 0 2K counters; aim for at least 10.',
      'Only 0 blockers; aim for at least 10.',
      'Only 0 vanilla-like bodies; aim for at least 10.',
      'Only 0 interaction cards; aim for at least 5.',
      'Only 0 bosses; aim for at least 5.',
    ])
  })

  it('attaches analysis for the selected 40 copies without changing allocation', () => {
    const best = card('OP16-001', {
      colors: ['Red', 'Blue'],
      cost: 3,
      counter: 2000,
    })
    const lower = card('OP16-002', { colors: ['Green'], cost: 7 })
    const catalog = runtimeCatalog([best, lower])

    const result = solver.solve(catalog, {
      'OP16-001': 20,
      'OP16-002': 25,
    })

    expect(quantities(result.mainDeck)).toEqual({
      'OP16-001': 20,
      'OP16-002': 20,
    })
    expect(quantities(result.sideboard)).toEqual({ 'OP16-002': 5 })
    expect(
      result.analysis.costColorDistribution.reduce(
        (total, bucket) => total + bucket.total,
        0,
      ),
    ).toBe(40)
    expect(result.analysis.costColorDistribution).toEqual([
      {
        cost: 3,
        total: 20,
        segments: [
          { color: 'Red', count: 10 },
          { color: 'Blue', count: 10 },
        ],
      },
      { cost: 7, total: 20, segments: [{ color: 'Green', count: 20 }] },
    ])
    expect(Object.isFrozen(result.analysis)).toBe(true)
    expect(result.totalCounter).toBe(result.analysis.totalCounter)
    expect(result.roleCoverage.twoKCounter).toBe(
      result.analysis.roleCoverage.twoKCounter.count,
    )
  })

  it('deep-freezes catalog card data exposed by the solution', () => {
    const sourceCard = card('OP16-001')
    const catalog = runtimeCatalog([sourceCard])

    const result = solver.solve(catalog, { 'OP16-001': 41 })
    const solvedCard = result.mainDeck[0]?.card

    expect(solvedCard).not.toBe(sourceCard)
    expect(Object.isFrozen(solvedCard)).toBe(true)
    expect(Object.isFrozen(solvedCard?.colors)).toBe(true)
    expect(Object.isFrozen(solvedCard?.traits)).toBe(true)
    expect(Object.isFrozen(solvedCard?.setMembership)).toBe(true)
    expect(result.sideboard[0]?.card).toBe(solvedCard)
  })

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['not finite', Number.NaN],
  ])('rejects %s pool quantities defensively', (_label, quantity) => {
    const catalog = runtimeCatalog([card('OP16-001')])

    expect(() => solver.solve(catalog, { 'OP16-001': quantity })).toThrow(
      /non-negative integer/i,
    )
  })

  it('rejects a positive count for a card outside the selected catalog', () => {
    const catalog = runtimeCatalog([card('OP16-001')])

    expect(() =>
      solver.solve(catalog, { 'OP16-001': 40, 'OP99-999': 1 }),
    ).toThrow('Pool card OP99-999 is not in the selected catalog.')
  })
})
