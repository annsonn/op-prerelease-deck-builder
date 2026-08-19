import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { canonicalize } from './canonicalize.js'
import { parseOfficialText } from './parse-official-text.js'

const officialFixtureUrl = new URL(
  './__fixtures__/official-page.txt',
  import.meta.url,
)

describe('canonicalize', () => {
  it('collapses art variants into sorted playable card identities', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')
    const sourceCards = parseOfficialText(fixture, 'op16')
    const secondVariant = sourceCards[1]

    if (secondVariant === undefined) {
      throw new Error('expected a second OP16-005 fixture variant')
    }

    secondVariant.rarity = 'TR'

    const cards = canonicalize(sourceCards, 'op16')

    expect(
      cards.map(
        ({ cardNumber, rarity, isSpecialReprint, entryShortcut, variantsCollapsed }) => ({
          cardNumber,
          rarity,
          isSpecialReprint,
          entryShortcut,
          variantsCollapsed,
        }),
      ),
    ).toEqual([
      {
        cardNumber: 'EB04-054',
        rarity: 'SP CARD',
        isSpecialReprint: true,
        entryShortcut: null,
        variantsCollapsed: 1,
      },
      {
        cardNumber: 'OP16-005',
        rarity: 'UC',
        isSpecialReprint: false,
        entryShortcut: '005',
        variantsCollapsed: 2,
      },
    ])
  })

  it('rejects variants whose playable data conflicts', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')
    const sourceCards = parseOfficialText(fixture, 'op16')
    const secondVariant = sourceCards[1]

    if (secondVariant === undefined) {
      throw new Error('expected a second OP16-005 fixture variant')
    }

    secondVariant.power = 9000

    expect(() => canonicalize(sourceCards, 'op16')).toThrow(
      'Conflicting playable data for OP16-005',
    )
  })

  it.each([
    ['UC', 'TR'],
    ['TR', 'UC'],
  ])(
    'selects the single base rarity regardless of variant order: %s, %s',
    async (firstRarity, secondRarity) => {
      const fixture = await readFile(officialFixtureUrl, 'utf8')
      const sourceCards = parseOfficialText(fixture, 'op16')
      const firstVariant = sourceCards[0]
      const secondVariant = sourceCards[1]

      if (firstVariant === undefined || secondVariant === undefined) {
        throw new Error('expected two OP16-005 fixture variants')
      }

      firstVariant.rarity = firstRarity
      secondVariant.rarity = secondRarity

      expect(
        canonicalize(sourceCards, 'op16').find(
          (card) => card.cardNumber === 'OP16-005',
        )?.rarity,
      ).toBe('UC')
    },
  )

  it.each([
    ['C', 'R'],
    ['R', 'C'],
  ])(
    'rejects conflicting base rarities regardless of order: %s, %s',
    async (firstRarity, secondRarity) => {
      const fixture = await readFile(officialFixtureUrl, 'utf8')
      const sourceCards = parseOfficialText(fixture, 'op16')
      const firstVariant = sourceCards[0]
      const secondVariant = sourceCards[1]

      if (firstVariant === undefined || secondVariant === undefined) {
        throw new Error('expected two OP16-005 fixture variants')
      }

      firstVariant.rarity = firstRarity
      secondVariant.rarity = secondRarity

      expect(() => canonicalize(sourceCards, 'op16')).toThrow(
        'Conflicting base rarities for OP16-005: C, R',
      )
    },
  )

  it('rejects ambiguous non-base rarities', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')
    const sourceCards = parseOfficialText(fixture, 'op16')
    const firstVariant = sourceCards[0]
    const secondVariant = sourceCards[1]

    if (firstVariant === undefined || secondVariant === undefined) {
      throw new Error('expected two OP16-005 fixture variants')
    }

    firstVariant.rarity = 'TR'
    secondVariant.rarity = 'SP CARD'

    expect(() => canonicalize(sourceCards, 'op16')).toThrow(
      'Ambiguous non-base rarities for OP16-005: SP CARD, TR',
    )
  })

  it('unions, deduplicates, and sorts variant set memberships', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')
    const sourceCards = parseOfficialText(fixture, 'op16')
    const firstVariant = sourceCards[0]
    const secondVariant = sourceCards[1]

    if (firstVariant === undefined || secondVariant === undefined) {
      throw new Error('expected two OP16-005 fixture variants')
    }

    firstVariant.setMembership = ['ST02', 'OP16']
    secondVariant.setMembership = ['ST01', 'OP16', 'ST02']

    expect(
      canonicalize(sourceCards, 'op16').find(
        (card) => card.cardNumber === 'OP16-005',
      )?.setMembership,
    ).toEqual(['OP16', 'ST01', 'ST02'])
  })
})
