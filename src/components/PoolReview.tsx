import { useEffect, useState } from 'react'

import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import type { PoolState } from '../pool/pool.js'
import { CardRevealButton } from './CardRevealButton.js'
import { CardStats } from './CardStats.js'

interface PoolReviewProps {
  catalog: RuntimeCatalog
  pool: PoolState
  eligibleCount: number
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onQuantity: (cardNumber: string, quantity: number) => void
  onUndo: () => void
  onReveal: (card: PlayableCard) => void
}

interface QuantityEditorProps {
  cardNumber: string
  cardName: string
  quantity: number
  onQuantity: (cardNumber: string, quantity: number) => void
}

function QuantityEditor({
  cardNumber,
  cardName,
  quantity,
  onQuantity,
}: QuantityEditorProps) {
  const [draft, setDraft] = useState(String(quantity))

  useEffect(() => setDraft(String(quantity)), [quantity])

  function commit(): void {
    const next = Number(draft)
    if (draft === '' || !Number.isSafeInteger(next) || next < 0) {
      setDraft(String(quantity))
      return
    }
    if (next !== quantity) onQuantity(cardNumber, next)
  }

  return (
    <input
      className="quantity-input"
      aria-label={`Quantity for ${cardName} (${cardNumber})`}
      type="number"
      inputMode="numeric"
      min="0"
      step="1"
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function PoolReview({
  catalog,
  pool,
  eligibleCount,
  isOpen,
  onOpenChange,
  onQuantity,
  onUndo,
  onReveal,
}: PoolReviewProps) {
  const lines = Object.entries(pool.counts)
    .map(([cardNumber, quantity]) => ({
      card: catalog.cardsByNumber.get(cardNumber),
      cardNumber,
      quantity,
    }))
    .filter(
      (line): line is typeof line & { card: NonNullable<typeof line.card> } =>
        line.card !== undefined,
    )
    .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber))
  const totalCopies = Object.values(pool.counts).reduce(
    (total, quantity) => total + quantity,
    0,
  )
  const latestCardNumber = pool.recentCardNumbers.at(-1)
  const latestCard =
    latestCardNumber === undefined
      ? undefined
      : catalog.cardsByNumber.get(latestCardNumber)

  return (
    <details
      className="panel pool-review"
      aria-labelledby="pool-heading"
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (nextOpen !== isOpen) onOpenChange(nextOpen)
      }}
    >
      <summary className="pool-review__summary">
        <span className="step-number" aria-hidden="true">
          3
        </span>
        <span className="pool-review__summary-copy">
          <span
            id="pool-heading"
            className="pool-review__heading"
            role="heading"
            aria-level={2}
          >
            Review your pool
          </span>
          {' '}
          <span
            className="pool-totals"
            aria-label={`Pool totals: ${totalCopies} copies, ${eligibleCount} eligible`}
          >
            <span>{totalCopies} copies</span>
            <span>{eligibleCount} eligible</span>
          </span>
        </span>
        <span className="pool-review__indicator" aria-hidden="true">
          {isOpen ? '−' : '+'}
        </span>
      </summary>

      <div className="pool-review__content">
        <div className="pool-review__actions">
          <button
            type="button"
            className="text-button"
            disabled={pool.events.length === 0}
            onClick={onUndo}
          >
            Undo last change
          </button>
        </div>

        {latestCard !== undefined ? (
          <div className="latest-card" aria-label="Latest accepted card">
            <span className="latest-card__identity">
              <span>Latest accepted card</span>
              <strong>
                {latestCard.name} · {latestCard.cardNumber}
              </strong>
            </span>
            <CardRevealButton card={latestCard} onReveal={onReveal} />
          </div>
        ) : null}

        {lines.length === 0 ? (
          <div className="empty-state">
            <strong>No cards entered yet</strong>
            <span>Your accepted entries will appear here.</span>
          </div>
        ) : (
          <ul className="pool-list">
            {lines.map(({ card, cardNumber, quantity }) => (
              <li key={cardNumber} className="pool-line">
                <div className="card-identity">
                  <strong>{card.name}</strong>
                  <span>
                    {card.cardNumber} · {card.cardType}
                  </span>
                  <CardStats
                    cost={card.cost}
                    power={card.power}
                    counter={card.counter}
                  />
                </div>
                <div className="quantity-actions">
                  <QuantityEditor
                    cardNumber={cardNumber}
                    cardName={card.name}
                    quantity={quantity}
                    onQuantity={onQuantity}
                  />
                  <button
                    type="button"
                    className="remove-button"
                    aria-label={`Remove ${card.name} (${cardNumber})`}
                    onClick={() => onQuantity(cardNumber, 0)}
                  >
                    Remove
                  </button>
                </div>
                <CardRevealButton card={card} onReveal={onReveal} />
              </li>
            ))}
          </ul>
        )}

        {pool.recentCardNumbers.length > 0 ? (
          <details className="recent-entries">
            <summary>Recent accepted entries</summary>
            <ol>
              {pool.recentCardNumbers.map((cardNumber, index) => {
                const card = catalog.cardsByNumber.get(cardNumber)
                return (
                  <li key={`${cardNumber}-${index}`}>
                    {card?.name ?? cardNumber}
                  </li>
                )
              })}
            </ol>
          </details>
        ) : null}
      </div>
    </details>
  )
}
