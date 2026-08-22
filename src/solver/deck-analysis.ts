import {
  hasStructuredInteraction,
  type CardFeatures,
} from '../../shared/card-features.js'
import {
  displayCardColorOrder,
  normalizeDisplayCardColors,
  type DisplayCardColor,
} from '../card-colors.js'
import type {
  SoftTargetRole,
  StrategyProfile,
} from '../strategy/strategy-profile.js'

import { isImportantPlay } from './card-measurements.js'
import {
  measuredRoleKeys,
  type MeasuredRole,
} from './deck-state.js'
import type {
  CostColorBucket,
  DeckAnalysis,
  DeckInsight,
  DeckLine,
  RoleMeasurement,
} from './types.js'

const MAIN_DECK_SIZE = 40
const INSIGHT_LIMIT = 3
const INSIGHT_PRIORITIES = Object.freeze({
  bricks: 800,
  counter: 700,
  curve: 600,
  twoKCounter: 500,
  blocker: 400,
  vanillaLike: 300,
  interaction: 200,
  boss: 100,
})

interface InsightCandidate extends DeckInsight {
  normalizedDistance: number
}

interface MutableBucket {
  total: number
  colors: Map<DisplayCardColor, number>
}

interface AnalysisSummary {
  roleCoverage: Readonly<Record<MeasuredRole, RoleMeasurement>>
  totalCounter: number
  oddCostImportantPlays: number
  evenCostImportantPlays: number
}

function targetForRole(
  role: MeasuredRole,
  profile: StrategyProfile,
): number | null {
  return role === 'twoKCounter' ||
    role === 'blocker' ||
    role === 'vanillaLike' ||
    role === 'interaction' ||
    role === 'boss'
    ? profile.targets[role]
    : null
}

function summarizeMainDeck(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): AnalysisSummary {
  const counts = Object.fromEntries(
    measuredRoleKeys.map((role) => [role, 0]),
  ) as Record<MeasuredRole, number>
  let totalCounter = 0
  let oddCostImportantPlays = 0
  let evenCostImportantPlays = 0

  for (const line of mainDeck) {
    const features = featuresByCardNumber.get(line.card.cardNumber)
    if (features === undefined) {
      throw new Error(`Missing card features for ${line.card.cardNumber}.`)
    }

    const counterContribution = (line.card.counter ?? 0) * line.quantity
    if (!Number.isSafeInteger(counterContribution)) {
      throw new RangeError('Total counter value must remain a safe integer.')
    }
    totalCounter += counterContribution
    if (!Number.isSafeInteger(totalCounter)) {
      throw new RangeError('Total counter value must remain a safe integer.')
    }

    const flags = features.rainbowUsableFlags
    for (const role of measuredRoleKeys) {
      if (role === 'interaction') continue
      if (flags[role]) counts[role] += line.quantity
    }
    if (hasStructuredInteraction(features)) counts.interaction += line.quantity

    if (isImportantPlay(line.card, features)) {
      const parity = (line.card.cost ?? 0) % 2 === 0 ? 'even' : 'odd'
      if (parity === 'odd') oddCostImportantPlays += line.quantity
      else evenCostImportantPlays += line.quantity
    }
  }

  const roleCoverage = Object.fromEntries(
    measuredRoleKeys.map((role) => [
      role,
      Object.freeze({ count: counts[role], target: targetForRole(role, profile) }),
    ]),
  ) as Record<MeasuredRole, RoleMeasurement>

  return Object.freeze({
    roleCoverage: Object.freeze(roleCoverage),
    totalCounter,
    oddCostImportantPlays,
    evenCostImportantPlays,
  })
}

function freezeInsight(candidate: InsightCandidate): DeckInsight {
  return Object.freeze({
    id: candidate.id,
    title: candidate.title,
    evidence: candidate.evidence,
    priority: candidate.priority,
  })
}

function compareInsights(
  left: InsightCandidate,
  right: InsightCandidate,
): number {
  return (
    right.priority - left.priority ||
    right.normalizedDistance - left.normalizedDistance ||
    left.id.localeCompare(right.id)
  )
}

function minimumInsight(
  id: string,
  title: string,
  measurement: number,
  target: number,
  priority: number,
  noun: string,
): { strength?: InsightCandidate; weakness?: InsightCandidate } {
  const candidate: InsightCandidate = {
    id,
    title,
    evidence: `${measurement} ${noun}; soft target at least ${target}.`,
    priority,
    normalizedDistance: Math.abs(measurement - target) / Math.max(1, target),
  }
  return measurement >= target
    ? { strength: candidate }
    : { weakness: candidate }
}

function rangeInsight(
  id: string,
  title: string,
  measurement: number,
  minimum: number,
  maximum: number,
): { strength?: InsightCandidate; weakness?: InsightCandidate } {
  const withinRange = measurement >= minimum && measurement <= maximum
  const distance = withinRange
    ? Math.min(measurement - minimum, maximum - measurement) /
      Math.max(1, maximum - minimum)
    : measurement < minimum
      ? (minimum - measurement) / Math.max(1, minimum)
      : (measurement - maximum) / Math.max(1, maximum)
  const candidate: InsightCandidate = {
    id,
    title,
    evidence: `${measurement} cards; profile range ${minimum}-${maximum}.`,
    priority: INSIGHT_PRIORITIES.curve,
    normalizedDistance: distance,
  }
  return withinRange ? { strength: candidate } : { weakness: candidate }
}

function buildCostColorDistribution(
  mainDeck: readonly DeckLine[],
): readonly CostColorBucket[] {
  const buckets = new Map<number | null, MutableBucket>()
  let totalCopies = 0

  for (const line of mainDeck) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError('Main deck line quantity must be a positive safe integer.')
    }
    totalCopies += line.quantity
    if (!Number.isSafeInteger(totalCopies)) {
      throw new RangeError('Main deck quantities must remain a safe integer.')
    }

    const colors = normalizeDisplayCardColors(line.card.colors)
    const share = line.quantity / colors.length
    const bucket = buckets.get(line.card.cost) ?? {
      total: 0,
      colors: new Map<DisplayCardColor, number>(),
    }
    bucket.total += line.quantity
    for (const color of colors) {
      bucket.colors.set(color, (bucket.colors.get(color) ?? 0) + share)
    }
    buckets.set(line.card.cost, bucket)
  }

  if (totalCopies !== MAIN_DECK_SIZE) {
    throw new RangeError('Main deck quantities must total exactly 40 copies.')
  }

  const costs = [...buckets.keys()].sort((left, right) => {
    if (left === null) return right === null ? 0 : 1
    if (right === null) return -1
    return left - right
  })

  return Object.freeze(
    costs.map((cost) => {
      const bucket = buckets.get(cost)
      if (bucket === undefined) throw new Error('Missing analysis bucket.')
      const orderedCounts = displayCardColorOrder.flatMap((color) => {
        const count = bucket.colors.get(color)
        return count === undefined ? [] : [{ color, count }]
      })
      let finalizedCount = 0
      const segments = orderedCounts.map(({ color, count }, index) => {
        const finalizedSegmentCount =
          index === orderedCounts.length - 1
            ? bucket.total - finalizedCount
            : count
        finalizedCount += finalizedSegmentCount
        return Object.freeze({ color, count: finalizedSegmentCount })
      })
      return Object.freeze({
        cost,
        total: bucket.total,
        segments: Object.freeze(segments),
      })
    }),
  )
}

function insightCandidates(
  mainDeck: readonly DeckLine[],
  summary: AnalysisSummary,
  profile: StrategyProfile,
): { strengths: readonly DeckInsight[]; weaknesses: readonly DeckInsight[] } {
  const strengths: InsightCandidate[] = []
  const weaknesses: InsightCandidate[] = []
  const add = (candidate: {
    strength?: InsightCandidate
    weakness?: InsightCandidate
  }) => {
    if (candidate.strength !== undefined) strengths.push(candidate.strength)
    if (candidate.weakness !== undefined) weaknesses.push(candidate.weakness)
  }

  let earlyCount = 0
  let middleCount = 0
  let lateCount = 0
  let highCostCount = 0
  for (const line of mainDeck) {
    const { cost } = line.card
    if (cost === null) continue
    if (
      cost >= profile.curve.early.minimumCost &&
      cost <= profile.curve.early.maximumCost
    ) {
      earlyCount += line.quantity
    }
    if (
      cost >= profile.curve.middle.minimumCost &&
      cost <= profile.curve.middle.maximumCost
    ) {
      middleCount += line.quantity
    }
    if (cost >= profile.curve.late.minimumCost) lateCount += line.quantity
    if (cost >= profile.curve.highCost.minimumCost) highCostCount += line.quantity
  }

  add(
    minimumInsight(
      'early-curve',
      'Early curve',
      earlyCount,
      profile.curve.early.target,
      INSIGHT_PRIORITIES.curve,
      `cards at cost ${profile.curve.early.minimumCost}-${profile.curve.early.maximumCost}`,
    ),
  )
  add(
    minimumInsight(
      'middle-curve',
      'Middle curve',
      middleCount,
      profile.curve.middle.target,
      INSIGHT_PRIORITIES.curve,
      `cards at cost ${profile.curve.middle.minimumCost}-${profile.curve.middle.maximumCost}`,
    ),
  )
  add(
    rangeInsight(
      'late-curve',
      'Late curve',
      lateCount,
      profile.curve.late.minimum,
      profile.curve.late.maximum,
    ),
  )
  add(
    rangeInsight(
      'high-cost',
      'High-cost balance',
      highCostCount,
      profile.curve.highCost.minimum,
      profile.curve.highCost.maximum,
    ),
  )

  const { neutralMinimum: counterFloor, strengthMinimum: counterStrength } =
    profile.analysis.totalCounter
  const counterCandidate: InsightCandidate = {
    id: 'total-counter',
    title: 'Counter total',
    evidence: `${summary.totalCounter} total counter; profile-based defensive range starts at ${counterFloor}, with ${counterStrength} a strength.`,
    priority: INSIGHT_PRIORITIES.counter,
    normalizedDistance:
      summary.totalCounter >= counterStrength
        ? (summary.totalCounter - counterStrength) / Math.max(1, counterStrength)
        : (counterFloor - summary.totalCounter) / Math.max(1, counterFloor),
  }
  if (summary.totalCounter >= counterStrength) strengths.push(counterCandidate)
  else if (summary.totalCounter < counterFloor) weaknesses.push(counterCandidate)

  const brickCount = summary.roleCoverage.brick.count
  const brickTolerance = profile.limits.brickTolerance
  const brickCandidate: InsightCandidate = {
    id: 'bricks',
    title: 'Hand defense',
    evidence: `${brickCount} zero-counter Character cards; profile tolerance ${brickTolerance}.`,
    priority: INSIGHT_PRIORITIES.bricks,
    normalizedDistance:
      Math.abs(brickCount - brickTolerance) / Math.max(1, brickTolerance),
  }
  if (brickCount > brickTolerance) weaknesses.push(brickCandidate)
  else if (brickCount <= Math.floor(brickTolerance / 2)) {
    strengths.push(brickCandidate)
  }

  const targetedRoles: readonly Readonly<{
    role: SoftTargetRole
    id: string
    title: string
    noun: string
    priority: number
  }>[] = [
    {
      role: 'twoKCounter',
      id: 'two-k-counter',
      title: '2K counters',
      noun: '2K counters',
      priority: INSIGHT_PRIORITIES.twoKCounter,
    },
    {
      role: 'blocker',
      id: 'blockers',
      title: 'Blockers',
      noun: 'blockers',
      priority: INSIGHT_PRIORITIES.blocker,
    },
    {
      role: 'vanillaLike',
      id: 'vanilla-like',
      title: 'Efficient bodies',
      noun: 'vanilla-like bodies',
      priority: INSIGHT_PRIORITIES.vanillaLike,
    },
    {
      role: 'interaction',
      id: 'interaction',
      title: 'Interaction',
      noun: 'interaction cards',
      priority: INSIGHT_PRIORITIES.interaction,
    },
    {
      role: 'boss',
      id: 'bosses',
      title: 'Bosses',
      noun: 'bosses',
      priority: INSIGHT_PRIORITIES.boss,
    },
  ]
  for (const { role, id, title, noun, priority } of targetedRoles) {
    add(
      minimumInsight(
        id,
        title,
        summary.roleCoverage[role].count,
        profile.targets[role],
        priority,
        noun,
      ),
    )
  }

  return Object.freeze({
    strengths: Object.freeze(
      strengths.sort(compareInsights).slice(0, INSIGHT_LIMIT).map(freezeInsight),
    ),
    weaknesses: Object.freeze(
      weaknesses.sort(compareInsights).slice(0, INSIGHT_LIMIT).map(freezeInsight),
    ),
  })
}

export function analyzeMainDeck(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): DeckAnalysis {
  const costColorDistribution = buildCostColorDistribution(mainDeck)
  const summary = summarizeMainDeck(mainDeck, featuresByCardNumber, profile)
  const { strengths, weaknesses } = insightCandidates(
    mainDeck,
    summary,
    profile,
  )
  return Object.freeze({
    costColorDistribution,
    totalCounter: summary.totalCounter,
    roleCoverage: summary.roleCoverage,
    oddCostImportantPlays: summary.oddCostImportantPlays,
    evenCostImportantPlays: summary.evenCostImportantPlays,
    strengths,
    weaknesses,
  })
}
