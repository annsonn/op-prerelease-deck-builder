# GitHub Pages Deployment Design

Date: 2026-08-19
Status: Approved for implementation

## Goal

Publish the production Vite application at
`https://annsonn.github.io/op-prerelease-deck-builder/`. Every push to `main`
deploys automatically, and the same workflow can be started manually. Pull
requests continue to verify the application without publishing it.

## Selected approach

Extend the existing `.github/workflows/ci.yml` workflow with GitHub's official
Pages artifact and deployment actions. The workflow will verify and build once,
then deploy that exact build only when the run targets `main` and is not a pull
request.

This avoids a generated `gh-pages` branch and prevents a separate deployment
workflow from rebuilding independently of CI. Deployment uses the workflow's
built-in `GITHUB_TOKEN`; no personal access token or repository secret is
required.

## Application base path

GitHub hosts this project Page below `/op-prerelease-deck-builder/`, while local
development should remain available at `/`.

`vite.config.ts` will read `VITE_BASE_PATH` and fall back to `/`. The GitHub
workflow will set:

```text
VITE_BASE_PATH=/op-prerelease-deck-builder/
```

Vite will therefore emit Pages-safe JavaScript and CSS asset URLs without
changing the local `npm run dev` experience.

## Runtime catalog URLs

The committed catalog index deliberately contains deployment-neutral logical
paths such as `/catalogs/op16/manifest.json`. Those generated files and schemas
will remain unchanged.

The browser catalog loader will join logical catalog paths to
`import.meta.env.BASE_URL` before fetching them. The join will normalize the
base to one trailing slash and strip the logical path's leading slash; it will
not use standard URL resolution, which would treat `/catalogs/...` as an
origin-rooted path and discard the Pages base. With the local base, a request
remains `/catalogs/index.json`. With the Pages base, it becomes
`/op-prerelease-deck-builder/catalogs/index.json`. The same join applies to the
index and every runtime artifact request.

The loader's public behavior, validation, checksums, and catalog data structures
will not change.

## Workflow behavior

The existing CI workflow will support:

- `pull_request`: install, verify, and build; never upload or deploy.
- Push to `main`: install, verify, build, upload `dist`, and deploy.
- Manual dispatch from `main`: perform the same verified deployment.

The workflow will use the Node version in `.node-version`, install with
`npm ci`, and retain the existing `npm run verify` and `npm run build` gates.
The Pages steps will use the official actions:

- `actions/configure-pages`
- `actions/upload-pages-artifact`
- `actions/deploy-pages`

The deployment job will depend on the build job, use the `github-pages`
environment, publish the action's returned page URL, and request only the
`pages: write` and `id-token: write` permissions needed to deploy. Pages
concurrency will cancel an older in-progress deployment when a newer one starts.
Runs dispatched from branches other than `main` may verify and build but must not
publish.

## Failure handling

- A dependency installation, verification, catalog check, or build failure stops
  the workflow before artifact upload.
- A failed or skipped build prevents the dependent deployment job from running.
- GitHub retains failed-run logs and the `github-pages` deployment environment
  records successful deployments and their URLs.
- No deployment credential is stored in the repository.

## Test and verification plan

Implementation will start with failing tests that demonstrate the missing base
path behavior. Tests will cover:

- Joining catalog paths at the local `/` base.
- Joining catalog paths at the Pages base.
- Prefixing the catalog index request.
- Prefixing every artifact request derived from a logical manifest path.

After implementation:

1. Run the focused catalog-loader tests.
2. Run `npm run verify`.
3. Build with `VITE_BASE_PATH=/op-prerelease-deck-builder/`.
4. Inspect `dist/index.html` for repository-prefixed asset URLs.
5. Start the preview with
   `VITE_BASE_PATH=/op-prerelease-deck-builder/ npm run preview -- --host 127.0.0.1`,
   open
   `http://127.0.0.1:4173/op-prerelease-deck-builder/`, and confirm the
   prefixed catalog index and one complete catalog load succeed.
6. Validate the workflow diff and run `git diff --check`.

## Documentation and repository setup

The README will document the public URL, deployment trigger, and the one-time
repository setting:

`Settings -> Pages -> Build and deployment -> Source -> GitHub Actions`

The first workflow run cannot publish until that setting is selected. No custom
domain, SPA fallback, service worker, or offline installation behavior is part
of this change.
