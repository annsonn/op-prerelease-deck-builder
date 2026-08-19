import { describe, expect, it } from 'vitest'

import { loadSetConfigFromValue } from './config.js'
import { sourceCardSchema, sourceConfigSchema } from './model.js'

describe('sourceCardSchema', () => {
  it('accepts a normalized OP16 character record', () => {
    const card = sourceCardSchema.parse({
      sourceRecordId: 'OP16-005:0',
      cardNumber: 'OP16-005',
      name: 'Example Blocker',
      rarity: 'UC',
      cardType: 'CHARACTER',
      colors: ['Red'],
      cost: 8,
      life: null,
      power: 8000,
      counter: 1000,
      attribute: 'Slash',
      traits: ['Example Crew'],
      effect: '[Blocker]',
      trigger: '',
      setMembership: ['OP16'],
    })

    expect(card.cardNumber).toBe('OP16-005')
  })

  it('accepts a structurally valid colorless card', () => {
    const card = sourceCardSchema.parse({
      sourceRecordId: 'OP16-005:1',
      cardNumber: 'OP16-005',
      name: 'Example Blocker',
      rarity: 'UC',
      cardType: 'CHARACTER',
      colors: [],
      cost: 8,
      life: null,
      power: 8000,
      counter: 1000,
      attribute: 'Slash',
      traits: ['Example Crew'],
      effect: '[Blocker]',
      trigger: '',
      setMembership: ['OP16'],
    })

    expect(card.colors).toEqual([])
  })

  it('accepts treatment rarity labels for source variants', () => {
    const card = sourceCardSchema.parse({
      sourceRecordId: 'OP16-005:1',
      cardNumber: 'OP16-005',
      name: 'Example Blocker',
      rarity: 'TR',
      cardType: 'CHARACTER',
      colors: ['Red'],
      cost: 8,
      life: null,
      power: 8000,
      counter: 1000,
      attribute: 'Slash',
      traits: ['Example Crew'],
      effect: '[Blocker]',
      trigger: '',
      setMembership: ['OP16'],
    })

    expect(card.rarity).toBe('TR')
  })
})

describe('loadSetConfigFromValue', () => {
  it('rejects an unsupported source type', () => {
    expect(() =>
      loadSetConfigFromValue(
        {
          sets: {
            op16: {
              sourceType: 'scrape-anything',
              source: 'x',
            },
          },
        },
        'op16',
      ),
    ).toThrow(/sourceType/i)
  })
})

describe('sourceConfigSchema', () => {
  const cardKaizokuSource = {
    sourceType: 'cardkaizoku-json' as const,
    source: 'https://cdn.cardkaizoku.com/card_data_v20260813T061527.json',
    sourceSha256: '360eb0fa0e568b3e120721b6ef8b1a9ce8e4a87748a4a278c6a31ed73ec68d10',
    cachePath: 'tmp/catalog/source/card_data_v20260813T061527.json',
    targetSet: 'op17',
    expectedFirst: 1,
    expectedLast: 119,
    expectedSpecialReprints: [],
  }

  it('accepts a resolved Card Kaizoku runtime source', () => {
    expect(sourceConfigSchema.parse(cardKaizokuSource)).toEqual(cardKaizokuSource)
  })

  it('rejects an invalid Card Kaizoku checksum', () => {
    expect(() =>
      sourceConfigSchema.parse({
        ...cardKaizokuSource,
        sourceSha256: 'not-a-sha256',
      }),
    ).toThrow(/sourceSha256/)
  })

  it('rejects an empty Card Kaizoku cache path', () => {
    expect(() =>
      sourceConfigSchema.parse({
        ...cardKaizokuSource,
        cachePath: '',
      }),
    ).toThrow(/cachePath/)
  })

  it('rejects a reversed Card Kaizoku expected card range', () => {
    expect(() =>
      sourceConfigSchema.parse({
        ...cardKaizokuSource,
        expectedFirst: 119,
        expectedLast: 1,
      }),
    ).toThrow('expectedFirst must be less than or equal to expectedLast')
  })

  it('defaults expected special reprints to an empty inventory', () => {
    expect(
      sourceConfigSchema.parse({
        sourceType: 'official-html',
        source: 'https://example.com/op16',
        targetSet: 'op16',
        expectedFirst: 1,
        expectedLast: 119,
      }).expectedSpecialReprints,
    ).toEqual([])
  })

  it('rejects a reversed expected card range', () => {
    expect(() =>
      sourceConfigSchema.parse({
        sourceType: 'official-html',
        source: 'https://example.com/op16',
        targetSet: 'op16',
        expectedFirst: 119,
        expectedLast: 1,
      }),
    ).toThrow('expectedFirst must be less than or equal to expectedLast')
  })
})
