import { convert } from 'html-to-text'

import type { SourceCard } from '../model.js'
import { parseOfficialText } from '../parse-official-text.js'
import type { CatalogSourceAdapter } from '../source-adapter.js'

export class OfficialHtmlAdapter implements CatalogSourceAdapter {
  constructor(
    private readonly url: string,
    private readonly targetSet: string,
  ) {}

  async load(): Promise<SourceCard[]> {
    const response = await fetch(this.url, {
      headers: {
        'user-agent': 'sealed-deck-builder/0.1 personal-use',
      },
    })

    if (!response.ok) {
      throw new Error(
        `Official catalog request failed: ${response.status} ${response.statusText}`,
      )
    }

    const text = convert(await response.text(), {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
      ],
    })

    return parseOfficialText(text, this.targetSet)
  }
}
