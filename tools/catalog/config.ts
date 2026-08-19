import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  sourceConfigFileSchema,
  sourceConfigSchema,
  type SourceConfig,
} from './model.js'

export function loadSetConfigFromValue(value: unknown, setId: string): SourceConfig {
  const config = sourceConfigFileSchema.parse(value)
  const normalizedSetId = setId.toLowerCase()
  const setConfig = config.sets[normalizedSetId]

  if (setConfig === undefined) {
    throw new Error(`Unknown set "${setId}" in catalog-sources.json`)
  }

  if (setConfig.sourceType === 'cardkaizoku-json') {
    const snapshot = config.cardKaizokuSnapshot

    if (snapshot === undefined) {
      throw new Error(`Card Kaizoku snapshot is required for set "${normalizedSetId}"`)
    }

    return sourceConfigSchema.parse({
      ...setConfig,
      source: snapshot.source,
      sourceSha256: snapshot.sha256,
      cachePath: snapshot.cachePath,
    })
  }

  return sourceConfigSchema.parse(setConfig)
}

export function loadSetConfig(setId: string): SourceConfig {
  const configPath = resolve('catalog-sources.json')
  const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'))

  return loadSetConfigFromValue(value, setId)
}
