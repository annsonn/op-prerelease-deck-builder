# Premium Bomb Scoring Design

## Goal

Recognize high-impact, immediately usable finisher text that the current broad
effect score flattens away, so the first copy of a card such as OP17-022 Shanks
is normally selected from a sealed pool without making every expensive or
zero-counter card mandatory.

The change adds two general card-text features, makes each count toward an
auditable additive effect score, and applies a conservative first-copy floor to cards that
combine enough independent qualities to be a premium bomb. No rule may mention
Shanks, OP17-022, rarity, set number, color, name, or trait.

## Current Problem

OP17-022 has Rush and this unconditional On Play effect:

> Set up to 2 of your DON!! cards as active. Then, rest all of your opponent's
> Characters.

The classifier currently records `rush`, `removal`, `boss`, and `brick`.
Scoring then collapses Rush and removal into one `effectQuality` point, awards
nothing for reactivating DON!!, and treats mass rest like single-target rest.
When interaction, boss, and high-cost targets are already satisfied, counter,
brick, curve saturation, and redundancy can push the card below ordinary
sealed filler.

This is a feature-model limitation, not a card-specific exception.

## Feature Vocabulary

Append these boolean keys to `CardFeatureKey`, `CardFeatures.flags`, and
`CardFeatures.rainbowUsableFlags`:

- `massRest`: the usable rules text unconditionally instructs the player to
  rest all of the opponent's Characters.
- `donRefresh`: the usable rules text instructs the player to set one or more
  of their DON!! cards as active.

The keys are independent. `massRest` continues to imply the existing
`removal` flag, but it does not imply `twoForOne`; `donRefresh` does not imply
draw, ramp, or generic combo support. Neither key becomes a role-coverage
target or a support-requirement key.

The existing `rainbowUsableRulesText` pass remains authoritative. A premium
effect inside a Leader-, name-, trait-, or mono-color-incompatible clause may
appear in raw `flags`, but must be false in `rainbowUsableFlags` for Rainbow
Luffy and cannot earn premium-effect points or the bomb floor.

## Conservative Detection

Detection operates on the same normalized English rules text as the existing
features.

`massRest` is true only for a phrase matching the semantic shape:

```text
rest all of your opponent's Character or Characters
```

The detector is case-insensitive, accepts the existing apostrophe
normalization, and permits whitespace variation. It does not match:

- `rest up to 1/2/N`;
- `rest all of your Characters`;
- `rest all DON!! cards`;
- `your opponent may rest ...`;
- `all of your opponent's Characters will not become active`;
- text that only prevents refresh or activation.

`donRefresh` is true only for an imperative phrase matching the semantic
shape:

```text
set [up to] a positive numeric quantity of your DON!! cards as active
```

The initial implementation accepts printed digits from 1 through 10 and the
optional words `up to`. It does not match adding DON!! from the DON!! deck,
setting a Character or Leader active, giving rested DON!! to a card, resting
DON!! as a cost, or setting an opponent's DON!! active. This boolean feature
records the presence of meaningful DON!! refresh, not the printed quantity;
quantity-weighted scoring is out of scope.

These intentionally narrow detectors may miss new wording. False negatives are
safer than promoting ordinary cards to premium bombs; new official wording can
be added with positive and negative boundary tests.

## Scoring Contract

The strategy profile gains this set-overridable value with the same default for
all OP sets:

```ts
limits: {
  premiumBombFirstCopyFloor: 15,
}
```

The marginal score adds one named, ordered component:

- `premiumBombFloor`: a non-negative adjustment applied after every existing
  positive and negative component.

Broad effects now score additively instead of as one presence check. Each true
Rainbow-usable flag in `blocker`, `draw`, `removal`, `rush`, `banish`,
`twoForOne`, `massRest`, and `donRefresh` contributes the existing
`profile.weights.compatibility.effect` value. With the default weight of `1`,
OP17-022 receives `+4` in `effectQuality` for removal, Rush, mass rest, and DON!!
refresh. No new per-feature weights are introduced.

A candidate qualifies for the floor only when all of these facts are true:

1. it is a `CHARACTER`;
2. `rainbowUsableFlags.boss` is true;
3. `rainbowUsableFlags.massRest` is true;
4. `rainbowUsableFlags.rush` is true; and
5. `rainbowUsableFlags.donRefresh` is true.

This rule captures an immediate, large board swing on a finisher without
promoting a generic boss, a mass-rest Event, or a conditional effect Rainbow
Luffy cannot use.

After ordinary scoring, including compatibility, curve saturation, brick, and
redundancy penalties, calculate:

```ts
const selectedCopies = state.selectedCountsByCardNumber[cardNumber] ?? 0
const floorAdjustment =
  isPremiumBomb(candidate) && selectedCopies === 0
    ? Math.max(0, profile.limits.premiumBombFirstCopyFloor - subtotal)
    : 0
```

`premiumBombFloor` is included only when `floorAdjustment > 0`, and the final
score is the exact sum of all visible components. If the ordinary first-copy
score is already at least 15, the floor contributes nothing.

The floor is not a forced insertion. It gives the first copy a minimum marginal
score of 15, so truly stronger candidates may still fill all 40 slots. It does
not bypass the greedy solver, tie breaking, pool conservation, or deck-size
rules. The second and later physical copies receive no floor and remain fully
subject to brick, curve-saturation, satisfied-role, and repeated-effect
penalties. Additive broad-effect scoring still describes the printed effects on
later copies.

## Profile Validation

`mergeStrategyProfile` must merge the new limit and reject invalid
configuration:

- `premiumBombFirstCopyFloor` must be finite and non-negative.

The defaults are policy, not catalog data. Set overrides may tune them later
without changing feature extraction or solver code.

## Catalog and Runtime Compatibility

Catalog manifest `schemaVersion` remains `1`. Cards, suggested roles, UI-facing
deck structures, and artifact filenames do not change.

Newly derived strategy suggestions serialize both new boolean keys in `flags`
and `rainbowUsableFlags`, and list true keys in `evidence`. Existing serialized
feature objects that predate the keys remain valid through an explicit strict
legacy flag schema containing the former key set. The legacy union must retain
the existing combinations that may also omit `rainbowUsableFlags` or
`supportRequirementsByFlag`; unknown keys and malformed values remain rejected.

At runtime, supplied feature metadata is authoritative only when both new keys
exist in both flag records and the existing rainbow/support layers are present.
Otherwise `loadRuntimeCatalog` reclassifies that card from its current printed
text. This allows the checked-in OP catalogs and an older deployed catalog to
benefit immediately without a bulk catalog rewrite. A future normal catalog
sync will emit the new canonical form.

No card-number exception, migration file, network request, local storage, or UI
state is added.

## UI and Explanation Behavior

There is no new screen, role-coverage row, card badge, or user control. Existing
deck-line reason rendering automatically exposes the new labels when they
contribute:

- the existing broad-effect reason with its additive contribution
- `First-copy premium bomb floor`

Main deck, Sideboard, sorting, play guide, role coverage, strengths, weaknesses,
and catalog selection keep their existing contracts. Sideboard scoring against
a completed deck does not receive the floor if that card number is already in
the Main deck; a sideboard-only premium bomb may still show its first-copy floor
because it is absent from that completed deck, which truthfully describes its
marginal value as a possible swap-in.

## Testing and Acceptance

Classifier tests must cover:

- the exact OP17-022 text producing raw and Rainbow-usable `massRest` and
  `donRefresh` flags;
- each detector's positive boundary;
- the negative wording listed above;
- conditional Leader/trait text being present in raw flags but suppressed from
  Rainbow-usable flags;
- stable feature-key/evidence order and deeply frozen output.

Schema and loader tests must prove:

- the new canonical shape parses strictly;
- the exact pre-premium shape still parses without being mutated;
- malformed partial premium flags and unknown keys fail;
- a pre-premium enriched suggestion is reclassified from card text at runtime;
- a current enriched suggestion remains authoritative and deeply frozen.

Scoring tests must prove:

- each Rainbow-usable broad-effect flag contributes exactly the existing effect
  weight, and OP17-022's four effects contribute `+4` in total;
- raw-only/incompatible flags contribute nothing;
- a qualifying first copy below 15 receives exactly the difference to 15;
- a qualifying first copy already above 15 receives no floor component;
- a second copy receives no floor and retains existing redundancy/brick/curve
  behavior;
- a boss missing Rush, DON!! refresh, or mass rest, and a non-Character with the
  full text, receives no floor;
- score totals remain finite, deterministic, frozen, and reconcilable to their
  components.

A deterministic solver integration test must load the checked-in OP17 catalog
through the production loader and generate the tournament pool for seed `4`.
This seed is confirmed to contain OP17-022 while the pre-change engine excludes
it. The post-change assertion must show at least one OP17-022 in the 40-card Main
deck and prove that Main plus Sideboard conserves every physical OP17-022 copy
from the generated pool.

Lookalikes and missing premium-bomb qualifiers stay at the marginal-score unit
boundary, where the deck state and ordinary subtotal are controlled. A paired
solver negative with synthetic filler is intentionally not required because
changing ordinary curve, role, or body scores can make such a fixture prove the
filler construction rather than the premium predicate.

A catalog-backed acceptance test must generate 1,000 OP17 tournament pools from
seeds 0 through 999. It must find at least one pool containing OP17-022 and prove
that every such pool puts at least one copy in the Main deck. This is a bounded,
repeatable regression sample, not a claim that every possible future pool or
catalog revision must include the card.

Focused tests, the complete test suite, lint, type checking, catalog validation,
and production build must pass. The strategy evaluation command must complete
for deterministic OP17 seeds, with the before/after OP17-022 inclusion rate
recorded in the plan as calibration evidence alongside the bounded 1,000-seed
first-copy acceptance test.

## Out of Scope

- Hardcoding any card, set, rarity, color, name, or trait.
- Automatically including all bosses, Rush cards, 10-cost cards, or SR cards.
- Guaranteeing the premium bomb is selected regardless of the other 40 cards.
- Quantity-weighted DON!! refresh, opponent-board-size simulation, or direct win
  percentage modeling.
- Changing the greedy 40-slot selection algorithm.
- Relaxing zero-counter, counter-total, brick, curve, role, or redundancy rules
  globally.
- Rebuilding all checked-in derived catalogs solely to add false feature keys.
- Adding UI for premium-bomb labels or exposing tuning controls.
