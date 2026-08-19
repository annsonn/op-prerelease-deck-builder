import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rmdir,
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

import { writeBundleFiles } from './artifacts.js'

export interface StagedCatalog {
  output: string
  setId: string
  generation: string
}

export interface PublicationReceipt extends StagedCatalog {
  previous?: string
}

export interface PublicationHooks {
  beforePublish?: (index: number) => Promise<void>
}

interface PublicationState extends PublicationReceipt {
  hadExistingOutput: boolean
  previousCatalog?: OwnedCatalog
  previousMoved: boolean
  rollback?: string
}

type OwnedCatalog =
  | { kind: 'directory' }
  | { kind: 'symlink'; rawTarget: string }

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function assertSafePublicationTarget(output: string): void {
  const resolvedOutput = resolve(output)
  if (
    resolvedOutput === parse(resolvedOutput).root ||
    resolvedOutput === resolve(process.cwd())
  ) {
    throw new Error(`Unsafe catalog output target: ${output}`)
  }
}

async function readOwnedManifest(
  path: string,
  expectedSetId: string,
): Promise<void> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))
  } catch {
    throw new Error(`Refusing to replace non-catalog directory: ${path}`)
  }

  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    !('schemaVersion' in manifest) ||
    manifest.schemaVersion !== 1 ||
    !('setId' in manifest) ||
    typeof manifest.setId !== 'string'
  ) {
    throw new Error(`Refusing to replace non-catalog directory: ${path}`)
  }

  if (manifest.setId !== expectedSetId) {
    throw new Error(
      `Refusing to replace catalog for ${manifest.setId} at ${path}; expected ${expectedSetId}`,
    )
  }
}

async function assertCatalogOwned(
  path: string,
  expectedSetId: string,
  generationOwner = path,
): Promise<OwnedCatalog | undefined> {
  if (!(await pathExists(path))) {
    return undefined
  }

  const stats = await lstat(path)
  let manifestPath = path
  let ownership: OwnedCatalog
  if (stats.isSymbolicLink()) {
    const resolvedPath = resolve(path)
    const rawTarget = await readlink(path)
    const target = resolve(dirname(resolvedPath), rawTarget)
    const [pathParent, targetParent, owner] = await Promise.all([
      realpath(dirname(resolvedPath)),
      realpath(dirname(target)),
      canonicalPathIdentity(generationOwner),
    ])
    const targetStats = await lstat(target)
    const targetBasename = basename(target)
    if (
      targetStats.isSymbolicLink() ||
      !targetStats.isDirectory() ||
      targetParent !== pathParent ||
      (!targetBasename.startsWith(`${basename(owner)}.staging-`) &&
        !targetBasename.startsWith(`${basename(owner)}.tombstone-`))
    ) {
      throw new Error(
        `Refusing catalog symlink outside adjacent generations: ${path}`,
      )
    }
    manifestPath = target
    ownership = { kind: 'symlink', rawTarget }
  } else if (!stats.isDirectory()) {
    throw new Error(`Refusing to replace non-catalog directory: ${path}`)
  } else {
    ownership = { kind: 'directory' }
  }

  await readOwnedManifest(manifestPath, expectedSetId)
  return ownership
}

async function canonicalPathIdentity(path: string): Promise<string> {
  const resolvedPath = resolve(path)
  const canonicalParent = await realpath(dirname(resolvedPath))
  return join(canonicalParent, basename(resolvedPath))
}

function assertAdjacentGeneration({
  output,
  generation,
}: StagedCatalog): void {
  const resolvedOutput = resolve(output)
  const resolvedGeneration = resolve(generation)
  if (
    dirname(resolvedGeneration) !== dirname(resolvedOutput) ||
    !basename(resolvedGeneration).startsWith(
      `${basename(resolvedOutput)}.staging-`,
    )
  ) {
    throw new Error(
      `Catalog generation is not adjacent to its output: ${generation} for ${output}`,
    )
  }
}

async function assertStagedCatalog(staged: StagedCatalog): Promise<void> {
  assertSafePublicationTarget(staged.output)
  assertAdjacentGeneration(staged)

  if (!(await pathExists(staged.generation))) {
    throw new Error(`Catalog generation does not exist: ${staged.generation}`)
  }
  const stats = await lstat(staged.generation)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Catalog generation is not a directory: ${staged.generation}`)
  }
  await readOwnedManifest(staged.generation, staged.setId)
}

async function uniqueSibling(output: string, role: string): Promise<string> {
  // The canonical output lock is held while selecting and renaming to this
  // UUID path. Cooperating publishers therefore cannot claim the same sibling,
  // and the existence check preserves any pre-existing diagnostic artifact.
  let candidate = `${output}.${role}-${randomUUID()}`
  while (await pathExists(candidate)) {
    candidate = `${output}.${role}-${randomUUID()}`
  }
  return candidate
}

async function outputPointsToGeneration(
  output: string,
  generation: string,
): Promise<boolean> {
  if (!(await pathExists(output))) {
    return false
  }
  const stats = await lstat(output)
  if (!stats.isSymbolicLink()) {
    return false
  }
  return resolve(dirname(output), await readlink(output)) === resolve(generation)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function stageCatalog(
  output: string,
  setId: string,
  files: Record<string, unknown>,
): Promise<StagedCatalog> {
  assertSafePublicationTarget(output)
  await assertCatalogOwned(output, setId)
  await mkdir(dirname(output), { recursive: true })
  const generation = await mkdtemp(`${output}.staging-`)

  try {
    await writeBundleFiles(generation, files)
    await assertStagedCatalog({ output, setId, generation })
  } catch (error) {
    throw new Error(
      `Catalog bundle staging failed for ${output}: ${errorMessage(error)}; abandoned staging preserved at ${generation}`,
      { cause: error },
    )
  }

  return { output, setId, generation }
}

async function preflightGroup(
  staged: StagedCatalog[],
): Promise<Array<OwnedCatalog | undefined>> {
  const outputs = new Set<string>()
  const generations = new Set<string>()
  const publicationPaths: Array<{
    itemIndex: number
    role: 'output' | 'generation'
    path: string
  }> = []

  for (const [itemIndex, item] of staged.entries()) {
    assertSafePublicationTarget(item.output)
    const [output, generation] = await Promise.all([
      canonicalPathIdentity(item.output),
      canonicalPathIdentity(item.generation),
    ])
    if (outputs.has(output)) {
      throw new Error(`Duplicate catalog output: ${item.output}`)
    }
    if (generations.has(generation)) {
      throw new Error(`Duplicate catalog generation: ${item.generation}`)
    }
    outputs.add(output)
    generations.add(generation)
    publicationPaths.push(
      { itemIndex, role: 'output', path: output },
      { itemIndex, role: 'generation', path: generation },
    )
  }

  for (const [index, left] of publicationPaths.entries()) {
    for (const right of publicationPaths.slice(index + 1)) {
      const leftToRight = relative(left.path, right.path)
      const rightToLeft = relative(right.path, left.path)
      const overlaps = [leftToRight, rightToLeft].some(
        (path) =>
          path === '' ||
          (!isAbsolute(path) &&
            path !== '..' &&
            !path.startsWith(`..${sep}`)),
      )
      if (overlaps) {
        throw new Error(
          `Overlapping catalog publication paths: ${left.path} (${left.role} for item ${left.itemIndex}) and ${right.path} (${right.role} for item ${right.itemIndex})`,
        )
      }
    }
  }

  const existing: Array<OwnedCatalog | undefined> = []
  for (const item of staged) {
    await assertStagedCatalog(item)
    existing.push(await assertCatalogOwned(item.output, item.setId))
  }
  return existing
}

async function releasePublicationLocks(lockPaths: string[]): Promise<Error[]> {
  const errors: Error[] = []
  for (const lockPath of [...lockPaths].reverse()) {
    try {
      await rmdir(lockPath)
    } catch (error) {
      errors.push(
        new Error(
          `Catalog publication lock cleanup failed for ${lockPath}: ${errorMessage(error)}`,
          { cause: error },
        ),
      )
    }
  }
  return errors
}

async function acquirePublicationLocks(outputs: string[]): Promise<string[]> {
  const canonicalOutputs = await Promise.all(
    outputs.map(async (output) => {
      assertSafePublicationTarget(output)
      return canonicalPathIdentity(output)
    }),
  )
  const lockPaths = [...new Set(canonicalOutputs)]
    .map((output) => `${output}.publication-lock`)
    .sort()
  const acquired: string[] = []

  for (const lockPath of lockPaths) {
    try {
      await mkdir(lockPath)
      acquired.push(lockPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const acquisitionError = new Error(
        code === 'EEXIST'
          ? `Catalog publication lock contention at ${lockPath}`
          : `Catalog publication lock acquisition failed at ${lockPath}: ${errorMessage(error)}`,
        { cause: error },
      )
      const cleanupErrors = await releasePublicationLocks(acquired)
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [acquisitionError, ...cleanupErrors],
          `Catalog publication lock acquisition and cleanup failed: ${[acquisitionError, ...cleanupErrors].map((failure) => failure.message).join('; ')}`,
        )
      }
      throw acquisitionError
    }
  }

  return acquired
}

export async function withCatalogPublicationLocks<T>(
  outputs: string[],
  action: () => Promise<T>,
): Promise<T> {
  const lockPaths = await acquirePublicationLocks(outputs)
  let result: T | undefined
  let actionError: unknown
  let actionCompleted = false

  try {
    result = await action()
    actionCompleted = true
  } catch (error) {
    actionError = error
  }

  const cleanupErrors = await releasePublicationLocks(lockPaths)
  if (actionError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [actionError, ...cleanupErrors],
        `Catalog publication action and lock cleanup failed: ${errorMessage(actionError)}; ${cleanupErrors.map((error) => error.message).join('; ')}`,
      )
    }
    throw actionError
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Catalog publication lock cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
    )
  }
  if (!actionCompleted) {
    throw new Error('Catalog publication lock action returned no result')
  }
  return result as T
}

async function rollbackPublications(
  states: PublicationState[],
): Promise<{ errors: Error[]; details: string[] }> {
  const errors: Error[] = []
  const details: string[] = []

  for (const state of [...states].reverse()) {
    let outputExists: boolean
    let promotedOutput = false
    try {
      outputExists = await pathExists(state.output)
      if (outputExists) {
        promotedOutput = await outputPointsToGeneration(
          state.output,
          state.generation,
        )
      }
    } catch (error) {
      errors.push(
        new Error(
          `Catalog rollback could not inspect output ${state.output} for generation ${state.generation}: ${errorMessage(error)}`,
          { cause: error },
        ),
      )
      continue
    }
    let outputAvailable = !outputExists

    if (promotedOutput) {
      try {
        state.rollback = await uniqueSibling(state.output, 'rollback')
      } catch (error) {
        errors.push(
          new Error(
            `Catalog rollback could not allocate a rollback sibling for ${state.output}: ${errorMessage(error)}`,
            { cause: error },
          ),
        )
        details.push(`promoted output remains at ${state.output}`)
        if (state.previous !== undefined) {
          details.push(`previous output preserved at ${state.previous}`)
        }
        continue
      }
      try {
        await rename(state.output, state.rollback)
        outputAvailable = true
        details.push(
          `promoted output preserved at ${state.rollback} for ${state.output}`,
        )
      } catch (error) {
        errors.push(
          new Error(
            `Catalog rollback failed moving ${state.output} to ${state.rollback}: ${errorMessage(error)}`,
            { cause: error },
          ),
        )
        outputAvailable = false
        if (state.previous !== undefined) {
          details.push(`previous output preserved at ${state.previous}`)
        }
        continue
      }
    } else if (outputExists) {
      outputAvailable = false
    }

    let previousExists = false
    if (state.previous !== undefined) {
      try {
        previousExists = await pathExists(state.previous)
      } catch (error) {
        errors.push(
          new Error(
            `Catalog rollback could not inspect previous output ${state.previous} for ${state.output}: ${errorMessage(error)}`,
            { cause: error },
          ),
        )
        continue
      }
    }
    const previousNeedsRestore = state.previousMoved || previousExists

    if (previousNeedsRestore && state.previous !== undefined) {
      if (!outputAvailable) {
        errors.push(
          new Error(
            `Catalog rollback cannot restore ${state.previous} to occupied output ${state.output}`,
          ),
        )
        details.push(`previous output preserved at ${state.previous}`)
        continue
      }
      if (!previousExists) {
        errors.push(
          new Error(
            `Catalog rollback cannot find previous output ${state.previous} for ${state.output}`,
          ),
        )
        continue
      }
      if (state.previousCatalog === undefined) {
        errors.push(
          new Error(
            `Catalog rollback cannot restore ${state.previous} to ${state.output} without its prior ownership snapshot`,
          ),
        )
        details.push(`previous output preserved at ${state.previous}`)
        continue
      }
      const restoreTarget =
        state.previousCatalog.kind === 'symlink'
          ? state.previousCatalog.rawTarget
          : basename(state.previous)
      try {
        await symlink(restoreTarget, state.output, 'dir')
        await assertCatalogOwned(state.output, state.setId)
        details.push(`previous output restored at ${state.output}`)
      } catch (error) {
        errors.push(
          new Error(
            `Catalog rollback failed restoring ${state.previous} to ${state.output} without replacement: ${errorMessage(error)}`,
            { cause: error },
          ),
        )
        details.push(`previous output preserved at ${state.previous}`)
      }
    } else if (!state.hadExistingOutput && !outputAvailable) {
      details.push(`uncertain output preserved at ${state.output}`)
    }
  }

  return { errors, details }
}

function publicationFailure(
  failure: unknown,
  states: PublicationState[],
  rollbackErrors: Error[],
  rollbackDetails: string[],
): Error {
  const generations = states.map(({ generation }) => generation).join(', ')
  const originalMessage = errorMessage(failure)
  const detail = rollbackDetails.length > 0 ? `; ${rollbackDetails.join('; ')}` : ''

  if (rollbackErrors.length > 0) {
    const rollbackFailureDetail = rollbackErrors
      .map((error) => error.message)
      .join('; ')
    return new AggregateError(
      [failure, ...rollbackErrors],
      `Catalog group publication and rollback failed: ${originalMessage}; rollback failures: ${rollbackFailureDetail}; abandoned staging preserved at ${generations}${detail}`,
    )
  }

  if (states.length === 1) {
    const [state] = states
    if (state === undefined) {
      throw new Error('Catalog publication state is unexpectedly empty')
    }
    const restored = rollbackDetails.some((entry) =>
      entry.includes(`previous output restored at ${state.output}`),
    )
    const uncertain = rollbackDetails.some((entry) =>
      entry.includes(`uncertain output preserved at ${state.output}`),
    )
    if (restored) {
      return new Error(
        `Catalog publication failed for ${state.output}: ${originalMessage}; previous output restored; abandoned staging preserved at ${state.generation}${detail}`,
        { cause: failure },
      )
    }
    if (uncertain) {
      return new Error(
        `Catalog publication failed for ${state.output}: ${originalMessage}; uncertain output preserved at ${state.output}; abandoned staging preserved at ${state.generation}${detail}`,
        { cause: failure },
      )
    }
  }

  return new Error(
    `Catalog group publication failed: ${originalMessage}; rollback completed; abandoned staging preserved at ${generations}${detail}`,
    { cause: failure },
  )
}

async function publishCatalogGroupLocked(
  staged: StagedCatalog[],
  hooks?: PublicationHooks,
): Promise<PublicationReceipt[]> {
  const existing = await preflightGroup(staged)
  const states: PublicationState[] = []
  const receipts: PublicationReceipt[] = []

  try {
    for (const [index, item] of staged.entries()) {
      if (!(index in existing)) {
        throw new Error(`Missing catalog preflight result for ${item.output}`)
      }
      const previousCatalog = existing[index]
      const state: PublicationState = {
        ...item,
        hadExistingOutput: previousCatalog !== undefined,
        previousCatalog,
        previousMoved: false,
      }

      if (state.hadExistingOutput) {
        state.previous = await uniqueSibling(state.output, 'tombstone')
      }

      await hooks?.beforePublish?.(index)
      states.push(state)

      if (state.previous !== undefined) {
        await rename(state.output, state.previous)
        state.previousMoved = true
        await assertCatalogOwned(state.previous, state.setId, state.output)
      }

      await symlink(basename(state.generation), state.output, 'dir')
      await assertCatalogOwned(state.output, state.setId)

      const receipt: PublicationReceipt = {
        output: state.output,
        setId: state.setId,
        generation: state.generation,
      }
      if (state.previous !== undefined) {
        receipt.previous = state.previous
      }
      receipts.push(receipt)
    }
  } catch (failure) {
    let rollback: Awaited<ReturnType<typeof rollbackPublications>>
    try {
      rollback = await rollbackPublications(states)
    } catch (rollbackFailure) {
      const paths = states
        .flatMap(({ output, generation, previous }) => [
          output,
          generation,
          ...(previous === undefined ? [] : [previous]),
        ])
        .join(', ')
      throw new AggregateError(
        [failure, rollbackFailure],
        `Catalog group publication and rollback failed for paths ${paths}: ${errorMessage(failure)}; ${errorMessage(rollbackFailure)}`,
      )
    }
    throw publicationFailure(
      failure,
      states,
      rollback.errors,
      rollback.details,
    )
  }

  return receipts
}

export async function publishCatalogGroup(
  staged: StagedCatalog[],
  hooks?: PublicationHooks,
): Promise<PublicationReceipt[]> {
  return withCatalogPublicationLocks(
    staged.map(({ output }) => output),
    () => publishCatalogGroupLocked(staged, hooks),
  )
}
