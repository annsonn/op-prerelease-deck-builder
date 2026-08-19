import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  symlink,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'

import { z } from 'zod'

import {
  artifactChecksumsSchema,
  catalogManifestSchema,
  playableCardSchema,
  printedCardIdSchema,
  strategySuggestionSchema,
} from '../../shared/catalog.js'
import { runtimeCatalogIndexSchema } from '../../shared/catalog-index.js'

import { sha256, writeJson } from './artifacts.js'
import { withCatalogPublicationLocks } from './publication.js'

export interface RuntimeExportOptions {
  bundleRoot: string
  publicRoot: string
  stagingRoot: string
}

export interface RuntimeExportResult {
  publicRoot: string
  setCount: number
  fileCount: number
}

const setIds = Array.from(
  { length: 17 },
  (_, index) => `op${String(index + 1).padStart(2, '0')}`,
)
const runtimeDataFiles = [
  'manifest.json',
  'cards.json',
  'set-contents.json',
  'strategy-suggestions.json',
] as const
const sourceDataFiles = [...runtimeDataFiles, 'import-report.json'] as const
const runtimeExportFiles = [...runtimeDataFiles, 'checksums.json'].sort()
const runtimeRootEntries = ['index.json', ...setIds].sort()
const sha256Pattern = /^[a-f\d]{64}$/
const forbiddenKeyPattern = /^(?:bucketimg|cardimg|jp_.*)$|products|price|market/i

interface ValidatedBundle {
  setId: string
  manifest: z.infer<typeof catalogManifestSchema> & { sourceSha256: string }
  files: Record<(typeof runtimeDataFiles)[number], unknown>
}

interface ActiveBundleIdentity {
  output: string
  kind: 'directory' | 'symlink'
  generation: string
  rawTarget?: string
  outputDevice: number
  outputInode: number
  generationDevice: number
  generationInode: number
}

type OwnedRuntimeExport =
  | { kind: 'directory'; device: number; inode: number }
  | {
      kind: 'symlink'
      rawTarget: string
      target: string
      device: number
      inode: number
    }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}

function assertSafeRoots(publicRoot: string, stagingRoot: string): void {
  if (
    publicRoot === parse(publicRoot).root ||
    publicRoot === resolve(process.cwd())
  ) {
    throw new Error(`Unsafe runtime export target: ${publicRoot}`)
  }
  if (
    isPathInside(publicRoot, stagingRoot) ||
    isPathInside(stagingRoot, publicRoot)
  ) {
    throw new Error(
      `Runtime export public and staging roots must not overlap: ${publicRoot}, ${stagingRoot}`,
    )
  }
}

async function canonicalPublicIdentity(publicRoot: string): Promise<string> {
  await mkdir(dirname(publicRoot), { recursive: true })
  return join(await realpath(dirname(publicRoot)), basename(publicRoot))
}

async function readJson(path: string): Promise<unknown> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (cause) {
    throw new Error(`Runtime catalog artifact is missing or unreadable: ${path}`, {
      cause,
    })
  }

  try {
    return JSON.parse(content) as unknown
  } catch (cause) {
    throw new Error(`Runtime catalog artifact contains malformed JSON: ${path}`, {
      cause,
    })
  }
}

function parseSourceChecksums(
  value: unknown,
  path: string,
): Record<(typeof sourceDataFiles)[number], string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Source bundle checksums are invalid: ${path}`)
  }
  const record = value as Record<string, unknown>
  const actualKeys = Object.keys(record).sort()
  const expectedKeys = [...sourceDataFiles].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      `Source bundle checksums must contain exactly ${expectedKeys.join(', ')}: ${path}`,
    )
  }
  for (const key of expectedKeys) {
    if (typeof record[key] !== 'string' || !sha256Pattern.test(record[key])) {
      throw new Error(`Source bundle checksum is invalid for ${key}: ${path}`)
    }
  }
  return record as Record<(typeof sourceDataFiles)[number], string>
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
      throw new Error(`Runtime catalog privacy violation: URL at ${path}`)
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
        `Runtime catalog privacy violation: forbidden key ${path}.${key}`,
      )
    }
    assertBrowserSafe(child, `${path}.${key}`, rejectUrls)
  }
}

function assertCrossReferences(
  setId: string,
  cards: z.infer<typeof playableCardSchema>[],
  contents: string[],
  suggestions: z.infer<typeof strategySuggestionSchema>[],
): void {
  const cardNumbers = cards.map(({ cardNumber }) => cardNumber)
  if (new Set(cardNumbers).size !== cardNumbers.length) {
    throw new Error(`Runtime catalog ${setId} contains duplicate cards`)
  }
  for (const card of cards) {
    if (!card.setMembership.some((membership) => membership.toUpperCase() === setId)) {
      throw new Error(
        `Runtime catalog ${setId} card ${card.cardNumber} is missing ${setId} membership`,
      )
    }
  }
  if (
    contents.length !== cardNumbers.length ||
    contents.some((cardNumber, index) => cardNumber !== cardNumbers[index])
  ) {
    throw new Error(`Runtime catalog ${setId} set contents do not match cards`)
  }

  const suggestionNumbers = suggestions.map(({ cardNumber }) => cardNumber)
  const suggestionSet = new Set(suggestionNumbers)
  if (
    suggestionNumbers.length !== cardNumbers.length ||
    suggestionSet.size !== suggestionNumbers.length ||
    cardNumbers.some((cardNumber) => !suggestionSet.has(cardNumber))
  ) {
    throw new Error(
      `Runtime catalog ${setId} suggestions must contain exactly one entry per card`,
    )
  }
}

async function validateBundle(
  generation: string,
  lowerSetId: string,
): Promise<ValidatedBundle> {
  const checksumsPath = join(generation, 'checksums.json')
  const checksums = parseSourceChecksums(
    await readJson(checksumsPath),
    checksumsPath,
  )
  const rawFiles = {} as Record<(typeof sourceDataFiles)[number], string>
  for (const filename of sourceDataFiles) {
    const path = join(generation, filename)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch (cause) {
      throw new Error(`Source bundle artifact is missing: ${path}`, { cause })
    }
    if (sha256(content) !== checksums[filename]) {
      throw new Error(
        `Source checksum mismatch for ${lowerSetId}/${filename}`,
      )
    }
    rawFiles[filename] = content
  }

  const values = {} as Record<(typeof runtimeDataFiles)[number], unknown>
  for (const filename of runtimeDataFiles) {
    try {
      values[filename] = JSON.parse(rawFiles[filename]) as unknown
    } catch (cause) {
      throw new Error(
        `Source bundle artifact contains malformed JSON: ${lowerSetId}/${filename}`,
        { cause },
      )
    }
  }

  for (const filename of runtimeDataFiles) {
    assertBrowserSafe(
      values[filename],
      `${lowerSetId}/${filename}`,
      filename === 'cards.json',
    )
  }

  const expectedSetId = lowerSetId.toUpperCase()
  const manifestResult = catalogManifestSchema.safeParse(values['manifest.json'])
  if (!manifestResult.success) {
    throw new Error(`Runtime catalog ${expectedSetId} manifest is invalid`)
  }
  const manifest = manifestResult.data
  if (manifest.setId !== expectedSetId || manifest.sourceSha256 === undefined) {
    throw new Error(
      `Runtime catalog ${expectedSetId} manifest must match its set and include sourceSha256`,
    )
  }
  const cards = z.array(playableCardSchema).parse(values['cards.json'])
  const contents = z.array(printedCardIdSchema).parse(values['set-contents.json'])
  const suggestions = z
    .array(strategySuggestionSchema)
    .parse(values['strategy-suggestions.json'])
  assertCrossReferences(expectedSetId, cards, contents, suggestions)

  return {
    setId: expectedSetId,
    manifest: { ...manifest, sourceSha256: manifest.sourceSha256 },
    files: values,
  }
}

async function resolveActiveBundle(
  output: string,
): Promise<ActiveBundleIdentity> {
  const outputStats = await lstat(output)
  if (outputStats.isSymbolicLink()) {
    const rawTarget = await readlink(output)
    const target = resolve(dirname(output), rawTarget)
    const [outputParent, targetParent, targetStats] = await Promise.all([
      realpath(dirname(output)),
      realpath(dirname(target)),
      lstat(target),
    ])
    if (
      targetStats.isSymbolicLink() ||
      !targetStats.isDirectory() ||
      outputParent !== targetParent ||
      (!basename(target).startsWith(`${basename(output)}.staging-`) &&
        !basename(target).startsWith(`${basename(output)}.tombstone-`))
    ) {
      throw new Error(
        `Runtime catalog active bundle is not an adjacent owned generation: ${output}`,
      )
    }
    return {
      output,
      kind: 'symlink',
      generation: await realpath(target),
      rawTarget,
      outputDevice: outputStats.dev,
      outputInode: outputStats.ino,
      generationDevice: targetStats.dev,
      generationInode: targetStats.ino,
    }
  }
  if (!outputStats.isDirectory()) {
    throw new Error(`Runtime catalog active bundle is not a directory: ${output}`)
  }
  return {
    output,
    kind: 'directory',
    generation: await realpath(output),
    outputDevice: outputStats.dev,
    outputInode: outputStats.ino,
    generationDevice: outputStats.dev,
    generationInode: outputStats.ino,
  }
}

async function validateActiveBundles(
  bundleRoot: string,
): Promise<ActiveBundleIdentity[]> {
  let entries: string[]
  try {
    entries = await readdir(bundleRoot)
  } catch (cause) {
    throw new Error(`Runtime catalog bundle root is unavailable: ${bundleRoot}`, {
      cause,
    })
  }
  const active = entries.filter((entry) => /^op\d{2}$/.test(entry)).sort()
  if (
    active.length !== setIds.length ||
    active.some((entry, index) => entry !== setIds[index])
  ) {
    throw new Error(
      `Runtime export requires active bundles exactly op01 through op17; found: ${active.join(', ')}`,
    )
  }
  const identities = []
  for (const setId of setIds) {
    identities.push(await resolveActiveBundle(join(bundleRoot, setId)))
  }
  return identities
}

async function recheckActiveBundles(
  identities: ActiveBundleIdentity[],
): Promise<void> {
  for (const identity of identities) {
    const current = await resolveActiveBundle(identity.output)
    if (
      current.kind !== identity.kind ||
      current.generation !== identity.generation ||
      current.rawTarget !== identity.rawTarget ||
      current.outputDevice !== identity.outputDevice ||
      current.outputInode !== identity.outputInode ||
      current.generationDevice !== identity.generationDevice ||
      current.generationInode !== identity.generationInode
    ) {
      throw new Error(
        `Runtime catalog active bundle changed during export: ${identity.output}`,
      )
    }
  }
}

async function stageExport(
  stagingRoot: string,
  bundles: ValidatedBundle[],
): Promise<string> {
  const generation = await mkdtemp(join(stagingRoot, 'runtime-export-'))
  try {
    const index = runtimeCatalogIndexSchema.parse({
      schemaVersion: 1,
      sets: bundles.map(({ setId, manifest }) => ({
        setId,
        label: setId,
        manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
        sourceSha256: manifest.sourceSha256,
        readiness: manifest.readiness,
      })),
    })

    for (const bundle of bundles) {
      const output = join(generation, bundle.setId.toLowerCase())
      const checksums: Record<string, string> = {}
      for (const filename of runtimeDataFiles) {
        checksums[filename] = await writeJson(
          join(output, filename),
          bundle.files[filename],
        )
      }
      await writeJson(
        join(output, 'checksums.json'),
        artifactChecksumsSchema.parse(checksums),
      )
    }
    await writeJson(join(generation, 'index.json'), index)
  } catch (cause) {
    throw new Error(
      `Runtime export staging failed; abandoned staging preserved at ${generation}: ${errorMessage(cause)}`,
      { cause },
    )
  }
  return generation
}

async function readOwnedRuntimeIndex(path: string): Promise<void> {
  try {
    runtimeCatalogIndexSchema.parse(await readJson(join(path, 'index.json')))
  } catch (cause) {
    throw new Error(
      `Refusing to replace non-runtime-catalog directory: ${path}`,
      { cause },
    )
  }
}

async function assertOwnedPublicRoot(
  publicRoot: string,
  stagingRoot: string,
): Promise<OwnedRuntimeExport | undefined> {
  if (!(await pathExists(publicRoot))) return undefined
  const stats = await lstat(publicRoot)
  if (stats.isSymbolicLink()) {
    const rawTarget = await readlink(publicRoot)
    const target = resolve(dirname(publicRoot), rawTarget)
    const [publicParent, stagingDirectory, targetParent, targetStats] =
      await Promise.all([
        realpath(dirname(publicRoot)),
        realpath(stagingRoot),
        realpath(dirname(target)),
        lstat(target),
      ])
    const targetName = basename(target)
    const isLegacyAdjacentGeneration =
      publicParent === targetParent &&
      (targetName.startsWith(`${basename(publicRoot)}.staging-`) ||
        targetName.startsWith(`${basename(publicRoot)}.tombstone-`))
    const isRestoredPrevious =
      stagingDirectory === targetParent && targetName.startsWith('previous-')
    if (
      targetStats.isSymbolicLink() ||
      !targetStats.isDirectory() ||
      (!isLegacyAdjacentGeneration && !isRestoredPrevious)
    ) {
      throw new Error(
        `Refusing runtime export symlink outside owned generations: ${publicRoot}`,
      )
    }
    await readOwnedRuntimeIndex(target)
    return {
      kind: 'symlink',
      rawTarget,
      target,
      device: stats.dev,
      inode: stats.ino,
    }
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `Refusing to replace non-runtime-catalog directory: ${publicRoot}`,
    )
  }
  await readOwnedRuntimeIndex(publicRoot)
  return { kind: 'directory', device: stats.dev, inode: stats.ino }
}

async function assertMovedOwnedExport(
  movedPath: string,
  existing: OwnedRuntimeExport,
): Promise<void> {
  const movedStats = await lstat(movedPath)
  if (
    movedStats.dev !== existing.device ||
    movedStats.ino !== existing.inode ||
    (existing.kind === 'symlink' &&
      (!movedStats.isSymbolicLink() ||
        (await readlink(movedPath)) !== existing.rawTarget)) ||
    (existing.kind === 'directory' && !movedStats.isDirectory())
  ) {
    throw new Error('Runtime export public destination changed during publication')
  }
}

async function uniqueStagingPath(
  stagingRoot: string,
  prefix: string,
): Promise<string> {
  let path = join(stagingRoot, `${prefix}-${randomUUID()}`)
  while (await pathExists(path)) {
    path = join(stagingRoot, `${prefix}-${randomUUID()}`)
  }
  return path
}

async function uniquePrevious(stagingRoot: string): Promise<string> {
  return uniqueStagingPath(stagingRoot, 'previous')
}

async function copyToAdjacentGeneration(
  stagedGeneration: string,
  publicRoot: string,
): Promise<string> {
  const adjacentGeneration = await mkdtemp(`${publicRoot}.staging-`)
  try {
    for (const entry of await readdir(stagedGeneration)) {
      await cp(
        join(stagedGeneration, entry),
        join(adjacentGeneration, entry),
        { recursive: true, errorOnExist: true, force: false },
      )
    }
    await readOwnedRuntimeIndex(adjacentGeneration)
  } catch (cause) {
    throw new Error(
      `Runtime export adjacent generation copy failed; temporary staging preserved at ${stagedGeneration}; adjacent generation preserved at ${adjacentGeneration}: ${errorMessage(cause)}`,
      { cause },
    )
  }
  return adjacentGeneration
}

async function restoreWithOwnedPointer(
  publicRoot: string,
  target: string,
): Promise<void> {
  await symlink(target, publicRoot, 'dir')
}

async function restorePreviousExport(
  publicRoot: string,
  previous: string,
  existing: OwnedRuntimeExport,
): Promise<void> {
  await restoreWithOwnedPointer(
    publicRoot,
    existing.kind === 'symlink' ? existing.rawTarget : previous,
  )
  await readOwnedRuntimeIndex(publicRoot)
}

async function preserveReadablePrevious(
  previous: string,
  existing: OwnedRuntimeExport,
  stagingRoot: string,
): Promise<void> {
  if (existing.kind === 'directory') return

  const preservedPointer = await uniqueStagingPath(
    stagingRoot,
    'legacy-pointer',
  )
  await rename(previous, preservedPointer)
  await assertMovedOwnedExport(preservedPointer, existing)
  try {
    await symlink(existing.target, previous, 'dir')
    await readOwnedRuntimeIndex(previous)
  } catch (cause) {
    throw new Error(
      `Runtime export could not preserve a readable previous legacy generation at ${previous}; original pointer preserved at ${preservedPointer}: ${errorMessage(cause)}`,
      { cause },
    )
  }
}

function assertExactEntries(
  actualEntries: string[],
  expectedEntries: string[],
  context: string,
): void {
  const actual = [...actualEntries].sort()
  const expected = [...expectedEntries].sort()
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      `Runtime export ${context} has unexpected entries: ${actual.join(', ')}`,
    )
  }
}

function populationOrder(entries: string[]): string[] {
  assertExactEntries(entries, runtimeRootEntries, 'adjacent generation')
  const expected = [...setIds, 'index.json']
  return expected
}

async function copySetDirectoryExclusively(
  source: string,
  destination: string,
  claimIdentity: OwnedRuntimeExport,
  publicRoot: string,
): Promise<OwnedRuntimeExport> {
  const sourceStats = await lstat(source)
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw new Error(`Runtime export set source is not a regular directory: ${source}`)
  }
  const actualFiles = (await readdir(source)).sort()
  assertExactEntries(actualFiles, runtimeExportFiles, `set source ${source}`)

  await mkdir(destination)
  const destinationStats = await lstat(destination)
  const destinationIdentity: OwnedRuntimeExport = {
    kind: 'directory',
    device: destinationStats.dev,
    inode: destinationStats.ino,
  }
  for (const filename of runtimeExportFiles) {
    await assertMovedOwnedExport(publicRoot, claimIdentity)
    await assertMovedOwnedExport(destination, destinationIdentity)
    const sourceFile = join(source, filename)
    const sourceFileStats = await lstat(sourceFile)
    if (sourceFileStats.isSymbolicLink() || !sourceFileStats.isFile()) {
      throw new Error(`Runtime export source is not a regular file: ${sourceFile}`)
    }
    await copyFile(
      sourceFile,
      join(destination, filename),
      constants.COPYFILE_EXCL,
    )
    await assertMovedOwnedExport(publicRoot, claimIdentity)
    await assertMovedOwnedExport(destination, destinationIdentity)
  }
  return destinationIdentity
}

async function validatePublishedInventory(
  publicRoot: string,
  claimIdentity: OwnedRuntimeExport,
  setIdentities: Map<string, OwnedRuntimeExport>,
): Promise<void> {
  await assertMovedOwnedExport(publicRoot, claimIdentity)
  assertExactEntries(
    await readdir(publicRoot),
    runtimeRootEntries,
    `root ${publicRoot}`,
  )

  const indexStats = await lstat(join(publicRoot, 'index.json'))
  if (indexStats.isSymbolicLink() || !indexStats.isFile()) {
    throw new Error(
      `Runtime export index is not a regular file: ${join(publicRoot, 'index.json')}`,
    )
  }
  for (const setId of setIds) {
    await assertMovedOwnedExport(publicRoot, claimIdentity)
    const setRoot = join(publicRoot, setId)
    const setIdentity = setIdentities.get(setId)
    if (setIdentity === undefined) {
      throw new Error(`Runtime export set identity is missing: ${setRoot}`)
    }
    await assertMovedOwnedExport(setRoot, setIdentity)
    assertExactEntries(
      await readdir(setRoot),
      runtimeExportFiles,
      `set directory ${setRoot}`,
    )
    for (const filename of runtimeExportFiles) {
      await assertMovedOwnedExport(publicRoot, claimIdentity)
      await assertMovedOwnedExport(setRoot, setIdentity)
      const path = join(setRoot, filename)
      const stats = await lstat(path)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`Runtime export artifact is not a regular file: ${path}`)
      }
    }
    await assertMovedOwnedExport(setRoot, setIdentity)
    assertExactEntries(
      await readdir(setRoot),
      runtimeExportFiles,
      `set directory ${setRoot}`,
    )
  }
  await assertMovedOwnedExport(publicRoot, claimIdentity)
  assertExactEntries(
    await readdir(publicRoot),
    runtimeRootEntries,
    `root ${publicRoot}`,
  )
}

async function archiveOwnedAdjacentGeneration(
  adjacentGeneration: string,
  publicRoot: string,
  identity: OwnedRuntimeExport,
): Promise<void> {
  const [publicParent, adjacentParent] = await Promise.all([
    realpath(dirname(publicRoot)),
    realpath(dirname(adjacentGeneration)),
  ])
  if (
    identity.kind !== 'directory' ||
    publicParent !== adjacentParent ||
    !basename(adjacentGeneration).startsWith(
      `${basename(publicRoot)}.staging-`,
    )
  ) {
    throw new Error(
      `Runtime export refused to archive an unowned adjacent generation: ${adjacentGeneration}`,
    )
  }
  await assertMovedOwnedExport(adjacentGeneration, identity)
  let archived = `${adjacentGeneration}.completed-${randomUUID()}`
  while (await pathExists(archived)) {
    archived = `${adjacentGeneration}.completed-${randomUUID()}`
  }
  await rename(adjacentGeneration, archived)
  await assertMovedOwnedExport(archived, identity)
}

async function populateClaimedPublicRoot(
  adjacentGeneration: string,
  publicRoot: string,
  stagingRoot: string,
): Promise<void> {
  try {
    await mkdir(publicRoot)
  } catch (cause) {
    throw new Error(
      `Runtime export publication failed because the destination is occupied or unavailable: ${publicRoot}: ${errorMessage(cause)}`,
      { cause },
    )
  }

  // Trust boundary: publication locks serialize cooperative writers. Portable
  // Node cannot atomically return a stable directory handle from mkdir, so an
  // uncooperative swap between this exclusive claim and lstat is out of scope.
  const claimStats = await lstat(publicRoot)
  const claimIdentity: OwnedRuntimeExport = {
    kind: 'directory',
    device: claimStats.dev,
    inode: claimStats.ino,
  }
  try {
    const adjacentStats = await lstat(adjacentGeneration)
    const adjacentIdentity: OwnedRuntimeExport = {
      kind: 'directory',
      device: adjacentStats.dev,
      inode: adjacentStats.ino,
    }
    const setIdentities = new Map<string, OwnedRuntimeExport>()
    for (const entry of populationOrder(await readdir(adjacentGeneration))) {
      await assertMovedOwnedExport(publicRoot, claimIdentity)
      const source = join(adjacentGeneration, entry)
      const destination = join(publicRoot, entry)
      if (entry === 'index.json') {
        const sourceStats = await lstat(source)
        if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
          throw new Error(
            `Runtime export index source is not a regular file: ${source}`,
          )
        }
        await copyFile(source, destination, constants.COPYFILE_EXCL)
      } else {
        setIdentities.set(
          entry,
          await copySetDirectoryExclusively(
            source,
            destination,
            claimIdentity,
            publicRoot,
          ),
        )
      }
      await assertMovedOwnedExport(publicRoot, claimIdentity)
      if (!(await pathExists(destination))) {
        throw new Error(
          `Runtime export population did not publish expected entry: ${destination}`,
        )
      }
    }
    await assertMovedOwnedExport(publicRoot, claimIdentity)
    await validatePublishedInventory(publicRoot, claimIdentity, setIdentities)
    await readOwnedRuntimeIndex(publicRoot)
    await assertMovedOwnedExport(publicRoot, claimIdentity)
    await archiveOwnedAdjacentGeneration(
      adjacentGeneration,
      publicRoot,
      adjacentIdentity,
    )
    await assertMovedOwnedExport(publicRoot, claimIdentity)
  } catch (cause) {
    const failed = await uniqueStagingPath(stagingRoot, 'failed')
    try {
      await rename(publicRoot, failed)
      await assertMovedOwnedExport(failed, claimIdentity)
    } catch (preserveCause) {
      try {
        if (await pathExists(failed)) {
          await restoreWithOwnedPointer(publicRoot, failed)
        }
      } catch (restoreCause) {
        throw new AggregateError(
          [cause, preserveCause, restoreCause],
          `Runtime export population failed and the claimed destination could not be preserved without overwrite; adjacent remainder preserved at ${adjacentGeneration}; partial diagnostics may remain at ${publicRoot} or ${failed}`,
        )
      }
      throw new AggregateError(
        [cause, preserveCause],
        `Runtime export population failed and the claimed destination changed while preserving diagnostics; adjacent remainder preserved at ${adjacentGeneration}; partial diagnostics preserved at ${publicRoot} or ${failed}`,
      )
    }
    throw new Error(
      `Runtime export population failed; partial claimed directory preserved at ${failed}; adjacent remainder preserved at ${adjacentGeneration}: ${errorMessage(cause)}`,
      { cause },
    )
  }
}

async function publishExport(
  generation: string,
  publicRoot: string,
  stagingRoot: string,
  beforePromote: () => Promise<void>,
): Promise<void> {
  const adjacentGeneration = await copyToAdjacentGeneration(
    generation,
    publicRoot,
  )
  const existing = await assertOwnedPublicRoot(publicRoot, stagingRoot)
  await beforePromote()
  const previous =
    existing === undefined ? undefined : await uniquePrevious(stagingRoot)
  if (existing !== undefined && previous !== undefined) {
    await rename(publicRoot, previous)
    try {
      await assertMovedOwnedExport(previous, existing)
    } catch (cause) {
      try {
        await restoreWithOwnedPointer(publicRoot, previous)
      } catch (restoreCause) {
        throw new AggregateError(
          [cause, restoreCause],
          `Runtime export public destination changed during publication and could not be restored without overwrite; moved entry preserved at ${previous}; adjacent generation preserved at ${adjacentGeneration}`,
        )
      }
      throw new Error(
        `Runtime export public destination changed during publication; unexpected entry restored from ${previous}; adjacent generation preserved at ${adjacentGeneration}`,
        { cause },
      )
    }
    try {
      await preserveReadablePrevious(previous, existing, stagingRoot)
    } catch (cause) {
      try {
        await restorePreviousExport(publicRoot, previous, existing)
      } catch (restoreCause) {
        throw new AggregateError(
          [cause, restoreCause],
          `Runtime export could not preserve a readable previous generation or restore the public destination without overwrite; diagnostics preserved under ${stagingRoot}; adjacent generation preserved at ${adjacentGeneration}`,
        )
      }
      throw new Error(
        `Runtime export could not preserve a readable previous generation; previous export restored; diagnostics preserved under ${stagingRoot}; adjacent generation preserved at ${adjacentGeneration}: ${errorMessage(cause)}`,
        { cause },
      )
    }
  }

  try {
    await populateClaimedPublicRoot(
      adjacentGeneration,
      publicRoot,
      stagingRoot,
    )
  } catch (cause) {
    if (existing === undefined) {
      throw new Error(
        `Runtime export publication failed; temporary staging preserved at ${generation}; adjacent generation or remainder preserved at ${adjacentGeneration}: ${errorMessage(cause)}`,
        { cause },
      )
    }
    if (previous === undefined) throw cause
    try {
      await restorePreviousExport(publicRoot, previous, existing)
    } catch (restoreCause) {
      throw new AggregateError(
        [cause, restoreCause],
        `Runtime export publication failed and previous export could not be restored without overwrite; previous export preserved at ${previous}; temporary staging preserved at ${generation}; adjacent generation or remainder preserved at ${adjacentGeneration}`,
      )
    }
    throw new Error(
      `Runtime export population failed; previous export restored; temporary staging preserved at ${generation}; adjacent generation or remainder preserved at ${adjacentGeneration}: ${errorMessage(cause)}`,
      { cause },
    )
  }
}

export async function exportRuntimeCatalogs(
  options: RuntimeExportOptions,
): Promise<RuntimeExportResult> {
  const bundleRoot = resolve(options.bundleRoot)
  const publicRoot = resolve(options.publicRoot)
  const stagingRoot = resolve(options.stagingRoot)
  assertSafeRoots(publicRoot, stagingRoot)
  await mkdir(stagingRoot, { recursive: true })
  const canonicalPublicRoot = await canonicalPublicIdentity(publicRoot)
  const canonicalStagingRoot = await realpath(stagingRoot)
  if (
    isPathInside(canonicalPublicRoot, canonicalStagingRoot) ||
    isPathInside(canonicalStagingRoot, canonicalPublicRoot)
  ) {
    throw new Error(
      `Runtime export public and staging roots must not overlap: ${publicRoot}, ${stagingRoot}`,
    )
  }

  const bundleOutputs = setIds.map((setId) => join(bundleRoot, setId))
  return withCatalogPublicationLocks(
    [...bundleOutputs, publicRoot],
    async () => {
      const identities = await validateActiveBundles(bundleRoot)
      const bundles = []
      for (const [index, identity] of identities.entries()) {
        const setId = setIds[index]
        if (setId === undefined) {
          throw new Error('Runtime catalog set identity is unexpectedly missing')
        }
        bundles.push(await validateBundle(identity.generation, setId))
      }
      const generation = await stageExport(stagingRoot, bundles)
      await publishExport(generation, publicRoot, stagingRoot, () =>
        recheckActiveBundles(identities),
      )

      return {
        publicRoot,
        setCount: bundles.length,
        fileCount: bundles.length * (runtimeDataFiles.length + 1),
      }
    },
  )
}
