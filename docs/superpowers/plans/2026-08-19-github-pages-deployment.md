# GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the verified Vite app to `https://annsonn.github.io/op-prerelease-deck-builder/` after every push to `main`, with an equivalent manual workflow trigger.

**Architecture:** Keep catalog manifests deployment-neutral and join their logical `/catalogs/...` paths to Vite's runtime base URL in the browser loader. Configure Vite from `VITE_BASE_PATH`, then extend the existing CI workflow so its verified Pages build is uploaded and deployed through GitHub's official artifact actions.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, GitHub Actions, GitHub Pages

---

## File map

- Modify `src/catalog/load-catalog.ts`: join logical catalog paths to the active Vite base path before every fetch.
- Modify `src/catalog/load-catalog.test.ts`: prove local and GitHub Pages paths for the index and all runtime artifacts.
- Modify `vite.config.ts`: use `VITE_BASE_PATH` for production asset URLs and `/` by default.
- Create `vite.config.test.ts`: lock down default and configured Vite base-path behavior.
- Modify `vitest.config.ts`: include the root Vite configuration test in the Node test project.
- Modify `tsconfig.node.json`: type-check the Vite configuration test.
- Modify `.github/workflows/ci.yml`: add manual dispatch, Pages artifact upload, and the dependent deployment job.
- Modify `README.md`: document the deployed URL, automatic/manual triggers, and one-time Pages setting.

### Task 1: Make runtime catalog fetching base-path aware

**Files:**
- Modify: `src/catalog/load-catalog.test.ts`
- Modify: `src/catalog/load-catalog.ts`

- [x] **Step 1: Write the failing path-join tests**

Import `resolveCatalogPath` and add this suite before `describe('loadCatalogIndex', ...)`:

```ts
describe('resolveCatalogPath', () => {
  it('preserves root-based catalog paths for local development', () => {
    expect(resolveCatalogPath('/catalogs/index.json', '/')).toBe(
      '/catalogs/index.json',
    )
  })

  it('joins logical catalog paths to a Pages base without duplicate slashes', () => {
    expect(
      resolveCatalogPath(
        '/catalogs/op16/manifest.json',
        '/op-prerelease-deck-builder',
      ),
    ).toBe('/op-prerelease-deck-builder/catalogs/op16/manifest.json')
  })
})
```

- [x] **Step 2: Run the focused tests and verify the missing export fails**

Run:

```bash
npm test -- src/catalog/load-catalog.test.ts
```

Expected: FAIL because `resolveCatalogPath` is not exported from `load-catalog.ts`.

- [x] **Step 3: Implement the minimal join helper**

Add to `src/catalog/load-catalog.ts` before `fetchBytes`:

```ts
export function resolveCatalogPath(path: string, baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${path.replace(/^\/+/, '')}`
}
```

- [x] **Step 4: Run the focused tests and verify the helper passes**

Run:

```bash
npm test -- src/catalog/load-catalog.test.ts
```

Expected: PASS for the two new path-join tests and every existing loader test.

- [x] **Step 5: Write failing integration tests for index and artifact prefixes**

Change the fixture's signature and artifact keys as follows; the empty default
preserves every existing test path:

```ts
async function runtimeFixture(basePath = ''): Promise<RuntimeFixture> {
  const artifactRoot = `${basePath}/catalogs/op16`
  const cards = [
    card('OP16-005'),
    card('OP10-045', {
      cost: 8,
      power: 9000,
      counter: 2000,
      effect:
        '[Blocker] Draw 2 cards. [Rush] K.O. up to 1 of your opponent\'s Characters.',
    }),
  ]
  const artifacts: Record<string, string> = {
    [`${artifactRoot}/manifest.json`]: `${JSON.stringify({
      schemaVersion: 1,
      setId: 'OP16',
      language: 'en',
      source: 'https://cdn.example.test/cards.json',
      sourceType: 'cardkaizoku-json',
      sourceSha256,
      readiness: 'needs-review',
    })}\n`,
    [`${artifactRoot}/cards.json`]: `${JSON.stringify(cards)}\n`,
    [`${artifactRoot}/set-contents.json`]: `${JSON.stringify(
      cards.map(({ cardNumber }) => cardNumber),
    )}\n`,
    [`${artifactRoot}/strategy-suggestions.json`]: `${JSON.stringify(
      cards.map(({ cardNumber }) => suggestion(cardNumber)),
    )}\n`,
    [`${artifactRoot}/checksums.json`]: '',
  }

  const rebuildChecksums = async (): Promise<void> => {
    const checksums = Object.fromEntries(
      await Promise.all(
        [
          'manifest.json',
          'cards.json',
          'set-contents.json',
          'strategy-suggestions.json',
        ].map(async (filename) => [
          filename,
          await browserSha256(
            encoder.encode(artifacts[`${artifactRoot}/${filename}`]),
          ),
        ]),
      ),
    )
    artifacts[`${artifactRoot}/checksums.json`] = `${JSON.stringify(checksums)}\n`
  }
  await rebuildChecksums()

  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input.toString()
    const body = artifacts[path]
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      statusText: body === undefined ? 'Not Found' : 'OK',
      arrayBuffer: async () => encoder.encode(body ?? '').buffer,
    } as Response
  }) as unknown as typeof fetch

  return { artifacts, fetcher, rebuildChecksums }
}
```

Then add:

```ts
it('loads the index below the supplied Pages base path', async () => {
  const fetcher = fetchText(JSON.stringify(runtimeIndex()))

  await loadCatalogIndex(fetcher, '/op-prerelease-deck-builder/')

  expect(fetcher).toHaveBeenCalledWith(
    '/op-prerelease-deck-builder/catalogs/index.json',
  )
})
```

Add under `describe('loadRuntimeCatalog', ...)`:

```ts
it('loads every artifact below the supplied Pages base path', async () => {
  const basePath = '/op-prerelease-deck-builder'
  const { fetcher } = await runtimeFixture(basePath)

  await loadRuntimeCatalog(
    entry,
    fetcher,
    browserSha256,
    `${basePath}/`,
  )

  expect(fetcher).toHaveBeenCalledTimes(5)
  for (const filename of [
    'manifest.json',
    'cards.json',
    'set-contents.json',
    'strategy-suggestions.json',
    'checksums.json',
  ]) {
    expect(fetcher).toHaveBeenCalledWith(
      `${basePath}/catalogs/op16/${filename}`,
    )
  }
})
```

- [x] **Step 6: Run the focused tests and verify the loader ignores the new base**

Run:

```bash
npm test -- src/catalog/load-catalog.test.ts
```

Expected: FAIL because both loader functions still fetch root-absolute paths and do not accept the base-path arguments.

- [x] **Step 7: Apply the base path to every loader fetch**

Update the functions in `src/catalog/load-catalog.ts`:

```ts
export async function loadCatalogIndex(
  fetcher: typeof fetch = fetch,
  baseUrl: string = import.meta.env.BASE_URL,
): Promise<RuntimeCatalogIndex> {
  const logicalPath = '/catalogs/index.json'
  const label = `catalog index ${logicalPath}`
  const bytes = await fetchBytes(
    resolveCatalogPath(logicalPath, baseUrl),
    label,
    fetcher,
  )
  return parseSchema(
    runtimeCatalogIndexSchema,
    parseJson(bytes, label),
    label,
  )
}
```

Add the fourth argument to `loadRuntimeCatalog`:

```ts
baseUrl: string = import.meta.env.BASE_URL,
```

Wrap its artifact path before `fetchBytes`:

```ts
resolveCatalogPath(`${manifestDirectory}${filename}`, baseUrl)
```

- [x] **Step 8: Run focused and type checks**

Run:

```bash
npm test -- src/catalog/load-catalog.test.ts
npx tsc -b
```

Expected: the loader suite passes and app TypeScript exits successfully.

- [x] **Step 9: Commit the catalog URL change**

```bash
git add src/catalog/load-catalog.ts src/catalog/load-catalog.test.ts
git commit -m "fix: support project-page catalog paths"
```

### Task 2: Configure Vite's deployment base

**Files:**
- Create: `vite.config.test.ts`
- Modify: `vite.config.ts`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.node.json`

- [x] **Step 1: Write the failing Vite base-path tests**

Create `vite.config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveBasePath } from './vite.config.js'

describe('resolveBasePath', () => {
  it('uses the root path when no deployment base is configured', () => {
    expect(resolveBasePath(undefined)).toBe('/')
  })

  it('uses the configured GitHub Pages project path', () => {
    expect(resolveBasePath('/op-prerelease-deck-builder/')).toBe(
      '/op-prerelease-deck-builder/',
    )
  })
})
```

Set the `include` array in `tsconfig.node.json` to:

```json
"include": ["vite.config.ts", "vite.config.test.ts", "vitest.config.ts"]
```

Add the root configuration test to the Node project's `include` array in
`vitest.config.ts`, preserving the existing `tools` and `shared` test globs:

```ts
include: [
  'tools/**/*.test.ts',
  'shared/**/*.test.ts',
  'vite.config.test.ts',
],
```

- [x] **Step 2: Run the Vite configuration test and verify the missing export fails**

Run:

```bash
npm test -- vite.config.test.ts
```

Expected: FAIL because `resolveBasePath` is not exported.

- [x] **Step 3: Implement the configured base path**

Update `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export function resolveBasePath(configuredBase: string | undefined): string {
  return configuredBase ?? '/'
}

export default defineConfig({
  base: resolveBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
})
```

- [x] **Step 4: Run the Vite test and Node configuration type-check**

Run:

```bash
npm test -- vite.config.test.ts
npx tsc -b
```

Expected: both commands exit successfully.

- [x] **Step 5: Build for Pages and inspect emitted asset paths**

Run:

```bash
VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run build
node -e "const fs=require('node:fs');const html=fs.readFileSync('dist/index.html','utf8');if(!html.includes('/op-prerelease-deck-builder/assets/'))process.exit(1)"
```

Expected: build exits successfully and the Node assertion exits `0`.

- [x] **Step 6: Commit the Vite base configuration**

```bash
git add vite.config.ts vite.config.test.ts vitest.config.ts tsconfig.node.json docs/superpowers/plans/2026-08-19-github-pages-deployment.md
git commit -m "build: configure GitHub Pages base path"
```

### Task 3: Deploy the verified build through GitHub Actions

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [x] **Step 1: Extend the existing workflow**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches:
      - main
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

env:
  VITE_BASE_PATH: /op-prerelease-deck-builder/

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: npm
          registry-url: https://registry.npmjs.org
      - name: Install dependencies
        run: npm ci
      - name: Verify repository
        run: npm run verify
      - name: Build application
        run: npm run build
      - name: Upload GitHub Pages artifact
        if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    needs: verify
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    concurrency:
      group: pages
      cancel-in-progress: true
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Configure GitHub Pages
        uses: actions/configure-pages@v5
      - name: Deploy GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [x] **Step 2: Document deployment and one-time setup**

Add after README's Quick start section:

```md
## GitHub Pages

The latest verified `main` build is published at
<https://annsonn.github.io/op-prerelease-deck-builder/>. Pushes to `main`
deploy automatically, and **Actions -> CI -> Run workflow** starts the same
deployment when run on `main`; selecting another branch only verifies and
builds.

Before the first deployment, set **Settings -> Pages -> Build and deployment ->
Source** to **GitHub Actions**. The workflow deploys with GitHub's built-in
`GITHUB_TOKEN`; no personal access token or repository secret is required.
Pull requests verify and build the Pages configuration without deploying it.
```

- [x] **Step 3: Validate the workflow contract and documentation diff**

Run:

```bash
node -e "const fs=require('node:fs');const y=fs.readFileSync('.github/workflows/ci.yml','utf8');for(const s of ['workflow_dispatch:','VITE_BASE_PATH: /op-prerelease-deck-builder/','actions/configure-pages@v5','actions/upload-pages-artifact@v4','actions/deploy-pages@v4','pages: write','id-token: write'])if(!y.includes(s))throw new Error('missing '+s)"
git diff --check
```

Expected: the Node assertion and diff check both exit `0`.

- [x] **Step 4: Commit deployment automation and docs**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: deploy app to GitHub Pages"
```

### Task 4: Verify the complete deployment slice

**Files:**
- Verify: `src/catalog/load-catalog.ts`
- Verify: `vite.config.ts`
- Verify: `.github/workflows/ci.yml`
- Verify: `README.md`

- [ ] **Step 1: Run all repository gates**

Run:

```bash
npm run verify
VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run build
git diff --check
```

Expected: lint, both TypeScript projects, all Vitest suites, the 17-set/85-file catalog check, the Pages production build, and the diff check all pass.

- [ ] **Step 2: Start the Pages-path preview**

Run:

```bash
VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run preview -- --host 127.0.0.1
```

Expected: Vite serves the existing build and reports port `4173` unless that port is occupied.

- [ ] **Step 3: Verify the deployed-path HTML and catalogs locally**

Open:

```text
http://127.0.0.1:4173/op-prerelease-deck-builder/
```

Confirm the app renders, the set selector contains OP-01 through OP-17, OP-16 can be selected, and the browser console has no failed catalog requests or runtime errors.

- [ ] **Step 4: Verify repository state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -4
```

Expected: `main` is clean and ahead of `origin/main` only by the reviewed deployment commits. Do not push until the user requests the remote update.
