import { describe, expect, it } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'

import {
  drawTestPool,
  generateTestPool,
  generateVirtualBoosterBox,
  testPoolPackCounts,
  type SimulatedBoosterBox,
  type SimulatedRarity,
  type TestPoolMode,
} from './generate-test-pool.js'

function card(
  cardNumber: string,
  rarity: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  const isSpecialReprint = !cardNumber.startsWith('OP16-')
  return {
    cardNumber,
    name: `${cardNumber} Test Card`,
    rarity,
    cardType: rarity === 'L' ? 'LEADER' : 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: isSpecialReprint ? null : cardNumber.slice(-3),
    isSpecialReprint,
    ...overrides,
  }
}

function runtimeCatalog(cards: readonly PlayableCard[]): RuntimeCatalog {
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
    cardsByNumber: new Map(cards.map((item) => [item.cardNumber, item])),
    normalCardsByShortcut: new Map(
      cards.flatMap((item) =>
        item.entryShortcut === null ? [] : [[item.entryShortcut, item] as const],
      ),
    ),
    specialCards: cards.filter((item) => item.isSpecialReprint),
    strategySuggestions: [],
    suggestionsByCardNumber: new Map(),
    featuresByCardNumber: new Map(),
  }
}

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function baseCards(): PlayableCard[] {
  return [
    card('OP16-001', 'L'),
    card('OP16-002', 'C'),
    card('OP16-003', 'C'),
    card('OP16-004', 'UC'),
    card('OP16-005', 'UC'),
    card('OP16-006', 'R', { variantsCollapsed: 1_000_000 }),
    card('OP16-007', 'SR'),
    card('OP16-008', 'SEC'),
  ]
}

const catalog = runtimeCatalog(baseCards())

function constantRandom(value: number): () => number {
  return () => value
}

function rarityTotal(
  counts: Readonly<Record<SimulatedRarity, number>>,
): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

describe('generateVirtualBoosterBox', () => {
  it('builds 24 twelve-card packs', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))

    expect(box.packs).toHaveLength(24)
    expect(box.packs.every((pack) => pack.length === 12)).toBe(true)
    expect(box.packs.flat()).toHaveLength(288)
  })

  it.each([
    {
      seed: 5,
      counts: { C: 168, UC: 71, L: 1, R: 41, SR: 7, SEC: 0 },
      parallelHits: 2,
    },
    {
      seed: 682,
      counts: { C: 168, UC: 71, L: 1, R: 39, SR: 8, SEC: 1 },
      parallelHits: 3,
    },
  ])(
    'honors the configured SR, SEC, and parallel-hit branch for seed $seed',
    ({ seed, counts, parallelHits }) => {
      const box = generateVirtualBoosterBox(catalog, lcg(seed))

      expect(box.rarityCounts).toEqual(counts)
      expect(box.parallelHitCardNumbers).toHaveLength(parallelHits)
      expect(box.parallelHitCardNumbers).toEqual(
        Array.from({ length: parallelHits }, () => 'OP16-006'),
      )
      expect(rarityTotal(box.rarityCounts)).toBe(288)
    },
  )

  it('places every leader once, removes one UC per leader, and preserves slot 10 as R', () => {
    const twoLeaderCatalog = runtimeCatalog([
      ...baseCards(),
      card('OP16-009', 'L'),
    ])
    const box = generateVirtualBoosterBox(twoLeaderCatalog, lcg(5))
    const leaderLocations = box.packs.flatMap((pack, packIndex) =>
      pack[8]?.endsWith('001') || pack[8]?.endsWith('009')
        ? [[packIndex, pack[8]] as const]
        : [],
    )

    expect(leaderLocations.map(([, number]) => number).sort()).toEqual([
      'OP16-001',
      'OP16-009',
    ])
    expect(new Set(leaderLocations.map(([index]) => index)).size).toBe(2)
    expect(box.rarityCounts.UC).toBe(70)
    expect(box.rarityCounts.L).toBe(2)
    expect(
      box.packs.every(
        (pack) => twoLeaderCatalog.cardsByNumber.get(pack[10]!)?.rarity === 'R',
      ),
    ).toBe(true)
  })

  it('uses distinct non-leader packs for SR, SEC, and special-reprint parallel replacements', () => {
    const special = card('ST21-014', 'C', { variantsCollapsed: 100 })
    const specialFirstCatalog = runtimeCatalog([
      special,
      ...baseCards().map((item) => ({ ...item, variantsCollapsed: 1 })),
      card('OP16-009', 'L'),
    ])
    const box = generateVirtualBoosterBox(
      specialFirstCatalog,
      constantRandom(0),
    )
    const leaderPackIndexes = new Set(
      box.packs.flatMap((pack, index) =>
        pack[8] === 'OP16-001' || pack[8] === 'OP16-009' ? [index] : [],
      ),
    )
    const replacementPackIndexes = box.packs.flatMap((pack, index) =>
      ['OP16-007', 'OP16-008', 'ST21-014'].includes(pack[11]!)
        ? [index]
        : [],
    )

    expect(box.parallelHitCardNumbers).toEqual(['ST21-014', 'ST21-014'])
    expect(box.packs.flat().filter((number) => number === 'ST21-014')).toHaveLength(
      2,
    )
    expect(replacementPackIndexes).toHaveLength(10)
    expect(new Set(replacementPackIndexes).size).toBe(10)
    expect(
      replacementPackIndexes.every((index) => !leaderPackIndexes.has(index)),
    ).toBe(true)
  })

  it('limits parallel hits to special reprints and normal R, SR, or SEC cards', () => {
    const candidateCatalog = runtimeCatalog([
      ...baseCards().map((item) => ({ ...item, variantsCollapsed: 1 })),
      card('ST21-014', 'UC'),
      card('OP16-009', 'C'),
    ])
    const allowed = new Set(
      candidateCatalog.cards
        .filter(
          (item) =>
            item.isSpecialReprint ||
            ['R', 'SR', 'SEC'].includes(item.rarity),
        )
        .map((item) => item.cardNumber),
    )

    for (let seed = 0; seed < 40; seed += 1) {
      const box = generateVirtualBoosterBox(candidateCatalog, lcg(seed))
      expect(
        box.parallelHitCardNumbers.every((number) => allowed.has(number)),
      ).toBe(true)
    }
  })

  it('weights parallel candidates by variantsCollapsed', () => {
    const weightedCatalog = runtimeCatalog([
      card('OP16-001', 'L'),
      card('OP16-002', 'C'),
      card('OP16-003', 'UC'),
      card('OP16-004', 'R'),
      card('OP16-005', 'R', { variantsCollapsed: 20 }),
      card('OP16-006', 'SR'),
      card('OP16-007', 'SEC'),
    ])

    const box = generateVirtualBoosterBox(weightedCatalog, constantRandom(0.2))

    expect(box.parallelHitCardNumbers).toEqual(['OP16-005', 'OP16-005'])
    expect(box.packs.flat().filter((number) => number === 'OP16-005')).toHaveLength(
      2,
    )
  })

  it('treats absent variant metadata as one parallel-candidate copy', () => {
    const noVariantMetadata = {
      ...card('ST21-014', 'C'),
      variantsCollapsed: undefined,
    } as unknown as PlayableCard
    const metadataFreeCatalog = runtimeCatalog([
      noVariantMetadata,
      ...baseCards().map((item) => ({ ...item, variantsCollapsed: 1 })),
    ])

    const box = generateVirtualBoosterBox(
      metadataFreeCatalog,
      constantRandom(0),
    )

    expect(box.parallelHitCardNumbers).toEqual(['ST21-014', 'ST21-014'])
  })

  it('excludes and counts cards with unsupported rarities', () => {
    const unknown = card('OP16-099', 'TR')
    const catalogWithUnknown = runtimeCatalog([...baseCards(), unknown])
    const box = generateVirtualBoosterBox(catalogWithUnknown, lcg(5))

    expect(box.excludedUnknownRarityCount).toBe(1)
    expect(box.packs.flat()).not.toContain('OP16-099')
    expect(
      box.packs
        .flat()
        .every((number) => catalogWithUnknown.cardsByNumber.has(number)),
    ).toBe(true)
  })

  it.each(['C', 'UC', 'L', 'R', 'SR'])(
    'rejects a catalog without a normal %s pool',
    (missingRarity) => {
      const incomplete = runtimeCatalog(
        baseCards().filter((item) => item.rarity !== missingRarity),
      )

      expect(() =>
        generateVirtualBoosterBox(incomplete, constantRandom(0.9)),
      ).toThrow(new RegExp(`OP16.*normal ${missingRarity} pool`, 'i'))
    },
  )

  it('requires SEC only when the SEC box roll fires', () => {
    const noSec = runtimeCatalog(
      baseCards().filter((item) => item.rarity !== 'SEC'),
    )

    expect(() =>
      generateVirtualBoosterBox(noSec, constantRandom(0.9)),
    ).not.toThrow()
    expect(() =>
      generateVirtualBoosterBox(noSec, constantRandom(0.2)),
    ).toThrow(/OP16.*normal SEC pool/i)
  })

  it('rejects more leaders than a box has packs', () => {
    const leaders = Array.from({ length: 25 }, (_, index) =>
      card(`OP16-${String(index + 20).padStart(3, '0')}`, 'L'),
    )
    const tooManyLeaders = runtimeCatalog([
      ...baseCards().filter((item) => item.rarity !== 'L'),
      ...leaders,
    ])

    expect(() =>
      generateVirtualBoosterBox(tooManyLeaders, constantRandom(0.9)),
    ).toThrow(/25 leaders.*24 packs/i)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1])(
    'rejects invalid random value %s',
    (value) => {
      expect(() =>
        generateVirtualBoosterBox(catalog, constantRandom(value)),
      ).toThrow(/random.*finite.*\[0, 1\)/i)
    },
  )

  it('validates random values after the three configuration rolls', () => {
    let callCount = 0
    const invalidDuringSampling = () => {
      callCount += 1
      return callCount <= 3 ? 0.2 : Number.NaN
    }

    expect(() =>
      generateVirtualBoosterBox(catalog, invalidDuringSampling),
    ).toThrow(/random.*finite.*\[0, 1\)/i)
  })

  it('consumes all three configuration rolls before validating card pools', () => {
    let callCount = 0
    const incomplete = runtimeCatalog(
      baseCards().filter((item) => item.rarity !== 'C'),
    )

    expect(() =>
      generateVirtualBoosterBox(incomplete, () => {
        callCount += 1
        return 0.9
      }),
    ).toThrow(/normal C pool/i)
    expect(callCount).toBe(3)
  })

  it('is deterministic for the same seed and supports duplicate cards', () => {
    const first = generateVirtualBoosterBox(catalog, lcg(42))
    const second = generateVirtualBoosterBox(catalog, lcg(42))

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(new Set(first.packs.flat()).size).toBeLessThan(288)
  })

  it('returns deeply frozen data detached from the catalog', () => {
    const mutableCards = baseCards()
    const mutableCatalog = runtimeCatalog(mutableCards)
    const box = generateVirtualBoosterBox(mutableCatalog, lcg(5))
    const firstNumber = box.packs[0]![0]

    mutableCards[0]!.cardNumber = 'OP16-999'
    mutableCards[0]!.rarity = 'TR'

    expect(box.packs[0]![0]).toBe(firstNumber)
    expect(box.cardRarities['OP16-001']).toBe('L')
    expect(Object.isFrozen(box)).toBe(true)
    expect(Object.isFrozen(box.packs)).toBe(true)
    expect(box.packs.every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(box.rarityCounts)).toBe(true)
    expect(Object.isFrozen(box.cardRarities)).toBe(true)
    expect(Object.isFrozen(box.parallelHitCardNumbers)).toBe(true)
    expect(() =>
      (box.packs[0] as string[]).push('OP16-999'),
    ).toThrow()
  })
})

describe('drawTestPool', () => {
  it('exports immutable pack counts for each test-pool mode', () => {
    const counts: Readonly<Record<TestPoolMode, number>> = testPoolPackCounts

    expect(counts).toEqual({ development: 5, tournament: 6 })
    expect(Object.isFrozen(counts)).toBe(true)
  })

  it('selects five distinct whole packs and computes their rarity counts', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const result = drawTestPool(box, lcg(99))

    expect(result.selectedPackIndexes).toHaveLength(5)
    expect(new Set(result.selectedPackIndexes).size).toBe(5)
    expect(result.cardNumbers).toHaveLength(60)
    expect(result.cardNumbers).toEqual(
      result.selectedPackIndexes.flatMap((index) => box.packs[index]!),
    )
    expect(rarityTotal(result.rarityCounts)).toBe(60)
    expect(result.excludedUnknownRarityCount).toBe(
      box.excludedUnknownRarityCount,
    )
  })

  it('rejects malformed boxes before drawing', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const tooFewPacks = {
      ...box,
      packs: box.packs.slice(1),
    } satisfies SimulatedBoosterBox
    const shortPack = {
      ...box,
      packs: box.packs.map((pack, index) =>
        index === 0 ? pack.slice(1) : pack,
      ),
    } satisfies SimulatedBoosterBox

    expect(() => drawTestPool(tooFewPacks, lcg(1))).toThrow(/24 packs/i)
    expect(() => drawTestPool(shortPack, lcg(1))).toThrow(
      /pack 0.*12 cards/i,
    )
  })

  it('draws a detached structural clone with copied rarity metadata', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const detachedClone = {
      ...box,
      packs: box.packs.map((pack) => [...pack]),
      cardRarities: { ...box.cardRarities },
    }
    const result = drawTestPool(detachedClone, lcg(1))
    const expectedCounts = result.cardNumbers.reduce(
      (counts, cardNumber) => {
        counts[detachedClone.cardRarities[cardNumber]!] += 1
        return counts
      },
      { C: 0, UC: 0, L: 0, R: 0, SR: 0, SEC: 0 },
    )

    expect(result.cardNumbers).toHaveLength(60)
    expect(result.rarityCounts).toEqual(expectedCounts)
  })

  it('rejects a string card number absent from cardRarities', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const unknownCardBox = {
      ...box,
      packs: box.packs.map((pack, packIndex) =>
        packIndex === 0
          ? pack.map((cardNumber, cardIndex) =>
              cardIndex === 0 ? 'OP16-999' : cardNumber,
            )
          : [...pack],
      ),
      cardRarities: { ...box.cardRarities },
    }

    expect(() => drawTestPool(unknownCardBox, lcg(1))).toThrow(
      /pack 0.*OP16-999.*cardRarities/i,
    )
  })

  it('rejects a non-string pack entry with its exact location', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const packs: unknown[][] = box.packs.map((pack) => [...pack])
    packs[2]![4] = 42
    const nonStringCardBox = {
      ...box,
      packs,
      cardRarities: { ...box.cardRarities },
    } as unknown as SimulatedBoosterBox

    expect(() => drawTestPool(nonStringCardBox, lcg(1))).toThrow(
      /pack 2.*entry 4.*string/i,
    )
  })

  it('validates its random values', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))

    expect(() => drawTestPool(box, constantRandom(1))).toThrow(
      /random.*finite.*\[0, 1\)/i,
    )
  })

  it('returns deeply frozen arrays and records', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const result = drawTestPool(box, lcg(99))

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.cardNumbers)).toBe(true)
    expect(Object.isFrozen(result.rarityCounts)).toBe(true)
    expect(Object.isFrozen(result.selectedPackIndexes)).toBe(true)
  })

  it.each([
    ['development', 5, 60],
    ['tournament', 6, 72],
  ] as const)(
    'draws $packCount distinct complete packs in $mode mode',
    (mode, packCount, cardCount) => {
      const box = generateVirtualBoosterBox(catalog, lcg(5))
      const result = drawTestPool(box, lcg(99), mode)

      expect(testPoolPackCounts[mode]).toBe(packCount)
      expect(result.selectedPackIndexes).toHaveLength(packCount)
      expect(new Set(result.selectedPackIndexes).size).toBe(packCount)
      expect(result.cardNumbers).toHaveLength(cardCount)
      expect(result.cardNumbers).toEqual(
        result.selectedPackIndexes.flatMap((index) => box.packs[index]!),
      )
      expect(rarityTotal(result.rarityCounts)).toBe(cardCount)
    },
  )

  it('keeps development mode as the default and returns deeply frozen tournament results', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    const implicitDevelopment = drawTestPool(box, lcg(99))
    const explicitDevelopment = drawTestPool(box, lcg(99), 'development')
    const tournament = drawTestPool(box, lcg(99), 'tournament')

    expect(implicitDevelopment).toEqual(explicitDevelopment)
    expect(Object.isFrozen(tournament)).toBe(true)
    expect(Object.isFrozen(tournament.cardNumbers)).toBe(true)
    expect(Object.isFrozen(tournament.rarityCounts)).toBe(true)
    expect(Object.isFrozen(tournament.selectedPackIndexes)).toBe(true)
  })

  it('rejects an invalid mode before consuming a random value', () => {
    const box = generateVirtualBoosterBox(catalog, lcg(5))
    let calls = 0

    expect(() =>
      drawTestPool(
        box,
        () => {
          calls += 1
          return 0.5
        },
        'draft' as never,
      ),
    ).toThrow(/mode.*development.*tournament/i)
    expect(calls).toBe(0)
  })
})

describe('generateTestPool', () => {
  it('generates and draws deterministically with one random stream', () => {
    const first = generateTestPool(catalog, lcg(123))
    const second = generateTestPool(catalog, lcg(123))

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.cardNumbers).toHaveLength(60)
  })

  it('exactly composes box generation and drawing with one seeded stream', () => {
    const explicitRandom = lcg(314)
    const box = generateVirtualBoosterBox(catalog, explicitRandom)
    const explicit = drawTestPool(box, explicitRandom)

    const composed = generateTestPool(catalog, lcg(314))

    expect(composed).toEqual(explicit)
  })

  it('generates deterministic tournament pools with one random stream', () => {
    const first = generateTestPool(catalog, lcg(123), 'tournament')
    const second = generateTestPool(catalog, lcg(123), 'tournament')

    expect(first).toEqual(second)
    expect(first.cardNumbers).toHaveLength(72)
    expect(first.selectedPackIndexes).toHaveLength(6)
    expect(new Set(first.selectedPackIndexes).size).toBe(6)
  })

  it('rejects an invalid mode before box-generation random values are consumed', () => {
    let calls = 0

    expect(() =>
      generateTestPool(
        catalog,
        () => {
          calls += 1
          return 0.5
        },
        'draft' as never,
      ),
    ).toThrow(/mode.*development.*tournament/i)
    expect(calls).toBe(0)
  })
})

describe('generateVirtualBoosterBox DON exclusion', () => {
  it('excludes DON cards labelled C, R, or SR from normal pools, parallel hits, and rarity metadata', () => {
    const donCards = [
      card('OP16-DON-C', 'C', { cardType: 'DON' }),
      card('OP16-DON-R', 'R', { cardType: 'DON' }),
      card('OP16-DON-SR', 'SR', { cardType: 'DON' }),
      card('ST21-DON-P', 'R', {
        cardType: 'DON',
        isSpecialReprint: true,
        entryShortcut: null,
        variantsCollapsed: 1_000_000,
      }),
    ]
    const box = generateVirtualBoosterBox(
      runtimeCatalog([...donCards, ...baseCards()]),
      constantRandom(0),
    )

    for (const donCard of donCards) {
      expect(box.packs.flat()).not.toContain(donCard.cardNumber)
      expect(box.parallelHitCardNumbers).not.toContain(donCard.cardNumber)
    }
    expect(box.parallelHitCardNumbers).toEqual(['OP16-006', 'OP16-006'])
    expect(box.cardRarities).not.toHaveProperty('OP16-DON-C')
    expect(box.cardRarities).not.toHaveProperty('OP16-DON-R')
    expect(box.cardRarities).not.toHaveProperty('OP16-DON-SR')
    expect(box.cardRarities).not.toHaveProperty('ST21-DON-P')
  })

  it('retains ordinary cards whose effect text mentions DON!!', () => {
    const effectCard = card('OP16-010', 'C', {
      effect: 'On Play: Add up to 1 DON!! card from your DON!! deck.',
    })
    const box = generateVirtualBoosterBox(
      runtimeCatalog([effectCard, ...baseCards()]),
      constantRandom(0),
    )

    expect(box.packs.flat()).toContain(effectCard.cardNumber)
    expect(box.cardRarities[effectCard.cardNumber]).toBe('C')
  })
})
