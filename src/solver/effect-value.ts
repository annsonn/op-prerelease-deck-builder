import type {
  ActivationChannel,
  EffectAction,
  EffectChooser,
  RainbowLuffyCompatibility,
  TargetSpec,
  TimingModifier,
} from '../../shared/card-effect-model.js'
import type { StrategyProfile } from '../strategy/strategy-profile.js'

export const premiumCategories = Object.freeze([
  'pressure',
  'interaction',
  'cardAdvantage',
  'lifeAdvantage',
  'donAdvantage',
  'durableDefense',
] as const)

export type PremiumCategory = (typeof premiumCategories)[number]

export interface ActionContribution {
  readonly effectId: string
  readonly branchIndex: number
  readonly actionIndex: number
  readonly category: PremiumCategory | null
  readonly rawGrossValue: number
  readonly targetSupportFactor: number
  readonly effectiveTargetCount: number
  readonly cappedGrossValue: number
  readonly activation: ActivationChannel
  readonly conditionSupportFactor: number
  readonly supportDependent: boolean
  readonly allocatedCostValue: number
  readonly netValue: number
  readonly chooser: EffectChooser
  readonly rainbowLuffyCompatibility: RainbowLuffyCompatibility
  readonly reason: string
}

export interface EffectContribution {
  readonly effectId: string
  readonly grossValue: number
  readonly costValue: number
  readonly activationFactor: number
  readonly conditionSupportFactor: number
  readonly actions: readonly ActionContribution[]
  readonly categoryValues: Readonly<Record<PremiumCategory, number>>
  readonly netValue: number
  readonly reason: string
}

export interface EffectValuation {
  readonly total: number
  readonly contributions: readonly EffectContribution[]
  readonly premiumImpact: number
  readonly premiumCategories: readonly PremiumCategory[]
}

export interface ActionTargetSupport {
  readonly factor: number
  readonly effectiveTargetCount: number
  readonly requestedTargetCount?: number
  readonly reason: string
}

export interface ActionValueContext {
  readonly profile: StrategyProfile
  readonly activation: ActivationChannel
  readonly targetSupport?: ActionTargetSupport
  readonly timing?: readonly TimingModifier[]
}

export interface ActionValue {
  readonly grossValue: number
  readonly category: PremiumCategory | null
  readonly targetSupportFactor: number
  readonly effectiveTargetCount: number
  readonly supportDependent: boolean
  readonly reason: string
}

interface ResolvedTargetSupport {
  readonly factor: number
  readonly effectiveTargetCount: number
  readonly requestedTargetCount: number | null
  readonly supportDependent: boolean
  readonly safe: boolean
  readonly reason: string
}

const ROUNDING_PLACES = 6

function stableRound(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Number(value.toFixed(ROUNDING_PLACES))
  return Object.is(rounded, -0) ? 0 : rounded
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isSafeOwnSubject(subject: TargetSpec['subject']): boolean {
  return subject === 'player' || subject === 'thisCard'
}

function isExplicitSelfTarget(target: TargetSpec): boolean {
  return target.subject === 'thisCard' && target.allowsSelf
}

function unreachableAction(action: never): never {
  throw new Error(`Unhandled effect action: ${JSON.stringify(action)}`)
}

function actionTarget(action: EffectAction): TargetSpec | null {
  switch (action.kind) {
    case 'filter':
    case 'remove':
    case 'negateEffect':
    case 'lockAttack':
    case 'deploy':
    case 'protect':
    case 'counterModifier':
    case 'powerModifier':
      return action.target
    case 'keyword':
    case 'draw':
    case 'lifeMove':
    case 'handDiscard':
    case 'donChange':
    case 'leaderBasePower':
    case 'unknown':
      return null
    default:
      return unreachableAction(action)
  }
}

function printedQuantity(target: TargetSpec): number | null {
  if (typeof target.quantity !== 'number') return null
  return isFinitePositive(target.quantity) ? target.quantity : null
}

function targetMultiplicity(
  target: TargetSpec,
  profile: StrategyProfile,
): number {
  const multipliers = profile.effectModel.targetMultipliers
  if (target.quantity === 'all' || target.quantity === 'anyNumber') {
    return multipliers.unbounded
  }
  if (!isFinitePositive(target.quantity)) return 0
  if (target.quantity === 1) return multipliers.one
  if (target.quantity === 2) return multipliers.two
  return multipliers.threeOrMore
}

function costCeilingFactor(
  target: TargetSpec,
  profile: StrategyProfile,
): number {
  const maximumCost =
    target.totalCostMaximum ?? target.predicate.maximumCost
  if (maximumCost === null) return 1
  if (!isFiniteNonNegative(maximumCost)) return 0

  const factors = profile.effectModel.costCeilingFactors
  if (maximumCost <= 2) return factors.zeroToTwo
  if (maximumCost <= 4) return factors.threeToFour
  if (maximumCost <= 6) return factors.fiveToSix
  return factors.sevenOrMore
}

function hasLongDuration(
  actionDuration: TimingModifier | null,
  contextTiming: readonly TimingModifier[],
): boolean {
  return (
    actionDuration === 'untilOpponentsNextEndPhase' ||
    contextTiming.includes('untilOpponentsNextEndPhase')
  )
}

function durationMultiplier(
  actionDuration: TimingModifier | null,
  context: ActionValueContext,
): number {
  return hasLongDuration(actionDuration, context.timing ?? [])
    ? context.profile.effectModel.longDurationMultiplier
    : 1
}

function hasUnconstrainedLeaderOption(target: TargetSpec): boolean {
  const predicate = target.predicate
  return (
    target.subject === 'player' &&
    target.zones.includes('field') &&
    target.quantity === 1 &&
    !target.differentNames &&
    target.totalCostMaximum === null &&
    predicate.cardTypes.includes('LEADER') &&
    predicate.names.length === 0 &&
    predicate.traits.length === 0 &&
    predicate.minimumCost === null &&
    predicate.maximumCost === null &&
    predicate.minimumPower === null &&
    predicate.maximumPower === null &&
    predicate.counter === 'any' &&
    predicate.hasTrigger === null
  )
}

function targetIsSupportDependent(action: EffectAction): boolean {
  const target = actionTarget(action)
  if (target === null || isExplicitSelfTarget(target)) return false

  switch (action.kind) {
    case 'filter':
    case 'deploy':
    case 'protect':
    case 'counterModifier':
      return true
    case 'powerModifier':
      return !hasUnconstrainedLeaderOption(target)
    case 'remove':
    case 'negateEffect':
    case 'lockAttack':
    case 'keyword':
    case 'draw':
    case 'lifeMove':
    case 'handDiscard':
    case 'donChange':
    case 'leaderBasePower':
    case 'unknown':
      return false
    default:
      return unreachableAction(action)
  }
}

function defaultEffectiveTargetCount(action: EffectAction): number {
  const target = actionTarget(action)
  if (target === null) return 1
  if (isExplicitSelfTarget(target)) return 1
  return printedQuantity(target) ?? 0
}

function resolveTargetSupport(
  action: EffectAction,
  context: ActionValueContext,
): ResolvedTargetSupport {
  const supportDependent = targetIsSupportDependent(action)
  const supplied = context.targetSupport

  if (!supportDependent) {
    return {
      factor: 1,
      effectiveTargetCount: defaultEffectiveTargetCount(action),
      requestedTargetCount: null,
      supportDependent: false,
      safe: true,
      reason: 'target-independent action',
    }
  }

  if (supplied !== undefined) {
    if (
      !Number.isFinite(supplied.factor) ||
      supplied.factor < 0 ||
      supplied.factor > 1 ||
      !isFiniteNonNegative(supplied.effectiveTargetCount) ||
      (supplied.requestedTargetCount !== undefined &&
        !isFinitePositive(supplied.requestedTargetCount))
    ) {
      return {
        factor: 0,
        effectiveTargetCount: 0,
        requestedTargetCount: null,
        supportDependent,
        safe: false,
        reason: 'unsafe target-support evidence was ignored',
      }
    }
    return {
      factor: stableRound(supplied.factor),
      effectiveTargetCount: stableRound(supplied.effectiveTargetCount),
      requestedTargetCount:
        supplied.requestedTargetCount === undefined
          ? null
          : stableRound(supplied.requestedTargetCount),
      supportDependent,
      safe: true,
      reason: supplied.reason || 'controlled target-support evidence',
    }
  }

  return {
    factor: 0,
    effectiveTargetCount: 0,
    requestedTargetCount: null,
    supportDependent: true,
    safe: true,
    reason: 'dynamic target support is deferred',
  }
}

function safeResult(
  grossValue: number,
  category: PremiumCategory | null,
  support: ResolvedTargetSupport,
  reason: string,
): ActionValue {
  const stableGross = stableRound(grossValue)
  const safe = Number.isFinite(grossValue)

  return Object.freeze({
    grossValue: safe ? stableGross : 0,
    category: safe ? category : null,
    targetSupportFactor: safe ? support.factor : 0,
    effectiveTargetCount: safe ? support.effectiveTargetCount : 0,
    supportDependent: support.supportDependent,
    reason: `${safe ? reason : 'unsafe action arithmetic produced zero'}; ${support.reason}`,
  })
}

function unsafeResult(
  support: ResolvedTargetSupport,
  reason: string,
): ActionValue {
  return Object.freeze({
    grossValue: 0,
    category: null,
    targetSupportFactor: support.factor,
    effectiveTargetCount: support.effectiveTargetCount,
    supportDependent: support.supportDependent,
    reason: `${reason}; ${support.reason}`,
  })
}

function interactionValue(
  baseValue: number,
  target: TargetSpec,
  context: ActionValueContext,
): number {
  return stableRound(
    baseValue *
      targetMultiplicity(target, context.profile) *
      costCeilingFactor(target, context.profile),
  )
}

function deployValue(target: TargetSpec, context: ActionValueContext): number {
  const quantity = printedQuantity(target)
  if (quantity === null) return 0

  const actions = context.profile.effectModel.actions
  const totalCostSaved =
    target.totalCostMaximum ??
    (target.predicate.maximumCost === null
      ? 0
      : target.predicate.maximumCost * quantity)
  if (!isFiniteNonNegative(totalCostSaved)) return 0

  const recursionBonus = target.zones.includes('trash')
    ? actions.trashDeployBonus
    : 0
  return stableRound(
    Math.min(
      actions.deployCap,
      actions.deployPerCard * quantity +
        actions.deployPerCostSaved * totalCostSaved +
        recursionBonus,
    ),
  )
}

function powerCategory(
  action: Extract<EffectAction, { kind: 'powerModifier' }>,
  context: ActionValueContext,
): PremiumCategory {
  if (
    context.activation === 'counter' ||
    context.activation === 'onBlock' ||
    context.activation === 'onOpponentsAttack' ||
    action.duration === 'opponentsTurn' ||
    action.duration === 'untilOpponentsNextEndPhase'
  ) {
    return 'durableDefense'
  }
  return 'pressure'
}

export function valueAction(
  action: EffectAction,
  context: ActionValueContext,
): ActionValue {
  const support = resolveTargetSupport(action, context)
  const actions = context.profile.effectModel.actions

  if (!support.safe) {
    return unsafeResult(support, 'unsafe target-support evidence produced zero')
  }

  switch (action.kind) {
    case 'keyword':
      return safeResult(
        actions.keyword,
        action.keyword === 'blocker' ? 'durableDefense' : 'pressure',
        support,
        `${action.keyword} keyword`,
      )

    case 'draw': {
      if (!isFiniteNonNegative(action.amount)) {
        return unsafeResult(support, 'unsafe draw amount produced zero')
      }
      if (action.subject === 'player') {
        return safeResult(
          action.amount * actions.ownDrawPerCard,
          'cardAdvantage',
          support,
          `player draws ${action.amount}`,
        )
      }
      if (action.subject === 'opponent') {
        return safeResult(
          action.amount * actions.opponentDrawPerCard,
          'cardAdvantage',
          support,
          `opponent draws ${action.amount}`,
        )
      }
      return unsafeResult(
        support,
        `unsupported draw subject ${action.subject} produced zero`,
      )
    }

    case 'filter': {
      if (
        action.subject !== 'player' ||
        !isFiniteNonNegative(action.lookedAt) ||
        !isFiniteNonNegative(action.kept)
      ) {
        return unsafeResult(support, 'unsafe filter subject or magnitude produced zero')
      }
      const extraSeen = Math.max(0, action.lookedAt - action.kept)
      return safeResult(
        Math.min(
          actions.filterCap,
          action.kept * actions.filterPerKept +
            extraSeen * actions.filterPerExtraSeen,
        ),
        'cardAdvantage',
        support,
        `filter keeps ${action.kept} after seeing ${action.lookedAt}`,
      )
    }

    case 'remove': {
      if (action.target.subject !== 'opponent') {
        return unsafeResult(support, 'unsafe removal subject produced zero')
      }
      if (action.mode === 'powerReduction') {
        if (
          action.powerDelta === null ||
          !Number.isFinite(action.powerDelta) ||
          action.powerDelta >= 0
        ) {
          return unsafeResult(support, 'unsafe power-reduction delta produced zero')
        }
        const value =
          (Math.abs(action.powerDelta) / 1_000) *
          actions.powerReductionPerThousand
        return safeResult(
          interactionValue(value, action.target, context),
          'interaction',
          support,
          `reduce opposing power by ${Math.abs(action.powerDelta)}`,
        )
      }

      const baseValues = {
        ko: actions.koBase,
        bottomDeck: actions.bottomDeckBase,
        returnHand: actions.returnHandBase,
        rest: actions.restBase,
      } as const
      return safeResult(
        interactionValue(baseValues[action.mode], action.target, context),
        'interaction',
        support,
        `${action.mode} interaction`,
      )
    }

    case 'negateEffect':
      if (action.target.subject !== 'opponent') {
        return unsafeResult(support, 'unsafe negation subject produced zero')
      }
      return safeResult(
        actions.negateEffectBase *
          costCeilingFactor(action.target, context.profile),
        'interaction',
        support,
        'negate opposing effect',
      )

    case 'lockAttack':
      if (action.target.subject !== 'opponent') {
        return unsafeResult(support, 'unsafe attack-lock subject produced zero')
      }
      return safeResult(
        interactionValue(actions.lockAttackBase, action.target, context) *
          durationMultiplier(action.duration, context),
        'interaction',
        support,
        `attack lock through ${action.duration}`,
      )

    case 'deploy':
      if (!isSafeOwnSubject(action.target.subject)) {
        return unsafeResult(support, 'unsafe deploy subject produced zero')
      }
      return safeResult(
        deployValue(action.target, context),
        'cardAdvantage',
        support,
        `deploy ${String(action.target.quantity)} card(s)`,
      )

    case 'protect':
      if (!isSafeOwnSubject(action.target.subject)) {
        return unsafeResult(support, 'unsafe protection subject produced zero')
      }
      return safeResult(
        actions.protectionBase * durationMultiplier(null, context),
        'durableDefense',
        support,
        'replacement protection',
      )

    case 'lifeMove':
      if (!isFiniteNonNegative(action.amount)) {
        return unsafeResult(support, 'unsafe Life movement amount produced zero')
      }
      return safeResult(
        action.amount *
          (action.direction === 'gainOwnLife'
            ? actions.ownLifeGainPerCard
            : actions.opponentLifeToHandPerCard),
        'lifeAdvantage',
        support,
        `${action.direction} ${action.amount}`,
      )

    case 'handDiscard':
      if (
        action.subject !== 'opponent' ||
        !isFiniteNonNegative(action.amount)
      ) {
        return unsafeResult(support, 'unsafe hand-discard subject or amount produced zero')
      }
      return safeResult(
        action.amount * actions.opponentDiscardPerCard,
        'cardAdvantage',
        support,
        `opponent discards ${action.amount}`,
      )

    case 'donChange': {
      if (!isFiniteNonNegative(action.amount)) {
        return unsafeResult(support, 'unsafe DON!! amount produced zero')
      }
      const perCard = {
        refresh: actions.refreshDonPerCard,
        rampActive: actions.rampActiveDonPerCard,
        rampRested: actions.rampRestedDonPerCard,
      } as const
      return safeResult(
        action.amount * perCard[action.mode],
        'donAdvantage',
        support,
        `${action.mode} ${action.amount} DON!!`,
      )
    }

    case 'counterModifier': {
      if (
        !isSafeOwnSubject(action.target.subject) ||
        !isFiniteNonNegative(action.amount)
      ) {
        return unsafeResult(support, 'unsafe counter modifier produced zero')
      }
      const valuePerTarget =
        (action.amount / 1_000) * actions.counterAuraPerThousandPerCard
      const requestedTargetCount =
        support.requestedTargetCount ??
        (isExplicitSelfTarget(action.target)
          ? (printedQuantity(action.target) ?? 1)
          : valuePerTarget > 0
            ? actions.counterAuraCap / valuePerTarget
            : 0)
      return safeResult(
        Math.min(actions.counterAuraCap, valuePerTarget * requestedTargetCount),
        'durableDefense',
        support,
        `counter modifier ${action.amount} across ${requestedTargetCount} requested target(s)`,
      )
    }

    case 'powerModifier': {
      if (
        !isSafeOwnSubject(action.target.subject) ||
        !isFinitePositive(action.powerDelta)
      ) {
        return unsafeResult(support, 'unsafe own-power modifier produced zero')
      }
      const perThousand =
        context.activation === 'counter'
          ? actions.counterPerThousand
          : actions.ownPowerPerThousandPerTarget
      return safeResult(
        (action.powerDelta / 1_000) *
          perThousand *
          targetMultiplicity(action.target, context.profile),
        powerCategory(action, context),
        support,
        `own power gains ${action.powerDelta}`,
      )
    }

    case 'leaderBasePower':
      if (!isFinitePositive(action.powerDelta)) {
        return unsafeResult(support, 'unsafe Leader power delta produced zero')
      }
      if (action.duration !== 'untilOpponentsNextEndPhase') {
        return unsafeResult(
          support,
          'long-duration Leader shield is unavailable at shorter duration',
        )
      }
      return safeResult(
        (action.powerDelta / 1_000) * actions.leaderShieldPerThousand,
        'durableDefense',
        support,
        `Leader base power gains ${action.powerDelta}`,
      )

    case 'unknown':
      return unsafeResult(
        support,
        `unknown action "${action.normalizedText}" produced zero`,
      )
  }
}
