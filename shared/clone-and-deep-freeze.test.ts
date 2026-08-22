import { describe, expect, it } from 'vitest'

import { cloneAndDeepFreeze } from './clone-and-deep-freeze.js'

describe('cloneAndDeepFreeze', () => {
  it('returns a recursively frozen clone', () => {
    const source = {
      effects: [
        {
          branches: [{ actions: [{ kind: 'draw', amount: 1 }] }],
        },
      ],
    }

    const clone = cloneAndDeepFreeze(source)

    expect(Object.isFrozen(clone)).toBe(true)
    expect(Object.isFrozen(clone.effects)).toBe(true)
    expect(Object.isFrozen(clone.effects[0])).toBe(true)
    expect(Object.isFrozen(clone.effects[0]!.branches)).toBe(true)
    expect(Object.isFrozen(clone.effects[0]!.branches[0])).toBe(true)
    expect(Object.isFrozen(clone.effects[0]!.branches[0]!.actions)).toBe(true)
    expect(Object.isFrozen(clone.effects[0]!.branches[0]!.actions[0])).toBe(
      true,
    )
  })

  it('detaches every nested object and array from the input', () => {
    const source = {
      effects: [{ evidence: ['first'] }],
    }

    const clone = cloneAndDeepFreeze(source)

    expect(clone).not.toBe(source)
    expect(clone.effects).not.toBe(source.effects)
    expect(clone.effects[0]).not.toBe(source.effects[0])
    expect(clone.effects[0]!.evidence).not.toBe(source.effects[0]!.evidence)

    source.effects[0]!.evidence.push('changed after cloning')
    expect(clone.effects[0]!.evidence).toEqual(['first'])
  })

  it('preserves object-key, array, and nested branch order', () => {
    const source = {
      third: 3,
      first: 1,
      second: 2,
      branches: [
        { id: 'branch-b', actions: ['remove', 'draw'] },
        { id: 'branch-a', actions: ['deploy', 'protect'] },
      ],
    }

    const clone = cloneAndDeepFreeze(source)

    expect(Object.keys(clone)).toEqual([
      'third',
      'first',
      'second',
      'branches',
    ])
    expect(clone.branches.map(({ id }) => id)).toEqual([
      'branch-b',
      'branch-a',
    ])
    expect(clone.branches.map(({ actions }) => actions)).toEqual([
      ['remove', 'draw'],
      ['deploy', 'protect'],
    ])
  })
})
