import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, test } from 'vitest'

import { printedCardIdSchema } from '../shared/catalog.js'

const repositoryRoot = process.cwd()
const execFileAsync = promisify(execFile)

function pathContainsPrintedCardId(path: string): boolean {
  const candidates = path.matchAll(
    /(?:^|[^a-z0-9])([a-z][a-z0-9]*-\d{3})(?:_EN)?(?=$|[^a-z0-9])/gi,
  )

  for (const match of candidates) {
    const candidate = match[1]
    if (
      candidate &&
      printedCardIdSchema.safeParse(candidate.toUpperCase()).success
    ) {
      return true
    }
  }

  return false
}

function isTrackedCardImageArtifact(path: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/')
  const pathSegments = normalizedPath.split('/')
  const basename = pathSegments.at(-1) ?? ''
  const hasExplicitCardImagePath = pathSegments.some((segment) =>
    /^(?:card[-_ ]images(?:[-_ ]archive)?|card[-_ ]image[-_ ]archive)$/i.test(
      segment,
    ),
  )
  const isExplicitCardImageArchive =
    /(?:^|[-_ ])(?:card[-_ ]images(?:[-_ ]archive)?|card[-_ ]image[-_ ]archive)\.(?:7z|tar(?:\.gz)?|tgz|zip)$/i.test(
      basename,
    )
  const isImage =
    /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(basename)
  const containsPrintedCardId = pathContainsPrintedCardId(normalizedPath)

  return (
    hasExplicitCardImagePath ||
    isExplicitCardImageArchive ||
    (isImage && containsPrintedCardId)
  )
}

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), 'utf8')
}

describe('tracked card image artifact detection', () => {
  test('rejects nested, renamed, case-varied card bitmaps and card-image archives', () => {
    const forbiddenPaths = [
      'public/assets/cards/OP16-001_EN.webp',
      'public/assets/cards/OP16-004_EN/front.webp',
      'public/assets/previews/front-ST01-002.jpg',
      'public/assets/eb02-003.PNG',
      'public/assets/previews/PRB01-004.jpeg',
      'public/assets/P-001_EN.webp',
      'public/assets/DON-001.png',
      'public/assets/OP16-001.svg',
      'public/assets/ABCDE12-999.tiff',
      'public/card-images/provider-logo.svg',
      'public/assets/Card Images/archive.txt',
      'public/assets/card-images.zip',
      'public/assets/card-image-archive.tar.gz',
    ]

    expect(forbiddenPaths.filter(isTrackedCardImageArtifact)).toEqual(
      forbiddenPaths,
    )
  })

  test('allows source modules and unrelated images', () => {
    const allowedPaths = [
      'src/lib/card-image-url.ts',
      'src/card-image/card-image-url.ts',
      'src/components/CardImageDialog.tsx',
      'public/favicon.png',
      'public/assets/logo.webp',
      'docs/card-image-notes.md',
      'public/assets/OP16-001.txt',
      'public/assets/ABCDEF-001.webp',
      'public/assets/OP123-001.png',
    ]

    expect(allowedPaths.filter(isTrackedCardImageArtifact)).toEqual([])
  })
})

describe('public repository readiness', () => {
  test('package metadata and verification scripts describe the sealed deck builder', async () => {
    const packageJson = JSON.parse(await readRepositoryFile('package.json')) as {
      description?: unknown
      keywords?: unknown
      license?: unknown
      overrides?: Record<string, unknown>
      packageManager?: unknown
      private?: unknown
      scripts?: Record<string, unknown>
    }

    expect(packageJson.private).toBe(true)
    expect(packageJson.description).toBe(
      'Offline-first One Piece TCG sealed deck builder and play guide',
    )
    expect(packageJson.license).toBe('MIT')
    expect(packageJson.keywords).toEqual([
      'one-piece-card-game',
      'sealed-deck',
      'deck-builder',
    ])
    expect(packageJson.packageManager).toMatch(/^npm@/)
    expect(packageJson.overrides?.rolldown).toBe('1.2.4')
    expect(packageJson.scripts?.typecheck).toBe(
      'tsc -b && tsc -p tsconfig.tools.json',
    )
    expect(packageJson.scripts?.verify).toBe(
      'npm run lint && npm run typecheck && npm test && npm run catalog:check',
    )
  })

  test('the supported Node version is pinned to Node 24', async () => {
    expect(await readRepositoryFile('.node-version')).toMatch(/^24\./)
  })

  test('CI installs and verifies without syncing catalog data', async () => {
    const workflow = await readRepositoryFile('.github/workflows/ci.yml')

    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run verify')
    expect(workflow).toContain('npm run build')
    expect(workflow).not.toContain('catalog:sync')
  })

  test('the lockfile uses only the public registry and contains no email addresses', async () => {
    const lockfile = await readRepositoryFile('package-lock.json')
    const lockfileJson = JSON.parse(lockfile) as {
      packages?: Record<string, { resolved?: unknown }>
    }
    const resolvedUrls = Object.values(lockfileJson.packages ?? {}).flatMap(
      ({ resolved }) => (typeof resolved === 'string' ? [resolved] : []),
    )

    expect(lockfile).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    expect(resolvedUrls.length).toBeGreaterThan(0)
    expect(
      resolvedUrls.every((url) => url.startsWith('https://registry.npmjs.org/')),
    ).toBe(true)
  })

  test('documents setup, offline catalogs, and the raw source contract', async () => {
    const readme = await readRepositoryFile('README.md')

    for (const heading of [
      '## What it does',
      '## Current scope',
      '## Quick start',
      '## Commands',
      '## Catalogs and offline use',
      '## Updating the catalogs',
      '## Raw Card Kaizoku JSON format',
      '## Strategy engine',
      '## Project structure',
      '## Data, trademarks, and attribution',
      '## License',
    ]) {
      expect(readme).toContain(heading)
    }

    for (const expected of [
      'npm ci',
      'npm run dev',
      'npm run catalog:sync',
      'npm run verify',
      'npm run build',
      'cardNumber',
      'cardName',
      'products',
      'public/catalogs',
      'tmp/catalog/source',
    ]) {
      expect(readme).toContain(expected)
    }

    expect(readme).toMatch(/candidate[^\n]*does not publish/i)
    expect(readme).toMatch(/must not run[^\n]*(dev|preview)/i)
  })

  test('keeps raw copied source data out of tracked fixtures', async () => {
    const fixtures = await Promise.all([
      readRepositoryFile('tools/catalog/__fixtures__/cardkaizoku-rows.json'),
      readRepositoryFile('tools/catalog/__fixtures__/official-page.txt'),
      readRepositoryFile('tools/catalog/__fixtures__/op17-input.json'),
    ])

    expect(fixtures.join('\n')).not.toMatch(
      /Monkey\.D\.Dragon|Thatch|Cavendish|Bartholomew Kuma|Dragon's Command|New Headquarters|Straw Hat Crew|Whitebeard Pirates/i,
    )
  })

  test('documents remote card images without bundling an image archive', async () => {
    const [readme, notice, { stdout: trackedFilesOutput }] = await Promise.all([
      readRepositoryFile('README.md'),
      readRepositoryFile('NOTICE'),
      execFileAsync('git', ['ls-files', '-z'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }),
    ])
    const normalizedReadme = readme.replace(/\s+/g, ' ')
    const normalizedNotice = notice.replace(/\s+/g, ' ')
    const trackedFiles = trackedFilesOutput.split('\0').filter(Boolean)

    expect(readme).toContain('## Card images')
    expect(readme).toContain(
      '[Images served by Limitless TCG](https://onepiece.limitlesstcg.com/cards)',
    )
    expect(normalizedReadme).toMatch(
      /card reveal[^.]*requires?[^.]*internet connection/i,
    )
    expect(normalizedReadme).toMatch(
      /loads?[^.]*directly from Limitless TCG[^.]*only after[^.]*activat(?:e|es|ed|ing|ion)[^.]*View/i,
    )
    expect(normalizedReadme).toMatch(
      /no card image archive[^.]*downloaded during build/i,
    )
    expect(normalizedReadme).toMatch(
      /no card image archive[^.]*committed[^.]*repository/i,
    )
    expect(normalizedReadme).toMatch(
      /no card image archive[^.]*GitHub Pages artifact/i,
    )
    expect(normalizedReadme).toMatch(
      /remote URL format[^.]*not[^.]*documented API guarantee/i,
    )
    expect(normalizedReadme).toMatch(
      /unavailable images[^.]*error state[^.]*Retry/i,
    )
    expect(normalizedReadme).toMatch(
      /card artwork[^.]*third-party material[^.]*not covered[^.]*MIT License/i,
    )
    expect(normalizedNotice).toMatch(
      /(?:not affiliated[^.]*Limitless TCG|Limitless TCG[^.]*not affiliated)/i,
    )
    expect(normalizedNotice).toMatch(
      /card images[^.]*served remotely[^.]*Limitless TCG/i,
    )
    expect(normalizedNotice).toMatch(
      /(?:no card image files[^.]*distributed|card image files[^.]*not distributed)/i,
    )
    expect(normalizedNotice).toMatch(
      /(?:no card image files[^.]*licensed under[^.]*MIT License|card image files[^.]*not licensed[^.]*MIT License)/i,
    )
    expect(normalizedNotice).toMatch(
      /Limitless TCG[^.]*independent[^.]*third-party provider/i,
    )
    expect(normalizedNotice).toMatch(
      /(?:Limitless TCG[^.]*(?:does not sponsor or endorse|neither sponsors nor endorses)|not sponsored or endorsed[^.]*Limitless TCG)/i,
    )
    expect(trackedFiles.filter(isTrackedCardImageArtifact)).toEqual([])
  })

  test('publishes license, notice, architecture, and roadmap documents', async () => {
    expect(await readRepositoryFile('LICENSE')).toContain('MIT License')
    expect(await readRepositoryFile('NOTICE')).toMatch(/unofficial|not affiliated/i)
    expect(await readRepositoryFile('docs/architecture.md')).toContain(
      'Catalog pipeline',
    )
    expect(await readRepositoryFile('docs/roadmap.md')).toContain(
      'Tournament readiness',
    )
  })
})
