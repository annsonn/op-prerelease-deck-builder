# OP17 General Effect Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat broad-effect bonuses with deterministic, explainable structured effect valuation, including subject-aware draw, choice semantics, Event modes, interaction magnitude, activation availability, and resource costs.

**Architecture:** Add all calibration policy to `StrategyProfile` and put arithmetic in a pure `src/solver/effect-value.ts` module that consumes only canonical version-2 effect instances plus solver state. It emits reconciled instance and action contributions so shared costs, action-specific target support, and premium categories remain auditable. `marginal-score.ts` keeps the existing `effectQuality` component name but delegates its value and explanation to the new module; printed body scoring becomes card-type aware. Shared feature summaries remain derived compatibility signals for coverage, while selected positive structured contributions are the sole generic effect-quality and redundancy source.

**Tech Stack:** TypeScript 6, Vitest 4, existing Zod-backed v2 effect model, strategy profile, deck state, and greedy solver

**Prerequisite:** Complete and merge `docs/superpowers/plans/2026-08-21-op17-effect-context-parsing.md` with every Phase-1 gate green.

**Approved design:** `docs/superpowers/specs/2026-08-21-op17-value-model-design.md`

---

## Parser-revision protocol

If an acceptance failure requires a semantic parser change after Phase 1, first
write a RED parser test plus a RED migration test using the previous serialized
revision. Then update `CURRENT_EFFECT_PARSER_REVISION` and its strict schemas in
`shared/card-effect-model.ts`, retain the exact prior-revision input schema in
`shared/catalog.ts`, and make `src/catalog/upgrade-card-features.ts` reparse the
older revision from printed text. Run the parser, model, catalog, adapter, and
loader suites GREEN. Stage all five production modules and their tests in the
phase's final commit. Regex-only production edits without this migration are
not allowed.

## File map

- Modify `src/strategy/strategy-profile.ts`: add typed action values, costs, activation factors, target and duration multipliers, and the per-instance cap.
- Modify `src/strategy/strategy-profile.test.ts`: defaults, deep merge, immutability, and numeric boundary validation.
- Create `src/solver/effect-value.ts`: pure action, branch, instance, and Event-mode valuation with stable reasons.
- Create `src/solver/effect-value.test.ts`: exact arithmetic for every table row, cap, factor, choice, optional effect, and Event exclusivity.
- Modify `shared/card-features.ts`: derive subject-aware broad summaries from compatible structured instances after parsing.
- Modify `shared/card-features.test.ts`: opponent draw, Trigger-only text, clause compatibility, and corrected summary boundaries.
- Modify `src/solver/deck-state.ts`: count direct structured interaction coverage.
- Modify `src/solver/deck-state.test.ts`: lockdown, hand disruption, Life pressure, opponent draw, and overlap coverage.
- Modify `src/solver/marginal-score.ts`: type-aware printed body, structured `effectQuality`, removal of duplicate broad bonuses and generic combo penalty, and structured redundancy.
- Modify `src/solver/marginal-score.test.ts`: exact cutover scores and negative/positive boundaries.
- Modify `src/solver/strategy-solver.test.ts`: solution invariants under the new score source.
- Modify `src/solver/play-guide.ts` and `src/solver/play-guide.test.ts` only if they inspect old flags as effect value; keep user-facing guide behavior stable otherwise.
- Modify `tools/evaluate-strategy.ts` and `tools/evaluate-strategy.test.ts`: measure structured interaction availability consistently with runtime coverage.
- Create `tools/op17-general-effect-value.acceptance.test.ts`: named catalog semantics, controlled Event fixtures, deterministic solve, and conservation.

### Task 1: Put the Phase-2 calibration tables in the strategy profile

**Files:**
- Modify: `src/strategy/strategy-profile.test.ts`
- Modify: `src/strategy/strategy-profile.ts`

- [x] **Step 1: Write failing default, merge, freeze, and validation tests**

Add one exact snapshot-style expectation for the new profile section:

```ts
expect(getStrategyProfile('OP17').effectModel).toEqual({
  actions: {
    ownDrawPerCard: 2, opponentDrawPerCard: -2,
    filterPerKept: 1, filterPerExtraSeen: 0.25, filterCap: 2.5,
    opponentDiscardPerCard: 2.5, counterPerThousand: 2,
    koBase: 4, bottomDeckBase: 4.5, returnHandBase: 3, restBase: 1.5,
    negateEffectBase: 1.5,
    powerReductionPerThousand: 0.75, lockAttackBase: 2.5,
    deployPerCard: 1.5, deployPerCostSaved: 0.5, deployCap: 9,
    trashDeployBonus: 1, protectionBase: 3, ownLifeGainPerCard: 5,
    opponentLifeToHandPerCard: 3, refreshDonPerCard: 1.5,
    rampActiveDonPerCard: 2, rampRestedDonPerCard: 1.25,
    counterAuraPerThousandPerCard: 1, counterAuraCap: 6,
    ownPowerPerThousandPerTarget: 0.75, leaderShieldPerThousand: 4,
    keyword: 1,
  },
  costs: {
    playEventDonPerCard: 1, donMinusPerCard: 1.5, restDonPerCard: 1,
    discardHandPerCard: 2, trashSelf: 1.5, restSelf: 1,
  },
  activationFactors: {
    onPlay: 1, main: 1, static: 0.8, activateMain: 0.75,
    whenAttacking: 0.7, counter: 0.65, onOpponentsAttack: 0.6,
    onBlock: 0.6, onKo: 0.5, trigger: 0.35,
  },
  targetMultipliers: { one: 1, two: 1.75, threeOrMore: 2.25, unbounded: 2.5 },
  costCeilingFactors: { zeroToTwo: 0.55, threeToFour: 0.75, fiveToSix: 0.9, sevenOrMore: 1 },
  longDurationMultiplier: 1.25,
  effectInstanceCap: 12,
})
```

Assert an override changes one nested action and one factor without dropping siblings, and all nested objects are frozen. Add table-driven invalid values: `NaN`, `Infinity`, and negative for every group; activation factors below 0 or above 1; zero/non-positive target multipliers and cap; positive `opponentDrawPerCard` must fail because it is an adverse value; non-negative values are required elsewhere.

- [x] **Step 2: Run profile tests and verify RED**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

Expected: FAIL because `effectModel` and its override shape do not exist.

- [x] **Step 3: Add the typed profile section and exact defaults**

Define exported readonly types `EffectActionValues`, `EffectCostValues`, and `EffectModelProfile`; add `effectModel` to `StrategyProfile` and an optional recursively partial `effectModel` to `StrategyProfileOverride`. Put the exact approved numbers in `BASE_PROFILE`. Extend `mergeStrategyProfile` one nesting level for `actions`, `costs`, `activationFactors`, `targetMultipliers`, and `costCeilingFactors`, then validate every leaf with a named error.

Use helpers with explicit rules:

```ts
function finiteNonNegative(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative.`)
}
function boundedFactor(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be from 0 through 1.`)
}
function finitePositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and positive.`)
}
```

Validate `opponentDrawPerCard` separately as finite and `<= 0`. No set-specific override is introduced in this phase.

- [x] **Step 4: Run profile tests and verify GREEN**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

Expected: PASS for exact defaults, partial override preservation, freezing, and every invalid boundary.

- [x] **Step 5: Commit profile policy**

```bash
git add src/strategy/strategy-profile.ts src/strategy/strategy-profile.test.ts
git commit -m "feat: configure structured effect values"
```

Task 1 evidence (2026-08-21):

- RED: `npm test -- src/strategy/strategy-profile.test.ts` failed 21 of 47
  tests because `effectModel` and its merge and validation contract did not
  exist.
- GREEN: `npm test -- src/strategy/strategy-profile.test.ts` passed 1 file / 58
  tests, covering exact defaults, recursive partial overrides, detached and
  deeply frozen results, named validation, adverse opponent draw, bounded
  activation factors, positive multipliers and caps, and non-negative action
  and cost values.
- Full suite: `npm test` passed 61 files / 1,057 tests.
- Verification: `npm run lint`, `npm run typecheck`, and `git diff --check`
  passed. Self-review confirmed all values live in the base profile with no
  card, set, name, color, or rarity override.

### Task 2: Value individual actions with exact magnitude and caps

**Files:**
- Create: `src/solver/effect-value.test.ts`
- Create: `src/solver/effect-value.ts`

- [ ] **Step 1: Write failing exact action-arithmetic tests**

Create helpers that construct canonical `EffectAction`, `EffectInstance`, and `CandidateCard` values without printed-card identities. Test every row in the approved action table. Representative assertions:

```ts
expect(valueAction(draw('player', 2), context).grossValue).toBe(4)
expect(valueAction(draw('opponent', 2), context).grossValue).toBe(-4)
expect(valueAction(filter({ lookedAt: 5, kept: 1 }), context).grossValue).toBe(2)
expect(valueAction(remove('bottomDeck', target({ quantity: 2, maximumCost: 5 })), context).grossValue).toBe(4.5 * 1.75 * 0.9)
expect(valueAction(remove('ko', target({ quantity: 'anyNumber', totalCostMaximum: 4 })), context).grossValue).toBe(4 * 2.5 * 0.75)
expect(valueAction(lockAttack(target({ quantity: 2 }), 'untilOpponentsNextEndPhase'), context).grossValue).toBe(2.5 * 1.75 * 1.25)
expect(valueAction(deploy(target({ quantity: 2, maximumCost: 4 })), context).grossValue).toBe(7)
expect(valueAction(deploy(target({ quantity: 2, maximumCost: 20 })), context).grossValue).toBe(9)
expect(valueAction({ kind: 'unknown', normalizedText: 'future wording' }, context).grossValue).toBe(0)
```

Cover K.O., return hand, rest, effect negation, power reduction, protection, both Life directions, hand discard, all DON modes, counter aura with zero and positive eligible counts, own power modifier, Leader shield, and every keyword. Assert power actions consume `powerDelta`, not an absolute resulting power; multiplicity is applied once; cost ceiling is applied once; broad target values hit the instance cap later; and every returned value is finite.

- [ ] **Step 2: Run evaluator tests and verify RED**

Run `npm test -- src/solver/effect-value.test.ts`.

Expected: FAIL because the evaluator module does not exist.

- [ ] **Step 3: Implement pure target and action valuation**

Create `src/solver/effect-value.ts` and export the approved `PremiumCategory`, `EffectContribution`, and `EffectValuation` interfaces plus:

```ts
export function valueCardEffects(
  candidate: CandidateCard,
  state: DeckState,
  poolSupport: PoolSupport,
  profile: StrategyProfile,
): EffectValuation
```

Keep `valueAction` exported only for direct unit testing. Add private helpers for target multiplicity, cost-ceiling factor, duration, injected target-support evidence, and stable six-decimal rounding. `all` and `anyNumber` use `unbounded`; numeric three or greater uses `threeOrMore`. A maximum cost 0-2/3-4/5-6/7+ maps to the approved factors; unrestricted is `1`. Direct arithmetic tests may inject controlled target factors/count evidence for counter auras. Production Phase 2 does not estimate dynamic pool-backed counts and returns target factor/value zero for them until Phase 3 supplies exact reconciled support; this avoids temporarily double-counting selected cards in the original full pool. Dynamic raw magnitude uses printed quantities/ceilings and caps, and the supplied target factor is applied exactly once.

Each action result includes `grossValue`, one `PremiumCategory | null`, an initial target-support factor, and a human-readable reason. Map Rush and attack pressure to `pressure`; removal, negation, and lockdown to `interaction`; draw, filtering, hand discard, and deployment to `cardAdvantage`; Life movement to `lifeAdvantage`; DON!! movement to `donAdvantage`; and Blocker, protection, counter auras, and Leader shielding to `durableDefense`. Phase 2 uses target-support factor 1 only for target-independent actions; dynamic pool-backed filter/deploy/search/aura targets remain zero until Phase 3 instead of inflating their value. An explicit `this card` Trigger deployment with `allowsSelf: true` is target-independent and remains available. Unknown action or unsafe subject produces zero and an explicit reason, never an exception.

- [ ] **Step 4: Run action tests and verify GREEN**

Run `npm test -- src/solver/effect-value.test.ts`.

Expected: PASS for every action row, multiplier, cap input, and zero-value safety boundary.

- [ ] **Step 5: Commit action arithmetic**

```bash
git add src/solver/effect-value.ts src/solver/effect-value.test.ts
git commit -m "feat: value structured card actions"
```

### Task 3: Reconcile costs, branches, activation, conditions, and Event modes

**Files:**
- Modify: `src/solver/effect-value.test.ts`
- Modify: `src/solver/effect-value.ts`

- [ ] **Step 1: Add failing aggregation tests**

Add exact tests for all six costs, shared-cost deduction once, proportional shared-cost allocation across chosen positive actions, rounding-residue reconciliation, the +12 per-instance positive cap before factors, each activation factor, optional clamp, mandatory negative retention, incompatible hard zero, unknown-condition zero, self-state availability, and branch ownership:

```ts
expect(value(instance({ actions: [draw('player', 1), draw('player', 1)], costs: [donMinus(1)] })).toMatchObject({
  grossValue: 4, costValue: 1.5, activationFactor: 1, conditionSupportFactor: 1, netValue: 2.5,
})
expect(value(instance({ chooser: 'player', branches: [[draw('player', 1)], [draw('player', 2)]] })).netValue).toBe(4)
expect(value(instance({ chooser: 'opponent', branches: [[draw('opponent', 2)], [handDiscard('opponent', 2)]] })).netValue).toBe(-4)
expect(value(instance({ optional: true, actions: [draw('player', 1)], costs: [discardHand(2)] })).netValue).toBe(0)
expect(value(instance({ condition: { kind: 'unknown', normalizedText: 'board condition' } })).conditionSupportFactor).toBe(0)
```

For a cost-3 Event with Main draw, Counter +4000, and Trigger deploy modes, assert the evaluator values each physical-card mode with the correct implicit Event DON cost and returns only the highest net mode. For a Character with On Play plus Trigger, assert both independently available instances contribute; this distinguishes a physical Event choice from a Character's Life-trigger access.

Add a null-cost Event: its Main and Counter modes have availability zero with
an explicit missing-cost reason, while a direct Trigger action remains
eligible. Add a two-category instance with gross values 2 and 6 plus cost 2;
assert allocated costs 0.5 and 1.5, action nets reconcile to the instance net,
and each category total uses its action net exactly once.
Add a mixed beneficial/adverse instance: if its total net is non-positive all
premium categories are zero; if positive, its positive signed category
subtotals are proportionally scaled to exactly the instance net.

- [ ] **Step 2: Run aggregation tests and verify RED**

Run `npm test -- src/solver/effect-value.test.ts`.

Expected: FAIL at branch/cost/activation aggregation.

- [ ] **Step 3: Implement instance and card aggregation**

Implement `valueCost`, `valueBranch`, and `valueEffectInstance`. First multiply each action's raw gross by its action-target support factor. Sum those effective values inside a branch; take the maximum branch for `chooser: 'player'`, minimum for `chooser: 'opponent'`, and sole branch for `none`. If the selected branch gross exceeds `effectInstanceCap`, retain its non-positive subtotal `N` and multiply each positive action by `(effectInstanceCap - N) / positiveSubtotal`; assign stable-rounding residue to the last positive action. Allocate the one shared cost across the resulting positive action values proportionally; if no action is positive, assign it to the first action. Then apply activation and condition-support factors. Clamp an optional instance at zero; in that case preserve gross and allocated-cost evidence but set every selected action net/category value to zero. Mandatory negative values remain negative. The action net sum must equal the instance net and the cost must never be deducted again. Sum signed action nets by category; when the instance net is positive, proportionally scale its positive category subtotals to that net, otherwise zero every category. Assign category rounding residue to the last positive canonical category.

Use support factor `1` only for `always` and `selfState: playedThisTurn`; clause-local Rainbow `incompatible`, `unknown`, `cards`, `leader`, `all`, or `any` conditions that are not fully resolvable in Phase 2 use zero. A compatible Leader-free `always` instance is not penalized because an adjacent instance is incompatible.

For Events, group instances by activation, add implicit `{ kind: 'playEventDon', amount: card.cost }` to Main and Counter only when `card.cost` is numeric, value each group, and retain the group with the highest total; deterministic ties use printed occurrence order. A null-cost Event's Main/Counter group is zero/unavailable, never free. Trigger does not pay printed Event cost. For Characters and Stages, sum ordered instance contributions. Do not recursively invoke an On Play instance from `Trigger: Play this card`.

Freeze all result arrays and objects. Each `EffectContribution` contains ordered frozen `ActionContribution` records and reconciled category totals. Each action records `rawGrossValue`, `targetSupportFactor`, `effectiveTargetCount`, post-cap `cappedGrossValue`, allocated cost, activation/condition factors, and final net. `EffectValuation.total` must equal both the stable sum of `contributions[].netValue` and the sum of selected action nets after the optional clamp; reasons expose every field. Also populate the Phase-4-ready fields now: `premiumImpact` is the stable sum of positive reconciled `EffectContribution`/category totals before marginal-score redundancy, never a raw sum of individually positive actions. Shared costs and mandatory adverse actions therefore reduce the contribution before it can add premium impact. `premiumCategories` is the frozen printed-order de-duplicated list of categories with positive reconciled values. Add assertions that adverse opponent draw lowers or eliminates the containing contribution's premium impact and Event-discarded modes contribute neither impact nor categories.

- [ ] **Step 4: Run evaluator tests and verify GREEN**

Run `npm test -- src/solver/effect-value.test.ts`.

Expected: PASS with exact reconciliation for all costs, branches, factors, caps, and Event mode choice.

- [ ] **Step 5: Commit aggregation**

```bash
git add src/solver/effect-value.ts src/solver/effect-value.test.ts
git commit -m "feat: reconcile effect contributions"
```

### Task 4: Make summary roles subject-aware and interaction structural

**Files:**
- Modify: `shared/card-features.test.ts`
- Modify: `shared/card-features.ts`
- Modify: `src/solver/deck-state.test.ts`
- Modify: `src/solver/deck-state.ts`
- Modify: `tools/evaluate-strategy.test.ts`
- Modify: `tools/evaluate-strategy.ts`

- [ ] **Step 1: Write failing subject-aware summary tests**

Add classifier tests proving:

```ts
expect(classifyCardFeatures(card({ effect: 'Your opponent draws 2 cards.' })).rainbowUsableFlags.draw).toBe(false)
expect(classifyCardFeatures(card({ effect: '[Trigger] Draw 1 card.' })).rainbowUsableFlags.draw).toBe(true)
expect(classifyCardFeatures(card({ effect: "Place up to 1 Character with a cost of 5 or less at the bottom of the owner's deck." })).rainbowUsableFlags.removal).toBe(true)
```

Add deck-state tests where lockdown, effect negation, opponent hand discard, and opposing-Life pressure each increment `interaction` once; own draw plus removal on one card still increments once; opponent draw, own-Life gain alone, unknown action, Trigger-only action with zero structured value, and incompatible action do not increment it.

- [ ] **Step 2: Run summary/coverage tests and verify RED**

Run:

```bash
npm test -- shared/card-features.test.ts src/solver/deck-state.test.ts tools/evaluate-strategy.test.ts
```

Expected: FAIL because raw text booleans still treat every draw alike and interaction is `draw || removal`.

- [ ] **Step 3: Derive broad summaries from compatible structured actions**

After the Phase-1 legacy-parity gate has shipped, replace only the broad summary derivation for `draw`, `removal`, `twoForOne`, `blocker`, `rush`, `banish`, `massRest`, and `donRefresh` with an ordered scan of compatible/neutral instances. Player draw sets `draw`; opponent draw does not. Board-control remove modes set `removal`; quantity two/all/anyNumber or player draw two sets `twoForOne`. Keywords and recognized rest-all/DON-refresh actions set their existing flags. Keep printed-stat flags (`twoKCounter`, `vanillaLike`, `boss`, `brick`), searcher and combo summaries as documented until Phase 3.

Export a small predicate:

```ts
export function hasStructuredInteraction(features: CardFeatures): boolean
```

It returns true for a compatible, non-Trigger instance with an `always` or `selfState` condition containing player draw, opponent-target removal/negation/lockdown/hand discard, or opponent Life-to-hand. It returns false for unknown/adverse/incompatible actions and unresolved dynamic conditions. “Positive” here means the action's subject and direction have positive gross value; resource costs remain visible in the card's effect contribution but do not change the structural one-card coverage label. Trigger is excluded from coverage because its `0.35` access is below always-available role credit; Trigger value still contributes to `effectQuality`.

Use `hasStructuredInteraction` in `deck-state.ts` and `tools/evaluate-strategy.ts` so available-role reporting and selected coverage use the same definition. Preserve one-card-one-count overlap.

- [ ] **Step 4: Run summary/coverage tests and verify GREEN**

Run the same three focused files.

Expected: PASS with OP17-049 no longer supplying own draw/interaction and lockdown counted once.

- [ ] **Step 5: Commit summary cutover**

```bash
git add shared/card-features.ts shared/card-features.test.ts src/solver/deck-state.ts src/solver/deck-state.test.ts tools/evaluate-strategy.ts tools/evaluate-strategy.test.ts
git commit -m "feat: derive subject aware effect roles"
```

### Task 5: Make structured effects authoritative in marginal scoring

**Files:**
- Modify: `src/solver/marginal-score.test.ts`
- Modify: `src/solver/marginal-score.ts`
- Modify: `src/solver/strategy-solver.test.ts`
- Modify: `src/solver/play-guide.test.ts`
- Modify: `src/solver/play-guide.ts`

- [ ] **Step 1: Write failing score-cutover tests**

Replace old `broadEffectCount × compatibility.effect` expectations with exact structured totals. Add boundaries:

```ts
expect(score(character({ cost: 3, power: 5_000, effect: '[On Play] Draw 1 card.' })).components).toMatchObject({
  standalonePower: 4,
  effectQuality: 2,
})
expect(score(event({ cost: 3, effect: '[Counter] Up to 1 of your Leader gains +4000 power.' })).components).toMatchObject({
  effectQuality: 3.25, // (8 - 3 Event DON cost) * 0.65
})
expect(score(event({ cost: 3, effect: '[Counter] Up to 1 of your Leader gains +4000 power.' })).components.standalonePower).toBeUndefined()
expect(score(character({ effect: 'Your opponent chooses one:<br/>• Draw 2 cards.<br/>• Your opponent trashes 2 cards from their hand.' })).components.effectQuality).toBe(-4)
```

Assert no `compatibilityEffect` penalty for a card with one incompatible clause and one usable clause, no generic `comboSupport` penalty for a structured numeric/unknown condition, no duplicate effect bonus from legacy flags, and the current exact Shanks first-copy premium predicate still behaves unchanged until Phase 4.

- [ ] **Step 2: Run marginal scoring tests and verify RED**

Run `npm test -- src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts`.

Expected: FAIL because broad booleans still drive effect quality and Events receive negative body efficiency.

- [ ] **Step 3: Cut over printed body and `effectQuality`**

Replace the inline body formula with:

```ts
function printedBodyValue(candidate: CandidateCard, profile: StrategyProfile): number {
  if (candidate.card.cardType !== 'CHARACTER' || candidate.card.power === null) return 0
  return (candidate.card.power / 1000 - (candidate.card.cost ?? 0)) * profile.weights.standalone.cardPower
}
```

Call `valueCardEffects(candidate, state, poolSupport, profile)` once. Add one `effectQuality` component equal to its total and a stable reason joining the ordered contribution reasons. Delete `BROAD_EFFECT_FLAGS` and its count-based addition. Stop adding the whole-card `compatibilityEffect` and the generic `comboSupport` penalty for canonical v2 features; hard-zero incompatible structured contributions and zero-support unresolved conditions already encode those constraints. Keep the component names in the public order/label maps for serialized UI compatibility, but they may be absent.

Base redundant-effect detection only on the positive selected
`ActionContribution`s returned by this exact `valueCardEffects` call, not raw
booleans or a scan of every printed action. Discarded Event modes, unchosen
branches, unsupported targets, adverse effects, and incompatible actions cannot
trigger redundancy. Keep existing searcher support temporarily, as permitted
by the design. Leave target, curve, brick, role redundancy, and Phase-4 premium
predicate ordering unchanged.

- [ ] **Step 4: Update play-guide consumers only where semantics changed**

Run `npm test -- src/solver/play-guide.test.ts`. If failures show it is describing opponent draw or incompatible effects as player tools, replace those checks with subject-aware summary flags or `hasStructuredInteraction`. Preserve headings and prose for unaffected cards. Add exact negative tests; do not reword unrelated UI.

- [ ] **Step 5: Run solver tests and verify GREEN**

Run:

```bash
npm test -- src/solver/effect-value.test.ts src/solver/marginal-score.test.ts src/solver/deck-state.test.ts src/solver/strategy-solver.test.ts src/solver/play-guide.test.ts
```

Expected: PASS with reconcilable structured effect totals, zero Event body value, and all 40-card/conservation/determinism invariants intact.

- [ ] **Step 6: Commit the scoring cutover**

```bash
git add src/solver/marginal-score.ts src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts src/solver/play-guide.ts src/solver/play-guide.test.ts
git commit -m "feat: score structured card effects"
```

### Task 6: Lock OP17 value corrections and Event viability

**Files:**
- Create: `tools/op17-general-effect-value.acceptance.test.ts`
- Modify: `src/solver/effect-value.test.ts`
- Modify: `src/solver/marginal-score.test.ts`

- [ ] **Step 1: Add failing catalog-backed semantic/value assertions**

Load the checked-in OP17 catalog and value named cards through production classification and profile code. Assert semantic causes, not inclusion quotas:

- Gloriosa has a positive compatible `bottomDeck` contribution.
- Queen has player draw, Banish, two-target long-duration lockdown, and exactly one `DON!!-1` deduction.
- Loki's `anyNumber` total-cost-4 K.O. is greater than a controlled single-target cost-4 K.O.
- The 3 Sweet Commanders has player draw, own-Life gain, two-target power reduction, and a separate Trigger deployment contribution at factor `0.35`.
- Miss Buckingham Stussy has positive On Play and repeatable Activate: Main lockdown contributions.
- Kaido exposes both negate-effect and K.O. interaction on the same target.
- Ganzui exposes a +1000 Leader-shield delta and protection contributions; the protection contribution records its discard cost even if optional net clamps to zero.
- OP17-049 has no own-draw summary or value; its opponent-choice net is the minimum player outcome and is not the sum of both branches.

- [ ] **Step 2: Add controlled Event and invariant acceptance**

Collect every Rainbow-usable OP17 Event whose unconditional Counter action grants +3000 or +4000. For each, assert controlled-fixture `effectQuality > 0` and `standalonePower === undefined`. Do not demand solver inclusion yet; Phase 4 owns empirical rates.

For 100 fixed OP17 seeds, assert exactly 40 Main cards, exact physical-copy conservation, finite card scores/components, and byte-for-byte repeatability. Record the current provisional catalog source checksum in the test failure label so future catalog refreshes are distinguishable from engine drift.

- [ ] **Step 3: Run acceptance and verify RED for any missing general rule**

Run:

```bash
npm test -- tools/op17-general-effect-value.acceptance.test.ts
```

Expected before final corrections: FAIL on any parser/evaluator mismatch; the failure must identify the action or contribution, not only a changed inclusion outcome.

- [ ] **Step 4: Correct only general parser or valuation rules**

For each failure, first add a minimal positive wording fixture and a negative near-match to the parser/evaluator unit tests, then make the smallest general change. A semantic parser correction after Phase 1 must follow the parser-revision protocol above. No production branch may inspect set, card number, name, rarity, or color. Do not tune profile numbers solely to force one card into Main.

- [ ] **Step 5: Run full Phase-2 verification**

Run:

```bash
npm test -- shared/card-effect-parser.test.ts shared/card-features.test.ts src/strategy/strategy-profile.test.ts src/solver/effect-value.test.ts src/solver/deck-state.test.ts src/solver/marginal-score.test.ts tools/op17-general-effect-value.acceptance.test.ts
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
```

Expected: all commands PASS, every score is finite and reconcilable, all deterministic solutions remain valid, and catalog schema version remains 1 with canonical runtime feature version 2.

- [ ] **Step 6: Request two-stage review**

Dispatch a spec-compliance reviewer against Phase 2 and the approved design. Resolve every finding and rerun focused tests. Then dispatch a code-quality reviewer, resolve findings, and rerun the complete verification block.

- [ ] **Step 7: Commit acceptance and verification evidence**

```bash
git add tools/op17-general-effect-value.acceptance.test.ts shared/card-effect-model.ts shared/card-effect-model.test.ts shared/card-effect-parser.ts shared/card-effect-parser.test.ts shared/card-features.ts shared/card-features.test.ts shared/catalog.ts shared/catalog.test.ts src/catalog/upgrade-card-features.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts src/solver/effect-value.ts src/solver/effect-value.test.ts src/solver/marginal-score.ts src/solver/marginal-score.test.ts docs/superpowers/plans/2026-08-21-op17-general-effect-value.md
git commit -m "test: verify OP17 general effect value"
```

Record exact suite counts, catalog checksum, and commands in the checked plan. Phase 3 may start only after this phase is independently green, reviewed, and committed.
