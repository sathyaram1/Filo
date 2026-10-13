// L'ambiente dei processi che un test lancia: senza la sessione che lancia i test, anche con `node --test` a mano dentro
// una routine, dove il lanciatore non c'è a ripulire (#949.1, #1141.1). L'elenco dell'identità lo tiene il lanciatore.
// Chi vuole una sessione in un figlio la dichiara lui, sopra questo ambiente. Sentinella: tests/unit/sessioneIsolata.test.mjs.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ambientePerITest } from '../../scripts/run-unit-tests.mjs';

// Dichiarato e assente vince sul ripiego del transcript più recente, che il biglietto in cartella accende anche senza FILO_ROUTINE.
export const NESSUN_TRANSCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'transcript-che-non-esiste.jsonl');

export function ambienteSenzaSessione(base = process.env) {
  return { ...ambientePerITest(base), FILO_TRANSCRIPT: NESSUN_TRANSCRIPT };
}
