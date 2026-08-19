import { describe, expect, it } from 'vitest'

import {
  classifyCardFeatures,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'
import {
  getStrategyProfile,
  type StrategyProfile,
} from '../strategy/strategy-profile.js'

import { measuredRoleKeys, type MeasuredRole } from './deck-state.js'
import { generatePlayGuide } from './play-guide.js'
import type {
  AllocatedRole,
  DeckAnalysis,
  DeckInsight,
  DeckLine,
} from './types.js'

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
    cost: 4,
    life: null,
    power: 6000,
    counter: 1000,
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

function allocatedRoles(): Record<AllocatedRole, number> {
  return {
    twoKCounter: 0,
    blocker: 0,
    interaction: 0,
    pressure: 0,
    boss: 0,
    curve: 0,
  }
}

function line(deckCard: PlayableCard, quantity = 1, score = 0): DeckLine {
  return {
    card: deckCard,
    quantity,
    allocatedRoles: allocatedRoles(),
    score,
    reasons: [],
  }
}

function coverage(
  overrides: Partial<Record<MeasuredRole, number>> = {},
): DeckAnalysis['roleCoverage'] {
  return Object.fromEntries(
    measuredRoleKeys.map((role) => [
      role,
      {
        count: overrides[role] ?? 0,
        target:
          role === 'twoKCounter' ||
          role === 'blocker' ||
          role === 'vanillaLike' ||
          role === 'interaction' ||
          role === 'boss'
            ? PROFILE.targets[role]
            : null,
      },
    ]),
  ) as DeckAnalysis['roleCoverage']
}

function insight(id: string, title = id): DeckInsight {
  return { id, title, evidence: `${title} needs help.`, priority: 1 }
}

function analysis(
  overrides: Partial<DeckAnalysis> = {},
): DeckAnalysis {
  return {
    costColorDistribution: [],
    totalCounter: 26_000,
    roleCoverage: coverage(),
    oddCostImportantPlays: 10,
    evenCostImportantPlays: 10,
    strengths: [],
    weaknesses: [],
    ...overrides,
  }
}

function featureMap(
  lines: readonly DeckLine[],
): ReadonlyMap<string, CardFeatures> {
  return new Map(
    lines.map(({ card: deckCard }) => [
      deckCard.cardNumber,
      classifyCardFeatures(deckCard),
    ]),
  )
}

function guideFor({
  mainDeck = [],
  sideboard = [],
  deckAnalysis = analysis(),
  profile = PROFILE,
}: {
  mainDeck?: readonly DeckLine[]
  sideboard?: readonly DeckLine[]
  deckAnalysis?: DeckAnalysis
  profile?: StrategyProfile
} = {}) {
  const allLines = [...mainDeck, ...sideboard]
  return generatePlayGuide({
    mainDeck,
    sideboard,
    analysis: deckAnalysis,
    featuresByCardNumber: featureMap(allLines),
    profile,
    leader: 'Rainbow Luffy',
  })
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested)
}

function allGuideStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allGuideStrings)
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(allGuideStrings)
  }
  return []
}

describe('generatePlayGuide turn order', () => {
  it.each([
    [9, 5, 'first'],
    [5, 9, 'second'],
    [8, 6, 'flexible'],
  ] as const)(
    'recommends %s odd and %s even important plays as %s',
    (odd, even, expected) => {
      const guide = guideFor({
        deckAnalysis: analysis({
          oddCostImportantPlays: odd,
          evenCostImportantPlays: even,
        }),
      })

      expect(guide.turnOrder.preference).toBe(expected)
      expect(guide.turnOrder.points[0]).toContain(String(odd))
      expect(guide.turnOrder.points[0]).toContain(String(even))
    },
  )
})

describe('generatePlayGuide opening and game plan', () => {
  it('names useful early bodies, Blockers, and 2K counters without promoting an unsupported combo', () => {
    const earlyBody = line(
      card('OP16-001', { name: 'Early Body', cost: 1, power: 3000 }),
    )
    const blocker = line(
      card('OP16-002', {
        name: 'Early Blocker',
        cost: 2,
        effect: '[Blocker]',
      }),
    )
    const twoK = line(
      card('OP16-003', { name: 'Hand Guard', cost: 3, counter: 2000 }),
    )
    const unsupportedCombo = line(
      card('OP16-004', {
        name: 'Unsupported Combo',
        cost: 1,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )

    const openingPoints = guideFor({
      mainDeck: [earlyBody, blocker, twoK, unsupportedCombo],
      deckAnalysis: analysis({
        roleCoverage: coverage({ twoKCounter: 1, blocker: 1 }),
      }),
    }).openingPriorities.points
    const points = openingPoints.join(' ')

    expect(points).toContain('OP16-001 Early Body')
    expect(points).toContain('OP16-002 Early Blocker')
    expect(points).toContain('OP16-003 Hand Guard')
    expect(openingPoints).not.toContainEqual(
      expect.stringMatching(/supported setup.*Unsupported Combo/i),
    )
    expect(points).not.toContain('Missing Ally')
  })

  it('describes early development, mid-game pressure, and the actual selected finisher', () => {
    const early = line(card('OP16-001', { name: 'Scout', cost: 2 }))
    const middle = line(card('OP16-055', { name: 'Pressure', cost: 5 }))
    const boss = line(
      card('OP16-099', {
        name: 'Final Captain',
        cost: 8,
        power: 9000,
        counter: 0,
        effect: '[Rush] [On Play] Draw 1 card.',
      }),
      2,
    )

    const guide = guideFor({
      mainDeck: [early, middle, boss],
      deckAnalysis: analysis({
        roleCoverage: coverage({ boss: 2, rush: 2, draw: 2 }),
      }),
    })

    expect(guide.corePlan.points[0]).toMatch(/early/i)
    expect(guide.corePlan.points[1]).toMatch(/mid-game/i)
    expect(guide.corePlan.points[2]).toContain('OP16-099 Final Captain')
    expect(guide.finishers.points).toContainEqual(
      expect.stringContaining('OP16-099 Final Captain'),
    )
    expect(guide.finishers.points.join(' ')).toMatch(/Rush|draw/i)
  })

  it('does not recommend high-cost Blockers, searchers, or draw cards as opening keeps', () => {
    const highBlocker = line(
      card('OP16-071', {
        name: 'Late Blocker',
        cost: 7,
        power: 8000,
        effect: '[Blocker]',
      }),
    )
    const highSearcher = line(
      card('OP16-081', {
        name: 'Late Searcher',
        cost: 8,
        power: 9000,
        effect:
          '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Test Crew} type card and add it to your hand.',
      }),
    )
    const highDraw = line(
      card('OP16-091', {
        name: 'Late Draw',
        cost: 9,
        power: 10_000,
        effect: '[On Play] Draw 1 card.',
      }),
    )
    const support = line(card('OP16-010', { name: 'Support' }), 6)

    const points = guideFor({
      mainDeck: [highBlocker, highSearcher, highDraw, support],
    }).openingPriorities.points.join(' ')

    expect(points).not.toContain('Late Blocker')
    expect(points).not.toContain('Late Searcher')
    expect(points).not.toContain('Late Draw')
  })

  it('keeps intrinsic early-body and 2K evidence when a conditional effect lacks support', () => {
    const independentValue = line(
      card('OP16-011', {
        name: 'Independent Value',
        cost: 1,
        power: 3000,
        counter: 2000,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )

    const points = guideFor({
      mainDeck: [independentValue],
    }).openingPriorities.points

    expect(points).toContainEqual(expect.stringMatching(/early body.*Independent Value/i))
    expect(points).toContainEqual(expect.stringMatching(/2K counter.*Independent Value/i))
    expect(points).not.toContainEqual(expect.stringMatching(/supported setup.*Independent Value/i))
  })

  it('counts searchable targets after the source copy leaves the deck', () => {
    const searcher = line(
      card('OP16-012', {
        name: 'Self-counting Searcher',
        cost: 2,
        effect:
          '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Test Crew} type card and add it to your hand.',
      }),
    )
    const fiveOtherTargets = line(
      card('OP16-013', { name: 'Five Other Targets', cost: 4 }),
      5,
    )
    const sixOtherTargets = line(
      card('OP16-013', { name: 'Six Other Targets', cost: 4 }),
      6,
    )

    const underThreshold = guideFor({
      mainDeck: [searcher, fiveOtherTargets],
    }).openingPriorities.points.join(' ')
    const atThreshold = guideFor({
      mainDeck: [searcher, sixOtherTargets],
    }).openingPriorities.points.join(' ')

    expect(underThreshold).not.toMatch(/supported setup.*Self-counting Searcher/i)
    expect(atThreshold).toMatch(/supported setup.*Self-counting Searcher/i)
  })

  it('keeps combo support semantics distinct because the played Character can satisfy its own condition', () => {
    const selfSupportingCombo = line(
      card('OP16-017', {
        name: 'Self Combo',
        cost: 2,
        effect:
          '[On Play] If you have a Character named [Self Combo], draw 1 card.',
      }),
      PROFILE.limits.comboMinimumSupport,
    )

    const points = guideFor({
      mainDeck: [selfSupportingCombo],
    }).openingPriorities.points.join(' ')

    expect(points).toMatch(/supported setup.*Self Combo/i)
  })

  it('uses only Character bodies as named core development and pressure evidence', () => {
    const earlyEvent = line(
      card('OP16-014', {
        name: 'Early Event',
        cardType: 'EVENT',
        cost: 1,
      }),
    )
    const middleStage = line(
      card('OP16-015', {
        name: 'Middle Stage',
        cardType: 'STAGE',
        cost: 4,
      }),
    )
    const unsupportedEffectBoss = line(
      card('OP16-016', {
        name: 'Unsupported Effect Boss',
        cost: 7,
        power: 7000,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )

    const points = guideFor({
      mainDeck: [earlyEvent, middleStage, unsupportedEffectBoss],
    }).corePlan.points.join(' ')

    expect(points).not.toContain('Early Event')
    expect(points).not.toContain('Middle Stage')
    expect(points).not.toContain('Unsupported Effect Boss')
    expect(points).toMatch(/efficient development|steady board pressure|no selected boss/i)
  })

  it('does not name underpowered early or mid Characters whose only value is unsupported conditional text', () => {
    const earlyConditional = line(
      card('OP16-018', {
        name: 'Underpowered Early Conditional',
        cost: 2,
        power: 0,
        counter: 0,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )
    const middleConditional = line(
      card('OP16-019', {
        name: 'Underpowered Mid Conditional',
        cost: 4,
        power: 1000,
        counter: 0,
        effect:
          '[On Play] If you have a Character named [Missing Ally], K.O. up to 1 of your opponent\'s Characters with a cost of 3 or less.',
      }),
    )

    const points = guideFor({
      mainDeck: [earlyConditional, middleConditional],
    }).corePlan.points.join(' ')

    expect(points).not.toContain('Underpowered Early Conditional')
    expect(points).not.toContain('Underpowered Mid Conditional')
    expect(points).toMatch(/efficient development/i)
    expect(points).toMatch(/steady board pressure/i)
  })

  it('keeps unconditional Blocker, Rush, and removal claims when an unrelated conditional draw lacks support', () => {
    const mixedBlocker = line(
      card('OP16-020', {
        name: 'Mixed Blocker',
        cost: 2,
        power: 1000,
        effect:
          '[Blocker] [On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )
    const mixedRush = line(
      card('OP16-021', {
        name: 'Mixed Rush Boss',
        cost: 7,
        power: 7000,
        counter: 0,
        effect:
          '[Rush] [On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )
    const mixedRemoval = line(
      card('OP16-022', {
        name: 'Mixed Removal',
        cardType: 'EVENT',
        cost: 4,
        effect:
          '[Main] K.O. up to 1 of your opponent\'s Characters with a cost of 3 or less. If you have a Character named [Missing Ally], draw 1 card.',
      }),
      1,
      10,
    )

    const guide = guideFor({
      mainDeck: [mixedBlocker, mixedRush],
      sideboard: [mixedRemoval],
      deckAnalysis: analysis({
        roleCoverage: coverage({ blocker: 1, boss: 1, rush: 1 }),
        weaknesses: [insight('interaction', 'Interaction')],
      }),
    })
    const opening = guide.openingPriorities.points
    const finishers = guide.finishers.points.join(' ')

    expect(opening).toContainEqual(expect.stringMatching(/Blocker.*Mixed Blocker/i))
    expect(opening).not.toContainEqual(expect.stringMatching(/supported setup.*Mixed Blocker/i))
    expect(finishers).toMatch(/Mixed Rush Boss.*Rush pressure/i)
    expect(finishers).not.toMatch(/Mixed Rush Boss.*draw support/i)
    expect(guide.sideboardSuggestions[0]).toMatchObject({
      cardNumber: 'OP16-022',
      addressesInsightIds: ['interaction'],
    })
  })
})

describe('generatePlayGuide defense and closing guidance', () => {
  it('uses high-counter guidance when the deck clears the profile strength threshold', () => {
    const guide = guideFor({
      deckAnalysis: analysis({
        totalCounter: PROFILE.analysis.totalCounter.strengthMinimum,
        roleCoverage: coverage({ twoKCounter: PROFILE.targets.twoKCounter }),
      }),
    })

    expect(guide.counterPlan.points.join(' ')).toMatch(/defend efficiently/i)
    expect(guide.counterPlan.points.join(' ')).not.toMatch(/preserve.*2K.*aggressively/i)
  })

  it('warns on low counter, scarce 2Ks, and excessive bricks', () => {
    const guide = guideFor({
      deckAnalysis: analysis({
        totalCounter: PROFILE.analysis.totalCounter.neutralMinimum - 1000,
        roleCoverage: coverage({
          twoKCounter: PROFILE.targets.twoKCounter - 1,
          brick: PROFILE.limits.brickTolerance + 1,
        }),
      }),
    })

    const points = guide.counterPlan.points.join(' ')
    expect(points).toMatch(/low|below/i)
    expect(points).toMatch(/preserve.*2K.*aggressively/i)
    expect(points).toMatch(/9 zero-counter|brick/i)
  })

  it('falls back to a tempo-oriented closing plan when finishers are thin', () => {
    const guide = guideFor({
      deckAnalysis: analysis({
        roleCoverage: coverage({ boss: PROFILE.targets.boss - 1 }),
        weaknesses: [insight('bosses', 'Bosses')],
      }),
    })

    expect(guide.finishers.points.join(' ')).toMatch(/closing power.*thin/i)
    expect(guide.finishers.points.join(' ')).toMatch(/tempo/i)
  })

  it('sequences Rainbow-usable removal before attacks and avoids excessive hand commitment', () => {
    const removal = line(
      card('OP16-088', {
        name: 'Clean Sweep',
        cardType: 'EVENT',
        effect:
          '[Main] K.O. up to 1 of your opponent\'s Characters with a cost of 4 or less.',
      }),
    )

    const points = guideFor({
      mainDeck: [removal],
      deckAnalysis: analysis({
        roleCoverage: coverage({ removal: 1, interaction: 1 }),
      }),
    }).attackSequencing.points.join(' ')

    expect(points).toMatch(/removal before attacks/i)
    expect(points).toMatch(/hand.*lethal|lethal.*hand/i)
  })
})

describe('generatePlayGuide Sideboard suggestions', () => {
  it('ranks weakness-addressing cards before marginal score and card number without mutating the Sideboard', () => {
    const blockerA = line(
      card('OP16-088', { name: 'Guard A', effect: '[Blocker]' }),
      1,
      8,
    )
    const blockerB = line(
      card('OP16-089', { name: 'Guard B', effect: '[Blocker]' }),
      2,
      8,
    )
    const unrelated = line(card('OP16-001', { name: 'Big Score' }), 1, 99)
    const sideboard = [unrelated, blockerB, blockerA]
    const originalOrder = sideboard.map(({ card: sideboardCard }) =>
      sideboardCard.cardNumber,
    )

    const guide = guideFor({
      sideboard,
      deckAnalysis: analysis({
        roleCoverage: coverage({ blocker: 0 }),
        weaknesses: [insight('blockers', 'Blockers')],
      }),
    })

    expect(guide.sideboardSuggestions[0]).toMatchObject({
      cardNumber: 'OP16-088',
      quantity: 1,
      addressesInsightIds: ['blockers'],
    })
    expect(guide.sideboardSuggestions[1]).toMatchObject({
      cardNumber: 'OP16-089',
      quantity: 2,
      addressesInsightIds: ['blockers'],
    })
    expect(guide.sideboardSuggestions).toHaveLength(2)
    expect(
      sideboard.map(({ card: sideboardCard }) => sideboardCard.cardNumber),
    ).toEqual(originalOrder)
  })

  it('uses score only after the number of addressed weaknesses', () => {
    const multiRole = line(
      card('OP16-090', {
        name: 'Guard Removal',
        effect:
          '[Blocker] [On Play] K.O. up to 1 of your opponent\'s Characters with a cost of 2 or less.',
      }),
      1,
      1,
    )
    const higherScore = line(
      card('OP16-091', { name: 'Removal', effect: '[On Play] Draw 1 card.' }),
      1,
      20,
    )

    const guide = guideFor({
      sideboard: [higherScore, multiRole],
      deckAnalysis: analysis({
        weaknesses: [
          insight('blockers', 'Blockers'),
          insight('interaction', 'Interaction'),
        ],
      }),
    })

    expect(guide.sideboardSuggestions.map(({ cardNumber }) => cardNumber)).toEqual([
      'OP16-090',
      'OP16-091',
    ])
    expect(guide.sideboardSuggestions[0]?.addressesInsightIds).toEqual([
      'blockers',
      'interaction',
    ])
  })

  it('does not claim or recommend unsupported conditional finisher and Sideboard effects', () => {
    const unsupportedBoss = line(
      card('OP16-099', {
        name: 'Conditional Boss',
        cost: 8,
        power: 9000,
        counter: 0,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )
    const unsupportedRemoval = line(
      card('OP16-088', {
        name: 'Conditional Removal',
        cardType: 'EVENT',
        effect:
          '[Main] If you have a Character named [Missing Ally], K.O. up to 1 of your opponent\'s Characters with a cost of 4 or less.',
      }),
      1,
      20,
    )

    const guide = guideFor({
      mainDeck: [unsupportedBoss],
      sideboard: [unsupportedRemoval],
      deckAnalysis: analysis({
        roleCoverage: coverage({ boss: 1 }),
        weaknesses: [insight('interaction', 'Interaction')],
      }),
    })

    expect(guide.finishers.points.join(' ')).toContain('Conditional Boss')
    expect(guide.finishers.points.join(' ')).not.toMatch(/draw support/i)
    expect(guide.sideboardSuggestions).toEqual([])
  })

  it.each([
    [
      'suffix condition',
      '[Main] Draw 1 card if you have a Character named [Missing Ally].',
    ],
    [
      'Then continuation',
      '[Main] If you have a Character named [Missing Ally], return 1 DON!! card to your DON!! deck. Then, draw 1 card.',
    ],
  ])('does not promote unsupported draw from a %s', (_label, effect) => {
    const conditionalDraw = line(
      card('OP16-085', {
        name: 'Conditional Draw Form',
        cardType: 'EVENT',
        cost: 2,
        effect,
      }),
      1,
      20,
    )

    const guide = guideFor({
      sideboard: [conditionalDraw],
      deckAnalysis: analysis({
        weaknesses: [insight('interaction', 'Interaction')],
      }),
    })

    expect(guide.sideboardSuggestions).toEqual([])
  })

  it('gates effect-derived Blocker and boss suggestions while retaining a genuine large boss body', () => {
    const conditionalBlocker = line(
      card('OP16-086', {
        name: 'Conditional Blocker',
        effect:
          'If you have a Character named [Missing Ally], this Character gains [Blocker].',
      }),
      1,
      30,
    )
    const effectDerivedBoss = line(
      card('OP16-087', {
        name: 'Conditional Effect Boss',
        cost: 7,
        power: 7000,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
      1,
      20,
    )
    const printedBoss = line(
      card('OP16-088', {
        name: 'Large Printed Boss',
        cost: 7,
        power: 8000,
        effect:
          '[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
      1,
      10,
    )

    const guide = guideFor({
      sideboard: [conditionalBlocker, effectDerivedBoss, printedBoss],
      deckAnalysis: analysis({
        weaknesses: [
          insight('blockers', 'Blockers'),
          insight('bosses', 'Bosses'),
        ],
      }),
    })

    expect(guide.sideboardSuggestions).toEqual([
      expect.objectContaining({
        cardNumber: 'OP16-088',
        addressesInsightIds: ['bosses'],
      }),
    ])
  })

  it('uses any positive printed counter for a total-counter weakness and retains score ordering', () => {
    const oneK = line(
      card('OP16-092', { name: 'One K Counter', counter: 1000 }),
      1,
      12,
    )
    const twoK = line(
      card('OP16-093', { name: 'Two K Counter', counter: 2000 }),
      1,
      8,
    )
    const zeroCounter = line(
      card('OP16-094', { name: 'Zero Counter', counter: 0 }),
      1,
      99,
    )

    const guide = guideFor({
      sideboard: [zeroCounter, twoK, oneK],
      deckAnalysis: analysis({
        weaknesses: [insight('total-counter', 'Counter total')],
      }),
    })

    expect(guide.sideboardSuggestions.map(({ cardNumber }) => cardNumber)).toEqual([
      'OP16-092',
      'OP16-093',
    ])
    expect(guide.sideboardSuggestions.every(({ addressesInsightIds }) =>
      addressesInsightIds.includes('total-counter'),
    )).toBe(true)
  })
})

describe('generatePlayGuide output contract', () => {
  it('is deterministic, deeply frozen, qualified, and makes no win-rate or percentage claims', () => {
    const mainDeck = [
      line(card('OP16-001', { name: 'Body', cost: 2 })),
      line(
        card('OP16-099', {
          name: 'Boss',
          cost: 8,
          power: 9000,
          counter: 0,
        }),
      ),
    ]
    const input = {
      mainDeck,
      deckAnalysis: analysis({ roleCoverage: coverage({ boss: 1 }) }),
    }

    const first = guideFor(input)
    const second = guideFor(input)
    const strings = allGuideStrings(first)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expectDeeplyFrozen(first)
    expect(strings.some((text) => /\b(prefer|consider|may)\b/i.test(text))).toBe(
      true,
    )
    expect(strings.join(' ')).not.toMatch(/\bwin rate\b|\d+(?:\.\d+)?%/i)
  })

  it('returns neutral evidence-limited sentences for an empty input', () => {
    const guide = guideFor()

    expect(guide.openingPriorities.points.join(' ')).toMatch(/no specific|flexible/i)
    expect(guide.finishers.points.join(' ')).toMatch(/no selected boss|tempo/i)
    expect(guide.sideboardSuggestions).toEqual([])
  })
})
