import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { PlayableCard } from '../../shared/catalog.js'
import type { StrategyDeckSolution } from '../solver/types.js'
import { DeckResult } from './DeckResult.js'

const mainCard: PlayableCard = {
  cardNumber: 'OP16-005',
  name: 'Main Deck Card',
  rarity: 'C',
  cardType: 'CHARACTER',
  colors: ['Blue', 'Red'],
  cost: 5,
  life: null,
  power: 7000,
  counter: 1000,
  attribute: 'Strike',
  traits: ['Test Crew'],
  effect: '',
  trigger: '',
  setMembership: ['OP16'],
  variantsCollapsed: 1,
  entryShortcut: '005',
  isSpecialReprint: false,
}

const sideboardCard: PlayableCard = {
  cardNumber: 'OP16-006',
  name: 'Sideboard Card',
  rarity: 'UC',
  cardType: 'EVENT',
  colors: ['Blue'],
  cost: 1,
  life: null,
  power: null,
  counter: null,
  attribute: '',
  traits: ['Test Crew'],
  effect: 'Test effect.',
  trigger: '',
  setMembership: ['OP16'],
  variantsCollapsed: 1,
  entryShortcut: '006',
  isSpecialReprint: false,
}

const secondMainCard: PlayableCard = {
  ...mainCard,
  cardNumber: 'OP16-007',
  name: 'Second Main Card',
  colors: ['Green'],
  cost: 6,
  entryShortcut: '007',
}

const secondSideboardCard: PlayableCard = {
  ...sideboardCard,
  cardNumber: 'OP16-008',
  name: 'Second Sideboard Card',
  colors: ['Purple'],
  cost: 2,
  entryShortcut: '008',
}

const solution: StrategyDeckSolution = {
  label: 'Strategy sealed build',
  mainDeck: [
    {
      card: mainCard,
      quantity: 2,
      allocatedRoles: {
        twoKCounter: 0,
        blocker: 0,
        interaction: 0,
        pressure: 2,
        boss: 0,
        curve: 0,
      },
      score: 17,
      reasons: ['Test reason'],
    },
    {
      card: secondMainCard,
      quantity: 38,
      allocatedRoles: {
        twoKCounter: 0,
        blocker: 0,
        interaction: 0,
        pressure: 38,
        boss: 0,
        curve: 0,
      },
      score: 16,
      reasons: ['Second test reason'],
    },
  ],
  sideboard: [
    {
      card: sideboardCard,
      quantity: 1,
      allocatedRoles: {
        twoKCounter: 0,
        blocker: 0,
        interaction: 1,
        pressure: 0,
        boss: 0,
        curve: 0,
      },
      score: 11,
      reasons: ['Test reason'],
    },
    {
      card: secondSideboardCard,
      quantity: 1,
      allocatedRoles: {
        twoKCounter: 0,
        blocker: 0,
        interaction: 1,
        pressure: 0,
        boss: 0,
        curve: 0,
      },
      score: 10,
      reasons: ['Second test reason'],
    },
  ],
  mainDeckSize: 40,
  curve: { '0-2': 0, '3-4': 0, '5-6': 40, '7+': 0 },
  totalCounter: 40_000,
  roleCoverage: {
    twoKCounter: 0,
    blocker: 0,
    interaction: 0,
    pressure: 40,
    boss: 0,
    curve: 0,
  },
  warnings: [],
  analysis: {
    costColorDistribution: [
      {
        cost: 5,
        total: 2,
        segments: [
          { color: 'Red', count: 1 },
          { color: 'Blue', count: 1 },
        ],
      },
      {
        cost: 6,
        total: 38,
        segments: [{ color: 'Green', count: 38 }],
      },
    ],
    totalCounter: 40_000,
    roleCoverage: {
      twoKCounter: { count: 8, target: 10 },
      blocker: { count: 6, target: 10 },
      vanillaLike: { count: 12, target: 10 },
      draw: { count: 3, target: null },
      removal: { count: 4, target: null },
      interaction: { count: 6, target: 5 },
      boss: { count: 5, target: 5 },
      rush: { count: 2, target: null },
      banish: { count: 1, target: null },
      brick: { count: 9, target: null },
    },
    oddCostImportantPlays: 12,
    evenCostImportantPlays: 9,
    strengths: [
      {
        id: 'early-curve',
        title: 'Strong early curve',
        evidence: '18 cards cost 0-4; target at least 16.',
        priority: 700,
      },
    ],
    weaknesses: [
      {
        id: 'blockers',
        title: 'Low blocker count',
        evidence: '3 blockers; target at least 8.',
        priority: 500,
      },
    ],
  },
  playGuide: {
    leader: 'Rainbow Luffy',
    turnOrder: {
      title: 'Turn order',
      preference: 'first',
      points: ['Prefer going first when given the choice.'],
    },
    openingPriorities: {
      title: 'Opening priorities',
      points: ['Look for an early body.'],
    },
    corePlan: {
      title: 'Core plan',
      points: ['Develop, pressure, then close.'],
    },
    counterPlan: {
      title: 'Counter plan',
      points: ['Preserve flexible counter cards.'],
    },
    finishers: {
      title: 'Finishers',
      points: ['Close with the cards already named by the engine.'],
    },
    attackSequencing: {
      title: 'Attack sequencing',
      points: ['Use removal before attacks when useful.'],
    },
    sideboardSuggestions: [
      {
        cardNumber: 'OP16-006',
        cardName: 'Sideboard Card',
        quantity: 1,
        score: 11,
        addressesInsightIds: ['blockers'],
        reason: 'Adds a measured role that the deck is short on.',
      },
      {
        cardNumber: 'OP16-008',
        cardName: 'Second Sideboard Card',
        quantity: 1,
        score: 10,
        addressesInsightIds: ['interaction'],
        reason: 'Adds another measured role that the deck is short on.',
      },
    ],
  },
  solverVersion: 'strategy-v2',
  profileId: 'sealed-video-v1',
  profileVersion: 1,
}

describe('DeckResult', () => {
  it('wires analysis into the chart and insights while replacing old summaries', () => {
    render(<DeckResult solution={solution} />)

    expect(
      screen.getByRole('heading', { name: 'Cost and color curve' }),
    ).toBeVisible()
    expect(
      screen.getByRole('list', { name: 'Cost and color distribution data' }),
    ).toHaveTextContent('Cost 5: 2 cards; Red 1, Blue 1.')
    expect(screen.getByRole('region', { name: 'Strengths' })).toHaveTextContent(
      'Strong early curve',
    )
    expect(screen.getByRole('region', { name: 'Weaknesses' })).toHaveTextContent(
      'Low blocker count',
    )
    expect(screen.getByRole('heading', { name: 'Total counter' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Role coverage' })).toBeVisible()
    const roleCoverage = screen.getByRole('group', {
      name: 'Role coverage',
    })
    expect(
      within(roleCoverage).getByRole('definition', {
        name: '8 cards; recommended target 10',
      }),
    ).toHaveTextContent('8 / 10')
    expect(roleCoverage).not.toHaveTextContent('soft target')
    expect(
      screen.queryByRole('heading', { name: 'Cost curve' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Warnings' }),
    ).not.toBeInTheDocument()
  })

  it('places the play guide after insights and before the Main deck', () => {
    render(<DeckResult solution={solution} />)

    const insights = screen.getByRole('region', { name: 'Weaknesses' }).closest(
      '.deck-insights',
    )
    const guide = screen.getByRole('region', { name: 'How to play this deck' })
    const mainDeck = screen.getByRole('region', { name: 'Main deck' })

    if (insights === null) throw new Error('Expected deck insights container.')
    expect(
      insights.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      guide.compareDocumentPosition(mainDeck) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps Main deck full width with colors, printed stats, quantity, and score', () => {
    render(<DeckResult solution={solution} />)

    const mainDeck = screen.getByRole('region', { name: 'Main deck' })
    expect(mainDeck).toHaveClass('main-deck')
    const mainRows = within(mainDeck).getAllByRole('listitem')
    expect(mainRows).toHaveLength(2)
    expect(mainRows[0]).toHaveTextContent('Main Deck Card')
    expect(mainRows[1]).toHaveTextContent('Second Main Card')
    const mainStats = within(mainRows[0]).getByRole('group', {
      name: 'Card stats',
    })
    expect(within(mainRows[0]).getByText('OP16-005')).toBeVisible()
    expect(
      within(mainStats)
        .getAllByTestId('card-stat-value')
        .map((value) => value.textContent),
    ).toEqual(['Cost 5', 'Power 7,000', 'Counter 1,000'])
    expect(mainRows[0]).toHaveTextContent('2×')
    expect(mainRows[0]).toHaveTextContent('Score 17')
    expect(mainRows[1]).toHaveTextContent('38×')
    expect(mainRows[1]).toHaveTextContent('Score 16')
    const colors = within(mainRows[0]).getByRole('group', {
      name: 'Card colors',
    })
    expect(colors).toHaveTextContent('Red / Blue')
    expect(colors.querySelectorAll('.card-color-rail__segment')).toHaveLength(2)
    expect(mainDeck.querySelector('.deck-line--colored')).toBeInTheDocument()
  })

  it('keeps Sideboard hidden until its native disclosure is opened', async () => {
    const user = userEvent.setup()
    render(<DeckResult solution={solution} />)

    const summary = screen.getByText('Sideboard · 2 cards')
    const details = summary.closest('details')
    const sideboardCardName = screen.getByText('Sideboard Card')
    const suggestions = screen.getByRole('region', {
      name: 'Sideboard suggestions',
    })

    expect(details).not.toHaveAttribute('open')
    expect(sideboardCardName).not.toBeVisible()
    expect(suggestions).not.toBeVisible()

    await user.click(summary)

    expect(details).toHaveAttribute('open')
    expect(sideboardCardName).toBeVisible()
    expect(suggestions).toBeVisible()
    expect(
      within(suggestions)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '1× Sideboard CardOP16-006Adds a measured role that the deck is short on.',
      '1× Second Sideboard CardOP16-008Adds another measured role that the deck is short on.',
    ])

    const sideboard = screen.getByRole('region', { name: 'Sideboard' })
    const sideboardList = sideboard.querySelector<HTMLElement>('.deck-list')
    expect(sideboardList).not.toBeNull()
    const sideboardRows = within(sideboardList!).getAllByRole('listitem')
    expect(sideboardRows).toHaveLength(2)
    expect(sideboardRows[0]).toHaveTextContent('Sideboard Card')
    expect(sideboardRows[1]).toHaveTextContent('Second Sideboard Card')
    const sideboardStats = within(sideboardRows[0]).getByRole('group', {
      name: 'Card stats',
    })
    expect(sideboardStats.previousElementSibling).toHaveTextContent('OP16-006')
    expect(
      within(sideboardStats)
        .getAllByTestId('card-stat-value')
        .map((value) => value.textContent),
    ).toEqual(['Cost 1', 'Power —', 'Counter —'])
    expect(sideboardRows[0]).toHaveTextContent('1×')
    expect(sideboardRows[0]).toHaveTextContent('Score 11')
    expect(sideboardRows[1]).toHaveTextContent('1×')
    expect(sideboardRows[1]).toHaveTextContent('Score 10')
    expect(
      within(sideboard).queryByRole('group', { name: 'Card colors' }),
    ).not.toBeInTheDocument()

    summary.focus()
    expect(summary).toHaveFocus()
  })

  it('keeps an empty Sideboard closed and reveals None when opened', async () => {
    const user = userEvent.setup()
    render(<DeckResult solution={{ ...solution, sideboard: [] }} />)

    const summary = screen.getByText('Sideboard · 0 cards')
    const details = summary.closest('details')
    const emptyMessage = screen.getByText('None')

    expect(details).not.toHaveAttribute('open')
    expect(emptyMessage).not.toBeVisible()

    await user.click(summary)

    expect(details).toHaveAttribute('open')
    expect(emptyMessage).toBeVisible()
  })

  it('shows a neutral Sideboard suggestion state only inside the disclosure', async () => {
    const user = userEvent.setup()
    render(
      <DeckResult
        solution={{
          ...solution,
          playGuide: { ...solution.playGuide, sideboardSuggestions: [] },
        }}
      />,
    )

    const summary = screen.getByText('Sideboard · 2 cards')
    const neutral = screen.getByText('No Sideboard swaps are suggested.')
    expect(neutral).not.toBeVisible()

    await user.click(summary)

    expect(neutral).toBeVisible()
  })
})
