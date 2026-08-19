import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, sortObjectKeys(child)]),
    )
  }

  return value
}

export function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(sortObjectKeys(value), null, 2)

  if (serialized === undefined) {
    throw new TypeError('Value cannot be serialized as JSON')
  }

  return `${serialized}\n`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function writeJson(path: string, value: unknown): Promise<string> {
  const content = stableStringify(value)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')

  return sha256(content)
}

export async function writeBundleFiles(
  root: string,
  files: Record<string, unknown>,
): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {}

  for (const filename of Object.keys(files).sort(compareCodeUnits)) {
    if (filename === 'checksums.json') {
      continue
    }

    checksums[filename] = await writeJson(join(root, filename), files[filename])
  }

  await writeJson(join(root, 'checksums.json'), checksums)

  return checksums
}
