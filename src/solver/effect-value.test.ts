import { describe, expect, it } from 'vitest'

import {
  emptyCardPredicate,
  type ActivationChannel,
  type EffectAction,
  type TargetSpec,
  type TimingModifier,
} from '../../shared/card-effect-model.js'
import { getStrategyProfile } from '../strategy/strategy-profile.js'

import {
  valueAction,
  type ActionTargetSupport,
  type ActionValueContext,
  type PremiumCategory,
} from './effect-value.js'

const PROFILE = getStrategyProfile('OP17')

function target(
  overrides: Partial<Omit<TargetSpec, 'predicate'>> & {
    predicate?: Partial<TargetSpec['predicate']>
  } = {},
): TargetSpec {
  const { predicate = {}, ...targetOverrides } = overrides
  return {
    subject: 'opponent',
    zones: ['field'],
    quantity: 1,
    predicate: {
      ...emptyCardPredicate(),
      ...predicate,
    },
    differentNames: false,
    totalCostMaximum: null,
    allowsSelf: false,
    ...targetOverrides,
  }
}

function context(
  activation: ActivationChannel = 'onPlay',
  targetSupport?: ActionTargetSupport,
  timing: readonly TimingModifier[] = [],
): ActionValueContext {
  return { profile: PROFILE, activation, targetSupport, timing }
}

function gross(action: EffectAction, actionContext = context()): number {
  return valueAction(action, actionContext).grossValue
}

function expectValue(
  action: EffectAction,
  expectedGross: number,
  category: PremiumCategory | null,
  actionContext = context(),
): void {
  const result = valueAction(action, actionContext)

  expect(result.grossValue).toBe(expectedGross)
  expect(result.category).toBe(category)
  expect(result.reason.length).toBeGreaterThan(0)
  expect(Number.isFinite(result.grossValue)).toBe(true)
  expect(Number.isFinite(result.targetSupportFactor)).toBe(true)
  expect(Number.isFinite(result.effectiveTargetCount)).toBe(true)
}

const ACTION_BY_KIND = {
  keyword: { kind: 'keyword', keyword: 'rush' },
  draw: { kind: 'draw', subject: 'player', amount: 1 },
  filter: {
    kind: 'filter',
    subject: 'player',
    lookedAt: 3,
    kept: 1,
    target: target({ subject: 'player', zones: ['deck'] }),
  },
  remove: {
    kind: 'remove',
    mode: 'ko',
    target: target(),
    powerDelta: null,
  },
  negateEffect: { kind: 'negateEffect', target: target() },
  lockAttack: {
    kind: 'lockAttack',
    target: target(),
    duration: 'thisTurn',
  },
  deploy: {
    kind: 'deploy',
    target: target({ subject: 'player', zones: ['hand'] }),
  },
  protect: {
    kind: 'protect',
    target: target({ subject: 'thisCard', allowsSelf: true }),
  },
  lifeMove: { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
  handDiscard: { kind: 'handDiscard', subject: 'opponent', amount: 1 },
  donChange: { kind: 'donChange', mode: 'refresh', amount: 1 },
  counterModifier: {
    kind: 'counterModifier',
    amount: 1_000,
    target: target({ subject: 'player', quantity: 'all' }),
  },
  powerModifier: {
    kind: 'powerModifier',
    powerDelta: 1_000,
    target: target({ subject: 'player' }),
    duration: 'thisTurn',
  },
  leaderBasePower: {
    kind: 'leaderBasePower',
    powerDelta: 1_000,
    duration: 'untilOpponentsNextEndPhase',
  },
  unknown: { kind: 'unknown', normalizedText: 'future wording' },
} satisfies {
  readonly [Kind in EffectAction['kind']]: Extract<
    EffectAction,
    { readonly kind: Kind }
  >
}

describe('valueAction exact action arithmetic', () => {
  it('keeps the complete EffectAction union finite and evaluable', () => {
    for (const action of Object.values(ACTION_BY_KIND)) {
      const result = valueAction(action, context())
      expect(Number.isFinite(result.grossValue)).toBe(true)
      expect(Number.isFinite(result.targetSupportFactor)).toBe(true)
      expect(Number.isFinite(result.effectiveTargetCount)).toBe(true)
    }
  })

  it('values player draw and preserves opponent draw as adverse value', () => {
    expectValue(
      { kind: 'draw', subject: 'player', amount: 2 },
      4,
      'cardAdvantage',
    )
    expectValue(
      { kind: 'draw', subject: 'opponent', amount: 2 },
      -4,
      'cardAdvantage',
    )
  })

  it.each(['thisCard', 'bothPlayers', 'unknown'] as const)(
    'safely gives an unsupported %s draw subject zero value',
    (subject) => {
      const result = valueAction(
        { kind: 'draw', subject, amount: 2 },
        context(),
      )

      expect(result).toMatchObject({ grossValue: 0, category: null })
      expect(result.reason).toContain('unsupported draw subject')
    },
  )

  it('values filtering by kept and extra-seen cards and applies its own cap', () => {
    expectValue(
      {
        kind: 'filter',
        subject: 'player',
        lookedAt: 5,
        kept: 1,
        target: target({ subject: 'player', zones: ['deck'] }),
      },
      2,
      'cardAdvantage',
    )
    expect(
      gross({
        kind: 'filter',
        subject: 'player',
        lookedAt: 20,
        kept: 2,
        target: target({ subject: 'player', zones: ['deck'] }),
      }),
    ).toBe(2.5)
  })

  it('does not value filtering for an unsafe subject', () => {
    expectValue(
      {
        kind: 'filter',
        subject: 'opponent',
        lookedAt: 5,
        kept: 1,
        target: target({ subject: 'opponent', zones: ['deck'] }),
      },
      0,
      null,
    )
  })

  it.each([
    ['ko', 4],
    ['bottomDeck', 4.5],
    ['returnHand', 3],
    ['rest', 1.5],
  ] as const)('values %s interaction from its calibrated base', (mode, base) => {
    expectValue(
      {
        kind: 'remove',
        mode,
        target: target(),
        powerDelta: null,
      },
      base,
      'interaction',
    )
  })

  it('applies target multiplicity and a printed maximum-cost factor once', () => {
    expectValue(
      {
        kind: 'remove',
        mode: 'bottomDeck',
        target: target({
          quantity: 2,
          predicate: { maximumCost: 5 },
        }),
        powerDelta: null,
      },
      7.0875,
      'interaction',
    )
  })

  it('uses unbounded multiplicity and a total-cost ceiling once', () => {
    expectValue(
      {
        kind: 'remove',
        mode: 'ko',
        target: target({ quantity: 'anyNumber', totalCostMaximum: 4 }),
        powerDelta: null,
      },
      7.5,
      'interaction',
    )
  })

  it.each([
    [1, 1],
    [2, 1.75],
    [3, 2.25],
    [8, 2.25],
    ['all', 2.5],
    ['anyNumber', 2.5],
  ] as const)('maps target quantity %s to multiplier %s', (quantity, multiplier) => {
    expect(
      gross({
        kind: 'remove',
        mode: 'ko',
        target: target({ quantity }),
        powerDelta: null,
      }),
    ).toBe(4 * multiplier)
  })

  it.each([
    [0, 0.55],
    [2, 0.55],
    [3, 0.75],
    [4, 0.75],
    [5, 0.9],
    [6, 0.9],
    [7, 1],
    [12, 1],
  ] as const)('maps maximum cost %s to factor %s', (maximumCost, factor) => {
    expect(
      gross({
        kind: 'remove',
        mode: 'ko',
        target: target({ predicate: { maximumCost } }),
        powerDelta: null,
      }),
    ).toBe(4 * factor)
  })

  it('leaves unrestricted interaction at full value', () => {
    expect(
      gross({
        kind: 'remove',
        mode: 'ko',
        target: target(),
        powerDelta: null,
      }),
    ).toBe(4)
  })

  it('values power reduction from the signed delta, not the resulting power', () => {
    expectValue(
      {
        kind: 'remove',
        mode: 'powerReduction',
        target: target({
          quantity: 2,
          predicate: { maximumCost: 5, maximumPower: 12_000 },
        }),
        powerDelta: -3_000,
      },
      3.54375,
      'interaction',
    )
  })

  it('safely rejects missing or positive power-reduction deltas', () => {
    for (const powerDelta of [null, 3_000] as const) {
      expectValue(
        {
          kind: 'remove',
          mode: 'powerReduction',
          target: target(),
          powerDelta,
        },
        0,
        null,
      )
    }
  })

  it('does not cap a broad action at the later per-instance cap', () => {
    const result = valueAction(
      {
        kind: 'remove',
        mode: 'powerReduction',
        target: target({ quantity: 'all' }),
        powerDelta: -10_000,
      },
      context(),
    )

    expect(result.grossValue).toBe(18.75)
    expect(result.grossValue).toBeGreaterThan(PROFILE.effectModel.effectInstanceCap)
  })

  it('values opposing effect negation with cost ceiling but not target multiplicity', () => {
    expectValue(
      {
        kind: 'negateEffect',
        target: target({ quantity: 2, predicate: { maximumCost: 4 } }),
      },
      1.125,
      'interaction',
    )
    expect(
      gross({
        kind: 'negateEffect',
        target: target({
          quantity: 'anyNumber',
          predicate: { maximumCost: 4 },
        }),
      }),
    ).toBe(1.125)
  })

  it('values long-duration attack lockdown', () => {
    expectValue(
      {
        kind: 'lockAttack',
        target: target({ quantity: 2 }),
        duration: 'untilOpponentsNextEndPhase',
      },
      5.46875,
      'interaction',
    )
  })

  it('values deployment by quantity and printed cost saved', () => {
    expectValue(
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          quantity: 2,
          predicate: { maximumCost: 4 },
        }),
      },
      7,
      'cardAdvantage',
    )
    expect(
      gross({
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          quantity: 2,
          predicate: { maximumCost: 20 },
        }),
      }),
    ).toBe(9)
  })

  it('uses a total-cost ceiling for multi-deploy and adds trash recursion once', () => {
    expect(
      gross({
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          quantity: 2,
          totalCostMaximum: 9,
        }),
      }),
    ).toBe(7.5)
    expect(
      gross({
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['trash'],
          quantity: 1,
          predicate: { maximumCost: 2 },
        }),
      }),
    ).toBe(3.5)
  })

  it('values replacement protection and its long-duration timing once', () => {
    const protect: EffectAction = {
      kind: 'protect',
      target: target({ subject: 'thisCard', allowsSelf: true }),
    }

    expectValue(protect, 3, 'durableDefense')
    expectValue(
      protect,
      3.75,
      'durableDefense',
      context('static', undefined, ['untilOpponentsNextEndPhase']),
    )
  })

  it.each([
    ['gainOwnLife', 2, 10],
    ['opponentLifeToHand', 2, 6],
  ] as const)('values %s Life movement', (direction, amount, expected) => {
    expectValue(
      { kind: 'lifeMove', direction, amount },
      expected,
      'lifeAdvantage',
    )
  })

  it('values only opponent hand discard as card advantage', () => {
    expectValue(
      { kind: 'handDiscard', subject: 'opponent', amount: 2 },
      5,
      'cardAdvantage',
    )
    expectValue(
      { kind: 'handDiscard', subject: 'player', amount: 2 },
      0,
      null,
    )
  })

  it.each([
    ['refresh', 2, 3],
    ['rampActive', 2, 4],
    ['rampRested', 2, 2.5],
  ] as const)('values DON!! %s', (mode, amount, expected) => {
    expectValue(
      { kind: 'donChange', mode, amount },
      expected,
      'donAdvantage',
    )
  })

  it('values a counter aura from injected eligible-target evidence', () => {
    const support: ActionTargetSupport = {
      factor: 0.75,
      effectiveTargetCount: 2,
      requestedTargetCount: 2,
      reason: 'two eligible counterless Characters',
    }
    const result = valueAction(
      {
        kind: 'counterModifier',
        amount: 2_000,
        target: target({ subject: 'player', quantity: 'all' }),
      },
      context('static', support),
    )

    expect(result).toMatchObject({
      grossValue: 4,
      category: 'durableDefense',
      targetSupportFactor: 0.75,
      effectiveTargetCount: 2,
      supportDependent: true,
    })
    expect(result.reason).toContain(support.reason)
  })

  it('uses theoretical counter-aura magnitude while availability remains closed', () => {
    const aura: EffectAction = {
      kind: 'counterModifier',
      amount: 3_000,
      target: target({ subject: 'player', quantity: 'all' }),
    }

    expect(valueAction(aura, context('static'))).toMatchObject({
      grossValue: 6,
      category: 'durableDefense',
      targetSupportFactor: 0,
      effectiveTargetCount: 0,
    })
    expectValue(
      aura,
      6,
      'durableDefense',
      context('static', {
        factor: 1,
        effectiveTargetCount: 3,
        reason: 'three eligible Characters',
      }),
    )
  })

  it('uses requested theoretical count, never effective count, for aura raw gross', () => {
    const aura: EffectAction = {
      kind: 'counterModifier',
      amount: 1_500,
      target: target({ subject: 'player', quantity: 'all' }),
    }

    for (const effectiveTargetCount of [0, 1.25, 99]) {
      const result = valueAction(
        aura,
        context('static', {
          factor: 0.5,
          effectiveTargetCount,
          requestedTargetCount: 3,
          reason: 'controlled aura request',
        }),
      )

      expect(result).toMatchObject({
        grossValue: 4.5,
        targetSupportFactor: 0.5,
        effectiveTargetCount,
      })
    }
  })

  it('keeps an explicit self Counter modifier at its one printed target', () => {
    expectValue(
      {
        kind: 'counterModifier',
        amount: 2_000,
        target: target({
          subject: 'thisCard',
          zones: ['hand'],
          allowsSelf: true,
        }),
      },
      2,
      'durableDefense',
      context('counter'),
    )
  })

  it('uses Counter calibration for Counter power and own-power calibration otherwise', () => {
    const power: EffectAction = {
      kind: 'powerModifier',
      powerDelta: 3_000,
      target: target({ subject: 'player', quantity: 2 }),
      duration: 'thisTurn',
    }

    expectValue(power, 10.5, 'durableDefense', context('counter'))
    expectValue(power, 3.9375, 'pressure', context('main'))
  })

  it('safely gives adverse own-power directions zero value', () => {
    expectValue(
      {
        kind: 'powerModifier',
        powerDelta: -3_000,
        target: target({ subject: 'player' }),
        duration: 'thisTurn',
      },
      0,
      null,
    )
  })

  it('values Leader shielding from its delta rather than the absolute base power', () => {
    expectValue(
      {
        kind: 'leaderBasePower',
        powerDelta: 1_000,
        duration: 'untilOpponentsNextEndPhase',
      },
      4,
      'durableDefense',
    )
  })

  it.each([
    'oncePerTurn',
    'yourTurn',
    'opponentsTurn',
    'thisTurn',
  ] as const)(
    'requires opposing-end-phase duration for Leader shielding, not %s',
    (duration) => {
      const result = valueAction(
        {
          kind: 'leaderBasePower',
          powerDelta: 1_000,
          duration,
        },
        context(),
      )

      expect(result).toMatchObject({ grossValue: 0, category: null })
      expect(result.reason).toContain('long-duration Leader shield')
    },
  )

  it.each([
    ['rush', 'pressure'],
    ['banish', 'pressure'],
    ['blocker', 'durableDefense'],
  ] as const)('values the %s keyword', (keyword, category) => {
    expectValue(
      { kind: 'keyword', keyword },
      1,
      category,
    )
  })

  it('returns a safe explicit zero for unknown actions', () => {
    const result = valueAction(
      { kind: 'unknown', normalizedText: 'future wording' },
      context(),
    )

    expect(result).toMatchObject({ grossValue: 0, category: null })
    expect(result.reason).toContain('unknown action')
  })
})

describe('valueAction target-support evidence', () => {
  it('ignores supplied target evidence for target-independent actions', () => {
    const supplied: ActionTargetSupport = {
      factor: 0.25,
      effectiveTargetCount: 9,
      reason: 'must not affect independent actions',
    }
    const independentActions: readonly EffectAction[] = [
      { kind: 'draw', subject: 'player', amount: 1 },
      {
        kind: 'remove',
        mode: 'ko',
        target: target(),
        powerDelta: null,
      },
      { kind: 'keyword', keyword: 'rush' },
      {
        kind: 'leaderBasePower',
        powerDelta: 1_000,
        duration: 'untilOpponentsNextEndPhase',
      },
    ]

    for (const action of independentActions) {
      const result = valueAction(action, context('onPlay', supplied))
      expect(result).toMatchObject({
        targetSupportFactor: 1,
        supportDependent: false,
      })
      expect(result.reason).not.toContain(supplied.reason)
    }
  })

  it('defers dynamic filter and deploy targets without injected support', () => {
    const actions: readonly EffectAction[] = [
      {
        kind: 'filter',
        subject: 'player',
        lookedAt: 5,
        kept: 1,
        target: target({ subject: 'player', zones: ['deck'] }),
      },
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          predicate: { maximumCost: 4 },
        }),
      },
    ]

    for (const action of actions) {
      expect(valueAction(action, context())).toMatchObject({
        targetSupportFactor: 0,
        effectiveTargetCount: 0,
        supportDependent: true,
      })
    }
  })

  it('keeps explicit self Trigger deployment target-independent', () => {
    const result = valueAction(
      {
        kind: 'deploy',
        target: target({
          subject: 'thisCard',
          zones: ['life'],
          allowsSelf: true,
        }),
      },
      context('trigger'),
    )

    expect(result).toMatchObject({
      grossValue: 1.5,
      targetSupportFactor: 1,
      effectiveTargetCount: 1,
      supportDependent: false,
    })
  })

  it('requires support for a trait-constrained Leader-or-Character target', () => {
    const constrained: EffectAction = {
      kind: 'powerModifier',
      powerDelta: 2_000,
      target: target({
        subject: 'player',
        predicate: {
          cardTypes: ['LEADER', 'CHARACTER'],
          traits: ['Navy'],
        },
      }),
      duration: 'thisTurn',
    }

    expect(valueAction(constrained, context('counter'))).toMatchObject({
      targetSupportFactor: 0,
      effectiveTargetCount: 0,
      supportDependent: true,
    })
    expect(
      valueAction(
        constrained,
        context('counter', {
          factor: 0.4,
          effectiveTargetCount: 1,
          reason: 'one matching Navy target',
        }),
      ),
    ).toMatchObject({
      targetSupportFactor: 0.4,
      effectiveTargetCount: 1,
      supportDependent: true,
    })
  })

  it('keeps a truly unconstrained Leader-or-Character target independent', () => {
    const unconstrained: EffectAction = {
      kind: 'powerModifier',
      powerDelta: 2_000,
      target: target({
        subject: 'player',
        predicate: { cardTypes: ['LEADER', 'CHARACTER'] },
      }),
      duration: 'thisTurn',
    }
    const result = valueAction(
      unconstrained,
      context('counter', {
        factor: 0.25,
        effectiveTargetCount: 9,
        reason: 'must be ignored',
      }),
    )

    expect(result).toMatchObject({
      targetSupportFactor: 1,
      effectiveTargetCount: 1,
      supportDependent: false,
    })
  })

  it('preserves injected factor and count without applying the factor to raw gross', () => {
    const result = valueAction(
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          quantity: 2,
          predicate: { maximumCost: 4 },
        }),
      },
      context('onPlay', {
        factor: 0.5,
        effectiveTargetCount: 1.25,
        reason: 'controlled support',
      }),
    )

    expect(result).toMatchObject({
      grossValue: 7,
      targetSupportFactor: 0.5,
      effectiveTargetCount: 1.25,
    })
    expect(result.reason).toContain('controlled support')
  })

  it('fails closed for unsafe injected target evidence', () => {
    const action: EffectAction = {
      kind: 'counterModifier',
      amount: 2_000,
      target: target({ subject: 'player', quantity: 'all' }),
    }

    for (const targetSupport of [
      { factor: Number.NaN, effectiveTargetCount: 2, reason: 'bad factor' },
      { factor: 2, effectiveTargetCount: 2, reason: 'large factor' },
      { factor: 1, effectiveTargetCount: Number.POSITIVE_INFINITY, reason: 'bad count' },
      { factor: 1, effectiveTargetCount: -1, reason: 'negative count' },
      {
        factor: 1,
        effectiveTargetCount: 1,
        requestedTargetCount: 0,
        reason: 'zero requested count',
      },
      {
        factor: 1,
        effectiveTargetCount: 1,
        requestedTargetCount: Number.POSITIVE_INFINITY,
        reason: 'bad requested count',
      },
    ]) {
      expect(valueAction(action, context('static', targetSupport))).toMatchObject({
        grossValue: 0,
        targetSupportFactor: 0,
        effectiveTargetCount: 0,
      })
    }
  })
})

describe('valueAction numeric safety', () => {
  it('fails closed rather than returning non-finite arithmetic', () => {
    const unsafeActions = [
      { kind: 'draw', subject: 'player', amount: Number.NaN },
      { kind: 'lifeMove', direction: 'gainOwnLife', amount: Number.POSITIVE_INFINITY },
      { kind: 'donChange', mode: 'refresh', amount: -1 },
      {
        kind: 'powerModifier',
        powerDelta: Number.POSITIVE_INFINITY,
        target: target({ subject: 'player' }),
        duration: 'thisTurn',
      },
    ] as unknown as readonly EffectAction[]

    for (const action of unsafeActions) {
      const result = valueAction(action, context())
      expect(result.grossValue).toBe(0)
      expect(Number.isFinite(result.grossValue)).toBe(true)
      expect(result.reason).toContain('unsafe')
    }
  })
})
