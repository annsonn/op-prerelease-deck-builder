import { sourceCardSchema, type SourceCard } from './model.js'

const headerPattern =
  /^([A-Z]{1,5}\d{0,2}-\d{3})\s*\|\s*(.+?)\s*\|\s*(LEADER|CHARACTER|EVENT|STAGE)$/

const labels = [
  'Life',
  'Cost',
  'Attribute',
  'Power',
  'Counter',
  'Color',
  'Block',
  'Type',
  'Effect',
  'Trigger',
  'Card Set(s)',
] as const

type Label = (typeof labels)[number]

const canonicalLabels = new Map(
  labels.map((label) => [label.toUpperCase(), label] as const),
)
const ignoredLines = new Set(['TEXT VIEW', 'CARD VIEW'])

interface ParsedRecord {
  cardNumber: string
  rarity: string
  cardType: string
  name: string
  fields: Map<Label, string[]>
}

function fieldValue(record: ParsedRecord, label: Label): string {
  return (record.fields.get(label) ?? []).join('\n').trim()
}

function integerField(record: ParsedRecord, label: Label): number | null {
  const value = fieldValue(record, label)

  if (value === '' || value === '-') {
    return null
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${record.cardNumber} has invalid ${label} value "${value}"`,
    )
  }

  return Number(value)
}

function slashSeparatedField(record: ParsedRecord, label: Label): string[] {
  return fieldValue(record, label)
    .split('/')
    .map((value) => value.trim())
    .filter((value) => value !== '' && value !== '-')
}

function membershipField(record: ParsedRecord): string[] {
  return Array.from(
    fieldValue(record, 'Card Set(s)').matchAll(/\[([^\]]+)\]/g),
  ).flatMap((match) => {
    const token = match[1]?.trim() ?? ''

    if (
      token === 'javascript:void(0);' ||
      token.startsWith('/') ||
      /^[a-z][a-z\d+.-]*:\/\//i.test(token)
    ) {
      return []
    }

    if (!/^[A-Z]{2,5}-?\d{2}$/.test(token)) {
      throw new Error(
        `${record.cardNumber} has invalid Card Set(s) token "${token}"`,
      )
    }

    return [token.replace('-', '')]
  })
}

function collectRecords(text: string): ParsedRecord[] {
  const records: ParsedRecord[] = []
  let current: ParsedRecord | undefined
  let currentLabel: Label | undefined

  for (const line of text.split(/\r?\n/).map((value) => value.trim())) {
    const uppercaseLine = line.toUpperCase()

    if (line === '' || ignoredLines.has(uppercaseLine)) {
      continue
    }

    const header = headerPattern.exec(line)
    if (header !== null) {
      current = {
        cardNumber: header[1] ?? '',
        rarity: header[2] ?? '',
        cardType: header[3] ?? '',
        name: '',
        fields: new Map(),
      }
      records.push(current)
      currentLabel = undefined
      continue
    }

    if (current === undefined) {
      continue
    }

    const label = canonicalLabels.get(uppercaseLine)
    if (label !== undefined) {
      currentLabel = label
      if (!current.fields.has(currentLabel)) {
        current.fields.set(currentLabel, [])
      }
      continue
    }

    if (current.name === '' && currentLabel === undefined) {
      current.name = line
      continue
    }

    if (currentLabel !== undefined) {
      current.fields.get(currentLabel)?.push(line)
    }
  }

  return records
}

export function parseOfficialText(text: string, targetSet: string): SourceCard[] {
  const requestedMembership = targetSet.toUpperCase()
  const records = collectRecords(text)

  if (records.length === 0) {
    throw new Error(`No card records found for ${requestedMembership}`)
  }

  return records.map((record, ordinal) => {
    const setMembership = membershipField(record)

    if (!setMembership.includes(requestedMembership)) {
      throw new Error(
        `${record.cardNumber} does not declare membership in ${requestedMembership}`,
      )
    }

    return sourceCardSchema.parse({
      sourceRecordId: `${record.cardNumber}:${ordinal}`,
      cardNumber: record.cardNumber,
      name: record.name,
      rarity: record.rarity,
      cardType: record.cardType,
      colors: slashSeparatedField(record, 'Color'),
      cost: integerField(record, 'Cost'),
      life: integerField(record, 'Life'),
      power: integerField(record, 'Power'),
      counter: integerField(record, 'Counter'),
      attribute: fieldValue(record, 'Attribute'),
      traits: slashSeparatedField(record, 'Type'),
      effect: fieldValue(record, 'Effect'),
      trigger: fieldValue(record, 'Trigger') === '-' ? '' : fieldValue(record, 'Trigger'),
      setMembership,
    })
  })
}
