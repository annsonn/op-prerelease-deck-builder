import { reportFailure, runCatalogCommand } from './cli.js'

void runCatalogCommand('validate').catch(reportFailure)
