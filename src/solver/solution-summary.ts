import type {
  SoftTargetRole,
  StrategyProfile,
} from '../strategy/strategy-profile.js'

import type {
  AllocatedRole,
  DeckAnalysis,
  DeckSolution,
} from './types.js'

export interface SolutionSummary {
  readonly curve: DeckSolution['curve']
  readonly roleCoverage: DeckSolution['roleCoverage']
  readonly totalCounter: number
  readonly warnings: readonly string[]
}

const targetedRoleWarnings: readonly Readonly<{
  role: SoftTargetRole
  noun: string
}>[] = Object.freeze([
  Object.freeze({ role: 'twoKCounter', noun: '2K counters' }),
  Object.freeze({ role: 'blocker', noun: 'blockers' }),
  Object.freeze({ role: 'vanillaLike', noun: 'vanilla-like bodies' }),
  Object.freeze({ role: 'interaction', noun: 'interaction cards' }),
  Object.freeze({ role: 'boss', noun: 'bosses' }),
])

function curveBucket(
  costValue: number | null,
): keyof DeckSolution['curve'] {
  const cost = costValue ?? 0
  if (cost <= 2) return '0-2'
  if (cost <= 4) return '3-4'
  if (cost <= 6) return '5-6'
  return '7+'
}

function warningMessages(
  analysis: DeckAnalysis,
  profile: StrategyProfile,
): readonly string[] {
  return Object.freeze(
    targetedRoleWarnings.flatMap(({ role, noun }) => {
      const count = analysis.roleCoverage[role].count
      const target = profile.targets[role]
      return count < target
        ? [`Only ${count} ${noun}; aim for at least ${target}.`]
        : []
    }),
  )
}

export function projectSolutionSummary(
  analysis: DeckAnalysis,
  profile: StrategyProfile,
): SolutionSummary {
  const curve: Record<keyof DeckSolution['curve'], number> = {
    '0-2': 0,
    '3-4': 0,
    '5-6': 0,
    '7+': 0,
  }
  for (const bucket of analysis.costColorDistribution) {
    curve[curveBucket(bucket.cost)] += bucket.total
  }

  const roleCoverage: Record<AllocatedRole, number> = {
    twoKCounter: analysis.roleCoverage.twoKCounter.count,
    blocker: analysis.roleCoverage.blocker.count,
    interaction: analysis.roleCoverage.interaction.count,
    pressure: analysis.roleCoverage.vanillaLike.count,
    boss: analysis.roleCoverage.boss.count,
    curve: curve['0-2'] + curve['3-4'] + curve['5-6'],
  }

  return Object.freeze({
    curve: Object.freeze(curve),
    roleCoverage: Object.freeze(roleCoverage),
    totalCounter: analysis.totalCounter,
    warnings: warningMessages(analysis, profile),
  })
}
