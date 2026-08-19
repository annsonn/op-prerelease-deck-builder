import { normalizeDisplayCardColors } from '../card-colors.js'

interface CardColorRailProps {
  colors: readonly string[]
}

export function CardColorRail({ colors }: CardColorRailProps) {
  const displayColors = normalizeDisplayCardColors(colors)

  return (
    <span className="card-colors" role="group" aria-label="Card colors">
      <span className="card-color-rail" aria-hidden="true">
        {displayColors.map((color) => (
          <span
            key={color}
            className={`card-color-rail__segment card-color-rail__segment--${color.toLowerCase()}`}
            style={{ flexGrow: 1 }}
          />
        ))}
      </span>
      <span className="card-color-names">{displayColors.join(' / ')}</span>
    </span>
  )
}
