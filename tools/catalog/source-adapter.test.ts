import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalJsonAdapter } from './adapters/local-json.js'
import { OfficialHtmlAdapter } from './adapters/official-html.js'
import { parseOfficialText } from './parse-official-text.js'

const officialFixtureUrl = new URL('./__fixtures__/official-page.txt', import.meta.url)
const localFixturePath = fileURLToPath(
  new URL('./__fixtures__/op17-input.json', import.meta.url),
)

describe('parseOfficialText', () => {
  it('parses visible official card records without collapsing variants', async () => {
    const fixture = await readFile(officialFixtureUrl, 'utf8')

    const cards = parseOfficialText(fixture, 'op16')

    expect(cards.map((card) => card.cardNumber)).toEqual([
      'OP16-005',
      'OP16-005',
      'EB04-054',
    ])
    expect(cards[0]?.effect).toContain('[Blocker]')
    expect(cards[0]?.setMembership).toEqual(['OP16'])
    expect(cards[2]?.setMembership).toEqual(['OP16'])
  })

  it('rejects a record that does not declare the requested target set', () => {
    const text = `
OP16-005 | UC | CHARACTER
Example Blocker
Card Set(s)
-EXAMPLE TEST SET- [OP-16]
`

    expect(() => parseOfficialText(text, 'op17')).toThrow(
      'OP16-005 does not declare membership in OP17',
    )
  })

  it('rejects content with no recognizable card records', () => {
    expect(() => parseOfficialText('Temporarily unavailable', 'op16')).toThrow(
      'No card records found for OP16',
    )
  })

  it.each(['123abc', '1,000'])(
    'rejects malformed decimal Cost value %s',
    (value) => {
      const text = `
OP16-005 | UC | CHARACTER
Example Blocker
Cost
${value}
Card Set(s)
[OP-16]
`

      expect(() => parseOfficialText(text, 'op16')).toThrow(
        `OP16-005 has invalid Cost value "${value}"`,
      )
    },
  )

  it.each([
    ['OP-16', 'OP16'],
    ['OP16', 'OP16'],
    ['EB-04', 'EB04'],
    ['EB04', 'EB04'],
    ['ST-15', 'ST15'],
    ['ST15', 'ST15'],
  ])('accepts official membership token %s', (token, normalized) => {
    const text = `
OP16-005 | UC | CHARACTER
Example Blocker
Card Set(s)
[${token}]
`

    expect(parseOfficialText(text, normalized).at(0)?.setMembership).toEqual([
      normalized,
    ])
  })

  it('ignores converted link destinations beside valid memberships', () => {
    const text = `
OP16-081 | R | CHARACTER
Test Card
Card Set(s)
[OP-16]
[/news/notice-op16.html]
[javascript:void(0);]
`

    expect(parseOfficialText(text, 'op16').at(0)?.setMembership).toEqual([
      'OP16',
    ])
  })

  it.each(['OP-1-6', '-OP16-', 'O-P-16'])(
    'rejects malformed membership token %s',
    (token) => {
      const text = `
OP16-005 | UC | CHARACTER
Example Blocker
Card Set(s)
[${token}]
`

      expect(() => parseOfficialText(text, 'op16')).toThrow(
        `OP16-005 has invalid Card Set(s) token "${token}"`,
      )
    },
  )
})

describe('LocalJsonAdapter', () => {
  it('loads and validates reviewed local JSON records', async () => {
    const cards = await new LocalJsonAdapter(localFixturePath).load()

    expect(cards).toHaveLength(2)
    expect(cards[0]?.cardNumber).toBe('OP17-005')
  })

  it('reports a missing local catalog input with its path', async () => {
    const path = `${localFixturePath}.missing`

    await expect(new LocalJsonAdapter(path).load()).rejects.toThrow(
      `Local catalog input not found: ${path}`,
    )
  })

  it('wraps invalid local input with path context and preserves the cause', async () => {
    const path = fileURLToPath(officialFixtureUrl)

    try {
      await new LocalJsonAdapter(path).load()
      expect.unreachable('expected invalid local input to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`Local catalog input invalid: ${path}`)
      expect((error as Error).cause).toBeInstanceOf(SyntaxError)
    }
  })
})

describe('OfficialHtmlAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests official HTML with the catalog user agent and parses visible text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        `<html><body>
          <p>OP16-005 | UC | CHARACTER</p>
          <p>Example Blocker</p>
          <p>Cost</p><p>8</p>
          <p>Card Set(s)</p><p>-EXAMPLE TEST SET- [OP-16]</p>
          <script>OP99-999 | UC | CHARACTER</script>
        </body></html>`,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const cards = await new OfficialHtmlAdapter(
      'https://example.test/cards',
      'op16',
    ).load()

    expect(cards.map((card) => card.cardNumber)).toEqual(['OP16-005'])
    expect(fetchMock).toHaveBeenCalledOnce()
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('user-agent')).toBe('sealed-deck-builder/0.1 personal-use')
  })

  it('parses official heading labels after HTML text conversion uppercases them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        new Response(
          `<html><body>
            <h3>TEXT VIEW</h3>
            <h3>OP16-005 | UC | CHARACTER</h3>
            <p>Example Blocker</p>
            <h3>Life</h3><p>-</p>
            <h3>Cost</h3><p>8</p>
            <h3>Card Set(s)</h3><p>-EXAMPLE TEST SET- [OP-16]</p>
            <h3>CARD VIEW</h3>
          </body></html>`,
        ),
      ),
    )

    const cards = await new OfficialHtmlAdapter(
      'https://example.test/cards',
      'op16',
    ).load()

    expect(cards).toHaveLength(1)
    expect(cards[0]?.cost).toBe(8)
    expect(cards[0]?.life).toBeNull()
  })

  it('reports unsuccessful official catalog responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        new Response('', { status: 503, statusText: 'Service Unavailable' }),
      ),
    )

    await expect(
      new OfficialHtmlAdapter('https://example.test/cards', 'op16').load(),
    ).rejects.toThrow(
      'Official catalog request failed: 503 Service Unavailable',
    )
  })
})
