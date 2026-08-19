import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { z } from 'zod'

import { runtimeCatalogIndexSchema } from '../../shared/catalog-index.js'
import {
  artifactChecksumsSchema,
  catalogManifestSchema,
  playableCardSchema,
  printedCardIdSchema,
  strategySuggestionSchema,
} from '../../shared/catalog.js'
import { reportFailure } from './cli.js'

export interface RuntimeCatalogCheckResult {
  setCount: number
  fileCount: number
}

const failurePrefix =
  'Runtime catalogs unavailable or invalid. Run npm run catalog:sync.'
const runtimeFiles = [
  'manifest.json',
  'cards.json',
  'set-contents.json',
  'strategy-suggestions.json',
  'checksums.json',
] as const
const checksummedFiles = [
  'manifest.json',
  'cards.json',
  'set-contents.json',
  'strategy-suggestions.json',
] as const
const forbiddenKeyPattern = /^(?:bucketimg|cardimg|jp_.*)$|products|price|market/i

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isUrlString(value: string): boolean {
  if (/(?:^|[\s([{'"=:])\/\/[^\s/]+/i.test(value)) return true
  if (/(?:https?|ftp|file):\/\/\S+|(?:mailto|data):\S+/i.test(value)) {
    return true
  }
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function assertBrowserSafe(
  value: unknown,
  path: string,
  rejectUrls: boolean,
): void {
  if (typeof value === 'string') {
    if (rejectUrls && isUrlString(value)) {
      throw new Error(`runtime catalog privacy violation: URL at ${path}`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertBrowserSafe(child, `${path}[${index}]`, rejectUrls),
    )
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) {
      throw new Error(
        `runtime catalog privacy violation: forbidden key ${path}.${key}`,
      )
    }
    assertBrowserSafe(child, `${path}.${key}`, rejectUrls)
  }
}

async function resolveRuntimeRoot(publicRoot: string): Promise<string> {
  if (
    publicRoot === parse(publicRoot).root ||
    publicRoot === resolve(process.cwd())
  ) {
    throw new Error(`unsafe public root: ${publicRoot}`)
  }

  const rootStats = await lstat(publicRoot)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(
      `runtime catalog root must be a regular directory: ${publicRoot}`,
    )
  }
  return publicRoot
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8')
  try {
    return JSON.parse(content) as unknown
  } catch (cause) {
    throw new Error(`${path} contains malformed JSON`, { cause })
  }
}

async function assertExactEntries(
  path: string,
  expectedEntries: readonly string[],
): Promise<void> {
  const actualEntries = (await readdir(path)).sort()
  const expected = [...expectedEntries].sort()
  if (
    actualEntries.length !== expected.length ||
    actualEntries.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      `unexpected runtime catalog entries at ${path}; expected ${expected.join(', ')}; found ${actualEntries.join(', ')}`,
    )
  }
}

async function assertRegularFile(path: string): Promise<void> {
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`runtime catalog artifact is not a regular file: ${path}`)
  }
}

async function assertDirectory(path: string): Promise<void> {
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`runtime catalog set is not a directory: ${path}`)
  }
}

export async function checkRuntimeCatalogs(
  publicRoot: string,
): Promise<RuntimeCatalogCheckResult> {
  try {
    const root = resolve(publicRoot)
    const runtimeRoot = await resolveRuntimeRoot(root)
    await assertRegularFile(join(runtimeRoot, 'index.json'))
    const index = runtimeCatalogIndexSchema.parse(
      await readJson(join(runtimeRoot, 'index.json')),
    )
    await assertExactEntries(runtimeRoot, [
      'index.json',
      ...index.sets.map(({ setId }) => setId.toLowerCase()),
    ])
    for (const entry of index.sets) {
      const setRoot = join(runtimeRoot, entry.setId.toLowerCase())
      await assertDirectory(setRoot)
      await assertExactEntries(setRoot, runtimeFiles)
      const values: Record<string, unknown> = {}
      const rawFiles: Record<string, Buffer> = {}
      for (const filename of runtimeFiles) {
        const path = join(setRoot, filename)
        await assertRegularFile(path)
        const content = await readFile(path)
        rawFiles[filename] = content
        try {
          values[filename] = JSON.parse(content.toString('utf8')) as unknown
        } catch (cause) {
          throw new Error(`${path} contains malformed JSON`, { cause })
        }
      }
      for (const filename of checksummedFiles) {
        assertBrowserSafe(
          values[filename],
          `${entry.setId.toLowerCase()}/${filename}`,
          filename === 'cards.json',
        )
      }
      const schemas = {
        'manifest.json': catalogManifestSchema,
        'cards.json': z.array(playableCardSchema),
        'set-contents.json': z.array(printedCardIdSchema),
        'strategy-suggestions.json': z.array(strategySuggestionSchema),
        'checksums.json': artifactChecksumsSchema,
      }
      for (const filename of runtimeFiles) {
        const result = schemas[filename].safeParse(values[filename])
        if (!result.success) {
          throw new Error(`${join(setRoot, filename)} does not match its schema`)
        }
      }
      const checksums = artifactChecksumsSchema.parse(values['checksums.json'])
      for (const filename of checksummedFiles) {
        const actual = createHash('sha256')
          .update(rawFiles[filename]!)
          .digest('hex')
        if (actual !== checksums[filename]) {
          throw new Error(
            `checksum mismatch for ${join(setRoot, filename)}`,
          )
        }
      }
      const manifest = catalogManifestSchema.parse(values['manifest.json'])
      if (
        manifest.setId !== entry.setId ||
        manifest.sourceSha256 !== entry.sourceSha256 ||
        manifest.readiness !== entry.readiness
      ) {
        throw new Error(
          `runtime catalog ${entry.setId} manifest identity or provenance does not match its index entry`,
        )
      }
      const cards = z.array(playableCardSchema).parse(values['cards.json'])
      const contents = z
        .array(printedCardIdSchema)
        .parse(values['set-contents.json'])
      const cardNumbers = cards.map(({ cardNumber }) => cardNumber)
      if (
        contents.length !== cardNumbers.length ||
        contents.some((cardNumber, index) => cardNumber !== cardNumbers[index])
      ) {
        throw new Error(
          `runtime catalog ${entry.setId} set contents do not match cards`,
        )
      }
      const suggestions = z
        .array(strategySuggestionSchema)
        .parse(values['strategy-suggestions.json'])
      const suggestionNumbers = suggestions.map(({ cardNumber }) => cardNumber)
      const suggestionSet = new Set(suggestionNumbers)
      if (
        new Set(cardNumbers).size !== cardNumbers.length ||
        suggestionNumbers.length !== cardNumbers.length ||
        suggestionSet.size !== suggestionNumbers.length ||
        cardNumbers.some((cardNumber) => !suggestionSet.has(cardNumber))
      ) {
        throw new Error(
          `runtime catalog ${entry.setId} suggestions must contain exactly one entry per card`,
        )
      }
    }
    return { setCount: index.sets.length, fileCount: index.sets.length * 5 }
  } catch (cause) {
    throw new Error(`${failurePrefix} ${errorMessage(cause)}`, { cause })
  }
}

export async function runRuntimeCatalogCheck(
  publicRoot: string = resolve('public/catalogs'),
): Promise<void> {
  const result = await checkRuntimeCatalogs(publicRoot)
  process.stdout.write(
    `Runtime catalogs ready: ${result.setCount} sets, ${result.fileCount} files\n`,
  )
}

const entryPath = process.argv[1]
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  void runRuntimeCatalogCheck().catch(reportFailure)
}
