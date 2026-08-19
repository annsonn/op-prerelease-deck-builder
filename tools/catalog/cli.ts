import * as configModule from './config.js'
import type { BuildStage } from './model.js'
import * as pipelineModule from './pipeline.js'

export async function runCatalogCommand(
  stage: BuildStage,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const setId = argv[0]?.toLowerCase()

  if (setId === undefined) {
    throw new Error(`Usage: npm run catalog:${stage} -- <set-id>`)
  }

  const config = configModule.loadSetConfig(setId)
  const result = await pipelineModule.buildCatalog({ setId, config })

  process.stdout.write(
    `Catalog ${stage} complete\n` +
      `Source records: ${result.variantCount}\n` +
      `Playable identities: ${result.cardCount}\n` +
      `Special reprints: ${result.specialReprintCount}\n` +
      `Readiness: ${result.readiness}\n` +
      `Output: ${result.output}\n`,
  )
}

export function reportFailure(failure: unknown): void {
  const lines = [failure instanceof Error ? failure.message : String(failure)]
  const seen = new Set<unknown>([failure])
  let cause = failure instanceof Error ? failure.cause : undefined

  for (let depth = 0; cause !== undefined && depth < 3; depth += 1) {
    if (seen.has(cause)) {
      break
    }
    seen.add(cause)

    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    const singleLineMessage = causeMessage.replace(/\s+/g, ' ').trim()
    const conciseMessage =
      singleLineMessage.length > 500
        ? `${singleLineMessage.slice(0, 499)}…`
        : singleLineMessage
    lines.push(`Caused by: ${conciseMessage}`)
    cause = cause instanceof Error ? cause.cause : undefined
  }

  process.stderr.write(`${lines.join('\n')}\n`)
  process.exitCode = 1
}
