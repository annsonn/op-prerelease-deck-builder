import type { ReactNode } from 'react'

interface WorkflowStepProps {
  stepNumber: number
  headingId: string
  title: string
  description: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  children: ReactNode
}

export function WorkflowStep({
  stepNumber,
  headingId,
  title,
  description,
  isOpen,
  onOpenChange,
  className = '',
  children,
}: WorkflowStepProps) {
  return (
    <details
      className={`panel workflow-step ${className}`.trim()}
      aria-labelledby={headingId}
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (nextOpen !== isOpen) onOpenChange(nextOpen)
      }}
    >
      <summary className="workflow-step__summary">
        <span className="step-number" aria-hidden="true">
          {stepNumber}
        </span>
        <span className="workflow-step__summary-copy">
          <span
            id={headingId}
            className="workflow-step__heading"
            role="heading"
            aria-level={2}
          >
            {title}
          </span>
          <span className="workflow-step__description">{description}</span>
        </span>
        <span className="workflow-step__indicator" aria-hidden="true">
          {isOpen ? '−' : '+'}
        </span>
      </summary>
      <div className="workflow-step__content">{children}</div>
    </details>
  )
}
