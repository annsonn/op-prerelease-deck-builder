# OP17 Effect Context Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the immutable pre-upgrade strategy baseline, then add canonical version-2/revision-1 structured effect instances and parser diagnostics to every runtime card while preserving all existing feature flags, marginal scores, and deck selections.

**Architecture:** Put the immutable effect vocabulary and strict Zod schemas in `shared/card-effect-model.ts`; keep text normalization, clause context, requirements, costs, targets, actions, and Rainbow compatibility inside `shared/card-effect-parser.ts`. `classifyCardFeatures` remains the only public card-classification entry point and adds version-2/revision-1 metadata without changing its legacy boolean derivation in this phase. A single loader adapter accepts every already-supported serialized shape, reuses current-revision parsed effects only when their effects and diagnostics semantically equal one fresh current classification, and otherwise reparses the complete model so runtime summaries and effects cannot form a hybrid.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, existing catalog loader and greedy sealed solver

**Approved design:** `docs/superpowers/specs/2026-08-21-op17-value-model-design.md`

---

## File map

- Create `shared/card-effect-model.ts`: canonical effect types, strict schemas, empty predicates, and deep-freezing constructor.
- Create `shared/card-effect-model.test.ts`: schema strictness, finite-number checks, deterministic order, and recursive immutability.
- Create `shared/card-effect-parser.ts`: normalize and tokenize printed clauses, carry activation context, parse requirements/costs/actions/branches, and return diagnostics.
- Create `shared/card-effect-parser.test.ts`: table-driven grammar contracts plus exact OP17 semantics.
- Modify `shared/card-features.ts`: add `effectModelVersion`, `effectParserRevision`, `effects`, and `unparsedClauses` while preserving the current raw and Rainbow-usable flag passes.
- Modify `shared/card-features.test.ts`: assert additive metadata and prove old summary fields do not change.
- Modify `shared/catalog.ts`: accept strict canonical v2 metadata and all exact legacy variants under manifest schema version 1.
- Modify `shared/catalog.test.ts`: canonical/legacy/mixed/partial schema coverage.
- Create `src/catalog/upgrade-card-features.ts`: the only runtime migration adapter.
- Create `src/catalog/upgrade-card-features.test.ts`: matching-revision semantic equality, summary recomputation, mismatched/legacy/absent fallbacks, revision-mismatch rejection, and deep freeze.
- Modify `src/catalog/load-catalog.ts`: delegate all feature resolution to the adapter.
- Modify `src/catalog/load-catalog.test.ts`: verify canonical v2 runtime output for old and new artifacts.
- Modify `src/solver/deck-state.test.ts`, `src/solver/marginal-score.test.ts`, and `src/solver/strategy-solver.test.ts`: give handwritten feature fixtures the additive v2 fields without changing expectations.
- Modify `tools/catalog/derive-strategy.test.ts`: prove a normal catalog derivation emits v2 feature metadata.
- Create `tools/op17-effect-context.acceptance.test.ts`: catalog-backed semantics and Phase-1 solver-parity checks.
- Create `tools/fixtures/value-model-baseline.json`: immutable commit/checksum, exact OP17 gated-card counts, and captured OP16 strategy guardrail evidence from before production changes.

### Task 0: Capture the immutable pre-upgrade baseline

**Files:**
- Create: `tools/fixtures/value-model-baseline.json`
- Create: `tools/value-model-baseline.test.ts`

- [x] **Step 1: Generate from the named engine baseline before production edits**

Run the existing `StrategyDeckSolver` from engine commit `1aa63a5` (the
docs-only `2f7ed4b` tree is code-equivalent) against the checked-in OP17 and
OP16 catalog bytes for tournament seeds `0..4999`. Do not use
`BasicDeckSolver`. Store:

- engine commit, generator mode, seed start/count, set ID, canonical
  StrategyProfile JSON/SHA-256, and the SHA-256 of each runtime catalog artifact
  set;
- the already reproduced OP17 opened/Main counts for OP17-043, 046, 049, 054,
  063, 065, 093, 112, 114, 118, and 119;
- a SHA-256 of the canonical StrategyDeckSolution JSON for each OP17 seed
  `0..99`, used by the Phase-1 no-scoring-change gate;
- for OP16, evaluated/invalid/nondeterministic deck totals, target-miss totals,
  threshold counts, and the immutable reported averages shown below; future
  capture code should additionally retain raw sums wherever the existing
  evaluator exposes them so Phase 4 need not reverse rounded values; and
- exactly-40 and physical-copy-conservation failure totals for both sets.

- [x] **Step 2: Lock provenance and shape with a failing-then-passing test**

Create `tools/value-model-baseline.test.ts` to validate every count as a
non-negative safe integer and every reported average as finite/non-negative,
require exactly 5,000 requested/evaluated pools,
assert both catalog checksums against the checked-in bytes, and assert the exact
known OP17 counts copied in Phase 4. Require exactly 100 ordered OP17 solution
digests for seeds 0 through 99, each a lowercase SHA-256. The test must fail
with a refresh-specific message on checksum drift. It must not rerun 10,000
solves during ordinary unit tests.

The fixture must include this already captured OP16 strategy baseline exactly:

```ts
{
  checksum: 'd98327c9708ef94aa3180de5cfea058d37a01e3825774748f7bff8536773d1f7',
  seeds: 5000,
  averages: {
    size: 40, twoKCounter: 13.00, blocker: 8.67,
    vanillaLike: 5.75, interaction: 12.23, boss: 3.98,
    totalCounter: 49398.80, bricks: 3.60,
    early: 16.04, middle: 14.81, high: 9.15,
  },
  reachableTargetMisses: {
    twoKCounter: 158, blocker: 603, vanillaLike: 2534,
    interaction: 0, boss: 3262,
  },
  belowCounterThreshold: { neutralMinimum24000: 0, strengthMinimum30000: 0 },
}
```

Label this `StrategyDeckSolver`/Strategy V2 baseline explicitly; it is not the
existing evaluator's `BasicDeckSolver` baseline column.

The OP17 fixture must use checksum
`80185f046091d3def85245b291df31e81b349508adb29842152393c743632a52`
and these exact `{ opened, main }` counts: 043 `{2350,72}`, 046 `{941,0}`,
049 `{1640,1636}`, 054 `{1681,259}`, 063 `{926,2}`, 065 `{2393,99}`,
093 `{954,0}`, 112 `{906,122}`, 114 `{1657,380}`, 118 `{481,52}`, and
119 `{546,328}`. Its eligible Counter-Event counts are 037 `{1662,1}`,
038 `{3154,3}`, 076 `{1651,6}`, 077 `{2401,0}`, 078 `{3177,0}`,
097 `{3125,0}`, and 098 `{3174,0}`. Keys expand to `OP17-NNN`; tuple order is
opened then Main.

- [x] **Step 3: Commit the baseline before Task 1**

```bash
git add tools/fixtures/value-model-baseline.json tools/value-model-baseline.test.ts
git commit -m "test: capture pre-upgrade value model baseline"
```

No production file may change before this commit exists.

Task 0 evidence (2026-08-21):

- RED: `npm test -- tools/value-model-baseline.test.ts` failed all 6 tests
  with the expected missing-fixture `ENOENT`.
- Capture: a temporary, subsequently removed generator ran
  `StrategyDeckSolver` twice for tournament seeds `0..4999` against both
  checked-in catalogs. All audited OP17 gated-card and Counter-Event counts
  exactly matched the approved design; OP16 raw metric sums are retained beside
  the specified reported averages.
- Invariants: OP16 and OP17 each evaluated 5,000 pools with 0 skipped, invalid,
  nondeterministic, non-40-card, or physical-copy-conservation failures.
- GREEN: `npm test -- tools/value-model-baseline.test.ts` passed 1 file / 6
  tests; `npm run lint` and `npm run typecheck` passed.
- Quality-review RED: mutation tests proved the original permissive cast
  accepted a missing metric and a forged solution digest; running Vitest from
  `/private/tmp` with `--root` produced 8 path-dependent `ENOENT` failures.
- Quality-review GREEN: a strict Zod schema now enforces exact set/artifact and
  metric shapes, safe counts, reconciliation invariants, the fixed historical
  profile snapshot/digest, and the pinned aggregate digest for ordered seeds
  `0..99`. The focused suite passes 1 file / 8 tests from both the repository
  and `/private/tmp`; `npm run lint` and `npm run typecheck` pass.

### Task 1: Define and validate the canonical effect vocabulary

**Files:**
- Create: `shared/card-effect-model.test.ts`
- Create: `shared/card-effect-model.ts`

- [x] **Step 1: Write failing schema and immutability tests**

Create `shared/card-effect-model.test.ts` with a complete minimal instance and the strict boundaries:

```ts
import { describe, expect, it } from 'vitest'

import {
  cardEffectModelSchema,
  createCardEffectModel,
  emptyCardPredicate,
  type EffectInstance,
} from './card-effect-model.js'

const EFFECT: EffectInstance = {
  id: 'effect:0',
  source: 'effect',
  activation: 'onPlay',
  timing: [],
  condition: { kind: 'always' },
  costs: [],
  chooser: 'none',
  optional: false,
  branches: [{ actions: [{ kind: 'draw', subject: 'player', amount: 1 }] }],
  rainbowLuffyCompatibility: 'compatible',
}

describe('card effect model', () => {
  it('accepts and deeply freezes a deterministic canonical model', () => {
    const model = createCardEffectModel({ effects: [EFFECT], unparsedClauses: [] })
    expect(cardEffectModelSchema.parse(model)).toEqual(model)
    expect(model.effectModelVersion).toBe(2)
    expect(model.effectParserRevision).toBe(1)
    expect(Object.isFrozen(model)).toBe(true)
    expect(Object.isFrozen(model.effects)).toBe(true)
    expect(Object.isFrozen(model.effects[0]!.branches[0]!.actions)).toBe(true)
    expect(emptyCardPredicate()).toEqual({
      names: [], traits: [], cardTypes: [], minimumCost: null,
      maximumCost: null, minimumPower: null, maximumPower: null,
      counter: 'any', hasTrigger: null,
    })
  })

  it.each([
    [{ ...EFFECT, unexpected: true }],
    [{ ...EFFECT, id: '' }],
    [{ ...EFFECT, branches: [] }],
    [{ ...EFFECT, branches: [{ actions: [{ kind: 'draw', subject: 'player', amount: -1 }] }] }],
    [{ ...EFFECT, branches: [{ actions: [{ kind: 'powerModifier', powerDelta: Number.NaN, target: { subject: 'player', zones: ['field'], quantity: 1, predicate: emptyCardPredicate(), differentNames: false, totalCostMaximum: null, allowsSelf: false }, duration: 'thisTurn' }] }] }],
  ])('rejects invalid or partial effect instances %#', (effect) => {
    expect(cardEffectModelSchema.safeParse({
      effectModelVersion: 2,
      effectParserRevision: 1,
      effects: [effect],
      unparsedClauses: [],
    }).success).toBe(false)
  })
})
```

- [x] **Step 2: Run the model test and verify RED**

Run:

```bash
npm test -- shared/card-effect-model.test.ts
```

Expected: FAIL because `shared/card-effect-model.ts` does not exist.

- [x] **Step 3: Implement the complete model and strict schemas**

Create `shared/card-effect-model.ts` with the exact unions from the approved design (`EffectSource`, `ActivationChannel`, `TimingModifier`, `EffectSubject`, `EffectChooser`, `CardPredicate`, `TargetSpec`, `RequirementExpression`, `EffectCost`, `EffectAction`, `EffectBranch`, and `EffectInstance`). `TargetSpec` includes required `allowsSelf`; power actions use signed finite `powerDelta`; and `negateEffect` is a first-class action. Export matching recursive Zod schemas. Use finite non-negative numbers for counts, ceilings, and ordinary amounts; use finite signed numbers for power deltas; use positive integers for target quantities; require at least one branch and at least one action per branch; keep every object strict.

The public model wrapper and constructor must be:

```ts
export interface CardEffectModel {
  readonly effectModelVersion: 2
  readonly effectParserRevision: 1
  readonly effects: readonly EffectInstance[]
  readonly unparsedClauses: readonly string[]
}

export const CURRENT_EFFECT_PARSER_REVISION = 1 as const

export const cardEffectModelSchema = z.strictObject({
  effectModelVersion: z.literal(2),
  effectParserRevision: z.literal(CURRENT_EFFECT_PARSER_REVISION),
  effects: z.array(effectInstanceSchema),
  unparsedClauses: z.array(z.string().min(1)),
})

export function emptyCardPredicate(): CardPredicate {
  return {
    names: [], traits: [], cardTypes: [], minimumCost: null,
    maximumCost: null, minimumPower: null, maximumPower: null,
    counter: 'any', hasTrigger: null,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createCardEffectModel(
  input: Omit<CardEffectModel, 'effectModelVersion' | 'effectParserRevision'>,
): CardEffectModel {
  const parsed = cardEffectModelSchema.parse({
    effectModelVersion: 2,
    effectParserRevision: CURRENT_EFFECT_PARSER_REVISION,
    ...input,
  })
  return deepFreeze(structuredClone(parsed))
}
```

Do not place regexes, card text, score weights, or OP17 identities in this file.

- [x] **Step 4: Run the model test and verify GREEN**

Run `npm test -- shared/card-effect-model.test.ts`.

Expected: PASS with strict invalid-shape rejection and recursive freezing.

- [x] **Step 5: Commit the vocabulary**

```bash
git add shared/card-effect-model.ts shared/card-effect-model.test.ts
git commit -m "feat: define structured card effect model"
```

Task 1 evidence (2026-08-21):

- RED: `npm test -- shared/card-effect-model.test.ts` failed because
  `shared/card-effect-model.ts` did not exist.
- GREEN: `npm test -- shared/card-effect-model.test.ts` passed 1 file / 12
  tests, covering strict recursive schemas, every action family, first-class
  effect negation, signed finite power deltas, required `allowsSelf`, stable
  ordering, independent cloning, and recursive freezing.
- Quality-review RED: a mutation that recursively froze the model while
  deliberately skipping nested `target` values failed at the new target-freeze
  assertion. The restored implementation passed with two effects, two ordered
  branches, nested action objects, target specs, predicates, and predicate
  arrays all explicitly covered.
- Verification: `npm run lint`, `npm run typecheck`, and `git diff --check`
  passed.

### Task 2: Parse activation blocks, continuations, choices, and shared costs

**Files:**
- Create: `shared/card-effect-parser.test.ts`
- Create: `shared/card-effect-parser.ts`

- [x] **Step 1: Write failing clause-context tests**

Create `shared/card-effect-parser.test.ts` with a local `card()` fixture and these contracts:

```ts
it('keeps Then actions in one instance with one paid cost', () => {
  const result = parseCardEffects(card({
    effect: "[On Play] DON!!-1: Draw 1 card. Then, up to 2 of your opponent's Characters with a cost of 5 or less cannot attack until the end of your opponent's next End Phase.",
  }))
  expect(result.effects).toEqual([expect.objectContaining({
    id: 'effect:0', activation: 'onPlay',
    costs: [{ kind: 'donMinus', amount: 1 }],
    branches: [{ actions: [
      { kind: 'draw', subject: 'player', amount: 1 },
      expect.objectContaining({ kind: 'lockAttack', duration: 'untilOpponentsNextEndPhase' }),
    ] }],
  })])
})

it('inherits an opponent chooser and subject across bullets', () => {
  const result = parseCardEffects(card({
    effect: '[On Play] Your opponent chooses one:<br/>• Draw 2 cards.<br/>• Your opponent trashes 2 cards from their hand.',
  }))
  expect(result.effects[0]).toMatchObject({ chooser: 'opponent', branches: [
    { actions: [{ kind: 'draw', subject: 'opponent', amount: 2 }] },
    { actions: [{ kind: 'handDiscard', subject: 'opponent', amount: 2 }] },
  ] })
})

it('copies common actions before a choice into every branch', () => {
  const result = parseCardEffects(card({
    effect: '[On Play] Draw 1 card, then choose one:<br/>- Add 1 card to your Life.<br/>- Add 1 card from your opponent\'s Life to their hand.',
  }))
  expect(result.effects[0]?.branches).toEqual([
    { actions: [expect.objectContaining({ kind: 'draw' }), expect.objectContaining({ kind: 'lifeMove', direction: 'gainOwnLife' })] },
    { actions: [expect.objectContaining({ kind: 'draw' }), expect.objectContaining({ kind: 'lifeMove', direction: 'opponentLifeToHand' })] },
  ])
})

it('defaults an unannotated continuous clause to static without inheriting the prior activation', () => {
  const result = parseCardEffects(card({
    effect: '[On Play] Draw 1 card.<br/>All of your Characters without a Counter have +1000 Counter.',
  }))
  expect(result.effects.map(({ activation }) => activation)).toEqual(['onPlay', 'static'])
})

it.each([
  ['[Blocker]', 'static'], ['[On Play] Draw 1 card.', 'onPlay'],
  ['[Activate: Main] Draw 1 card.', 'activateMain'],
  ['[Counter] Up to 1 of your Leader gains +2000 power.', 'counter'],
  ['[On K.O.] Draw 1 card.', 'onKo'],
  ['[When Attacking] Draw 1 card.', 'whenAttacking'],
  ["[On Your Opponent's Attack] Draw 1 card.", 'onOpponentsAttack'],
])('maps %s to %s', (effect, activation) => {
  expect(parseCardEffects(card({ effect })).effects[0]?.activation).toBe(activation)
})

it('never merges Trigger-field text into the printed effect instance', () => {
  const result = parseCardEffects(card({
    effect: '[On Play] Draw 1 card.', trigger: '[Trigger] Play this card.',
  }))
  expect(result.effects.map(({ id, source, activation }) => [id, source, activation])).toEqual([
    ['effect:0', 'effect', 'onPlay'], ['trigger:0', 'trigger', 'trigger'],
  ])
})
```

- [x] **Step 2: Run the parser test and verify RED**

Run `npm test -- shared/card-effect-parser.test.ts`.

Expected: FAIL because `parseCardEffects` is missing.

- [x] **Step 3: Implement normalization and context tokenization**

Create `shared/card-effect-parser.ts`. Export only:

```ts
export function normalizeCardRulesText(text: string): string
export function parseCardEffects(card: PlayableCard): CardEffectModel
```

Normalize HTML breaks, full-width brackets/braces, curly quotes, Unicode minus/dashes, bullets, non-breaking spaces, and `K.O.` periods. Tokenize `effect` and `trigger` separately into `{ source, text, bullet }` clauses. Use a context record with `activation`, `timing`, `condition`, `costs`, `chooser`, and `compatibility`; flush it only on a new bracketed activation or independent sentence. An unannotated continuous/conditional sentence starts a new `static` instance rather than inheriting the previous activation. Timing annotations preceding an activation stay with that activation. A `Then` clause appends to the prior branch. When `choose one` follows common actions, copy those actions into each bullet branch; do not value them once per branch because only one branch is selected. Allocate IDs as `${source}:${instanceIndex}` after parsing so skipped unknown clauses cannot create unstable gaps.

Use these annotation maps exactly:

```ts
const ACTIVATIONS = new Map([
  ['on play', 'onPlay'], ['activate: main', 'activateMain'],
  ['main', 'main'], ['counter', 'counter'], ['trigger', 'trigger'],
  ['on k.o.', 'onKo'], ['when attacking', 'whenAttacking'],
  ['on block', 'onBlock'], ["on your opponent's attack", 'onOpponentsAttack'],
] as const)
const TIMINGS = new Map([
  ['once per turn', 'oncePerTurn'], ['your turn', 'yourTurn'],
  ["opponent's turn", 'opponentsTurn'],
] as const)
```

Parse colon prefixes into shared costs (`DON!!-N`, `rest N ... DON!!`, discard/trash N from hand, trash self, rest self). Parse bracketed Blocker/Rush/Banish as static keyword actions. Set `allowsSelf: true` only for explicit `this card`/`this Character` support wording and false otherwise. Preserve an unrecognized non-empty result in `unparsedClauses` rather than inventing an action.

- [x] **Step 4: Run the clause-context tests and verify GREEN**

Run `npm test -- shared/card-effect-parser.test.ts`.

Expected: PASS for every activation, shared cost, `Then`, bullet branch, and Trigger separation.

- [x] **Step 5: Commit the parser skeleton**

```bash
git add shared/card-effect-parser.ts shared/card-effect-parser.test.ts
git commit -m "feat: parse card effect context"
```

Task 2 evidence (2026-08-21):

- RED: `npm test -- shared/card-effect-parser.test.ts` failed before collection
  because `shared/card-effect-parser.ts` did not exist.
- GREEN: `npm test -- shared/card-effect-parser.test.ts` passed 1 file / 24
  tests covering normalization, every activation mapping, leading timing,
  `Then` cost ownership, chooser/subject inheritance, common-choice actions,
  Trigger separation, dense IDs, structural keywords, explicit-self targets,
  and unknown-clause diagnostics.
- Regression verification: the complete suite passed 58 files / 915 tests;
  `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Spec-review RED: 5 of 31 focused tests failed, proving Trigger-field labels
  could override Trigger activation, line-broken `Then` lost its context,
  same-line clauses collapsed, trailing unknown text disappeared, and IDs
  consequently did not remain source-local and dense.
- Spec-review GREEN: the focused suite passed 1 file / 31 tests after making
  Trigger activation source-authoritative, introducing explicit continuation
  state, tokenizing printed sentences before classification, and retaining the
  unmatched residue of partially parsed clauses as diagnostics.
- Post-review verification: the complete suite passed 58 files / 922 tests;
  `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Annotation-review RED: 3 of 34 focused tests failed because an
  activation/timing-only line was discarded before its result clause.
- Annotation-review GREEN: the focused suite passed 1 file / 34 tests after
  retaining one-use pending annotation context, replacing it with later
  annotation blocks, and preserving Trigger-source activation authority.
- Annotation-review verification: the complete suite passed 58 files / 925
  tests; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Context-composition RED: 4 of 38 focused tests failed because activation-only
  and timing-only annotation blocks replaced the entire pending context.
- Context-composition GREEN: the focused suite passed 1 file / 38 tests after
  splitting pending activation and timing into independently composable and
  replaceable typed fields.
- Context-composition verification: the complete suite passed 58 files / 929
  tests; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Conservative-parsing RED: 6 of 44 focused tests failed because bracketed
  DON-minus lost its cost, unsupported annotations could expose optimistic
  actions, unknown choice bullets disappeared, and alternative activation
  diagnostics lost the first printed mode.
- Conservative-parsing GREEN: the focused suite passed 1 file / 44 tests after
  whitelisting leading annotations, recognizing bracketed DON-minus, rejecting
  unrepresentable activation syntax, and retaining unknown branches as
  explicit zero-value actions plus diagnostics.
- Conservative-parsing verification: the complete suite passed 58 files / 935
  tests; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.

### Task 3: Parse subjects, targets, actions, duration, and clause-local compatibility

**Files:**
- Modify: `shared/card-effect-parser.test.ts`
- Modify: `shared/card-effect-parser.ts`

- [x] **Step 1: Add failing action and safety tables**

Append table-driven tests covering every Phase-1 action family. Each row must assert the complete parsed action, not a boolean. Include own/opponent draw, filter, hand discard, K.O., bottom deck, return hand, rest, power reduction, effect negation, attack lock, deploy, trash deploy, protection, Life gain, opposing Life to hand, DON refresh/ramp, counter modifier, power modifier, and Leader base power. Include `quantity: 1`, `2`, `all`, and `anyNumber`, cost ceilings, power bounds, card types, counter predicates, Trigger predicates, different names, total-cost ceilings, `allowsSelf` true/false, and all declared durations.

Add explicit safety tests:

```ts
it('keeps an unknown draw subject diagnostic and gives it no player identity', () => {
  const result = parseCardEffects(card({ effect: '[On Play] Draw cards.' }))
  expect(result.unparsedClauses).toContain('Draw cards.')
  expect(result.effects.flatMap((effect) => effect.branches).flatMap((branch) => branch.actions)).not.toContainEqual(
    expect.objectContaining({ kind: 'draw', subject: 'player' }),
  )
})

it('resolves that Character only inside the same instance', () => {
  const result = parseCardEffects(card({
    effect: "[Activate: Main] DON!!-1: Negate the effect of up to 1 of your opponent's Characters with a cost of 6 or less, and K.O. that Character.",
  }))
  const remove = result.effects[0]!.branches[0]!.actions.find((action) => action.kind === 'remove')
  expect(remove).toMatchObject({ mode: 'ko', target: { subject: 'opponent', quantity: 1, predicate: { maximumCost: 6 } } })
  expect(result.effects[0]!.branches[0]!.actions).toContainEqual(
    expect.objectContaining({ kind: 'negateEffect', target: expect.objectContaining({ subject: 'opponent', quantity: 1 }) }),
  )
})

it('normalizes an absolute Leader base power to a delta for Rainbow Luffy', () => {
  const result = parseCardEffects(card({
    effect: "[On Play] Your Leader's base power becomes 6000 until the end of your opponent's next End Phase.",
  }))
  expect(result.effects[0]?.branches[0]?.actions).toContainEqual(
    expect.objectContaining({ kind: 'leaderBasePower', powerDelta: 1000 }),
  )
})

it('marks only the Leader-locked instance incompatible', () => {
  const result = parseCardEffects(card({
    effect: 'If your Leader is [Nami], draw 1 card.<br/>[Blocker]',
  }))
  expect(result.effects.map(({ rainbowLuffyCompatibility }) => rainbowLuffyCompatibility)).toEqual([
    'incompatible', 'compatible',
  ])
})
```

- [x] **Step 2: Run action tests and verify RED**

Run `npm test -- shared/card-effect-parser.test.ts`.

Expected: FAIL on the first unimplemented action/target field and clause-local compatibility.

- [x] **Step 3: Implement conservative action and requirement parsing**

Add focused private functions `parseTargetSpec`, `parseRequirement`, `parseCosts`, `parseActions`, and `effectCompatibility`. Process specific patterns before broad ones. Numeric words `one`, `two`, and `three` may normalize to integers; other unknown quantities stay diagnostic. Explicit `your opponent`/`opponent's` targets are opponent; `your` targets are player; `this Character` is `thisCard`. The owner-deck wording may be opponent only when the same target phrase already established an opposing Character, or the clause is the unambiguous `Place up to N Character ... bottom of the owner's deck` board-removal form. Emit `negateEffect` before resolving a same-instance `K.O. that Character` to the identical target. Power actions store a signed delta. For the fixed 5000-power Rainbow Luffy, absolute Leader-base wording subtracts 5000; target-base wording such as "4000 base power becomes 8000" subtracts the exact parsed predicate value. If no safe baseline exists, retain the clause as unknown rather than storing the absolute result as a bonus.

Return `{ kind: 'unknown', normalizedText }` only when the action is recognized as an action block but its safe semantics are incomplete; otherwise add the clause to diagnostics. Parse Leader name/trait and mono-color restrictions into `RequirementExpression.kind === 'leader'`, and mark only that effect instance incompatible. Parse all other recognized conditions into `cards`, `selfState`, `all`, or `any`; use `unknown` for unresolved conditions. Never carry target references across effect instances.

Only explicit activation conditions such as `if`/`when` become the instance
`RequirementExpression`. Do not copy a filter, deploy, search, aura, or other
action's eligible output `TargetSpec` into the instance condition; Phase 3
evaluates that target per action so independent sibling actions remain usable.

- [x] **Step 4: Run parser tests and verify GREEN**

Run `npm test -- shared/card-effect-parser.test.ts`.

Expected: PASS for all action families and safety negatives.

- [x] **Step 5: Commit complete Phase-1 parsing**

```bash
git add shared/card-effect-parser.ts shared/card-effect-parser.test.ts
git commit -m "feat: parse structured card actions"
```

Task 3 evidence (2026-08-21):

- RED: `npm test -- shared/card-effect-parser.test.ts` retained all 50 prior
  parser tests as passing and failed 27 new action, target, requirement,
  duration, compatibility, and Event-cost cases.
- GREEN: the focused suite passed 1 file / 77 tests after adding conservative
  parsing for every Phase-1 action family, exact target predicates and zones,
  same-instance target references, compound requirements, and clause-local
  Rainbow Luffy compatibility.
- Self-review RED: 3 of 81 focused tests failed for jointly rested self costs,
  standalone negation, and named-Leader target locking; a further cost audit
  failed 1 of 82 tests for qualified discard and replacement costs.
- Self-review GREEN: the focused suite passed 1 file / 82 tests with all four
  omissions corrected and an opponent-turn duration guard retained.
- Verification: the complete suite passed 58 files / 973 tests;
  `npm run lint`, `npm run typecheck`, and `git diff --check` passed. Production
  parser rules contain no set IDs, card numbers, card names, rarities, or color
  exceptions.
- Spec-review RED: 8 of 90 focused tests failed, proving condition-first costs
  lost compatibility, a loose conjunction invented `restSelf`, incomplete
  targets lacked unknown actions, exclusionary self wording became self-deploy,
  three conditional modifier forms were missing, power-target quantities were
  flattened, and both-player draw became player draw.
- Spec-review GREEN: the focused suite passed 1 file / 90 tests after parsing
  condition/cost prefixes in either printed order, requiring verb-local self
  costs, replacing every failed target with an unknown action plus diagnostic,
  and adding the reviewed general grammar with near-negative coverage.
- Post-review verification: the complete suite passed 58 files / 981 tests;
  `npm run lint`, `npm run typecheck`, and `git diff --check` passed, and no
  fallback `TargetSpec` remains in a target-parsing failure path.
- Final spec-review RED: 5 of 107 focused model/parser tests failed, proving a
  cost-first condition leaked into diagnostics, condition-first payment text
  lost optionality, exclusionary self wording could be rediscovered by a
  suffix action match, mixed Leader/Character targets lost `LEADER`, and the
  strict predicate schema did not yet admit that canonical target type.
- Final spec-review GREEN: the focused model/parser suite passed 2 files / 107
  tests after producing one fully condition-stripped action string, deriving
  optionality from the original clause, masking `other than this Character`
  before all action and target parsing, and adding strict `LEADER` predicate
  support while retaining parser revision 1 before release.
- Final post-review verification: the complete suite passed 58 files / 986
  tests; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Protection-review RED: 1 of 97 parser tests failed because the clause parser
  split `one of your Characters other than this Character would be removed`
  into an unknown condition/action before replacement protection could own the
  wording.
- Protection-review GREEN: the focused parser suite passed 1 file / 97 tests
  after recognizing the complete future replacement condition and matching its
  centrally masked non-self target; an explicit-self positive and past-tense
  near-negative guard both pass. The complete suite passed 58 files / 989
  tests, with lint, typecheck, and `git diff --check` green.
- Quality-review RED: 11 of 120 focused model/parser tests failed, proving an
  unsupported or alternative colon cost could expose free actions, a
  self-deploy from trash chose the wrong zone, an unknown leading action lost
  its explicit activation and shared cost before `Then`, the parser injected
  printed Event cost owned by Phase 2, `all` and `any` shared one incorrect
  compatibility rule, and an unqualified `there is` condition was assigned to
  the player.
- A mutation-sensitive near-negative then failed 1 of 121 focused tests because
  `cost of 2 or less` was initially mistaken for an alternative payment.
- Quality-review GREEN: the focused model/parser suite passed 2 files / 121
  tests after making unsupported-cost drafts internally unavailable, retaining
  annotated unknown drafts for continuation ownership, parsing explicit
  self-deployment zones before fallback, leaving printed Event cost to the
  evaluator, implementing distinct tri-state `all`/`any` truth tables, and
  representing unqualified board-state conditions with `bothPlayers`.
  Near-negatives also prove that alternative payments are never charged
  cumulatively, payment predicates containing `or less` remain valid, and
  unsupported payment text cannot leak a recognized `Then` action. The
  complete suite passed 58 files / 1000 tests; lint, typecheck, and
  `git diff --check` passed.

### Task 4: Publish v2 features without changing legacy summaries

**Files:**
- Modify: `shared/card-features.test.ts`
- Modify: `shared/card-features.ts`
- Modify: `src/solver/deck-state.test.ts`
- Modify: `src/solver/marginal-score.test.ts`
- Modify: `src/solver/strategy-solver.test.ts`

- [x] **Step 1: Write failing additive-metadata tests**

In `shared/card-features.test.ts`, add:

```ts
it('publishes parsed v2 metadata without changing legacy summary semantics', () => {
  const value = card({ effect: '[On Play] Draw 1 card. Then, K.O. up to 1 of your opponent\'s Characters.' })
  const features = classifyCardFeatures(value)
  expect(features.effectModelVersion).toBe(2)
  expect(features.effectParserRevision).toBe(1)
  expect(features.effects).toHaveLength(1)
  expect(features.effects[0]?.branches[0]?.actions.map(({ kind }) => kind)).toEqual(['draw', 'remove'])
  expect(features.flags).toMatchObject({ draw: true, removal: true, twoForOne: false })
  expect(features.rainbowUsableFlags).toMatchObject({ draw: true, removal: true })
  expect(Object.isFrozen(features.effects[0]?.branches[0]?.actions)).toBe(true)
})
```

Capture the existing returned summary fields for a representative unconditional, Leader-incompatible, generic-conditional, Trigger-only, and mixed-clause fixture before editing. Assert those exact flags, compatibility, search targets, requirements, and evidence after v2 metadata is present.

- [x] **Step 2: Run classifier tests and verify RED**

Run `npm test -- shared/card-features.test.ts`.

Expected: FAIL because `CardFeatures` has no version-2 fields.

- [x] **Step 3: Add the model to `CardFeatures`**

In `shared/card-features.ts`, make `CardFeatures` extend `CardEffectModel`, extend `cardFeaturesSchema` with `cardEffectModelSchema.shape`, and call `parseCardEffects(card)` once inside `classifyCardFeatures`. Spread only `effectModelVersion`, `effectParserRevision`, `effects`, and `unparsedClauses` into the frozen result. Leave `detectTextFeatureFlags`, `buildFeatureFlags`, `rainbowUsableRulesText`, support summaries, compatibility summary, and evidence unchanged in Phase 1.

Update handwritten `CardFeatures` fixtures in the three solver tests with:

```ts
effectModelVersion: 2,
effectParserRevision: 1,
effects: [],
unparsedClauses: [],
```

Do not change any existing score, coverage, or solution expectations.

- [x] **Step 4: Run classifier and solver unit tests and verify GREEN**

Run:

```bash
npm test -- shared/card-features.test.ts src/solver/deck-state.test.ts src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts
```

Expected: PASS with no updated score snapshots.

- [x] **Step 5: Commit the additive feature contract**

```bash
git add shared/card-features.ts shared/card-features.test.ts src/solver/deck-state.test.ts src/solver/marginal-score.test.ts src/solver/strategy-solver.test.ts
git commit -m "feat: publish version two card features"
```

Task 4 evidence (2026-08-21):

- RED: `npm test -- shared/card-features.test.ts` failed only the new additive
  contract (`effectModelVersion` was `undefined` instead of `2`); the other 97
  classifier tests passed.
- GREEN: the four-file classifier/solver command passed 4 files / 168 tests
  without changing any score, coverage, or solution expectation.
- Parity: `npm test -- tools/value-model-baseline.test.ts` passed 1 file / 8
  tests, retaining the pinned score/solution evidence and aggregate digest.
- Static review: `npm run lint` and `git diff --check` passed. The Task 4 diff
  changes only the feature contract, its legacy-parity tests, and the three
  named handwritten solver fixtures.
- Expected Phase boundary: the full suite has 8 failures in
  `shared/catalog.test.ts`, `src/catalog/load-catalog.test.ts`, and
  `tools/op17-premium-bomb.acceptance.test.ts`; `npm run typecheck` has one
  corresponding `src/catalog/load-catalog.ts` error. They prove the old
  serialized catalog/loader path cannot yet produce canonical v2 metadata and
  are the explicit RED inputs for Task 5's schema union and upgrade adapter.

### Task 5: Accept old catalogs and expose only canonical v2 at runtime

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-op17-value-model-design.md`
- Modify: `shared/catalog.test.ts`
- Modify: `shared/catalog.ts`
- Create: `src/catalog/upgrade-card-features.test.ts`
- Create: `src/catalog/upgrade-card-features.ts`
- Modify: `src/catalog/load-catalog.test.ts`
- Modify: `src/catalog/load-catalog.ts`
- Modify: `tools/catalog/derive-strategy.test.ts`
- Modify: `tools/evaluate-strategy.test.ts`

- [x] **Step 1: Write failing strict migration tests**

In `shared/catalog.test.ts`, assert: a complete v2/revision-1 suggestion parses; all eight currently supported legacy/premium variants still parse unchanged; `effectModelVersion: 2` with missing/wrong `effectParserRevision`, missing `effects`, missing `unparsedClauses`, an invalid nested action, or an unknown nested key fails; mixing v2 fields into a legacy flag shape fails.

In `src/catalog/upgrade-card-features.test.ts`, assert:

```ts
const canonical = classifyCardFeatures(card({ effect: '[On Play] Draw 1 card.' }))
expect(upgradeSerializedCardFeatures(card(), canonical)).toEqual(canonical)
expect(upgradeSerializedCardFeatures(card(), canonical)).not.toBe(canonical)
expect(upgradeSerializedCardFeatures(card({ effect: '[Blocker]' }), legacyFeatures).effects).not.toHaveLength(0)
expect(upgradeSerializedCardFeatures(card({ effect: '[Rush]' }), undefined).effectModelVersion).toBe(2)
```

Also mutate the serialized legacy summary flags beside exact revision-1
effects and prove the adapter ignores those projections and recomputes current
flags/support summaries. Mutate effects and diagnostics independently and
prove either semantic mismatch falls back to the complete fresh
classification. Revision 1 has no older v2 revision; wrong revisions are
rejected by the Phase-1 serialized schema. Recursively walk each returned value
and expect every array/object frozen. When a later phase increments the
revision, it must add the prior-revision adapter-reparse test then.

- [x] **Step 2: Run schema/adapter tests and verify RED**

Run:

```bash
npm test -- shared/catalog.test.ts src/catalog/upgrade-card-features.test.ts
```

Expected: FAIL because the schema union and adapter do not exist.

- [x] **Step 3: Implement the exact legacy union and adapter**

In `shared/catalog.ts`, preserve the current eight legacy schemas under explicit legacy names and pinned literal historical flag/object schemas that do not derive from the evolving `cardFeaturesSchema` or current feature-key arrays. Define canonical serialized v2 parse metadata with `effectModelVersion`, `effectParserRevision`, strict effects, and diagnostics; legacy summary fields may remain present for artifact compatibility but are projections, not authoritative inputs. Set `serializedCardFeaturesSchema` to a union whose first member is v2/revision-1 and whose remaining members are the exact previous accepted shapes. Retain an explicit accepted prior-revision schema whenever a later phase increments the parser revision. Export `SerializedCardFeatures = z.infer<typeof serializedCardFeaturesSchema>` for the adapter. Keep the outer manifest at `schemaVersion: 1`.

Create `src/catalog/upgrade-card-features.ts`:

```ts
export function upgradeSerializedCardFeatures(
  card: PlayableCard,
  serialized: SerializedCardFeatures | undefined,
): CardFeatures {
  const current = classifyCardFeatures(card)
  if (
    serialized?.effectModelVersion === 2 &&
    serialized.effectParserRevision === CURRENT_EFFECT_PARSER_REVISION &&
    effectsAndDiagnosticsSemanticallyEqual(serialized, current)
  ) {
    return freezeCardFeatures({
      ...current,
      effects: serialized.effects,
      unparsedClauses: serialized.unparsedClauses,
    })
  }
  return freezeCardFeatures(current)
}
```

The adapter computes one current classification and reuses serialized
effects/diagnostics only after semantic equality with that current parse.
Otherwise it returns the complete current classification. Every flag,
Rainbow-usable flag, compatibility summary, required/searchable summary,
support summary, and evidence therefore corresponds to the returned effects.
Move the full deep-copy/freezing implementation out of
`load-catalog.ts` into this module. It must recursively copy and freeze nested
effects, predicates, requirements, costs, branches, actions, diagnostics, and
derived summaries. Do not mutate the serialized suggestion.

- [x] **Step 4: Route the loader and derivation through v2**

Delete `hasCurrentFeatureMetadata` and the loader-local freezer from `src/catalog/load-catalog.ts`; for each card call `upgradeSerializedCardFeatures(card, suppliedFeatures)`. Extend loader tests to prove exact matching-revision parsed effects may be reused, summaries are recomputed, semantic mismatches fall back to full classification, and every legacy shape is reclassified from printed text. In `tools/catalog/derive-strategy.test.ts`, assert `deriveStrategy(card).features` has model version 2/parser revision 1 and passes the serialized v2 schema.

- [x] **Step 5: Run migration tests and verify GREEN**

Run:

```bash
npm test -- shared/catalog.test.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.test.ts tools/catalog/derive-strategy.test.ts
```

Expected: PASS for strict v2, every legacy input, canonical runtime output, and new derivation.

- [x] **Step 6: Commit the migration seam**

```bash
git add shared/catalog.ts shared/catalog.test.ts src/catalog/upgrade-card-features.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts tools/catalog/derive-strategy.test.ts
git commit -m "feat: upgrade catalog effects at runtime"
```

Task 5 evidence (2026-08-21):

- RED: `npm test -- shared/catalog.test.ts
  src/catalog/upgrade-card-features.test.ts` failed because the exported
  serialized union and upgrade adapter did not exist; the inherited legacy
  schemas also rejected their pre-v2 shapes.
- Review RED: effect and diagnostics mutations at matching version/revision
  reproduced a hybrid runtime model. Regression tests now require complete
  current reclassification for either semantic mismatch.
- GREEN: the focused migration command passed 4 files / 89 tests. It covers
  strict canonical v2/revision-1 metadata, all eight exact legacy variants,
  exact-match effect reuse, semantic-mismatch reparsing, summary recomputation,
  absent-feature fallback, loader delegation, derivation, and recursive
  detachment/freezing.
- Compatibility: the manifest remains schema version 1, legacy serialized
  schemas use pinned literal historical fields independent of the evolving
  current contract, serialized suggestions remain unchanged in
  `strategySuggestions`, and every runtime entry is upgraded to canonical v2.
  The one pre-existing handwritten
  `tools/evaluate-strategy.test.ts` fixture was completed with empty v2 effect
  metadata so the repository typecheck is green.
- Repository gates: `npm test` passed 59 files / 1,016 tests; `npm run lint`,
  `npm run typecheck`, and `git diff --check` passed; `npm run catalog:check`
  reported 17 sets / 85 files; and `npm run build` completed the production
  Vite build.

### Task 6: Lock exact OP17 semantics and Phase-1 score parity

**Files:**
- Create: `tools/op17-effect-context.acceptance.test.ts`
- Modify: `shared/card-effect-parser.test.ts`

- [x] **Step 1: Add failing catalog-backed acceptance**

Load the checked-in OP17 catalog with `loadLocalCatalogs(['OP17'])`. Assert exact semantic causes:

```ts
expect(actions('OP17-049')).toContainEqual(expect.objectContaining({ kind: 'draw', subject: 'opponent', amount: 2 }))
expect(effect('OP17-063', 'activateMain')).toMatchObject({ costs: [{ kind: 'donMinus', amount: 1 }], condition: { kind: 'selfState', state: 'playedThisTurn' } })
expect(actions('OP17-063')).toContainEqual(expect.objectContaining({ kind: 'negateEffect' }))
expect(actions('OP17-065')).toContainEqual(expect.objectContaining({ kind: 'lockAttack', target: expect.objectContaining({ quantity: 2, predicate: expect.objectContaining({ maximumCost: 5 }) }), duration: 'untilOpponentsNextEndPhase' }))
expect(effect('OP17-043', 'onPlay')).toContainEqual(expect.objectContaining({ kind: 'leaderBasePower', powerDelta: 1000 }))
expect(effect('OP17-112', 'onPlay').branches.every((branch) => branch.actions.some((action) => action.kind === 'draw'))).toBe(true)
expect(features('OP17-114').effects.map(({ source }) => source)).toContain('trigger')
```

For seeds `0..99`, solve once with runtime v2 metadata and compare against the
recorded Phase-0 engine-baseline solution digest/metrics for those seeds; do not
construct an invalid runtime `CardFeatures` object by deleting required v2
fields. Assert byte-for-byte equal solutions or a recorded per-seed digest plus
exact deck lines. This proves additive metadata is not yet authoritative.

- [x] **Step 2: Run acceptance and verify RED if any named wording is unhandled**

Run `npm test -- tools/op17-effect-context.acceptance.test.ts`.

Expected before final parser fixes: FAIL with the first exact OP17 semantic mismatch; never change legacy score expectations to make it pass.

- [x] **Step 3: Make only grammar-general parser corrections**

Adjust parser patterns using wording-general rules such as subject inheritance, same-instance target references, duration parsing, or bullet context. Add a positive minimal fixture and a negative near-match beside every correction. Complete all grammar corrections before publishing revision 1. After Phase 1 is released, any semantic grammar correction must increment `effectParserRevision`, retain the older revision as accepted serialized input, and prove the loader reparses it. Do not mention a card number, set, rarity, color, or name in production parser code.

- [x] **Step 4: Run focused and full Phase-1 verification**

Run:

```bash
npm test -- shared/card-effect-model.test.ts shared/card-effect-parser.test.ts shared/card-features.test.ts shared/catalog.test.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.test.ts tools/op17-effect-context.acceptance.test.ts
npm run lint
npm run typecheck
npm test
npm run catalog:check
npm run build
```

Expected: all commands PASS; the full suite retains its pre-phase score and solution expectations, and the build emits canonical v2 on the next catalog derivation without requiring a bulk catalog rewrite now.

- [x] **Step 5: Request two-stage review**

Dispatch a spec-compliance reviewer against Phase 1 and the approved design. After all spec findings are resolved, dispatch a code-quality reviewer. Re-run the focused acceptance after each correction.

- [x] **Step 6: Commit Phase-1 acceptance and verification record**

```bash
git add tools/op17-effect-context.acceptance.test.ts shared/card-effect-parser.ts shared/card-effect-parser.test.ts docs/superpowers/plans/2026-08-21-op17-effect-context-parsing.md
git commit -m "test: verify OP17 effect context parsing"
```

Record the exact test counts and commands in the checked checklist before committing. Phase 2 may start only when the branch is clean and every Phase-1 gate is green.

Task 6 evidence (2026-08-21):

- First-run acceptance was GREEN rather than RED: Tasks 2 through 5 already
  handled every named OP17 wording, so the conditional RED gate found no
  semantic mismatch. No parser production code changed and revision 1 remains
  current.
- The catalog-backed acceptance locks exact effect context for OP17-043, 046,
  049, 054, 063, 065, 093, 112, 114, 118, and 119. It also solves tournament
  seeds `0..99` twice, matches each canonical solution SHA-256 to the Phase-0
  fixture, requires exactly 40 Main cards, and conserves every physical copy
  across Main and Sideboard.
- Focused verification passed 7 files / 299 tests:
  `npm test -- shared/card-effect-model.test.ts shared/card-effect-parser.test.ts shared/card-features.test.ts shared/catalog.test.ts src/catalog/upgrade-card-features.test.ts src/catalog/load-catalog.test.ts tools/op17-effect-context.acceptance.test.ts`.
- Full verification passed 60 files / 1,021 tests. `npm run lint`,
  `npm run typecheck`, and `git diff --check` passed. `npm run catalog:check`
  reported 17 sets / 85 files, and `npm run build` completed the Vite
  production build.
- Spec-compliance self-review found all Phase-1 semantic and parity gates
  represented without production card identities. Code-quality self-review
  found the acceptance helpers bounded, deterministic, and independent of
  parser implementation details; no corrections were required.
- Independent spec review found five assertions that proved presence but were
  not sufficiently mutation-sensitive. The corrected acceptance now pins the
  opponent-owned two-branch choice, same-target negate/KO pair, one paid
  draw-plus-lock instance, exactly two common-draw Life branches, and a
  separately sourced Trigger self-deploy from Life. The first run of these
  stricter catalog-backed assertions passed, confirming this remained a
  test-contract correction rather than a parser semantic change.
- Independent quality review found remaining flattened/partial semantic checks
  and a duplicate-line blind spot in the acceptance conservation helper. A RED
  regression reproduced the latter (`3` physical copies were incorrectly
  collapsed to `2`). The helper now accumulates duplicate lines and rejects
  non-positive or non-safe quantities. Every audited cause is asserted as a
  complete effect instance, and negative probes prove that wrong activation,
  cost, condition, zone, or predicate values fail exact comparison. Final
  focused and full counts are the 299 and 1,021 totals recorded above; all
  other gates were rerun after these corrections.
