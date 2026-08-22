import type { PlayableCard } from '../../shared/catalog.js'
import type { StrategyProfile } from '../strategy/strategy-profile.js'
import type { EffectValuation, PremiumCategory } from './effect-value.js'

export interface PremiumImpactDecision {
  readonly qualifies: boolean
  readonly impact: number
  readonly categoryValues: Readonly<Record<PremiumCategory, number>>
  readonly qualifyingCategories: readonly PremiumCategory[]
  readonly reasons: readonly string[]
}

const categories = ['pressure', 'interaction', 'cardAdvantage', 'lifeAdvantage', 'donAdvantage', 'durableDefense'] as const

export function qualifyPremiumImpact(
  card: PlayableCard,
  valuation: EffectValuation,
  profile: StrategyProfile,
): PremiumImpactDecision {
  const values = Object.fromEntries(categories.map((category) => [category, 0])) as Record<PremiumCategory, number>
  const reasons: string[] = []
  let impact = 0
  let hasNonOpponentContribution = false
  for (const contribution of valuation.contributions) {
    const positiveSupportSafe = contribution.actions.every((action) =>
      !action.supportDependent || action.conditionSupportFactor >= 0.5,
    )
    if (contribution.netValue <= 0 || !positiveSupportSafe) {
      reasons.push(contribution.effectId + ' excluded')
      continue
    }
    if (contribution.actions.some((action) => action.chooser !== 'opponent')) hasNonOpponentContribution = true
  }
  for (const contribution of valuation.contributions) {
    const eligible = contribution.netValue > 0 && contribution.actions.every((action) => !action.supportDependent || action.conditionSupportFactor >= 0.5)
    if (!eligible || (!hasNonOpponentContribution && contribution.actions.every((action) => action.chooser === 'opponent'))) continue
    impact += contribution.netValue
    for (const category of categories) values[category] += contribution.categoryValues[category]
  }
  const qualifyingCategories = categories.filter((category) => values[category] >= profile.limits.premiumCategoryMinimum)
  const qualifies = card.cardType === 'CHARACTER' && card.cost !== null && card.cost >= 6 && impact >= profile.limits.premiumImpactThreshold && qualifyingCategories.length >= 2
  return Object.freeze({ qualifies, impact: Number(impact.toFixed(6)), categoryValues: Object.freeze(values), qualifyingCategories: Object.freeze(qualifyingCategories), reasons: Object.freeze(reasons) })
}
