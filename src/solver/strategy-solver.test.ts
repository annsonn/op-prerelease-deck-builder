import { describe, expect, it } from 'vitest'

import {
  supportRequirementFlagKeys,
  type CardFeatures,
  type CardFeatureKey,
} from '../../shared/card-features.js'
import type {
  PlayableCard,
  StrategySuggestion,
  SuggestedRole,
} from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import { getStrategyProfile } from '../strategy/strategy-profile.js'

import { BasicDeckSolver } from './basic-solver.js'
import {
  addCandidateToDeckState,
  buildPoolSupport,
  createEmptyDeckState,
  type CandidateCard,
  type DeckState,
} from './deck-state.js'
import {
  scoreCandidateAgainstCompletedDeck,
  scoreMarginalCandidate,
} from './marginal-score.js'
import { StrategyDeckSolver } from './strategy-solver.js'

const PROFILE = getStrategyProfile('OP16')

function candidate(
  cardNumber: string,
  cardOverrides: Partial<PlayableCard> = {},
  enabledFlags: readonly CardFeatureKey[] = [],
  featureOverrides: Partial<Omit<CardFeatures, 'flags' | 'rainbowUsableFlags'>> = {},
): CandidateCard {
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
    massRest: false,
    donRefresh: false,
    searcher: false,
    comboDependent: false,
    brick: false,
  }
  for (const flag of enabledFlags) flags[flag] = true

  return {
    card: {
      cardNumber,
      name: `${cardNumber} Test Card`,
      rarity: 'C',
      cardType: 'CHARACTER',
      colors: ['Red'],
      cost: 3,
      life: null,
      power: 4000,
      counter: 0,
      attribute: 'Strike',
      traits: ['Test Crew'],
      effect: '',
      trigger: '',
      setMembership: ['OP16'],
      variantsCollapsed: 1,
      entryShortcut: cardNumber.startsWith('OP16-')
        ? cardNumber.slice(-3)
        : null,
      isSpecialReprint: !cardNumber.startsWith('OP16-'),
      ...cardOverrides,
    },
    features: {
      effectModelVersion: 2,
      effectParserRevision: 1,
      effects: [],
      unparsedClauses: [],
      flags: { ...flags },
      rainbowUsableFlags: { ...flags },
      supportRequirementsByFlag: Object.fromEntries(
        supportRequirementFlagKeys.map((flag) => [flag, null]),
      ) as CardFeatures['supportRequirementsByFlag'],
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
      ...featureOverrides,
    },
  }
}

function runtimeCatalog(
  candidates: readonly CandidateCard[],
  roleAssignments: Readonly<Record<string, readonly SuggestedRole[]>> = {},
): RuntimeCatalog {
  const cards = candidates.map(({ card }) => card)
  const suggestions: StrategySuggestion[] = cards.map((card) => ({
    cardNumber: card.cardNumber,
    roles: [...(roleAssignments[card.cardNumber] ?? [])],
    reviewStatus: 'suggested',
  }))
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
    cardsByNumber: new Map(cards.map((card) => [card.cardNumber, card])),
    normalCardsByShortcut: new Map(
      cards.flatMap((card) =>
        card.entryShortcut === null
          ? []
          : [[card.entryShortcut, card] as const],
      ),
    ),
    specialCards: cards.filter((card) => card.isSpecialReprint),
    strategySuggestions: suggestions,
    suggestionsByCardNumber: new Map(
      suggestions.map((item) => [item.cardNumber, item]),
    ),
    featuresByCardNumber: new Map(
      candidates.map(({ card, features }) => [card.cardNumber, features]),
    ),
  }
}

function quantities(
  lines: readonly { card: PlayableCard; quantity: number }[],
): Record<string, number> {
  return Object.fromEntries(
    lines.map((line) => [line.card.cardNumber, line.quantity]),
  )
}

function addCopies(
  state: DeckState,
  value: CandidateCard,
  quantity: number,
): DeckState {
  let next = state
  for (let index = 0; index < quantity; index += 1) {
    next = addCandidateToDeckState(next, value)
  }
  return next
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested)
}

const solver = new StrategyDeckSolver()

describe('StrategyDeckSolver validation and conservation', () => {
  it('builds exactly 40 eligible cards while excluding Leader and DON!! copies', () => {
    const leader = candidate('OP16-001', { cardType: 'LEADER' })
    const don = candidate('OP16-002', { cardType: 'DON' })
    const playable = candidate('OP16-003')
    const result = solver.solve(runtimeCatalog([leader, don, playable]), {
      'OP16-001': 2,
      'OP16-002': 10,
      'OP16-003': 40,
    })

    expect(result.mainDeckSize).toBe(40)
    expect(quantities(result.mainDeck)).toEqual({ 'OP16-003': 40 })
    expect(result.sideboard).toEqual([])
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid pool quantity %s exactly like the basic solver',
    (quantity) => {
      const catalog = runtimeCatalog([candidate('OP16-001')])
      expect(() => solver.solve(catalog, { 'OP16-001': quantity })).toThrow(
        'Pool quantity for OP16-001 must be a non-negative integer.',
      )
    },
  )

  it('rejects an unknown positive card and reports an actionable shortage', () => {
    const catalog = runtimeCatalog([candidate('OP16-001')])
    expect(() =>
      solver.solve(catalog, { 'OP16-001': 40, 'OP16-999': 1 }),
    ).toThrow('Pool card OP16-999 is not in the selected catalog.')
    expect(() => solver.solve(catalog, { 'OP16-001': 39 })).toThrow(
      'A legal sealed deck needs 40 eligible cards; only 39 were entered. Add 1 more eligible card.',
    )
  })

  it('conserves every eligible physical copy without over-selection', () => {
    const candidates = [
      candidate('OP16-010', { counter: 2000 }, ['twoKCounter']),
      candidate('OP16-011', {}, ['blocker']),
      candidate('OP16-012'),
    ]
    const counts = { 'OP16-010': 22, 'OP16-011': 17, 'OP16-012': 6 }
    const result = solver.solve(runtimeCatalog(candidates), counts)
    const main = quantities(result.mainDeck)
    const side = quantities(result.sideboard)

    expect(result.mainDeck.reduce((sum, line) => sum + line.quantity, 0)).toBe(40)
    for (const [cardNumber, poolQuantity] of Object.entries(counts)) {
      expect((main[cardNumber] ?? 0) + (side[cardNumber] ?? 0)).toBe(poolQuantity)
      expect(main[cardNumber] ?? 0).toBeLessThanOrEqual(poolQuantity)
    }
  })

  it('handles a billion-copy quantity with bounded output', () => {
    const best = candidate(
      'OP16-001',
      { cost: 0, power: 10_000, counter: 2000 },
      ['twoKCounter'],
    )
    const lower = candidate('OP16-002', { cost: null, power: 0 })
    const result = solver.solve(runtimeCatalog([best, lower]), {
      'OP16-001': 1_000_000_000,
      'OP16-002': 1,
    })

    expect(quantities(result.mainDeck)).toEqual({ 'OP16-001': 40 })
    expect(quantities(result.sideboard)).toEqual({
      'OP16-001': 999_999_960,
      'OP16-002': 1,
    })
    expect(result.mainDeck).toHaveLength(1)
    expect(result.sideboard).toHaveLength(2)
  })
})

describe('StrategyDeckSolver marginal selection', () => {
  it('is deterministic across count and catalog insertion order and breaks ties by card number', () => {
    const first = candidate('OP16-010')
    const second = candidate('OP16-011')
    const left = solver.solve(runtimeCatalog([second, first]), {
      'OP16-011': 25,
      'OP16-010': 20,
    })
    const right = solver.solve(runtimeCatalog([first, second]), {
      'OP16-010': 20,
      'OP16-011': 25,
    })

    expect(quantities(left.mainDeck)).toEqual({
      'OP16-010': 20,
      'OP16-011': 20,
    })
    expect(left.mainDeck.map((line) => line.card.cardNumber)).toEqual([
      'OP16-010',
      'OP16-011',
    ])
    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })

  it('projects every usable role and lets those roles change later choices', () => {
    const locked = candidate('OP16-000', { cost: null, power: 200_000 })
    const multiRole = candidate(
      'OP16-001',
      { cost: null, power: 100_000, counter: 2000 },
      ['twoKCounter', 'blocker', 'draw', 'boss', 'rush'],
    )
    const blocker = candidate('OP16-002', { cost: null, power: 0 }, ['blocker'])
    const filler = candidate('OP16-003', { cost: null, power: 1000 })
    const result = solver.solve(
      runtimeCatalog([locked, multiRole, blocker, filler]),
      {
        'OP16-000': 29,
        'OP16-001': 10,
        'OP16-002': 1,
        'OP16-003': 1,
      },
    )
    const noRoleMulti = candidate('OP16-001', {
      cost: null,
      power: 100_000,
      counter: 2000,
    })
    const withoutCoverage = solver.solve(
      runtimeCatalog([locked, noRoleMulti, blocker, filler]),
      {
        'OP16-000': 29,
        'OP16-001': 10,
        'OP16-002': 1,
        'OP16-003': 1,
      },
    )
    const multiLine = result.mainDeck.find(
      (line) => line.card.cardNumber === 'OP16-001',
    )

    expect(multiLine?.quantity).toBe(10)
    expect(multiLine?.allocatedRoles).toEqual({
      twoKCounter: 10,
      blocker: 10,
      interaction: 10,
      pressure: 10,
      boss: 10,
      curve: 0,
    })
    expect(quantities(result.mainDeck)).toMatchObject({ 'OP16-003': 1 })
    expect(quantities(result.sideboard)).toEqual({ 'OP16-002': 1 })
    expect(quantities(withoutCoverage.mainDeck)).toMatchObject({
      'OP16-002': 1,
    })
    expect(quantities(withoutCoverage.sideboard)).toEqual({ 'OP16-003': 1 })
  })

  it('improves reachable boss and early-curve balance over Basic in a controlled pool', () => {
    const middle = candidate(
      'OP16-001',
      { cost: 3, power: 4000, counter: 2000 },
      ['twoKCounter'],
    )
    const early = candidate(
      'OP16-002',
      { cost: 2, power: 5000 },
      ['vanillaLike'],
    )
    const boss = candidate(
      'OP16-003',
      { cost: 8, power: 9000 },
      ['boss'],
    )
    const catalog = runtimeCatalog([middle, early, boss])
    const counts = { 'OP16-001': 40, 'OP16-002': 8, 'OP16-003': 5 }

    const basic = new BasicDeckSolver().solve(catalog, counts)
    const strategy = solver.solve(catalog, counts)

    expect(strategy.roleCoverage.boss).toBeGreaterThan(basic.roleCoverage.boss)
    expect(strategy.curve['0-2']).toBeGreaterThan(basic.curve['0-2'])
    expect(strategy.roleCoverage.boss).toBe(PROFILE.targets.boss)
    expect(strategy.curve['0-2']).toBe(PROFILE.curve.early.target)
  })

  it('reports the one-decimal mean of every selected-copy marginal score', () => {
    const only = candidate('OP16-001', { cost: 3, power: 6000, counter: 1000 })
    const catalog = runtimeCatalog([only])
    const result = solver.solve(catalog, { 'OP16-001': 40 })
    const poolSupport = buildPoolSupport([{ ...only, quantity: 40 }])
    let state = createEmptyDeckState()
    const scores: number[] = []

    for (let index = 0; index < 40; index += 1) {
      const score = scoreMarginalCandidate(only, state, poolSupport, PROFILE)
      scores.push(score.total)
      state = addCandidateToDeckState(state, only)
    }

    expect(result.mainDeck[0]?.score).toBe(
      Number((scores.reduce((sum, score) => sum + score, 0) / 40).toFixed(1)),
    )
  })

  it('summarizes changing many-copy contributions as reconcilable component averages', () => {
    const lateBrick = candidate(
      'OP16-001',
      { cost: null, power: 100_000 },
      ['blocker', 'brick'],
    )
    const result = solver.solve(runtimeCatalog([lateBrick]), {
      'OP16-001': 40,
    })
    const line = result.mainDeck[0]

    expect(line?.reasons).toEqual([
      'Printed body efficiency (avg +200)',
      'Blocker target (avg +1.4)',
      'Brick risk beyond tolerance (avg -3.05)',
      'Broadly useful Rainbow-usable effects (avg +1)',
      'Satisfied-role redundancy (avg -0.75)',
    ])
    expect(line?.reasons).toHaveLength(5)

    const displayedTotal = line?.reasons.reduce((sum, reason) => {
      const match = /\(avg ([+-]\d+(?:\.\d+)?)\)$/.exec(reason)
      expect(match).not.toBeNull()
      return sum + Number(match?.[1])
    }, 0)
    expect(displayedTotal).toBeCloseTo(line?.score ?? Number.NaN, 1)
  })

  it('scores and orders sideboard cards against the truthful completed deck state', () => {
    const selected = candidate(
      'OP16-001',
      { cost: 0, power: 10_000, counter: 2000 },
      ['twoKCounter'],
    )
    const neededBoss = candidate(
      'OP16-002',
      { cost: 8, power: 8000 },
      ['boss'],
    )
    const plain = candidate('OP16-003', { cost: null, power: 0 })
    const candidates = [selected, neededBoss, plain]
    const poolSupport = buildPoolSupport(
      candidates.map((item) => ({
        ...item,
        quantity: item === selected ? 40 : 1,
      })),
    )
    const fullState = addCopies(createEmptyDeckState(), selected, 40)

    expect(fullState.size).toBe(40)

    const expectedBoss = scoreCandidateAgainstCompletedDeck(
      neededBoss,
      fullState,
      poolSupport,
      PROFILE,
    )
    const expectedPlain = scoreCandidateAgainstCompletedDeck(
      plain,
      fullState,
      poolSupport,
      PROFILE,
    )
    const result = solver.solve(runtimeCatalog(candidates), {
      'OP16-001': 40,
      'OP16-002': 1,
      'OP16-003': 1,
    })

    expect(result.mainDeck).toHaveLength(1)
    expect(result.mainDeck[0]?.quantity).toBe(40)
    expect(result.sideboard.map((line) => line.card.cardNumber)).toEqual([
      'OP16-002',
      'OP16-003',
    ])
    expect(result.sideboard[0]).toMatchObject({
      score: expectedBoss.total,
      reasons: expectedBoss.reasons,
    })
    expect(result.sideboard[1]).toMatchObject({
      score: expectedPlain.total,
      reasons: expectedPlain.reasons,
    })
    expect(fullState.size).toBe(40)
  })
})

describe('StrategyDeckSolver result contract', () => {
  it('derives compatibility summaries and play guidance from the final analysis', () => {
    const selected = candidate(
      'OP16-001',
      { cost: 2, power: 10_000, counter: 2000 },
      ['twoKCounter', 'blocker', 'vanillaLike', 'draw', 'boss'],
    )
    const first = solver.solve(runtimeCatalog([selected]), {
      'OP16-001': 40,
    })
    const second = solver.solve(runtimeCatalog([selected]), {
      'OP16-001': 40,
    })

    expect(first.totalCounter).toBe(first.analysis.totalCounter)
    expect(first.roleCoverage.twoKCounter).toBe(
      first.analysis.roleCoverage.twoKCounter.count,
    )
    expect(first.roleCoverage.blocker).toBe(
      first.analysis.roleCoverage.blocker.count,
    )
    expect(first.roleCoverage.interaction).toBe(
      first.analysis.roleCoverage.interaction.count,
    )
    expect(first.roleCoverage.boss).toBe(
      first.analysis.roleCoverage.boss.count,
    )
    expect(first.curve).toEqual({ '0-2': 40, '3-4': 0, '5-6': 0, '7+': 0 })
    expect(first.playGuide.finishers.points.length).toBeGreaterThan(0)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('warns for every missed soft target even when visible weaknesses are capped', () => {
    const plain = candidate('OP16-001', {
      cost: 3,
      power: 4000,
      counter: 1000,
    })
    const result = solver.solve(runtimeCatalog([plain]), {
      'OP16-001': 40,
    })

    expect(result.analysis.weaknesses).toHaveLength(3)
    expect(result.warnings).toEqual([
      'Only 0 2K counters; aim for at least 10.',
      'Only 0 blockers; aim for at least 10.',
      'Only 0 vanilla-like bodies; aim for at least 10.',
      'Only 0 interaction cards; aim for at least 5.',
      'Only 0 bosses; aim for at least 5.',
    ])
  })

  it('generates Sideboard suggestions from the actual allocated Sideboard', () => {
    const early = candidate(
      'OP16-001',
      { cost: 2, power: 100_000, counter: 2000 },
      ['twoKCounter', 'vanillaLike', 'draw', 'boss'],
    )
    const middle = candidate(
      'OP16-002',
      { cost: 3, power: 100_000, counter: 2000 },
      ['twoKCounter', 'vanillaLike', 'draw', 'boss'],
    )
    const late = candidate(
      'OP16-003',
      { cost: 6, power: 100_000, counter: 2000 },
      ['twoKCounter', 'vanillaLike', 'draw', 'boss'],
    )
    const high = candidate(
      'OP16-004',
      { cost: 7, power: 100_000, counter: 2000 },
      ['twoKCounter', 'vanillaLike', 'draw', 'boss'],
    )
    const blocker = candidate(
      'OP16-099',
      { cost: 2, power: 0, counter: 1000 },
      ['blocker'],
    )
    const result = solver.solve(
      runtimeCatalog([early, middle, late, high, blocker]),
      {
        'OP16-001': 8,
        'OP16-002': 22,
        'OP16-003': 6,
        'OP16-004': 4,
        'OP16-099': 1,
      },
    )

    expect(quantities(result.sideboard)).toEqual({ 'OP16-099': 1 })
    expect(result.playGuide.sideboardSuggestions[0]).toMatchObject({
      cardNumber: 'OP16-099',
      quantity: 1,
      addressesInsightIds: ['blockers'],
    })
  })

  it('returns strategy/profile identifiers and a detached deeply frozen graph', () => {
    const source = candidate(
      'OP16-001',
      {
        colors: ['Red', 'Blue'],
        traits: ['Test Crew', 'Straw Hat Crew'],
        setMembership: ['OP16', 'PRB02'],
        cost: 0,
        power: 10_000,
      },
    )
    const result = solver.solve(runtimeCatalog([source]), {
      'OP16-001': 41,
    })
    const mainCard = result.mainDeck[0]?.card
    const sideCard = result.sideboard[0]?.card

    expect(result).toMatchObject({
      label: 'Strategy sealed build',
      solverVersion: 'strategy-v2',
      profileId: 'sealed-video-v1',
      profileVersion: 1,
    })
    expect(mainCard).toBe(sideCard)
    expect(mainCard).not.toBe(source.card)
    source.card.colors[0] = 'Black'
    source.card.traits[0] = 'Changed'
    source.card.setMembership[0] = 'OP99'
    expect(mainCard?.colors).toEqual(['Red', 'Blue'])
    expect(mainCard?.traits).toEqual(['Test Crew', 'Straw Hat Crew'])
    expect(mainCard?.setMembership).toEqual(['OP16', 'PRB02'])
    expectDeeplyFrozen(result)
  })
})
