import { describe, expect, it } from 'vitest'

import type { PlayableCard } from './catalog.js'
import {
  cardFeatureKeys,
  cardFeaturesSchema,
  classifyCardFeatures,
  supportRequirementFlagKeys,
  type CardFeatureKey,
} from './card-features.js'

function card(overrides: Partial<PlayableCard> = {}): PlayableCard {
  return {
    cardNumber: 'OP17-001',
    name: 'Test Card',
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP17'],
    variantsCollapsed: 1,
    entryShortcut: '001',
    isSpecialReprint: false,
    ...overrides,
  }
}

function expectFlag(
  key: CardFeatureKey,
  positive: Partial<PlayableCard>,
  negative: Partial<PlayableCard>,
): void {
  expect(classifyCardFeatures(card(positive)).flags[key]).toBe(true)
  expect(classifyCardFeatures(card(negative)).flags[key]).toBe(false)
}

describe('classifyCardFeatures', () => {
  it('publishes parsed v2 metadata without changing legacy summary semantics', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] Draw 1 card. Then, K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.effectModelVersion).toBe(2)
    expect(features.effectParserRevision).toBe(1)
    expect(features.effects).toHaveLength(1)
    expect(
      features.effects[0]?.branches[0]?.actions.map(({ kind }) => kind),
    ).toEqual(['draw', 'remove'])
    expect(features.flags).toMatchObject({
      draw: true,
      removal: true,
      twoForOne: false,
    })
    expect(features.rainbowUsableFlags).toMatchObject({
      draw: true,
      removal: true,
    })
    expect(cardFeaturesSchema.parse(features)).toEqual(features)
    expect(Object.isFrozen(features.effects[0]?.branches[0]?.actions)).toBe(true)
  })

  it.each([
    {
      label: 'unconditional',
      overrides: { effect: '[On Play] Draw 1 card.' },
      flags: ['draw'],
      usableFlags: ['draw'],
      compatibility: 'compatible',
      supportRequirements: {},
      requiredNames: [],
      evidence: ['draw'],
    },
    {
      label: 'Leader-incompatible',
      overrides: {
        effect:
          "[On Play] If your Leader is [Nami], K.O. up to 1 of your opponent's Characters.",
      },
      flags: ['removal', 'comboDependent'],
      usableFlags: [],
      compatibility: 'incompatible',
      supportRequirements: {},
      requiredNames: ['Nami'],
      evidence: ['comboDependent', 'removal'],
    },
    {
      label: 'generic-conditional',
      overrides: {
        effect:
          "[On Play] If your opponent has 5 Characters, set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
      },
      flags: ['removal', 'massRest', 'donRefresh', 'comboDependent'],
      usableFlags: ['removal', 'donRefresh', 'comboDependent'],
      compatibility: 'neutral',
      supportRequirements: { removal: { requiredNames: [], requiredTraits: [] } },
      requiredNames: [],
      evidence: ['comboDependent', 'donRefresh', 'massRest', 'removal'],
    },
    {
      label: 'Trigger-only',
      overrides: { trigger: '[Trigger] Draw 1 card.' },
      flags: ['draw'],
      usableFlags: ['draw'],
      compatibility: 'compatible',
      supportRequirements: {},
      requiredNames: [],
      evidence: ['draw'],
    },
    {
      label: 'mixed-clause',
      overrides: {
        effect:
          '[Blocker]<br/>[On Play] If you have a Character named [Missing Ally], draw 1 card.',
      },
      flags: ['blocker', 'draw', 'comboDependent'],
      usableFlags: ['blocker', 'draw', 'comboDependent'],
      compatibility: 'neutral',
      supportRequirements: {
        draw: { requiredNames: ['Missing Ally'], requiredTraits: [] },
      },
      requiredNames: ['Missing Ally'],
      evidence: ['blocker', 'comboDependent', 'draw'],
    },
  ] as const)(
    'preserves the exact legacy summary for $label text',
    ({
      overrides,
      flags: enabledFlags,
      usableFlags,
      compatibility,
      supportRequirements,
      requiredNames,
      evidence,
    }) => {
      const features = classifyCardFeatures(card(overrides))
      const enabledFlagSet = new Set<CardFeatureKey>(enabledFlags)
      const usableFlagSet = new Set<CardFeatureKey>(usableFlags)
      const flags = Object.fromEntries(
        cardFeatureKeys.map((key) => [key, enabledFlagSet.has(key)]),
      )
      const rainbowUsableFlags = Object.fromEntries(
        cardFeatureKeys.map((key) => [key, usableFlagSet.has(key)]),
      )
      const supportRequirementsByFlag = Object.fromEntries(
        supportRequirementFlagKeys.map((key) => [
          key,
          key in supportRequirements
            ? supportRequirements[key as keyof typeof supportRequirements]
            : null,
        ]),
      )

      expect({
        flags: features.flags,
        rainbowUsableFlags: features.rainbowUsableFlags,
        supportRequirementsByFlag: features.supportRequirementsByFlag,
        rainbowLuffyCompatibility: features.rainbowLuffyCompatibility,
        searchableTraits: features.searchableTraits,
        searchableNames: features.searchableNames,
        requiredTraits: features.requiredTraits,
        requiredNames: features.requiredNames,
        evidence: features.evidence,
      }).toEqual({
        flags,
        rainbowUsableFlags,
        supportRequirementsByFlag,
        rainbowLuffyCompatibility: compatibility,
        searchableTraits: [],
        searchableNames: [],
        requiredTraits: [],
        requiredNames,
        evidence,
      })
    },
  )

  it('publishes the complete stable feature vocabulary', () => {
    expect(cardFeatureKeys).toEqual([
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
    ])
  })

  it('publishes stable per-claim support requirement keys', () => {
    expect(supportRequirementFlagKeys).toEqual([
      'blocker',
      'draw',
      'removal',
      'rush',
      'banish',
      'twoForOne',
      'searcher',
    ])
  })

  it('attributes target dependencies to the affected claim rather than the whole card', () => {
    const mixed = classifyCardFeatures(
      card({
        effect:
          '[Blocker] [On Play] If you have a Character named [Missing Ally], draw 1 card.',
      }),
    )
    const conditionalBlocker = classifyCardFeatures(
      card({
        effect:
          'If you have a Character named [Missing Ally], this Character gains [Blocker].',
      }),
    )

    expect(mixed.supportRequirementsByFlag.blocker).toBeNull()
    expect(mixed.supportRequirementsByFlag.draw).toEqual({
      requiredNames: ['Missing Ally'],
      requiredTraits: [],
    })
    expect(conditionalBlocker.supportRequirementsByFlag.blocker).toEqual({
      requiredNames: ['Missing Ally'],
      requiredTraits: [],
    })
  })

  it('carries target dependencies through suffix conditions and Then continuations', () => {
    const suffix = classifyCardFeatures(
      card({
        effect:
          'Draw 1 card if you have a Character named [Missing Ally].',
      }),
    )
    const continuation = classifyCardFeatures(
      card({
        effect:
          'If you have a Character named [Missing Ally], return 1 DON!! card to your DON!! deck. Then, draw 1 card.',
      }),
    )

    expect(suffix.supportRequirementsByFlag.draw?.requiredNames).toEqual([
      'Missing Ally',
    ])
    expect(continuation.supportRequirementsByFlag.draw?.requiredNames).toEqual([
      'Missing Ally',
    ])
  })

  it('classifies an overlapping high-impact character', () => {
    const features = classifyCardFeatures(
      card({
        cost: 7,
        power: 8000,
        counter: 2000,
        effect:
          "[Blocker]<br/>[On Play] Draw 1 card. K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.flags).toMatchObject({
      twoKCounter: true,
      blocker: true,
      draw: true,
      removal: true,
      boss: true,
      brick: false,
    })
  })

  it('classifies the exact OP17-022 board swing text', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-022',
        name: 'Shanks',
        cost: 10,
        power: 12000,
        counter: 0,
        effect:
          "[Rush]<br/>[On Play] Set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
      }),
    )

    expect(features.flags).toMatchObject({
      rush: true,
      removal: true,
      boss: true,
      brick: true,
      massRest: true,
      donRefresh: true,
    })
    expect(features.rainbowUsableFlags).toMatchObject({
      massRest: true,
      donRefresh: true,
    })
    expect(features.evidence).toEqual(
      expect.arrayContaining(['massRest', 'donRefresh']),
    )
  })

  it.each([
    "Rest all of your opponent's Character.",
    "Then, rest all of your opponent's Characters.",
    "Rest all of your\nopponent's Characters.",
  ])('classifies imperative global opponent rest text: %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags).toMatchObject({
      massRest: true,
    })
  })

  it.each([
    'Set 1 of your DON!! card as active.',
    'Set up to 10 of your DON!! cards as active.',
    'Set up to 2 of your\nDON!! cards as active.',
  ])('classifies bounded imperative DON refresh text: %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags).toMatchObject({
      donRefresh: true,
    })
  })

  it.each([
    "Rest up to 2 of your opponent's Characters.",
    "You may rest all of your opponent's Characters.",
    "If you rest all of your opponent's Characters, draw 1 card.",
    'Rest all of your Characters.',
    'Rest all of your opponents Characters.',
    "All of your opponent's Characters are rested.",
    "Your opponent may rest all of your opponent's Characters.",
    "Rest all of your opponent's DON!! cards.",
    "Your opponent's Characters cannot be set as active.",
  ])('does not classify non-imperative or non-global rest text: %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags).toMatchObject({
      massRest: false,
      donRefresh: false,
    })
  })

  it.each([
    'Set up to 0 of your DON!! cards as active.',
    'Set up to 11 of your DON!! cards as active.',
    'You may set up to 2 of your DON!! cards as active.',
    'Set up to 2 of your Characters as active.',
    'Set 2 DON!! cards as active.',
    'Set up to 1 DON!! from your DON!! deck as active.',
    'Set up to 1 of your Leader as active.',
    'Give up to 2 rested DON!! cards to your Leader.',
    'Rest 2 of your DON!! cards.',
    "Set up to 2 of your opponent's DON!! cards as active.",
  ])('does not classify out-of-bound or non-imperative DON refresh text: %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags).toMatchObject({
      massRest: false,
      donRefresh: false,
    })
  })

  it('suppresses incompatible Leader-conditional board swing effects and Then continuations', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] If your Leader is [Nami], set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
      }),
    )

    expect(features.flags).toMatchObject({
      massRest: true,
      donRefresh: true,
    })
    expect(features.rainbowUsableFlags).toMatchObject({
      massRest: false,
      donRefresh: false,
    })
  })

  it('preserves generic conditional premium effects without counting them as Rainbow-usable', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] If your opponent has 5 Characters, set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
      }),
    )

    expect(features.rainbowLuffyCompatibility).toBe('neutral')
    expect(features.flags).toMatchObject({
      massRest: true,
      donRefresh: true,
    })
    expect(features.rainbowUsableFlags).toMatchObject({
      massRest: false,
      donRefresh: true,
    })
  })

  it('rejects a compound Leader trait condition for Rainbow Luffy', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          '[On Play] If your Leader has the {FILM} or {Straw Hat Crew} type, set up to 2 of your DON!! cards as active.',
      }),
    )

    expect(features.rainbowLuffyCompatibility).toBe('incompatible')
    expect(features.requiredTraits).toEqual(['FILM', 'Straw Hat Crew'])
    expect(features.flags).toMatchObject({ donRefresh: true })
    expect(features.rainbowUsableFlags).toMatchObject({ donRefresh: false })
  })

  it('rejects a Leader-is-mono-colored condition and its Then continuation', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] If your Leader is mono-colored, set up to 2 of your DON!! cards as active. Then, rest all of your opponent's Characters.",
      }),
    )

    expect(features.rainbowLuffyCompatibility).toBe('incompatible')
    expect(features.flags).toMatchObject({
      massRest: true,
      donRefresh: true,
    })
    expect(features.rainbowUsableFlags).toMatchObject({
      massRest: false,
      donRefresh: false,
    })
  })

  it('classifies each independent flag with a positive and negative boundary', () => {
    expectFlag('twoKCounter', { counter: 2000 }, { counter: 1999 })
    expectFlag('blocker', { effect: '[Blocker]' }, { effect: '[Blockade]' })
    expectFlag(
      'vanillaLike',
      { cost: 3, power: 5000 },
      { cost: 3, power: 5000, effect: 'If your Leader is [Nami], draw 1 card.' },
    )
    expectFlag('draw', { effect: 'Draw 1 card.' }, { effect: 'Add 1 card to your hand.' })
    expectFlag(
      'boss',
      { cost: 7, power: 7000, effect: '[Rush]' },
      { cost: 7, power: 7000 },
    )
    expectFlag('rush', { effect: '[Rush]' }, { effect: 'Rush your turn.' })
    expectFlag('banish', { effect: '[Banish]' }, { effect: 'Banish this card.' })
    expectFlag('twoForOne', { effect: 'Draw 2 cards.' }, { effect: 'Draw 1 card.' })
    expectFlag(
      'searcher',
      {
        effect:
          'Look at 5 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type card and add it to your hand.',
      },
      { effect: 'Reveal 1 card and add it to your hand.' },
    )
    expectFlag(
      'comboDependent',
      { effect: 'If your Leader is [Nami], draw 1 card.' },
      { effect: '[On Play] Draw 1 card.' },
    )
    expectFlag('brick', { counter: 0 }, { counter: 1000 })
  })

  it('recognizes the qualified Rush keyword without matching a lookalike', () => {
    expect(
      classifyCardFeatures(
        card({
          cardNumber: 'OP17-027',
          effect:
            "[Rush: Character]<br/>[On Play] If your Leader has the {Red-Haired Pirates} type, draw 1 card and rest up to 2 of your opponent's Characters.",
        }),
      ).flags.rush,
    ).toBe(true)
    expect(
      classifyCardFeatures(card({ effect: '[Rushdown: Character]' })).flags.rush,
    ).toBe(false)
  })

  it.each([
    "K.O. up to 1 of your opponent's Characters.",
    "Return up to 1 of your opponent's Characters to the owner's hand.",
    "Place up to 1 of your opponent's Characters at the bottom of the owner's deck.",
    "Rest up to 1 of your opponent's Characters.",
    "Up to 1 of your opponent's Characters gets −2000 power during this turn.",
  ])('detects %s as interaction removal', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags.removal).toBe(true)
  })

  it.each([
    "[On Play] Rest up to 1 of your opponent's cards. <br/> [Activate: Main] You may trash this Character: If your Leader has the {Straw Hat Crew} type, set up to 1 of your Characters with a base cost of 8 or less as active.",
    "[On Your Opponent's Attack] You may trash this Character: Rest up to 1 of your opponent's Leader or Characters.",
    "[Main] You may rest 5 of your DON!! cards: Return up to 1 Character with a cost of 6 or less to the owner's hand.<br/>[Counter] Up to 1 of your Leader with a type including \"Rocks Pirates\" gains +2000 power during this battle.",
  ])('detects real sealed interaction wording in %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags.removal).toBe(true)
  })

  it.each([
    'Rest this Character.',
    'You may rest 2 of your DON!! cards.',
    "Return up to 1 of your Characters to the owner's hand.",
    "You may return 1 of your Characters to the owner's hand: Draw 2 cards.",
  ])('does not treat self-owned interaction text as removal: %s', (effect) => {
    expect(classifyCardFeatures(card({ effect })).flags.removal).toBe(false)
  })

  it('does not classify a non-opponent rest effect as removal', () => {
    expect(
      classifyCardFeatures(card({ effect: 'Rest this Character.' })).flags.removal,
    ).toBe(false)
  })

  it('recognizes K.O. removal of an opponent Stage without matching a self-Stage cost', () => {
    expect(
      classifyCardFeatures(
        card({
          cardNumber: 'OP17-017',
          cardType: 'EVENT',
          effect:
            "[Main] You may rest 2 of your DON!! cards: K.O. up to 1 of your opponent's Stages.<br/>[Counter] If you have 2 or more Characters with 8000 power, up to 1 of your Leader or Character cards gains +4000 power during this battle.",
        }),
      ).flags.removal,
    ).toBe(true)
    expect(
      classifyCardFeatures(card({ effect: 'K.O. this Stage: Draw 1 card.' }))
        .flags.removal,
    ).toBe(false)
  })

  it('does not confuse Blocker prose with the Blocker keyword', () => {
    expect(
      classifyCardFeatures(
        card({ effect: 'This Character cannot be blocked by a Blocker.' }),
      ).flags.blocker,
    ).toBe(false)
  })

  it('does not classify a self-K.O. cost as opponent removal', () => {
    expect(
      classifyCardFeatures(
        card({
          effect:
            "K.O. this Character: Draw 2 cards. Your opponent's Characters cannot attack during this turn.",
        }),
      ).flags.removal,
    ).toBe(false)
  })

  it('does not treat a sequential if-you-do clause as a combo dependency', () => {
    const features = classifyCardFeatures(
      card({
        cost: 3,
        power: 5000,
        effect: 'Rest this Character. If you do, draw 1 card.',
      }),
    )

    expect(features.flags.comboDependent).toBe(false)
    expect(features.flags.vanillaLike).toBe(true)
    expect(features.rainbowLuffyCompatibility).toBe('compatible')
  })

  it('does not classify Events or Stages as bricks solely for lacking counter', () => {
    expect(
      classifyCardFeatures(card({ cardType: 'EVENT', counter: null })).flags.brick,
    ).toBe(false)
    expect(
      classifyCardFeatures(card({ cardType: 'STAGE', counter: 0 })).flags.brick,
    ).toBe(false)
  })

  it('collects stable search targets and conditional requirements', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          'Look at 5 cards from the top of your deck; reveal up to 1 {Heart Pirates} type card or a card named [Trafalgar Law] and add it to your hand. If your Leader has the {Straw Hat Crew} type and you have a Character named [Tony Tony.Chopper], draw 1 card.',
      }),
    )

    expect(features.searchableTraits).toEqual(['Heart Pirates'])
    expect(features.searchableNames).toEqual(['Trafalgar Law'])
    expect(features.requiredTraits).toEqual(['Straw Hat Crew'])
    expect(features.requiredNames).toEqual(['Tony Tony.Chopper'])
  })

  it('extracts quoted search traits without treating exclusions as targets', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP03-003',
        effect:
          '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 card with a type including "Whitebeard Pirates" other than [Izo] and add it to your hand. Then, place the rest at the bottom of your deck in any order.',
      }),
    )

    expect(features.flags.searcher).toBe(true)
    expect(features.searchableTraits).toEqual(['Whitebeard Pirates'])
    expect(features.searchableNames).toEqual([])
  })

  it('extracts quoted required traits and positive names but not exclusions', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          'If you have a Character named [Kuzan] other than [Koby] with a type including “Navy”, draw 1 card.',
      }),
    )

    expect(features.requiredTraits).toEqual(['Navy'])
    expect(features.requiredNames).toEqual(['Kuzan'])
  })

  it.each([
    [
      'straight quotes',
      'If your Leader\'s card name includes "Ace" and you have 6 or more DON!! cards on your field, give this card in your hand −2 cost. <br/> [On Your Opponent\'s Attack] You may trash 1 Character card with 8000 power from your hand: Your Leader and this Character\'s base power becomes 7000 during this turn.',
    ],
    [
      'curly quotes',
      'If your Leader’s card name includes “Ace” and you have 6 or more DON!! cards on your field, give this card in your hand −2 cost. <br/> [On Your Opponent\'s Attack] You may trash 1 Character card with 8000 power from your hand: Your Leader and this Character\'s base power becomes 7000 during this turn.',
    ],
  ])('extracts an OP16-015 Leader card-name requirement with %s', (_label, effect) => {
    const features = classifyCardFeatures(
      card({ cardNumber: 'OP16-015', cost: 4, power: 6000, effect }),
    )

    expect(features.flags.comboDependent).toBe(true)
    expect(features.flags.vanillaLike).toBe(false)
    expect(features.rainbowUsableFlags.vanillaLike).toBe(true)
    expect(features.requiredNames).toEqual(['Ace'])
    expect(features.rainbowLuffyCompatibility).toBe('incompatible')
  })

  it('does not treat OP17-116 Trigger criteria as a required card name', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-116',
        cardType: 'EVENT',
        effect:
          "[Main] You may rest 2 of your DON!! cards: K.O. up to 1 of your opponent's Stages.<br/>[Counter] If you have 2 or more Characters with a [Trigger], up to 1 of your Leader or Character gains +4000 power during this battle.",
      }),
    )

    expect(features.flags.comboDependent).toBe(true)
    expect(features.requiredNames).toEqual([])
  })

  it('does not treat OP13-113 Trigger criteria or an excluded card as searchable names', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP13-113',
        effect:
          '[On Play] Look at 4 cards from the top of your deck; reveal up to 1 card with a [Trigger] other than [Lilith] and add it to your hand. Then, place the rest at the bottom of your deck in any order.',
      }),
    )

    expect(features.flags.searcher).toBe(true)
    expect(features.searchableNames).toEqual([])
  })

  it.each([
    'Trigger',
    'Blocker',
    'Rush',
    'Rush: Character',
    'Banish',
    'On Play',
    'When Attacking',
    'Activate: Main',
    'Counter',
    'Main',
    'Once Per Turn',
  ])('filters the [%s] structural annotation from search targets', (annotation) => {
    const features = classifyCardFeatures(
      card({
        effect: `Look at 3 cards from the top of your deck; reveal up to 1 card with a [${annotation}] and add it to your hand.`,
      }),
    )

    expect(features.searchableNames).toEqual([])
  })

  it('recognizes Rainbow Luffy compatibility boundaries', () => {
    expect(
      classifyCardFeatures(
        card({ effect: 'If your Leader is [Monkey.D.Luffy], draw 1 card.' }),
      ).rainbowLuffyCompatibility,
    ).toBe('incompatible')
    expect(
      classifyCardFeatures(
        card({ effect: 'If your Leader has the {Straw Hat Crew} type, draw 1 card.' }),
      ).rainbowLuffyCompatibility,
    ).toBe('incompatible')
    expect(
      classifyCardFeatures(card({ effect: '[On Play] Draw 1 card.' }))
        .rainbowLuffyCompatibility,
    ).toBe('compatible')
    expect(
      classifyCardFeatures(
        card({ effect: 'If your Leader has 5 or more life, draw 1 card.' }),
      ).rainbowLuffyCompatibility,
    ).toBe('neutral')
  })

  it('normalizes a curly Leader possessive before detecting a required type', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          'If your Leader’s type includes {Straw Hat Crew}, draw 1 card.',
      }),
    )

    expect(features.flags.comboDependent).toBe(true)
    expect(features.requiredTraits).toEqual(['Straw Hat Crew'])
    expect(features.rainbowLuffyCompatibility).toBe('incompatible')
  })

  it('rejects real mono-colored and quoted Leader requirements for Rainbow Luffy', () => {
    const monoColored = classifyCardFeatures(
      card({
        cardNumber: 'OP17-005',
        effect:
          "If your opponent has a Character with 10000 power or more, give this card in your hand -4 cost.<br/>[On Play] If your mono-colored Leader has 5 or more life, K.O. up to 1 of your opponent's Characters.",
      }),
    )
    const quotedType = classifyCardFeatures(
      card({
        cardNumber: 'OP17-044',
        effect:
          "If your Leader's type includes ”Rocks Pirates” and this Character is rested, your opponent cannot attack any card other than the Character [Captain John].<br/>[Activate: Main] You may rest this Character: Draw 1 card and trash 1 card from your hand.",
      }),
    )

    expect(monoColored.rainbowLuffyCompatibility).toBe('incompatible')
    expect(monoColored.flags.removal).toBe(true)
    expect(monoColored.rainbowUsableFlags.removal).toBe(false)
    expect(quotedType.rainbowLuffyCompatibility).toBe('incompatible')
    expect(quotedType.requiredTraits).toEqual(['Rocks Pirates'])
    expect(
      classifyCardFeatures(
        card({ effect: "Your Leader's base power becomes 6000." }),
      ).rainbowLuffyCompatibility,
    ).toBe('compatible')
  })

  it('suppresses OP17-003-like conditional removal for Rainbow Luffy', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-003',
        cost: 4,
        power: 6000,
        effect:
          "[Rush: Character]<br/>[On Play] If your Leader is [Edward.Newgate] or has the {Land of Wano} type, give up to 1 of your opponent's rested Characters -6000 power during this turn.",
      }),
    )

    expect(features.flags.removal).toBe(true)
    expect(features.flags.vanillaLike).toBe(false)
    expect(features.rainbowUsableFlags.rush).toBe(true)
    expect(features.rainbowUsableFlags.vanillaLike).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
  })

  it('keeps DON!! inside an incompatible OP11-075-like condition', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP11-075',
        effect:
          'If your Leader is [Nico Robin] and you have 6 or more DON!! cards on your field, draw 2 cards.',
      }),
    )

    expect(features.flags.draw).toBe(true)
    expect(features.flags.twoForOne).toBe(true)
    expect(features.rainbowUsableFlags.draw).toBe(false)
    expect(features.rainbowUsableFlags.twoForOne).toBe(false)
  })

  it('keeps compatible OP17-114-like multi-target power reduction usable', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-114',
        effect:
          "[On Play] Up to 2 of your opponent's Characters get -3000 power during this turn.",
      }),
    )

    expect(features.flags.twoForOne).toBe(true)
    expect(features.rainbowUsableFlags.twoForOne).toBe(true)
  })

  it('suppresses an OP17-060-like Then continuation of a Leader condition', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-060',
        effect:
          "[On Play] If your Leader has the {Animal Kingdom Pirates} type, add up to 1 DON!! from your DON!! deck and set it as active. Then, K.O. up to 1 of your opponent's Characters with 3000 power or less.",
      }),
    )

    expect(features.flags.removal).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
  })

  it('suppresses an OP17-103-like Then power reduction after a Leader condition', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-103',
        effect:
          "[Your Turn] [On Play] If your Leader is a {Big Mom Pirates} type, you may add up to 1 card from the top of your deck to your Life cards. Then, give up to 1 of your opponent's Characters -3000 power during this turn.",
        trigger: '[Trigger] Play this card.',
      }),
    )

    expect(features.flags.removal).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
  })

  it('keeps an independent clause after a suppressed Then chain usable', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] If your Leader has the {Animal Kingdom Pirates} type, add up to 1 DON!! from your DON!! deck and set it as active. Then, K.O. up to 1 of your opponent's Characters. Then, draw 1 card.<br/>[Blocker]",
      }),
    )

    expect(features.flags.removal).toBe(true)
    expect(features.flags.draw).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
    expect(features.rainbowUsableFlags.draw).toBe(false)
    expect(features.rainbowUsableFlags.blocker).toBe(true)
  })

  it('keeps Then after a compatible unconditional clause usable', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] Draw 1 card. Then, K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.rainbowUsableFlags.draw).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(true)
  })

  it('retains an unconditional Blocker while suppressing conditional removal', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[Blocker]<br/>[On Play] If your Leader is [Nami], K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.flags.blocker).toBe(true)
    expect(features.flags.removal).toBe(true)
    expect(features.rainbowUsableFlags.blocker).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
  })

  it('retains unconditional draw while suppressing conditional removal', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          "[On Play] Draw 1 card. If your Leader has the {Navy} type, K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.flags.draw).toBe(true)
    expect(features.flags.removal).toBe(true)
    expect(features.rainbowUsableFlags.draw).toBe(true)
    expect(features.rainbowUsableFlags.removal).toBe(false)
  })

  it('keeps every detected flag usable for compatible unconditional text', () => {
    const features = classifyCardFeatures(
      card({
        counter: 2000,
        effect:
          "[Blocker]<br/>[On Play] Draw 1 card. K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(features.rainbowLuffyCompatibility).toBe('compatible')
    expect(features.rainbowUsableFlags).toEqual(features.flags)
  })

  it('keeps a power-qualified boss but suppresses an effect-only boss', () => {
    const powerBoss = classifyCardFeatures(
      card({
        cost: 7,
        power: 8000,
        effect:
          "[On Play] If your Leader is [Nami], K.O. up to 1 of your opponent's Characters.",
      }),
    )
    const effectBoss = classifyCardFeatures(
      card({
        cost: 7,
        power: 7000,
        effect:
          "[On Play] If your Leader is [Nami], K.O. up to 1 of your opponent's Characters.",
      }),
    )

    expect(powerBoss.flags.boss).toBe(true)
    expect(powerBoss.rainbowUsableFlags.boss).toBe(true)
    expect(powerBoss.rainbowUsableFlags.removal).toBe(false)
    expect(effectBoss.flags.boss).toBe(true)
    expect(effectBoss.rainbowUsableFlags.boss).toBe(false)
  })

  it('does not treat balanced draw-two/trash-two text as two-for-one value', () => {
    const features = classifyCardFeatures(
      card({
        cardNumber: 'OP17-082',
        effect:
          'If there is a Character with a cost of 12 or more, this Character gains +3000 power.<br/>[On Play] Draw 2 cards and trash 2 cards from your hand.',
      }),
    )

    expect(features.flags.draw).toBe(true)
    expect(features.flags.twoForOne).toBe(false)
  })

  it('normalizes HTML, Unicode punctuation, whitespace, and bracketed names', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          'Look at 5 cards from the top of your deck<br />reveal up to 1 {Heart Pirates} type card named [Trafalgar Law] — “add it to your hand”.\n\nIf your Leader is [Monkey.D.Luffy], draw 1 card.',
      }),
    )

    expect(features.flags.searcher).toBe(true)
    expect(features.searchableTraits).toEqual(['Heart Pirates'])
    expect(features.searchableNames).toEqual(['Trafalgar Law'])
    expect(features.requiredNames).toEqual(['Monkey.D.Luffy'])
    expect(features.rainbowLuffyCompatibility).toBe('incompatible')
  })

  it('uses stat-only compatible fallbacks for empty text', () => {
    const features = classifyCardFeatures(
      card({ cost: 3, power: 5000, effect: '', trigger: '' }),
    )

    expect(features.flags.vanillaLike).toBe(true)
    expect(features.rainbowUsableFlags.vanillaLike).toBe(true)
    expect(features.flags.comboDependent).toBe(false)
    expect(features.rainbowLuffyCompatibility).toBe('compatible')
  })

  it('keeps zero- and null-counter Character bricks usable for Rainbow Luffy', () => {
    const zeroCounter = classifyCardFeatures(card({ counter: 0 }))
    const nullCounter = classifyCardFeatures(card({ counter: null }))

    expect(zeroCounter.flags.brick).toBe(true)
    expect(zeroCounter.rainbowUsableFlags.brick).toBe(true)
    expect(nullCounter.flags.brick).toBe(true)
    expect(nullCounter.rainbowUsableFlags.brick).toBe(true)
  })

  it('returns a deeply immutable, deduplicated, stably sorted result', () => {
    const features = classifyCardFeatures(
      card({
        effect:
          'Look at 5 cards from the top of your deck; reveal up to 1 {Zeta} type card or {Alpha} type card or another {Zeta} type card named [Zoro] or [Ace] or [Zoro] and add it to your hand. If your Leader has the {Zeta} type or {Zeta} trait and you have a Character named [Zoro] or [Ace] or [Zoro], draw 1 card.',
      }),
    )

    expect(features.searchableTraits).toEqual(['Alpha', 'Zeta'])
    expect(features.searchableNames).toEqual(['Ace', 'Zoro'])
    expect(features.requiredTraits).toEqual(['Zeta'])
    expect(features.requiredNames).toEqual(['Ace', 'Zoro'])
    expect(Object.isFrozen(features)).toBe(true)
    expect(Object.isFrozen(features.flags)).toBe(true)
    expect(Object.isFrozen(features.rainbowUsableFlags)).toBe(true)
    expect(Object.isFrozen(features.supportRequirementsByFlag)).toBe(true)
    for (const requirement of Object.values(
      features.supportRequirementsByFlag,
    )) {
      if (requirement === null) continue
      expect(Object.isFrozen(requirement)).toBe(true)
      expect(Object.isFrozen(requirement.requiredNames)).toBe(true)
      expect(Object.isFrozen(requirement.requiredTraits)).toBe(true)
    }
    expect(Object.isFrozen(features.searchableTraits)).toBe(true)
    expect(Object.isFrozen(features.searchableNames)).toBe(true)
    expect(Object.isFrozen(features.requiredTraits)).toBe(true)
    expect(Object.isFrozen(features.requiredNames)).toBe(true)
    expect(Object.isFrozen(features.evidence)).toBe(true)
    expect(() => (features.searchableNames as string[]).push('Nami')).toThrow()
    expect(() => {
      ;(features.rainbowUsableFlags as Record<CardFeatureKey, boolean>).draw =
        false
    }).toThrow()
  })
})
