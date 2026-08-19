import { useId } from 'react'

import type { GuideSection, PlayGuide } from '../solver/types.js'

interface DeckPlayGuideProps {
  guide: PlayGuide
}

interface GuideSectionViewProps {
  section: GuideSection
}

function GuideSectionView({ section }: GuideSectionViewProps) {
  const headingId = useId()
  return (
    <section className="deck-play-guide__section" aria-labelledby={headingId}>
      <h4 id={headingId}>{section.title}</h4>
      <ul className="deck-play-guide__points">
        {section.points.map((point, index) => (
          <li key={`${section.title}-${index}`}>{point}</li>
        ))}
      </ul>
    </section>
  )
}

export function DeckPlayGuide({ guide }: DeckPlayGuideProps) {
  const headingId = useId()
  const sections: readonly GuideSection[] = [
    guide.turnOrder,
    guide.openingPriorities,
    guide.corePlan,
    guide.counterPlan,
    guide.finishers,
    guide.attackSequencing,
  ]

  return (
    <section className="deck-play-guide" aria-labelledby={headingId}>
      <h3 id={headingId}>How to play this deck</h3>
      <div className="deck-play-guide__sections">
        {sections.map((section) => (
          <GuideSectionView key={section.title} section={section} />
        ))}
      </div>
    </section>
  )
}
