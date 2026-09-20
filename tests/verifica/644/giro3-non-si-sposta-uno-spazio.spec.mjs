// Verifica #644, giro 3 — togliere un commento non deve far comparire (né
// sparire) uno spazio bianco.
//
// Il giro 1 confrontava i due alberi normalizzando gli spazi: così un commento
// che in HTML faceva da tappo fra due elementi in riga (`</li><!--\n--><li>`)
// poteva sparire portandosi dietro il tappo, e fra i due elementi si apriva un
// buco che nessun confronto vedeva. Qui gli spazi si contano: al posto del
// commento non deve restare niente di diverso da prima.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASE = '13793c5b06bbd3123352446f016e2b2d5f4d730e';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const esiste = () => { try { git('cat-file', '-e', `${BASE}^{commit}`); return true; } catch (_) { return false; } };

function cssVia(t) {
  let out = '', i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < t.length) {
        if (t[i] === '\\') { out += t.slice(i, i + 2); i += 2; continue; }
        out += t[i];
        const fine = t[i] === q || t[i] === '\n';
        i++;
        if (fine) break;
      }
      continue;
    }
    if (c === '/' && t[i + 1] === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i = Math.min(i + 2, t.length);
      continue;
    }
    out += c; i++;
  }
  return out;
}

function jsVia(t) {
  let out = '', i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < t.length) {
        if (t[i] === '\\') { out += t.slice(i, i + 2); i += 2; continue; }
        out += t[i];
        const fine = t[i] === q;
        i++;
        if (fine) break;
      }
      continue;
    }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && t[i + 1] === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i = Math.min(i + 2, t.length);
      continue;
    }
    out += c; i++;
  }
  return out;
}

const codice = (attrs) => {
  if (/\bsrc\s*=/.test(attrs)) return false;
  const m = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return true;
  const t = (m[2] ?? m[3] ?? m[4] ?? '').trim().toLowerCase();
  return t === '' || t === 'module' || /javascript|ecmascript/.test(t);
};

function htmlVia(t) {
  let out = '', i = 0;
  const raw = /<(script|style)\b([^>]*)>/i;
  while (i < t.length) {
    const m = raw.exec(t.slice(i));
    const s = t.indexOf('<!--', i);
    if (m && (s === -1 || i + m.index < s)) {
      const tag = m[1].toLowerCase();
      const apre = i + m.index + m[0].length;
      out += t.slice(i, apre);
      let chiusura = t.toLowerCase().indexOf(`</${tag}`, apre);
      if (chiusura === -1) chiusura = t.length;
      const corpo = t.slice(apre, chiusura);
      if (tag === 'style') out += cssVia(corpo);
      else if (codice(m[2])) out += jsVia(corpo);
      else out += corpo;
      i = chiusura;
      continue;
    }
    if (s === -1) { out += t.slice(i); break; }
    out += t.slice(i, s);
    const e = t.indexOf('-->', s + 4);
    i = e === -1 ? t.length : e + 3;
  }
  return out;
}

const senzaCommenti = (f, t) => (f.endsWith('.css') ? cssVia(t) : htmlVia(t));
// Le sequenze di spazio si riducono a uno: quel che conta è se uno spazio c'è
// o non c'è, non quanti ce ne sono.
const misura = (f, t) => senzaCommenti(f, t).replace(/[ \t\r\n]+/g, ' ');

test('togliere i commenti non fa comparire né sparire uno spazio bianco', () => {
  test.skip(!esiste(), 'il commit di partenza non è in questo clone');
  const potati = git('diff', '--name-only', `${BASE}...HEAD`, '--', 'src')
    .split('\n').filter((f) => f.endsWith('.html') || f.endsWith('.css'));
  expect(potati.length, 'nessun file potato: la guardia passerebbe a vuoto').toBeGreaterThan(20);

  const diversi = [];
  for (const f of potati) {
    const prima = misura(f, git('show', `${BASE}:${f}`));
    const adesso = misura(f, readFileSync(join(ROOT, f), 'utf8'));
    if (prima !== adesso) {
      let i = 0;
      while (i < prima.length && i < adesso.length && prima[i] === adesso[i]) i++;
      diversi.push(`${f}\n  prima: ${JSON.stringify(prima.slice(Math.max(0, i - 80), i + 80))}\n  adesso: ${JSON.stringify(adesso.slice(Math.max(0, i - 80), i + 80))}`);
    }
  }
  expect(diversi.join('\n')).toBe('');
});
