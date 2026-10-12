// Riconosce fra i file del repo, che è pubblico, una copia di dati del server: documenti Firestore o feedback già in chiaro.
// Non legge il server e non sposta niente: dice quali file sono copie e perché. Le copie di lavoro stanno in os.tmpdir().
// Sentinella: tests/unit/copieDiDatiFuoriDalRepo.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

// Il motivo per cui il file `f` di `root` è una copia, o '': fuori dai dati finti, solo se comincia come un JSON.
function motivoFile(root, f) {
  if (f.startsWith(CARTELLA_FINTI)) return '';
  let byte;
  try { byte = readFileSync(join(root, f)); } catch (_) { return ''; }
  return sembraJson(byte) ? motivoCopiaTesto(byte.toString('utf8')) : '';
}

function copieFra(root, file) {
  const trovate = [];
  for (const f of file) {
    const motivo = motivoFile(root, f);
    if (motivo) trovate.push({ file: f, motivo });
  }
  return trovate;
}

const elencoGit = (root, args) => execFileSync('git', [...args, '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

/** I file tracciati da git in `root` che sono copie di dati del server, fuori dalla cartella dei dati finti. */
export function copieNelRepo(root) {
  return copieFra(root, elencoGit(root, ['ls-files']));
}

/** Come copieNelRepo, sui soli file messi in scena (aggiunti o cambiati): il salvataggio li toglie prima del commit. */
export function copieInScena(root) {
  return copieFra(root, elencoGit(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
}

const gitTesto = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Le copie nei commit che spedire `rif` porterebbe su origin (quelli che nessun ramo di origin conosce),
 * dal commit più vecchio: [{ commit, file, motivo }]. Ogni strada che spedisce lo chiede prima del push.
 */
export function copieDaSpedire(root, rif = 'HEAD') {
  const commit = gitTesto(root, ['rev-list', '--reverse', rif, '--not', '--remotes=origin']).split('\n').filter(Boolean);
  const trovate = [];
  const lette = new Map();
  for (const c of commit) {
    const voci = gitTesto(root, ['diff-tree', '-r', '--root', '--no-commit-id', '--raw', '-z', '--diff-filter=ACMR', c]).split('\0');
    for (let i = 0; i < voci.length - 1;) {
      const meta = voci[i].split(' ');
      const rinomina = /^[RC]/.test(meta[4] || '');
      const file = voci[i + (rinomina ? 2 : 1)];
      i += rinomina ? 3 : 2;
      if (!file || file.startsWith(CARTELLA_FINTI)) continue;
      const blob = meta[3];
      if (!lette.has(blob)) {
        const byte = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        lette.set(blob, sembraJson(byte) ? motivoCopiaTesto(byte.toString('utf8')) : '');
      }
      if (lette.get(blob)) trovate.push({ commit: c, file, motivo: lette.get(blob) });
    }
  }
  return trovate;
}

const citaShell = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Cosa dire a chi spedisce quando copieDaSpedire ha trovato qualcosa: il ramo non parte, e come toglierle dalla storia. */
export function avvisoSpedizione(copie) {
  const file = [...new Set(copie.map((c) => c.file))];
  const primo = copie[0].commit.slice(0, 10);
  return `NON spedisco il ramo: ${file.join(', ')} (dal commit ${primo}) ha la forma di una copia dei dati del server `
    + `(${copie[0].motivo}), e il repo e' pubblico: una volta spedita resta nella storia anche se tolta dopo. `
    + `Toglila dalla storia del ramo e sposta la copia nella cartella temporanea del sistema (os.tmpdir()): `
    + `git reset --soft ${primo}~1 && git rm -q --cached --ignore-unmatch -- ${file.map(citaShell).join(' ')} && git commit -m "lavoro senza la copia dei dati" `
    + `(rifa' in un commit solo i commit da li' in poi, il lavoro resta). Poi il salvataggio spedisce.`;
}

// Un nome in .gitignore: le / restano, i caratteri speciali e gli spazi in coda si citano.
const comeEsclusione = (f) => `/${f.replace(/[\\*?[]/g, '\\$&').replace(/ $/, '\\ ')}`;

/**
 * Toglie dalla vista di git, in questa copia soltanto (info/exclude, non versionato), le copie lasciate nella
 * cartella: senza, «git add -A» — che la consegna chiede davanti a una cartella sporca — le rimetteva nel commit.
 */
export function escludiInLocale(root, file) {
  const dove = resolve(root, gitTesto(root, ['rev-parse', '--git-path', 'info/exclude']).trim());
  let attuale = '';
  try { attuale = readFileSync(dove, 'utf8'); } catch (_) { mkdirSync(dirname(dove), { recursive: true }); }
  const righe = new Set(attuale.split(/\r?\n/));
  const nuove = file.filter((f) => !/[\r\n]/.test(f)).map(comeEsclusione).filter((r) => !righe.has(r));
  if (!nuove.length) return;
  appendFileSync(dove, `${attuale && !attuale.endsWith('\n') ? '\n' : ''}${nuove.join('\n')}\n`);
}
