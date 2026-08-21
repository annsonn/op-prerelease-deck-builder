export type SoftTargetRole =
  | 'twoKCounter'
  | 'blocker'
  | 'vanillaLike'
  | 'interaction'
  | 'boss'

type TargetCurveBand = Readonly<{
  minimumCost: number
  maximumCost: number
  target: number
}>

type RangeCurveBand = Readonly<{
  minimumCost: number
  minimum: number
  maximum: number
}>

type StrategyWeights = Readonly<{
  standalone: Readonly<{
    cardPower: number
    counterValue: number
    saturatedCounterValue: number
  }>
  softTargets: Readonly<Record<SoftTargetRole, number>>
  softTargetFloorPercent: Readonly<Record<SoftTargetRole, number>>
  curve: Readonly<{
    early: number
    middle: number
    late: number
    highCost: number
    turnOrderDominance: number
  }>
  synergy: Readonly<{
    trait: number
    type: number
    combo: number
    searcher: number
  }>
  compatibility: Readonly<{
    leaderColor: number
    cardColor: number
    effect: number
  }>
  redundancy: Readonly<{
    role: number
    effect: number
  }>
  progressiveBricks: Readonly<{
    first: number
    second: number
    third: number
    fourthOrMore: number
  }>
}>

export type StrategyProfile = Readonly<{
  id: 'sealed-video-v1'
  version: 1
  targets: Readonly<Record<SoftTargetRole, number>>
  curve: Readonly<{
    early: TargetCurveBand
    middle: TargetCurveBand
    late: RangeCurveBand
    highCost: RangeCurveBand
    turnOrderDominance: number
  }>
  limits: Readonly<{
    brickTolerance: number
    searcherMinimumTargets: number
    comboMinimumSupport: number
    premiumBombFirstCopyFloor: number
  }>
  analysis: Readonly<{
    totalCounter: Readonly<{
      neutralMinimum: number
      strengthMinimum: number
      scoringSaturationMinimum: number
    }>
  }>
  weights: StrategyWeights
}>

export type StrategyProfileOverride = Readonly<{
  targets?: Partial<Record<SoftTargetRole, number>>
  curve?: Readonly<{
    early?: Partial<TargetCurveBand>
    middle?: Partial<TargetCurveBand>
    late?: Partial<RangeCurveBand>
    highCost?: Partial<RangeCurveBand>
    turnOrderDominance?: number
  }>
  limits?: Partial<StrategyProfile['limits']>
  analysis?: Readonly<{
    totalCounter?: Partial<StrategyProfile['analysis']['totalCounter']>
  }>
  weights?: Readonly<{
    standalone?: Partial<StrategyWeights['standalone']>
    softTargets?: Partial<StrategyWeights['softTargets']>
    softTargetFloorPercent?: Partial<StrategyWeights['softTargetFloorPercent']>
    curve?: Partial<StrategyWeights['curve']>
    synergy?: Partial<StrategyWeights['synergy']>
    compatibility?: Partial<StrategyWeights['compatibility']>
    redundancy?: Partial<StrategyWeights['redundancy']>
    progressiveBricks?: Partial<StrategyWeights['progressiveBricks']>
  }>
}>

const BASE_PROFILE: StrategyProfile = {
  id: 'sealed-video-v1',
  version: 1,
  targets: {
    twoKCounter: 10,
    blocker: 10,
    vanillaLike: 10,
    interaction: 5,
    boss: 5,
  },
  curve: {
    early: { minimumCost: 0, maximumCost: 2, target: 8 },
    middle: { minimumCost: 3, maximumCost: 5, target: 16 },
    late: { minimumCost: 6, minimum: 6, maximum: 10 },
    highCost: { minimumCost: 7, minimum: 4, maximum: 8 },
    turnOrderDominance: 3,
  },
  limits: {
    brickTolerance: 8,
    searcherMinimumTargets: 6,
    comboMinimumSupport: 4,
    premiumBombFirstCopyFloor: 15,
  },
  analysis: {
    totalCounter: {
      neutralMinimum: 24_000,
      strengthMinimum: 30_000,
      scoringSaturationMinimum: 30_000,
    },
  },
  weights: {
    standalone: { cardPower: 2, counterValue: 1, saturatedCounterValue: 1 },
    softTargets: {
      twoKCounter: 3,
      blocker: 3,
      vanillaLike: 1,
      interaction: 3,
      boss: 2,
    },
    softTargetFloorPercent: {
      twoKCounter: 0,
      blocker: 0,
      vanillaLike: 0,
      interaction: 0,
      boss: 0,
    },
    curve: {
      early: 3,
      middle: 3,
      late: 2,
      highCost: 2,
      turnOrderDominance: 3,
    },
    synergy: { trait: 2, type: 2, combo: 2, searcher: 2 },
    compatibility: { leaderColor: 3, cardColor: 2, effect: 1 },
    redundancy: { role: 1, effect: 1 },
    progressiveBricks: { first: 1, second: 2, third: 3, fourthOrMore: 4 },
  },
}

const OP16_OP17_CALIBRATION = {
  analysis: {
    totalCounter: { scoringSaturationMinimum: 52_000 },
  },
  weights: {
    standalone: { counterValue: 7 },
    softTargets: { blocker: 8 },
    softTargetFloorPercent: { blocker: 60, vanillaLike: 50 },
  },
} as const satisfies StrategyProfileOverride

const SET_OVERRIDES: Readonly<Partial<Record<string, StrategyProfileOverride>>> =
  Object.freeze({
    OP16: OP16_OP17_CALIBRATION,
    OP17: OP16_OP17_CALIBRATION,
  })

function deepFreeze<T extends object>(value: T): T {
  for (const nestedValue of Object.values(value)) {
    if (nestedValue !== null && typeof nestedValue === 'object') {
      deepFreeze(nestedValue)
    }
  }

  return Object.freeze(value)
}

function mergeDefined<T extends object>(base: T, override: Partial<T> | undefined): T {
  const definedEntries = Object.entries(override ?? {}).filter(
    ([, value]) => value !== undefined,
  )

  return { ...base, ...Object.fromEntries(definedEntries) }
}

export function mergeStrategyProfile(
  base: StrategyProfile,
  override: StrategyProfileOverride | undefined,
): StrategyProfile {
  const merged: StrategyProfile = {
    ...base,
    targets: mergeDefined(base.targets, override?.targets),
    curve: {
      early: mergeDefined(base.curve.early, override?.curve?.early),
      middle: mergeDefined(base.curve.middle, override?.curve?.middle),
      late: mergeDefined(base.curve.late, override?.curve?.late),
      highCost: mergeDefined(base.curve.highCost, override?.curve?.highCost),
      turnOrderDominance:
        override?.curve?.turnOrderDominance ?? base.curve.turnOrderDominance,
    },
    limits: mergeDefined(base.limits, override?.limits),
    analysis: {
      totalCounter: mergeDefined(
        base.analysis.totalCounter,
        override?.analysis?.totalCounter,
      ),
    },
    weights: {
      standalone: mergeDefined(base.weights.standalone, override?.weights?.standalone),
      softTargets: mergeDefined(
        base.weights.softTargets,
        override?.weights?.softTargets,
      ),
      softTargetFloorPercent: mergeDefined(
        base.weights.softTargetFloorPercent,
        override?.weights?.softTargetFloorPercent,
      ),
      curve: mergeDefined(base.weights.curve, override?.weights?.curve),
      synergy: mergeDefined(base.weights.synergy, override?.weights?.synergy),
      compatibility: mergeDefined(
        base.weights.compatibility,
        override?.weights?.compatibility,
      ),
      redundancy: mergeDefined(base.weights.redundancy, override?.weights?.redundancy),
      progressiveBricks: mergeDefined(
        base.weights.progressiveBricks,
        override?.weights?.progressiveBricks,
      ),
    },
  }

  const { neutralMinimum, strengthMinimum, scoringSaturationMinimum } =
    merged.analysis.totalCounter
  for (const [label, value] of [
    ['neutral minimum', neutralMinimum],
    ['strength minimum', strengthMinimum],
    ['scoring saturation minimum', scoringSaturationMinimum],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        `Total-counter ${label} must be a non-negative safe integer.`,
      )
    }
  }
  if (strengthMinimum < neutralMinimum) {
    throw new RangeError(
      'Total-counter strength minimum must be at least the neutral minimum.',
    )
  }
  if (scoringSaturationMinimum < strengthMinimum) {
    throw new RangeError(
      'Total-counter scoring saturation minimum must be at least the strength minimum.',
    )
  }

  if (
    !Number.isFinite(merged.limits.premiumBombFirstCopyFloor) ||
    merged.limits.premiumBombFirstCopyFloor < 0
  ) {
    throw new RangeError(
      'premiumBombFirstCopyFloor must be a finite, non-negative number.',
    )
  }

  for (const [role, percentage] of Object.entries(
    merged.weights.softTargetFloorPercent,
  )) {
    if (
      !Number.isSafeInteger(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      throw new RangeError(
        `Soft-target floor for ${role} must be an integer from 0 through 100.`,
      )
    }
  }

  return deepFreeze(merged)
}

export function getStrategyProfile(setId: string): StrategyProfile {
  if (!/^OP\d{2}$/.test(setId)) {
    throw new Error(`Invalid set id "${setId}". Expected an ID matching OP\\d{2}.`)
  }

  return mergeStrategyProfile(BASE_PROFILE, SET_OVERRIDES[setId])
}
