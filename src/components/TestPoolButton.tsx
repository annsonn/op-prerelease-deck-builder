import type { TestPoolMode } from '../test-pool/generate-test-pool.js'

interface TestPoolButtonProps {
  onGenerate: (mode: TestPoolMode) => void
}

export function TestPoolButton({ onGenerate }: TestPoolButtonProps) {
  return (
    <aside className="test-pool-tool" aria-labelledby="test-pool-heading">
      <div>
        <p id="test-pool-heading" className="test-pool-title">
          Testing utility
        </p>
        <p>Generating a test pool replaces the cards currently entered.</p>
      </div>
      <div className="test-pool-actions">
        <button
          type="button"
          className="test-pool-button"
          onClick={() => onGenerate('tournament')}
        >
          Generate 72-card tournament pool
        </button>
        <button
          type="button"
          className="test-pool-button test-pool-button--secondary"
          onClick={() => onGenerate('development')}
        >
          Generate 60-card development pool
        </button>
      </div>
    </aside>
  )
}
