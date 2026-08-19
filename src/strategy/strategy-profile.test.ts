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
    })
    expect(profile.analysis).toEqual({
      totalCounter: {
        neutralMinimum: 24_000,
        strengthMinimum: 30_000,
        scoringSaturationMinimum: 52_000,
      },
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
