import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SourceConfig } from './model.js'
import { buildCatalog } from './pipeline.js'

const fixturePath = fileURLToPath(
  new URL('./__fixtures__/op17-input.json', import.meta.url),
)
const expectedFiles = [
  'cards.json',
  'checksums.json',
  'import-report.json',
  'manifest.json',
  'set-contents.json',
  'strategy-suggestions.json',
]
const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-pipeline-'))
  temporaryDirectories.push(directory)
  return directory
}

function localConfig(expectedFirst = 5): SourceConfig {
  return {
    sourceType: 'local-json',
    source: fixturePath,
    targetSet: 'op17',
    expectedFirst,
    expectedLast: 5,
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('buildCatalog', () => {
  it('defaults internal bundle output beneath tmp/catalog/bundles', async () => {
    const originalWorkingDirectory = process.cwd()
    const root = await makeTemporaryDirectory()
    process.chdir(root)
    try {
      const result = await buildCatalog({ setId: 'op17', config: localConfig() })
      expect(result.output).toBe(
        resolve('tmp', 'catalog', 'bundles', 'op17'),
      )
    } finally {
      process.chdir(originalWorkingDirectory)
    }
  })

  it('builds Card Kaizoku catalogs offline from a verified cache', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    const cachePath = join(root, 'cache', 'cards.json')
    const cachedRows = [
      {
        cardNumber: 'OP17-001',
        cardName: 'Offline Test Card',
        cost: '3',
        attribute: 'Strike',
        cardType: 'CHARACTER',
        power: '5000',
        counter: '1000',
        color: 'Red',
        feature: 'Test Crew',
        text: '',
        rarity: 'C',
        trigger: '',
        cardSet: 'OP17',
      },
    ]
    const cacheBytes = JSON.stringify(cachedRows)
    const sourceSha256 = createHash('sha256')
      .update(cacheBytes)
      .digest('hex')
    await mkdir(join(root, 'cache'))
    await writeFile(cachePath, cacheBytes, 'utf8')
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const config: SourceConfig = {
      sourceType: 'cardkaizoku-json',
      source: 'https://cdn.example.test/cards.json',
      sourceSha256,
      cachePath,
      targetSet: 'op17',
      expectedFirst: 1,
      expectedLast: 1,
      expectedSpecialReprints: [],
    }

    await expect(buildCatalog({ setId: 'op17', output, config })).resolves.toEqual({
      setId: 'OP17',
      cardCount: 1,
      variantCount: 1,
      specialReprintCount: 0,
      readiness: 'needs-review',
      output,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
    ).toEqual({
      language: 'en',
      readiness: 'needs-review',
      schemaVersion: 1,
      setId: 'OP17',
      source: 'https://cdn.example.test/cards.json',
      sourceSha256,
      sourceType: 'cardkaizoku-json',
    })
  })

  it('rejects a Card Kaizoku cache with the wrong checksum without fetching', async () => {
    const root = await makeTemporaryDirectory()
    const cachePath = join(root, 'cards.json')
    await writeFile(cachePath, '[]', 'utf8')
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const config: SourceConfig = {
      sourceType: 'cardkaizoku-json',
      source: 'https://cdn.example.test/cards.json',
      sourceSha256: 'a'.repeat(64),
      cachePath,
      targetSet: 'op17',
      expectedFirst: 1,
      expectedLast: 1,
      expectedSpecialReprints: [],
    }

    await expect(
      buildCatalog({ setId: 'op17', output: join(root, 'op17'), config }),
    ).rejects.toThrow(`Card Kaizoku cache checksum mismatch at ${cachePath}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing Card Kaizoku cache without fetching', async () => {
    const root = await makeTemporaryDirectory()
    const cachePath = join(root, 'missing', 'cards.json')
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const config: SourceConfig = {
      sourceType: 'cardkaizoku-json',
      source: 'https://cdn.example.test/cards.json',
      sourceSha256: 'a'.repeat(64),
      cachePath,
      targetSet: 'op17',
      expectedFirst: 1,
      expectedLast: 1,
      expectedSpecialReprints: [],
    }

    await expect(
      buildCatalog({ setId: 'op17', output: join(root, 'op17'), config }),
    ).rejects.toThrow(
      `Card Kaizoku cache is missing at ${cachePath} for source ${config.source}`,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects the filesystem root before publication', async () => {
    const filesystemRoot = parse(process.cwd()).root

    await expect(
      buildCatalog({
        setId: 'op17',
        output: filesystemRoot,
        config: localConfig(),
      }),
    ).rejects.toThrow(`Unsafe catalog output target: ${filesystemRoot}`)
  })

  it('rejects the current workspace directory without changing its contents', async () => {
    const originalWorkingDirectory = process.cwd()
    const workspace = await makeTemporaryDirectory()
    const sentinel = join(workspace, 'workspace.sentinel')
    await writeFile(sentinel, 'workspace bytes', 'utf8')
    const originalEntries = await readdir(workspace)

    process.chdir(workspace)
    try {
      const resolvedWorkspace = process.cwd()
      await expect(
        buildCatalog({
          setId: 'op17',
          output: resolvedWorkspace,
          config: localConfig(),
        }),
      ).rejects.toThrow(`Unsafe catalog output target: ${resolvedWorkspace}`)
    } finally {
      process.chdir(originalWorkingDirectory)
    }

    expect(await readdir(workspace)).toEqual(originalEntries)
    expect(await readFile(sentinel, 'utf8')).toBe('workspace bytes')
  })

  it('rejects an arbitrary existing output and preserves its sentinel', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'arbitrary-output')
    const sentinel = join(output, 'unrelated.sentinel')
    await mkdir(output)
    await writeFile(sentinel, 'unrelated bytes', 'utf8')

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow(`Refusing to replace non-catalog directory: ${output}`)

    expect(await readdir(output)).toEqual(['unrelated.sentinel'])
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated bytes')
  })

  it('rejects a mismatched catalog manifest and preserves the existing output', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'wrong-set')
    const sentinel = join(output, 'wrong-set.sentinel')
    await mkdir(output)
    await writeFile(
      join(output, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, setId: 'OP99' }),
      'utf8',
    )
    await writeFile(sentinel, 'wrong set bytes', 'utf8')

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow(
      `Refusing to replace catalog for OP99 at ${output}; expected OP17`,
    )

    expect((await readdir(output)).sort()).toEqual([
      'manifest.json',
      'wrong-set.sentinel',
    ])
    expect(await readFile(sentinel, 'utf8')).toBe('wrong set bytes')
  })

  it('rejects an output symlink whose catalog target is not an adjacent generation', async () => {
    const root = await makeTemporaryDirectory()
    const outside = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    const externalCatalog = join(outside, 'external-catalog')

    await buildCatalog({
      setId: 'op17',
      output: externalCatalog,
      config: localConfig(),
    })
    await symlink(await realpath(externalCatalog), output, 'dir')

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow(
      `Refusing catalog symlink outside adjacent generations: ${output}`,
    )

    expect(await realpath(output)).toBe(await realpath(externalCatalog))
    expect((await readdir(root)).sort()).toEqual(['op17'])
  })

  it('builds a complete catalog bundle and reports canonical counts', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    const result = await buildCatalog({
      setId: 'op17',
      output,
      config: localConfig(),
    })

    expect(result).toEqual({
      setId: 'OP17',
      cardCount: 1,
      variantCount: 2,
      specialReprintCount: 0,
      readiness: 'needs-review',
      output,
    })
    expect(JSON.parse(await readFile(join(output, 'cards.json'), 'utf8'))).toHaveLength(
      1,
    )
    expect((await readdir(output)).sort()).toEqual(expectedFiles)
  })

  it('writes byte-for-byte deterministic bundles', async () => {
    const firstRoot = await makeTemporaryDirectory()
    const secondRoot = await makeTemporaryDirectory()
    const firstOutput = join(firstRoot, 'op17')
    const secondOutput = join(secondRoot, 'op17')

    await buildCatalog({
      setId: 'op17',
      output: firstOutput,
      config: localConfig(),
    })
    await buildCatalog({
      setId: 'OP17',
      output: secondOutput,
      config: localConfig(),
    })

    for (const filename of expectedFiles) {
      expect(await readFile(join(firstOutput, filename))).toEqual(
        await readFile(join(secondOutput, filename)),
      )
    }
  })

  it('rejects a mismatched set identity before creating output', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'escaped-output')

    await expect(
      buildCatalog({
        setId: '../op16',
        output,
        config: localConfig(),
      }),
    ).rejects.toThrow(
      'Set ID "../op16" does not match configured target "op17"',
    )

    expect(await readdir(root)).toEqual([])
  })

  it('writes diagnostic artifacts before rejecting validation errors', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    await buildCatalog({ setId: 'op17', output, config: localConfig() })
    await writeFile(join(output, 'last-known-good.marker'), 'preserve me', 'utf8')
    const originalFiles = new Map(
      await Promise.all(
        (await readdir(output)).map(async (filename) => [
          filename,
          await readFile(join(output, filename)),
        ] as const),
      ),
    )

    await expect(
      buildCatalog({
        setId: 'op17',
        output,
        config: localConfig(4),
      }),
    ).rejects.toThrow(
      `Catalog validation failed:\nMissing OP17-004\nFailure diagnostics: ${output}.failed`,
    )

    const report = JSON.parse(
      await readFile(join(`${output}.failed`, 'import-report.json'), 'utf8'),
    ) as { validation: { errors: string[] } }
    expect(report.validation.errors).toContain('Missing OP17-004')
    expect((await readdir(`${output}.failed`)).sort()).toEqual(expectedFiles)

    expect((await readdir(output)).sort()).toEqual([...originalFiles.keys()].sort())
    for (const [filename, content] of originalFiles) {
      expect(await readFile(join(output, filename))).toEqual(content)
    }
  })

  it('preserves prior owned failure diagnostics as a unique tombstone', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    const failureOutput = `${output}.failed`

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig(4) }),
    ).rejects.toThrow('Catalog validation failed:')
    await writeFile(
      join(failureOutput, 'prior-diagnostics.marker'),
      'preserve diagnostics',
      'utf8',
    )

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig(4) }),
    ).rejects.toThrow('Preserved prior diagnostics:')

    const tombstone = (await readdir(root)).find((name) =>
      name.startsWith('op17.failed.tombstone-'),
    )
    expect(tombstone).toBeDefined()
    expect(
      await readFile(join(root, tombstone!, 'prior-diagnostics.marker'), 'utf8'),
    ).toBe('preserve diagnostics')
    expect(
      JSON.parse(await readFile(join(failureOutput, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
  })

  it('preserves an unrelated failure directory and refuses to replace it', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    const failureOutput = `${output}.failed`
    const sentinel = join(failureOutput, 'unrelated.sentinel')
    await mkdir(failureOutput)
    await writeFile(sentinel, 'unrelated failure bytes', 'utf8')

    await expect(
      buildCatalog({
        setId: 'op17',
        output,
        config: localConfig(4),
      }),
    ).rejects.toThrow(
      `Refusing to replace non-catalog directory: ${failureOutput}`,
    )

    expect(await readdir(failureOutput)).toEqual(['unrelated.sentinel'])
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated failure bytes')
    expect(await readdir(root)).toEqual(['op17.failed'])
  })

  it('replaces an existing output, preserving it as a complete owned tombstone', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    await buildCatalog({ setId: 'op17', output, config: localConfig() })
    await writeFile(join(output, 'obsolete.marker'), 'old output', 'utf8')

    await buildCatalog({ setId: 'op17', output, config: localConfig() })

    expect((await readdir(output)).sort()).toEqual(expectedFiles)
    const checksums = JSON.parse(
      await readFile(join(output, 'checksums.json'), 'utf8'),
    ) as Record<string, string>
    for (const [filename, expectedChecksum] of Object.entries(checksums)) {
      const { createHash } = await import('node:crypto')
      const actualChecksum = createHash('sha256')
        .update(await readFile(join(output, filename)))
        .digest('hex')
      expect(actualChecksum).toBe(expectedChecksum)
    }
    const rootEntries = await readdir(root)
    expect(rootEntries).toContain('op17')
    const tombstone = rootEntries.find((name) =>
      name.startsWith('op17.tombstone-'),
    )
    expect(tombstone).toBeDefined()
    expect(await readFile(join(root, tombstone!, 'obsolete.marker'), 'utf8')).toBe(
      'old output',
    )
    expect(
      JSON.parse(await readFile(join(root, tombstone!, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
  })
})
