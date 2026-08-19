import type { DeckInsight } from '../solver/types.js'

interface DeckInsightsProps {
  strengths: readonly DeckInsight[]
  weaknesses: readonly DeckInsight[]
}

interface InsightGroupProps {
  heading: string
  headingId: string
  insights: readonly DeckInsight[]
  emptyMessage: string
  tone: 'strength' | 'weakness'
}

function InsightGroup({
  heading,
  headingId,
  insights,
  emptyMessage,
  tone,
}: InsightGroupProps) {
  return (
    <section
      className={`deck-insight-group deck-insight-group--${tone}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>{heading}</h3>
      {insights.length === 0 ? (
        <p className="deck-insight-empty">{emptyMessage}</p>
      ) : (
        <ul className="deck-insight-list">
          {insights.map((insight) => (
            <li key={insight.id} className="deck-insight">
              <span className="deck-insight__icon" aria-hidden="true">
                {tone === 'strength' ? '+' : '−'}
              </span>
              <div className="deck-insight__copy">
                <h4>{insight.title}</h4>
                <p>{insight.evidence}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function DeckInsights({ strengths, weaknesses }: DeckInsightsProps) {
  return (
    <div className="deck-insights">
      <InsightGroup
        heading="Strengths"
        headingId="strengths-heading"
        insights={strengths}
        emptyMessage="No standout measured strengths."
        tone="strength"
      />
      <InsightGroup
        heading="Weaknesses"
        headingId="weaknesses-heading"
        insights={weaknesses}
        emptyMessage="No measured weaknesses crossed a threshold."
        tone="weakness"
      />
    </div>
  )
}
