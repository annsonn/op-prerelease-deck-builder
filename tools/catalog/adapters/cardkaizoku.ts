import { z } from 'zod'

import { readVerifiedCardKaizokuCache } from '../cardkaizoku-snapshot.js'
import { sourceCardSchema, type SourceCard } from '../model.js'
import type { CatalogSourceAdapter } from '../source-adapter.js'

const printedCardIdPattern = /^[A-Z]{1,5}\d{0,2}-\d{3}$/
const setMembershipPattern = /^(?:EB|OP|PRB|ST)\d{2}$/

const candidateRowSchema = z.looseObject({
  cardNumber: z.string(),
})

const productSchema = z.looseObject({
  cardSet: z.string().optional(),
})

const cardKaizokuRowSchema = z.looseObject({
  cardNumber: z.string(),
  cardName: z.string(),
  cost: z.string(),
  attribute: z.string(),
  cardType: z.string(),
  power: z.string(),
  counter: z.string(),
  color: z.string(),
  feature: z.string(),
  text: z.string(),
  rarity: z.string(),
  trigger: z.string(),
  cardSet: z.string(),
  products: z.array(productSchema).optional(),
})

function normalizedMembership(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  return setMembershipPattern.test(normalized) ? normalized : null
}

export function inferCardKaizokuMemberships(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return []
  }

  const record = value as Record<string, unknown>
  const memberships = new Set<string>()
  const topLevelMembership = normalizedMembership(record.cardSet)

  if (topLevelMembership !== null) {
    memberships.add(topLevelMembership)
  }

  if (Array.isArray(record.products)) {
    for (const product of record.products) {
      if (typeof product !== 'object' || product === null || Array.isArray(product)) {
        continue
      }

      const membership = normalizedMembership(
        (product as Record<string, unknown>).cardSet,
      )
      if (membership !== null) {
        memberships.add(membership)
      }
    }
  }

  return Array.from(memberships).sort()
}

function parseNullableInteger(
  cardNumber: string,
  field: string,
  value: string,
): number | null {
  const normalized = value.trim()
  if (normalized === '' || normalized === '-') return null
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${cardNumber} has invalid ${field} value "${value}"`,
    )
  }
  return Number(normalized)
}

function splitSlashSeparated(value: string): string[] {
  return value
    .split('/')
    .map((token) => token.trim())
    .filter((token) => token !== '' && token !== '-')
}

function normalizedOptionalText(value: string): string {
  const normalized = value.trim()
  return normalized === '-' ? '' : normalized
}

export function adaptCardKaizokuRows(
  value: unknown,
  targetSet: string,
): SourceCard[] {
  const rows = z.array(z.unknown()).parse(value)
  const normalizedTargetSet = targetSet.trim().toUpperCase()
  const cards: SourceCard[] = []

  rows.forEach((valueRow, ordinal) => {
    const candidate = candidateRowSchema.safeParse(valueRow)
    if (
      !candidate.success ||
      !printedCardIdPattern.test(candidate.data.cardNumber)
    ) {
      return
    }

    const setMembership = inferCardKaizokuMemberships(valueRow)
    if (!setMembership.includes(normalizedTargetSet)) {
      return
    }

    const row = cardKaizokuRowSchema.parse(valueRow)
    const parsedCost = parseNullableInteger(
      row.cardNumber,
      'cost',
      row.cost,
    )
    const isLeader = row.cardType.trim().toUpperCase() === 'LEADER'

    cards.push(
      sourceCardSchema.parse({
        sourceRecordId: `${row.cardNumber}:${ordinal}`,
        cardNumber: row.cardNumber,
        name: row.cardName.trim(),
        rarity: row.rarity.trim() || 'UNKNOWN',
        cardType: row.cardType.trim().toUpperCase(),
        colors: splitSlashSeparated(row.color),
        cost: isLeader ? null : parsedCost,
        life: isLeader ? parsedCost : null,
        power: parseNullableInteger(row.cardNumber, 'power', row.power),
        counter: parseNullableInteger(row.cardNumber, 'counter', row.counter),
        attribute: normalizedOptionalText(row.attribute),
        traits: splitSlashSeparated(row.feature),
        effect: normalizedOptionalText(row.text),
        trigger: normalizedOptionalText(row.trigger),
        setMembership,
      }),
    )
  })

  return cards
}

export class CardKaizokuJsonAdapter implements CatalogSourceAdapter {
  constructor(
    private readonly source: string,
    private readonly cachePath: string,
    private readonly sourceSha256: string,
    private readonly targetSet: string,
  ) {}

  async load(): Promise<SourceCard[]> {
    const snapshot = await readVerifiedCardKaizokuCache({
      source: this.source,
      cachePath: this.cachePath,
      sourceSha256: this.sourceSha256,
    })

    return adaptCardKaizokuRows(snapshot.value, this.targetSet)
  }
}
