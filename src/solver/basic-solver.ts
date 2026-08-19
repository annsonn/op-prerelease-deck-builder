import type {
  PlayableCard,
  SuggestedRole,
} from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import { getStrategyProfile } from '../strategy/strategy-profile.js'

import type {
  AllocatedRole,
  DeckLine,
  DeckSolution,
  DeckSolver,
} from './types.js'
import { analyzeMainDeck } from './deck-analysis.js'
import { projectSolutionSummary } from './solution-summary.js'

const MAIN_DECK_SIZE = 40

interface RankedCard {
  card: PlayableCard
  primaryRole: AllocatedRole
  quantity: number
  reasons: readonly string[]
  score: number
}

function blankRoleCounts(): Record<AllocatedRole, number> {
  return {
    twoKCounter: 0,
    blocker: 0,
    interaction: 0,
    pressure: 0,
    boss: 0,
    curve: 0,
  }
}

function scoreCard(
  card: PlayableCard,
  suggestedRoles: ReadonlySet<SuggestedRole>,
): { score: number; reasons: readonly string[] } {
  let score = 0
  const reasons: string[] = []

  if (card.counter === 2000) {
    score += 24
    reasons.push('2K counter (+24)')
  } else if (card.counter === 1000) {
    score += 8
    reasons.push('1K counter (+8)')
  }
  if (suggestedRoles.has('blocker')) {
    score += 20
    reasons.push('Blocker (+20)')
  }
  if (suggestedRoles.has('removal')) {
    score += 18
    reasons.push('Removal (+18)')
  }
  if (suggestedRoles.has('draw')) {
    score += 14
    reasons.push('Draw (+14)')
  }
  if (suggestedRoles.has('pressure')) {
    score += 12
    reasons.push('Pressure (+12)')
  }
  if (suggestedRoles.has('boss')) {
    score += 10
    reasons.push('Boss (+10)')
  }
  if (card.cost !== null && card.cost >= 2 && card.cost <= 6) {
    score += 8
    reasons.push('Playable curve cost (+8)')
  }
  if (card.cost !== null && card.cost >= 8) {
    score -= 4
    reasons.push('High-cost penalty (-4)')
  }

  if (reasons.length === 0) reasons.push('Baseline eligible card')
  return { score, reasons: Object.freeze(reasons) }
}

function primaryRole(
  card: PlayableCard,
  suggestedRoles: ReadonlySet<SuggestedRole>,
): AllocatedRole {
  if (card.counter === 2000) return 'twoKCounter'
  if (suggestedRoles.has('blocker')) return 'blocker'
  if (suggestedRoles.has('removal')) return 'interaction'
  if (suggestedRoles.has('boss')) return 'boss'
  if (suggestedRoles.has('pressure')) return 'pressure'
  return 'curve'
}

function compareRankedCards(left: RankedCard, right: RankedCard): number {
  return (
    right.score - left.score ||
    (left.card.cardNumber < right.card.cardNumber
      ? -1
      : left.card.cardNumber > right.card.cardNumber
        ? 1
        : 0)
  )
}

function freezeCard(card: PlayableCard): PlayableCard {
  const colors = [...card.colors]
  const traits = [...card.traits]
  const setMembership = [...card.setMembership]
  Object.freeze(colors)
  Object.freeze(traits)
  Object.freeze(setMembership)
  return Object.freeze({
    ...card,
    colors,
    traits,
    setMembership,
  })
}

function deckLine(ranked: RankedCard, quantity: number): DeckLine {
  const allocatedRoles = blankRoleCounts()
  allocatedRoles[ranked.primaryRole] = quantity
  return Object.freeze({
    card: ranked.card,
    quantity,
    allocatedRoles: Object.freeze(allocatedRoles),
    score: ranked.score,
    reasons: ranked.reasons,
  })
}

function allocateRankedCards(
  rankedCards: readonly RankedCard[],
): { mainDeck: readonly DeckLine[]; sideboard: readonly DeckLine[] } {
  const mainDeck: DeckLine[] = []
  const sideboard: DeckLine[] = []
  let remainingMainSlots = MAIN_DECK_SIZE

  for (const ranked of rankedCards) {
    // Copies have identical scores, so assigning a prefix preserves ascending
    // copy-ordinal order without allocating an object for every physical copy.
    const mainQuantity = Math.min(ranked.quantity, remainingMainSlots)
    if (mainQuantity > 0) {
      mainDeck.push(deckLine(ranked, mainQuantity))
      remainingMainSlots -= mainQuantity
    }
    const sideboardQuantity = ranked.quantity - mainQuantity
    if (sideboardQuantity > 0) {
      sideboard.push(deckLine(ranked, sideboardQuantity))
    }
  }

  return {
    mainDeck: Object.freeze(mainDeck),
    sideboard: Object.freeze(sideboard),
  }
}

function shortageMessage(eligibleCount: number): string {
  const missing = MAIN_DECK_SIZE - eligibleCount
  return `A legal sealed deck needs 40 eligible cards; only ${eligibleCount} were entered. Add ${missing} more eligible ${missing === 1 ? 'card' : 'cards'}.`
}

export class BasicDeckSolver implements DeckSolver {
  solve(
    catalog: RuntimeCatalog,
    counts: Readonly<Record<string, number>>,
  ): DeckSolution {
    const profile = getStrategyProfile(catalog.manifest.setId)
    const rankedCards: RankedCard[] = []
    let eligibleCountForShortage = 0

    for (const [cardNumber, quantity] of Object.entries(counts)) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new RangeError(
          `Pool quantity for ${cardNumber} must be a non-negative integer.`,
        )
      }
      if (quantity === 0) continue

      const card = catalog.cardsByNumber.get(cardNumber)
      if (card === undefined) {
        throw new Error(
          `Pool card ${cardNumber} is not in the selected catalog.`,
        )
      }
      if (card.cardType === 'LEADER' || card.cardType === 'DON') continue

      const suggestedRoles = new Set(
        catalog.suggestionsByCardNumber.get(cardNumber)?.roles ?? [],
      )
      const { score, reasons } = scoreCard(card, suggestedRoles)
      const allocatedRole = primaryRole(card, suggestedRoles)
      rankedCards.push({
        card: freezeCard(card),
        primaryRole: allocatedRole,
        quantity,
        reasons,
        score,
      })
      eligibleCountForShortage = Math.min(
        MAIN_DECK_SIZE,
        eligibleCountForShortage + quantity,
      )
    }

    if (eligibleCountForShortage < MAIN_DECK_SIZE) {
      throw new Error(shortageMessage(eligibleCountForShortage))
    }

    rankedCards.sort(compareRankedCards)
    const { mainDeck, sideboard } = allocateRankedCards(rankedCards)
    const analysis = analyzeMainDeck(
      mainDeck,
      catalog.featuresByCardNumber,
      profile,
    )
    const { curve, roleCoverage, totalCounter, warnings } =
      projectSolutionSummary(analysis, profile)

    return Object.freeze({
      label: 'Basic sealed build',
      mainDeck,
      sideboard,
      mainDeckSize: MAIN_DECK_SIZE,
      curve,
      totalCounter,
      roleCoverage,
      warnings,
      analysis,
      solverVersion: 'basic-v1',
      profileId: 'baseline-v1',
      profileVersion: 1,
    })
  }
}
