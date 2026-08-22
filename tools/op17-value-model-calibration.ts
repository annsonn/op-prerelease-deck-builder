import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import { generateTestPool } from '../src/test-pool/generate-test-pool.js'
import { getStrategyProfile, type StrategyProfile } from '../src/strategy/strategy-profile.js'
import { mulberry32 } from './evaluate-strategy.js'

export interface CalibrationCardRate { readonly opened: number; readonly main: number; readonly inclusionRate: number }
export interface CalibrationReport {
  readonly setId: string
  readonly seedStart: number
  readonly seedEnd: number
  readonly seedCount: number
  readonly catalogChecksum: string
  readonly profileSha256: string
  readonly cards: Readonly<Record<string, CalibrationCardRate>>
  readonly exactFortyFailures: number
  readonly physicalCopyConservationFailures: number
  readonly nondeterministicDecks: number
}

function freeze<T extends object>(value: T): T { return Object.freeze(value) }
function counts(catalog: RuntimeCatalog, cardNumbers: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const number of cardNumbers) {
    const card = catalog.cardsByNumber.get(number)
    if (card !== undefined && card.cardType !== 'LEADER' && card.cardType !== 'DON') result[number] = (result[number] ?? 0) + 1
  }
  return result
}
function profileHash(profile: StrategyProfile): string { return createHash('sha256').update(JSON.stringify(profile)).digest('hex') }

export async function evaluateValueModelCalibration(catalog: RuntimeCatalog, seedCount: number, cardNumbers: readonly string[] = catalog.cards.map((card) => card.cardNumber)): Promise<CalibrationReport> {
  if (!Number.isSafeInteger(seedCount) || seedCount <= 0) throw new RangeError('seedCount must be a positive safe integer')
  const opened: Record<string, number> = {}
  const main: Record<string, number> = {}
  let exactFortyFailures = 0
  let physicalCopyConservationFailures = 0
  let nondeterministicDecks = 0
  const solver = new StrategyDeckSolver()
  for (let seed = 0; seed < seedCount; seed += 1) {
    const generated = generateTestPool(catalog, mulberry32(seed), 'tournament')
    const pool = counts(catalog, generated.cardNumbers)
    for (const cardNumber of cardNumbers) if ((pool[cardNumber] ?? 0) > 0) opened[cardNumber] = (opened[cardNumber] ?? 0) + 1
    const solution = solver.solve(catalog, pool)
    if (solution.mainDeckSize !== 40) exactFortyFailures += 1
    const selected: Record<string, number> = {}
    for (const line of [...solution.mainDeck, ...solution.sideboard]) selected[line.card.cardNumber] = (selected[line.card.cardNumber] ?? 0) + line.quantity
    const sameCounts = Object.keys({ ...selected, ...pool }).every((key) => (selected[key] ?? 0) === (pool[key] ?? 0))
    if (!sameCounts) physicalCopyConservationFailures += 1
    const repeated = solver.solve(catalog, pool)
    if (JSON.stringify(repeated) !== JSON.stringify(solution)) nondeterministicDecks += 1
    for (const line of solution.mainDeck) if (cardNumbers.includes(line.card.cardNumber)) main[line.card.cardNumber] = (main[line.card.cardNumber] ?? 0) + line.quantity
  }
  const cards = Object.fromEntries([...cardNumbers].sort().map((cardNumber: string) => {
    const openedCount = opened[cardNumber] ?? 0
    const mainCount = main[cardNumber] ?? 0
    return [cardNumber, freeze({ opened: openedCount, main: mainCount, inclusionRate: openedCount === 0 ? 0 : Number((mainCount / openedCount).toFixed(6)) })]
  }))
  const bytes = await readFile(resolve('public/catalogs', catalog.manifest.setId, 'cards.json'))
  return freeze({ setId: catalog.manifest.setId, seedStart: 0, seedEnd: seedCount - 1, seedCount, catalogChecksum: createHash('sha256').update(bytes).digest('hex'), profileSha256: profileHash(getStrategyProfile(catalog.manifest.setId)), cards: freeze(cards), exactFortyFailures, physicalCopyConservationFailures, nondeterministicDecks })
}
