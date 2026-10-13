// L'ambiente di un figlio che un test lancia sugli strumenti delle routine: senza la sessione che corre i test, come
// sotto il lanciatore, e senza un transcript da misurare. Sentinella: tests/unit/proveDaDentroUnaSessione.test.mjs.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ambientePerITest } from '../../scripts/run-unit-tests.mjs';

// Togliere l'identità non basta: il biglietto nella cartella di una routine fa cercare il transcript più recente.
export const NESSUN_TRANSCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'transcript-che-non-esiste.jsonl');

/** `extra` vince: chi vuole una sessione nel suo test la mette lì. */
export function senzaSessione(extra = {}, base = process.env) {
  return { ...ambientePerITest(base), FILO_TRANSCRIPT: NESSUN_TRANSCRIPT, ...extra };
}
