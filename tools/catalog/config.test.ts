import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadSetConfig, loadSetConfigFromValue } from './config.js'

const snapshot = {
  source: 'https://cdn.example.test/cards.json',
  sha256: 'a'.repeat(64),
  cachePath: 'tmp/catalog/source/cards.json',
}

const cardKaizokuConfig = {
  cardKaizokuSnapshot: snapshot,
  sets: {
    op01: {
      sourceType: 'cardkaizoku-json',
      targetSet: 'op01',
      expectedFirst: 1,
      expectedLast: 2,
      expectedSpecialReprints: [],
    },
    op02: {
      sourceType: 'cardkaizoku-json',
      targetSet: 'op02',
      expectedFirst: 1,
      expectedLast: 3,
      expectedSpecialReprints: [],
    },
  },
}

describe('loadSetConfigFromValue', () => {
  it.each(['op01', 'op02'])('merges the shared Card Kaizoku snapshot into %s', (setId) => {
    expect(loadSetConfigFromValue(cardKaizokuConfig, setId)).toEqual({
      ...cardKaizokuConfig.sets[setId as keyof typeof cardKaizokuConfig.sets],
      source: snapshot.source,
      sourceSha256: snapshot.sha256,
      cachePath: snapshot.cachePath,
    })
  })

  it('matches set IDs case-insensitively', () => {
    expect(loadSetConfigFromValue(cardKaizokuConfig, 'OP01').targetSet).toBe('op01')
  })

  it('fails clearly when a Card Kaizoku set has no shared snapshot', () => {
    expect(() =>
      loadSetConfigFromValue(
        {
          sets: {
            op01: cardKaizokuConfig.sets.op01,
          },
        },
        'op01',
      ),
    ).toThrow(/Card Kaizoku snapshot.*op01/i)
  })
})

const sharedSnapshot = {
  source: 'https://cdn.cardkaizoku.com/card_data_v20260813T061527.json',
  sourceSha256: '360eb0fa0e568b3e120721b6ef8b1a9ce8e4a87748a4a278c6a31ed73ec68d10',
  cachePath: 'tmp/catalog/source/card_data_v20260813T061527.json',
}

const expectedSets = {
  op01: { expectedLast: 121, expectedSpecialReprints: [] },
  op02: { expectedLast: 121, expectedSpecialReprints: [] },
  op03: {
    expectedLast: 123,
    expectedSpecialReprints: ['OP01-051', 'ST01-012', 'ST03-009', 'ST04-003'],
  },
  op04: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP01-047',
      'OP01-078',
      'OP02-004',
      'OP02-085',
      'OP02-099',
      'OP03-006',
      'OP03-032',
      'OP03-050',
      'OP03-070',
      'OP03-081',
      'OP03-116',
    ],
  },
  op05: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP01-016',
      'OP01-121',
      'OP02-120',
      'OP03-092',
      'OP04-044',
      'ST01-012',
    ],
  },
  op06: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP03-008',
      'OP03-114',
      'OP04-024',
      'OP04-064',
      'OP05-051',
      'OP05-091',
      'ST01-007',
    ],
  },
  op07: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP01-035',
      'OP01-073',
      'OP03-003',
      'OP03-078',
      'OP05-074',
      'OP06-101',
      'ST10-010',
    ],
  },
  op08: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP02-013',
      'OP03-112',
      'OP07-109',
      'ST02-007',
      'ST03-004',
      'ST04-005',
      'ST06-006',
    ],
  },
  op09: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP04-119',
      'OP05-067',
      'OP05-093',
      'OP05-119',
      'OP07-015',
      'OP07-051',
      'OP08-106',
      'ST18-004',
    ],
  },
  op10: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'EB01-056',
      'OP07-021',
      'OP08-052',
      'ST12-012',
      'ST14-003',
      'ST15-002',
      'ST18-001',
    ],
  },
  op11: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'EB01-057',
      'OP05-119',
      'OP06-119',
      'OP07-085',
      'OP09-005',
      'OP09-015',
      'ST16-004',
      'ST18-005',
    ],
  },
  op12: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'OP06-050',
      'OP09-013',
      'OP09-037',
      'OP09-093',
      'OP10-063',
      'OP10-082',
      'ST13-011',
      'ST18-004',
    ],
  },
  op13: {
    expectedLast: 120,
    expectedSpecialReprints: [
      'EB02-028',
      'OP07-111',
      'OP07-118',
      'OP09-004',
      'OP09-009',
      'OP09-118',
      'OP09-119',
      'OP10-030',
      'OP11-058',
    ],
  },
  op14: {
    expectedLast: 120,
    expectedSpecialReprints: [
      'EB01-003',
      'EB01-023',
      'EB04-011',
      'EB04-012',
      'EB04-013',
      'EB04-014',
      'EB04-015',
      'EB04-016',
      'EB04-017',
      'EB04-018',
      'EB04-019',
      'EB04-020',
      'EB04-021',
      'EB04-022',
      'EB04-023',
      'EB04-024',
      'EB04-025',
      'EB04-026',
      'EB04-027',
      'EB04-028',
      'EB04-029',
      'EB04-030',
      'EB04-031',
      'EB04-032',
      'EB04-033',
      'EB04-034',
      'EB04-035',
      'EB04-036',
      'EB04-037',
      'EB04-038',
      'EB04-039',
      'EB04-040',
      'EB04-041',
      'OP06-093',
      'OP07-046',
      'OP09-051',
      'OP10-065',
      'OP12-030',
      'OP12-108',
      'PRB02-006',
    ],
  },
  op15: { expectedLast: 119, expectedSpecialReprints: [] },
  op16: {
    expectedLast: 119,
    expectedSpecialReprints: [
      'EB04-054',
      'OP10-045',
      'OP11-067',
      'OP14-029',
      'OP14-084',
      'ST15-005',
    ],
  },
  op17: { expectedLast: 119, expectedSpecialReprints: [] },
} as const

describe('catalog-sources.json', () => {
  it('defines exactly OP01 through OP17', () => {
    const catalogSources: unknown = JSON.parse(
      readFileSync(resolve('catalog-sources.json'), 'utf8'),
    )

    expect(Object.keys((catalogSources as { sets: object }).sets)).toEqual(
      Object.keys(expectedSets),
    )
  })

  it.each(Object.entries(expectedSets))(
    'loads the shared Card Kaizoku snapshot and inventory for %s',
    (setId, expected) => {
      expect(loadSetConfig(setId)).toEqual({
        sourceType: 'cardkaizoku-json',
        ...sharedSnapshot,
        targetSet: setId,
        expectedFirst: 1,
        expectedLast: expected.expectedLast,
        expectedSpecialReprints: expected.expectedSpecialReprints,
      })
    },
  )

  it('matches configured set IDs case-insensitively', () => {
    expect(loadSetConfig('OP14')).toEqual(loadSetConfig('op14'))
  })
})
