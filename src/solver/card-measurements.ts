import type { CardFeatures } from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'

/**
 * Returns whether a card is a material play for turn-order curve analysis.
 * Printed counter and brick status alone do not make a card an important play.
 */
export function isImportantPlay(
  card: PlayableCard,
  features: CardFeatures,
): boolean {
  if (card.cost === null || card.cost < 1) return false

  const flags = features.rainbowUsableFlags
  return (
    flags.vanillaLike ||
    flags.blocker ||
    flags.draw ||
    flags.removal ||
    flags.boss ||
    flags.rush ||
    flags.banish
  )
}
