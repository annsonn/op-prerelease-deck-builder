import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  sha256,
  stableStringify,
  writeBundleFiles,
  writeJson,
} from './artifacts.js'
import type { StrategySuggestion } from './derive-strategy.js'
import type { PlayableCard, SourceConfig } from './model.js'
import { validateCatalog } from './validate.js'

const config: SourceConfig = {
  sourceType: 'official-html',
  source: 'https://example.com/op16',
  targetSet: 'op16',
  expectedFirst: 1,
  expectedLast: 119,
}

const expectedSpecialReprint = 'EB04-054'

function withExpectedSpecials(
  expectedSpecialReprints: string[],
): SourceConfig {
  return { ...config, expectedSpecialReprints }
}

function makeSpecialReprint(cardNumber = expectedSpecialReprint): PlayableCard {
  return {
    ...makeCard(1),
    cardNumber,
    setMembership: [cardNumber.slice(0, cardNumber.indexOf('-')), 'OP16'],
    entryShortcut: null,
    isSpecialReprint: true,
  }
}

function reviewedSpecialStrategy(cardNumber = expectedSpecialReprint): StrategySuggestion {
  return {
    cardNumber,
    roles: [],
    reviewStatus: 'reviewed',
  }
}

function makeCard(number: number): PlayableCard {
  const shortcut = String(number).padStart(3, '0')

  return {
    cardNumber: `OP16-${shortcut}`,
    name: `Test Card ${shortcut}`,
    rarity: 'C',
    cardType: 'CHARACTER',
    colors: ['Red'],
    cost: 1,
    life: null,
    power: 1000,
    counter: 1000,
    attribute: 'Strike',
    traits: ['Test'],
    effect: '',
    trigger: '',
    setMembership: ['OP16'],
    variantsCollapsed: 1,
    entryShortcut: shortcut,
    isSpecialReprint: false,
  }
}

const cards001Through119 = Array.from({ length: 119 }, (_, index) =>
  makeCard(index + 1),
)
const reviewedSuggestions: StrategySuggestion[] = cards001Through119.map(
  ({ cardNumber }) => ({
    cardNumber,
    roles: [],
    reviewStatus: 'reviewed',
  }),
)

const temporaryDirectories: string[] = []

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-artifacts-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('validateCatalog', () => {
  it('marks a complete reviewed catalog as tournament-ready', () => {
    expect(
      validateCatalog(cards001Through119, config, reviewedSuggestions),
    ).toEqual({
      errors: [],
      warnings: [],
      readiness: 'tournament-ready',
    })
  })

  it('reports a missing normal target card', () => {
    const cards = cards001Through119.filter(
      ({ cardNumber }) => cardNumber !== 'OP16-005',
    )
    const suggestions = reviewedSuggestions.filter(
      ({ cardNumber }) => cardNumber !== 'OP16-005',
    )

    expect(validateCatalog(cards, config, suggestions).errors).toContain(
      'Missing OP16-005',
    )
  })

  it('requires human review before tournament-ready', () => {
    const suggestions = reviewedSuggestions.map((suggestion) => ({
      ...suggestion,
      reviewStatus: 'suggested' as const,
    }))

    expect(validateCatalog(cards001Through119, config, suggestions)).toEqual({
      errors: [],
      warnings: [],
      readiness: 'needs-review',
    })
  })

  it.each(['-', 'unknown', 'UnKnOwN'])(
    'warns for unknown rarity %s and requires review',
    (rarity) => {
      const cards = cards001Through119.map((card, index) =>
        index === 4 ? { ...card, rarity } : card,
      )

      expect(validateCatalog(cards, config, reviewedSuggestions)).toEqual({
        errors: [],
        warnings: ['Unknown rarity: OP16-005'],
        readiness: 'needs-review',
      })
    },
  )

  it('does not treat an older-numbered special reprint as a missing normal card', () => {
    const specialReprint = makeSpecialReprint()
    const specialStrategy = reviewedSpecialStrategy()

    expect(
      validateCatalog(
        [...cards001Through119, specialReprint],
        withExpectedSpecials([expectedSpecialReprint]),
        [...reviewedSuggestions, specialStrategy],
      ),
    ).toEqual({
      errors: [],
      warnings: [],
      readiness: 'tournament-ready',
    })
  })

  it('cannot be tournament-ready when every configured special reprint is missing', () => {
    const result = validateCatalog(
      cards001Through119,
      withExpectedSpecials(['EB04-054', 'OP10-045']),
      reviewedSuggestions,
    )

    expect(result.errors).toEqual(['Missing EB04-054', 'Missing OP10-045'])
    expect(result.readiness).toBe('provisional')
  })

  it('rejects a normal target identity beyond the configured range', () => {
    const unexpectedCard = makeCard(120)
    const result = validateCatalog(
      [...cards001Through119, unexpectedCard],
      config,
      [...reviewedSuggestions, {
        cardNumber: unexpectedCard.cardNumber,
        roles: [],
        reviewStatus: 'reviewed',
      }],
    )

    expect(result.errors).toContain('Unexpected card: OP16-120')
    expect(result.readiness).toBe('provisional')
  })

  it('rejects a different-prefix identity not in the special inventory', () => {
    const unexpectedCard = makeSpecialReprint('OP01-001')
    const result = validateCatalog(
      [...cards001Through119, unexpectedCard],
      config,
      [...reviewedSuggestions, reviewedSpecialStrategy('OP01-001')],
    )

    expect(result.errors).toContain('Unexpected card: OP01-001')
    expect(result.readiness).toBe('provisional')
  })

  it.each(['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP CARD'])(
    'accepts sanctioned canonical rarity %s',
    (rarity) => {
      const cards = cards001Through119.map((card, index) =>
        index === 4 ? { ...card, rarity } : card,
      )

      expect(validateCatalog(cards, config, reviewedSuggestions).warnings).toEqual(
        [],
      )
    },
  )

  it('warns for an unsanctioned canonical rarity and requires review', () => {
    const cards = cards001Through119.map((card, index) =>
      index === 4 ? { ...card, rarity: 'TYPO_RARITY' } : card,
    )

    expect(validateCatalog(cards, config, reviewedSuggestions)).toEqual({
      errors: [],
      warnings: ['Unknown rarity: OP16-005'],
      readiness: 'needs-review',
    })
  })

  it('requires normal target cards to declare target-set membership', () => {
    const cards = cards001Through119.map((card, index) =>
      index === 4 ? { ...card, setMembership: ['ST01'] } : card,
    )

    const result = validateCatalog(cards, config, reviewedSuggestions)

    expect(result.errors).toContain('Missing OP16 membership: OP16-005')
    expect(result.readiness).toBe('provisional')
  })

  it('requires special reprints to declare target-set membership', () => {
    const specialReprint: PlayableCard = {
      ...makeCard(1),
      cardNumber: 'EB04-054',
      setMembership: ['EB04'],
      entryShortcut: null,
      isSpecialReprint: true,
    }
    const specialStrategy: StrategySuggestion = {
      cardNumber: specialReprint.cardNumber,
      roles: [],
      reviewStatus: 'reviewed',
    }

    const result = validateCatalog(
      [...cards001Through119, specialReprint],
      config,
      [...reviewedSuggestions, specialStrategy],
    )

    expect(result.errors).toContain('Missing OP16 membership: EB04-054')
    expect(result.readiness).toBe('provisional')
  })

  it('rejects duplicate playable card numbers before strategy validation', () => {
    const result = validateCatalog(
      [...cards001Through119, makeCard(5)],
      config,
      reviewedSuggestions,
    )

    expect(result.errors).toContain('Duplicate card: OP16-005')
    expect(result.readiness).toBe('provisional')
  })

  it('defensively rejects a reversed expected card range', () => {
    const invalidConfig: SourceConfig = {
      ...config,
      expectedFirst: 119,
      expectedLast: 1,
    }

    const result = validateCatalog(
      cards001Through119,
      invalidConfig,
      reviewedSuggestions,
    )

    expect(result.errors[0]).toBe('Invalid expected range: 119..1')
    expect(result.readiness).toBe('provisional')
  })

  it('requires exactly one strategy suggestion for every playable card', () => {
    const suggestions = [
      ...reviewedSuggestions.filter(
        ({ cardNumber }) => cardNumber !== 'OP16-005',
      ),
      reviewedSuggestions[0]!,
      {
        cardNumber: 'OP99-001',
        roles: [],
        reviewStatus: 'reviewed' as const,
      },
      {
        cardNumber: 'OP99-001',
        roles: [],
        reviewStatus: 'reviewed' as const,
      },
    ]

    const result = validateCatalog(cards001Through119, config, suggestions)

    expect(result.errors).toEqual([
      'Missing strategy: OP16-005',
      'Duplicate strategy: OP16-001',
      'Duplicate strategy: OP99-001',
      'Unknown strategy card: OP99-001',
    ])
    expect(result.readiness).toBe('provisional')
  })
})

describe('catalog artifacts', () => {
  it('stableStringify recursively sorts object keys and preserves array order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(
      '{\n  "a": 2,\n  "b": 1\n}\n',
    )
    expect(
      stableStringify({ z: [{ b: 1, a: 2 }, { d: 3, c: 4 }], a: true }),
    ).toBe(
      '{\n  "a": true,\n  "z": [\n    {\n      "a": 2,\n      "b": 1\n    },\n    {\n      "c": 4,\n      "d": 3\n    }\n  ]\n}\n',
    )
    expect(stableStringify({ a: 1, Z: 2, 'ä': 3 })).toBe(
      '{\n  "Z": 2,\n  "a": 1,\n  "ä": 3\n}\n',
    )
  })

  it('computes a deterministic SHA-256 checksum', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('writeJson creates parent directories and returns the written checksum', async () => {
    const root = await makeTemporaryDirectory()
    const path = join(root, 'nested', 'catalog.json')
    const value = { b: 1, a: { d: 4, c: 3 } }

    const checksum = await writeJson(path, value)
    const content = await readFile(path, 'utf8')

    expect(content).toBe(stableStringify(value))
    expect(checksum).toBe(sha256(content))
  })

  it('writes bundle files and checksums in filename order without self-checksum', async () => {
    const root = await makeTemporaryDirectory()
    const checksums = await writeBundleFiles(root, {
      'zeta.json': { z: 1, a: 2 },
      'alpha.json': [{ second: 2, first: 1 }],
    })

    expect(Object.keys(checksums)).toEqual(['alpha.json', 'zeta.json'])
    expect(JSON.parse(await readFile(join(root, 'checksums.json'), 'utf8'))).toEqual(
      checksums,
    )
    expect(checksums).not.toHaveProperty('checksums.json')
    expect(checksums['alpha.json']).toBe(
      sha256(await readFile(join(root, 'alpha.json'), 'utf8')),
    )
  })

  it('orders bundle filenames by code unit', async () => {
    const root = await makeTemporaryDirectory()

    const checksums = await writeBundleFiles(root, {
      'ä.json': 3,
      'a.json': 2,
      'Z.json': 1,
    })

    expect(Object.keys(checksums)).toEqual(['Z.json', 'a.json', 'ä.json'])
  })
})
