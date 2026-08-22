# OP17 Premium Impact and Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Shanks-shaped first-copy predicate with a general, explainable premium-impact rule and calibrate the complete value model against fixed OP17 pools without regressing OP16 deck construction.

**Architecture:** Reuse `EffectValuation` from Phase 2 and support factors from Phase 3. The profile owns thresholds; one pure qualifier reduces ordered positive contributions into independent impact categories. `marginal-score.ts` applies the existing first-copy floor after ordinary positive and negative components. A separate evaluation module records reproducible catalog checksums, inclusion rates, deck invariants, and OP16 guardrails; production code never sees card identity or audit baselines.

**Tech Stack:** TypeScript 6, Vitest 4, existing structured parser/value/support modules, deterministic tournament-pool generator and strategy evaluator

**Prerequisite:** Complete and merge `2026-08-21-op17-dynamic-support.md` with every Phase-3 gate green.

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

- Modify `src/strategy/strategy-profile.ts` and `.test.ts`: publish and validate premium threshold, category minimum, and existing floor together.
- Create `src/solver/premium-impact.ts` and `.test.ts`: group qualifying contribution value and explain eligibility.
- Modify `src/solver/effect-value.ts` and `.test.ts`: expose stable category-level contribution totals needed by the qualifier.
- Modify `src/solver/marginal-score.ts` and `.test.ts`: replace the exact Shanks flag predicate and retain first-copy floor ordering.
- Modify `src/solver/strategy-solver.test.ts`: general qualifying/nonqualifying selection fixtures and copy conservation.
- Create `tools/op17-value-model-calibration.ts` and `.test.ts`: reusable deterministic before/after rate and guardrail evaluator.
- Create `tools/op17-value-model.acceptance.test.ts`: fixed OP17 and OP16 catalog-backed gates.
- Modify `tools/op17-premium-bomb.acceptance.test.ts`: retain Shanks regression through the general rule, not legacy flags.
- Modify `tools/evaluate-strategy.ts` and `.test.ts` only to share non-CLI evaluation helpers; keep report behavior stable.

### Task 1: Publish general premium-impact policy

**Files:**
- Modify: `src/strategy/strategy-profile.test.ts`
- Modify: `src/strategy/strategy-profile.ts`

- [ ] **Step 1: Write failing policy tests**

Assert the base profile exposes:

```ts
expect(getStrategyProfile('OP17').limits).toMatchObject({
  premiumImpactThreshold: 7.5,
  premiumCategoryMinimum: 2,
  premiumBombFirstCopyFloor: 15,
})
```

Assert all sets share the defaults, a partial override preserves siblings, and
negative, `NaN`, or infinite threshold/category/floor values fail with the
field name. Zero is allowed by type even though production defaults are
positive.

- [ ] **Step 2: Run RED**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

Expected: FAIL because the two general thresholds are missing.

- [ ] **Step 3: Implement validated policy**

Add `premiumImpactThreshold` and `premiumCategoryMinimum` beside the existing
first-copy floor. Merge and deep-freeze them through the normal profile path.
Do not add OP17-specific thresholds.

- [ ] **Step 4: Run GREEN and commit**

Run `npm test -- src/strategy/strategy-profile.test.ts`.

```bash
git add src/strategy/strategy-profile.ts src/strategy/strategy-profile.test.ts
git commit -m "feat: configure premium impact thresholds"
```

### Task 2: Qualify premium impact from reconciled contributions

**Files:**
- Create: `src/solver/premium-impact.test.ts`
- Create: `src/solver/premium-impact.ts`
- Modify: `src/solver/effect-value.test.ts`
- Modify: `src/solver/effect-value.ts`

- [ ] **Step 1: Write failing category and boundary tests**

Require `EffectValuation` to expose frozen, stable action/category totals,
including activation channels, instance-condition factors, action-target
factors, and proportionally allocated shared costs behind each positive value.
Test:

- qualifying cost-6 Character at impact `7.5` with two categories at `2`;
- qualifying existing boss below cost 6;
- non-Character and low-cost non-boss rejection;
- impact `7.499999` rejection;
- only one category rejection;
- Trigger-only rejection even above threshold;
- incompatible, adverse, zero, discarded Event-mode, and opponent-choice-only contributions excluded;
- support-dependent contribution at `0.499999` rejected and `0.5` accepted;
- a contribution containing a positive support-dependent action below 0.5 is
  excluded from premium qualification while unrelated qualifying effect
  instances may still satisfy the total and two-category gates;
- ordinary valuation retains an independent draw beside an unsupported deploy,
  while that shared-cost instance is conservatively premium-ineligible;
- stable category order and deep freezing.

The result contract is:

```ts
interface PremiumImpactDecision {
  readonly qualifies: boolean
  readonly impact: number
  readonly categoryValues: Readonly<Record<PremiumCategory, number>>
  readonly qualifyingCategories: readonly PremiumCategory[]
  readonly reasons: readonly string[]
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/solver/effect-value.test.ts src/solver/premium-impact.test.ts
```

Expected: FAIL because category evidence and the qualifier do not exist.

- [ ] **Step 3: Implement one general qualifier**

Consume the reconciled `EffectContribution.categoryValues` plus its ordered
`ActionContribution` evidence established in Phases 2 and 3. Create
`qualifyPremiumImpact(card, valuation, profile)`. A whole effect contribution
is premium-eligible only when its net is positive and every positive
support-dependent action in it has combined condition/target support at least
0.5. This conservative contribution boundary preserves its shared-cost and
adverse-effect accounting; ordinary scoring still keeps independently usable
actions such as draw even when the contribution cannot qualify for the premium
floor. Sum all remaining eligible contribution net/category values once across
the card in approved effect-instance and category order. The card qualifies
when that aggregate reaches impact 7.5 and at least two categories reach 2;
no individual instance must reach those gates alone. Opponent-choice
contributions may count only when at least one eligible non-opponent-choice
contribution is present, matching the "not solely" design rule. Do not reparse
text and do not inspect set, card number, name, rarity, color, or exact feature
combinations.

- [ ] **Step 4: Run GREEN and commit**

Run the two focused files.

```bash
git add src/solver/effect-value.ts src/solver/effect-value.test.ts src/solver/premium-impact.ts src/solver/premium-impact.test.ts
git commit -m "feat: qualify general premium impact"
```

### Task 3: Replace the exact first-copy bomb predicate

**Files:**
- Modify: `src/solver/marginal-score.test.ts`
- Modify: `src/solver/marginal-score.ts`
- Modify: `src/solver/strategy-solver.test.ts`
- Modify: `tools/op17-premium-bomb.acceptance.test.ts`

- [ ] **Step 1: Write failing marginal-score lifecycle tests**

Build controlled candidates from structured effects rather than flag records.
Assert:

```ts
expect(firstCopy.components.premiumBombFloor).toBe(
  profile.limits.premiumBombFirstCopyFloor - ordinaryTotal,
)
expect(firstCopy.total).toBe(profile.limits.premiumBombFirstCopyFloor)
expect(secondCopy.components.premiumBombFloor).toBeUndefined()
```

Prove the floor is computed after body, counter, curve, saturation, brick,
effect, compatibility, support, and redundancy components. Assert qualifying
value can raise a low ordinary score but cannot erase a score already above the
floor. Add nonqualifying tests for each boundary from Task 2.

Mutate the old exact predicate inputs: a qualifying card with no Rush or
mass-rest flag must still qualify, while a boss+rush+massRest+donRefresh fixture
whose structured effects are incompatible must not.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts tools/op17-premium-bomb.acceptance.test.ts
```

Expected: FAIL because marginal scoring still checks the exact four flags.

- [ ] **Step 3: Route the existing floor through the decision**

Call `valueCardEffects` once, pass that exact result to both `effectQuality` and
`qualifyPremiumImpact`, and apply the floor only when selected physical copies
equal zero and the decision qualifies. Keep `premiumBombFloor` as the final
ordered component and include decision impact/categories in the reason. Remove
the exact flag predicate completely.

Update the Shanks acceptance test to assert the parsed contributions and
general decision before its existing 1,000-seed guarantee. Do not relax the
guarantee or force later copies.

- [ ] **Step 4: Run GREEN and commit**

Run the three focused files plus `src/solver/premium-impact.test.ts`.

```bash
git add src/solver/marginal-score.ts src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts tools/op17-premium-bomb.acceptance.test.ts
git commit -m "feat: generalize first-copy premium bombs"
```

### Task 4: Build reproducible inclusion and guardrail evaluation

**Files:**
- Create: `tools/op17-value-model-calibration.test.ts`
- Create: `tools/op17-value-model-calibration.ts`
- Modify: `tools/evaluate-strategy.test.ts`
- Modify: `tools/evaluate-strategy.ts`

- [ ] **Step 1: Write failing evaluator tests with tiny synthetic catalogs**

Define an immutable report containing catalog checksum, set ID, seed range,
canonical StrategyProfile SHA-256, per-card opened pools/Main pools/inclusion
percentage,
average and raw-sum deck metrics, target misses,
below-counter-threshold counts/rates, average and total bricks, invalid decks,
and nondeterministic solves. Assert exact arithmetic for zero appearances,
duplicate copies, one opened card per pool, deterministic repeat, and
malformed/non-40-card solution detection.

The production evaluator accepts an injected pool generator and solvers for
fast unit tests. It must never make network requests or write artifacts.

- [ ] **Step 2: Run RED**

Run `npm test -- tools/op17-value-model-calibration.test.ts`.

Expected: FAIL because the evaluator module is absent.

- [ ] **Step 3: Implement bounded deterministic evaluation**

Reuse exported non-CLI helpers from `tools/evaluate-strategy.ts` where they have
the same semantics; otherwise extract them with unchanged tests. The pre-phase
comparison comes from `tools/fixtures/value-model-baseline.json`, never the
existing evaluator's `BasicDeckSolver` column. Calculate all percentages from
integer counts at reporting time, round only presentation, and include seed in
every failure. Hash the checked-in runtime artifact bytes, not a reserialized
object. Freeze the report.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npm test -- tools/op17-value-model-calibration.test.ts tools/evaluate-strategy.test.ts
```

```bash
git add tools/op17-value-model-calibration.ts tools/op17-value-model-calibration.test.ts tools/evaluate-strategy.ts tools/evaluate-strategy.test.ts
git commit -m "test: measure deterministic value-model calibration"
```

### Task 5: Enforce OP17 improvements and OP16 guardrails

**Files:**
- Create: `tools/op17-value-model.acceptance.test.ts`
- Read: `tools/fixtures/value-model-baseline.json`
- Modify: general parser/value/support tests only for failures exposed here

- [ ] **Step 1: Load and verify the immutable Phase-0 baseline fixture**

Import `tools/fixtures/value-model-baseline.json`; do not duplicate or regenerate
the old solver. Assert it contains the exact provisional OP17 catalog checksum
and audited 5,000-seed counts:

```ts
{
  checksum: '80185f046091d3def85245b291df31e81b349508adb29842152393c743632a52',
  'OP17-046': { opened: 941, main: 0 },
  'OP17-063': { opened: 926, main: 2 },
  'OP17-065': { opened: 2393, main: 99 },
  'OP17-093': { opened: 954, main: 0 },
  'OP17-112': { opened: 906, main: 122 },
  'OP17-118': { opened: 481, main: 52 },
  'OP17-049': { opened: 1640, main: 1636 },
  'OP17-043': { opened: 2350, main: 72 },
  'OP17-054': { opened: 1681, main: 259 },
  'OP17-114': { opened: 1657, main: 380 },
  'OP17-119': { opened: 546, main: 328 },
  counterEvents: {
    'OP17-037': { opened: 1662, main: 1 },
    'OP17-038': { opened: 3154, main: 3 },
    'OP17-076': { opened: 1651, main: 6 },
    'OP17-077': { opened: 2401, main: 0 },
    'OP17-078': { opened: 3177, main: 0 },
    'OP17-097': { opened: 3125, main: 0 },
    'OP17-098': { opened: 3174, main: 0 },
  },
}
```

These numbers were reproduced before Phase 1 with production engine commit
`1aa63a5` (the docs-only `2f7ed4b` tree is engine-equivalent), the current
Shanks fix, `generateTestPool(..., 'tournament')`, `mulberry32(seed)`, and
`StrategyDeckSolver` for seeds `0..4999`. If the catalog checksum differs, fail
with an explicit refresh/calibration message rather than comparing unrelated
data.

Load the Phase-0 OP16 fixture rather than regenerating an old solver. It must
contain checksum
`d98327c9708ef94aa3180de5cfea058d37a01e3825774748f7bff8536773d1f7`,
5,000 evaluated seeds, averages `size=40`, `twoKCounter=13.00`,
`blocker=8.67`, `vanillaLike=5.75`, `interaction=12.23`, `boss=3.98`,
`totalCounter=49398.80`, `bricks=3.60`, `early=16.04`, `middle=14.81`,
`high=9.15`, reachable misses `twoKCounter=158`, `blocker=603`,
`vanillaLike=2534`, `interaction=0`, `boss=3262`, and zero decks below both
24,000 neutral and 30,000 strength counter thresholds. Label it
`StrategyDeckSolver`/Strategy V2; it is not `BasicDeckSolver`.

- [ ] **Step 2: Write the 5,000-seed OP17 gates**

Require Gloriosa, Kaido, Luffy, Linlin, Xebec, and Queen to improve by at least
20 percentage points or reach at least 60% when opened. Loki, The 3 Sweet
Commanders, Miss Buckingham Stussy, and Ganzui may regress at most two points
and must retain their controlled contribution tests. OP17-049 must fall at
least 20 points and finish at or below 80% without being banned.

Collect distinct Rainbow-usable OP17 Events with unconditional +3000/+4000
Counter text. Require positive controlled value for all eligible Events and a
non-zero opened-to-Main inclusion rate for at least half. Keep Shanks's existing
1,000-seed first-copy guarantee.

- [ ] **Step 3: Write the parallel 5,000-seed OP16 guardrails**

Compare the immutable Phase-0 `StrategyDeckSolver` fixture with the final solver and require:

- no more than two percentage points regression in counter, boss, blocker, or vanilla-like target misses;
- no more than one point increase in decks below either configured 24,000
  neutral or 30,000 strength total-counter threshold;
- no more than `+0.25` average bricks;
- exactly 40 Main cards, physical-copy conservation, finite scores, and deterministic repeated solves for both sets.

Do not weaken a failed guardrail in the same commit as its production fix.

- [ ] **Step 4: Run RED and calibrate only through documented general policy**

Run:

```bash
npm test -- tools/op17-value-model.acceptance.test.ts --testTimeout=300000
```

Expected on first run: one or more directional/guardrail failures. Diagnose
semantic parser/support errors before changing weights. Any weight or threshold
change must be general, added to exact arithmetic tests, and accompanied by the
before/after report. Never add a card/set/name/rarity/color override.

Declare every 5,000-seed acceptance case itself with a 300,000 ms Vitest timeout
so it also remains valid under the ordinary full `npm test` command. Generate
each seed's pool counts once and reuse them for all measurements. A semantic
parser correction must follow the parser-revision protocol above.

- [ ] **Step 5: Run complete verification and reviews**

```bash
npm test -- src/solver/effect-value.test.ts src/solver/effect-support.test.ts src/solver/premium-impact.test.ts src/solver/marginal-score.test.ts tools/op17-premium-bomb.acceptance.test.ts tools/op17-value-model.acceptance.test.ts
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
```

Dispatch a spec-compliance reviewer and resolve all findings, then a code-quality
reviewer and resolve all findings. Re-run the full block after corrections.

- [ ] **Step 6: Commit acceptance and evidence**

Update this plan with exact catalog checksums, before/after rates, OP16 metrics,
test counts, and any explicit calibration decisions.

```bash
git add tools/op17-value-model.acceptance.test.ts tools/op17-premium-bomb.acceptance.test.ts tools/op17-value-model-calibration.ts tools/op17-value-model-calibration.test.ts src/strategy/strategy-profile.ts src/strategy/strategy-profile.test.ts src/solver/effect-value.ts src/solver/effect-value.test.ts src/solver/effect-support.ts src/solver/effect-support.test.ts src/solver/premium-impact.ts src/solver/premium-impact.test.ts src/solver/marginal-score.ts src/solver/marginal-score.test.ts shared/card-effect-model.ts shared/card-effect-model.test.ts shared/card-effect-parser.ts shared/card-effect-parser.test.ts shared/card-features.ts shared/card-features.test.ts shared/catalog.ts shared/catalog.test.ts src/catalog/upgrade-card-features.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts docs/superpowers/plans/2026-08-21-op17-premium-impact-calibration.md
git commit -m "test: verify OP17 value model calibration"
```

Finish with an aggregate spec and standards review across all four phases, then
run the full verification block from a clean branch before merging to local
`main`. Do not push unless the user separately requests it.
