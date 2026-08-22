import {
  hasStructuredInteraction,
  type CardFeatureKey,
} from '../../shared/card-features.js'
import type { SoftTargetRole, StrategyProfile } from '../strategy/strategy-profile.js'

import {
  countMatchingSupport,
  type CandidateCard,
  type DeckState,
  type MatchSupportTargets,
  type PoolSupport,
} from './deck-state.js'
import { valueCardEffects } from './effect-value.js'

export const marginalScoreComponentOrder = Object.freeze([
  'standalonePower',
  'standaloneCounter',
  'targetTwoKCounter',
  'targetBlocker',
  'targetVanillaLike',
  'targetInteraction',
  'targetBoss',
  'curveEarly',
  'curveMiddle',
  'curveLate',
  'curveLateSaturation',
  'curveHighCost',
  'curveHighCostSaturation',
  'brickPenalty',
  'effectQuality',
  'compatibilityEffect',
  'searcherSupport',
  'comboSupport',
  'redundancyEffect',
  'redundancyRole',
  'premiumBombFloor',
] as const)

export type MarginalScoreComponent =
  (typeof marginalScoreComponentOrder)[number]

export const marginalScoreComponentLabels: Readonly<
  Record<MarginalScoreComponent, string>
> = Object.freeze({
  standalonePower: 'Printed body efficiency',
  standaloneCounter: 'Printed counter value',
  targetTwoKCounter: '2K counter target',
  targetBlocker: 'Blocker target',
  targetVanillaLike: 'Vanilla-like target',
  targetInteraction: 'Interaction target',
  targetBoss: 'Boss target',
  curveEarly: 'Early curve need',
  curveMiddle: 'Middle curve need',
  curveLate: 'Late curve need',
  curveLateSaturation: 'Late curve saturation',
  curveHighCost: 'High-cost curve need',
  curveHighCostSaturation: 'High-cost curve saturation',
  brickPenalty: 'Brick risk beyond tolerance',
  effectQuality: 'Structured effect value',
  compatibilityEffect: 'Rainbow Luffy conditional-effect compatibility',
  searcherSupport: 'Searcher support',
  comboSupport: 'Combo support',
  redundancyEffect: 'Repeated usable effect copies',
  redundancyRole: 'Satisfied-role redundancy',
  premiumBombFloor: 'First-copy premium bomb floor',
})

export interface MarginalScore {
  readonly total: number
  readonly components: Readonly<Record<string, number>>
  readonly reasonsByComponent: Readonly<
    Partial<Record<MarginalScoreComponent, string>>
  >
  readonly reasons: readonly string[]
}

type Component = readonly [
  name: MarginalScoreComponent,
  value: number,
  reason: string,
]

const TARGET_COMPONENTS: readonly Readonly<{
  role: SoftTargetRole
  flag: CardFeatureKey | 'interaction'
  component: MarginalScoreComponent
  label: string
}>[] = [
  {
    role: 'twoKCounter',
    flag: 'twoKCounter',
    component: 'targetTwoKCounter',
    label: '2K counter target',
  },
  {
    role: 'blocker',
    flag: 'blocker',
    component: 'targetBlocker',
    label: 'Blocker target',
  },
  {
    role: 'vanillaLike',
    flag: 'vanillaLike',
    component: 'targetVanillaLike',
    label: 'Vanilla-like target',
  },
  {
    role: 'interaction',
    flag: 'interaction',
    component: 'targetInteraction',
    label: 'Interaction target',
  },
  {
    role: 'boss',
    flag: 'boss',
    component: 'targetBoss',
    label: 'Boss target',
  },
]

function hasRole(
  candidate: CandidateCard,
  role: CardFeatureKey | 'interaction',
): boolean {
  const flags = candidate.features.rainbowUsableFlags
  return role === 'interaction'
    ? hasStructuredInteraction(candidate.features)
    : flags[role]
}

function printedBodyValue(
  candidate: CandidateCard,
  profile: StrategyProfile,
): number {
  if (
    candidate.card.cardType !== 'CHARACTER' ||
    candidate.card.power === null
  ) {
    return 0
  }
  return (
    (candidate.card.power / 1000 - (candidate.card.cost ?? 0)) *
    profile.weights.standalone.cardPower
  )
}

function stableNumber(value: number): number {
  return Number(value.toFixed(6))
}

function countCosts(
  state: DeckState,
  minimumCost: number,
  maximumCost = Number.POSITIVE_INFINITY,
): number {
  return Object.entries(state.costCounts).reduce((sum, [cost, count]) => {
    const numericCost = Number(cost)
    return numericCost >= minimumCost && numericCost <= maximumCost
      ? sum + count
      : sum
  }, 0)
}

function deficitContribution(
  weight: number,
  target: number,
  current: number,
  floorPercent = 0,
): number {
  if (target <= 0 || current >= target) return 0
  const deficitRatio = (target - current) / target
  return weight * Math.max(deficitRatio, floorPercent / 100)
}

function matchesTargets(
  candidate: CandidateCard,
  targets: MatchSupportTargets,
): boolean {
  const names = new Set(targets.names)
  const traits = new Set(targets.traits)
  return (
    names.has(candidate.card.name) ||
    candidate.card.traits.some((trait) => traits.has(trait))
  )
}

function supportRatio(count: number, threshold: number): number {
  if (threshold <= 0) return 1
  return Math.min(1, Math.max(0, count / threshold))
}

function dynamicSupport(
  candidate: CandidateCard,
  state: DeckState,
  poolSupport: PoolSupport,
  targets: MatchSupportTargets,
  threshold: number,
  weight: number,
): Readonly<{ selected: number; poolPotential: number; value: number }> {
  const selected = countMatchingSupport(state, targets)
  const poolMatches = countMatchingSupport(poolSupport, targets)
  const currentCandidateIsInPool =
    (poolSupport.byCardNumber[candidate.card.cardNumber] ?? 0) > 0
  const poolPotential = Math.max(
    0,
    poolMatches -
      (currentCandidateIsInPool && matchesTargets(candidate, targets) ? 1 : 0),
  )
  const value =
    weight *
    (supportRatio(selected, threshold) +
      supportRatio(poolPotential, threshold) -
      1)
  return { selected, poolPotential, value }
}

function freezeResult(entries: readonly Component[]): MarginalScore {
  const pending = new Map<
    MarginalScoreComponent,
    Readonly<{ value: number; reason: string }>
  >()
  const components = Object.create(null) as Record<string, number>
  const reasonsByComponent = Object.create(null) as Partial<
    Record<MarginalScoreComponent, string>
  >
  const reasons: string[] = []

  for (const [name, rawValue, reason] of entries) {
    if (!Number.isFinite(rawValue)) {
      throw new RangeError(
        `Marginal score component "${name}" must be a finite number.`,
      )
    }
    const value = stableNumber(rawValue)
    if (value === 0) continue
    pending.set(name, { value, reason })
  }

  for (const component of marginalScoreComponentOrder) {
    const entry = pending.get(component)
    if (entry === undefined) continue
    components[component] = entry.value
    reasonsByComponent[component] = entry.reason
    reasons.push(entry.reason)
  }

  const rawTotal = Object.values(components).reduce(
    (sum, value) => sum + value,
    0,
  )
  if (!Number.isFinite(rawTotal)) {
    throw new RangeError('Marginal score total must be a finite number.')
  }
  const total = stableNumber(rawTotal)
  return Object.freeze({
    total,
    components: Object.freeze(components),
    reasonsByComponent: Object.freeze(reasonsByComponent),
    reasons: Object.freeze(reasons),
  })
}

function scoreCandidate(
  candidate: CandidateCard,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): MarginalScore {
  const effectValuation = valueCardEffects(
    candidate,
    state,
    poolSupport,
    profile,
  )
  const entries: Component[] = [
    [
      'standalonePower',
      printedBodyValue(candidate, profile),
      'Printed body efficiency value',
    ],
    [
      'standaloneCounter',
      ((candidate.card.counter ?? 0) / 1000) *
        (state.totalCounter >=
          profile.analysis.totalCounter.scoringSaturationMinimum
          ? profile.weights.standalone.saturatedCounterValue
          : profile.weights.standalone.counterValue),
      'Printed counter value',
    ],
  ]

  for (const { role, flag, component, label } of TARGET_COMPONENTS) {
    if (!hasRole(candidate, flag)) continue
    const target = profile.targets[role]
    const contribution = deficitContribution(
      profile.weights.softTargets[role],
      target,
      state.coverage[role],
      profile.weights.softTargetFloorPercent[role],
    )
    entries.push([component, contribution, `${label}: ${stableNumber(contribution)}`])
  }

  const cost = candidate.card.cost
  if (cost !== null) {
    const { early, middle, late, highCost } = profile.curve
    if (cost >= early.minimumCost && cost <= early.maximumCost) {
      const current = countCosts(state, early.minimumCost, early.maximumCost)
      const value = deficitContribution(
        profile.weights.curve.early,
        early.target,
        current,
      )
      entries.push(['curveEarly', value, `Early curve need: ${stableNumber(value)}`])
    }
    if (cost >= middle.minimumCost && cost <= middle.maximumCost) {
      const current = countCosts(state, middle.minimumCost, middle.maximumCost)
      const value = deficitContribution(
        profile.weights.curve.middle,
        middle.target,
        current,
      )
      entries.push(['curveMiddle', value, `Middle curve need: ${stableNumber(value)}`])
    }
    if (cost >= late.minimumCost) {
      const current = countCosts(state, late.minimumCost)
      const value = deficitContribution(
        profile.weights.curve.late,
        late.minimum,
        current,
      )
      entries.push(['curveLate', value, `Late curve need: ${stableNumber(value)}`])
      if (current >= late.maximum) {
        entries.push([
          'curveLateSaturation',
          -profile.weights.redundancy.effect,
          'Late curve is saturated',
        ])
      }
    }
    if (cost >= highCost.minimumCost) {
      const current = countCosts(state, highCost.minimumCost)
      const value = deficitContribution(
        profile.weights.curve.highCost,
        highCost.minimum,
        current,
      )
      entries.push([
        'curveHighCost',
        value,
        `High-cost curve need: ${stableNumber(value)}`,
      ])
      if (current >= highCost.maximum) {
        entries.push([
          'curveHighCostSaturation',
          -profile.weights.redundancy.effect,
          'High-cost curve is saturated',
        ])
      }
    }
  }

  if (candidate.features.flags.brick) {
    const excess = state.brickCount + 1 - profile.limits.brickTolerance
    const progressive = profile.weights.progressiveBricks
    const penalty =
      excess <= 0
        ? 0
        : excess === 1
          ? progressive.first
          : excess === 2
            ? progressive.second
            : excess === 3
              ? progressive.third
              : progressive.fourthOrMore
    entries.push(['brickPenalty', -penalty, `Brick risk beyond tolerance: ${penalty}`])
  }

  if (effectValuation.total !== 0) {
    entries.push([
      'effectQuality',
      effectValuation.total,
      `Structured effect value: ${effectValuation.contributions
        .map((contribution) => contribution.reason)
        .join(' | ')}`,
    ])
  }

  if (candidate.features.rainbowUsableFlags.searcher) {
    const support = dynamicSupport(
      candidate,
      state,
      poolSupport,
      {
        names: candidate.features.searchableNames,
        traits: candidate.features.searchableTraits,
      },
      profile.limits.searcherMinimumTargets,
      profile.weights.synergy.searcher,
    )
    entries.push([
      'searcherSupport',
      support.value,
      `Searcher support selected ${support.selected}, pool potential ${support.poolPotential}: ${stableNumber(support.value)}`,
    ])
  }

  const selectedCopies =
    state.selectedCountsByCardNumber[candidate.card.cardNumber] ?? 0
  const hasUsableEffect = effectValuation.contributions.some(
    (contribution) =>
      contribution.actions.some((action) => action.netValue > 0),
  )
  if (selectedCopies > 0 && hasUsableEffect) {
    entries.push([
      'redundancyEffect',
      -profile.weights.redundancy.effect * selectedCopies,
      `Repeated usable effect copies: ${selectedCopies}`,
    ])
  }

  const applicableTargetRoles = TARGET_COMPONENTS.filter(({ flag }) =>
    hasRole(candidate, flag),
  )
  const hasSaturatedRole =
    applicableTargetRoles.length > 0 &&
    applicableTargetRoles.every(
      ({ role }) => state.coverage[role] >= profile.targets[role],
    )
  if (hasSaturatedRole) {
    entries.push([
      'redundancyRole',
      -profile.weights.redundancy.role,
      'Candidate roles are already satisfied',
    ])
  }

  const usableFlags = candidate.features.rainbowUsableFlags
  const isPremiumBomb =
    candidate.card.cardType === 'CHARACTER' &&
    usableFlags.boss &&
    usableFlags.rush &&
    usableFlags.massRest &&
    usableFlags.donRefresh
  if (selectedCopies === 0 && isPremiumBomb) {
    const provisionalScore = freezeResult(entries).total
    const floorContribution =
      profile.limits.premiumBombFirstCopyFloor - provisionalScore
    if (floorContribution > 0) {
      entries.push([
        'premiumBombFloor',
        floorContribution,
        `First-copy premium bomb floor: ${stableNumber(floorContribution)}`,
      ])
    }
  }

  return freezeResult(entries)
}

export function scoreMarginalCandidate(
  candidate: CandidateCard,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): MarginalScore {
  if (state.size >= 40) {
    throw new RangeError(
      'Cannot score a marginal candidate for a full 40-card deck.',
    )
  }
  return scoreCandidate(candidate, state, poolSupport, profile)
}

export function scoreCandidateAgainstCompletedDeck(
  candidate: CandidateCard,
  completedState: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): MarginalScore {
  if (completedState.size !== 40) {
    throw new RangeError('Completed-deck scoring requires exactly 40 cards.')
  }
  return scoreCandidate(candidate, completedState, poolSupport, profile)
}
