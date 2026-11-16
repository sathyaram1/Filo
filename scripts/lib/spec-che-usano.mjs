// Gli spec che usano un modulo cambiato, seguendo import, require e i percorsi passati a join/resolve (#2551): un aiuto
// dei test non porta il nome di nessuno spec, e la regola del nome non lo vedeva. Non decide da solo quanti spec
// lanciare oltre la soglia: li elenca. Regole: tests/unit/specCheUsano.test.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

// Oggi l'aiuto condiviso più largo (il menu contestuale) arriva a 138 spec, i sei universali (fixture, percorsi…) a
// più di 720: oltre la soglia la scelta sarebbe la suite intera, che gira su main a ogni fusione.
export const SOGLIA_SPEC_DI_UN_MODULO = 200;

const JS = /\.(?:m|c)?js$/;
const SPEC = /^tests\/[^/]+\.spec\.mjs$/;
const IMPORT = /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PERCORSO = /\b(?:join|resolve)\s*\(([^()]*)\)/g;
const LETTERALE = /['"]([^'"\n]+)['"]/g;

/** I file del repo a cui `testo`, sorgente di `file`, rimanda. `esiste` dice se un percorso è un file tracciato. PURA. */
export function riferimenti(file, testo, esiste) {
  const dir = posix.dirname(file);
  const out = new Set();
  const norma = (p) => posix.normalize(p).replace(/^\.\//, '');
  // Le righe di solo commento non rimandano a niente: un esempio di codice citato lì faceva un arco falso.
  const codice = String(testo || '').split('\n').filter((r) => !/^\s*(?:\/\/|\/?\*)/.test(r)).join('\n');
  for (const m of codice.matchAll(IMPORT)) {
    const s = m[1] || m[2] || m[3] || m[4];
    if (!/^\.{1,2}\//.test(s)) continue;
    const base = norma(posix.join(dir, s));
    const trovato = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`].find(esiste);
    // Un modulo tolto dal ramo e ancora importato resta un rimando: lo spec che lo importa va lanciato.
    out.add(trovato || base);
  }
  // Uno script lanciato con spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs')]) non è un import.
  for (const m of codice.matchAll(PERCORSO)) {
    const pezzi = [...m[1].matchAll(LETTERALE)].map((l) => l[1]);
    if (!pezzi.length || !JS.test(pezzi[pezzi.length - 1])) continue;
    const rel = pezzi.join('/');
    for (const c of [norma(rel), norma(posix.join(dir, rel))]) if (!c.startsWith('..') && esiste(c)) out.add(c);
  }
  out.delete(file);
  return [...out];
}

/**
 * Per ogni file di `changed`, gli spec (tests/<nome>, senza estensione) che lo raggiungono di rimando in rimando, fra i
 * sorgenti dati (Map percorso → testo). Chi supera la soglia finisce in `troppoLarghi` col suo conto. PURA.
 */
export function specCheUsano(changed, sorgenti, { soglia = SOGLIA_SPEC_DI_UN_MODULO } = {}) {
  const esiste = (p) => sorgenti.has(p);
  const rimandi = new Map();
  for (const [f, testo] of sorgenti) rimandi.set(f, riferimenti(f, testo, esiste));
  const usatoDa = new Map();
  for (const spec of sorgenti.keys()) {
    if (!SPEC.test(spec)) continue;
    const visti = new Set();
    const pila = [spec];
    while (pila.length) {
      for (const d of rimandi.get(pila.pop()) || []) {
        if (visti.has(d)) continue;
        visti.add(d);
        pila.push(d);
      }
    }
    for (const d of visti) {
      if (!usatoDa.has(d)) usatoDa.set(d, []);
      usatoDa.get(d).push(spec.replace(/\.spec\.mjs$/, ''));
    }
  }
  const specs = new Set();
  const troppoLarghi = [];
  for (const f of new Set(Array.isArray(changed) ? changed : [])) {
    const chi = usatoDa.get(f) || [];
    if (chi.length > soglia) troppoLarghi.push({ file: f, spec: chi.length });
    else for (const s of chi) specs.add(s);
  }
  return { specs: [...specs], troppoLarghi };
}

/** I sorgenti JS tracciati in `root` dove un rimando può passare: i test, gli script e l'app. */
export function leggiSorgenti(root) {
  let elenco = [];
  try {
    elenco = execFileSync('git', ['ls-files', '-z', 'tests', 'scripts', 'src'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\u0000');
  } catch { return new Map(); }
  const sorgenti = new Map();
  for (const f of elenco) {
    if (!JS.test(f)) continue;
    try { sorgenti.set(f, readFileSync(join(root, f), 'utf8')); } catch { /* tolto dall'albero ma ancora nell'indice */ }
  }
  return sorgenti;
}
