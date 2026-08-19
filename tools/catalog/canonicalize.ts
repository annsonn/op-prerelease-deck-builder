import {
  playableCardSchema,
  type PlayableCard,
  type SourceCard,
} from './model.js'

const baseRarities = new Set(['L', 'C', 'UC', 'R', 'SR', 'SEC'])

function canonicalRarity(variants: SourceCard[], cardNumber: string): string {
  const rarities = Array.from(
    new Set(variants.map((variant) => variant.rarity)),
  ).sort()
  const distinctBaseRarities = rarities.filter((rarity) =>
    baseRarities.has(rarity),
  )

  if (distinctBaseRarities.length > 1) {
    throw new Error(
      `Conflicting base rarities for ${cardNumber}: ${distinctBaseRarities.join(', ')}`,
    )
  }

  const baseRarity = distinctBaseRarities[0]
  if (baseRarity !== undefined) {
    return baseRarity
  }

  if (rarities.length > 1) {
    throw new Error(
      `Ambiguous non-base rarities for ${cardNumber}: ${rarities.join(', ')}`,
    )
  }

  const rarity = rarities[0]
  if (rarity === undefined) {
    throw new Error(`No rarity found for ${cardNumber}`)
  }

  return rarity
}

function gameplayFingerprint(card: SourceCard): string {
  return JSON.stringify({
    cardNumber: card.cardNumber,
    name: card.name,
    cardType: card.cardType,
    colors: card.colors,
    cost: card.cost,
    life: card.life,
    power: card.power,
    counter: card.counter,
    attribute: card.attribute,
    traits: card.traits,
    effect: card.effect,
    trigger: card.trigger,
  })
}

export function canonicalize(
  sourceCards: SourceCard[],
  setId: string,
): PlayableCard[] {
  const variantsByCardNumber = new Map<string, SourceCard[]>()

  for (const sourceCard of sourceCards) {
    const variants = variantsByCardNumber.get(sourceCard.cardNumber) ?? []
    variants.push(sourceCard)
    variantsByCardNumber.set(sourceCard.cardNumber, variants)
  }

  const normalCardPattern = new RegExp(`^${setId.toUpperCase()}-(\\d{3})$`)

  return Array.from(variantsByCardNumber, ([cardNumber, variants]) => {
    const firstVariant = variants[0]

    if (firstVariant === undefined) {
      throw new Error(`No variants found for ${cardNumber}`)
    }

    const expectedFingerprint = gameplayFingerprint(firstVariant)
    if (
      variants.some(
        (variant) => gameplayFingerprint(variant) !== expectedFingerprint,
      )
    ) {
      throw new Error(`Conflicting playable data for ${cardNumber}`)
    }

    const normalCardMatch = normalCardPattern.exec(cardNumber)
    const rarity = canonicalRarity(variants, cardNumber)

    return playableCardSchema.parse({
      cardNumber: firstVariant.cardNumber,
      name: firstVariant.name,
      rarity,
      cardType: firstVariant.cardType,
      colors: firstVariant.colors,
      cost: firstVariant.cost,
      life: firstVariant.life,
      power: firstVariant.power,
      counter: firstVariant.counter,
      attribute: firstVariant.attribute,
      traits: firstVariant.traits,
      effect: firstVariant.effect,
      trigger: firstVariant.trigger,
      setMembership: Array.from(
        new Set(variants.flatMap((variant) => variant.setMembership)),
      ).sort(),
      variantsCollapsed: variants.length,
      entryShortcut: normalCardMatch?.[1] ?? null,
      isSpecialReprint: normalCardMatch === null,
    })
  }).sort((left, right) => left.cardNumber.localeCompare(right.cardNumber))
}
