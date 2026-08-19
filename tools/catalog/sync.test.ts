import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const fileSystemControl = vi.hoisted(() => ({
  originalSymlink: undefined as
    | ((target: string, path: string, type?: 'dir') => Promise<void>)
    | undefined,
  symlinkImplementation: undefined as
    | ((target: string, path: string, type?: 'dir') => Promise<void>)
    | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  fileSystemControl.originalSymlink = (target, path, type) =>
    original.symlink(target, path, type)
  return {
    ...original,
    symlink: (target: string, path: string, type?: 'dir') =>
      fileSystemControl.symlinkImplementation?.(target, path, type) ??
      original.symlink(target, path, type),
  }
})

import { formatSyncResult, parseSyncArguments } from './sync-command.js'
import { syncCatalogs, type SyncCatalogsResult } from './sync.js'

const temporaryDirectories: string[] = []
const source = 'https://cdn.example.test/card-data-v1.json'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function row(setNumber: number): Record<string, unknown> {
  const setId = `OP${String(setNumber).padStart(2, '0')}`
  return {
    cardNumber: `${setId}-001`,
    cardName: `${setId} Test Card`,
    cost: '1',
    attribute: 'Strike',
    cardType: 'CHARACTER',
    power: '1000',
    counter: '1000',
    color: 'Red',
    feature: 'Test Crew',
    text: '',
    rarity: 'C',
    trigger: '',
    cardSet: setId,
  }
}

function fixture(root: string): {
  bytes: Uint8Array
  configValue: unknown
  outputRoot: string
  cachePath: string
} {
  const bytes = new TextEncoder().encode(
    JSON.stringify(Array.from({ length: 17 }, (_, index) => row(index + 1))),
  )
  const cachePath = join(root, 'source', 'cards.json')
  const sets = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => {
      const setId = `op${String(index + 1).padStart(2, '0')}`
      return [
        setId,
        {
          sourceType: 'cardkaizoku-json',
          targetSet: setId,
          expectedFirst: 1,
          expectedLast: 1,
          expectedSpecialReprints: [],
        },
      ]
    }),
  )
  return {
    bytes,
    cachePath,
    outputRoot: join(root, 'catalogs'),
    configValue: {
      cardKaizokuSnapshot: {
        source,
        sha256: sha256(bytes),
        cachePath,
      },
      sets,
    },
  }
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-sync-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  fileSystemControl.symlinkImplementation = undefined
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('syncCatalogs', () => {
  it('downloads one snapshot and publishes all 17 catalogs in OP order', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )

    const result = await syncCatalogs({
      configValue: input.configValue,
      outputRoot: input.outputRoot,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('published')
    expect(result.catalogs.map(({ setId }) => setId)).toEqual(
      Array.from({ length: 17 }, (_, index) =>
        `OP${String(index + 1).padStart(2, '0')}`,
      ),
    )
    expect(
      JSON.parse(
        await readFile(join(input.outputRoot, 'op01', 'manifest.json'), 'utf8'),
      ),
    ).toMatchObject({ source, sourceSha256: sha256(input.bytes) })
  })

  it('reuses the verified cache without fetching on a second sync', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )
    const decodedSnapshot = new TextDecoder().decode(input.bytes)
    const parse = vi.spyOn(JSON, 'parse')

    await syncCatalogs({ ...input, fetcher })
    await syncCatalogs({ ...input, fetcher })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(
      parse.mock.calls.filter(([value]) => value === decodedSnapshot),
    ).toHaveLength(2)
  })

  it.each([
    [
      'missing supported set',
      (config: { sets: Record<string, unknown> }) => {
        delete config.sets.op17
      },
    ],
    [
      'extra set',
      (config: { sets: Record<string, unknown> }) => {
        config.sets.op18 = {
          sourceType: 'cardkaizoku-json',
          targetSet: 'op18',
          expectedFirst: 1,
          expectedLast: 1,
        }
      },
    ],
    [
      'mixed source types',
      (config: { sets: Record<string, unknown> }) => {
        config.sets.op17 = {
          sourceType: 'local-json',
          source: '/tmp/op17.json',
          targetSet: 'op17',
          expectedFirst: 1,
          expectedLast: 1,
        }
      },
    ],
    [
      'mismatched target set',
      (config: { sets: Record<string, unknown> }) => {
        config.sets.op17 = {
          sourceType: 'cardkaizoku-json',
          targetSet: 'op16',
          expectedFirst: 1,
          expectedLast: 1,
        }
      },
    ],
  ])('rejects %s before network or filesystem mutation', async (_name, mutate) => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const config = structuredClone(input.configValue) as {
      sets: Record<string, unknown>
    }
    mutate(config)
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      syncCatalogs({
        configValue: config,
        outputRoot: input.outputRoot,
        fetcher,
      }),
    ).rejects.toThrow(/Catalog sync requires/)

    expect(fetcher).not.toHaveBeenCalled()
    await expect(access(input.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(input.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves every staging generation and reports all sets when validation fails', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )
    await syncCatalogs({ ...input, fetcher })
    const outputs = Array.from({ length: 17 }, (_, index) =>
      join(input.outputRoot, `op${String(index + 1).padStart(2, '0')}`),
    )
    const originalPointers = await Promise.all(
      outputs.map((output) => readlink(output)),
    )
    const originalCards = await Promise.all(
      outputs.map((output) => readFile(join(output, 'cards.json'), 'utf8')),
    )
    const originalStagingCount = (await readdir(input.outputRoot)).filter(
      (entry) => entry.includes('.staging-'),
    ).length
    const config = structuredClone(input.configValue) as {
      sets: Record<string, { expectedLast: number }>
    }
    config.sets.op17!.expectedLast = 2

    let failure: Error | undefined
    try {
      await syncCatalogs({
        configValue: config,
        outputRoot: input.outputRoot,
        fetcher,
      })
    } catch (error) {
      failure = error as Error
    }

    expect(failure?.message).toMatch(/validation failed.*report/i)
    const entries = await readdir(input.outputRoot)
    expect(entries.filter((entry) => entry.includes('.staging-'))).toHaveLength(
      originalStagingCount + 17,
    )
    expect(await Promise.all(outputs.map((output) => readlink(output)))).toEqual(
      originalPointers,
    )
    expect(
      await Promise.all(
        outputs.map((output) => readFile(join(output, 'cards.json'), 'utf8')),
      ),
    ).toEqual(originalCards)
    const reportDirectory = join(root, 'reports')
    const [reportName] = await readdir(reportDirectory)
    expect(reportName).toMatch(/^sync-failed-/)
    const report = JSON.parse(
      await readFile(join(reportDirectory, reportName!), 'utf8'),
    ) as { catalogs: Array<{ setId: string; errors: string[] }> }
    expect(report.catalogs).toHaveLength(17)
    expect(report.catalogs.at(-1)).toMatchObject({
      setId: 'OP17',
      errors: ['Missing OP17-002'],
    })
  })

  it('downloads an override once, preserves cache and pointers, and ignores discarded metadata', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const configuredFetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )
    await syncCatalogs({ ...input, fetcher: configuredFetcher })
    const publishedSource = 'https://published.example.test/op01.json'
    const publishedSha256 = 'b'.repeat(64)
    const op01ManifestPath = join(
      input.outputRoot,
      'op01',
      'manifest.json',
    )
    const op01Manifest = JSON.parse(
      await readFile(op01ManifestPath, 'utf8'),
    ) as Record<string, unknown>
    await writeFile(
      op01ManifestPath,
      JSON.stringify({
        ...op01Manifest,
        source: publishedSource,
        sourceSha256: publishedSha256,
      }),
      'utf8',
    )
    const originalCache = await readFile(input.cachePath)
    const originalPointers = await Promise.all(
      Array.from({ length: 17 }, (_, index) =>
        readlink(
          join(
            input.outputRoot,
            `op${String(index + 1).padStart(2, '0')}`,
          ),
        ),
      ),
    )
    const candidateRows = Array.from({ length: 17 }, (_, index) => ({
      ...row(index + 1),
      imageUrl: `https://images.example.test/${index + 1}.png`,
      price: '999.99',
    }))
    const candidateBytes = new TextEncoder().encode(JSON.stringify(candidateRows))
    const candidateSource = 'https://cdn.example.test/card-data-v2.json'
    const candidateFetcher = vi.fn<typeof fetch>(async () =>
      new Response(candidateBytes, { status: 200 }),
    )

    const result = await syncCatalogs({
      configValue: input.configValue,
      outputRoot: input.outputRoot,
      sourceOverride: candidateSource,
      fetcher: candidateFetcher,
    })

    expect(candidateFetcher).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      mode: 'candidate-report',
      source: candidateSource,
      sourceSha256: sha256(candidateBytes),
      catalogs: expect.arrayContaining([expect.objectContaining({ setId: 'OP01' })]),
    })
    expect(result.reportPath).toBe(
      join(root, 'reports', `candidate-${sha256(candidateBytes)}.json`),
    )
    expect(await readFile(input.cachePath)).toEqual(originalCache)
    await expect(
      Promise.all(
        Array.from({ length: 17 }, (_, index) =>
          readlink(
            join(
              input.outputRoot,
              `op${String(index + 1).padStart(2, '0')}`,
            ),
          ),
        ),
      ),
    ).resolves.toEqual(originalPointers)
    const originalReportBytes = await readFile(result.reportPath!)
    const report = JSON.parse(originalReportBytes.toString('utf8')) as {
      catalogs: Array<{
        baseline: {
          kind: string
          source: string
          sourceSha256: string | null
        }
        diff: Record<string, unknown[]>
      }>
    }
    expect(report.catalogs[0]?.baseline).toEqual({
      kind: 'published',
      source: publishedSource,
      sourceSha256: publishedSha256,
    })
    expect(
      report.catalogs.every(({ diff }) =>
        Object.values(diff).every((changes) => changes.length === 0),
      ),
    ).toBe(true)

    const identicalResult = await syncCatalogs({
      configValue: input.configValue,
      outputRoot: input.outputRoot,
      sourceOverride: candidateSource,
      fetcher: candidateFetcher,
    })
    expect(identicalResult.reportPath).toBe(result.reportPath)
    expect(await readFile(result.reportPath!)).toEqual(originalReportBytes)

    const op01CardsPath = join(input.outputRoot, 'op01', 'cards.json')
    const op01Cards = JSON.parse(
      await readFile(op01CardsPath, 'utf8'),
    ) as Array<Record<string, unknown>>
    op01Cards[0]!.name = 'Changed published baseline'
    await writeFile(op01CardsPath, JSON.stringify(op01Cards), 'utf8')
    await expect(
      syncCatalogs({
        configValue: input.configValue,
        outputRoot: input.outputRoot,
        sourceOverride: candidateSource,
        fetcher: candidateFetcher,
      }),
    ).rejects.toThrow(/Refusing to overwrite a different catalog report/)
    expect(await readFile(result.reportPath!)).toEqual(originalReportBytes)
  })

  it('uses the verified configured cache as an offline candidate baseline', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    await mkdir(join(root, 'source'), { recursive: true })
    await writeFile(input.cachePath, input.bytes)
    const candidateFetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )

    const result = await syncCatalogs({
      configValue: input.configValue,
      outputRoot: input.outputRoot,
      sourceOverride: 'https://cdn.example.test/candidate.json',
      fetcher: candidateFetcher,
    })

    expect(result.mode).toBe('candidate-report')
    await expect(access(input.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(candidateFetcher).toHaveBeenCalledTimes(1)
    const report = JSON.parse(await readFile(result.reportPath!, 'utf8')) as {
      catalogs: Array<{ baseline: Record<string, unknown> }>
    }
    expect(report.catalogs[0]?.baseline).toEqual({
      kind: 'configured-cache',
      source,
      sourceSha256: sha256(input.bytes),
    })
  })

  it.each([
    ['manifest.json', '{not json'],
    ['cards.json', '{not json'],
  ])(
    'rejects a malformed published %s without falling back to cache',
    async (filename, malformed) => {
      const root = await makeTemporaryDirectory()
      const input = fixture(root)
      const configuredFetcher = vi.fn<typeof fetch>(async () =>
        new Response(input.bytes, { status: 200 }),
      )
      await syncCatalogs({ ...input, fetcher: configuredFetcher })
      const output = join(input.outputRoot, 'op01')
      const pointer = await readlink(output)
      await writeFile(join(output, filename), malformed, 'utf8')
      const candidateFetcher = vi.fn<typeof fetch>(async () =>
        new Response(input.bytes, { status: 200 }),
      )

      await expect(
        syncCatalogs({
          configValue: input.configValue,
          outputRoot: input.outputRoot,
          sourceOverride: 'https://cdn.example.test/candidate.json',
          fetcher: candidateFetcher,
        }),
      ).rejects.toThrow(new RegExp(`published baseline.*OP01.*${filename}`, 'i'))

      expect(await readlink(output)).toBe(pointer)
      await expect(access(join(root, 'reports'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('rejects a published manifest for the wrong set without cache fallback', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const configuredFetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )
    await syncCatalogs({ ...input, fetcher: configuredFetcher })
    const output = join(input.outputRoot, 'op01')
    const manifestPath = join(output, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as object
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, setId: 'OP02' }),
      'utf8',
    )
    const candidateFetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )

    await expect(
      syncCatalogs({
        configValue: input.configValue,
        outputRoot: input.outputRoot,
        sourceOverride: 'https://cdn.example.test/candidate.json',
        fetcher: candidateFetcher,
      }),
    ).rejects.toThrow(/published baseline.*OP01.*setId/i)
  })

  it.each(['empty directory', 'dangling symlink'])(
    'rejects an existing %s output without falling back to cache',
    async (kind) => {
      const root = await makeTemporaryDirectory()
      const input = fixture(root)
      await mkdir(join(root, 'source'), { recursive: true })
      await writeFile(input.cachePath, input.bytes)
      await mkdir(input.outputRoot, { recursive: true })
      const output = join(input.outputRoot, 'op01')
      if (kind === 'empty directory') {
        await mkdir(output)
      } else {
        await symlink('missing-generation', output, 'dir')
      }
      const candidateFetcher = vi.fn<typeof fetch>(async () =>
        new Response(input.bytes, { status: 200 }),
      )

      await expect(
        syncCatalogs({
          configValue: input.configValue,
          outputRoot: input.outputRoot,
          sourceOverride: 'https://cdn.example.test/candidate.json',
          fetcher: candidateFetcher,
        }),
      ).rejects.toThrow(/Published baseline invalid for OP01/)

      expect(candidateFetcher).toHaveBeenCalledTimes(1)
      await expect(access(join(root, 'reports'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('fails clearly when neither a published nor cached baseline is available', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )

    await expect(
      syncCatalogs({
        configValue: input.configValue,
        outputRoot: input.outputRoot,
        sourceOverride: 'https://cdn.example.test/candidate.json',
        fetcher,
      }),
    ).rejects.toThrow(/baseline unavailable.*OP01/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(access(input.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an HTTP source override before fetch or filesystem side effects', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      syncCatalogs({
        configValue: input.configValue,
        outputRoot: input.outputRoot,
        sourceOverride: 'http://cdn.example.test/candidate.json',
        fetcher,
      }),
    ).rejects.toThrow(
      'Invalid Card Kaizoku candidate URL: http://cdn.example.test/candidate.json',
    )

    expect(fetcher).not.toHaveBeenCalled()
    await expect(access(input.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(input.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back every pointer when group publication faults partway through', async () => {
    const root = await makeTemporaryDirectory()
    const input = fixture(root)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(input.bytes, { status: 200 }),
    )
    await syncCatalogs({ ...input, fetcher })
    const outputs = Array.from({ length: 17 }, (_, index) =>
      join(input.outputRoot, `op${String(index + 1).padStart(2, '0')}`),
    )
    const originalPointers = await Promise.all(outputs.map((output) => readlink(output)))
    let injected = false
    fileSystemControl.symlinkImplementation = async (target, path, type) => {
      if (!injected && path === outputs[4]) {
        injected = true
        throw new Error('injected publication fault')
      }
      await fileSystemControl.originalSymlink!(target, path, type)
    }

    await expect(syncCatalogs({ ...input, fetcher })).rejects.toThrow(
      /publication.*rollback/i,
    )

    expect(await Promise.all(outputs.map((output) => readlink(output)))).toEqual(
      originalPointers,
    )
  })
})

describe('parseSyncArguments', () => {
  const usage = 'Usage: npm run catalog:sync [-- --source <versioned-json-url>]'

  it('accepts no arguments or one valid source override', () => {
    expect(parseSyncArguments([])).toEqual({})
    expect(
      parseSyncArguments(['--source', 'https://cdn.example.test/cards-v2.json']),
    ).toEqual({ sourceOverride: 'https://cdn.example.test/cards-v2.json' })
  })

  it.each([
    ['--source'],
    ['--source', 'not-a-url'],
    ['--source', 'http://cdn.example.test/cards.json'],
    ['--source', 'file:///tmp/cards.json'],
    ['op01'],
    ['--source', 'https://cdn.example.test/cards.json', 'extra'],
  ])('rejects invalid arguments with exact usage: %j', (...argv) => {
    expect(() => parseSyncArguments(argv)).toThrow(usage)
  })
})

describe('formatSyncResult', () => {
  const result: SyncCatalogsResult = {
    mode: 'published',
    source: 'https://cdn.example.test/cards.json',
    sourceSha256: 'a'.repeat(64),
    catalogs: [
      {
        setId: 'OP01',
        cardCount: 1,
        variantCount: 1,
        specialReprintCount: 0,
        readiness: 'needs-review',
        output: '/tmp/catalogs/op01',
      },
    ],
  }

  it('labels published catalog paths as outputs', () => {
    const summary = formatSyncResult(result)
    expect(summary).toContain('output=/tmp/catalogs/op01')
    expect(summary).not.toContain('comparisonPath=')
  })

  it('labels candidate paths as unpublished comparisons', () => {
    const summary = formatSyncResult({
      ...result,
      mode: 'candidate-report',
      reportPath: '/tmp/catalog/reports/candidate-a.json',
    })
    expect(summary).toContain(
      'comparisonPath=/tmp/catalogs/op01 status=not-published',
    )
    expect(summary).not.toContain('output=')
  })
})
