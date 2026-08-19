import { describe, expect, it } from 'vitest'

import type { SourceCard, SourceConfig } from './model.js'
import { prepareCatalog } from './prepare.js'

function sourceCard(
  cardNumber: string,
  sourceRecordId: string,
  rarity = 'C',
): SourceCard {
  return {
    sourceRecordId,
    cardNumber,
    name: `Test ${cardNumber}`,
    rarity,
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
  }
}

const sourceCards = [
  sourceCard('OP17-001', 'OP17-001:0', 'C'),
  sourceCard('OP17-001', 'OP17-001:1', 'SP CARD'),
  sourceCard('OP10-045', 'OP10-045:2', 'SR'),
  sourceCard('EB04-054', 'EB04-054:3', 'R'),
]

const cardKaizokuConfig: SourceConfig = {
  sourceType: 'cardkaizoku-json',
  source: 'https://cdn.example.test/cards.json',
  sourceSha256: 'a'.repeat(64),
  cachePath: 'tmp/catalog/source/cards.json',
  targetSet: 'op17',
  expectedFirst: 1,
  expectedLast: 1,
  expectedSpecialReprints: ['OP10-045', 'EB04-054'],
}

describe('prepareCatalog', () => {
  it('prepares the complete deterministic Card Kaizoku catalog bundle', () => {
    const prepared = prepareCatalog(sourceCards, cardKaizokuConfig)
    const repeated = prepareCatalog([...sourceCards].reverse(), cardKaizokuConfig)

    expect(prepared.bundle['manifest.json']).toEqual({
      schemaVersion: 1,
      setId: 'OP17',
      language: 'en',
      source: 'https://cdn.example.test/cards.json',
      sourceType: 'cardkaizoku-json',
      sourceSha256: 'a'.repeat(64),
      readiness: 'needs-review',
    })
    expect(Object.keys(prepared.bundle).sort()).toEqual([
      'cards.json',
      'import-report.json',
      'manifest.json',
      'set-contents.json',
      'strategy-suggestions.json',
    ])
    expect(prepared.bundle).toEqual(repeated.bundle)
    expect(prepared.specialReprints).toEqual(['EB04-054', 'OP10-045'])
    expect(prepared.validation).toEqual({
      errors: [],
      warnings: [],
      readiness: 'needs-review',
    })
    expect(prepared.result).toEqual({
      setId: 'OP17',
      cardCount: 3,
      variantCount: 4,
      specialReprintCount: 2,
      readiness: 'needs-review',
    })
    expect(prepared.bundle['import-report.json']).toEqual({
      sourceRecords: 4,
      playableIdentities: 3,
      variantsCollapsed: 1,
      specialReprints: ['EB04-054', 'OP10-045'],
      validation: prepared.validation,
    })
  })

  it.each([
    {
      sourceType: 'local-json' as const,
      source: 'tmp/catalog/source/op17.json',
    },
    {
      sourceType: 'official-html' as const,
      source: 'https://example.test/cards',
    },
  ])('omits sourceSha256 from $sourceType manifests', (directSource) => {
    const config: SourceConfig = {
      ...directSource,
      targetSet: 'op17',
      expectedFirst: 1,
      expectedLast: 1,
      expectedSpecialReprints: ['OP10-045', 'EB04-054'],
    }

    expect(prepareCatalog(sourceCards, config).bundle['manifest.json']).toEqual({
      schemaVersion: 1,
      setId: 'OP17',
      language: 'en',
      source: directSource.source,
      sourceType: directSource.sourceType,
      readiness: 'needs-review',
    })
  })
})
