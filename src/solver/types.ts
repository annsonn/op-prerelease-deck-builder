import type { PlayableCard } from '../../shared/catalog.js'
import type { RuntimeCatalog } from '../catalog/load-catalog.js'
import type { DisplayCardColor } from '../card-colors.js'
import type { MeasuredRole } from './deck-state.js'

export type AllocatedRole =
  | 'twoKCounter'
  | 'blocker'
  | 'interaction'
  | 'pressure'
  | 'boss'
  | 'curve'

export interface DeckLine {
  card: PlayableCard
  quantity: number
  allocatedRoles: Readonly<Record<AllocatedRole, number>>
  score: number
  reasons: readonly string[]
}

export interface CostColorSegment {
  readonly color: DisplayCardColor
  readonly count: number
}

export interface CostColorBucket {
  readonly cost: number | null
  readonly total: number
  readonly segments: readonly CostColorSegment[]
}

export interface DeckInsight {
  readonly id: string
  readonly title: string
  readonly evidence: string
  readonly priority: number
}

export interface RoleMeasurement {
  readonly count: number
  readonly target: number | null
}

export interface DeckAnalysis {
  readonly costColorDistribution: readonly CostColorBucket[]
  readonly totalCounter: number
  readonly roleCoverage: Readonly<Record<MeasuredRole, RoleMeasurement>>
  readonly oddCostImportantPlays: number
  readonly evenCostImportantPlays: number
  readonly strengths: readonly DeckInsight[]
  readonly weaknesses: readonly DeckInsight[]
}

export interface GuideSection {
  readonly title: string
  readonly points: readonly string[]
}

export interface TurnOrderGuide extends GuideSection {
  readonly preference: 'first' | 'second' | 'flexible'
}

export interface SideboardSuggestion {
  readonly cardNumber: string
  readonly cardName: string
  readonly quantity: number
  readonly score: number
  readonly addressesInsightIds: readonly string[]
  readonly reason: string
}

export interface PlayGuide {
  readonly leader: 'Rainbow Luffy'
  readonly turnOrder: TurnOrderGuide
  readonly openingPriorities: GuideSection
  readonly corePlan: GuideSection
  readonly counterPlan: GuideSection
  readonly finishers: GuideSection
  readonly attackSequencing: GuideSection
  readonly sideboardSuggestions: readonly SideboardSuggestion[]
}

export interface DeckSolution {
  label: 'Basic sealed build' | 'Strategy sealed build'
  mainDeck: readonly DeckLine[]
  sideboard: readonly DeckLine[]
  mainDeckSize: 40
  curve: Readonly<Record<'0-2' | '3-4' | '5-6' | '7+', number>>
  totalCounter: number
  roleCoverage: Readonly<Record<AllocatedRole, number>>
  warnings: readonly string[]
  readonly analysis: DeckAnalysis
  readonly playGuide?: PlayGuide
  solverVersion: 'basic-v1' | 'strategy-v2'
  profileId: string
  profileVersion: number
}

export interface StrategyDeckSolution extends DeckSolution {
  label: 'Strategy sealed build'
  readonly playGuide: PlayGuide
  solverVersion: 'strategy-v2'
}

export interface DeckSolver {
  solve(
    catalog: RuntimeCatalog,
    counts: Readonly<Record<string, number>>,
  ): DeckSolution
}
