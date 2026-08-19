import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CardColorRail } from './CardColorRail.js'

describe('CardColorRail', () => {
  it('prints canonical color names and splits the visual rail equally', () => {
    render(<CardColorRail colors={[' blue ', 'RED', 'Blue']} />)

    const color = screen.getByRole('group', { name: 'Card colors' })
    expect(within(color).getByText('Red / Blue')).toBeVisible()

    const rail = color.querySelector('[aria-hidden="true"]')
    expect(rail).toHaveClass('card-color-rail')
    expect(rail).toHaveAttribute('aria-hidden', 'true')
    expect(rail?.children).toHaveLength(2)
    expect(rail?.children[0]).toHaveClass(
      'card-color-rail__segment',
      'card-color-rail__segment--red',
    )
    expect(rail?.children[0]).toHaveStyle({ flexGrow: '1' })
    expect(rail?.children[1]).toHaveClass(
      'card-color-rail__segment',
      'card-color-rail__segment--blue',
    )
    expect(rail?.children[1]).toHaveStyle({ flexGrow: '1' })
  })

  it('uses a printed Unknown fallback and a neutral rail', () => {
    render(<CardColorRail colors={['Orange']} />)

    expect(screen.getByText('Unknown')).toBeVisible()
    expect(
      screen
        .getByRole('group', { name: 'Card colors' })
        .querySelector('.card-color-rail__segment--unknown'),
    ).toBeInTheDocument()
  })
})
