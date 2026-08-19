import { z } from 'zod'

import { readinessSchema, sha256Schema } from './catalog.js'

export const runtimeCatalogIndexEntrySchema = z
  .strictObject({
    setId: z.string().regex(/^OP\d{2}$/),
    label: z.string().min(1),
    manifestPath: z
      .string()
      .regex(/^\/catalogs\/op\d{2}\/manifest\.json$/),
    sourceSha256: sha256Schema,
    readiness: readinessSchema,
  })
  .superRefine((entry, context) => {
    const expectedPath = `/catalogs/${entry.setId.toLowerCase()}/manifest.json`
    if (entry.manifestPath !== expectedPath) {
      context.addIssue({
        code: 'custom',
        message: `manifestPath must be ${expectedPath}`,
        path: ['manifestPath'],
      })
    }
  })

export type RuntimeCatalogIndexEntry = z.infer<
  typeof runtimeCatalogIndexEntrySchema
>

const expectedSetIds = Array.from(
  { length: 17 },
  (_, index) => `OP${String(index + 1).padStart(2, '0')}`,
)

export const runtimeCatalogIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sets: z.array(runtimeCatalogIndexEntrySchema).length(17),
  })
  .superRefine((index, context) => {
    const seenSetIds = new Set<string>()

    index.sets.forEach((entry, position) => {
      if (seenSetIds.has(entry.setId)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate setId ${entry.setId}`,
          path: ['sets', position, 'setId'],
        })
      }
      seenSetIds.add(entry.setId)

      const expectedSetId = expectedSetIds[position]
      if (entry.setId !== expectedSetId) {
        context.addIssue({
          code: 'custom',
          message: `expected ${expectedSetId} at position ${position}`,
          path: ['sets', position, 'setId'],
        })
      }
    })
  })

export type RuntimeCatalogIndex = z.infer<typeof runtimeCatalogIndexSchema>
