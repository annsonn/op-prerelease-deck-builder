import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const renameControl = vi.hoisted(() => ({
  original: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  implementation: undefined as
    | ((oldPath: string, newPath: string) => Promise<void>)
    | undefined,
  rmCalls: [] as Array<{ path: string; options?: unknown }>,
  originalRm: undefined as
    | ((path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>)
    | undefined,
  symlinkImplementation: undefined as
    | ((target: string, path: string) => Promise<void>)
    | undefined,
  originalSymlink: undefined as
    | ((target: string, path: string) => Promise<void>)
    | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  renameControl.original = (oldPath, newPath) => original.rename(oldPath, newPath)
  renameControl.originalRm = (path, options) => original.rm(path, options)
  renameControl.originalSymlink = (target, path) =>
    original.symlink(target, path, 'dir')

  return {
    ...original,
    rename: (oldPath: string, newPath: string) =>
      renameControl.implementation?.(oldPath, newPath) ??
      original.rename(oldPath, newPath),
    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => {
      renameControl.rmCalls.push({ path, options })
      return original.rm(path, options)
    },
    symlink: (target: string, path: string) =>
      renameControl.symlinkImplementation?.(target, path) ??
      original.symlink(target, path, 'dir'),
  }
})

import type { SourceConfig } from './model.js'
import { buildCatalog } from './pipeline.js'

const fixturePath = fileURLToPath(
  new URL('./__fixtures__/op17-input.json', import.meta.url),
)
const temporaryDirectories: string[] = []

function localConfig(): SourceConfig {
  return {
    sourceType: 'local-json',
    source: fixturePath,
    targetSet: 'op17',
    expectedFirst: 5,
    expectedLast: 5,
  }
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-race-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  renameControl.implementation = undefined
  renameControl.symlinkImplementation = undefined
  renameControl.rmCalls = []
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('catalog publication race safety', () => {
  it('restores the original output and preserves an unrelated swap', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    await buildCatalog({ setId: 'op17', output, config: localConfig() })

    const displacedOwnedOutput = join(root, `displaced-${randomUUID()}`)
    renameControl.implementation = async (oldPath, newPath) => {
      if (oldPath === output && basename(newPath).startsWith('op17.tombstone-')) {
        await renameControl.original!(output, displacedOwnedOutput)
        await mkdir(output)
        await writeFile(join(output, 'unrelated.sentinel'), 'keep me', 'utf8')
      }
      await renameControl.original!(oldPath, newPath)
    }

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow('previous output restored; abandoned staging preserved at')

    expect(
      JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
    const tombstone = (await readdir(root)).find((entry) =>
      entry.startsWith('op17.tombstone-'),
    )
    expect(tombstone).toBeDefined()
    expect(await readFile(join(root, tombstone!, 'unrelated.sentinel'), 'utf8')).toBe(
      'keep me',
    )
  })

  it('preserves a replacement staging directory after promotion failure', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    renameControl.symlinkImplementation = async (target) => {
      const staging = join(root, target)
      await renameControl.originalRm!(staging, { recursive: true })
      await mkdir(staging)
      await writeFile(join(staging, 'unrelated.sentinel'), 'keep me', 'utf8')
      throw new Error('injected promotion failure')
    }

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow(`abandoned staging preserved at`)

    const staging = (await readdir(root)).find((name) =>
      name.startsWith('op17.staging-'),
    )
    expect(staging).toBeDefined()
    expect(
      await readFile(join(root, staging!, 'unrelated.sentinel'), 'utf8'),
    ).toBe('keep me')
  })

  it('restores an owned output when promotion fails', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    await buildCatalog({ setId: 'op17', output, config: localConfig() })
    const originalManifest = await readFile(join(output, 'manifest.json'))

    let injectPromotionFailure = true
    renameControl.symlinkImplementation = async (target, path) => {
      if (injectPromotionFailure) {
        injectPromotionFailure = false
        throw new Error('injected promotion failure')
      }
      await renameControl.originalSymlink!(target, path)
    }

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow('abandoned staging preserved at')

    expect(await readFile(join(output, 'manifest.json'))).toEqual(
      originalManifest,
    )
    expect((await readdir(root)).some((name) => name.startsWith('op17.staging-'))).toBe(
      true,
    )
  })

  it('preserves the owned backup when promotion and rollback both fail', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    await buildCatalog({ setId: 'op17', output, config: localConfig() })

    renameControl.symlinkImplementation = async () => {
      throw new Error('injected promotion failure')
    }
    renameControl.implementation = async (oldPath, newPath) => {
      if (basename(oldPath).startsWith('op17.tombstone-') && newPath === output) {
        throw new Error('injected rollback failure')
      }
      await renameControl.original!(oldPath, newPath)
    }

    let failure: Error | undefined
    try {
      await buildCatalog({ setId: 'op17', output, config: localConfig() })
    } catch (error) {
      failure = error as Error
    }

    const backup = (await readdir(root)).find((name) =>
      name.startsWith('op17.tombstone-'),
    )
    expect(backup).toBeDefined()
    expect(
      JSON.parse(await readFile(join(root, backup!, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
    expect((await readdir(root)).some((name) => name.startsWith('op17.staging-'))).toBe(
      true,
    )
    const stagingPaths = (await readdir(root))
      .filter((name) => name.startsWith('op17.staging-'))
      .map((name) => join(root, name))
    expect(failure?.message).toContain(join(root, backup!))
    expect(stagingPaths.some((path) => failure?.message.includes(path))).toBe(true)
  })

  it('moves a newly promoted output aside after verification fails', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    renameControl.symlinkImplementation = async (target, path) => {
      await renameControl.originalSymlink!(target, path)
      await writeFile(join(output, 'manifest.json'), '{invalid json', 'utf8')
    }

    let failure: Error | undefined
    try {
      await buildCatalog({ setId: 'op17', output, config: localConfig() })
    } catch (error) {
      failure = error as Error
    }

    await expect(readFile(join(output, 'manifest.json'), 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    const staging = (await readdir(root)).find((name) =>
      name.startsWith('op17.staging-'),
    )
    const rollback = (await readdir(root)).find((name) =>
      name.startsWith('op17.rollback-'),
    )
    expect(rollback).toBeDefined()
    expect(await readFile(join(root, rollback!, 'manifest.json'), 'utf8')).toBe(
      '{invalid json',
    )
    expect(failure?.message).toContain(join(root, rollback!))
    expect(failure?.message).toContain(join(root, staging!))
  })

  it('preserves every directory when an unrelated staging replacement is published', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    await buildCatalog({ setId: 'op17', output, config: localConfig() })
    const displacedStaging = join(root, `displaced-staging-${randomUUID()}`)

    let replacePublishedStaging = true
    renameControl.symlinkImplementation = async (target, path) => {
      if (replacePublishedStaging) {
        replacePublishedStaging = false
        const staging = join(root, target)
        await renameControl.original!(staging, displacedStaging)
        await mkdir(staging)
        await writeFile(join(staging, 'unrelated.sentinel'), 'keep me', 'utf8')
      }
      await renameControl.originalSymlink!(target, path)
    }

    await expect(
      buildCatalog({ setId: 'op17', output, config: localConfig() }),
    ).rejects.toThrow('previous output restored; abandoned staging preserved at')

    expect(
      JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
    expect(
      JSON.parse(await readFile(join(displacedStaging, 'manifest.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, setId: 'OP17' })
    const rollback = (await readdir(root)).find((name) =>
      name.startsWith('op17.rollback-'),
    )
    expect(rollback).toBeDefined()
    expect(await readFile(join(root, rollback!, 'unrelated.sentinel'), 'utf8')).toBe(
      'keep me',
    )
  })

  it('does not replace a destination that appears at the publication boundary', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')

    renameControl.symlinkImplementation = async (target, path) => {
      await mkdir(path)
      await writeFile(join(path, 'unrelated.sentinel'), 'keep me', 'utf8')
      await renameControl.originalSymlink!(target, path)
    }

    let failure: Error | undefined
    try {
      await buildCatalog({ setId: 'op17', output, config: localConfig() })
    } catch (error) {
      failure = error as Error
    }

    expect(await readFile(join(output, 'unrelated.sentinel'), 'utf8')).toBe(
      'keep me',
    )
    const staging = (await readdir(root)).find((name) =>
      name.startsWith('op17.staging-'),
    )
    expect(failure?.message).toContain(
      `uncertain output preserved at ${output}`,
    )
    expect(failure?.message).toContain(join(root, staging!))
  })

  it('never requests recursive removal during publication', async () => {
    const root = await makeTemporaryDirectory()
    const output = join(root, 'op17')
    await buildCatalog({ setId: 'op17', output, config: localConfig() })

    renameControl.rmCalls = []
    await buildCatalog({ setId: 'op17', output, config: localConfig() })
    await expect(
      buildCatalog({
        setId: 'op17',
        output: join(root, 'invalid-op17'),
        config: { ...localConfig(), expectedFirst: 4 },
      }),
    ).rejects.toThrow('Catalog validation failed:')

    expect(renameControl.rmCalls).toEqual([])
  })
})
