import { beforeAll, describe, expect, it } from 'vitest'

import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import type { DeckLine, StrategyDeckSolution } from '../src/solver/types.js'
import { generateTestPool } from '../src/test-pool/generate-test-pool.js'
import { loadLocalCatalogs, mulberry32 } from './evaluate-strategy.js'

const SHANKS_CARD_NUMBER = 'OP17-022'

function playablePoolCounts(
  catalog: RuntimeCatalog,
  cardNumbers: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const cardNumber of cardNumbers) {
    const card = catalog.cardsByNumber.get(cardNumber)
    if (card === undefined) {
      throw new Error(`Generated pool contains unknown card ${cardNumber}.`)
    }
    if (card.cardType === 'LEADER' || card.cardType === 'DON') continue
    counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
  }
  return counts
}

function zoneCounts(lines: readonly DeckLine[]): Record<string, number> {
  return Object.fromEntries(
    lines.map(({ card, quantity }) => [card.cardNumber, quantity]),
  )
}

function zoneQuantity(lines: readonly DeckLine[], cardNumber: string): number {
  return lines.find(({ card }) => card.cardNumber === cardNumber)?.quantity ?? 0
}

function expectPoolConserved(
  solution: StrategyDeckSolution,
  counts: Readonly<Record<string, number>>,
): void {
  const mainCounts = zoneCounts(solution.mainDeck)
  const sideboardCounts = zoneCounts(solution.sideboard)
  const combinedCounts: Record<string, number> = {}

  for (const [cardNumber, quantity] of Object.entries(mainCounts)) {
    combinedCounts[cardNumber] = quantity
  }
  for (const [cardNumber, quantity] of Object.entries(sideboardCounts)) {
    combinedCounts[cardNumber] = (combinedCounts[cardNumber] ?? 0) + quantity
  }

  expect(combinedCounts).toEqual(counts)
}

describe('OP17 premium-bomb acceptance', () => {
  let catalog: RuntimeCatalog

  beforeAll(async () => {
    const [loadedCatalog] = await loadLocalCatalogs(['OP17'])
    if (loadedCatalog === undefined) {
      throw new Error('OP17 catalog did not load.')
    }
    catalog = loadedCatalog
  })

  it('selects and conserves OP17-022 in the confirmed pre-change failing seed 4', () => {
    const counts = playablePoolCounts(
      catalog,
      generateTestPool(catalog, mulberry32(4), 'tournament').cardNumbers,
    )
    expect(counts[SHANKS_CARD_NUMBER]).toBeGreaterThan(0)

    const solver = new StrategyDeckSolver()
    const solution = solver.solve(catalog, counts)
    const repeatedSolution = solver.solve(catalog, counts)

    expect(solution.mainDeckSize).toBe(40)
    expect(zoneQuantity(solution.mainDeck, SHANKS_CARD_NUMBER)).toBeGreaterThanOrEqual(
      1,
    )
    expectPoolConserved(solution, counts)
    expect(repeatedSolution).toEqual(solution)
  })

  it('selects the first OP17-022 copy whenever it appears in 1,000 seeded pools', () => {
    const solver = new StrategyDeckSolver()
    let poolsContainingShanks = 0

    for (let seed = 0; seed < 1_000; seed += 1) {
      const counts = playablePoolCounts(
        catalog,
        generateTestPool(catalog, mulberry32(seed), 'tournament').cardNumbers,
      )
      if ((counts[SHANKS_CARD_NUMBER] ?? 0) === 0) continue

      poolsContainingShanks += 1
      expect(
        zoneQuantity(
          solver.solve(catalog, counts).mainDeck,
          SHANKS_CARD_NUMBER,
        ),
        `seed ${seed} should select the first OP17-022 copy`,
      ).toBeGreaterThanOrEqual(1)
    }

    expect(poolsContainingShanks).toBeGreaterThan(0)
  }, 30_000)
})
