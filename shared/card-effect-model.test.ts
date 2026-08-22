import { describe, expect, it } from 'vitest'

import {
  cardEffectModelSchema,
  cardPredicateSchema,
  createCardEffectModel,
  emptyCardPredicate,
  effectActionSchema,
  requirementExpressionSchema,
  type EffectInstance,
  type TargetSpec,
} from './card-effect-model.js'

const TARGET: TargetSpec = {
  subject: 'opponent',
  zones: ['field'],
  quantity: 1,
  predicate: emptyCardPredicate(),
  differentNames: false,
  totalCostMaximum: null,
  allowsSelf: false,
}

const TARGET_WITH_PREDICATE: TargetSpec = {
  subject: 'player',
  zones: ['deck', 'trash'],
  quantity: 'anyNumber',
  predicate: {
    ...emptyCardPredicate(),
    names: ['Nami'],
    traits: ['East Blue'],
    cardTypes: ['CHARACTER'],
  },
  differentNames: true,
  totalCostMaximum: 9,
  allowsSelf: true,
}

const EFFECT: EffectInstance = {
  id: 'effect:0',
  source: 'effect',
  activation: 'onPlay',
  timing: [],
  condition: { kind: 'always' },
  costs: [],
  chooser: 'none',
  optional: false,
  branches: [
    { actions: [{ kind: 'draw', subject: 'player', amount: 1 }] },
  ],
  rainbowLuffyCompatibility: 'compatible',
}

const SECOND_EFFECT: EffectInstance = {
  id: 'effect:1',
  source: 'trigger',
  activation: 'trigger',
  timing: ['oncePerTurn'],
  condition: {
    kind: 'cards',
    target: TARGET_WITH_PREDICATE,
    minimumCount: 2,
  },
  costs: [{ kind: 'donMinus', amount: 1 }],
  chooser: 'player',
  optional: true,
  branches: [
    {
      actions: [
        { kind: 'negateEffect', target: TARGET_WITH_PREDICATE },
        {
          kind: 'remove',
          mode: 'ko',
          target: TARGET_WITH_PREDICATE,
          powerDelta: null,
        },
      ],
    },
    {
      actions: [
        {
          kind: 'powerModifier',
          powerDelta: -2_000,
          target: TARGET_WITH_PREDICATE,
          duration: 'thisTurn',
        },
      ],
    },
  ],
  rainbowLuffyCompatibility: 'neutral',
}

describe('card effect model', () => {
  it('accepts LEADER as a strict card predicate type', () => {
    expect(
      cardPredicateSchema.safeParse({
        ...emptyCardPredicate(),
        cardTypes: ['LEADER', 'CHARACTER'],
      }).success,
    ).toBe(true)
    expect(
      cardPredicateSchema.safeParse({
        ...emptyCardPredicate(),
        cardTypes: ['leader'],
      }).success,
    ).toBe(false)
    expect(
      cardPredicateSchema.safeParse({
        ...emptyCardPredicate(),
        cardTypes: ['DON'],
      }).success,
    ).toBe(false)
  })

  it('accepts and deeply freezes a deterministic canonical model', () => {
    const mutableEffect = structuredClone(EFFECT)
    const mutableSecondEffect = structuredClone(SECOND_EFFECT)
    const input = {
      effects: [mutableEffect, mutableSecondEffect],
      unparsedClauses: ['Unparsed first.', 'Unparsed second.'],
    }

    const model = createCardEffectModel(input)
    const repeatedModel = createCardEffectModel(input)

    expect(cardEffectModelSchema.parse(model)).toEqual(model)
    expect(repeatedModel).toEqual(model)
    expect(model.effectModelVersion).toBe(2)
    expect(model.effectParserRevision).toBe(1)
    expect(model.effects.map(({ id }) => id)).toEqual(['effect:0', 'effect:1'])
    expect(
      model.effects[1]!.branches.map(({ actions }) =>
        actions.map(({ kind }) => kind),
      ),
    ).toEqual([['negateEffect', 'remove'], ['powerModifier']])
    expect(model.unparsedClauses).toEqual([
      'Unparsed first.',
      'Unparsed second.',
    ])
    expect(model).not.toBe(input)
    expect(model.effects[0]).not.toBe(mutableEffect)
    expect(Object.isFrozen(model)).toBe(true)
    expect(Object.isFrozen(model.effects)).toBe(true)
    expect(Object.isFrozen(model.effects[0])).toBe(true)
    expect(Object.isFrozen(model.effects[0]!.condition)).toBe(true)
    expect(Object.isFrozen(model.effects[0]!.branches)).toBe(true)
    expect(Object.isFrozen(model.effects[0]!.branches[0]!.actions)).toBe(true)

    const nestedAction = model.effects[1]!.branches[0]!.actions[0]!
    expect(nestedAction.kind).toBe('negateEffect')
    if (nestedAction.kind !== 'negateEffect') {
      throw new Error('Expected the first nested action to be negateEffect')
    }
    expect(Object.isFrozen(model.effects[1]!.branches[0])).toBe(true)
    expect(Object.isFrozen(nestedAction)).toBe(true)
    expect(Object.isFrozen(nestedAction.target)).toBe(true)
    expect(Object.isFrozen(nestedAction.target.zones)).toBe(true)
    expect(Object.isFrozen(nestedAction.target.predicate)).toBe(true)
    expect(Object.isFrozen(nestedAction.target.predicate.names)).toBe(true)
    expect(Object.isFrozen(nestedAction.target.predicate.traits)).toBe(true)
    expect(Object.isFrozen(nestedAction.target.predicate.cardTypes)).toBe(true)

    ;(mutableEffect as { id: string }).id = 'changed-after-construction'
    input.unparsedClauses.push('Changed after construction.')
    expect(model.effects[0]!.id).toBe('effect:0')
    expect(model.unparsedClauses).toEqual([
      'Unparsed first.',
      'Unparsed second.',
    ])

    expect(emptyCardPredicate()).toEqual({
      names: [],
      traits: [],
      cardTypes: [],
      minimumCost: null,
      maximumCost: null,
      minimumPower: null,
      maximumPower: null,
      counter: 'any',
      hasTrigger: null,
    })
  })

  it.each([
    [{ ...EFFECT, unexpected: true }],
    [{ ...EFFECT, id: '' }],
    [{ ...EFFECT, branches: [] }],
    [{ ...EFFECT, branches: [{ actions: [] }] }],
    [
      {
        ...EFFECT,
        branches: [
          {
            actions: [{ kind: 'draw', subject: 'player', amount: -1 }],
          },
        ],
      },
    ],
    [
      {
        ...EFFECT,
        branches: [
          {
            actions: [
              {
                kind: 'powerModifier',
                powerDelta: Number.NaN,
                target: TARGET,
                duration: 'thisTurn',
              },
            ],
          },
        ],
      },
    ],
  ])('rejects invalid or partial effect instances %#', (effect) => {
    expect(
      cardEffectModelSchema.safeParse({
        effectModelVersion: 2,
        effectParserRevision: 1,
        effects: [effect],
        unparsedClauses: [],
      }).success,
    ).toBe(false)
  })

  it('accepts every canonical action including negation and signed power deltas', () => {
    const actions = [
      { kind: 'keyword', keyword: 'blocker' },
      { kind: 'draw', subject: 'player', amount: 2 },
      {
        kind: 'filter',
        subject: 'player',
        lookedAt: 5,
        kept: 1,
        target: TARGET,
      },
      {
        kind: 'remove',
        mode: 'powerReduction',
        target: TARGET,
        powerDelta: -3_000,
      },
      { kind: 'negateEffect', target: TARGET },
      {
        kind: 'lockAttack',
        target: TARGET,
        duration: 'untilOpponentsNextEndPhase',
      },
      { kind: 'deploy', target: TARGET },
      { kind: 'protect', target: TARGET },
      { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
      { kind: 'handDiscard', subject: 'opponent', amount: 1 },
      { kind: 'donChange', mode: 'rampActive', amount: 1 },
      { kind: 'counterModifier', amount: 2_000, target: TARGET },
      {
        kind: 'powerModifier',
        powerDelta: -2_000,
        target: TARGET,
        duration: 'thisTurn',
      },
      {
        kind: 'leaderBasePower',
        powerDelta: 1_000,
        duration: 'opponentsTurn',
      },
      { kind: 'unknown', normalizedText: 'unresolved wording' },
    ]

    for (const action of actions) {
      expect(effectActionSchema.safeParse(action).success).toBe(true)
    }
  })

  it('validates recursive requirement expressions strictly', () => {
    const expression = {
      kind: 'all',
      children: [
        { kind: 'always' },
        {
          kind: 'any',
          children: [
            { kind: 'cards', target: TARGET, minimumCount: 2 },
            {
              kind: 'leader',
              names: ['Nami'],
              traits: ['East Blue'],
              monoColorRequired: false,
            },
          ],
        },
      ],
    }

    expect(requirementExpressionSchema.safeParse(expression).success).toBe(true)
    expect(
      requirementExpressionSchema.safeParse({
        ...expression,
        children: [{ kind: 'always', unexpected: true }],
      }).success,
    ).toBe(false)
    expect(
      effectActionSchema.safeParse({
        kind: 'negateEffect',
        target: { ...TARGET, allowsSelf: undefined },
      }).success,
    ).toBe(false)
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects a non-finite signed power delta: %s', (powerDelta) => {
    expect(
      effectActionSchema.safeParse({
        kind: 'powerModifier',
        powerDelta,
        target: TARGET,
        duration: 'thisTurn',
      }).success,
    ).toBe(false)
  })
})
