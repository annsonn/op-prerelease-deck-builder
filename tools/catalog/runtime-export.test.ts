import { createHash } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, parse, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const fileSystemControl = vi.hoisted(() => ({
  originalCopyFile: undefined as
    | ((source: string, destination: string, mode?: number) => Promise<void>)
    | undefined,
  copyFileImplementation: undefined as
    | ((source: string, destination: string, mode?: number) => Promise<void>)
    | undefined,
  originalMkdir: undefined as
    | ((path: string, options?: { recursive?: boolean }) => Promise<string | undefined>)
    | undefined,
  mkdirImplementation: undefined as
    | ((path: string, options?: { recursive?: boolean }) => Promise<string | undefined>)
    | undefined,
  originalReadFile: undefined as
    | ((path: string, encoding: 'utf8') => Promise<string>)
    | undefined,
  readFileImplementation: undefined as
    | ((path: string, encoding: 'utf8') => Promise<string>)
    | undefined,
  originalRename: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  renameImplementation: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  originalSymlink: undefined as
    | ((target: string, path: string, type?: 'dir') => Promise<void>)
    | undefined,
  symlinkImplementation: undefined as
    | ((target: string, path: string, type?: 'dir') => Promise<void>)
    | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  fileSystemControl.originalCopyFile = (source, destination, mode) =>
    original.copyFile(source, destination, mode)
  fileSystemControl.originalMkdir = (path, options) =>
    original.mkdir(path, options)
  fileSystemControl.originalRename = original.rename
  fileSystemControl.originalReadFile = (path, encoding) =>
    original.readFile(path, encoding)
  fileSystemControl.originalSymlink = (target, path, type) =>
    original.symlink(target, path, type)
  return {
    ...original,
    copyFile: (source: string, destination: string, mode?: number) =>
      fileSystemControl.copyFileImplementation?.(source, destination, mode) ??
      original.copyFile(source, destination, mode),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      fileSystemControl.mkdirImplementation?.(path, options) ??
      original.mkdir(path, options),
    readFile: (path: string, encoding: 'utf8') =>
      fileSystemControl.readFileImplementation?.(path, encoding) ??
      original.readFile(path, encoding),
    rename: (oldPath: string, newPath: string) =>
      fileSystemControl.renameImplementation?.(oldPath, newPath) ??
      original.rename(oldPath, newPath),
    symlink: (target: string, path: string, type?: 'dir') =>
      fileSystemControl.symlinkImplementation?.(target, path, type) ??
      original.symlink(target, path, type),
  }
})

import { stableStringify, writeBundleFiles } from './artifacts.js'
import { publishCatalogGroup, stageCatalog } from './publication.js'
import {
  exportRuntimeCatalogs,
  type RuntimeExportOptions,
} from './runtime-export.js'

const temporaryDirectories: string[] = []
const checksum = 'a'.repeat(64)
const runtimeFiles = [
  'cards.json',
  'checksums.json',
  'manifest.json',
  'set-contents.json',
  'strategy-suggestions.json',
]

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-export-test-'))
  temporaryDirectories.push(directory)
  return directory
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

async function fixture(): Promise<RuntimeExportOptions> {
  const root = await makeTemporaryDirectory()
  const bundleRoot = join(root, 'tmp', 'catalog', 'bundles')
  const stagingRoot = join(root, 'tmp', 'catalog', 'staging')
  const publicRoot = join(root, 'public', 'catalogs')
  await mkdir(bundleRoot, { recursive: true })

  for (let index = 1; index <= 17; index += 1) {
    const lowerSetId = `op${String(index).padStart(2, '0')}`
    const setId = lowerSetId.toUpperCase()
    const generation = join(bundleRoot, `${lowerSetId}.staging-fixture`)
    const playableCard = card(setId)
    await writeBundleFiles(generation, {
      'manifest.json': {
        schemaVersion: 1,
        setId,
        language: 'en',
        source: 'https://cdn.example.test/cards.json',
        sourceType: 'cardkaizoku-json',
        sourceSha256: checksum,
        readiness: 'needs-review',
      },
      'cards.json': [playableCard],
      'set-contents.json': [`${setId}-001`],
      'strategy-suggestions.json': [
        {
          cardNumber: `${setId}-001`,
          roles: ['pressure'],
          reviewStatus: 'suggested',
        },
      ],
      'import-report.json': { privateDiagnostics: true },
    })
    await symlink(basename(generation), join(bundleRoot, lowerSetId), 'dir')
  }

  return { bundleRoot, publicRoot, stagingRoot }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function rewriteBundleJson(
  options: RuntimeExportOptions,
  setId: string,
  filename: string,
  value: unknown,
): Promise<void> {
  const setRoot = join(options.bundleRoot, setId)
  const content = stableStringify(value)
  await writeFile(join(setRoot, filename), content, 'utf8')
  const checksums = (await readJson(join(setRoot, 'checksums.json'))) as Record<
    string,
    string
  >
  checksums[filename] = sha256(content)
  await writeFile(
    join(setRoot, 'checksums.json'),
    stableStringify(checksums),
    'utf8',
  )
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  for (const setName of [
    'index.json',
    ...Array.from(
      { length: 17 },
      (_, index) => `op${String(index + 1).padStart(2, '0')}`,
    ),
  ]) {
    const path = join(root, setName)
    const stats = await lstat(path)
    if (stats.isDirectory()) {
      for (const filename of (await readdir(path)).sort()) {
        snapshot[`${setName}/${filename}`] = await readFile(
          join(path, filename),
          'utf8',
        )
      }
    } else {
      snapshot[setName] = await readFile(path, 'utf8')
    }
  }
  return snapshot
}

async function expectRegularDirectory(path: string): Promise<void> {
  const stats = await lstat(path)
  expect(stats.isDirectory()).toBe(true)
  expect(stats.isSymbolicLink()).toBe(false)
}

afterEach(async () => {
  fileSystemControl.copyFileImplementation = undefined
  fileSystemControl.mkdirImplementation = undefined
  fileSystemControl.readFileImplementation = undefined
  fileSystemControl.renameImplementation = undefined
  fileSystemControl.symlinkImplementation = undefined
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('exportRuntimeCatalogs', () => {
  it('exports exactly 17 sanitized runtime catalogs and one ordered index', async () => {
    const options = await fixture()

    await expect(exportRuntimeCatalogs(options)).resolves.toEqual({
      publicRoot: resolve(options.publicRoot),
      setCount: 17,
      fileCount: 85,
    })
    await expectRegularDirectory(options.publicRoot)

    expect((await readdir(options.publicRoot)).sort()).toEqual([
      'index.json',
      ...Array.from({ length: 17 }, (_, index) =>
        `op${String(index + 1).padStart(2, '0')}`,
      ),
    ])
    expect((await readdir(join(options.publicRoot, 'op01'))).sort()).toEqual(
      runtimeFiles,
    )
    const index = (await readJson(join(options.publicRoot, 'index.json'))) as {
      schemaVersion: number
      sets: Array<Record<string, unknown>>
    }
    expect(index.schemaVersion).toBe(1)
    expect(index.sets).toHaveLength(17)
    expect(index.sets.map(({ setId }) => setId)).toEqual(
      Array.from({ length: 17 }, (_, index) =>
        `OP${String(index + 1).padStart(2, '0')}`,
      ),
    )
    expect(index.sets[0]).toEqual({
      setId: 'OP01',
      label: 'OP01',
      manifestPath: '/catalogs/op01/manifest.json',
      sourceSha256: checksum,
      readiness: 'needs-review',
    })
  })

  it('regenerates exact runtime checksums deterministically', async () => {
    const first = await fixture()
    const second = await fixture()

    await exportRuntimeCatalogs(first)
    await exportRuntimeCatalogs(second)
    await expectRegularDirectory(first.publicRoot)
    await expectRegularDirectory(second.publicRoot)

    expect(await snapshotTree(first.publicRoot)).toEqual(
      await snapshotTree(second.publicRoot),
    )
    const checksums = (await readJson(
      join(first.publicRoot, 'op01', 'checksums.json'),
    )) as Record<string, string>
    expect(Object.keys(checksums).sort()).toEqual([
      'cards.json',
      'manifest.json',
      'set-contents.json',
      'strategy-suggestions.json',
    ])
    for (const [filename, digest] of Object.entries(checksums)) {
      expect(
        sha256(
          await readFile(join(first.publicRoot, 'op01', filename), 'utf8'),
        ),
      ).toBe(digest)
    }
  })

  it.each([
    ['bucketImg', 'secret'],
    ['cardImg', 'secret'],
    ['jp_name', 'secret'],
    ['marketValue', 100],
    ['products', []],
    ['salePrice', 1],
  ])('rejects recursively forbidden private key %s', async (key, value) => {
    const options = await fixture()
    const cards = (await readJson(
      join(options.bundleRoot, 'op01', 'cards.json'),
    )) as Array<Record<string, unknown>>
    cards[0]!.metadata = { nested: { [key]: value } }
    await rewriteBundleJson(options, 'op01', 'cards.json', cards)

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(/privacy.*key/i)
    await expect(access(options.publicRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it.each([
    'See https://private.example.test/card/1',
    'See(https://private.example.test/card/1)',
    '  //private.example.test/card/1',
    '\t//PRIVATE.example.test/card/1',
    'See //private.example.test/card/1',
    'HTTPS://PRIVATE.example.test/card/1',
  ])(
    'rejects URL strings anywhere inside cards while allowing manifest source URLs: %s',
    async (effect) => {
      const options = await fixture()
      const cards = (await readJson(
        join(options.bundleRoot, 'op01', 'cards.json'),
      )) as Array<Record<string, unknown>>
      cards[0]!.effect = effect
      await rewriteBundleJson(options, 'op01', 'cards.json', cards)

      await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
        /privacy.*url/i,
      )
    },
  )

  it('rejects missing or extra active bundles', async () => {
    const missing = await fixture()
    await unlink(join(missing.bundleRoot, 'op17'))
    await expect(exportRuntimeCatalogs(missing)).rejects.toThrow(
      /exactly.*op01.*op17/i,
    )

    const extra = await fixture()
    await symlink('op17.staging-fixture', join(extra.bundleRoot, 'op18'), 'dir')
    await expect(exportRuntimeCatalogs(extra)).rejects.toThrow(
      /exactly.*op01.*op17/i,
    )
  })

  it('rejects a source bundle whose copied artifact checksum is corrupted', async () => {
    const options = await fixture()
    await writeFile(
      join(options.bundleRoot, 'op01', 'cards.json'),
      '[]\n',
      'utf8',
    )

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /source checksum mismatch.*cards\.json/i,
    )
  })

  it('rejects mismatched contents and non-bijective suggestions', async () => {
    const contents = await fixture()
    await rewriteBundleJson(contents, 'op01', 'set-contents.json', ['OP01-002'])
    await expect(exportRuntimeCatalogs(contents)).rejects.toThrow(/set contents.*cards/i)

    const suggestions = await fixture()
    await rewriteBundleJson(suggestions, 'op01', 'strategy-suggestions.json', [])
    await expect(exportRuntimeCatalogs(suggestions)).rejects.toThrow(
      /suggestions.*exactly one.*card/i,
    )
  })

  it('rejects cards that omit the exported set membership', async () => {
    const options = await fixture()
    const cards = (await readJson(
      join(options.bundleRoot, 'op01', 'cards.json'),
    )) as Array<Record<string, unknown>>
    cards[0]!.setMembership = ['OP02']
    await rewriteBundleJson(options, 'op01', 'cards.json', cards)

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /missing OP01 membership/i,
    )
  })

  it('preserves an owned previous export under staging during replacement', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    const originalIndex = await readFile(
      join(options.publicRoot, 'index.json'),
      'utf8',
    )

    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)

    const previousNames = (await readdir(options.stagingRoot)).filter((name) =>
      name.startsWith('previous-'),
    )
    expect(previousNames).toHaveLength(1)
    expect(
      await readFile(
        join(options.stagingRoot, previousNames[0]!, 'index.json'),
        'utf8',
      ),
    ).toBe(originalIndex)
  })

  it('migrates an owned legacy adjacent-generation symlink to a regular directory', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)

    const legacyGeneration = `${options.publicRoot}.staging-legacy`
    await rename(options.publicRoot, legacyGeneration)
    await symlink(basename(legacyGeneration), options.publicRoot, 'dir')
    const cards = (await readJson(
      join(options.bundleRoot, 'op01', 'cards.json'),
    )) as Array<Record<string, unknown>>
    cards[0]!.name = 'OP01 Deterministic Replacement'
    await rewriteBundleJson(options, 'op01', 'cards.json', cards)

    await exportRuntimeCatalogs(options)

    await expectRegularDirectory(options.publicRoot)
    const publishedCards = (await readJson(
      join(options.publicRoot, 'op01', 'cards.json'),
    )) as Array<Record<string, unknown>>
    expect(publishedCards[0]!.name).toBe('OP01 Deterministic Replacement')
    const previousNames = (await readdir(options.stagingRoot)).filter((name) =>
      name.startsWith('previous-'),
    )
    expect(previousNames).toHaveLength(1)
    expect(
      await readFile(
        join(options.stagingRoot, previousNames[0]!, 'index.json'),
        'utf8',
      ),
    ).toContain('"schemaVersion": 1')
  })

  it('rejects an arbitrary existing destination without changing it', async () => {
    const options = await fixture()
    await mkdir(options.publicRoot, { recursive: true })
    const sentinel = join(options.publicRoot, 'unrelated.sentinel')
    await writeFile(sentinel, 'preserve me', 'utf8')

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /refusing to replace non-runtime-catalog directory/i,
    )
    expect(await readFile(sentinel, 'utf8')).toBe('preserve me')
  })

  it('refuses an empty destination created immediately before publication', async () => {
    const options = await fixture()
    let injected = false
    let contenderIdentity: { device: number; inode: number } | undefined
    fileSystemControl.mkdirImplementation = async (path, mkdirOptions) => {
      if (!injected && path === resolve(options.publicRoot)) {
        injected = true
        await fileSystemControl.originalMkdir!(path, mkdirOptions)
        const stats = await lstat(path)
        contenderIdentity = { device: stats.dev, inode: stats.ino }
      }
      return fileSystemControl.originalMkdir!(path, mkdirOptions)
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /publication.*occupied|EEXIST/i,
    )

    expect(injected).toBe(true)
    const finalStats = await lstat(options.publicRoot)
    expect(finalStats.isDirectory()).toBe(true)
    expect({ device: finalStats.dev, inode: finalStats.ino }).toEqual(
      contenderIdentity,
    )
    expect(await readdir(options.publicRoot)).toEqual([])
  })

  it('restores an unowned destination swapped in before replacement publication', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    const displacedOwnedPointer = `${options.publicRoot}.externally-displaced`
    let injected = false
    fileSystemControl.renameImplementation = async (oldPath, newPath) => {
      if (
        !injected &&
        oldPath === resolve(options.publicRoot) &&
        basename(newPath).startsWith('previous-')
      ) {
        injected = true
        await fileSystemControl.originalRename!(oldPath, displacedOwnedPointer)
        await mkdir(oldPath)
      }
      await fileSystemControl.originalRename!(oldPath, newPath)
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /public destination changed during publication/i,
    )

    expect(injected).toBe(true)
    expect(await readdir(options.publicRoot)).toEqual([])
    await expectRegularDirectory(displacedOwnedPointer)
    expect(
      await readFile(join(displacedOwnedPointer, 'index.json'), 'utf8'),
    ).toContain(
      '"schemaVersion": 1',
    )
  })

  it('holds every internal publication lock while snapshotting all bundles', async () => {
    const options = await fixture()
    const replacementOutput = join(options.bundleRoot, 'op17')
    const replacement = await stageCatalog(replacementOutput, 'OP17', {
      'manifest.json': {
        schemaVersion: 1,
        setId: 'OP17',
        language: 'en',
        source: 'https://cdn.example.test/cards-v2.json',
        sourceType: 'cardkaizoku-json',
        sourceSha256: 'b'.repeat(64),
        readiness: 'needs-review',
      },
      'cards.json': [card('OP17')],
      'set-contents.json': ['OP17-001'],
      'strategy-suggestions.json': [
        {
          cardNumber: 'OP17-001',
          roles: ['pressure'],
          reviewStatus: 'suggested',
        },
      ],
      'import-report.json': { replacement: true },
    })
    let releaseRead!: () => void
    const mayRead = new Promise<void>((resolvePromise) => {
      releaseRead = resolvePromise
    })
    let enteredRead!: () => void
    const readEntered = new Promise<void>((resolvePromise) => {
      enteredRead = resolvePromise
    })
    let paused = false
    fileSystemControl.readFileImplementation = async (path, encoding) => {
      if (
        !paused &&
        (path.endsWith('/op01/checksums.json') ||
          path.endsWith('op01.staging-fixture/checksums.json'))
      ) {
        paused = true
        enteredRead()
        await mayRead
      }
      return fileSystemControl.originalReadFile!(path, encoding)
    }

    const exporting = exportRuntimeCatalogs(options)
    await readEntered
    let publicationFailure: unknown
    try {
      await publishCatalogGroup([replacement])
    } catch (error) {
      publicationFailure = error
    }
    releaseRead()
    await exporting
    await expectRegularDirectory(options.publicRoot)

    expect(publicationFailure).toEqual(expect.any(Error))
    expect(String(publicationFailure)).toMatch(/publication lock contention/i)
    expect(await readlink(replacementOutput)).toBe('op17.staging-fixture')
    const index = (await readJson(join(options.publicRoot, 'index.json'))) as {
      sets: Array<{ sourceSha256: string }>
    }
    expect(index.sets.every(({ sourceSha256 }) => sourceSha256 === checksum)).toBe(
      true,
    )
  })

  it('restores an owned export when population fails and preserves diagnostics', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    const originalIndex = await readFile(
      join(options.publicRoot, 'index.json'),
      'utf8',
    )
    fileSystemControl.copyFileImplementation = async (
      source,
      destination,
      mode,
    ) => {
      if (destination === join(resolve(options.publicRoot), 'op02', 'cards.json')) {
        throw new Error('injected population fault')
      }
      await fileSystemControl.originalCopyFile!(source, destination, mode)
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /population.*previous export restored/i,
    )
    expect(await readFile(join(options.publicRoot, 'index.json'), 'utf8')).toBe(
      originalIndex,
    )
    expect(
      (await readdir(options.stagingRoot)).some((name) =>
        name.startsWith('failed-'),
      ),
    ).toBe(true)
  })

  it('does not overwrite a child contender created during population', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    const originalIndex = await readFile(
      join(options.publicRoot, 'index.json'),
      'utf8',
    )
    const contenderPath = join(options.publicRoot, 'op01', 'cards.json')
    let injected = false
    fileSystemControl.copyFileImplementation = async (
      source,
      destination,
      mode,
    ) => {
      if (!injected && destination === contenderPath) {
        injected = true
        await writeFile(destination, 'preserve me', 'utf8')
      }
      await fileSystemControl.originalCopyFile!(source, destination, mode)
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /population.*previous export restored/i,
    )

    expect(injected).toBe(true)
    expect(await readFile(join(options.publicRoot, 'index.json'), 'utf8')).toBe(
      originalIndex,
    )
    const failed = (await readdir(options.stagingRoot)).find((name) =>
      name.startsWith('failed-'),
    )
    expect(failed).toBeDefined()
    expect(
      await readFile(
        join(options.stagingRoot, failed!, 'op01', 'cards.json'),
        'utf8',
      ),
    ).toBe('preserve me')
  })

  it('rejects a non-colliding extra child injected during population', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    const originalIndex = await readFile(
      join(options.publicRoot, 'index.json'),
      'utf8',
    )
    const injectedPath = join(options.publicRoot, 'op01', 'unexpected.json')
    let injected = false
    fileSystemControl.copyFileImplementation = async (
      source,
      destination,
      mode,
    ) => {
      await fileSystemControl.originalCopyFile!(source, destination, mode)
      if (
        !injected &&
        destination === join(options.publicRoot, 'op01', 'cards.json')
      ) {
        injected = true
        await writeFile(injectedPath, '{"unexpected":true}\n', 'utf8')
      }
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /population.*previous export restored/i,
    )

    expect(injected).toBe(true)
    expect(await readFile(join(options.publicRoot, 'index.json'), 'utf8')).toBe(
      originalIndex,
    )
    const failed = (await readdir(options.stagingRoot)).find((name) =>
      name.startsWith('failed-'),
    )
    expect(failed).toBeDefined()
    expect(
      await readFile(
        join(options.stagingRoot, failed!, 'op01', 'unexpected.json'),
        'utf8',
      ),
    ).toBe('{"unexpected":true}\n')
  })

  it('does not overwrite a contender that appears during restore', async () => {
    const options = await fixture()
    await exportRuntimeCatalogs(options)
    await expectRegularDirectory(options.publicRoot)
    let claimFailed = false
    fileSystemControl.mkdirImplementation = async (path, mkdirOptions) => {
      if (!claimFailed && path === resolve(options.publicRoot)) {
        claimFailed = true
        throw new Error('injected population fault')
      }
      return fileSystemControl.originalMkdir!(path, mkdirOptions)
    }
    fileSystemControl.symlinkImplementation = async (target, path, type) => {
      if (path === resolve(options.publicRoot)) {
        await mkdir(path)
      }
      await fileSystemControl.originalSymlink!(target, path, type)
    }

    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /could not be restored without overwrite/i,
    )

    expect(await readdir(options.publicRoot)).toEqual([])
    expect(
      (await readdir(options.stagingRoot)).some((name) =>
        name.startsWith('previous-'),
      ),
    ).toBe(true)
  })

  it('rejects unsafe and overlapping publication paths', async () => {
    const options = await fixture()
    await expect(
      exportRuntimeCatalogs({ ...options, publicRoot: parse(process.cwd()).root }),
    ).rejects.toThrow(/unsafe runtime export target/i)
    await expect(
      exportRuntimeCatalogs({ ...options, publicRoot: process.cwd() }),
    ).rejects.toThrow(/unsafe runtime export target/i)
    await expect(
      exportRuntimeCatalogs({
        ...options,
        stagingRoot: join(options.publicRoot, 'staging'),
      }),
    ).rejects.toThrow(/roots.*overlap/i)
    await expect(
      exportRuntimeCatalogs({
        ...options,
        publicRoot: join(options.stagingRoot, 'public'),
      }),
    ).rejects.toThrow(/roots.*overlap/i)
    await expect(
      exportRuntimeCatalogs({
        ...options,
        publicRoot: options.stagingRoot,
      }),
    ).rejects.toThrow(/roots.*overlap/i)
  })

  it('serializes exporters using a canonical public-root lock', async () => {
    const options = await fixture()
    let releasePromotion!: () => void
    const promotionBlocked = new Promise<void>((resolvePromise) => {
      releasePromotion = resolvePromise
    })
    let firstPromotionStarted!: () => void
    const firstPromotion = new Promise<void>((resolvePromise) => {
      firstPromotionStarted = resolvePromise
    })
    let blocked = false
    const blockFirstPromotion = async (): Promise<void> => {
      if (blocked) return
      blocked = true
      firstPromotionStarted()
      await promotionBlocked
    }
    fileSystemControl.symlinkImplementation = async (target, path, type) => {
      if (path === resolve(options.publicRoot)) await blockFirstPromotion()
      await fileSystemControl.originalSymlink!(target, path, type)
    }
    fileSystemControl.mkdirImplementation = async (path, mkdirOptions) => {
      if (path === resolve(options.publicRoot)) {
        await blockFirstPromotion()
      }
      return fileSystemControl.originalMkdir!(path, mkdirOptions)
    }

    const first = exportRuntimeCatalogs(options)
    await firstPromotion
    await expect(exportRuntimeCatalogs(options)).rejects.toThrow(
      /lock contention/i,
    )
    releasePromotion()
    await first
    await expectRegularDirectory(options.publicRoot)
  })
})
