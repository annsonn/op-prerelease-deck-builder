import {
  hasStructuredInteraction,
  type CardFeatures,
} from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'

import { isImportantPlay } from './card-measurements.js'

export const measuredRoleKeys = Object.freeze([
  'twoKCounter',
  'blocker',
  'vanillaLike',
  'draw',
  'removal',
  'interaction',
  'boss',
  'rush',
  'banish',
  'brick',
] as const)

export type MeasuredRole = (typeof measuredRoleKeys)[number]

export interface CandidateCard {
  readonly card: PlayableCard
  readonly features: CardFeatures
}

export interface CandidatePoolEntry extends CandidateCard {
  readonly quantity: number
}

export interface CardSupportEntry {
  readonly quantity: number
  readonly name: string
  readonly traits: readonly string[]
  readonly cardType: PlayableCard['cardType']
  readonly cost: number | null
  readonly power: number | null
  readonly counter: number | null
  readonly hasTrigger: boolean
}
export type CardNumberSupport = CardSupportEntry

export interface MatchSupportTargets {
  readonly names: readonly string[]
  readonly traits: readonly string[]
}

interface ExactCardSupport { readonly cardSupportByNumber: Readonly<Record<string, CardSupportEntry>> }

export type DeckState = Readonly<{
  size: number
  coverage: Readonly<Record<MeasuredRole, number>>
  totalCounter: number
  costCounts: Readonly<Record<string, number>>
  selectedCountsByCardNumber: Readonly<Record<string, number>>
  selectedCountsByName: Readonly<Record<string, number>>
  selectedCountsByTrait: Readonly<Record<string, number>>
  cardSupportByNumber: Readonly<Record<string, CardSupportEntry>>
  importantPlayCounts: Readonly<{
    odd: number
    even: number
  }>
  brickCount: number
}>

export type PoolSupport = Readonly<{
  byCardNumber: Readonly<Record<string, number>>
  byName: Readonly<Record<string, number>>
  byTrait: Readonly<Record<string, number>>
  cardSupportByNumber: Readonly<Record<string, CardNumberSupport>>
}>

const MAIN_DECK_SIZE = 40

function deepFreeze<T extends object>(value: T): T {
  for (const nestedValue of Object.values(value)) {
    if (nestedValue !== null && typeof nestedValue === 'object') {
      deepFreeze(nestedValue)
    }
  }
  return Object.freeze(value)
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined
}

function sortedCountRecord(counts: Readonly<Record<string, number>>): Record<string, number> {
  const sorted = emptyRecord<number>()
  for (const [key, value] of Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    sorted[key] = value
  }
  return sorted
}

function sortedTraits(traits: readonly string[]): readonly string[] {
  return [...new Set(traits)].sort((left, right) => left.localeCompare(right))
}

function sortedCardSupportRecord(
  support: Readonly<Record<string, CardSupportEntry>>,
): Record<string, CardSupportEntry> {
  const sorted = emptyRecord<CardNumberSupport>()
  for (const [cardNumber, entry] of Object.entries(support).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    sorted[cardNumber] = {
      quantity: entry.quantity,
      name: entry.name,
      traits: [...entry.traits],
      cardType: entry.cardType,
      cost: entry.cost,
      power: entry.power,
      counter: entry.counter,
      hasTrigger: entry.hasTrigger,
    }
  }
  return sorted
}

function emptyCoverage(): Record<MeasuredRole, number> {
  const coverage = emptyRecord<number>() as Record<MeasuredRole, number>
  for (const role of measuredRoleKeys) coverage[role] = 0
  return coverage
}

function increment(
  counts: Readonly<Record<string, number>>,
  key: string,
  amount = 1,
): Record<string, number> {
  const next = emptyRecord<number>()
  for (const [existingKey, value] of Object.entries(counts)) {
    next[existingKey] = value
  }
  next[key] = (ownValue(counts, key) ?? 0) + amount
  return next
}

function addCardSupport(
  support: Readonly<Record<string, CardNumberSupport>>,
  card: PlayableCard,
  quantity: number,
): Record<string, CardNumberSupport> {
  const traits = sortedTraits(card.traits)
  const existing = ownValue(support, card.cardNumber)
  if (existing !== undefined) {
    if (
      existing.name !== card.name ||
      existing.cardType !== card.cardType || existing.cost !== card.cost ||
      existing.power !== card.power || existing.counter !== card.counter ||
      existing.hasTrigger !== (card.trigger.trim().length > 0) ||
      existing.traits.length !== traits.length ||
      existing.traits.some((trait, index) => trait !== traits[index])
    ) {
      throw new Error(
        `Conflicting printed support data for card ${card.cardNumber}.`,
      )
    }
  }

  const nextQuantity = (existing?.quantity ?? 0) + quantity
  if (!Number.isSafeInteger(nextQuantity)) {
    throw new RangeError(
      `Pool quantity total for ${card.cardNumber} exceeds a safe integer.`,
    )
  }

  const next = emptyRecord<CardNumberSupport>()
  for (const [cardNumber, entry] of Object.entries(support)) {
    next[cardNumber] = entry
  }
  next[card.cardNumber] = {
    quantity: nextQuantity,
    name: card.name,
    traits,
    cardType: card.cardType,
    cost: card.cost,
    power: card.power,
    counter: card.counter,
    hasTrigger: card.trigger.trim().length > 0,
  }
  return next
}

function measuredCoverage(
  coverage: DeckState['coverage'],
  candidate: CandidateCard,
): Record<MeasuredRole, number> {
  const next = { ...coverage }
  const flags = candidate.features.rainbowUsableFlags

  for (const role of measuredRoleKeys) {
    if (role === 'interaction') continue
    if (flags[role]) next[role] += 1
  }
  if (hasStructuredInteraction(candidate.features)) next.interaction += 1

  return next
}

function freezeDeckState(state: Omit<DeckState, 'brickCount'>): DeckState {
  return deepFreeze({
    ...state,
    coverage: sortedCountRecord(state.coverage) as Record<MeasuredRole, number>,
    costCounts: sortedCountRecord(state.costCounts),
    selectedCountsByCardNumber: sortedCountRecord(state.selectedCountsByCardNumber),
    selectedCountsByName: sortedCountRecord(state.selectedCountsByName),
    selectedCountsByTrait: sortedCountRecord(state.selectedCountsByTrait),
    cardSupportByNumber: sortedCardSupportRecord(state.cardSupportByNumber),
    importantPlayCounts: { ...state.importantPlayCounts },
    brickCount: state.coverage.brick,
  })
}

export function createEmptyDeckState(): DeckState {
  return freezeDeckState({
    size: 0,
    coverage: emptyCoverage(),
    totalCounter: 0,
    costCounts: emptyRecord<number>(),
    selectedCountsByCardNumber: emptyRecord<number>(),
    selectedCountsByName: emptyRecord<number>(),
    selectedCountsByTrait: emptyRecord<number>(),
    cardSupportByNumber: emptyRecord<CardNumberSupport>(),
    importantPlayCounts: { odd: 0, even: 0 },
  })
}

export function addCandidateToDeckState(
  state: DeckState,
  candidate: CandidateCard,
): DeckState {
  if (state.size >= MAIN_DECK_SIZE) {
    throw new RangeError(`A deck state cannot exceed ${MAIN_DECK_SIZE} cards.`)
  }

  const { card } = candidate
  const totalCounter = state.totalCounter + (card.counter ?? 0)
  if (!Number.isSafeInteger(totalCounter)) {
    throw new RangeError('Total counter value must remain a safe integer.')
  }
  const costCounts =
    card.cost === null
      ? state.costCounts
      : increment(state.costCounts, String(card.cost))
  const importantPlayCounts = { ...state.importantPlayCounts }
  if (isImportantPlay(candidate.card, candidate.features)) {
    if (card.cost === null) {
      throw new Error('Important plays must have a numeric cost.')
    }
    importantPlayCounts[card.cost % 2 === 0 ? 'even' : 'odd'] += 1
  }

  let selectedCountsByTrait = state.selectedCountsByTrait
  for (const trait of new Set(card.traits)) {
    selectedCountsByTrait = increment(selectedCountsByTrait, trait)
  }

  return freezeDeckState({
    size: state.size + 1,
    coverage: measuredCoverage(state.coverage, candidate),
    totalCounter,
    costCounts,
    selectedCountsByCardNumber: increment(
      state.selectedCountsByCardNumber,
      card.cardNumber,
    ),
    selectedCountsByName: increment(state.selectedCountsByName, card.name),
    selectedCountsByTrait,
    cardSupportByNumber: addCardSupport(state.cardSupportByNumber, card, 1),
    importantPlayCounts,
  })
}

function validatePoolQuantity(entry: CandidatePoolEntry): void {
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) {
    throw new RangeError(
      `Pool quantity for ${entry.card.cardNumber} must be a positive safe integer.`,
    )
  }
}

function addPoolCount(
  counts: Readonly<Record<string, number>>,
  key: string,
  quantity: number,
): Record<string, number> {
  const total = (ownValue(counts, key) ?? 0) + quantity
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`Pool quantity total for ${key} exceeds a safe integer.`)
  }
  return increment(counts, key, quantity)
}

export function buildPoolSupport(
  entries: readonly CandidatePoolEntry[],
): PoolSupport {
  let byCardNumber: Readonly<Record<string, number>> = emptyRecord<number>()
  let byName: Readonly<Record<string, number>> = emptyRecord<number>()
  let byTrait: Readonly<Record<string, number>> = emptyRecord<number>()
  let cardSupportByNumber: Readonly<Record<string, CardNumberSupport>> =
    emptyRecord<CardNumberSupport>()

  for (const entry of entries) {
    validatePoolQuantity(entry)
    const { card, quantity } = entry
    byCardNumber = addPoolCount(byCardNumber, card.cardNumber, quantity)
    byName = addPoolCount(byName, card.name, quantity)
    for (const trait of new Set(card.traits)) {
      byTrait = addPoolCount(byTrait, trait, quantity)
    }
    cardSupportByNumber = addCardSupport(cardSupportByNumber, card, quantity)
  }

  return deepFreeze({
    byCardNumber: sortedCountRecord(byCardNumber),
    byName: sortedCountRecord(byName),
    byTrait: sortedCountRecord(byTrait),
    cardSupportByNumber: sortedCardSupportRecord(cardSupportByNumber),
  })
}

export function countMatchingSupport(
  support: ExactCardSupport,
  targets: MatchSupportTargets,
): number {
  const names = new Set(targets.names)
  const traits = new Set(targets.traits)
  let count = 0

  for (const entry of Object.values(support.cardSupportByNumber)) {
    if (
      names.has(entry.name) ||
      entry.traits.some((trait) => traits.has(trait))
    ) {
      count += entry.quantity
      if (!Number.isSafeInteger(count)) {
        throw new RangeError('Matching support count exceeds a safe integer.')
      }
    }
  }

  return count
}
