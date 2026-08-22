import { z } from 'zod'

import type { PlayableCard } from './catalog.js'
import {
  cardEffectModelSchema,
  type CardEffectModel,
} from './card-effect-model.js'
import { parseCardEffects } from './card-effect-parser.js'

export const cardFeatureKeys = [
  'twoKCounter',
  'blocker',
  'vanillaLike',
  'draw',
  'removal',
  'boss',
  'rush',
  'banish',
  'twoForOne',
  'massRest',
  'donRefresh',
  'searcher',
  'comboDependent',
  'brick',
] as const

export type CardFeatureKey = (typeof cardFeatureKeys)[number]

export const supportRequirementFlagKeys = [
  'blocker',
  'draw',
  'removal',
  'rush',
  'banish',
  'twoForOne',
  'searcher',
] as const

export type SupportRequirementFlag =
  (typeof supportRequirementFlagKeys)[number]

export interface SupportRequirement {
  readonly requiredNames: readonly string[]
  readonly requiredTraits: readonly string[]
}

export type RainbowLuffyCompatibility =
  | 'compatible'
  | 'neutral'
  | 'incompatible'

export interface CardFeatures extends CardEffectModel {
  readonly flags: Readonly<Record<CardFeatureKey, boolean>>
  readonly rainbowUsableFlags: Readonly<Record<CardFeatureKey, boolean>>
  readonly supportRequirementsByFlag: Readonly<
    Record<SupportRequirementFlag, SupportRequirement | null>
  >
  readonly rainbowLuffyCompatibility: RainbowLuffyCompatibility
  readonly searchableTraits: readonly string[]
  readonly searchableNames: readonly string[]
  readonly requiredTraits: readonly string[]
  readonly requiredNames: readonly string[]
  readonly evidence: readonly string[]
}

export const featureFlagsSchema = z.strictObject({
  twoKCounter: z.boolean(),
  blocker: z.boolean(),
  vanillaLike: z.boolean(),
  draw: z.boolean(),
  removal: z.boolean(),
  boss: z.boolean(),
  rush: z.boolean(),
  banish: z.boolean(),
  twoForOne: z.boolean(),
  massRest: z.boolean(),
  donRefresh: z.boolean(),
  searcher: z.boolean(),
  comboDependent: z.boolean(),
  brick: z.boolean(),
})

const supportRequirementSchema = z.strictObject({
  requiredNames: z.array(z.string()),
  requiredTraits: z.array(z.string()),
})

export const supportRequirementsByFlagSchema = z.strictObject({
  blocker: supportRequirementSchema.nullable(),
  draw: supportRequirementSchema.nullable(),
  removal: supportRequirementSchema.nullable(),
  rush: supportRequirementSchema.nullable(),
  banish: supportRequirementSchema.nullable(),
  twoForOne: supportRequirementSchema.nullable(),
  searcher: supportRequirementSchema.nullable(),
})

export const cardFeaturesSchema = z.strictObject({
  ...cardEffectModelSchema.shape,
  flags: featureFlagsSchema,
  rainbowUsableFlags: featureFlagsSchema,
  supportRequirementsByFlag: supportRequirementsByFlagSchema,
  rainbowLuffyCompatibility: z.enum(['compatible', 'neutral', 'incompatible']),
  searchableTraits: z.array(z.string()),
  searchableNames: z.array(z.string()),
  requiredTraits: z.array(z.string()),
  requiredNames: z.array(z.string()),
  evidence: z.array(z.string()),
})

function normalizeRulesText(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/[［]/g, '[')
    .replace(/[］]/g, ']')
    .replace(/[｛]/g, '{')
    .replace(/[｝]/g, '}')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim()
}

function sortedFrozen(values: Iterable<string>): readonly string[] {
  const normalized = new Set<string>()
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (trimmed) normalized.add(trimmed)
  }
  return Object.freeze(Array.from(normalized).sort())
}

function allMatches(text: string, expression: RegExp): string[] {
  return Array.from(text.matchAll(expression), (match) => match[1] ?? '')
}

const structuralAnnotations = new Set([
  'activate: main',
  'banish',
  'blocker',
  'counter',
  'double attack',
  'end of your turn',
  'end of your opponent\'s turn',
  'main',
  'on block',
  'on k.o.',
  'on play',
  'on your opponent\'s attack',
  'once per turn',
  'opponent\'s turn',
  'rush',
  'rush: character',
  'trigger',
  'unblockable',
  'when attacked',
  'when attacking',
  'when blocked',
  'your turn',
])

function isStructuralAnnotation(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase()
  return (
    structuralAnnotations.has(normalized) ||
    /^don!!\s*(?:[x-]\s*\d+)?$/i.test(normalized)
  )
}

function cardNameTargets(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const prefix = text.slice(0, match.index).slice(-32)
    if (/\bother than\s*$/i.test(prefix)) continue
    const name = match[1] ?? ''
    if (!isStructuralAnnotation(name)) names.push(name)
  }
  names.push(
    ...allMatches(
      text,
      /\bcard\s+name\s+includ(?:es|ing)\s+"([^"]+)"/gi,
    ),
  )
  return names
}

function traitTargets(text: string): string[] {
  return [
    ...allMatches(text, /\{([^}]+)\}/g),
    ...allMatches(text, /\btype\s+includ(?:es|ing)\s+"([^"]+)"/gi),
  ]
}

function hasBlocker(text: string): boolean {
  return (
    /\[\s*blocker\s*\]/i.test(text) ||
    /(?:^|[.;])\s*blocker\s*(?=$|[.;])/i.test(text)
  )
}

function hasDraw(text: string): boolean {
  return /\bdraw\s+\d+\s+cards?\b/i.test(text)
}

function hasRush(text: string): boolean {
  return (
    /\[\s*rush(?:\s*:\s*character)?\s*\]/i.test(text) ||
    /(?:^|[.;])\s*rush\s*(?=$|[.;])/i.test(text)
  )
}

function hasBanish(text: string): boolean {
  return (
    /\[\s*banish\s*\]/i.test(text) ||
    /(?:^|[.;])\s*banish\s*(?=$|[.;])/i.test(text)
  )
}

function hasRemoval(text: string): boolean {
  return [
    /\bk\.?\s*o\.?(?=\s|$)[^.;]{0,120}\bopponent'?s?\s+(?:characters?|stages?)\b/i,
    /\breturn\b[^.;:]{0,120}\bopponent'?s?\s+characters?\b[^.;:]{0,120}\bhand\b/i,
    /\breturn\s+up to\s+(?:1|one)\s+character\b[^.;:]{0,120}\bowner'?s?\s+hand\b/i,
    /\b(?:place|put)\b.{0,120}\bopponent'?s?\s+characters?\b.{0,120}\bbottom\b.{0,80}\bdeck\b/i,
    /\brest\b[^.;:]{0,120}\bopponent'?s?\s+(?:(?:leader|character)\s+or\s+)?(?:cards?|characters?|leaders?)\b/i,
    /\bopponent'?s?\s+(?:rested\s+)?characters?\b.{0,120}-\s*\d+\s*power\b/i,
  ].some((expression) => expression.test(text))
}

function hasSearchPattern(text: string): boolean {
  return (
    /\b(?:look at|search)\b/i.test(text) &&
    /\breveal\b/i.test(text) &&
    /\badd\b/i.test(text) &&
    /\b(?:hand|deck)\b/i.test(text)
  )
}

function hasTwoForOne(text: string): boolean {
  const drawsTwo = /\bdraw\s+(?:2|two)\s+cards?\b/i.test(text)
  const replacesDrawnCards =
    /\bdraw\s+(?:2|two)\s+cards?\b[^.;]{0,80}\btrash\s+(?:2|two)\s+cards?\b/i.test(
      text,
    )
  return (
    (drawsTwo && !replacesDrawnCards) ||
    /\bk\.?\s*o\.?(?=\s|$)[^.;]{0,120}\bup to\s+(?:2|two)\b[^.;]{0,120}\bopponent'?s?\s+characters?\b/i.test(
      text,
    ) ||
    /\b(?:return|place|put|rest)\b.{0,120}\bup to\s+(?:2|two)\b.{0,120}\bopponent'?s?\s+characters?\b/i.test(
      text,
    ) ||
    /\bup to\s+(?:2|two)\s+(?:of\s+)?your\s+opponent'?s?\s+characters?\b[^.;]{0,120}-\s*\d+\s*power\b/i.test(
      text,
    )
  )
}

const imperativeEffectPrefix =
  String.raw`(?:^|[\n.;]\s*)(?:\[[^\]]+\]\s*)*(?:then,\s*)?(?:if\b[^.;\n]{0,240},\s*)?`

function hasMassRest(text: string): boolean {
  return new RegExp(
    `${imperativeEffectPrefix}rest\\s+all\\s+of\\s+your\\s+opponent's\\s+characters?\\b`,
    'i',
  ).test(text)
}

function hasDonRefresh(text: string): boolean {
  return new RegExp(
    `${imperativeEffectPrefix}set(?:\\s+up\\s+to)?\\s+(?:10|[1-9])\\s+of\\s+your\\s+DON!!\\s+cards?\\s+as\\s+active\\b`,
    'i',
  ).test(text)
}

function searchClause(text: string): string {
  const match = /\b(?:look at|search)\b[\s\S]*?\badd\b[\s\S]*?\b(?:hand|deck)\b/i.exec(
    text,
  )
  return match?.[0] ?? ''
}

function conditionalClauses(text: string): readonly string[] {
  return Array.from(text.matchAll(/\bif\b([\s\S]*?)(?=,|;|$)/gi), (match) =>
    (match[1] ?? '').trim(),
  )
}

function hasComboDependency(text: string): boolean {
  return conditionalClauses(text).some((condition) =>
    [
      /\b(?:a\s+)?(?:card|character|leader)\s+named\s+\[[^\]]+\]/i,
      /\{[^}]+\}\s*(?:type|trait)\b/i,
      /\btype\s+includ(?:es|ing)\s+"[^"]+"/i,
      /\b(?:your|the|this|that)\s+(?:leader|character|event|stage|card)\b/i,
      /\bopponent'?s?\s+(?:leader|characters?|events?|stages?|cards?)\b/i,
      /\b(?:you|your opponent|the opponent)\s+(?:have|has)\b/i,
      /\bthere\s+(?:is|are)\b/i,
      /\b(?:field|hand|trash|life|rested|active|don!!)\b/i,
    ].some((expression) => expression.test(condition)),
  )
}

function rainbowLuffyCompatibility(
  text: string,
  comboDependent: boolean,
): RainbowLuffyCompatibility {
  if (
    /\b(?:your|the)\s+(?:mono-colored\s+leader|leader\s+is\s+mono-colored)\b/i.test(
      text,
    )
  ) {
    return 'incompatible'
  }

  const leaderCondition = /\bif\s+(?:your|the)\s+leader\b/i.test(text)
  if (!leaderCondition) return comboDependent ? 'neutral' : 'compatible'

  const namedLeader =
    /\bleader\s+(?:is|named)\s+(?:a\s+card\s+named\s+)?\[[^\]]+\]/i.test(
      text,
    ) ||
    /\bleader'?s?\s+card\s+name\s+includ(?:es|ing)\s+"[^"]+"/i.test(
      text,
    )
  const leaderType =
    /\bleader\s+has(?:\s+the)?\s+(?:\{[^}]+\}|\[[^\]]+\])(?:\s+or\s+(?:\{[^}]+\}|\[[^\]]+\]))*\s+(?:type|trait)\b/i.test(
      text,
    ) ||
    /\bleader\s+is\s+(?:a\s+)?(?:\{[^}]+\}|\[[^\]]+\])\s+(?:type|trait)\b/i.test(
      text,
    ) ||
    /\bleader'?s?\s+type\s+includ(?:es|ing)\s+(?:\{[^}]+\}|\[[^\]]+\]|"[^"]+")/i.test(
      text,
    )

  return namedLeader || leaderType ? 'incompatible' : 'neutral'
}

interface TextFeatureFlags {
  readonly blocker: boolean
  readonly draw: boolean
  readonly removal: boolean
  readonly rush: boolean
  readonly banish: boolean
  readonly twoForOne: boolean
  readonly massRest: boolean
  readonly donRefresh: boolean
  readonly searcher: boolean
  readonly comboDependent: boolean
}

function detectTextFeatureFlags(rulesText: string): TextFeatureFlags {
  return {
    blocker: hasBlocker(rulesText),
    draw: hasDraw(rulesText),
    removal: hasRemoval(rulesText),
    rush: hasRush(rulesText),
    banish: hasBanish(rulesText),
    twoForOne: hasTwoForOne(rulesText),
    massRest: hasMassRest(rulesText),
    donRefresh: hasDonRefresh(rulesText),
    searcher: hasSearchPattern(rulesText),
    comboDependent: hasComboDependency(rulesText),
  }
}

function buildFeatureFlags(
  card: PlayableCard,
  textFlags: TextFeatureFlags,
): Record<CardFeatureKey, boolean> {
  const vanillaLike =
    card.cardType === 'CHARACTER' &&
    card.cost !== null &&
    card.cost >= 1 &&
    card.cost <= 6 &&
    card.power !== null &&
    card.power >= (card.cost + 2) * 1000 &&
    !textFlags.comboDependent
  const boss =
    card.cardType === 'CHARACTER' &&
    card.cost !== null &&
    card.cost >= 7 &&
    ((card.power !== null && card.power >= 8000) ||
      textFlags.rush ||
      textFlags.banish ||
      textFlags.draw ||
      textFlags.removal ||
      textFlags.twoForOne)

  return {
    twoKCounter: card.counter !== null && card.counter >= 2000,
    blocker: textFlags.blocker,
    vanillaLike,
    draw: textFlags.draw,
    removal: textFlags.removal,
    boss,
    rush: textFlags.rush,
    banish: textFlags.banish,
    twoForOne: textFlags.twoForOne,
    massRest: textFlags.massRest,
    donRefresh: textFlags.donRefresh,
    searcher: textFlags.searcher,
    comboDependent: textFlags.comboDependent,
    brick:
      card.cardType === 'CHARACTER' &&
      (card.counter === null || card.counter === 0),
  }
}

const koPeriodPlaceholder = '\uE000'

function splitRulesClauses(rulesText: string): readonly string[] {
  const protectedText = rulesText.replace(/\bk\.o\./gi, (match) =>
    match.replaceAll('.', koPeriodPlaceholder),
  )
  return protectedText
    .split(/\n+|(?<=[.?])\s+/)
    .map((clause) => clause.replaceAll(koPeriodPlaceholder, '.').trim())
    .filter(Boolean)
}

function rainbowUsableRulesText(rulesText: string): string {
  const usableClauses: string[] = []
  let suppressThenContinuation = false

  for (const clause of splitRulesClauses(rulesText)) {
    if (/^then\b[,:]?/i.test(clause) && suppressThenContinuation) continue

    const incompatible =
      rainbowLuffyCompatibility(clause, hasComboDependency(clause)) ===
      'incompatible'
    if (incompatible) {
      suppressThenContinuation = true
      continue
    }

    suppressThenContinuation = false
    usableClauses.push(clause)
  }

  return usableClauses.join('\n')
}

function unconditionalMassRestRulesText(rulesText: string): string {
  const unconditionalClauses: string[] = []
  let suppressThenContinuation = false

  for (const clause of splitRulesClauses(rulesText)) {
    if (/^then\b[,:]?/i.test(clause) && suppressThenContinuation) continue

    if (/\bif\b/i.test(clause)) {
      suppressThenContinuation = true
      continue
    }

    suppressThenContinuation = false
    unconditionalClauses.push(clause)
  }

  return unconditionalClauses.join('\n')
}

function supportClaims(text: string): ReadonlySet<SupportRequirementFlag> {
  const flags = detectTextFeatureFlags(text)
  const claims = new Set<SupportRequirementFlag>()
  for (const claim of supportRequirementFlagKeys) {
    if (flags[claim]) claims.add(claim)
  }
  return claims
}

function requirementFromText(text: string): SupportRequirement {
  return Object.freeze({
    requiredNames: sortedFrozen(cardNameTargets(text)),
    requiredTraits: sortedFrozen(traitTargets(text)),
  })
}

function mergeRequirements(
  requirements: readonly SupportRequirement[],
): SupportRequirement {
  return Object.freeze({
    requiredNames: sortedFrozen(
      requirements.flatMap(({ requiredNames }) => requiredNames),
    ),
    requiredTraits: sortedFrozen(
      requirements.flatMap(({ requiredTraits }) => requiredTraits),
    ),
  })
}

function buildSupportRequirementsByFlag(
  rulesText: string,
): Readonly<Record<SupportRequirementFlag, SupportRequirement | null>> {
  const occurrences = new Map<
    SupportRequirementFlag,
    Array<SupportRequirement | null>
  >(
    supportRequirementFlagKeys.map((claim) => [claim, []]),
  )
  let inheritedRequirement: SupportRequirement | null = null

  const addClaims = (
    claims: ReadonlySet<SupportRequirementFlag>,
    requirement: SupportRequirement | null,
  ) => {
    for (const claim of claims) occurrences.get(claim)?.push(requirement)
  }

  for (const clause of splitRulesClauses(rulesText)) {
    const thenContinuation = /^then\b[,:]?/i.test(clause)
    const conditionIndex = clause.search(/\bif\b/i)
    const allClaims = supportClaims(clause)

    if (thenContinuation && inheritedRequirement !== null) {
      addClaims(allClaims, inheritedRequirement)
      continue
    }

    if (conditionIndex < 0) {
      addClaims(allClaims, null)
      inheritedRequirement = null
      continue
    }

    const conditionText = conditionalClauses(clause).join(' ')
    const requirement = requirementFromText(conditionText)
    const beforeClaims = supportClaims(clause.slice(0, conditionIndex))
    const afterClaims = supportClaims(clause.slice(conditionIndex))

    if (afterClaims.size > 0) {
      addClaims(beforeClaims, null)
      addClaims(afterClaims, requirement)
    } else {
      addClaims(beforeClaims, requirement)
    }
    const attributedClaims = new Set([...beforeClaims, ...afterClaims])
    addClaims(
      new Set([...allClaims].filter((claim) => !attributedClaims.has(claim))),
      requirement,
    )
    inheritedRequirement = requirement
  }

  const result = {} as Record<
    SupportRequirementFlag,
    SupportRequirement | null
  >
  for (const claim of supportRequirementFlagKeys) {
    const claimOccurrences = occurrences.get(claim) ?? []
    result[claim] =
      claimOccurrences.length === 0 ||
      claimOccurrences.some((requirement) => requirement === null)
        ? null
        : mergeRequirements(
            claimOccurrences.filter(
              (requirement): requirement is SupportRequirement =>
                requirement !== null,
            ),
          )
  }
  return Object.freeze(result)
}

export function classifyCardFeatures(card: PlayableCard): CardFeatures {
  const effectModel = parseCardEffects(card)
  const rulesText = normalizeRulesText(`${card.effect}\n${card.trigger}`)
  const textFlags = detectTextFeatureFlags(rulesText)
  const flags = buildFeatureFlags(card, textFlags)
  const usableRulesText = rainbowUsableRulesText(rulesText)
  const usableTextFlags = detectTextFeatureFlags(usableRulesText)
  const detectedUsableFlags = buildFeatureFlags(card, usableTextFlags)
  const usableMassRest = hasMassRest(
    unconditionalMassRestRulesText(usableRulesText),
  )
  const rainbowUsableFlags: Record<CardFeatureKey, boolean> = {
    ...detectedUsableFlags,
    massRest: usableMassRest,
    twoKCounter: flags.twoKCounter,
    brick: flags.brick,
  }
  const searchableText = textFlags.searcher ? searchClause(rulesText) : ''
  const requiredText = textFlags.comboDependent
    ? conditionalClauses(rulesText).join(' ')
    : ''
  const evidence = cardFeatureKeys
    .filter((key) => flags[key])
    .map((key) => key)

  return Object.freeze({
    effectModelVersion: effectModel.effectModelVersion,
    effectParserRevision: effectModel.effectParserRevision,
    effects: effectModel.effects,
    unparsedClauses: effectModel.unparsedClauses,
    flags: Object.freeze(flags),
    rainbowUsableFlags: Object.freeze(rainbowUsableFlags),
    supportRequirementsByFlag:
      buildSupportRequirementsByFlag(usableRulesText),
    rainbowLuffyCompatibility: rainbowLuffyCompatibility(
      rulesText,
      textFlags.comboDependent,
    ),
    searchableTraits: sortedFrozen(traitTargets(searchableText)),
    searchableNames: sortedFrozen(cardNameTargets(searchableText)),
    requiredTraits: sortedFrozen(traitTargets(requiredText)),
    requiredNames: sortedFrozen(cardNameTargets(requiredText)),
    evidence: sortedFrozen(evidence),
  })
}
