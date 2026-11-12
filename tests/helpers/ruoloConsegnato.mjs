// Il testo del ruolo come lo riceve chi lavora: nella stampa di dispatch o, se lì non sta, intero nel file che la
// stampa cita. Dove finisce dipende dalla taglia del ruolo e dal percorso degli strumenti: una prova non lo presume.
import { readFileSync } from 'node:fs';

export function ruoloConsegnato(stampa) {
  const file = stampa && stampa.istruzioniFile;
  if (!file) return String((stampa && stampa.instructions) || '');
  if (!String(stampa.instructions || '').includes(file)) throw new Error(`la stampa non dice dove sta il ruolo (${file})`);
  return readFileSync(file, 'utf8');
}
