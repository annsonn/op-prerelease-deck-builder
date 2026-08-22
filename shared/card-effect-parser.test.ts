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
})
