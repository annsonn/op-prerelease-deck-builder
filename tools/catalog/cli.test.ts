import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCatalogCommand, reportFailure } from './cli.js'
import * as configModule from './config.js'
import * as pipelineModule from './pipeline.js'
import type { SourceConfig } from './model.js'

const config: SourceConfig = {
  sourceType: 'local-json',
  source: '/fixtures/op17.json',
  targetSet: 'op17',
  expectedFirst: 5,
  expectedLast: 5,
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('runCatalogCommand', () => {
  it('rejects a missing set ID with stage-specific usage', async () => {
    await expect(runCatalogCommand('validate', [])).rejects.toThrow(
      'Usage: npm run catalog:validate -- <set-id>',
    )
  })

  it('runs the requested stage and writes the exact result summary', async () => {
    vi.spyOn(configModule, 'loadSetConfig').mockReturnValue(config)
    const buildCatalog = vi
      .spyOn(pipelineModule, 'buildCatalog')
      .mockResolvedValue({
        setId: 'OP17',
        cardCount: 1,
        variantCount: 2,
        specialReprintCount: 0,
        readiness: 'needs-review',
        output: '/tmp/catalog/op17',
      })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runCatalogCommand('derive', ['OP17'])

    expect(configModule.loadSetConfig).toHaveBeenCalledWith('op17')
    expect(buildCatalog).toHaveBeenCalledWith({ setId: 'op17', config })
    expect(write).toHaveBeenCalledWith(
      'Catalog derive complete\n' +
        'Source records: 2\n' +
        'Playable identities: 1\n' +
        'Special reprints: 0\n' +
        'Readiness: needs-review\n' +
        'Output: /tmp/catalog/op17\n',
    )
  })
})

describe('reportFailure', () => {
  it.each([
    [new Error('broken catalog'), 'broken catalog\n'],
    ['plain failure', 'plain failure\n'],
  ])('writes the failure and requests a nonzero exit', (failure, message) => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    reportFailure(failure)

    expect(write).toHaveBeenCalledWith(message)
    expect(process.exitCode).toBe(1)
  })

  it('includes a concise nested cause chain for invalid local input', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const parseFailure = new SyntaxError('Unexpected token at position 4')
    const validationFailure = new Error('Record 2 is invalid', {
      cause: parseFailure,
    })
    const failure = new Error(
      'Local catalog input invalid: tmp/catalog/source/op17.json',
      { cause: validationFailure },
    )

    reportFailure(failure)

    expect(write).toHaveBeenCalledWith(
      'Local catalog input invalid: tmp/catalog/source/op17.json\n' +
        'Caused by: Record 2 is invalid\n' +
        'Caused by: Unexpected token at position 4\n',
    )
  })

  it('bounds cause output and leaves missing-input errors unchanged', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const longCause = new Error('x'.repeat(2_000))

    reportFailure(new Error('Invalid catalog', { cause: longCause }))
    reportFailure(
      new Error(
        'Local catalog input not found: tmp/catalog/source/op17.json',
      ),
    )

    expect(write.mock.calls[0]?.[0]).toEqual(expect.any(String))
    expect(String(write.mock.calls[0]?.[0]).length).toBeLessThan(1_000)
    expect(write.mock.calls[1]?.[0]).toBe(
      'Local catalog input not found: tmp/catalog/source/op17.json\n',
    )
  })
})
