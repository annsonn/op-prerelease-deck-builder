import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CostColorBucket } from '../solver/types.js'
import { CostColorChart } from './CostColorChart.js'

const distribution: readonly CostColorBucket[] = [
  {
    cost: 2,
    total: 3,
    segments: [
      { color: 'Blue', count: 1 },
      { color: 'Red', count: 2 },
    ],
  },
  {
    cost: 6,
    total: 4,
    segments: [
      { color: 'Red', count: 2 },
      { color: 'Blue', count: 2 },
    ],
  },
  {
    cost: null,
    total: 1,
    segments: [{ color: 'Unknown', count: 1 }],
  },
]

describe('CostColorChart', () => {
  it('renders exact cost buckets as stacked bars with totals and y-axis ticks', () => {
    render(<CostColorChart distribution={distribution} />)

    expect(
      screen.getByRole('heading', { name: 'Cost and color curve' }),
    ).toBeVisible()

    const plot = screen.getByRole('img', {
      name: 'Cost and color distribution chart',
    })
    expect(within(plot).getByTestId('cost-color-y-axis')).toHaveTextContent(
      '420',
    )

    const bars = within(plot).getAllByTestId('cost-color-bar')
    expect(bars).toHaveLength(3)
    expect(
      bars.map((bar) => within(bar).getByTestId('cost-label').textContent),
    ).toEqual(['2', '6', '—'])
    expect(
      bars.map((bar) => within(bar).getByTestId('bar-total').textContent),
    ).toEqual(['3', '4', '1'])

    const firstSegments = within(bars[0]).getAllByTestId('color-segment')
    expect(firstSegments.map((segment) => segment.dataset.color)).toEqual([
      'Red',
      'Blue',
    ])
    expect(firstSegments[0]).toHaveClass('cost-color-chart__segment--red')
    expect(firstSegments[1]).toHaveClass('cost-color-chart__segment--blue')
  })

  it('shows a canonical legend for colors present anywhere in the data', () => {
    render(<CostColorChart distribution={distribution} />)

    const legend = screen.getByRole('list', { name: 'Card colors' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Red', 'Blue', 'Unknown'])
  })

  it('provides a textual summary for every bucket, including fractional colors', () => {
    const fractionalDistribution: readonly CostColorBucket[] = [
      {
        cost: 6,
        total: 4,
        segments: [
          { color: 'Red', count: 2 },
          { color: 'Blue', count: 2 },
        ],
      },
      {
        cost: null,
        total: 1,
        segments: [
          { color: 'Green', count: 0.5 },
          { color: 'Purple', count: 0.5 },
        ],
      },
    ]

    render(<CostColorChart distribution={fractionalDistribution} />)

    const summary = screen.getByRole('list', {
      name: 'Cost and color distribution data',
    })
    expect(within(summary).getAllByRole('listitem')).toHaveLength(2)
    expect(summary).toHaveTextContent('Cost 6: 4 cards; Red 2, Blue 2.')
    expect(summary).toHaveTextContent(
      'Cost —: 1 card; Green 0.5, Purple 0.5.',
    )
  })

  it('handles an empty distribution without inventing bars or legend entries', () => {
    render(<CostColorChart distribution={[]} />)

    expect(screen.getByText('No cost data available.')).toBeVisible()
    expect(screen.queryAllByTestId('cost-color-bar')).toHaveLength(0)
    expect(screen.queryByRole('list', { name: 'Card colors' })).toBeNull()
    expect(
      screen.getByRole('list', { name: 'Cost and color distribution data' }),
    ).toBeEmptyDOMElement()
  })
})
