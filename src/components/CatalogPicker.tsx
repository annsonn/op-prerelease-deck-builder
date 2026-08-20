import type { RuntimeCatalogIndexEntry } from '../../shared/catalog-index.js'

interface CatalogPickerProps {
  entries: readonly RuntimeCatalogIndexEntry[]
  selectedSetId: string
  onSelect: (setId: string) => void
}

const opSetIdPattern = /^OP(\d{2})$/

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareCatalogEntries(
  left: RuntimeCatalogIndexEntry,
  right: RuntimeCatalogIndexEntry,
): number {
  const leftMatch = opSetIdPattern.exec(left.setId)
  const rightMatch = opSetIdPattern.exec(right.setId)

  if (leftMatch !== null && rightMatch !== null) {
    return Number(rightMatch[1]) - Number(leftMatch[1])
  }
  if (leftMatch !== null) return -1
  if (rightMatch !== null) return 1
  return compareText(left.setId, right.setId)
}

export function CatalogPicker({
  entries,
  selectedSetId,
  onSelect,
}: CatalogPickerProps) {
  const orderedEntries = [...entries].sort(compareCatalogEntries)

  return (
    <label className="field">
      <span>Card set</span>
      <select
        value={selectedSetId}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        <option value="" disabled>
          Select an OP set
        </option>
        {orderedEntries.map((entry) => (
          <option key={entry.setId} value={entry.setId}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  )
}
