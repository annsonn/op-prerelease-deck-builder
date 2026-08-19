import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TestPoolButton } from './TestPoolButton.js'

describe('TestPoolButton', () => {
  it('presents tournament and development draws in that order', () => {
    render(<TestPoolButton onGenerate={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName(
      'Generate 72-card tournament pool',
    )
    expect(buttons[1]).toHaveAccessibleName(
      'Generate 60-card development pool',
    )
  })

  it('explains that generation replaces current entries', () => {
    render(<TestPoolButton onGenerate={vi.fn()} />)

    const utility = screen.getByRole('complementary', {
      name: 'Testing utility',
    })
    expect(utility).toHaveTextContent(
      'Generating a test pool replaces the cards currently entered.',
    )
    expect(utility).not.toHaveTextContent(/exact|official|guaranteed|proprietary/i)
  })

  it('reports the selected mode', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<TestPoolButton onGenerate={onGenerate} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )

    expect(onGenerate.mock.calls).toEqual([
      ['tournament'],
      ['development'],
    ])
  })

  it('groups both controls in the responsive action container', () => {
    render(<TestPoolButton onGenerate={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]?.parentElement).toHaveClass('test-pool-actions')
    expect(buttons[1]?.parentElement).toBe(buttons[0]?.parentElement)
    expect(buttons[0]).toHaveClass('test-pool-button')
    expect(buttons[1]).toHaveClass('test-pool-button')
  })
})
