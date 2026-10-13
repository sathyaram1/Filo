// Toglie a questo processo di prova l'identità della sessione che lo lancia, come fa già il lanciatore degli unit:
// vale per chi corre il file da solo con `node --test` (#1109.1). Va importato per primo; l'elenco sta nel lanciatore.
// Ai figli dà ambienteSenzaSessione (#1141.1). Sentinelle: proveSenzaSessione.test.mjs, sessioneIsolata.test.mjs.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITA_SESSIONE, ambientePerITest } from '../../scripts/run-unit-tests.mjs';

for (const k of IDENTITA_SESSIONE) delete process.env[k];

// Dichiarato e assente vince sul ripiego del transcript più recente, che il biglietto in cartella accende anche senza FILO_ROUTINE.
export const NESSUN_TRANSCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'transcript-che-non-esiste.jsonl');

/** L'ambiente di un figlio lanciato da una prova: chi vuole una sessione nel figlio la dichiara lui, sopra questo. */
export function ambienteSenzaSessione(base = process.env) {
  return { ...ambientePerITest(base), FILO_TRANSCRIPT: NESSUN_TRANSCRIPT };
}
