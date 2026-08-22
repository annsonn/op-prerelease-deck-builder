import { beforeAll, describe, expect, it } from 'vitest'

import type { EffectAction } from '../shared/card-effect-model.js'
import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { buildPoolSupport, createEmptyDeckState } from '../src/solver/deck-state.js'
import { valueCardEffects } from '../src/solver/effect-value.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import { getStrategyProfile } from '../src/strategy/strategy-profile.js'
import { generateTestPool } from '../src/test-pool/generate-test-pool.js'
import { loadLocalCatalogs, mulberry32 } from './evaluate-strategy.js'

describe('OP17 general effect-value acceptance', () => {
  let catalog: RuntimeCatalog
  const profile = getStrategyProfile('OP17')

  beforeAll(async () => {
    const [loaded] = await loadLocalCatalogs(['OP17'])
    if (loaded === undefined) throw new Error('OP17 catalog did not load.')
    catalog = loaded
  })

  function entry(cardNumber: string) {
    const card = catalog.cardsByNumber.get(cardNumber)
    if (card === undefined) throw new Error('Missing ' + cardNumber + '.')
    const features = catalog.featuresByCardNumber.get(cardNumber)
    if (features === undefined) throw new Error('Missing features for ' + cardNumber + '.')
    return { card, features }
  }

  function valuation(cardNumber: string) {
    const { card, features } = entry(cardNumber)
    const supportCards = catalog.cards.filter((item) => item.cardType === 'CHARACTER').map((item) => ({ card: item, features: catalog.featuresByCardNumber.get(item.cardNumber)!, quantity: 1 }))
    return valueCardEffects({ card, features }, createEmptyDeckState(), buildPoolSupport(supportCards), profile)
  }

  function actions(cardNumber: string): readonly EffectAction[] {
    return entry(cardNumber).features.effects.flatMap((effect) => effect.branches.flatMap((branch) => branch.actions))
  }

  it('preserves named OP17 semantic causes in structured contributions', () => {
    expect(valuation('OP17-046').total).toBeGreaterThan(0)
    expect(entry('OP17-046').features.rainbowUsableFlags.removal).toBe(true)
    expect(entry('OP17-065').features.rainbowUsableFlags.draw).toBe(true)
    expect(valuation('OP17-065').total).toBeGreaterThan(0)
    expect(actions('OP17-063').map((action) => action.kind)).toEqual(expect.arrayContaining(['negateEffect', 'remove']))
    expect(entry('OP17-049').features.rainbowUsableFlags.draw).toBe(false)
    expect(valuation('OP17-049').total).toBeLessThanOrEqual(0)
    expect(actions('OP17-119').some((action) => action.kind === 'remove' && action.target.quantity === 'anyNumber')).toBe(true)
    expect(actions('OP17-114').some((action) => action.kind === 'draw')).toBe(true)
    expect(actions('OP17-054').some((action) => action.kind === 'lockAttack')).toBe(true)
    expect(actions('OP17-043').some((action) => action.kind === 'protect')).toBe(true)
  })

  it('values Rainbow-usable OP17 Counter Events without printed body value', () => {
    const counters = catalog.cards.filter((card) => {
      const features = catalog.featuresByCardNumber.get(card.cardNumber)
      return card.cardType === 'EVENT' && /\[Counter\][\s\S]*\+(?:3000|4000)/.test(card.effect) &&
        features?.effects.some((effect) => effect.activation === 'counter' && effect.condition.kind === 'always' && effect.rainbowLuffyCompatibility !== 'incompatible') === true
    })
    expect(counters.length).toBeGreaterThan(0)
    let positivelyValued = 0
    for (const card of counters) {
      const features = catalog.featuresByCardNumber.get(card.cardNumber)
      if (features === undefined) throw new Error('Missing features for ' + card.cardNumber + '.')
      const supportCards = catalog.cards.map((item) => ({ card: item, features: catalog.featuresByCardNumber.get(item.cardNumber)!, quantity: 1 }))
      const result = valueCardEffects({ card, features }, createEmptyDeckState(), buildPoolSupport(supportCards), profile)
      expect(Number.isFinite(result.total), card.cardNumber).toBe(true)
      if (result.total > 0) positivelyValued += 1
    }
    expect(positivelyValued).toBeGreaterThan(0)
  })

  it('keeps 100 seeded OP17 solves valid, conserved, and repeatable', () => {
    const solver = new StrategyDeckSolver()
    for (let seed = 0; seed < 100; seed += 1) {
      const generated = generateTestPool(catalog, mulberry32(seed), 'tournament')
      const counts: Record<string, number> = {}
      for (const cardNumber of generated.cardNumbers) {
        const card = catalog.cardsByNumber.get(cardNumber)
        if (card !== undefined && card.cardType !== 'LEADER' && card.cardType !== 'DON') counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
      }
      const solution = solver.solve(catalog, counts)
      expect(solution.mainDeckSize, 'seed ' + seed).toBe(40)
      const conserved: Record<string, number> = {}
      for (const line of [...solution.mainDeck, ...solution.sideboard]) conserved[line.card.cardNumber] = (conserved[line.card.cardNumber] ?? 0) + line.quantity
      expect(conserved, 'seed ' + seed + ' conservation').toEqual(counts)
      expect(solver.solve(catalog, counts), 'seed ' + seed + ' repeat').toEqual(solution)
    }
  }, 30_000)
})
