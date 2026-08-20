import type { PlayableCard } from '../../shared/catalog.js'
import type { DeckLine, DeckSolution } from '../solver/types.js'
import { CardColorRail } from './CardColorRail.js'
import { CardRevealButton } from './CardRevealButton.js'
import { CardStats } from './CardStats.js'
import { CostColorChart } from './CostColorChart.js'
import { DeckInsights } from './DeckInsights.js'
import { DeckPlayGuide } from './DeckPlayGuide.js'
import { DeckRoleCoverage } from './DeckRoleCoverage.js'

interface DeckResultProps {
  solution: DeckSolution
  onReveal: (card: PlayableCard) => void
}

function quantity(lines: readonly DeckLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0)
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`
}

function DeckList({
  lines,
  showColors = false,
  onReveal,
}: {
  lines: readonly DeckLine[]
  showColors?: boolean
  onReveal: (card: PlayableCard) => void
}) {
  if (lines.length === 0) return <p className="empty-result">None</p>
  return (
    <ul className="deck-list">
      {lines.map((line) => (
        <li
          className={showColors ? 'deck-line deck-line--colored' : 'deck-line'}
          key={line.card.cardNumber}
        >
          <strong>{line.quantity}×</strong>
          <span className="deck-line__identity">
            {line.card.name}
            <small>{line.card.cardNumber}</small>
            {showColors ? <CardColorRail colors={line.card.colors} /> : null}
            <CardStats
              cost={line.card.cost}
              power={line.card.power}
              counter={line.card.counter}
            />
          </span>
          <span className="score">Score {line.score}</span>
          <CardRevealButton card={line.card} onReveal={onReveal} />
        </li>
      ))}
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

export function DeckResult({ solution, onReveal }: DeckResultProps) {
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
          <h3 id="main-deck-heading">Main deck</h3>
          <DeckList
            lines={solution.mainDeck}
            showColors
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
            <DeckList lines={solution.sideboard} onReveal={onReveal} />
          </section>
        </details>
      </div>
    </section>
  )
}
