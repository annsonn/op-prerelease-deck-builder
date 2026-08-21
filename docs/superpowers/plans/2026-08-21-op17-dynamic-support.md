# OP17 Dynamic Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate structured card, Leader, numeric, type, counter, Trigger, and zone requirements against the selected deck and remaining sealed pool, including a narrowly controlled Elbaf/Elbaph trait alias.

**Architecture:** Keep requirement syntax in the shared version-2 effect model, but put all runtime matching in one pure `src/solver/effect-support.ts` module. Extend the solver's support index with immutable printed attributes so valuation never parses text or scans catalog objects. `effect-value.ts` consumes one instance-condition factor plus per-action target-availability factors; legacy name/trait summaries remain derived compatibility output during migration and cannot add a second score.

**Tech Stack:** TypeScript 6, Vitest 4, canonical effect model from Phase 1, structured valuation from Phase 2, existing deck-state and strategy-profile modules

**Prerequisite:** Complete and merge `2026-08-21-op17-general-effect-value.md` with every Phase-2 gate green.

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

- Modify `src/strategy/strategy-profile.ts` and `.test.ts`: add validated zone availability factors.
- Modify `src/solver/deck-state.ts` and `.test.ts`: index complete printed support attributes in selected and remaining cards.
- Create `src/solver/effect-support.ts` and `.test.ts`: canonical trait comparison, predicate matching, requirement evaluation, self-exclusion, quantity and zone factors.
- Modify `src/solver/effect-value.ts` and `.test.ts`: use structured support factors for conditional effects.
- Modify `shared/card-features.ts` and `.test.ts`: derive old support-summary fields from structured requirements without scoring them.
- Modify `src/solver/marginal-score.ts` and `.test.ts`: remove remaining legacy search/combo additions for v2 features.
- Modify `src/solver/play-guide.ts` and `.test.ts` only where it consumes old support summaries; preserve unrelated prose.
- Create `tools/op17-dynamic-support.acceptance.test.ts`: catalog-backed OP17 semantic, deterministic, and conservation gates.

### Task 1: Publish zone-factor policy

**Files:**
- Modify: `src/strategy/strategy-profile.test.ts`
- Modify: `src/strategy/strategy-profile.ts`

- [ ] **Step 1: Write failing default and validation tests**

Assert the base profile publishes:

```ts
expect(getStrategyProfile('OP17').effectModel.zoneFactors).toEqual({
  deck: 1,
  hand: 0.75,
  field: 0.65,
  trash: 0.55,
  life: 0.25,
})
expect(getStrategyProfile('OP17').effectModel.opponentBoardConditionFactor).toBe(0.5)
```

Assert a one-field override preserves siblings and that `-0.01`, `1.01`,
`NaN`, and `Infinity` are rejected for every zone factor and the opponent-board
factor with the field name.

- [ ] **Step 2: Run RED**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

Expected: FAIL because `zoneFactors` is absent.

- [ ] **Step 3: Implement and validate the policy**

Add the exact five zone keys plus `opponentBoardConditionFactor: 0.5` to
`EffectModelProfile`, its recursively partial override, deep merge, freezer,
and `[0, 1]` validation. Do not introduce a set-specific override.

- [ ] **Step 4: Run GREEN and commit**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

```bash
git add src/strategy/strategy-profile.ts src/strategy/strategy-profile.test.ts
git commit -m "feat: configure effect support availability"
```

### Task 2: Index every printed support attribute

**Files:**
- Modify: `src/solver/deck-state.test.ts`
- Modify: `src/solver/deck-state.ts`

- [ ] **Step 1: Write failing index tests**

Replace `CardNumberSupport` with a richer exported `CardSupportEntry` and assert
both `DeckState.cardSupportByNumber` and `PoolSupport.cardSupportByNumber`
retain, per printed card number:

```ts
{
  quantity: 2,
  name: 'Example',
  traits: ['Elbaph', 'Giant'],
  cardType: 'CHARACTER',
  cost: 2,
  power: 4000,
  counter: 1000,
  hasTrigger: true,
}
```

Add null-stat, zero-counter, duplicate-trait, conflicting-metadata, stable-key
order, safe-integer, and recursive-freeze cases.

- [ ] **Step 2: Run RED**

Run `npm test -- src/solver/deck-state.test.ts`.

Expected: FAIL because the support index contains only name and traits.

- [ ] **Step 3: Extend the immutable index**

Populate the entry only from `PlayableCard` fields. `hasTrigger` is true only
for non-empty printed Trigger text. Preserve quantity arithmetic and conflict
checks across every new field. Do not add zone state or parser results here.

- [ ] **Step 4: Run GREEN and commit**

Run `npm test -- src/solver/deck-state.test.ts`.

```bash
git add src/solver/deck-state.ts src/solver/deck-state.test.ts
git commit -m "feat: index structured card support"
```

### Task 3: Match predicates and controlled trait aliases

**Files:**
- Create: `src/solver/effect-support.test.ts`
- Create: `src/solver/effect-support.ts`

- [ ] **Step 1: Write failing predicate tests**

Create table-driven tests for exact name, exact trait, card type, minimum and
maximum cost, minimum and maximum power, `hasCounter`, `withoutCounter`,
`hasTrigger`, conjunction of fields, and every null/unrestricted boundary.
Require all names/traits inside one predicate to use OR semantics while
different predicate fields use AND semantics.

Add zone tests proving one zone uses its configured factor and multiple source
zones use the maximum listed factor without addition. Add an opponent-target
condition proving the player's selected/pool indexes are never inspected and a
safely parsed condition receives only `opponentBoardConditionFactor`; an
unknown opponent condition remains zero.

Add the exact alias contract:

```ts
expect(canonicalTraitKey('Elbaf')).toBe('elbaph')
expect(canonicalTraitKey('Elbaph')).toBe('elbaph')
expect(matchesCardPredicate(elbaphCard, predicate({ traits: ['Elbaf'] }))).toBe(true)
```

Negative rows must reject `Elba`, `Elbapho`, `New Elbaf`, substring matches,
and unrelated near-spellings. Display/source traits must remain unchanged.

- [ ] **Step 2: Run RED**

Run `npm test -- src/solver/effect-support.test.ts`.

Expected: FAIL because the matcher does not exist.

- [ ] **Step 3: Implement the pure matcher**

Export only `canonicalTraitKey`, `matchesCardPredicate`,
`evaluateRequirementSupport`, `evaluateTargetSupport`, and result types. Keep
the alias table private, exact, symmetric, and comparison-only. Match finite
printed values without coercing nulls. Select a multi-zone factor with
`Math.max`, never addition. Safely parsed opponent-board requirements return
the profile's conservative 0.5 factor without consulting the player's pool;
unknown requirements return factor `0` with an explicit reason.
Target-support results also expose selected count, remaining-pool count,
deterministic constrained capacity, and effective target count so deploy and
counter-aura availability use the same reconciled evidence as the factor.
Raw magnitude still comes from printed quantities/ceilings and action caps;
`effectiveTargetCount` is explanatory and is never multiplied a second time.
`evaluateTargetSupport` accepts an explicit positive `requestedCount`: deploy
uses its printed numeric quantity, filter/search uses kept quantity, and an
aura uses the number of eligible cards required to reach its configured action
cap. This avoids inventing a threshold for `all`/`anyNumber` wording.

- [ ] **Step 4: Run GREEN and commit**

Run `npm test -- src/solver/effect-support.test.ts`.

```bash
git add src/solver/effect-support.ts src/solver/effect-support.test.ts
git commit -m "feat: match structured support predicates"
```

### Task 4: Reconcile quantities, zones, selected support, and pool potential

**Files:**
- Modify: `src/solver/effect-support.test.ts`
- Modify: `src/solver/effect-support.ts`

- [ ] **Step 1: Add failing requirement-expression arithmetic tests**

Cover `always`, `leader`, `selfState`, `cards`, `all`, `any`, and `unknown`.
For a cards requirement, assert:

```ts
supportFactor = zoneFactor * Math.min(1, (selected + 0.5 * poolPotential) / minimumCount)
```

Test zero/partial/full support, selected saturation, multiple physical copies,
candidate self-exclusion, explicit self-reference, `differentNames`, quantity,
and `totalCostMaximum`. Include a regression where one support copy is already
selected: it contributes at selected weight and is subtracted from original
pool potential, never counted again at half weight. `all` uses the minimum child
factor; `any` uses the maximum. Named/typed/mono-color Leader conditions remain
hard-incompatible under Rainbow Luffy regardless of pool contents.

For exact capacity, include two cost-5 cards failing a two-card total-cost-9
target, duplicate names failing `differentNames`, multiple physical copies, and
deterministic ties. Use an exact bounded dynamic program: sort eligible physical
copies by card number; group by normalized name when `differentNames` is true;
advance `(usedCount, totalCost)` states up to requested count/ceiling; retain
the lexicographically smallest sequence for equal states; then choose most
cards, greatest total cost, and lexicographically smallest sequence. Treat a
null-cost card as ineligible when enforcing a total ceiling. Without a printed
ceiling, use the finite eligible-pool cost sum as the bound. Never enumerate all
subsets of the 72-card pool.

For action targets, table-test `requestedCount`: deploy uses printed quantity,
filter/search uses kept quantity, and counter aura uses the eligible-card count
needed to hit its configured cap. Invalid/non-positive requested counts fail.
Assert the resulting target factor is applied once to the theoretical action
gross and `effectiveTargetCount` is explanation-only.

- [ ] **Step 2: Run RED**

Run `npm test -- src/solver/effect-support.test.ts`.

Expected: FAIL on expression composition, self-exclusion, or capacity bounds.

- [ ] **Step 3: Implement deterministic support reconciliation**

For each card number calculate remaining quantity as original pool quantity
minus `DeckState` selected quantity, then subtract one current-candidate copy
unless Phase-1 `TargetSpec.allowsSelf` is true. Clamp at zero. Count matching
selected support separately at full weight and remaining support at half
weight. Apply the exact bounded dynamic program above for quantity,
`differentNames`, and total-cost constraints. `allowsSelf` is already required
by canonical v2/revision 1; Phase 3 must not change the serialized schema. Keep
results finite, six-decimal stable, deeply frozen, and reasoned.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npm test -- shared/card-effect-model.test.ts shared/card-effect-parser.test.ts src/solver/effect-support.test.ts
```

```bash
git add src/solver/effect-support.ts src/solver/effect-support.test.ts
git commit -m "feat: reconcile dynamic effect support"
```

### Task 5: Make structured support authoritative in valuation and synergy

**Files:**
- Modify: `src/solver/effect-value.test.ts`
- Modify: `src/solver/effect-value.ts`
- Modify: `src/solver/marginal-score.test.ts`
- Modify: `src/solver/marginal-score.ts`
- Modify: `shared/card-features.test.ts`
- Modify: `shared/card-features.ts`
- Modify: `src/solver/play-guide.test.ts`
- Modify: `src/solver/play-guide.ts`

- [ ] **Step 1: Write failing integration tests**

Assert an effect contribution records its instance-condition factor and each
action's target factor with exact arithmetic; zero action support zeros only
that action; support `0.5` halves only that action; and a supported conditional
effect becomes premium-impact eligible. A draw plus unsupported deploy keeps
full draw value and zero deploy value. Verify one incompatible clause stays
zero while an adjacent unconditional clause remains fully valued.

In marginal-score tests, assert canonical v2 cards receive no separate
`searcherSupport`, `comboSupport`, whole-card compatibility, or duplicate
legacy-flag component. Preserve component labels/order for result compatibility
but omit empty legacy components. Derive the old required/searchable summary
arrays and `supportRequirementsByFlag` from structured requirements for UI/play
guide consumers only.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/solver/effect-value.test.ts src/solver/marginal-score.test.ts shared/card-features.test.ts src/solver/play-guide.test.ts
```

Expected: FAIL because dynamic requirements still receive zero and legacy
synergy remains authoritative.

- [ ] **Step 3: Wire the matcher exactly once**

Call `evaluateRequirementSupport` once per effect instance for its activation
condition. Separately call `evaluateTargetSupport` once for every chosen
support-dependent filter, deploy, aura, search, or similar action and store the
factor/reason and effective count on its `ActionContribution`. Apply the factor
once to raw printed/capped magnitude; do not multiply effective count again.
Target-independent actions use 1.
Re-run branch selection, cap scaling, proportional shared-cost allocation, and
category reconciliation with the target-adjusted action values. Delete the
remaining v2 search/combo scoring path from marginal scoring. Keep legacy fields
as runtime-derived summaries only. Do not inspect effect text, names, traits,
or card numbers in solver arithmetic.

- [ ] **Step 4: Run GREEN and commit**

Run the four focused files plus `src/solver/effect-support.test.ts`.

```bash
git add src/solver/effect-value.ts src/solver/effect-value.test.ts src/solver/marginal-score.ts src/solver/marginal-score.test.ts shared/card-features.ts shared/card-features.test.ts src/solver/play-guide.ts src/solver/play-guide.test.ts
git commit -m "feat: score support-aware card effects"
```

### Task 6: Lock OP17 dynamic-synergy behavior

**Files:**
- Create: `tools/op17-dynamic-support.acceptance.test.ts`
- Modify: parser/effect tests only for general fixes exposed by acceptance

- [ ] **Step 1: Add catalog-backed semantic acceptance**

Using `loadLocalCatalogs(['OP17'])`, assert:

- Kaido's aura predicate matches counterless Characters and its played-this-turn removal has no false unsupported-combo penalty.
- OP17-093 Luffy independently measures cost-12-or-more Rush support and cost-2-or-less Character-from-trash support.
- OP17-112 Linlin measures Trigger-bearing 4000-power Characters while its Life effects stay independently usable.
- OP17-118 Xebec estimates up to two different-name Rocks Pirates totaling cost nine.
- OP17-080 Usopp finds catalog `Elbaph` traits through only the `Elbaf` alias.
- named, typed, and mono-color Leader requirements stay incompatible under Rainbow Luffy.

For OP17-093 and OP17-118, also remove every eligible deploy target in a
controlled pool and prove their independent draw action remains fully valued.

For each, assert the parsed predicate, selected/pool counts, zone factor,
support factor, and contribution reason. Do not assert a win rate.

- [ ] **Step 2: Add deterministic solver invariants**

Across 250 fixed OP17 seeds, solve twice and require identical results, exactly
40 Main cards, finite components, and exact physical-copy conservation. Add a
mutation check that disables the alias and one that counts the candidate as its
own support; each must make its named acceptance test fail.

- [ ] **Step 3: Run RED, then make grammar-general corrections only**

Run `npm test -- tools/op17-dynamic-support.acceptance.test.ts`.

For every failure, add a minimal parser/matcher positive and negative test
before changing production. Any parser semantic change follows the
parser-revision protocol above. No production
condition may mention OP17, a card number, card name, rarity, or color.

- [ ] **Step 4: Run full Phase-3 verification and reviews**

```bash
npm test -- shared/card-effect-parser.test.ts src/solver/effect-support.test.ts src/solver/effect-value.test.ts src/solver/marginal-score.test.ts tools/op17-dynamic-support.acceptance.test.ts
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
```

Dispatch a spec-compliance reviewer, resolve all findings, then a code-quality
reviewer. Re-run the full block after fixes.

- [ ] **Step 5: Commit acceptance evidence**

```bash
git add tools/op17-dynamic-support.acceptance.test.ts shared/card-effect-model.ts shared/card-effect-model.test.ts shared/card-effect-parser.ts shared/card-effect-parser.test.ts shared/card-features.ts shared/card-features.test.ts shared/catalog.ts shared/catalog.test.ts src/catalog/upgrade-card-features.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts src/solver/effect-support.ts src/solver/effect-support.test.ts src/solver/effect-value.ts src/solver/effect-value.test.ts src/solver/marginal-score.ts src/solver/marginal-score.test.ts docs/superpowers/plans/2026-08-21-op17-dynamic-support.md
git commit -m "test: verify OP17 dynamic support"
```

Record exact counts and commands in this checklist. Phase 4 starts only from a
clean, independently green Phase-3 commit.
