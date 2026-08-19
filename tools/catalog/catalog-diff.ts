import { stableStringify } from './artifacts.js'
import type { PlayableCard } from './model.js'
import { canonicalPlayableRarities } from './validate.js'

export const comparedGameplayFields = [
  'name',
  'cardType',
  'cost',
  'life',
  'power',
  'counter',
  'colors',
  'attribute',
  'traits',
  'effect',
  'trigger',
  'rarity',
] as const

export interface FieldChange {
  cardNumber: string
  field: (typeof comparedGameplayFields)[number]
  before: unknown
  after: unknown
}

export interface CatalogDiff {
  added: string[]
  removed: string[]
  gameplayChanges: FieldChange[]
  specialReprintsAdded: string[]
  specialReprintsRemoved: string[]
  newlyUnknownRarities: string[]
  newlyResolvedRarities: string[]
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort(compareCodeUnits)
}

function specialReprintIds(cards: PlayableCard[]): Set<string> {
  return new Set(
    cards
      .filter(({ isSpecialReprint }) => isSpecialReprint)
      .map(({ cardNumber }) => cardNumber),
  )
}

export function diffCatalogs(
  before: PlayableCard[],
  after: PlayableCard[],
): CatalogDiff {
  const beforeByCardNumber = new Map(
    before.map((card) => [card.cardNumber, card]),
  )
  const afterByCardNumber = new Map(
    after.map((card) => [card.cardNumber, card]),
  )
  const beforeIds = new Set(beforeByCardNumber.keys())
  const afterIds = new Set(afterByCardNumber.keys())
  const beforeSpecialIds = specialReprintIds(before)
  const afterSpecialIds = specialReprintIds(after)
  const canonicalRarities = new Set<string>(canonicalPlayableRarities)
  const gameplayChanges: FieldChange[] = []
  const newlyUnknownRarities: string[] = []
  const newlyResolvedRarities: string[] = []

  const sharedIds = [...beforeIds]
    .filter((cardNumber) => afterIds.has(cardNumber))
    .sort(compareCodeUnits)

  for (const cardNumber of sharedIds) {
    const beforeCard = beforeByCardNumber.get(cardNumber)
    const afterCard = afterByCardNumber.get(cardNumber)

    if (beforeCard === undefined || afterCard === undefined) {
      continue
    }

    for (const field of comparedGameplayFields) {
      const beforeValue = beforeCard[field]
      const afterValue = afterCard[field]

      if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
        gameplayChanges.push({
          cardNumber,
          field,
          before: beforeValue,
          after: afterValue,
        })
      }
    }

    const wasUnknown = !canonicalRarities.has(beforeCard.rarity)
    const isUnknown = !canonicalRarities.has(afterCard.rarity)

    if (!wasUnknown && isUnknown) {
      newlyUnknownRarities.push(cardNumber)
    } else if (wasUnknown && !isUnknown) {
      newlyResolvedRarities.push(cardNumber)
    }
  }

  return {
    added: sortedDifference(afterIds, beforeIds),
    removed: sortedDifference(beforeIds, afterIds),
    gameplayChanges,
    specialReprintsAdded: sortedDifference(afterSpecialIds, beforeSpecialIds),
    specialReprintsRemoved: sortedDifference(beforeSpecialIds, afterSpecialIds),
    newlyUnknownRarities,
    newlyResolvedRarities,
  }
}
