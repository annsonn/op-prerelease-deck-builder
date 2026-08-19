import { reportFailure, runCatalogCommand } from './cli.js'

void runCatalogCommand('derive').catch(reportFailure)
