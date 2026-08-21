# Premium Bomb Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize mass-rest and DON!!-refresh text, score those effects additively, and give the first copy of a general premium-bomb pattern a marginal-score floor so OP17-022 Shanks is normally selected.

**Architecture:** Extend the shared card-feature classifier with two conservative boolean signals and preserve schema-version-1 catalogs through explicit legacy parsing plus runtime reclassification. Keep tuning in `StrategyProfile`; keep selection unchanged and express additive effects and the first-copy floor as reconcilable marginal-score components. Acceptance combines controlled marginal-score boundaries with the checked-in OP17 catalog's confirmed pre-change failing seed 4 and a bounded 1,000-seed sample.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, existing greedy strategy solver and catalog pipeline

**Approved design:** `docs/superpowers/specs/2026-08-21-premium-bomb-scoring-design.md`

---

## File Map

- Modify `shared/card-features.ts`: add the two feature keys, conservative text detectors, and raw/Rainbow-usable classification.
- Modify `shared/card-features.test.ts`: detector boundaries, OP17-022 text, compatibility suppression, evidence order, and freezing.
- Modify `shared/catalog.ts`: accept both canonical premium flags and the exact former flag shape without changing manifest schema version.
- Modify `shared/catalog.test.ts`: strict current/legacy/partial-shape parsing tests.
- Modify `src/catalog/load-catalog.ts`: recognize current feature metadata and reclassify pre-premium metadata from printed text.
- Modify `src/catalog/load-catalog.test.ts`: current-authoritative and pre-premium fallback contracts.
- Modify `src/strategy/strategy-profile.ts`: add the first-copy floor with override merging and validation.
- Modify `src/strategy/strategy-profile.test.ts`: defaults, overrides, immutability, and invalid-value tests.
- Modify `src/solver/marginal-score.ts`: additive broad-effect scoring, premium-bomb predicate, and first-copy-only floor.
- Modify `src/solver/marginal-score.test.ts`: exact contributions, floor boundaries, second-copy behavior, and negative qualifiers.
- Create `tools/op17-premium-bomb.acceptance.test.ts`: catalog-backed seed-4 regression and 1,000-seed first-copy acceptance.
- Modify `tools/evaluate-strategy.ts`: export the existing local-catalog loader for the acceptance test.
- Modify `tools/evaluate-strategy.test.ts` and existing feature fixtures: add false defaults for the new exhaustive flag record.
- Modify other exhaustive `Record<CardFeatureKey, boolean>` fixtures reported by TypeScript: add `massRest: false` and `donRefresh: false` only; do not change their behavior.
- Modify `docs/superpowers/plans/2026-08-21-premium-bomb-scoring.md`: check completed steps and record verification/calibration evidence.

### Task 1: Add premium text features without breaking old catalogs

**Files:**
- Modify: `shared/card-features.test.ts`
- Modify: `shared/catalog.test.ts`
- Modify: `src/catalog/load-catalog.test.ts`
- Modify: `shared/card-features.ts`
- Modify: `shared/catalog.ts`
- Modify: `src/catalog/load-catalog.ts`

- [x] **Step 1: Write failing classifier boundary tests**

In `shared/card-features.test.ts`, update the stable vocabulary expectation by
placing `massRest` and `donRefresh` after `twoForOne`, then add:

```ts
it('classifies both premium effects on the exact OP17-022 rules text', () => {
  const features = classifyCardFeatures(
    card({
      cardNumber: 'OP17-022',
      cost: 10,
      power: 12_000,
      counter: 0,
      effect:
        "[Rush]<br/>[On Play] Set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
    }),
  )

  expect(features.flags).toMatchObject({
    rush: true,
    removal: true,
    boss: true,
    brick: true,
    massRest: true,
    donRefresh: true,
  })
  expect(features.rainbowUsableFlags.massRest).toBe(true)
  expect(features.rainbowUsableFlags.donRefresh).toBe(true)
  expect(features.evidence).toEqual(
    [...features.evidence].sort((left, right) => left.localeCompare(right)),
  )
})

it.each([
  "Rest up to 2 of your opponent's Characters.",
  'Rest all of your Characters.',
  "All of your opponent's Characters will not become active.",
  "Your opponent may rest all of their Characters.",
])('does not classify non-mass-rest wording: %s', (effect) => {
  expect(classifyCardFeatures(card({ effect })).flags.massRest).toBe(false)
})

it.each([
  'Add up to 2 DON!! cards from your DON!! deck and set them as active.',
  'Set up to 2 of your Characters as active.',
  'Give up to 1 rested DON!! card to this Character.',
  'You may rest 2 of your DON!! cards.',
  "Set up to 2 of your opponent's DON!! cards as active.",
  'Set up to 0 of your DON!! cards as active.',
])('does not classify non-refresh wording: %s', (effect) => {
  expect(classifyCardFeatures(card({ effect })).flags.donRefresh).toBe(false)
})

it('suppresses premium effects inside an incompatible Leader condition', () => {
  const features = classifyCardFeatures(
    card({
      effect:
        "If your Leader is [Shanks], set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
    }),
  )

  expect(features.flags.massRest).toBe(true)
  expect(features.flags.donRefresh).toBe(true)
  expect(features.rainbowUsableFlags.massRest).toBe(false)
  expect(features.rainbowUsableFlags.donRefresh).toBe(false)
})
```

Extend the existing deep-freeze assertions to cover the two new properties
through the already-frozen `flags` and `rainbowUsableFlags` records.

- [x] **Step 2: Write failing schema and loader compatibility tests**

In `shared/catalog.test.ts`, build `prePremiumFlags` by deleting both new keys
from a current fixture and assert that an otherwise current suggestion with the
pre-premium `flags` and `rainbowUsableFlags` parses unchanged. Also assert that
a record containing `massRest` but missing `donRefresh`, an unknown flag, or a
string flag fails strict parsing.

In `src/catalog/load-catalog.test.ts`, add a pre-premium enriched suggestion for
an OP17-022-shaped fixture. After loading, assert that the serialized suggestion
still lacks both keys while `featuresByCardNumber` contains `massRest: true` and
`donRefresh: true`. Extend the current enriched-metadata test with deliberately
swapped current premium flags and prove the supplied current values remain
authoritative and deeply frozen.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- shared/card-features.test.ts shared/catalog.test.ts src/catalog/load-catalog.test.ts
```

Expected: FAIL because `massRest` and `donRefresh` are not feature keys and the
pre-premium/current schema distinction does not exist.

- [x] **Step 4: Implement the conservative detectors and feature plumbing**

In `shared/card-features.ts`, append the keys after `twoForOne`, export the flag
schema for exact legacy derivation, extend `TextFeatureFlags`, and add:

```ts
function hasMassRest(text: string): boolean {
  return /\brest\s+all\s+of\s+your\s+opponent'?s\s+characters?\b/i.test(text)
}

function hasDonRefresh(text: string): boolean {
  return /\bset\s+(?:up\s+to\s+)?(?:[1-9]|10)\s+of\s+your\s+don!!\s+cards?\s+as\s+active\b/i.test(
    text,
  )
}
```

Return these values from `detectTextFeatureFlags`, copy them in
`buildFeatureFlags`, and let the existing raw/usable passes and sorted evidence
generation handle them. Do not add them to `supportRequirementFlagKeys`.

- [x] **Step 5: Implement strict pre-premium schema compatibility**

In `shared/catalog.ts`, import the exported `featureFlagsSchema`, derive:

```ts
const prePremiumFeatureFlagsSchema = featureFlagsSchema.omit({
  massRest: true,
  donRefresh: true,
})

const prePremiumCardFeaturesSchema = cardFeaturesSchema.extend({
  flags: prePremiumFeatureFlagsSchema,
  rainbowUsableFlags: prePremiumFeatureFlagsSchema,
})
```

Create the same no-support, no-rainbow, and no-support/no-rainbow variants from
`prePremiumCardFeaturesSchema` that already exist for the canonical schema, and
include all four pre-premium variants in `serializedCardFeaturesSchema`. Keep
every object strict and keep manifest `schemaVersion: 1`.

In `src/catalog/load-catalog.ts`, add a type guard that returns true only when
the supplied object contains the existing rainbow/support layers and both new
keys in both flag records:

```ts
function hasCurrentCardFeatures(
  features: StrategySuggestion['features'],
): features is CardFeatures {
  return Boolean(
    features &&
      'rainbowUsableFlags' in features &&
      'supportRequirementsByFlag' in features &&
      'massRest' in features.flags &&
      'donRefresh' in features.flags &&
      'massRest' in features.rainbowUsableFlags &&
      'donRefresh' in features.rainbowUsableFlags,
  )
}
```

Replace the inline capability check with this guard. Current metadata remains
authoritative; every older accepted shape is reclassified from `card`.

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- shared/card-features.test.ts shared/catalog.test.ts src/catalog/load-catalog.test.ts
```

Expected: PASS, including exact OP17-022 classification, negative wording,
strict legacy parsing, and loader fallback.

- [x] **Step 7: Commit the feature and compatibility layer**

```bash
git add shared/card-features.ts shared/card-features.test.ts shared/catalog.ts shared/catalog.test.ts src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts
git commit -m "feat: classify premium board swing effects"
```

### Task 2: Add validated strategy-profile policy

**Files:**
- Modify: `src/strategy/strategy-profile.test.ts`
- Modify: `src/strategy/strategy-profile.ts`

- [x] **Step 1: Write failing profile-policy tests**

In `src/strategy/strategy-profile.test.ts`, assert:

```ts
it('publishes the conservative premium-bomb floor', () => {
  const profile = getStrategyProfile('OP17')

  expect(profile.limits.premiumBombFirstCopyFloor).toBe(15)
})

it('merges premium policy overrides without changing sibling values', () => {
  const base = getStrategyProfile('OP15')
  const merged = mergeStrategyProfile(base, {
    limits: { premiumBombFirstCopyFloor: 9 },
  })

  expect(merged.limits.premiumBombFirstCopyFloor).toBe(9)
  expect(merged.weights).toEqual(base.weights)
  expect(merged.targets).toEqual(base.targets)
})
```

Add table-driven rejection tests for `-1`, `Number.NaN`, and
`Number.POSITIVE_INFINITY` in the floor. Require the error to name the invalid
field.

- [x] **Step 2: Run the focused profile test and verify RED**

Run:

```bash
npm test -- src/strategy/strategy-profile.test.ts
```

Expected: FAIL because the profile has no premium policy.

- [x] **Step 3: Implement defaults, override merging, and validation**

In `src/strategy/strategy-profile.ts`:

```ts
limits: Readonly<{
  brickTolerance: number
  searcherMinimumTargets: number
  comboMinimumSupport: number
  premiumBombFirstCopyFloor: number
}>
```

Add this base value:

```ts
limits: {
  brickTolerance: 8,
  searcherMinimumTargets: 6,
  comboMinimumSupport: 4,
  premiumBombFirstCopyFloor: 15,
},
```

Validate the floor with `Number.isFinite(value) && value >= 0`; throw a
`RangeError` naming the field on failure. Do not add an OP17-only override or
change any existing weight.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/strategy/strategy-profile.test.ts
```

Expected: PASS for defaults, overrides, validation, and deep freezing.

- [x] **Step 5: Commit the profile policy**

```bash
git add src/strategy/strategy-profile.ts src/strategy/strategy-profile.test.ts
git commit -m "feat: configure premium bomb scoring"
```

### Task 3: Score premium effects and floor only the first qualifying copy

**Files:**
- Modify: `src/solver/marginal-score.test.ts`
- Modify: `src/solver/marginal-score.ts`
- Create: `tools/op17-premium-bomb.acceptance.test.ts`
- Modify: `tools/evaluate-strategy.ts`
- Modify: exhaustive feature fixtures reported by `npm run typecheck`

- [x] **Step 1: Update the local exhaustive flag fixture and write failing additive tests**

Add `massRest: false` and `donRefresh: false` to the `flags` record in
`src/solver/marginal-score.test.ts`, then add a qualifying candidate with
`boss`, `rush`, `removal`, `massRest`, `donRefresh`, and `brick`. Use a profile
override with every unrelated weight set to zero when isolating components.
Assert the four true broad flags add rather than collapse:

```ts
expect(score.components.effectQuality).toBe(4)
```

Create the same raw flags with both premium keys false in
`rainbowUsableFlags`; assert only the two remaining usable broad flags
contribute `effectQuality: 2`. With all broad flags false in the usable record,
assert `effectQuality` is absent.

- [x] **Step 2: Write failing first-copy-floor and negative-qualifier tests**

With a zeroed profile except `premiumBombFirstCopyFloor: 15`, assert a
qualifying first copy with an ordinary subtotal of 5 gets
`premiumBombFloor: 10` and total 15. Assert a qualifying first copy with subtotal
16 has no floor component.

Add one selected copy to state with `addCandidateToDeckState` and assert the
second copy has no floor, while its existing `redundancyEffect` and any active
brick/curve penalties remain unchanged. Table-test these non-qualifiers:

```ts
[
  ['missing mass rest', ['boss', 'rush', 'donRefresh']],
  ['missing Rush', ['boss', 'massRest', 'removal', 'donRefresh']],
  ['missing DON refresh', ['boss', 'massRest', 'removal', 'rush']],
  ['missing boss', ['massRest', 'removal', 'rush', 'donRefresh']],
]
```

Also use a qualifying flag set on an `EVENT` and require no floor.

- [x] **Step 3: Write the failing catalog-backed seed-4 and 1,000-seed tests**

Rename and export the existing `localCatalogs` helper in
`tools/evaluate-strategy.ts` as `loadLocalCatalogs`, updating its command caller.
Create `tools/op17-premium-bomb.acceptance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { StrategyDeckSolver } from '../src/solver/strategy-solver.js'
import { generateTestPool } from '../src/test-pool/generate-test-pool.js'
import { loadLocalCatalogs, mulberry32 } from './evaluate-strategy.js'

function poolCounts(cardNumbers: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const cardNumber of cardNumbers) {
    counts[cardNumber] = (counts[cardNumber] ?? 0) + 1
  }
  return counts
}

function zoneQuantity(
  lines: readonly { card: { cardNumber: string }; quantity: number }[],
  cardNumber: string,
): number {
  return lines.find(({ card }) => card.cardNumber === cardNumber)?.quantity ?? 0
}

describe('OP17 premium-bomb acceptance', () => {
  it('selects and conserves OP17-022 in the confirmed pre-change failing seed 4', async () => {
    const [catalog] = await loadLocalCatalogs(['OP17'])
    if (catalog === undefined) throw new Error('OP17 catalog did not load.')
    const counts = poolCounts(
      generateTestPool(catalog, mulberry32(4), 'tournament').cardNumbers,
    )
    expect(counts['OP17-022']).toBeGreaterThan(0)

    const solution = new StrategyDeckSolver().solve(catalog, counts)
    const mainQuantity = zoneQuantity(solution.mainDeck, 'OP17-022')
    const sideboardQuantity = zoneQuantity(solution.sideboard, 'OP17-022')

    expect(solution.mainDeckSize).toBe(40)
    expect(mainQuantity).toBeGreaterThanOrEqual(1)
    expect(mainQuantity + sideboardQuantity).toBe(counts['OP17-022'])
  })

  it('selects the first OP17-022 copy whenever it appears in 1,000 seeded pools', async () => {
    const [catalog] = await loadLocalCatalogs(['OP17'])
    if (catalog === undefined) throw new Error('OP17 catalog did not load.')
    const solver = new StrategyDeckSolver()
    let poolsContainingShanks = 0

    for (let seed = 0; seed < 1_000; seed += 1) {
      const counts = poolCounts(
        generateTestPool(catalog, mulberry32(seed), 'tournament').cardNumbers,
      )
      if ((counts['OP17-022'] ?? 0) === 0) continue

      poolsContainingShanks += 1
      expect(
        zoneQuantity(solver.solve(catalog, counts).mainDeck, 'OP17-022'),
      ).toBeGreaterThanOrEqual(1)
    }

    expect(poolsContainingShanks).toBeGreaterThan(0)
  })
})
```

This uses the checked-in catalog through the production loader, so it also
exercises pre-premium feature reclassification. Seed 4 is the focused regression;
the larger sample is the bounded acceptance gate. Do not add a synthetic paired
negative solver test; missing qualifier combinations are already isolated in
Step 2.

- [x] **Step 4: Run the scorer and acceptance tests and verify RED**

Run:

```bash
npm test -- src/solver/marginal-score.test.ts tools/op17-premium-bomb.acceptance.test.ts
```

Expected: FAIL because broad effects still collapse to one point, the floor
component does not exist, and seed 4 leaves OP17-022 outside the Main deck.

- [x] **Step 5: Implement additive components and the general predicate**

In `src/solver/marginal-score.ts`, insert `premiumBombFloor` last in
`marginalScoreComponentOrder` and add its label:

```ts
premiumBombFloor: 'First-copy premium bomb floor',
```

Append `massRest` and `donRefresh` to `BROAD_EFFECT_FLAGS`. Replace the current
`.some(...)` presence check with a count of true Rainbow-usable broad flags and
score `effectQuality` as `count * profile.weights.compatibility.effect`. The
reason must include the count and stable contribution, and the component label
becomes `Broadly useful Rainbow-usable effects`:

```ts
const broadEffectCount = BROAD_EFFECT_FLAGS.filter(
  (flag) => candidate.features.rainbowUsableFlags[flag],
).length
if (broadEffectCount > 0) {
  const value = broadEffectCount * profile.weights.compatibility.effect
  entries.push([
    'effectQuality',
    value,
    `Broadly useful Rainbow-usable effects: ${broadEffectCount} (${stableNumber(value)})`,
  ])
}
```

Update existing reason snapshots from the singular label to the plural label
and use their exact new additive values; do not loosen them to partial matches.
Add the private predicate:

```ts
function isPremiumBomb(candidate: CandidateCard): boolean {
  const flags = candidate.features.rainbowUsableFlags
  return (
    candidate.card.cardType === 'CHARACTER' &&
    flags.boss &&
    flags.massRest &&
    flags.rush &&
    flags.donRefresh
  )
}
```

After all existing penalties and redundancy components are appended, compute a
provisional result with `freezeResult(entries)`. When this is the first selected
card number and it qualifies, append exactly the positive difference between
the configured floor and provisional total, then call `freezeResult(entries)`
for the returned score:

```ts
const provisional = freezeResult(entries)
const selectedCopies =
  state.selectedCountsByCardNumber[candidate.card.cardNumber] ?? 0
const floorAdjustment =
  isPremiumBomb(candidate) && selectedCopies === 0
    ? Math.max(
        0,
        profile.limits.premiumBombFirstCopyFloor - provisional.total,
      )
    : 0
if (floorAdjustment > 0) {
  entries.push([
    'premiumBombFloor',
    floorAdjustment,
    `First-copy premium bomb floor: ${stableNumber(floorAdjustment)}`,
  ])
}
return freezeResult(entries)
```

- [x] **Step 6: Repair exhaustive test fixtures mechanically**

Run `npm run typecheck`. For each reported exhaustive
`Record<CardFeatureKey, boolean>` fixture, add only:

```ts
massRest: false,
donRefresh: false,
```

Do not weaken fixture types with casts and do not change expected behavior.

- [x] **Step 7: Run scoring tests and static checks**

Run:

```bash
npm test -- src/solver/marginal-score.test.ts tools/op17-premium-bomb.acceptance.test.ts
npm run lint
npm run typecheck
```

Expected: all exit 0; additive values, the exact floor difference, first-copy
boundary, non-qualifiers, totals, and frozen outputs pass.

- [x] **Step 8: Commit scoring behavior**

```bash
git add src/solver/marginal-score.ts src/solver/marginal-score.test.ts src tools shared
git commit -m "feat: prioritize first-copy premium bombs"
```

Before committing, inspect `git diff --cached --name-only` and unstage any file
whose only purpose is not an exhaustive feature-fixture update.

### Task 4: Complete verification and record calibration

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-premium-bomb-scoring.md`

- [x] **Step 1: Re-run the focused regression and acceptance tests**

Run:

```bash
npm test -- src/solver/marginal-score.test.ts tools/op17-premium-bomb.acceptance.test.ts
```

Expected: PASS for exact additive scoring, controlled non-qualifiers, seed-4
selection and conservation, and every OP17-022 appearance in seeds 0 through
999.

- [x] **Step 2: Run the full automated gate**

Run:

```bash
npm run verify
npm run build
git diff --check
```

Expected: lint, both TypeScript projects, all Vitest projects, catalog runtime
checks, production build, and whitespace validation exit 0. Existing checked-in
catalogs remain untouched and load through the legacy reclassification path.

- [x] **Step 3: Record deterministic calibration evidence**

Run the deterministic evaluation after implementation:

```bash
npm run strategy:evaluate -- --seeds 1000
```

Record the overall OP17 report summary and the acceptance test's pool-appearance
count in `Verification Record`. The confirmed pre-change card-level baseline is
seed 4 excluding OP17-022; the evaluation report is observational, while the
1,000-seed test is the bounded card-level acceptance gate.

- [x] **Step 4: Review the implementation against scope**

Run:

```bash
rg -n "OP17-022|Shanks" shared src/solver src/strategy --glob '!*.test.ts'
git diff --stat
git status --short
```

Expected: the production-code search has no matches; the diff contains only the
feature, schema compatibility, profile, scorer, tests/fixtures, and this plan.
There are no regenerated catalog artifacts or UI changes.

- [x] **Step 5: Update this plan and commit verification evidence**

Check completed boxes and replace the empty record below with exact commands,
exit results, test counts, build result, and calibration summary. Then run:

```bash
git add docs/superpowers/plans/2026-08-21-premium-bomb-scoring.md
git commit -m "docs: verify premium bomb scoring"
```

## Verification Record

Verified on 2026-08-21 in the isolated `codex/shanks-premium-bomb` worktree.

- Regression mutation RED: temporarily restored the old broad-effect behavior
  (removed `massRest`/`donRefresh` from broad effects, collapsed broad effects
  to one point, and disabled the premium floor), then ran
  `npm test -- tools/op17-premium-bomb.acceptance.test.ts`. Vitest exited 1;
  both tests failed, with seed 4 selecting zero copies of OP17-022 and the
  bounded gate failing at seed 4. The mutation was then fully restored.
- Focused GREEN: the focused Vitest command for `marginal-score.test.ts` and
  `op17-premium-bomb.acceptance.test.ts` exited 0 with 2 test files and 37 tests
  passing. The seed-4 regression builds exactly 40 Main-deck cards, selects
  OP17-022, conserves every eligible generated card across Main and Sideboard,
  and produces the same solution on a repeated solve.
- Bounded acceptance: across deterministic tournament seeds 0 through 999,
  OP17-022 appeared in 178 pools (190 physical copies). Every one of those 178
  pools placed at least one copy in Main. The test loads the checked-in OP17
  catalog once through `loadRuntimeCatalog`; it does not claim a real-world win
  rate or that every additional copy should be selected.
- Full automated gate: the first sandboxed `npm run verify` reached 55 passing
  test files and 860 passing tests, then `catalog:check` could not create the
  tsx IPC socket (`listen EPERM .../tsx-501/22032.pipe`). Re-running the exact
  command outside the sandbox exited 0: lint and both TypeScript projects
  passed, all 55 test files and 860 tests passed, and the catalog runtime check
  reported `Runtime catalogs ready: 17 sets, 85 files`.
- Production build: `npm run build` exited 0 after the same catalog runtime
  check; TypeScript and Vite completed, transforming 128 modules and emitting
  `dist/index.html` plus the CSS and JavaScript bundles.
- Deterministic calibration: `npm run strategy:evaluate -- --seeds 1000`
  evaluated all 1,000 pools for both OP16 and OP17 with zero invalid/skipped
  decks. OP17 Strategy V2 averaged 49,074 counter, 5.98 bricks, 7.40 bosses,
  and 9.18 high-cost cards; its evaluation acceptance passed. The command
  exited 1 because OP16 reduced reachable blocker misses from 153 to 144, one
  short of the generic required reduction of 10; OP16 reported no counter,
  boss, vanilla-like, or brick regression. This report is observational and is
  not evidence of win percentage.
- Card-level comparison: the confirmed pre-change 5,000-seed OP17 baseline had
  OP17-022 in 943 pools and selected it in 211 (22.4%). The post-change bounded
  acceptance uses a different 1,000-seed window and selected the first copy in
  all 178 appearances, so it proves the intended deterministic policy rather
  than a real-world performance improvement.
- Scope/cleanliness: `git diff --check` exited 0. The production-code `rg`
  search for `OP17-022|Shanks` in `shared`, `src/solver`, and `src/strategy`
  returned no matches, confirming the production predicate is general rather
  than card- or set-specific. The branch diff contains no UI or generated
  catalog files; Leaders and DON!! remain intentionally outside solver
  conservation.
