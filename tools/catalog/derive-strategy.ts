import {
  strategySuggestionSchema,
  type PlayableCard,
  type StrategySuggestion,
  type SuggestedRole,
} from '../../shared/catalog.js'
import { classifyCardFeatures } from '../../shared/card-features.js'

export type { StrategySuggestion, SuggestedRole }

export function deriveStrategy(card: PlayableCard): StrategySuggestion {
  const roles = new Set<SuggestedRole>()
  const rulesText = `${card.effect}\n${card.trigger}`

  if (/\[Blocker\]/i.test(rulesText)) {
    roles.add('blocker')
  }

  if (card.counter === 2000) {
    roles.add('twoKCounter')
  }

  if (/\bDraw \d+/i.test(rulesText)) {
    roles.add('draw')
  }

  const suggestsRemoval = [
    /\bK\.O\.\s+up to\b[^.\n]*\bopponent\b/i,
    /\breturn up to\b[^.\n]*\bopponent\b[^.\n]*\bhand\b/i,
    /\bplace up to\b[^.\n]*\bopponent\b[^.\n]*\bbottom\b/i,
  ].some((pattern) => pattern.test(rulesText))

  if (suggestsRemoval) {
    roles.add('removal')
  }

  if (
    card.cardType === 'CHARACTER' &&
    card.power !== null &&
    card.power >= 5000 &&
    card.cost !== null &&
    card.cost <= 5
  ) {
    roles.add('pressure')
  }

  if (
    card.cardType === 'CHARACTER' &&
    card.cost !== null &&
    card.cost >= 8 &&
    card.power !== null &&
    card.power >= 9000
  ) {
    roles.add('boss')
  }

  return strategySuggestionSchema.parse({
    cardNumber: card.cardNumber,
    roles: Array.from(roles).sort(),
    features: classifyCardFeatures(card),
    reviewStatus: 'suggested',
  })
}
