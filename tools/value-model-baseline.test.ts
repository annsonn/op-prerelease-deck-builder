import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { stableStringify } from './catalog/artifacts.js'

const SHA256_PATTERN = /^[a-f\d]{64}$/
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const EXPECTED_PROFILE_SHA256 =
  '371c9b997556e6dcec85cabed16cfd53d5371c4af78901a2f24e5d23d3e6a545'
const EXPECTED_OP17_SOLUTION_DIGESTS_SHA256 =
  '48ed3893b9e1af46bc0cb416547945cfb5ff7b1e79d6cb100a8f54fb82e355ea'
const ARTIFACT_FILENAMES = [
  'manifest.json',
  'cards.json',
  'set-contents.json',
  'strategy-suggestions.json',
] as const

const EXPECTED_CHECKSUMS = {
  OP16: 'd98327c9708ef94aa3180de5cfea058d37a01e3825774748f7bff8536773d1f7',
  OP17: '80185f046091d3def85245b291df31e81b349508adb29842152393c743632a52',
} as const

const EXPECTED_OP17_GATED_CARDS = {
  'OP17-043': { opened: 2350, main: 72 },
  'OP17-046': { opened: 941, main: 0 },
  'OP17-049': { opened: 1640, main: 1636 },
  'OP17-054': { opened: 1681, main: 259 },
  'OP17-063': { opened: 926, main: 2 },
  'OP17-065': { opened: 2393, main: 99 },
  'OP17-093': { opened: 954, main: 0 },
  'OP17-112': { opened: 906, main: 122 },
  'OP17-114': { opened: 1657, main: 380 },
  'OP17-118': { opened: 481, main: 52 },
  'OP17-119': { opened: 546, main: 328 },
} as const

const EXPECTED_OP17_COUNTER_EVENTS = {
  'OP17-037': { opened: 1662, main: 1 },
  'OP17-038': { opened: 3154, main: 3 },
  'OP17-076': { opened: 1651, main: 6 },
  'OP17-077': { opened: 2401, main: 0 },
  'OP17-078': { opened: 3177, main: 0 },
  'OP17-097': { opened: 3125, main: 0 },
  'OP17-098': { opened: 3174, main: 0 },
} as const

const EXPECTED_OP16_AVERAGES = {
  size: 40,
  twoKCounter: 13,
  blocker: 8.67,
  vanillaLike: 5.75,
  interaction: 12.23,
  boss: 3.98,
  totalCounter: 49398.8,
  bricks: 3.6,
  early: 16.04,
  middle: 14.81,
  high: 9.15,
} as const

const EXPECTED_OP16_TARGET_MISSES = {
  twoKCounter: 158,
  blocker: 603,
  vanillaLike: 2534,
  interaction: 0,
  boss: 3262,
} as const

const EXPECTED_PROFILE_SNAPSHOT = {
  analysis: {
    totalCounter: {
      neutralMinimum: 24_000,
      scoringSaturationMinimum: 52_000,
      strengthMinimum: 30_000,
    },
  },
  curve: {
    early: { maximumCost: 2, minimumCost: 0, target: 8 },
    highCost: { maximum: 8, minimum: 4, minimumCost: 7 },
    late: { maximum: 10, minimum: 6, minimumCost: 6 },
    middle: { maximumCost: 5, minimumCost: 3, target: 16 },
    turnOrderDominance: 3,
  },
  id: 'sealed-video-v1',
  limits: {
    brickTolerance: 8,
    comboMinimumSupport: 4,
    premiumBombFirstCopyFloor: 15,
    searcherMinimumTargets: 6,
  },
  targets: {
    blocker: 10,
    boss: 5,
    interaction: 5,
    twoKCounter: 10,
    vanillaLike: 10,
  },
  version: 1,
  weights: {
    compatibility: { cardColor: 2, effect: 1, leaderColor: 3 },
    curve: {
      early: 3,
      highCost: 2,
      late: 2,
      middle: 3,
      turnOrderDominance: 3,
    },
    progressiveBricks: { first: 1, fourthOrMore: 4, second: 2, third: 3 },
    redundancy: { effect: 1, role: 1 },
    softTargetFloorPercent: {
      blocker: 60,
      boss: 0,
      interaction: 0,
      twoKCounter: 0,
      vanillaLike: 50,
    },
    softTargets: {
      blocker: 8,
      boss: 2,
      interaction: 3,
      twoKCounter: 3,
      vanillaLike: 1,
    },
    standalone: { cardPower: 2, counterValue: 7, saturatedCounterValue: 1 },
    synergy: { combo: 2, searcher: 2, trait: 2, type: 2 },
  },
} as const

const METRIC_KEYS = [
  'size',
  'twoKCounter',
  'blocker',
  'vanillaLike',
  'interaction',
  'boss',
  'totalCounter',
  'bricks',
  'early',
  'middle',
  'high',
] as const

const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, 'must be a safe integer')
const nonNegativeFiniteSchema = z.number().finite().nonnegative()
const sha256Schema = z.string().regex(SHA256_PATTERN)
const metricsSchema = z.strictObject({
  size: nonNegativeFiniteSchema,
  twoKCounter: nonNegativeFiniteSchema,
  blocker: nonNegativeFiniteSchema,
  vanillaLike: nonNegativeFiniteSchema,
  interaction: nonNegativeFiniteSchema,
  boss: nonNegativeFiniteSchema,
  totalCounter: nonNegativeFiniteSchema,
  bricks: nonNegativeFiniteSchema,
  early: nonNegativeFiniteSchema,
  middle: nonNegativeFiniteSchema,
  high: nonNegativeFiniteSchema,
})
const rawMetricsSchema = z.strictObject({
  size: nonNegativeSafeIntegerSchema,
  twoKCounter: nonNegativeSafeIntegerSchema,
  blocker: nonNegativeSafeIntegerSchema,
  vanillaLike: nonNegativeSafeIntegerSchema,
  interaction: nonNegativeSafeIntegerSchema,
  boss: nonNegativeSafeIntegerSchema,
  totalCounter: nonNegativeSafeIntegerSchema,
  bricks: nonNegativeSafeIntegerSchema,
  early: nonNegativeSafeIntegerSchema,
  middle: nonNegativeSafeIntegerSchema,
  high: nonNegativeSafeIntegerSchema,
})
const targetMissesSchema = z.strictObject({
  twoKCounter: nonNegativeSafeIntegerSchema,
  blocker: nonNegativeSafeIntegerSchema,
  vanillaLike: nonNegativeSafeIntegerSchema,
  interaction: nonNegativeSafeIntegerSchema,
  boss: nonNegativeSafeIntegerSchema,
})
const thresholdCountsSchema = z.strictObject({
  neutralMinimum24000: nonNegativeSafeIntegerSchema,
  strengthMinimum30000: nonNegativeSafeIntegerSchema,
})
const artifactSha256Schema = z.strictObject({
  'manifest.json': sha256Schema,
  'cards.json': sha256Schema,
  'set-contents.json': sha256Schema,
  'strategy-suggestions.json': sha256Schema,
})
const profileSnapshotSchema = z.strictObject({
  canonical: z.record(z.string(), z.json()),
  sha256: z.literal(EXPECTED_PROFILE_SHA256),
})
const baseSetShapeSchema = z.object({
  checksum: sha256Schema,
  artifactSha256: artifactSha256Schema,
  profile: profileSnapshotSchema,
  requestedPools: nonNegativeSafeIntegerSchema,
  evaluatedPools: nonNegativeSafeIntegerSchema,
  skippedPools: nonNegativeSafeIntegerSchema,
  invalidDecks: nonNegativeSafeIntegerSchema,
  nondeterministicDecks: nonNegativeSafeIntegerSchema,
  exactFortyFailures: nonNegativeSafeIntegerSchema,
  physicalCopyConservationFailures: nonNegativeSafeIntegerSchema,
  rawSums: rawMetricsSchema,
  averages: metricsSchema,
  reachableTargetMisses: targetMissesSchema,
  belowCounterThreshold: thresholdCountsSchema,
})

type BaselineSetShape = z.infer<typeof baseSetShapeSchema>

function roundedAverage(total: number, count: number): number {
  return count === 0 ? 0 : Number((total / count).toFixed(2))
}

function refineBaselineSet(
  set: BaselineSetShape,
  context: z.core.$RefinementCtx<BaselineSetShape>,
): void {
  const validDecks = set.evaluatedPools - set.invalidDecks
  const issue = (message: string, path: PropertyKey[]): void => {
    context.addIssue({ code: 'custom', message, path })
  }

  if (set.requestedPools !== set.evaluatedPools + set.skippedPools) {
    issue('requested pools must equal evaluated plus skipped pools', [
      'requestedPools',
    ])
  }
  if (validDecks < 0) {
    issue('invalid decks cannot exceed evaluated pools', ['invalidDecks'])
    return
  }
  for (const key of [
    'nondeterministicDecks',
    'exactFortyFailures',
    'physicalCopyConservationFailures',
  ] as const) {
    if (set[key] > validDecks) {
      issue(`${key} cannot exceed valid decks`, [key])
    }
  }
  if (set.rawSums.size !== validDecks * 40) {
    issue('raw deck-size sum must equal 40 times valid decks', [
      'rawSums',
      'size',
    ])
  }
  for (const key of METRIC_KEYS) {
    if (set.averages[key] !== roundedAverage(set.rawSums[key], validDecks)) {
      issue(`${key} average must reconcile with its raw sum`, ['averages', key])
    }
  }
  for (const [key, count] of Object.entries(set.reachableTargetMisses)) {
    if (count > validDecks) {
      issue(`${key} target misses cannot exceed valid decks`, [
        'reachableTargetMisses',
        key,
      ])
    }
  }
  for (const [key, count] of Object.entries(set.belowCounterThreshold)) {
    if (count > validDecks) {
      issue(`${key} threshold count cannot exceed valid decks`, [
        'belowCounterThreshold',
        key,
      ])
    }
  }
  if (set.artifactSha256['cards.json'] !== set.checksum) {
    issue('catalog checksum must equal the captured cards.json digest', [
      'checksum',
    ])
  }
  if (sha256(stableStringify(set.profile.canonical)) !== set.profile.sha256) {
    issue('profile snapshot does not match its pinned digest', ['profile'])
  }
}

const inclusionCountSchema = z
  .strictObject({
    opened: nonNegativeSafeIntegerSchema,
    main: nonNegativeSafeIntegerSchema,
  })
  .superRefine((counts, context) => {
    if (counts.main > counts.opened) {
      context.addIssue({
        code: 'custom',
        message: 'Main inclusion cannot exceed opened pools',
        path: ['main'],
      })
    }
  })
const gatedCardsSchema = z.strictObject({
  'OP17-043': inclusionCountSchema,
  'OP17-046': inclusionCountSchema,
  'OP17-049': inclusionCountSchema,
  'OP17-054': inclusionCountSchema,
  'OP17-063': inclusionCountSchema,
  'OP17-065': inclusionCountSchema,
  'OP17-093': inclusionCountSchema,
  'OP17-112': inclusionCountSchema,
  'OP17-114': inclusionCountSchema,
  'OP17-118': inclusionCountSchema,
  'OP17-119': inclusionCountSchema,
})
const counterEventsSchema = z.strictObject({
  'OP17-037': inclusionCountSchema,
  'OP17-038': inclusionCountSchema,
  'OP17-076': inclusionCountSchema,
  'OP17-077': inclusionCountSchema,
  'OP17-078': inclusionCountSchema,
  'OP17-097': inclusionCountSchema,
  'OP17-098': inclusionCountSchema,
})
const solutionDigestSchema = z.strictObject({
  seed: nonNegativeSafeIntegerSchema,
  sha256: sha256Schema,
})
const op16SetSchema = z
  .strictObject({ ...baseSetShapeSchema.shape, setId: z.literal('OP16') })
  .superRefine(refineBaselineSet)
const op17SetSchema = z
  .strictObject({
    ...baseSetShapeSchema.shape,
    setId: z.literal('OP17'),
    gatedCards: gatedCardsSchema,
    counterEvents: counterEventsSchema,
    solutionDigests: z.array(solutionDigestSchema).length(100),
  })
  .superRefine((set, context) => {
    refineBaselineSet(set, context)
    const validDecks = set.evaluatedPools - set.invalidDecks
    for (const [group, values] of [
      ['gatedCards', set.gatedCards],
      ['counterEvents', set.counterEvents],
    ] as const) {
      for (const [cardNumber, counts] of Object.entries(values)) {
        if (counts.opened > validDecks) {
          context.addIssue({
            code: 'custom',
            message: `${cardNumber} opened pools cannot exceed valid decks`,
            path: [group, cardNumber, 'opened'],
          })
        }
      }
    }
    for (const [index, digest] of set.solutionDigests.entries()) {
      if (digest.seed !== index) {
        context.addIssue({
          code: 'custom',
          message: 'solution digest seeds must be ordered from 0 through 99',
          path: ['solutionDigests', index, 'seed'],
        })
      }
    }
  })

const valueModelBaselineSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    provenance: z.strictObject({
      engine: z.literal('StrategyDeckSolver'),
      engineCommit: z.literal('1aa63a5'),
      generator: z.strictObject({
        function: z.literal('generateTestPool'),
        mode: z.literal('tournament'),
      }),
      seedCount: z.literal(5000),
      seedStart: z.literal(0),
      solverVersion: z.literal('strategy-v2'),
    }),
    sets: z.strictObject({ OP16: op16SetSchema, OP17: op17SetSchema }),
  })
  .superRefine((baseline, context) => {
    const digest = sha256(stableStringify(baseline.sets.OP17.solutionDigests))
    if (digest !== EXPECTED_OP17_SOLUTION_DIGESTS_SHA256) {
      context.addIssue({
        code: 'custom',
        message: 'ordered OP17 solution digests do not match the pinned aggregate',
        path: ['sets', 'OP17', 'solutionDigests'],
      })
    }
  })

type BaselineSet = z.infer<typeof op16SetSchema> | z.infer<typeof op17SetSchema>
type ValueModelBaseline = z.infer<typeof valueModelBaselineSchema>

type MutableValueModelBaseline = {
  sets: {
    OP16: { averages: Record<string, number> }
    OP17: { solutionDigests: { seed: number; sha256: string }[] }
  }
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function loadFixture(): Promise<ValueModelBaseline> {
  const content = await readFile(
    resolve(REPOSITORY_ROOT, 'tools/fixtures/value-model-baseline.json'),
    'utf8',
  )
  return strictParseBaseline(JSON.parse(content) as unknown)
}

function strictParseBaseline(input: unknown): ValueModelBaseline {
  return valueModelBaselineSchema.parse(input)
}

function expectCount(value: number, label: string): void {
  expect(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative safe integer`,
  ).toBe(true)
}

function expectCountRecord(
  values: Readonly<Record<string, number>>,
  label: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    expectCount(value, `${label}.${key}`)
  }
}

function expectAverageRecord(
  values: Readonly<Record<string, number>>,
  label: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    expect(
      Number.isFinite(value) && value >= 0,
      `${label}.${key} must be finite and non-negative`,
    ).toBe(true)
  }
}

function expectSetCounts(set: BaselineSet): void {
  for (const key of [
    'requestedPools',
    'evaluatedPools',
    'skippedPools',
    'invalidDecks',
    'nondeterministicDecks',
    'exactFortyFailures',
    'physicalCopyConservationFailures',
  ] as const) {
    expectCount(set[key], `${set.setId}.${key}`)
  }
  expectCountRecord(set.rawSums, `${set.setId}.rawSums`)
  expectCountRecord(
    set.reachableTargetMisses,
    `${set.setId}.reachableTargetMisses`,
  )
  expectCountRecord(
    set.belowCounterThreshold,
    `${set.setId}.belowCounterThreshold`,
  )
  expectAverageRecord(set.averages, `${set.setId}.averages`)
}

describe('immutable pre-upgrade value-model baseline', () => {
  it('locks engine, generator, profile, and seed provenance', async () => {
    const baseline = await loadFixture()

    expect(baseline.schemaVersion).toBe(1)
    expect(baseline.provenance).toEqual({
      engineCommit: '1aa63a5',
      engine: 'StrategyDeckSolver',
      solverVersion: 'strategy-v2',
      generator: {
        function: 'generateTestPool',
        mode: 'tournament',
      },
      seedStart: 0,
      seedCount: 5000,
    })

    for (const setId of ['OP16', 'OP17'] as const) {
      const set = baseline.sets[setId]
      expect(set.setId).toBe(setId)
      expect(set.requestedPools).toBe(5000)
      expect(set.evaluatedPools).toBe(5000)
      expect(set.profile.canonical).toEqual(EXPECTED_PROFILE_SNAPSHOT)
      expect(set.profile.sha256).toBe(EXPECTED_PROFILE_SHA256)
      expect(set.profile.sha256).toBe(
        sha256(stableStringify(set.profile.canonical)),
      )
      expect(set.profile.sha256).toMatch(SHA256_PATTERN)
      expectSetCounts(set)
    }
  })

  it('fails with a refresh-specific message when checked-in catalog bytes drift', async () => {
    const baseline = await loadFixture()

    for (const setId of ['OP16', 'OP17'] as const) {
      const set = baseline.sets[setId]
      const setRoot = resolve(
        REPOSITORY_ROOT,
        'public/catalogs',
        setId.toLowerCase(),
      )
      const cardsChecksum = sha256(await readFile(resolve(setRoot, 'cards.json')))
      expect(
        cardsChecksum,
        `${setId} catalog refresh detected; regenerate and explicitly recalibrate the immutable value-model baseline before comparing engines.`,
      ).toBe(EXPECTED_CHECKSUMS[setId])
      expect(set.checksum).toBe(EXPECTED_CHECKSUMS[setId])

      for (const filename of ARTIFACT_FILENAMES) {
        const actual = sha256(await readFile(resolve(setRoot, filename)))
        expect(
          actual,
          `${setId} ${filename} refresh detected; regenerate and explicitly recalibrate the immutable value-model baseline before comparing engines.`,
        ).toBe(set.artifactSha256[filename])
      }
    }
  })

  it('locks the exact OP17 gated-card and Counter-Event counts', async () => {
    const { OP17 } = (await loadFixture()).sets

    expect(OP17.gatedCards).toEqual(EXPECTED_OP17_GATED_CARDS)
    expect(OP17.counterEvents).toEqual(EXPECTED_OP17_COUNTER_EVENTS)
    for (const [cardNumber, counts] of Object.entries({
      ...OP17.gatedCards,
      ...OP17.counterEvents,
    })) {
      expectCount(counts.opened, `${cardNumber}.opened`)
      expectCount(counts.main, `${cardNumber}.main`)
      expect(counts.main).toBeLessThanOrEqual(counts.opened)
    }
  })

  it('locks the exact Strategy V2 OP16 averages and guardrail counts', async () => {
    const { OP16 } = (await loadFixture()).sets

    expect(OP16.averages).toEqual(EXPECTED_OP16_AVERAGES)
    expect(OP16.reachableTargetMisses).toEqual(EXPECTED_OP16_TARGET_MISSES)
    expect(OP16.belowCounterThreshold).toEqual({
      neutralMinimum24000: 0,
      strengthMinimum30000: 0,
    })
    expect(OP16.invalidDecks).toBe(0)
    expect(OP16.nondeterministicDecks).toBe(0)
  })

  it('locks both sets to 40-card deterministic, physically conserved solutions', async () => {
    const baseline = await loadFixture()

    for (const set of Object.values(baseline.sets)) {
      expect(set.exactFortyFailures).toBe(0)
      expect(set.physicalCopyConservationFailures).toBe(0)
      expect(set.invalidDecks).toBe(0)
      expect(set.nondeterministicDecks).toBe(0)
    }
  })

  it('stores 100 ordered OP17 canonical solution digests without solving pools', async () => {
    const digests = (await loadFixture()).sets.OP17.solutionDigests

    expect(digests).toHaveLength(100)
    expect(digests.map(({ seed }) => seed)).toEqual(
      Array.from({ length: 100 }, (_, seed) => seed),
    )
    for (const { seed, sha256: digest } of digests) {
      expectCount(seed, 'OP17.solutionDigests.seed')
      expect(digest).toMatch(SHA256_PATTERN)
    }
    expect(sha256(stableStringify(digests))).toBe(
      EXPECTED_OP17_SOLUTION_DIGESTS_SHA256,
    )
  })

  it('rejects a fixture with a missing metric key', async () => {
    const mutated = structuredClone(
      await loadFixture(),
    ) as unknown as MutableValueModelBaseline
    delete mutated.sets.OP16.averages.boss

    expect(() => strictParseBaseline(mutated)).toThrow()
  })

  it('rejects an arbitrary replacement solution digest', async () => {
    const mutated = structuredClone(
      await loadFixture(),
    ) as unknown as MutableValueModelBaseline
    mutated.sets.OP17.solutionDigests[0]!.sha256 = '0'.repeat(64)

    expect(() => strictParseBaseline(mutated)).toThrow()
  })
})
