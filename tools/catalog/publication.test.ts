import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const renameControl = vi.hoisted(() => ({
  originalLstat: undefined as
    | ((path: string) => ReturnType<typeof import('node:fs/promises').lstat>)
    | undefined,
  lstatImplementation: undefined as
    | ((path: string) => ReturnType<typeof import('node:fs/promises').lstat>)
    | undefined,
  original: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  implementation: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  originalRmdir: undefined as
    | ((path: string) => Promise<void>)
    | undefined,
  rmdirImplementation: undefined as
    | ((path: string) => Promise<void>)
    | undefined,
  originalSymlink: undefined as
    | ((target: string, path: string) => Promise<void>)
    | undefined,
  symlinkImplementation: undefined as
    | ((target: string, path: string) => Promise<void>)
    | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  renameControl.originalLstat = (path) => original.lstat(path)
  renameControl.original = (oldPath, newPath) => original.rename(oldPath, newPath)
  renameControl.originalRmdir = (path) => original.rmdir(path)
  renameControl.originalSymlink = (target, path) =>
    original.symlink(target, path, 'dir')

  return {
    ...original,
    lstat: (path: string) =>
      renameControl.lstatImplementation?.(path) ?? original.lstat(path),
    rename: (oldPath: string, newPath: string) =>
      renameControl.implementation?.(oldPath, newPath) ??
      original.rename(oldPath, newPath),
    rmdir: (path: string) =>
      renameControl.rmdirImplementation?.(path) ?? original.rmdir(path),
    symlink: (target: string, path: string) =>
      renameControl.symlinkImplementation?.(target, path) ??
      original.symlink(target, path, 'dir'),
  }
})

import {
  publishCatalogGroup,
  stageCatalog,
  type StagedCatalog,
} from './publication.js'

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-publication-'))
  temporaryDirectories.push(directory)
  return directory
}

function bundle(setId: string, label: string): Record<string, unknown> {
  return {
    'manifest.json': { schemaVersion: 1, setId },
    'payload.json': { label },
  }
}

async function exists(path: string): Promise<boolean> {
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

async function canonicalIdentity(path: string): Promise<string> {
  const resolvedPath = resolve(path)
  return join(await realpath(dirname(resolvedPath)), basename(resolvedPath))
}

async function stagePair(
  root: string,
): Promise<[StagedCatalog, StagedCatalog]> {
  return Promise.all([
    stageCatalog(join(root, 'op17'), 'OP17', bundle('OP17', 'op17')),
    stageCatalog(join(root, 'op18'), 'OP18', bundle('OP18', 'op18')),
  ])
}

afterEach(async () => {
  renameControl.lstatImplementation = undefined
  renameControl.implementation = undefined
  renameControl.rmdirImplementation = undefined
  renameControl.symlinkImplementation = undefined
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('stageCatalog', () => {
  it('fully writes an adjacent generation without changing the output pointer', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    const staged = await stageCatalog(output, 'OP17', bundle('OP17', 'new'))

    expect(staged).toEqual({ output, setId: 'OP17', generation: staged.generation })
    expect(dirname(staged.generation)).toBe(dirname(output))
    expect(basename(staged.generation)).toMatch(/^op17\.staging-/)
    expect(await exists(output)).toBe(false)
    expect((await readdir(staged.generation)).sort()).toEqual([
      'checksums.json',
      'manifest.json',
      'payload.json',
    ])
    expect(
      JSON.parse(await readFile(join(staged.generation, 'manifest.json'), 'utf8')),
    ).toEqual({ schemaVersion: 1, setId: 'OP17' })
  })

  it('rejects unsafe outputs before creating a generation', async () => {
    for (const output of [parse(process.cwd()).root, process.cwd()]) {
      await expect(
        stageCatalog(output, 'OP17', bundle('OP17', 'unsafe')),
      ).rejects.toThrow(`Unsafe catalog output target: ${output}`)
    }
  })

  it('preserves an abandoned generation when staged ownership verification fails', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    await expect(
      stageCatalog(output, 'OP17', bundle('OP99', 'wrong set')),
    ).rejects.toThrow('abandoned staging preserved at')

    const generation = (await readdir(root)).find((entry) =>
      entry.startsWith('op17.staging-'),
    )
    expect(generation).toBeDefined()
    expect(
      JSON.parse(await readFile(join(root, generation!, 'manifest.json'), 'utf8')),
    ).toEqual({ schemaVersion: 1, setId: 'OP99' })
  })
})

describe('publishCatalogGroup', () => {
  it('serializes concurrent groups so the contending group cannot mutate', async () => {
    const root = await makeTemporaryDirectory()
    const first = await stagePair(root)
    const second = await Promise.all([
      stageCatalog(join(root, 'op17'), 'OP17', bundle('OP17', 'second op17')),
      stageCatalog(join(root, 'op18'), 'OP18', bundle('OP18', 'second op18')),
    ])
    let releaseFirst!: () => void
    const firstMayPublish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstHasLocks!: () => void
    const locksHeld = new Promise<void>((resolve) => {
      firstHasLocks = resolve
    })

    const firstPublication = publishCatalogGroup(first, {
      beforePublish: async (index) => {
        if (index === 0) {
          firstHasLocks()
          await firstMayPublish
        }
      },
    })
    await locksHeld

    await expect(publishCatalogGroup(second)).rejects.toThrow(
      'Catalog publication lock contention',
    )
    expect(await exists(first[0].output)).toBe(false)
    expect(await exists(first[1].output)).toBe(false)

    releaseFirst()
    await expect(firstPublication).resolves.toEqual(first)
    expect(await readlink(first[0].output)).toBe(basename(first[0].generation))
    expect(await readlink(first[1].output)).toBe(basename(first[1].generation))
  })

  it('publishes only after every staged bundle has been fully written', async () => {
    const root = await makeTemporaryDirectory()
    const staged = await stagePair(root)
    let hookCalls = 0

    const receipts = await publishCatalogGroup(staged, {
      beforePublish: async (index) => {
        hookCalls += 1
        if (index === 0) {
          await Promise.all(
            staged.map(async ({ output, generation }) => {
              expect(await exists(output)).toBe(false)
              expect(await exists(join(generation, 'checksums.json'))).toBe(true)
              expect(await exists(join(generation, 'manifest.json'))).toBe(true)
              expect(await exists(join(generation, 'payload.json'))).toBe(true)
            }),
          )
        }
      },
    })

    expect(hookCalls).toBe(2)
    expect(receipts).toEqual(staged)
    for (const item of staged) {
      expect(await readlink(item.output)).toBe(basename(item.generation))
    }
  })

  it('preflights the entire group before changing any output pointer', async () => {
    const root = await makeTemporaryDirectory()
    await stagePair(root)
    const existing = await stageCatalog(
      join(root, 'existing'),
      'OP17',
      bundle('OP17', 'existing'),
    )
    await publishCatalogGroup([existing])
    const originalTarget = await readlink(existing.output)
    const validExisting = await stageCatalog(
      existing.output,
      'OP17',
      bundle('OP17', 'replacement'),
    )

    const invalidOutput = join(root, 'arbitrary')
    await mkdir(invalidOutput)
    await writeFile(join(invalidOutput, 'sentinel'), 'keep me', 'utf8')
    const invalidGeneration = join(root, 'arbitrary.staging-manual')
    await mkdir(invalidGeneration)
    await writeFile(
      join(invalidGeneration, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, setId: 'OP17' }),
      'utf8',
    )

    await expect(
      publishCatalogGroup([
        validExisting,
        { output: invalidOutput, setId: 'OP17', generation: invalidGeneration },
      ]),
    ).rejects.toThrow(`Refusing to replace non-catalog directory: ${invalidOutput}`)

    expect(await readlink(existing.output)).toBe(originalTarget)
    expect(await readFile(join(invalidOutput, 'sentinel'), 'utf8')).toBe('keep me')
  })

  it.each([
    ['filesystem root', () => parse(process.cwd()).root],
    ['current working directory', () => process.cwd()],
  ])('rejects a %s output without changing earlier group items', async (_name, outputFor) => {
    const root = await makeTemporaryDirectory()
    const [first] = await stagePair(root)
    const unsafeOutput = outputFor()

    await expect(
      publishCatalogGroup([
        first,
        { ...first, output: unsafeOutput },
      ]),
    ).rejects.toThrow(`Unsafe catalog output target: ${unsafeOutput}`)

    expect(await exists(first.output)).toBe(false)
  })

  it('rejects duplicate outputs and generations before publication', async () => {
    const root = await makeTemporaryDirectory()
    const [first, second] = await stagePair(root)

    await expect(
      publishCatalogGroup([first, { ...second, output: first.output }]),
    ).rejects.toThrow(`Duplicate catalog output: ${first.output}`)
    await expect(
      publishCatalogGroup([first, { ...second, generation: first.generation }]),
    ).rejects.toThrow(`Duplicate catalog generation: ${first.generation}`)
    expect(await exists(first.output)).toBe(false)
    expect(await exists(second.output)).toBe(false)
  })

  it('rejects cross-role path overlap before changing any output pointer', async () => {
    const root = await makeTemporaryDirectory()
    const first = await stageCatalog(
      join(root, 'op17'),
      'OP17',
      bundle('OP17', 'first'),
    )
    const second = await stageCatalog(
      first.generation,
      'OP17',
      bundle('OP17', 'second'),
    )
    const originalManifest = await readFile(
      join(first.generation, 'manifest.json'),
    )

    await expect(publishCatalogGroup([first, second])).rejects.toThrow(
      `Overlapping catalog publication paths: ${await canonicalIdentity(first.generation)}`,
    )

    expect(await exists(first.output)).toBe(false)
    expect(await readFile(join(first.generation, 'manifest.json'))).toEqual(
      originalManifest,
    )
    expect(await exists(second.generation)).toBe(true)
  })

  it('rejects normalized ancestor publication paths before mutation', async () => {
    const root = await makeTemporaryDirectory()
    const first = await stageCatalog(
      join(root, 'group'),
      'OP17',
      bundle('OP17', 'parent'),
    )
    const second = await stageCatalog(
      join(root, 'alias', '..', 'group', 'child'),
      'OP18',
      bundle('OP18', 'child'),
    )
    const entriesBefore = (await readdir(join(root, 'group'))).sort()

    await expect(publishCatalogGroup([first, second])).rejects.toThrow(
      `Overlapping catalog publication paths: ${await canonicalIdentity(first.output)}`,
    )

    expect((await readdir(join(root, 'group'))).sort()).toEqual(entriesBefore)
    expect((await lstat(first.output)).isSymbolicLink()).toBe(false)
    expect(await exists(second.output)).toBe(false)
  })

  it('rejects duplicate physical outputs reached through a parent symlink', async () => {
    const root = await makeTemporaryDirectory()
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    await mkdir(real)
    await symlink(real, alias, 'dir')
    const first = await stageCatalog(
      join(real, 'op17'),
      'OP17',
      bundle('OP17', 'real'),
    )
    const second = await stageCatalog(
      join(alias, 'op17'),
      'OP17',
      bundle('OP17', 'alias'),
    )

    await expect(publishCatalogGroup([first, second])).rejects.toThrow(
      'Duplicate catalog output',
    )

    expect(await exists(first.output)).toBe(false)
    expect(
      (await readdir(real)).filter((entry) => entry.includes('.rollback-')),
    ).toEqual([])
  })

  it('rejects a mismatched generation before changing any output', async () => {
    const root = await makeTemporaryDirectory()
    const [first, second] = await stagePair(root)
    await writeFile(
      join(second.generation, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, setId: 'OP99' }),
      'utf8',
    )

    await expect(publishCatalogGroup([first, second])).rejects.toThrow(
      `Refusing to replace catalog for OP99 at ${second.generation}; expected OP18`,
    )
    expect(await exists(first.output)).toBe(false)
    expect(await exists(second.output)).toBe(false)
  })

  it('rejects an external output symlink before changing any output', async () => {
    const root = await makeTemporaryDirectory()
    const outside = await makeTemporaryDirectory()
    const [first, second] = await stagePair(root)
    const externalGeneration = await stageCatalog(
      join(outside, 'external'),
      'OP18',
      bundle('OP18', 'external'),
    )
    await symlink(resolve(externalGeneration.generation), second.output, 'dir')

    await expect(publishCatalogGroup([first, second])).rejects.toThrow(
      `Refusing catalog symlink outside adjacent generations: ${second.output}`,
    )
    expect(await exists(first.output)).toBe(false)
    expect(await readlink(second.output)).toBe(resolve(externalGeneration.generation))
  })

  it('rejects an adjacent relay symlink to an external generation', async () => {
    const root = await makeTemporaryDirectory()
    const outside = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    const staged = await stageCatalog(output, 'OP17', bundle('OP17', 'new'))
    const external = await stageCatalog(
      join(outside, 'external'),
      'OP17',
      bundle('OP17', 'external'),
    )
    const relay = `${output}.staging-relay`
    await symlink(external.generation, relay, 'dir')
    await symlink(basename(relay), output, 'dir')

    await expect(publishCatalogGroup([staged])).rejects.toThrow(
      `Refusing catalog symlink outside adjacent generations: ${output}`,
    )

    expect(await readlink(output)).toBe(basename(relay))
    expect(await readlink(relay)).toBe(external.generation)
  })

  it('publishes all pointers adjacently and preserves prior outputs as tombstones', async () => {
    const root = await makeTemporaryDirectory()
    const prior = await stagePair(root)
    await publishCatalogGroup(prior)
    const priorTargets = await Promise.all(prior.map(({ output }) => readlink(output)))
    const staged = await Promise.all([
      stageCatalog(join(root, 'op17'), 'OP17', bundle('OP17', 'new op17')),
      stageCatalog(join(root, 'op18'), 'OP18', bundle('OP18', 'new op18')),
    ])

    const receipts = await publishCatalogGroup(staged)

    for (const [index, receipt] of receipts.entries()) {
      expect(receipt.previous).toMatch(
        new RegExp(`${basename(receipt.output)}\\.tombstone-`),
      )
      expect(dirname(receipt.previous!)).toBe(dirname(receipt.output))
      expect(await readlink(receipt.output)).toBe(basename(receipt.generation))
      expect(await readlink(receipt.previous!)).toBe(priorTargets[index])
    }
  })

  it('rolls back earlier existing outputs byte-for-byte when a later hook fails', async () => {
    const root = await makeTemporaryDirectory()
    const outputs = ['op17', 'op18', 'op19'].map((name) => join(root, name))
    const prior = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'old')),
      ),
    )
    await publishCatalogGroup(prior)
    const originalTargets = await Promise.all(outputs.map((output) => readlink(output)))
    const staged = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'new')),
      ),
    )

    await expect(
      publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 2) throw new Error('injected index 2 failure')
        },
      }),
    ).rejects.toThrow('injected index 2 failure')

    await Promise.all(
      outputs.map(async (output, index) => {
        expect(await readlink(output)).toBe(originalTargets[index])
      }),
    )
  })

  it('restores the exact raw prior symlink target bytes during group rollback', async () => {
    const root = await makeTemporaryDirectory()
    const firstOutput = join(root, 'op17')
    const firstPrior = await stageCatalog(
      firstOutput,
      'OP17',
      bundle('OP17', 'old'),
    )
    const rawPriorTarget = `./${basename(firstPrior.generation)}`
    await symlink(rawPriorTarget, firstOutput, 'dir')
    const staged = await Promise.all([
      stageCatalog(firstOutput, 'OP17', bundle('OP17', 'new')),
      stageCatalog(join(root, 'op18'), 'OP18', bundle('OP18', 'new')),
    ])

    await expect(
      publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 1) throw new Error('injected later publication failure')
        },
      }),
    ).rejects.toThrow('injected later publication failure')

    expect(await readlink(firstOutput)).toBe(rawPriorTarget)
  })

  it('moves promoted new outputs to rollback artifacts and leaves active names absent', async () => {
    const root = await makeTemporaryDirectory()
    const staged = await Promise.all(
      ['op17', 'op18', 'op19'].map((name, index) =>
        stageCatalog(
          join(root, name),
          `OP${17 + index}`,
          bundle(`OP${17 + index}`, 'new'),
        ),
      ),
    )

    await expect(
      publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 2) throw new Error('injected index 2 failure')
        },
      }),
    ).rejects.toThrow('injected index 2 failure')

    for (const item of staged) {
      expect(await exists(item.output)).toBe(false)
      expect(await exists(item.generation)).toBe(true)
    }
    const entries = await readdir(root)
    const rollbacks = entries.filter((entry) => entry.includes('.rollback-'))
    expect(rollbacks).toHaveLength(2)
    expect((await Promise.all(rollbacks.map((entry) => readlink(join(root, entry))))).sort()).toEqual(
      staged.slice(0, 2).map(({ generation }) => basename(generation)).sort(),
    )
  })

  it('aggregates the publication and rollback failures with preserved paths', async () => {
    const root = await makeTemporaryDirectory()
    const outputs = [join(root, 'op17'), join(root, 'op18')]
    const prior = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'old')),
      ),
    )
    await publishCatalogGroup(prior)
    const staged = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'new')),
      ),
    )
    let preservedTombstone = ''
    let injectRollbackFailure = false
    renameControl.implementation = async (oldPath, newPath) => {
      if (oldPath === outputs[0] && basename(newPath).startsWith('op17.tombstone-')) {
        preservedTombstone = newPath
      }
      await renameControl.original!(oldPath, newPath)
    }
    renameControl.symlinkImplementation = async (target, path) => {
      if (injectRollbackFailure && path === outputs[0]) {
        injectRollbackFailure = false
        throw new Error('injected rollback rename failure')
      }
      await renameControl.originalSymlink!(target, path)
    }

    let failure: unknown
    try {
      await publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 1) {
            injectRollbackFailure = true
            throw new Error('injected publication failure')
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    const errors = (failure as AggregateError).errors as Error[]
    expect(errors).toHaveLength(2)
    expect(errors[0]!.message).toBe('injected publication failure')
    expect(errors[1]!.message).toContain('injected rollback rename failure')
    expect((errors[1]!.cause as Error).message).toBe(
      'injected rollback rename failure',
    )
    expect((failure as Error).message).toContain(outputs[0])
    expect((failure as Error).message).toContain(preservedTombstone)
    expect((failure as Error).message).toContain('.rollback-')
  })

  it('retains the publication error and continues rollback after inspection fails', async () => {
    const root = await makeTemporaryDirectory()
    const staged = await Promise.all(
      ['op17', 'op18', 'op19'].map((name, index) =>
        stageCatalog(
          join(root, name),
          `OP${17 + index}`,
          bundle(`OP${17 + index}`, 'new'),
        ),
      ),
    )
    let injectInspectionFailure = false
    renameControl.lstatImplementation = async (path) => {
      if (injectInspectionFailure && path === staged[1]!.output) {
        injectInspectionFailure = false
        throw new Error(`injected rollback inspection failure at ${path}`)
      }
      return renameControl.originalLstat!(path)
    }

    let failure: unknown
    try {
      await publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 2) {
            injectInspectionFailure = true
            throw new Error('injected publication failure')
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    const errors = (failure as AggregateError).errors as Error[]
    expect(errors[0]!.message).toBe('injected publication failure')
    expect(errors.some((error) => error.message.includes(staged[1]!.output))).toBe(
      true,
    )
    expect((failure as Error).message).toContain(
      `could not inspect output ${staged[1]!.output}`,
    )
    expect(await exists(staged[0]!.output)).toBe(false)
    expect(await exists(staged[1]!.output)).toBe(true)
    expect(
      (await readdir(root)).some((entry) => entry.startsWith('op17.rollback-')),
    ).toBe(true)
  })

  it('does not clobber a replacement that appears before prior output restoration', async () => {
    const root = await makeTemporaryDirectory()
    const outputs = [join(root, 'op17'), join(root, 'op18')]
    const prior = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'old')),
      ),
    )
    await publishCatalogGroup(prior)
    const staged = await Promise.all(
      outputs.map((output, index) =>
        stageCatalog(output, `OP${17 + index}`, bundle(`OP${17 + index}`, 'new')),
      ),
    )
    let injectReplacement = false
    renameControl.symlinkImplementation = async (target, path) => {
      if (injectReplacement && path === outputs[0]) {
        injectReplacement = false
        await mkdir(path)
        await writeFile(join(path, 'replacement.sentinel'), 'preserve me', 'utf8')
      }
      await renameControl.originalSymlink!(target, path)
    }

    let failure: unknown
    try {
      await publishCatalogGroup(staged, {
        beforePublish: async (index) => {
          if (index === 1) {
            injectReplacement = true
            throw new Error('injected publication failure')
          }
        },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'injected publication failure' }),
      ]),
    )
    expect(await readFile(join(outputs[0]!, 'replacement.sentinel'), 'utf8')).toBe(
      'preserve me',
    )
    expect((failure as Error).message).toContain(outputs[0])
    expect(
      (await readdir(root)).filter((entry) => entry.endsWith('.publication-lock')),
    ).toEqual([])
  })

  it('removes only its exact locks after successful publication', async () => {
    const root = await makeTemporaryDirectory()
    const staged = await stagePair(root)
    const unrelatedLock = join(root, 'unrelated.publication-lock')
    await mkdir(unrelatedLock)

    await publishCatalogGroup(staged)

    expect(await exists(unrelatedLock)).toBe(true)
    expect(
      (await readdir(root)).filter(
        (entry) =>
          entry.endsWith('.publication-lock') &&
          entry !== basename(unrelatedLock),
      ),
    ).toEqual([])
  })

  it('reports lock cleanup failure with the exact retained lock path', async () => {
    const root = await makeTemporaryDirectory()
    const [staged] = await stagePair(root)
    let retainedLock = ''
    renameControl.rmdirImplementation = async (path) => {
      if (path.endsWith('.publication-lock')) {
        retainedLock = path
        throw new Error(`injected lock cleanup failure at ${path}`)
      }
      await renameControl.originalRmdir!(path)
    }

    let failure: unknown
    try {
      await publishCatalogGroup([staged])
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect(retainedLock).toBe(
      `${await canonicalIdentity(staged.output)}.publication-lock`,
    )
    expect((failure as Error).message).toContain(retainedLock)
    expect(await exists(retainedLock)).toBe(true)
  })
})
