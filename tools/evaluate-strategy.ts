import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { runtimeCatalogIndexSchema } from '../shared/catalog-index.js'
import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { loadRuntimeCatalog } from '../src/catalog/load-catalog.js'
import { BasicDeckSolver } from '../src/solver/basic-solver.js'
import {
  addCandidateToDeckState,
  createEmptyDeckState,
  type DeckState,
} from '../src/solver/deck-state.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import type { DeckSolution, DeckSolver } from '../src/solver/types.js'
import { getStrategyProfile } from '../src/strategy/strategy-profile.js'
import {
  generateTestPool,
  type TestPoolGeneration,
} from '../src/test-pool/generate-test-pool.js'
import { reportFailure } from './catalog/cli.js'

export const DEFAULT_EVALUATION_SEEDS = 1_000
export const MATERIAL_COUNTER_REGRESSION = 1_000
export const MATERIAL_BRICK_INCREASE = 1
export const MATERIAL_VANILLA_LIKE_COVERAGE_REGRESSION = 0.5
export const MATERIAL_TARGET_MISS_REDUCTION_RATE = 0.01

const targetKeys = Object.freeze([
  'twoKCounter',
  'blocker',
  'vanillaLike',
  'interaction',
  'boss',
] as const)

type TargetKey = (typeof targetKeys)[number]
type EngineKey = 'baseline' | 'v2'

export interface EvaluationCoverage {
  readonly twoKCounter: number
  readonly blocker: number
  readonly vanillaLike: number
  readonly interaction: number
  readonly boss: number
}

export interface EvaluationCurve {
  readonly early: number
  readonly middle: number
  readonly high: number
}

export interface DeckEvaluation {
  readonly valid: boolean
  readonly error: string | null
  readonly mainDeckSize: number
  readonly coverage: EvaluationCoverage
  readonly totalCounter: number
  readonly bricks: number
  readonly curve: EvaluationCurve
}

export interface PoolEvaluation {
  readonly inputCounts: Readonly<Record<string, number>>
  readonly reachableTargets: Readonly<Record<TargetKey, boolean>>
  readonly baseline: DeckEvaluation
  readonly v2: DeckEvaluation
}

export interface AverageDeckEvaluation {
  readonly mainDeckSize: number
  readonly coverage: EvaluationCoverage
  readonly totalCounter: number
  readonly bricks: number
  readonly curve: EvaluationCurve
}

export interface SetEvaluation {
  readonly setId: string
  readonly seedCount: number
  readonly evaluatedPools: number
  readonly skippedPools: number
  readonly invalidDecks: Readonly<Record<EngineKey, number>>
  readonly averages: Readonly<Record<EngineKey, AverageDeckEvaluation>>
  readonly reachableTargetMisses: Readonly<
    Record<EngineKey, Readonly<Record<TargetKey, number>>>
  >
  readonly materialRegression: boolean
  readonly acceptance: EvaluationAcceptance
  readonly failed: boolean
}

export interface EvaluationAcceptance {
  readonly requiredTargetMissReduction: number
  readonly requiredBlockerMissReduction: number
  readonly requiredBossMissReduction: number
  readonly insufficientEvidence: boolean
  readonly counterRegression: boolean
  readonly blockerMissesNotReduced: boolean
  readonly bossMissesNotReduced: boolean
  readonly vanillaLikeRegression: boolean
  readonly brickRegression: boolean
  readonly failed: boolean
}

export interface EvaluationSolvers {
  readonly baselineSolver?: DeckSolver
  readonly v2Solver?: DeckSolver
}

export interface SetEvaluationDependencies extends EvaluationSolvers {
  readonly generate?: (
    catalog: RuntimeCatalog,
    random: () => number,
    mode: 'tournament',
  ) => TestPoolGeneration
}

interface MutableMetricTotals {
  mainDeckSize: number
  coverage: Record<TargetKey, number>
  totalCounter: number
  bricks: number
  curve: Record<keyof EvaluationCurve, number>
}

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object') deepFreeze(nested)
  }
  return Object.freeze(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function frozenCounts(
  counts: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const detached: Record<string, number> = Object.create(null)
  for (const [cardNumber, quantity] of Object.entries(counts).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new RangeError(
        `Pool quantity for ${cardNumber} must be a non-negative safe integer.`,
      )
    }
    if (quantity > 0) detached[cardNumber] = quantity
  }
  return Object.freeze(detached)
}

function blankCoverage(): Record<TargetKey, number> {
  return {
    twoKCounter: 0,
    blocker: 0,
    vanillaLike: 0,
    interaction: 0,
    boss: 0,
  }
}

function blankCurve(): Record<keyof EvaluationCurve, number> {
  return { early: 0, middle: 0, high: 0 }
}

function invalidDeck(error: unknown, mainDeckSize = 0): DeckEvaluation {
  return deepFreeze({
    valid: false,
    error: errorMessage(error),
    mainDeckSize,
    coverage: blankCoverage(),
    totalCounter: 0,
    bricks: 0,
    curve: blankCurve(),
  })
}

function addCurveCopy(curve: Record<keyof EvaluationCurve, number>, cost: number | null): void {
  if (cost === null) return
  if (cost <= 2) curve.early += 1
  else if (cost <= 5) curve.middle += 1
  else curve.high += 1
}

function canonicalEligibleCounts(
  catalog: RuntimeCatalog,
  inputCounts: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
  const eligible = new Map<string, number>()
  for (const [cardNumber, quantity] of Object.entries(inputCounts)) {
    const card = catalog.cardsByNumber.get(cardNumber)
    if (card === undefined) {
      throw new Error(`Input pool contains unknown card ${cardNumber}.`)
    }
    if (card.cardType !== 'LEADER' && card.cardType !== 'DON') {
      eligible.set(cardNumber, quantity)
    }
  }
  return eligible
}

function validateZone(
  zoneName: 'Main deck' | 'Sideboard',
  lines: DeckSolution['mainDeck'],
  catalog: RuntimeCatalog,
  eligibleInputCounts: ReadonlyMap<string, number>,
  combinedCounts: Map<string, number>,
): number {
  let zoneSize = 0
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(
        `${zoneName} line quantities must be positive safe integers.`,
      )
    }
    const cardNumber = line.card.cardNumber
    const card = catalog.cardsByNumber.get(cardNumber)
    if (card === undefined) {
      throw new Error(`${zoneName} contains unknown card ${cardNumber}.`)
    }
    if (card.cardType === 'LEADER' || card.cardType === 'DON') {
      throw new Error(`${zoneName} contains ineligible card ${cardNumber}.`)
    }

    const combined = (combinedCounts.get(cardNumber) ?? 0) + line.quantity
    if (!Number.isSafeInteger(combined)) {
      throw new Error(`${zoneName} quantity total for ${cardNumber} is unsafe.`)
    }
    const available = eligibleInputCounts.get(cardNumber) ?? 0
    if (combined > available) {
      throw new Error(
        `${zoneName} over-selects ${cardNumber}; zones contain ${combined} but the eligible input contains ${available}.`,
      )
    }
    combinedCounts.set(cardNumber, combined)
    zoneSize += line.quantity
    if (!Number.isSafeInteger(zoneSize)) {
      throw new Error(`${zoneName} quantity total is unsafe.`)
    }
  }
  return zoneSize
}

function measureSolution(
  catalog: RuntimeCatalog,
  inputCounts: Readonly<Record<string, number>>,
  solution: DeckSolution,
): DeckEvaluation {
  const eligibleInputCounts = canonicalEligibleCounts(catalog, inputCounts)
  const combinedCounts = new Map<string, number>()
  const mainDeckSize = validateZone(
    'Main deck',
    solution.mainDeck,
    catalog,
    eligibleInputCounts,
    combinedCounts,
  )
  validateZone(
    'Sideboard',
    solution.sideboard,
    catalog,
    eligibleInputCounts,
    combinedCounts,
  )
  for (const [cardNumber, expected] of eligibleInputCounts) {
    const actual = combinedCounts.get(cardNumber) ?? 0
    if (actual !== expected) {
      throw new Error(
        `Main deck and Sideboard do not conserve ${cardNumber}; zones contain ${actual} but the eligible input contains ${expected}.`,
      )
    }
  }

  if (solution.mainDeckSize !== 40 || mainDeckSize !== 40) {
    throw new Error(
      `Main deck must contain exactly 40 physical cards; found ${mainDeckSize}.`,
    )
  }

  let state: DeckState = createEmptyDeckState()
  const curve = blankCurve()

  for (const line of solution.mainDeck) {
    const cardNumber = line.card.cardNumber
    const card = catalog.cardsByNumber.get(cardNumber)!
    const features = catalog.featuresByCardNumber.get(cardNumber)
    if (features === undefined) {
      throw new Error(`Main deck is missing features for ${cardNumber}.`)
    }
    for (let copy = 0; copy < line.quantity; copy += 1) {
      state = addCandidateToDeckState(state, { card, features })
      addCurveCopy(curve, card.cost)
    }
  }

  const coverage = {
    twoKCounter: state.coverage.twoKCounter,
    blocker: state.coverage.blocker,
    vanillaLike: state.coverage.vanillaLike,
    interaction: state.coverage.interaction,
    boss: state.coverage.boss,
  }
  return deepFreeze({
    valid: true,
    error: null,
    mainDeckSize,
    coverage,
    totalCounter: state.totalCounter,
    bricks: state.brickCount,
    curve,
  })
}

function safelyEvaluateSolver(
  solver: DeckSolver,
  catalog: RuntimeCatalog,
  inputCounts: Readonly<Record<string, number>>,
): DeckEvaluation {
  try {
    const solution = solver.solve(catalog, inputCounts)
    return measureSolution(catalog, inputCounts, solution)
  } catch (error) {
    return invalidDeck(error)
  }
}

function targetReachability(
  catalog: RuntimeCatalog,
  inputCounts: Readonly<Record<string, number>>,
): Readonly<Record<TargetKey, boolean>> {
  const profile = getStrategyProfile(catalog.manifest.setId)
  const available = blankCoverage()

  for (const [cardNumber, quantity] of Object.entries(inputCounts)) {
    const card = catalog.cardsByNumber.get(cardNumber)
    const flags = catalog.featuresByCardNumber.get(cardNumber)?.rainbowUsableFlags
    if (
      card === undefined ||
      flags === undefined ||
      card.cardType === 'LEADER' ||
      card.cardType === 'DON'
    ) {
      continue
    }
    if (flags.twoKCounter) available.twoKCounter += quantity
    if (flags.blocker) available.blocker += quantity
    if (flags.vanillaLike) available.vanillaLike += quantity
    if (flags.draw || flags.removal) available.interaction += quantity
    if (flags.boss) available.boss += quantity
  }

  return Object.freeze(
    Object.fromEntries(
      targetKeys.map((key) => [key, available[key] >= profile.targets[key]]),
    ) as Record<TargetKey, boolean>,
  )
}

export function evaluatePool(
  catalog: RuntimeCatalog,
  counts: Readonly<Record<string, number>>,
  dependencies: EvaluationSolvers = {},
): PoolEvaluation {
  const inputCounts = frozenCounts(counts)
  const baselineSolver = dependencies.baselineSolver ?? new BasicDeckSolver()
  const v2Solver = dependencies.v2Solver ?? new StrategyDeckSolver()

  return deepFreeze({
    inputCounts,
    reachableTargets: targetReachability(catalog, inputCounts),
    baseline: safelyEvaluateSolver(baselineSolver, catalog, inputCounts),
    v2: safelyEvaluateSolver(v2Solver, catalog, inputCounts),
  })
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function aggregateCounts(cardNumbers: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = Object.create(null)
  for (const cardNumber of cardNumbers) {
    counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
  }
  return frozenCounts(counts)
}

function eligibleCount(
  catalog: RuntimeCatalog,
  counts: Readonly<Record<string, number>>,
): number {
  let total = 0
  for (const [cardNumber, quantity] of Object.entries(counts)) {
    const card = catalog.cardsByNumber.get(cardNumber)
    if (card !== undefined && card.cardType !== 'LEADER' && card.cardType !== 'DON') {
      total += quantity
    }
  }
  return total
}

function blankTotals(): MutableMetricTotals {
  return {
    mainDeckSize: 0,
    coverage: blankCoverage(),
    totalCounter: 0,
    bricks: 0,
    curve: blankCurve(),
  }
}

function addMetrics(totals: MutableMetricTotals, metrics: DeckEvaluation): void {
  if (!metrics.valid) return
  totals.mainDeckSize += metrics.mainDeckSize
  for (const key of targetKeys) totals.coverage[key] += metrics.coverage[key]
  totals.totalCounter += metrics.totalCounter
  totals.bricks += metrics.bricks
  totals.curve.early += metrics.curve.early
  totals.curve.middle += metrics.curve.middle
  totals.curve.high += metrics.curve.high
}

function roundedAverage(total: number, count: number): number {
  return count === 0 ? 0 : Number((total / count).toFixed(2))
}

function averageMetrics(
  totals: MutableMetricTotals,
  validCount: number,
): AverageDeckEvaluation {
  return deepFreeze({
    mainDeckSize: roundedAverage(totals.mainDeckSize, validCount),
    coverage: Object.fromEntries(
      targetKeys.map((key) => [key, roundedAverage(totals.coverage[key], validCount)]),
    ) as Record<TargetKey, number>,
    totalCounter: roundedAverage(totals.totalCounter, validCount),
    bricks: roundedAverage(totals.bricks, validCount),
    curve: {
      early: roundedAverage(totals.curve.early, validCount),
      middle: roundedAverage(totals.curve.middle, validCount),
      high: roundedAverage(totals.curve.high, validCount),
    },
  })
}

export function assessEvaluationAcceptance(
  baseline: AverageDeckEvaluation,
  v2: AverageDeckEvaluation,
  baselineMisses: Readonly<EvaluationCoverage>,
  v2Misses: Readonly<EvaluationCoverage>,
  evaluatedPools: number,
  requestedPools: number,
): EvaluationAcceptance {
  if (
    !Number.isSafeInteger(evaluatedPools) ||
    !Number.isSafeInteger(requestedPools) ||
    evaluatedPools < 0 ||
    requestedPools < 0 ||
    evaluatedPools > requestedPools
  ) {
    throw new RangeError(
      'Evidence counts must be non-negative safe integers with evaluated pools no greater than requested pools.',
    )
  }
  const insufficientEvidence =
    evaluatedPools <= 0 || evaluatedPools !== requestedPools
  const requiredTargetMissReduction = Math.ceil(
    evaluatedPools * MATERIAL_TARGET_MISS_REDUCTION_RATE,
  )
  const requiredBlockerMissReduction = Math.min(
    requiredTargetMissReduction,
    baselineMisses.blocker,
  )
  const requiredBossMissReduction = Math.min(
    requiredTargetMissReduction,
    baselineMisses.boss,
  )
  const counterRegression =
    baseline.totalCounter - v2.totalCounter >= MATERIAL_COUNTER_REGRESSION
  const blockerMissesNotReduced =
    baselineMisses.blocker > 0 &&
    baselineMisses.blocker - v2Misses.blocker <
      requiredBlockerMissReduction
  const bossMissesNotReduced =
    baselineMisses.boss > 0 &&
    baselineMisses.boss - v2Misses.boss < requiredBossMissReduction
  const vanillaLikeRegression =
    baseline.coverage.vanillaLike - v2.coverage.vanillaLike >=
      MATERIAL_VANILLA_LIKE_COVERAGE_REGRESSION
  const brickRegression =
    v2.bricks - baseline.bricks >= MATERIAL_BRICK_INCREASE

  return deepFreeze({
    requiredTargetMissReduction,
    requiredBlockerMissReduction,
    requiredBossMissReduction,
    insufficientEvidence,
    counterRegression,
    blockerMissesNotReduced,
    bossMissesNotReduced,
    vanillaLikeRegression,
    brickRegression,
    failed:
      insufficientEvidence ||
      counterRegression ||
      blockerMissesNotReduced ||
      bossMissesNotReduced ||
      vanillaLikeRegression ||
      brickRegression,
  })
}

export function evaluateSet(
  catalog: RuntimeCatalog,
  seedCount = DEFAULT_EVALUATION_SEEDS,
  dependencies: SetEvaluationDependencies = {},
): SetEvaluation {
  if (!Number.isSafeInteger(seedCount) || seedCount <= 0) {
    throw new RangeError('Seed count must be a positive integer.')
  }
  const generate = dependencies.generate ?? generateTestPool
  const totals: Record<EngineKey, MutableMetricTotals> = {
    baseline: blankTotals(),
    v2: blankTotals(),
  }
  const invalidDecks: Record<EngineKey, number> = { baseline: 0, v2: 0 }
  const reachableTargetMisses: Record<EngineKey, Record<TargetKey, number>> = {
    baseline: blankCoverage(),
    v2: blankCoverage(),
  }
  let evaluatedPools = 0
  let skippedPools = 0

  for (let seed = 0; seed < seedCount; seed += 1) {
    const generated = generate(catalog, mulberry32(seed), 'tournament')
    const counts = aggregateCounts(generated.cardNumbers)
    if (eligibleCount(catalog, counts) < 40) {
      skippedPools += 1
      continue
    }

    const evaluation = evaluatePool(catalog, counts, dependencies)
    evaluatedPools += 1
    for (const engine of ['baseline', 'v2'] as const) {
      const metrics = evaluation[engine]
      if (!metrics.valid) {
        invalidDecks[engine] += 1
        continue
      }
      addMetrics(totals[engine], metrics)
      for (const target of targetKeys) {
        const targetValue = getStrategyProfile(catalog.manifest.setId).targets[target]
        if (
          evaluation.reachableTargets[target] &&
          metrics.coverage[target] < targetValue
        ) {
          reachableTargetMisses[engine][target] += 1
        }
      }
    }
  }

  const validCounts = {
    baseline: evaluatedPools - invalidDecks.baseline,
    v2: evaluatedPools - invalidDecks.v2,
  }
  const averages = {
    baseline: averageMetrics(totals.baseline, validCounts.baseline),
    v2: averageMetrics(totals.v2, validCounts.v2),
  }
  const acceptance = assessEvaluationAcceptance(
    averages.baseline,
    averages.v2,
    reachableTargetMisses.baseline,
    reachableTargetMisses.v2,
    evaluatedPools,
    seedCount,
  )
  const materialRegression = acceptance.counterRegression

  return deepFreeze({
    setId: catalog.manifest.setId,
    seedCount,
    evaluatedPools,
    skippedPools,
    invalidDecks,
    averages,
    reachableTargetMisses,
    materialRegression,
    acceptance,
    failed:
      invalidDecks.baseline > 0 ||
      invalidDecks.v2 > 0 ||
      acceptance.failed,
  })
}

function metricCells(metrics: AverageDeckEvaluation): readonly string[] {
  return [
    metrics.mainDeckSize.toFixed(2),
    metrics.coverage.twoKCounter.toFixed(2),
    metrics.coverage.blocker.toFixed(2),
    metrics.coverage.vanillaLike.toFixed(2),
    metrics.coverage.interaction.toFixed(2),
    metrics.coverage.boss.toFixed(2),
    metrics.totalCounter.toFixed(2),
    metrics.bricks.toFixed(2),
    metrics.curve.early.toFixed(2),
    metrics.curve.middle.toFixed(2),
    metrics.curve.high.toFixed(2),
  ]
}

export function formatEvaluationReport(results: readonly SetEvaluation[]): string {
  const lines = [
    'Deterministic sealed deck-property evaluation',
    'Set | Engine | Valid | Invalid | Size | 2K | Blocker | Vanilla-like | Interaction | Boss | Counter | Bricks | Early | Middle | High',
  ]
  for (const result of results) {
    for (const [engine, label] of [
      ['baseline', 'Baseline'],
      ['v2', 'Strategy V2'],
    ] as const) {
      lines.push(
        [
          result.setId,
          label,
          result.evaluatedPools - result.invalidDecks[engine],
          result.invalidDecks[engine],
          ...metricCells(result.averages[engine]),
        ].join(' | '),
      )
      lines.push(
        `${result.setId} ${label} reachable-target misses: ${targetKeys
          .map((target) => `${target}=${result.reachableTargetMisses[engine][target]}`)
          .join(', ')}`,
      )
    }
    lines.push(
      `${result.setId} pools: requested=${result.seedCount}, evaluated=${result.evaluatedPools}, skipped=${result.skippedPools}, acceptanceFailed=${result.acceptance.failed}, insufficientEvidence=${result.acceptance.insufficientEvidence}, requiredTargetMissReduction=${result.acceptance.requiredTargetMissReduction}, requiredBlockerMissReduction=${result.acceptance.requiredBlockerMissReduction}, requiredBossMissReduction=${result.acceptance.requiredBossMissReduction}, counterRegression=${result.acceptance.counterRegression}, blockerMissesNotReduced=${result.acceptance.blockerMissesNotReduced}, bossMissesNotReduced=${result.acceptance.bossMissesNotReduced}, vanillaLikeRegression=${result.acceptance.vanillaLikeRegression}, brickRegression=${result.acceptance.brickRegression}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function parseSeedCount(argv: readonly string[]): number {
  if (argv.length === 0) return DEFAULT_EVALUATION_SEEDS
  if (argv.length !== 2 || argv[0] !== '--seeds') {
    throw new Error(
      'Unknown arguments. Usage: npm run strategy:evaluate -- --seeds <positive integer>',
    )
  }
  const parsed = Number(argv[1])
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Seed count must be a positive integer.')
  }
  return parsed
}

export async function loadLocalCatalogs(
  setIds: readonly string[],
): Promise<readonly RuntimeCatalog[]> {
  const publicRoot = resolve('public/catalogs')
  const indexPath = resolve(publicRoot, 'index.json')
  const index = runtimeCatalogIndexSchema.parse(
    JSON.parse(await readFile(indexPath, 'utf8')) as unknown,
  )
  const fetcher: typeof fetch = async (input) => {
    const pathname = typeof input === 'string' ? input : input.toString()
    const relative = pathname.replace(/^\/catalogs\//, '')
    try {
      return new Response(await readFile(resolve(publicRoot, relative)), {
        status: 200,
      })
    } catch {
      return new Response('', { status: 404, statusText: 'Not Found' })
    }
  }
  const digest = async (bytes: Uint8Array): Promise<string> =>
    createHash('sha256').update(bytes).digest('hex')

  return Promise.all(
    setIds.map(async (setId) => {
      const entry = index.sets.find((candidate) => candidate.setId === setId)
      if (entry === undefined) throw new Error(`Catalog index is missing ${setId}.`)
      return loadRuntimeCatalog(entry, fetcher, digest)
    }),
  )
}

export async function runEvaluationCommand(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const seeds = parseSeedCount(argv)
  const catalogs = await loadLocalCatalogs(['OP16', 'OP17'])
  const results = catalogs.map((catalog) => evaluateSet(catalog, seeds))
  process.stdout.write(formatEvaluationReport(results))
  if (results.some((result) => result.failed)) process.exitCode = 1
}

const entryPath = process.argv[1]
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  void runEvaluationCommand().catch(reportFailure)
}
