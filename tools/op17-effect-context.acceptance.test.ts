import { beforeAll, describe, expect, it } from 'vitest'

import type { EffectInstance, TargetSpec } from '../shared/card-effect-model.js'
import { emptyCardPredicate } from '../shared/card-effect-model.js'
import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import type { DeckLine, StrategyDeckSolution } from '../src/solver/types.js'
import { generateTestPool } from '../src/test-pool/generate-test-pool.js'
import { loadLocalCatalogs, mulberry32 } from './evaluate-strategy.js'

function fieldTarget(
  overrides: Partial<TargetSpec> = {},
): TargetSpec {
  return {
    subject: 'opponent',
    zones: ['field'],
    quantity: 1,
    predicate: {
      ...emptyCardPredicate(),
      cardTypes: ['CHARACTER'],
    },
    differentNames: false,
    totalCostMaximum: null,
    allowsSelf: false,
    ...overrides,
  }
}

function expectedEffect(
  id: string,
  activation: EffectInstance['activation'],
  branches: EffectInstance['branches'],
  overrides: Partial<EffectInstance> = {},
): EffectInstance {
  return {
    id,
    source: 'effect',
    activation,
    timing: [],
    condition: { kind: 'always' },
    costs: [],
    chooser: 'none',
    optional: false,
    branches,
    rainbowLuffyCompatibility: 'compatible',
    ...overrides,
  }
}

function expectExactEffect(
  actual: EffectInstance,
  expected: EffectInstance,
): void {
  expect(actual).toEqual(expected)
}

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
  const counts: Record<string, number> = {}
  for (const { card, quantity } of lines) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(
        `${card.cardNumber} deck-line quantity must be a positive safe integer.`,
      )
    }
    counts[card.cardNumber] = (counts[card.cardNumber] ?? 0) + quantity
  }
  return counts
}

function expectPoolConserved(
  solution: StrategyDeckSolution,
  counts: Readonly<Record<string, number>>,
): void {
  const combinedCounts = zoneCounts(solution.mainDeck)
  for (const [cardNumber, quantity] of Object.entries(
    zoneCounts(solution.sideboard),
  )) {
    combinedCounts[cardNumber] = (combinedCounts[cardNumber] ?? 0) + quantity
  }
  expect(combinedCounts).toEqual(counts)
}

describe('OP17 effect-context acceptance', () => {
  let catalog: RuntimeCatalog

  beforeAll(async () => {
    const [loadedCatalog] = await loadLocalCatalogs(['OP17'])
    if (loadedCatalog === undefined) throw new Error('OP17 catalog did not load.')
    catalog = loadedCatalog
  })

  it('accumulates duplicate lines and rejects invalid physical quantities', () => {
    const card = catalog.cardsByNumber.get('OP17-001')
    if (card === undefined) throw new Error('Missing OP17-001 test card.')
    const line = (quantity: number): DeckLine => ({
      card,
      quantity,
      allocatedRoles: {
        twoKCounter: 0,
        blocker: 0,
        interaction: 0,
        pressure: 0,
        boss: 0,
        curve: 0,
      },
      score: 0,
      reasons: [],
    })

    expect(zoneCounts([line(1), line(2)])).toEqual({ 'OP17-001': 3 })
    expect(() => zoneCounts([line(0)])).toThrow(/positive safe integer/i)
    expect(() => zoneCounts([line(Number.NaN)])).toThrow(
      /positive safe integer/i,
    )
  })

  function effects(cardNumber: string): readonly EffectInstance[] {
    const features = catalog.featuresByCardNumber.get(cardNumber)
    if (features === undefined) throw new Error(`Missing features for ${cardNumber}.`)
    expect(features.effectModelVersion).toBe(2)
    expect(features.effectParserRevision).toBe(2)
    return features.effects
  }

  it('recognizes qualified Rush independently from adjacent clause compatibility', () => {
    for (const cardNumber of [
      'OP17-003',
      'OP17-027',
      'OP17-048',
      'OP17-069',
    ]) {
      const features = catalog.featuresByCardNumber.get(cardNumber)
      if (features === undefined) throw new Error(`Missing ${cardNumber}.`)

      expect(features.flags.rush, `${cardNumber} raw Rush`).toBe(true)
      expect(
        features.rainbowUsableFlags.rush,
        `${cardNumber} Rainbow-usable Rush`,
      ).toBe(true)
      expect(
        features.effects.some(
          (instance) =>
            instance.rainbowLuffyCompatibility === 'compatible' &&
            instance.branches.some((branch) =>
              branch.actions.some(
                (action) =>
                  action.kind === 'keyword' && action.keyword === 'rush',
              ),
            ),
        ),
        `${cardNumber} clause-local Rush instance`,
      ).toBe(true)
    }
  })

  it('distinguishes draw-two/trash-one advantage from balanced filtering', () => {
    const advantage = catalog.featuresByCardNumber.get('OP17-066')
    const balanced = catalog.featuresByCardNumber.get('OP17-082')
    if (advantage === undefined || balanced === undefined) {
      throw new Error('Missing OP17 draw/discard boundary cards.')
    }

    expect(advantage.flags.twoForOne).toBe(true)
    expect(advantage.rainbowUsableFlags.twoForOne).toBe(true)
    expect(balanced.flags.twoForOne).toBe(false)
    expect(balanced.rainbowUsableFlags.twoForOne).toBe(false)
  })

  function effect(
    cardNumber: string,
    activation: EffectInstance['activation'],
  ): EffectInstance {
    const found = effects(cardNumber).find(
      (candidate) => candidate.activation === activation,
    )
    if (found === undefined) {
      throw new Error(`${cardNumber} has no ${activation} effect.`)
    }
    return found
  }

  it('captures opponent choice, paid activation, shared targets, and lock duration', () => {
    expect(effects('OP17-049')).toHaveLength(2)
    const opponentChoice = effect('OP17-049', 'onPlay')
    expectExactEffect(
      opponentChoice,
      expectedEffect(
        'effect:0',
        'onPlay',
        [
          {
            actions: [{ kind: 'draw', subject: 'opponent', amount: 2 }],
          },
          {
            actions: [
              { kind: 'handDiscard', subject: 'opponent', amount: 2 },
            ],
          },
        ],
        { chooser: 'opponent' },
      ),
    )

    expect(effects('OP17-063')).toHaveLength(2)
    const paidRemoval = effect('OP17-063', 'activateMain')
    const sixCostTarget = fieldTarget({
      predicate: {
        ...emptyCardPredicate(),
        cardTypes: ['CHARACTER'],
        maximumCost: 6,
      },
    })
    expectExactEffect(
      paidRemoval,
      expectedEffect(
        'effect:1',
        'activateMain',
        [
          {
            actions: [
              { kind: 'negateEffect', target: sixCostTarget },
              {
                kind: 'remove',
                mode: 'ko',
                target: sixCostTarget,
                powerDelta: null,
              },
            ],
          },
        ],
        {
          timing: ['oncePerTurn'],
          condition: { kind: 'selfState', state: 'playedThisTurn' },
          costs: [{ kind: 'donMinus', amount: 1 }],
          optional: true,
        },
      ),
    )
    const [negate, ko] = paidRemoval.branches[0]?.actions ?? []
    if (negate?.kind !== 'negateEffect' || ko?.kind !== 'remove') {
      throw new Error('Expected one same-target negate followed by removal.')
    }
    expect(ko.target).toEqual(negate.target)

    expect(effects('OP17-065')).toHaveLength(2)
    const paidLock = effect('OP17-065', 'onPlay')
    expectExactEffect(
      paidLock,
      expectedEffect(
        'effect:1',
        'onPlay',
        [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              {
                kind: 'lockAttack',
                target: fieldTarget({
                  quantity: 2,
                  predicate: {
                    ...emptyCardPredicate(),
                    cardTypes: ['CHARACTER'],
                    maximumCost: 5,
                  },
                }),
                duration: 'untilOpponentsNextEndPhase',
              },
            ],
          },
        ],
        {
          costs: [{ kind: 'donMinus', amount: 1 }],
          optional: true,
        },
      ),
    )
  })

  it('captures leader protection, branch-common draw, and Trigger separately', () => {
    expect(effects('OP17-043')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-043', 'onPlay'),
      expectedEffect('effect:1', 'onPlay', [
        {
          actions: [
            {
              kind: 'leaderBasePower',
              powerDelta: 1_000,
              duration: 'untilOpponentsNextEndPhase',
            },
          ],
        },
      ]),
    )

    expect(effects('OP17-112')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-112', 'onPlay'),
      expectedEffect(
        'effect:1',
        'onPlay',
        [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
            ],
          },
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              {
                kind: 'lifeMove',
                direction: 'opponentLifeToHand',
                amount: 1,
              },
            ],
          },
        ],
        { chooser: 'player' },
      ),
    )

    const sweetCommandersEffects = effects('OP17-114')
    expect(sweetCommandersEffects).toHaveLength(2)
    expectExactEffect(
      effect('OP17-114', 'onPlay'),
      expectedEffect(
        'effect:0',
        'onPlay',
        [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
              {
                kind: 'remove',
                mode: 'powerReduction',
                target: fieldTarget({ quantity: 2 }),
                powerDelta: -3_000,
              },
            ],
          },
        ],
        {
          timing: ['yourTurn'],
          costs: [{ kind: 'restDon', amount: 2 }],
          optional: true,
        },
      ),
    )
    expectExactEffect(
      effect('OP17-114', 'trigger'),
      expectedEffect(
        'trigger:0',
        'trigger',
        [
          {
            actions: [
              {
                kind: 'deploy',
                target: {
                  subject: 'thisCard',
                  zones: ['life'],
                  quantity: 1,
                  predicate: emptyCardPredicate(),
                  differentNames: false,
                  totalCostMaximum: null,
                  allowsSelf: true,
                },
              },
            ],
          },
        ],
        { source: 'trigger' },
      ),
    )
  })

  it('captures the remaining audited removal, lock, deploy, and multi-target causes', () => {
    expect(effects('OP17-046')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-046', 'onPlay'),
      expectedEffect(
        'effect:1',
        'onPlay',
        [
          {
            actions: [
              {
                kind: 'remove',
                mode: 'bottomDeck',
                target: fieldTarget({
                  predicate: {
                    ...emptyCardPredicate(),
                    cardTypes: ['CHARACTER'],
                    maximumCost: 5,
                  },
                }),
                powerDelta: null,
              },
            ],
          },
        ],
        { optional: true },
      ),
    )

    expect(effects('OP17-054')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-054', 'onPlay'),
      expectedEffect(
        'effect:0',
        'onPlay',
        [
          {
            actions: [
              {
                kind: 'lockAttack',
                target: fieldTarget({
                  predicate: {
                    ...emptyCardPredicate(),
                    cardTypes: ['CHARACTER'],
                    maximumCost: 6,
                  },
                }),
                duration: 'untilOpponentsNextEndPhase',
              },
            ],
          },
        ],
        { optional: true },
      ),
    )
    expectExactEffect(
      effect('OP17-054', 'activateMain'),
      expectedEffect(
        'effect:1',
        'activateMain',
        [
          {
            actions: [
              {
                kind: 'lockAttack',
                target: fieldTarget(),
                duration: 'untilOpponentsNextEndPhase',
              },
            ],
          },
        ],
        {
          costs: [
            { kind: 'restDon', amount: 3 },
            { kind: 'restSelf' },
          ],
          optional: true,
        },
      ),
    )

    expect(effects('OP17-093')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-093', 'static'),
      expectedEffect(
        'effect:0',
        'static',
        [{ actions: [{ kind: 'keyword', keyword: 'rush' }] }],
        {
          condition: {
            kind: 'cards',
            target: fieldTarget({
              subject: 'bothPlayers',
              predicate: {
                ...emptyCardPredicate(),
                cardTypes: ['CHARACTER'],
                minimumCost: 12,
              },
            }),
            minimumCount: 1,
          },
        },
      ),
    )
    const trashDeploy = expectedEffect(
      'effect:1',
      'onPlay',
      [
        {
          actions: [
            { kind: 'draw', subject: 'player', amount: 1 },
            {
              kind: 'deploy',
              target: fieldTarget({
                subject: 'player',
                zones: ['trash'],
                predicate: {
                  ...emptyCardPredicate(),
                  cardTypes: ['CHARACTER'],
                  maximumCost: 2,
                },
              }),
            },
          ],
        },
      ],
      { optional: true },
    )
    expectExactEffect(effect('OP17-093', 'onPlay'), trashDeploy)

    expect(effects('OP17-118')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-118', 'onPlay'),
      expectedEffect(
        'effect:1',
        'onPlay',
        [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              {
                kind: 'deploy',
                target: fieldTarget({
                  subject: 'player',
                  zones: ['hand'],
                  quantity: 2,
                  predicate: {
                    ...emptyCardPredicate(),
                    traits: ['Rocks Pirates'],
                    cardTypes: [],
                  },
                  differentNames: true,
                  totalCostMaximum: 9,
                }),
              },
            ],
          },
        ],
        { optional: true },
      ),
    )

    expect(effects('OP17-119')).toHaveLength(2)
    expectExactEffect(
      effect('OP17-119', 'onPlay'),
      expectedEffect('effect:1', 'onPlay', [
        {
          actions: [
            {
              kind: 'remove',
              mode: 'ko',
              target: fieldTarget({
                quantity: 'anyNumber',
                totalCostMaximum: 4,
              }),
              powerDelta: null,
            },
          ],
        },
      ]),
    )

    const deployAction = trashDeploy.branches[0]?.actions[1]
    if (deployAction?.kind !== 'deploy') {
      throw new Error('Expected the exact OP17 trash-deploy action.')
    }
    const mutants: readonly EffectInstance[] = [
      { ...trashDeploy, activation: 'main' },
      { ...trashDeploy, costs: [{ kind: 'donMinus', amount: 1 }] },
      {
        ...trashDeploy,
        condition: { kind: 'unknown', normalizedText: 'wrong condition' },
      },
      {
        ...trashDeploy,
        branches: [
          {
            actions: [
              trashDeploy.branches[0]!.actions[0]!,
              {
                ...deployAction,
                target: { ...deployAction.target, zones: ['hand'] },
              },
            ],
          },
        ],
      },
      {
        ...trashDeploy,
        branches: [
          {
            actions: [
              trashDeploy.branches[0]!.actions[0]!,
              {
                ...deployAction,
                target: {
                  ...deployAction.target,
                  predicate: {
                    ...deployAction.target.predicate,
                    maximumCost: 3,
                  },
                },
              },
            ],
          },
        ],
      },
    ]
    for (const mutant of mutants) {
      expect(() => expectExactEffect(effect('OP17-093', 'onPlay'), mutant)).toThrow()
    }
  })

  it('preserves 100-seed deck invariants and determinism after the Phase-2 cutover', () => {
    const solver = new StrategyDeckSolver()

    for (let seed = 0; seed < 100; seed += 1) {
      const counts = playablePoolCounts(
        catalog,
        generateTestPool(catalog, mulberry32(seed), 'tournament').cardNumbers,
      )
      const solution = solver.solve(catalog, counts)
      const repeated = solver.solve(catalog, counts)

      expect(solution.mainDeckSize, `seed ${seed} deck size`).toBe(40)
      expectPoolConserved(solution, counts)
      expect(repeated, `seed ${seed} determinism`).toEqual(solution)
    }
  }, 30_000)
})
