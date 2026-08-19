import type { CardFeatures } from '../../shared/card-features.js'
import type { StrategyProfile } from '../strategy/strategy-profile.js'

import type {
  DeckAnalysis,
  DeckInsight,
  DeckLine,
  GuideSection,
  PlayGuide,
  SideboardSuggestion,
  TurnOrderGuide,
} from './types.js'

interface GeneratePlayGuideInput {
  readonly mainDeck: readonly DeckLine[]
  readonly sideboard: readonly DeckLine[]
  readonly analysis: DeckAnalysis
  readonly featuresByCardNumber: ReadonlyMap<string, CardFeatures>
  readonly profile: StrategyProfile
  readonly leader: 'Rainbow Luffy'
}

function deepFreeze<T extends object>(value: T): T {
  for (const nestedValue of Object.values(value)) {
    if (nestedValue !== null && typeof nestedValue === 'object') {
      deepFreeze(nestedValue)
    }
  }
  return Object.freeze(value)
}

function section(title: string, points: readonly string[]): GuideSection {
  return { title, points: [...points] }
}

function cardLabel(line: DeckLine): string {
  return `${line.card.cardNumber} ${line.card.name}`
}

function sortedLines(lines: readonly DeckLine[]): readonly DeckLine[] {
  return [...lines].sort((left, right) =>
    left.card.cardNumber.localeCompare(right.card.cardNumber),
  )
}

function featuresFor(
  line: DeckLine,
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
): CardFeatures {
  const features = featuresByCardNumber.get(line.card.cardNumber)
  if (features === undefined) {
    throw new Error(`Missing card features for ${line.card.cardNumber}.`)
  }
  return features
}

function namedList(lines: readonly DeckLine[]): string {
  return lines.map(cardLabel).join(', ')
}

function supportCount(
  mainDeck: readonly DeckLine[],
  names: readonly string[],
  traits: readonly string[],
): number {
  const targetNames = new Set(names)
  const targetTraits = new Set(traits)
  return mainDeck.reduce((count, line) => {
    const matches =
      targetNames.has(line.card.name) ||
      line.card.traits.some((trait) => targetTraits.has(trait))
    return count + (matches ? line.quantity : 0)
  }, 0)
}

function matchesSupportTargets(
  line: DeckLine,
  names: readonly string[],
  traits: readonly string[],
): boolean {
  const targetNames = new Set(names)
  const targetTraits = new Set(traits)
  return (
    targetNames.has(line.card.name) ||
    line.card.traits.some((trait) => targetTraits.has(trait))
  )
}

type EffectClaim =
  | 'blocker'
  | 'draw'
  | 'removal'
  | 'rush'
  | 'banish'
  | 'twoForOne'
  | 'searcher'

function hasRequiredTargetSupport(
  claim: EffectClaim,
  features: CardFeatures,
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile,
): boolean {
  const requirement = features.supportRequirementsByFlag[claim]
  if (requirement === null) return true
  const hasExtractedTargets =
    requirement.requiredNames.length > 0 ||
    requirement.requiredTraits.length > 0
  return (
    hasExtractedTargets &&
    supportCount(
      mainDeck,
      requirement.requiredNames,
      requirement.requiredTraits,
    ) >= profile.limits.comboMinimumSupport
  )
}

function hasSearcherTargetSupport(
  source: DeckLine,
  features: CardFeatures,
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile,
): boolean {
  const hasExtractedTargets =
    features.searchableNames.length > 0 || features.searchableTraits.length > 0
  const selectedTargets = supportCount(
    mainDeck,
    features.searchableNames,
    features.searchableTraits,
  )
  const sourceLeavesDeck =
    mainDeck.includes(source) &&
    matchesSupportTargets(
      source,
      features.searchableNames,
      features.searchableTraits,
    )
  const postPlayTargets = selectedTargets - (sourceLeavesDeck ? 1 : 0)
  return (
    hasExtractedTargets &&
    postPlayTargets >= profile.limits.searcherMinimumTargets
  )
}

function supportsClaim(
  source: DeckLine,
  features: CardFeatures,
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile,
  claim: EffectClaim,
): boolean {
  if (!features.rainbowUsableFlags[claim]) return false
  if (
    !hasRequiredTargetSupport(claim, features, mainDeck, profile)
  ) {
    return false
  }
  return (
    claim !== 'searcher' ||
    hasSearcherTargetSupport(source, features, mainDeck, profile)
  )
}

function isOpeningPlayable(
  line: DeckLine,
  profile: StrategyProfile,
): boolean {
  const cost = line.card.cost
  return (
    cost !== null &&
    cost >= profile.curve.early.minimumCost &&
    cost <= profile.curve.early.maximumCost
  )
}

function hasPrintedBossBody(line: DeckLine): boolean {
  return (
    line.card.cardType === 'CHARACTER' &&
    line.card.cost !== null &&
    line.card.cost >= 7 &&
    line.card.power !== null &&
    line.card.power >= 8000
  )
}

function hasCostEfficientPower(line: DeckLine): boolean {
  const cost = line.card.cost
  return (
    cost !== null &&
    line.card.power !== null &&
    line.card.power >= (cost + 2) * 1000
  )
}

const bodyEffectClaims: readonly EffectClaim[] = [
  'blocker',
  'draw',
  'removal',
  'rush',
  'banish',
  'searcher',
]

const bossEffectClaims: readonly EffectClaim[] = [
  'rush',
  'banish',
  'draw',
  'removal',
  'twoForOne',
]

function hasSupportedBodyEvidence(
  line: DeckLine,
  features: CardFeatures,
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile,
): boolean {
  return (
    hasCostEfficientPower(line) ||
    features.rainbowUsableFlags.vanillaLike ||
    bodyEffectClaims.some((claim) =>
      supportsClaim(line, features, mainDeck, profile, claim),
    )
  )
}

function isEfficientEarlyBody(
  line: DeckLine,
  profile: StrategyProfile,
): boolean {
  const cost = line.card.cost
  return (
    line.card.cardType === 'CHARACTER' &&
    isOpeningPlayable(line, profile) &&
    cost !== null &&
    hasCostEfficientPower(line)
  )
}

function generateTurnOrder(
  analysis: DeckAnalysis,
  profile: StrategyProfile,
): TurnOrderGuide {
  const odd = analysis.oddCostImportantPlays
  const even = analysis.evenCostImportantPlays
  const margin = profile.curve.turnOrderDominance
  const preference =
    odd - even >= margin
      ? 'first'
      : even - odd >= margin
        ? 'second'
        : 'flexible'
  const recommendation =
    preference === 'first'
      ? 'Prefer going first when given the choice.'
      : preference === 'second'
        ? 'Prefer going second when given the choice.'
        : 'This build appears flexible; consider the draw based on the opposing leader and your comfort.'

  return {
    title: 'Turn order',
    preference,
    points: [
      `${odd} important odd-cost plays and ${even} important even-cost plays. ${recommendation}`,
    ],
  }
}

function generateOpeningPriorities(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): GuideSection {
  const ordered = sortedLines(mainDeck)
  const earlyBodies = ordered.filter((line) =>
    isEfficientEarlyBody(line, profile),
  )
  const blockers = ordered.filter(
    (line) =>
      isOpeningPlayable(line, profile) &&
      featuresFor(line, featuresByCardNumber).rainbowUsableFlags.blocker &&
      supportsClaim(
        line,
        featuresFor(line, featuresByCardNumber),
        mainDeck,
        profile,
        'blocker',
      ),
  )
  const twoKCounters = ordered.filter(
    (line) =>
      featuresFor(line, featuresByCardNumber).rainbowUsableFlags.twoKCounter,
  )
  const setupCards = ordered.filter((line) => {
    const features = featuresFor(line, featuresByCardNumber)
    const flags = features.rainbowUsableFlags
    return (
      isOpeningPlayable(line, profile) &&
      ((flags.searcher &&
        supportsClaim(line, features, mainDeck, profile, 'searcher')) ||
        (flags.draw &&
          supportsClaim(line, features, mainDeck, profile, 'draw')))
    )
  })
  const points: string[] = []

  if (earlyBodies.length > 0) {
    points.push(`Prefer an early body such as ${namedList(earlyBodies.slice(0, 3))}.`)
  }
  if (blockers.length > 0) {
    points.push(`Consider keeping an early Blocker such as ${namedList(blockers.slice(0, 3))}.`)
  }
  if (setupCards.length > 0) {
    points.push(`Consider supported setup from ${namedList(setupCards.slice(0, 3))}.`)
  }
  if (twoKCounters.length > 0) {
    points.push(`Consider preserving flexible 2K counter options such as ${namedList(twoKCounters.slice(0, 3))}.`)
  }
  if (points.length === 0) {
    points.push(
      'No specific opening package is supported strongly enough; prefer a flexible curve and usable counter cards.',
    )
  }

  return section('Opening priorities', points)
}

function selectedBosses(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): readonly DeckLine[] {
  return sortedLines(mainDeck).filter((line) => {
    const features = featuresFor(line, featuresByCardNumber)
    return (
      features.rainbowUsableFlags.boss &&
      (hasPrintedBossBody(line) ||
        bossEffectClaims.some((claim) =>
          supportsClaim(line, features, mainDeck, profile, claim),
        ))
    )
  })
}

function generateCorePlan(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): GuideSection {
  const ordered = sortedLines(mainDeck)
  const early = ordered.filter((line) => {
    const cost = line.card.cost
    const features = featuresFor(line, featuresByCardNumber)
    return (
      line.card.cardType === 'CHARACTER' &&
      cost !== null &&
      cost >= profile.curve.early.minimumCost &&
      cost <= profile.curve.early.maximumCost &&
      hasSupportedBodyEvidence(line, features, mainDeck, profile)
    )
  })
  const middle = ordered.filter((line) => {
    const cost = line.card.cost
    const features = featuresFor(line, featuresByCardNumber)
    return (
      line.card.cardType === 'CHARACTER' &&
      cost !== null &&
      cost >= profile.curve.middle.minimumCost &&
      cost <= profile.curve.middle.maximumCost &&
      hasSupportedBodyEvidence(line, features, mainDeck, profile)
    )
  })
  const bosses = selectedBosses(mainDeck, featuresByCardNumber, profile)

  return section('Core plan', [
    early.length > 0
      ? `Early: Prefer developing ${namedList(early.slice(0, 3))} without overspending cards from hand.`
      : 'Early: Prefer efficient development and avoid forcing an unsupported setup line.',
    middle.length > 0
      ? `Mid-game: Use ${namedList(middle.slice(0, 3))} to build board pressure while keeping defensive options.`
      : 'Mid-game: Consider steady board pressure and protect the bodies that enable multiple attacks.',
    bosses.length > 0
      ? `Closing: Transition into ${namedList(bosses)} when the board is ready for a finisher.`
      : 'Closing: With no selected boss, prefer a tempo plan built around repeated board attacks.',
  ])
}

function generateCounterPlan(
  analysis: DeckAnalysis,
  profile: StrategyProfile,
): GuideSection {
  const { neutralMinimum, strengthMinimum } = profile.analysis.totalCounter
  const points: string[] = []

  if (analysis.totalCounter >= strengthMinimum) {
    points.push(
      `${analysis.totalCounter} total counter gives this build a strong defensive base; prefer to defend efficiently rather than spending multiple cards on low-impact attacks.`,
    )
  } else if (analysis.totalCounter < neutralMinimum) {
    points.push(
      `${analysis.totalCounter} total counter is below the profile's defensive range; consider taking safe life and defend the bodies that preserve your plan.`,
    )
  } else {
    points.push(
      `${analysis.totalCounter} total counter is in the profile's middle range; prefer efficient one-card defenses when possible.`,
    )
  }

  const twoKCount = analysis.roleCoverage.twoKCounter.count
  if (twoKCount < profile.targets.twoKCounter) {
    points.push(
      `Only ${twoKCount} 2K counters are present; preserve 2K counters aggressively for attacks that matter.`,
    )
  }

  const brickCount = analysis.roleCoverage.brick.count
  if (brickCount > profile.limits.brickTolerance) {
    points.push(
      `${brickCount} zero-counter Character cards exceed the profile tolerance; consider avoiding unnecessary life loss and plan discards carefully.`,
    )
  }

  return section('Counter plan', points)
}

function finisherEffects(
  line: DeckLine,
  features: CardFeatures,
  mainDeck: readonly DeckLine[],
  profile: StrategyProfile,
): string {
  const flags = features.rainbowUsableFlags
  const effects = [
    flags.rush && supportsClaim(line, features, mainDeck, profile, 'rush')
      ? 'Rush pressure'
      : undefined,
    flags.banish && supportsClaim(line, features, mainDeck, profile, 'banish')
      ? 'Banish pressure'
      : undefined,
    flags.removal && supportsClaim(line, features, mainDeck, profile, 'removal')
      ? 'removal'
      : undefined,
    flags.draw && supportsClaim(line, features, mainDeck, profile, 'draw')
      ? 'draw support'
      : undefined,
    flags.twoForOne &&
    supportsClaim(line, features, mainDeck, profile, 'twoForOne')
      ? 'multi-card value'
      : undefined,
  ].filter((value): value is string => value !== undefined)
  return effects.length > 0 ? effects.join(', ') : 'a large late-game body'
}

function generateFinishers(
  mainDeck: readonly DeckLine[],
  analysis: DeckAnalysis,
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): GuideSection {
  const bosses = selectedBosses(mainDeck, featuresByCardNumber, profile)
  const points = bosses.map((line) => {
    const features = featuresFor(line, featuresByCardNumber)
    return `Consider ${cardLabel(line)} as a finisher for ${finisherEffects(
      line,
      features,
      mainDeck,
      profile,
    )}.`
  })

  if (analysis.roleCoverage.boss.count < profile.targets.boss) {
    points.push(
      `Closing power is thin at ${analysis.roleCoverage.boss.count} bosses; prefer a tempo-oriented plan and preserve board pressure.`,
    )
  }
  if (points.length === 0) {
    points.push(
      'No selected boss is supported by the detected features; prefer a tempo-oriented plan and repeated board attacks.',
    )
  }

  return section('Finishers', points)
}

function generateAttackSequencing(
  mainDeck: readonly DeckLine[],
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): GuideSection {
  const points: string[] = []
  const hasSupportedRemoval = mainDeck.some((line) => {
    const features = featuresFor(line, featuresByCardNumber)
    return supportsClaim(line, features, mainDeck, profile, 'removal')
  })
  if (hasSupportedRemoval) {
    points.push(
      'When it improves the board, consider using removal before attacks so later attack targets and counter decisions are clearer.',
    )
  }
  points.push(
    'Prefer efficient attack increments and avoid committing excessive hand resources unless pushing lethal or creating a major board swing.',
  )
  return section('Attack sequencing', points)
}

function countCostBand(
  analysis: DeckAnalysis,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): number {
  return analysis.costColorDistribution.reduce((count, bucket) => {
    const cost = bucket.cost
    return cost !== null && cost >= minimum && cost <= maximum
      ? count + bucket.total
      : count
  }, 0)
}

function addressesWeakness(
  insight: DeckInsight,
  line: DeckLine,
  features: CardFeatures,
  analysis: DeckAnalysis,
  profile: StrategyProfile,
  mainDeck: readonly DeckLine[],
): boolean {
  const flags = features.rainbowUsableFlags
  const cost = line.card.cost
  switch (insight.id) {
    case 'two-k-counter':
      return flags.twoKCounter
    case 'total-counter':
      return (line.card.counter ?? 0) > 0
    case 'blockers':
      return supportsClaim(line, features, mainDeck, profile, 'blocker')
    case 'vanilla-like':
      return flags.vanillaLike
    case 'interaction':
      return (
        supportsClaim(line, features, mainDeck, profile, 'draw') ||
        supportsClaim(line, features, mainDeck, profile, 'removal')
      )
    case 'bosses':
      return (
        flags.boss &&
        (hasPrintedBossBody(line) ||
          bossEffectClaims.some((claim) =>
            supportsClaim(line, features, mainDeck, profile, claim),
          ))
      )
    case 'early-curve':
      return (
        cost !== null &&
        cost >= profile.curve.early.minimumCost &&
        cost <= profile.curve.early.maximumCost
      )
    case 'middle-curve':
      return (
        cost !== null &&
        cost >= profile.curve.middle.minimumCost &&
        cost <= profile.curve.middle.maximumCost
      )
    case 'late-curve':
      return (
        countCostBand(analysis, profile.curve.late.minimumCost) <
          profile.curve.late.minimum &&
        cost !== null &&
        cost >= profile.curve.late.minimumCost
      )
    case 'high-cost':
      return (
        countCostBand(analysis, profile.curve.highCost.minimumCost) <
          profile.curve.highCost.minimum &&
        cost !== null &&
        cost >= profile.curve.highCost.minimumCost
      )
    case 'bricks':
      return !flags.brick && (line.card.counter ?? 0) > 0
    default:
      return false
  }
}

function generateSideboardSuggestions(
  mainDeck: readonly DeckLine[],
  sideboard: readonly DeckLine[],
  analysis: DeckAnalysis,
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
  profile: StrategyProfile,
): readonly SideboardSuggestion[] {
  return sideboard
    .map((line): SideboardSuggestion | undefined => {
      const features = featuresFor(line, featuresByCardNumber)
      const addressesInsightIds = analysis.weaknesses
        .filter((weakness) =>
          addressesWeakness(
            weakness,
            line,
            features,
            analysis,
            profile,
            mainDeck,
          ),
        )
        .map(({ id }) => id)
      if (addressesInsightIds.length === 0) return undefined
      return {
        cardNumber: line.card.cardNumber,
        cardName: line.card.name,
        quantity: line.quantity,
        score: line.score,
        addressesInsightIds,
        reason: `Consider this card when addressing ${analysis.weaknesses
          .filter(({ id }) => addressesInsightIds.includes(id))
          .map(({ title }) => title)
          .join(', ')}.`,
      }
    })
    .filter(
      (suggestion): suggestion is SideboardSuggestion => suggestion !== undefined,
    )
    .sort(
      (left, right) =>
        right.addressesInsightIds.length - left.addressesInsightIds.length ||
        right.score - left.score ||
        left.cardNumber.localeCompare(right.cardNumber),
    )
    .slice(0, 3)
}

export function generatePlayGuide(input: GeneratePlayGuideInput): PlayGuide {
  const {
    mainDeck,
    sideboard,
    analysis,
    featuresByCardNumber,
    profile,
    leader,
  } = input
  const result: PlayGuide = {
    leader,
    turnOrder: generateTurnOrder(analysis, profile),
    openingPriorities: generateOpeningPriorities(
      mainDeck,
      featuresByCardNumber,
      profile,
    ),
    corePlan: generateCorePlan(mainDeck, featuresByCardNumber, profile),
    counterPlan: generateCounterPlan(analysis, profile),
    finishers: generateFinishers(
      mainDeck,
      analysis,
      featuresByCardNumber,
      profile,
    ),
    attackSequencing: generateAttackSequencing(
      mainDeck,
      featuresByCardNumber,
      profile,
    ),
    sideboardSuggestions: generateSideboardSuggestions(
      mainDeck,
      sideboard,
      analysis,
      featuresByCardNumber,
      profile,
    ),
  }
  return deepFreeze(result)
}
