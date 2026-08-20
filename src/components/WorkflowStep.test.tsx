import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowStep } from './WorkflowStep.js'

function ControlledStep({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)

  return (
    <WorkflowStep
      stepNumber={1}
      headingId="test-heading"
      title="Choose your set"
      description="Your pool resets when you change sets."
      isOpen={open}
      onOpenChange={setOpen}
      className="setup-panel"
    >
      <label>
        Preserved value
        <input defaultValue="kept" />
      </label>
    </WorkflowStep>
  )
}

function workflowDisclosure(title: string): HTMLDetailsElement {
  const disclosure = screen.getByRole('heading', { name: title }).closest('details')
  if (!(disclosure instanceof HTMLDetailsElement)) {
    throw new Error(`Expected ${title} inside a details disclosure.`)
  }
  return disclosure
}

function nextNativeToggle(disclosure: HTMLDetailsElement): Promise<void> {
  return new Promise((resolve) => {
    disclosure.addEventListener('toggle', () => resolve(), { once: true })
  })
}

describe('WorkflowStep', () => {
  it('renders a controlled closed disclosure with its summary copy visible', () => {
    render(<ControlledStep initiallyOpen={false} />)

    const disclosure = workflowDisclosure('Choose your set')
    const summary = screen.getByText('Choose your set').closest('summary')
    const stepNumber = summary?.querySelector('.step-number')
    const indicator = summary?.querySelector('.workflow-step__indicator')

    expect(disclosure).toHaveClass('panel', 'workflow-step', 'setup-panel')
    expect(disclosure).toHaveAttribute('aria-labelledby', 'test-heading')
    expect(disclosure).not.toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'Choose your set' })).toBeVisible()
    expect(screen.getByText('Your pool resets when you change sets.')).toBeVisible()
    expect(stepNumber).toHaveTextContent('1')
    expect(stepNumber).toHaveAttribute('aria-hidden', 'true')
    expect(indicator).toHaveTextContent('+')
    expect(indicator).toHaveAttribute('aria-hidden', 'true')

    const child = screen.getByRole('textbox', { name: 'Preserved value', hidden: true })
    expect(child).toBeInTheDocument()
    expect(child).not.toBeVisible()
  })

  it('renders a controlled open disclosure and its child content', () => {
    render(<ControlledStep />)

    const disclosure = workflowDisclosure('Choose your set')
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByRole('textbox', { name: 'Preserved value' })).toBeVisible()
    expect(disclosure.querySelector('.workflow-step__indicator')).toHaveTextContent('−')
  })

  it('keeps the same child node and value mounted across close and reopen', async () => {
    const user = userEvent.setup()
    render(<ControlledStep />)

    const disclosure = workflowDisclosure('Choose your set')
    const summary = screen.getByText('Choose your set').closest('summary')
    if (summary === null) throw new Error('Expected workflow summary.')

    const child = screen.getByRole('textbox', { name: 'Preserved value' })
    await user.clear(child)
    await user.type(child, 'edited')

    await user.click(summary)
    await waitFor(() => expect(disclosure).not.toHaveAttribute('open'))
    expect(child).not.toBeVisible()

    await user.click(summary)
    await waitFor(() => expect(disclosure).toHaveAttribute('open'))
    expect(screen.getByRole('textbox', { name: 'Preserved value' })).toBe(child)
    expect(child).toHaveValue('edited')
  })

  it('reports native summary clicks as true then false', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    function ClickHarness() {
      const [open, setOpen] = useState(false)
      return (
        <WorkflowStep
          stepNumber={2}
          headingId="entry-heading"
          title="Enter your cards"
          description="Enter card numbers."
          isOpen={open}
          onOpenChange={(nextOpen) => {
            onOpenChange(nextOpen)
            setOpen(nextOpen)
          }}
        >
          <button type="button">Child action</button>
        </WorkflowStep>
      )
    }

    render(<ClickHarness />)
    const summary = screen.getByText('Enter your cards').closest('summary')
    if (summary === null) throw new Error('Expected workflow summary.')

    await user.click(summary)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(true))
    await user.click(summary)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false))
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false])
  })

  it('does not echo prop-driven open changes through onOpenChange', async () => {
    const onOpenChange = vi.fn()
    const view = render(
      <WorkflowStep
        stepNumber={2}
        headingId="entry-heading"
        title="Enter your cards"
        description="Enter card numbers."
        isOpen={false}
        onOpenChange={onOpenChange}
      >
        <button type="button">Child action</button>
      </WorkflowStep>,
    )
    const disclosure = workflowDisclosure('Enter your cards')
    expect(disclosure).not.toHaveAttribute('open')
    expect(onOpenChange).not.toHaveBeenCalled()

    const openingToggle = nextNativeToggle(disclosure)
    view.rerender(
      <WorkflowStep
        stepNumber={2}
        headingId="entry-heading"
        title="Enter your cards"
        description="Enter card numbers."
        isOpen
        onOpenChange={onOpenChange}
      >
        <button type="button">Child action</button>
      </WorkflowStep>,
    )
    await openingToggle
    expect(disclosure).toHaveAttribute('open')
    expect(onOpenChange).not.toHaveBeenCalled()

    const closingToggle = nextNativeToggle(disclosure)
    view.rerender(
      <WorkflowStep
        stepNumber={2}
        headingId="entry-heading"
        title="Enter your cards"
        description="Enter card numbers."
        isOpen={false}
        onOpenChange={onOpenChange}
      >
        <button type="button">Child action</button>
      </WorkflowStep>,
    )
    await closingToggle
    expect(disclosure).not.toHaveAttribute('open')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
