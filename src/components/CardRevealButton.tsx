import type { PlayableCard } from '../../shared/catalog.js'

interface CardRevealButtonProps {
  readonly card: PlayableCard
  readonly onReveal: (card: PlayableCard) => void
}

export function CardRevealButton({
  card,
  onReveal,
}: CardRevealButtonProps) {
  return (
    <button
      type="button"
      className="card-reveal-button"
      aria-label={`View ${card.name}, ${card.cardNumber}`}
      aria-haspopup="dialog"
      onClick={() => onReveal(card)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        focusable="false"
      >
        <path d="M2.4 12s3.5-6 9.6-6 9.6 6 9.6 6-3.5 6-9.6 6-9.6-6-9.6-6Z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    </button>
  )
}
