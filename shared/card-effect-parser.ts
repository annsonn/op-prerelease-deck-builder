import type { PlayableCard } from './catalog.js'
import {
  createCardEffectModel,
  emptyCardPredicate,
  type ActivationChannel,
  type CardEffectModel,
  type EffectAction,
  type EffectChooser,
  type EffectCost,
  type EffectInstance,
  type EffectSource,
  type EffectSubject,
  type RequirementExpression,
  type TargetSpec,
  type TimingModifier,
} from './card-effect-model.js'

const ACTIVATIONS = new Map<string, ActivationChannel>([
  ['on play', 'onPlay'],
  ['activate: main', 'activateMain'],
  ['main', 'main'],
  ['counter', 'counter'],
  ['trigger', 'trigger'],
  ['on k.o.', 'onKo'],
  ['when attacking', 'whenAttacking'],
  ['on block', 'onBlock'],
  ["on your opponent's attack", 'onOpponentsAttack'],
])

const TIMINGS = new Map<string, TimingModifier>([
  ['once per turn', 'oncePerTurn'],
  ['your turn', 'yourTurn'],
  ["opponent's turn", 'opponentsTurn'],
])

const KEYWORDS = new Map<string, 'blocker' | 'rush' | 'banish'>([
  ['blocker', 'blocker'],
  ['rush', 'rush'],
  ['banish', 'banish'],
])

interface ParsedLine {
  readonly activation: ActivationChannel
  readonly timings: readonly TimingModifier[]
  readonly keywords: readonly ('blocker' | 'rush' | 'banish')[]
  readonly annotationCosts: readonly EffectCost[]
  readonly hasActivationAnnotation: boolean
  readonly hasTimingAnnotations: boolean
  readonly hasContextAnnotations: boolean
  readonly unsupportedLeadingSyntax: boolean
  readonly text: string
}

interface PendingAnnotationContext {
  readonly activation: ActivationChannel | null
  readonly timings: readonly TimingModifier[] | null
  readonly costs: readonly EffectCost[]
}

interface InstanceDraft {
  readonly source: EffectSource
  readonly activation: ActivationChannel
  readonly timing: readonly TimingModifier[]
  readonly condition: RequirementExpression
  readonly costs: readonly EffectCost[]
  readonly chooser: EffectChooser
  readonly optional: boolean
  readonly branches: readonly { readonly actions: readonly EffectAction[] }[]
}

interface PendingChoice {
  readonly source: EffectSource
  readonly activation: ActivationChannel
  readonly timing: readonly TimingModifier[]
  readonly condition: RequirementExpression
  readonly costs: readonly EffectCost[]
  readonly chooser: Exclude<EffectChooser, 'none'>
  readonly optional: boolean
  readonly commonActions: readonly EffectAction[]
  readonly branches: EffectAction[][]
}

interface ActionMatch {
  readonly index: number
  readonly end: number
  readonly action: EffectAction
}

interface ParsedActions {
  readonly actions: readonly EffectAction[]
  readonly unparsedText: string
}

interface TextClause {
  readonly text: string
  readonly bullet: boolean
}

export function normalizeCardRulesText(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/[［]/g, '[')
    .replace(/[］]/g, ']')
    .replace(/[｛]/g, '{')
    .replace(/[｝]/g, '}')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/K\.O\./gi, 'KO')
    .replace(/\r\n?/g, '\n')
    .replace(/[•●▪]\s*/g, '\n- ')
    .replace(/(^|\n)\s*[-*]\s+/g, '$1- ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim()
}

function normalizeAnnotation(annotation: string): string {
  const normalized = annotation.toLowerCase().replace(/\s+/g, ' ').trim()
  return normalized === 'on ko' ? 'on k.o.' : normalized
}

function parseLine(line: string, source: EffectSource): ParsedLine {
  let remaining = line.trim()
  const timings: TimingModifier[] = []
  const keywords: ('blocker' | 'rush' | 'banish')[] = []
  const annotationCosts: EffectCost[] = []
  let hasActivationAnnotation = false
  let hasTimingAnnotations = false
  let hasContextAnnotations = false
  let activation: ActivationChannel = source === 'trigger' ? 'trigger' : 'static'

  while (remaining.startsWith('[')) {
    const match = remaining.match(/^\[([^\]]+)]\s*/)
    if (!match) break

    const annotation = normalizeAnnotation(match[1] ?? '')
    const mappedTiming = TIMINGS.get(annotation)
    const mappedActivation = ACTIVATIONS.get(annotation)
    const mappedKeyword = KEYWORDS.get(annotation)
    const donMinus = annotation.match(/^don!!\s*-\s*(\d+)$/)
    if (!mappedTiming && !mappedActivation && !mappedKeyword && !donMinus) {
      break
    }
    if (mappedTiming) {
      timings.push(mappedTiming)
      hasTimingAnnotations = true
      hasContextAnnotations = true
    }
    if (mappedActivation) {
      hasActivationAnnotation = true
      hasContextAnnotations = true
      if (source === 'effect') activation = mappedActivation
    }
    if (mappedKeyword) keywords.push(mappedKeyword)
    if (donMinus) {
      annotationCosts.push({ kind: 'donMinus', amount: Number(donMinus[1]) })
    }
    remaining = remaining.slice(match[0].length).trim()
  }

  return {
    activation,
    timings,
    keywords,
    annotationCosts,
    hasActivationAnnotation,
    hasTimingAnnotations,
    hasContextAnnotations,
    unsupportedLeadingSyntax:
      /^\[[^\]]+]/.test(remaining) || /^\/\s*\[[^\]]+]/.test(remaining),
    text: remaining,
  }
}

function target(overrides: Partial<TargetSpec> = {}): TargetSpec {
  return {
    subject: 'unknown',
    zones: [],
    quantity: 1,
    predicate: emptyCardPredicate(),
    differentNames: false,
    totalCostMaximum: null,
    allowsSelf: false,
    ...overrides,
  }
}

function parseSharedCosts(text: string): {
  readonly costs: readonly EffectCost[]
  readonly resultText: string
} {
  const separator = text.indexOf(':')
  if (separator < 0) return { costs: [], resultText: text }

  const prefix = text.slice(0, separator).trim()
  const costs: EffectCost[] = []
  for (const match of prefix.matchAll(/DON!!\s*-\s*(\d+)/gi)) {
    costs.push({ kind: 'donMinus', amount: Number(match[1]) })
  }
  for (const match of prefix.matchAll(/rest\s+(\d+)\s+of your DON!! cards?/gi)) {
    costs.push({ kind: 'restDon', amount: Number(match[1]) })
  }
  for (const match of prefix.matchAll(
    /(?:trash|discard)\s+(\d+)\s+cards? from your hand/gi,
  )) {
    costs.push({ kind: 'discardHand', amount: Number(match[1]) })
  }
  if (/trash this (?:card|character)/i.test(prefix)) {
    costs.push({ kind: 'trashSelf' })
  }
  if (/rest this (?:card|character)/i.test(prefix)) {
    costs.push({ kind: 'restSelf' })
  }

  return costs.length > 0
    ? { costs, resultText: text.slice(separator + 1).trim() }
    : { costs: [], resultText: text }
}

function addMatches(
  matches: ActionMatch[],
  text: string,
  expression: RegExp,
  action: (match: RegExpMatchArray) => EffectAction,
): void {
  for (const match of text.matchAll(expression)) {
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      action: action(match),
    })
  }
}

function parseQuantity(text: string): number | 'all' | 'anyNumber' {
  if (/\bany number\b/i.test(text)) return 'anyNumber'
  if (/\ball\b/i.test(text)) return 'all'
  return Number(text.match(/\b(?:up to\s+)?(\d+)\b/i)?.[1] ?? 1)
}

function parseActions(
  text: string,
  inheritedSubject: EffectSubject,
  source: EffectSource,
): ParsedActions {
  const matches: ActionMatch[] = []

  addMatches(
    matches,
    text,
    /\b(your opponent\s+)?draws?\s+(\d+)\s+cards?/gi,
    (match) => ({
      kind: 'draw',
      subject:
        match[1] || inheritedSubject === 'opponent' ? 'opponent' : 'player',
      amount: Number(match[2]),
    }),
  )

  addMatches(
    matches,
    text,
    /your opponent\s+(?:trashes|discards)\s+(\d+)\s+cards? from (?:their|his or her) hand/gi,
    (match) => ({
      kind: 'handDiscard',
      subject: 'opponent',
      amount: Number(match[1]),
    }),
  )

  addMatches(
    matches,
    text,
    /add\s+(\d+)\s+cards? to your life/gi,
    (match) => ({
      kind: 'lifeMove',
      direction: 'gainOwnLife',
      amount: Number(match[1]),
    }),
  )
  addMatches(
    matches,
    text,
    /add\s+(\d+)\s+cards? from your opponent's life to their hand/gi,
    (match) => ({
      kind: 'lifeMove',
      direction: 'opponentLifeToHand',
      amount: Number(match[1]),
    }),
  )

  addMatches(
    matches,
    text,
    /((?:up to\s+\d+|all|any number)\s+of your opponent's characters(?:\s+with a cost of\s+(\d+)\s+or less)?)\s+cannot attack until the end of your opponent's next end phase/gi,
    (match) => ({
      kind: 'lockAttack',
      target: target({
        subject: 'opponent',
        zones: ['field'],
        quantity: parseQuantity(match[1] ?? ''),
        predicate: {
          ...emptyCardPredicate(),
          cardTypes: ['CHARACTER'],
          maximumCost: match[2] ? Number(match[2]) : null,
        },
      }),
      duration: 'untilOpponentsNextEndPhase',
    }),
  )

  addMatches(
    matches,
    text,
    /(all|up to\s+\d+)\s+of your characters without a counter (?:have|gain)\s+\+(\d+)\s+counter/gi,
    (match) => ({
      kind: 'counterModifier',
      amount: Number(match[2]),
      target: target({
        subject: 'player',
        zones: ['field'],
        quantity: parseQuantity(match[1] ?? ''),
        predicate: {
          ...emptyCardPredicate(),
          cardTypes: ['CHARACTER'],
          counter: 'withoutCounter',
        },
      }),
    }),
  )

  addMatches(
    matches,
    text,
    /(?:up to\s+\d+\s+of\s+)?your leader gains\s+\+(\d+)\s+power/gi,
    (match) => ({
      kind: 'powerModifier',
      powerDelta: Number(match[1]),
      target: target({ subject: 'player', zones: ['field'], quantity: 1 }),
      duration: 'thisTurn',
    }),
  )

  addMatches(
    matches,
    text,
    /play\s+(this (?:card|character)|(?:up to\s+)?\d+\s+character card)/gi,
    (match) => {
      const explicitSelf = /^this /i.test(match[1] ?? '')
      return {
        kind: 'deploy',
        target: target({
          subject: explicitSelf ? 'thisCard' : 'player',
          zones: [explicitSelf && source === 'trigger' ? 'life' : 'hand'],
          quantity: parseQuantity(match[1] ?? ''),
          predicate: {
            ...emptyCardPredicate(),
            cardTypes: ['CHARACTER'],
          },
          allowsSelf: explicitSelf,
        }),
      }
    },
  )

  const ordered = matches.sort((left, right) => left.index - right.index)
  const residue = text.split('')
  for (const match of ordered) {
    residue.fill(' ', match.index, match.end)
  }
  const unparsedText = residue
    .join('')
    .replace(/^\s*then\s*,?\s*/i, '')
    .replace(/^\s*(?:and|then)\b\s*/i, '')
    .replace(/^[\s,;:.]+/, '')
    .trim()
  const connectorOnly = unparsedText
    .replace(/\b(?:and|then)\b/gi, '')
    .replace(/[\s,;:.]/g, '')

  return {
    actions: ordered.map(({ action }) => action),
    unparsedText: connectorOnly ? unparsedText : '',
  }
}

function parseCondition(text: string): {
  readonly condition: RequirementExpression
  readonly resultText: string
} {
  const match = text.match(/^\s*(if\s+[^,]+),\s*(.+)$/i)
  if (!match) return { condition: { kind: 'always' }, resultText: text }

  return {
    condition: {
      kind: 'unknown',
      normalizedText: (match[1] ?? '').toLowerCase().replace(/\s+/g, ' '),
    },
    resultText: match[2] ?? '',
  }
}

function tokenizeSourceText(normalized: string): readonly TextClause[] {
  const clauses: TextClause[] = []
  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('- ')) {
      clauses.push({ text: trimmed.slice(2).trim(), bullet: true })
      continue
    }

    let start = 0
    for (const boundary of trimmed.matchAll(/\.\s+/g)) {
      const end = boundary.index + 1
      const text = trimmed.slice(start, end).trim()
      if (text) clauses.push({ text, bullet: false })
      start = boundary.index + boundary[0].length
    }
    const trailing = trimmed.slice(start).trim()
    if (trailing) clauses.push({ text: trailing, bullet: false })
  }
  return clauses
}

function mergePendingContext(
  previous: PendingAnnotationContext | null,
  current: ParsedLine,
): PendingAnnotationContext {
  return {
    activation: current.hasActivationAnnotation
      ? current.activation
      : (previous?.activation ?? null),
    timings: current.hasTimingAnnotations
      ? current.timings
      : (previous?.timings ?? null),
    costs: [...(previous?.costs ?? []), ...current.annotationCosts],
  }
}

function unknownAction(text: string): EffectAction {
  return {
    kind: 'unknown',
    normalizedText: text.toLowerCase().replace(/\s+/g, ' ').trim(),
  }
}

function instance(
  source: EffectSource,
  activation: ActivationChannel,
  timing: readonly TimingModifier[],
  condition: RequirementExpression,
  costs: readonly EffectCost[],
  chooser: EffectChooser,
  optional: boolean,
  branches: readonly { readonly actions: readonly EffectAction[] }[],
): InstanceDraft {
  return {
    source,
    activation,
    timing,
    condition,
    costs,
    chooser,
    optional,
    branches,
  }
}

function finalizeChoice(
  choice: PendingChoice,
  drafts: InstanceDraft[],
): void {
  if (choice.branches.length === 0) return
  drafts.push(
    instance(
      choice.source,
      choice.activation,
      choice.timing,
      choice.condition,
      choice.costs,
      choice.chooser,
      choice.optional,
      choice.branches.map((actions) => ({
        actions: [...choice.commonActions, ...actions],
      })),
    ),
  )
}

function parseSource(
  rawText: string,
  source: EffectSource,
  diagnostics: string[],
): readonly InstanceDraft[] {
  const normalized = normalizeCardRulesText(rawText)
  if (!normalized) return []

  const drafts: InstanceDraft[] = []
  let pendingChoice: PendingChoice | null = null
  let continuationDraftIndex: number | null = null
  let pendingContext: PendingAnnotationContext | null = null

  for (const clause of tokenizeSourceText(normalized)) {
    if (clause.bullet && pendingChoice) {
      const inheritedSubject =
        pendingChoice.chooser === 'opponent' ? 'opponent' : 'player'
      const parsedBullet = parseLine(clause.text, source)
      if (parsedBullet.unsupportedLeadingSyntax) {
        pendingChoice.branches.push([unknownAction(clause.text)])
        diagnostics.push(clause.text)
        continue
      }
      const parsedActions = parseActions(
        parsedBullet.text,
        inheritedSubject,
        source,
      )
      const branchActions = [...parsedActions.actions]
      if (parsedActions.unparsedText) {
        branchActions.push(unknownAction(parsedActions.unparsedText))
        diagnostics.push(parsedActions.unparsedText)
      } else if (parsedActions.actions.length === 0) {
        branchActions.push(unknownAction(clause.text))
        diagnostics.push(clause.text)
      }
      pendingChoice.branches.push(branchActions)
      continue
    }

    if (pendingChoice) {
      finalizeChoice(pendingChoice, drafts)
      pendingChoice = null
      continuationDraftIndex = drafts.length - 1
    }

    const continuationMatch = clause.text.match(/^then\s*,?\s*(.+)$/i)
    if (continuationMatch && continuationDraftIndex !== null) {
      const parsedActions = parseActions(
        continuationMatch[1] ?? '',
        'player',
        source,
      )
      if (parsedActions.actions.length > 0) {
        const previous = drafts[continuationDraftIndex]
        if (previous) {
          drafts[continuationDraftIndex] = {
            ...previous,
            optional:
              previous.optional ||
              /\b(?:up to|you may)\b/i.test(continuationMatch[1] ?? ''),
            branches: previous.branches.map((branch) => ({
              actions: [...branch.actions, ...parsedActions.actions],
            })),
          }
        }
      }
      if (parsedActions.unparsedText) {
        diagnostics.push(parsedActions.unparsedText)
      } else if (parsedActions.actions.length === 0) {
        diagnostics.push(clause.text)
        continuationDraftIndex = null
      }
      continue
    }

    const currentLine = parseLine(clause.text, source)
    if (currentLine.unsupportedLeadingSyntax) {
      diagnostics.push(clause.text)
      pendingContext = null
      continuationDraftIndex = null
      continue
    }
    if (
      (currentLine.hasContextAnnotations ||
        currentLine.annotationCosts.length > 0) &&
      currentLine.keywords.length === 0 &&
      !currentLine.text
    ) {
      pendingContext = mergePendingContext(pendingContext, currentLine)
      continuationDraftIndex = null
      continue
    }

    const parsedLine = pendingContext
      ? {
          ...currentLine,
          activation: currentLine.hasActivationAnnotation
            ? currentLine.activation
            : (pendingContext.activation ?? currentLine.activation),
          timings: currentLine.hasTimingAnnotations
            ? currentLine.timings
            : (pendingContext.timings ?? currentLine.timings),
          annotationCosts: [
            ...pendingContext.costs,
            ...currentLine.annotationCosts,
          ],
        }
      : currentLine
    pendingContext = null

    for (const keyword of parsedLine.keywords) {
      drafts.push(
        instance(
          source,
          source === 'trigger' ? 'trigger' : 'static',
          parsedLine.timings,
          { kind: 'always' },
          [],
          'none',
          false,
          [{ actions: [{ kind: 'keyword', keyword }] }],
        ),
      )
      continuationDraftIndex = drafts.length - 1
    }

    const costResult = parseSharedCosts(parsedLine.text)
    const conditionResult = parseCondition(costResult.resultText)
    const choiceMatch = conditionResult.resultText.match(
      /(your opponent chooses one|(?:you\s+)?choose one)\s*:/i,
    )
    if (choiceMatch) {
      const chooser = /^your opponent/i.test(choiceMatch[1] ?? '')
        ? 'opponent'
        : 'player'
      const commonText = conditionResult.resultText
        .slice(0, choiceMatch.index)
        .replace(/,?\s*then\s*$/i, '')
        .trim()
      const commonResult = parseActions(commonText, 'player', source)
      if (commonResult.unparsedText) {
        diagnostics.push(commonResult.unparsedText)
      }
      pendingChoice = {
        source,
        activation: parsedLine.activation,
        timing: parsedLine.timings,
        condition: conditionResult.condition,
        costs: [...parsedLine.annotationCosts, ...costResult.costs],
        chooser,
        optional: /\b(?:up to|you may)\b/i.test(conditionResult.resultText),
        commonActions: commonResult.actions,
        branches: [],
      }
      continuationDraftIndex = null
      continue
    }

    const parsedActions = parseActions(
      conditionResult.resultText,
      'player',
      source,
    )
    if (parsedActions.actions.length > 0) {
      drafts.push(
        instance(
          source,
          parsedLine.activation,
          parsedLine.timings,
          conditionResult.condition,
          [...parsedLine.annotationCosts, ...costResult.costs],
          'none',
          /\b(?:up to|you may)\b/i.test(conditionResult.resultText),
          [{ actions: parsedActions.actions }],
        ),
      )
      continuationDraftIndex = drafts.length - 1
      if (parsedActions.unparsedText) {
        diagnostics.push(parsedActions.unparsedText)
      }
    } else if (parsedLine.keywords.length === 0 && parsedLine.text) {
      diagnostics.push(parsedLine.text)
      continuationDraftIndex = null
    }
  }

  if (pendingChoice) finalizeChoice(pendingChoice, drafts)
  return drafts
}

export function parseCardEffects(card: PlayableCard): CardEffectModel {
  const unparsedClauses: string[] = []
  const effectDrafts = parseSource(card.effect, 'effect', unparsedClauses)
  const triggerDrafts = parseSource(card.trigger, 'trigger', unparsedClauses)

  const withIds = (
    source: EffectSource,
    drafts: readonly InstanceDraft[],
  ): EffectInstance[] =>
    drafts.map((draft, index) => ({
      id: `${source}:${index}`,
      source: draft.source,
      activation: draft.activation,
      timing: draft.timing,
      condition: draft.condition,
      costs: draft.costs,
      chooser: draft.chooser,
      optional: draft.optional,
      branches: draft.branches,
      rainbowLuffyCompatibility: 'compatible',
    }))

  return createCardEffectModel({
    effects: [
      ...withIds('effect', effectDrafts),
      ...withIds('trigger', triggerDrafts),
    ],
    unparsedClauses,
  })
}
