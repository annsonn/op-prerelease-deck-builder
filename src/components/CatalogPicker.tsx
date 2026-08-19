import type { RuntimeCatalogIndexEntry } from '../../shared/catalog-index.js'

interface CatalogPickerProps {
  entries: readonly RuntimeCatalogIndexEntry[]
  selectedSetId: string
  onSelect: (setId: string) => void
}

export function CatalogPicker({
  entries,
  selectedSetId,
  onSelect,
}: CatalogPickerProps) {
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
        {entries.map((entry) => (
          <option key={entry.setId} value={entry.setId}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  )
}
