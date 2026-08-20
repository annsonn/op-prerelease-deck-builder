import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  RuntimeCatalogIndex,
  RuntimeCatalogIndexEntry,
} from '../shared/catalog-index.js'
import type { PlayableCard } from '../shared/catalog.js'
import './App.css'
import {
  browserSha256,
  loadCatalogIndex,
  loadRuntimeCatalog,
  type RuntimeCatalog,
} from './catalog/load-catalog.js'
import { CardEntry } from './components/CardEntry.js'
import { CardImageDialog } from './components/CardImageDialog.js'
import { CatalogPicker } from './components/CatalogPicker.js'
import { DeckResult } from './components/DeckResult.js'
import { PoolReview } from './components/PoolReview.js'
import { TestPoolButton } from './components/TestPoolButton.js'
import { WorkflowStep } from './components/WorkflowStep.js'
import {
  appendCard,
  eligiblePoolCount,
  replaceCards,
  setQuantity,
  undoLast,
  type PoolState,
} from './pool/pool.js'
import { StrategyDeckSolver } from './solver/strategy-solver.js'
import type { DeckSolution, DeckSolver } from './solver/types.js'
import {
  generateTestPool,
  type TestPoolGeneration,
  type TestPoolMode,
} from './test-pool/generate-test-pool.js'

export interface CatalogApi {
  loadIndex: () => Promise<RuntimeCatalogIndex>
  loadCatalog: (entry: RuntimeCatalogIndexEntry) => Promise<RuntimeCatalog>
}

export interface TestPoolApi {
  generate: (
    catalog: RuntimeCatalog,
    mode: TestPoolMode,
  ) => TestPoolGeneration
}

interface AppProps {
  catalogApi?: CatalogApi
  testPoolApi?: TestPoolApi
  deckSolver?: DeckSolver
}

const defaultCatalogApi: CatalogApi = {
  loadIndex: () => loadCatalogIndex(fetch, import.meta.env.BASE_URL),
  loadCatalog: (entry) =>
    loadRuntimeCatalog(
      entry,
      fetch,
      browserSha256,
      import.meta.env.BASE_URL,
    ),
}

const defaultTestPoolApi: TestPoolApi = {
  generate: (catalog, mode) => generateTestPool(catalog, undefined, mode),
}

const defaultDeckSolver: DeckSolver = new StrategyDeckSolver()

function emptyPool(): PoolState {
  return {
    events: [],
    counts: {},
    recentCardNumbers: [],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatRarityConfirmation(
  total: number,
  counts: TestPoolGeneration['rarityCounts'],
): string {
  return `Generated ${total} test cards: ${counts.C} C, ${counts.UC} UC, ${counts.L} L, ${counts.R} R, ${counts.SR} SR, ${counts.SEC} SEC.`
}

function App({
  catalogApi = defaultCatalogApi,
  testPoolApi = defaultTestPoolApi,
  deckSolver = defaultDeckSolver,
}: AppProps) {
  const [index, setIndex] = useState<RuntimeCatalogIndex | null>(null)
  const [selectedSetId, setSelectedSetId] = useState('')
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null)
  const [pool, setPool] = useState<PoolState>(emptyPool)
  const [isSetStepOpen, setIsSetStepOpen] = useState(true)
  const [isEntryStepOpen, setIsEntryStepOpen] = useState(true)
  const [isPoolReviewOpen, setIsPoolReviewOpen] = useState(true)
  const [solution, setSolution] = useState<DeckSolution | null>(null)
  const [loadingIndex, setLoadingIndex] = useState(true)
  const [loadingSetId, setLoadingSetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [revealedCard, setRevealedCard] = useState<PlayableCard | null>(null)
  const catalogRequest = useRef(0)
  const indexCatalogApi = useRef<CatalogApi | null>(null)

  useEffect(() => {
    let active = true
    catalogRequest.current += 1
    setLoadingIndex(true)
    setIndex(null)
    setSelectedSetId('')
    setCatalog(null)
    setPool(emptyPool())
    setIsSetStepOpen(true)
    setIsEntryStepOpen(true)
    setIsPoolReviewOpen(true)
    setSolution(null)
    setLoadingSetId(null)
    setError(null)
    setConfirmation('')
    setRevealedCard(null)

    void catalogApi.loadIndex().then(
      (loadedIndex) => {
        if (!active) return
        indexCatalogApi.current = catalogApi
        setIndex(loadedIndex)
        setLoadingIndex(false)
      },
      (cause: unknown) => {
        if (!active) return
        setError(`Could not load card sets: ${errorMessage(cause)}`)
        setLoadingIndex(false)
      },
    )

    return () => {
      active = false
    }
  }, [catalogApi])

  useEffect(() => {
    if (index === null || selectedSetId === '') return
    if (indexCatalogApi.current !== catalogApi) return
    const entry = index.sets.find(({ setId }) => setId === selectedSetId)
    if (entry === undefined) {
      setError(`The selected set ${selectedSetId} is not in the catalog index.`)
      return
    }

    const request = ++catalogRequest.current
    setLoadingSetId(entry.setId)
    setError(null)
    setConfirmation('')

    void catalogApi.loadCatalog(entry).then(
      (loadedCatalog) => {
        if (catalogRequest.current !== request) return
        setCatalog(loadedCatalog)
        setLoadingSetId(null)
        setConfirmation(`${entry.setId} is ready for pool entry.`)
      },
      (cause: unknown) => {
        if (catalogRequest.current !== request) return
        setError(
          `Could not load ${entry.label}: ${errorMessage(cause)} Run npm run catalog:sync if the local catalog is unavailable.`,
        )
        setLoadingSetId(null)
      },
    )
  }, [catalogApi, index, selectedSetId])

  const selectedEntry = useMemo(
    () => index?.sets.find(({ setId }) => setId === selectedSetId) ?? null,
    [index, selectedSetId],
  )
  const eligibleCount = catalog === null ? 0 : eligiblePoolCount(pool, catalog)
  const missingCount = Math.max(0, 40 - eligibleCount)

  const handleSelect = useCallback((setId: string) => {
    catalogRequest.current += 1
    setSelectedSetId(setId)
    setCatalog(null)
    setPool(emptyPool())
    setIsEntryStepOpen(true)
    setIsPoolReviewOpen(true)
    setSolution(null)
    setError(null)
    setConfirmation('')
    setRevealedCard(null)
  }, [])

  const handleCard = useCallback((card: PlayableCard) => {
    setRevealedCard(null)
    setPool((current) => {
      const next = appendCard(current, card.cardNumber)
      setConfirmation(
        `Added ${card.name}. Copy ${next.counts[card.cardNumber] ?? 1}.`,
      )
      return next
    })
    setIsPoolReviewOpen(true)
    setSolution(null)
    setError(null)
  }, [])

  const handleEntryError = useCallback((message: string) => {
    setError(message)
    setConfirmation('')
  }, [])

  const handleGenerateTestPool = useCallback((mode: TestPoolMode) => {
    if (catalog === null) return
    try {
      const generated = testPoolApi.generate(catalog, mode)
      const nextPool = replaceCards(pool, generated.cardNumbers)
      setRevealedCard(null)
      setPool(nextPool)
      setIsPoolReviewOpen(true)
      setSolution(null)
      setError(null)
      setConfirmation(
        formatRarityConfirmation(
          generated.cardNumbers.length,
          generated.rarityCounts,
        ),
      )
    } catch (cause) {
      setError(errorMessage(cause))
      setConfirmation('')
    }
  }, [catalog, pool, testPoolApi])

  const handleUndo = useCallback(() => {
    setRevealedCard(null)
    setPool((current) => undoLast(current))
    setIsPoolReviewOpen(true)
    setSolution(null)
    setError(null)
    setConfirmation('Undid last change.')
  }, [])

  const handleQuantity = useCallback(
    (cardNumber: string, quantity: number) => {
      setRevealedCard(null)
      setPool((current) => setQuantity(current, cardNumber, quantity))
      setIsPoolReviewOpen(true)
      setSolution(null)
      setError(null)
      setConfirmation(
        quantity === 0
          ? `Removed ${cardNumber} from the pool.`
          : `Set ${cardNumber} to ${quantity} copies.`,
      )
    },
    [],
  )

  const handleBuild = useCallback(() => {
    if (catalog === null) return
    try {
      const nextSolution = deckSolver.solve(catalog, pool.counts)
      setRevealedCard(null)
      setSolution(nextSolution)
      setIsSetStepOpen(false)
      setIsEntryStepOpen(false)
      setIsPoolReviewOpen(false)
      setError(null)
      setConfirmation('Built a 40-card main deck.')
    } catch (cause) {
      setError(errorMessage(cause))
      setConfirmation('')
    }
  }, [catalog, deckSolver, pool.counts])

  const handleReveal = useCallback((card: PlayableCard) => {
    setRevealedCard(card)
  }, [])

  const handleCloseReveal = useCallback(() => {
    setRevealedCard(null)
  }, [])

  return (
    <main className="app-shell">
      <header className="masthead">
        <p className="eyebrow">One Piece Card Game</p>
        <h1>Sealed deck builder</h1>
        <p className="intro">
          Enter the cards you opened. We’ll make a transparent 40-card first
          build from your pool.
        </p>
      </header>

      <WorkflowStep
        stepNumber={1}
        headingId="set-heading"
        title="Choose your set"
        description="Your pool resets when you change sets."
        isOpen={isSetStepOpen}
        onOpenChange={setIsSetStepOpen}
        className="setup-panel"
      >
        {loadingIndex ? (
          <p className="loading-status" role="status">
            Loading card sets…
          </p>
        ) : index === null ? null : (
          <CatalogPicker
            entries={index.sets}
            selectedSetId={selectedSetId}
            onSelect={handleSelect}
          />
        )}

        {loadingSetId !== null && selectedEntry !== null ? (
          <p className="loading-status" role="status">
            Loading {selectedEntry.label}…
          </p>
        ) : null}

        {catalog !== null && selectedEntry !== null ? (
          <div className="catalog-summary">
            <div className="leader-summary">
              <span className="leader-mark" aria-hidden="true">
                L
              </span>
              <span>
                <strong>Rainbow Luffy</strong>
                <small>Fixed all-color leader</small>
              </span>
            </div>
            <div className="catalog-status">
              <span
                className={`readiness readiness--${selectedEntry.readiness}`}
              >
                {selectedEntry.readiness === 'tournament-ready'
                  ? 'Tournament ready'
                  : selectedEntry.readiness === 'needs-review'
                    ? 'Needs review'
                    : 'Provisional'}
              </span>
              <span>{catalog.cards.length} card records loaded</span>
            </div>
          </div>
        ) : null}
      </WorkflowStep>

      {error !== null ? (
        <p className="message message--error" role="alert">
          {error}
        </p>
      ) : null}

      {catalog !== null ? (
        <>
          <WorkflowStep
            stepNumber={2}
            headingId="entry-heading"
            title="Enter your cards"
            description="Use the short number for normal cards or a full reprint ID."
            isOpen={isEntryStepOpen}
            onOpenChange={setIsEntryStepOpen}
            className="entry-panel"
          >
            <p
              className={`entry-message confirmation-status${
                confirmation === '' ? ' confirmation-status--empty' : ''
              }`}
              role="status"
              aria-label="Entry confirmation"
            >
              {confirmation}
            </p>
            <CardEntry
              key={catalog.manifest.setId}
              catalog={catalog}
              onCard={handleCard}
              onError={handleEntryError}
            />
            <TestPoolButton onGenerate={handleGenerateTestPool} />
          </WorkflowStep>

          <PoolReview
            key={`pool-${catalog.manifest.setId}`}
            catalog={catalog}
            pool={pool}
            eligibleCount={eligibleCount}
            isOpen={isPoolReviewOpen}
            onOpenChange={setIsPoolReviewOpen}
            onQuantity={handleQuantity}
            onUndo={handleUndo}
            onReveal={handleReveal}
          />

          <section className="build-panel" aria-label="Build deck">
            <div>
              <strong>
                {missingCount === 0
                  ? 'Ready to build'
                  : `${missingCount} more eligible ${missingCount === 1 ? 'card' : 'cards'} needed`}
              </strong>
              <span>Leader and DON!! cards never count toward the 40.</span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={eligibleCount < 40}
              onClick={handleBuild}
            >
              Build deck
            </button>
          </section>

          {solution !== null ? (
            <DeckResult
              solution={solution}
              featuresByCardNumber={catalog.featuresByCardNumber}
              onReveal={handleReveal}
            />
          ) : null}
        </>
      ) : null}
      {revealedCard === null ? null : (
        <CardImageDialog card={revealedCard} onClose={handleCloseReveal} />
      )}
    </main>
  )
}

export default App
