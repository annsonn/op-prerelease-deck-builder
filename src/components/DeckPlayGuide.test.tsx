import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PlayGuide } from '../solver/types.js'
import { DeckPlayGuide } from './DeckPlayGuide.js'

const guide: PlayGuide = {
  leader: 'Rainbow Luffy',
  turnOrder: {
    title: 'Turn order',
    preference: 'first',
    points: ['Prefer going first when given the choice.'],
  },
  openingPriorities: {
    title: 'Opening priorities',
    points: ['Look for an early body and a flexible 2K counter.'],
  },
  corePlan: {
    title: 'Core plan',
    points: ['Develop early, pressure in the mid-game, then close.'],
  },
  counterPlan: {
    title: 'Counter plan',
    points: ['Preserve counter cards for attacks that matter.'],
  },
  finishers: {
    title: 'Finishers',
    points: ['Use OP16-099 Final Captain when the board is ready.'],
  },
  attackSequencing: {
    title: 'Attack sequencing',
    points: ['Use removal before attacks when it improves the attack order.'],
  },
  sideboardSuggestions: [],
}

describe('DeckPlayGuide', () => {
  it('renders the supplied guide sections in gameplay order', () => {
    render(<DeckPlayGuide guide={guide} />)

    const region = screen.getByRole('region', { name: 'How to play this deck' })
    expect(within(region).getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'How to play this deck',
      'Turn order',
      'Opening priorities',
      'Core plan',
      'Counter plan',
      'Finishers',
      'Attack sequencing',
    ])
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Prefer going first when given the choice.',
      'Look for an early body and a flexible 2K counter.',
      'Develop early, pressure in the mid-game, then close.',
      'Preserve counter cards for attacks that matter.',
      'Use OP16-099 Final Captain when the board is ready.',
      'Use removal before attacks when it improves the attack order.',
    ])
  })

  it('renders neutral guidance exactly as supplied', () => {
    render(
      <DeckPlayGuide
        guide={{
          ...guide,
          turnOrder: {
            title: 'Turn order',
            preference: 'flexible',
            points: ['This build appears flexible.'],
          },
          finishers: {
            title: 'Finishers',
            points: ['No specific finisher stands out; preserve board pressure.'],
          },
        }}
      />,
    )

    expect(screen.getByText('This build appears flexible.')).toBeVisible()
    expect(
      screen.getByText('No specific finisher stands out; preserve board pressure.'),
    ).toBeVisible()
  })
})
