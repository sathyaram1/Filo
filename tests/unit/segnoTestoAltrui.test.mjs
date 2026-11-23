// #592.25 — il segno che distingue il testo altrui dalle parole di Filo (il filo a sinistra, per metà colore del testo)
// è lo stesso dappertutto: chi rinforza quello del popup di conferma trova qui ogni copia da portare con sé.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

// Dove il segno si disegna: file e selettore. Una copia nuova si aggiunge qui.
const COPIE = [
  ['src/shared/confirmUi.js', '.sn-confirm-quote'],
  ['src/pages/dashboard/dashboard.css', '.dash-delete-query'],
  ['src/pages/dashboard/dashboard.css', '.dash-altrui'],
  ['src/renderer/shell.css', '.dl-row-ask-nome'],
  ['src/renderer/shell.css', '.permesso-oggetto'],
  ['src/renderer/avviso-sito.css', '.altrui'],
];

function regole(testo) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(testo))) {
    const selettori = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim()).filter(Boolean);
    out.push({ selettori, corpo: m[2] });
  }
  return out;
}
const bordo = (corpo) => {
  const m = /border-left\s*:\s*([^;]+);/.exec(corpo);
  return m ? m[1].trim() : '';
};
// L'accento si chiama in modo diverso in ogni documento: il resto deve coincidere.
const forma = (v) => v.replace(/var\(--[a-z-]+(?:,\s*#[0-9a-f]{3,8})?\)/gi, 'ACCENTO').replace(/\s+/g, ' ');

function fileDa(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fileDa(p));
    else if (/\.css$/.test(n) || n === 'confirmUi.js') out.push(p);
  }
  return out;
}

test('ogni copia del segno del testo altrui è uguale a quella del popup di conferma', () => {
  const testi = new Map();
  const leggi = (f) => { if (!testi.has(f)) testi.set(f, readFileSync(join(ROOT, f), 'utf8')); return testi.get(f); };
  const [fileRif, selRif] = COPIE[0];
  const rif = regole(leggi(fileRif)).find((r) => r.selettori.includes(selRif));
  const atteso = forma(bordo(rif.corpo));
  assert.match(atteso, /currentColor/, 'il filo del popup è per metà colore del testo');
  for (const [f, sel] of COPIE) {
    const r = regole(leggi(f)).find((x) => x.selettori.includes(sel) && bordo(x.corpo));
    assert.ok(r, `${f}: ${sel} non disegna il segno`);
    assert.equal(forma(bordo(r.corpo)), atteso, `${f}: ${sel}`);
  }
});

test('nessuna regola disegna il segno fuori dall\'elenco delle copie', () => {
  const note = new Set(COPIE.map(([f, s]) => `${f} ${s}`));
  for (const p of fileDa(SRC)) {
    const f = relative(ROOT, p).split('\\').join('/');
    for (const r of regole(readFileSync(p, 'utf8'))) {
      if (!/currentColor\s*\)/.test(bordo(r.corpo))) continue;
      for (const s of r.selettori) assert.ok(note.has(`${f} ${s}`), `${f}: ${s} disegna il segno del testo altrui ma non sta nelle COPIE`);
    }
  }
});
