# Card Kaizoku Catalog Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update OP01-OP17 to the 2026-08-19 Card Kaizoku snapshot while preserving official `EB03` reprint membership when the feed supplies its `EB0304` alias.

**Architecture:** Keep source-specific normalization inside the Card Kaizoku adapter, before the existing canonical membership validator. Continue pinning one checksum-verified, ignored raw snapshot and deterministically export only sanitized runtime artifacts to `public/catalogs`.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js catalog tooling, Vite

---

### Task 1: Normalize the Card Kaizoku EB0304 alias

**Files:**
- Modify: `tools/catalog/adapters/cardkaizoku.test.ts`
- Modify: `tools/catalog/adapters/cardkaizoku.ts`

- [x] **Step 1: Write the failing membership test**

Add this focused case to the `inferCardKaizokuMemberships` suite:

```ts
it('normalizes the Card Kaizoku EB0304 alias to EB03', () => {
  expect(
    inferCardKaizokuMemberships({
      cardSet: 'OP05',
      products: [{ cardSet: ' eb0304 ' }],
    }),
  ).toEqual(['EB03', 'OP05'])

  expect(
    inferCardKaizokuMemberships({
      cardSet: 'OP05',
      products: [{ cardSet: 'EB0304' }, { cardSet: 'EB03' }],
    }),
  ).toEqual(['EB03', 'OP05'])
})
```

- [x] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
npx vitest run tools/catalog/adapters/cardkaizoku.test.ts -t "normalizes the Card Kaizoku EB0304 alias"
```

Expected: FAIL because the current validator drops `EB0304`, so the first assertion receives `['OP05']` instead of `['EB03', 'OP05']`.

- [x] **Step 3: Add the narrow source alias**

Add an immutable alias map next to the membership pattern and apply it before validation:

```ts
const setMembershipAliases: Readonly<Record<string, string>> = {
  EB0304: 'EB03',
}

function normalizedMembership(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  const canonical = setMembershipAliases[normalized] ?? normalized
  return setMembershipPattern.test(canonical) ? canonical : null
}
```

- [x] **Step 4: Run the focused adapter suite**

Run:

```bash
npx vitest run tools/catalog/adapters/cardkaizoku.test.ts
```

Expected: the adapter test file passes with the new alias case and all existing malformed-membership checks unchanged.

### Task 2: Pin and publish the new snapshot

**Files:**
- Modify: `catalog-sources.json`
- Modify: `tools/catalog/config.test.ts`
- Regenerate: `public/catalogs/index.json`
- Regenerate: `public/catalogs/op01/manifest.json` through `public/catalogs/op17/manifest.json`
- Regenerate: `public/catalogs/op01/checksums.json` through `public/catalogs/op17/checksums.json`

- [x] **Step 1: Pin the verified snapshot provenance**

Set the shared snapshot fields in `catalog-sources.json` and the `sharedSnapshot` expectation in `tools/catalog/config.test.ts` to:

```json
{
  "source": "https://cdn.cardkaizoku.com/card_data_v20260819T101535.json",
  "sha256": "66c0594fc4c5ad4d2aa5599836330a00fd98842d8b6d118dac765ebadbe8d594",
  "cachePath": "tmp/catalog/source/card_data_v20260819T101535.json"
}
```

Use `sourceSha256` instead of `sha256` in the TypeScript test fixture.

- [x] **Step 2: Regenerate every configured catalog**

Run:

```bash
npm run catalog:sync
```

Expected: `Mode: published`, the verified checksum above, and OP01 through OP17 summaries. Raw data stays below ignored `tmp/catalog`.

- [x] **Step 3: Confirm the alias preserved runtime provenance**

Run:

```bash
jq '.[] | select(.cardNumber == "OP05-006") | .setMembership' public/catalogs/op05/cards.json
jq '.[] | select(.cardNumber == "OP09-034") | .setMembership' public/catalogs/op09/cards.json
```

Expected: both arrays still contain `EB03`. No gameplay field, set contents, or strategy suggestion changes are expected.

- [x] **Step 4: Confirm deterministic publication**

Hash `git diff --binary`, rerun `npm run catalog:sync`, hash the diff again, and require identical hashes.

- [x] **Step 5: Run complete verification**

Run:

```bash
npm run verify
VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run build
git diff --check
```

Expected: lint and both TypeScript projects pass, all Vitest tests pass, runtime validation reports 17 sets and 85 files, the Pages production build succeeds, and the diff has no whitespace errors.

- [x] **Step 6: Review and commit the catalog refresh**

Commit the Task 1 adapter and test changes separately:

```bash
git commit -m "fix: normalize Card Kaizoku EB0304 membership"
```

Then stage only `catalog-sources.json`, `tools/catalog/config.test.ts`, this plan, and the sanitized `public/catalogs` outputs. Confirm no file under `tmp/` is tracked, then commit the catalog refresh:

```bash
git commit -m "data: refresh Card Kaizoku catalogs"
```
