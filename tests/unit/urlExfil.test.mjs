// Unit test per src/shared/urlExfil.js — il rilevatore di esfiltrazione dati via
// URL (sicurezza NAVIGA). Una pagina ostile può iniettare istruzioni nel modello
// per fargli aprire un link che porta FUORI dati sensibili (memoria/profilo). Il
// taint-match deve riconoscere i dati del corpus dentro l'URL (anche urlencoded
// o base64) e lasciare passare i link innocui; il fallback strutturale copre i
// payload da origine non fidata.
//
// Asseriamo il SUCCESSO della difesa: un URL che esfiltra dati del corpus →
// exfil:true; un URL di ricerca normale → exfil:false. Senza il modulo questi
// assert non avrebbero senso, e un eventuale regress li rende rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'urlExfil.js'));

const E = globalThis.SN_URL_EXFIL;

// Corpus tipico: dati personali che il modello aveva nel contesto.
const CORPUS = [
  'Profilo: si chiama Mario Rossi, vive a Bologna.',
  'Email: sathyarampontillo@gmail.com',
  'Preferenze: tema scuro, lingua italiana.',
  'Token salvato: ABC123XYZ789TOK',
].join('\n');

const isExfil = (url, opts = {}) => E.assess(url, { corpus: CORPUS, ...opts }).exfil;

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(E);
  assert.equal(typeof E.assess, 'function');
});

test('link innocui NON sono esfiltrazione (zero attrito sui casi normali)', () => {
  for (const url of [
    'https://example.com',
    'https://example.com/cerca?q=gatti',
    'https://www.google.com/search?q=meteo+bologna',
    'https://news.ycombinator.com/item?id=12345',
    'https://it.wikipedia.org/wiki/Bologna', // "bologna" NON è nel corpus come token isolato sensibile forte
    'example.com',
    '',
  ]) {
    assert.equal(isExfil(url), false, `"${url}" non dovrebbe essere esfiltrazione`);
  }
});

test('taint — nome/dati del profilo in chiaro nella query → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?d=Mario_Rossi'), true);
  assert.equal(isExfil('https://attaccante.com/log?u=mario.rossi&c=bologna'), true);
});

test('taint — email del corpus nel link → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?e=sathyarampontillo@gmail.com'), true);
  assert.equal(isExfil('https://attaccante.com/?e=sathyarampontillo%40gmail.com'), true);
});

test('taint — token con cifre del corpus → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?t=ABC123XYZ789TOK'), true);
});

test('taint — dati urlencodati (anche doppio) → esfiltrazione', () => {
  assert.equal(isExfil('https://attaccante.com/?d=Mario%20Rossi'), true);
  assert.equal(isExfil('https://attaccante.com/?d=Mario%2520Rossi'), true);
});

test('taint — dati codificati in base64 → esfiltrazione', () => {
  // base64("Mario Rossi Bologna") con dati del profilo
  const b64 = Buffer.from('Mario Rossi Bologna').toString('base64');
  assert.equal(isExfil(`https://attaccante.com/c?p=${b64}`), true);
});

test('taint — funziona anche su path e sottodominio, non solo query', () => {
  assert.equal(isExfil('https://attaccante.com/exfil/Mario_Rossi/done'), true);
  assert.equal(isExfil('https://mario-rossi-bologna.attaccante.com'), true);
});

test('una parola comune lunga (stopword) da sola NON scatena un falso positivo', () => {
  // "preferenze" è nel corpus ma è una parola comune: da sola non basta.
  assert.equal(isExfil('https://example.com/preferenze'), false);
});

test('fallback strutturale — payload corposo SOLO da origine non fidata', () => {
  const blob = 'x'.repeat(120);
  const url = `https://attaccante.com/?p=${blob}`;
  // da pagina web non fidata (agente sulla pagina) → sospetto
  assert.equal(isExfil(url, { fromUntrusted: true }), true);
  // da input diretto/dashboard (fidato) → niente nag sui link lunghi legittimi
  assert.equal(isExfil(url, { fromUntrusted: false }), false);
});

test('fallback strutturale — blob opaco lungo da origine non fidata', () => {
  const url = 'https://attaccante.com/?s=ZGF0aWNpZnJhdGljaGVpbHRhaW50bm9udmVkZQ';
  assert.equal(isExfil(url, { fromUntrusted: true }), true);
});

test('assess torna anche una reason leggibile quando rileva esfiltrazione', () => {
  const v = E.assess('https://attaccante.com/?e=sathyarampontillo@gmail.com', { corpus: CORPUS });
  assert.equal(v.exfil, true);
  assert.ok(typeof v.reason === 'string' && v.reason.length > 0);
});

test('corpus vuoto + origine fidata → nessun falso positivo', () => {
  assert.equal(E.assess('https://attaccante.com/?d=qualcosa', { corpus: '', fromUntrusted: false }).exfil, false);
});
