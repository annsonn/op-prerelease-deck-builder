import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { reportFailure } from './cli.js'
import { exportRuntimeCatalogs } from './runtime-export.js'
import {
  syncCatalogs,
  validateSourceOverride,
  type SyncCatalogsResult,
} from './sync.js'

const usage =
  'Usage: npm run catalog:sync [-- --source <versioned-json-url>]'

export function parseSyncArguments(
  argv: string[],
): { sourceOverride?: string } {
  if (argv.length === 0) return {}
  if (argv.length !== 2 || argv[0] !== '--source' || argv[1] === undefined) {
    throw new Error(usage)
  }

  try {
    validateSourceOverride(argv[1])
  } catch {
    throw new Error(usage)
  }

  return { sourceOverride: argv[1] }
}

export async function runSyncCommand(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const { sourceOverride } = parseSyncArguments(argv)
  const configPath = resolve('catalog-sources.json')
  const configValue: unknown = JSON.parse(await readFile(configPath, 'utf8'))
  const bundleRoot = resolve('tmp/catalog/bundles')
  const result = await syncCatalogs({
    configValue,
    outputRoot: bundleRoot,
    ...(sourceOverride === undefined ? {} : { sourceOverride }),
  })
  if (result.mode === 'published') {
    await exportRuntimeCatalogs({
      bundleRoot,
      publicRoot: resolve('public/catalogs'),
      stagingRoot: resolve('tmp/catalog/staging'),
    })
  }

  process.stdout.write(formatSyncResult(result))
}

export function formatSyncResult(result: SyncCatalogsResult): string {
  const lines = [
    `Mode: ${result.mode}`,
    `Source: ${result.source}`,
    `Checksum: ${result.sourceSha256}`,
    `Report: ${result.reportPath ?? 'none'}`,
    ...result.catalogs.map(
      (catalog) =>
        `${catalog.setId}: records=${catalog.variantCount} cards=${catalog.cardCount} specialReprints=${catalog.specialReprintCount} readiness=${catalog.readiness} ${
          result.mode === 'published'
            ? `output=${catalog.output}`
            : `comparisonPath=${catalog.output} status=not-published`
        }`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

const entryPath = process.argv[1]
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  void runSyncCommand().catch(reportFailure)
}
