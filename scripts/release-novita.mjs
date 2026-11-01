// Le novità riscritte dal redattore (SPEC-MANUTENTORE § 8) al posto delle righe dei worker, in locale nell'albero che
// si costruisce: niente commit, e la pubblicazione non si ferma mai (senza risposta restano le righe dei worker, con
// l'avviso). Gira con la parola della costruzione: patchNotes.js lo LEGGE come dato, mai eseguito. Prove: tests/unit/releaseNovita.test.mjs.
//
// USO   node scripts/release-novita.mjs <X.Y.Z | vX.Y.Z>   (nella cartella del progetto, con FILO_BUILD_PASSPHRASE)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const RELEASE_NOVITA_URL = `${BASE}/releaseNovita`;
// Un server appeso non deve tenere ferma la costruzione: oltre si esce con le righe dei worker.
const ATTESA_MS = 60000;
const VERSIONE_RE = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
const REGISTRO = ['src', 'shared', 'patchNotes.js'];

/** L'impronta di una riga, la stessa di SN_PATCH_NOTES.impronta (FNV-1a sul testo). PURA. */
export function impronta(r) {
  const s = r && typeof r === 'object' ? String(r.testo || '') : String(r == null ? '' : r);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Il letterale di NOTES: liste, oggetti, stringhe, numeri, true/false/null, commenti e virgole finali. Qualunque altra
// cosa (un'espressione, un template con ${}) ferma la lettura: meglio le righe dei worker che un registro letto male.
function letterale(s, inizio) {
  let i = inizio;
  const guasto = (cosa) => { throw new Error(`${cosa} al carattere ${i}`); };
  const salta = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('//', i)) { const n = s.indexOf('\n', i); i = n < 0 ? s.length : n; } else if (s.startsWith('/*', i)) {
        const n = s.indexOf('*/', i + 2);
        if (n < 0) guasto('commento aperto');
        i = n + 2;
      } else return;
    }
  };
  const esadecimali = (n) => {
    const h = s.slice(i, i + n);
    if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(h)) guasto('sequenza esadecimale');
    i += n;
    return parseInt(h, 16);
  };
  const SEMPLICI = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
  const stringa = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      const c = s[i++];
      if (c === '$' && q === '`' && s[i] === '{') guasto('template con espressioni');
      if ((c === '\n' || c === '\r') && q !== '`') guasto('a capo in una stringa');
      if (c !== '\\') { out += c; continue; }
      const e = s[i++];
      if (e === 'x') out += String.fromCharCode(esadecimali(2));
      else if (e === 'u' && s[i] === '{') {
        const n = s.indexOf('}', i);
        const h = n < 0 ? '' : s.slice(i + 1, n);
        if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) guasto('\\u{} malformato');
        out += String.fromCodePoint(parseInt(h, 16));
        i = n + 1;
      } else if (e === 'u') out += String.fromCharCode(esadecimali(4));
      else if (e === '0' && !/\d/.test(s[i] || '')) out += '\0';
      else if (/\d/.test(e)) guasto('sequenza ottale');
      else if (e === '\r') { if (s[i] === '\n') i++; } else if (e === '\n' || e === ' ' || e === ' ') { /* a capo continuato */ } else out += SEMPLICI[e] || e;
    }
    if (s[i] !== q) guasto('stringa aperta');
    i++;
    return out;
  };
  const valore = () => {
    salta();
    const c = s[i];
    if (c === '[') {
      i++;
      const v = [];
      const posti = [];
      for (;;) {
        salta();
        if (s[i] === ']') { i++; return { v, posti }; }
        const a = i;
        v.push(valore().v);
        posti.push([a, i]);
        salta();
        if (s[i] === ',') i++;
        else if (s[i] !== ']') guasto('lista');
      }
    }
    if (c === '{') {
      i++;
      const v = {};
      for (;;) {
        salta();
        if (s[i] === '}') { i++; return { v }; }
        let k;
        if (s[i] === "'" || s[i] === '"') k = stringa();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 200));
          if (!m) guasto('chiave');
          k = m[0];
          i += k.length;
        }
        if (k === '__proto__') guasto('chiave __proto__');
        salta();
        if (s[i] !== ':') guasto('due punti');
        i++;
        v[k] = valore().v;
        salta();
        if (s[i] === ',') i++;
        else if (s[i] !== '}') guasto('oggetto');
      }
    }
    if (c === "'" || c === '"' || c === '`') return { v: stringa() };
    const m = /^(?:-?\d+(?:\.\d+)?|true|false|null)(?![\w$])/.exec(s.slice(i, i + 40));
    if (!m) guasto('valore');
    i += m[0].length;
    return { v: JSON.parse(m[0]) };
  };
  return valore();
}

/** Il registro NOTES di un testo di patchNotes.js, letto senza eseguirlo: { note, posti } | null. PURA. */
export function leggiNote(sorgente) {
  const s = String(sorgente);
  const m = /\bconst\s+NOTES\s*=\s*\[/.exec(s);
  if (!m) return null;
  try {
    const r = letterale(s, m.index + m[0].length - 1);
    return Array.isArray(r.v) ? { note: r.v, posti: r.posti } : null;
  } catch (_) { return null; }
}

/** Una riga del server com'è nel registro: testo, o { testo, segnalazione }; null se non è nessuna delle due. PURA. */