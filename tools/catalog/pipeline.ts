import { resolve } from 'node:path'

import { CardKaizokuJsonAdapter } from './adapters/cardkaizoku.js'
import { LocalJsonAdapter } from './adapters/local-json.js'
import { OfficialHtmlAdapter } from './adapters/official-html.js'
import type { SourceConfig } from './model.js'
import {
  prepareCatalog,
  type PreparedCatalogResult,
} from './prepare.js'
import type { CatalogSourceAdapter } from './source-adapter.js'
import { publishCatalogGroup, stageCatalog } from './publication.js'

export interface BuildCatalogOptions {
  setId: string
  output?: string
  config: SourceConfig
}

export type BuildCatalogResult = PreparedCatalogResult & {
  output: string
}

function createSourceAdapter(config: SourceConfig): CatalogSourceAdapter {
  switch (config.sourceType) {
    case 'official-html':
      return new OfficialHtmlAdapter(config.source, config.targetSet)
    case 'local-json':
      return new LocalJsonAdapter(config.source)
    case 'cardkaizoku-json':
      return new CardKaizokuJsonAdapter(
        config.source,
        config.cachePath,
        config.sourceSha256,
        config.targetSet,
      )
    default:
      return assertNever(config)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported catalog source config: ${String(value)}`)
}

export async function buildCatalog({
  setId,
  output: requestedOutput,
  config,
}: BuildCatalogOptions): Promise<BuildCatalogResult> {
  const normalizedSetId = setId.toLowerCase()
  if (normalizedSetId !== config.targetSet) {
    throw new Error(
      `Set ID "${normalizedSetId}" does not match configured target "${config.targetSet}"`,
    )
  }

  const output = resolve(
    requestedOutput ?? resolve('tmp/catalog/bundles', config.targetSet),
  )
  const sourceCards = await createSourceAdapter(config).load()
  const prepared = prepareCatalog(sourceCards, config)

  if (prepared.validation.errors.length > 0) {
    const failureOutput = `${output}.failed`
    const stagedDiagnostics = await stageCatalog(
      failureOutput,
      prepared.setId,
      prepared.bundle,
    )
    const [diagnosticsReceipt] = await publishCatalogGroup([stagedDiagnostics])
    if (diagnosticsReceipt === undefined) {
      throw new Error(`Catalog diagnostics publication returned no receipt`)
    }
    throw new Error(
      `Catalog validation failed:\n${prepared.validation.errors.join('\n')}\nFailure diagnostics: ${failureOutput}${diagnosticsReceipt.previous === undefined ? '' : `\nPreserved prior diagnostics: ${diagnosticsReceipt.previous}`}`,
    )
  }

  const staged = await stageCatalog(output, prepared.setId, prepared.bundle)
  await publishCatalogGroup([staged])

  return {
    ...prepared.result,
    output,
  }
}
