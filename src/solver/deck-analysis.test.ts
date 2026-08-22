import { describe, expect, it } from 'vitest'

import {
  classifyCardFeatures,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'
import {
  getStrategyProfile,
  mergeStrategyProfile,
  type StrategyProfile,
} from '../strategy/strategy-profile.js'

import { analyzeMainDeck } from './deck-analysis.js'
import {
  addCandidateToDeckState,
  createEmptyDeckState,
} from './deck-state.js'
import type { AllocatedRole, DeckLine } from './types.js'

const PROFILE = getStrategyProfile('OP16')

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
    cost: 5,
    life: null,
    power: 4000,
    counter: 0,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: cardNumber.slice(-3),
    isSpecialReprint: false,
    ...overrides,
  }
}

function roleCounts(
  overrides: Partial<Record<AllocatedRole, number>> = {},
): Record<AllocatedRole, number> {
  return {
    twoKCounter: 0,
    blocker: 0,
    interaction: 0,
    pressure: 0,
    boss: 0,
    curve: 0,
    ...overrides,
  }
}

function line(
  cardNumber: string,
  quantity: number,
  overrides: Partial<PlayableCard> = {},
  allocatedRoleOverrides: Partial<Record<AllocatedRole, number>> = {},
): DeckLine {
  return {
    card: card(cardNumber, overrides),
    quantity,
    allocatedRoles: roleCounts(allocatedRoleOverrides),
    score: 0,
    reasons: [],
  }
}

function featuresFor(
  mainDeck: readonly DeckLine[],
): ReadonlyMap<string, CardFeatures> {
  return new Map(
    mainDeck.map(({ card: deckCard }) => [
      deckCard.cardNumber,
      classifyCardFeatures(deckCard),
    ]),
  )
}

function analyze(
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile = PROFILE,
  featuresByCardNumber: ReadonlyMap<string, CardFeatures> = featuresFor(mainDeck),
) {
  return analyzeMainDeck(mainDeck, featuresByCardNumber, profile)
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested)
}

function sideFor(
  analysis: ReturnType<typeof analyze>,
  id: string,
): 'strength' | 'weakness' | 'neutral' {
  if (analysis.strengths.some((insight) => insight.id === id)) {
    return 'strength'
  }
  if (analysis.weaknesses.some((insight) => insight.id === id)) {
    return 'weakness'
  }
  return 'neutral'
}

describe('analyzeMainDeck distribution', () => {
  it('orders exact numeric costs before missing cost and splits each copy across canonical colors', () => {
    const analysis = analyze([
      line('OP16-001', 8, {
        cost: 7,
        colors: [' blue ', 'RED', 'blue'],
      }),
      line('OP16-002', 8, { cost: 2, colors: ['Green'] }),
      line('OP16-005', 4, { cost: 2.5, colors: ['Yellow'] }),
      line('OP16-003', 16, { cost: 7, colors: ['Orange'] }),
      line('OP16-004', 4, { cost: null, colors: [] }),
    ])

    expect(analysis.costColorDistribution).toEqual([
      { cost: 2, total: 8, segments: [{ color: 'Green', count: 8 }] },
      { cost: 2.5, total: 4, segments: [{ color: 'Yellow', count: 4 }] },
      {
        cost: 7,
        total: 24,
        segments: [
          { color: 'Red', count: 4 },
          { color: 'Blue', count: 4 },
          { color: 'Unknown', count: 16 },
        ],
      },
      { cost: null, total: 4, segments: [{ color: 'Unknown', count: 4 }] },
    ])
    for (const bucket of analysis.costColorDistribution) {
      expect(
        bucket.segments.reduce((total, segment) => total + segment.count, 0),
      ).toBe(bucket.total)
    }
    expect(
      analysis.costColorDistribution.reduce(
        (total, bucket) => total + bucket.total,
        0,
      ),
    ).toBe(40)
  })

  it('uses an exact residual for forty one-copy three-color lines', () => {
    const analysis = analyze(
      Array.from({ length: 40 }, (_, index) =>
        line(`OP16-${String(index + 1).padStart(3, '0')}`, 1, {
          colors: ['Red', 'Blue', 'Green'],
          cost: 3,
        }),
      ),
    )
    const bucket = analysis.costColorDistribution[0]

    expect(bucket?.segments.map(({ color }) => color)).toEqual([
      'Red',
      'Blue',
      'Green',
    ])
    expect(bucket?.segments[0]?.count).toBeCloseTo(40 / 3)
    expect(bucket?.segments[1]?.count).toBeCloseTo(40 / 3)
    expect(
      bucket?.segments.reduce((total, segment) => total + segment.count, 0),
    ).toBe(bucket?.total)
    expect(
      analysis.costColorDistribution.reduce(
        (total, costBucket) => total + costBucket.total,
        0,
      ),
    ).toBe(40)
  })

  it('returns deeply frozen output detached from mutable deck input', () => {
    const colors = ['Red', 'Blue']
    const sourceLine = line('OP16-001', 40, { cost: 2, colors })
    const analysis = analyze([sourceLine])

    colors[0] = 'Black'
    sourceLine.quantity = 1

    expect(analysis.costColorDistribution).toEqual([
      {
        cost: 2,
        total: 40,
        segments: [
          { color: 'Red', count: 20 },
          { color: 'Blue', count: 20 },
        ],
      },
    ])
    expectDeeplyFrozen(analysis)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a %s line quantity', (_label, quantity) => {
    const deck = [line('OP16-001', quantity)]
    expect(() => analyze(deck)).toThrow(/positive safe integer/i)
  })

  it('rejects a main deck whose quantities do not total exactly 40', () => {
    const deck = [line('OP16-001', 39)]
    expect(() => analyze(deck)).toThrow(/exactly 40/i)
  })
})

describe('analyzeMainDeck authoritative measurements', () => {
  function overlappingDeck(): readonly DeckLine[] {
    return [
      line(
        'OP16-099',
        1,
        {
          name: 'Overlapping Finisher',
          cost: 7,
          power: 9000,
          counter: 2000,
          effect:
            '[Blocker] [Rush] [Banish] [On Play] Draw 1 card. K.O. up to 1 of your opponent\'s Characters with a cost of 3 or less.',
        },
        { curve: 40 },
      ),
      line('OP16-088', 1, {
        cardType: 'EVENT',
        cost: 4,
        counter: null,
        effect:
          '[Main] K.O. up to 1 of your opponent\'s Characters with a cost of 2 or less.',
      }),
      line('OP16-077', 1, {
        cost: 3,
        power: 5000,
        counter: 1000,
      }),
      line('OP16-066', 1, {
        cost: 5,
        power: 4000,
        counter: 0,
      }),
      line('OP16-001', 36, {
        cardType: 'EVENT',
        cost: 0,
        counter: null,
      }),
    ]
  }

  it('counts independent classified roles, interaction union, counter, bricks, and important-play parity', () => {
    const deck = overlappingDeck()
    const featureMap = featuresFor(deck)
    const analysis = analyze(deck, PROFILE, featureMap)

    expect(analysis.roleCoverage.twoKCounter).toEqual({ count: 1, target: 10 })
    expect(analysis.roleCoverage.blocker).toEqual({ count: 1, target: 10 })
    expect(analysis.roleCoverage.vanillaLike).toEqual({ count: 1, target: 10 })
    expect(analysis.roleCoverage.draw).toEqual({ count: 1, target: null })
    expect(analysis.roleCoverage.removal).toEqual({ count: 2, target: null })
    expect(analysis.roleCoverage.interaction).toEqual({ count: 2, target: 5 })
    expect(analysis.roleCoverage.boss).toEqual({ count: 1, target: 5 })
    expect(analysis.roleCoverage.rush).toEqual({ count: 1, target: null })
    expect(analysis.roleCoverage.banish).toEqual({ count: 1, target: null })
    expect(analysis.roleCoverage.brick).toEqual({ count: 1, target: null })
    expect(analysis.totalCounter).toBe(3000)
    expect(analysis.oddCostImportantPlays).toBe(2)
    expect(analysis.evenCostImportantPlays).toBe(1)
  })

  it('keeps analyzer important-play parity identical to incremental deck state', () => {
    const deck = overlappingDeck()
    const featureMap = featuresFor(deck)
    let state = createEmptyDeckState()
    for (const deckLine of deck) {
      const features = featureMap.get(deckLine.card.cardNumber)
      if (features === undefined) throw new Error('Missing fixture features.')
      for (let copy = 0; copy < deckLine.quantity; copy += 1) {
        state = addCandidateToDeckState(state, {
          card: deckLine.card,
          features,
        })
      }
    }

    const analysis = analyze(deck, PROFILE, featureMap)

    expect({
      odd: analysis.oddCostImportantPlays,
      even: analysis.evenCostImportantPlays,
    }).toEqual(state.importantPlayCounts)
  })

  it('ignores contradictory exclusive legacy allocations', () => {
    const deck = [
      line(
        'OP16-001',
        40,
        { cardType: 'EVENT', cost: 1, counter: null },
        {
          twoKCounter: 40,
          blocker: 40,
          interaction: 40,
          pressure: 40,
          boss: 40,
          curve: 40,
        },
      ),
    ]

    const analysis = analyze(deck)

    expect(
      Object.values(analysis.roleCoverage).map(({ count }) => count),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('injects active profile targets without inventing targets for detailed roles', () => {
    const profile = mergeStrategyProfile(PROFILE, {
      targets: {
        twoKCounter: 4,
        blocker: 5,
        vanillaLike: 6,
        interaction: 7,
        boss: 8,
      },
    })
    const analysis = analyze(overlappingDeck(), profile)

    expect(analysis.roleCoverage).toMatchObject({
      twoKCounter: { target: 4 },
      blocker: { target: 5 },
      vanillaLike: { target: 6 },
      interaction: { target: 7 },
      boss: { target: 8 },
      draw: { target: null },
      removal: { target: null },
      rush: { target: null },
      banish: { target: null },
      brick: { target: null },
    })
  })

  it('counts a draw-and-removal copy once toward interaction', () => {
    const deck = [
      line('OP16-001', 2, {
        cardType: 'EVENT',
        cost: 2,
        counter: null,
        effect:
          '[Main] Draw 1 card. K.O. up to 1 of your opponent\'s Characters with a cost of 1 or less.',
      }),
      line('OP16-002', 38, {
        cardType: 'EVENT',
        cost: 0,
        counter: null,
      }),
    ]
    const analysis = analyze(deck)

    expect(analysis.roleCoverage.draw.count).toBe(2)
    expect(analysis.roleCoverage.removal.count).toBe(2)
    expect(analysis.roleCoverage.interaction.count).toBe(2)
  })

  it('renders structured lockdown coverage without inventing draw or removal', () => {
    const deck = [
      line('OP16-003', 2, {
        effect:
          '[On Play] Up to 2 of your opponent\'s Characters cannot attack until the end of your opponent\'s next End Phase.',
      }),
      line('OP16-004', 38, { cardType: 'EVENT', cost: 0, counter: null }),
    ]
    const analysis = analyze(deck)

    expect(analysis.roleCoverage.draw.count).toBe(0)
    expect(analysis.roleCoverage.removal.count).toBe(0)
    expect(analysis.roleCoverage.interaction.count).toBe(2)
  })

  it('rejects a deck card without published features', () => {
    const deck = [line('OP16-001', 40)]
    expect(() => analyze(deck, PROFILE, new Map())).toThrow(/features.*OP16-001/i)
  })
})

describe('analyzeMainDeck profile-driven insights', () => {
  it.each([
    [23_999, 'weakness'],
    [24_000, 'neutral'],
    [29_999, 'neutral'],
    [30_000, 'strength'],
  ] as const)(
    'classifies total counter %i as %s at the default profile boundary',
    (totalCounter, expected) => {
      const deck = [
        line('OP16-001', 1, { cost: 3, counter: totalCounter }),
        line('OP16-002', 39, {
          cardType: 'EVENT',
          cost: 0,
          counter: null,
        }),
      ]

      expect(sideFor(analyze(deck), 'total-counter')).toBe(expected)
    },
  )

  it('uses an overridden total-counter policy without coupling it to role targets', () => {
    const profile = mergeStrategyProfile(PROFILE, {
      analysis: {
        totalCounter: { neutralMinimum: 5_000, strengthMinimum: 6_000 },
      },
    })
    const deck = [
      line('OP16-001', 1, { cost: 3, counter: 5_999 }),
      line('OP16-002', 39, {
        cardType: 'EVENT',
        cost: 0,
        counter: null,
      }),
    ]

    const analysis = analyze(deck, profile)

    expect(sideFor(analysis, 'total-counter')).toBe('neutral')
    expect(analysis.roleCoverage.twoKCounter.target).toBe(10)
  })

  it('uses profile curve bands and targets as evidence', () => {
    const profile = mergeStrategyProfile(PROFILE, {
      curve: {
        early: { minimumCost: 1, maximumCost: 1, target: 10 },
        middle: { minimumCost: 2, maximumCost: 3, target: 15 },
        late: { minimumCost: 4, minimum: 8, maximum: 12 },
        highCost: { minimumCost: 8, minimum: 3, maximum: 6 },
      },
    })
    const deck = [
      line('OP16-001', 9, { cardType: 'EVENT', cost: 1, counter: null }),
      line('OP16-002', 15, { cardType: 'EVENT', cost: 2, counter: null }),
      line('OP16-003', 13, { cardType: 'EVENT', cost: 4, counter: null }),
      line('OP16-004', 3, { cardType: 'EVENT', cost: 8, counter: null }),
    ]
    const analysis = analyze(deck, profile)

    expect(sideFor(analysis, 'early-curve')).toBe('weakness')
    expect(
      analysis.weaknesses.find(({ id }) => id === 'early-curve')?.evidence,
    ).toMatch(/9.*10/)
  })

  it('reports low counter and excessive brick evidence', () => {
    const deck = [
      line('OP16-001', 9, { cost: 5, power: 4000, counter: 0 }),
      line('OP16-002', 31, {
        cardType: 'EVENT',
        cost: 3,
        counter: null,
      }),
    ]
    const analysis = analyze(deck)

    expect(sideFor(analysis, 'total-counter')).toBe('weakness')
    expect(sideFor(analysis, 'bricks')).toBe('weakness')
    expect(
      analysis.weaknesses.find(({ id }) => id === 'bricks')?.evidence,
    ).toMatch(/9.*8/)
  })

  it('produces deterministic priority/severity/id ordering capped at three per side', () => {
    const deck = [
      line('OP16-001', 40, { cost: 7, power: 4000, counter: 0 }),
    ]

    const first = analyze(deck)
    const second = analyze(deck)

    expect(first.strengths.length).toBeLessThanOrEqual(3)
    expect(first.weaknesses).toHaveLength(3)
    expect(first.strengths).toEqual(second.strengths)
    expect(first.weaknesses).toEqual(second.weaknesses)
  })
})
