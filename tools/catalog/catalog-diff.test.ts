import { describe, expect, it } from 'vitest'

import { comparedGameplayFields, diffCatalogs } from './catalog-diff.js'
import type { PlayableCard } from './model.js'

function makeCard(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  return {
    cardNumber,
    name: `Card ${cardNumber}`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 1,
    life: null,
    power: 1000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test'],
    effect: '',
    trigger: '',
    setMembership: ['OP17'],
    variantsCollapsed: 1,
    entryShortcut: cardNumber.slice(-3),
    isSpecialReprint: false,
    ...overrides,
  }
}

describe('diffCatalogs', () => {
  it('reports every diff list in deterministic code-unit order', () => {
    const before = [
      makeCard('OP17-003', { isSpecialReprint: true }),
      makeCard('OP17-002', { rarity: 'C' }),
      makeCard('OP17-001', {
        colors: ['Red', 'Blue'],
        cost: 1,
        name: 'Before name',
      }),
      makeCard('OP17-010', { rarity: 'MYSTERY' }),
      makeCard('OP17-009', { rarity: 'C' }),
      makeCard('OP17-004', { isSpecialReprint: false }),
    ]
    const after = [
      makeCard('OP17-011'),
      makeCard('OP17-002', { rarity: 'MYSTERY' }),
      makeCard('OP17-001', {
        colors: ['Blue', 'Red'],
        cost: 2,
        name: 'After name',
      }),
      makeCard('OP17-010', { rarity: 'C' }),
      makeCard('OP17-009', { rarity: '-' }),
      makeCard('OP17-003', { isSpecialReprint: false }),
      makeCard('OP17-004', { isSpecialReprint: true }),
    ]

    expect(diffCatalogs(before, after)).toEqual({
      added: ['OP17-011'],
      removed: [],
      gameplayChanges: [
        {
          cardNumber: 'OP17-001',
          field: 'name',
          before: 'Before name',
          after: 'After name',
        },
        {
          cardNumber: 'OP17-001',
          field: 'cost',
          before: 1,
          after: 2,
        },
        {
          cardNumber: 'OP17-001',
          field: 'colors',
          before: ['Red', 'Blue'],
          after: ['Blue', 'Red'],
        },
        {
          cardNumber: 'OP17-002',
          field: 'rarity',
          before: 'C',
          after: 'MYSTERY',
        },
        {
          cardNumber: 'OP17-009',
          field: 'rarity',
          before: 'C',
          after: '-',
        },
        {
          cardNumber: 'OP17-010',
          field: 'rarity',
          before: 'MYSTERY',
          after: 'C',
        },
      ],
      specialReprintsAdded: ['OP17-004'],
      specialReprintsRemoved: ['OP17-003'],
      newlyUnknownRarities: ['OP17-002', 'OP17-009'],
      newlyResolvedRarities: ['OP17-010'],
    })
  })

  it('sorts added and removed IDs by code unit and excludes them from transitions', () => {
    const before = [
      makeCard('OP17-002', { isSpecialReprint: true, rarity: 'UNKNOWN' }),
      makeCard('OP17-010'),
    ]
    const after = [
      makeCard('OP17-001', { isSpecialReprint: true, rarity: 'UNKNOWN' }),
      makeCard('OP17-003'),
    ]

    expect(diffCatalogs(before, after)).toEqual({
      added: ['OP17-001', 'OP17-003'],
      removed: ['OP17-002', 'OP17-010'],
      gameplayChanges: [],
      specialReprintsAdded: ['OP17-001'],
      specialReprintsRemoved: ['OP17-002'],
      newlyUnknownRarities: [],
      newlyResolvedRarities: [],
    })
  })

  it('ignores metadata-only changes', () => {
    const before = makeCard('OP17-001')
    const after = makeCard('OP17-001', {
      entryShortcut: null,
      setMembership: ['OP01', 'OP17'],
      variantsCollapsed: 4,
    })

    expect(diffCatalogs([before], [after])).toEqual({
      added: [],
      removed: [],
      gameplayChanges: [],
      specialReprintsAdded: [],
      specialReprintsRemoved: [],
      newlyUnknownRarities: [],
      newlyResolvedRarities: [],
    })
  })

  it('returns an empty diff for identical catalogs without mutating inputs', () => {
    const before = [makeCard('OP17-002'), makeCard('OP17-001')]
    const after = before.map((card) => ({
      ...card,
      colors: [...card.colors],
      traits: [...card.traits],
      setMembership: [...card.setMembership],
    }))
    const beforeSnapshot = structuredClone(before)
    const afterSnapshot = structuredClone(after)

    expect(diffCatalogs(before, after)).toEqual({
      added: [],
      removed: [],
      gameplayChanges: [],
      specialReprintsAdded: [],
      specialReprintsRemoved: [],
      newlyUnknownRarities: [],
      newlyResolvedRarities: [],
    })
    expect(before).toEqual(beforeSnapshot)
    expect(after).toEqual(afterSnapshot)
    expect(comparedGameplayFields).toEqual([
      'name',
      'cardType',
      'cost',
      'life',
      'power',
      'counter',
      'colors',
      'attribute',
      'traits',
      'effect',
      'trigger',
      'rarity',
    ])
  })
})
