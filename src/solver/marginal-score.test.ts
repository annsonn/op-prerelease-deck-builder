import { describe, expect, it } from 'vitest'

import {
  classifyCardFeatures,
  supportRequirementFlagKeys,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'
import {
  getStrategyProfile,
  mergeStrategyProfile,
} from '../strategy/strategy-profile.js'

import {
  addCandidateToDeckState,
  buildPoolSupport,
  createEmptyDeckState,
  type CandidateCard,
  type DeckState,
} from './deck-state.js'
import {
  marginalScoreComponentLabels,
  marginalScoreComponentOrder,
  scoreCandidateAgainstCompletedDeck,
  scoreMarginalCandidate,
} from './marginal-score.js'

const EMPTY_POOL = buildPoolSupport([])
const PROFILE = getStrategyProfile('OP16')

function candidate(
  cardNumber: string,
  cardOverrides: Partial<PlayableCard> = {},
  enabledFlags: readonly (keyof CardFeatures['flags'])[] = [],
  featureOverrides: Partial<Omit<CardFeatures, 'flags'>> = {},
): CandidateCard {
  const flags: Record<keyof CardFeatures['flags'], boolean> = {
    twoKCounter: false,
    blocker: false,
    vanillaLike: false,
    draw: false,
    removal: false,
    boss: false,
    rush: false,
    banish: false,
    twoForOne: false,
    massRest: false,
    donRefresh: false,
    searcher: false,
    comboDependent: false,
    brick: false,
  }
  for (const flag of enabledFlags) flags[flag] = true

  return {
    card: {
      cardNumber,
      name: `${cardNumber} Test Card`,
      rarity: 'C',
      cardType: 'CHARACTER',
      colors: ['Red'],
      cost: 3,
      life: null,
      power: 0,
      counter: 0,
      attribute: 'Strike',
      traits: ['Test Crew'],
      effect: '',
      trigger: '',
      setMembership: ['OP16'],
      variantsCollapsed: 1,
      entryShortcut: cardNumber.slice(-3),
      isSpecialReprint: false,
      ...cardOverrides,
    },
    features: {
      effectModelVersion: 2,
      effectParserRevision: 2,
      effects: [],
      unparsedClauses: [],
      flags,
      rainbowUsableFlags: { ...flags },
      supportRequirementsByFlag: Object.fromEntries(
        supportRequirementFlagKeys.map((flag) => [flag, null]),
      ) as CardFeatures['supportRequirementsByFlag'],
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
      ...featureOverrides,
    },
  }
}

function addCopies(
  state: DeckState,
  value: CandidateCard,
  quantity: number,
): DeckState {
  let next = state
  for (let index = 0; index < quantity; index += 1) {
    next = addCandidateToDeckState(next, value)
  }
  return next
}

function classifiedCandidate(
  cardNumber: string,
  cardOverrides: Partial<PlayableCard>,
): CandidateCard {
  const card = candidate(cardNumber, {
    setMembership: ['OP17'],
    ...cardOverrides,
  }).card
  return { card, features: classifyCardFeatures(card) }
}

describe('marginal soft-target scoring', () => {
  it.each([
    ['blocker', 'targetBlocker'],
    ['vanillaLike', 'targetVanillaLike'],
  ] as const)(
    'diminishes the %s target to a near-target floor and removes it at target',
    (role, component) => {
      const roleCard = candidate('OP16-001', {}, [role])
      const target = PROFILE.targets[role]
      const emptyScore = scoreMarginalCandidate(
        roleCard,
        createEmptyDeckState(),
        EMPTY_POOL,
        PROFILE,
      )
      const oneBelowScore = scoreMarginalCandidate(
        roleCard,
        addCopies(createEmptyDeckState(), roleCard, target - 1),
        EMPTY_POOL,
        PROFILE,
      )
      const atTargetScore = scoreMarginalCandidate(
        roleCard,
        addCopies(createEmptyDeckState(), roleCard, target),
        EMPTY_POOL,
        PROFILE,
      )

      expect(emptyScore.components[component]).toBe(
        PROFILE.weights.softTargets[role],
      )
      expect(oneBelowScore.components[component]).toBe(
        PROFILE.weights.softTargets[role] *
          (PROFILE.weights.softTargetFloorPercent[role] / 100),
      )
      expect(emptyScore.components[component]).toBeGreaterThan(
        oneBelowScore.components[component] ?? 0,
      )
      expect(atTargetScore.components[component]).toBeUndefined()
    },
  )

  it('credits every applicable target on one multi-role card', () => {
    const structured = classifiedCandidate('OP16-002', {
      effect:
        '[On Play] Draw 1 card. Then, K.O. up to 1 of your opponent\'s Characters.',
    })
    const score = scoreMarginalCandidate(
      candidate(
        'OP16-002',
        { counter: 2000 },
        ['twoKCounter', 'blocker', 'vanillaLike', 'draw', 'removal', 'boss'],
        { effects: structured.features.effects },
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components).toMatchObject({
      targetTwoKCounter: PROFILE.weights.softTargets.twoKCounter,
      targetBlocker: PROFILE.weights.softTargets.blocker,
      targetVanillaLike: PROFILE.weights.softTargets.vanillaLike,
      targetInteraction: PROFILE.weights.softTargets.interaction,
      targetBoss: PROFILE.weights.softTargets.boss,
    })
    expect(
      Object.keys(score.components).filter((name) => name === 'targetInteraction'),
    ).toHaveLength(1)
  })

  it('does not let a selected raw-only interaction saturate usable coverage', () => {
    const rawOnlyRemoval = candidate('OP16-038', {}, ['removal'], {
      rainbowUsableFlags: {
        ...candidate('OP16-096').features.rainbowUsableFlags,
      },
      rainbowLuffyCompatibility: 'incompatible',
    })
    const usableDraw = classifiedCandidate('OP16-039', {
      effect: '[On Play] Draw 1 card.',
    })
    const score = scoreMarginalCandidate(
      usableDraw,
      addCandidateToDeckState(createEmptyDeckState(), rawOnlyRemoval),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.targetInteraction).toBe(
      PROFILE.weights.softTargets.interaction,
    )
  })

  it('credits a positive structured lockdown exactly once', () => {
    const lockdown = classifiedCandidate('OP17-005', {
      effect:
        '[On Play] Up to 2 of your opponent\'s Characters cannot attack until the end of your opponent\'s next End Phase.',
    })
    const score = scoreMarginalCandidate(
      lockdown,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.targetInteraction).toBe(
      PROFILE.weights.softTargets.interaction,
    )
    expect(
      Object.keys(score.components).filter(
        (component) => component === 'targetInteraction',
      ),
    ).toHaveLength(1)
  })

  it.each([
    {
      label: 'opponent draw',
      overrides: { effect: '[On Play] Your opponent draws 2 cards.' },
    },
    {
      label: 'Trigger-only removal',
      overrides: {
        trigger:
          '[Trigger] K.O. up to 1 of your opponent\'s Characters with a cost of 4 or less.',
      },
    },
    {
      label: 'Rainbow-incompatible removal',
      overrides: {
        effect:
          '[On Play] If your Leader is [Restricted Leader], K.O. up to 1 of your opponent\'s Characters.',
      },
    },
    {
      label: 'dynamic-condition removal',
      overrides: {
        effect:
          '[On Play] If your opponent has 3 or more Characters, K.O. up to 1 of your opponent\'s Characters.',
      },
    },
  ])('does not grant interaction target credit for $label', ({ overrides }) => {
    const score = scoreMarginalCandidate(
      classifiedCandidate('OP17-006', overrides),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.targetInteraction).toBeUndefined()
  })
})

describe('standalone printed value', () => {
  it('reduces printed-counter priority after the defensive strength threshold', () => {
    const twoK = candidate(
      'OP16-041',
      { counter: 2000 },
      ['twoKCounter'],
    )
    const oneK = candidate('OP16-042', { counter: 1000 })
    const saturatedDefense = addCopies(createEmptyDeckState(), twoK, 26)

    expect(
      scoreMarginalCandidate(
        oneK,
        createEmptyDeckState(),
        EMPTY_POOL,
        PROFILE,
      ).components.standaloneCounter,
    ).toBe(PROFILE.weights.standalone.counterValue)
    expect(saturatedDefense.totalCounter).toBeGreaterThanOrEqual(
      PROFILE.analysis.totalCounter.scoringSaturationMinimum,
    )
    expect(
      scoreMarginalCandidate(
        oneK,
        saturatedDefense,
        EMPTY_POOL,
        PROFILE,
      ).components.standaloneCounter,
    ).toBe(PROFILE.weights.standalone.saturatedCounterValue)
  })

  it('lets an efficient card beat a weak unmet-quota filler', () => {
    const efficient = scoreMarginalCandidate(
      candidate('OP16-003', { power: 6000, counter: 1000 }),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )
    const weakFiller = scoreMarginalCandidate(
      candidate('OP16-004', { power: 1000 }, ['blocker']),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(efficient.components.standalonePower).toBe(
      3 * PROFILE.weights.standalone.cardPower,
    )
    expect(efficient.components.standaloneCounter).toBe(
      PROFILE.weights.standalone.counterValue,
    )
    expect(weakFiller.components.standalonePower).toBe(
      -2 * PROFILE.weights.standalone.cardPower,
    )
    expect(efficient.total).toBeGreaterThan(weakFiller.total)
  })

  it('prefers a needed efficient early body after the boss and high end saturate', () => {
    const selectedBoss = candidate(
      'OP16-027',
      { cost: 8, power: 9000 },
      ['boss'],
    )
    const saturated = addCopies(
      createEmptyDeckState(),
      selectedBoss,
      PROFILE.curve.highCost.maximum,
    )
    const efficientEarly = scoreMarginalCandidate(
      candidate('OP16-028', { cost: 2, power: 5000 }),
      saturated,
      EMPTY_POOL,
      PROFILE,
    )
    const anotherBoss = scoreMarginalCandidate(
      candidate('OP16-029', { cost: 8, power: 9000 }, ['boss']),
      saturated,
      EMPTY_POOL,
      PROFILE,
    )

    expect(efficientEarly.total).toBeGreaterThan(anotherBoss.total)
    expect(anotherBoss.components.highCostPenalty).toBeUndefined()
  })
})

describe('progressive brick scoring', () => {
  it('starts after tolerance and uses each exact progressive boundary', () => {
    const profile = mergeStrategyProfile(PROFILE, {
      limits: { brickTolerance: 2 },
    })
    const brick = candidate('OP16-005', {}, ['brick'])
    const scoreAtExistingCount = (count: number) =>
      scoreMarginalCandidate(
        brick,
        addCopies(createEmptyDeckState(), brick, count),
        EMPTY_POOL,
        profile,
      ).components.brickPenalty

    expect(scoreAtExistingCount(1)).toBeUndefined()
    expect(scoreAtExistingCount(2)).toBe(
      -profile.weights.progressiveBricks.first,
    )
    expect(scoreAtExistingCount(3)).toBe(
      -profile.weights.progressiveBricks.second,
    )
    expect(scoreAtExistingCount(4)).toBe(
      -profile.weights.progressiveBricks.third,
    )
    expect(scoreAtExistingCount(5)).toBe(
      -profile.weights.progressiveBricks.fourthOrMore,
    )
    expect(scoreAtExistingCount(6)).toBe(
      -profile.weights.progressiveBricks.fourthOrMore,
    )
  })
})

describe('searcher support', () => {
  it('moves continuously from pool risk to selected-deck support', () => {
    const searcher = candidate(
      'OP16-006',
      {},
      ['searcher'],
      { searchableNames: ['Alpha'] },
    )
    const alpha = candidate('OP16-007', { name: 'Alpha' })
    const fiveTargetPool = buildPoolSupport([{ ...alpha, quantity: 5 }])
    const sixTargetPool = buildPoolSupport([{ ...alpha, quantity: 6 }])
    const scoreWithSelected = (quantity: number) =>
      scoreMarginalCandidate(
        searcher,
        addCopies(createEmptyDeckState(), alpha, quantity),
        sixTargetPool,
        PROFILE,
      ).components.searcherSupport

    expect(
      scoreMarginalCandidate(
        searcher,
        createEmptyDeckState(),
        fiveTargetPool,
        PROFILE,
      ).components.searcherSupport,
    ).toBe(-0.333333)
    expect(scoreWithSelected(0)).toBeUndefined()
    expect(scoreWithSelected(3)).toBe(1)
    expect(scoreWithSelected(6)).toBe(PROFILE.weights.synergy.searcher)
  })

  it('uses exact overlapping unions and excludes only the current physical copy', () => {
    const profile = mergeStrategyProfile(PROFILE, {
      limits: { searcherMinimumTargets: 5 },
    })
    const searcher = candidate(
      'OP16-006',
      {},
      ['searcher'],
      { searchableNames: ['Alpha'], searchableTraits: ['Navy'] },
    )
    const overlapping = candidate('OP16-007', {
      name: 'Alpha',
      traits: ['Navy'],
    })
    const disjoint = candidate('OP16-008', {
      name: 'Beta',
      traits: ['Navy'],
    })
    const supportedPool = buildPoolSupport([
      { ...overlapping, quantity: 2 },
      { ...disjoint, quantity: 3 },
    ])
    const selected = addCopies(
      addCopies(createEmptyDeckState(), overlapping, 2),
      disjoint,
      3,
    )

    expect(
      scoreMarginalCandidate(
        searcher,
        selected,
        supportedPool,
        profile,
      ).components.searcherSupport,
    ).toBe(profile.weights.synergy.searcher)

    const selfSearcher = candidate(
      'OP16-030',
      { name: 'Alpha' },
      ['searcher'],
      { searchableNames: ['Alpha'] },
    )
    const selfProfile = mergeStrategyProfile(PROFILE, {
      limits: { searcherMinimumTargets: 1 },
    })
    const selfPool = buildPoolSupport([{ ...selfSearcher, quantity: 1 }])
    expect(
      scoreMarginalCandidate(
        selfSearcher,
        createEmptyDeckState(),
        selfPool,
        selfProfile,
      ).components.searcherSupport,
    ).toBe(-selfProfile.weights.synergy.searcher)

    const twoCopyPool = buildPoolSupport([{ ...selfSearcher, quantity: 2 }])
    expect(
      scoreMarginalCandidate(
        selfSearcher,
        addCandidateToDeckState(createEmptyDeckState(), selfSearcher),
        twoCopyPool,
        selfProfile,
      ).components.searcherSupport,
    ).toBe(selfProfile.weights.synergy.searcher)
  })
})

describe('legacy combo support', () => {
  it('does not add a whole-card combo component for canonical structured features', () => {
    const combo = candidate(
      'OP16-009',
      {},
      ['comboDependent'],
      { requiredNames: ['Alpha'], requiredTraits: ['Navy'] },
    )
    const overlapping = candidate('OP16-011', {
      name: 'Alpha',
      traits: ['Navy'],
    })
    const supportedPool = buildPoolSupport([{ ...overlapping, quantity: 4 }])
    const unsupportedPool = buildPoolSupport([{ ...overlapping, quantity: 2 }])

    for (const [state, pool] of [
      [createEmptyDeckState(), supportedPool],
      [createEmptyDeckState(), unsupportedPool],
      [addCopies(createEmptyDeckState(), overlapping, 4), supportedPool],
    ] as const) {
      expect(scoreMarginalCandidate(
        combo,
        state,
        pool,
        PROFILE,
      ).components.comboSupport).toBeUndefined()
    }
  })
})

describe('structured effect quality', () => {
  it('scores Character body efficiency and an On Play draw exactly once', () => {
    const score = scoreMarginalCandidate(
      classifiedCandidate('OP17-001', {
        cost: 3,
        power: 5_000,
        effect: '[On Play] Draw 1 card.',
      }),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components).toMatchObject({
      standalonePower: 4,
      effectQuality: 2,
    })
    expect(score.reasonsByComponent.effectQuality).toContain('effect effect:0')
  })

  it('gives Events zero body value and values their best physical-card mode', () => {
    const value = classifiedCandidate('OP17-002', {
      cardType: 'EVENT',
      cost: 3,
      power: null,
      effect:
        '[Main] Draw 2 cards.<br/>[Counter] Up to 1 of your Leader gains +4000 power during this battle.',
      trigger: '[Trigger] Draw 1 card.',
    })
    const score = scoreMarginalCandidate(
      value,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.standalonePower).toBeUndefined()
    expect(score.components.effectQuality).toBe(3.25)
    expect(score.reasonsByComponent.effectQuality).toContain('effect effect:1')
    expect(score.reasonsByComponent.effectQuality).not.toContain('trigger:0')
    expect(score.reasonsByComponent.effectQuality).not.toContain('effect:0')
  })

  it('retains adverse opponent-choice value instead of granting a broad bonus', () => {
    const score = scoreMarginalCandidate(
      classifiedCandidate('OP17-049', {
        effect:
          '[On Play] Your opponent chooses one:<br/>• Draw 2 cards.<br/>• Your opponent trashes 2 cards from their hand.',
      }),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBe(-4)
  })

  it('values Gloriosa bottom-deck removal through the structured action', () => {
    const score = scoreMarginalCandidate(
      classifiedCandidate('OP17-046', {
        name: 'Gloriosa',
        cost: 4,
        power: 1_000,
        effect:
          '[Blocker]<br/>[On Play] Place up to 1 Character with a cost of 5 or less at the bottom of the owner\'s deck.',
      }),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBe(4.85)
    expect(score.reasonsByComponent.effectQuality).toContain('effect effect:1')
  })

  it('does not apply whole-card compatibility or generic combo penalties', () => {
    const score = scoreMarginalCandidate(
      classifiedCandidate('OP17-003', {
        effect:
          '[On Play] If your Leader is [Restricted Leader], draw 1 card.<br/>[On Play] If your opponent has 3 or more Characters, draw 1 card.',
      }),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.compatibilityEffect).toBeUndefined()
    expect(score.components.comboSupport).toBeUndefined()
  })

  it('does not fall back to legacy broad flags when structured effects are absent', () => {
    const score = scoreMarginalCandidate(
      candidate('OP17-004', {}, ['draw', 'removal', 'rush']),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBeUndefined()
  })

  it('does not count or floor raw-only incompatible premium-effect flags', () => {
    const emptyUsable = candidate('OP17-098').features.rainbowUsableFlags
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-023',
        {},
        ['blocker', 'draw', 'removal', 'boss', 'rush', 'banish', 'twoForOne', 'massRest', 'donRefresh'],
        {
          rainbowUsableFlags: { ...emptyUsable },
          rainbowLuffyCompatibility: 'incompatible',
        },
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBeUndefined()
    expect(score.components.premiumBombFloor).toBeUndefined()
  })

})

describe('curve scoring', () => {
  it('rewards an unmet band, saturates exact counts, and never blanket-penalizes bosses', () => {
    const middle = candidate('OP16-015', { cost: 3 })
    const state = addCopies(
      createEmptyDeckState(),
      middle,
      PROFILE.curve.middle.target,
    )
    const neededEarly = scoreMarginalCandidate(
      candidate('OP16-016', { cost: 2 }),
      state,
      EMPTY_POOL,
      PROFILE,
    )
    const saturatedMiddle = scoreMarginalCandidate(
      candidate('OP16-017', { cost: 3 }),
      state,
      EMPTY_POOL,
      PROFILE,
    )
    const boss = candidate(
      'OP16-018',
      { cost: 8, power: 9000 },
      ['boss'],
    )
    const neededBoss = scoreMarginalCandidate(
      boss,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )
    const highSaturated = scoreMarginalCandidate(
      boss,
      addCopies(
        createEmptyDeckState(),
        boss,
        PROFILE.curve.highCost.maximum,
      ),
      EMPTY_POOL,
      PROFILE,
    )

    expect(neededEarly.components.curveEarly).toBeGreaterThan(0)
    expect(saturatedMiddle.components.curveMiddle).toBeUndefined()
    expect(neededEarly.total).toBeGreaterThan(saturatedMiddle.total)
    expect(neededBoss.components.targetBoss).toBeGreaterThan(0)
    expect(neededBoss.components.curveLate).toBeGreaterThan(0)
    expect(neededBoss.components.curveHighCost).toBeGreaterThan(0)
    expect(neededBoss.components.highCostPenalty).toBeUndefined()
    expect(highSaturated.components.curveHighCostSaturation).toBe(
      -PROFILE.weights.redundancy.effect,
    )
  })
})

describe('redundancy scoring', () => {
  it('grows redundancy for positive selected actions but not effectless duplicates', () => {
    const duplicate = classifiedCandidate('OP16-019', {
      effect:
        '[On Play] K.O. up to 1 of your opponent\'s Characters with a cost of 4 or less.',
    })
    const firstDuplicate = scoreMarginalCandidate(
      duplicate,
      addCandidateToDeckState(createEmptyDeckState(), duplicate),
      EMPTY_POOL,
      PROFILE,
    )
    const secondDuplicate = scoreMarginalCandidate(
      duplicate,
      addCopies(createEmptyDeckState(), duplicate, 2),
      EMPTY_POOL,
      PROFILE,
    )
    const vanilla = candidate('OP16-032', {}, ['vanillaLike'])
    const twoK = candidate('OP16-033', { counter: 2000 }, ['twoKCounter'])

    expect(firstDuplicate.components.redundancyEffect).toBe(
      -PROFILE.weights.redundancy.effect,
    )
    expect(secondDuplicate.components.redundancyEffect).toBe(
      -2 * PROFILE.weights.redundancy.effect,
    )
    expect(
      scoreMarginalCandidate(
        vanilla,
        addCandidateToDeckState(createEmptyDeckState(), vanilla),
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyEffect,
    ).toBeUndefined()
    expect(
      scoreMarginalCandidate(
        twoK,
        addCandidateToDeckState(createEmptyDeckState(), twoK),
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyEffect,
    ).toBeUndefined()
  })

  it('ignores adverse actions and positive actions in a discarded Event mode', () => {
    const opponentDraw = classifiedCandidate('OP17-030', {
      effect: '[On Play] Your opponent draws 2 cards.',
    })
    const losingMainMode = classifiedCandidate('OP17-031', {
      cardType: 'EVENT',
      cost: 1,
      power: null,
      effect: '[Main] Draw 2 cards. Then, your opponent draws 2 cards.',
      trigger: '[Trigger] Do nothing.',
    })

    for (const value of [opponentDraw, losingMainMode]) {
      const state = addCandidateToDeckState(createEmptyDeckState(), value)
      expect(
        scoreMarginalCandidate(value, state, EMPTY_POOL, PROFILE).components
          .redundancyEffect,
      ).toBeUndefined()
    }
  })

  it('keeps usable role saturation separately named', () => {
    const roleFiller = candidate('OP16-020', {}, ['blocker'])
    const saturatedRoleScore = scoreMarginalCandidate(
      roleFiller,
      addCopies(
        createEmptyDeckState(),
        candidate('OP16-021', {}, ['blocker']),
        PROFILE.targets.blocker,
      ),
      EMPTY_POOL,
      PROFILE,
    )
    const unusableBlocker = candidate('OP16-034', {}, ['blocker'], {
      rainbowUsableFlags: {
        ...candidate('OP16-097').features.rainbowUsableFlags,
      },
    })

    expect(saturatedRoleScore.components.redundancyRole).toBe(
      -PROFILE.weights.redundancy.role,
    )
    expect(
      scoreMarginalCandidate(
        unusableBlocker,
        addCopies(
          createEmptyDeckState(),
          candidate('OP16-035', {}, ['blocker']),
          PROFILE.targets.blocker,
        ),
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyRole,
    ).toBeUndefined()
  })

  it('does not penalize a multi-role card while any of its target roles is short', () => {
    const twoKBlocker = candidate(
      'OP16-036',
      { counter: 2000 },
      ['twoKCounter', 'blocker'],
    )
    const onlyTwoKSaturated = addCopies(
      createEmptyDeckState(),
      candidate('OP16-037', { counter: 2000 }, ['twoKCounter']),
      PROFILE.targets.twoKCounter,
    )
    const bothSaturated = addCopies(
      onlyTwoKSaturated,
      candidate('OP16-038', {}, ['blocker']),
      PROFILE.targets.blocker,
    )

    expect(
      scoreMarginalCandidate(
        twoKBlocker,
        onlyTwoKSaturated,
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyRole,
    ).toBeUndefined()
    expect(
      scoreMarginalCandidate(
        twoKBlocker,
        bothSaturated,
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyRole,
    ).toBe(-PROFILE.weights.redundancy.role)
  })
})

describe('premium bomb first-copy floor', () => {
  const premiumBomb = classifiedCandidate('OP17-022', {
    name: 'Shanks',
    cost: 10,
    power: 12_000,
    counter: 0,
    effect:
      '[Rush]<br/>[On Play] Set up to 2 of your DON!! cards as active. Then, rest all of your opponent\'s Characters.',
  })
  const saturatedRoleCard = candidate(
    'OP17-099',
    { cost: 10, power: 10_000 },
    ['boss', 'removal'],
  )
  const saturatedBrick = candidate(
    'OP17-098',
    { cost: 10, power: 10_000 },
    ['boss', 'removal', 'brick'],
  )
  const saturatedState = addCopies(
    addCopies(
      createEmptyDeckState(),
      saturatedBrick,
      PROFILE.limits.brickTolerance,
    ),
    saturatedRoleCard,
    PROFILE.curve.late.maximum - PROFILE.limits.brickTolerance,
  )

  it('raises an otherwise saturated first copy after applying its brick penalty', () => {
    expect(saturatedState.brickCount).toBe(PROFILE.limits.brickTolerance)

    const score = scoreMarginalCandidate(
      premiumBomb,
      saturatedState,
      EMPTY_POOL,
      PROFILE,
    )
    const ordinarySubtotal = Object.entries(score.components).reduce(
      (sum, [component, value]) =>
        component === 'premiumBombFloor' ? sum : sum + value,
      0,
    )

    expect(score.components.brickPenalty).toBe(
      -PROFILE.weights.progressiveBricks.first,
    )
    expect(ordinarySubtotal).toBe(11.55)
    expect(score.components.premiumBombFloor).toBe(3.45)
    expect(score.reasonsByComponent.premiumBombFloor).toBe(
      'First-copy premium bomb floor: 3.45',
    )
    expect(score.total).toBe(PROFILE.limits.premiumBombFirstCopyFloor)
  })

  const saturatedStateWithoutBricks = addCopies(
    createEmptyDeckState(),
    saturatedRoleCard,
    PROFILE.curve.late.maximum,
  )

  it('raises a saturated first copy after structured effect value', () => {
    const score = scoreMarginalCandidate(
      premiumBomb,
      saturatedStateWithoutBricks,
      EMPTY_POOL,
      PROFILE,
    )
    const ordinarySubtotal = Object.entries(score.components).reduce(
      (sum, [component, value]) =>
        component === 'premiumBombFloor' ? sum : sum + value,
      0,
    )

    expect(ordinarySubtotal).toBe(12.55)
    expect(score.components.premiumBombFloor).toBe(2.45)
    expect(score.reasonsByComponent.premiumBombFloor).toBe(
      'First-copy premium bomb floor: 2.45',
    )
    expect(score.total).toBe(PROFILE.limits.premiumBombFirstCopyFloor)
  })

  it('omits the floor when ordinary first-copy scoring already exceeds it', () => {
    const score = scoreMarginalCandidate(
      premiumBomb,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.total).toBe(20.55)
    expect(score.components.premiumBombFloor).toBeUndefined()
  })

  it('does not floor a second copy and preserves duplicate-effect redundancy', () => {
    const score = scoreMarginalCandidate(
      premiumBomb,
      addCandidateToDeckState(saturatedStateWithoutBricks, premiumBomb),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.premiumBombFloor).toBeUndefined()
    expect(score.components.redundancyEffect).toBe(
      -PROFILE.weights.redundancy.effect,
    )
    expect(score.total).toBe(10.95)
  })

  it.each([
    ['boss', ['rush', 'removal', 'massRest', 'donRefresh']],
    ['rush', ['boss', 'removal', 'massRest', 'donRefresh']],
    ['massRest', ['boss', 'rush', 'removal', 'donRefresh']],
    ['donRefresh', ['boss', 'rush', 'removal', 'massRest']],
  ] as const)('does not floor a CHARACTER missing usable %s', (_missing, flags) => {
    const score = scoreMarginalCandidate(
      candidate('OP17-024', { cost: 10, power: 12_000 }, flags),
      saturatedStateWithoutBricks,
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.total).toBeLessThan(PROFILE.limits.premiumBombFirstCopyFloor)
    expect(score.components.premiumBombFloor).toBeUndefined()
  })

  it('does not floor a non-CHARACTER with every qualifying flag', () => {
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-025',
        { cardType: 'EVENT', cost: 10, power: null },
        ['boss', 'rush', 'removal', 'massRest', 'donRefresh'],
      ),
      saturatedStateWithoutBricks,
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.total).toBeLessThan(PROFILE.limits.premiumBombFirstCopyFloor)
    expect(score.components.premiumBombFloor).toBeUndefined()
  })

  it('keeps the premium floor last in the component and reason contract', () => {
    expect(marginalScoreComponentOrder.at(-1)).toBe('premiumBombFloor')
    expect(marginalScoreComponentLabels.effectQuality).toBe(
      'Structured effect value',
    )
    expect(marginalScoreComponentLabels.premiumBombFloor).toBe(
      'First-copy premium bomb floor',
    )

    const score = scoreMarginalCandidate(
      premiumBomb,
      saturatedStateWithoutBricks,
      EMPTY_POOL,
      PROFILE,
    )
    expect(Object.keys(score.components).at(-1)).toBe('premiumBombFloor')
    expect(score.reasons.at(-1)).toBe('First-copy premium bomb floor: 2.45')
  })
})

describe('score result contract', () => {
  it('scores sideboard candidates against a truthful completed 40-card state', () => {
    const filler = candidate('OP16-040')
    const fullState = addCopies(createEmptyDeckState(), filler, 40)

    expect(fullState.size).toBe(40)
    expect(
      scoreCandidateAgainstCompletedDeck(
        filler,
        fullState,
        EMPTY_POOL,
        PROFILE,
      ).total,
    ).toBeTypeOf('number')
    expect(fullState.size).toBe(40)
    expect(() =>
      scoreCandidateAgainstCompletedDeck(
        filler,
        createEmptyDeckState(),
        EMPTY_POOL,
        PROFILE,
      ),
    ).toThrow('Completed-deck scoring requires exactly 40 cards.')
  })

  it('returns finite deeply frozen deterministic output in fixed component order', () => {
    const supportCard = candidate('OP16-022', { name: 'Alpha' })
    const pool = buildPoolSupport([{ ...supportCard, quantity: 6 }])
    const value = candidate(
      'OP16-023',
      { cost: 8, power: 10_000, counter: 2000 },
      [
        'twoKCounter',
        'blocker',
        'vanillaLike',
        'draw',
        'boss',
        'searcher',
        'comboDependent',
      ],
      {
        searchableNames: ['Alpha'],
        requiredNames: ['Alpha'],
      },
    )

    const first = scoreMarginalCandidate(
      value,
      addCopies(createEmptyDeckState(), supportCard, 6),
      pool,
      PROFILE,
    )
    const second = scoreMarginalCandidate(
      value,
      addCopies(createEmptyDeckState(), supportCard, 6),
      pool,
      PROFILE,
    )

    expect(Object.keys(first.components)).toEqual([
      'standalonePower',
      'standaloneCounter',
      'targetTwoKCounter',
      'targetBlocker',
      'targetVanillaLike',
      'targetBoss',
      'curveLate',
      'curveHighCost',
      'searcherSupport',
    ])
    expect(first.reasons).toEqual([
      'Printed body efficiency value',
      'Printed counter value',
      `2K counter target: ${PROFILE.weights.softTargets.twoKCounter}`,
      `Blocker target: ${PROFILE.weights.softTargets.blocker}`,
      `Vanilla-like target: ${PROFILE.weights.softTargets.vanillaLike}`,
      `Boss target: ${PROFILE.weights.softTargets.boss}`,
      'Late curve need: 2',
      'High-cost curve need: 2',
      'Searcher support selected 6, pool potential 6: 2',
    ])
    expect(first.reasonsByComponent).toEqual(
      Object.fromEntries(
        Object.keys(first.components).map((component, index) => [
          component,
          first.reasons[index],
        ]),
      ),
    )
    expect(
      Object.keys(first.components).every((component, index, components) =>
        index === 0
          ? true
          : marginalScoreComponentOrder.indexOf(
              components[index - 1] as (typeof marginalScoreComponentOrder)[number],
            ) <
            marginalScoreComponentOrder.indexOf(
              component as (typeof marginalScoreComponentOrder)[number],
            ),
      ),
    ).toBe(true)
    expect(first).toEqual(second)
    expect(first.total).toBe(
      Object.values(first.components).reduce((sum, component) => sum + component),
    )
    expect(Number.isFinite(first.total)).toBe(true)
    expect(Object.values(first.components).every(Number.isFinite)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.components)).toBe(true)
    expect(Object.isFrozen(first.reasonsByComponent)).toBe(true)
    expect(Object.isFrozen(first.reasons)).toBe(true)
  })

  it('rejects full states and identifies non-finite components', () => {
    const filler = candidate('OP16-024')
    const fullState = addCopies(createEmptyDeckState(), filler, 40)

    expect(() =>
      scoreMarginalCandidate(filler, fullState, EMPTY_POOL, PROFILE),
    ).toThrow('Cannot score a marginal candidate for a full 40-card deck.')
    expect(() =>
      scoreMarginalCandidate(
        candidate('OP16-025', { power: Number.POSITIVE_INFINITY }),
        createEmptyDeckState(),
        EMPTY_POOL,
        PROFILE,
      ),
    ).toThrow(
      'Marginal score component "standalonePower" must be a finite number.',
    )
    const overflowingProfile = mergeStrategyProfile(PROFILE, {
      weights: {
        standalone: {
          cardPower: Number.MAX_VALUE,
          counterValue: Number.MAX_VALUE,
        },
      },
    })
    expect(() =>
      scoreMarginalCandidate(
        candidate('OP16-026', { cost: 0, power: 1000, counter: 1000 }),
        createEmptyDeckState(),
        EMPTY_POOL,
        overflowingProfile,
      ),
    ).toThrow('Marginal score total must be a finite number.')

    const largeFiniteProfile = mergeStrategyProfile(PROFILE, {
      weights: { standalone: { cardPower: 1e100 } },
    })
    const largeFinite = scoreMarginalCandidate(
      candidate('OP16-036', { cost: null, power: 1000 }),
      createEmptyDeckState(),
      EMPTY_POOL,
      largeFiniteProfile,
    )
    expect(largeFinite.components.standalonePower).toBe(1e100)
    expect(Number.isFinite(largeFinite.total)).toBe(true)

    const precisionProfile = mergeStrategyProfile(PROFILE, {
      weights: { standalone: { cardPower: 1 / 3 } },
    })
    expect(
      scoreMarginalCandidate(
        candidate('OP16-037', { cost: null, power: 1000 }),
        createEmptyDeckState(),
        EMPTY_POOL,
        precisionProfile,
      ).components.standalonePower,
    ).toBe(0.333333)
  })
})
