import { describe, expect, it } from 'vitest'

import { getStrategyProfile, mergeStrategyProfile } from './strategy-profile'

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return
  }

  expect(Object.isFrozen(value)).toBe(true)
  Object.values(value).forEach(expectDeeplyFrozen)
}

describe('getStrategyProfile', () => {
  it('uses one calibrated override for OP16/OP17 and conservative defaults elsewhere', () => {
    const op16 = getStrategyProfile('OP16')
    const op17 = getStrategyProfile('OP17')
    const futureSet = getStrategyProfile('OP99')

    expect(op16).toEqual(op17)
    expect(op17).not.toEqual(futureSet)
    expect(op16).toMatchObject({ id: 'sealed-video-v1', version: 1 })
    expect(futureSet.analysis.totalCounter.scoringSaturationMinimum).toBe(30_000)
    expect(futureSet.weights.standalone).toEqual({
      cardPower: 2,
      counterValue: 1,
      saturatedCounterValue: 1,
    })
    expect(futureSet.weights.softTargets.blocker).toBe(3)
    expect(Object.values(futureSet.weights.softTargetFloorPercent)).toEqual([
      0,
      0,
      0,
      0,
      0,
    ])
  })

  it('resolves OP01 through OP15 to detached base profiles', () => {
    const referenceBase = getStrategyProfile('OP99')

    for (let setNumber = 1; setNumber <= 15; setNumber += 1) {
      const setId = `OP${String(setNumber).padStart(2, '0')}`
      const profile = getStrategyProfile(setId)

      expect(profile).toEqual(referenceBase)
      expect(profile).not.toBe(referenceBase)
      expect(profile.targets).not.toBe(referenceBase.targets)
      expect(profile.limits).not.toBe(referenceBase.limits)
      expect(profile.weights).not.toBe(referenceBase.weights)
    }
  })

  it('exposes the exact sealed targets, curve policy, and limits', () => {
    const profile = getStrategyProfile('OP16')

    expect(profile.targets).toEqual({
      twoKCounter: 10,
      blocker: 10,
      vanillaLike: 10,
      interaction: 5,
      boss: 5,
    })
    expect(profile.curve).toEqual({
      early: { minimumCost: 0, maximumCost: 2, target: 8 },
      middle: { minimumCost: 3, maximumCost: 5, target: 16 },
      late: { minimumCost: 6, maximum: 10, minimum: 6 },
      highCost: { minimumCost: 7, maximum: 8, minimum: 4 },
      turnOrderDominance: 3,
    })
    expect(profile.limits).toEqual({
      brickTolerance: 8,
      searcherMinimumTargets: 6,
      comboMinimumSupport: 4,
      premiumBombFirstCopyFloor: 15,
      premiumImpactThreshold: 7.5,
      premiumCategoryMinimum: 2,
    })
    expect(profile.analysis).toEqual({
      totalCounter: {
        neutralMinimum: 24_000,
        strengthMinimum: 30_000,
        scoringSaturationMinimum: 52_000,
      },
    })
  })

  it('publishes the premium-bomb first-copy floor for base and calibrated sets', () => {
    expect(getStrategyProfile('OP01').limits.premiumBombFirstCopyFloor).toBe(15)
    expect(getStrategyProfile('OP17').limits.premiumBombFirstCopyFloor).toBe(15)
  })

  it('publishes the exact structured effect-value policy', () => {
    expect(getStrategyProfile('OP17').effectModel).toEqual({
      actions: {
        ownDrawPerCard: 2,
        opponentDrawPerCard: -2,
        filterPerKept: 1,
        filterPerExtraSeen: 0.25,
        filterCap: 2.5,
        opponentDiscardPerCard: 2.5,
        counterPerThousand: 2,
        koBase: 4,
        bottomDeckBase: 4.5,
        returnHandBase: 3,
        restBase: 1.5,
        negateEffectBase: 1.5,
        powerReductionPerThousand: 0.75,
        lockAttackBase: 2.5,
        deployPerCard: 1.5,
        deployPerCostSaved: 0.5,
        deployCap: 9,
        trashDeployBonus: 1,
        protectionBase: 3,
        ownLifeGainPerCard: 5,
        opponentLifeToHandPerCard: 3,
        refreshDonPerCard: 1.5,
        rampActiveDonPerCard: 2,
        rampRestedDonPerCard: 1.25,
        counterAuraPerThousandPerCard: 1,
        counterAuraCap: 6,
        ownPowerPerThousandPerTarget: 0.75,
        leaderShieldPerThousand: 4,
        keyword: 1,
      },
      costs: {
        playEventDonPerCard: 1,
        donMinusPerCard: 1.5,
        restDonPerCard: 1,
        discardHandPerCard: 2,
        trashSelf: 1.5,
        restSelf: 1,
      },
      activationFactors: {
        onPlay: 1,
        main: 1,
        static: 0.8,
        activateMain: 0.75,
        whenAttacking: 0.7,
        counter: 0.65,
        onOpponentsAttack: 0.6,
        onBlock: 0.6,
        onKo: 0.5,
        trigger: 0.35,
      },
      targetMultipliers: {
        one: 1,
        two: 1.75,
        threeOrMore: 2.25,
        unbounded: 2.5,
      },
      costCeilingFactors: {
        zeroToTwo: 0.55,
        threeToFour: 0.75,
        fiveToSix: 0.9,
        sevenOrMore: 1,
      },
      longDurationMultiplier: 1.25,
      effectInstanceCap: 12,
      zoneFactors: { deck: 1, hand: 0.75, field: 0.65, trash: 0.55, life: 0.25 },
      opponentBoardConditionFactor: 0.5,
    })
  })

  it('keeps every weight category explicit and numeric for scorer tuning', () => {
    const weights = getStrategyProfile('OP16').weights

    expect(Object.keys(weights)).toEqual([
      'standalone',
      'softTargets',
      'softTargetFloorPercent',
      'curve',
      'synergy',
      'compatibility',
      'redundancy',
      'progressiveBricks',
    ])
    expect(Object.values(weights).flatMap(Object.values).every(Number.isInteger)).toBe(
      true,
    )
  })

  it('centralizes the evaluated sealed target and defensive tuning policy', () => {
    const { weights } = getStrategyProfile('OP16')

    expect(weights.standalone.counterValue).toBe(7)
    expect(weights.standalone.saturatedCounterValue).toBe(1)
    expect(weights.softTargets).toEqual({
      twoKCounter: 3,
      blocker: 8,
      vanillaLike: 1,
      interaction: 3,
      boss: 2,
    })
    expect(weights.softTargetFloorPercent).toEqual({
      twoKCounter: 0,
      blocker: 60,
      vanillaLike: 50,
      interaction: 0,
      boss: 0,
    })
    expect(weights.progressiveBricks).toEqual({
      first: 1,
      second: 2,
      third: 3,
      fourthOrMore: 4,
    })
  })

  it('rejects malformed set IDs with an actionable error', () => {
    expect(() => getStrategyProfile('16')).toThrow(/OP\\d\{2\}/)
    expect(() => getStrategyProfile('OP1')).toThrow(/invalid set id/i)
  })

  it('returns a deeply frozen profile', () => {
    const profile = getStrategyProfile('OP16')

    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.targets)).toBe(true)
    expect(Object.isFrozen(profile.curve)).toBe(true)
    expect(Object.isFrozen(profile.curve.early)).toBe(true)
    expect(Object.isFrozen(profile.limits)).toBe(true)
    expect(Object.isFrozen(profile.analysis)).toBe(true)
    expect(Object.isFrozen(profile.analysis.totalCounter)).toBe(true)
    expect(Object.isFrozen(profile.weights)).toBe(true)
    expect(Object.isFrozen(profile.weights.softTargets)).toBe(true)
  })

  it('returns detached profiles so mutation attempts cannot affect another lookup', () => {
    const first = getStrategyProfile('OP16')
    const second = getStrategyProfile('OP16')

    expect(first).not.toBe(second)
    expect(first.targets).not.toBe(second.targets)
    expect(first.effectModel).not.toBe(second.effectModel)
    expect(first.effectModel.actions).not.toBe(second.effectModel.actions)
    expect(() => {
      ;(first.targets as unknown as { blocker: number }).blocker = 0
    }).toThrow(TypeError)
    expect(second.targets.blocker).toBe(10)
  })

  it('keeps calibrated set overrides from mutating the shared base profile', () => {
    const op01 = getStrategyProfile('OP01')
    const op17 = getStrategyProfile('OP17')

    expect(op01.curve).not.toBe(op17.curve)
    expect(op01.curve.highCost).not.toBe(op17.curve.highCost)
    expect(op17.curve.highCost).toEqual({ minimumCost: 7, maximum: 8, minimum: 4 })
    expect(op01.weights.standalone.counterValue).toBe(1)
    expect(op17.weights.standalone.counterValue).toBe(7)
  })
})

describe('mergeStrategyProfile', () => {
  it('merges one nested value without losing defaults or accepting undefined', () => {
    const base = getStrategyProfile('OP99')
    const baseSnapshot = structuredClone(base)
    const override = {
      targets: { blocker: undefined },
      curve: { late: { maximum: undefined } },
      limits: { brickTolerance: undefined },
      analysis: { totalCounter: { neutralMinimum: undefined } },
      weights: {
        standalone: { counterValue: undefined },
        synergy: { trait: undefined, combo: 5 },
      },
    }
    const overrideSnapshot = structuredClone(override)

    const merged = mergeStrategyProfile(base, override)

    expect(merged).toEqual({
      ...base,
      weights: {
        ...base.weights,
        synergy: { ...base.weights.synergy, combo: 5 },
      },
    })
    expect(base).toEqual(baseSnapshot)
    expect(override).toEqual(overrideSnapshot)
    expect(merged).not.toBe(base)
    expect(merged.targets).not.toBe(base.targets)
    expect(merged.curve.late).not.toBe(base.curve.late)
    expect(merged.limits).not.toBe(base.limits)
    expect(merged.analysis).not.toBe(base.analysis)
    expect(merged.analysis.totalCounter).not.toBe(base.analysis.totalCounter)
    expect(merged.weights).not.toBe(base.weights)
    expect(merged.weights.synergy).not.toBe(base.weights.synergy)
    expectDeeplyFrozen(merged)
  })

  it('overrides total-counter thresholds independently', () => {
    const base = getStrategyProfile('OP16')
    const merged = mergeStrategyProfile(base, {
      analysis: {
        totalCounter: { neutralMinimum: 20_000, strengthMinimum: 28_000 },
      },
    })

    expect(merged.analysis.totalCounter).toEqual({
      neutralMinimum: 20_000,
      strengthMinimum: 28_000,
      scoringSaturationMinimum: 52_000,
    })
    expect(base.analysis.totalCounter).toEqual({
      neutralMinimum: 24_000,
      strengthMinimum: 30_000,
      scoringSaturationMinimum: 52_000,
    })
    expectDeeplyFrozen(merged)
  })

  it('overrides the premium-bomb floor without changing sibling policy', () => {
    const base = getStrategyProfile('OP17')

    const merged = mergeStrategyProfile(base, {
      limits: { premiumBombFirstCopyFloor: 9 },
    })

    expect(merged.limits).toEqual({
      ...base.limits,
      premiumBombFirstCopyFloor: 9,
    })
    expect(merged.targets).toEqual(base.targets)
    expect(merged.weights).toEqual(base.weights)
    expect(Object.isFrozen(merged.limits)).toBe(true)
    expectDeeplyFrozen(merged)
  })

  it('deeply merges effect policy leaves without dropping siblings', () => {
    const base = getStrategyProfile('OP17')
    const merged = mergeStrategyProfile(base, {
      effectModel: {
        actions: { koBase: 8 },
        activationFactors: { trigger: 0.25 },
      },
    })

    expect(merged.effectModel).toEqual({
      ...base.effectModel,
      actions: { ...base.effectModel.actions, koBase: 8 },
      activationFactors: {
        ...base.effectModel.activationFactors,
        trigger: 0.25,
      },
    })
    expect(base.effectModel.actions.koBase).toBe(4)
    expect(merged.effectModel.actions.bottomDeckBase).toBe(4.5)
    expect(merged.effectModel.activationFactors.onPlay).toBe(1)
    expectDeeplyFrozen(merged.effectModel)
  })

  it.each([
    ['actions.koBase', { actions: { koBase: -1 } }],
    ['actions.keyword', { actions: { keyword: Number.NaN } }],
    ['actions.filterCap', { actions: { filterCap: Number.POSITIVE_INFINITY } }],
    ['costs.trashSelf', { costs: { trashSelf: -1 } }],
    ['costs.restSelf', { costs: { restSelf: Number.NaN } }],
    [
      'costs.playEventDonPerCard',
      { costs: { playEventDonPerCard: Number.POSITIVE_INFINITY } },
    ],
  ] as const)('rejects invalid non-negative effect value %s', (label, effectModel) => {
    expect(() =>
      mergeStrategyProfile(getStrategyProfile('OP17'), { effectModel }),
    ).toThrow(new RegExp(`${label.replace('.', '\\.')}.*finite and non-negative`, 'i'))
  })

  it.each([
    ['activationFactors.trigger', -0.01],
    ['activationFactors.trigger', 1.01],
    ['activationFactors.trigger', Number.NaN],
    ['activationFactors.trigger', Number.POSITIVE_INFINITY],
  ] as const)('rejects out-of-range availability factor %s=%s', (label, trigger) => {
    expect(() =>
      mergeStrategyProfile(getStrategyProfile('OP17'), {
        effectModel: { activationFactors: { trigger } },
      }),
    ).toThrow(new RegExp(`${label.replace('.', '\\.')}.*0 through 1`, 'i'))
  })

  it.each([
    ['targetMultipliers.one', { targetMultipliers: { one: 0 } }],
    ['targetMultipliers.two', { targetMultipliers: { two: -1 } }],
    [
      'targetMultipliers.threeOrMore',
      { targetMultipliers: { threeOrMore: Number.NaN } },
    ],
    [
      'targetMultipliers.unbounded',
      { targetMultipliers: { unbounded: Number.POSITIVE_INFINITY } },
    ],
    ['costCeilingFactors.zeroToTwo', { costCeilingFactors: { zeroToTwo: 0 } }],
    [
      'costCeilingFactors.threeToFour',
      { costCeilingFactors: { threeToFour: -1 } },
    ],
    [
      'costCeilingFactors.fiveToSix',
      { costCeilingFactors: { fiveToSix: Number.NaN } },
    ],
    [
      'costCeilingFactors.sevenOrMore',
      { costCeilingFactors: { sevenOrMore: Number.POSITIVE_INFINITY } },
    ],
    ['longDurationMultiplier', { longDurationMultiplier: 0 }],
    ['longDurationMultiplier', { longDurationMultiplier: -1 }],
    ['longDurationMultiplier', { longDurationMultiplier: Number.NaN }],
    [
      'longDurationMultiplier',
      { longDurationMultiplier: Number.POSITIVE_INFINITY },
    ],
    ['effectInstanceCap', { effectInstanceCap: 0 }],
    ['effectInstanceCap', { effectInstanceCap: -1 }],
    ['effectInstanceCap', { effectInstanceCap: Number.NaN }],
    ['effectInstanceCap', { effectInstanceCap: Number.POSITIVE_INFINITY }],
  ] as const)('rejects invalid positive effect policy %s', (label, effectModel) => {
    expect(() =>
      mergeStrategyProfile(getStrategyProfile('OP17'), { effectModel }),
    ).toThrow(new RegExp(`${label.replace('.', '\\.')}.*finite and positive`, 'i'))
  })

  it.each([
    0.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])(
    'rejects adverse opponent draw value %s',
    (opponentDrawPerCard) => {
      expect(() =>
        mergeStrategyProfile(getStrategyProfile('OP17'), {
          effectModel: { actions: { opponentDrawPerCard } },
        }),
      ).toThrow(/actions\.opponentDrawPerCard.*finite and non-positive/i)
    },
  )

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid premium-bomb first-copy floor %s with a named range error',
    (premiumBombFirstCopyFloor) => {
      const mergeInvalidProfile = () =>
        mergeStrategyProfile(getStrategyProfile('OP17'), {
          limits: { premiumBombFirstCopyFloor },
        })

      expect(mergeInvalidProfile).toThrowError(RangeError)
      expect(mergeInvalidProfile).toThrow(/premiumBombFirstCopyFloor/)
    },
  )

  it.each([
    [{ neutralMinimum: -1 }, /non-negative safe integer/i],
    [{ neutralMinimum: 1.5 }, /non-negative safe integer/i],
    [{ strengthMinimum: Number.MAX_SAFE_INTEGER + 1 }, /non-negative safe integer/i],
    [{ scoringSaturationMinimum: 1.5 }, /non-negative safe integer/i],
    [
      { neutralMinimum: 30_001, strengthMinimum: 30_000 },
      /strength minimum.*neutral minimum/i,
    ],
    [
      { strengthMinimum: 30_000, scoringSaturationMinimum: 29_999 },
      /scoring saturation minimum.*strength minimum/i,
    ],
  ] as const)('rejects invalid total-counter policy %o', (totalCounter, error) => {
    expect(() =>
      mergeStrategyProfile(getStrategyProfile('OP16'), {
        analysis: { totalCounter },
      }),
    ).toThrow(error)
  })

  it.each([-1, 101, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid soft-target floor percentage %s',
    (blocker) => {
      expect(() =>
        mergeStrategyProfile(getStrategyProfile('OP16'), {
          weights: { softTargetFloorPercent: { blocker } },
        }),
      ).toThrow(/target floor.*0 through 100/i)
    },
  )
})
