import { describe, expect, it } from 'vitest'

import {
  CARD_IMAGE_PROVIDER_NAME,
  CARD_IMAGE_PROVIDER_URL,
  resolveCardImageUrl,
} from './card-image-url.js'

const op16SourceContract = [
  'OP16-001',
  'OP16-119',
  'EB04-054',
  'OP10-045',
  'OP11-067',
  'OP14-029',
  'OP14-084',
  'ST15-005',
] as const

describe('resolveCardImageUrl', () => {
  it.each([
    ['OP16-005', 'OP16'],
    ['OP17-005', 'OP17'],
    ['ST15-005', 'ST15'],
    ['EB03-004', 'EB03'],
    ['PRB01-001', 'PRB01'],
  ])('derives the Limitless English image URL for %s', (cardNumber, prefix) => {
    expect(resolveCardImageUrl(cardNumber)).toBe(
      `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${prefix}/${cardNumber}_EN.webp`,
    )
  })

  it.each(op16SourceContract)(
    'keeps the OP16 source contract deterministic for %s',
    (cardNumber) => {
      const [prefix] = cardNumber.split('-')
      expect(resolveCardImageUrl(cardNumber)).toBe(
        `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/one-piece/${prefix}/${cardNumber}_EN.webp`,
      )
    },
  )

  it.each(['op17-005', 'OP17-5', 'OP17-0005', 'OP17/005', ''])(
    'rejects malformed printed card ID %j',
    (cardNumber) => {
      expect(() => resolveCardImageUrl(cardNumber)).toThrow(
        `Invalid printed card ID for image: ${cardNumber}`,
      )
    },
  )

  it('exposes the provider attribution beside the resolver', () => {
    expect(CARD_IMAGE_PROVIDER_NAME).toBe('Limitless TCG')
    expect(CARD_IMAGE_PROVIDER_URL).toBe(
      'https://onepiece.limitlesstcg.com/cards',
    )
  })
})
