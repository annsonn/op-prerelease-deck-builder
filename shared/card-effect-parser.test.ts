import { describe, expect, it } from 'vitest'

import type { PlayableCard } from './catalog.js'
import {
  normalizeCardRulesText,
  parseCardEffects,
} from './card-effect-parser.js'

function card(overrides: Partial<PlayableCard> = {}): PlayableCard {
  return {
    cardNumber: 'OP17-001',
    name: 'Test Card',
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4_000,
    counter: 1_000,
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

describe('normalizeCardRulesText', () => {
  it('canonicalizes printed punctuation, spacing, breaks, and bullets', () => {
    expect(
      normalizeCardRulesText(
        '［On Play］\u00a0Draw 1 card。<br />｛Your Turn｝ • K.O. 1 card — then −1.',
      ),
    ).toBe('[On Play] Draw 1 card。\n{Your Turn}\n- KO 1 card - then -1.')
  })
})

describe('parseCardEffects clause context', () => {
  it('keeps Then actions in one instance with one paid cost', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] DON!!-1: Draw 1 card. Then, up to 2 of your opponent's Characters with a cost of 5 or less cannot attack until the end of your opponent's next End Phase.",
      }),
    )

    expect(result.effects).toEqual([
      expect.objectContaining({
        id: 'effect:0',
        activation: 'onPlay',
        costs: [{ kind: 'donMinus', amount: 1 }],
        branches: [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              expect.objectContaining({
                kind: 'lockAttack',
                duration: 'untilOpponentsNextEndPhase',
              }),
            ],
          },
        ],
      }),
    ])
  })

  it('inherits an opponent chooser and subject across bullets', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Your opponent chooses one:<br/>• Draw 2 cards.<br/>• Your opponent trashes 2 cards from their hand.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      chooser: 'opponent',
      branches: [
        { actions: [{ kind: 'draw', subject: 'opponent', amount: 2 }] },
        {
          actions: [
            { kind: 'handDiscard', subject: 'opponent', amount: 2 },
          ],
        },
      ],
    })
  })

  it('copies common actions before a choice into every branch', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] Draw 1 card, then choose one:<br/>- Add 1 card to your Life.<br/>- Add 1 card from your opponent's Life to their hand.",
      }),
    )

    expect(result.effects[0]?.branches).toEqual([
      {
        actions: [
          expect.objectContaining({ kind: 'draw' }),
          expect.objectContaining({
            kind: 'lifeMove',
            direction: 'gainOwnLife',
          }),
        ],
      },
      {
        actions: [
          expect.objectContaining({ kind: 'draw' }),
          expect.objectContaining({
            kind: 'lifeMove',
            direction: 'opponentLifeToHand',
          }),
        ],
      },
    ])
  })

  it('defaults an unannotated continuous clause to static without inheriting the prior activation', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Draw 1 card.<br/>All of your Characters without a Counter have +1000 Counter.',
      }),
    )

    expect(result.effects.map(({ activation }) => activation)).toEqual([
      'onPlay',
      'static',
    ])
  })

  it.each([
    ['[Blocker]', 'static'],
    ['[On Play] Draw 1 card.', 'onPlay'],
    ['[Activate: Main] Draw 1 card.', 'activateMain'],
    ['[Main] Draw 1 card.', 'main'],
    ['[Counter] Up to 1 of your Leader gains +2000 power.', 'counter'],
    ['[On K.O.] Draw 1 card.', 'onKo'],
    ['[When Attacking] Draw 1 card.', 'whenAttacking'],
    ['[On Block] Draw 1 card.', 'onBlock'],
    ["[On Your Opponent's Attack] Draw 1 card.", 'onOpponentsAttack'],
  ])('maps %s to %s', (effect, activation) => {
    expect(parseCardEffects(card({ effect })).effects[0]?.activation).toBe(
      activation,
    )
  })

  it('attaches timing annotations preceding an activation to that instance', () => {
    const result = parseCardEffects(
      card({ effect: '[Your Turn] [Once Per Turn] [On Play] Draw 1 card.' }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'onPlay',
      timing: ['yourTurn', 'oncePerTurn'],
    })
  })

  it('carries an annotation-only activation and timing block to the next result clause', () => {
    const result = parseCardEffects(
      card({
        effect: '[Your Turn] [On Play]<br/>Draw 1 card.',
      }),
    )

    expect(result.effects).toMatchObject([
      {
        id: 'effect:0',
        activation: 'onPlay',
        timing: ['yourTurn'],
        branches: [
          { actions: [{ kind: 'draw', subject: 'player', amount: 1 }] },
        ],
      },
    ])
  })

  it('replaces a pending annotation-only block with a later annotation block', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Your Turn] [On Play]<br/>[Opponent\'s Turn] [When Attacking]<br/>Draw 1 card.',
      }),
    )

    expect(result.effects).toMatchObject([
      {
        id: 'effect:0',
        activation: 'whenAttacking',
        timing: ['opponentsTurn'],
      },
    ])
  })

  it('composes a timing-only block followed by an activation block with a result', () => {
    const result = parseCardEffects(
      card({
        effect: '[Your Turn]<br/>[On Play] Draw 1 card.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'onPlay',
      timing: ['yourTurn'],
    })
  })

  it('composes an activation-only block followed by a timing block with a result', () => {
    const result = parseCardEffects(
      card({
        effect: '[On Play]<br/>[Your Turn] Draw 1 card.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'onPlay',
      timing: ['yourTurn'],
    })
  })

  it('replaces pending activation independently while retaining timing', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Your Turn] [On Play]<br/>[When Attacking]<br/>Draw 1 card.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'whenAttacking',
      timing: ['yourTurn'],
    })
  })

  it('replaces pending timing independently while retaining activation', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Your Turn] [On Play]<br/>[Opponent\'s Turn]<br/>Draw 1 card.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'onPlay',
      timing: ['opponentsTurn'],
    })
  })

  it('keeps Trigger activation permanent across an annotation-only block', () => {
    const result = parseCardEffects(
      card({
        trigger: '[Your Turn] [On Play]<br/>Draw 1 card.',
      }),
    )

    expect(result.effects).toMatchObject([
      {
        id: 'trigger:0',
        source: 'trigger',
        activation: 'trigger',
        timing: ['yourTurn'],
      },
    ])
  })

  it('never merges Trigger-field text into the printed effect instance', () => {
    const result = parseCardEffects(
      card({
        effect: '[On Play] Draw 1 card.',
        trigger: '[Trigger] Play this card.',
      }),
    )

    expect(
      result.effects.map(({ id, source, activation }) => [
        id,
        source,
        activation,
      ]),
    ).toEqual([
      ['effect:0', 'effect', 'onPlay'],
      ['trigger:0', 'trigger', 'trigger'],
    ])
  })

  it('forces every Trigger-field clause to Trigger activation despite embedded activation labels', () => {
    const result = parseCardEffects(
      card({
        effect: '[On Play] Draw 1 card.',
        trigger:
          '[On Play] Draw 1 card. [When Attacking] Draw 1 card.',
      }),
    )

    expect(
      result.effects.map(({ id, source, activation }) => [
        id,
        source,
        activation,
      ]),
    ).toEqual([
      ['effect:0', 'effect', 'onPlay'],
      ['trigger:0', 'trigger', 'trigger'],
      ['trigger:1', 'trigger', 'trigger'],
    ])
  })

  it('does not force an Effect-field activation to Trigger', () => {
    const result = parseCardEffects(
      card({ effect: '[On Play] Draw 1 card.' }),
    )

    expect(result.effects[0]).toMatchObject({
      source: 'effect',
      activation: 'onPlay',
    })
  })

  it('inherits activation, condition, and paid cost across a line-broken Then', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] DON!!-1: If your opponent has 5 Characters, draw 1 card.<br/>Then, up to 2 of your opponent's Characters cannot attack until the end of your opponent's next End Phase.",
      }),
    )

    expect(result.effects).toEqual([
      expect.objectContaining({
        id: 'effect:0',
        activation: 'onPlay',
        condition: {
          kind: 'unknown',
          normalizedText: 'if your opponent has 5 characters',
        },
        costs: [{ kind: 'donMinus', amount: 1 }],
        branches: [
          {
            actions: [
              { kind: 'draw', subject: 'player', amount: 1 },
              expect.objectContaining({ kind: 'lockAttack' }),
            ],
          },
        ],
      }),
    ])
  })

  it('does not inherit activation or cost without an explicit Then', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] DON!!-1: Draw 1 card.<br/>All of your Characters without a Counter have +1000 Counter.',
      }),
    )

    expect(result.effects).toMatchObject([
      { activation: 'onPlay', costs: [{ kind: 'donMinus', amount: 1 }] },
      { activation: 'static', costs: [] },
    ])
  })

  it('tokenizes later activations and independent sentences on the same printed line', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Draw 1 card. All of your Characters without a Counter have +1000 Counter. [When Attacking] Draw 1 card.',
      }),
    )

    expect(
      result.effects.map(({ id, activation }) => [id, activation]),
    ).toEqual([
      ['effect:0', 'onPlay'],
      ['effect:1', 'static'],
      ['effect:2', 'whenAttacking'],
    ])
  })

  it('preserves unrecognized trailing text after a recognized action', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Draw 1 card; perform an unfamiliar maneuver. [When Attacking] Draw 1 card.',
      }),
    )

    expect(result.effects.map(({ id }) => id)).toEqual([
      'effect:0',
      'effect:1',
    ])
    expect(result.unparsedClauses).toContain(
      'perform an unfamiliar maneuver.',
    )
  })

  it('allocates stable dense IDs independently for Effect and Trigger sources after diagnostics', () => {
    const result = parseCardEffects(
      card({
        effect:
          'Unknown effect. [On Play] Draw 1 card. Unknown effect two. [When Attacking] Draw 1 card.',
        trigger:
          'Unknown trigger. [On Play] Draw 1 card. [When Attacking] Draw 1 card.',
      }),
    )

    expect(
      result.effects.map(({ id, activation }) => [id, activation]),
    ).toEqual([
      ['effect:0', 'onPlay'],
      ['effect:1', 'whenAttacking'],
      ['trigger:0', 'trigger'],
      ['trigger:1', 'trigger'],
    ])
  })

  it.each([
    ['DON!!-2', [{ kind: 'donMinus', amount: 2 }]],
    ['Rest 3 of your DON!! cards', [{ kind: 'restDon', amount: 3 }]],
    ['Trash 2 cards from your hand', [{ kind: 'discardHand', amount: 2 }]],
    ['Trash this Character', [{ kind: 'trashSelf' }]],
    ['Rest this Character', [{ kind: 'restSelf' }]],
  ])('parses the shared cost prefix %s once', (prefix, costs) => {
    const result = parseCardEffects(
      card({ effect: `[Activate: Main] ${prefix}: Draw 1 card. Then, draw 1 card.` }),
    )

    expect(result.effects[0]).toMatchObject({
      costs,
      branches: {
        0: {
          actions: [
            { kind: 'draw', subject: 'player', amount: 1 },
            { kind: 'draw', subject: 'player', amount: 1 },
          ],
        },
      },
    })
  })

  it('parses a real bracketed DON minus annotation as one shared cost', () => {
    const result = parseCardEffects(
      card({ trigger: '[Trigger] [DON!!-1]: Draw 2 cards.' }),
    )

    expect(result.effects).toMatchObject([
      {
        id: 'trigger:0',
        activation: 'trigger',
        costs: [{ kind: 'donMinus', amount: 1 }],
        branches: [
          { actions: [{ kind: 'draw', subject: 'player', amount: 2 }] },
        ],
      },
    ])
  })

  it('does not confuse an attached-DON requirement with a DON-minus cost', () => {
    const result = parseCardEffects(
      card({ effect: '[DON!! x1] Draw 1 card.' }),
    )

    expect(result.effects).toEqual([])
    expect(result.unparsedClauses).toEqual(['[DON!! x1] Draw 1 card.'])
  })

  it('keeps an unsupported timing annotation diagnostic and unavailable', () => {
    const result = parseCardEffects(
      card({ effect: '[End of Your Turn] Draw 2 cards.' }),
    )

    expect(result.effects).toEqual([])
    expect(result.unparsedClauses).toEqual([
      '[End of Your Turn] Draw 2 cards.',
    ])
  })

  it('preserves every choice bullet through an explicit unknown action', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Your opponent chooses one:<br/>• Draw 2 cards.<br/>• Perform an unfamiliar maneuver.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      chooser: 'opponent',
      branches: [
        { actions: [{ kind: 'draw', subject: 'opponent', amount: 2 }] },
        {
          actions: [
            {
              kind: 'unknown',
              normalizedText: 'perform an unfamiliar maneuver.',
            },
          ],
        },
      ],
    })
    expect(result.unparsedClauses).toContain(
      'Perform an unfamiliar maneuver.',
    )
  })

  it('rejects the real unsupported alternative-activation shape as one diagnostic', () => {
    const effect =
      '[When Attacking] / [On Your Opponent\'s Attack] [Once Per Turn] You may trash 1 card with a type including "Rocks Pirates" from your hand: Give up to 1 of your opponent\'s Characters -3000 power during this turn.'
    const result = parseCardEffects(card({ effect }))

    expect(result.effects).toEqual([])
    expect(result.unparsedClauses).toEqual([effect])
  })

  it('does not retain an optimistic action behind alternative activation syntax', () => {
    const effect =
      "[When Attacking] / [On Your Opponent's Attack] [Once Per Turn] Draw 2 cards."
    const result = parseCardEffects(card({ effect }))

    expect(result.effects).toEqual([])
    expect(result.unparsedClauses).toEqual([effect])
  })

  it('emits structural keywords as static actions in printed order', () => {
    const result = parseCardEffects(
      card({ effect: '[Blocker]<br/>[Rush]<br/>[Banish]' }),
    )

    expect(result.effects).toMatchObject([
      {
        activation: 'static',
        branches: [{ actions: [{ kind: 'keyword', keyword: 'blocker' }] }],
      },
      {
        activation: 'static',
        branches: [{ actions: [{ kind: 'keyword', keyword: 'rush' }] }],
      },
      {
        activation: 'static',
        branches: [{ actions: [{ kind: 'keyword', keyword: 'banish' }] }],
      },
    ])
  })

  it('marks self deployment only when this card is explicit', () => {
    const self = parseCardEffects(
      card({ trigger: '[Trigger] Play this card.' }),
    )
    const other = parseCardEffects(
      card({ trigger: '[Trigger] Play up to 1 Character card.' }),
    )

    expect(self.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'deploy',
      target: { allowsSelf: true },
    })
    expect(other.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'deploy',
      target: { allowsSelf: false },
    })
  })

  it('records unknown clauses as diagnostics without creating ID gaps', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Draw 1 card.<br/>Perform an unfamiliar maneuver.<br/>[When Attacking] Draw 1 card.',
      }),
    )

    expect(result.effects.map(({ id }) => id)).toEqual([
      'effect:0',
      'effect:1',
    ])
    expect(result.unparsedClauses).toEqual([
      'Perform an unfamiliar maneuver.',
    ])
  })

  const emptyPredicate = {
    names: [],
    traits: [],
    cardTypes: [],
    minimumCost: null,
    maximumCost: null,
    minimumPower: null,
    maximumPower: null,
    counter: 'any',
    hasTrigger: null,
  } as const

  const target = (overrides: Record<string, unknown> = {}) => ({
    subject: 'unknown',
    zones: [],
    quantity: 1,
    predicate: emptyPredicate,
    differentNames: false,
    totalCostMaximum: null,
    allowsSelf: false,
    ...overrides,
  })

  it.each([
    [
      'own draw',
      '[On Play] Draw 2 cards.',
      { kind: 'draw', subject: 'player', amount: 2 },
    ],
    [
      'opponent draw',
      '[On Play] Your opponent draws 2 cards.',
      { kind: 'draw', subject: 'opponent', amount: 2 },
    ],
    [
      'filter from deck',
      '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 card with a type including "Test Crew" and add it to your hand.',
      {
        kind: 'filter',
        subject: 'player',
        lookedAt: 5,
        kept: 1,
        target: target({
          subject: 'player',
          zones: ['deck'],
          predicate: { ...emptyPredicate, traits: ['Test Crew'] },
        }),
      },
    ],
    [
      'opponent hand discard',
      '[On Play] Your opponent trashes 2 cards from their hand.',
      { kind: 'handDiscard', subject: 'opponent', amount: 2 },
    ],
    [
      'KO two Characters by cost',
      "[On Play] K.O. up to 2 of your opponent's Characters with a cost of 5 or less.",
      {
        kind: 'remove',
        mode: 'ko',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          quantity: 2,
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 5,
          },
        }),
        powerDelta: null,
      },
    ],
    [
      'bottom-deck Character without explicit opponent token',
      "[On Play] Place up to 1 Character with a cost of 5 or less at the bottom of the owner's deck.",
      {
        kind: 'remove',
        mode: 'bottomDeck',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 5,
          },
        }),
        powerDelta: null,
      },
    ],
    [
      'return Character to hand with Trigger predicate',
      "[Main] Return up to 1 of your opponent's Characters with a [Trigger] to the owner's hand.",
      {
        kind: 'remove',
        mode: 'returnHand',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            hasTrigger: true,
          },
        }),
        powerDelta: null,
      },
    ],
    [
      'rest all opposing Characters',
      "[On Play] Rest all of your opponent's Characters.",
      {
        kind: 'remove',
        mode: 'rest',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          quantity: 'all',
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
        }),
        powerDelta: null,
      },
    ],
    [
      'power reduction by power bound',
      "[On Play] Give up to 1 of your opponent's Characters with 5000 power or less -3000 power during this turn.",
      {
        kind: 'remove',
        mode: 'powerReduction',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumPower: 5_000,
          },
        }),
        powerDelta: -3_000,
      },
    ],
    [
      'attack lock',
      "[On Play] Up to 2 of your opponent's Characters with a base cost of 6 or less cannot attack until the end of your opponent's next End Phase.",
      {
        kind: 'lockAttack',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          quantity: 2,
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 6,
          },
        }),
        duration: 'untilOpponentsNextEndPhase',
      },
    ],
    [
      'deploy different names within total cost',
      '[On Play] Play up to 2 {Test Crew} type cards with different card names and a total cost of 9 or less from your hand.',
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['hand'],
          quantity: 2,
          predicate: { ...emptyPredicate, traits: ['Test Crew'] },
          differentNames: true,
          totalCostMaximum: 9,
        }),
      },
    ],
    [
      'deploy Character from trash',
      '[On Play] Play up to 1 Character card with a cost of 2 or less from your trash.',
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['trash'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 2,
          },
        }),
      },
    ],
    [
      'replacement protection',
      "If this Character would be removed from the field, you may trash 2 cards from your hand instead.",
      {
        kind: 'protect',
        target: target({
          subject: 'thisCard',
          zones: ['field'],
          allowsSelf: true,
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
        }),
      },
    ],
    [
      'own Life gain',
      '[On Play] Add up to 1 card from the top of your deck to the top of your Life cards.',
      { kind: 'lifeMove', direction: 'gainOwnLife', amount: 1 },
    ],
    [
      'opposing Life to hand',
      "[On Play] Add up to 1 card from the top of your opponent's Life cards to the owner's hand.",
      { kind: 'lifeMove', direction: 'opponentLifeToHand', amount: 1 },
    ],
    [
      'DON refresh',
      '[On Play] Set up to 2 of your DON!! cards as active.',
      { kind: 'donChange', mode: 'refresh', amount: 2 },
    ],
    [
      'DON ramp active',
      '[On Play] Add up to 1 DON!! card from your DON!! deck and set it as active.',
      { kind: 'donChange', mode: 'rampActive', amount: 1 },
    ],
    [
      'DON ramp rested',
      '[On Play] Add up to 3 DON!! cards from your DON!! deck and rest them.',
      { kind: 'donChange', mode: 'rampRested', amount: 3 },
    ],
    [
      'Counter aura without Counter',
      'All of your Character cards without a Counter have a +1000 Counter.',
      {
        kind: 'counterModifier',
        amount: 1_000,
        target: target({
          subject: 'player',
          zones: ['field'],
          quantity: 'all',
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            counter: 'withoutCounter',
          },
        }),
      },
    ],
    [
      'power modifier this turn',
      '[Counter] Your Leader gains +2000 power during this turn.',
      {
        kind: 'powerModifier',
        powerDelta: 2_000,
        target: target({
          subject: 'player',
          zones: ['field'],
          predicate: { ...emptyPredicate, cardTypes: ['LEADER'] },
        }),
        duration: 'thisTurn',
      },
    ],
    [
      'Leader base power',
      "[On Play] Your Leader's base power becomes 6000 until the end of your opponent's next End Phase.",
      {
        kind: 'leaderBasePower',
        powerDelta: 1_000,
        duration: 'untilOpponentsNextEndPhase',
      },
    ],
  ])('parses the complete %s action', (_name, effect, expected) => {
    const result = parseCardEffects(card({ effect }))

    expect(result.effects[0]?.branches[0]?.actions).toContainEqual(expected)
  })

  it('parses any-number removal and its total-cost ceiling', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] K.O. any number of your opponent's Characters with a total cost of 4 or less.",
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'remove',
        mode: 'ko',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          quantity: 'anyNumber',
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
          totalCostMaximum: 4,
        }),
        powerDelta: null,
      },
    ])
  })

  it('parses effect negation and resolves that Character only inside the same instance', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[Activate: Main] DON!!-1: Negate the effect of up to 1 of your opponent's Characters with a cost of 6 or less, and K.O. that Character.",
      }),
    )
    const actions = result.effects[0]?.branches[0]?.actions

    expect(actions).toEqual([
      {
        kind: 'negateEffect',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 6,
          },
        }),
      },
      {
        kind: 'remove',
        mode: 'ko',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 6,
          },
        }),
        powerDelta: null,
      },
    ])
  })

  it('does not resolve that Character across effect instances', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] Rest up to 1 of your opponent's Characters.<br/>[When Attacking] K.O. that Character.",
      }),
    )

    expect(result.effects).toHaveLength(2)
    expect(result.effects[1]?.branches[0]?.actions).toEqual([
      { kind: 'unknown', normalizedText: 'ko that character.' },
    ])
    expect(result.unparsedClauses).toContain('KO that Character.')
  })

  it('parses numeric target words only when their meaning is declared', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] Rest up to two of your opponent's Characters. [When Attacking] Rest several of your opponent's Characters.",
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'remove',
      target: { quantity: 2 },
    })
    expect(result.unparsedClauses).toContain(
      "Rest several of your opponent's Characters.",
    )
  })

  it('keeps an unknown draw subject diagnostic and gives it no player identity', () => {
    const result = parseCardEffects(card({ effect: '[On Play] Draw cards.' }))

    expect(result.unparsedClauses).toContain('Draw cards.')
    expect(
      result.effects
        .flatMap((effect) => effect.branches)
        .flatMap((branch) => branch.actions),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'draw', subject: 'player' }),
    )
  })

  it('normalizes an absolute target base power to a signed delta', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Your Turn] The base power of all your Characters with a [Trigger] and 4000 base power becomes 8000.',
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'powerModifier',
        powerDelta: 4_000,
        target: target({
          subject: 'player',
          zones: ['field'],
          quantity: 'all',
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            minimumPower: 4_000,
            maximumPower: 4_000,
            hasTrigger: true,
          },
        }),
        duration: 'thisTurn',
      },
    ])
  })

  it('keeps an absolute target power without a safe baseline diagnostic', () => {
    const effect =
      '[Your Turn] The power of all your Characters becomes 8000.'
    const result = parseCardEffects(card({ effect }))

    expect(result.effects).toEqual([])
    expect(result.unparsedClauses).toEqual([
      'The power of all your Characters becomes 8000.',
    ])
  })

  it('parses card, self-state, and compound activation requirements', () => {
    const numeric = parseCardEffects(
      card({
        effect:
          '[On Play] If you have 2 or more Characters with 8000 power or more, draw 1 card.',
      }),
    )
    const selfState = parseCardEffects(
      card({
        effect:
          '[Activate: Main] If this Character was played on this turn, draw 1 card.',
      }),
    )
    const compound = parseCardEffects(
      card({
        effect:
          '[On Play] If you have a Character with a cost of 12 or more and a Character with a [Trigger], draw 1 card.',
      }),
    )

    expect(numeric.effects[0]?.condition).toEqual({
      kind: 'cards',
      target: target({
        subject: 'player',
        zones: ['field'],
        predicate: {
          ...emptyPredicate,
          cardTypes: ['CHARACTER'],
          minimumPower: 8_000,
        },
      }),
      minimumCount: 2,
    })
    expect(selfState.effects[0]?.condition).toEqual({
      kind: 'selfState',
      state: 'playedThisTurn',
    })
    expect(compound.effects[0]?.condition).toEqual({
      kind: 'all',
      children: [
        {
          kind: 'cards',
          target: target({
            subject: 'player',
            zones: ['field'],
            predicate: {
              ...emptyPredicate,
              cardTypes: ['CHARACTER'],
              minimumCost: 12,
            },
          }),
          minimumCount: 1,
        },
        {
          kind: 'cards',
          target: target({
            subject: 'player',
            zones: ['field'],
            predicate: {
              ...emptyPredicate,
              cardTypes: ['CHARACTER'],
              hasTrigger: true,
            },
          }),
          minimumCount: 1,
        },
      ],
    })
  })

  it('parses Leader name, trait, and mono-color restrictions', () => {
    const named = parseCardEffects(
      card({
        effect:
          '[On Play] If your Leader is [Nami] or has the {Test Crew} type, draw 1 card.',
      }),
    )
    const mono = parseCardEffects(
      card({
        effect:
          "[On Play] Your mono-colored Leader's base power becomes 8000 until the end of your opponent's next End Phase.",
      }),
    )

    expect(named.effects[0]?.condition).toEqual({
      kind: 'leader',
      names: ['Nami'],
      traits: ['Test Crew'],
      monoColorRequired: false,
    })
    expect(named.effects[0]?.rainbowLuffyCompatibility).toBe('incompatible')
    expect(mono.effects[0]?.condition).toEqual({
      kind: 'leader',
      names: [],
      traits: [],
      monoColorRequired: true,
    })
    expect(mono.effects[0]?.rainbowLuffyCompatibility).toBe('incompatible')
  })

  it('marks only the Leader-locked instance incompatible', () => {
    const result = parseCardEffects(
      card({
        effect: 'If your Leader is [Nami], draw 1 card.<br/>[Blocker]',
      }),
    )

    expect(
      result.effects.map(({ rainbowLuffyCompatibility }) =>
        rainbowLuffyCompatibility,
      ),
    ).toEqual(['incompatible', 'compatible'])
  })

  it('captures a jointly rested self as a paid cost', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Activate: Main] You may rest 3 of your DON!! cards and this Character: Draw 1 card.',
      }),
    )

    expect(result.effects[0]?.costs).toEqual([
      { kind: 'restDon', amount: 3 },
      { kind: 'restSelf' },
    ])
  })

  it('captures qualified hand-discard and replacement costs', () => {
    const qualified = parseCardEffects(
      card({
        effect:
          '[On Play] You may trash 1 card with a [Trigger] from your hand: Draw 3 cards.',
      }),
    )
    const replacement = parseCardEffects(
      card({
        effect:
          'If this Character would be removed from the field, you may trash 2 cards from your hand instead.',
      }),
    )

    expect(qualified.effects[0]?.costs).toEqual([
      { kind: 'discardHand', amount: 1 },
    ])
    expect(replacement.effects[0]?.costs).toEqual([
      { kind: 'discardHand', amount: 2 },
    ])
  })

  it('parses standalone effect negation without inventing a follow-up action', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] Negate the effect of up to 1 of your opponent's Characters with a cost of 4 or less.",
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'negateEffect',
        target: target({
          subject: 'opponent',
          zones: ['field'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumCost: 4,
          },
        }),
      },
    ])
  })

  it('treats a specifically named Leader target as an instance-local lock', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] Your [Navigator] Leader's base power becomes 7000 until the end of your opponent's next End Phase.<br/>[Blocker]",
      }),
    )

    expect(result.effects[0]).toMatchObject({
      condition: {
        kind: 'leader',
        names: ['Navigator'],
        traits: [],
        monoColorRequired: false,
      },
      branches: [
        {
          actions: [
            {
              kind: 'leaderBasePower',
              powerDelta: 2_000,
              duration: 'untilOpponentsNextEndPhase',
            },
          ],
        },
      ],
      rainbowLuffyCompatibility: 'incompatible',
    })
    expect(result.effects[1]?.rainbowLuffyCompatibility).toBe('compatible')
  })

  it('retains an opponent-turn power modifier duration', () => {
    const result = parseCardEffects(
      card({ effect: "This Character gains +3000 power on your opponent's turn." }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'powerModifier',
        powerDelta: 3_000,
        target: target({
          subject: 'thisCard',
          zones: ['field'],
          allowsSelf: true,
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
        }),
        duration: 'opponentsTurn',
      },
    ])
  })

  it('never attributes ambiguous owner-deck movement to the opponent', () => {
    const effect = "Place 1 card at the bottom of the owner's deck."
    const result = parseCardEffects(card({ effect }))

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'unknown',
        normalizedText: "place 1 card at the bottom of the owner's deck.",
      },
    ])
    expect(result.unparsedClauses).toEqual([effect])
  })

  it('parses a condition before a qualified colon cost', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] If your Leader is [Navigator], you may trash 1 card with a [Trigger] from your hand: Draw 2 cards.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      condition: {
        kind: 'leader',
        names: ['Navigator'],
        traits: [],
        monoColorRequired: false,
      },
      costs: [{ kind: 'discardHand', amount: 1 }],
      branches: [
        { actions: [{ kind: 'draw', subject: 'player', amount: 2 }] },
      ],
      rainbowLuffyCompatibility: 'incompatible',
    })
  })

  it('does not infer restSelf from an unrelated bare conjunction', () => {
    const valid = parseCardEffects(
      card({
        effect:
          '[Activate: Main] Rest 2 of your DON!! cards and this Character: Draw 1 card.',
      }),
    )
    const invalid = parseCardEffects(
      card({
        effect:
          '[Activate: Main] Trash 1 card from your hand and this Character: Draw 1 card.',
      }),
    )

    expect(valid.effects[0]?.costs).toEqual([
      { kind: 'restDon', amount: 2 },
      { kind: 'restSelf' },
    ])
    expect(invalid.effects[0]?.costs).toEqual([])
    expect(invalid.effects[0]?.branches[0]?.actions).toEqual([
      expect.objectContaining({ kind: 'unknown' }),
    ])
  })

  it('keeps an incomplete recognized target unknown and diagnostic', () => {
    const effect = "[On Play] Rest several of your opponent's Characters."
    const result = parseCardEffects(card({ effect }))
    const actions = result.effects.flatMap((instance) =>
      instance.branches.flatMap((branch) => branch.actions),
    )

    expect(actions).toContainEqual({
      kind: 'unknown',
      normalizedText: "rest several of your opponent's characters.",
    })
    expect(result.unparsedClauses).toContain(
      "Rest several of your opponent's Characters.",
    )
    expect(actions).not.toContainEqual(
      expect.objectContaining({
        kind: 'remove',
        target: expect.objectContaining({ quantity: 1 }),
      }),
    )
  })

  it('does not treat an exclusionary this Character phrase as self-deployment', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] Play up to 1 Character card with 4000 power or less other than this Character from your trash.',
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'deploy',
        target: target({
          subject: 'player',
          zones: ['trash'],
          predicate: {
            ...emptyPredicate,
            cardTypes: ['CHARACTER'],
            maximumPower: 4_000,
          },
          allowsSelf: false,
        }),
      },
    ])
  })

  it('parses conditional Rush and in-hand Counter as actions', () => {
    const rush = parseCardEffects(
      card({
        effect:
          '[On Play] If there is a Character with a cost of 12 or more, this Character gains [Rush].',
      }),
    )
    const counter = parseCardEffects(
      card({
        effect:
          'If you only have Characters without a Counter, this card in your hand has a +2000 Counter.',
      }),
    )

    expect(rush.effects[0]).toMatchObject({
      condition: {
        kind: 'cards',
        target: { predicate: { minimumCost: 12 } },
        minimumCount: 1,
      },
      branches: [{ actions: [{ kind: 'keyword', keyword: 'rush' }] }],
    })
    expect(counter.effects[0]).toMatchObject({
      condition: {
        kind: 'cards',
        target: {
          subject: 'player',
          quantity: 'all',
          predicate: { counter: 'withoutCounter' },
        },
        minimumCount: 1,
      },
      branches: [
        {
          actions: [
            {
              kind: 'counterModifier',
              amount: 2_000,
              target: expect.objectContaining({
                subject: 'thisCard',
                zones: ['hand'],
                quantity: 1,
                allowsSelf: true,
              }),
            },
          ],
        },
      ],
    })
  })

  it('parses an opponent-turn power modifier after an unsupported cost modifier', () => {
    const result = parseCardEffects(
      card({
        effect:
          "This Character gains +12 cost and gains +3000 power on your opponent's turn.",
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toContainEqual({
      kind: 'powerModifier',
      powerDelta: 3_000,
      target: target({
        subject: 'thisCard',
        zones: ['field'],
        predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
        allowsSelf: true,
      }),
      duration: 'opponentsTurn',
    })
    expect(result.unparsedClauses).toContain(
      'This Character gains +12 cost and.',
    )
  })

  it('preserves the printed quantity on power-modifier targets', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Counter] Up to 2 of your Characters gain +2000 power during this battle.',
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'powerModifier',
      target: { subject: 'player', quantity: 2 },
    })
  })

  it('keeps both-player draw distinct from player draw', () => {
    const result = parseCardEffects(
      card({ effect: '[On Play] Both players draw 2 cards.' }),
    )
    const nearNegative = parseCardEffects(
      card({ effect: '[On Play] Both players draw cards.' }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      { kind: 'draw', subject: 'bothPlayers', amount: 2 },
    ])
    expect(nearNegative.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'unknown',
        normalizedText: 'both players draw cards.',
      },
    ])
    expect(nearNegative.unparsedClauses).toEqual([
      'Both players draw cards.',
    ])
  })

  it('passes the condition-stripped result to actions after a leading cost', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[Activate: Main] [Once Per Turn] DON!!-1: If this Character was played on this turn, negate the effect of up to 1 of your opponent's Characters with a cost of 6 or less, and K.O. that Character.",
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'activateMain',
      timing: ['oncePerTurn'],
      condition: { kind: 'selfState', state: 'playedThisTurn' },
      costs: [{ kind: 'donMinus', amount: 1 }],
      branches: [
        {
          actions: [
            expect.objectContaining({ kind: 'negateEffect' }),
            expect.objectContaining({ kind: 'remove', mode: 'ko' }),
          ],
        },
      ],
    })
    expect(result.unparsedClauses).toEqual([])
  })

  it('retains optionality from a condition-first cost clause', () => {
    const optional = parseCardEffects(
      card({
        effect:
          '[On Play] If you have a Character with a [Trigger], you may trash 1 card from your hand: Draw 2 cards.',
      }),
    )
    const required = parseCardEffects(
      card({
        effect:
          '[On Play] If you have a Character with a [Trigger], trash 1 card from your hand: Draw 2 cards.',
      }),
    )

    expect(optional.effects[0]?.optional).toBe(true)
    expect(required.effects[0]?.optional).toBe(false)
  })

  it('centralizes other-than-self exclusion for power targets', () => {
    const excluded = parseCardEffects(
      card({
        effect:
          '[Counter] Up to 1 of your Characters other than this Character gains +2000 power during this battle.',
      }),
    )
    const self = parseCardEffects(
      card({
        effect:
          '[Counter] This Character gains +2000 power during this battle.',
      }),
    )

    expect(excluded.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'powerModifier',
        powerDelta: 2_000,
        target: target({
          subject: 'player',
          zones: ['field'],
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
          allowsSelf: false,
        }),
        duration: 'thisTurn',
      },
    ])
    expect(self.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'powerModifier',
      target: { subject: 'thisCard', allowsSelf: true },
    })
  })

  it('preserves mixed Leader-or-Character target types', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Counter] Up to 1 of your Leader or Characters gains +3000 power during this battle.',
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions[0]).toMatchObject({
      kind: 'powerModifier',
      target: {
        subject: 'player',
        quantity: 1,
        predicate: { cardTypes: ['LEADER', 'CHARACTER'] },
      },
    })
  })

  it('parses protection for another own Character without allowing self', () => {
    const result = parseCardEffects(
      card({
        effect:
          "If one of your Characters other than this Character would be removed from the field by your opponent's effect, you may trash 2 cards from your hand instead.",
      }),
    )

    expect(result.effects[0]).toMatchObject({
      condition: { kind: 'always' },
      costs: [{ kind: 'discardHand', amount: 2 }],
      optional: true,
      branches: [
        {
          actions: [
            {
              kind: 'protect',
              target: target({
                subject: 'player',
                zones: ['field'],
                predicate: {
                  ...emptyPredicate,
                  cardTypes: ['CHARACTER'],
                },
                allowsSelf: false,
              }),
            },
          ],
        },
      ],
    })
    expect(result.unparsedClauses).toEqual([])
  })

  it('keeps non-replacement other-than-self wording unknown and diagnostic', () => {
    const effect =
      "If one of your Characters other than this Character was removed from the field by your opponent's effect, you may trash 2 cards from your hand instead."
    const result = parseCardEffects(card({ effect }))
    const actions = result.effects.flatMap((instance) =>
      instance.branches.flatMap((branch) => branch.actions),
    )

    expect(actions).not.toContainEqual(
      expect.objectContaining({ kind: 'protect' }),
    )
    expect(actions).toContainEqual(
      expect.objectContaining({ kind: 'unknown' }),
    )
    expect(result.unparsedClauses.length).toBeGreaterThan(0)
  })

  it('continues to allow explicit self replacement protection', () => {
    const result = parseCardEffects(
      card({
        effect:
          'If this Character would be removed from the field, you may trash 1 card from your hand instead.',
      }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'protect',
        target: target({
          subject: 'thisCard',
          zones: ['field'],
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
          allowsSelf: true,
        }),
      },
    ])
  })

  it('makes an unsupported colon-cost instance unavailable through Then', () => {
    const result = parseCardEffects(
      card({
        effect:
          "[On Play] You may return 1 card from your hand to your deck: Draw 2 cards. Then, rest up to 1 of your opponent's Characters.",
      }),
    )
    const effect = result.effects[0]

    expect(effect).toMatchObject({
      activation: 'onPlay',
      branches: {
        0: {
          actions: [expect.objectContaining({ kind: 'unknown' })],
        },
      },
    })
    expect(
      effect?.branches.flatMap((branch) => branch.actions),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'draw' }),
    )
    expect(
      effect?.branches.flatMap((branch) => branch.actions),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'remove', mode: 'rest' }),
    )
    expect(result.unparsedClauses).toEqual([
      'You may return 1 card from your hand to your deck: Draw 2 cards.',
      "Then, rest up to 1 of your opponent's Characters.",
    ])
  })

  it('parses Play this Character card from trash before self fallback', () => {
    const result = parseCardEffects(
      card({ trigger: '[Trigger] Play this Character card from your trash.' }),
    )

    expect(result.effects[0]?.branches[0]?.actions).toEqual([
      {
        kind: 'deploy',
        target: target({
          subject: 'thisCard',
          zones: ['trash'],
          predicate: { ...emptyPredicate, cardTypes: ['CHARACTER'] },
          allowsSelf: true,
        }),
      },
    ])
    expect(result.unparsedClauses).toEqual([])
  })

  it('keeps annotated context and shared cost when the leading action is unknown', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] DON!!-1: Perform an unfamiliar maneuver. Then, draw 1 card.',
      }),
    )

    expect(result.effects).toMatchObject([
      {
        activation: 'onPlay',
        condition: { kind: 'always' },
        costs: [{ kind: 'donMinus', amount: 1 }],
        branches: [
          {
            actions: [
              { kind: 'unknown', normalizedText: 'perform an unfamiliar maneuver.' },
              { kind: 'draw', subject: 'player', amount: 1 },
            ],
          },
        ],
      },
    ])
    expect(result.unparsedClauses).toContain(
      'Perform an unfamiliar maneuver.',
    )
  })

  it('does not inject the printed Event cost into parsed effect instances', () => {
    const result = parseCardEffects(
      card({
        cardType: 'EVENT',
        cost: 4,
        effect:
          '[Main] Draw 1 card.<br/>[Counter] Up to 1 of your Leader or Character gains +2000 power during this battle.',
        trigger: '[Trigger] Draw 1 card.',
      }),
    )

    expect(result.effects.map(({ activation, costs }) => [activation, costs])).toEqual([
      ['main', []],
      ['counter', []],
      ['trigger', []],
    ])
  })

  it('keeps alternative costs unknown instead of charging both', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[Activate: Main] You may trash 1 card from your hand or rest 1 of your DON!! cards: Draw 2 cards.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      activation: 'activateMain',
      costs: [],
      branches: [
        { actions: [expect.objectContaining({ kind: 'unknown' })] },
      ],
    })
    expect(result.effects[0]?.branches[0]?.actions).not.toContainEqual(
      expect.objectContaining({ kind: 'draw' }),
    )
    expect(result.unparsedClauses).toEqual([
      'You may trash 1 card from your hand or rest 1 of your DON!! cards: Draw 2 cards.',
    ])
  })

  it('does not mistake an or-less payment predicate for an alternative cost', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] You may trash 1 card with a cost of 2 or less from your hand: Draw 2 cards.',
      }),
    )

    expect(result.effects[0]).toMatchObject({
      costs: [{ kind: 'discardHand', amount: 1 }],
      branches: [
        { actions: [{ kind: 'draw', subject: 'player', amount: 2 }] },
      ],
    })
    expect(result.unparsedClauses).toEqual([])
  })

  it.each([
    [
      'all rejects one incompatible child',
      'If your Leader is [Navigator] and you have a Character with a [Trigger], draw 1 card.',
      'all',
      'incompatible',
    ],
    [
      'all retains a neutral child',
      'If an unfamiliar condition applies and you have a Character with a [Trigger], draw 1 card.',
      'all',
      'neutral',
    ],
    [
      'any accepts one compatible child',
      'If your Leader is [Navigator] or you have a Character with a [Trigger], draw 1 card.',
      'any',
      'compatible',
    ],
    [
      'any retains a neutral child when none are compatible',
      'If your Leader is [Navigator] or an unfamiliar condition applies, draw 1 card.',
      'any',
      'neutral',
    ],
    [
      'any rejects all incompatible children',
      'If your Leader is [Navigator] or your Leader has the {Test Crew} type, draw 1 card.',
      'any',
      'incompatible',
    ],
  ])(
    'applies compatibility truth table: %s',
    (_name, effect, requirementKind, compatibility) => {
      const result = parseCardEffects(card({ effect }))

      expect(result.effects[0]).toMatchObject({
        condition: { kind: requirementKind },
        rainbowLuffyCompatibility: compatibility,
      })
    },
  )

  it('does not assign an unqualified there-is condition to the player', () => {
    const result = parseCardEffects(
      card({
        effect:
          '[On Play] If there is a Character with a cost of 12 or more, draw 1 card.',
      }),
    )

    expect(result.effects[0]?.condition).toMatchObject({
      kind: 'cards',
      target: { subject: 'bothPlayers' },
    })
  })
})
