import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeCatalogIndexEntry } from '../../shared/catalog-index.js'
import { CatalogPicker } from './CatalogPicker.js'

const sourceSha256 = 'a'.repeat(64)

function entry(setId: string): RuntimeCatalogIndexEntry {
  return {
    setId,
    label: setId,
    manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
    sourceSha256,
    readiness: 'needs-review',
  }
}

function optionValues(): string[] {
  return screen
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value)
}

describe('CatalogPicker', () => {
  it('orders OP sets newest first without mutating the supplied entries', () => {
    const entries = [
      entry('OP02'),
      entry('OP17'),
      entry('OP01'),
      entry('OP10'),
      entry('OP16'),
    ]
    const originalOrder = entries.map(({ setId }) => setId)
    Object.freeze(entries)

    render(
      <CatalogPicker
        entries={entries}
        selectedSetId="OP10"
        onSelect={vi.fn()}
      />,
    )

    const valuesAfterPlaceholder = optionValues().slice(1)
    expect(valuesAfterPlaceholder).toEqual([
      'OP17',
      'OP16',
      'OP10',
      'OP02',
      'OP01',
    ])
    expect(valuesAfterPlaceholder[0]).toBe('OP17')
    expect(valuesAfterPlaceholder.at(-1)).toBe('OP01')
    expect(entries.map(({ setId }) => setId)).toEqual(originalOrder)
  })

  it('places valid OP IDs before unexpected IDs and orders fallbacks deterministically', () => {
    const entries = [
      entry('Z-SET'),
      entry('OP02'),
      entry('A-SET'),
      entry('OP17'),
    ]

    render(
      <CatalogPicker
        entries={entries}
        selectedSetId=""
        onSelect={vi.fn()}
      />,
    )

    expect(optionValues().slice(1)).toEqual([
      'OP17',
      'OP02',
      'A-SET',
      'Z-SET',
    ])
  })

  it('preserves the controlled value and reports the selected set', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <CatalogPicker
        entries={[entry('OP01'), entry('OP17')]}
        selectedSetId="OP01"
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Card set' })).toHaveValue(
      'OP01',
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Card set' }),
      'OP17',
    )

    expect(onSelect).toHaveBeenCalledWith('OP17')
  })
})
