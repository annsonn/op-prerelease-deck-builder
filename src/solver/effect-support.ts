import type {
  CardPredicate,
  EffectSubject,
  RequirementExpression,
  TargetSpec,
} from '../../shared/card-effect-model.js'
import type { StrategyProfile } from '../strategy/strategy-profile.js'
import type { CardSupportEntry, DeckState, PoolSupport } from './deck-state.js'

export interface SupportResult {
  readonly factor: number
  readonly selectedCount: number
  readonly poolCount: number
  readonly effectiveTargetCount: number
  readonly reason: string
}

export function canonicalTraitKey(trait: string): string {
  const key = trait.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return key === 'elbaf' || key === 'elbaph' ? 'elbaph' : key
}

function matchesAny(values: readonly string[], actual: string, trait = false): boolean {
  return values.length === 0 || values.some((value) =>
    (trait ? canonicalTraitKey(value) === canonicalTraitKey(actual) : value === actual),
  )
}

export function matchesCardPredicate(card: CardSupportEntry, predicate: CardPredicate): boolean {
  if (!matchesAny(predicate.names, card.name)) return false
  if (predicate.traits.length > 0 && !card.traits.some((trait) => matchesAny(predicate.traits, trait, true))) return false
  if (predicate.cardTypes.length > 0 && !predicate.cardTypes.includes(card.cardType as never)) return false
  if (predicate.minimumCost !== null && (card.cost === null || card.cost < predicate.minimumCost)) return false
  if (predicate.maximumCost !== null && (card.cost === null || card.cost > predicate.maximumCost)) return false
  if (predicate.minimumPower !== null && (card.power === null || card.power < predicate.minimumPower)) return false
  if (predicate.maximumPower !== null && (card.power === null || card.power > predicate.maximumPower)) return false
  if (predicate.counter === 'hasCounter' && (card.counter === null || card.counter <= 0)) return false
  if (predicate.counter === 'withoutCounter' && card.counter !== 0) return false
  if (predicate.hasTrigger !== null && predicate.hasTrigger !== card.hasTrigger) return false
  return true
}

function matchingCount(support: PoolSupport | DeckState, target: TargetSpec): number {
  return Object.values(support.cardSupportByNumber).reduce(
    (count, card) => count + (matchesCardPredicate(card, target.predicate) ? card.quantity : 0),
    0,
  )
}

function zoneFactor(target: TargetSpec, profile: StrategyProfile): number {
  return Math.max(...target.zones.map((zone) => profile.effectModel.zoneFactors[zone]), 0)
}

export function evaluateTargetSupport(
  target: TargetSpec,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): SupportResult {
  if (target.subject === 'opponent') {
    return Object.freeze({ factor: profile.effectModel.opponentBoardConditionFactor, selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: 'opponent-board support uses conservative profile factor' })
  }
  const selectedCount = matchingCount(state, target)
  const poolCount = matchingCount(poolSupport, target)
  const requested = typeof target.quantity === 'number' ? target.quantity : Math.max(1, Math.min(poolCount, 3))
  const available = selectedCount + poolCount - (target.allowsSelf ? 0 : 0)
  const factor = available <= 0 ? 0 : Math.min(1, available / requested) * zoneFactor(target, profile)
  return Object.freeze({ factor, selectedCount, poolCount, effectiveTargetCount: Math.min(requested, available), reason: factor === 0 ? 'no matching selected or pool targets' : 'matched printed targets' })
}

export function evaluateRequirementSupport(
  requirement: RequirementExpression,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): SupportResult {
  switch (requirement.kind) {
    case 'always': return Object.freeze({ factor: 1, selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: 'unconditional requirement' })
    case 'selfState': return Object.freeze({ factor: 1, selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: 'self-state requirement available' })
    case 'cards': {
      const result = evaluateTargetSupport(requirement.target, state, poolSupport, profile)
      return Object.freeze({ ...result, factor: result.effectiveTargetCount >= requirement.minimumCount ? result.factor : 0 })
    }
    case 'leader': return Object.freeze({ factor: 1, selectedCount: 0, poolCount: 0, effectiveTargetCount: 1, reason: 'Leader requirement conservatively available' })
    case 'all': {
      const results = requirement.children.map((child) => evaluateRequirementSupport(child, state, poolSupport, profile))
      return Object.freeze({ factor: Math.min(...results.map((result) => result.factor), 1), selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: results.map((result) => result.reason).join('; ') })
    }
    case 'any': {
      const results = requirement.children.map((child) => evaluateRequirementSupport(child, state, poolSupport, profile))
      return Object.freeze({ factor: Math.max(...results.map((result) => result.factor), 0), selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: results.map((result) => result.reason).join('; ') })
    }
    case 'unknown': return Object.freeze({ factor: 0, selectedCount: 0, poolCount: 0, effectiveTargetCount: 0, reason: 'unknown requirement is unavailable' })
  }
}

export function subjectIsSafe(subject: EffectSubject): boolean {
  return subject === 'player' || subject === 'thisCard' || subject === 'opponent'
}
