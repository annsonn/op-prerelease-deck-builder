import type { SourceCard } from './model.js'

export interface CatalogSourceAdapter {
  load(): Promise<SourceCard[]>
}
