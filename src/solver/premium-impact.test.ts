import { describe, expect, it } from 'vitest'
import { getStrategyProfile } from '../strategy/strategy-profile.js'
import { qualifyPremiumImpact } from './premium-impact.js'
import type { EffectValuation } from './effect-value.js'

const profile = getStrategyProfile('OP17')
const card = { cardNumber: 'X', name: 'Boss', rarity: 'C' as const, cardType: 'CHARACTER' as const, colors: ['Red'], cost: 6, life: null, power: 8000, counter: 0, attribute: 'Strike', traits: [], effect: '', trigger: '', setMembership: ['OP17'], variantsCollapsed: 1, entryShortcut: 'X', isSpecialReprint: false }
function valuation(): EffectValuation {
  const action = { effectId: 'effect:0', branchIndex: 0, actionIndex: 0, category: 'interaction' as const, rawGrossValue: 4, targetSupportFactor: 1, effectiveTargetCount: 1, cappedGrossValue: 4, activation: 'onPlay' as const, conditionSupportFactor: 1, supportDependent: false, allocatedCostValue: 0, netValue: 4, chooser: 'none' as const, rainbowLuffyCompatibility: 'compatible' as const, reason: '' }
  const second = { ...action, actionIndex: 1, category: 'pressure' as const, netValue: 4 }
  return { total: 8, premiumImpact: 8, premiumCategories: ['interaction', 'pressure'], contributions: [{ effectId: 'effect:0', grossValue: 8, costValue: 0, activationFactor: 1, conditionSupportFactor: 1, actions: [action, second], categoryValues: { pressure: 4, interaction: 4, cardAdvantage: 0, lifeAdvantage: 0, donAdvantage: 0, durableDefense: 0 }, netValue: 8, reason: '' }] }
}
describe('premium impact', () => {
  it('qualifies a high-cost multi-category contribution', () => {
    const decision = qualifyPremiumImpact(card, valuation(), profile)
    expect(decision.qualifies).toBe(true)
    expect(decision.impact).toBe(8)
    expect(Object.isFrozen(decision)).toBe(true)
  })
})
