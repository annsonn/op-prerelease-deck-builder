import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CardKaizokuSnapshotRef {
  source: string
  sourceSha256: string
  cachePath: string
}

export interface LoadedSnapshot {
  source: string
  sha256: string
  bytes: Uint8Array
  value: unknown
  cachePath?: string
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseSnapshot(bytes: Uint8Array, context: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (cause) {
    throw new Error(`Invalid Card Kaizoku JSON from ${context}`, { cause })
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

class MissingCardKaizokuCacheError extends Error {}

async function cleanupVerifiedCandidate(
  candidatePath: string,
  cachePath: string,
): Promise<void> {
  try {
    await unlink(candidatePath)
  } catch (cause) {
    throw new Error(
      `Card Kaizoku cache is valid at ${cachePath}, but candidate cleanup failed for ${candidatePath}`,
      { cause },
    )
  }
}

async function readVerifiedSnapshotFile(
  path: string,
  source: string,
  expectedSha256: string,
  context: string,
): Promise<LoadedSnapshot> {
  const verified = await readVerifiedSnapshotBytes(
    path,
    expectedSha256,
    context,
  )

  return {
    source,
    sha256: verified.sha256,
    bytes: verified.bytes,
    value: parseSnapshot(verified.bytes, `${context} ${path}`),
    cachePath: path,
  }
}

async function readVerifiedSnapshotBytes(
  path: string,
  expectedSha256: string,
  context: string,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  let bytes: Uint8Array

  try {
    bytes = await readFile(path)
  } catch (cause) {
    throw new Error(`Failed to read Card Kaizoku ${context} at ${path}`, {
      cause,
    })
  }

  const actualSha256 = sha256(bytes)

  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Card Kaizoku ${context} checksum mismatch at ${path}: expected ${expectedSha256}, actual ${actualSha256}`,
    )
  }

  return { bytes, sha256: actualSha256 }
}

export async function readVerifiedCardKaizokuCache(
  ref: CardKaizokuSnapshotRef,
): Promise<LoadedSnapshot> {
  try {
    return await readVerifiedSnapshotFile(
      ref.cachePath,
      ref.source,
      ref.sourceSha256,
      'cache',
    )
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.cause !== undefined &&
      hasErrorCode(cause.cause, 'ENOENT')
    ) {
      throw new MissingCardKaizokuCacheError(
        `Card Kaizoku cache is missing at ${ref.cachePath} for source ${ref.source}; run \`npm run catalog:sync\` to download it`,
        { cause: cause.cause },
      )
    }

    throw cause
  }
}

export async function downloadCardKaizokuCandidate(
  source: string,
  fetcher: typeof fetch = fetch,
): Promise<LoadedSnapshot> {
  let response: Response

  try {
    response = await fetcher(source)
  } catch (cause) {
    throw new Error(`Failed to download Card Kaizoku source ${source}`, {
      cause,
    })
  }

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''
    throw new Error(
      `Card Kaizoku download failed: HTTP ${response.status}${statusText} from ${source}`,
    )
  }

  let bytes: Uint8Array

  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (cause) {
    throw new Error(`Failed to read Card Kaizoku response from ${source}`, {
      cause,
    })
  }

  const actualSha256 = sha256(bytes)

  return {
    source,
    sha256: actualSha256,
    bytes,
    value: parseSnapshot(bytes, `source ${source}`),
  }
}

export async function ensureCardKaizokuSnapshot(
  ref: CardKaizokuSnapshotRef,
  fetcher: typeof fetch = fetch,
): Promise<LoadedSnapshot> {
  try {
    return await readVerifiedCardKaizokuCache(ref)
  } catch (error) {
    if (!(error instanceof MissingCardKaizokuCacheError)) {
      throw error
    }
  }

  const downloaded = await downloadCardKaizokuCandidate(ref.source, fetcher)

  if (downloaded.sha256 !== ref.sourceSha256) {
    throw new Error(
      `Card Kaizoku source checksum mismatch for ${ref.source}: expected ${ref.sourceSha256}, actual ${downloaded.sha256}`,
    )
  }

  await mkdir(dirname(ref.cachePath), { recursive: true })
  const candidatePath = `${ref.cachePath}.candidate-${randomUUID()}`

  try {
    await writeFile(candidatePath, downloaded.bytes, { flag: 'wx' })
  } catch (cause) {
    throw new Error(
      `Failed to stage Card Kaizoku candidate at ${candidatePath} for cache ${ref.cachePath}`,
      { cause },
    )
  }

  try {
    await readVerifiedSnapshotBytes(
      candidatePath,
      ref.sourceSha256,
      'candidate',
    )
  } catch (cause) {
    throw new Error(
      `Failed to verify Card Kaizoku candidate ${candidatePath} for cache ${ref.cachePath}; candidate preserved at ${candidatePath}`,
      { cause },
    )
  }

  try {
    await link(candidatePath, ref.cachePath)
  } catch (cause) {
    if (hasErrorCode(cause, 'EEXIST')) {
      let winner: LoadedSnapshot

      try {
        winner = await readVerifiedCardKaizokuCache(ref)
      } catch (winnerCause) {
        throw new Error(
          `Failed to verify existing Card Kaizoku cache ${ref.cachePath} after candidate ${candidatePath} lost promotion; candidate preserved at ${candidatePath}`,
          { cause: winnerCause },
        )
      }

      await cleanupVerifiedCandidate(candidatePath, ref.cachePath)
      return winner
    }

    throw new Error(
      `Failed to promote Card Kaizoku candidate ${candidatePath} to cache ${ref.cachePath}; candidate preserved at ${candidatePath}`,
      { cause },
    )
  }

  await cleanupVerifiedCandidate(candidatePath, ref.cachePath)

  return {
    ...downloaded,
    cachePath: ref.cachePath,
  }
}
