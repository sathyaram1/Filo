// Il classificatore dei comandi sta in più file (#2493): chi ne legge il sorgente lo legge intero da qui.
// L'elenco delle parti lo dà cmdClassify.js, che le carica: nessuna copia a mano.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
const ENTRATA = join(SHARED, 'cmdClassify.js');

export function partiDelClassificatore() {
  const m = /const PARTI = \[([^\]]*)\]/.exec(readFileSync(ENTRATA, 'utf8'));
  if (!m) throw new Error('cmdClassify.js non dichiara più le sue parti in `const PARTI = [...]`');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// I percorsi di tutti i file del classificatore, nell'ordine di caricamento: le parti, poi l'entrata.
export function fileDelClassificatore() {
  return partiDelClassificatore().map((p) => join(SHARED, `${p}.js`)).concat(ENTRATA);
}

export function sorgenteDelClassificatore() {
  return fileDelClassificatore().map((f) => readFileSync(f, 'utf8')).join('\n');
}
