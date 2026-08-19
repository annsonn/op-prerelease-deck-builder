import { useId } from 'react'

import {
  displayCardColorOrder,
  type DisplayCardColor,
} from '../card-colors.js'
import type {
  CostColorBucket,
  CostColorSegment,
} from '../solver/types.js'

interface CostColorChartProps {
  distribution: readonly CostColorBucket[]
}

const countFormatter = new Intl.NumberFormat('en-CA', {
  maximumFractionDigits: 3,
})

function formatCount(count: number): string {
  return countFormatter.format(count)
}

function formatCost(cost: number | null): string {
  return cost === null ? '—' : String(cost)
}

function colorClassName(color: DisplayCardColor): string {
  return color.toLowerCase()
}

function orderedSegments(
  segments: readonly CostColorSegment[],
): readonly CostColorSegment[] {
  const counts = new Map<DisplayCardColor, number>()
  for (const segment of segments) {
    counts.set(segment.color, (counts.get(segment.color) ?? 0) + segment.count)
  }

  return displayCardColorOrder.flatMap((color) => {
    const count = counts.get(color)
    return count === undefined || count <= 0 ? [] : [{ color, count }]
  })
}

function bucketSummary(bucket: CostColorBucket): string {
  const cardNoun = bucket.total === 1 ? 'card' : 'cards'
  const colors = orderedSegments(bucket.segments)
    .map(({ color, count }) => `${color} ${formatCount(count)}`)
    .join(', ')
  return `Cost ${formatCost(bucket.cost)}: ${formatCount(bucket.total)} ${cardNoun}; ${colors}.`
}

export function CostColorChart({ distribution }: CostColorChartProps) {
  const headingId = useId()
  const maximum = Math.max(0, ...distribution.map((bucket) => bucket.total))
  const midpoint = maximum / 2
  const presentColors = new Set(
    distribution.flatMap((bucket) =>
      bucket.segments
        .filter((segment) => segment.count > 0)
        .map((segment) => segment.color),
    ),
  )
  const legendColors = displayCardColorOrder.filter((color) =>
    presentColors.has(color),
  )

  return (
    <section className="cost-color-chart" aria-labelledby={headingId}>
      <h3 id={headingId}>Cost and color curve</h3>

      <div
        className="cost-color-chart__plot"
        role="img"
        aria-label="Cost and color distribution chart"
      >
        <div
          className="cost-color-chart__y-axis"
          data-testid="cost-color-y-axis"
          aria-hidden="true"
        >
          <span>{formatCount(maximum)}</span>
          <span>{formatCount(midpoint)}</span>
          <span>0</span>
        </div>

        <div className="cost-color-chart__bars" aria-hidden="true">
          {distribution.map((bucket) => (
            <div
              className="cost-color-chart__bar-column"
              data-testid="cost-color-bar"
              key={bucket.cost === null ? 'unknown' : bucket.cost}
            >
              <span
                className="cost-color-chart__bar-total"
                data-testid="bar-total"
              >
                {formatCount(bucket.total)}
              </span>
              <div
                className="cost-color-chart__bar"
                style={{
                  height: `${maximum === 0 ? 0 : (bucket.total / maximum) * 100}%`,
                }}
              >
                {orderedSegments(bucket.segments).map((segment) => (
                  <span
                    className={`cost-color-chart__segment cost-color-chart__segment--${colorClassName(segment.color)}`}
                    data-testid="color-segment"
                    data-color={segment.color}
                    key={segment.color}
                    style={{ flexGrow: segment.count }}
                  />
                ))}
              </div>
              <span
                className="cost-color-chart__x-label"
                data-testid="cost-label"
              >
                {formatCost(bucket.cost)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {distribution.length === 0 ? (
        <p className="cost-color-chart__empty">No cost data available.</p>
      ) : null}

      {legendColors.length > 0 ? (
        <ul className="cost-color-chart__legend" aria-label="Card colors">
          {legendColors.map((color) => (
            <li key={color}>
              <span
                className={`cost-color-chart__swatch cost-color-chart__swatch--${colorClassName(color)}`}
                aria-hidden="true"
              />
              {color}
            </li>
          ))}
        </ul>
      ) : null}

      <ul
        className="sr-only"
        aria-label="Cost and color distribution data"
      >
        {distribution.map((bucket) => (
          <li key={bucket.cost === null ? 'unknown' : bucket.cost}>
            {bucketSummary(bucket)}
          </li>
        ))}
      </ul>
    </section>
  )
}
