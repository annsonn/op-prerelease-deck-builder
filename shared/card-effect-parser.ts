import type { PlayableCard } from './catalog.js'
import {
  createCardEffectModel,
  emptyCardPredicate,
  type ActivationChannel,
  type CardPredicate,
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
  readonly rainbowLuffyCompatibility:
    | 'compatible'
    | 'neutral'
    | 'incompatible'
  readonly unavailable: boolean
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

function parseCosts(text: string): {
  readonly costs: readonly EffectCost[]
  readonly resultText: string
  readonly supported: boolean
} {
  const separator = text.indexOf(':')
  const prefix = (separator < 0 ? text : text.slice(0, separator)).trim()
  if (
    separator >= 0 &&
    /\b(?:(?:your opponent|you)\s+)?chooses? one\s*$/i.test(prefix)
  ) {
    return { costs: [], resultText: text, supported: true }
  }
  if (
    separator >= 0 &&
    /\bor\s+(?=(?:DON!!\s*-\s*\d+|rest|trash|discard)\b)/i.test(prefix)
  ) {
    return { costs: [], resultText: text, supported: false }
  }
  const costs: EffectCost[] = []
  for (const match of prefix.matchAll(/DON!!\s*-\s*(\d+)/gi)) {
    costs.push({ kind: 'donMinus', amount: Number(match[1]) })
  }
  for (const match of prefix.matchAll(
    /rest\s+(\d+)\s+of your DON!! cards?/gi,
  )) {
    costs.push({ kind: 'restDon', amount: Number(match[1]) })
  }
  for (const match of prefix.matchAll(
    /(?:trash|discard)\s+(\d+)\s+cards?(?:\s+with\s+[^,:]+?)?\s+from your hand/gi,
  )) {
    costs.push({ kind: 'discardHand', amount: Number(match[1]) })
  }
  if (/trash this (?:card|character)/i.test(prefix)) {
    costs.push({ kind: 'trashSelf' })
  }
  if (
    /rest this (?:card|character)/i.test(prefix) ||
    /rest\s+\d+\s+of your DON!! cards?\s+and this character/i.test(prefix)
  ) {
    costs.push({ kind: 'restSelf' })
  }

  if (separator >= 0) {
    const unsupportedPrefix = prefix
      .replace(/DON!!\s*-\s*\d+/gi, '')
      .replace(/rest\s+\d+\s+of your DON!! cards?(?:\s+and this character)?/gi, '')
      .replace(/(?:trash|discard)\s+\d+\s+cards?(?:\s+with\s+[^,:]+?)?\s+from your hand/gi, '')
      .replace(/(?:trash|rest) this (?:card|character)/gi, '')
      .replace(/\byou may\b/gi, '')
      .replace(/\band\b/gi, '')
      .replace(/[\s,]+/g, '')
    if (unsupportedPrefix) {
      return { costs: [], resultText: text, supported: false }
    }
  }

  return costs.length > 0
    ? {
        costs,
        resultText:
          separator < 0 ? text : text.slice(separator + 1).trim(),
        supported: true,
      }
    : { costs: [], resultText: text, supported: separator < 0 }
}

const NUMBER_WORDS = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
])

function parseNumberToken(token: string | undefined): number | null {
  if (!token) return null
  if (/^\d+$/.test(token)) return Number(token)
  return NUMBER_WORDS.get(token.toLowerCase()) ?? null
}

function parseQuantity(text: string): number | 'all' | 'anyNumber' | null {
  const normalized = text.trim()
  if (/^any number\b/i.test(normalized)) return 'anyNumber'
  if (/^all\b/i.test(normalized)) return 'all'
  const match = normalized.match(
    /^(?:up to\s+)?(\d+|one|two|three)(?:\s+of)?\b/i,
  )
  if (match) return parseNumberToken(match[1])
  if (/^(?:this|a|an)\s+(?:card|character|stage|leader)\b/i.test(normalized)) {
    return 1
  }
  if (/^(?:your|your opponent's)\s+(?:leader|character|stage)\b/i.test(normalized)) {
    return 1
  }
  return null
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function maskExcludedSelfTargets(text: string): string {
  return text.replace(/other than this (?:card|character|stage)/gi, (match) =>
    ' '.repeat(match.length),
  )
}

function parsePredicate(text: string): CardPredicate {
  const names = [...text.matchAll(/\[([^\]]+)]/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(
      (name) =>
        name.length > 0 &&
        !['trigger', 'counter', 'blocker', 'rush', 'banish'].includes(
          name.toLowerCase(),
        ),
    )
  const traits = [
    ...[...text.matchAll(/\{([^}]+)}/g)].map(
      (match) => match[1]?.trim() ?? '',
    ),
    ...[...text.matchAll(/type including\s+["“”]([^"“”]+)["“”]/gi)].map(
      (match) => match[1]?.trim() ?? '',
    ),
  ].filter(Boolean)
  const cardTypes: ('LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE')[] = []
  if (/\bleaders?\b/i.test(text)) cardTypes.push('LEADER')
  if (/\bcharacters?\b/i.test(text)) cardTypes.push('CHARACTER')
  if (/\bevents?\b/i.test(text)) cardTypes.push('EVENT')
  if (/\bstages?\b/i.test(text)) cardTypes.push('STAGE')

  const maximumCost = text.match(
    /(?<!total )\b(?:base\s+)?cost(?:\s+of)?\s+(\d+)\s+or less\b/i,
  )
  const minimumCost = text.match(
    /\b(?:base\s+)?cost(?:\s+of)?\s+(\d+)\s+or more\b/i,
  )
  const maximumPower = text.match(
    /\b(?:base\s+)?power(?:\s+of)?\s+(\d+)\s+or less\b|\b(\d+)\s+(?:base\s+)?power\s+or less\b/i,
  )
  const minimumPower = text.match(
    /\b(?:base\s+)?power(?:\s+of)?\s+(\d+)\s+or more\b|\b(\d+)\s+(?:base\s+)?power\s+or more\b/i,
  )
  const exactPower = text.match(/\b(\d+)\s+base power\b(?!\s+or)/i)

  return {
    ...emptyCardPredicate(),
    names: unique(names),
    traits: unique(traits),
    cardTypes,
    minimumCost: minimumCost ? Number(minimumCost[1]) : null,
    maximumCost: maximumCost ? Number(maximumCost[1]) : null,
    minimumPower: exactPower
      ? Number(exactPower[1])
      : minimumPower
        ? Number(minimumPower[1] ?? minimumPower[2])
        : null,
    maximumPower: exactPower
      ? Number(exactPower[1])
      : maximumPower
        ? Number(maximumPower[1] ?? maximumPower[2])
        : null,
    counter: /without (?:a )?counter/i.test(text)
      ? 'withoutCounter'
      : /with (?:a )?counter/i.test(text)
        ? 'hasCounter'
        : 'any',
    hasTrigger: /with (?:a )?\[trigger]/i.test(text) ? true : null,
  }
}

function parseTargetSpec(
  text: string,
  options: {
    readonly zones: TargetSpec['zones']
    readonly fallbackSubject?: EffectSubject
    readonly quantity?: TargetSpec['quantity']
  },
): TargetSpec | null {
  const semanticText = maskExcludedSelfTargets(text)
  const explicitQuantity = options.quantity ?? parseQuantity(semanticText)
  if (explicitQuantity === null) return null

  const explicitSelf = /^\s*this (?:card|character|stage)\b/i.test(semanticText)
  const subject: EffectSubject = explicitSelf
    ? 'thisCard'
    : /\b(?:your opponent|opponent's)\b/i.test(semanticText)
      ? 'opponent'
      : /\b(?:your|you)\b/i.test(semanticText)
        ? 'player'
        : (options.fallbackSubject ?? 'unknown')
  const totalCost = semanticText.match(
    /\btotal cost of\s+(\d+)\s+or less\b/i,
  )

  return target({
    subject,
    zones: options.zones,
    quantity: explicitQuantity,
    predicate: parsePredicate(semanticText),
    differentNames: /\bdifferent (?:card )?names\b/i.test(semanticText),
    totalCostMaximum: totalCost ? Number(totalCost[1]) : null,
    allowsSelf: explicitSelf,
  })
}

function actionWithTarget(
  rawText: string,
  parsedTarget: TargetSpec | null,
  create: (parsedTarget: TargetSpec) => EffectAction,
): EffectAction {
  return parsedTarget ? create(parsedTarget) : unknownAction(rawText)
}

function addMatches(
  matches: ActionMatch[],
  text: string,
  expression: RegExp,
  action: (match: RegExpMatchArray) => EffectAction,
): void {
  for (const match of text.matchAll(expression)) {
    const start = match.index
    const end = start + match[0].length
    if (matches.some((existing) => start < existing.end && end > existing.index)) {
      continue
    }
    matches.push({
      index: start,
      end,
      action: action(match),
    })
  }
}

function parseDuration(text: string): TimingModifier | null {
  if (/until the end of your opponent's next end phase/i.test(text)) {
    return 'untilOpponentsNextEndPhase'
  }
  if (/on your opponent's turn/i.test(text)) return 'opponentsTurn'
  if (/during this (?:turn|battle)|until the end of this turn/i.test(text)) {
    return 'thisTurn'
  }
  return null
}

function parseActions(
  rawText: string,
  inheritedSubject: EffectSubject,
  source: EffectSource,
): ParsedActions {
  const text = maskExcludedSelfTargets(rawText)
  const matches: ActionMatch[] = []

  addMatches(
    matches,
    text,
    /\bboth players draw\s+(\d+)\s+cards?/gi,
    (match) => ({
      kind: 'draw',
      subject: 'bothPlayers',
      amount: Number(match[1]),
    }),
  )

  addMatches(
    matches,
    text,
    /look at\s+(\d+)\s+cards? from the top of your deck;?\s*reveal up to\s+(\d+)\s+(.+?)\s+and add (?:it|them) to your hand/gi,
    (match) => {
      const eligibleText = match[3] ?? ''
      return actionWithTarget(
        match[0],
        parseTargetSpec(`up to ${match[2]} ${eligibleText}`, {
          zones: ['deck'],
          fallbackSubject: 'player',
        }),
        (parsedTarget) => ({
        kind: 'filter',
        subject: 'player',
        lookedAt: Number(match[1]),
        kept: Number(match[2]),
          target: parsedTarget,
        }),
      )
    },
  )

  for (const match of text.matchAll(
    /negate the effect of\s+(.+?),?\s+and\s+KO that character/gi,
  )) {
    const targetText = match[1] ?? ''
    const sharedTarget = parseTargetSpec(targetText, {
      zones: ['field'],
      fallbackSubject: 'opponent',
    })
    const start = match.index
    const end = start + match[0].length
    if (!sharedTarget) {
      matches.push({
        index: start,
        end,
        action: unknownAction(match[0]),
      })
      continue
    }
    matches.push(
      {
        index: start,
        end,
        action: { kind: 'negateEffect', target: sharedTarget },
      },
      {
        index: start,
        end,
        action: {
          kind: 'remove',
          mode: 'ko',
          target: sharedTarget,
          powerDelta: null,
        },
      },
    )
  }

  addMatches(
    matches,
    text,
    /negate the effect of\s+((?:(?:up to\s+(?:\d+|one|two|three)|all|any number)\s+of\s+)?(?:your opponent's\s+)?characters?(?:[^.;]*?))(?:\.|$)/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({ kind: 'negateEffect', target: parsedTarget }),
      ),
  )

  addMatches(
    matches,
    text,
    /\b(?:KO|K\.O\.)\s+((?:(?:up to\s+(?:\d+|one|two|three)|any number|all)\s+of\s+)?(?:your opponent's\s+)?(?:rested\s+)?(?:characters?|stages?)(?:[^.;]*?))(?:\.|$)/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'remove',
          mode: 'ko',
          target: parsedTarget,
          powerDelta: null,
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /place\s+((?:(?:up to\s+(?:\d+|one|two|three)(?:\s+of)?|all\s+of|any number\s+of)\s+)?(?:your opponent's\s+)?(?:characters?|stages?)(?:[^.;]*?))\s+at the bottom of the owner's deck/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'remove',
          mode: 'bottomDeck',
          target: parsedTarget,
          powerDelta: null,
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /return\s+((?:(?:up to\s+(?:\d+|one|two|three)|all|any number)\s+of\s+)?(?:your opponent's\s+)?(?:characters?|stages?)(?:[^.;]*?))\s+to the owner's hand/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'remove',
          mode: 'returnHand',
          target: parsedTarget,
          powerDelta: null,
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /\brest\s+((?:(?:up to\s+(?:\d+|one|two|three)|all|any number)\s+of\s+)?(?:your opponent's\s+)(?:leader or\s+)?(?:characters?|stages?)(?:[^.;]*?))(?:\.|$)/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'remove',
          mode: 'rest',
          target: parsedTarget,
          powerDelta: null,
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /(?:give\s+)?((?:(?:up to\s+(?:\d+|one|two|three)(?:\s+of)?|all\s+of|any number\s+of)\s+)?your opponent's\s+(?:leader or\s+)?characters?(?:[^.;]*?))\s+-(\d+)\s+power\s+(during this turn|during this battle)/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'remove',
          mode: 'powerReduction',
          target: parsedTarget,
          powerDelta: -Number(match[2]),
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /((?:(?:up to\s+(?:\d+|one|two|three)|all|any number)\s+of\s+)?your opponent's characters(?:\s+with a (?:base )?cost of\s+\d+\s+or less)?)\s+cannot attack until the end of your opponent's next end phase/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'opponent',
        }),
        (parsedTarget) => ({
          kind: 'lockAttack',
          target: parsedTarget,
          duration: 'untilOpponentsNextEndPhase',
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /play\s+(this (?:card|character(?: card)?)|(?:(?:up to\s+)?(?:\d+|one|two|three)\s+)?(?:\{[^}]+}\s+type\s+)?(?:character\s+)?cards?(?:[^.;]*?)?)\s+from your\s+(hand(?:\s+or\s+trash)?|trash(?:\s+or\s+(?:your\s+)?hand)?)/gi,
    (match) => {
      const targetText = match[1] ?? ''
      const sourceText = (match[2] ?? '').toLowerCase()
      const zones: TargetSpec['zones'] = sourceText.includes('hand') && sourceText.includes('trash')
        ? ['hand', 'trash']
        : sourceText.includes('trash')
          ? ['trash']
          : ['hand']
      return actionWithTarget(
        match[0],
        parseTargetSpec(targetText, {
            zones,
            fallbackSubject: /^this /i.test(targetText)
              ? 'thisCard'
              : 'player',
        }),
        (parsedTarget) => ({ kind: 'deploy', target: parsedTarget }),
      )
    },
  )

  addMatches(
    matches,
    text,
    /play\s+(this (?:card|character))/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: [source === 'trigger' ? 'life' : 'hand'],
          fallbackSubject: 'thisCard',
        }),
        (parsedTarget) => ({ kind: 'deploy', target: parsedTarget }),
      ),
  )

  addMatches(
    matches,
    text,
    /play\s+((?:up to\s+)?(?:\d+|one|two|three)\s+(?:character\s+)?cards?)(?!\s+from)/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['hand'],
          fallbackSubject: 'player',
        }),
        (parsedTarget) => ({ kind: 'deploy', target: parsedTarget }),
      ),
  )

  addMatches(
    matches,
    text,
    /if\s+((?:this|one of your) characters?)\s+would be removed from the field(?: by your opponent's effect)?,\s+you may\s+.+?\s+instead/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'player',
          quantity: 1,
        }),
        (parsedTarget) => ({ kind: 'protect', target: parsedTarget }),
      ),
  )

  addMatches(
    matches,
    text,
    /this character gains\s+\[(rush|blocker|banish)]/gi,
    (match) => ({
      kind: 'keyword',
      keyword: (match[1] ?? '').toLowerCase() as
        | 'rush'
        | 'blocker'
        | 'banish',
    }),
  )

  addMatches(
    matches,
    text,
    /(this card in your hand) has (?:a\s+)?\+(\d+)\s+counter/gi,
    (match) => ({
      kind: 'counterModifier',
      amount: Number(match[2]),
      target: target({
        subject: 'thisCard',
        zones: ['hand'],
        quantity: 1,
        allowsSelf: true,
      }),
    }),
  )

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
    /add\s+(?:up to\s+)?(\d+)\s+cards?(?: from the top of your deck)? to (?:the top of )?your life(?: cards?)?/gi,
    (match) => ({
      kind: 'lifeMove',
      direction: 'gainOwnLife',
      amount: Number(match[1]),
    }),
  )
  addMatches(
    matches,
    text,
    /add\s+(?:up to\s+)?(\d+)\s+cards? from (?:the top of )?your opponent's life(?: cards?)? to (?:their|the owner's) hand/gi,
    (match) => ({
      kind: 'lifeMove',
      direction: 'opponentLifeToHand',
      amount: Number(match[1]),
    }),
  )

  addMatches(matches, text, /set up to\s+(\d+)\s+of your DON!! cards as active/gi, (match) => ({
    kind: 'donChange',
    mode: 'refresh',
    amount: Number(match[1]),
  }))

  addMatches(matches, text, /add up to\s+(\d+)\s+DON!! cards? from your DON!! deck and set (?:it|them) as active/gi, (match) => ({
    kind: 'donChange',
    mode: 'rampActive',
    amount: Number(match[1]),
  }))

  addMatches(matches, text, /add up to\s+(\d+)\s+DON!! cards? from your DON!! deck and rest (?:it|them)/gi, (match) => ({
    kind: 'donChange',
    mode: 'rampRested',
    amount: Number(match[1]),
  }))

  addMatches(
    matches,
    text,
    /((?:all|up to\s+(?:\d+|one|two|three))\s+of your (?:characters?|character cards?) without a counter)\s+(?:have|gain)\s+(?:a\s+)?\+(\d+)\s+counter/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'player',
        }),
        (parsedTarget) => ({
          kind: 'counterModifier',
          amount: Number(match[2]),
          target: parsedTarget,
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /(?:give\s+)?((?:(?:up to\s+(?:\d+|one|two|three)\s+of\s+)?your\s+(?:leader(?:\s+or\s+characters?)?|characters?)|this character))\s+(?:gains?|gets?)\s+([+-]\d+)\s+power(?:\s+(during this (?:turn|battle)|on your opponent's turn))?/gi,
    (match) =>
      actionWithTarget(
        match[0],
        parseTargetSpec(match[1] ?? '', {
          zones: ['field'],
          fallbackSubject: 'player',
        }),
        (parsedTarget) => ({
          kind: 'powerModifier',
          powerDelta: Number(match[2]),
          target: parsedTarget,
          duration: parseDuration(match[3] ?? '') ?? 'thisTurn',
        }),
      ),
  )

  addMatches(
    matches,
    text,
    /gains\s+([+-]\d+)\s+power\s+(on your opponent's turn|during this turn)/gi,
    (match) =>
      /^this character gains\s+[+-]\d+\s+cost\s+and\s*$/i.test(
        text.slice(0, match.index),
      )
        ? {
            kind: 'powerModifier',
            powerDelta: Number(match[1]),
            target: target({
              subject: 'thisCard',
              zones: ['field'],
              quantity: 1,
              predicate: {
                ...emptyCardPredicate(),
                cardTypes: ['CHARACTER'],
              },
              allowsSelf: true,
            }),
            duration: parseDuration(match[2] ?? '') ?? 'thisTurn',
          }
        : unknownAction(match[0]),
  )

  addMatches(
    matches,
    text,
    /your (?:(?:\[[^\]]+]|\{[^}]+})\s+|mono-colored\s+)?leader's base power becomes\s+(\d+)\s+(until the end of your opponent's next end phase|during this turn)/gi,
    (match) => ({
      kind: 'leaderBasePower',
      powerDelta: Number(match[1]) - 5_000,
      duration: parseDuration(match[2] ?? '') ?? 'thisTurn',
    }),
  )

  addMatches(
    matches,
    text,
    /the base power of\s+(.+?)\s+and\s+(\d+)\s+base power becomes\s+(\d+)/gi,
    (match) => {
      const originalPower = Number(match[2])
      const targetText = `${match[1] ?? ''} and ${originalPower} base power`
      return actionWithTarget(
        match[0],
        parseTargetSpec(targetText, {
            zones: ['field'],
            fallbackSubject: 'player',
        }),
        (parsedTarget) => ({
          kind: 'powerModifier',
          powerDelta: Number(match[3]) - originalPower,
          target: parsedTarget,
          duration: parseDuration(text) ?? 'thisTurn',
        }),
      )
    },
  )

  const ordered = matches.sort((left, right) => left.index - right.index)
  if (
    ordered.length === 0 &&
    /\b(?:draw|look at|KO|K\.O\.|place|return|rest|give|negate|play|trash|discard|add|set|gain|has|cannot attack)\b/i.test(
      text,
    )
  ) {
    return { actions: [unknownAction(rawText)], unparsedText: rawText }
  }
  const residue = rawText.split('')
  for (const match of ordered) {
    if (match.action.kind !== 'unknown') {
      residue.fill(' ', match.index, match.end)
    }
  }
  const unparsedText = residue
    .join('')
    .replace(/\s+([,;:.])/g, '$1')
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
  if (
    /^\s*if\s+(?:this|one of your) characters?(?: other than this character)?\s+would be removed/i.test(
      text,
    )
  ) {
    return { condition: { kind: 'always' }, resultText: text }
  }

  const match = text.match(/^\s*(if\s+[^,]+),\s*(.+)$/i)
  if (!match) {
    const namedLeaderTarget = text.match(
      /your\s+(?:\[([^\]]+)]|\{([^}]+)})\s+leader/i,
    )
    if (/\bmono-colored leader\b/i.test(text) || namedLeaderTarget) {
      return {
        condition: {
          kind: 'leader',
          names: namedLeaderTarget?.[1] ? [namedLeaderTarget[1]] : [],
          traits: namedLeaderTarget?.[2] ? [namedLeaderTarget[2]] : [],
          monoColorRequired: /\bmono-colored leader\b/i.test(text),
        },
        resultText: text,
      }
    }
    return { condition: { kind: 'always' }, resultText: text }
  }

  const requirementText = match[1] ?? ''

  return {
    condition: parseRequirement(requirementText),
    resultText: match[2] ?? '',
  }
}

function cardRequirement(text: string): RequirementExpression | null {
  const countMatch = text.match(/\byou have\s+(\d+)\s+or more\s+(.+)$/i)
  if (countMatch) {
    const targetSpec = parseTargetSpec(`a ${countMatch[2] ?? ''}`, {
      zones: ['field'],
      fallbackSubject: 'player',
      quantity: 1,
    })
    return targetSpec
      ? {
          kind: 'cards',
          target: targetSpec,
          minimumCount: Number(countMatch[1]),
        }
      : null
  }

  const oneMatch = text.match(
    /\b(you have|there is)\s+(?:a|one)\s+(.+)$/i,
  )
  if (!oneMatch) return null
  const targetSpec = parseTargetSpec(`a ${oneMatch[2] ?? ''}`, {
    zones: ['field'],
    fallbackSubject: /^there is$/i.test(oneMatch[1] ?? '')
      ? 'bothPlayers'
      : 'player',
    quantity: 1,
  })
  return targetSpec
    ? { kind: 'cards', target: targetSpec, minimumCount: 1 }
    : null
}

function parseRequirement(text: string): RequirementExpression {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (/^if this character was played (?:on|during) this turn$/i.test(normalized)) {
    return { kind: 'selfState', state: 'playedThisTurn' }
  }

  const logical = normalized.match(
    /^if (.+?)\s+(and|or)\s+((?:you have|there is|your leader|an unfamiliar condition)\b.+)$/i,
  )
  if (logical) {
    return {
      kind: /^and$/i.test(logical[2] ?? '') ? 'all' : 'any',
      children: [
        parseRequirement(`if ${logical[1] ?? ''}`),
        parseRequirement(`if ${logical[3] ?? ''}`),
      ],
    }
  }

  if (/\byour leader\b/i.test(normalized)) {
    const names = [...normalized.matchAll(/\[([^\]]+)]/g)].map(
      (match) => match[1]?.trim() ?? '',
    ).filter(Boolean)
    const traits = [
      ...normalized.matchAll(/\{([^}]+)}/g),
      ...normalized.matchAll(/type including\s+["“”]([^"“”]+)["“”]/gi),
    ].map((match) => match[1]?.trim() ?? '').filter(Boolean)
    if (names.length > 0 || traits.length > 0 || /mono-colored/i.test(normalized)) {
      return {
        kind: 'leader',
        names: unique(names),
        traits: unique(traits),
        monoColorRequired: /mono-colored/i.test(normalized),
      }
    }
  }

  if (/^if you only have characters without (?:a )?counter$/i.test(normalized)) {
    const targetSpec = parseTargetSpec(
      'all of your Characters without a Counter',
      {
        zones: ['field'],
        fallbackSubject: 'player',
      },
    )
    if (targetSpec) {
      return { kind: 'cards', target: targetSpec, minimumCount: 1 }
    }
  }

  const compound = normalized.match(
    /^if you have (a .+?) and (a .+)$/i,
  )
  if (compound) {
    const children = [compound[1], compound[2]]
      .map((part) => cardRequirement(`if you have ${part ?? ''}`))
      .filter((child): child is RequirementExpression => child !== null)
    if (children.length === 2) return { kind: 'all', children }
  }

  const cards = cardRequirement(normalized)
  if (cards) return cards

  return {
    kind: 'unknown',
    normalizedText: normalized.toLowerCase(),
  }
}

function effectCompatibility(
  requirement: RequirementExpression,
): 'compatible' | 'neutral' | 'incompatible' {
  if (requirement.kind === 'leader') return 'incompatible'
  if (requirement.kind === 'all') {
    const children = requirement.children.map(effectCompatibility)
    if (children.includes('incompatible')) return 'incompatible'
    return children.includes('neutral') ? 'neutral' : 'compatible'
  }
  if (requirement.kind === 'any') {
    const children = requirement.children.map(effectCompatibility)
    if (children.includes('compatible')) return 'compatible'
    return children.includes('neutral') ? 'neutral' : 'incompatible'
  }
  return requirement.kind === 'unknown' ? 'neutral' : 'compatible'
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
  unavailable = false,
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
    rainbowLuffyCompatibility: effectCompatibility(condition),
    unavailable,
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
      const previous = drafts[continuationDraftIndex]
      if (previous?.unavailable) {
        diagnostics.push(clause.text)
        continue
      }
      const parsedActions = parseActions(
        continuationMatch[1] ?? '',
        'player',
        source,
      )
      if (parsedActions.actions.length > 0) {
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
          hasActivationAnnotation:
            currentLine.hasActivationAnnotation ||
            pendingContext.activation !== null,
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

    const parsedRuleText =
      parsedLine.annotationCosts.length > 0
        ? parsedLine.text.replace(/^:\s*/, '')
        : parsedLine.text
    const leadingCondition = parseCondition(parsedRuleText)
    const leadingCost = parseCosts(leadingCondition.resultText)
    const conditionPrecedesCost =
      leadingCondition.condition.kind !== 'always' ||
      leadingCondition.resultText !== parsedRuleText
    const costResult =
      conditionPrecedesCost ? leadingCost : parseCosts(parsedRuleText)
    const conditionResult =
      conditionPrecedesCost
        ? leadingCondition
        : parseCondition(costResult.resultText)
    const actionText = conditionPrecedesCost
      ? costResult.resultText
      : conditionResult.resultText
    if (!costResult.supported) {
      drafts.push(
        instance(
          source,
          parsedLine.activation,
          parsedLine.timings,
          conditionResult.condition,
          parsedLine.annotationCosts,
          'none',
          /\b(?:up to|you may)\b/i.test(parsedLine.text),
          [{ actions: [unknownAction(parsedLine.text)] }],
          true,
        ),
      )
      diagnostics.push(parsedLine.text)
      continuationDraftIndex = drafts.length - 1
      continue
    }
    const choiceMatch = actionText.match(
      /(your opponent chooses one|(?:you\s+)?choose one)\s*:/i,
    )
    if (choiceMatch) {
      const chooser = /^your opponent/i.test(choiceMatch[1] ?? '')
        ? 'opponent'
        : 'player'
      const commonText = actionText
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
        optional: /\b(?:up to|you may)\b/i.test(parsedLine.text),
        commonActions: commonResult.actions,
        branches: [],
      }
      continuationDraftIndex = null
      continue
    }

    const parsedActions = parseActions(
      actionText,
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
          /\b(?:up to|you may)\b/i.test(parsedLine.text),
          [{ actions: parsedActions.actions }],
        ),
      )
      continuationDraftIndex = drafts.length - 1
      if (parsedActions.unparsedText) {
        diagnostics.push(parsedActions.unparsedText)
      }
    } else if (parsedLine.keywords.length === 0 && parsedLine.text) {
      diagnostics.push(actionText)
      const hasOwnedContext =
        parsedLine.hasActivationAnnotation ||
        parsedLine.annotationCosts.length > 0 ||
        costResult.costs.length > 0 ||
        conditionResult.condition.kind !== 'always'
      if (hasOwnedContext) {
        drafts.push(
          instance(
            source,
            parsedLine.activation,
            parsedLine.timings,
            conditionResult.condition,
            [...parsedLine.annotationCosts, ...costResult.costs],
            'none',
            /\b(?:up to|you may)\b/i.test(parsedLine.text),
            [{ actions: [unknownAction(actionText)] }],
          ),
        )
        continuationDraftIndex = drafts.length - 1
      } else {
        continuationDraftIndex = null
      }
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
      rainbowLuffyCompatibility: draft.rainbowLuffyCompatibility,
    }))

  return createCardEffectModel({
    effects: [
      ...withIds('effect', effectDrafts),
      ...withIds('trigger', triggerDrafts),
    ],
    unparsedClauses,
  })
}
