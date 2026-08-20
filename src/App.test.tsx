import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type {
  RuntimeCatalogIndex,
  RuntimeCatalogIndexEntry,
} from '../shared/catalog-index.js'
import type {
  PlayableCard,
  StrategySuggestion,
  SuggestedRole,
} from '../shared/catalog.js'
import { classifyCardFeatures } from '../shared/card-features.js'
import App, { type CatalogApi } from './App.js'
import {
  browserSha256,
  type RuntimeCatalog,
} from './catalog/load-catalog.js'
import type { TestPoolGeneration } from './test-pool/generate-test-pool.js'

const catalogLoaderMocks = vi.hoisted(() => ({
  loadCatalogIndex: vi.fn(),
  loadRuntimeCatalog: vi.fn(),
}))

vi.mock('./catalog/load-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./catalog/load-catalog.js')
  >()
  return { ...actual, ...catalogLoaderMocks }
})

const sourceSha256 = 'a'.repeat(64)

function indexEntry(setNumber: number): RuntimeCatalogIndexEntry {
  const setId = `OP${String(setNumber).padStart(2, '0')}`
  return {
    setId,
    label: `OP-${setNumber}`,
    manifestPath: `/catalogs/${setId.toLowerCase()}/manifest.json`,
    sourceSha256,
    readiness: setNumber === 17 ? 'provisional' : 'needs-review',
  }
}

function runtimeIndex(): RuntimeCatalogIndex {
  return {
    schemaVersion: 1,
    sets: Array.from({ length: 17 }, (_, index) => indexEntry(index + 1)),
  }
}

function card(
  cardNumber: string,
  overrides: Partial<PlayableCard> = {},
): PlayableCard {
  const isSpecialReprint = !cardNumber.startsWith('OP16-')
  return {
    cardNumber,
    name: `${cardNumber} Test Card`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 3,
    life: null,
    power: 4000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test Crew'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: isSpecialReprint ? null : cardNumber.slice(-3),
    isSpecialReprint,
    ...overrides,
  }
}

function runtimeCatalog(
  setNumber: 16 | 17,
  cards: readonly PlayableCard[],
  roles: Readonly<Record<string, readonly SuggestedRole[]>> = {},
): RuntimeCatalog {
  const setId = `OP${setNumber}`
  const strategySuggestions: StrategySuggestion[] = cards.map((item) => ({
    cardNumber: item.cardNumber,
    roles: [...(roles[item.cardNumber] ?? [])],
    reviewStatus: 'suggested',
  }))
  return {
    manifest: {
      schemaVersion: 1,
      setId,
      language: 'en',
      source: 'fixture.json',
      sourceType: 'local-json',
      sourceSha256,
      readiness: setNumber === 17 ? 'provisional' : 'needs-review',
    },
    cards,
    cardsByNumber: new Map(cards.map((item) => [item.cardNumber, item])),
    normalCardsByShortcut: new Map(
      cards.flatMap((item) =>
        item.entryShortcut === null
          ? []
          : [[item.entryShortcut, item] as const],
      ),
    ),
    specialCards: cards.filter((item) => item.isSpecialReprint),
    strategySuggestions,
    suggestionsByCardNumber: new Map(
      strategySuggestions.map((item) => [item.cardNumber, item]),
    ),
    featuresByCardNumber: new Map(
      cards.map((item) => [item.cardNumber, classifyCardFeatures(item)]),
    ),
  }
}

function op16Catalog(): RuntimeCatalog {
  const cards = [
    card('OP16-001', { cardType: 'LEADER' }),
    card('OP16-002', { cardType: 'DON' }),
    card('OP16-005', { cost: 2, counter: 2000 }),
    card('OP16-006', { cost: 3, effect: '[Blocker]' }),
    card('OP16-007', {
      cost: 4,
      effect:
        "[On Play] K.O. up to 1 of your opponent's Characters with a cost of 3 or less.",
    }),
    card('OP16-008', { cost: 5 }),
    card('OP16-009', { cost: 6 }),
    card('OP16-010', { cost: 7 }),
    card('OP16-011', { cost: 8, counter: 0 }),
    card('OP16-012', { cost: 1 }),
    card('OP10-045'),
  ]
  return runtimeCatalog(16, cards)
}

function catalogApi(
  loadCatalog: CatalogApi['loadCatalog'] = async (entry) =>
    entry.setId === 'OP16'
      ? op16Catalog()
      : runtimeCatalog(17, []),
): CatalogApi {
  return {
    loadIndex: async () => runtimeIndex(),
    loadCatalog,
  }
}

function testPoolGeneration(
  mode: 'development' | 'tournament' = 'development',
): TestPoolGeneration {
  const developmentCards = [
    ...Array<string>(35).fill('OP16-005'),
    ...Array<string>(14).fill('OP16-006'),
    'OP16-001',
    ...Array<string>(8).fill('OP16-007'),
    'OP16-008',
    'OP16-012',
  ]
  const tournamentCards = [
    ...developmentCards,
    ...Array<string>(7).fill('OP16-009'),
    ...Array<string>(5).fill('OP16-010'),
  ]
  return {
    cardNumbers:
      mode === 'tournament' ? tournamentCards : developmentCards,
    rarityCounts:
      mode === 'tournament'
        ? { C: 42, UC: 19, L: 1, R: 8, SR: 2, SEC: 0 }
        : { C: 35, UC: 14, L: 1, R: 8, SR: 2, SEC: 0 },
    selectedPackIndexes:
      mode === 'tournament' ? [0, 4, 9, 14, 19, 23] : [0, 4, 9, 14, 23],
    excludedUnknownRarityCount: 0,
  }
}

async function commitQuantity(
  user: ReturnType<typeof userEvent.setup>,
  cardName: string,
  cardNumber: string,
  quantity: number,
): Promise<void> {
  const input = screen.getByRole('spinbutton', {
    name: `Quantity for ${cardName} (${cardNumber})`,
  })
  await user.clear(input)
  await user.type(input, String(quantity))
  await user.tab()
}

function poolCardRow(cardName: string, cardNumber: string): HTMLElement {
  const quantity = screen.getByRole('spinbutton', {
    name: `Quantity for ${cardName} (${cardNumber})`,
  })
  const row = quantity.closest('li')
  if (row === null) throw new Error(`Expected pool row for ${cardNumber}.`)
  return row
}

function poolTotals(): HTMLElement {
  return screen.getByLabelText(/^Pool totals:/)
}

function cardImage(): HTMLImageElement {
  const image = document.body.querySelector<HTMLImageElement>(
    '.card-image-dialog__image',
  )
  if (image === null) throw new Error('Expected one card image request.')
  return image
}

describe('default catalog API', () => {
  it('passes the Vite base URL through the browser gateway', async () => {
    const user = userEvent.setup()
    catalogLoaderMocks.loadCatalogIndex.mockResolvedValue(runtimeIndex())
    catalogLoaderMocks.loadRuntimeCatalog.mockResolvedValue(op16Catalog())

    render(<App />)

    await waitFor(() => {
      expect(catalogLoaderMocks.loadCatalogIndex).toHaveBeenCalledWith(
        fetch,
        import.meta.env.BASE_URL,
      )
    })
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await waitFor(() => {
      expect(catalogLoaderMocks.loadRuntimeCatalog).toHaveBeenCalledWith(
        indexEntry(16),
        fetch,
        browserSha256,
        import.meta.env.BASE_URL,
      )
    })
  })
})

describe('sealed pool builder', () => {
  it('shows the test-pool utility only after the selected catalog loads', async () => {
    const user = userEvent.setup()
    let resolveCatalog!: (catalog: RuntimeCatalog) => void
    const pendingCatalog = new Promise<RuntimeCatalog>((resolve) => {
      resolveCatalog = resolve
    })
    render(<App catalogApi={catalogApi(async () => pendingCatalog)} />)

    expect(
      screen.queryByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    ).not.toBeInTheDocument()

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    expect(screen.getByText('Loading OP-16…')).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    ).not.toBeInTheDocument()

    resolveCatalog(op16Catalog())

    expect(
      await screen.findByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('complementary', { name: 'Testing utility' }),
    ).toHaveTextContent(
      'Generating a test pool replaces the cards currently entered.',
    )
  })

  it('generates a deterministic 60-card pool with rarity details and one-step Undo', async () => {
    const user = userEvent.setup()
    const generate = vi.fn(() => testPoolGeneration())
    const loadedCatalog = op16Catalog()
    render(
      <App
        catalogApi={catalogApi(async () => loadedCatalog)}
        testPoolApi={{ generate }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )

    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(loadedCatalog, 'development')
    expect(poolTotals()).toHaveTextContent('60 copies')
    expect(poolTotals()).toHaveTextContent('59 eligible')
    expect(
      screen.getByRole('status', { name: 'Entry confirmation' }),
    ).toHaveTextContent(
      'Generated 60 test cards: 35 C, 14 UC, 1 L, 8 R, 2 SR, 0 SEC.',
    )
    expect(
      screen.getByRole('spinbutton', {
        name: 'Quantity for OP16-001 Test Card (OP16-001)',
      }),
    ).toHaveValue(1)
    expect(screen.getByLabelText('Latest accepted card')).toHaveTextContent(
      'OP16-012 Test Card · OP16-012',
    )

    await user.click(screen.getByRole('button', { name: 'Build deck' }))
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(poolTotals()).toHaveTextContent('0 copies')
    expect(poolTotals()).toHaveTextContent('0 eligible')
    expect(
      screen.queryByLabelText('Latest accepted card'),
    ).not.toBeInTheDocument()
  })

  it('replaces a manual card with a 72-card tournament pool', async () => {
    const user = userEvent.setup()
    const generate = vi.fn(
      (_catalog: RuntimeCatalog, mode: 'development' | 'tournament') =>
        testPoolGeneration(mode),
    )
    const loadedCatalog = op16Catalog()
    render(
      <App
        catalogApi={catalogApi(async () => loadedCatalog)}
        testPoolApi={{ generate }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.type(
      await screen.findByRole('textbox', {
        name: 'Card number (1–3 digits)',
      }),
      '5',
    )
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    )

    expect(generate).toHaveBeenCalledWith(loadedCatalog, 'tournament')
    expect(poolTotals()).toHaveTextContent('72 copies')
    expect(
      screen.getByRole('status', { name: 'Entry confirmation' }),
    ).toHaveTextContent(
      'Generated 72 test cards: 42 C, 19 UC, 1 L, 8 R, 2 SR, 0 SEC.',
    )
  })

  it('undoes a generated replacement to restore an earlier manual card', async () => {
    const user = userEvent.setup()
    render(
      <App
        catalogApi={catalogApi()}
        testPoolApi={{ generate: () => testPoolGeneration() }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    const suffixInput = await screen.findByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(suffixInput).toHaveFocus()

    await user.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    expect(poolTotals()).toHaveTextContent('60 copies')
    expect(poolTotals()).toHaveTextContent('59 eligible')

    await user.click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(poolTotals()).toHaveTextContent('1 copies')
    expect(poolTotals()).toHaveTextContent('1 eligible')
    expect(
      screen.getByRole('spinbutton', {
        name: 'Quantity for OP16-005 Test Card (OP16-005)',
      }),
    ).toHaveValue(1)
  })

  it('keeps repeated generation at 60 cards and clears a stale solution', async () => {
    const user = userEvent.setup()
    render(
      <App
        catalogApi={catalogApi()}
        testPoolApi={{ generate: () => testPoolGeneration() }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Build deck' }))
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()

    await user.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )

    expect(
      screen.queryByRole('heading', { name: 'Strategy sealed build' }),
    ).not.toBeInTheDocument()
    expect(poolTotals()).toHaveTextContent('60 copies')
  })

  it('preserves the pool and solution when test-pool generation throws', async () => {
    const user = userEvent.setup()
    const generate = vi
      .fn()
      .mockReturnValueOnce(testPoolGeneration())
      .mockImplementationOnce(() => {
        throw new Error('No eligible booster rarities')
      })
    render(<App catalogApi={catalogApi()} testPoolApi={{ generate }} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Build deck' }))

    await user.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No eligible booster rarities',
    )
    expect(poolTotals()).toHaveTextContent('60 copies')
    expect(poolTotals()).toHaveTextContent('59 eligible')
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()
  })

  it('preserves the pool and solution when generated replacement is empty', async () => {
    const user = userEvent.setup()
    const generate = vi
      .fn()
      .mockReturnValueOnce(testPoolGeneration())
      .mockReturnValueOnce({
        ...testPoolGeneration(),
        cardNumbers: [],
      })
    render(<App catalogApi={catalogApi()} testPoolApi={{ generate }} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Build deck' }))

    await user.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pool replacement must include at least one card.',
    )
    expect(poolTotals()).toHaveTextContent('60 copies')
    expect(poolTotals()).toHaveTextContent('59 eligible')
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()
  })

  it('hides the test utility and resets its batch when the set changes', async () => {
    const user = userEvent.setup()
    let resolveOp17!: (catalog: RuntimeCatalog) => void
    const op17Promise = new Promise<RuntimeCatalog>((resolve) => {
      resolveOp17 = resolve
    })
    render(
      <App
        catalogApi={catalogApi(async (entry) =>
          entry.setId === 'OP16' ? op16Catalog() : op17Promise,
        )}
        testPoolApi={{ generate: () => testPoolGeneration() }}
      />,
    )

    const picker = await screen.findByRole('combobox', { name: 'Card set' })
    await user.selectOptions(picker, 'OP16')
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    expect(poolTotals()).toHaveTextContent('60 copies')

    await user.selectOptions(picker, 'OP17')

    expect(screen.getByText('Loading OP-17…')).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Pool totals:/)).not.toBeInTheDocument()

    resolveOp17(runtimeCatalog(17, []))

    expect(
      await screen.findByRole('button', {
        name: 'Generate 72-card tournament pool',
      }),
    ).toBeVisible()
    expect(poolTotals()).toHaveTextContent('0 copies')
  })

  it('enters and corrects an OP-16 pool, then builds an exact legal deck', async () => {
    const user = userEvent.setup()
    render(<App catalogApi={catalogApi()} />)

    const picker = await screen.findByRole('combobox', { name: 'Card set' })
    expect(within(picker).getByRole('option', { name: 'OP-16' })).toBeVisible()
    expect(within(picker).getByRole('option', { name: 'OP-17' })).toBeVisible()

    await user.selectOptions(picker, 'OP16')
    expect(await screen.findByText('Needs review')).toBeVisible()
    expect(screen.getByText('Rainbow Luffy')).toBeVisible()
    expect(screen.getByText('Fixed all-color leader')).toBeVisible()

    const suffixInput = screen.getByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    expect(suffixInput).toHaveAttribute('inputmode', 'numeric')
    expect(suffixInput).toHaveAttribute('pattern', '[0-9]*')

    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(suffixInput).toHaveValue('')
    expect(suffixInput).toHaveFocus()
    expect(screen.getByText('Added OP16-005 Test Card. Copy 1.')).toBeVisible()
    expect(screen.getByText('Latest accepted card')).toBeVisible()
    expect(
      screen.getByText('OP16-005 Test Card · OP16-005'),
    ).toBeVisible()

    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.getByText('2 eligible')).toBeVisible()

    const fullIdInput = screen.getByRole('textbox', {
      name: 'Full printed card ID',
    })
    await user.type(fullIdInput, 'op10-045')
    await user.click(screen.getByRole('button', { name: 'Add full ID' }))
    expect(screen.getByText('3 eligible')).toBeVisible()

    await user.type(suffixInput, '999')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No normally numbered card 999 exists in OP16.',
    )
    expect(screen.getByText('3 eligible')).toBeVisible()
    expect(screen.getByText('OP10-045 Test Card · OP10-045')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(screen.getByText('2 eligible')).toBeVisible()
    expect(screen.queryByText('OP10-045 Test Card')).not.toBeInTheDocument()
    expect(
      screen.getByText('OP16-005 Test Card · OP16-005'),
    ).toBeVisible()

    for (const suffix of ['6', '7', '8', '9', '10', '11', '12']) {
      await user.clear(suffixInput)
      await user.type(suffixInput, suffix)
      await user.click(screen.getByRole('button', { name: 'Add number' }))
    }

    await commitQuantity(user, 'OP16-005 Test Card', 'OP16-005', 6)
    for (const suffix of ['006', '007', '008', '009', '010', '011', '012']) {
      await commitQuantity(
        user,
        `${`OP16-${suffix}`} Test Card`,
        `OP16-${suffix}`,
        5,
      )
    }

    await user.type(suffixInput, '1')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.getByText('42 copies')).toBeVisible()
    expect(screen.getByText('41 eligible')).toBeVisible()
    await user.click(
      screen.getByRole('button', {
        name: 'Remove OP16-001 Test Card (OP16-001)',
      }),
    )

    expect(screen.getByText('41 copies')).toBeVisible()
    expect(screen.getByText('41 eligible')).toBeVisible()
    const buildButton = screen.getByRole('button', { name: 'Build deck' })
    expect(buildButton).toBeEnabled()
    await user.click(buildButton)

    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()
    const coverage = screen.getByRole('group', { name: 'Role coverage' })
    const blockers = within(coverage)
      .getByText('Blockers')
      .closest('.role-metric')
    expect(blockers).toHaveTextContent('Blockers5 / 10')
    expect(blockers).not.toHaveTextContent('soft target')
    expect(
      within(coverage).getByText('Removal').closest('.role-metric'),
    ).toHaveTextContent(
      'Removal5',
    )
    const guide = screen.getByRole('region', {
      name: 'How to play this deck',
    })
    expect(guide).toBeVisible()
    expect(
      within(guide).getByText(/consider using removal before attacks/i),
    ).toBeVisible()
    expect(screen.getByText('Main deck 40')).toBeVisible()
    expect(screen.getByText('Sideboard 1')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Cost and color curve' }),
    ).toBeVisible()
    expect(screen.getByText('Total counter')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Role coverage' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Strengths' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Weaknesses' })).toBeVisible()
    expect(screen.getByText('Sideboard · 1 card')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Cost curve' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Warnings' }),
    ).not.toBeInTheDocument()
  })

  it('keeps build disabled until 40 eligible cards are entered', async () => {
    const user = userEvent.setup()
    render(<App catalogApi={catalogApi()} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )

    expect(await screen.findByRole('button', { name: 'Build deck' })).toBeDisabled()
    expect(screen.getByText('40 more eligible cards needed')).toBeVisible()
  })

  it('shows loading and actionable catalog errors', async () => {
    const loadIndex = vi.fn<CatalogApi['loadIndex']>()
    const api: CatalogApi = {
      loadIndex,
      loadCatalog: vi.fn<CatalogApi['loadCatalog']>(),
    }
    loadIndex.mockRejectedValueOnce(new Error('offline'))

    render(<App catalogApi={api} />)

    expect(screen.getByText('Loading card sets…')).toBeVisible()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load card sets: offline',
    )
  })

  it('ignores a stale catalog result after the selected set changes', async () => {
    const user = userEvent.setup()
    let resolveOp16!: (catalog: RuntimeCatalog) => void
    const op16Promise = new Promise<RuntimeCatalog>((resolve) => {
      resolveOp16 = resolve
    })
    const api = catalogApi(async (entry) =>
      entry.setId === 'OP16'
        ? op16Promise
        : runtimeCatalog(17, []),
    )
    render(<App catalogApi={api} />)

    const picker = await screen.findByRole('combobox', { name: 'Card set' })
    await user.selectOptions(picker, 'OP16')
    expect(screen.getByText('Loading OP-16…')).toBeVisible()
    await user.selectOptions(picker, 'OP17')

    expect(await screen.findByText('OP17 is ready for pool entry.')).toBeVisible()
    resolveOp16(op16Catalog())
    await Promise.resolve()

    expect(screen.getByText('OP17 is ready for pool entry.')).toBeVisible()
    expect(screen.queryByText('OP16 is ready for pool entry.')).not.toBeInTheDocument()
  })

  it('resets the loaded pool immediately when the selected set changes', async () => {
    const user = userEvent.setup()
    render(<App catalogApi={catalogApi()} />)

    const picker = await screen.findByRole('combobox', { name: 'Card set' })
    await user.selectOptions(picker, 'OP16')
    const suffixInput = await screen.findByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.getByText('1 eligible')).toBeVisible()

    await user.selectOptions(picker, 'OP17')

    expect(screen.queryByText('OP16-005 Test Card')).not.toBeInTheDocument()
    expect(await screen.findByText('0 eligible')).toBeVisible()
  })

  it('shows a set-load error and keeps the pool interface unavailable', async () => {
    const user = userEvent.setup()
    render(
      <App
        catalogApi={catalogApi(async () => {
          throw new Error('checksum mismatch')
        })}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load OP-16: checksum mismatch Run npm run catalog:sync',
    )
    expect(
      screen.queryByRole('textbox', { name: 'Card number (1–3 digits)' }),
    ).not.toBeInTheDocument()
  })

  it('clears catalog-derived state while a replacement API reloads', async () => {
    const user = userEvent.setup()
    const firstApi = catalogApi()
    let resolveReplacement!: (catalog: RuntimeCatalog) => void
    const replacementCatalog = new Promise<RuntimeCatalog>((resolve) => {
      resolveReplacement = resolve
    })
    const replacementApi = catalogApi(async () => replacementCatalog)
    const view = render(<App catalogApi={firstApi} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.type(
      await screen.findByRole('textbox', {
        name: 'Card number (1–3 digits)',
      }),
      '5',
    )
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.getByText('1 eligible')).toBeVisible()

    view.rerender(<App catalogApi={replacementApi} />)

    expect(screen.getByText('Loading card sets…')).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: 'Card number (1–3 digits)' }),
    ).not.toBeInTheDocument()
    await screen.findByRole('combobox', { name: 'Card set' })
    resolveReplacement(op16Catalog())
    await Promise.resolve()

    expect(
      screen.queryByRole('textbox', { name: 'Card number (1–3 digits)' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('0 eligible')).not.toBeInTheDocument()
  })

  it('gives duplicate-name pool controls unique card-number labels', async () => {
    const user = userEvent.setup()
    const cards = [
      card('OP16-005', { name: 'Monkey.D.Luffy' }),
      card('OP16-006', { name: 'Monkey.D.Luffy' }),
    ]
    render(
      <App
        catalogApi={catalogApi(async () => runtimeCatalog(16, cards))}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    const suffixInput = await screen.findByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    for (const suffix of ['5', '6']) {
      await user.type(suffixInput, suffix)
      await user.click(screen.getByRole('button', { name: 'Add number' }))
    }

    expect(
      screen.getByRole('spinbutton', {
        name: 'Quantity for Monkey.D.Luffy (OP16-005)',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Remove Monkey.D.Luffy (OP16-006)',
      }),
    ).toBeVisible()

    const firstReveal = within(
      poolCardRow('Monkey.D.Luffy', 'OP16-005'),
    ).getByRole('button', {
      name: 'View Monkey.D.Luffy, OP16-005',
    })
    const secondReveal = within(
      poolCardRow('Monkey.D.Luffy', 'OP16-006'),
    ).getByRole('button', {
      name: 'View Monkey.D.Luffy, OP16-006',
    })

    await user.click(firstReveal)
    expect(
      screen.getByRole('dialog', { name: 'Monkey.D.Luffy, OP16-005' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close card image' }))

    await user.click(secondReveal)
    expect(
      screen.getByRole('dialog', { name: 'Monkey.D.Luffy, OP16-006' }),
    ).toBeVisible()
  })

  it('owns one card dialog without letting image failure mutate the pool or solution', async () => {
    const user = userEvent.setup()
    render(
      <App
        catalogApi={catalogApi()}
        testPoolApi={{ generate: () => testPoolGeneration() }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    await user.click(
      await screen.findByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Build deck' }))

    await user.click(
      within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
        'button',
        { name: 'View OP16-005 Test Card, OP16-005' },
      ),
    )

    expect(
      screen.getByRole('dialog', {
        name: 'OP16-005 Test Card, OP16-005',
      }),
    ).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(
      document.body.querySelectorAll('.card-image-dialog__image'),
    ).toHaveLength(1)

    fireEvent.error(cardImage())

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Card image unavailable',
    )
    expect(
      screen.getByRole('spinbutton', {
        name: 'Quantity for OP16-005 Test Card (OP16-005)',
      }),
    ).toHaveValue(35)
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /View Rainbow Luffy/ }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close card image' }))
    await user.click(
      within(poolCardRow('OP16-006 Test Card', 'OP16-006')).getByRole(
        'button',
        { name: 'View OP16-006 Test Card, OP16-006' },
      ),
    )

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(
      screen.getByRole('dialog', {
        name: 'OP16-006 Test Card, OP16-006',
      }),
    ).toBeVisible()
    expect(cardImage()).toHaveAttribute(
      'alt',
      'OP16-006 Test Card (OP16-006) card',
    )
  })

  it('closes a reveal for successful test-pool replacement and set selection only', async () => {
    const user = userEvent.setup()
    const generate = vi
      .fn()
      .mockReturnValueOnce(testPoolGeneration())
      .mockImplementationOnce(() => {
        throw new Error('replacement failed')
      })
      .mockReturnValueOnce(testPoolGeneration('tournament'))
    render(<App catalogApi={catalogApi()} testPoolApi={{ generate }} />)

    const picker = await screen.findByRole('combobox', { name: 'Card set' })
    await user.selectOptions(picker, 'OP16')
    const generateButton = await screen.findByRole('button', {
      name: 'Generate 60-card development pool',
    })
    await user.click(generateButton)
    await user.click(
      within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
        'button',
        { name: 'View OP16-005 Test Card, OP16-005' },
      ),
    )

    fireEvent.click(generateButton)

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('replacement failed')

    fireEvent.click(generateButton)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(poolTotals()).toHaveTextContent('72 copies')

    fireEvent.click(
      within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
        'button',
        { name: 'View OP16-005 Test Card, OP16-005' },
      ),
    )
    fireEvent.change(picker, { target: { value: 'OP17' } })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Loading OP-17…')).toBeVisible()
  })

  it('closes a reveal after accepted cards, Undo, quantity edits, removal, and deck replacement', async () => {
    const user = userEvent.setup()
    render(
      <App
        catalogApi={catalogApi()}
        testPoolApi={{ generate: () => testPoolGeneration() }}
      />,
    )

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    const suffixInput = await screen.findByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    await user.click(
      within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
        'button',
        { name: 'View OP16-005 Test Card, OP16-005' },
      ),
    )

    fireEvent.change(suffixInput, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(
      within(screen.getByLabelText('Latest accepted card')).getByRole(
        'button',
        { name: 'View OP16-006 Test Card, OP16-006' },
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const firstRow = poolCardRow('OP16-005 Test Card', 'OP16-005')
    fireEvent.click(
      within(firstRow).getByRole('button', {
        name: 'View OP16-005 Test Card, OP16-005',
      }),
    )
    const quantity = within(firstRow).getByRole('spinbutton', {
      name: 'Quantity for OP16-005 Test Card (OP16-005)',
    })
    fireEvent.change(quantity, { target: { value: '2' } })
    fireEvent.blur(quantity)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(quantity).toHaveValue(2)

    fireEvent.click(
      within(firstRow).getByRole('button', {
        name: 'View OP16-005 Test Card, OP16-005',
      }),
    )
    fireEvent.click(
      within(firstRow).getByRole('button', {
        name: 'Remove OP16-005 Test Card (OP16-005)',
      }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', {
        name: 'Quantity for OP16-005 Test Card (OP16-005)',
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate 60-card development pool',
      }),
    )
    fireEvent.click(
      within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
        'button',
        { name: 'View OP16-005 Test Card, OP16-005' },
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build deck' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Strategy sealed build' }),
    ).toBeVisible()
  })

  it('cleans up the dialog and restores body scroll when the catalog API resets', async () => {
    const user = userEvent.setup()
    const firstApi = catalogApi()
    let resolveIndex!: (index: RuntimeCatalogIndex) => void
    const replacementApi: CatalogApi = {
      loadIndex: () =>
        new Promise<RuntimeCatalogIndex>((resolve) => {
          resolveIndex = resolve
        }),
      loadCatalog: async () => op16Catalog(),
    }
    const view = render(<App catalogApi={firstApi} />)
    const previousOverflow = document.body.style.overflow

    try {
      await user.selectOptions(
        await screen.findByRole('combobox', { name: 'Card set' }),
        'OP16',
      )
      const suffixInput = await screen.findByRole('textbox', {
        name: 'Card number (1–3 digits)',
      })
      await user.type(suffixInput, '5')
      await user.click(screen.getByRole('button', { name: 'Add number' }))
      document.body.style.overflow = 'clip'
      await user.click(
        within(poolCardRow('OP16-005 Test Card', 'OP16-005')).getByRole(
          'button',
          { name: 'View OP16-005 Test Card, OP16-005' },
        ),
      )
      expect(document.body.style.overflow).toBe('hidden')

      view.rerender(<App catalogApi={replacementApi} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('clip')
      expect(screen.getByText('Loading card sets…')).toBeVisible()
      resolveIndex(runtimeIndex())
    } finally {
      view.unmount()
      document.body.style.overflow = previousOverflow
    }
  })

  it('updates the persistent live confirmation for repeated copies', async () => {
    const user = userEvent.setup()
    render(<App catalogApi={catalogApi()} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Card set' }),
      'OP16',
    )
    const suffixInput = await screen.findByRole('textbox', {
      name: 'Card number (1–3 digits)',
    })
    const status = screen.getByRole('status', { name: 'Entry confirmation' })
    expect(status).toHaveTextContent('OP16 is ready for pool entry.')

    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    expect(status).toHaveTextContent('Added OP16-005 Test Card. Copy 1.')

    await user.type(suffixInput, '5')
    await user.click(screen.getByRole('button', { name: 'Add number' }))
    await waitFor(() =>
      expect(status).toHaveTextContent('Added OP16-005 Test Card. Copy 2.'),
    )
  })
})
