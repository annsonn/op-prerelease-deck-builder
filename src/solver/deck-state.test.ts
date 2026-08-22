import { describe, expect, it } from 'vitest'

import {
  supportRequirementFlagKeys,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'

import { isImportantPlay } from './card-measurements.js'
import {
  addCandidateToDeckState,
  buildPoolSupport,
  countMatchingSupport,
  createEmptyDeckState,
  measuredRoleKeys,
  type CandidateCard,
} from './deck-state.js'

function card(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  return {
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
    entryShortcut: cardNumber.slice(-3),
    isSpecialReprint: false,
    ...overrides,
  }
}

function candidate(
  cardNumber: string,
  cardOverrides: Partial<PlayableCard> = {},
  enabledFlags: readonly (keyof CardFeatures['flags'])[] = [],
  usableFlags: readonly (keyof CardFeatures['flags'])[] = enabledFlags,
): CandidateCard {
  const flags: Record<keyof CardFeatures['flags'], boolean> = {
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
  const rainbowUsableFlags = Object.fromEntries(
    Object.keys(flags).map((flag) => [
      flag,
      usableFlags.includes(flag as keyof CardFeatures['flags']),
    ]),
  ) as Record<keyof CardFeatures['flags'], boolean>

  return {
    card: card(cardNumber, cardOverrides),
    features: {
      effectModelVersion: 2,
      effectParserRevision: 1,
      effects: [],
      unparsedClauses: [],
      flags,
      rainbowUsableFlags,
      supportRequirementsByFlag: Object.fromEntries(
        supportRequirementFlagKeys.map((flag) => [flag, null]),
      ) as CardFeatures['supportRequirementsByFlag'],
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
    },
  }
}

function add(
  state: ReturnType<typeof createEmptyDeckState>,
  ...candidates: readonly CandidateCard[]
) {
  return candidates.reduce(addCandidateToDeckState, state)
}

describe('deck state role measurements', () => {
  it('keeps the public measured role order stable', () => {
    expect(measuredRoleKeys).toEqual([
      'twoKCounter',
      'blocker',
      'vanillaLike',
      'draw',
      'removal',
      'interaction',
      'boss',
      'rush',
      'banish',
      'brick',
    ])
  })

  it('counts a 2K blocker in both overlapping roles', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-001', { counter: 2000 }, ['twoKCounter', 'blocker']),
    )

    expect(state.coverage.twoKCounter).toBe(1)
    expect(state.coverage.blocker).toBe(1)
    expect(state.totalCounter).toBe(2000)
  })

  it('counts draw and removal separately but counts their interaction overlap once', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-002', {}, ['draw', 'removal']),
    )

    expect(state.coverage.draw).toBe(1)
    expect(state.coverage.removal).toBe(1)
    expect(state.coverage.interaction).toBe(1)
  })

  it('preserves removal and boss overlap', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-003', {}, ['removal', 'boss']),
    )

    expect(state.coverage.removal).toBe(1)
    expect(state.coverage.interaction).toBe(1)
    expect(state.coverage.boss).toBe(1)
  })

  it('excludes raw blocker and removal roles that Rainbow Luffy cannot use', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-024', {}, ['blocker', 'removal'], []),
    )

    expect(state.coverage.blocker).toBe(0)
    expect(state.coverage.removal).toBe(0)
    expect(state.coverage.interaction).toBe(0)
    expect(state.importantPlayCounts).toEqual({ odd: 0, even: 0 })
  })

  it('counts a usable blocker without its conditional raw removal role', () => {
    const state = add(
      createEmptyDeckState(),
      candidate(
        'OP16-025',
        {},
        ['blocker', 'removal'],
        ['blocker'],
      ),
    )

    expect(state.coverage.blocker).toBe(1)
    expect(state.coverage.removal).toBe(0)
    expect(state.coverage.interaction).toBe(0)
    expect(state.importantPlayCounts).toEqual({ odd: 1, even: 0 })
  })

  it('measures vanilla-like rush banish and brick roles independently', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-004', {}, ['vanillaLike', 'rush', 'banish', 'brick']),
    )

    expect(state.coverage).toMatchObject({
      vanillaLike: 1,
      rush: 1,
      banish: 1,
      brick: 1,
    })
    expect(state.brickCount).toBe(state.coverage.brick)
  })
})

describe('deck state quantities and important plays', () => {
  it('uses the canonical predicate for important plays', () => {
    const usableDraw = candidate('OP16-024', { cost: 3 }, ['draw'])
    const unusableDraw = candidate('OP16-025', { cost: 3 }, ['draw'], [])
    const zeroCostBoss = candidate('OP16-026', { cost: 0 }, ['boss'])
    const counterOnly = candidate('OP16-027', { cost: 2 }, ['twoKCounter'])

    expect(isImportantPlay(usableDraw.card, usableDraw.features)).toBe(true)
    expect(isImportantPlay(unusableDraw.card, unusableDraw.features)).toBe(false)
    expect(isImportantPlay(zeroCostBoss.card, zeroCostBoss.features)).toBe(false)
    expect(isImportantPlay(counterOnly.card, counterOnly.features)).toBe(false)
  })

  it('tracks printed counter, exact numeric costs, and important-play parity', () => {
    const state = add(
      createEmptyDeckState(),
      candidate('OP16-005', { cost: 3, counter: 1000 }, ['draw']),
      candidate('OP16-006', { cost: 4, counter: null }, ['boss']),
      candidate('OP16-007', { cost: 2, counter: 2000 }),
      candidate('OP16-008', { cost: null, counter: 9000 }, ['rush']),
    )

    expect(state.totalCounter).toBe(12_000)
    expect(state.costCounts).toEqual({ 2: 1, 3: 1, 4: 1 })
    // Important means a non-null cost >= 1 card with one or more of:
    // vanillaLike, blocker, draw, removal, boss, rush, or banish.
    expect(state.importantPlayCounts).toEqual({ odd: 1, even: 1 })
  })

  it('tracks selected physical copies by number, printed name, and trait', () => {
    const alpha = candidate('OP16-009', {
      name: 'Alpha',
      traits: ['Navy', 'Science'],
    })
    const alphaDuplicate = candidate('OP16-009', {
      name: 'Alpha',
      traits: ['Navy', 'Science'],
    })
    const beta = candidate('OP16-010', { name: 'Beta', traits: ['Navy'] })
    const state = add(createEmptyDeckState(), alpha, alphaDuplicate, beta)

    expect(state.size).toBe(3)
    expect(state.selectedCountsByCardNumber).toEqual({
      'OP16-009': 2,
      'OP16-010': 1,
    })
    expect(state.selectedCountsByName).toEqual({ Alpha: 2, Beta: 1 })
    expect(state.selectedCountsByTrait).toEqual({ Navy: 3, Science: 2 })
    expect(state.cardSupportByNumber).toEqual({
      'OP16-009': {
        quantity: 2,
        name: 'Alpha',
        traits: ['Navy', 'Science'],
      },
      'OP16-010': { quantity: 1, name: 'Beta', traits: ['Navy'] },
    })
    expect(
      countMatchingSupport(state, { names: ['Alpha'], traits: ['Navy'] }),
    ).toBe(3)
  })
})

describe('pool support', () => {
  it('counts available physical copies by card number, printed name, and trait', () => {
    const alpha = candidate('OP16-011', {
      name: 'Alpha',
      traits: ['Navy', 'Science'],
    })
    const alphaDuplicate = candidate('OP16-011', {
      name: 'Alpha',
      traits: ['Navy', 'Science'],
    })
    const beta = candidate('OP16-012', { name: 'Beta', traits: ['Navy'] })

    const support = buildPoolSupport([
      { ...alpha, quantity: 2 },
      { ...alphaDuplicate, quantity: 3 },
      { ...beta, quantity: 4 },
    ])

    expect(support.byCardNumber).toEqual({ 'OP16-011': 5, 'OP16-012': 4 })
    expect(support.byName).toEqual({ Alpha: 5, Beta: 4 })
    expect(support.byTrait).toEqual({ Navy: 9, Science: 5 })
    expect(support.cardSupportByNumber).toEqual({
      'OP16-011': {
        quantity: 5,
        name: 'Alpha',
        traits: ['Navy', 'Science'],
      },
      'OP16-012': { quantity: 4, name: 'Beta', traits: ['Navy'] },
    })
  })

  it('counts each physical card number once across overlapping OR targets', () => {
    const support = buildPoolSupport([
      {
        ...candidate('OP16-017', {
          name: 'Alpha',
          traits: ['Navy', 'Navy'],
        }),
        quantity: 2,
      },
      {
        ...candidate('OP16-018', { name: 'Beta', traits: ['Science'] }),
        quantity: 3,
      },
    ])

    expect(
      countMatchingSupport(support, { names: ['Alpha'], traits: ['Navy'] }),
    ).toBe(2)
    expect(
      countMatchingSupport(support, {
        names: ['Alpha'],
        traits: ['Science'],
      }),
    ).toBe(5)
    expect(support.cardSupportByNumber['OP16-017']?.traits).toEqual(['Navy'])
  })

  it('keeps prototype-shaped printed names and traits as numeric own keys', () => {
    const constructorCard = candidate('OP16-019', {
      name: 'constructor',
      traits: ['toString'],
    })
    const toStringCard = candidate('OP16-020', {
      name: 'toString',
      traits: ['__proto__'],
    })
    const protoCard = candidate('OP16-021', {
      name: '__proto__',
      traits: ['constructor'],
    })
    const support = buildPoolSupport([
      { ...constructorCard, quantity: 2 },
      { ...toStringCard, quantity: 3 },
      { ...protoCard, quantity: 4 },
    ])
    const state = add(
      createEmptyDeckState(),
      constructorCard,
      toStringCard,
      toStringCard,
      protoCard,
    )

    expect(support.byName.constructor).toBe(2)
    expect(support.byName.toString).toBe(3)
    expect(support.byName.__proto__).toBe(4)
    expect(support.byTrait.toString).toBe(2)
    expect(support.byTrait.__proto__).toBe(3)
    expect(support.byTrait.constructor).toBe(4)
    expect(state.selectedCountsByName.constructor).toBe(1)
    expect(state.selectedCountsByName.toString).toBe(2)
    expect(state.selectedCountsByName.__proto__).toBe(1)
    expect(state.selectedCountsByTrait.toString).toBe(1)
    expect(state.selectedCountsByTrait.__proto__).toBe(2)
    expect(state.selectedCountsByTrait.constructor).toBe(1)
    expect(Object.hasOwn(support.byName, '__proto__')).toBe(true)
    expect(Object.hasOwn(state.selectedCountsByTrait, 'constructor')).toBe(true)
  })

  it('uses counts rather than expanding a billion physical copies', () => {
    const support = buildPoolSupport([
      { ...candidate('OP16-013', { name: 'Huge' }), quantity: 1_000_000_000 },
    ])

    expect(support.byCardNumber['OP16-013']).toBe(1_000_000_000)
    expect(Object.values(support).every((value) => !Array.isArray(value))).toBe(
      true,
    )
  })

  it('rejects invalid pool quantities with the affected card number', () => {
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        buildPoolSupport([{ ...candidate('OP16-014'), quantity }]),
      ).toThrow('Pool quantity for OP16-014 must be a positive safe integer.')
    }
  })
})

describe('deck state immutability and limits', () => {
  it('rejects selecting more than 40 cards with an actionable error', () => {
    let state = createEmptyDeckState()
    const item = candidate('OP16-015')
    for (let index = 0; index < 40; index += 1) {
      state = addCandidateToDeckState(state, item)
    }

    expect(state.size).toBe(40)
    expect(() => addCandidateToDeckState(state, item)).toThrow(
      'A deck state cannot exceed 40 cards.',
    )
  })

  it('rejects a total counter value that would exceed a safe integer', () => {
    const atMaximum = addCandidateToDeckState(
      createEmptyDeckState(),
      candidate('OP16-022', { counter: Number.MAX_SAFE_INTEGER }),
    )

    expect(() =>
      addCandidateToDeckState(
        atMaximum,
        candidate('OP16-023', { counter: 1 }),
      ),
    ).toThrow('Total counter value must remain a safe integer.')
  })

  it('is deterministic, does not mutate inputs, and deeply freezes results', () => {
    const item = candidate('OP16-016', {
      name: 'Mutable Input',
      traits: ['Navy'],
      colors: ['Blue'],
    })
    const empty = createEmptyDeckState()
    const first = addCandidateToDeckState(empty, item)
    const second = addCandidateToDeckState(createEmptyDeckState(), item)
    const support = buildPoolSupport([{ ...item, quantity: 2 }])

    expect(first).toEqual(second)
    expect(empty.size).toBe(0)
    expect(item.card.traits).toEqual(['Navy'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.coverage)).toBe(true)
    expect(Object.isFrozen(first.costCounts)).toBe(true)
    expect(Object.isFrozen(first.selectedCountsByCardNumber)).toBe(true)
    expect(Object.isFrozen(first.selectedCountsByName)).toBe(true)
    expect(Object.isFrozen(first.selectedCountsByTrait)).toBe(true)
    expect(Object.isFrozen(first.cardSupportByNumber)).toBe(true)
    expect(Object.isFrozen(first.cardSupportByNumber['OP16-016'])).toBe(true)
    expect(Object.isFrozen(first.cardSupportByNumber['OP16-016']?.traits)).toBe(
      true,
    )
    expect(Object.isFrozen(first.importantPlayCounts)).toBe(true)
    expect(Object.isFrozen(support)).toBe(true)
    expect(Object.isFrozen(support.byCardNumber)).toBe(true)
    expect(Object.isFrozen(support.byName)).toBe(true)
    expect(Object.isFrozen(support.byTrait)).toBe(true)
    expect(Object.isFrozen(support.cardSupportByNumber)).toBe(true)
    expect(Object.isFrozen(support.cardSupportByNumber['OP16-016'])).toBe(true)
    expect(Object.isFrozen(support.cardSupportByNumber['OP16-016']?.traits)).toBe(
      true,
    )
  })
})
