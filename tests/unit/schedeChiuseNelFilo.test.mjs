// #872.4 — la Cronologia e «Tab archiviate» non ci sono più: le schede chiuse stanno nel filo della home. Nessun testo
// che legge l'utente (o il modello, che lo ripete) rimanda lì. Restano fuori i commenti, le note delle versioni uscite e
// il file generato dalla trasparenza (si controlla la sua sorgente).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUORI = new Set(['src/shared/patchNotes.js', 'src/shared/transparency.js']);
const VECCHI_POSTI = [
  /Tab archiviate/,
  /\b(in|nella|dalla|da|alla) Cronologia\b(?! AI| appunti)/,
  /\b(salvat[ae]|restano|resta|ritrovabil\w*|riapribil\w*) (in|nella|dalla) cronologia\b/i,
];

function file(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) file(p, out);
    else if (/\.(js|html|md)$/.test(n)) out.push(p);
  }
  return out;
}

test('nessun testo manda a cercare le schede chiuse in una pagina che non c’è più', () => {
  const trovati = [];
  for (const p of [...file(join(root, 'src')), ...file(join(root, 'transparency'))]) {
    const rel = relative(root, p).split('\\').join('/');
    if (FUORI.has(rel)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*(\/\/|\/?\*|<!--)/.test(riga)) return;
      if (VECCHI_POSTI.some((re) => re.test(riga))) trovati.push(`${rel}:${i + 1}: ${riga.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(trovati, []);
});
