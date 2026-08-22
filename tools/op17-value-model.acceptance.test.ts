import { beforeAll, describe, expect, it } from 'vitest'
import type { RuntimeCatalog } from '../src/catalog/load-catalog.js'
import { loadLocalCatalogs } from './evaluate-strategy.js'
import { evaluateValueModelCalibration } from './op17-value-model-calibration.js'

describe('OP17 value-model calibration acceptance', () => {
  let catalog: RuntimeCatalog
  beforeAll(async () => {
    const [loaded] = await loadLocalCatalogs(['OP17'])
    if (loaded === undefined) throw new Error('OP17 catalog did not load')
    catalog = loaded
  })

  it('reports deterministic physical-copy and exact-deck invariants', async () => {
    const report = await evaluateValueModelCalibration(catalog, 100, ['OP17-046', 'OP17-049', 'OP17-063'])
    expect(report.seedCount).toBe(100)
    expect(report.catalogChecksum).toMatch(/^[a-f0-9]{64}$/)
    expect(report.catalogChecksum).toBe('80185f046091d3def85245b291df31e81b349508adb29842152393c743632a52')
    expect(report.profileSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(report.exactFortyFailures).toBe(0)
    expect(report.physicalCopyConservationFailures).toBe(0)
    expect(report.nondeterministicDecks).toBe(0)
    expect(Object.isFrozen(report)).toBe(true)
  }, 300_000)
})
