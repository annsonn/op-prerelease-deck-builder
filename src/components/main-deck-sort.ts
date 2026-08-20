import type { DeckLine } from '../solver/types.js'

export const MAIN_DECK_SORT_FIELDS = [
  'score',
  'name',
  'cost',
  'power',
] as const

export type MainDeckSortField = (typeof MAIN_DECK_SORT_FIELDS)[number]
export type MainDeckSortDirection = 'ascending' | 'descending'

const nameCollator = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
})

const cardNumberCollator = new Intl.Collator('en', { numeric: true })

export function defaultDirectionFor(
  field: MainDeckSortField,
): MainDeckSortDirection {
  switch (field) {
    case 'score':
    case 'power':
      return 'descending'
    case 'name':
    case 'cost':
      return 'ascending'
  }
}

export function parseMainDeckSortField(value: string): MainDeckSortField {
  switch (value) {
    case 'score':
    case 'name':
    case 'cost':
    case 'power':
      return value
    default:
      throw new Error(`Unsupported Main deck sort field: ${value}.`)
  }
}

function applyDirection(
  comparison: number,
  direction: MainDeckSortDirection,
): number {
  return direction === 'ascending' ? comparison : -comparison
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: MainDeckSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1

  return applyDirection(left - right, direction)
}

function compareByField(
  left: DeckLine,
  right: DeckLine,
  field: MainDeckSortField,
  direction: MainDeckSortDirection,
): number {
  switch (field) {
    case 'score':
      return applyDirection(left.score - right.score, direction)
    case 'name':
      return applyDirection(
        nameCollator.compare(left.card.name, right.card.name),
        direction,
      )
    case 'cost':
      return compareNullableNumber(left.card.cost, right.card.cost, direction)
    case 'power':
      return compareNullableNumber(left.card.power, right.card.power, direction)
  }
}

export function sortMainDeck(
  lines: readonly DeckLine[],
  field: MainDeckSortField,
  direction: MainDeckSortDirection,
): DeckLine[] {
  return [...lines].sort((left, right) => {
    const fieldComparison = compareByField(left, right, field, direction)

    return (
      fieldComparison ||
      cardNumberCollator.compare(left.card.cardNumber, right.card.cardNumber)
    )
  })
}
