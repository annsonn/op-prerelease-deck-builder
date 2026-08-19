import { describe, expect, it } from 'vitest'

import { getStrategyProfile } from '../strategy/strategy-profile.js'

import { measuredRoleKeys, type MeasuredRole } from './deck-state.js'
import { projectSolutionSummary } from './solution-summary.js'
import type { DeckAnalysis, RoleMeasurement } from './types.js'

const PROFILE = getStrategyProfile('OP16')

function analysis(
  counts: Partial<Record<MeasuredRole, number>> = {},
): DeckAnalysis {
  const targetedRoles = new Set([
    'twoKCounter',
    'blocker',
    'vanillaLike',
    'interaction',
    'boss',
  ])
  const roleCoverage = Object.fromEntries(
    measuredRoleKeys.map((role) => [
      role,
      {
        count: counts[role] ?? 0,
        target: targetedRoles.has(role)
          ? PROFILE.targets[role as keyof typeof PROFILE.targets]
          : null,
      },
    ]),
  ) as Record<MeasuredRole, RoleMeasurement>

  return {
    costColorDistribution: [
      { cost: null, total: 2, segments: [{ color: 'Red', count: 2 }] },
      { cost: 1, total: 8, segments: [{ color: 'Red', count: 8 }] },
      { cost: 3, total: 10, segments: [{ color: 'Blue', count: 10 }] },
      { cost: 5, total: 5, segments: [{ color: 'Green', count: 5 }] },
      { cost: 6, total: 5, segments: [{ color: 'Green', count: 5 }] },
      { cost: 7, total: 10, segments: [{ color: 'Black', count: 10 }] },
    ],
    totalCounter: 31_000,
    roleCoverage,
    oddCostImportantPlays: 0,
    evenCostImportantPlays: 0,
    strengths: [],
    weaknesses: [],
  }
}

describe('projectSolutionSummary', () => {
  it('projects curve, compatibility role counts, and exact target warnings once', () => {
    const result = projectSolutionSummary(
      analysis({
        twoKCounter: 9,
        blocker: 10,
        vanillaLike: 12,
        interaction: 4,
        boss: 5,
      }),
      PROFILE,
    )

    expect(result).toEqual({
      curve: { '0-2': 10, '3-4': 10, '5-6': 10, '7+': 10 },
      roleCoverage: {
        twoKCounter: 9,
        blocker: 10,
        interaction: 4,
        pressure: 12,
        boss: 5,
        curve: 30,
      },
      totalCounter: 31_000,
      warnings: [
        'Only 9 2K counters; aim for at least 10.',
        'Only 4 interaction cards; aim for at least 5.',
      ],
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.curve)).toBe(true)
    expect(Object.isFrozen(result.roleCoverage)).toBe(true)
    expect(Object.isFrozen(result.warnings)).toBe(true)
  })

  it('emits every soft-target deficit in canonical order', () => {
    expect(projectSolutionSummary(analysis(), PROFILE).warnings).toEqual([
      'Only 0 2K counters; aim for at least 10.',
      'Only 0 blockers; aim for at least 10.',
      'Only 0 vanilla-like bodies; aim for at least 10.',
      'Only 0 interaction cards; aim for at least 5.',
      'Only 0 bosses; aim for at least 5.',
    ])
  })
})
