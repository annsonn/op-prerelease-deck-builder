import { describe, expect, it } from 'vitest'

import {
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
      effectParserRevision: 1,
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
    const score = scoreMarginalCandidate(
      candidate(
        'OP16-002',
        { counter: 2000 },
        ['twoKCounter', 'blocker', 'vanillaLike', 'draw', 'removal', 'boss'],
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
    const usableDraw = candidate('OP16-039', {}, ['draw'])
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

describe('combo support', () => {
  it('uses continuous selected and pool support while penalizing no-target combos', () => {
    const combo = candidate(
      'OP16-009',
      {},
      ['comboDependent'],
      { requiredNames: ['Alpha'], requiredTraits: ['Navy'] },
    )
    const noTargets = candidate('OP16-010', {}, ['comboDependent'])
    const overlapping = candidate('OP16-011', {
      name: 'Alpha',
      traits: ['Navy'],
    })
    const supportedPool = buildPoolSupport([{ ...overlapping, quantity: 4 }])
    const unsupportedPool = buildPoolSupport([{ ...overlapping, quantity: 2 }])

    expect(
      scoreMarginalCandidate(
        combo,
        createEmptyDeckState(),
        supportedPool,
        PROFILE,
      ).components.comboSupport,
    ).toBeUndefined()
    expect(
      scoreMarginalCandidate(
        combo,
        createEmptyDeckState(),
        unsupportedPool,
        PROFILE,
      ).components.comboSupport,
    ).toBe(-PROFILE.weights.synergy.combo / 2)
    expect(
      scoreMarginalCandidate(
        combo,
        addCopies(createEmptyDeckState(), overlapping, 2),
        supportedPool,
        PROFILE,
      ).components.comboSupport,
    ).toBe(PROFILE.weights.synergy.combo / 2)
    expect(
      scoreMarginalCandidate(
        combo,
        addCopies(createEmptyDeckState(), overlapping, 4),
        supportedPool,
        PROFILE,
      ).components.comboSupport,
    ).toBe(PROFILE.weights.synergy.combo)
    expect(
      scoreMarginalCandidate(
        noTargets,
        createEmptyDeckState(),
        supportedPool,
        PROFILE,
      ).components.comboSupport,
    ).toBe(-PROFILE.weights.synergy.combo)
  })
})

describe('Rainbow compatibility and effect quality', () => {
  it('adds every distinct Rainbow-usable broad effect', () => {
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-022',
        { cost: 10, power: 12_000 },
        ['boss', 'rush', 'removal', 'massRest', 'donRefresh'],
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBe(
      4 * PROFILE.weights.compatibility.effect,
    )
    expect(score.reasonsByComponent.effectQuality).toBe(
      'Broadly useful Rainbow-usable effects: 4 (4)',
    )
  })

  it('reports effect count before aggregate value when the effect weight is non-unit', () => {
    const weightedProfile = mergeStrategyProfile(PROFILE, {
      weights: { compatibility: { effect: 1.5 } },
    })
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-019',
        {},
        ['removal', 'rush', 'massRest', 'donRefresh'],
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      weightedProfile,
    )

    expect(score.components.effectQuality).toBe(6)
    expect(score.reasonsByComponent.effectQuality).toBe(
      'Broadly useful Rainbow-usable effects: 4 (6)',
    )
  })

  it('credits all eight Rainbow-usable broad-effect flags', () => {
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-021',
        {},
        ['blocker', 'draw', 'removal', 'rush', 'banish', 'twoForOne', 'massRest', 'donRefresh'],
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(PROFILE.weights.compatibility.effect).toBe(1)
    expect(score.components.effectQuality).toBe(8)
    expect(score.reasonsByComponent.effectQuality).toBe(
      'Broadly useful Rainbow-usable effects: 8 (8)',
    )
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

  it('counts only usable effects when raw mass-rest and DON-refresh flags remain', () => {
    const emptyUsable = candidate('OP17-097').features.rainbowUsableFlags
    const score = scoreMarginalCandidate(
      candidate(
        'OP17-020',
        {},
        ['removal', 'rush', 'massRest', 'donRefresh'],
        {
          rainbowUsableFlags: {
            ...emptyUsable,
            removal: true,
            rush: true,
          },
          rainbowLuffyCompatibility: 'incompatible',
        },
      ),
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.effectQuality).toBe(2)
    expect(score.reasonsByComponent.effectQuality).toBe(
      'Broadly useful Rainbow-usable effects: 2 (2)',
    )
  })

  it('keeps printed stats and usable Rush while removing restricted interaction', () => {
    const mixed = candidate(
      'OP16-014',
      { power: 5000, counter: 1000 },
      ['removal', 'rush'],
      {
        rainbowUsableFlags: {
          ...candidate('OP16-099').features.rainbowUsableFlags,
          rush: true,
        },
        rainbowLuffyCompatibility: 'incompatible',
      },
    )
    const score = scoreMarginalCandidate(
      mixed,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.standalonePower).toBe(
      2 * PROFILE.weights.standalone.cardPower,
    )
    expect(score.components.standaloneCounter).toBe(
      PROFILE.weights.standalone.counterValue,
    )
    expect(score.components.targetInteraction).toBeUndefined()
    expect(score.components.effectQuality).toBe(
      PROFILE.weights.compatibility.effect,
    )
    expect(score.components.compatibilityEffect).toBe(
      -PROFILE.weights.compatibility.effect,
    )
  })

  it('credits a usable Blocker without reviving unusable removal', () => {
    const emptyUsable = candidate('OP16-098').features.rainbowUsableFlags
    const mixedBlocker = candidate(
      'OP16-031',
      {},
      ['blocker', 'removal'],
      {
        rainbowUsableFlags: { ...emptyUsable, blocker: true },
        rainbowLuffyCompatibility: 'incompatible',
      },
    )
    const score = scoreMarginalCandidate(
      mixedBlocker,
      createEmptyDeckState(),
      EMPTY_POOL,
      PROFILE,
    )

    expect(score.components.targetBlocker).toBeGreaterThan(0)
    expect(score.components.targetInteraction).toBeUndefined()
    expect(score.components.effectQuality).toBe(
      PROFILE.weights.compatibility.effect,
    )

    const unusableConditional = candidate(
      'OP16-040',
      {},
      ['searcher', 'comboDependent'],
      {
        rainbowUsableFlags: { ...emptyUsable },
        rainbowLuffyCompatibility: 'neutral',
        searchableNames: ['Alpha'],
        requiredNames: ['Alpha'],
      },
    )
    const support = buildPoolSupport([
      { ...candidate('OP16-041', { name: 'Alpha' }), quantity: 6 },
    ])
    const unusableScore = scoreMarginalCandidate(
      unusableConditional,
      createEmptyDeckState(),
      support,
      PROFILE,
    )
    expect(unusableScore.components.searcherSupport).toBeUndefined()
    expect(unusableScore.components.comboSupport).toBeUndefined()
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
  it('grows effect redundancy but does not penalize Blockers or effectless duplicates', () => {
    const duplicate = candidate('OP16-019', {}, ['removal'])
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
    const blocker = candidate('OP16-036', {}, ['blocker'])

    expect(firstDuplicate.components.redundancyEffect).toBe(
      -PROFILE.weights.redundancy.effect,
    )
    expect(secondDuplicate.components.redundancyEffect).toBe(
      -2 * PROFILE.weights.redundancy.effect,
    )
    expect(
      scoreMarginalCandidate(
        blocker,
        addCandidateToDeckState(createEmptyDeckState(), blocker),
        EMPTY_POOL,
        PROFILE,
      ).components.redundancyEffect,
    ).toBeUndefined()
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
  const premiumBomb = candidate(
    'OP17-022',
    { cost: 10, power: 12_000 },
    ['boss', 'rush', 'removal', 'massRest', 'donRefresh', 'brick'],
  )
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
    expect(ordinarySubtotal).toBe(4)
    expect(score.components.premiumBombFloor).toBe(11)
    expect(score.reasonsByComponent.premiumBombFloor).toBe(
      'First-copy premium bomb floor: 11',
    )
    expect(score.total).toBe(PROFILE.limits.premiumBombFirstCopyFloor)
  })

  const saturatedStateWithoutBricks = addCopies(
    createEmptyDeckState(),
    saturatedRoleCard,
    PROFILE.curve.late.maximum,
  )

  it('raises a saturated first copy without bricks from an ordinary subtotal of 5 to 15', () => {
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

    expect(ordinarySubtotal).toBe(5)
    expect(score.components.premiumBombFloor).toBe(10)
    expect(score.reasonsByComponent.premiumBombFloor).toBe(
      'First-copy premium bomb floor: 10',
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

    expect(score.total).toBe(17)
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
    expect(score.total).toBe(4)
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
      'Broadly useful Rainbow-usable effects',
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
    expect(score.reasons.at(-1)).toBe('First-copy premium bomb floor: 10')
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
      'targetInteraction',
      'targetBoss',
      'curveLate',
      'curveHighCost',
      'effectQuality',
      'searcherSupport',
      'comboSupport',
    ])
    expect(first.reasons).toEqual([
      'Printed body efficiency value',
      'Printed counter value',
      `2K counter target: ${PROFILE.weights.softTargets.twoKCounter}`,
      `Blocker target: ${PROFILE.weights.softTargets.blocker}`,
      `Vanilla-like target: ${PROFILE.weights.softTargets.vanillaLike}`,
      `Interaction target: ${PROFILE.weights.softTargets.interaction}`,
      `Boss target: ${PROFILE.weights.softTargets.boss}`,
      'Late curve need: 2',
      'High-cost curve need: 2',
      'Broadly useful Rainbow-usable effects: 2 (2)',
      'Searcher support selected 6, pool potential 6: 2',
      'Combo support selected 6, pool potential 6: 2',
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
