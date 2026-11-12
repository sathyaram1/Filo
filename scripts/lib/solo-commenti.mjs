// Quali file cambiati da un ramo cambiano solo nei commenti o negli spazi (#2425): non scelgono spec, perché lì
// nessun comportamento si muove. Nel dubbio (sorgente che non si legge, file nuovo o tolto, tipo ignoto) il file conta
// come cambiato davvero. Regole: tests/unit/soloCommenti.test.mjs.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JS = /\.(?:m|c)?js$/i;
const CSS = /\.css$/i;

let tsCaricato;
function typescript() {
  if (tsCaricato === undefined) {
    try { tsCaricato = createRequire(join(ROOT, 'package.json'))('typescript'); } catch { tsCaricato = null; }
  }
  return tsCaricato;
}

// Il parser vero, non una regex: un `//` dentro una stringa, un template o una regex letterale non è un commento.
function jsSenzaCommenti(testo, nome) {
  const ts = typescript();
  if (!ts) return null;
  const sf = ts.createSourceFile(nome, testo, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) return null;
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

function cssSenzaCommenti(testo) {
  let out = '';
  let quota = '';
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (quota) {
      out += c;
      if (c === '\\') out += testo[++i] ?? '';
      else if (c === quota) quota = '';
      continue;
    }
    if (c === '/' && testo[i + 1] === '*') {
      const fine = testo.indexOf('*/', i + 2);
      if (fine < 0) return null;
      i = fine + 1;
      out += ' ';
      continue;
    }
    if (c === '"' || c === '\'') quota = c;
    out += c;
  }
  return quota ? null : out.replace(/\s+/g, ' ').trim();
}

/** Il sorgente ridotto al solo codice: due versioni uguali qui differiscono solo in commenti e spazi. null = non lo so dire. PURA. */
export function codiceSenzaCommenti(testo, nome) {
  if (typeof testo !== 'string') return null;
  if (JS.test(nome)) return jsSenzaCommenti(testo, nome);
  if (CSS.test(nome)) return cssSenzaCommenti(testo);
  return null;
}

/** Le due versioni di un file differiscono solo in commenti e spazi? Un lato mancante (file nuovo o tolto) è un cambio vero. PURA. */
export function soloNeiCommenti(prima, dopo, nome) {
  if (typeof prima !== 'string' || typeof dopo !== 'string') return false;
  const a = codiceSenzaCommenti(prima, nome);
  if (a === null) return false;
  const b = codiceSenzaCommenti(dopo, nome);
  return b !== null && a === b;
}

function mostra(root, rev, file) {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch { return null; }
}

/**
 * Dei file cambiati da HEAD rispetto a `base`, quelli che cambiano solo nei commenti: il confronto parte dal punto
 * in cui il ramo si è staccato, come il diff a tre punti che li ha elencati.
 */
export function cambiatiSoloNeiCommenti(changed, { base, root = ROOT }) {
  const candidati = (Array.isArray(changed) ? changed : []).filter((f) => JS.test(f) || CSS.test(f));
  if (!candidati.length) return [];
  let mb = '';
  try {
    mb = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return []; }
  return candidati.filter((f) => soloNeiCommenti(mostra(root, mb, f), mostra(root, 'HEAD', f), f));
}
