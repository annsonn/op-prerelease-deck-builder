import { useMemo, useState } from 'react'

import type { PlayableCard } from '../../shared/catalog.js'
import type { CardFeatures } from '../../shared/card-features.js'
import type { DeckLine, DeckSolution } from '../solver/types.js'
import { CardColorRail } from './CardColorRail.js'
import { CardRevealButton } from './CardRevealButton.js'
import { CardStats } from './CardStats.js'
import { CostColorChart } from './CostColorChart.js'
import { DeckInsights } from './DeckInsights.js'
import { DeckPlayGuide } from './DeckPlayGuide.js'
import { DeckRoleCoverage } from './DeckRoleCoverage.js'
import {
  defaultDirectionFor,
  type MainDeckSortDirection,
  type MainDeckSortField,
  parseMainDeckSortField,
  sortMainDeck,
} from './main-deck-sort.js'

interface DeckResultProps {
  solution: DeckSolution
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>
  onReveal: (card: PlayableCard) => void
}

interface StoredMainDeckSort {
  solution: DeckSolution
  field: MainDeckSortField
  direction: MainDeckSortDirection
}

function defaultMainDeckSort(solution: DeckSolution): StoredMainDeckSort {
  const field = 'score'

  return {
    solution,
    field,
    direction: defaultDirectionFor(field),
  }
}

function oppositeDirection(
  direction: MainDeckSortDirection,
): MainDeckSortDirection {
  return direction === 'ascending' ? 'descending' : 'ascending'
}

function visibleDirection(direction: MainDeckSortDirection): string {
  return direction === 'ascending' ? 'Ascending ↑' : 'Descending ↓'
}

function quantity(lines: readonly DeckLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0)
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`
}

function featuresFor(
  cardNumber: string,
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>,
): CardFeatures {
  const features = featuresByCardNumber.get(cardNumber)
  if (features === undefined) {
    throw new Error(`Missing card features for ${cardNumber}.`)
  }
  return features
}

function DeckList({
  lines,
  featuresByCardNumber,
  showMainDeckMetadata = false,
  onReveal,
}: {
  lines: readonly DeckLine[]
  featuresByCardNumber: ReadonlyMap<string, CardFeatures>
  showMainDeckMetadata?: boolean
  onReveal: (card: PlayableCard) => void
}) {
  if (lines.length === 0) return <p className="empty-result">None</p>
  return (
    <ul className="deck-list">
      {lines.map((line) => {
        let isPrintedBlocker = false
        if (showMainDeckMetadata) {
          const features = featuresFor(
            line.card.cardNumber,
            featuresByCardNumber,
          )
          isPrintedBlocker = features.flags.blocker
        }

        return (
          <li
            className={showMainDeckMetadata ? 'deck-line deck-line--colored' : 'deck-line'}
            key={line.card.cardNumber}
          >
            <strong>{line.quantity}×</strong>
            <span className="deck-line__identity">
              {line.card.name}
              <small>{line.card.cardNumber}</small>
              {showMainDeckMetadata ? (
                <span className="deck-line__metadata">
                  <CardColorRail colors={line.card.colors} />
                  {isPrintedBlocker ? (
                    <span className="deck-line__blocker-label">Blocker</span>
                  ) : null}
                </span>
              ) : null}
              <CardStats
                cost={line.card.cost}
                power={line.card.power}
                counter={line.card.counter}
              />
            </span>
            <span className="score">Score {line.score}</span>
            <CardRevealButton card={line.card} onReveal={onReveal} />
          </li>
        )
      })}
    </ul>
  )
}

function SideboardSuggestions({
  suggestions,
}: {
  suggestions: NonNullable<DeckSolution['playGuide']>['sideboardSuggestions']
}) {
  return (
    <section
      className="sideboard-suggestions"
      aria-labelledby="sideboard-suggestions-heading"
    >
      <h4 id="sideboard-suggestions-heading">Sideboard suggestions</h4>
      {suggestions.length === 0 ? (
        <p className="sideboard-suggestions__empty">
          No Sideboard swaps are suggested.
        </p>
      ) : (
        <ul className="sideboard-suggestions__list">
          {suggestions.map((suggestion) => (
            <li key={suggestion.cardNumber}>
              <strong>
                {suggestion.quantity}× {suggestion.cardName}
              </strong>
              <small>{suggestion.cardNumber}</small>
              <p>{suggestion.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function DeckResult({
  solution,
  featuresByCardNumber,
  onReveal,
}: DeckResultProps) {
  const [storedMainDeckSort, setStoredMainDeckSort] =
    useState<StoredMainDeckSort>(() => defaultMainDeckSort(solution))
  const mainDeckSort =
    storedMainDeckSort.solution === solution
      ? storedMainDeckSort
      : defaultMainDeckSort(solution)
  if (storedMainDeckSort.solution !== solution) {
    setStoredMainDeckSort(mainDeckSort)
  }
  const nextDirection = oppositeDirection(mainDeckSort.direction)
  const orderedMainDeck = useMemo(
    () =>
      sortMainDeck(
        solution.mainDeck,
        mainDeckSort.field,
        mainDeckSort.direction,
      ),
    [solution.mainDeck, mainDeckSort.direction, mainDeckSort.field],
  )
  const mainSize = quantity(solution.mainDeck)
  const sideboardSize = quantity(solution.sideboard)

  return (
    <section className="result-panel" aria-labelledby="result-heading">
      <div className="result-hero">
        <p className="eyebrow">Your first pass</p>
        <h2 id="result-heading">{solution.label}</h2>
        <div className="result-counts">
          <span>Main deck {mainSize}</span>
          <span>Sideboard {sideboardSize}</span>
        </div>
      </div>

      <div className="summary-grid">
        <section className="summary-card" aria-labelledby="counter-heading">
          <h3 id="counter-heading">Total counter</h3>
          <strong className="hero-metric">
            {solution.totalCounter.toLocaleString('en-CA')}
          </strong>
        </section>

        <section className="summary-card" aria-labelledby="roles-heading">
          <h3 id="roles-heading">Role coverage</h3>
          <DeckRoleCoverage roleCoverage={solution.analysis.roleCoverage} />
        </section>
      </div>

      <CostColorChart distribution={solution.analysis.costColorDistribution} />
      <DeckInsights
        strengths={solution.analysis.strengths}
        weaknesses={solution.analysis.weaknesses}
      />
      {solution.playGuide === undefined ? null : (
        <DeckPlayGuide guide={solution.playGuide} />
      )}

      <div className="deck-sections">
        <section
          className="main-deck"
          aria-labelledby="main-deck-heading"
        >
          <div className="main-deck__header">
            <h3 id="main-deck-heading">Main deck</h3>
            <div
              className="main-deck-sort"
              role="group"
              aria-label="Main deck sorting"
            >
              <div className="main-deck-sort__field">
                <label htmlFor="main-deck-sort-field">Sort by</label>
                <select
                  id="main-deck-sort-field"
                  value={mainDeckSort.field}
                  onChange={(event) => {
                    const field = parseMainDeckSortField(event.target.value)
                    setStoredMainDeckSort({
                      solution,
                      field,
                      direction: defaultDirectionFor(field),
                    })
                  }}
                >
                  <option value="score">Score</option>
                  <option value="name">Name</option>
                  <option value="cost">Cost</option>
                  <option value="power">Power</option>
                </select>
              </div>
              <button
                type="button"
                className="main-deck-sort__direction"
                aria-label={`Change sort direction to ${nextDirection}`}
                onClick={() => {
                  setStoredMainDeckSort({
                    solution,
                    field: mainDeckSort.field,
                    direction: nextDirection,
                  })
                }}
              >
                {visibleDirection(mainDeckSort.direction)}
              </button>
            </div>
          </div>
          <DeckList
            lines={orderedMainDeck}
            featuresByCardNumber={featuresByCardNumber}
            showMainDeckMetadata
            onReveal={onReveal}
          />
        </section>
        <details className="sideboard-disclosure">
          <summary>Sideboard · {cardCountLabel(sideboardSize)}</summary>
          <section className="sideboard-content" aria-label="Sideboard">
            {solution.playGuide === undefined ? null : (
              <SideboardSuggestions
                suggestions={solution.playGuide.sideboardSuggestions}
              />
            )}
            <DeckList
              lines={solution.sideboard}
              featuresByCardNumber={featuresByCardNumber}
              onReveal={onReveal}
            />
          </section>
        </details>
      </div>
    </section>
  )
}
