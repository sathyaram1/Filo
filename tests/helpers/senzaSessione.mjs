// Toglie a questo processo di prova l'identità della sessione che lo lancia, come fa già il lanciatore degli unit:
// vale per chi corre il file da solo con `node --test` (#1109.1). Va importato per primo; l'elenco sta nel lanciatore.
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';

for (const k of IDENTITA_SESSIONE) delete process.env[k];
