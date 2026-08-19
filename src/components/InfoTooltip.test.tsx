import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { InfoTooltip } from './InfoTooltip.js'

function ControlledInfoTooltip() {
  const [open, setOpen] = useState(false)
  const tooltipId = 'blocker-help'

  return (
    <>
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId={tooltipId}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      />
      {open ? (
        <p id={tooltipId} role="tooltip">
          Blocker definition
        </p>
      ) : null}
    </>
  )
}

describe('InfoTooltip', () => {
  it('uses a controlled native button with stable disclosure semantics', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId="blocker-help"
        open={false}
        onToggle={onToggle}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'What does Blockers mean?',
    })
    expect(trigger).toHaveAttribute('type', 'button')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls', 'blocker-help')
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(trigger).toHaveTextContent('')

    rerender(
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId="blocker-help"
        open
        onToggle={onToggle}
      />,
    )

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', 'blocker-help')
    expect(trigger).toHaveAttribute('aria-describedby', 'blocker-help')
  })

  it('toggles only from activation events', () => {
    const onToggle = vi.fn()
    render(
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId="blocker-help"
        open={false}
        onToggle={onToggle}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.focus(trigger)
    fireEvent.pointerEnter(trigger)
    fireEvent.pointerLeave(trigger)
    fireEvent.blur(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onToggle).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('uses native Enter and Space button activation exactly once each', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId="blocker-help"
        open={false}
        onToggle={onToggle}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'What does Blockers mean?',
    })
    trigger.focus()

    await user.keyboard('{Enter}')
    expect(onToggle).toHaveBeenCalledTimes(1)

    await user.keyboard(' ')
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('toggles exactly once from one touch pointer sequence', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <InfoTooltip
        label="What does Blockers mean?"
        tooltipId="blocker-help"
        open={false}
        onToggle={onToggle}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'What does Blockers mean?',
    })
    await user.pointer([
      { keys: '[TouchA>]', target: trigger },
      { keys: '[/TouchA]', target: trigger },
    ])

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('opens, closes from the same trigger, and reopens from touch', async () => {
    const user = userEvent.setup()
    render(<ControlledInfoTooltip />)

    const trigger = screen.getByRole('button', {
      name: 'What does Blockers mean?',
    })
    await user.click(trigger)
    let tooltip = screen.getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.pointer([
      { keys: '[TouchA>]', target: trigger },
      { keys: '[/TouchA]', target: trigger },
    ])
    tooltip = screen.getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
  })

  it('renders text variant children and toggles through the same API', () => {
    const onToggle = vi.fn()
    render(
      <InfoTooltip
        label="What does soft target mean for Blockers?"
        tooltipId="blocker-target-help"
        open={false}
        onToggle={onToggle}
        variant="text"
      >
        soft target
      </InfoTooltip>,
    )

    const trigger = screen.getByRole('button', {
      name: 'What does soft target mean for Blockers?',
    })
    expect(trigger).toHaveTextContent('soft target')
    fireEvent.click(trigger)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
