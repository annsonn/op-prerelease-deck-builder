import type {
  ActivationChannel,
  EffectAction,
  EffectChooser,
  EffectCost,
  EffectInstance,
  RainbowLuffyCompatibility,
  TargetSpec,
  TimingModifier,
} from '../../shared/card-effect-model.js'
import type { StrategyProfile } from '../strategy/strategy-profile.js'
import type { CandidateCard, DeckState, PoolSupport } from './deck-state.js'
import { evaluateRequirementSupport, evaluateTargetSupport } from './effect-support.js'

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

interface BranchActionValue {
  readonly actionIndex: number
  readonly value: ActionValue
  readonly targetAdjustedGrossValue: number
}

interface BranchValue {
  readonly branchIndex: number
  readonly actions: readonly BranchActionValue[]
  readonly grossValue: number
}

interface InstanceValueOptions {
  readonly activationFactorOverride?: number
  readonly availabilityReason?: string
}

function stableSum(values: readonly number[]): number {
  return stableRound(values.reduce((sum, value) => sum + value, 0))
}

function valueCost(cost: EffectCost, profile: StrategyProfile): number {
  const values = profile.effectModel.costs
  switch (cost.kind) {
    case 'playEventDon':
      return isFiniteNonNegative(cost.amount)
        ? stableRound(cost.amount * values.playEventDonPerCard)
        : 0
    case 'donMinus':
      return isFiniteNonNegative(cost.amount)
        ? stableRound(cost.amount * values.donMinusPerCard)
        : 0
    case 'restDon':
      return isFiniteNonNegative(cost.amount)
        ? stableRound(cost.amount * values.restDonPerCard)
        : 0
    case 'discardHand':
      return isFiniteNonNegative(cost.amount)
        ? stableRound(cost.amount * values.discardHandPerCard)
        : 0
    case 'trashSelf':
      return stableRound(values.trashSelf)
    case 'restSelf':
      return stableRound(values.restSelf)
  }
}

function valueBranch(
  instance: EffectInstance,
  branchIndex: number,
  profile: StrategyProfile,
  state: DeckState,
  poolSupport: PoolSupport,
): BranchValue {
  const branch = instance.branches[branchIndex]
  if (branch === undefined) {
    return Object.freeze({ branchIndex, actions: Object.freeze([]), grossValue: 0 })
  }
  const actions = branch.actions.map((action, actionIndex) => {
    const target = actionTarget(action)
    const targetSupport = target === null ? undefined : evaluateTargetSupport(target, state, poolSupport, profile)
    const actionValue = valueAction(action, {
      profile,
      activation: instance.activation,
      timing: instance.timing,
      targetSupport,
    })
    return Object.freeze({
      actionIndex,
      value: actionValue,
      targetAdjustedGrossValue: stableRound(
        actionValue.grossValue * actionValue.targetSupportFactor,
      ),
    })
  })
  return Object.freeze({
    branchIndex,
    actions: Object.freeze(actions),
    grossValue: stableSum(actions.map((action) => action.targetAdjustedGrossValue)),
  })
}

function chooseBranch(
  instance: EffectInstance,
  profile: StrategyProfile,
  state: DeckState,
  poolSupport: PoolSupport,
): BranchValue {
  const branches = instance.branches.map((_, branchIndex) =>
    valueBranch(instance, branchIndex, profile, state, poolSupport),
  )
  const first = branches[0] ?? Object.freeze({
    branchIndex: 0,
    actions: Object.freeze([]),
    grossValue: 0,
  })
  if (instance.chooser === 'none') return first

  return branches.slice(1).reduce((selected, branch) => {
    if (instance.chooser === 'player') {
      return branch.grossValue > selected.grossValue ? branch : selected
    }
    return branch.grossValue < selected.grossValue ? branch : selected
  }, first)
}

function allocateProportionally(
  weights: readonly number[],
  total: number,
): readonly number[] {
  const positiveIndexes = weights
    .map((weight, index) => ({ weight, index }))
    .filter(({ weight }) => weight > 0)
  const allocations = weights.map(() => 0)
  const totalWeight = positiveIndexes.reduce(
    (sum, { weight }) => sum + weight,
    0,
  )
  const roundedTotal = stableRound(total)
  const scale = 10 ** ROUNDING_PLACES
  const totalUnits = Math.round(roundedTotal * scale)
  if (
    positiveIndexes.length === 0 ||
    !Number.isFinite(totalWeight) ||
    totalWeight <= 0 ||
    totalUnits <= 0
  ) {
    return Object.freeze(allocations)
  }

  const shares = positiveIndexes.map(({ weight, index }) => {
    const exactUnits = (totalUnits * weight) / totalWeight
    const wholeUnits = Math.floor(exactUnits)
    return {
      index,
      wholeUnits,
      fractionalUnits: exactUnits - wholeUnits,
    }
  })
  let remainingUnits =
    totalUnits - shares.reduce((sum, share) => sum + share.wholeUnits, 0)
  const residueOrder = [...shares].sort(
    (left, right) =>
      right.fractionalUnits - left.fractionalUnits || left.index - right.index,
  )
  for (let index = 0; remainingUnits > 0; index += 1) {
    residueOrder[index % residueOrder.length]!.wholeUnits += 1
    remainingUnits -= 1
  }
  shares.forEach(({ index, wholeUnits }) => {
    allocations[index] = stableRound(wholeUnits / scale)
  })
  return Object.freeze(allocations)
}

function capBranchValues(
  actions: readonly BranchActionValue[],
  cap: number,
): readonly number[] {
  const adjusted = actions.map((action) => action.targetAdjustedGrossValue)
  if (stableSum(adjusted) <= cap) return Object.freeze(adjusted)

  const nonPositiveSubtotal = stableSum(adjusted.filter((value) => value <= 0))
  const positive = adjusted.map((value) => (value > 0 ? value : 0))
  const cappedPositive = allocateProportionally(
    positive,
    stableRound(cap - nonPositiveSubtotal),
  )
  return Object.freeze(
    adjusted.map((value, index) => (value > 0 ? cappedPositive[index]! : value)),
  )
}

function emptyCategoryValues(): Record<PremiumCategory, number> {
  return {
    pressure: 0,
    interaction: 0,
    cardAdvantage: 0,
    lifeAdvantage: 0,
    donAdvantage: 0,
    durableDefense: 0,
  }
}

function reconcileCategoryValues(
  actions: readonly ActionContribution[],
  netValue: number,
): Readonly<Record<PremiumCategory, number>> {
  const subtotals = emptyCategoryValues()
  for (const action of actions) {
    if (action.category !== null) {
      subtotals[action.category] = stableRound(
        subtotals[action.category] + action.netValue,
      )
    }
  }
  if (netValue <= 0) return Object.freeze(emptyCategoryValues())

  const weights = premiumCategories.map((category) =>
    Math.max(0, subtotals[category]),
  )
  const allocated = allocateProportionally(weights, netValue)
  const result = emptyCategoryValues()
  premiumCategories.forEach((category, index) => {
    result[category] = allocated[index] ?? 0
  })
  return Object.freeze(result)
}

function valueEffectInstance(
  instance: EffectInstance,
  profile: StrategyProfile,
  state: DeckState,
  poolSupport: PoolSupport,
  options: InstanceValueOptions = {},
): EffectContribution {
  const selectedBranch = chooseBranch(instance, profile, state, poolSupport)
  const cappedValues = capBranchValues(
    selectedBranch.actions,
    profile.effectModel.effectInstanceCap,
  )
  const costValue = stableSum(
    instance.costs.map((cost) => valueCost(cost, profile)),
  )
  const positiveCappedValues = cappedValues.map((value) =>
    value > 0 ? value : 0,
  )
  const hasPositiveCappedValue = positiveCappedValues.some((value) => value > 0)
  const allocatedCosts = hasPositiveCappedValue
    ? allocateProportionally(positiveCappedValues, costValue)
    : Object.freeze(
        positiveCappedValues.map((_, index) =>
          index === 0 ? costValue : 0,
        ),
      )

  const condition = instance.rainbowLuffyCompatibility === 'incompatible'
    ? { factor: 0, reason: 'incompatible structured effect' }
    : evaluateRequirementSupport(instance.condition, state, poolSupport, profile)
  const activationFactor = stableRound(
    options.activationFactorOverride ??
      profile.effectModel.activationFactors[instance.activation],
  )
  const calculatedNetValues = selectedBranch.actions.map((_, index) =>
    stableRound(
      (cappedValues[index]! - (allocatedCosts[index] ?? 0)) *
        activationFactor *
        condition.factor,
    ),
  )
  const unclampedNetValue = stableSum(calculatedNetValues)
  const optionalClamp = instance.optional && unclampedNetValue <= 0
  const actions = selectedBranch.actions.map((action, index) => {
    const cappedGrossValue = cappedValues[index]!
    const allocatedCostValue = allocatedCosts[index] ?? 0
    const netValue = optionalClamp ? 0 : calculatedNetValues[index]!
    return Object.freeze({
      effectId: instance.id,
      branchIndex: selectedBranch.branchIndex,
      actionIndex: action.actionIndex,
      category: action.value.category,
      rawGrossValue: action.value.grossValue,
      targetSupportFactor: action.value.targetSupportFactor,
      effectiveTargetCount: action.value.effectiveTargetCount,
      cappedGrossValue,
      activation: instance.activation,
      conditionSupportFactor: condition.factor,
      supportDependent: action.value.supportDependent,
      allocatedCostValue,
      netValue,
      chooser: instance.chooser,
      rainbowLuffyCompatibility: instance.rainbowLuffyCompatibility,
      reason: `${action.value.reason}; raw gross ${action.value.grossValue}; target support ${action.value.targetSupportFactor}; effective targets ${action.value.effectiveTargetCount}; target-adjusted ${action.targetAdjustedGrossValue}; capped gross ${cappedGrossValue}; allocated cost ${allocatedCostValue}; activation ${instance.activation} factor ${activationFactor}; condition support ${condition.factor}; support dependent ${String(action.value.supportDependent)}; chooser ${instance.chooser}; compatibility ${instance.rainbowLuffyCompatibility}; net ${netValue}`,
    }) satisfies ActionContribution
  })
  const netValue = optionalClamp ? 0 : stableSum(actions.map((action) => action.netValue))
  const grossValue = stableSum(cappedValues)
  const categoryValues = reconcileCategoryValues(actions, netValue)
  const reasonParts = [
    `effect ${instance.id}`,
    `branch ${selectedBranch.branchIndex}`,
    `gross ${grossValue}`,
    `cost ${costValue}`,
    `activation ${activationFactor}`,
    `condition ${condition.factor}`,
    `net ${netValue}`,
    condition.reason,
  ]
  if (options.availabilityReason !== undefined) {
    reasonParts.push(options.availabilityReason)
  }
  if (optionalClamp) reasonParts.push('optional loss clamped to zero')

  return Object.freeze({
    effectId: instance.id,
    grossValue,
    costValue,
    activationFactor,
    conditionSupportFactor: condition.factor,
    actions: Object.freeze(actions),
    categoryValues,
    netValue,
    reason: reasonParts.join('; '),
  })
}

interface EventMode {
  readonly activation: ActivationChannel
  readonly instances: readonly EffectInstance[]
}

function groupEventModes(
  instances: readonly EffectInstance[],
): readonly EventMode[] {
  const groups: { activation: ActivationChannel; instances: EffectInstance[] }[] = []
  for (const instance of instances) {
    const existing = groups.find((group) => group.activation === instance.activation)
    if (existing === undefined) {
      groups.push({ activation: instance.activation, instances: [instance] })
    } else {
      existing.instances.push(instance)
    }
  }
  return Object.freeze(
    groups.map((group) =>
      Object.freeze({
        activation: group.activation,
        instances: Object.freeze(group.instances),
      }),
    ),
  )
}

interface ModeActionReference {
  readonly contributionIndex: number
  readonly actionIndex: number
  readonly weight: number
}

function applyEventModeCost(
  contributions: readonly EffectContribution[],
  instances: readonly EffectInstance[],
  rawModeCost: number,
  activationFactor: number,
): readonly EffectContribution[] {
  const positiveActions: ModeActionReference[] = []
  contributions.forEach((contribution, contributionIndex) => {
    contribution.actions.forEach((action, actionIndex) => {
      if (action.netValue > 0) {
        positiveActions.push({
          contributionIndex,
          actionIndex,
          weight: action.netValue,
        })
      }
    })
  })

  const firstUsableMandatoryAction = contributions.flatMap(
    (contribution, contributionIndex) => {
      const instance = instances[contributionIndex]
      if (
        instance === undefined ||
        instance.optional ||
        contribution.activationFactor <= 0 ||
        contribution.conditionSupportFactor <= 0
      ) {
        return []
      }
      return contribution.actions.length === 0
        ? []
        : [{ contributionIndex, actionIndex: 0, weight: 1 }]
    },
  )[0]
  const mandatoryPositiveActions = positiveActions.filter(
    ({ contributionIndex }) =>
      instances[contributionIndex]?.optional === false,
  )
  const hasUsableMandatoryClause = firstUsableMandatoryAction !== undefined
  const allocationTargets =
    hasUsableMandatoryClause
      ? mandatoryPositiveActions.length > 0
        ? mandatoryPositiveActions
        : [firstUsableMandatoryAction]
      : positiveActions
  const usesMandatoryFallback =
    hasUsableMandatoryClause && mandatoryPositiveActions.length === 0

  if (allocationTargets.length === 0 || rawModeCost <= 0) {
    const reason =
      allocationTargets.length === 0
        ? 'Event printed cost not allocated: no positive usable mode evidence and no usable mandatory mode action'
        : 'Event printed cost is zero'
    return Object.freeze(
      contributions.map((contribution) =>
        Object.freeze({
          ...contribution,
          reason: `${contribution.reason}; ${reason}`,
        }),
      ),
    )
  }

  const weights = allocationTargets.map((reference) => reference.weight)
  const rawAllocations = allocateProportionally(weights, rawModeCost)
  const effectiveModeCost = stableRound(rawModeCost * activationFactor)
  const effectiveAllocations = allocateProportionally(
    weights,
    effectiveModeCost,
  )
  const allocationByAction = new Map<
    string,
    Readonly<{ raw: number; effective: number }>
  >()
  allocationTargets.forEach((reference, index) => {
    allocationByAction.set(
      `${reference.contributionIndex}:${reference.actionIndex}`,
      Object.freeze({
        raw: rawAllocations[index] ?? 0,
        effective: effectiveAllocations[index] ?? 0,
      }),
    )
  })

  const adjustedContributions = Object.freeze(
    contributions.map((contribution, contributionIndex) => {
      const actionAllocations = contribution.actions.map((_, actionIndex) =>
        allocationByAction.get(`${contributionIndex}:${actionIndex}`) ?? {
          raw: 0,
          effective: 0,
        },
      )
      const provisionallyAdjustedActions = contribution.actions.map(
        (action, actionIndex) => {
          const allocation = actionAllocations[actionIndex]!
          const allocatedCostValue = stableRound(
            action.allocatedCostValue + allocation.raw,
          )
          const netValue = stableRound(action.netValue - allocation.effective)
          return Object.freeze({
            ...action,
            allocatedCostValue,
            netValue,
            reason: `${action.reason}; Event mode cost raw ${allocation.raw}; Event mode cost after activation ${allocation.effective}; ${usesMandatoryFallback && allocation.raw > 0 ? 'Event printed cost allocated to first usable mandatory action; ' : ''}mode-adjusted net ${netValue}`,
          })
        },
      )
      const actions = Object.freeze(provisionallyAdjustedActions)
      const allocatedRawCost = stableSum(
        actionAllocations.map((allocation) => allocation.raw),
      )
      const allocatedEffectiveCost = stableSum(
        actionAllocations.map((allocation) => allocation.effective),
      )
      const costValue = stableRound(
        contribution.costValue + allocatedRawCost,
      )
      const netValue = stableSum(actions.map((action) => action.netValue))
      return Object.freeze({
        ...contribution,
        costValue,
        actions,
        categoryValues: reconcileCategoryValues(actions, netValue),
        netValue,
        reason: `${contribution.reason}; Event mode cost raw ${allocatedRawCost}; Event mode cost after activation ${allocatedEffectiveCost}; ${usesMandatoryFallback && allocatedRawCost > 0 ? 'Event printed cost allocated to first usable mandatory action; ' : ''}mode-adjusted net ${netValue}`,
      })
    }),
  )
  const modeNetValue = stableSum(
    adjustedContributions.map((contribution) => contribution.netValue),
  )
  const finalContributions =
    !hasUsableMandatoryClause && modeNetValue <= 0
      ? clampOptionalEventMode(adjustedContributions)
      : adjustedContributions
  return finalContributions
}

function clampOptionalEventMode(
  contributions: readonly EffectContribution[],
): readonly EffectContribution[] {
  return Object.freeze(
    contributions.map((contribution) => {
      const actions = Object.freeze(
        contribution.actions.map((action) =>
          Object.freeze({
            ...action,
            netValue: 0,
            reason: `${action.reason}; optional mode loss clamped to zero`,
          }),
        ),
      )
      return Object.freeze({
        ...contribution,
        actions,
        categoryValues: Object.freeze(emptyCategoryValues()),
        netValue: 0,
        reason: `${contribution.reason}; optional mode loss clamped to zero`,
      })
    }),
  )
}

function valueEventMode(
  mode: EventMode,
  printedCost: number | null,
  profile: StrategyProfile,
  state: DeckState,
  poolSupport: PoolSupport,
): readonly EffectContribution[] {
  const paysPrintedCost = mode.activation === 'main' || mode.activation === 'counter'
  const missingPrintedCost = paysPrintedCost && printedCost === null
  const contributions = Object.freeze(
    mode.instances.map((instance) =>
      valueEffectInstance(instance, profile, state, poolSupport, {
        activationFactorOverride: missingPrintedCost ? 0 : undefined,
        availabilityReason: missingPrintedCost
          ? 'missing printed Event cost makes this mode unavailable'
          : undefined,
      }),
    ),
  )
  if (!paysPrintedCost || printedCost === null) return contributions

  return applyEventModeCost(
    contributions,
    mode.instances,
    valueCost({ kind: 'playEventDon', amount: printedCost }, profile),
    profile.effectModel.activationFactors[mode.activation],
  )
}

function contributionTotal(
  contributions: readonly EffectContribution[],
): number {
  return stableSum(contributions.map((contribution) => contribution.netValue))
}

function chosenCardContributions(
  candidate: CandidateCard,
  profile: StrategyProfile,
  state: DeckState,
  poolSupport: PoolSupport,
): readonly EffectContribution[] {
  if (candidate.card.cardType !== 'EVENT') {
    return Object.freeze(
      candidate.features.effects.map((instance) =>
        valueEffectInstance(instance, profile, state, poolSupport),
      ),
    )
  }

  const modes = groupEventModes(candidate.features.effects)
  const first = modes[0]
  if (first === undefined) return Object.freeze([])
  let selected = valueEventMode(first, candidate.card.cost, profile, state, poolSupport)
  let selectedTotal = contributionTotal(selected)
  for (const mode of modes.slice(1)) {
    const valued = valueEventMode(mode, candidate.card.cost, profile, state, poolSupport)
    const total = contributionTotal(valued)
    if (total > selectedTotal) {
      selected = valued
      selectedTotal = total
    }
  }
  return selected
}

export function valueCardEffects(
  candidate: CandidateCard,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): EffectValuation {
  const contributions = chosenCardContributions(candidate, profile, state, poolSupport)
  const total = contributionTotal(contributions)
  const suppressEventPremium =
    candidate.card.cardType === 'EVENT' && total <= 0
  const categorySeen = new Set<PremiumCategory>()
  const orderedCategories: PremiumCategory[] = []
  if (!suppressEventPremium) {
    for (const contribution of contributions) {
      for (const action of contribution.actions) {
        const category = action.category
        if (
          category !== null &&
          contribution.categoryValues[category] > 0 &&
          !categorySeen.has(category)
        ) {
          categorySeen.add(category)
          orderedCategories.push(category)
        }
      }
    }
  }
  const premiumImpact = suppressEventPremium
    ? 0
    : stableSum(
        contributions.flatMap((contribution) =>
          premiumCategories.map(
            (category) => contribution.categoryValues[category],
          ),
        ),
      )
  return Object.freeze({
    total,
    contributions,
    premiumImpact,
    premiumCategories: Object.freeze(orderedCategories),
  })
}
