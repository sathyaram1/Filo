// Riconosce fra i file del repo, che è pubblico, una copia di dati del server: documenti Firestore o feedback già in chiaro.
// Non legge il server e non sposta niente: dice quali file sono copie e perché. Le copie di lavoro stanno in os.tmpdir().
// Sentinella: tests/unit/copieDiDatiFuoriDalRepo.test.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Dati finti per le prove: l'unico posto del repo dove una copia è ammessa.
export const CARTELLA_FINTI = 'tests/fixtures/';

const VALORI_FIRESTORE = new Set([
  'stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue', 'mapValue',
  'arrayValue', 'nullValue', 'referenceValue', 'geoPointValue', 'bytesValue',
]);
// Chi ha scritto: da soli, o accanto al testo, rendono riconoscibile una persona.
const IDENTITA = ['clientId', 'clientIdHash', 'userAgent', 'walletPseudonym'];

const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const valoreFirestore = (v) => oggetto(v) && Object.keys(v).length === 1 && VALORI_FIRESTORE.has(Object.keys(v)[0]);
const percorsoFirestore = (s) => /\/databases\/[^/]+\/documents\//.test(s);

function motivoDiUnNodo(o, chiave) {
  if (oggetto(o.fields)) {
    const campi = Object.values(o.fields);
    if (typeof o.name === 'string' && (percorsoFirestore(o.name) || chiave === 'documents')) return 'documento Firestore (name + fields)';
    if (campi.length && campi.some(valoreFirestore)) return 'campi nel formato di Firestore (stringValue, integerValue…)';
  }
  const presenti = IDENTITA.filter((k) => typeof o[k] === 'string');
  if (presenti.length && presenti.length + (typeof o.text === 'string' ? 1 : 0) >= 2) {
    return `campi di un feedback in chiaro (${[...(typeof o.text === 'string' ? ['text'] : []), ...presenti].join(', ')})`;
  }
  return '';
}

/** Il motivo per cui un valore JSON è una copia di dati del server, o ''. Scende in tutto l'albero. */
export function motivoCopia(radice) {
  const pila = [[radice, '']];
  while (pila.length) {
    const [v, chiave] = pila.pop();
    if (Array.isArray(v)) {
      for (const x of v) pila.push([x, chiave]);
    } else if (oggetto(v)) {
      const m = motivoDiUnNodo(v, chiave);
      if (m) return m;
      for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') pila.push([x, k]);
    }
  }
  return '';
}

/** Come motivoCopia, sul testo di un file: JSON intero, o una riga JSON per documento. Un testo che non è JSON → ''. */
export function motivoCopiaTesto(testo) {
  const t = String(testo || '').replace(/^﻿/, '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return '';
  try { return motivoCopia(JSON.parse(t)); } catch (_) { /* può essere una riga per documento */ }
  for (const riga of t.split(/\r?\n/)) {
    const r = riga.trim();
    if (!r.startsWith('{') && !r.startsWith('[')) continue;
    try {
      const m = motivoCopia(JSON.parse(r));
      if (m) return m;
    } catch (_) { /* riga non JSON: non dice niente */ }
  }
  return '';
}

// Il primo carattere visibile, letto sui byte: immagini e caratteri non si decodificano per niente.
function sembraJson(byte) {
  let i = byte[0] === 0xEF && byte[1] === 0xBB && byte[2] === 0xBF ? 3 : 0;
  while (i < byte.length && (byte[i] === 0x20 || byte[i] === 0x09 || byte[i] === 0x0A || byte[i] === 0x0D)) i++;
  return byte[i] === 0x7B || byte[i] === 0x5B;
}

/** I file tracciati da git in `root` che sono copie di dati del server, fuori dalla cartella dei dati finti. */
export function copieNelRepo(root) {
  const file = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  const trovate = [];
  for (const f of file) {
    if (f.startsWith(CARTELLA_FINTI)) continue;
    let byte;
    try { byte = readFileSync(join(root, f)); } catch (_) { continue; }
    if (!sembraJson(byte)) continue;
    const motivo = motivoCopiaTesto(byte.toString('utf8'));
    if (motivo) trovate.push({ file: f, motivo });
  }
  return trovate;
}
