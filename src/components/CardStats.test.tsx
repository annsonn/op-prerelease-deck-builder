import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CardStats } from './CardStats.js'

describe('CardStats', () => {
  it('shows printed values in Cost, Power, Counter order', () => {
    render(<CardStats cost={3} power={5000} counter={1000} />)

    const stats = screen.getByRole('group', { name: 'Card stats' })
    const values = within(stats).getAllByTestId('card-stat-value')
    expect(values.map((value) => value.textContent)).toEqual([
      'Cost 3',
      'Power 5,000',
      'Counter 1,000',
    ])
  })

  it('shows an em dash for unavailable printed values', () => {
    render(<CardStats cost={1} power={null} counter={null} />)

    expect(screen.getByText('Power —')).toBeVisible()
    expect(screen.getByText('Counter —')).toBeVisible()
  })
})
