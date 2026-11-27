// La mappa prova → file (#2502): dalle registrazioni della suite (src/main/copertura.js, scripts/lib/copertura-prove.mjs)
// alla tabella pubblicata, e dalla tabella e da un diff agli spec da lanciare, dal più specifico al più largo. PURO:
// i file li legge chi chiama. Regole: tests/unit/mappaProve.test.mjs.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { SOGLIA_SPEC_DI_UN_MODULO } from './spec-che-usano.mjs';

// Si chiede solo a chi costruisce la mappa: finish:check e le sue prove girano anche da copie degli script senza src/.
const percorsoFilo = (host, rel) => createRequire(import.meta.url)('../../src/main/percorsoFilo.js').percorsoFilo(host, rel);

export const VERSIONE_MAPPA = 1;
export const SEGNO_RIGA = '[mappa-prove]';
const PEZZO = 8000;

/** Il file del repo (a barre normali, sotto src/) di un indirizzo di script, o null. `root` è il repo assoluto. */
export function percorsoDaIndirizzo(indirizzo, root) {
  const u = String(indirizzo || '');
  let rel = null;
  if (u.startsWith('filo://')) {
    let url;
    try { url = new URL(u); } catch (_) { return null; }
    let dentro;
    try { dentro = decodeURIComponent(url.pathname.replace(/^\/+/, '')); } catch (_) { return null; }
    rel = percorsoFilo(url.hostname, dentro);
  } else {
    let assoluto = u;
    if (u.startsWith('file://')) { try { assoluto = fileURLToPath(u); } catch (_) { return null; } }
    const r = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const a = assoluto.replace(/\\/g, '/');
    if (!r || !a.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return null;
    rel = a.slice(r.length + 1);
  }
  rel = rel.replace(/\\/g, '/');
  if (rel.split('/').includes('..')) return null;
  return rel.startsWith('src/') ? rel : null;
}

/**
 * Le registrazioni di una parte della suite, una per prova: i lanci della stessa prova (un'app per caso, main e
 * pagine) diventano un record solo, con gli indirizzi già portati ai file del repo. Restano offset: le righe le fa
 * costruisciMappa, coi sorgenti del commit provato.
 */
export function unisciRegistrazioni(registrazioni, root) {
  const perProva = new Map();
  for (const reg of registrazioni || []) {
    const prova = String(reg?.prova || '');
    let file = perProva.get(prova);
    if (!file) perProva.set(prova, (file = new Map()));
    const metti = (rel, intervalli) => {
      let set = file.get(rel);
      if (!set) file.set(rel, (set = new Set()));
      for (const [da, a] of intervalli || []) set.add(`${da}:${a}`);
    };
    for (const [u, iv] of Object.entries(reg?.indirizzi || {})) {
      const rel = percorsoDaIndirizzo(u, root);
      if (rel) metti(rel, iv);
    }
  }
  return [...perProva].map(([prova, file]) => ({
    prova,
    file: Object.fromEntries([...file].map(([rel, set]) => [rel, [...set].map((k) => k.split(':').map(Number))])),
  }));
}

/** Gli inizi di riga di un testo, per passare da un offset alla riga (da 1). */
export function iniziDiRiga(testo) {
  const out = [0];
  const t = String(testo || '');
  for (let i = 0; i < t.length; i += 1) if (t.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

export function rigaDi(inizi, offset) {
  let lo = 0;
  let hi = inizi.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inizi[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** I millisecondi di ogni spec (tests/<nome>.spec.mjs) dal JSON di Playwright: l'ultimo tentativo di ogni caso. */
export function durateDaRapporto(rapporto) {
  const out = new Map();
  const giro = (suite, file) => {
    const f = suite.file || file;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const r = (t.results || [])[Math.max(0, (t.results || []).length - 1)];
        if (!r || !f) continue;
        const chiave = `tests/${String(f).replace(/\\/g, '/').replace(/^tests\//, '')}`;
        out.set(chiave, (out.get(chiave) || 0) + (Number(r.duration) || 0));
      }
    }
    for (const s of suite.suites || []) giro(s, f);
  };
  for (const s of rapporto?.suites || []) giro(s, s.file);
  return out;
}

/**
 * La tabella da registrazioni [{ prova, processo, file?: {rel: [[da,a]…]}, indirizzi?: {url: [[da,a]…]} }]
 * (`file` è la forma di `unisciRegistrazioni`, `indirizzi` quella dei processi). Un indirizzo senza intervalli è un
 * file servito alla pagina (un foglio di stile, un HTML): lo carica chi l'ha chiesto. `sorgente(rel)` dà il testo del
 * file al commit provato (null se non c'è). Le funzioni passano da offset a righe; gli insiemi di spec uguali si
 * scrivono una volta. Le registrazioni senza prova si contano e basta.
 */
export function costruisciMappa({ registrazioni, sorgente, root, durate = new Map(), commit = '', corsa = '' }) {
  const prove = [];
  const indiceProva = new Map();
  const perFile = new Map();
  const caricati = new Map();
  const inizi = new Map();
  let senzaProva = 0;
  const idProva = (p) => {
    if (!indiceProva.has(p)) { indiceProva.set(p, prove.length); prove.push(p); }
    return indiceProva.get(p);
  };
  const aggiungi = (rel, intervalli, p) => {
    if (!inizi.has(rel)) { const t = sorgente(rel); inizi.set(rel, t == null ? null : iniziDiRiga(t)); }
    const righe = inizi.get(rel);
    if (!righe) return;
    let funzioni = perFile.get(rel);
    if (!funzioni) perFile.set(rel, (funzioni = new Map()));
    let chiCarica = caricati.get(rel);
    if (!chiCarica) caricati.set(rel, (chiCarica = new Set()));
    chiCarica.add(p);
    for (const [da, a] of intervalli || []) {
      const chiave = `${rigaDi(righe, da)}:${rigaDi(righe, Math.max(da, a - 1))}`;
      let chi = funzioni.get(chiave);
      if (!chi) funzioni.set(chiave, (chi = new Set()));
      chi.add(p);
    }
  };
  for (const reg of registrazioni || []) {
    const nome = String(reg?.prova || '').replace(/\\/g, '/');
    if (!/^tests\/.+\.spec\.(?:m?js)$/.test(nome)) { senzaProva += 1; continue; }
    const p = idProva(nome);
    for (const [rel, iv] of Object.entries(reg.file || {})) if (rel.startsWith('src/')) aggiungi(rel, iv, p);
    for (const [u, iv] of Object.entries(reg.indirizzi || {})) {
      const rel = percorsoDaIndirizzo(u, root);
      if (rel) aggiungi(rel, iv, p);
    }
  }
  const insiemi = [];
  const indiceInsieme = new Map();
  const idInsieme = (set) => {
    const elenco = [...set].sort((a, b) => a - b);
    const k = elenco.join(',');
    if (!indiceInsieme.has(k)) { indiceInsieme.set(k, insiemi.length); insiemi.push(elenco); }
    return indiceInsieme.get(k);
  };
  const file = {};
  for (const rel of [...perFile.keys()].sort()) {
    const tutte = caricati.get(rel);
    const funzioni = [];
    for (const [k, chi] of perFile.get(rel)) {
      const [da, a] = k.split(':').map(Number);
      funzioni.push([da, a, idInsieme(chi)]);
    }
    funzioni.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    file[rel] = { carico: idInsieme(tutte), funzioni };
  }
  return {
    versione: VERSIONE_MAPPA,
    commit,
    corsa,
    prove: prove.map((spec) => ({ spec, ms: Math.round(durate.get(spec) || 0) })),
    insiemi,
    file,
    senzaProva,
  };
}

/** La tabella come righe di registro: gzip, base64, a pezzi numerati. */
export function righeDellaMappa(mappa) {
  const b = gzipSync(Buffer.from(JSON.stringify(mappa))).toString('base64');
  const n = Math.max(1, Math.ceil(b.length / PEZZO));
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(`${SEGNO_RIGA} ${i + 1}/${n} ${b.slice(i * PEZZO, (i + 1) * PEZZO)}`);
  return out;
}

/** Dal registro (anche coi tempi di GitHub davanti) alla tabella, o un errore che dice cosa manca. */
export function mappaDaRegistro(testo) {
  const pezzi = new Map();
  let totale = 0;
  for (const riga of String(testo || '').split('\n')) {
    const i = riga.indexOf(SEGNO_RIGA);
    if (i < 0) continue;
    const m = riga.slice(i + SEGNO_RIGA.length).trim().match(/^(\d+)\/(\d+) (\S+)$/);
    if (!m) continue;
    totale = Number(m[2]);
    pezzi.set(Number(m[1]), m[3]);
  }
  if (!totale) return { errore: 'nel registro non c\'è nessuna riga della mappa' };
  for (let i = 1; i <= totale; i += 1) if (!pezzi.has(i)) return { errore: `manca il pezzo ${i} di ${totale}` };
  let mappa;
  try {
    mappa = JSON.parse(gunzipSync(Buffer.from([...Array(totale)].map((_, i) => pezzi.get(i + 1)).join(''), 'base64')).toString('utf8'));
  } catch (e) { return { errore: `la mappa non si legge: ${e.message}` }; }
  if (mappa?.versione !== VERSIONE_MAPPA) return { errore: `mappa di versione ${mappa?.versione}, questo strumento legge la ${VERSIONE_MAPPA}` };
  return { mappa };
}

/**
 * I blocchi di un `git diff -U0`: per file (percorso di prima) le righe toccate, nella numerazione di prima.
 * Un'aggiunta pura tocca le due righe fra cui cade. File nuovi in `nuovi`, tolti in `tolti`.
 */
export function blocchiDelDiff(testo) {
  const file = new Map();
  const nuovi = new Set();
  const tolti = new Set();
  let prima = null;
  let dopo = null;
  for (const riga of String(testo || '').split('\n')) {
    if (riga.startsWith('diff --git ')) { prima = null; dopo = null; continue; }
    if (riga.startsWith('--- ')) { prima = riga === '--- /dev/null' ? null : riga.slice(4).replace(/^a\//, '').replace(/\t.*$/, ''); continue; }
    if (riga.startsWith('+++ ')) {
      dopo = riga === '+++ /dev/null' ? null : riga.slice(4).replace(/^b\//, '').replace(/\t.*$/, '');
      if (!prima && dopo) nuovi.add(dopo);
      if (prima && !dopo) tolti.add(prima);
      if (prima && !file.has(prima)) file.set(prima, []);
      continue;
    }
    const m = riga.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m && prima) {
      const da = Number(m[1]);
      const n = m[2] === undefined ? 1 : Number(m[2]);
      file.get(prima).push({ da, n, nuovoDa: Number(m[3]), nuovoN: m[4] === undefined ? 1 : Number(m[4]) });
    }
  }
  return { file, nuovi: [...nuovi], tolti: [...tolti] };
}

/** Le righe (numerazione di prima) che un blocco tocca. */
export function righeDelBlocco(b) {
  if (b.n > 0) return [...Array(b.n)].map((_, i) => b.da + i);
  return [b.da, b.da + 1].filter((r) => r >= 1);
}

/**
 * Riporta la riga `r` di un file nella numerazione di prima di `blocchi` (il diff dal commit della mappa al file di
 * adesso): una riga dentro un cambio va al suo inizio, una dopo si sposta di quanto il diff ha aggiunto o tolto.
 */
export function rigaSullaMappa(r, blocchi) {
  let scarto = 0;
  for (const b of blocchi || []) {
    const fine = b.nuovoDa + Math.max(b.nuovoN, 1) - 1;
    if (b.nuovoN === 0 ? r <= b.nuovoDa : r < b.nuovoDa) break;
    if (b.nuovoN > 0 && r <= fine) return b.da + Math.min(r - b.nuovoDa, Math.max(b.n - 1, 0));
    // Un lato vuoto conta dalla riga dopo quella che git nomina.
    scarto = (b.da + b.n + (b.n === 0 ? 1 : 0)) - (b.nuovoDa + b.nuovoN + (b.nuovoN === 0 ? 1 : 0));
  }
  return r + scarto;
}

/**
 * Gli spec che passano dalle righe cambiate. `cambi`: Map file → righe nella numerazione della mappa, o null per il
 * file intero. Ogni riga prende la funzione più stretta che la contiene fra quelle eseguite: `funzione` se è una
 * funzione vera eseguita da non più di `soglia` spec, `larga` se la eseguono quasi tutti (come un modulo che oltre
 * quella soglia di spec usano: è la suite intera), `file` se è solo il caricamento del modulo. Ordine: per livello,
 * poi quanto il legame è stretto (insiemi piccoli pesano di più), poi i più brevi. `senzaProve`: i file che nessuna
 * prova carica. Con `sorgente(rel)` (il testo al commit della mappa) una riga fuori dalle funzioni vale anche per le
 * righe che usano i nomi che dichiara (righeDeiNomi).
 */
export function proveDelCambio(mappa, cambi, { soglia = SOGLIA_SPEC_DI_UN_MODULO, sorgente = null } = {}) {
  const punti = new Map();
  const senzaProve = [];
  const dai = (insieme, livello, rel) => {
    const chi = mappa.insiemi[insieme] || [];
    for (const p of chi) {
      const v = punti.get(p) || { livello: 'file', peso: 0, file: new Set() };
      if (ORDINE[livello] < ORDINE[v.livello]) v.livello = livello;
      v.peso += 1 / Math.max(1, chi.length);
      v.file.add(rel);
      punti.set(p, v);
    }
  };
  for (const [rel, righe] of cambi) {
    const f = mappa.file[rel];
    if (!f) { senzaProve.push(rel); continue; }
    const intero = f.funzioni.reduce((m, x) => Math.max(m, x[1]), 1);
    const prese = new Set();
    if (!righe) dai(f.carico, 'file', rel);
    for (const r of righe || []) {
      let meglio = null;
      for (const x of f.funzioni) {
        if (x[0] > r) break;
        if (x[1] >= r && (!meglio || x[1] - x[0] < meglio[1] - meglio[0])) meglio = x;
      }
      const chiave = meglio ? `${meglio[0]}:${meglio[1]}` : 'carico';
      if (prese.has(chiave)) continue;
      prese.add(chiave);
      const insieme = meglio ? meglio[2] : f.carico;
      // Il modulo intero, o l'IIFE che lo avvolge, gira a ogni caricamento: vale come il file, non come una funzione.
      const vera = Boolean(meglio) && (meglio[1] - meglio[0] + 1) < 0.9 * intero;
      const livello = !vera ? 'file' : mappa.insiemi[insieme].length > soglia ? 'larga' : 'funzione';
      dai(insieme, livello, rel);
    }
  }
  const prove = [...punti].map(([p, v]) => ({ spec: mappa.prove[p].spec, ms: mappa.prove[p].ms, livello: v.livello, peso: v.peso, file: [...v.file] }));
  prove.sort((a, b) => ORDINE[a.livello] - ORDINE[b.livello] || b.peso - a.peso || a.ms - b.ms || a.spec.localeCompare(b.spec));
  return { prove, senzaProve };
}

const ORDINE = { funzione: 0, larga: 1, file: 2 };
