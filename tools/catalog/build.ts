import { reportFailure, runCatalogCommand } from './cli.js'

void runCatalogCommand('build').catch(reportFailure)
