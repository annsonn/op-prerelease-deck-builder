import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DeckAnalysis } from '../solver/types.js'
import { DeckRoleCoverage } from './DeckRoleCoverage.js'

const roleCoverage: DeckAnalysis['roleCoverage'] = {
  twoKCounter: { count: 7, target: 10 },
  blocker: { count: 8, target: 10 },
  vanillaLike: { count: 9, target: 10 },
  draw: { count: 3, target: null },
  removal: { count: 4, target: null },
  interaction: { count: 6, target: 5 },
  boss: { count: 5, target: 5 },
  rush: { count: 2, target: null },
  banish: { count: 1, target: null },
  brick: { count: 11, target: null },
}

const approvedRoleHelp = [
  {
    label: '2K counters',
    description: 'cards with at least 2,000 printed Counter.',
  },
  {
    label: 'Blockers',
    description: 'cards with a Rainbow-Luffy-usable Blocker effect.',
  },
  {
    label: 'Vanilla-like bodies',
    description:
      'efficient 1–6 cost Characters with strong power for their cost and no detected combo dependency.',
  },
  {
    label: 'Interaction',
    description:
      'cards with usable draw or removal; a card that has both is counted once here.',
  },
  {
    label: 'Bosses',
    description:
      '7+ cost Characters with at least 8,000 power or a significant closing effect.',
  },
  {
    label: 'Draw',
    description: 'cards with usable card-draw effects.',
  },
  {
    label: 'Removal',
    description:
      'cards that disrupt opposing cards through K.O., bounce, bottom-deck, rest, or power reduction.',
  },
  { label: 'Rush', description: 'cards with a usable Rush effect.' },
  { label: 'Banish', description: 'cards with a usable Banish effect.' },
  {
    label: 'Bricks',
    description: 'Character cards with zero or no printed Counter.',
  },
] as const

const roleLabels = approvedRoleHelp.map(({ label }) => label)

describe('DeckRoleCoverage', () => {
  it('renders overlapping roles in the canonical review order', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    expect(
      within(list).getAllByRole('term').map((term) => term.textContent),
    ).toEqual(roleLabels)
  })

  it('shows compact measurements with accessible target context', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const measurements = within(list).getAllByRole('definition')

    expect(measurements.map((measurement) => measurement.textContent)).toEqual([
      '7 / 10',
      '8 / 10',
      '9 / 10',
      '6 / 5',
      '5 / 5',
      '3',
      '4',
      '2',
      '1',
      '11',
    ])
    expect(list).not.toHaveTextContent('soft target')
    expect(
      measurements.map((measurement) =>
        measurement.getAttribute('aria-label'),
      ),
    ).toEqual([
      '7 cards; recommended target 10',
      '8 cards; recommended target 10',
      '9 cards; recommended target 10',
      '6 cards; recommended target 5',
      '5 cards; recommended target 5',
      '3 cards',
      '4 cards',
      '2 cards',
      '1 card',
      '11 cards',
    ])
  })

  it('offers an accessible explanation trigger for every role', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    for (const label of roleLabels) {
      expect(
        within(list).getByRole('button', {
          name: `What does ${label} mean?`,
        }),
      ).toBeVisible()
    }
    expect(within(list).getAllByRole('button')).toHaveLength(10)
    expect(
      within(list).queryByRole('button', { name: /soft target/i }),
    ).not.toBeInTheDocument()
  })

  it('explains blockers in one shared panel beside the active metric', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const trigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(
      trigger,
    )

    const tooltip = within(list).getByRole('tooltip')
    const roleRow = trigger.closest('.metric-list--roles > div')
    if (roleRow === null) throw new Error('Expected trigger role row.')
    expect(tooltip).toHaveTextContent(
      'cards with a Rainbow-Luffy-usable Blocker effect.',
    )
    expect(
      within(list).getByRole('button', {
        name: 'What does Blockers mean?',
      }),
    ).toHaveAttribute('aria-describedby', tooltip.id)
    expect(roleRow).toContainElement(tooltip)
  })

  it.each(approvedRoleHelp)(
    'shows the approved definition for $label',
    ({ label, description }) => {
      render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

      const list = screen.getByRole('group', { name: 'Role coverage' })
      fireEvent.click(
        within(list).getByRole('button', {
          name: `What does ${label} mean?`,
        }),
      )

      expect(within(list).getByRole('tooltip')).toHaveTextContent(description)
    },
  )

  it.each([
    {
      label: 'Blockers',
      expected:
        'cards with a Rainbow-Luffy-usable Blocker effect. Recommended target: 10. This is a goal used by the strategy engine, not a hard deck requirement. Cards can count toward multiple roles, and exceeding the target can still be useful.',
    },
    {
      label: 'Interaction',
      expected:
        'cards with usable draw or removal; a card that has both is counted once here. Recommended target: 5. This is a goal used by the strategy engine, not a hard deck requirement. Cards can count toward multiple roles, and exceeding the target can still be useful.',
    },
  ])(
    'includes the recommended target in $label role help',
    ({ label, expected }) => {
      render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

      const list = screen.getByRole('group', { name: 'Role coverage' })
      fireEvent.click(
        within(list).getByRole('button', {
          name: `What does ${label} mean?`,
        }),
      )

      expect(within(list).getByRole('tooltip')).toHaveTextContent(expected)
    },
  )

  it('does not add target guidance to roles without a recommended target', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    fireEvent.click(
      within(list).getByRole('button', {
        name: 'What does Draw mean?',
      }),
    )
    const tooltip = within(list).getByRole('tooltip')
    expect(tooltip).toHaveTextContent(approvedRoleHelp[5].description)
    expect(tooltip).not.toHaveTextContent('Recommended target')
  })

  it('starts every trigger closed with stable disclosure controls', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })

    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(blockerTrigger).toHaveAttribute('aria-controls', 'role-help-blocker')
    expect(blockerTrigger).not.toHaveAttribute('aria-describedby')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens and closes help from repeated activation of the same trigger', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const trigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(trigger)

    const tooltip = within(list).getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', tooltip.id)
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-controls', 'role-help-blocker')
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('switches active triggers atomically while keeping one panel', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    const bossTrigger = within(list).getByRole('button', {
      name: 'What does Bosses mean?',
    })
    fireEvent.click(blockerTrigger)
    const blockerTooltip = within(list).getByRole('tooltip')
    fireEvent.pointerDown(bossTrigger)

    expect(within(list).getByRole('tooltip')).toBe(blockerTooltip)
    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(bossTrigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(bossTrigger)

    const tooltips = within(list).getAllByRole('tooltip')
    expect(tooltips).toHaveLength(1)
    expect(tooltips[0]).toHaveTextContent(approvedRoleHelp[4].description)
    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(blockerTrigger).not.toHaveAttribute('aria-describedby')
    expect(bossTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(bossTrigger).toHaveAttribute('aria-controls', tooltips[0].id)
    expect(bossTrigger).toHaveAttribute('aria-describedby', tooltips[0].id)
  })

  it('does not open help from focus or hover alone', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.focus(blockerTrigger)
    fireEvent.pointerEnter(blockerTrigger)

    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps activated help open through blur and pointer exits', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(blockerTrigger)
    const tooltip = within(list).getByRole('tooltip')
    const roleRow = blockerTrigger.closest('.metric-list--roles > div')
    if (roleRow === null) throw new Error('Expected Blockers role row.')

    fireEvent.blur(blockerTrigger)
    fireEvent.pointerLeave(blockerTrigger, { relatedTarget: tooltip })
    expect(within(list).getByRole('tooltip')).toBe(tooltip)

    fireEvent.pointerLeave(roleRow)
    expect(within(list).getByRole('tooltip')).toBe(tooltip)
  })

  it('keeps active help open on pointerdown within its trigger or panel', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const trigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(trigger)
    const tooltip = within(list).getByRole('tooltip')

    fireEvent.pointerDown(trigger)
    expect(within(list).getByRole('tooltip')).toBe(tooltip)

    fireEvent.pointerDown(tooltip)
    expect(within(list).getByRole('tooltip')).toBe(tooltip)
  })

  it('closes active help on pointerdown outside the group', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(blockerTrigger)
    expect(within(list).getByRole('tooltip')).toBeVisible()

    fireEvent.pointerDown(document.body)

    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(blockerTrigger).toHaveAttribute(
      'aria-controls',
      'role-help-blocker',
    )
    expect(blockerTrigger).not.toHaveAttribute('aria-describedby')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes active help on Escape from the trigger or document body', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const blockerTrigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    fireEvent.click(blockerTrigger)
    fireEvent.keyDown(blockerTrigger, { key: 'Escape' })
    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(blockerTrigger).toHaveAttribute(
      'aria-controls',
      'role-help-blocker',
    )
    expect(blockerTrigger).not.toHaveAttribute('aria-describedby')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.click(blockerTrigger)
    expect(within(list).getByRole('tooltip')).toBeVisible()
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(blockerTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(blockerTrigger).toHaveAttribute(
      'aria-controls',
      'role-help-blocker',
    )
    expect(blockerTrigger).not.toHaveAttribute('aria-describedby')
    expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('attaches dismissal listeners only while active and cleans them up', () => {
    const addListener = vi.spyOn(document, 'addEventListener')
    const removeListener = vi.spyOn(document, 'removeEventListener')

    try {
      const { unmount } = render(
        <DeckRoleCoverage roleCoverage={roleCoverage} />,
      )
      const trigger = screen.getByRole('button', {
        name: 'What does Blockers mean?',
      })
      const added = (type: 'keydown' | 'pointerdown') =>
        addListener.mock.calls.filter(([eventType]) => eventType === type)
      const removed = (type: 'keydown' | 'pointerdown') =>
        removeListener.mock.calls.filter(([eventType]) => eventType === type)

      expect(added('keydown')).toHaveLength(0)
      expect(added('pointerdown')).toHaveLength(0)

      fireEvent.click(trigger)
      const firstKeydownListener = added('keydown')[0]?.[1]
      const firstPointerdownListener = added('pointerdown')[0]?.[1]
      if (firstKeydownListener === undefined) {
        throw new Error('Expected active keydown listener.')
      }
      if (firstPointerdownListener === undefined) {
        throw new Error('Expected active pointerdown listener.')
      }
      expect(added('keydown')).toHaveLength(1)
      expect(added('pointerdown')).toHaveLength(1)

      fireEvent.click(trigger)
      expect(removeListener).toHaveBeenCalledWith(
        'keydown',
        firstKeydownListener,
      )
      expect(removeListener).toHaveBeenCalledWith(
        'pointerdown',
        firstPointerdownListener,
      )

      fireEvent.click(trigger)
      const secondKeydownListener = added('keydown')[1]?.[1]
      const secondPointerdownListener = added('pointerdown')[1]?.[1]
      if (secondKeydownListener === undefined) {
        throw new Error('Expected reopened keydown listener.')
      }
      if (secondPointerdownListener === undefined) {
        throw new Error('Expected reopened pointerdown listener.')
      }
      unmount()

      expect(removeListener).toHaveBeenCalledWith(
        'keydown',
        secondKeydownListener,
      )
      expect(removeListener).toHaveBeenCalledWith(
        'pointerdown',
        secondPointerdownListener,
      )
      expect(removed('keydown')).toHaveLength(2)
      expect(removed('pointerdown')).toHaveLength(2)
    } finally {
      addListener.mockRestore()
      removeListener.mockRestore()
    }
  })

  it('dismisses outside pointerdown without preventing normal propagation', () => {
    render(<DeckRoleCoverage roleCoverage={roleCoverage} />)

    const list = screen.getByRole('group', { name: 'Role coverage' })
    const trigger = within(list).getByRole('button', {
      name: 'What does Blockers mean?',
    })
    const observedEvents: PointerEvent[] = []
    const observePointerDown = (event: PointerEvent) => {
      observedEvents.push(event)
    }
    window.addEventListener('pointerdown', observePointerDown)

    try {
      fireEvent.click(trigger)
      const propagated = fireEvent.pointerDown(document.body)

      expect(propagated).toBe(true)
      expect(observedEvents).toHaveLength(1)
      expect(observedEvents[0]?.defaultPrevented).toBe(false)
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(within(list).queryByRole('tooltip')).not.toBeInTheDocument()
    } finally {
      window.removeEventListener('pointerdown', observePointerDown)
    }
  })
})
