import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  checkRuntimeCatalogs,
  runRuntimeCatalogCheck,
} from './check-runtime.js'

const temporaryDirectories: string[] = []
const sourceSha256 = 'a'.repeat(64)

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<Buffer> {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  await writeFile(path, content)
  return content
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function rewriteRuntimeJson(
  publicRoot: string,
  setId: string,
  filename: string,
  value: unknown,
): Promise<void> {
  const setRoot = join(publicRoot, setId)
  const content = await writeJson(join(setRoot, filename), value)
  const checksums = (await readJson(join(setRoot, 'checksums.json'))) as Record<
    string,
    string
  >
  checksums[filename] = sha256(content)
  await writeJson(join(setRoot, 'checksums.json'), checksums)
}

function card(setId: string): Record<string, unknown> {
  return {
    cardNumber: `${setId}-001`,
    name: `${setId} Test Card`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 1,
    life: null,
    power: 1000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: [setId],
    variantsCollapsed: 1,
    entryShortcut: '001',
    isSpecialReprint: false,
  }
}

async function runtimeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-check-test-'))
  temporaryDirectories.push(root)
  const publicRoot = join(root, 'public', 'catalogs')
  await mkdir(publicRoot, { recursive: true })

  const sets = []
  for (let index = 1; index <= 17; index += 1) {
    const lowerSetId = `op${String(index).padStart(2, '0')}`
    const setId = lowerSetId.toUpperCase()
    const setRoot = join(publicRoot, lowerSetId)
    await mkdir(setRoot)
    const artifacts = {
      'manifest.json': {
        schemaVersion: 1,
        setId,
        language: 'en',
        source: 'https://cdn.example.test/cards.json',
        sourceType: 'cardkaizoku-json',
        sourceSha256,
        readiness: 'needs-review',
      },
      'cards.json': [card(setId)],
      'set-contents.json': [`${setId}-001`],
      'strategy-suggestions.json': [
        {
          cardNumber: `${setId}-001`,
          roles: ['pressure'],
          reviewStatus: 'suggested',
        },
      ],
    }
    const checksums: Record<string, string> = {}
    for (const [filename, value] of Object.entries(artifacts)) {
      checksums[filename] = sha256(await writeJson(join(setRoot, filename), value))
    }
    await writeJson(join(setRoot, 'checksums.json'), checksums)
    sets.push({
      setId,
      label: setId,
      manifestPath: `/catalogs/${lowerSetId}/manifest.json`,
      sourceSha256,
      readiness: 'needs-review',
    })
  }
  await writeJson(join(publicRoot, 'index.json'), { schemaVersion: 1, sets })
  return publicRoot
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('checkRuntimeCatalogs', () => {
  it('wires catalog checks into development and production builds', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts).toMatchObject({
      'catalog:check': 'tsx tools/catalog/check-runtime.ts',
      predev: 'npm run catalog:check',
      prebuild: 'npm run catalog:check',
    })
  })

  it('accepts a complete tracked runtime directory', async () => {
    const publicRoot = await runtimeFixture()

    await expect(checkRuntimeCatalogs(publicRoot)).resolves.toEqual({
      setCount: 17,
      fileCount: 85,
    })

    expect(await readFile(join(publicRoot, 'index.json'), 'utf8')).toContain(
      '"schemaVersion": 1',
    )
  })

  it('prefixes a missing export with the sync recovery command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-check-missing-'))
    temporaryDirectories.push(root)

    await expect(
      checkRuntimeCatalogs(join(root, 'public', 'catalogs')),
    ).rejects.toThrow(
      /^Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\./,
    )
  })

  it('rejects a symlink runtime catalog root', async () => {
    const publicRoot = await runtimeFixture()
    const generation = `${publicRoot}.staging-fixture`
    await rename(publicRoot, generation)
    await symlink(basename(generation), publicRoot, 'dir')

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*runtime catalog root must be a regular directory/i,
    )
  })

  it('rejects a runtime export with a missing set artifact', async () => {
    const publicRoot = await runtimeFixture()
    await unlink(join(publicRoot, 'op01', 'cards.json'))

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*op01.*cards\.json/i,
    )
  })

  it('rejects malformed JSON in a set artifact', async () => {
    const publicRoot = await runtimeFixture()
    await writeFile(join(publicRoot, 'op01', 'cards.json'), '{not json')

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*op01\/cards\.json.*malformed JSON/i,
    )
  })

  it('rejects an artifact that does not match its runtime schema', async () => {
    const publicRoot = await runtimeFixture()
    await rewriteRuntimeJson(publicRoot, 'op01', 'cards.json', [
      { ...card('OP01'), cardNumber: undefined },
    ])

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*op01\/cards\.json.*schema/i,
    )
  })

  it('verifies checksums against the exact artifact bytes', async () => {
    const publicRoot = await runtimeFixture()
    const path = join(publicRoot, 'op01', 'cards.json')
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(' ')]))

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*checksum mismatch.*op01\/cards\.json/i,
    )
  })

  it('requires set contents to exactly match ordered card numbers', async () => {
    const publicRoot = await runtimeFixture()
    await rewriteRuntimeJson(publicRoot, 'op01', 'set-contents.json', [])

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*OP01.*set contents.*cards/i,
    )
  })

  it('requires exactly one strategy suggestion for every card', async () => {
    const publicRoot = await runtimeFixture()
    await rewriteRuntimeJson(
      publicRoot,
      'op01',
      'strategy-suggestions.json',
      [],
    )

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*OP01.*suggestions.*exactly one.*card/i,
    )
  })

  it('requires manifest identity and provenance to match the index entry', async () => {
    const publicRoot = await runtimeFixture()
    const manifest = (await readJson(
      join(publicRoot, 'op01', 'manifest.json'),
    )) as Record<string, unknown>
    await rewriteRuntimeJson(publicRoot, 'op01', 'manifest.json', {
      ...manifest,
      setId: 'OP02',
    })

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*OP01.*manifest.*index/i,
    )
  })

  it('rejects browser-private keys even when checksums are updated', async () => {
    const publicRoot = await runtimeFixture()
    await rewriteRuntimeJson(publicRoot, 'op01', 'cards.json', [
      { ...card('OP01'), bucketImg: 'private' },
    ])

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*privacy.*bucketImg/i,
    )
  })

  it('rejects URL strings inside browser card data', async () => {
    const publicRoot = await runtimeFixture()
    await rewriteRuntimeJson(publicRoot, 'op01', 'cards.json', [
      { ...card('OP01'), effect: 'See https://private.example.test/card' },
    ])

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*privacy.*URL/i,
    )
  })

  it('rejects a malformed runtime index', async () => {
    const publicRoot = await runtimeFixture()
    await writeFile(join(publicRoot, 'index.json'), '{not json')

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*index\.json.*malformed JSON/i,
    )
  })

  it('rejects an extra runtime checksum key', async () => {
    const publicRoot = await runtimeFixture()
    const path = join(publicRoot, 'op01', 'checksums.json')
    const checksums = (await readJson(path)) as Record<string, string>
    await writeJson(path, { ...checksums, 'private.json': sourceSha256 })

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*checksums\.json.*schema/i,
    )
  })

  it('rejects unexpected public files outside the exact runtime inventory', async () => {
    const publicRoot = await runtimeFixture()
    await writeJson(join(publicRoot, 'op01', 'private.json'), {
      bucketImg: 'private',
    })

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*unexpected.*op01.*private\.json/i,
    )
  })

  it('rejects nested artifact symlinks', async () => {
    const publicRoot = await runtimeFixture()
    const external = await mkdtemp(join(tmpdir(), 'runtime-check-artifact-'))
    temporaryDirectories.push(external)
    const cardsPath = join(publicRoot, 'op01', 'cards.json')
    const externalCards = join(external, 'cards.json')
    await writeFile(externalCards, await readFile(cardsPath))
    await unlink(cardsPath)
    await symlink(externalCards, cardsPath)

    await expect(checkRuntimeCatalogs(publicRoot)).rejects.toThrow(
      /Runtime catalogs unavailable or invalid\. Run npm run catalog:sync\. .*regular file.*cards\.json/i,
    )
  })

  it('prints the required CLI success summary', async () => {
    const publicRoot = await runtimeFixture()
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await runRuntimeCatalogCheck(publicRoot)

    expect(write).toHaveBeenCalledWith(
      'Runtime catalogs ready: 17 sets, 85 files\n',
    )
  })
})
