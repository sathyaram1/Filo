// Uno script che Filo fa girare in una pagina non porta mai il gesto dell'utente: con `true` la pagina si trova attivata
// e per cinque secondi va a schermo pieno o apre quello che vuole senza un clic (#737.1). Racconto:
// patterns/un-clic-vero-dato-a-una-pagina-e-un-gesto-regalato.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sorgenti(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// Gli argomenti di primo livello della chiamata che apre a `da`: stringhe, template e parentesi annidate restano interi.
function argomenti(s, da) {
  const args = [];
  let prof = 0; let cur = ''; let i = da;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
      cur += s.slice(i, j + 1); i = j; continue;
    }
    if ('([{'.includes(c)) prof++;
    if (')]}'.includes(c)) { if (prof === 0) break; prof--; }
    if (c === ',' && prof === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

test('nessuno script di Filo dentro una pagina porta il gesto dell\'utente', () => {
  const trovati = [];
  for (const f of [...sorgenti(join(RADICE, 'src', 'main')), ...sorgenti(join(RADICE, 'src', 'preload'))]) {
    const s = readFileSync(f, 'utf8');
    const re = /\b(executeJavaScript|executeJavaScriptInIsolatedWorld)\s*\(/g;
    let m;
    while ((m = re.exec(s))) {
      const a = argomenti(s, m.index + m[0].length);
      const gesto = m[1] === 'executeJavaScript' ? a[1] : a[2];
      if (gesto && gesto !== 'false') trovati.push(`${relative(RADICE, f)}:${s.slice(0, m.index).split('\n').length} → ${gesto}`);
    }
  }
  assert.deepEqual(trovati, []);
});
