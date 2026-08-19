import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'

export type PoolEvent =
  | { type: 'added'; cardNumber: string }
  | { type: 'batch-added'; cardNumbers: readonly string[] }
  | { type: 'batch-replaced'; cardNumbers: readonly string[] }
  | { type: 'quantity-set'; cardNumber: string; quantity: number }

export interface PoolState {
  events: readonly PoolEvent[]
  counts: Readonly<Record<string, number>>
  recentCardNumbers: readonly string[]
}

export type EntryResolution =
  | { ok: true; card: PlayableCard }
  | {
      ok: false
      reason:
        | 'empty'
        | 'invalid-format'
        | 'not-found'
        | 'special-requires-full-id'
      message: string
    }

const numericSuffixPattern = /^\d{1,3}$/
const printedCardIdPattern = /^[A-Z]{1,5}\d{0,2}-\d{3}$/

function failure(
  reason: Exclude<EntryResolution, { ok: true }>['reason'],
  message: string,
): EntryResolution {
  return { ok: false, reason, message }
}

export function resolvePoolEntry(
  input: string,
  catalog: RuntimeCatalog,
): EntryResolution {
  const normalized = input.trim().toUpperCase()
  if (normalized.length === 0) {
    return failure('empty', 'Enter a card number.')
  }

  if (numericSuffixPattern.test(normalized)) {
    const shortcut = normalized.padStart(3, '0')
    const normalCard = catalog.normalCardsByShortcut.get(shortcut)
    if (normalCard !== undefined) return { ok: true, card: normalCard }

    const specialCard = catalog.specialCards.find(({ cardNumber }) =>
      cardNumber.endsWith(`-${shortcut}`),
    )
    if (specialCard !== undefined) {
      return failure(
        'special-requires-full-id',
        `${shortcut} is a special reprint. Enter its full printed ID.`,
      )
    }
    return failure(
      'not-found',
      `No normally numbered card ${shortcut} exists in ${catalog.manifest.setId}.`,
    )
  }

  if (!printedCardIdPattern.test(normalized)) {
    return failure(
      'invalid-format',
      'Enter one to three digits or a full printed card ID.',
    )
  }

  const card = catalog.cardsByNumber.get(normalized)
  return card === undefined
    ? failure(
        'not-found',
        `${normalized} is not available in ${catalog.manifest.setId}.`,
      )
    : { ok: true, card }
}

function copyEvent(event: PoolEvent): PoolEvent {
  if (event.type === 'batch-added' || event.type === 'batch-replaced') {
    return Object.freeze({
      ...event,
      cardNumbers: Object.freeze([...event.cardNumbers]),
    })
  }
  return Object.freeze({ ...event })
}

function project(events: readonly PoolEvent[]): PoolState {
  const immutableEvents = events.map(copyEvent)
  const counts: Record<string, number> = {}
  const recentCardNumbers: string[] = []

  for (const event of immutableEvents) {
    if (event.type === 'added') {
      counts[event.cardNumber] = (counts[event.cardNumber] ?? 0) + 1
      recentCardNumbers.push(event.cardNumber)
      continue
    }

    if (event.type === 'batch-added') {
      for (const cardNumber of event.cardNumbers) {
        counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
        recentCardNumbers.push(cardNumber)
      }
      continue
    }

    if (event.type === 'batch-replaced') {
      for (const cardNumber of Object.keys(counts)) delete counts[cardNumber]
      recentCardNumbers.length = 0
      for (const cardNumber of event.cardNumbers) {
        counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
        recentCardNumbers.push(cardNumber)
      }
      continue
    }

    if (event.quantity === 0) {
      delete counts[event.cardNumber]
    } else {
      counts[event.cardNumber] = event.quantity
    }
  }

  return Object.freeze({
    events: Object.freeze(immutableEvents),
    counts: Object.freeze(counts),
    recentCardNumbers: Object.freeze(recentCardNumbers.slice(-10)),
  })
}

function normalizeCardNumber(cardNumber: string): string {
  return cardNumber.trim().toUpperCase()
}

export function appendCard(
  state: PoolState,
  cardNumber: string,
): PoolState {
  return project([
    ...state.events,
    { type: 'added', cardNumber: normalizeCardNumber(cardNumber) },
  ])
}

export function appendCards(
  state: PoolState,
  cardNumbers: readonly string[],
): PoolState {
  if (cardNumbers.length === 0) {
    throw new RangeError('Pool batch must include at least one card.')
  }
  return project([
    ...state.events,
    {
      type: 'batch-added',
      cardNumbers: cardNumbers.map(normalizeCardNumber),
    },
  ])
}

export function replaceCards(
  state: PoolState,
  cardNumbers: readonly string[],
): PoolState {
  if (cardNumbers.length === 0) {
    throw new RangeError('Pool replacement must include at least one card.')
  }
  return project([
    ...state.events,
    {
      type: 'batch-replaced',
      cardNumbers: cardNumbers.map(normalizeCardNumber),
    },
  ])
}

export function setQuantity(
  state: PoolState,
  cardNumber: string,
  quantity: number,
): PoolState {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError('Pool quantity must be a non-negative integer.')
  }
  return project([
    ...state.events,
    {
      type: 'quantity-set',
      cardNumber: normalizeCardNumber(cardNumber),
      quantity,
    },
  ])
}

export function undoLast(state: PoolState): PoolState {
  return project(state.events.slice(0, -1))
}

export function eligiblePoolCount(
  state: PoolState,
  catalog: RuntimeCatalog,
): number {
  return Object.entries(state.counts).reduce((total, [cardNumber, quantity]) => {
    const card = catalog.cardsByNumber.get(cardNumber)
    return card === undefined ||
      card.cardType === 'LEADER' ||
      card.cardType === 'DON'
      ? total
      : total + quantity
  }, 0)
}
