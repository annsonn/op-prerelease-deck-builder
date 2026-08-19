import { reportFailure, runCatalogCommand } from './cli.js'

void runCatalogCommand('import').catch(reportFailure)
