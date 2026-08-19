import { printedCardIdSchema } from '../../shared/catalog.js'

const CARD_IMAGE_ORIGIN = 'https://cdn.cardkaizoku.com'

export function resolveCardImageUrl(cardNumber: string): string {
  const parsed = printedCardIdSchema.safeParse(cardNumber)
  if (!parsed.success) {
    throw new Error(`Invalid printed card ID for image: ${cardNumber}`)
  }

  const [prefix] = parsed.data.split('-')
  return `${CARD_IMAGE_ORIGIN}/cards_en/${prefix}/${parsed.data}.png`
}
