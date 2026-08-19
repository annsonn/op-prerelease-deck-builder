import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const repositoryRoot = process.cwd()

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), 'utf8')
}

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
