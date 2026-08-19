import { describe, expect, it } from 'vitest'

import type { CardFeatureKey, CardFeatures } from '../shared/card-features.js'
import type {
  PlayableCard,
  StrategySuggestion,
  SuggestedRole,
} from '../shared/catalog.js'
import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { BasicDeckSolver } from '../src/solver/basic-solver.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import type { DeckSolution, DeckSolver } from '../src/solver/types.js'
import type { TestPoolGeneration } from '../src/test-pool/generate-test-pool.js'

import {
  MATERIAL_BRICK_INCREASE,
  MATERIAL_COUNTER_REGRESSION,
  MATERIAL_TARGET_MISS_REDUCTION_RATE,
  MATERIAL_VANILLA_LIKE_COVERAGE_REGRESSION,
  assessEvaluationAcceptance,
  evaluatePool,
  evaluateSet,
  formatEvaluationReport,
  parseSeedCount,
} from './evaluate-strategy.js'

function featureSet(enabled: readonly CardFeatureKey[]): CardFeatures {
  const flags: Record<CardFeatureKey, boolean> = {
    twoKCounter: false,
    blocker: false,
    vanillaLike: false,
    draw: false,
    removal: false,
    boss: false,
    rush: false,
    banish: false,
    twoForOne: false,
    searcher: false,
    comboDependent: false,
    brick: false,
  }
  for (const flag of enabled) flags[flag] = true
  return {
    flags: { ...flags },
    rainbowUsableFlags: { ...flags },
    supportRequirementsByFlag: {
      blocker: null,
      draw: null,
      removal: null,
      rush: null,
      banish: null,
      twoForOne: null,
      searcher: null,
    },
    rainbowLuffyCompatibility: 'compatible',
    searchableTraits: [],
    searchableNames: [],
    requiredTraits: [],
    requiredNames: [],
    evidence: [],
  }
}

function card(
  cardNumber: string,
  enabled: readonly CardFeatureKey[] = [],
  overrides: Partial<PlayableCard> = {},
): { card: PlayableCard; features: CardFeatures } {
  return {
    card: {
      cardNumber,
      name: `${cardNumber} Test Card`,
      rarity: 'C',
      cardType: 'CHARACTER',
      colors: ['Red'],
      cost: 3,
      life: null,
      power: 5_000,
      counter: 1_000,
      attribute: 'Strike',
      traits: ['Test Crew'],
      effect: '',
      trigger: '',
      setMembership: ['OP16'],
      variantsCollapsed: 1,
      entryShortcut: cardNumber.slice(-3),
      isSpecialReprint: false,
      ...overrides,
    },
    features: featureSet(enabled),
  }
}

function runtimeCatalog(
  candidates: readonly ReturnType<typeof card>[],
): RuntimeCatalog {
  const cards = candidates.map((candidate) => candidate.card)
  const suggestions: StrategySuggestion[] = candidates.map(
    ({ card: candidateCard, features }) => ({
      cardNumber: candidateCard.cardNumber,
      roles: [
        features.flags.twoKCounter ? 'twoKCounter' : undefined,
        features.flags.blocker ? 'blocker' : undefined,
        features.flags.draw ? 'draw' : undefined,
        features.flags.removal ? 'removal' : undefined,
        features.flags.vanillaLike ? 'pressure' : undefined,
        features.flags.boss ? 'boss' : undefined,
      ].filter((role): role is SuggestedRole => role !== undefined),
      reviewStatus: 'reviewed',
    }),
  )
  return {
    manifest: {
      schemaVersion: 1,
      setId: 'OP16',
      language: 'en',
      source: 'fixture.json',
      sourceType: 'local-json',
      readiness: 'needs-review',
    },
    cards,
    cardsByNumber: new Map(cards.map((item) => [item.cardNumber, item])),
    normalCardsByShortcut: new Map(
      cards.map((item) => [item.entryShortcut!, item]),
    ),
    specialCards: [],
    strategySuggestions: suggestions,
    suggestionsByCardNumber: new Map(
      suggestions.map((suggestion) => [suggestion.cardNumber, suggestion]),
    ),
    featuresByCardNumber: new Map(
      candidates.map((candidate) => [
        candidate.card.cardNumber,
        candidate.features,
      ]),
    ),
  }
}

function controlledCandidates(): readonly ReturnType<typeof card>[] {
  return [
    card('OP16-001', ['twoKCounter'], { counter: 2_000, cost: 1 }),
    card('OP16-002', ['blocker'], { cost: 2 }),
    card('OP16-003', ['vanillaLike'], { cost: 4, power: 6_000 }),
    card('OP16-004', ['draw'], { cost: 5 }),
    card('OP16-005', ['boss'], { cost: 8, power: 9_000, counter: 0 }),
    card('OP16-006', ['brick'], { cost: 6, counter: 0 }),
  ]
}

function controlledCatalog(): RuntimeCatalog {
  return runtimeCatalog(controlledCandidates())
}

const controlledCounts = Object.freeze({
  'OP16-001': 12,
  'OP16-002': 12,
  'OP16-003': 12,
  'OP16-004': 10,
  'OP16-005': 8,
  'OP16-006': 18,
})

function generatedPool(): TestPoolGeneration {
  return Object.freeze({
    cardNumbers: Object.freeze(
      Object.entries(controlledCounts).flatMap(([cardNumber, quantity]) =>
        Array.from({ length: quantity }, () => cardNumber),
      ),
    ),
    rarityCounts: Object.freeze({ C: 72, UC: 0, L: 0, R: 0, SR: 0, SEC: 0 }),
    selectedPackIndexes: Object.freeze([0, 1, 2, 3, 4, 5]),
    excludedUnknownRarityCount: 0,
  })
}

function invalidatingSolver(base: DeckSolver): DeckSolver {
  return {
    solve(catalog, counts): DeckSolution {
      const valid = base.solve(catalog, counts)
      return { ...valid, mainDeck: Object.freeze(valid.mainDeck.slice(1)) }
    },
  }
}

describe('evaluatePool', () => {
  it('measures a valid V2 deck and reports target reachability from the pool', () => {
    const result = evaluatePool(controlledCatalog(), controlledCounts)

    expect(result.v2.mainDeckSize).toBe(40)
    expect(result.v2.coverage).toMatchObject({
      twoKCounter: expect.any(Number),
      blocker: expect.any(Number),
      vanillaLike: expect.any(Number),
      interaction: expect.any(Number),
      boss: expect.any(Number),
    })
    expect(result.v2.bricks).toBeGreaterThanOrEqual(0)
    expect(result.reachableTargets.boss).toBe(true)
    expect(result.v2.valid).toBe(true)
  })

  it('passes the same detached frozen counts to both solvers without mutation', () => {
    const received: Readonly<Record<string, number>>[] = []
    const wrap = (solver: DeckSolver): DeckSolver => ({
      solve(catalog, counts) {
        received.push(counts)
        expect(Object.isFrozen(counts)).toBe(true)
        return solver.solve(catalog, counts)
      },
    })
    const source = { ...controlledCounts }

    const result = evaluatePool(controlledCatalog(), source, {
      baselineSolver: wrap(new BasicDeckSolver()),
      v2Solver: wrap(new StrategyDeckSolver()),
    })

    expect(received).toHaveLength(2)
    expect(received[0]).toBe(received[1])
    expect(result.inputCounts).toBe(received[0])
    expect(result.inputCounts).not.toBe(source)
    expect(source).toEqual(controlledCounts)
  })

  it('serializes identically for repeat runs', () => {
    const first = evaluatePool(controlledCatalog(), controlledCounts)
    const second = evaluatePool(controlledCatalog(), controlledCounts)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('rejects duplicate physical copies introduced in the Sideboard', () => {
    const result = evaluatePool(controlledCatalog(), controlledCounts, {
      v2Solver: {
        solve(catalog, counts) {
          const solution = new StrategyDeckSolver().solve(catalog, counts)
          const duplicated = solution.sideboard[0]!
          return {
            ...solution,
            sideboard: Object.freeze([
              ...solution.sideboard.slice(1),
              { ...duplicated, quantity: duplicated.quantity + 1 },
            ]),
          }
        },
      },
    })

    expect(result.v2.valid).toBe(false)
    expect(result.v2.error).toMatch(/sideboard|over-select|conserve/i)
  })

  it('rejects an eligible pool copy omitted from both zones', () => {
    const result = evaluatePool(controlledCatalog(), controlledCounts, {
      v2Solver: {
        solve(catalog, counts) {
          const solution = new StrategyDeckSolver().solve(catalog, counts)
          return {
            ...solution,
            sideboard: Object.freeze(solution.sideboard.slice(1)),
          }
        },
      },
    })

    expect(result.v2.valid).toBe(false)
    expect(result.v2.error).toMatch(/sideboard|missing|conserve/i)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid Sideboard quantity %s',
    (quantity) => {
      const result = evaluatePool(controlledCatalog(), controlledCounts, {
        v2Solver: {
          solve(catalog, counts) {
            const solution = new StrategyDeckSolver().solve(catalog, counts)
            return {
              ...solution,
              sideboard: Object.freeze([
                { ...solution.sideboard[0]!, quantity },
                ...solution.sideboard.slice(1),
              ]),
            }
          },
        },
      })

      expect(result.v2.valid).toBe(false)
      expect(result.v2.error).toMatch(/sideboard.*positive safe integer/i)
    },
  )

  it('rejects an unknown card in the Sideboard', () => {
    const result = evaluatePool(controlledCatalog(), controlledCounts, {
      v2Solver: {
        solve(catalog, counts) {
          const solution = new StrategyDeckSolver().solve(catalog, counts)
          const existing = solution.sideboard[0]!
          return {
            ...solution,
            sideboard: Object.freeze([
              ...solution.sideboard,
              {
                ...existing,
                card: { ...existing.card, cardNumber: 'OP16-999' },
              },
            ]),
          }
        },
      },
    })

    expect(result.v2.valid).toBe(false)
    expect(result.v2.error).toMatch(/sideboard.*unknown.*OP16-999/i)
  })

  it.each(['LEADER', 'DON'] as const)(
    'rejects an ineligible %s card in the Sideboard',
    (cardType) => {
      const ineligible = card('OP16-007', [], { cardType })
      const catalog = runtimeCatalog([...controlledCandidates(), ineligible])
      const counts = { ...controlledCounts, 'OP16-007': 1 }
      const result = evaluatePool(catalog, counts, {
        v2Solver: {
          solve(activeCatalog, activeCounts) {
            const solution = new StrategyDeckSolver().solve(
              activeCatalog,
              activeCounts,
            )
            return {
              ...solution,
              sideboard: Object.freeze([
                ...solution.sideboard,
                { ...solution.sideboard[0]!, card: ineligible.card, quantity: 1 },
              ]),
            }
          },
        },
      })

      expect(result.v2.valid).toBe(false)
      expect(result.v2.error).toMatch(
        new RegExp(`sideboard.*ineligible.*${ineligible.card.cardNumber}`, 'i'),
      )
    },
  )
})

describe('evaluateSet', () => {
  it('counts invalid solver output instead of aborting the remaining seeds', () => {
    const result = evaluateSet(controlledCatalog(), 3, {
      generate: () => generatedPool(),
      v2Solver: invalidatingSolver(new StrategyDeckSolver()),
    })

    expect(result.seedCount).toBe(3)
    expect(result.evaluatedPools).toBe(3)
    expect(result.invalidDecks).toEqual({ baseline: 0, v2: 3 })
    expect(result.averages.baseline.mainDeckSize).toBe(40)
  })

  it('uses a named 1000-counter threshold for material regression', () => {
    expect(MATERIAL_COUNTER_REGRESSION).toBe(1_000)

    const result = evaluateSet(controlledCatalog(), 1, {
      generate: () => generatedPool(),
      v2Solver: {
        solve(catalog, counts) {
          const solution = new BasicDeckSolver().solve(catalog, counts)
          const counterLine = solution.mainDeck.find(
            (line) => line.card.cardNumber === 'OP16-001',
          )!
          const brickLine = solution.sideboard.find(
            (line) => line.card.cardNumber === 'OP16-006',
          )!
          return {
            ...solution,
            mainDeck: Object.freeze([
              ...solution.mainDeck
                .filter((line) => line !== counterLine)
                .map((line) => ({ ...line })),
              { ...counterLine, quantity: counterLine.quantity - 1 },
              { ...brickLine, quantity: 1 },
            ]),
            sideboard: Object.freeze([
              ...solution.sideboard
                .filter((line) => line !== brickLine)
                .map((line) => ({ ...line })),
              { ...brickLine, quantity: brickLine.quantity - 1 },
              { ...counterLine, quantity: 1 },
            ]),
            solverVersion: 'strategy-v2',
            label: 'Strategy sealed build',
          }
        },
      },
    })

    expect(result.materialRegression).toBe(true)
  })

  it('does not let an unrelated target improvement mask a material counter regression', () => {
    const baseline = {
      mainDeckSize: 40,
      coverage: { twoKCounter: 10, blocker: 8, vanillaLike: 8, interaction: 5, boss: 4 },
      totalCounter: 30_000,
      bricks: 6,
      curve: { early: 10, middle: 20, high: 10 },
    }
    const baselineMisses = {
      twoKCounter: 0,
      blocker: 10,
      vanillaLike: 10,
      interaction: 0,
      boss: 10,
    }

    const result = assessEvaluationAcceptance(
      baseline,
      {
        ...baseline,
        coverage: { ...baseline.coverage, interaction: 8 },
        totalCounter: 29_000,
      },
      baselineMisses,
      { ...baselineMisses, interaction: 0 },
      1_000,
      1_000,
    )

    expect(MATERIAL_COUNTER_REGRESSION).toBe(1_000)
    expect(result.counterRegression).toBe(true)
    expect(result.failed).toBe(true)
  })

  it('requires a named 1% normalized reduction in reachable Blocker and Boss misses', () => {
    expect(MATERIAL_TARGET_MISS_REDUCTION_RATE).toBe(0.01)
    const metrics = {
      mainDeckSize: 40,
      coverage: { twoKCounter: 10, blocker: 8, vanillaLike: 8, interaction: 5, boss: 4 },
      totalCounter: 30_000,
      bricks: 6,
      curve: { early: 10, middle: 20, high: 10 },
    }
    const baselineMisses = {
      twoKCounter: 0,
      blocker: 100,
      vanillaLike: 10,
      interaction: 0,
      boss: 100,
    }

    expect(
      assessEvaluationAcceptance(metrics, metrics, baselineMisses, {
        ...baselineMisses,
        blocker: 91,
        boss: 90,
      }, 1_000, 1_000),
    ).toMatchObject({
      requiredTargetMissReduction: 10,
      blockerMissesNotReduced: true,
      failed: true,
    })
    expect(
      assessEvaluationAcceptance(metrics, metrics, baselineMisses, {
        ...baselineMisses,
        blocker: 90,
        boss: 91,
      }, 1_000, 1_000),
    ).toMatchObject({ bossMissesNotReduced: true, failed: true })
    expect(
      assessEvaluationAcceptance(metrics, metrics, baselineMisses, {
        ...baselineMisses,
        blocker: 90,
        boss: 90,
      }, 1_000, 1_000),
    ).toMatchObject({
      requiredTargetMissReduction: 10,
      blockerMissesNotReduced: false,
      bossMissesNotReduced: false,
      failed: false,
    })
  })

  it.each(['blocker', 'boss'] as const)(
    'caps the required %s reduction at the Basic miss count',
    (role) => {
      const metrics = {
        mainDeckSize: 40,
        coverage: { twoKCounter: 10, blocker: 8, vanillaLike: 8, interaction: 5, boss: 4 },
        totalCounter: 30_000,
        bricks: 6,
        curve: { early: 10, middle: 20, high: 10 },
      }
      const otherRole = role === 'blocker' ? 'boss' : 'blocker'
      const baselineMisses = {
        twoKCounter: 0,
        blocker: role === 'blocker' ? 5 : 100,
        vanillaLike: 0,
        interaction: 0,
        boss: role === 'boss' ? 5 : 100,
      }
      const v2Misses = {
        ...baselineMisses,
        [role]: 0,
        [otherRole]: 90,
      }

      expect(
        assessEvaluationAcceptance(
          metrics,
          metrics,
          baselineMisses,
          v2Misses,
          1_000,
          1_000,
        ),
      ).toMatchObject({
        requiredTargetMissReduction: 10,
        requiredBlockerMissReduction: role === 'blocker' ? 5 : 10,
        requiredBossMissReduction: role === 'boss' ? 5 : 10,
        blockerMissesNotReduced: false,
        bossMissesNotReduced: false,
        failed: false,
      })
    },
  )

  it('uses named inclusive boundaries for vanilla-like and brick regressions', () => {
    expect(MATERIAL_VANILLA_LIKE_COVERAGE_REGRESSION).toBe(0.5)
    expect(MATERIAL_BRICK_INCREASE).toBe(1)
    const baseline = {
      mainDeckSize: 40,
      coverage: { twoKCounter: 10, blocker: 8, vanillaLike: 8, interaction: 5, boss: 4 },
      totalCounter: 30_000,
      bricks: 6,
      curve: { early: 10, middle: 20, high: 10 },
    }
    const noReachableMisses = {
      twoKCounter: 0,
      blocker: 0,
      vanillaLike: 0,
      interaction: 0,
      boss: 0,
    }

    expect(
      assessEvaluationAcceptance(
        baseline,
        {
          ...baseline,
          coverage: { ...baseline.coverage, vanillaLike: 7.5 },
        },
        noReachableMisses,
        noReachableMisses,
        1_000,
        1_000,
      ),
    ).toMatchObject({ vanillaLikeRegression: true, failed: true })
    expect(
      assessEvaluationAcceptance(
        baseline,
        { ...baseline, bricks: 7 },
        noReachableMisses,
        noReachableMisses,
        1_000,
        1_000,
      ),
    ).toMatchObject({ brickRegression: true, failed: true })
  })

  it('fails with insufficient evidence when every requested pool is skipped', () => {
    const tooSmall = Object.freeze({
      ...generatedPool(),
      cardNumbers: Object.freeze(generatedPool().cardNumbers.slice(0, 39)),
    })

    const result = evaluateSet(controlledCatalog(), 2, {
      generate: () => tooSmall,
    })

    expect(result).toMatchObject({
      evaluatedPools: 0,
      skippedPools: 2,
      failed: true,
      acceptance: { insufficientEvidence: true, failed: true },
    })
  })

  it('fails with insufficient evidence when even one requested pool is skipped', () => {
    let generation = 0
    const result = evaluateSet(controlledCatalog(), 2, {
      generate: () => {
        generation += 1
        const full = generatedPool()
        return generation === 1
          ? full
          : Object.freeze({
              ...full,
              cardNumbers: Object.freeze(full.cardNumbers.slice(0, 39)),
            })
      },
    })

    expect(result).toMatchObject({
      evaluatedPools: 1,
      skippedPools: 1,
      failed: true,
      acceptance: { insufficientEvidence: true, failed: true },
    })
  })

  it.each([
    [-1, 1_000],
    [1.5, 1_000],
    [1_001, 1_000],
  ])(
    'rejects invalid evidence counts evaluated=%s requested=%s',
    (evaluatedPools, requestedPools) => {
      const metrics = {
        mainDeckSize: 40,
        coverage: { twoKCounter: 10, blocker: 10, vanillaLike: 10, interaction: 5, boss: 5 },
        totalCounter: 30_000,
        bricks: 6,
        curve: { early: 10, middle: 20, high: 10 },
      }
      const misses = {
        twoKCounter: 0,
        blocker: 0,
        vanillaLike: 0,
        interaction: 0,
        boss: 0,
      }

      expect(() =>
        assessEvaluationAcceptance(
          metrics,
          metrics,
          misses,
          misses,
          evaluatedPools,
          requestedPools,
        ),
      ).toThrow(/evidence counts.*non-negative.*evaluated.*requested/i)
    },
  )
})

describe('evaluation report and CLI arguments', () => {
  it('formats objective deck-property comparisons without outcome claims', () => {
    const report = formatEvaluationReport([
      evaluateSet(controlledCatalog(), 2, {
        generate: () => generatedPool(),
      }),
    ])

    expect(report).toContain('OP16')
    expect(report).toContain('Baseline')
    expect(report).toContain('Strategy V2')
    expect(report).toContain('2K')
    expect(report).toContain('Early')
    expect(report.toLowerCase()).not.toContain('win rate')
    expect(report).not.toContain('%')
  })

  it.each([
    { args: [], expected: 1_000 },
    { args: ['--seeds', '25'], expected: 25 },
  ])('parses $args as $expected seeds', ({ args, expected }) => {
    expect(parseSeedCount(args)).toBe(expected)
  })

  it.each([
    ['--seeds', '0'],
    ['--seeds', '-1'],
    ['--seeds', '1.5'],
    ['--seeds', 'many'],
    ['--seeds'],
    ['--unknown', '2'],
  ])('rejects invalid CLI arguments %j', (...args) => {
    expect(() => parseSeedCount(args)).toThrow(/positive integer|unknown/i)
  })
})
