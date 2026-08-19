import { describe, expect, it } from 'vitest'

import { resolveCardImageUrl } from './card-image-url.js'

describe('resolveCardImageUrl', () => {
  it.each([
    ['OP17-005', 'OP17'],
    ['ST15-005', 'ST15'],
    ['EB03-004', 'EB03'],
    ['PRB01-001', 'PRB01'],
  ])('derives the English image URL for %s', (cardNumber, prefix) => {
    expect(resolveCardImageUrl(cardNumber)).toBe(
      `https://cdn.cardkaizoku.com/cards_en/${prefix}/${cardNumber}.png`,
    )
  })

  it.each(['op17-005', 'OP17-5', 'OP17-0005', 'OP17/005', ''])(
    'rejects malformed printed card ID %j',
    (cardNumber) => {
      expect(() => resolveCardImageUrl(cardNumber)).toThrow(
        `Invalid printed card ID for image: ${cardNumber}`,
      )
    },
  )
})
