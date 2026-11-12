// I pezzi di un workflow di GitHub Actions che una sentinella deve far GIRARE, non leggere: le condizioni `if:` e i passi bash.
// Non simula Actions intero: solo il sottoinsieme delle espressioni che i nostri workflow usano, e un errore per il resto.
// Chi lo usa: tests/unit/releaseSuite.test.mjs (l'ultima rete delle metà di piattaforma).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { cartellaTemporanea, togliCartella } from './percorsi.mjs';

function gettoni(testo) {
  const out = [];
  let i = 0;
  while (i < testo.length) {
    const c = testo[i];
    if (/\s/.test(c)) { i += 1; continue; }
    const due = testo.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(due)) { out.push({ t: 'op', v: due }); i += 2; continue; }
    if ('()!,<>'.includes(c)) { out.push({ t: 'op', v: c }); i += 1; continue; }
    if (c === "'") {
      let v = '';
      i += 1;
      for (;;) {
        if (i >= testo.length) throw new Error(`stringa non chiusa in «${testo}»`);
        if (testo[i] === "'" && testo[i + 1] === "'") { v += "'"; i += 2; continue; }
        if (testo[i] === "'") { i += 1; break; }
        v += testo[i]; i += 1;
      }
      out.push({ t: 'str', v });
      continue;
    }
    const m = testo.slice(i).match(/^[A-Za-z_][\w.-]*/) || testo.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new Error(`carattere inatteso «${c}» in «${testo}»`);
    out.push({ t: /^\d/.test(m[0]) ? 'num' : 'id', v: m[0] });
    i += m[0].length;
  }
  return out;
}

const vero = (x) => !(x === null || x === undefined || x === false || x === '' || x === 0 || Number.isNaN(x));
const numero = (x) => (x === null || x === undefined ? 0 : typeof x === 'boolean' ? Number(x) : typeof x === 'number' ? x : (String(x).trim() === '' ? 0 : Number(x)));
function uguali(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b && a !== null && b !== null) return a === b;
  return numero(a) === numero(b);
}

/**
 * Valuta una condizione di Actions (con o senza `${{ }}`) contro `contesto`:
 * `{ needs: { lavoro: { result, outputs } }, cancellata, inputs, github }`.
 * Una proprietà che non c'è vale null, come in Actions; una funzione sconosciuta è un errore.
 */
export function valutaCondizione(espressione, contesto = {}) {
  const testo = String(espressione ?? '').trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  if (!testo.trim()) return funzioni.success([], contesto);
  const g = gettoni(testo);
  let k = 0;
  const vedi = () => g[k];
  const prendi = (v) => {
    if (!g[k] || g[k].v !== v) throw new Error(`atteso «${v}» in «${testo}»`);
    k += 1;
  };
  function primario() {
    const x = g[k++];
    if (!x) throw new Error(`espressione troncata: «${testo}»`);
    if (x.t === 'str') return x.v;
    if (x.t === 'num') return Number(x.v);
    if (x.v === '(') { const v = o(); prendi(')'); return v; }
    if (x.t === 'id') {
      if (x.v === 'true') return true;
      if (x.v === 'false') return false;
      if (x.v === 'null') return null;
      if (vedi() && vedi().v === '(') {
        k += 1;
        const argomenti = [];
        if (vedi() && vedi().v !== ')') {
          argomenti.push(o());
          while (vedi() && vedi().v === ',') { k += 1; argomenti.push(o()); }
        }
        prendi(')');
        if (!funzioni[x.v]) throw new Error(`funzione «${x.v}» che questo valutatore non conosce: aggiungila`);
        return funzioni[x.v](argomenti, contesto);
      }
      let v = contesto;
      for (const pezzo of x.v.split('.')) v = v && typeof v === 'object' && pezzo in v ? v[pezzo] : null;
      return v === undefined ? null : v;
    }
    throw new Error(`«${x.v}» fuori posto in «${testo}»`);
  }
  function unario() {
    if (vedi() && vedi().v === '!') { k += 1; return !vero(unario()); }
    return primario();
  }
  function confronto() {
    let a = unario();
    while (vedi() && ['==', '!=', '<', '>', '<=', '>='].includes(vedi().v)) {
      const op = g[k++].v;
      const b = unario();
      if (op === '==') a = uguali(a, b);
      else if (op === '!=') a = !uguali(a, b);
      else if (op === '<') a = numero(a) < numero(b);
      else if (op === '>') a = numero(a) > numero(b);
      else if (op === '<=') a = numero(a) <= numero(b);
      else a = numero(a) >= numero(b);
    }
    return a;
  }
  function e() {
    let a = confronto();
    while (vedi() && vedi().v === '&&') { k += 1; const b = confronto(); a = vero(a) ? b : a; }
    return a;
  }
  function o() {
    let a = e();
    while (vedi() && vedi().v === '||') { k += 1; const b = e(); a = vero(a) ? a : b; }
    return a;
  }
  const v = o();
  if (k < g.length) throw new Error(`avanza «${g[k].v}» in «${testo}»`);
  return vero(v);
}

const esitiNeeds = (c) => Object.values(c.needs || {}).map((n) => n && n.result);
const funzioni = {
  always: () => true,
  cancelled: (_, c) => !!c.cancellata,
  success: (_, c) => !c.cancellata && esitiNeeds(c).every((r) => r === 'success'),
  failure: (_, c) => esitiNeeds(c).some((r) => r === 'failure'),
  contains: ([a, b]) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
  startsWith: ([a, b]) => String(a ?? '').toLowerCase().startsWith(String(b ?? '').toLowerCase()),
};

/** Il corpo di `run: |` di un passo (il testo dopo `- name:`), senza il rientro di dieci spazi. */
export function scriptDelPasso(corpo) {
  const righe = String(corpo).split('\n');
  const i = righe.findIndex((r) => /^ {8}run:\s*\|\s*$/.test(r));
  if (i < 0) {
    const una = righe.find((r) => /^ {8}run:\s*\S/.test(r));
    return una ? una.replace(/^ {8}run:\s*/, '') : null;
  }
  const out = [];
  for (const r of righe.slice(i + 1)) {
    if (r.trim() && !r.startsWith(' '.repeat(10))) break;
    out.push(r.slice(10));
  }
  return out.join('\n');
}

/** Le uscite dichiarate da un lavoro: nome → { passo, chiave } per ogni `nome: ${{ steps.<passo>.outputs.<chiave> }}`. */
export function usciteDelLavoro(testoLavoro) {
  const m = String(testoLavoro).match(/^ {4}outputs:\s*\n((?: {6}.*\n?)*)/m);
  const out = {};
  for (const r of (m ? m[1] : '').split('\n')) {
    const x = r.match(/^ {6}([\w-]+):\s*\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}\s*$/);
    if (x) out[x[1]] = { passo: x[2], chiave: x[3] };
  }
  return out;
}

export const haBash = spawnSync('bash', ['-c', 'true']).status === 0;

/**
 * Esegue lo script di un passo come lo esegue Actions (`bash --noprofile --norc -eo pipefail`),
 * con `sleep` finto e i file di `GITHUB_OUTPUT` e `GITHUB_STEP_SUMMARY`. `file` mette script nella cartella del
 * passo (percorso relativo → contenuto); in `env` `{{dir}}` diventa quella cartella; `leggi` sono i file da rileggere alla fine.
 */
export function eseguiPasso(script, { env = {}, file = {}, leggi = [] } = {}) {
  const dir = cartellaTemporanea('filo-passo-');
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(bin, 'sleep'), 0o755);
    for (const [rel, contenuto] of Object.entries(file)) {
      const p = join(dir, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, contenuto);
    }
    const uscite = join(dir, 'uscite.txt');
    const riepilogo = join(dir, 'riepilogo.md');
    writeFileSync(uscite, '');
    writeFileSync(riepilogo, '');
    const ambiente = { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_OUTPUT: uscite, GITHUB_STEP_SUMMARY: riepilogo };
    for (const [k, v] of Object.entries(env)) ambiente[k] = String(v).replace(/\{\{dir\}\}/g, dir);
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { encoding: 'utf8', env: ambiente });
    const valori = {};
    for (const riga of readFileSync(uscite, 'utf8').split(/\r?\n/)) {
      const i = riga.indexOf('=');
      if (i > 0) valori[riga.slice(0, i)] = riga.slice(i + 1);
    }
    const letti = {};
    for (const rel of leggi) {
      try { letti[rel] = readFileSync(join(dir, rel), 'utf8'); } catch { letti[rel] = ''; }
    }
    return { stato: r.status, registro: `${r.stdout || ''}${r.stderr || ''}`, uscite: valori, riepilogo: readFileSync(riepilogo, 'utf8'), letti };
  } finally {
    togliCartella(dir);
  }
}
