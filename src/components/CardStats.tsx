import type { PlayableCard } from '../../shared/catalog.js'

type CardStatsProps = Pick<PlayableCard, 'cost' | 'power' | 'counter'>

function formatPrintedStat(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-CA')
}

export function CardStats({ cost, power, counter }: CardStatsProps) {
  const stats = [
    ['Cost', cost],
    ['Power', power],
    ['Counter', counter],
  ] as const

  return (
    <span className="card-stats" role="group" aria-label="Card stats">
      {stats.map(([label, value], index) => (
        <span key={label} className="card-stat-part">
          {index > 0 ? (
            <span className="card-stat-separator" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span data-testid="card-stat-value">
            {label} {formatPrintedStat(value)}
          </span>
        </span>
      ))}
    </span>
  )
}
