// Toglie a questo processo di prova la sessione che lo lancia, come fa già il lanciatore degli unit: vale per chi corre
// il file da solo con `node --test` (#1109.1). Va importato per primo; l'elenco sta nel lanciatore.
// Sentinella: tests/unit/proveSenzaSessione.test.mjs.
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';
import { cartellaTemporanea } from './percorsi.mjs';

for (const k of IDENTITA_SESSIONE) delete process.env[k];
// Col biglietto in cartella il ripiego prende il transcript più recente nella cartella di Claude: come nel lanciatore,
// i test ne hanno una loro, vuota (#592.18).
process.env.CLAUDE_CONFIG_DIR = cartellaTemporanea('claude-dei-test-');
