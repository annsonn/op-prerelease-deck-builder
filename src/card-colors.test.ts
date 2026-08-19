import { describe, expect, it } from 'vitest'

import {
  displayCardColorOrder,
  normalizeDisplayCardColors,
} from './card-colors.js'

describe('normalizeDisplayCardColors', () => {
  it('normalizes recognized colors into stable display order', () => {
    expect(
      normalizeDisplayCardColors([
        ' yellow ',
        'BLUE',
        'red',
        'blue',
        'black',
        'purple',
        'green',
      ]),
    ).toEqual(['Red', 'Blue', 'Green', 'Purple', 'Yellow', 'Black'])
    expect(displayCardColorOrder).toEqual([
      'Red',
      'Blue',
      'Green',
      'Purple',
      'Yellow',
      'Black',
      'Unknown',
    ])
  })

  it('uses Unknown only when no recognized color remains', () => {
    expect(
      normalizeDisplayCardColors(['Orange', ' ', 'not-a-color']),
    ).toEqual(['Unknown'])
    expect(normalizeDisplayCardColors(['unknown', 'red'])).toEqual(['Red'])
  })

  it('returns a frozen result detached from the source array', () => {
    const source = ['red']
    const normalized = normalizeDisplayCardColors(source)

    source[0] = 'Blue'

    expect(normalized).toEqual(['Red'])
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(displayCardColorOrder)).toBe(true)
  })
})
