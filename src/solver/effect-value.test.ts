import { describe, expect, it } from 'vitest'

import {
  emptyCardPredicate,
  type ActivationChannel,
  type EffectAction,
  type EffectCost,
  type EffectInstance,
  type RequirementExpression,
  type TargetSpec,
  type TimingModifier,
} from '../../shared/card-effect-model.js'
import {
  supportRequirementFlagKeys,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'
import {
  getStrategyProfile,
  mergeStrategyProfile,
  type StrategyProfile,
} from '../strategy/strategy-profile.js'

import {
  valueAction,
  valueCardEffects,
  type ActionTargetSupport,
  type ActionValueContext,
  type EffectContribution,
  type PremiumCategory,
} from './effect-value.js'
import {
  buildPoolSupport,
  createEmptyDeckState,
  type CandidateCard,
} from './deck-state.js'

const PROFILE = getStrategyProfile('OP17')
const EMPTY_STATE = createEmptyDeckState()
const EMPTY_POOL = buildPoolSupport([])

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

function draw(
  subject: Extract<EffectAction, { kind: 'draw' }>['subject'],
  amount: number,
): EffectAction {
  return { kind: 'draw', subject, amount }
}

function effectInstance(
  overrides: Partial<Omit<EffectInstance, 'branches'>> & {
    actions?: readonly EffectAction[]
    branches?: EffectInstance['branches']
  } = {},
): EffectInstance {
  const {
    actions = [draw('player', 1)],
    branches = [{ actions }],
    ...instanceOverrides
  } = overrides
  return {
    id: 'effect:0',
    source: 'effect',
    activation: 'onPlay',
    timing: [],
    condition: { kind: 'always' },
    costs: [],
    chooser: 'none',
    optional: false,
    branches,
    rainbowLuffyCompatibility: 'compatible',
    ...instanceOverrides,
  }
}

function candidate(
  effects: readonly EffectInstance[],
  cardOverrides: Partial<PlayableCard> = {},
): CandidateCard {
  const flags = Object.fromEntries(
    [
      'twoKCounter',
      'blocker',
      'vanillaLike',
      'draw',
      'removal',
      'boss',
      'rush',
      'banish',
      'twoForOne',
      'massRest',
      'donRefresh',
      'searcher',
      'comboDependent',
      'brick',
    ].map((flag) => [flag, false]),
  ) as Record<keyof CardFeatures['flags'], boolean>
  const card: PlayableCard = {
    cardNumber: 'OP17-001',
    name: 'Evaluator Fixture',
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4_000,
    counter: 0,
    attribute: 'Strike',
    traits: ['Test'],
    effect: '',
    trigger: '',
    setMembership: ['OP17'],
    variantsCollapsed: 1,
    entryShortcut: '001',
    isSpecialReprint: false,
    ...cardOverrides,
  }
  return {
    card,
    features: {
      effectModelVersion: 2,
      effectParserRevision: 1,
      effects,
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
    },
  }
}

function cardValue(
  effects: readonly EffectInstance[],
  cardOverrides: Partial<PlayableCard> = {},
) {
  return cardValueWithProfile(effects, PROFILE, cardOverrides)
}

function cardValueWithProfile(
  effects: readonly EffectInstance[],
  profile: StrategyProfile,
  cardOverrides: Partial<PlayableCard> = {},
) {
  return valueCardEffects(
    candidate(effects, cardOverrides),
    EMPTY_STATE,
    EMPTY_POOL,
    profile,
  )
}

function contribution(
  instance: EffectInstance,
  cardOverrides: Partial<PlayableCard> = {},
): EffectContribution {
  return cardValue([instance], cardOverrides).contributions[0]!
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

describe('valueCardEffects instance reconciliation', () => {
  it.each([
    [{ kind: 'playEventDon', amount: 2 }, 2],
    [{ kind: 'donMinus', amount: 2 }, 3],
    [{ kind: 'restDon', amount: 2 }, 2],
    [{ kind: 'discardHand', amount: 2 }, 4],
    [{ kind: 'trashSelf' }, 1.5],
    [{ kind: 'restSelf' }, 1],
  ] satisfies readonly (readonly [EffectCost, number])[])(
    'deducts the shared %s cost exactly once',
    (cost, expectedCost) => {
      const result = contribution(
        effectInstance({
          actions: [draw('player', 1), draw('player', 1)],
          costs: [cost],
        }),
      )

      expect(result).toMatchObject({
        grossValue: 4,
        costValue: expectedCost,
        activationFactor: 1,
        conditionSupportFactor: 1,
        netValue: 4 - expectedCost,
      })
      expect(result.actions.reduce((sum, action) => sum + action.netValue, 0)).toBe(
        result.netValue,
      )
    },
  )

  it('allocates one shared cost proportionally and reconciles categories once', () => {
    const result = contribution(
      effectInstance({
        actions: [
          draw('player', 1),
          { kind: 'lifeMove', direction: 'opponentLifeToHand', amount: 2 },
        ],
        costs: [{ kind: 'restDon', amount: 2 }],
      }),
    )

    expect(result).toMatchObject({ grossValue: 8, costValue: 2, netValue: 6 })
    expect(result.actions).toMatchObject([
      { allocatedCostValue: 0.5, netValue: 1.5 },
      { allocatedCostValue: 1.5, netValue: 4.5 },
    ])
    expect(result.categoryValues).toEqual({
      pressure: 0,
      interaction: 0,
      cardAdvantage: 1.5,
      lifeAdvantage: 4.5,
      donAdvantage: 0,
      durableDefense: 0,
    })
  })

  it('assigns proportional rounding residue to the final positive action', () => {
    const result = contribution(
      effectInstance({
        actions: [
          draw('player', 1),
          { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
        ],
        costs: [{ kind: 'restSelf' }],
      }),
    )

    expect(result.actions.map((action) => action.allocatedCostValue)).toEqual([
      0.285714,
      0.714286,
    ])
    expect(result.actions.reduce((sum, action) => sum + action.allocatedCostValue, 0)).toBe(1)
    expect(result.actions.reduce((sum, action) => sum + action.netValue, 0)).toBe(6)
  })

  it('chooses the player-best and opponent-worst target-adjusted branch', () => {
    const unsupportedDeploy: EffectAction = {
      kind: 'deploy',
      target: target({
        subject: 'player',
        zones: ['hand'],
        predicate: { maximumCost: 5 },
      }),
    }
    const playerChoice = contribution(
      effectInstance({
        chooser: 'player',
        branches: [
          { actions: [unsupportedDeploy] },
          { actions: [draw('player', 2)] },
        ],
      }),
    )
    const opponentChoice = contribution(
      effectInstance({
        chooser: 'opponent',
        branches: [
          { actions: [draw('opponent', 2)] },
          { actions: [{ kind: 'handDiscard', subject: 'opponent', amount: 2 }] },
        ],
      }),
    )

    expect(playerChoice.netValue).toBe(4)
    expect(playerChoice.actions[0]).toMatchObject({ branchIndex: 1, targetSupportFactor: 1 })
    expect(opponentChoice.netValue).toBe(-4)
    expect(opponentChoice.actions[0]).toMatchObject({ branchIndex: 0, rawGrossValue: -4 })
  })

  it('caps positive value at 12 while retaining adverse actions', () => {
    const result = contribution(
      effectInstance({
        actions: [
          { kind: 'lifeMove', direction: 'gainOwnLife', amount: 3 },
          draw('opponent', 1),
        ],
      }),
    )

    expect(result).toMatchObject({ grossValue: 12, netValue: 12 })
    expect(result.actions).toMatchObject([
      { rawGrossValue: 15, cappedGrossValue: 14, netValue: 14 },
      { rawGrossValue: -2, cappedGrossValue: -2, netValue: -2 },
    ])
  })

  it('assigns positive-cap rounding residue to the final positive action', () => {
    const result = contribution(
      effectInstance({
        actions: [
          draw('player', 4),
          { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
        ],
      }),
    )

    expect(result.actions.map((action) => action.cappedGrossValue)).toEqual([
      7.384615,
      4.615385,
    ])
    expect(result.grossValue).toBe(12)
  })

  it.each([
    ['onPlay', 1],
    ['main', 1],
    ['static', 0.8],
    ['activateMain', 0.75],
    ['whenAttacking', 0.7],
    ['counter', 0.65],
    ['onOpponentsAttack', 0.6],
    ['onBlock', 0.6],
    ['onKo', 0.5],
    ['trigger', 0.35],
  ] as const)('applies the %s activation factor once', (activation, factor) => {
    const result = contribution(effectInstance({ activation }))

    expect(result.activationFactor).toBe(factor)
    expect(result.netValue).toBe(2 * factor)
    expect(result.actions[0]?.netValue).toBe(2 * factor)
  })

  it('clamps optional losses to zero but keeps cost evidence', () => {
    const result = contribution(
      effectInstance({
        optional: true,
        actions: [draw('player', 1)],
        costs: [{ kind: 'discardHand', amount: 2 }],
      }),
    )

    expect(result).toMatchObject({ grossValue: 2, costValue: 4, netValue: 0 })
    expect(result.actions[0]).toMatchObject({
      rawGrossValue: 2,
      cappedGrossValue: 2,
      allocatedCostValue: 4,
      netValue: 0,
    })
    expect(Object.values(result.categoryValues).every((value) => value === 0)).toBe(true)
  })

  it('clears signed action evidence when an optional mixed instance totals zero', () => {
    const valuation = cardValue([
      effectInstance({
        optional: true,
        actions: [draw('player', 1), draw('opponent', 1)],
      }),
    ])

    expect(valuation.total).toBe(0)
    expect(valuation.premiumImpact).toBe(0)
    expect(valuation.contributions[0]?.actions.map((action) => action.netValue)).toEqual([
      0,
      0,
    ])
    expect(
      Object.values(valuation.contributions[0]!.categoryValues).every(
        (value) => value === 0,
      ),
    ).toBe(true)
  })

  it('retains mandatory adverse value and allocates cost to the first action', () => {
    const result = contribution(
      effectInstance({
        actions: [draw('opponent', 1)],
        costs: [{ kind: 'restSelf' }],
      }),
    )

    expect(result).toMatchObject({ grossValue: -2, costValue: 1, netValue: -3 })
    expect(result.actions[0]).toMatchObject({ allocatedCostValue: 1, netValue: -3 })
    expect(Object.values(result.categoryValues).every((value) => value === 0)).toBe(true)
  })

  it.each([
    [{ kind: 'unknown', normalizedText: 'board condition' }, 0],
    [{ kind: 'cards', target: target({ subject: 'player' }), minimumCount: 1 }, 0],
    [{ kind: 'leader', names: ['Luffy'], traits: [], monoColorRequired: false }, 0],
    [{ kind: 'all', children: [{ kind: 'always' }] }, 0],
    [{ kind: 'any', children: [{ kind: 'always' }] }, 0],
    [{ kind: 'selfState', state: 'playedThisTurn' }, 1],
    [{ kind: 'always' }, 1],
  ] satisfies readonly (readonly [RequirementExpression, number])[])(
    'fails closed or resolves the %s condition',
    (condition, expectedFactor) => {
      const result = contribution(effectInstance({ condition }))
      expect(result.conditionSupportFactor).toBe(expectedFactor)
      expect(result.netValue).toBe(2 * expectedFactor)
    },
  )

  it('hard-zeros only the incompatible clause', () => {
    const valuation = cardValue([
      effectInstance({ id: 'effect:0', rainbowLuffyCompatibility: 'incompatible' }),
      effectInstance({ id: 'effect:1', actions: [draw('player', 2)] }),
    ])

    expect(valuation.contributions.map((item) => item.netValue)).toEqual([0, 4])
    expect(valuation.contributions[0]?.reason).toContain('incompatible')
    expect(valuation.total).toBe(4)
  })

  it('reconciles positive categories to a mixed instance net', () => {
    const positive = cardValue([
      effectInstance({
        actions: [
          { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
          draw('opponent', 1),
        ],
      }),
    ])
    const nonPositive = cardValue([
      effectInstance({
        actions: [draw('player', 1), draw('opponent', 2)],
      }),
    ])

    expect(positive.contributions[0]?.categoryValues).toEqual({
      pressure: 0,
      interaction: 0,
      cardAdvantage: 0,
      lifeAdvantage: 3,
      donAdvantage: 0,
      durableDefense: 0,
    })
    expect(positive).toMatchObject({
      total: 3,
      premiumImpact: 3,
      premiumCategories: ['lifeAdvantage'],
    })
    expect(nonPositive).toMatchObject({ total: -2, premiumImpact: 0, premiumCategories: [] })
    expect(Object.values(nonPositive.contributions[0]!.categoryValues).every((item) => item === 0)).toBe(true)
  })

  it('returns deeply frozen, exactly reconciled evidence', () => {
    const valuation = cardValue([
      effectInstance({ actions: [draw('player', 1), draw('opponent', 1)] }),
    ])

    expect(Object.isFrozen(valuation)).toBe(true)
    expect(Object.isFrozen(valuation.contributions)).toBe(true)
    expect(Object.isFrozen(valuation.contributions[0]!)).toBe(true)
    expect(Object.isFrozen(valuation.contributions[0]!.actions)).toBe(true)
    expect(Object.isFrozen(valuation.contributions[0]!.actions[0]!)).toBe(true)
    expect(Object.isFrozen(valuation.contributions[0]!.categoryValues)).toBe(true)
    expect(Object.isFrozen(valuation.premiumCategories)).toBe(true)
    expect(valuation.contributions[0]!.reason).toContain('branch 0')
    expect(valuation.contributions[0]!.actions[0]!.reason).toContain('raw gross 2')
    expect(valuation.contributions[0]!.actions[0]!.reason).toContain(
      'effective targets 1',
    )
    expect(valuation.total).toBe(
      valuation.contributions.reduce((sum, item) => sum + item.netValue, 0),
    )
  })

  it('sums Stage instances in printed order', () => {
    const valuation = cardValue(
      [
        effectInstance({ id: 'effect:0', activation: 'static' }),
        effectInstance({ id: 'effect:1', activation: 'activateMain' }),
      ],
      { cardType: 'STAGE' },
    )

    expect(valuation.contributions.map((item) => item.effectId)).toEqual([
      'effect:0',
      'effect:1',
    ])
    expect(valuation.total).toBe(3.1)
  })
})

describe('valueCardEffects physical-card modes', () => {
  const counterPower: EffectAction = {
    kind: 'powerModifier',
    powerDelta: 4_000,
    target: target({
      subject: 'player',
      predicate: { cardTypes: ['LEADER'] },
    }),
    duration: 'thisTurn',
  }
  const triggerSelfDeploy: EffectAction = {
    kind: 'deploy',
    target: target({
      subject: 'thisCard',
      zones: ['life'],
      allowsSelf: true,
    }),
  }

  it('keeps only the best Event Main, Counter, or Trigger group', () => {
    const main = effectInstance({ id: 'effect:0', activation: 'main', actions: [draw('player', 2)] })
    const counter = effectInstance({ id: 'effect:1', activation: 'counter', actions: [counterPower] })
    const trigger = effectInstance({
      id: 'trigger:0',
      source: 'trigger',
      activation: 'trigger',
      actions: [triggerSelfDeploy],
    })
    const valuation = cardValue([main, counter, trigger], {
      cardType: 'EVENT',
      cost: 3,
    })

    expect(valuation).toMatchObject({
      total: 3.25,
      premiumImpact: 3.25,
      premiumCategories: ['durableDefense'],
    })
    expect(valuation.contributions).toHaveLength(1)
    expect(valuation.contributions[0]).toMatchObject({
      effectId: 'effect:1',
      grossValue: 8,
      costValue: 3,
      activationFactor: 0.65,
      netValue: 3.25,
    })
    expect(counter.costs).toEqual([])
  })

  it('sums Character On Play and Trigger instances without recursive activation', () => {
    const valuation = cardValue([
      effectInstance({ id: 'effect:0', activation: 'onPlay' }),
      effectInstance({
        id: 'trigger:0',
        source: 'trigger',
        activation: 'trigger',
        actions: [triggerSelfDeploy],
      }),
    ])

    expect(valuation.contributions.map((item) => item.effectId)).toEqual([
      'effect:0',
      'trigger:0',
    ])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([2, 0.525])
    expect(valuation.total).toBe(2.525)
  })

  it.each(['main', 'counter'] as const)(
    'fails closed for a null-cost Event %s mode with an explicit reason',
    (activation) => {
      const result = cardValue(
        [effectInstance({ activation })],
        { cardType: 'EVENT', cost: null },
      )

      expect(result.total).toBe(0)
      expect(result.contributions[0]?.activationFactor).toBe(0)
      expect(result.contributions[0]?.reason).toContain('missing printed Event cost')
    },
  )

  it('keeps a direct null-cost Event Trigger eligible', () => {
    const valuation = cardValue(
      [
        effectInstance({ activation: 'main', actions: [draw('player', 5)] }),
        effectInstance({
          id: 'trigger:0',
          source: 'trigger',
          activation: 'trigger',
          actions: [draw('player', 1)],
        }),
      ],
      { cardType: 'EVENT', cost: null },
    )

    expect(valuation.contributions).toHaveLength(1)
    expect(valuation.contributions[0]).toMatchObject({
      effectId: 'trigger:0',
      activationFactor: 0.35,
      netValue: 0.7,
    })
  })

  it('excludes discarded Event modes from impact and categories', () => {
    const valuation = cardValue(
      [
        effectInstance({ activation: 'main', actions: [{ kind: 'lifeMove', direction: 'gainOwnLife', amount: 2 }] }),
        effectInstance({ id: 'effect:1', activation: 'counter', actions: [counterPower] }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.contributions.map((item) => item.effectId)).toEqual(['effect:0'])
    expect(valuation.premiumCategories).toEqual(['lifeAdvantage'])
    expect(valuation.premiumImpact).toBe(7)
  })

  it('deducts Event cost once from usable mode evidence when the first clause is unavailable', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          condition: { kind: 'unknown', normalizedText: 'board condition' },
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          actions: [draw('player', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(1)
    expect(valuation.contributions.map((item) => item.costValue)).toEqual([0, 3])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([0, 1])
    expect(valuation.premiumImpact).toBe(1)
  })

  it('keeps mode-level Event cost independent of clause order', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          actions: [draw('player', 2)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          condition: { kind: 'unknown', normalizedText: 'board condition' },
          actions: [draw('player', 1)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(1)
    expect(valuation.contributions.map((item) => item.costValue)).toEqual([3, 0])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([1, 0])
  })

  it('allocates Event cost only across mixed-condition usable clauses', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          condition: { kind: 'unknown', normalizedText: 'unknown condition' },
          actions: [draw('player', 5)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'effect:2',
          activation: 'main',
          condition: { kind: 'selfState', state: 'playedThisTurn' },
          actions: [
            { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
          ],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(4)
    expect(valuation.contributions[0]).toMatchObject({ costValue: 0, netValue: 0 })
    expect(valuation.contributions.slice(1).reduce((sum, item) => sum + item.costValue, 0)).toBe(3)
    expect(valuation.contributions.slice(1).reduce((sum, item) => sum + item.netValue, 0)).toBe(4)
    expect(valuation.premiumImpact).toBe(4)
  })

  it('applies Counter Event cost once at the Counter activation factor', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'counter',
          condition: { kind: 'unknown', normalizedText: 'unknown condition' },
          actions: [counterPower],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'counter',
          actions: [counterPower],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(3.25)
    expect(valuation.contributions.map((item) => item.costValue)).toEqual([0, 3])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([0, 3.25])
    expect(valuation.premiumImpact).toBe(3.25)
  })

  it('does not charge an Event mode with no usable positive evidence', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          condition: { kind: 'unknown', normalizedText: 'first condition' },
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          rainbowLuffyCompatibility: 'incompatible',
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(0)
    expect(valuation.premiumImpact).toBe(0)
    expect(valuation.contributions.every((item) => item.costValue === 0)).toBe(true)
    expect(valuation.contributions[0]?.reason).toContain(
      'no positive usable mode evidence',
    )
  })

  it('charges a mandatory adverse Main mode and preserves its negative value', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          condition: { kind: 'unknown', normalizedText: 'unknown condition' },
          actions: [draw('opponent', 1)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          actions: [draw('opponent', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation).toMatchObject({ total: -7, premiumImpact: 0 })
    expect(valuation.contributions[0]).toMatchObject({
      costValue: 0,
      netValue: 0,
    })
    expect(valuation.contributions[1]).toMatchObject({
      costValue: 3,
      netValue: -7,
    })
    expect(valuation.contributions[1]?.actions[0]).toMatchObject({
      allocatedCostValue: 3,
      netValue: -7,
    })
    expect(
      Object.values(valuation.contributions[1]!.categoryValues).every(
        (value) => value === 0,
      ),
    ).toBe(true)
    expect(valuation.contributions[0]?.actions[0]?.reason).not.toContain(
      'first usable mandatory action',
    )
    expect(valuation.contributions[1]?.reason).toContain(
      'first usable mandatory action',
    )
    expect(Object.isFrozen(valuation.contributions[1])).toBe(true)
    expect(Object.isFrozen(valuation.contributions[1]?.actions[0])).toBe(true)
  })

  it('charges a mandatory adverse Counter mode at Counter availability', () => {
    const valuation = cardValue(
      [
        effectInstance({
          activation: 'counter',
          actions: [draw('opponent', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(-4.55)
    expect(valuation.contributions[0]).toMatchObject({
      costValue: 3,
      activationFactor: 0.65,
      netValue: -4.55,
    })
    expect(valuation.contributions[0]?.actions[0]).toMatchObject({
      allocatedCostValue: 3,
      netValue: -4.55,
    })
  })

  it('does not charge a mode whose only available adverse clause is optional', () => {
    const valuation = cardValue(
      [
        effectInstance({
          activation: 'main',
          optional: true,
          actions: [draw('opponent', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(0)
    expect(valuation.contributions[0]).toMatchObject({
      costValue: 0,
      netValue: 0,
    })
    expect(valuation.contributions[0]?.reason).toContain(
      'no usable mandatory mode action',
    )
  })

  it('clamps an optional Event mode only after applying its printed cost', () => {
    const valuation = cardValue(
      [
        effectInstance({
          activation: 'main',
          optional: true,
          actions: [draw('player', 1)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation).toMatchObject({ total: 0, premiumImpact: 0 })
    expect(valuation.contributions[0]).toMatchObject({
      grossValue: 2,
      costValue: 3,
      netValue: 0,
    })
    expect(valuation.contributions[0]?.actions[0]).toMatchObject({
      allocatedCostValue: 3,
      netValue: 0,
    })
    expect(
      Object.values(valuation.contributions[0]!.categoryValues).every(
        (value) => value === 0,
      ),
    ).toBe(true)
    expect(valuation.contributions[0]?.reason).toContain(
      'optional mode loss clamped to zero',
    )
  })

  it.each([
    ['optional-first', ['optional', 'mandatory']],
    ['mandatory-first', ['mandatory', 'optional']],
  ] as const)(
    'keeps the full Main cost on mandatory evidence with %s ordering',
    (_, order) => {
      const valuation = cardValue(
        order.map((kind, index) =>
          effectInstance({
            id: `effect:${index}`,
            activation: 'main',
            optional: kind === 'optional',
            actions: [draw('player', 1)],
          }),
        ),
        { cardType: 'EVENT', cost: 5 },
      )
      const mandatoryIndex = order.indexOf('mandatory')
      const optionalIndex = order.indexOf('optional')

      expect(valuation).toMatchObject({ total: -1, premiumImpact: 0 })
      expect(
        valuation.contributions.reduce((sum, item) => sum + item.costValue, 0),
      ).toBe(5)
      expect(valuation.contributions[mandatoryIndex]).toMatchObject({
        costValue: 5,
        netValue: -3,
      })
      expect(valuation.contributions[mandatoryIndex]?.actions[0]).toMatchObject({
        allocatedCostValue: 5,
        netValue: -3,
      })
      expect(valuation.contributions[optionalIndex]).toMatchObject({
        costValue: 0,
        netValue: 2,
      })
      expect(valuation.contributions[optionalIndex]?.actions[0]).toMatchObject({
        allocatedCostValue: 0,
        netValue: 2,
      })
      expect(
        Object.values(
          valuation.contributions[optionalIndex]!.categoryValues,
        ).reduce((sum, value) => sum + value, 0),
      ).toBe(2)
      expect(
        Object.values(
          valuation.contributions[mandatoryIndex]!.categoryValues,
        ).every((value) => value === 0),
      ).toBe(true)
      expect(valuation.premiumCategories).toEqual([])
      expect(
        valuation.contributions.every(
          (item) =>
            item.actions.reduce((sum, action) => sum + action.netValue, 0) ===
            item.netValue,
        ),
      ).toBe(true)
      expect(Object.isFrozen(valuation)).toBe(true)
      expect(Object.isFrozen(valuation.contributions)).toBe(true)
      expect(
        valuation.contributions.every(
          (item) => Object.isFrozen(item) && Object.isFrozen(item.actions),
        ),
      ).toBe(true)
    },
  )

  it('keeps the full Counter cost on mandatory evidence before mode reconciliation', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'counter',
          optional: true,
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'counter',
          actions: [draw('player', 1)],
        }),
      ],
      { cardType: 'EVENT', cost: 5 },
    )

    expect(valuation).toMatchObject({ total: -0.65, premiumImpact: 0 })
    expect(valuation.contributions.map((item) => item.costValue)).toEqual([0, 5])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([
      1.3,
      -1.95,
    ])
    expect(
      Object.values(valuation.contributions[0]!.categoryValues).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(1.3)
    expect(
      Object.values(valuation.contributions[1]!.categoryValues).every(
        (value) => value === 0,
      ),
    ).toBe(true)
    expect(valuation.premiumCategories).toEqual([])
  })

  it('keeps selected mixed-mode contribution evidence while suppressing losing-card premium', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'main:optional',
          activation: 'main',
          optional: true,
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'main:mandatory',
          activation: 'main',
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'counter:mandatory',
          activation: 'counter',
          actions: [draw('opponent', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 5 },
    )

    expect(valuation.contributions.map((item) => item.effectId)).toEqual([
      'main:optional',
      'main:mandatory',
    ])
    expect(valuation).toMatchObject({
      total: -1,
      premiumImpact: 0,
      premiumCategories: [],
    })
    for (const contribution of valuation.contributions) {
      expect(
        contribution.actions.reduce((sum, action) => sum + action.netValue, 0),
      ).toBe(contribution.netValue)
      if (contribution.netValue > 0) {
        expect(
          Object.values(contribution.categoryValues).reduce(
            (sum, value) => sum + value,
            0,
          ),
        ).toBe(contribution.netValue)
      }
      expect(Object.isFrozen(contribution)).toBe(true)
      expect(Object.isFrozen(contribution.actions)).toBe(true)
      expect(Object.isFrozen(contribution.categoryValues)).toBe(true)
    }
    expect(Object.isFrozen(valuation)).toBe(true)
    expect(Object.isFrozen(valuation.premiumCategories)).toBe(true)
  })

  it('does not charge a mode when every clause is unavailable', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'counter',
          condition: { kind: 'unknown', normalizedText: 'unknown condition' },
          actions: [draw('opponent', 2)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'counter',
          rainbowLuffyCompatibility: 'incompatible',
          actions: [draw('opponent', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 3 },
    )

    expect(valuation.total).toBe(0)
    expect(valuation.contributions.every((item) => item.costValue === 0)).toBe(true)
    expect(valuation.contributions.every((item) => item.netValue === 0)).toBe(true)
    expect(valuation.contributions[0]?.reason).toContain(
      'no usable mandatory mode action',
    )
  })

  it('allocates Event cost rounding residue across usable actions and categories', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          actions: [draw('player', 1)],
        }),
        effectInstance({
          id: 'effect:1',
          activation: 'main',
          actions: [
            { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
          ],
        }),
      ],
      { cardType: 'EVENT', cost: 1 },
    )

    expect(valuation.contributions.map((item) => item.costValue)).toEqual([
      0.285714,
      0.714286,
    ])
    expect(
      valuation.contributions.flatMap((item) => item.actions).map(
        (action) => action.allocatedCostValue,
      ),
    ).toEqual([0.285714, 0.714286])
    expect(valuation.contributions.map((item) => item.netValue)).toEqual([
      1.714286,
      4.285714,
    ])
    expect(valuation.contributions[0]?.categoryValues.cardAdvantage).toBe(
      1.714286,
    )
    expect(valuation.contributions[1]?.categoryValues.lifeAdvantage).toBe(
      4.285714,
    )
    expect(
      valuation.contributions.reduce((sum, item) => sum + item.costValue, 0),
    ).toBe(1)
    expect(valuation.total).toBe(6)
    expect(valuation.premiumImpact).toBe(6)
  })

  it('apportions tiny rounded Event costs without a negative residue', () => {
    const microProfile = mergeStrategyProfile(PROFILE, {
      effectModel: {
        actions: { ownDrawPerCard: 0.000001 },
        costs: { playEventDonPerCard: 0.000002 },
      },
    })
    const valuation = cardValueWithProfile(
      [3, 3, 3, 1].map((amount, index) =>
        effectInstance({
          id: `effect:${index}`,
          activation: 'main',
          actions: [draw('player', amount)],
        }),
      ),
      microProfile,
      { cardType: 'EVENT', cost: 1 },
    )

    expect(valuation.contributions.map((item) => item.costValue)).toEqual([
      0.000001,
      0.000001,
      0,
      0,
    ])
    expect(
      valuation.contributions.flatMap((item) => item.actions).every(
        (action) => action.allocatedCostValue >= 0,
      ),
    ).toBe(true)
    expect(valuation.total).toBe(0.000008)
    expect(valuation.premiumImpact).toBe(0.000008)
  })

  it('chooses the Event mode from net value after its printed cost', () => {
    const valuation = cardValue(
      [
        effectInstance({
          id: 'effect:0',
          activation: 'main',
          actions: [
            { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
          ],
        }),
        effectInstance({
          id: 'trigger:0',
          source: 'trigger',
          activation: 'trigger',
          actions: [draw('player', 2)],
        }),
      ],
      { cardType: 'EVENT', cost: 4 },
    )

    expect(valuation.contributions.map((item) => item.effectId)).toEqual([
      'trigger:0',
    ])
    expect(valuation.total).toBe(1.4)
  })
})
