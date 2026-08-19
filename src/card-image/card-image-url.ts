import { printedCardIdSchema } from '../../shared/catalog.js'

const CARD_IMAGE_ORIGIN =
  'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com'

export const CARD_IMAGE_PROVIDER_NAME = 'Limitless TCG'
export const CARD_IMAGE_PROVIDER_URL =
  'https://onepiece.limitlesstcg.com/cards'

export function resolveCardImageUrl(cardNumber: string): string {
  const parsed = printedCardIdSchema.safeParse(cardNumber)
  if (!parsed.success) {
    throw new Error(`Invalid printed card ID for image: ${cardNumber}`)
  }

  const [prefix] = parsed.data.split('-')
  return `${CARD_IMAGE_ORIGIN}/one-piece/${prefix}/${parsed.data}_EN.webp`
}
