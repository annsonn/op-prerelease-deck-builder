import { describe, expect, it } from 'vitest'

import { resolveBasePath } from './vite.config.js'

describe('resolveBasePath', () => {
  it('uses the root path when no deployment base is configured', () => {
    expect(resolveBasePath(undefined)).toBe('/')
  })

  it('uses the configured GitHub Pages project path', () => {
    expect(resolveBasePath('/op-prerelease-deck-builder/')).toBe(
      '/op-prerelease-deck-builder/',
    )
  })
})
