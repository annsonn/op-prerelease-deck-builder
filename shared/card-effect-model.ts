import { z } from 'zod'

export type EffectSource = 'effect' | 'trigger'

export type ActivationChannel =
  | 'static'
  | 'onPlay'
  | 'main'
  | 'activateMain'
  | 'counter'
  | 'trigger'
  | 'onKo'
  | 'whenAttacking'
  | 'onBlock'
  | 'onOpponentsAttack'

export type TimingModifier =
  | 'oncePerTurn'
  | 'yourTurn'
  | 'opponentsTurn'
  | 'thisTurn'
  | 'untilOpponentsNextEndPhase'

export type EffectSubject =
  | 'player'
  | 'opponent'
  | 'thisCard'
  | 'bothPlayers'
  | 'unknown'

export type EffectChooser = 'player' | 'opponent' | 'none'

export type CardType = 'CHARACTER' | 'EVENT' | 'STAGE'

export type EffectZone = 'deck' | 'hand' | 'field' | 'trash' | 'life'

export interface CardPredicate {
  readonly names: readonly string[]
  readonly traits: readonly string[]
  readonly cardTypes: readonly CardType[]
  readonly minimumCost: number | null
  readonly maximumCost: number | null
  readonly minimumPower: number | null
  readonly maximumPower: number | null
  readonly counter: 'any' | 'hasCounter' | 'withoutCounter'
  readonly hasTrigger: boolean | null
}

export interface TargetSpec {
  readonly subject: EffectSubject
  readonly zones: readonly EffectZone[]
  readonly quantity: number | 'all' | 'anyNumber'
  readonly predicate: CardPredicate
  readonly differentNames: boolean
  readonly totalCostMaximum: number | null
  readonly allowsSelf: boolean
}

export type RequirementExpression =
  | { readonly kind: 'always' }
  | {
      readonly kind: 'all'
      readonly children: readonly RequirementExpression[]
    }
  | {
      readonly kind: 'any'
      readonly children: readonly RequirementExpression[]
    }
  | {
      readonly kind: 'cards'
      readonly target: TargetSpec
      readonly minimumCount: number
    }
  | {
      readonly kind: 'leader'
      readonly names: readonly string[]
      readonly traits: readonly string[]
      readonly monoColorRequired: boolean
    }
  | { readonly kind: 'selfState'; readonly state: 'playedThisTurn' }
  | { readonly kind: 'unknown'; readonly normalizedText: string }

export type EffectCost =
  | { readonly kind: 'playEventDon'; readonly amount: number }
  | { readonly kind: 'donMinus'; readonly amount: number }
  | { readonly kind: 'restDon'; readonly amount: number }
  | { readonly kind: 'discardHand'; readonly amount: number }
  | { readonly kind: 'trashSelf' }
  | { readonly kind: 'restSelf' }

export type EffectAction =
  | {
      readonly kind: 'keyword'
      readonly keyword: 'blocker' | 'rush' | 'banish'
    }
  | {
      readonly kind: 'draw'
      readonly subject: EffectSubject
      readonly amount: number
    }
  | {
      readonly kind: 'filter'
      readonly subject: EffectSubject
      readonly lookedAt: number
      readonly kept: number
      readonly target: TargetSpec
    }
  | {
      readonly kind: 'remove'
      readonly mode:
        | 'ko'
        | 'bottomDeck'
        | 'returnHand'
        | 'rest'
        | 'powerReduction'
      readonly target: TargetSpec
      readonly powerDelta: number | null
    }
  | { readonly kind: 'negateEffect'; readonly target: TargetSpec }
  | {
      readonly kind: 'lockAttack'
      readonly target: TargetSpec
      readonly duration: TimingModifier
    }
  | { readonly kind: 'deploy'; readonly target: TargetSpec }
  | { readonly kind: 'protect'; readonly target: TargetSpec }
  | {
      readonly kind: 'lifeMove'
      readonly direction: 'gainOwnLife' | 'opponentLifeToHand'
      readonly amount: number
    }
  | {
      readonly kind: 'handDiscard'
      readonly subject: EffectSubject
      readonly amount: number
    }
  | {
      readonly kind: 'donChange'
      readonly mode: 'refresh' | 'rampActive' | 'rampRested'
      readonly amount: number
    }
  | {
      readonly kind: 'counterModifier'
      readonly amount: number
      readonly target: TargetSpec
    }
  | {
      readonly kind: 'powerModifier'
      readonly powerDelta: number
      readonly target: TargetSpec
      readonly duration: TimingModifier
    }
  | {
      readonly kind: 'leaderBasePower'
      readonly powerDelta: number
      readonly duration: TimingModifier
    }
  | { readonly kind: 'unknown'; readonly normalizedText: string }

export interface EffectBranch {
  readonly actions: readonly EffectAction[]
}

export interface EffectInstance {
  readonly id: string
  readonly source: EffectSource
  readonly activation: ActivationChannel
  readonly timing: readonly TimingModifier[]
  readonly condition: RequirementExpression
  readonly costs: readonly EffectCost[]
  readonly chooser: EffectChooser
  readonly optional: boolean
  readonly branches: readonly EffectBranch[]
  readonly rainbowLuffyCompatibility: 'compatible' | 'neutral' | 'incompatible'
}

export interface CardEffectModel {
  readonly effectModelVersion: 2
  readonly effectParserRevision: 1
  readonly effects: readonly EffectInstance[]
  readonly unparsedClauses: readonly string[]
}

const finiteNonNegativeNumber = z.number().finite().nonnegative()
const finiteSignedNumber = z.number().finite()
const nonEmptyString = z.string().min(1)

export const effectSourceSchema = z.enum(['effect', 'trigger'])

export const activationChannelSchema = z.enum([
  'static',
  'onPlay',
  'main',
  'activateMain',
  'counter',
  'trigger',
  'onKo',
  'whenAttacking',
  'onBlock',
  'onOpponentsAttack',
])

export const timingModifierSchema = z.enum([
  'oncePerTurn',
  'yourTurn',
  'opponentsTurn',
  'thisTurn',
  'untilOpponentsNextEndPhase',
])

export const effectSubjectSchema = z.enum([
  'player',
  'opponent',
  'thisCard',
  'bothPlayers',
  'unknown',
])

export const effectChooserSchema = z.enum(['player', 'opponent', 'none'])

export const cardPredicateSchema: z.ZodType<CardPredicate> = z.strictObject({
  names: z.array(nonEmptyString),
  traits: z.array(nonEmptyString),
  cardTypes: z.array(z.enum(['CHARACTER', 'EVENT', 'STAGE'])),
  minimumCost: finiteNonNegativeNumber.nullable(),
  maximumCost: finiteNonNegativeNumber.nullable(),
  minimumPower: finiteNonNegativeNumber.nullable(),
  maximumPower: finiteNonNegativeNumber.nullable(),
  counter: z.enum(['any', 'hasCounter', 'withoutCounter']),
  hasTrigger: z.boolean().nullable(),
})

export const targetSpecSchema: z.ZodType<TargetSpec> = z.strictObject({
  subject: effectSubjectSchema,
  zones: z.array(z.enum(['deck', 'hand', 'field', 'trash', 'life'])),
  quantity: z.union([
    z.number().finite().int().positive(),
    z.literal('all'),
    z.literal('anyNumber'),
  ]),
  predicate: cardPredicateSchema,
  differentNames: z.boolean(),
  totalCostMaximum: finiteNonNegativeNumber.nullable(),
  allowsSelf: z.boolean(),
})

export const requirementExpressionSchema: z.ZodType<RequirementExpression> =
  z.lazy(() =>
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('always') }),
      z.strictObject({
        kind: z.literal('all'),
        children: z.array(requirementExpressionSchema),
      }),
      z.strictObject({
        kind: z.literal('any'),
        children: z.array(requirementExpressionSchema),
      }),
      z.strictObject({
        kind: z.literal('cards'),
        target: targetSpecSchema,
        minimumCount: finiteNonNegativeNumber,
      }),
      z.strictObject({
        kind: z.literal('leader'),
        names: z.array(nonEmptyString),
        traits: z.array(nonEmptyString),
        monoColorRequired: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal('selfState'),
        state: z.literal('playedThisTurn'),
      }),
      z.strictObject({
        kind: z.literal('unknown'),
        normalizedText: nonEmptyString,
      }),
    ]),
  )

export const effectCostSchema: z.ZodType<EffectCost> = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('playEventDon'),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('donMinus'),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('restDon'),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('discardHand'),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({ kind: z.literal('trashSelf') }),
    z.strictObject({ kind: z.literal('restSelf') }),
  ],
)

export const effectActionSchema: z.ZodType<EffectAction> =
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('keyword'),
      keyword: z.enum(['blocker', 'rush', 'banish']),
    }),
    z.strictObject({
      kind: z.literal('draw'),
      subject: effectSubjectSchema,
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('filter'),
      subject: effectSubjectSchema,
      lookedAt: finiteNonNegativeNumber,
      kept: finiteNonNegativeNumber,
      target: targetSpecSchema,
    }),
    z.strictObject({
      kind: z.literal('remove'),
      mode: z.enum([
        'ko',
        'bottomDeck',
        'returnHand',
        'rest',
        'powerReduction',
      ]),
      target: targetSpecSchema,
      powerDelta: finiteSignedNumber.nullable(),
    }),
    z.strictObject({
      kind: z.literal('negateEffect'),
      target: targetSpecSchema,
    }),
    z.strictObject({
      kind: z.literal('lockAttack'),
      target: targetSpecSchema,
      duration: timingModifierSchema,
    }),
    z.strictObject({
      kind: z.literal('deploy'),
      target: targetSpecSchema,
    }),
    z.strictObject({
      kind: z.literal('protect'),
      target: targetSpecSchema,
    }),
    z.strictObject({
      kind: z.literal('lifeMove'),
      direction: z.enum(['gainOwnLife', 'opponentLifeToHand']),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('handDiscard'),
      subject: effectSubjectSchema,
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('donChange'),
      mode: z.enum(['refresh', 'rampActive', 'rampRested']),
      amount: finiteNonNegativeNumber,
    }),
    z.strictObject({
      kind: z.literal('counterModifier'),
      amount: finiteNonNegativeNumber,
      target: targetSpecSchema,
    }),
    z.strictObject({
      kind: z.literal('powerModifier'),
      powerDelta: finiteSignedNumber,
      target: targetSpecSchema,
      duration: timingModifierSchema,
    }),
    z.strictObject({
      kind: z.literal('leaderBasePower'),
      powerDelta: finiteSignedNumber,
      duration: timingModifierSchema,
    }),
    z.strictObject({
      kind: z.literal('unknown'),
      normalizedText: nonEmptyString,
    }),
  ])

export const effectBranchSchema: z.ZodType<EffectBranch> = z.strictObject({
  actions: z.array(effectActionSchema).min(1),
})

export const effectInstanceSchema: z.ZodType<EffectInstance> = z.strictObject({
  id: nonEmptyString,
  source: effectSourceSchema,
  activation: activationChannelSchema,
  timing: z.array(timingModifierSchema),
  condition: requirementExpressionSchema,
  costs: z.array(effectCostSchema),
  chooser: effectChooserSchema,
  optional: z.boolean(),
  branches: z.array(effectBranchSchema).min(1),
  rainbowLuffyCompatibility: z.enum([
    'compatible',
    'neutral',
    'incompatible',
  ]),
})

export const CURRENT_EFFECT_PARSER_REVISION = 1 as const

export const cardEffectModelSchema = z.strictObject({
  effectModelVersion: z.literal(2),
  effectParserRevision: z.literal(CURRENT_EFFECT_PARSER_REVISION),
  effects: z.array(effectInstanceSchema),
  unparsedClauses: z.array(nonEmptyString),
})

export function emptyCardPredicate(): CardPredicate {
  return {
    names: [],
    traits: [],
    cardTypes: [],
    minimumCost: null,
    maximumCost: null,
    minimumPower: null,
    maximumPower: null,
    counter: 'any',
    hasTrigger: null,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

export function createCardEffectModel(
  input: Omit<CardEffectModel, 'effectModelVersion' | 'effectParserRevision'>,
): CardEffectModel {
  const parsed = cardEffectModelSchema.parse({
    effectModelVersion: 2,
    effectParserRevision: CURRENT_EFFECT_PARSER_REVISION,
    ...input,
  })
  return deepFreeze(structuredClone(parsed))
}
