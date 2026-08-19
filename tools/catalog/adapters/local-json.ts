import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { sourceCardSchema, type SourceCard } from '../model.js'
import type { CatalogSourceAdapter } from '../source-adapter.js'

const sourceCardsSchema = z.array(sourceCardSchema)

export class LocalJsonAdapter implements CatalogSourceAdapter {
  constructor(private readonly path: string) {}

  async load(): Promise<SourceCard[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'))

      return sourceCardsSchema.parse(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Local catalog input not found: ${this.path}`)
      }

      throw new Error(`Local catalog input invalid: ${this.path}`, {
        cause: error,
      })
    }
  }
}
