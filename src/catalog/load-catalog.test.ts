import { describe, expect, it, vi } from 'vitest'

import type { RuntimeCatalogIndexEntry } from '../../shared/catalog-index.js'
import type { PlayableCard, StrategySuggestion } from '../../shared/catalog.js'
import { classifyCardFeatures } from '../../shared/card-features.js'

import {
  browserSha256,
  loadCatalogIndex,
  loadRuntimeCatalog,
  resolveCatalogPath,
} from './load-catalog.js'

const encoder = new TextEncoder()
const sourceSha256 = 'a'.repeat(64)

const entry: RuntimeCatalogIndexEntry = {
  setId: 'OP16',
  label: 'OP16',
  manifestPath: '/catalogs/op16/manifest.json',
  sourceSha256,
  readiness: 'needs-review',
}

function card(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  return {
    cardNumber,
    name: `${cardNumber} Test Card`,
    rarity: 'C',
    cardType: 'CHARACTER',
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
    entryShortcut: cardNumber.startsWith('OP16-')
      ? cardNumber.slice(-3)
      : null,
    isSpecialReprint: !cardNumber.startsWith('OP16-'),
    ...overrides,
  }
}

function suggestion(cardNumber: string): StrategySuggestion {
  return {
    cardNumber,
    roles: ['pressure'],
    reviewStatus: 'suggested',
  }
}

interface RuntimeFixture {
  artifacts: Record<string, string>
  fetcher: typeof fetch
  rebuildChecksums: () => Promise<void>
}

interface MutableSerializedFeatures {
  effectModelVersion?: number
  effectParserRevision?: number
  effects?: unknown[]
  unparsedClauses?: string[]
  flags: Record<string, boolean>
  rainbowUsableFlags?: Record<string, boolean>
  supportRequirementsByFlag?: Record<string, unknown>
  rainbowLuffyCompatibility: string
  searchableTraits: string[]
  searchableNames: string[]
  requiredTraits: string[]
  requiredNames: string[]
  evidence: string[]
}

function exactLegacyFeatureVariants(): readonly MutableSerializedFeatures[] {
  const current: MutableSerializedFeatures = {
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
  }

  const featureLayers = (
    full: MutableSerializedFeatures,
  ): MutableSerializedFeatures[] => {
    const preSupport = structuredClone(full)
    delete preSupport.supportRequirementsByFlag
    const preRainbow = structuredClone(preSupport)
    delete preRainbow.rainbowUsableFlags
    const rainbowOnly = structuredClone(full)
    delete rainbowOnly.rainbowUsableFlags
    return [full, preSupport, preRainbow, rainbowOnly]
  }

  const prePremium = structuredClone(current)
  delete prePremium.flags.massRest
  delete prePremium.flags.donRefresh
  if (prePremium.rainbowUsableFlags !== undefined) {
    delete prePremium.rainbowUsableFlags.massRest
    delete prePremium.rainbowUsableFlags.donRefresh
  }

  return [...featureLayers(current), ...featureLayers(prePremium)]
}

async function runtimeFixture(basePath = ''): Promise<RuntimeFixture> {
  const artifactRoot = `${basePath}/catalogs/op16`
  const cards = [
    card('OP16-005'),
    card('OP10-045', {
      cost: 8,
      power: 9000,
      counter: 2000,
      effect:
        '[Blocker] Draw 2 cards. [Rush] K.O. up to 1 of your opponent\'s Characters.',
    }),
  ]
  const artifacts: Record<string, string> = {
    [`${artifactRoot}/manifest.json`]: `${JSON.stringify({
      schemaVersion: 1,
      setId: 'OP16',
      language: 'en',
      source: 'https://cdn.example.test/cards.json',
      sourceType: 'cardkaizoku-json',
      sourceSha256,
      readiness: 'needs-review',
    })}\n`,
    [`${artifactRoot}/cards.json`]: `${JSON.stringify(cards)}\n`,
    [`${artifactRoot}/set-contents.json`]: `${JSON.stringify(
      cards.map(({ cardNumber }) => cardNumber),
    )}\n`,
    [`${artifactRoot}/strategy-suggestions.json`]: `${JSON.stringify(
      cards.map(({ cardNumber }) => suggestion(cardNumber)),
    )}\n`,
    [`${artifactRoot}/checksums.json`]: '',
  }

  const rebuildChecksums = async (): Promise<void> => {
    const checksums = Object.fromEntries(
      await Promise.all(
        [
          'manifest.json',
          'cards.json',
          'set-contents.json',
          'strategy-suggestions.json',
        ].map(async (filename) => [
          filename,
          await browserSha256(
            encoder.encode(artifacts[`${artifactRoot}/${filename}`]),
          ),
        ]),
      ),
    )
    artifacts[`${artifactRoot}/checksums.json`] = `${JSON.stringify(checksums)}\n`
  }
  await rebuildChecksums()

  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input.toString()
    const body = artifacts[path]
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      statusText: body === undefined ? 'Not Found' : 'OK',
      arrayBuffer: async () => encoder.encode(body ?? '').buffer,
    } as Response
  }) as unknown as typeof fetch

  return { artifacts, fetcher, rebuildChecksums }
}

function runtimeIndex(): unknown {
  return {
    schemaVersion: 1,
    sets: Array.from({ length: 17 }, (_, index) => {
      const setId = `OP${String(index + 1).padStart(2, '0')}`
      return {
        setId,
        label: setId,
        manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
        sourceSha256,
        readiness: 'needs-review',
      }
    }),
  }
}

function fetchText(body: string, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? 'OK' : 'Service Unavailable',
    arrayBuffer: async () => encoder.encode(body).buffer,
  })) as unknown as typeof fetch
}

describe('browserSha256', () => {
  it('returns the lowercase SHA-256 digest of the exact bytes', async () => {
    await expect(browserSha256(encoder.encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('resolveCatalogPath', () => {
  it('preserves root-based catalog paths for local development', () => {
    expect(resolveCatalogPath('/catalogs/index.json', '/')).toBe(
      '/catalogs/index.json',
    )
  })

  it('joins logical catalog paths to a Pages base without duplicate slashes', () => {
    expect(
      resolveCatalogPath(
        '/catalogs/op16/manifest.json',
        '/op-prerelease-deck-builder',
      ),
    ).toBe('/op-prerelease-deck-builder/catalogs/op16/manifest.json')
  })

  it('collapses repeated trailing slashes in the base path', () => {
    expect(
      resolveCatalogPath(
        '/catalogs/index.json',
        '/op-prerelease-deck-builder///',
      ),
    ).toBe('/op-prerelease-deck-builder/catalogs/index.json')
  })
})

describe('loadCatalogIndex', () => {
  it('loads and validates the complete runtime index', async () => {
    const fetcher = fetchText(JSON.stringify(runtimeIndex()))

    const index = await loadCatalogIndex(fetcher)

    expect(index.sets).toHaveLength(17)
    expect(index.sets[15]).toEqual(entry)
    expect(fetcher).toHaveBeenCalledWith('/catalogs/index.json')
  })

  it('loads the index below the supplied Pages base path', async () => {
    const fetcher = fetchText(JSON.stringify(runtimeIndex()))

    await loadCatalogIndex(fetcher, '/op-prerelease-deck-builder/')

    expect(fetcher).toHaveBeenCalledWith(
      '/op-prerelease-deck-builder/catalogs/index.json',
    )
  })

  it('rejects an unsuccessful HTTP response', async () => {
    await expect(loadCatalogIndex(fetchText('', false))).rejects.toThrow(
      /catalog index.*503/i,
    )
  })

  it('rejects malformed index JSON', async () => {
    await expect(loadCatalogIndex(fetchText('{not json'))).rejects.toThrow(
      /catalog index.*malformed JSON/i,
    )
  })

  it('rejects an index that does not match the shared schema', async () => {
    await expect(
      loadCatalogIndex(fetchText(JSON.stringify({ schemaVersion: 1, sets: [] }))),
    ).rejects.toThrow(/catalog index.*schema/i)
  })
})

describe('loadRuntimeCatalog', () => {
  it('validates artifacts and splits normal shortcuts from special reprints', async () => {
    const { fetcher } = await runtimeFixture()

    const catalog = await loadRuntimeCatalog(entry, fetcher)

    expect(catalog.manifest.setId).toBe('OP16')
    expect(catalog.cards.map(({ cardNumber }) => cardNumber)).toEqual([
      'OP16-005',
      'OP10-045',
    ])
    expect(catalog.cardsByNumber.get('OP16-005')?.name).toBe(
      'OP16-005 Test Card',
    )
    expect(catalog.normalCardsByShortcut.get('005')?.cardNumber).toBe('OP16-005')
    expect(catalog.specialCards.map(({ cardNumber }) => cardNumber)).toEqual([
      'OP10-045',
    ])
    expect(catalog.suggestionsByCardNumber.get('OP10-045')?.roles).toEqual([
      'pressure',
    ])
    expect(Object.isFrozen(catalog.cards)).toBe(true)
    expect(Object.isFrozen(catalog.specialCards)).toBe(true)
    expect(Object.isFrozen(catalog.strategySuggestions)).toBe(true)
  })

  it('loads every artifact below the supplied Pages base path', async () => {
    const basePath = '/op-prerelease-deck-builder'
    const { fetcher } = await runtimeFixture(basePath)

    await loadRuntimeCatalog(entry, fetcher, browserSha256, `${basePath}/`)

    expect(fetcher).toHaveBeenCalledTimes(5)
    for (const filename of [
      'manifest.json',
      'cards.json',
      'set-contents.json',
      'strategy-suggestions.json',
      'checksums.json',
    ]) {
      expect(fetcher).toHaveBeenCalledWith(
        `${basePath}/catalogs/op16/${filename}`,
      )
    }
  })

  it('accepts exact effects while recomputing detached, deeply frozen projections', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    const firstCanonical = classifyCardFeatures(cards[0]!)
    const secondCanonical = classifyCardFeatures(cards[1]!)
    const firstFeatures = {
      ...firstCanonical,
      flags: { ...firstCanonical.flags, draw: true },
      evidence: ['serialized projection is not authoritative'],
    }
    const secondFeatures = {
      ...secondCanonical,
      flags: { ...secondCanonical.flags, draw: false },
      evidence: ['serialized projection is not authoritative'],
    }
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      { ...suggestion(cards[0]!.cardNumber), features: firstFeatures },
      { ...suggestion(cards[1]!.cardNumber), features: secondFeatures },
    ])}\n`
    await rebuildChecksums()

    const catalog = await loadRuntimeCatalog(entry, fetcher)
    const firstSupplied = catalog.strategySuggestions[0]!.features!
    const secondSupplied = catalog.strategySuggestions[1]!.features!
    const firstResolved = catalog.featuresByCardNumber.get('OP16-005')!
    const secondResolved = catalog.featuresByCardNumber.get('OP10-045')!
    const expectedFirst = classifyCardFeatures(cards[0]!)
    const expectedSecond = classifyCardFeatures(cards[1]!)

    expect(firstSupplied).toEqual(firstFeatures)
    expect(secondSupplied).toEqual(secondFeatures)
    expect(firstResolved).toEqual(expectedFirst)
    expect(secondResolved).toEqual(expectedSecond)
    expect(firstSupplied).not.toEqual(expectedFirst)
    expect(secondSupplied).not.toEqual(expectedSecond)
    expect(firstResolved).not.toEqual(secondResolved)
    expect(firstResolved).not.toBe(firstSupplied)
    expect(secondResolved).not.toBe(secondSupplied)
    for (const [resolved, supplied] of [
      [firstResolved, firstSupplied],
      [secondResolved, secondSupplied],
    ] as const) {
      if (
        !('rainbowUsableFlags' in supplied) ||
        !('supportRequirementsByFlag' in supplied)
      ) {
        throw new Error('expected current enriched feature metadata')
      }
      expect(resolved.flags).not.toBe(supplied.flags)
      expect(resolved.rainbowUsableFlags).not.toBe(
        supplied.rainbowUsableFlags,
      )
      expect(resolved.supportRequirementsByFlag).not.toBe(
        supplied.supportRequirementsByFlag,
      )
      expect(resolved.searchableTraits).not.toBe(supplied.searchableTraits)
      expect(Object.isFrozen(resolved)).toBe(true)
      expect(Object.isFrozen(resolved.flags)).toBe(true)
      expect(Object.isFrozen(resolved.rainbowUsableFlags)).toBe(true)
      expect(Object.isFrozen(resolved.supportRequirementsByFlag)).toBe(true)
      for (const requirement of Object.values(
        resolved.supportRequirementsByFlag,
      )) {
        if (requirement === null) continue
        expect(Object.isFrozen(requirement)).toBe(true)
        expect(Object.isFrozen(requirement.requiredNames)).toBe(true)
        expect(Object.isFrozen(requirement.requiredTraits)).toBe(true)
      }
      expect(Object.isFrozen(resolved.searchableTraits)).toBe(true)
      expect(Object.isFrozen(resolved.searchableNames)).toBe(true)
      expect(Object.isFrozen(resolved.requiredTraits)).toBe(true)
      expect(Object.isFrozen(resolved.requiredNames)).toBe(true)
      expect(Object.isFrozen(resolved.evidence)).toBe(true)
    }
  })

  it('reparses current-revision effects that do not match printed text', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    const firstFeatures = classifyCardFeatures(cards[1]!)
    const secondFeatures = classifyCardFeatures(cards[0]!)
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      { ...suggestion(cards[0]!.cardNumber), features: firstFeatures },
      { ...suggestion(cards[1]!.cardNumber), features: secondFeatures },
    ])}\n`
    await rebuildChecksums()

    const catalog = await loadRuntimeCatalog(entry, fetcher)

    expect(catalog.featuresByCardNumber.get('OP16-005')).toEqual(
      classifyCardFeatures(cards[0]!),
    )
    expect(catalog.featuresByCardNumber.get('OP10-045')).toEqual(
      classifyCardFeatures(cards[1]!),
    )
  })

  it('reclassifies enriched features created before rainbow usable flags', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    const firstFeatures = classifyCardFeatures(cards[0]!)
    const secondFeatures = classifyCardFeatures(cards[1]!)
    const {
      effectModelVersion: _effectModelVersion,
      effectParserRevision: _effectParserRevision,
      effects: _effects,
      unparsedClauses: _unparsedClauses,
      rainbowUsableFlags: _rainbowUsableFlags,
      ...legacyFeatures
    } = secondFeatures
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      { ...suggestion(cards[0]!.cardNumber), features: legacyFeatures },
      suggestion(cards[1]!.cardNumber),
    ])}\n`
    await rebuildChecksums()

    const catalog = await loadRuntimeCatalog(entry, fetcher)
    const suppliedFeatures = catalog.strategySuggestions[0]!.features!
    const resolvedFeatures = catalog.featuresByCardNumber.get('OP16-005')!

    expect(suppliedFeatures).toEqual(legacyFeatures)
    expect('rainbowUsableFlags' in suppliedFeatures).toBe(false)
    expect(resolvedFeatures).toEqual(firstFeatures)
    expect(resolvedFeatures).not.toEqual(secondFeatures)
    expect(Object.isFrozen(resolvedFeatures)).toBe(true)
    expect(Object.isFrozen(resolvedFeatures.rainbowUsableFlags)).toBe(true)
  })

  it('reclassifies enriched features created before per-claim support requirements', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    const currentFeatures = classifyCardFeatures(cards[0]!)
    const {
      effectModelVersion: _effectModelVersion,
      effectParserRevision: _effectParserRevision,
      effects: _effects,
      unparsedClauses: _unparsedClauses,
      supportRequirementsByFlag: _supportRequirementsByFlag,
      ...preSupportRequirementsFeatures
    } = currentFeatures
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      {
        ...suggestion(cards[0]!.cardNumber),
        features: preSupportRequirementsFeatures,
      },
      suggestion(cards[1]!.cardNumber),
    ])}\n`
    await rebuildChecksums()

    const catalog = await loadRuntimeCatalog(entry, fetcher)
    const suppliedFeatures = catalog.strategySuggestions[0]!.features!
    const resolvedFeatures = catalog.featuresByCardNumber.get('OP16-005')!

    expect(suppliedFeatures).toEqual(preSupportRequirementsFeatures)
    expect('supportRequirementsByFlag' in suppliedFeatures).toBe(false)
    expect(resolvedFeatures).toEqual(currentFeatures)
    expect(Object.isFrozen(resolvedFeatures.supportRequirementsByFlag)).toBe(
      true,
    )
  })

  it('reclassifies authoritative-looking metadata created before premium flags', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    cards[0] = {
      ...cards[0]!,
      name: 'Shanks',
      rarity: 'SR',
      cost: 10,
      power: 12000,
      counter: 0,
      effect:
        "[Rush]<br/>[On Play] Set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
    }
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify(cards)}\n`
    const firstFeatures = classifyCardFeatures(cards[0]!)
    const {
      effectModelVersion: _effectModelVersion,
      effectParserRevision: _effectParserRevision,
      effects: _effects,
      unparsedClauses: _unparsedClauses,
      ...legacySwappedFeatures
    } = structuredClone(classifyCardFeatures(cards[1]!))
    const swappedFeatures = legacySwappedFeatures as unknown as {
      flags: Record<string, boolean>
      rainbowUsableFlags: Record<string, boolean>
    }
    delete swappedFeatures.flags.massRest
    delete swappedFeatures.flags.donRefresh
    delete swappedFeatures.rainbowUsableFlags.massRest
    delete swappedFeatures.rainbowUsableFlags.donRefresh
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      { ...suggestion(cards[0]!.cardNumber), features: swappedFeatures },
      suggestion(cards[1]!.cardNumber),
    ])}\n`
    await rebuildChecksums()

    const catalog = await loadRuntimeCatalog(entry, fetcher)
    const suppliedFeatures = catalog.strategySuggestions[0]!.features!
    const resolvedFeatures = catalog.featuresByCardNumber.get('OP16-005')!

    expect('rainbowUsableFlags' in suppliedFeatures).toBe(true)
    expect('supportRequirementsByFlag' in suppliedFeatures).toBe(true)
    if (!('rainbowUsableFlags' in suppliedFeatures)) {
      throw new Error('expected pre-premium Rainbow feature metadata')
    }
    expect('massRest' in suppliedFeatures.flags).toBe(false)
    expect('donRefresh' in suppliedFeatures.flags).toBe(false)
    expect('massRest' in suppliedFeatures.rainbowUsableFlags).toBe(false)
    expect('donRefresh' in suppliedFeatures.rainbowUsableFlags).toBe(false)
    expect(resolvedFeatures).toEqual(firstFeatures)
    expect(resolvedFeatures).not.toEqual(suppliedFeatures)
    expect(resolvedFeatures.flags.massRest).toBe(true)
    expect(resolvedFeatures.flags.donRefresh).toBe(true)
    expect(resolvedFeatures.rainbowUsableFlags.massRest).toBe(true)
    expect(resolvedFeatures.rainbowUsableFlags.donRefresh).toBe(true)
  })

  it('reclassifies every exact legacy feature layer from printed text', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    cards[0] = { ...cards[0]!, effect: '[Blocker]' }
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify(cards)}\n`
    const expected = classifyCardFeatures(cards[0]!)

    for (const legacyFeatures of exactLegacyFeatureVariants()) {
      artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
        { ...suggestion(cards[0]!.cardNumber), features: legacyFeatures },
        suggestion(cards[1]!.cardNumber),
      ])}\n`
      await rebuildChecksums()

      const catalog = await loadRuntimeCatalog(entry, fetcher)

      expect(catalog.strategySuggestions[0]!.features).toEqual(legacyFeatures)
      expect(catalog.featuresByCardNumber.get('OP16-005')).toEqual(expected)
    }
  })

  it('classifies legacy suggestions without adding features to the suggestions', async () => {
    const { artifacts, fetcher } = await runtimeFixture()
    const cards = JSON.parse(
      artifacts['/catalogs/op16/cards.json']!,
    ) as PlayableCard[]
    const firstFeatures = classifyCardFeatures(cards[0]!)
    const secondFeatures = classifyCardFeatures(cards[1]!)

    const catalog = await loadRuntimeCatalog(entry, fetcher)

    expect(catalog.strategySuggestions.every(({ features }) => features === undefined)).toBe(
      true,
    )
    expect(catalog.featuresByCardNumber.get('OP16-005')).toEqual(firstFeatures)
    expect(catalog.featuresByCardNumber.get('OP10-045')).toEqual(secondFeatures)
    expect(firstFeatures).not.toEqual(secondFeatures)
  })

  it('rejects a missing artifact response', async () => {
    const { artifacts, fetcher } = await runtimeFixture()
    delete artifacts['/catalogs/op16/cards.json']

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /cards\.json.*404/i,
    )
  })

  it('rejects malformed artifact JSON', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    artifacts['/catalogs/op16/cards.json'] = '{not json'
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /cards\.json.*malformed JSON/i,
    )
  })

  it('rejects an artifact that does not match its shared schema', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify([
      { unexpected: true },
    ])}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /cards\.json.*schema/i,
    )
  })

  it('rejects a manifest whose identity differs from the index entry', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const manifest = JSON.parse(
      artifacts['/catalogs/op16/manifest.json']!,
    ) as Record<string, unknown>
    artifacts['/catalogs/op16/manifest.json'] = `${JSON.stringify({
      ...manifest,
      setId: 'OP15',
    })}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /manifest.*identity.*index/i,
    )
  })

  it('verifies checksums against the unparsed response bytes', async () => {
    const { artifacts, fetcher } = await runtimeFixture()
    artifacts['/catalogs/op16/cards.json'] = `${
      artifacts['/catalogs/op16/cards.json']
    } `

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /checksum mismatch.*cards\.json/i,
    )
  })

  it('rejects duplicate card numbers', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const duplicate = card('OP16-005')
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify([
      duplicate,
      duplicate,
    ])}\n`
    artifacts['/catalogs/op16/set-contents.json'] = `${JSON.stringify([
      'OP16-005',
      'OP16-005',
    ])}\n`
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      suggestion('OP16-005'),
      suggestion('OP16-005'),
    ])}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /duplicate card number.*OP16-005/i,
    )
  })

  it('rejects duplicate normal-card shortcuts', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = [
      card('OP16-005'),
      card('OP16-006', { entryShortcut: '005' }),
    ]
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify(cards)}\n`
    artifacts['/catalogs/op16/set-contents.json'] = `${JSON.stringify(
      cards.map(({ cardNumber }) => cardNumber),
    )}\n`
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify(
      cards.map(({ cardNumber }) => suggestion(cardNumber)),
    )}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /duplicate shortcut.*005/i,
    )
  })

  it('rejects a special reprint that exposes a numeric shortcut', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = [
      card('OP16-005'),
      card('OP10-045', { entryShortcut: '045' }),
    ]
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify(cards)}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /special reprint.*OP10-045.*shortcut/i,
    )
  })

  it('rejects a card that is not a member of the selected set', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    const cards = [
      card('OP16-005'),
      card('OP10-045', { setMembership: ['OP10'] }),
    ]
    artifacts['/catalogs/op16/cards.json'] = `${JSON.stringify(cards)}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /card OP10-045.*missing OP16 membership/i,
    )
  })

  it('rejects set contents that do not exactly match card order', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    artifacts['/catalogs/op16/set-contents.json'] = `${JSON.stringify([
      'OP10-045',
      'OP16-005',
    ])}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /set contents.*match.*cards/i,
    )
  })

  it('rejects a strategy suggestion for an unknown card', async () => {
    const { artifacts, fetcher, rebuildChecksums } = await runtimeFixture()
    artifacts['/catalogs/op16/strategy-suggestions.json'] = `${JSON.stringify([
      suggestion('OP16-005'),
      suggestion('OP16-999'),
    ])}\n`
    await rebuildChecksums()

    await expect(loadRuntimeCatalog(entry, fetcher)).rejects.toThrow(
      /strategy suggestion.*unknown card.*OP16-999/i,
    )
  })
})
