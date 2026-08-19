import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DeckInsights } from './DeckInsights.js'

describe('DeckInsights', () => {
  it('renders ranked strengths and weaknesses in the supplied order', () => {
    render(
      <DeckInsights
        strengths={[
          {
            id: 'early-curve',
            title: 'Early curve',
            evidence: '18 early-cost cards; target at least 16.',
            priority: 700,
          },
          {
            id: 'interaction',
            title: 'Interaction',
            evidence: '5 interaction cards; target at least 4.',
            priority: 400,
          },
        ]}
        weaknesses={[
          {
            id: 'blockers',
            title: 'Blockers',
            evidence: '3 blockers; target at least 8.',
            priority: 500,
          },
        ]}
      />,
    )

    const strengths = screen.getByRole('region', { name: 'Strengths' })
    expect(
      within(strengths).getAllByRole('heading', { level: 4 }).map((heading) =>
        heading.textContent,
      ),
    ).toEqual(['Early curve', 'Interaction'])
    expect(strengths).toHaveTextContent(
      '18 early-cost cards; target at least 16.',
    )

    const weaknesses = screen.getByRole('region', { name: 'Weaknesses' })
    expect(within(weaknesses).getByRole('heading', { level: 4 })).toHaveTextContent(
      'Blockers',
    )
    expect(weaknesses).toHaveTextContent('3 blockers; target at least 8.')
  })

  it('shows neutral copy when no threshold produces an insight', () => {
    render(<DeckInsights strengths={[]} weaknesses={[]} />)

    expect(screen.getByText('No standout measured strengths.')).toBeVisible()
    expect(
      screen.getByText('No measured weaknesses crossed a threshold.'),
    ).toBeVisible()
  })
})
