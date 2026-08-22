import { describe, expect, it } from 'vitest'

import {
  artifactChecksumsSchema,
  cardTypeSchema,
  catalogManifestSchema,
  nullableNonnegativeIntegerSchema,
  playableCardSchema,
  printedCardIdSchema,
  readinessSchema,
  serializedCardFeaturesSchema,
  sourceTypeSchema,
  strategySuggestionSchema,
  type PlayableCard,
} from './catalog.js'
import {
  cardFeaturesSchema,
  classifyCardFeatures,
  featureFlagsSchema,
} from './card-features.js'
import {
  runtimeCatalogIndexEntrySchema,
  runtimeCatalogIndexSchema,
  type RuntimeCatalogIndex,
} from './catalog-index.js'
import type { SourceCard, SourceConfig } from '../tools/catalog/model.js'
import { prepareCatalog } from '../tools/catalog/prepare.js'

const checksum = 'a'.repeat(64)

const playableCard: PlayableCard = {
  cardNumber: 'OP17-001',
  name: 'Test Card',
  rarity: 'C',
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
  variantsCollapsed: 1,
  entryShortcut: '001',
  isSpecialReprint: false,
}

const historicalCurrentFlags = {
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
}

const historicalPrePremiumFlags = {
  twoKCounter: false,
  blocker: false,
  vanillaLike: false,
  draw: false,
  removal: false,
  boss: false,
  rush: false,
  banish: false,
  twoForOne: false,
  searcher: false,
  comboDependent: false,
  brick: false,
}

const historicalSupportRequirementsByFlag = {
  blocker: null,
  draw: null,
  removal: null,
  rush: null,
  banish: null,
  twoForOne: null,
  searcher: null,
}

function runtimeIndex(): RuntimeCatalogIndex {
  return {
    schemaVersion: 1,
    sets: Array.from({ length: 17 }, (_, index) => {
      const setId = `OP${String(index + 1).padStart(2, '0')}`
      return {
        setId,
        label: `Set ${index + 1}`,
        manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
        sourceSha256: checksum,
        readiness: 'tournament-ready' as const,
      }
    }),
  }
}

describe('shared catalog primitives', () => {
  it('accepts and rejects card types', () => {
    expect(cardTypeSchema.parse('LEADER')).toBe('LEADER')
    expect(cardTypeSchema.safeParse('TREASURE').success).toBe(false)
  })

  it('accepts and rejects readiness values', () => {
    expect(readinessSchema.parse('needs-review')).toBe('needs-review')
    expect(readinessSchema.safeParse('ready').success).toBe(false)
  })

  it('accepts nullable nonnegative integers and rejects other numbers', () => {
    expect(nullableNonnegativeIntegerSchema.parse(null)).toBeNull()
    expect(nullableNonnegativeIntegerSchema.parse(0)).toBe(0)
    expect(nullableNonnegativeIntegerSchema.safeParse(-1).success).toBe(false)
    expect(nullableNonnegativeIntegerSchema.safeParse(1.5).success).toBe(false)
  })

  it('accepts printed card IDs and rejects malformed IDs', () => {
    expect(printedCardIdSchema.parse('OP17-001')).toBe('OP17-001')
    expect(printedCardIdSchema.parse('P-001')).toBe('P-001')
    expect(printedCardIdSchema.safeParse('op17-001').success).toBe(false)
    expect(printedCardIdSchema.safeParse('OP17-1').success).toBe(false)
  })
})

describe('playableCardSchema', () => {
  it('accepts the existing playable card shape', () => {
    expect(playableCardSchema.parse(playableCard)).toEqual(playableCard)
  })

  it('rejects invalid playable card fields', () => {
    expect(
      playableCardSchema.safeParse({ ...playableCard, variantsCollapsed: 0 })
        .success,
    ).toBe(false)
    expect(
      playableCardSchema.safeParse({ ...playableCard, entryShortcut: '1' })
        .success,
    ).toBe(false)
    expect(
      playableCardSchema.safeParse({ ...playableCard, sourceRecordId: 'source' })
        .success,
    ).toBe(false)
  })
})

describe('strategySuggestionSchema', () => {
  it('accepts only complete canonical version two effect metadata', () => {
    const canonical = classifyCardFeatures({
      ...playableCard,
      effect: '[On Play] Draw 1 card.',
    })

    expect(serializedCardFeaturesSchema.parse(canonical)).toEqual(canonical)
    expect(cardFeaturesSchema.parse(canonical)).toEqual(canonical)

    const invalidCanonical = [
      { ...canonical, effectParserRevision: 3 },
      Object.fromEntries(
        Object.entries(canonical).filter(
          ([key]) => key !== 'effectParserRevision',
        ),
      ),
      Object.fromEntries(
        Object.entries(canonical).filter(([key]) => key !== 'effects'),
      ),
      Object.fromEntries(
        Object.entries(canonical).filter(
          ([key]) => key !== 'unparsedClauses',
        ),
      ),
      {
        ...canonical,
        effects: canonical.effects.map((effect, index) =>
          index === 0
            ? {
                ...effect,
                branches: [{ actions: [{ kind: 'notAnAction' }] }],
              }
            : effect,
        ),
      },
      {
        ...canonical,
        effects: canonical.effects.map((effect, effectIndex) => ({
          ...effect,
          branches: effect.branches.map((branch, branchIndex) => ({
            actions: branch.actions.map((action, actionIndex) =>
              effectIndex === 0 && branchIndex === 0 && actionIndex === 0
                ? { ...action, unexpected: true }
                : action,
            ),
          })),
        })),
      },
      { ...canonical, unexpected: true },
    ]

    for (const features of invalidCanonical) {
      expect(serializedCardFeaturesSchema.safeParse(features).success).toBe(
        false,
      )
    }
  })

  it('accepts revision one as prior input but not as the canonical runtime model', () => {
    const canonical = classifyCardFeatures({
      ...playableCard,
      effect: '[On Play] Draw 1 card.',
    })
    const priorRevision = { ...canonical, effectParserRevision: 1 }

    expect(serializedCardFeaturesSchema.parse(priorRevision)).toEqual(
      priorRevision,
    )
    expect(cardFeaturesSchema.safeParse(priorRevision).success).toBe(false)
  })

  it('rejects version two metadata mixed into a legacy feature shape', () => {
    const canonical = classifyCardFeatures(playableCard)
    const {
      effectModelVersion: _effectModelVersion,
      effectParserRevision: _effectParserRevision,
      effects: _effects,
      unparsedClauses: _unparsedClauses,
      rainbowUsableFlags: _rainbowUsableFlags,
      ...legacy
    } = canonical

    expect(
      serializedCardFeaturesSchema.safeParse({
        ...legacy,
        effectModelVersion: 2,
        effectParserRevision: 1,
        effects: [],
        unparsedClauses: [],
      }).success,
    ).toBe(false)
  })

  it('accepts the existing suggestion shape', () => {
    const suggestion = {
      cardNumber: 'OP17-001',
      roles: ['pressure', 'twoKCounter'],
      reviewStatus: 'suggested',
    }

    expect(strategySuggestionSchema.parse(suggestion)).toEqual(suggestion)
  })

  it('rejects unknown roles and review states', () => {
    expect(
      strategySuggestionSchema.safeParse({
        cardNumber: 'OP17-001',
        roles: ['healer'],
        reviewStatus: 'suggested',
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        cardNumber: 'OP17-001',
        roles: [],
        reviewStatus: 'suggested',
        notes: '',
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        cardNumber: 'OP17-001',
        roles: [],
        reviewStatus: 'approved',
      }).success,
    ).toBe(false)
  })

  it('accepts serialized card features without changing the legacy suggestion contract', () => {
    const suggestion = {
      cardNumber: 'OP17-001',
      roles: ['blocker'],
      reviewStatus: 'suggested',
      features: {
        flags: { ...historicalCurrentFlags },
        rainbowUsableFlags: { ...historicalCurrentFlags },
        supportRequirementsByFlag: {
          ...historicalSupportRequirementsByFlag,
        },
        rainbowLuffyCompatibility: 'compatible',
        searchableTraits: ['Heart Pirates'],
        searchableNames: ['Trafalgar Law'],
        requiredTraits: [],
        requiredNames: [],
        evidence: ['Searcher'],
      },
    }

    expect(strategySuggestionSchema.parse(suggestion)).toEqual(suggestion)
    const {
      supportRequirementsByFlag: _supportRequirementsByFlag,
      ...preSupportRequirementsFeatures
    } = suggestion.features
    expect(
      strategySuggestionSchema.parse({
        ...suggestion,
        features: preSupportRequirementsFeatures,
      }),
    ).toEqual({
      ...suggestion,
      features: preSupportRequirementsFeatures,
    })
    const { rainbowUsableFlags: _rainbowUsableFlags, ...legacyFeatures } =
      suggestion.features
    const legacySuggestion = { ...suggestion, features: legacyFeatures }
    expect(strategySuggestionSchema.parse(legacySuggestion)).toEqual(
      legacySuggestion,
    )
  })

  it('accepts complete current and pre-premium flags across every historical feature layer', () => {
    const common = {
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
    }
    const featureLayers = (flags: Record<string, boolean>) => [
      {
        flags,
        rainbowUsableFlags: { ...flags },
        supportRequirementsByFlag: {
          ...historicalSupportRequirementsByFlag,
        },
        ...common,
      },
      { flags, rainbowUsableFlags: { ...flags }, ...common },
      {
        flags,
        supportRequirementsByFlag: {
          ...historicalSupportRequirementsByFlag,
        },
        ...common,
      },
      { flags, ...common },
    ]

    expect(featureFlagsSchema.parse(historicalCurrentFlags)).toEqual(
      historicalCurrentFlags,
    )
    for (const flags of [
      historicalCurrentFlags,
      historicalPrePremiumFlags,
    ]) {
      for (const features of featureLayers(flags)) {
        expect(
          strategySuggestionSchema.safeParse({
            cardNumber: 'OP17-001',
            roles: [],
            reviewStatus: 'suggested',
            features,
          }).success,
        ).toBe(true)
      }
    }
  })

  it('keeps the pinned legacy contract independent of future fields', () => {
    const legacy = {
      flags: { ...historicalCurrentFlags },
      rainbowUsableFlags: { ...historicalCurrentFlags },
      supportRequirementsByFlag: {
        ...historicalSupportRequirementsByFlag,
      },
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
    }

    expect(serializedCardFeaturesSchema.parse(legacy)).toEqual(legacy)
    expect(
      serializedCardFeaturesSchema.safeParse({
        ...legacy,
        flags: { ...legacy.flags, futureFlag: false },
      }).success,
    ).toBe(false)
    expect(
      serializedCardFeaturesSchema.safeParse({
        ...legacy,
        futureProjection: [],
      }).success,
    ).toBe(false)
  })

  it('rejects partial premium vocabulary in either feature flag record', () => {
    const baseFeatures = {
      flags: { ...historicalCurrentFlags },
      rainbowUsableFlags: { ...historicalCurrentFlags },
      supportRequirementsByFlag: {
        ...historicalSupportRequirementsByFlag,
      },
      rainbowLuffyCompatibility: 'compatible',
      searchableTraits: [],
      searchableNames: [],
      requiredTraits: [],
      requiredNames: [],
      evidence: [],
    }
    const partialFlags = {
      ...historicalPrePremiumFlags,
      massRest: false,
    }

    for (const features of [
      { ...baseFeatures, flags: partialFlags },
      { ...baseFeatures, rainbowUsableFlags: partialFlags },
    ]) {
      expect(
        strategySuggestionSchema.safeParse({
          cardNumber: 'OP17-001',
          roles: [],
          reviewStatus: 'suggested',
          features,
        }).success,
      ).toBe(false)
    }
  })

  it('strictly rejects malformed serialized card features', () => {
    const suggestion = {
      cardNumber: 'OP17-001',
      roles: [],
      reviewStatus: 'suggested',
      features: {
        flags: { ...historicalCurrentFlags },
        rainbowUsableFlags: { ...historicalCurrentFlags },
        supportRequirementsByFlag: {
          ...historicalSupportRequirementsByFlag,
        },
        rainbowLuffyCompatibility: 'compatible',
        searchableTraits: [],
        searchableNames: [],
        requiredTraits: [],
        requiredNames: [],
        evidence: [],
      },
    }

    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: { ...suggestion.features, unexpected: true },
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: {
          ...suggestion.features,
          supportRequirementsByFlag: {
            blocker: {
              requiredNames: ['Nami'],
              requiredTraits: [],
            },
          },
        },
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: {
          ...suggestion.features,
          flags: { ...historicalCurrentFlags, blocker: 'yes' },
        },
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: {
          ...suggestion.features,
          rainbowUsableFlags: { blocker: true },
        },
      }).success,
    ).toBe(false)
    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: {
          ...suggestion.features,
          rainbowUsableFlags: {
            ...suggestion.features.rainbowUsableFlags,
            unexpected: false,
          },
        },
      }).success,
    ).toBe(false)
    const { rainbowUsableFlags: _rainbowUsableFlags, ...legacyFeatures } =
      suggestion.features
    expect(
      strategySuggestionSchema.safeParse({
        ...suggestion,
        features: { ...legacyFeatures, unexpected: false },
      }).success,
    ).toBe(false)
  })
})

describe('catalogManifestSchema', () => {
  const manifest = {
    schemaVersion: 1,
    setId: 'OP17',
    language: 'en',
    source: 'https://cdn.example.test/cards.json',
    sourceType: 'cardkaizoku-json',
    sourceSha256: checksum,
    readiness: 'tournament-ready',
  }

  it('accepts the supported source types', () => {
    expect(sourceTypeSchema.parse('official-html')).toBe('official-html')
    expect(sourceTypeSchema.parse('local-json')).toBe('local-json')
    expect(sourceTypeSchema.parse('cardkaizoku-json')).toBe('cardkaizoku-json')
  })

  it('rejects unsupported source types', () => {
    expect(sourceTypeSchema.safeParse('api').success).toBe(false)
  })

  it('accepts an exact manifest with an optional checksum', () => {
    expect(catalogManifestSchema.parse(manifest)).toEqual(manifest)
    const { sourceSha256: _sourceSha256, ...withoutChecksum } = manifest
    expect(catalogManifestSchema.parse(withoutChecksum)).toEqual(
      withoutChecksum,
    )
  })

  it('rejects invalid manifest fields', () => {
    expect(
      catalogManifestSchema.safeParse({ ...manifest, schemaVersion: 2 }).success,
    ).toBe(false)
    expect(
      catalogManifestSchema.safeParse({ ...manifest, setId: 'op17' }).success,
    ).toBe(false)
    expect(
      catalogManifestSchema.safeParse({ ...manifest, language: 'fr' }).success,
    ).toBe(false)
    expect(
      catalogManifestSchema.safeParse({ ...manifest, source: 'not a URL' })
        .success,
    ).toBe(false)
    expect(
      catalogManifestSchema.safeParse({ ...manifest, sourceSha256: 'bad' })
        .success,
    ).toBe(false)
    expect(
      catalogManifestSchema.safeParse({ ...manifest, generatedAt: 'now' })
        .success,
    ).toBe(false)
  })
})

describe('artifactChecksumsSchema', () => {
  it('accepts exactly the four browser runtime artifact filenames', () => {
    expect(
      artifactChecksumsSchema.parse({
        'cards.json': checksum,
        'manifest.json': checksum,
        'set-contents.json': checksum,
        'strategy-suggestions.json': checksum,
      }),
    ).toEqual({
      'cards.json': checksum,
      'manifest.json': checksum,
      'set-contents.json': checksum,
      'strategy-suggestions.json': checksum,
    })
  })

  it.each([
    '',
    '/cards.json',
    '\\cards.json',
    'C:\\cards.json',
    '../cards.json',
    'metadata/../cards.json',
    'metadata\\..\\cards.json',
    'cards.json?download=1',
    'cards%2ejson',
    'import-report.json',
  ])('rejects unsafe checksum key %j', (filename) => {
    expect(
      artifactChecksumsSchema.safeParse({
        'cards.json': checksum,
        'manifest.json': checksum,
        'set-contents.json': checksum,
        'strategy-suggestions.json': checksum,
        [filename]: checksum,
      }).success,
    ).toBe(false)
  })

  it('rejects invalid checksum values', () => {
    expect(
      artifactChecksumsSchema.safeParse({
        'cards.json': 'bad',
        'manifest.json': checksum,
        'set-contents.json': checksum,
        'strategy-suggestions.json': checksum,
      }).success,
    ).toBe(false)
  })

  it('rejects a missing runtime artifact checksum', () => {
    expect(
      artifactChecksumsSchema.safeParse({
        'cards.json': checksum,
        'manifest.json': checksum,
        'set-contents.json': checksum,
      }).success,
    ).toBe(false)
  })
})

describe('runtimeCatalogIndexEntrySchema', () => {
  const entry = runtimeIndex().sets[0]

  it('accepts a valid catalog index entry', () => {
    expect(runtimeCatalogIndexEntrySchema.parse(entry)).toEqual(entry)
  })

  it('rejects an empty label and malformed checksum', () => {
    expect(
      runtimeCatalogIndexEntrySchema.safeParse({ ...entry, label: '' }).success,
    ).toBe(false)
    expect(
      runtimeCatalogIndexEntrySchema.safeParse({
        ...entry,
        sourceSha256: 'bad',
      }).success,
    ).toBe(false)
  })

  it('rejects a manifest path that does not match its set ID', () => {
    expect(
      runtimeCatalogIndexEntrySchema.safeParse({
        ...entry,
        manifestPath: '/catalogs/op02/manifest.json',
      }).success,
    ).toBe(false)
  })
})

describe('runtimeCatalogIndexSchema', () => {
  it('accepts the complete ordered OP01 through OP17 index', () => {
    expect(runtimeCatalogIndexSchema.parse(runtimeIndex())).toEqual(
      runtimeIndex(),
    )
  })

  it('rejects the obsolete version field without schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...index } = runtimeIndex()

    expect(
      runtimeCatalogIndexSchema.safeParse({ ...index, version: 1 }).success,
    ).toBe(false)
  })

  it('rejects a missing set', () => {
    const index = runtimeIndex()
    index.sets.pop()
    expect(runtimeCatalogIndexSchema.safeParse(index).success).toBe(false)
  })

  it('rejects duplicate set IDs', () => {
    const index = runtimeIndex()
    index.sets[1] = { ...index.sets[0]! }
    expect(runtimeCatalogIndexSchema.safeParse(index).success).toBe(false)
  })

  it('rejects sets that are out of order', () => {
    const index = runtimeIndex()
    ;[index.sets[0], index.sets[1]] = [index.sets[1]!, index.sets[0]!]
    expect(runtimeCatalogIndexSchema.safeParse(index).success).toBe(false)
  })
})

describe('current catalog tool output', () => {
  it('parses its prepared manifest, card, and suggestion with shared schemas', () => {
    const sourceCard: SourceCard = {
      sourceRecordId: 'OP17-001:0',
      cardNumber: playableCard.cardNumber,
      name: playableCard.name,
      rarity: playableCard.rarity,
      cardType: playableCard.cardType,
      colors: playableCard.colors,
      cost: playableCard.cost,
      life: playableCard.life,
      power: playableCard.power,
      counter: playableCard.counter,
      attribute: playableCard.attribute,
      traits: playableCard.traits,
      effect: playableCard.effect,
      trigger: playableCard.trigger,
      setMembership: playableCard.setMembership,
    }
    const config: SourceConfig = {
      sourceType: 'cardkaizoku-json',
      source: 'https://cdn.example.test/cards.json',
      sourceSha256: checksum,
      cachePath: 'tmp/catalog/source/cards.json',
      targetSet: 'op17',
      expectedFirst: 1,
      expectedLast: 1,
      expectedSpecialReprints: [],
    }

    const prepared = prepareCatalog([sourceCard], config)

    expect(
      catalogManifestSchema.safeParse(prepared.bundle['manifest.json']).success,
    ).toBe(true)
    expect(playableCardSchema.safeParse(prepared.cards[0]).success).toBe(true)
    expect(
      strategySuggestionSchema.safeParse(prepared.strategySuggestions[0]).success,
    ).toBe(true)
  })
})
