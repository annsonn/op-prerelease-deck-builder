import { catalogManifestSchema } from '../../shared/catalog.js'

import { canonicalize } from './canonicalize.js'
import {
  deriveStrategy,
  type StrategySuggestion,
} from './derive-strategy.js'
import type { PlayableCard, SourceCard, SourceConfig } from './model.js'
import { validateCatalog, type ValidationResult } from './validate.js'

export type CatalogBundle = Record<string, unknown>

export interface PreparedCatalogResult {
  setId: string
  cardCount: number
  variantCount: number
  specialReprintCount: number
  readiness: ValidationResult['readiness']
}

export interface PreparedCatalog {
  setId: string
  sourceCards: SourceCard[]
  cards: PlayableCard[]
  strategySuggestions: StrategySuggestion[]
  validation: ValidationResult
  specialReprints: string[]
  bundle: CatalogBundle
  result: PreparedCatalogResult
}

export function prepareCatalog(
  sourceCards: SourceCard[],
  config: SourceConfig,
): PreparedCatalog {
  const cards = canonicalize(sourceCards, config.targetSet)
  const strategySuggestions = cards.map(deriveStrategy)
  const validation = validateCatalog(cards, config, strategySuggestions)
  const setId = config.targetSet.toUpperCase()
  const specialReprints = cards
    .filter(({ isSpecialReprint }) => isSpecialReprint)
    .map(({ cardNumber }) => cardNumber)
    .sort()
  const manifest = catalogManifestSchema.parse({
    schemaVersion: 1,
    setId,
    language: 'en',
    source: config.source,
    sourceType: config.sourceType,
    ...(config.sourceType === 'cardkaizoku-json'
      ? { sourceSha256: config.sourceSha256 }
      : {}),
    readiness: validation.readiness,
  })

  const bundle: CatalogBundle = {
    'manifest.json': manifest,
    'cards.json': cards,
    'set-contents.json': cards.map(({ cardNumber }) => cardNumber),
    'strategy-suggestions.json': strategySuggestions,
    'import-report.json': {
      sourceRecords: sourceCards.length,
      playableIdentities: cards.length,
      variantsCollapsed: sourceCards.length - cards.length,
      specialReprints,
      validation,
    },
  }
  const result: PreparedCatalogResult = {
    setId,
    cardCount: cards.length,
    variantCount: sourceCards.length,
    specialReprintCount: specialReprints.length,
    readiness: validation.readiness,
  }

  return {
    setId,
    sourceCards,
    cards,
    strategySuggestions,
    validation,
    specialReprints,
    bundle,
    result,
  }
}
