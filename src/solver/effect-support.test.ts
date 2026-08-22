import { describe, expect, it } from 'vitest'
import { emptyCardPredicate } from '../../shared/card-effect-model.js'
import { getStrategyProfile } from '../strategy/strategy-profile.js'
import { buildPoolSupport, createEmptyDeckState } from './deck-state.js'
import { canonicalTraitKey, evaluateRequirementSupport, matchesCardPredicate } from './effect-support.js'

const profile = getStrategyProfile('OP17')
const card = { quantity: 2, name: 'Giant', traits: ['Elbaph'], cardType: 'CHARACTER' as const, cost: 4, power: 6000, counter: 1000, hasTrigger: true }

describe('structured effect support', () => {
  it('matches exact printed predicates and the controlled Elbaf alias', () => {
    expect(canonicalTraitKey('Elbaf')).toBe('elbaph')
    expect(canonicalTraitKey('Elbaph')).toBe('elbaph')
    expect(matchesCardPredicate(card, { ...emptyCardPredicate(), traits: ['Elbaf'], maximumCost: 4, hasTrigger: true })).toBe(true)
    expect(matchesCardPredicate(card, { ...emptyCardPredicate(), traits: ['Elba'] })).toBe(false)
  })
  it('uses the strongest configured zone factor and resolves basic requirements', () => {
    const support = buildPoolSupport([{ card: { ...card, cardNumber: 'X', rarity: 'C', colors: ['Red'], life: null, attribute: 'Strike', effect: '', trigger: '', setMembership: ['OP17'], variantsCollapsed: 1, entryShortcut: 'X', isSpecialReprint: false }, features: {} as never, quantity: 2 }])
    const result = evaluateRequirementSupport({ kind: 'cards', target: { subject: 'player', zones: ['deck', 'trash'], quantity: 1, predicate: { ...emptyCardPredicate(), traits: ['Elbaf'] }, differentNames: false, totalCostMaximum: null, allowsSelf: false }, minimumCount: 1 }, createEmptyDeckState(), support, profile)
    expect(result.factor).toBe(1)
  })
})
