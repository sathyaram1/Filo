// Sentinella: in italiano Filo scrive le migliaia col punto anche a quattro cifre (4.990, 1.200). Da Electron 44 il
// default di Intl per l'italiano le lascia senza (4990), e i saldi e i conteggi cambiavano aspetto da soli: ogni numero
// formattato in italiano chiede `useGrouping: true`. Le date restano come sono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = /\b(day|month|year|hour|minute|second|weekday|dateStyle|timeStyle)\b/;

function sorgenti(dir = join(ROOT, 'src'), out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (/\.(js|html)$/.test(nome)) out.push(p);
  }
  return out;
}

// Fino alla parentesi che chiude: le opzioni possono contenere una chiamata (Math.max(0, d)).
function argomenti(src, da) {
  let livello = 1;
  for (let i = da; i < src.length; i++) {
    if (src[i] === '(') livello++;
    else if (src[i] === ')' && --livello === 0) return src.slice(da, i);
  }
  return src.slice(da);
}

// Anche senza `new` e con le opzioni in una variabile: formattano uguale, e una regex sulla forma tipica non le vedeva.
function senzaRaggruppamento(src) {
  const fuori = [];
  for (const m of src.matchAll(/\bIntl\.NumberFormat\(/g)) {
    if (!argomenti(src, m.index + m[0].length).includes('useGrouping')) fuori.push(m.index);
  }
  for (const m of src.matchAll(/\.toLocaleString\(\s*['"]it(?:-IT)?['"]/g)) {
    const opzioni = argomenti(src, m.index + '.toLocaleString('.length);
    if (opzioni.includes('useGrouping') || DATA.test(opzioni)) continue;
    if (/Date\([^)]*\)\s*$/.test(src.slice(Math.max(0, m.index - 60), m.index))) continue;
    fuori.push(m.index);
  }
  return fuori;
}

test('ogni numero formattato in italiano tiene il punto delle migliaia anche a quattro cifre', () => {
  const senza = [];
  for (const p of sorgenti()) {
    const src = readFileSync(p, 'utf8');
    const dove = (i) => `${relative(ROOT, p).replace(/\\/g, '/')}:${src.slice(0, i).split('\n').length}`;
    for (const i of senzaRaggruppamento(src)) senza.push(dove(i));
  }
  assert.deepEqual(senza, [], 'qui un numero in italiano esce senza il punto delle migliaia: aggiungi { useGrouping: true }');
});

test('il controllo riconosce ogni forma che scrive un numero, e lascia stare le date', () => {
  const quanti = (s) => senzaRaggruppamento(s).length;
  assert.equal(quanti("Intl.NumberFormat('it-IT').format(n)"), 1);
  assert.equal(quanti("n.toLocaleString('it-IT', opzioni)"), 1);
  assert.equal(quanti("new Intl.NumberFormat('it-IT', { maximumFractionDigits: Math.max(0, d) }).format(n)"), 1);
  assert.equal(quanti("new Intl.NumberFormat('it-IT', { maximumFractionDigits: Math.max(0, d), useGrouping: true }).format(n)"), 0);
  assert.equal(quanti("n.toLocaleString('it', { useGrouping: true, maximumFractionDigits: 2 })"), 0);
  assert.equal(quanti("new Date(iso).toLocaleString('it-IT')"), 0);
  assert.equal(quanti("d.toLocaleString('it-IT', { day: 'numeric', month: 'short' })"), 0);
});

test('con useGrouping il motore scrive 4.990, senza no', () => {
  assert.equal(new Intl.NumberFormat('it-IT', { useGrouping: true }).format(4990), '4.990');
  assert.equal(new Intl.NumberFormat('it-IT', { useGrouping: true, minimumFractionDigits: 2 }).format(1234.5), '1.234,50');
  assert.equal((999).toLocaleString('it-IT', { useGrouping: true }), '999');
});

test('quello che legge l\'utente: tetto in token e limite di spesa col punto delle migliaia, i centesimi con la virgola', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  globalThis.self = globalThis;
  for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'cambi']) {
    require(`../../src/shared/${m}.js`);
  }
  const P = globalThis.SN_PREF;
  const K = globalThis.SN_CAMBI;
  assert.equal(P.buildPreferencePartial('token_ricordati', '4000').label, 'Tetto in token della chat → 4.000');
  assert.equal(P.buildPreferencePartial('limite_spesa', '2.500,50 euro').label, 'Limite di spesa mensile → 2.500,50 €');
  assert.equal(P.buildPreferencePartial('limite_spesa', '1500').label, 'Limite di spesa mensile → 1.500 €');
  assert.equal(K.fraseCambio({ chiave: 'contestoFilo.token', prima: 2000, dopo: 4000 }), 'tetto in token di quello che la chat ricorda: 2.000 token → 4.000 token');
  assert.equal(K.fraseCambio({ chiave: 'monthlyLimitEur', prima: 5, dopo: 2500.5 }), 'limite di spesa mensile: 5 € → 2.500,50 €');
});

test('anche i numeri scritti senza Intl: millisecondi, caratteri e valori con decimali prendono il punto delle migliaia', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  globalThis.self = globalThis;
  for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'cambi']) {
    require(`../../src/shared/${m}.js`);
  }
  const P = globalThis.SN_PREF;
  const K = globalThis.SN_CAMBI;
  const C = globalThis.SN_CONST;
  assert.equal(P.buildPreferencePartial('barra_uscita', '1500 ms').label, 'La barra si chiude 1.500 ms dopo che il mouse esce');
  assert.equal(P.buildPreferencePartial('barra_attesa', '2,5 s').label, 'Attesa sul bordo prima che la barra si apra → 2.500 ms');
  assert.equal(P.buildPreferencePartial('barra_attesa', '9000 ms').rifiuto, '9.000 ms è fuori dai limiti: da 100 a 3.000 ms');
  assert.match(P.buildPreferencePartial('stile_agente', 'a'.repeat(1234)).rifiuto, /^lo stile è lungo 1\.234 caratteri e il massimo è /);
  assert.match(P.lezioneDaAzione({ testo: 'a'.repeat(C.LESSON_MAX + 1000) }).rifiuto, /^la lezione è lunga \d\.\d{3} caratteri/);
  // Una correzione di una riga del profilo non è una lezione (#872.4).
  assert.match(P.lezioneDaAzione({ testo: 'a'.repeat(C.LESSON_MAX + 1000) }, { cosa: 'la correzione' }).rifiuto, /^la correzione è lunga \d\.\d{3} caratteri/);
  assert.equal(K.fraseCambio({ chiave: 'barraLaterale.uscitaMs', prima: 400, dopo: 1500 }), 'tempo prima che la barra laterale si chiuda: 400 ms → 1.500 ms');
  assert.equal(K.fraseCambio({ chiave: 'contestoFilo.giorni', prima: 3, dopo: 0.5 }), 'giorni di conversazioni che la chat ricorda: 3 giorni → 0,5 giorni');
  assert.equal(K.fraseCambio({ chiave: 'tts.rate', prima: 1, dopo: 1.25 }), 'velocità di lettura: 1× → 1,25×');
  assert.equal(P.buildPreferencePartial('velocita_lettura', '1,5').label, 'Velocità lettura → 1,5×');
  assert.equal(P.buildPreferencePartial('velocita_lettura', '1,25').label, 'Velocità lettura → 1,25×');
  assert.equal(P.buildPreferencePartial('tono_lettura', '1,3').label, 'Tono lettura → 1,3');
});
