import { useRef, useState, type FormEvent } from 'react'

import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import { resolvePoolEntry } from '../pool/pool.js'

interface CardEntryProps {
  catalog: RuntimeCatalog
  onCard: (card: PlayableCard) => void
  onError: (message: string) => void
}

export function CardEntry({ catalog, onCard, onError }: CardEntryProps) {
  const [suffix, setSuffix] = useState('')
  const [fullId, setFullId] = useState('')
  const suffixInput = useRef<HTMLInputElement>(null)
  const fullIdInput = useRef<HTMLInputElement>(null)

  function submit(
    event: FormEvent<HTMLFormElement>,
    value: string,
    clear: () => void,
    focus: () => void,
  ): void {
    event.preventDefault()
    const resolution = resolvePoolEntry(value, catalog)
    if (!resolution.ok) {
      onError(resolution.message)
      return
    }
    onCard(resolution.card)
    clear()
    focus()
  }

  return (
    <div className="entry-grid">
      <form
        className="entry-form"
        onSubmit={(event) =>
          submit(event, suffix, () => setSuffix(''), () => suffixInput.current?.focus())
        }
      >
        <label className="field" htmlFor="card-suffix">
          <span>Card number (1–3 digits)</span>
          <input
            ref={suffixInput}
            id="card-suffix"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="e.g. 5"
            value={suffix}
            onChange={(event) => setSuffix(event.currentTarget.value)}
          />
        </label>
        <button type="submit" className="entry-button">
          Add number
        </button>
      </form>

      <div className="entry-divider" aria-hidden="true">
        <span>or</span>
      </div>

      <form
        className="entry-form"
        onSubmit={(event) =>
          submit(event, fullId, () => setFullId(''), () => fullIdInput.current?.focus())
        }
      >
        <label className="field" htmlFor="card-full-id">
          <span>Full printed card ID</span>
          <input
            ref={fullIdInput}
            id="card-full-id"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="e.g. ST21-014"
            value={fullId}
            onChange={(event) => setFullId(event.currentTarget.value)}
          />
        </label>
        <button type="submit" className="entry-button entry-button--secondary">
          Add full ID
        </button>
      </form>
    </div>
  )
}
