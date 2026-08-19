import { z } from 'zod'

import { cardFeaturesSchema } from './card-features.js'

export const cardTypeSchema = z.enum([
  'LEADER',
  'CHARACTER',
  'EVENT',
  'STAGE',
  'DON',
])

export type CardType = z.infer<typeof cardTypeSchema>

export const readinessSchema = z.enum([
  'provisional',
  'needs-review',
  'tournament-ready',
])

export type Readiness = z.infer<typeof readinessSchema>

export const nullableNonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()

export const printedCardIdSchema = z
  .string()
  .regex(/^[A-Z]{1,5}\d{0,2}-\d{3}$/)

export const sha256Schema = z.string().regex(/^[a-f\d]{64}$/)

const playableCardFields = {
  cardNumber: printedCardIdSchema,
  name: z.string().min(1),
  rarity: z.string().min(1),
  cardType: cardTypeSchema,
  colors: z.array(z.string().min(1)),
  cost: nullableNonnegativeIntegerSchema,
  life: nullableNonnegativeIntegerSchema,
  power: nullableNonnegativeIntegerSchema,
  counter: nullableNonnegativeIntegerSchema,
  attribute: z.string(),
  traits: z.array(z.string().min(1)),
  effect: z.string(),
  trigger: z.string(),
  setMembership: z.array(z.string().min(1)).min(1),
  variantsCollapsed: z.number().int().positive(),
  entryShortcut: z.string().regex(/^\d{3}$/).nullable(),
  isSpecialReprint: z.boolean(),
}

export const playableCardSchema = z.strictObject(playableCardFields)

export type PlayableCard = z.infer<typeof playableCardSchema>

export const suggestedRoleSchema = z.enum([
  'blocker',
  'twoKCounter',
  'draw',
  'removal',
  'pressure',
  'boss',
])

export type SuggestedRole = z.infer<typeof suggestedRoleSchema>

const preSupportRequirementsCardFeaturesSchema = cardFeaturesSchema.omit({
  supportRequirementsByFlag: true,
})

const legacyCardFeaturesSchema = preSupportRequirementsCardFeaturesSchema.omit({
  rainbowUsableFlags: true,
})

const legacyRainbowCardFeaturesSchema = cardFeaturesSchema.omit({
  rainbowUsableFlags: true,
})

const serializedCardFeaturesSchema = z.union([
  cardFeaturesSchema,
  preSupportRequirementsCardFeaturesSchema,
  legacyCardFeaturesSchema,
  legacyRainbowCardFeaturesSchema,
])

export const strategySuggestionSchema = z.strictObject({
  cardNumber: printedCardIdSchema,
  roles: z.array(suggestedRoleSchema),
  features: serializedCardFeaturesSchema.optional(),
  reviewStatus: z.enum(['suggested', 'reviewed']),
})

export type StrategySuggestion = z.infer<typeof strategySuggestionSchema>

export const sourceTypeSchema = z.enum([
  'official-html',
  'local-json',
  'cardkaizoku-json',
])

export type SourceType = z.infer<typeof sourceTypeSchema>

const catalogManifestFields = {
  schemaVersion: z.literal(1),
  setId: z.string().regex(/^OP\d{2}$/),
  language: z.literal('en'),
  source: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceSha256: sha256Schema.optional(),
  readiness: readinessSchema,
}

export const catalogManifestSchema = z
  .strictObject(catalogManifestFields)
  .superRefine((manifest, context) => {
    if (manifest.sourceType === 'local-json') return

    if (!z.url().safeParse(manifest.source).success) {
      context.addIssue({
        code: 'custom',
        message: 'source must be a URL',
        path: ['source'],
      })
    }
  })

export type CatalogManifest = z.infer<typeof catalogManifestSchema>

export const artifactChecksumsSchema = z.strictObject({
  'manifest.json': sha256Schema,
  'cards.json': sha256Schema,
  'set-contents.json': sha256Schema,
  'strategy-suggestions.json': sha256Schema,
})

export type ArtifactChecksums = z.infer<typeof artifactChecksumsSchema>
