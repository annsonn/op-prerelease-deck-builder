import type { ReactNode } from 'react'

interface InfoTooltipProps {
  readonly label: string
  readonly tooltipId: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly variant?: 'icon' | 'text'
  readonly children?: ReactNode
}

export function InfoTooltip({
  label,
  tooltipId,
  open,
  onToggle,
  variant = 'icon',
  children,
}: InfoTooltipProps) {
  return (
    <button
      type="button"
      className={`info-tooltip-trigger info-tooltip-trigger--${variant}`}
      aria-label={label}
      aria-expanded={open}
      aria-controls={tooltipId}
      aria-describedby={open ? tooltipId : undefined}
      onClick={onToggle}
    >
      {variant === 'text' ? children : null}
    </button>
  )
}
