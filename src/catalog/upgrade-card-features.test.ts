import { describe, expect, it } from 'vitest'

import type {
  PlayableCard,
  SerializedCardFeatures,
} from '../../shared/catalog.js'
import { serializedCardFeaturesSchema } from '../../shared/catalog.js'
import {
  cardFeaturesSchema,
  classifyCardFeatures,
} from '../../shared/card-features.js'

import { upgradeSerializedCardFeatures } from './upgrade-card-features.js'

function card(overrides: Partial<PlayableCard> = {}): PlayableCard {
  return {
    cardNumber: 'OP17-001',
    name: 'Test Card',
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 5000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP17'],
    variantsCollapsed: 1,
    entryShortcut: '001',
    isSpecialReprint: false,
    ...overrides,
  }
}

function legacyFeatures(): SerializedCardFeatures {
  return serializedCardFeaturesSchema.parse({
    flags: {
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
    },
    rainbowUsableFlags: {
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
    },
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
  })
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return

  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child)
}

describe('upgradeSerializedCardFeatures', () => {
  it('accepts exact current effects while recomputing every projection', () => {
    const printedCard = card({ effect: '[On Play] Draw 1 card.' })
    const canonical = classifyCardFeatures(printedCard)
    const parsed = cardFeaturesSchema.parse(canonical)
    const serialized = {
      ...parsed,
      flags: { ...parsed.flags, draw: false },
      rainbowUsableFlags: { ...parsed.rainbowUsableFlags, draw: false },
      supportRequirementsByFlag: {
        ...parsed.supportRequirementsByFlag,
        draw: {
          requiredNames: ['Wrong Name'],
          requiredTraits: ['Wrong Trait'],
        },
      },
      rainbowLuffyCompatibility: 'incompatible' as const,
      searchableTraits: ['Wrong Trait'],
      searchableNames: ['Wrong Name'],
      requiredTraits: ['Wrong Trait'],
      requiredNames: ['Wrong Name'],
      evidence: ['wrong'],
    }

    const upgraded = upgradeSerializedCardFeatures(printedCard, serialized)

    expect(upgraded).toEqual(canonical)
    expect(upgraded).not.toBe(serialized)
    expect(upgraded.effects).toEqual(serialized.effects)
    expect(upgraded.effects).not.toBe(serialized.effects)
    expect(serialized.flags.draw).toBe(false)
    expect(serialized.evidence).toEqual(['wrong'])
    expectDeeplyFrozen(upgraded)
  })

  it.each([
    ['effects', (features: ReturnType<typeof cardFeaturesSchema.parse>) => ({
      ...features,
      effects: features.effects.map((effect, index) =>
        index === 0 ? { ...effect, id: 'mismatched-effect-id' } : effect,
      ),
    })],
    ['diagnostics', (features: ReturnType<typeof cardFeaturesSchema.parse>) => ({
      ...features,
      unparsedClauses: ['mismatched diagnostic'],
    })],
  ])('reparses semantically mismatched current %s', (_label, mutate) => {
    const printedCard = card({ effect: '[On Play] Draw 1 card.' })
    const canonical = classifyCardFeatures(printedCard)
    const serialized = mutate(cardFeaturesSchema.parse(canonical))

    const upgraded = upgradeSerializedCardFeatures(printedCard, serialized)

    expect(upgraded).toEqual(canonical)
    expect(upgraded.effects[0]?.id).not.toBe('mismatched-effect-id')
    expect(upgraded.unparsedClauses).not.toContain('mismatched diagnostic')
    expectDeeplyFrozen(upgraded)
  })

  it('returns a detached canonical copy for an unmodified current model', () => {
    const printedCard = card({ effect: '[On Play] Draw 1 card.' })
    const canonical = classifyCardFeatures(printedCard)
    const serialized = cardFeaturesSchema.parse(canonical)

    const upgraded = upgradeSerializedCardFeatures(printedCard, serialized)

    expect(upgraded).toEqual(canonical)
    expect(upgraded).not.toBe(serialized)
    expect(upgraded.effects).not.toBe(serialized.effects)
    expectDeeplyFrozen(upgraded)
  })

  it('reparses accepted revision-one effects with the current parser', () => {
    const printedCard = card({ effect: '[Rush: Character]' })
    const blankProjection = classifyCardFeatures(card())
    const priorRevision = serializedCardFeaturesSchema.parse({
      ...blankProjection,
      effectParserRevision: 1,
      effects: [],
      unparsedClauses: ['[Rush: Character]'],
    })

    const upgraded = upgradeSerializedCardFeatures(
      printedCard,
      priorRevision,
    )

    expect(upgraded.effectParserRevision).toBe(2)
    expect(upgraded.flags.rush).toBe(true)
    expect(upgraded.rainbowUsableFlags.rush).toBe(true)
    expect(upgraded.effects).toMatchObject([
      { branches: [{ actions: [{ kind: 'keyword', keyword: 'rush' }] }] },
    ])
    expect(upgraded.unparsedClauses).not.toContain('[Rush: Character]')
    expectDeeplyFrozen(upgraded)
  })

  it('reparses legacy and absent features from printed text', () => {
    const blocker = upgradeSerializedCardFeatures(
      card({ effect: '[Blocker]' }),
      legacyFeatures(),
    )
    const rush = upgradeSerializedCardFeatures(
      card({ effect: '[Rush]' }),
      undefined,
    )

    expect(blocker.effects).not.toHaveLength(0)
    expect(blocker.flags.blocker).toBe(true)
    expect(rush.effectModelVersion).toBe(2)
    expect(rush.effectParserRevision).toBe(2)
    expect(rush.flags.rush).toBe(true)
    expectDeeplyFrozen(blocker)
    expectDeeplyFrozen(rush)
  })
})
