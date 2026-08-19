import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeExportResult } from './runtime-export.js'
import type { SyncCatalogsResult } from './sync.js'

const controls = vi.hoisted(() => ({
  exportRuntimeCatalogs: vi.fn(),
  syncCatalogs: vi.fn(),
}))

vi.mock('./runtime-export.js', () => ({
  exportRuntimeCatalogs: controls.exportRuntimeCatalogs,
}))

vi.mock('./sync.js', () => ({
  syncCatalogs: controls.syncCatalogs,
  validateSourceOverride: (source: string) => {
    const url = new URL(source)
    if (url.protocol !== 'https:') throw new Error('invalid source')
    return url.href
  },
}))

import { runSyncCommand } from './sync-command.js'

const publishedResult: SyncCatalogsResult = {
  mode: 'published',
  source: 'https://cdn.example.test/cards.json',
  sourceSha256: 'a'.repeat(64),
  catalogs: [],
}

afterEach(() => {
  controls.exportRuntimeCatalogs.mockReset()
  controls.syncCatalogs.mockReset()
  vi.restoreAllMocks()
})

describe('runSyncCommand runtime export', () => {
  it('publishes internal bundles and then exports the fixed browser-safe paths', async () => {
    controls.syncCatalogs.mockResolvedValue(publishedResult)
    controls.exportRuntimeCatalogs.mockResolvedValue({
      publicRoot: resolve('public/catalogs'),
      setCount: 17,
      fileCount: 85,
    } satisfies RuntimeExportResult)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runSyncCommand([])

    expect(controls.syncCatalogs).toHaveBeenCalledWith({
      configValue: expect.any(Object),
      outputRoot: resolve('tmp/catalog/bundles'),
    })
    expect(controls.exportRuntimeCatalogs).toHaveBeenCalledWith({
      bundleRoot: resolve('tmp/catalog/bundles'),
      publicRoot: resolve('public/catalogs'),
      stagingRoot: resolve('tmp/catalog/staging'),
    })
    expect(controls.syncCatalogs.mock.invocationCallOrder[0]).toBeLessThan(
      controls.exportRuntimeCatalogs.mock.invocationCallOrder[0]!,
    )
  })

  it('does not export an unpublished source candidate', async () => {
    controls.syncCatalogs.mockResolvedValue({
      ...publishedResult,
      mode: 'candidate-report',
      reportPath: resolve('tmp/catalog/reports/candidate-a.json'),
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runSyncCommand([
      '--source',
      'https://cdn.example.test/cards-v2.json',
    ])

    expect(controls.exportRuntimeCatalogs).not.toHaveBeenCalled()
  })
})
