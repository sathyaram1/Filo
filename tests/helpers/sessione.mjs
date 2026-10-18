// L'ambiente di un processo figlio senza la sessione che lancia i test: in una routine il figlio che parla col canale
// ne misurerebbe il consumo e lo metterebbe nei corpi confrontati, anche col file lanciato da solo (#949.1, #813.7).
// Sentinella: tests/unit/proveSenzaSessione.test.mjs.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';

// Un transcript dichiarato che non c'è vince sul ripiego del più recente, che il biglietto nella cartella accende anche
// senza FILO_ROUTINE.
export const NESSUN_TRANSCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'transcript-che-non-esiste.jsonl');

export function senzaSessione(env = process.env) {
  const out = { ...env };
  for (const k of IDENTITA_SESSIONE) delete out[k];
  out.FILO_TRANSCRIPT = NESSUN_TRANSCRIPT;
  return out;
}
