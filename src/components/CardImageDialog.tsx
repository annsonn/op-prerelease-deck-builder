import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { PlayableCard } from '../../shared/catalog.js'
import {
  CARD_IMAGE_PROVIDER_NAME,
  CARD_IMAGE_PROVIDER_URL,
  resolveCardImageUrl,
} from '../card-image/card-image-url.js'

interface CardImageDialogProps {
  readonly card: PlayableCard
  readonly onClose: () => void
}

type ImageStatus = 'loading' | 'loaded' | 'failed'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), a[href], input:not(:disabled)'

export function CardImageDialog({ card, onClose }: CardImageDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const originRef = useRef<HTMLElement | null>(null)
  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    originRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (originRef.current?.isConnected) {
        originRef.current.focus()
      }
    }
  }, [])

  useEffect(() => {
    setImageStatus('loading')
    setRetryKey(0)
  }, [card.cardNumber])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      const first = focusableElements.at(0)
      const last = focusableElements.at(-1)
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        const focusTarget = event.shiftKey ? last : first
        focusTarget.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="card-image-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="card-image-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="card-image-dialog__header">
          <span id={titleId}>
            <strong>{card.name}</strong>
            <small>, {card.cardNumber}</small>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className="card-image-dialog__close"
            aria-label="Close card image"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="card-image-dialog__media">
          {imageStatus === 'loading' ? (
            <p role="status">Loading card image…</p>
          ) : null}
          {imageStatus === 'failed' ? (
            <div className="card-image-dialog__error" role="alert">
              <strong>Card image unavailable</strong>
              <button
                type="button"
                className="card-image-dialog__retry"
                onClick={() => {
                  setImageStatus('loading')
                  setRetryKey((current) => current + 1)
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <img
              key={`${card.cardNumber}-${retryKey}`}
              className="card-image-dialog__image"
              src={resolveCardImageUrl(card.cardNumber)}
              alt={`${card.name} (${card.cardNumber}) card`}
              referrerPolicy="no-referrer"
              hidden={imageStatus !== 'loaded'}
              onLoad={() => setImageStatus('loaded')}
              onError={() => setImageStatus('failed')}
            />
          )}
        </div>
        <p className="card-image-dialog__note">
          Standard reference printing; alternate art may look different.
        </p>
        <a
          className="card-image-dialog__attribution"
          href={CARD_IMAGE_PROVIDER_URL}
          target="_blank"
          rel="noreferrer"
        >
          Images served by {CARD_IMAGE_PROVIDER_NAME}
        </a>
      </div>
    </div>,
    document.body,
  )
}
