import { z } from 'zod'

import {
  cardTypeSchema,
  nullableNonnegativeIntegerSchema,
  playableCardSchema,
  printedCardIdSchema,
  readinessSchema,
  sha256Schema,
  type PlayableCard,
} from '../../shared/catalog.js'

export {
  cardTypeSchema,
  nullableNonnegativeIntegerSchema,
  playableCardSchema,
  printedCardIdSchema,
  readinessSchema,
  sha256Schema,
  type PlayableCard,
}

export const sourceCardSchema = playableCardSchema
  .omit({
    variantsCollapsed: true,
    entryShortcut: true,
    isSpecialReprint: true,
  })
  .extend({
    sourceRecordId: z.string().min(1),
  })

export type SourceCard = z.infer<typeof sourceCardSchema>

const sourceConfigFields = {
  targetSet: z.string().regex(/^op\d{2}$/),
  expectedFirst: z.number().int().positive(),
  expectedLast: z.number().int().positive(),
  expectedSpecialReprints: z.array(printedCardIdSchema).default([]),
}

const officialHtmlSourceSchema = z.object({
  sourceType: z.literal('official-html'),
  source: z.string().url(),
  ...sourceConfigFields,
})

const localJsonSourceSchema = z.object({
  sourceType: z.literal('local-json'),
  source: z.string().min(1),
  ...sourceConfigFields,
})

export const cardKaizokuSnapshotSchema = z.object({
  source: z.string().url(),
  sha256: sha256Schema,
  cachePath: z.string().min(1),
})

const cardKaizokuFileSourceSchema = z.object({
  sourceType: z.literal('cardkaizoku-json'),
  ...sourceConfigFields,
})

const cardKaizokuRuntimeSourceSchema = cardKaizokuFileSourceSchema.extend({
  source: z.string().url(),
  sourceSha256: sha256Schema,
  cachePath: z.string().min(1),
})

const expectedRangeRefinement = ({
  expectedFirst,
  expectedLast,
}: {
  expectedFirst: number
  expectedLast: number
}) => expectedFirst <= expectedLast

export const sourceConfigSchema = z
  .discriminatedUnion('sourceType', [
    officialHtmlSourceSchema,
    localJsonSourceSchema,
    cardKaizokuRuntimeSourceSchema,
  ])
  .refine(expectedRangeRefinement, {
    message: 'expectedFirst must be less than or equal to expectedLast',
    path: ['expectedLast'],
  })

export type SourceConfig = z.input<typeof sourceConfigSchema>

const sourceConfigFileSetSchema = z
  .discriminatedUnion('sourceType', [
    officialHtmlSourceSchema,
    localJsonSourceSchema,
    cardKaizokuFileSourceSchema,
  ])
  .refine(expectedRangeRefinement, {
    message: 'expectedFirst must be less than or equal to expectedLast',
    path: ['expectedLast'],
  })

export const sourceConfigFileSchema = z.object({
  cardKaizokuSnapshot: cardKaizokuSnapshotSchema.optional(),
  sets: z.record(z.string(), sourceConfigFileSetSchema),
})

export type SourceConfigFile = z.infer<typeof sourceConfigFileSchema>

export type BuildStage = 'import' | 'derive' | 'validate' | 'build'
