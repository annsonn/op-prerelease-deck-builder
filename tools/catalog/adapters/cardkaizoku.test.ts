import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  adaptCardKaizokuRows,
  inferCardKaizokuMemberships,
} from './cardkaizoku.js'

const fixtureUrl = new URL(
  '../__fixtures__/cardkaizoku-rows.json',
  import.meta.url,
)

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown
}

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    cardNumber: 'OP16-010',
    cardName: 'Test Character',
    cost: '3',
    attribute: 'Strike',
    cardType: 'CHARACTER',
    power: '4000',
    counter: '1000',
    color: 'Red',
    feature: 'Test Crew',
    text: 'Test effect',
    rarity: 'C',
    trigger: '',
    cardSet: 'OP16',
    ...overrides,
  }
}

describe('inferCardKaizokuMemberships', () => {
  it('normalizes, validates, deduplicates, and code-unit sorts memberships', () => {
    expect(
      inferCardKaizokuMemberships({
        cardSet: ' op10 ',
        products: [
          { cardSet: 'OP16', price: 999 },
          { cardSet: ' eb01 ' },
          { cardSet: 'OP16' },
          { cardSet: 'not-a-set' },
          { cardSet: 'OP-16' },
          { cardSet: 16 },
        ],
      }),
    ).toEqual(['EB01', 'OP10', 'OP16'])
  })
})

describe('adaptCardKaizokuRows', () => {
  it('includes top-level and product-derived target memberships in source order', async () => {
    const cards = adaptCardKaizokuRows(await loadFixture(), ' op16 ')

    expect(cards.map(({ sourceRecordId, cardNumber }) => ({ sourceRecordId, cardNumber }))).toEqual([
      { sourceRecordId: 'OP16-001:0', cardNumber: 'OP16-001' },
      { sourceRecordId: 'OP16-005:1', cardNumber: 'OP16-005' },
      { sourceRecordId: 'OP16-005:2', cardNumber: 'OP16-005' },
      { sourceRecordId: 'OP16-090:3', cardNumber: 'OP16-090' },
      { sourceRecordId: 'OP16-100:4', cardNumber: 'OP16-100' },
      { sourceRecordId: 'OP10-045:5', cardNumber: 'OP10-045' },
    ])
    expect(cards[2]?.setMembership).toEqual(['OP16', 'PRB02'])
    expect(cards[5]?.setMembership).toEqual(['OP10', 'OP16'])
  })

  it('keeps duplicate printings as separate source records', async () => {
    const variants = adaptCardKaizokuRows(await loadFixture(), 'OP16').filter(
      ({ cardNumber }) => cardNumber === 'OP16-005',
    )

    expect(variants).toHaveLength(2)
    expect(variants.map(({ rarity }) => rarity)).toEqual(['UC', 'TR'])
  })

  it('splits colors and traits while omitting blank and dash tokens', async () => {
    const leader = adaptCardKaizokuRows(await loadFixture(), 'OP16')[0]

    expect(leader?.colors).toEqual(['Red', 'Green'])
    expect(leader?.traits).toEqual(['Example Fleet', 'Test Region'])
  })

  it('maps leader cost to life and other card costs to cost', async () => {
    const cards = adaptCardKaizokuRows(await loadFixture(), 'OP16')
    const leader = cards.find(({ cardType }) => cardType === 'LEADER')
    const otherCards = cards.filter(({ cardType }) => cardType !== 'LEADER')

    expect(leader).toMatchObject({ cost: null, life: 5 })
    expect(otherCards.every(({ life }) => life === null)).toBe(true)
    expect(otherCards.map(({ cost }) => cost)).toEqual([8, 8, 2, 0, 5])
  })

  it('maps blank and dash numeric values to null, preserves zero, and defaults blank rarity', async () => {
    const cards = adaptCardKaizokuRows(await loadFixture(), 'OP16')
    const event = cards.find(({ cardNumber }) => cardNumber === 'OP16-090')
    const stage = cards.find(({ cardNumber }) => cardNumber === 'OP16-100')

    expect(event).toMatchObject({ rarity: 'UNKNOWN', power: null, counter: null })
    expect(stage).toMatchObject({ cost: 0, power: null, counter: null })
  })

  it('filters blank, malformed-ID, and non-target rows before retained-field validation', async () => {
    const fixture = await loadFixture()

    expect(() => adaptCardKaizokuRows(fixture, 'OP16')).not.toThrow()
  })

  it('rejects malformed numeric values with card and field context', () => {
    expect(() =>
      adaptCardKaizokuRows([validRow({ cost: '3x' })], 'OP16'),
    ).toThrow('OP16-010 has invalid cost value "3x"')
  })

  it('requires retained fields to be strings on candidate card rows', () => {
    expect(() =>
      adaptCardKaizokuRows([validRow({ cardName: 42 })], 'OP16'),
    ).toThrow(/cardName/)
  })

  it('does not leak source imagery, Japanese fields, products, prices, or URLs', async () => {
    const output = JSON.stringify(adaptCardKaizokuRows(await loadFixture(), 'OP16'))

    expect(output).not.toMatch(/bucketImg|cardImg|jp_|products|price|url|must-not-leak/)
  })
})
