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
import { CatalogPicker } from './components/CatalogPicker.js'
import { DeckResult } from './components/DeckResult.js'
import { PoolReview } from './components/PoolReview.js'
import { TestPoolButton } from './components/TestPoolButton.js'
import {
  appendCard,
  eligiblePoolCount,
  replaceCards,
  setQuantity,
  undoLast,
  type PoolState,
} from './pool/pool.js'
import { StrategyDeckSolver } from './solver/strategy-solver.js'
import type { DeckSolution } from './solver/types.js'
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

const solver = new StrategyDeckSolver()

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
}: AppProps) {
  const [index, setIndex] = useState<RuntimeCatalogIndex | null>(null)
  const [selectedSetId, setSelectedSetId] = useState('')
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null)
  const [pool, setPool] = useState<PoolState>(emptyPool)
  const [solution, setSolution] = useState<DeckSolution | null>(null)
  const [loadingIndex, setLoadingIndex] = useState(true)
  const [loadingSetId, setLoadingSetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')
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
    setSolution(null)
    setLoadingSetId(null)
    setError(null)
    setConfirmation('')

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
    setSolution(null)
    setError(null)
    setConfirmation('')
  }, [])

  const handleCard = useCallback((card: PlayableCard) => {
    setPool((current) => {
      const next = appendCard(current, card.cardNumber)
      setConfirmation(
        `Added ${card.name}. Copy ${next.counts[card.cardNumber] ?? 1}.`,
      )
      return next
    })
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
      setPool(nextPool)
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
    setPool((current) => undoLast(current))
    setSolution(null)
    setError(null)
    setConfirmation('Undid last change.')
  }, [])

  const handleQuantity = useCallback(
    (cardNumber: string, quantity: number) => {
      setPool((current) => setQuantity(current, cardNumber, quantity))
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
      setSolution(solver.solve(catalog, pool.counts))
      setError(null)
      setConfirmation('Built a 40-card main deck.')
    } catch (cause) {
      setError(errorMessage(cause))
      setConfirmation('')
    }
  }, [catalog, pool.counts])

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

      <section className="panel setup-panel" aria-labelledby="set-heading">
        <div className="section-heading">
          <span className="step-number">1</span>
          <div>
            <h2 id="set-heading">Choose your set</h2>
            <p>Your pool resets when you change sets.</p>
          </div>
        </div>

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
      </section>

      {catalog === null && error !== null ? (
        <p className="message message--error" role="alert">
          {error}
        </p>
      ) : null}

      {catalog !== null ? (
        <>
          <section className="panel entry-panel" aria-labelledby="entry-heading">
            <div className="section-heading">
              <span className="step-number">2</span>
              <div>
                <h2 id="entry-heading">Enter your cards</h2>
                <p>Use the short number for normal cards or a full reprint ID.</p>
              </div>
            </div>
            {error !== null ? (
              <p className="message message--error entry-message" role="alert">
                {error}
              </p>
            ) : null}
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
          </section>

          <PoolReview
            key={`pool-${catalog.manifest.setId}`}
            catalog={catalog}
            pool={pool}
            eligibleCount={eligibleCount}
            onQuantity={handleQuantity}
            onUndo={handleUndo}
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

          {solution !== null ? <DeckResult solution={solution} /> : null}
        </>
      ) : null}
    </main>
  )
}

export default App
