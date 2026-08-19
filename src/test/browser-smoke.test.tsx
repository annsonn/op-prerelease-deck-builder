import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('browser test environment', () => {
  it('provides the DOM and jest-dom matchers', () => {
    render(<main>First browser render</main>)

    expect(document).toBeDefined()
    expect(screen.getByRole('main')).toHaveTextContent('First browser render')
  })

  it('starts each test with a clean document', () => {
    expect(screen.queryByText('First browser render')).not.toBeInTheDocument()

    render(<main>Second browser render</main>)

    expect(screen.getByRole('main')).toHaveTextContent('Second browser render')
  })
})
