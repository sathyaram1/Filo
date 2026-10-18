// #1111 — chi corregge una parola perde solo il segno blu di quella: gli altri seguono il testo fino allo scan dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.SN_MSG ??= { MSG: {} };
globalThis.SN_CONST ??= { ACTIONS: {}, STORAGE_KEYS: {} };
require(join(ROOT, 'src', 'content', 'spellcheck.js'));
const { riallineaIssues } = globalThis.SN_SPELLCHECK;

// Gli issue segnati con **…** nel testo, come li darebbe lo scan.
function segnati(marcato) {
  const issues = [];
  let testo = '';
  for (const pezzo of marcato.split(/(\*\*.+?\*\*)/)) {
    if (pezzo.startsWith('**')) {
      const w = pezzo.slice(2, -2);
      issues.push({ type: 'grammar', start: testo.length, end: testo.length + w.length, segment: w });
      testo += w;
    } else testo += pezzo;
  }
  return { testo, issues };
}
const parole = (testo, issues) => issues.map((i) => testo.slice(i.start, i.end));

function dopo(marcato, nuovo) {
  const { testo, issues } = segnati(marcato);
  const r = riallineaIssues(issues, testo, nuovo);
  for (const i of r.issues) assert.equal(nuovo.slice(i.start, i.end), i.segment, 'il segno sta sulla stessa parola');
  return { parole: parole(nuovo, r.issues), perse: r.perse };
}

test('correggere una parola in mezzo lascia segnate le altre, prima e dopo', () => {
  assert.deepEqual(dopo('io **andiamo** a casa ciiao e **vado** ieri', 'io andiamo a casa ciao e vado ieri'),
    { parole: ['andiamo', 'vado'], perse: false });
  assert.deepEqual(dopo('io **andiamo** a casa ciao e **vado** ieri', 'io andiamo a casa e vado ieri'),
    { parole: ['andiamo', 'vado'], perse: false });
  assert.deepEqual(dopo('io **andiamo** a casa e **vado** ieri', 'io andiamo a casa nostra e vado ieri'),
    { parole: ['andiamo', 'vado'], perse: false });
});

test('la parola corretta perde il suo segno, le altre no', () => {
  assert.deepEqual(dopo('io **andiamo** a casa e **vado** ieri', 'io andiamo a casa e sono andato ieri'),
    { parole: ['andiamo'], perse: true });
  assert.deepEqual(dopo('io **andiamo** a casa e **vado** ieri', 'io vado a casa e vado ieri'),
    { parole: ['vado'], perse: true });
});

test('una lettera attaccata alla parola segnata, o due parole fuse, tolgono il segno; spazi e punteggiatura no', () => {
  assert.deepEqual(dopo('la casa **bello** oggi', 'la casa bellos oggi').parole, []);
  assert.deepEqual(dopo('la casa **bello** oggi', 'la casa sbello oggi').parole, []);
  assert.deepEqual(dopo('la casa **bello** oggi', 'la casa belloggi').parole, []);
  assert.deepEqual(dopo('la casa **bello** oggi', 'la casa bel lo oggi').parole, []);
  assert.deepEqual(dopo('la casa **bello**', 'la casa bello ').parole, ['bello']);
  assert.deepEqual(dopo('la casa **bello**.', 'la casa bello!').parole, ['bello']);
  assert.deepEqual(dopo('la casa **bello** oggi', 'la casa molto bello oggi').parole, ['bello']);
});

test('testo uguale, vuoto o senza segni: niente cambia e niente si perde', () => {
  const { testo, issues } = segnati('la **casa** bello');
  assert.deepEqual(riallineaIssues(issues, testo, testo), { issues, perse: false });
  assert.deepEqual(riallineaIssues([], testo, 'altro'), { issues: [], perse: false });
  assert.deepEqual(dopo('la **casa** bello', ''), { parole: [], perse: true });
  assert.deepEqual(dopo('**casa** 😀 **bello**', 'casa 😀😀 bello'), { parole: ['casa', 'bello'], perse: false });
});

test('scrivere e poi annullare riporta i segni dov\'erano', () => {
  const { testo, issues } = segnati('io **andiamo** a casa e **vado** ieri');
  const a = riallineaIssues(issues, testo, 'io andiamo a casa mia e vado ieri');
  const b = riallineaIssues(a.issues, 'io andiamo a casa mia e vado ieri', testo);
  assert.deepEqual(b.issues.map(({ start, end }) => [start, end]), issues.map(({ start, end }) => [start, end]));
});
