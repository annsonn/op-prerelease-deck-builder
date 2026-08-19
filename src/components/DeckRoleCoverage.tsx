import { useEffect, useRef, useState } from 'react'

import type { MeasuredRole } from '../solver/deck-state.js'
import type { DeckAnalysis } from '../solver/types.js'
import { InfoTooltip } from './InfoTooltip.js'

/* oxlint-disable react/only-export-components -- The canonical display order is part of this component's public contract. */

interface DeckRoleCoverageProps {
  roleCoverage: DeckAnalysis['roleCoverage']
}

interface RoleDisplay {
  readonly role: MeasuredRole
  readonly label: string
  readonly description: string
}

export const deckRoleCoverageOrder: readonly RoleDisplay[] = Object.freeze([
  Object.freeze({
    role: 'twoKCounter',
    label: '2K counters',
    description: 'cards with at least 2,000 printed Counter.',
  }),
  Object.freeze({
    role: 'blocker',
    label: 'Blockers',
    description: 'cards with a Rainbow-Luffy-usable Blocker effect.',
  }),
  Object.freeze({
    role: 'vanillaLike',
    label: 'Vanilla-like bodies',
    description:
      'efficient 1–6 cost Characters with strong power for their cost and no detected combo dependency.',
  }),
  Object.freeze({
    role: 'interaction',
    label: 'Interaction',
    description:
      'cards with usable draw or removal; a card that has both is counted once here.',
  }),
  Object.freeze({
    role: 'boss',
    label: 'Bosses',
    description:
      '7+ cost Characters with at least 8,000 power or a significant closing effect.',
  }),
  Object.freeze({
    role: 'draw',
    label: 'Draw',
    description: 'cards with usable card-draw effects.',
  }),
  Object.freeze({
    role: 'removal',
    label: 'Removal',
    description:
      'cards that disrupt opposing cards through K.O., bounce, bottom-deck, rest, or power reduction.',
  }),
  Object.freeze({
    role: 'rush',
    label: 'Rush',
    description: 'cards with a usable Rush effect.',
  }),
  Object.freeze({
    role: 'banish',
    label: 'Banish',
    description: 'cards with a usable Banish effect.',
  }),
  Object.freeze({
    role: 'brick',
    label: 'Bricks',
    description: 'Character cards with zero or no printed Counter.',
  }),
])

const targetGuidance =
  'This is a goal used by the strategy engine, not a hard deck requirement. Cards can count toward multiple roles, and exceeding the target can still be useful.'

function buildHelpDescription(
  description: string,
  target: number | null,
): string {
  if (target === null) return description
  return `${description} Recommended target: ${target}. ${targetGuidance}`
}

function buildMeasurementLabel(
  count: number,
  target: number | null,
): string {
  const cards = `${count} ${count === 1 ? 'card' : 'cards'}`
  return target === null
    ? cards
    : `${cards}; recommended target ${target}`
}

interface ActiveHelp {
  readonly id: string
  readonly description: string
}

export function DeckRoleCoverage({
  roleCoverage,
}: DeckRoleCoverageProps) {
  const groupRef = useRef<HTMLDivElement>(null)
  const [activeHelp, setActiveHelp] = useState<ActiveHelp | null>(null)

  const toggleHelp = (id: string, description: string) => {
    setActiveHelp((current) =>
      current?.id === id ? null : { id, description },
    )
  }

  useEffect(() => {
    if (activeHelp === null) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setActiveHelp(null)
    }
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return

      const helpTriggers = groupRef.current?.querySelectorAll(
        '.info-tooltip-trigger',
      )
      const isHelpTrigger = Array.from(helpTriggers ?? []).some((trigger) =>
        trigger.contains(target),
      )
      const activePanel = document.getElementById(activeHelp.id)
      if (
        isHelpTrigger ||
        activePanel?.contains(target) === true
      ) {
        return
      }
      setActiveHelp(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointerDown)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown)
    }
  }, [activeHelp])

  return (
    <div ref={groupRef} role="group" aria-label="Role coverage">
      <dl className="metric-list metric-list--roles">
        {deckRoleCoverageOrder.map(({ role, label, description }) => {
          const measurement = roleCoverage[role]
          const roleHelpId = `role-help-${role}`
          const helpDescription = buildHelpDescription(
            description,
            measurement.target,
          )
          return (
            <div key={role} className="role-metric">
              <dt className="role-metric__header">
                <span>{label}</span>
                <InfoTooltip
                  label={`What does ${label} mean?`}
                  tooltipId={roleHelpId}
                  open={activeHelp?.id === roleHelpId}
                  onToggle={() => toggleHelp(roleHelpId, helpDescription)}
                />
              </dt>
              <dd
                className="role-metric__value"
                aria-label={buildMeasurementLabel(
                  measurement.count,
                  measurement.target,
                )}
              >
                <span>{measurement.count}</span>
                {measurement.target === null ? null : (
                  <span className="role-metric__target">
                    {' / '}
                    {measurement.target}
                  </span>
                )}
              </dd>
              {activeHelp?.id === roleHelpId ? (
                <dd
                  id={activeHelp.id}
                  className="role-help-panel"
                  role="tooltip"
                >
                  {activeHelp.description}
                </dd>
              ) : null}
            </div>
          )
        })}
      </dl>
    </div>
  )
}
