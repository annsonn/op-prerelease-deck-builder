import type { StrategySuggestion } from './derive-strategy.js'
import type { PlayableCard, SourceConfig } from './model.js'

export interface ValidationResult {
  errors: string[]
  warnings: string[]
  readiness: 'provisional' | 'needs-review' | 'tournament-ready'
}

export const canonicalPlayableRarities = [
  'L',
  'C',
  'UC',
  'R',
  'SR',
  'SEC',
  'SP CARD',
] as const

const canonicalPlayableRaritySet = new Set<string>(canonicalPlayableRarities)

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalTargetCardNumbers(config: SourceConfig): string[] {
  const prefix = config.targetSet.toUpperCase()

  return Array.from(
    { length: config.expectedLast - config.expectedFirst + 1 },
    (_, index) =>
      `${prefix}-${String(config.expectedFirst + index).padStart(3, '0')}`,
  )
}

export function validateCatalog(
  cards: PlayableCard[],
  config: SourceConfig,
  strategy: StrategySuggestion[],
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const targetSet = config.targetSet.toUpperCase()
  const cardCounts = new Map<string, number>()
  for (const card of cards) {
    cardCounts.set(card.cardNumber, (cardCounts.get(card.cardNumber) ?? 0) + 1)
  }
  const cardNumbers = new Set(cardCounts.keys())
  const expectedCardNumbers = new Set([
    ...normalTargetCardNumbers(config),
    ...(config.expectedSpecialReprints ?? []),
  ])

  if (config.expectedFirst > config.expectedLast) {
    errors.push(
      `Invalid expected range: ${config.expectedFirst}..${config.expectedLast}`,
    )
  } else {
    for (const cardNumber of normalTargetCardNumbers(config)) {
      if (!cardNumbers.has(cardNumber)) {
        errors.push(`Missing ${cardNumber}`)
      }
    }
  }

  for (const cardNumber of config.expectedSpecialReprints ?? []) {
    if (!cardNumbers.has(cardNumber)) {
      errors.push(`Missing ${cardNumber}`)
    }
  }

  for (const card of [...cards].sort((left, right) =>
    compareCodeUnits(left.cardNumber, right.cardNumber),
  )) {
    if (!expectedCardNumbers.has(card.cardNumber)) {
      errors.push(`Unexpected card: ${card.cardNumber}`)
    }

    const declaresTargetMembership = card.setMembership.some(
      (membership) => membership.toUpperCase() === targetSet,
    )

    if (!declaresTargetMembership) {
      errors.push(`Missing ${targetSet} membership: ${card.cardNumber}`)
    }

    if (!canonicalPlayableRaritySet.has(card.rarity)) {
      warnings.push(`Unknown rarity: ${card.cardNumber}`)
    }
  }

  for (const [cardNumber, count] of [...cardCounts.entries()].sort(
    ([left], [right]) => compareCodeUnits(left, right),
  )) {
    if (count > 1) {
      errors.push(`Duplicate card: ${cardNumber}`)
    }
  }

  const strategyCounts = new Map<string, number>()
  for (const suggestion of strategy) {
    strategyCounts.set(
      suggestion.cardNumber,
      (strategyCounts.get(suggestion.cardNumber) ?? 0) + 1,
    )
  }

  for (const cardNumber of [...cardNumbers].sort(compareCodeUnits)) {
    if (!strategyCounts.has(cardNumber)) {
      errors.push(`Missing strategy: ${cardNumber}`)
    }
  }

  for (const [cardNumber, count] of [...strategyCounts.entries()].sort(
    ([left], [right]) => compareCodeUnits(left, right),
  )) {
    if (count > 1) {
      errors.push(`Duplicate strategy: ${cardNumber}`)
    }
  }

  for (const cardNumber of [...strategyCounts.keys()].sort(compareCodeUnits)) {
    if (!cardNumbers.has(cardNumber)) {
      errors.push(`Unknown strategy card: ${cardNumber}`)
    }
  }

  const allStrategyReviewed = strategy.every(
    ({ reviewStatus }) => reviewStatus === 'reviewed',
  )
  const readiness =
    errors.length > 0
      ? 'provisional'
      : allStrategyReviewed && warnings.length === 0
        ? 'tournament-ready'
        : 'needs-review'

  return { errors, warnings, readiness }
}
