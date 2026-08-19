import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'

export type SimulatedRarity = 'C' | 'UC' | 'L' | 'R' | 'SR' | 'SEC'
export type TestPoolMode = 'development' | 'tournament'

export const testPoolPackCounts = Object.freeze({
  development: 5,
  tournament: 6,
})

export interface SimulatedBoosterBox {
  packs: readonly (readonly string[])[]
  rarityCounts: Readonly<Record<SimulatedRarity, number>>
  cardRarities: Readonly<Record<string, SimulatedRarity>>
  parallelHitCardNumbers: readonly string[]
  excludedUnknownRarityCount: number
}

export interface TestPoolGeneration {
  cardNumbers: readonly string[]
  rarityCounts: Readonly<Record<SimulatedRarity, number>>
  selectedPackIndexes: readonly number[]
  excludedUnknownRarityCount: number
}

const PACK_COUNT = 24
const CARDS_PER_PACK = 12
const simulatedRarities = Object.freeze([
  'C',
  'UC',
  'L',
  'R',
  'SR',
  'SEC',
] as const)
const simulatedRaritySet = new Set<string>(simulatedRarities)

function isSimulatedRarity(rarity: string): rarity is SimulatedRarity {
  return simulatedRaritySet.has(rarity)
}

function validateTestPoolMode(mode: TestPoolMode): void {
  if (!Object.hasOwn(testPoolPackCounts, mode)) {
    throw new Error(
      `Cannot draw a test pool: mode must be development or tournament; received ${String(mode)}`,
    )
  }
}

function emptyRarityCounts(): Record<SimulatedRarity, number> {
  return { C: 0, UC: 0, L: 0, R: 0, SR: 0, SEC: 0 }
}

function freezeRarityCounts(
  counts: Record<SimulatedRarity, number>,
): Readonly<Record<SimulatedRarity, number>> {
  return Object.freeze({ ...counts })
}

function cryptoRandom(): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      'A random source is required because crypto.getRandomValues is unavailable',
    )
  }
  const value = new Uint32Array(1)
  globalThis.crypto.getRandomValues(value)
  return value[0]! / 0x1_0000_0000
}

function validatedRandom(random: () => number): () => number {
  let callCount = 0
  return () => {
    callCount += 1
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error(
        `Random source call ${callCount} must return a finite value in [0, 1); received ${String(value)}`,
      )
    }
    return value
  }
}

function sample<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const value = result[index]!
    result[index] = result[swapIndex]!
    result[swapIndex] = value
  }
  return result
}

function parallelWeight(card: PlayableCard): number {
  const variantsCollapsed = card.variantsCollapsed as number | undefined
  return Number.isFinite(variantsCollapsed) && variantsCollapsed! > 0
    ? variantsCollapsed!
    : 1
}

function sampleWeightedCard(
  cards: readonly PlayableCard[],
  random: () => number,
): PlayableCard {
  const totalWeight = cards.reduce(
    (sum, card) => sum + parallelWeight(card),
    0,
  )
  const target = random() * totalWeight
  let accumulatedWeight = 0
  for (const card of cards) {
    accumulatedWeight += parallelWeight(card)
    if (target < accumulatedWeight) return card
  }
  return cards[cards.length - 1]!
}

function countRarities(
  cardNumbers: readonly string[],
  cardRarities: Readonly<Record<string, SimulatedRarity>>,
): Readonly<Record<SimulatedRarity, number>> {
  const counts = emptyRarityCounts()
  for (const cardNumber of cardNumbers) {
    const rarity = cardRarities[cardNumber]
    if (!Object.hasOwn(cardRarities, cardNumber) || !rarity) {
      throw new Error(
        `Cannot count simulated rarity for card ${cardNumber}; the box metadata is inconsistent`,
      )
    }
    counts[rarity] += 1
  }
  return freezeRarityCounts(counts)
}

function requirePool(
  setId: string,
  rarity: SimulatedRarity,
  cards: readonly PlayableCard[],
): void {
  if (cards.length === 0) {
    throw new Error(
      `Cannot generate a virtual booster box for ${setId}: normal ${rarity} pool is empty`,
    )
  }
}

export function generateVirtualBoosterBox(
  catalog: RuntimeCatalog,
  random: () => number = cryptoRandom,
): SimulatedBoosterBox {
  const nextRandom = validatedRandom(random)

  // These are intentionally the first three random calls so a seed fully
  // determines the box configuration before any card or pack sampling.
  const superRareCount = nextRandom() < 0.5 ? 7 : 8
  const includesSecretRare = nextRandom() < 2 / 3
  const parallelHitCount = nextRandom() < 0.5 ? 2 : 3

  const normalCards = catalog.cards.filter(
    (card) => card.cardType !== 'DON' && !card.isSpecialReprint,
  )
  const rarityPools = Object.fromEntries(
    simulatedRarities.map((rarity) => [
      rarity,
      normalCards.filter((card) => card.rarity === rarity),
    ]),
  ) as Record<SimulatedRarity, PlayableCard[]>

  for (const rarity of ['C', 'UC', 'L', 'R', 'SR'] as const) {
    requirePool(catalog.manifest.setId, rarity, rarityPools[rarity])
  }
  if (includesSecretRare) {
    requirePool(catalog.manifest.setId, 'SEC', rarityPools.SEC)
  }

  const leaders = rarityPools.L
  if (leaders.length > PACK_COUNT) {
    throw new Error(
      `Cannot place ${leaders.length} leaders exactly once across ${PACK_COUNT} packs`,
    )
  }

  const replacementCount =
    leaders.length +
    superRareCount +
    (includesSecretRare ? 1 : 0) +
    parallelHitCount
  if (replacementCount > PACK_COUNT) {
    throw new Error(
      `Cannot place ${leaders.length} leaders and ${replacementCount - leaders.length} rare hits in distinct packs; only ${PACK_COUNT} packs are available`,
    )
  }

  const parallelCandidates = catalog.cards.filter(
    (card) =>
      card.cardType !== 'DON' &&
      isSimulatedRarity(card.rarity) &&
      (card.isSpecialReprint || ['R', 'SR', 'SEC'].includes(card.rarity)),
  )
  if (parallelCandidates.length === 0) {
    throw new Error(
      'Cannot generate parallel hits: no special reprints or normal R, SR, or SEC cards are available',
    )
  }

  const packs = Array.from({ length: PACK_COUNT }, () => [
    ...Array.from({ length: 7 }, () =>
      sample(rarityPools.C, nextRandom),
    ),
    ...Array.from({ length: 3 }, () =>
      sample(rarityPools.UC, nextRandom),
    ),
    ...Array.from({ length: 2 }, () => sample(rarityPools.R, nextRandom)),
  ])
  const replacementPackIndexes = shuffled(
    Array.from({ length: PACK_COUNT }, (_, index) => index),
    nextRandom,
  )
  let replacementIndex = 0

  for (const leader of leaders) {
    packs[replacementPackIndexes[replacementIndex++]!]![8] = leader
  }
  for (let index = 0; index < superRareCount; index += 1) {
    packs[replacementPackIndexes[replacementIndex++]!]![11] = sample(
      rarityPools.SR,
      nextRandom,
    )
  }
  if (includesSecretRare) {
    packs[replacementPackIndexes[replacementIndex++]!]![11] = sample(
      rarityPools.SEC,
      nextRandom,
    )
  }

  const parallelHits: PlayableCard[] = []
  for (let index = 0; index < parallelHitCount; index += 1) {
    const hit = sampleWeightedCard(parallelCandidates, nextRandom)
    parallelHits.push(hit)
    packs[replacementPackIndexes[replacementIndex++]!]![11] = hit
  }

  const cardRarities = Object.freeze(
    Object.fromEntries(
      catalog.cards.flatMap((card) =>
        card.cardType !== 'DON' && isSimulatedRarity(card.rarity)
          ? [[card.cardNumber, card.rarity] as const]
          : [],
      ),
    ) as Record<string, SimulatedRarity>,
  )
  const frozenPacks = Object.freeze(
    packs.map((pack) =>
      Object.freeze(pack.map(({ cardNumber }) => cardNumber)),
    ),
  )
  const box = Object.freeze({
    packs: frozenPacks,
    rarityCounts: countRarities(frozenPacks.flat(), cardRarities),
    cardRarities,
    parallelHitCardNumbers: Object.freeze(
      parallelHits.map(({ cardNumber }) => cardNumber),
    ),
    excludedUnknownRarityCount: catalog.cards.filter(
      (card) => card.cardType !== 'DON' && !isSimulatedRarity(card.rarity),
    ).length,
  })
  return box
}

function validateBoxShape(box: SimulatedBoosterBox): void {
  if (!box || !Array.isArray(box.packs) || box.packs.length !== PACK_COUNT) {
    throw new Error(
      `Cannot draw a test pool: box must contain exactly ${PACK_COUNT} packs`,
    )
  }
  if (
    !box.cardRarities ||
    typeof box.cardRarities !== 'object' ||
    Array.isArray(box.cardRarities)
  ) {
    throw new Error(
      'Cannot draw a test pool: box.cardRarities must be a card-number rarity record',
    )
  }
  for (const [index, pack] of box.packs.entries()) {
    if (!Array.isArray(pack) || pack.length !== CARDS_PER_PACK) {
      throw new Error(
        `Cannot draw a test pool: pack ${index} must contain exactly ${CARDS_PER_PACK} cards`,
      )
    }
    for (const [entryIndex, cardNumber] of pack.entries()) {
      if (typeof cardNumber !== 'string') {
        throw new Error(
          `Cannot draw a test pool: pack ${index} entry ${entryIndex} must be a string card number; received ${String(cardNumber)}`,
        )
      }
      if (!Object.hasOwn(box.cardRarities, cardNumber)) {
        throw new Error(
          `Cannot draw a test pool: pack ${index} entry ${entryIndex} card ${cardNumber} is absent from cardRarities`,
        )
      }
      if (!isSimulatedRarity(box.cardRarities[cardNumber]!)) {
        throw new Error(
          `Cannot draw a test pool: cardRarities entry for ${cardNumber} must be C, UC, L, R, SR, or SEC`,
        )
      }
    }
  }
}

export function drawTestPool(
  box: SimulatedBoosterBox,
  random: () => number = cryptoRandom,
  mode: TestPoolMode = 'development',
): TestPoolGeneration {
  validateTestPoolMode(mode)
  validateBoxShape(box)
  const nextRandom = validatedRandom(random)
  const selectedPackIndexes = shuffled(
    Array.from({ length: PACK_COUNT }, (_, index) => index),
    nextRandom,
  ).slice(0, testPoolPackCounts[mode])
  const cardNumbers = selectedPackIndexes.flatMap((index) => box.packs[index]!)
  return Object.freeze({
    cardNumbers: Object.freeze([...cardNumbers]),
    rarityCounts: countRarities(cardNumbers, box.cardRarities),
    selectedPackIndexes: Object.freeze([...selectedPackIndexes]),
    excludedUnknownRarityCount: box.excludedUnknownRarityCount,
  })
}

export function generateTestPool(
  catalog: RuntimeCatalog,
  random: () => number = cryptoRandom,
  mode: TestPoolMode = 'development',
): TestPoolGeneration {
  validateTestPoolMode(mode)
  const box = generateVirtualBoosterBox(catalog, random)
  return drawTestPool(box, random, mode)
}
