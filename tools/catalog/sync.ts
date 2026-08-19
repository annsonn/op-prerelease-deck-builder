import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

import { catalogManifestSchema } from '../../shared/catalog.js'

import { adaptCardKaizokuRows } from './adapters/cardkaizoku.js'
import { stableStringify, sha256 } from './artifacts.js'
import {
  downloadCardKaizokuCandidate,
  ensureCardKaizokuSnapshot,
  readVerifiedCardKaizokuCache,
} from './cardkaizoku-snapshot.js'
import { diffCatalogs } from './catalog-diff.js'
import { loadSetConfigFromValue } from './config.js'
import {
  playableCardSchema,
  sourceConfigFileSchema,
  type PlayableCard,
  type SourceConfig,
} from './model.js'
import type { BuildCatalogResult } from './pipeline.js'
import { prepareCatalog, type PreparedCatalog } from './prepare.js'
import {
  publishCatalogGroup,
  stageCatalog,
  type StagedCatalog,
} from './publication.js'

const supportedSetIds = Array.from(
  { length: 17 },
  (_, index) => `op${String(index + 1).padStart(2, '0')}`,
)

interface BaselineProvenance {
  kind: 'published' | 'configured-cache'
  source: string
  sourceSha256: string | null
}

interface PublishedBaseline {
  cards: PlayableCard[]
  provenance: BaselineProvenance
}

export interface SyncCatalogsOptions {
  configValue: unknown
  outputRoot: string
  sourceOverride?: string
  fetcher?: typeof fetch
}

export interface SyncCatalogsResult {
  mode: 'published' | 'candidate-report'
  source: string
  sourceSha256: string
  reportPath?: string
  catalogs: BuildCatalogResult[]
}

export async function syncCatalogs(
  options: SyncCatalogsOptions,
): Promise<SyncCatalogsResult> {
  const configs = loadSyncConfigs(options.configValue)
  const [firstConfig] = configs
  if (firstConfig === undefined) {
    throw new Error('Catalog sync configuration is unexpectedly empty')
  }

  if (options.sourceOverride !== undefined) {
    return syncCandidate(options, configs, firstConfig)
  }

  const snapshot = await ensureCardKaizokuSnapshot(
    {
      source: firstConfig.source,
      sourceSha256: firstConfig.sourceSha256,
      cachePath: firstConfig.cachePath,
    },
    options.fetcher,
  )
  const outputRoot = resolve(options.outputRoot)
  const prepared = configs.map((config) =>
    prepareCatalog(
      adaptCardKaizokuRows(snapshot.value, config.targetSet),
      config,
    ),
  )
  const staged = []
  for (const catalog of prepared) {
    staged.push(
      await stageCatalog(
        resolve(outputRoot, catalog.setId.toLowerCase()),
        catalog.setId,
        catalog.bundle,
      ),
    )
  }

  if (prepared.some(({ validation }) => validation.errors.length > 0)) {
    const reportPath = await writeGroupFailureReport(
      outputRoot,
      snapshot.source,
      snapshot.sha256,
      prepared,
      staged,
    )
    throw new Error(
      `Catalog group validation failed; no catalogs published; report: ${reportPath}`,
    )
  }

  await publishCatalogGroup(staged)

  return {
    mode: 'published',
    source: snapshot.source,
    sourceSha256: snapshot.sha256,
    catalogs: prepared.map((catalog) => ({
      ...catalog.result,
      output: resolve(outputRoot, catalog.setId.toLowerCase()),
    })),
  }
}

function loadSyncConfigs(
  configValue: unknown,
): Array<Extract<SourceConfig, { sourceType: 'cardkaizoku-json' }>> {
  const parsed = sourceConfigFileSchema.parse(configValue)
  const configuredSetIds = Object.keys(parsed.sets).sort()
  if (
    configuredSetIds.length !== supportedSetIds.length ||
    configuredSetIds.some((setId, index) => setId !== supportedSetIds[index])
  ) {
    throw new Error(
      `Catalog sync requires exactly ${supportedSetIds.join(', ')}; configured: ${configuredSetIds.join(', ')}`,
    )
  }

  const configs = supportedSetIds.map((setId) => {
    const config = loadSetConfigFromValue(parsed, setId)
    if (config.targetSet !== setId) {
      throw new Error(
        `Catalog sync requires ${setId} to target itself, not ${config.targetSet}`,
      )
    }
    return config
  })
  const [firstConfig] = configs
  if (firstConfig === undefined || firstConfig.sourceType !== 'cardkaizoku-json') {
    throw new Error('Catalog sync requires Card Kaizoku configuration for every set')
  }
  return configs.map((config) => {
    assertSharedCardKaizokuConfig(config, firstConfig)
    return config
  })
}

function assertSharedCardKaizokuConfig(
  config: SourceConfig,
  expected: Extract<SourceConfig, { sourceType: 'cardkaizoku-json' }>,
): asserts config is Extract<SourceConfig, { sourceType: 'cardkaizoku-json' }> {
  if (config.sourceType !== 'cardkaizoku-json') {
    throw new Error(
      `Catalog sync requires Card Kaizoku configuration for ${config.targetSet}`,
    )
  }
  if (
    config.source !== expected.source ||
    config.sourceSha256 !== expected.sourceSha256 ||
    config.cachePath !== expected.cachePath
  ) {
    throw new Error(
      `Catalog sync requires every set to share one Card Kaizoku snapshot`,
    )
  }
}

function catalogResults(
  prepared: PreparedCatalog[],
  outputRoot: string,
): BuildCatalogResult[] {
  return prepared.map((catalog) => ({
    ...catalog.result,
    output: resolve(outputRoot, catalog.setId.toLowerCase()),
  }))
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

async function writeImmutableReport(
  path: string,
  value: unknown,
): Promise<string> {
  const content = stableStringify(value)
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw new Error(`Failed to write catalog report ${path}`, { cause: error })
    }
    let existing: string
    try {
      existing = await readFile(path, 'utf8')
    } catch (readError) {
      throw new Error(`Catalog report exists but cannot be verified at ${path}`, {
        cause: readError,
      })
    }
    if (existing !== content) {
      throw new Error(
        `Refusing to overwrite a different catalog report at ${path}; existing report preserved`,
      )
    }
  }
  return path
}

async function writeGroupFailureReport(
  outputRoot: string,
  source: string,
  sourceSha256: string,
  prepared: PreparedCatalog[],
  staged: StagedCatalog[],
): Promise<string> {
  const report = {
    schemaVersion: 1,
    kind: 'catalog-sync-failure',
    source,
    sourceSha256,
    catalogs: prepared.map((catalog, index) => ({
      ...catalog.result,
      errors: catalog.validation.errors,
      warnings: catalog.validation.warnings,
      output: staged[index]?.output,
      stagedGeneration: staged[index]?.generation,
    })),
  }
  const contentHash = sha256(stableStringify(report)).slice(0, 16)
  const reportPath = join(
    dirname(outputRoot),
    'reports',
    `sync-failed-${sourceSha256}-${contentHash}.json`,
  )
  return writeImmutableReport(reportPath, report)
}

export function validateSourceOverride(sourceOverride: string): string {
  let url: URL
  try {
    url = new URL(sourceOverride)
  } catch (cause) {
    throw new Error(`Invalid Card Kaizoku candidate URL: ${sourceOverride}`, {
      cause,
    })
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Invalid Card Kaizoku candidate URL: ${sourceOverride}`)
  }
  return url.href
}

async function readPublishedBaseline(
  output: string,
  expectedSetId: string,
): Promise<PublishedBaseline | undefined> {
  try {
    await lstat(output)
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return undefined
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: failed to inspect ${output}`,
      { cause },
    )
  }

  const manifestPath = join(output, 'manifest.json')
  const cardsPath = join(output, 'cards.json')
  const [manifestRead, cardsRead] = await Promise.allSettled([
    readFile(manifestPath, 'utf8'),
    readFile(cardsPath, 'utf8'),
  ])
  if (manifestRead.status === 'rejected') {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: failed to read ${manifestPath}`,
      { cause: manifestRead.reason },
    )
  }
  if (cardsRead.status === 'rejected') {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: failed to read ${cardsPath}`,
      { cause: cardsRead.reason },
    )
  }

  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifestRead.value) as unknown
  } catch (cause) {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: malformed JSON in ${manifestPath}`,
      { cause },
    )
  }
  const manifest = catalogManifestSchema.safeParse(manifestValue)
  if (!manifest.success) {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: manifest schema invalid in ${manifestPath}: ${z.prettifyError(manifest.error)}`,
      { cause: manifest.error },
    )
  }
  if (manifest.data.setId !== expectedSetId) {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: manifest setId ${manifest.data.setId} does not match ${expectedSetId}`,
    )
  }

  let cardsValue: unknown
  try {
    cardsValue = JSON.parse(cardsRead.value) as unknown
  } catch (cause) {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: malformed JSON in ${cardsPath}`,
      { cause },
    )
  }
  const cards = z.array(playableCardSchema).safeParse(cardsValue)
  if (!cards.success) {
    throw new Error(
      `Published baseline invalid for ${expectedSetId}: cards schema invalid in ${cardsPath}: ${z.prettifyError(cards.error)}`,
      { cause: cards.error },
    )
  }

  return {
    cards: cards.data,
    provenance: {
      kind: 'published',
      source: manifest.data.source,
      sourceSha256: manifest.data.sourceSha256 ?? null,
    },
  }
}

async function syncCandidate(
  options: SyncCatalogsOptions,
  configs: Array<Extract<SourceConfig, { sourceType: 'cardkaizoku-json' }>>,
  configuredSnapshot: Extract<
    SourceConfig,
    { sourceType: 'cardkaizoku-json' }
  >,
): Promise<SyncCatalogsResult> {
  const source = validateSourceOverride(options.sourceOverride!)
  const candidate = await downloadCardKaizokuCandidate(source, options.fetcher)
  const outputRoot = resolve(options.outputRoot)
  const prepared = configs.map((config) => {
    const candidateConfig = {
      ...config,
      source: candidate.source,
      sourceSha256: candidate.sha256,
    }
    return prepareCatalog(
      adaptCardKaizokuRows(candidate.value, config.targetSet),
      candidateConfig,
    )
  })

  let cachedBaseline:
    | Awaited<ReturnType<typeof readVerifiedCardKaizokuCache>>
    | undefined
  const reportCatalogs = []
  for (const [index, catalog] of prepared.entries()) {
    const config = configs[index]
    if (config === undefined) {
      throw new Error(`Missing baseline configuration for ${catalog.setId}`)
    }
    const output = resolve(outputRoot, config.targetSet)
    const publishedBaseline = await readPublishedBaseline(
      output,
      catalog.setId,
    )
    let before: PlayableCard[]
    let baseline: BaselineProvenance
    if (publishedBaseline === undefined) {
      baseline = {
        kind: 'configured-cache',
        source: configuredSnapshot.source,
        sourceSha256: configuredSnapshot.sourceSha256,
      }
      try {
        cachedBaseline ??= await readVerifiedCardKaizokuCache({
          source: configuredSnapshot.source,
          sourceSha256: configuredSnapshot.sourceSha256,
          cachePath: configuredSnapshot.cachePath,
        })
      } catch (cause) {
        throw new Error(
          `Candidate baseline unavailable for ${catalog.setId}: no valid published cards.json and configured cache could not be loaded`,
          { cause },
        )
      }
      const baselinePrepared = prepareCatalog(
        adaptCardKaizokuRows(cachedBaseline.value, config.targetSet),
        config,
      )
      before = baselinePrepared.cards
    } else {
      before = publishedBaseline.cards
      baseline = publishedBaseline.provenance
    }

    reportCatalogs.push({
      ...catalog.result,
      output,
      baseline,
      errors: catalog.validation.errors,
      warnings: catalog.validation.warnings,
      diff: diffCatalogs(before, catalog.cards),
    })
  }

  const report = {
    schemaVersion: 1,
    kind: 'cardkaizoku-candidate',
    newSource: candidate.source,
    newSourceSha256: candidate.sha256,
    catalogs: reportCatalogs,
  }
  const reportPath = join(
    dirname(outputRoot),
    'reports',
    `candidate-${candidate.sha256}.json`,
  )
  await writeImmutableReport(reportPath, report)

  return {
    mode: 'candidate-report',
    source: candidate.source,
    sourceSha256: candidate.sha256,
    reportPath,
    catalogs: catalogResults(prepared, outputRoot),
  }
}
