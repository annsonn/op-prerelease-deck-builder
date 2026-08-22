# OP17 General Value Model Design

## Status and scope

This is the umbrella design for the user-approved follow-up to the OP17 card
audit. It replaces text-presence heuristics with a structured, explainable
effect model, then uses that model to value cards in the existing greedy sealed
deck solver. It is deliberately split into four independently releasable
phases. Each phase must leave catalogs loadable, scoring deterministic, and the
application deployable before the next phase begins.

The checked-in OP17 English catalog is provisional. Card text, traits, and set
contents may change before release, so the design favors general rules and
repeatable catalog-backed calibration over card-number exceptions. Seeded pool
results are regression evidence for this engine; they are not measured or
predicted win percentages.

The fixed leader remains the all-color Rainbow Luffy used by the application.
Existing incompatibility rules for named, typed, or mono-color Leader clauses
remain hard constraints. No production rule may mention an OP17 card number,
card name, rarity, color, or set as a way to force a selection.

## Problem statement

The current `CardFeatures` model is a flat set of booleans derived from the
combined effect and Trigger text. That loses facts which materially change
sealed value:

- who receives an effect, as demonstrated by OP17-049 Charlotte Linlin being
  treated as though the player draws two cards;
- when an effect is available, so a Trigger-only action can look permanently
  active;
- whether text affects one, two, any number, or all targets;
- costs, duration, conditions, and alternative-choice ownership;
- actions such as Event counters, lockdown, deployment, recursion, protection,
  Life movement, hand disruption, DON!! economy, counter auras, and Leader
  shielding;
- support predicates other than names and traits; and
- clause locality, causing one incompatible clause to hide or taint unrelated
  usable text.

The audit exposed the following concrete symptoms in 5,000 deterministic OP17
tournament pools under the then-current engine:

| Card | Observed Main inclusion when opened | Missing or distorted value |
| --- | ---: | --- |
| OP17-046 Gloriosa | 0 / 941 | bottom-deck removal without an explicit `opponent` token |
| OP17-063 Kaido | 2 / 926 | counter aura and `negate ... and K.O. that Character`; false unsupported-combo penalty |
| OP17-093 Monkey.D.Luffy | 0 / 954 | play a cost-2 Character from trash and conditional cost-12 Rush support |
| OP17-112 Charlotte Linlin | 122 / 906 | Life gain or opposing-Life pressure |
| OP17-118 Rocks.D.Xebec | 52 / 481 | multi-deploy totaling nine cost |
| OP17-065 Queen | 99 / 2393 | two-target attack lock through the opponent's next turn |
| OP17-119 Loki | 328 / 546 | `any number` removal flattened to ordinary removal |

The same audit found missed value on OP17-114 The 3 Sweet Commanders,
OP17-054 Miss Buckingham Stussy, OP17-043 Ganzui, and OP17-080 Usopp. Nearly
all Events were effectively unselectable because a zero-power Event receives
Character body-efficiency treatment while its `[Counter]` text receives no
defensive value. Conversely, OP17-049 Charlotte Linlin was selected in about
99.9% of applicable pools because the opponent's draw branch was misclassified
as the player's draw.

These observations are calibration inputs, not permanent inclusion quotas.

## Considered approaches

### 1. Add more feature booleans

This is the smallest change and matches the existing implementation. It would
add flags such as `lifeGain`, `lockdown`, and `multiDeploy`, followed by one
weight per flag.

The approach is shallow: every new wording requires another public flag, while
subject, quantity, timing, costs, and choice semantics remain duplicated across
detectors and scoring. It would recreate the Shanks problem with a larger list
of equally flat effects. It is not recommended.

### 2. Add reviewed card or card-pattern overrides

Overrides can produce accurate rankings quickly and can document expert card
judgment. They would also make provisional OP17 data easy to patch.

However, overrides are costly to maintain, do not improve evaluation of future
sets, conceal why a card is strong, and easily become card-number hardcodes.
They are explicitly excluded from production selection logic. A future catalog
review workflow may attach structured annotations conforming to the same
interface, but that is outside this design.

### 3. Parse structured effect instances and score them through one module

This is the recommended approach. A parser converts printed clauses into small,
typed effect instances that retain activation, subject, conditions, costs,
branches, targets, and duration. A deep valuation module consumes only those
instances plus the deck/pool state and strategy profile. In Phase 2, existing
booleans become a compatibility summary derived from the instances; Phase 1
keeps their current derivation so adding the representation cannot change deck
selection by itself.

This costs more initially, but it creates a stable seam: new wording is handled
inside parsing, and new calibration is handled inside profiles. Callers and
tests do not need to understand regular expressions or card-text grammar. It
also gives enough structure to distinguish opponent draw from player draw and
Trigger-only removal from an On Play effect without building a complete game
simulator.

## Architecture and stable interfaces

The design introduces two deep modules behind a small interface:

1. `classifyCardFeatures(card)` parses a card and returns canonical runtime
   `CardFeatures` version 2. Parsing, clause inheritance, Rainbow compatibility,
   and legacy summary flags stay inside this module.
2. `valueCardEffects(candidate, state, poolSupport, profile)` returns a frozen,
   reconcilable effect valuation. Marginal scoring consumes its total and
   explanations without inspecting rules text.

Conceptually, the canonical interfaces are:

```ts
type EffectSource = 'effect' | 'trigger'

type ActivationChannel =
  | 'static'
  | 'onPlay'
  | 'main'
  | 'activateMain'
  | 'counter'
  | 'trigger'
  | 'onKo'
  | 'whenAttacking'
  | 'onBlock'
  | 'onOpponentsAttack'

type TimingModifier =
  | 'oncePerTurn'
  | 'yourTurn'
  | 'opponentsTurn'
  | 'thisTurn'
  | 'untilOpponentsNextEndPhase'

type EffectSubject =
  | 'player'
  | 'opponent'
  | 'thisCard'
  | 'bothPlayers'
  | 'unknown'
type EffectChooser = 'player' | 'opponent' | 'none'

interface CardPredicate {
  readonly names: readonly string[]
  readonly traits: readonly string[]
  readonly cardTypes: readonly ('LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE')[]
  readonly minimumCost: number | null
  readonly maximumCost: number | null
  readonly minimumPower: number | null
  readonly maximumPower: number | null
  readonly counter: 'any' | 'hasCounter' | 'withoutCounter'
  readonly hasTrigger: boolean | null
}

interface TargetSpec {
  readonly subject: EffectSubject
  readonly zones: readonly ('deck' | 'hand' | 'field' | 'trash' | 'life')[]
  readonly quantity: number | 'all' | 'anyNumber'
  readonly predicate: CardPredicate
  readonly differentNames: boolean
  readonly totalCostMaximum: number | null
  // True only when the printed wording explicitly allows the candidate to
  // satisfy its own target/support requirement.
  readonly allowsSelf: boolean
}

type RequirementExpression =
  | { readonly kind: 'always' }
  | { readonly kind: 'all'; readonly children: readonly RequirementExpression[] }
  | { readonly kind: 'any'; readonly children: readonly RequirementExpression[] }
  | {
      readonly kind: 'cards'
      readonly target: TargetSpec
      readonly minimumCount: number
    }
  | {
      readonly kind: 'leader'
      readonly names: readonly string[]
      readonly traits: readonly string[]
      readonly monoColorRequired: boolean
    }
  | { readonly kind: 'selfState'; readonly state: 'playedThisTurn' }
  | { readonly kind: 'unknown'; readonly normalizedText: string }

type EffectCost =
  | { readonly kind: 'playEventDon'; readonly amount: number }
  | { readonly kind: 'donMinus'; readonly amount: number }
  | { readonly kind: 'restDon'; readonly amount: number }
  | { readonly kind: 'discardHand'; readonly amount: number }
  | { readonly kind: 'trashSelf' }
  | { readonly kind: 'restSelf' }

type EffectAction =
  | { readonly kind: 'keyword'; readonly keyword: 'blocker' | 'rush' | 'banish' }
  | { readonly kind: 'draw'; readonly subject: EffectSubject; readonly amount: number }
  | { readonly kind: 'filter'; readonly subject: EffectSubject; readonly lookedAt: number; readonly kept: number; readonly target: TargetSpec }
  | { readonly kind: 'remove'; readonly mode: 'ko' | 'bottomDeck' | 'returnHand' | 'rest' | 'powerReduction'; readonly target: TargetSpec; readonly powerDelta: number | null }
  | { readonly kind: 'negateEffect'; readonly target: TargetSpec }
  | { readonly kind: 'lockAttack'; readonly target: TargetSpec; readonly duration: TimingModifier }
  | { readonly kind: 'deploy'; readonly target: TargetSpec }
  | { readonly kind: 'protect'; readonly target: TargetSpec }
  | { readonly kind: 'lifeMove'; readonly direction: 'gainOwnLife' | 'opponentLifeToHand'; readonly amount: number }
  | { readonly kind: 'handDiscard'; readonly subject: EffectSubject; readonly amount: number }
  | { readonly kind: 'donChange'; readonly mode: 'refresh' | 'rampActive' | 'rampRested'; readonly amount: number }
  | { readonly kind: 'counterModifier'; readonly amount: number; readonly target: TargetSpec }
  // `powerDelta` is an increase/reduction from the printed base, never the
  // resulting absolute power printed after "becomes".
  | { readonly kind: 'powerModifier'; readonly powerDelta: number; readonly target: TargetSpec; readonly duration: TimingModifier }
  | { readonly kind: 'leaderBasePower'; readonly powerDelta: number; readonly duration: TimingModifier }
  | { readonly kind: 'unknown'; readonly normalizedText: string }

interface EffectBranch {
  readonly actions: readonly EffectAction[]
}

interface EffectInstance {
  readonly id: string // stable source + clause index, not a card-number rule
  readonly source: EffectSource
  readonly activation: ActivationChannel
  readonly timing: readonly TimingModifier[]
  readonly condition: RequirementExpression
  readonly costs: readonly EffectCost[]
  readonly chooser: EffectChooser
  readonly optional: boolean
  readonly branches: readonly EffectBranch[]
  readonly rainbowLuffyCompatibility: 'compatible' | 'neutral' | 'incompatible'
}

interface CardFeatures {
  readonly effectModelVersion: 2
  readonly effectParserRevision: 1
  readonly effects: readonly EffectInstance[]
  readonly unparsedClauses: readonly string[]
  // Existing flags, Rainbow-usable flags, support summaries, compatibility,
  // search targets, requirements, and evidence remain during migration.
}

interface EffectContribution {
  readonly effectId: string
  readonly grossValue: number
  readonly costValue: number
  readonly activationFactor: number
  readonly conditionSupportFactor: number
  readonly actions: readonly ActionContribution[]
  readonly categoryValues: Readonly<Record<PremiumCategory, number>>
  readonly netValue: number
  readonly reason: string
}

interface ActionContribution {
  readonly effectId: string
  readonly branchIndex: number
  readonly actionIndex: number
  readonly category: PremiumCategory | null
  readonly rawGrossValue: number
  readonly targetSupportFactor: number
  readonly effectiveTargetCount: number
  readonly cappedGrossValue: number
  readonly activation: ActivationChannel
  readonly conditionSupportFactor: number
  readonly supportDependent: boolean
  readonly allocatedCostValue: number
  readonly netValue: number
  readonly chooser: EffectChooser
  readonly rainbowLuffyCompatibility: 'compatible' | 'neutral' | 'incompatible'
  readonly reason: string
}

type PremiumCategory =
  | 'pressure'
  | 'interaction'
  | 'cardAdvantage'
  | 'lifeAdvantage'
  | 'donAdvantage'
  | 'durableDefense'

interface EffectValuation {
  readonly total: number
  readonly contributions: readonly EffectContribution[]
  readonly premiumImpact: number
  readonly premiumCategories: readonly PremiumCategory[]
}
```

The exact TypeScript may split these declarations into focused files, but the
external seam must preserve these semantics. Results are deeply frozen,
ordered by printed occurrence, finite, and deterministic. `unknown` is a real
safe result, not an exception and not positive value. `effectModelVersion`
versions the serialized shape; `effectParserRevision` versions the parser's
semantics. A runtime may reuse serialized effects only when both values match
its current implementation and the effects plus diagnostics are semantically
equal to one fresh current parse of the printed card. Any payload mismatch
falls back to the complete fresh classification so runtime effects and derived
projections cannot form a hybrid. Derived flags and support summaries are
never authoritative serialized inputs.

An `EffectInstance` groups sequential actions that share one activation,
condition, and cost. This prevents a cost such as `DON!!-1` from being deducted
once per action. `branches` preserves `choose one` behavior: player choices use
the highest-valued branch, opponent choices use the lowest-valued branch, and
ordinary sequential text has one branch containing all its actions. Actions
printed before `choose one` are common actions and are duplicated into every
branch in canonical output so they are resolved exactly once whichever branch
is chosen.

Instance-condition availability and action-target availability are separate.
For example, OP17-118's On Play instance is unconditional: its draw remains
fully available while only its deploy action is discounted by available Rocks
Pirates. `ActionContribution` preserves that distinction and also provides the
category-level evidence required for premium qualification. Shared cost is
deducted once from the instance, then allocated proportionally across the
chosen branch's positive gross action values. If every chosen action is
non-positive, the shared cost is assigned to the first printed action. This
keeps the instance total, action totals, and category totals reconcilable.

## Phase 1: clause and effect-context parsing

### Deliverable

Add canonical effect-model version 2 and populate structured instances without
changing solver scores. The existing summary flags continue to drive current
behavior for this phase and retain their current values. Version-2 effects and
parser diagnostics are additive metadata until the Phase 2 cutover.

The parser first normalizes punctuation and annotations, then tokenizes effect
text and Trigger text separately. It carries only explicit context across
printed continuations:

- bracketed activation and timing annotations apply until replaced by another
  activation block;
- `Then` inherits the preceding activation, condition, and already-paid cost;
- bullets inherit the immediately preceding `choose one` chooser and context;
- actions before `choose one` are common to, and copied into, every resulting
  branch;
- a colon separates activation costs from results;
- Trigger-field text always has `source: 'trigger'` and activation `trigger`,
  even when it contains an action that resembles On Play text.

An unannotated continuous or conditional clause defaults to `static`; it does
not inherit the previous bracketed activation. A timing annotation printed
before an activation annotation, such as `[Your Turn] [On Play]`, belongs to
that activation instance. The parser represents `negate the effect of ...` as
its own opponent-target action even when a following `K.O. that Character`
shares the same target. Text saying power "becomes N" is normalized to a
power delta, never stored as an N-point bonus. For the fixed 5000-power Rainbow
Luffy, "your Leader's base power becomes 6000" therefore produces a +1000
Leader-base-power delta. When target text states its original base power, the
parser subtracts that printed predicate value; otherwise an unresolved
absolute-power change remains diagnostic rather than receiving optimistic
value.

Explicit subjects win. An omitted subject is inherited only when grammar makes
it unambiguous. In particular, `Your opponent chooses one: Draw 2 cards` gives
the draw action an `opponent` subject. If the subject cannot be determined, it
is `unknown` and earns no positive value. The parser does not silently default
an unqualified draw to the player.

Rainbow compatibility is calculated per effect instance. A specific Leader
name or trait condition, or a mono-color Leader requirement, makes only that
condition's actions incompatible with Rainbow Luffy. Independent unconditional
or generally worded clauses remain usable. A summary Rainbow flag is true when
at least one compatible or neutral instance supplies it; an incompatible
occurrence cannot make a usable occurrence false. This preserves existing
Rainbow restrictions while fixing clause-wide suppression.

Parsing is intentionally conservative:

- `K.O. that Character` may resolve only to the target introduced in the same
  effect instance;
- `owner's deck` removal may be attributed to the opponent only when the target
  is an opponent target or the effect is an unambiguous removal from the
  opponent's board;
- `all`, `any number`, and printed numeric quantities stay distinct;
- costs never become positive actions;
- unknown conditions are retained and later receive zero support availability;
- no recursive simulation of `Trigger: Play this card` plus the card's On Play
  text occurs. Trigger deployment gets its own discounted tempo value later;
  the On Play instance is scored once as normal printed access.

### Phase gate

Golden parser tests cover every activation channel, subject inheritance,
`Then`, bullet choices, shared costs, target quantities, duration, and
clause-specific Rainbow compatibility. They also cover unannotated static
clauses, common actions before a choice, explicit-self support, negation, and
absolute-to-delta base-power wording. Exact OP17 tests must establish:

- OP17-049 produces an opponent-choice group whose draw subject is opponent;
- OP17-063 emits negation and K.O. actions that resolve `that Character` to the
  same cost-6-or-less opposing target;
- OP17-065 produces draw plus two-target lockdown with a shared `DON!!-1` cost;
- OP17-112 duplicates its common draw into both Life-choice branches;
- OP17-114 keeps effect text and Trigger deployment as separate instances;
- OP17-043 records a +1000 Leader base-power delta rather than +6000; and
- an incompatible Leader clause does not suppress an adjacent unconditional
  clause.

Solver snapshots and catalog-backed deck results must remain unchanged in this
phase.

## Phase 2: general effect value and scoring

### Deliverable

Make `valueCardEffects` the sole source of generic effect-quality score. The
existing `effectQuality` marginal-score component remains for UI and snapshot
compatibility, but its number becomes the sum of structured contributions.
Flat broad-effect booleans remain role-coverage and redundancy summaries; they
are not added again to effect value.

At this cutover, summary semantics become subject-aware. `draw` means a
compatible player draw, not any printed `draw` token. `removal` covers
compatible K.O., bottom-deck, return-to-hand, rest, or power-reduction board
control. Interaction coverage is computed directly from compatible,
positive-value draw, removal, lockdown, hand-disruption, or Life-pressure
instances instead of only `draw || removal`. Other legacy flags retain their
documented meanings. This lets lockdown contribute to the interaction target
without adding another public boolean, and prevents OP17-049's opponent draw
from satisfying the player's draw or interaction coverage.

Events no longer receive Character body-efficiency scoring. A Character uses
the existing printed body formula, an Event uses zero body value, and a Stage
keeps zero until Stage-specific utility is modeled. Event `[Counter]` actions
receive their structured defensive value.

For an Event, `[Main]`, `[Counter]`, and Trigger are mutually exclusive ways to
use the same physical card. The evaluator calculates each activation group's
net value and keeps the highest one; it does not add all modes together.
`[Main]` and `[Counter]` pay an implicit `playEventDon` cost equal to the
printed Event cost, while a Trigger does not pay that printed cost unless its
text declares another cost. Character printed cost remains represented by body
efficiency and curve scoring and is not deducted again from its effects.

These are the initial profile defaults in current solver score units. They are
calibration policy, not claims about game-state probability:

| Action | Gross value before availability and costs |
| --- | ---: |
| own draw | `+2.0` per card |
| opponent draw | `-2.0` per card |
| filtering | `+1.0` per kept card plus `+0.25` per extra card seen, capped at `+2.5` |
| opponent hand discard | `+2.5` per card |
| Event/Counter power | `+2.0` per 1000 power |
| K.O. | `+4.0` base |
| bottom-deck removal | `+4.5` base |
| return to hand | `+3.0` base |
| rest | `+1.5` base |
| negate an opposing Character's effect | `+1.5` base |
| power reduction | `+0.75` per 1000 power per effective target |
| cannot-attack lockdown | `+2.5` base per effective target |
| deploy | `+1.5` per card plus `+0.5` per maximum cost saved, total capped at `+9.0` |
| deploy from trash | deploy value plus `+1.0` recursion access |
| replacement protection | `+3.0` base before its payment |
| gain own Life | `+5.0` per card |
| opposing Life to hand | `+3.0` per card |
| refresh DON!! | `+1.5` per DON!! |
| ramp active / rested DON!! | `+2.0` / `+1.25` per DON!! |
| counter aura | `+1.0` per 1000 per expected eligible card, capped at `+6.0` |
| own power modifier | `+0.75` per 1000 per effective target |
| Leader base-power shield through the opposing turn | `+4.0` per 1000 |
| Rush / Banish / Blocker keyword | existing `+1.0` broad-effect value |

Known target multiplicity modifies removal, lockdown, and power effects once:
one target is `1.0`, two targets is `1.75`, three or more known targets is
`2.25`, and `all` or `anyNumber` is `2.5`. A printed cost ceiling modifies
interaction by `0.55` for cost 0-2, `0.75` for cost 3-4, `0.90` for cost 5-6,
and `1.0` for cost 7 or unrestricted. This gives Loki's `any number totaling
cost 4` more value than ordinary single-target removal without treating it as
unrestricted board wipe.

`untilOpponentsNextEndPhase` multiplies lockdown and protection by `1.25`;
shorter current-turn effects use `1.0`. Values are capped per printed effect
instance at `+12` before activation and support factors so `all` wording cannot
grow without bound.

Costs use these initial values and are deducted once per effect instance:

| Cost | Value |
| --- | ---: |
| printed Event DON!! cost for Main/Counter use | `1.0 × N` |
| `DON!!-N` | `1.5 × N` |
| rest DON!! | `1.0 × N` |
| discard from own hand | `2.0 × N` |
| trash this Character | `1.5` |
| rest this Character | `1.0` |

An optional activation contributes `max(0, gross - cost)`. A mandatory adverse
effect retains its negative value. A player choice uses the best branch; an
opponent choice uses the worst branch from the player's perspective. This
corrects OP17-049 rather than awarding both possible outcomes.

Each action's raw gross is first multiplied by its action-target support factor.
Branch ownership is resolved from those target-adjusted values, so an
unsupported deploy cannot win a branch or dilute an independent draw. If the
chosen branch exceeds the instance cap, scale its positive target-adjusted
action values proportionally while retaining adverse values. With positive
subtotal `P` and non-positive subtotal `N`, the scale is
`(effectInstanceCap - N) / P`; assign rounding residue to the last positive
action. Its one shared cost is then allocated
across those capped positive values proportionally. When no action is positive,
the first printed action receives the full cost. Finally, instance activation
and condition-support factors apply to the action nets. This ordered accounting
keeps action totals equal to the instance total while deducting cost exactly
once, and keeps category totals traceable to the positive premium subset.

`categoryValues` contains every `PremiumCategory` key in canonical order. Sum
signed selected action nets inside each category. If the instance net is not
positive, every category value is zero. Otherwise, take the positive category
subtotals and scale them proportionally so their sum equals the positive
instance net; assign rounding residue to the last positive category. Thus
mandatory adverse actions reduce premium impact rather than disappearing,
while every category remains traceable to its selected actions.

Activation availability multiplies the net result:

| Channel | Factor |
| --- | ---: |
| On Play | `1.00` |
| Event Main | `1.00` |
| static/continuous | `0.80` |
| Activate: Main | `0.75` |
| When Attacking | `0.70` |
| Counter | `0.65` |
| On opponent's attack / On Block | `0.60` |
| On K.O. | `0.50` |
| Trigger | `0.35` |

These factors express access, not strength after resolution. They prevent
Trigger-only removal from receiving full-time interaction credit. The factor
and every raw/cost value appear in `EffectContribution`, keeping totals
auditable.

Phase 2 supports unconditional and self-timing conditions. A dynamic condition
that Phase 3 cannot yet evaluate has support factor zero rather than receiving
optimistic value or the old generic combo penalty. Name/trait search support
may continue through the current matcher until Phase 3 replaces it.

An Event with a missing printed cost does not receive a free Main or Counter
mode. Those modes have availability zero with an explicit diagnostic; a direct
Trigger mode may still be valued because it does not pay the printed Event
cost.

### Phase gate

Unit tests reconcile every table row, multiplier, cap, shared cost, activation
factor, optional clamp, and chooser rule. Catalog-backed semantic and scoring
tests require:

- Gloriosa has compatible bottom-deck interaction value;
- Queen receives draw, two-target long-duration lockdown, Banish, and one
  shared DON!! cost;
- Loki's any-number removal is worth more than equal-cost single-target K.O.;
- The 3 Sweet Commanders receives draw, Life gain, two-target power reduction,
  and a separately discounted Trigger deployment;
- Miss Buckingham Stussy receives repeatable lockdown value;
- Ganzui receives Leader shielding and protection value;
- OP17-049 receives no own-draw flag or own-draw value, and its opponent-choice
  branch is evaluated conservatively; and
- every Rainbow-usable OP17 Event with unconditional `[Counter] +3000` or
  `[Counter] +4000` text has positive controlled-fixture marginal value.

## Phase 3: dynamic support predicates and controlled aliases

### Deliverable

Replace name/trait-only `SupportRequirement` matching with
`RequirementExpression` plus `CardPredicate`. The matcher evaluates both
selected-deck support and remaining pool potential without exposing parser
details to marginal scoring.

Supported predicates include exact or included name, trait, card type, minimum
and maximum cost, minimum and maximum power, presence of Trigger, and
counter-bearing versus counterless cards. Supported zones are deck, hand,
field, trash, and Life. The deck builder does not know an actual game state, so
zone access is an explicit conservative factor rather than a simulated fact:

| Required source zone | Factor |
| --- | ---: |
| deck | `1.00` |
| hand | `0.75` |
| field | `0.65` |
| trash | `0.55` |
| Life | `0.25` |

When a target may come from more than one printed zone, use the maximum of the
listed zone factors. The target is accessible through any one allowed route;
factors are not added. An opponent-board condition is never matched against
the player's pool and uses the conservative profile factor `0.50` when its
subject and predicate are otherwise safely parsed. Unknown opponent conditions
remain zero.

Support is still dynamic. For a required target count `T`, selected support and
eligible remaining pool support each contribute half of the available ratio:

```text
supportFactor = zoneFactor × min(1, (selected + 0.5 × poolPotential) / T)
```

`poolPotential` means genuinely remaining physical copies. For each card
number, subtract selected copies from original pool quantity, then subtract the
currently scored candidate copy unless `allowsSelf` is true. Clamp every
remaining quantity at zero. This prevents selected support from being counted
again at half weight. `allowsSelf` is part of canonical v2 from Phase 1 and is
true only for explicit self-reference.

Instance conditions and action targets are evaluated separately. A condition
factor applies to all actions in the instance; a filter, deploy, aura, or other
support-dependent action receives an additional target-support factor based on
its own `TargetSpec`. Independent draw or Life actions in the same instance do
not inherit the deploy/search target factor. The parser therefore creates a
`RequirementExpression` only for printed activation wording such as "if" or
"when"; it must not copy an action's eligible output target into the instance
condition, which would apply the same support twice and suppress sibling
actions.

`differentNames`, total-cost ceilings, and quantity limits are honored by an
exact deterministic dynamic program. Sort eligible physical copies by card
number; when `differentNames` is true, group choices by normalized name and
take at most one option from each group. Advance states by `(usedCount,
totalCost)` up to requested count and total-cost ceiling, retaining the
lexicographically smallest card-number sequence for equal states. A null-cost
card is ineligible when a total-cost ceiling must be enforced. Select greatest
used count, then greatest total cost, then lexicographically smallest sequence.
Without a printed total-cost ceiling, use the finite eligible-pool cost sum as
the DP bound. This avoids exponential subset enumeration while remaining exact
for the 72-card pool. Unsupported opponent-board conditions never create a
pool-based combo bonus.

The target-support result exposes selected count, remaining-pool count,
constrained capacity, effective target count, factor, and reason. Deploy saved
cost and aura raw magnitude come from printed quantities/ceilings and their
existing action caps; the reconciled target factor discounts that theoretical
value exactly once using constrained capacity and weighted remaining support.
`effectiveTargetCount` is retained as explanation evidence, not multiplied a
second time. The caller supplies a positive requested count: printed deploy
quantity, filter/search kept quantity, or the eligible-card count needed to hit
an aura's configured cap. The evaluator never independently rescans the
original pool.

Trait matching uses exact normalized values plus one controlled alias table.
For the current provisional data, `Elbaf` and `Elbaph` map to the canonical
comparison key `elbaph`. The alias is symmetric for matching but does not
rewrite displayed card text, catalog provenance, or exported traits. No fuzzy,
substring, edit-distance, or phonetic matching is allowed. Adding another
alias requires a positive pair test and negative near-match tests.

The old `requiredNames`, `requiredTraits`, `searchableNames`,
`searchableTraits`, and `supportRequirementsByFlag` fields remain derived
summaries during migration. New scoring uses the structured requirement on the
effect instance only, avoiding a generic `comboDependent` penalty when a valid
numeric, Trigger, Counter, type, power, or zone predicate was parsed.

### Phase gate

Predicate unit tests cover every field, conjunction/disjunction, quantities,
self-exclusion, selected/pool weighting, zones, and the exact controlled alias.
Negative tests prove that `Elbaf` does not match arbitrary Elbaph-like text.
Catalog-backed tests require:

- Kaido's counter aura finds counterless Characters and its played-this-turn
  removal receives no false unsupported-combo penalty;
- OP17-093 Luffy measures cost-12-or-more support for Rush and cost-2-or-less
  Character support from trash for deployment;
- OP17-112 Linlin measures Trigger-bearing 4000-power Characters while Life
  actions remain independently usable;
- OP17-118 Xebec measures up to two different-name Rocks Pirates totaling cost
  nine or less;
- OP17-080 Usopp finds `Elbaph` catalog cards through the controlled `Elbaf`
  alias; and
- a named- or typed-Leader requirement remains incompatible with Rainbow
  Luffy even when the pool contains matching Characters.

## Phase 4: generalized first-copy premium impact and OP17 calibration

### Deliverable

Replace the current exact `boss + rush + massRest + donRefresh` predicate with a
general impact calculation derived from structured effect contributions. The
ordinary effect score remains card-state dependent. Premium impact is the
positive, pre-redundancy value of compatible printed effects after activation,
cost, and support factors, grouped into independent categories:

- immediate attack or board pressure;
- interaction or lockdown;
- card advantage or deployment;
- Life advantage;
- resource advantage from DON!!;
- durable defense, protection, counter aura, or Leader shielding.

A first copy qualifies for the existing profile floor only when all of these
are true:

1. it is a Character and is either an existing `boss` or costs at least 6;
2. premium impact reaches the initial profile threshold of `7.5`;
3. at least two independent categories each contribute at least `2.0`;
4. at least one category is available through On Play, static, Activate: Main,
   When Attacking, or Counter rather than only through Trigger;
5. every contribution used for qualification is Rainbow-compatible;
6. support factor for every support-dependent qualifying contribution is at
   least `0.50`; and
7. the qualifying value is not solely an opponent-choice branch.

For condition 6, an effect contribution is premium-eligible only when its net
is positive and every positive support-dependent action inside it has combined
condition/target support at least `0.50`. If one such action is below the
threshold, exclude the whole contribution from premium impact so its shared
cost and adverse effects are never split away; ordinary effect scoring remains
action-specific and unchanged. Eligible contributions from all remaining
effect instances are then aggregated once across the card before applying the
impact and category gates.

The first-copy marginal-score floor remains `15`. The floor is a non-negative
adjustment after ordinary positive and negative scoring; it does not bypass the
greedy solver or force insertion. Second and later copies receive no floor and
retain brick, curve, role-saturation, and repeated-effect penalties.

This replaces the card-shaped Shanks predicate without weakening its existing
behavior: OP17-022 continues to qualify through immediate Rush, mass rest, and
DON!! refresh. Cards with one large but narrow effect, conditional effects with
insufficient pool support, or Trigger-only upside do not automatically qualify.
Rarity and card identity are never inputs.

The initial `7.5` threshold is the highest one-decimal general threshold that
retains the already accepted Shanks behavior under the same tables: Rush
`1 x 0.80 = 0.80`, refresh two DON!! `2 x 1.5 = 3.00`, and rest-all
`1.5 x 2.5 = 3.75`, totaling `7.55` across pressure, DON!! advantage, and
interaction. This is general profile calibration, not a card-identity rule.

The profile gains named effect weights, availability factors, target/duration
multipliers, zone factors, `opponentBoardConditionFactor: 0.50`,
`premiumImpactThreshold: 7.5`,
`premiumCategoryMinimum: 2`, and `premiumBombFirstCopyFloor: 15`. All must be
finite and non-negative; bounded factors must be in `[0, 1]`; target
multipliers and the effect-instance cap must be positive. Defaults apply to all
sets. OP17 overrides are allowed only from documented seeded calibration and
must not alter parsing.

### Empirical acceptance

Before Phase 1 production work, use engine commit `1aa63a5` and the checked-in
catalog bytes to capture the same 5,000 deterministic tournament-pool seeds
used by the audit. Record the OP17 and OP16 catalog checksums, profile, exact
gated-card opened/Main counts, raw guardrail counts where exposed, and the
evaluator's exact reported deck averages in an immutable fixture. The docs-only
design commit `2f7ed4b` is code-equivalent, but `1aa63a5` is the named code
baseline. Final after-rates must use the same fixture and seeds so a catalog
refresh cannot masquerade as an engine
change. The existing evaluator's `BasicDeckSolver` column is not this baseline;
the fixture must come from the pre-upgrade `StrategyDeckSolver`.

The captured checksums are OP17
`80185f046091d3def85245b291df31e81b349508adb29842152393c743632a52`
and OP16
`d98327c9708ef94aa3180de5cfea058d37a01e3825774748f7bff8536773d1f7`.
The immutable Phase-0 plan fixture owns the exact gated OP17 card/Event counts.
The OP16 5,000-seed Strategy V2 baseline has averages: size 40, 2K 13.00,
blocker 8.67, vanilla-like 5.75, interaction 12.23, boss 3.98, counter
49398.80, bricks 3.60, early 16.04, middle 14.81, and high 9.15; reachable
misses are 2K 158, blocker 603, vanilla-like 2534, interaction 0, and boss
3262, with zero decks below both 24,000 and 30,000 counter thresholds.

- For Gloriosa, Kaido OP17-063, Luffy OP17-093, Linlin OP17-112, Xebec
  OP17-118, and Queen OP17-065, Main inclusion when opened must improve by at
  least 20 percentage points from the recorded baseline. A card that reaches
  at least 60% satisfies this directional gate even if the exact baseline was
  regenerated from a changed provisional catalog.
- Loki OP17-119, The 3 Sweet Commanders, Miss Buckingham Stussy, and Ganzui may
  not regress by more than two percentage points; controlled fixtures must
  show the newly modeled contribution. Loki's multi-target contribution must
  exceed an otherwise identical single-target effect.
- At least half of the distinct Rainbow-usable OP17 Events with unconditional
  +3000 or +4000 Counter text must have a non-zero Main inclusion rate when
  opened, and each must have positive controlled-fixture value. Events with
  incompatible Leader conditions or net-negative costs are not forced in.
- OP17-049 Linlin must fall by at least 20 percentage points from its recorded
  1636 / 1640 baseline and must be at or below 80%, proving that the
  opponent-draw correction changes decisions without banning the card.
- OP17-022 Shanks must retain the existing bounded 1,000-seed guarantee: every
  sampled pool containing it puts at least one copy in Main. Extra copies are
  not guaranteed.

The complete solver must still build exactly 40 cards, conserve every physical
pool copy across Main and Sideboard, and produce byte-for-byte deterministic
results for a fixed catalog/profile/seed. A parallel 5,000-seed OP16 guardrail
must show no more than a two-percentage-point regression in counter, boss,
blocker, or vanilla-like target misses, no more than a one-percentage-point
increase in decks below either configured 24,000 neutral or 30,000 strength
total-counter threshold, and no more than `+0.25` average bricks. Any failed
guardrail requires an explicit profile calibration decision; it must not be
hidden by weakening the test.

## Catalog migration and compatibility

The outer catalog manifest remains schema version 1 because artifact names,
card fields, and set-content structure do not change. The nested feature model
is independently versioned with required `effectModelVersion: 2`.

The catalog schema accepts:

- canonical version-2 parse metadata with complete strict instances and the
  current `effectParserRevision`;
- the current premium-feature shape;
- pre-premium and earlier supported legacy shapes already accepted today; and
- no feature metadata.

Strict parsing continues to reject unknown keys, partial version-2 instances,
invalid numbers, or mixed shapes. The runtime loader exposes only canonical
version-2 `CardFeatures`. It reuses serialized effects only when
`effectModelVersion` and `effectParserRevision` match the runtime and both the
effects and diagnostics are semantically equal to one fresh current parse. Any
semantic mismatch, accepted prior revision, or legacy shape reclassifies from
the current card's printed effect and Trigger text; an unknown future revision
or malformed shape is rejected. Flags, Rainbow-usable summaries, support
summaries, compatibility summary, and evidence always come from that same
fresh current classification, so serialized metadata cannot create a hybrid
runtime model. It does not mutate the serialized strategy suggestion.
Current checked-in catalogs therefore work immediately without a bulk rewrite;
the next normal catalog build emits canonical version 2 with parser revision
1.

This migration logic belongs behind one adapter such as
`upgradeSerializedCardFeatures(card, serialized)`. Callers must not branch on
legacy shapes. The adapter and canonical outputs are deeply frozen. A grammar
change after Phase 1 must increment `effectParserRevision`, retain the prior
revision as accepted input, and reparse it at runtime; silently changing parser
semantics under the same revision is forbidden. Once all checked-in and
deployed catalogs have been regenerated, removing legacy input variants can be
considered in a separate schema-version change; it is not part of this work.

## Safety and false-positive rules

- Unknown action, subject, condition, quantity, or target produces no positive
  value and remains visible in parser diagnostics.
- A negative effect on the player and a benefit to the opponent retain negative
  value when mandatory; they are never reclassified as player benefit.
- Costs are attached and deducted once from the effect instance that pays them.
- Trigger actions remain separate and discounted. The evaluator does not
  recursively simulate chains or future turns.
- Quantity, target, deploy, aura, and per-instance caps prevent `all`, `any
  number`, or broad trait text from producing unbounded scores.
- An effect occurrence is scored once. Derived summary flags cannot add the
  same value again.
- Clause-specific Rainbow incompatibility is a hard zero for that contribution
  and for premium qualification. Pool support cannot make a Leader-incompatible
  effect usable.
- Trait aliases are explicit exact pairs used only for comparison.
- Parser false negatives are preferred to optimistic false positives. New
  official wording requires positive, negative, and catalog-backed tests.
- Every score remains the finite sum of named, ordered, explainable
  contributions.

## Test strategy

Each phase follows test-driven development and has four test layers:

1. **Parser contracts:** table-driven positive and negative wording, clause
   context, strict schemas, freezing, deterministic order, and unknown fallback.
2. **Valuation contracts:** exact arithmetic for action weights, availability,
   support, choices, costs, caps, and premium qualification.
3. **Catalog-backed regressions:** exact structured semantics for the named
   OP17 examples, using the production catalog loader rather than duplicated
   card fixtures wherever practical.
4. **Seeded solver acceptance:** before/after inclusion rates and OP16
   guardrails, plus the complete test suite, lint, type checking, catalog
   validation, and production build.

The long 5,000-seed OP17 and OP16 tests declare an explicit 300,000 ms timeout
and reuse generated pool counts across baseline/final measurements. Unit and
catalog-semantic tests remain under the ordinary fast timeout.

Tests assert semantic causes as well as selection outcomes. An inclusion-rate
change alone cannot pass if the parser still attributes the wrong subject or
if unrelated profile inflation caused the change.

## Non-goals

- Simulating hands, Life order, board state, matchups, player decisions, or
  complete One Piece rules.
- Claiming a win-rate improvement from deterministic pool selection.
- Supporting non-English card text in this parser revision.
- Changing the greedy 40-slot solver, deck size, pool generator, UI workflow,
  or card image/catalog-source behavior.
- Adding card-number, rarity, set, color, name, or trait-specific selection
  overrides.
- Automatically including every Event, boss, Rush card, zero-counter finisher,
  or high-rarity card.
- Fuzzy trait matching or silently correcting displayed/source catalog data.
- Rebuilding every catalog only to populate the new nested feature model.
- Designing reviewed manual annotations, matchup profiles, telemetry, or user
  tuning controls.

## Delivery boundaries

The four phases are separate implementation plans and reviewable deliveries.
Phase 1 changes representation without scoring behavior. Phase 2 enables
unconditional general value. Phase 3 enables dynamic conditional synergy.
Phase 4 generalizes first-copy premium treatment and calibrates OP17 with OP16
guardrails. Later phases may depend on the stable interfaces from earlier
phases, but no phase may leave a partially authoritative catalog shape or a
mixed old/new scoring path.
