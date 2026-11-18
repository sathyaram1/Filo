// La config git di ogni copia di lavoro che nasce (clone di un worker, ramo preparato, orchestratore locale, sessione):
// un passo solo, così una strada nuova non ne prende metà (#2224). Best-effort, non lancia mai.
// Sentinella: tests/unit/driverNovita.test.mjs (nessun altro chiama i due pezzi).

import { ensureCommentChar } from './carattere-commento.mjs';
import { ensureDriverNovita } from './driver-novita.mjs';

export function preparaCopia(root) {
  const commento = ensureCommentChar(root);
  const novita = ensureDriverNovita(root);
  return { ok: commento.ok && novita.ok, commento, novita };
}
