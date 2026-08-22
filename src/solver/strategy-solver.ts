import { hasStructuredInteraction } from '../../shared/card-features.js'
import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import {
  getStrategyProfile,
  type StrategyProfile,
} from '../strategy/strategy-profile.js'

import {
  addCandidateToDeckState,
  buildPoolSupport,
  createEmptyDeckState,
  type CandidateCard,
  type CandidatePoolEntry,
  type DeckState,
  type PoolSupport,
} from './deck-state.js'
import { analyzeMainDeck } from './deck-analysis.js'
import {
  marginalScoreComponentLabels,
  marginalScoreComponentOrder,
  scoreCandidateAgainstCompletedDeck,
  scoreMarginalCandidate,
  type MarginalScore,
  type MarginalScoreComponent,
} from './marginal-score.js'
import type {
  AllocatedRole,
  DeckLine,
  DeckSolver,
  StrategyDeckSolution,
} from './types.js'
import { generatePlayGuide } from './play-guide.js'
import { projectSolutionSummary } from './solution-summary.js'

const MAIN_DECK_SIZE = 40

const allocatedRoleNames: readonly AllocatedRole[] = [
  'twoKCounter',
  'blocker',
  'interaction',
  'pressure',
  'boss',
  'curve',
]

interface SelectedCopy {
  readonly candidate: CandidateCard
  readonly score: MarginalScore
}

interface SelectedAggregate {
  readonly candidate: CandidateCard
  quantity: number
  totalScore: number
  readonly componentTotals: Map<MarginalScoreComponent, number>
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

function compareCardNumber(left: CandidateCard, right: CandidateCard): number {
  return left.card.cardNumber.localeCompare(right.card.cardNumber)
}

function validateCandidates(
  catalog: RuntimeCatalog,
  counts: Readonly<Record<string, number>>,
): readonly CandidatePoolEntry[] {
  const candidates: CandidatePoolEntry[] = []
  let eligibleCountForShortage = 0

  for (const [cardNumber, quantity] of Object.entries(counts)) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new RangeError(
        `Pool quantity for ${cardNumber} must be a non-negative integer.`,
      )
    }
    if (quantity === 0) continue

    const catalogCard = catalog.cardsByNumber.get(cardNumber)
    if (catalogCard === undefined) {
      throw new Error(
        `Pool card ${cardNumber} is not in the selected catalog.`,
      )
    }
    if (
      catalogCard.cardType === 'LEADER' ||
      catalogCard.cardType === 'DON'
    ) {
      continue
    }

    const features = catalog.featuresByCardNumber.get(cardNumber)
    if (features === undefined) {
      throw new Error(`Catalog features for ${cardNumber} are unavailable.`)
    }
    candidates.push({
      card: freezeCard(catalogCard),
      features,
      quantity,
    })
    eligibleCountForShortage = Math.min(
      MAIN_DECK_SIZE,
      eligibleCountForShortage + quantity,
    )
  }

  if (eligibleCountForShortage < MAIN_DECK_SIZE) {
    const missing = MAIN_DECK_SIZE - eligibleCountForShortage
    throw new Error(
      `A legal sealed deck needs 40 eligible cards; only ${eligibleCountForShortage} were entered. Add ${missing} more eligible ${missing === 1 ? 'card' : 'cards'}.`,
    )
  }

  return Object.freeze(candidates.sort(compareCardNumber))
}

function selectMainDeck(
  candidates: readonly CandidatePoolEntry[],
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): readonly SelectedCopy[] {
  const remaining = new Map(
    candidates.map((candidate) => [
      candidate.card.cardNumber,
      candidate.quantity,
    ]),
  )
  const selected: SelectedCopy[] = []
  let state = createEmptyDeckState()

  for (let slot = 0; slot < MAIN_DECK_SIZE; slot += 1) {
    let bestCandidate: CandidatePoolEntry | undefined
    let bestScore: MarginalScore | undefined

    for (const candidate of candidates) {
      if ((remaining.get(candidate.card.cardNumber) ?? 0) === 0) continue
      const score = scoreMarginalCandidate(
        candidate,
        state,
        poolSupport,
        profile,
      )
      if (bestScore === undefined || score.total > bestScore.total) {
        bestCandidate = candidate
        bestScore = score
      }
    }

    if (bestCandidate === undefined || bestScore === undefined) {
      throw new Error('Unable to fill all 40 main-deck slots from the pool.')
    }

    const cardNumber = bestCandidate.card.cardNumber
    remaining.set(cardNumber, (remaining.get(cardNumber) ?? 0) - 1)
    selected.push({ candidate: bestCandidate, score: bestScore })
    state = addCandidateToDeckState(state, bestCandidate)
  }

  return Object.freeze(selected)
}

function createCompletedDeckState(
  finalDeckSelections: readonly CandidateCard[],
): DeckState {
  if (finalDeckSelections.length !== MAIN_DECK_SIZE) {
    throw new RangeError(
      'A completed deck state requires exactly 40 selections.',
    )
  }

  let finalState = createEmptyDeckState()
  for (const candidate of finalDeckSelections) {
    finalState = addCandidateToDeckState(finalState, candidate)
  }
  return finalState
}

function projectedRoles(
  candidate: CandidateCard,
  quantity: number,
): Readonly<Record<AllocatedRole, number>> {
  const roles = blankRoleCounts()
  const flags = candidate.features.rainbowUsableFlags
  if (flags.twoKCounter) roles.twoKCounter = quantity
  if (flags.blocker) roles.blocker = quantity
  if (hasStructuredInteraction(candidate.features)) roles.interaction = quantity
  if (flags.boss) roles.boss = quantity
  if (flags.vanillaLike || flags.rush || flags.banish) {
    roles.pressure = quantity
  }
  if (allocatedRoleNames.every((role) => role === 'curve' || roles[role] === 0)) {
    roles.curve = quantity
  }
  return Object.freeze(roles)
}

function strategyDeckLine(
  candidate: CandidateCard,
  quantity: number,
  score: number,
  reasons: readonly string[],
): DeckLine {
  return Object.freeze({
    card: candidate.card,
    quantity,
    allocatedRoles: projectedRoles(candidate, quantity),
    score,
    reasons: Object.freeze([...reasons]),
  })
}

function aggregateMainDeck(
  selected: readonly SelectedCopy[],
): readonly DeckLine[] {
  const aggregates = new Map<string, SelectedAggregate>()

  for (const copy of selected) {
    const cardNumber = copy.candidate.card.cardNumber
    let aggregate = aggregates.get(cardNumber)
    if (aggregate === undefined) {
      aggregate = {
        candidate: copy.candidate,
        quantity: 0,
        totalScore: 0,
        componentTotals: new Map<MarginalScoreComponent, number>(),
      }
      aggregates.set(cardNumber, aggregate)
    }
    aggregate.quantity += 1
    aggregate.totalScore += copy.score.total
    for (const component of marginalScoreComponentOrder) {
      const contribution = copy.score.components[component]
      if (contribution === undefined) continue
      aggregate.componentTotals.set(
        component,
        (aggregate.componentTotals.get(component) ?? 0) + contribution,
      )
    }
  }

  return Object.freeze(
    Array.from(aggregates.values(), (aggregate) =>
      strategyDeckLine(
        aggregate.candidate,
        aggregate.quantity,
        Number((aggregate.totalScore / aggregate.quantity).toFixed(1)),
        marginalScoreComponentOrder.flatMap((component) => {
          const total = aggregate.componentTotals.get(component)
          if (total === undefined) return []
          const average = Number((total / aggregate.quantity).toFixed(6))
          if (average === 0) return []
          const signedAverage = average > 0 ? `+${average}` : String(average)
          return [
            `${marginalScoreComponentLabels[component]} (avg ${signedAverage})`,
          ]
        }),
      ),
    ),
  )
}

function buildSideboard(
  candidates: readonly CandidatePoolEntry[],
  selected: readonly SelectedCopy[],
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): readonly DeckLine[] {
  const selectedCounts = new Map<string, number>()
  for (const copy of selected) {
    const cardNumber = copy.candidate.card.cardNumber
    selectedCounts.set(cardNumber, (selectedCounts.get(cardNumber) ?? 0) + 1)
  }
  const completedState = createCompletedDeckState(
    selected.map(({ candidate }) => candidate),
  )
  const lines: DeckLine[] = []

  for (const candidate of candidates) {
    const quantity =
      candidate.quantity -
      (selectedCounts.get(candidate.card.cardNumber) ?? 0)
    if (quantity === 0) continue
    const score = scoreCandidateAgainstCompletedDeck(
      candidate,
      completedState,
      poolSupport,
      profile,
    )
    lines.push(
      strategyDeckLine(
        candidate,
        quantity,
        score.total,
        score.reasons,
      ),
    )
  }

  lines.sort(
    (left, right) =>
      right.score - left.score ||
      left.card.cardNumber.localeCompare(right.card.cardNumber),
  )
  return Object.freeze(lines)
}

export class StrategyDeckSolver implements DeckSolver {
  solve(
    catalog: RuntimeCatalog,
    counts: Readonly<Record<string, number>>,
  ): StrategyDeckSolution {
    const profile = getStrategyProfile(catalog.manifest.setId)
    const candidates = validateCandidates(catalog, counts)
    const poolSupport = buildPoolSupport(candidates)
    const selected = selectMainDeck(candidates, poolSupport, profile)
    const mainDeck = aggregateMainDeck(selected)
    const sideboard = buildSideboard(
      candidates,
      selected,
      poolSupport,
      profile,
    )
    const analysis = analyzeMainDeck(
      mainDeck,
      catalog.featuresByCardNumber,
      profile,
    )
    const { curve, roleCoverage, totalCounter, warnings } =
      projectSolutionSummary(analysis, profile)
    const playGuide = generatePlayGuide({
      mainDeck,
      sideboard,
      analysis,
      featuresByCardNumber: catalog.featuresByCardNumber,
      profile,
      leader: 'Rainbow Luffy',
    })

    return Object.freeze({
      label: 'Strategy sealed build',
      mainDeck,
      sideboard,
      mainDeckSize: MAIN_DECK_SIZE,
      curve,
      totalCounter,
      roleCoverage,
      warnings,
      analysis,
      playGuide,
      solverVersion: 'strategy-v2',
      profileId: profile.id,
      profileVersion: profile.version,
    })
  }
}
