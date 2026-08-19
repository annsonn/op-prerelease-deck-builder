import { createHash } from 'node:crypto'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const fileSystemControl = vi.hoisted(() => ({
  linkImplementation: undefined as
    | ((existingPath: string, newPath: string) => Promise<void>)
    | undefined,
  originalLink: undefined as
    | ((existingPath: string, newPath: string) => Promise<void>)
    | undefined,
  originalWriteFile: undefined as
    | ((
        path: string,
        data: Uint8Array,
        options?: { flag?: string },
      ) => Promise<void>)
    | undefined,
  writeFileImplementation: undefined as
    | ((
        path: string,
        data: Uint8Array,
        options?: { flag?: string },
      ) => Promise<void>)
    | undefined,
  unlinkImplementation: undefined as
    | ((path: string) => Promise<void>)
    | undefined,
  unlinkCalls: [] as string[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  fileSystemControl.originalLink = (existingPath, newPath) =>
    original.link(existingPath, newPath)
  fileSystemControl.originalWriteFile = (path, data, options) =>
    original.writeFile(path, data, options)

  return {
    ...original,
    link: (existingPath: string, newPath: string) =>
      fileSystemControl.linkImplementation?.(existingPath, newPath) ??
      original.link(existingPath, newPath),
    writeFile: (
      path: string,
      data: Uint8Array,
      options?: { flag?: string },
    ) =>
      fileSystemControl.writeFileImplementation?.(path, data, options) ??
      original.writeFile(path, data, options),
    unlink: (path: string) => {
      fileSystemControl.unlinkCalls.push(path)
      return (
        fileSystemControl.unlinkImplementation?.(path) ?? original.unlink(path)
      )
    },
  }
})

import {
  downloadCardKaizokuCandidate,
  ensureCardKaizokuSnapshot,
  readVerifiedCardKaizokuCache,
  type CardKaizokuSnapshotRef,
} from './cardkaizoku-snapshot.js'

const temporaryDirectories: string[] = []

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function makeRef(
  bytes: Uint8Array,
): Promise<CardKaizokuSnapshotRef> {
  const root = await makeTemporaryDirectory()

  return {
    source: 'https://cdn.example.test/cards.json',
    sourceSha256: digest(bytes),
    cachePath: join(root, 'cache', 'cards.json'),
  }
}

async function makeTemporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cardkaizoku-snapshot-'))
  temporaryDirectories.push(root)
  return root
}

function successfulResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 })
}

afterEach(async () => {
  fileSystemControl.linkImplementation = undefined
  fileSystemControl.unlinkImplementation = undefined
  fileSystemControl.unlinkCalls = []
  fileSystemControl.writeFileImplementation = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('ensureCardKaizokuSnapshot', () => {
  it('returns a matching existing cache without fetching', async () => {
    const value = { cards: [{ id: 'OP01-001' }] }
    const bytes = jsonBytes(value)
    const ref = await makeRef(bytes)
    await mkdir(dirname(ref.cachePath), { recursive: true })
    await writeFile(ref.cachePath, bytes)
    const fetcher = vi.fn<typeof fetch>()

    const loaded = await ensureCardKaizokuSnapshot(ref, fetcher)

    expect(fetcher).not.toHaveBeenCalled()
    expect(loaded).toMatchObject({
      source: ref.source,
      sha256: ref.sourceSha256,
      value,
      cachePath: ref.cachePath,
    })
    expect([...loaded.bytes]).toEqual([...bytes])
  })

  it('rejects a mismatched existing cache without fetching or overwriting it', async () => {
    const expectedBytes = jsonBytes({ cards: ['expected'] })
    const existingBytes = jsonBytes({ cards: ['unrelated'] })
    const ref = await makeRef(expectedBytes)
    await mkdir(dirname(ref.cachePath), { recursive: true })
    await writeFile(ref.cachePath, existingBytes)
    const fetcher = vi.fn<typeof fetch>()

    await expect(ensureCardKaizokuSnapshot(ref, fetcher)).rejects.toThrow(
      `Card Kaizoku cache checksum mismatch at ${ref.cachePath}: expected ${ref.sourceSha256}, actual ${digest(existingBytes)}`,
    )

    expect(fetcher).not.toHaveBeenCalled()
    expect(await readFile(ref.cachePath)).toEqual(Buffer.from(existingBytes))
  })

  it('downloads a missing cache once, verifies and caches it, then returns it', async () => {
    const value = { cards: [{ id: 'OP02-001' }] }
    const bytes = jsonBytes(value)
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))
    const parse = vi.spyOn(JSON, 'parse')

    const loaded = await ensureCardKaizokuSnapshot(ref, fetcher)

    const decodedPayload = new TextDecoder().decode(bytes)
    expect(
      parse.mock.calls.filter(([input]) => input === decodedPayload),
    ).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(ref.source)
    expect(await readFile(ref.cachePath)).toEqual(Buffer.from(bytes))
    expect(
      (await readdir(dirname(ref.cachePath))).filter((path) =>
        path.startsWith('cards.json.candidate-'),
      ),
    ).toEqual([])
    expect(loaded).toMatchObject({
      source: ref.source,
      sha256: ref.sourceSha256,
      value,
      cachePath: ref.cachePath,
    })
    expect([...loaded.bytes]).toEqual([...bytes])
  })

  it('rejects a non-success response without creating the final cache', async () => {
    const bytes = jsonBytes({ cards: [] })
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('unavailable', { status: 503, statusText: 'Unavailable' }),
    )

    await expect(ensureCardKaizokuSnapshot(ref, fetcher)).rejects.toThrow(
      /503.*Unavailable.*https:\/\/cdn\.example\.test\/cards\.json/,
    )
    await expect(access(ref.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a downloaded checksum mismatch without creating the final cache', async () => {
    const expectedBytes = jsonBytes({ cards: ['expected'] })
    const downloadedBytes = jsonBytes({ cards: ['downloaded'] })
    const ref = await makeRef(expectedBytes)
    const fetcher = vi.fn<typeof fetch>(async () =>
      successfulResponse(downloadedBytes),
    )

    await expect(ensureCardKaizokuSnapshot(ref, fetcher)).rejects.toThrow(
      `expected ${ref.sourceSha256}, actual ${digest(downloadedBytes)}`,
    )
    await expect(access(ref.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('concurrent calls converge on one verified final cache', async () => {
    const value = { cards: [{ id: 'OP03-001' }] }
    const bytes = jsonBytes(value)
    const ref = await makeRef(bytes)
    let fetchCalls = 0
    let releaseDownloads = (): void => undefined
    const bothDownloadsStarted = new Promise<void>((resolve) => {
      releaseDownloads = resolve
    })
    const fetcher = vi.fn<typeof fetch>(async () => {
      fetchCalls += 1
      if (fetchCalls === 2) {
        releaseDownloads()
      }
      await bothDownloadsStarted
      return successfulResponse(bytes)
    })

    const loaded = await Promise.all([
      ensureCardKaizokuSnapshot(ref, fetcher),
      ensureCardKaizokuSnapshot(ref, fetcher),
    ])

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(ref.cachePath)).toEqual(Buffer.from(bytes))
    const candidates = (await readdir(dirname(ref.cachePath))).filter((path) =>
      path.startsWith('cards.json.candidate-'),
    )
    expect(candidates).toEqual([])
    expect(fileSystemControl.unlinkCalls).toHaveLength(2)
    expect(new Set(fileSystemControl.unlinkCalls).size).toBe(2)
    for (const candidatePath of fileSystemControl.unlinkCalls) {
      expect(candidatePath.startsWith(`${ref.cachePath}.candidate-`)).toBe(true)
    }
    expect(loaded).toHaveLength(2)
    for (const snapshot of loaded) {
      expect(snapshot).toMatchObject({
        source: ref.source,
        sha256: ref.sourceSha256,
        value,
        cachePath: ref.cachePath,
      })
      expect([...snapshot.bytes]).toEqual([...bytes])
    }
  })

  it('reports invalid downloaded JSON with source context and creates no final cache', async () => {
    const bytes = new TextEncoder().encode('{not json')
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))

    await expect(ensureCardKaizokuSnapshot(ref, fetcher)).rejects.toThrow(
      `Invalid Card Kaizoku JSON from source ${ref.source}`,
    )
    await expect(access(ref.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves and identifies a candidate that fails reread verification', async () => {
    const bytes = jsonBytes({ cards: [{ id: 'OP05-001' }] })
    const corruptedBytes = jsonBytes({ cards: ['corrupted after staging'] })
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))
    fileSystemControl.writeFileImplementation = async (path, data, options) => {
      await fileSystemControl.originalWriteFile!(path, data, options)
      if (path.startsWith(`${ref.cachePath}.candidate-`)) {
        await fileSystemControl.originalWriteFile!(path, corruptedBytes)
      }
    }

    let failure: Error | undefined
    try {
      await ensureCardKaizokuSnapshot(ref, fetcher)
    } catch (error) {
      failure = error as Error
    }

    const candidates = (await readdir(dirname(ref.cachePath))).filter((path) =>
      path.startsWith('cards.json.candidate-'),
    )
    expect(candidates).toHaveLength(1)
    const candidatePath = join(dirname(ref.cachePath), candidates[0]!)
    expect(await readFile(candidatePath)).toEqual(Buffer.from(corruptedBytes))
    expect(failure?.message).toContain(candidatePath)
    expect(failure?.message).toContain(ref.cachePath)
    expect(failure?.message).toContain(`candidate preserved at ${candidatePath}`)
    await expect(access(ref.cachePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves its candidate and does not clobber an invalid EEXIST winner', async () => {
    const bytes = jsonBytes({ cards: [{ id: 'OP06-001' }] })
    const winnerBytes = jsonBytes({ cards: ['unrelated winner'] })
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))
    let candidatePath: string | undefined
    fileSystemControl.linkImplementation = async (existingPath, newPath) => {
      candidatePath = existingPath
      await fileSystemControl.originalWriteFile!(newPath, winnerBytes, {
        flag: 'wx',
      })
      await fileSystemControl.originalLink!(existingPath, newPath)
    }

    let failure: Error | undefined
    try {
      await ensureCardKaizokuSnapshot(ref, fetcher)
    } catch (error) {
      failure = error as Error
    }

    expect(candidatePath).toBeDefined()
    expect(await readFile(ref.cachePath)).toEqual(Buffer.from(winnerBytes))
    expect(await readFile(candidatePath!)).toEqual(Buffer.from(bytes))
    expect(failure?.message).toContain(candidatePath!)
    expect(failure?.message).toContain(ref.cachePath)
    expect(failure?.message).toContain(`candidate preserved at ${candidatePath}`)
    expect(fileSystemControl.unlinkCalls).toEqual([])
  })

  it('reports candidate cleanup failure without touching the valid cache', async () => {
    const bytes = jsonBytes({ cards: [{ id: 'OP07-001' }] })
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))
    const cleanupCause = Object.assign(new Error('injected cleanup failure'), {
      code: 'EACCES',
    })
    let candidatePath: string | undefined
    fileSystemControl.unlinkImplementation = async (path) => {
      candidatePath = path
      throw cleanupCause
    }

    let failure: Error | undefined
    try {
      await ensureCardKaizokuSnapshot(ref, fetcher)
    } catch (error) {
      failure = error as Error
    }

    expect(candidatePath).toBeDefined()
    expect(await readFile(ref.cachePath)).toEqual(Buffer.from(bytes))
    expect(await readFile(candidatePath!)).toEqual(Buffer.from(bytes))
    expect(failure?.message).toContain(candidatePath!)
    expect(failure?.message).toContain(ref.cachePath)
    expect(failure?.message).toContain('cache is valid')
    expect(failure?.message).toContain('candidate cleanup failed')
    expect(failure?.cause).toBe(cleanupCause)
  })
})

describe('readVerifiedCardKaizokuCache', () => {
  it('never fetches and tells the user how to create a missing cache', async () => {
    const bytes = jsonBytes({ cards: [] })
    const ref = await makeRef(bytes)
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)

    await expect(readVerifiedCardKaizokuCache(ref)).rejects.toThrow(
      new RegExp(`${ref.cachePath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*npm run catalog:sync`),
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports invalid cached JSON with cache-path context', async () => {
    const bytes = new TextEncoder().encode('{not json')
    const ref = await makeRef(bytes)
    await mkdir(dirname(ref.cachePath), { recursive: true })
    await writeFile(ref.cachePath, bytes)

    await expect(readVerifiedCardKaizokuCache(ref)).rejects.toThrow(
      `Invalid Card Kaizoku JSON from cache ${ref.cachePath}`,
    )
  })
})

describe('downloadCardKaizokuCandidate', () => {
  it('returns the computed checksum, value and bytes without writing a cache', async () => {
    const root = await makeTemporaryDirectory()
    const source = pathToFileURL(join(root, 'candidate.json')).href
    const value = { cards: [{ id: 'OP04-001' }] }
    const bytes = jsonBytes(value)
    const fetcher = vi.fn<typeof fetch>(async () => successfulResponse(bytes))

    const loaded = await downloadCardKaizokuCandidate(source, fetcher)

    expect(fetcher).toHaveBeenCalledExactlyOnceWith(source)
    expect(loaded).toEqual({
      source,
      sha256: digest(bytes),
      bytes,
      value,
    })
    expect(await readdir(root)).toEqual([])
  })
})
