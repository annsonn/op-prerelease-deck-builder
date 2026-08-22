import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { canonicalize } from './canonicalize.js'
import { serializedCardFeaturesSchema } from '../../shared/catalog.js'
import {
  cardFeaturesSchema,
  classifyCardFeatures,
} from '../../shared/card-features.js'
import { deriveStrategy } from './derive-strategy.js'
import type { PlayableCard } from './model.js'
import { parseOfficialText } from './parse-official-text.js'

const officialFixtureUrl = new URL(
  './__fixtures__/official-page.txt',
  import.meta.url,
)

const baseCard: PlayableCard = {
  cardNumber: 'OP16-001',
  name: 'Test Card',
  rarity: 'C',
  cardType: 'CHARACTER',
  colors: ['Red'],
  cost: 1,
  life: null,
  power: 1000,
  counter: 1000,
  attribute: 'Slash',
  traits: ['Test'],
  effect: '',
  trigger: '',
  setMembership: ['OP16'],
  variantsCollapsed: 1,
  entryShortcut: '001',
  isSpecialReprint: false,
}

describe('deriveStrategy', () => {
  it('suggests fixture blocker and two-K counter roles', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')
    const sourceCards = parseOfficialText(fixture, 'op16')
    const card = canonicalize(sourceCards, 'op16').find(
      (candidate) => candidate.cardNumber === 'OP16-005',
    )

    if (card === undefined) {
      throw new Error('expected canonical OP16-005 fixture card')
    }

    const suggestion = deriveStrategy({ ...card, counter: 2000 })

    expect(suggestion).toEqual({
      cardNumber: 'OP16-005',
      roles: ['blocker', 'twoKCounter'],
      features: classifyCardFeatures({ ...card, counter: 2000 }),
      reviewStatus: 'suggested',
    })
  })

  it('publishes the shared feature classification without changing legacy roles', () => {
    const card = {
      ...baseCard,
      counter: 2000,
      cost: 8,
      power: 9000,
      effect: '[Blocker] Draw 2 cards. K.O. up to 1 of your opponent\'s Characters.',
    }

    const suggestion = deriveStrategy(card)
    const serializedFeatures = serializedCardFeaturesSchema.parse(
      suggestion.features,
    )
    const canonicalFeatures = cardFeaturesSchema.parse(serializedFeatures)

    expect(suggestion.features).toEqual(classifyCardFeatures(card))
    expect(canonicalFeatures.effectModelVersion).toBe(2)
    expect(canonicalFeatures.effectParserRevision).toBe(2)
    expect(serializedFeatures).toEqual(suggestion.features)
    expect(suggestion.roles).toEqual([
      'blocker',
      'boss',
      'draw',
      'removal',
      'twoKCounter',
    ])
  })

  it('returns deterministic feature suggestions for the same card', () => {
    const card = {
      ...baseCard,
      effect: 'Draw 1 card. [Rush] [Banish]',
      trigger: 'K.O. up to 1 of your opponent\'s Characters.',
    }

    expect(deriveStrategy(card)).toEqual(deriveStrategy(card))
  })

  it('detects draw and removal text across effects and triggers', () => {
    const suggestion = deriveStrategy({
      ...baseCard,
      effect: 'Draw 2 cards. K.O. up to 1 opposing Character.',
      trigger: 'Return up to 1 of your opponent\'s Characters to their hand.',
    })

    expect(suggestion.roles).toEqual(['draw', 'removal'])
  })

  it('suggests pressure only when character cost and power qualify', () => {
    expect(
      deriveStrategy({ ...baseCard, cost: 5, power: 5000 }).roles,
    ).toEqual(['pressure'])
    expect(
      deriveStrategy({ ...baseCard, cost: null, power: 5000 }).roles,
    ).not.toContain('pressure')
  })

  it('suggests boss for high-cost, high-power characters', () => {
    expect(
      deriveStrategy({ ...baseCard, cost: 8, power: 9000 }).roles,
    ).toEqual(['boss'])
  })

  it('detects bottom-deck removal and returns sorted, deduplicated roles', () => {
    const suggestion = deriveStrategy({
      ...baseCard,
      cost: 8,
      power: 9000,
      effect:
        'Draw 1 card. Place up to 1 of your opponent\'s Characters at the bottom of their deck.',
      trigger: 'Draw 1 card.',
    })

    expect(suggestion.roles).toEqual(['boss', 'draw', 'removal'])
  })

  it.each([
    ['K.O. up to 1 of your opponent\'s Characters with a cost of 3 or less.'],
    ['Return up to 1 of your opponent\'s Characters to the owner\'s hand.'],
    [
      'Place up to 1 of your opponent\'s Characters at the bottom of the owner\'s deck.',
    ],
  ])('detects opponent-targeted removal text: %s', (effect) => {
    expect(deriveStrategy({ ...baseCard, effect }).roles).toContain('removal')
  })

  it.each([
    ['[On K.O.] Draw 1 card.'],
    ['K.O. up to 1 of your Characters.'],
    ['Return up to 1 of your Characters to the owner\'s hand.'],
    ['Place up to 1 card from your hand at the bottom of your deck.'],
  ])('does not suggest removal for non-removal text: %s', (effect) => {
    expect(deriveStrategy({ ...baseCard, effect }).roles).not.toContain(
      'removal',
    )
  })
})
