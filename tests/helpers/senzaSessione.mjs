// Toglie a questo processo di prova la sessione che lo lancia, come fa già il lanciatore degli unit: vale per chi corre
// il file da solo con `node --test` (#1109.1). Va importato per primo; elenco e cartelle stanno nel lanciatore.
// Sentinella: tests/unit/proveSenzaSessione.test.mjs.
import { IDENTITA_SESSIONE, cartelleDeiTest } from '../../scripts/run-unit-tests.mjs';
import { cartellaTemporanea } from './percorsi.mjs';

for (const k of IDENTITA_SESSIONE) delete process.env[k];
Object.assign(process.env, cartelleDeiTest(cartellaTemporanea('sessione-dei-test-')));
