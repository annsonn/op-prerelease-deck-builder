import { z } from 'zod'

import {
  runtimeCatalogIndexEntrySchema,
  runtimeCatalogIndexSchema,
  type RuntimeCatalogIndex,
  type RuntimeCatalogIndexEntry,
} from '../../shared/catalog-index.js'
import {
  artifactChecksumsSchema,
  catalogManifestSchema,
  playableCardSchema,
  printedCardIdSchema,
  strategySuggestionSchema,
  type CatalogManifest,
  type PlayableCard,
  type StrategySuggestion,
} from '../../shared/catalog.js'
import {
  classifyCardFeatures,
  type CardFeatures,
} from '../../shared/card-features.js'

export interface RuntimeCatalog {
  manifest: CatalogManifest
  cards: readonly PlayableCard[]
  cardsByNumber: ReadonlyMap<string, PlayableCard>
  normalCardsByShortcut: ReadonlyMap<string, PlayableCard>
  specialCards: readonly PlayableCard[]
  strategySuggestions: readonly StrategySuggestion[]
  suggestionsByCardNumber: ReadonlyMap<string, StrategySuggestion>
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>
}

type RuntimeArtifactName =
  | 'manifest.json'
  | 'cards.json'
  | 'set-contents.json'
  | 'strategy-suggestions.json'
  | 'checksums.json'

const runtimeArtifactNames: readonly RuntimeArtifactName[] = [
  'manifest.json',
  'cards.json',
  'set-contents.json',
  'strategy-suggestions.json',
  'checksums.json',
]
const checksummedArtifactNames = runtimeArtifactNames.slice(0, 4) as readonly (
  | 'manifest.json'
  | 'cards.json'
  | 'set-contents.json'
  | 'strategy-suggestions.json'
)[]
const decoder = new TextDecoder()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchBytes(
  path: string,
  label: string,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetcher(path)
  } catch (cause) {
    throw new Error(`Unable to fetch ${label}: ${errorMessage(cause)}`, {
      cause,
    })
  }
  if (!response.ok) {
    throw new Error(
      `Unable to fetch ${label}: HTTP ${response.status} ${response.statusText}`.trim(),
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes)) as unknown
  } catch (cause) {
    throw new Error(`${label} contains malformed JSON`, { cause })
  }
}

function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`${label} does not match its runtime schema`, {
      cause: result.error,
    })
  }
  return result.data
}

function freezeCardFeatures(features: CardFeatures): CardFeatures {
  const supportRequirementsByFlag = Object.fromEntries(
    Object.entries(features.supportRequirementsByFlag).map(
      ([flag, requirement]) => [
        flag,
        requirement === null
          ? null
          : Object.freeze({
              requiredNames: Object.freeze([...requirement.requiredNames]),
              requiredTraits: Object.freeze([...requirement.requiredTraits]),
            }),
      ],
    ),
  ) as CardFeatures['supportRequirementsByFlag']
  return Object.freeze({
    flags: Object.freeze({ ...features.flags }),
    rainbowUsableFlags: Object.freeze({ ...features.rainbowUsableFlags }),
    supportRequirementsByFlag: Object.freeze(supportRequirementsByFlag),
    rainbowLuffyCompatibility: features.rainbowLuffyCompatibility,
    searchableTraits: Object.freeze([...features.searchableTraits]),
    searchableNames: Object.freeze([...features.searchableNames]),
    requiredTraits: Object.freeze([...features.requiredTraits]),
    requiredNames: Object.freeze([...features.requiredNames]),
    evidence: Object.freeze([...features.evidence]),
  })
}

export async function browserSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function loadCatalogIndex(
  fetcher: typeof fetch = fetch,
): Promise<RuntimeCatalogIndex> {
  const label = 'catalog index /catalogs/index.json'
  const bytes = await fetchBytes('/catalogs/index.json', label, fetcher)
  return parseSchema(
    runtimeCatalogIndexSchema,
    parseJson(bytes, label),
    label,
  )
}

export async function loadRuntimeCatalog(
  entry: RuntimeCatalogIndexEntry,
  fetcher: typeof fetch = fetch,
  digest: (bytes: Uint8Array) => Promise<string> = browserSha256,
): Promise<RuntimeCatalog> {
  const validatedEntry = parseSchema(
    runtimeCatalogIndexEntrySchema,
    entry,
    'catalog index entry',
  )
  const manifestDirectory = validatedEntry.manifestPath.slice(
    0,
    validatedEntry.manifestPath.lastIndexOf('/') + 1,
  )
  const rawArtifacts = Object.fromEntries(
    await Promise.all(
      runtimeArtifactNames.map(async (filename) => [
        filename,
        await fetchBytes(
          `${manifestDirectory}${filename}`,
          `${validatedEntry.setId} ${filename}`,
          fetcher,
        ),
      ]),
    ),
  ) as Record<RuntimeArtifactName, Uint8Array>

  const checksums = parseSchema(
    artifactChecksumsSchema,
    parseJson(
      rawArtifacts['checksums.json'],
      `${validatedEntry.setId} checksums.json`,
    ),
    `${validatedEntry.setId} checksums.json`,
  )
  for (const filename of checksummedArtifactNames) {
    const actual = await digest(rawArtifacts[filename])
    if (actual !== checksums[filename]) {
      throw new Error(
        `Runtime catalog checksum mismatch for ${validatedEntry.setId} ${filename}`,
      )
    }
  }

  const manifest = parseSchema(
    catalogManifestSchema,
    parseJson(
      rawArtifacts['manifest.json'],
      `${validatedEntry.setId} manifest.json`,
    ),
    `${validatedEntry.setId} manifest.json`,
  )
  const cards = parseSchema(
    z.array(playableCardSchema),
    parseJson(
      rawArtifacts['cards.json'],
      `${validatedEntry.setId} cards.json`,
    ),
    `${validatedEntry.setId} cards.json`,
  )
  const contents = parseSchema(
    z.array(printedCardIdSchema),
    parseJson(
      rawArtifacts['set-contents.json'],
      `${validatedEntry.setId} set-contents.json`,
    ),
    `${validatedEntry.setId} set-contents.json`,
  )
  const suggestions = parseSchema(
    z.array(strategySuggestionSchema),
    parseJson(
      rawArtifacts['strategy-suggestions.json'],
      `${validatedEntry.setId} strategy-suggestions.json`,
    ),
    `${validatedEntry.setId} strategy-suggestions.json`,
  )

  if (
    manifest.setId !== validatedEntry.setId ||
    manifest.sourceSha256 !== validatedEntry.sourceSha256 ||
    manifest.readiness !== validatedEntry.readiness
  ) {
    throw new Error(
      `Runtime catalog ${validatedEntry.setId} manifest identity or provenance does not match its index entry`,
    )
  }

  const cardNumbersSeen = new Set<string>()
  const shortcutsSeen = new Set<string>()
  for (const card of cards) {
    if (cardNumbersSeen.has(card.cardNumber)) {
      throw new Error(
        `Runtime catalog contains duplicate card number ${card.cardNumber}`,
      )
    }
    cardNumbersSeen.add(card.cardNumber)

    if (
      !card.setMembership.some(
        (membership) => membership.toUpperCase() === validatedEntry.setId,
      )
    ) {
      throw new Error(
        `Runtime catalog card ${card.cardNumber} is missing ${validatedEntry.setId} membership`,
      )
    }

    if (card.isSpecialReprint) {
      if (card.entryShortcut !== null) {
        throw new Error(
          `Runtime catalog special reprint ${card.cardNumber} must not expose a shortcut`,
        )
      }
      continue
    }
    if (card.entryShortcut === null) {
      throw new Error(
        `Runtime catalog normal card ${card.cardNumber} has no entry shortcut`,
      )
    }
    if (shortcutsSeen.has(card.entryShortcut)) {
      throw new Error(
        `Runtime catalog contains duplicate shortcut ${card.entryShortcut}`,
      )
    }
    shortcutsSeen.add(card.entryShortcut)
  }

  const cardNumbers = cards.map(({ cardNumber }) => cardNumber)
  if (
    contents.length !== cardNumbers.length ||
    contents.some((cardNumber, index) => cardNumber !== cardNumbers[index])
  ) {
    throw new Error(
      `Runtime catalog ${validatedEntry.setId} set contents do not match cards`,
    )
  }

  const suggestionNumbersSeen = new Set<string>()
  for (const suggestion of suggestions) {
    if (!cardNumbersSeen.has(suggestion.cardNumber)) {
      throw new Error(
        `Runtime catalog strategy suggestion references unknown card ${suggestion.cardNumber}`,
      )
    }
    if (suggestionNumbersSeen.has(suggestion.cardNumber)) {
      throw new Error(
        `Runtime catalog contains duplicate strategy suggestion for ${suggestion.cardNumber}`,
      )
    }
    suggestionNumbersSeen.add(suggestion.cardNumber)
  }
  if (suggestionNumbersSeen.size !== cardNumbersSeen.size) {
    throw new Error(
      `Runtime catalog ${validatedEntry.setId} must contain exactly one strategy suggestion per card`,
    )
  }

  const cardsByNumber = new Map(
    cards.map((card) => [card.cardNumber, card] as const),
  )
  const normalCardsByShortcut = new Map(
    cards
      .filter(
        (card): card is PlayableCard & { entryShortcut: string } =>
          !card.isSpecialReprint && card.entryShortcut !== null,
      )
      .map((card) => [card.entryShortcut, card] as const),
  )
  const specialCards = cards.filter(({ isSpecialReprint }) => isSpecialReprint)
  const suggestionsByCardNumber = new Map(
    suggestions.map((suggestion) => [suggestion.cardNumber, suggestion] as const),
  )
  const featuresByCardNumber = new Map(
    cards.map((card) => {
      const suppliedFeatures = suggestionsByCardNumber.get(card.cardNumber)?.features
      const resolvedFeatures =
        suppliedFeatures &&
        'rainbowUsableFlags' in suppliedFeatures &&
        'supportRequirementsByFlag' in suppliedFeatures
          ? suppliedFeatures
          : classifyCardFeatures(card)
      return [
        card.cardNumber,
        freezeCardFeatures(resolvedFeatures),
      ] as const
    }),
  )

  return {
    manifest,
    cards: Object.freeze([...cards]),
    cardsByNumber,
    normalCardsByShortcut,
    specialCards: Object.freeze([...specialCards]),
    strategySuggestions: Object.freeze([...suggestions]),
    suggestionsByCardNumber,
    featuresByCardNumber,
  }
}
