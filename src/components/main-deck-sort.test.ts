import { describe, expect, it } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { DeckLine } from '../solver/types.js'

import {
  defaultDirectionFor,
  MAIN_DECK_SORT_FIELDS,
  parseMainDeckSortField,
  sortMainDeck,
  type MainDeckSortDirection,
  type MainDeckSortField,
} from './main-deck-sort.js'

const card = (
  cardNumber: string,
  name: string,
  cost: number | null,
  power: number | null,
): PlayableCard => {
  const fixture: PlayableCard = {
    cardNumber,
    name,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost,
    life: null,
    power,
    counter: 1_000,
    attribute: 'Strike',
    traits: ['Test'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: cardNumber.slice(-3),
    isSpecialReprint: false,
  }

  Object.freeze(fixture.colors)
  Object.freeze(fixture.traits)
  Object.freeze(fixture.setMembership)

  return Object.freeze(fixture)
}

const line = (card: PlayableCard, score: number): DeckLine =>
  Object.freeze({
    card,
    quantity: 1,
    allocatedRoles: Object.freeze({
      twoKCounter: 0,
      blocker: 0,
      interaction: 0,
      pressure: 0,
      boss: 0,
      curve: 1,
    }),
    score,
    reasons: Object.freeze(['Test fixture']),
  })

const LINES: readonly DeckLine[] = Object.freeze([
  line(card('OP16-004', 'Gamma', null, 9_000), 5),
  line(card('OP16-002', 'Alpha', 2, 4_000), 20),
  line(card('OP16-010', 'beta', 5, 7_000), 10),
  line(card('OP16-003', 'alpha', 2, null), 20),
])

const cardNumbers = (lines: readonly DeckLine[]): string[] =>
  lines.map(({ card: { cardNumber } }) => cardNumber)

describe('main deck sorting', () => {
  it.each<[
    MainDeckSortField,
    MainDeckSortDirection,
    readonly string[],
  ]>([
    ['score', 'descending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['score', 'ascending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
    ['name', 'ascending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['name', 'descending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
    ['cost', 'ascending', ['OP16-002', 'OP16-003', 'OP16-010', 'OP16-004']],
    ['cost', 'descending', ['OP16-010', 'OP16-002', 'OP16-003', 'OP16-004']],
    ['power', 'ascending', ['OP16-002', 'OP16-010', 'OP16-004', 'OP16-003']],
    ['power', 'descending', ['OP16-004', 'OP16-010', 'OP16-002', 'OP16-003']],
  ])('sorts by %s %s', (field, direction, expected) => {
    expect(cardNumbers(sortMainDeck(LINES, field, direction))).toEqual(expected)
  })

  it('defines the natural default direction for every sort field', () => {
    expect(MAIN_DECK_SORT_FIELDS).toEqual(['score', 'name', 'cost', 'power'])
    expect(
      Object.fromEntries(
        MAIN_DECK_SORT_FIELDS.map((field) => [
          field,
          defaultDirectionFor(field),
        ]),
      ),
    ).toEqual({
      score: 'descending',
      name: 'ascending',
      cost: 'ascending',
      power: 'descending',
    })
  })

  it('strictly parses supported fields and rejects unsupported values', () => {
    for (const field of MAIN_DECK_SORT_FIELDS) {
      expect(parseMainDeckSortField(field)).toBe(field)
    }

    expect(() => parseMainDeckSortField('rarity')).toThrowError(
      /^Unsupported Main deck sort field: rarity\.$/,
    )
  })

  it('returns a new array without changing the frozen input order', () => {
    const before = cardNumbers(LINES)
    const sorted = sortMainDeck(LINES, 'score', 'descending')

    expect(sorted).not.toBe(LINES)
    expect(cardNumbers(LINES)).toEqual(before)
  })
})
