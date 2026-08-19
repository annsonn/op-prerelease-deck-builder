import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

const fixtureRoot = mkdtempSync(join(tmpdir(), 'catalog-gitignore-test-'))
writeFileSync(
  join(fixtureRoot, '.gitignore'),
  readFileSync(join(process.cwd(), '.gitignore')),
)
execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot })

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], {
      cwd: fixtureRoot,
      stdio: 'ignore',
    })
    return true
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return false
    throw error
  }
}

describe('generated catalog ignore contract', () => {
  it.each([
    'public/catalogs.staging-fixture/index.json',
    'public/catalogs.tombstone-fixture/index.json',
    'tmp/catalog/source/cards.json',
    'tmp/catalog/bundles/op01/manifest.json',
    'tmp/catalog/reports/candidate.json',
    'tmp/catalog/staging/previous-fixture/index.json',
  ])('ignores %s', (path) => {
    expect(isIgnored(path)).toBe(true)
  })

  it.each([
    'public/catalogs',
    'public/catalogs/index.json',
    'public/catalogs/op16/cards.json',
    'public/favicon.svg',
    'public/icons.svg',
    'public/catalog-source.json',
  ])('does not broadly ignore %s', (path) => {
    expect(isIgnored(path)).toBe(false)
  })
})
