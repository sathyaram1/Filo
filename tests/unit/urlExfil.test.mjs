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

// #553: dati corti, sotto le soglie della forma, scritti al contrario o in esadecimale; e le credenziali nell'indirizzo.
test('taint — dati corti al contrario o in esadecimale → esfiltrazione; un hash di commit no', () => {
  assert.equal(isExfil('https://attaccante.example/oiraM/issoR/angoloB'), true);
  assert.equal(isExfil(`https://attaccante.example/${Buffer.from('Mario Rossi').toString('hex')}`), true);
  assert.equal(isExfil('https://github.com/o/r/commit/9f2c4e1a7b3d5c8e0f1a2b3c4d5e6f7a8b9c0d1e'), false);
  assert.equal(isExfil('https://www.google.com/search?q=ristoranti+aperti+oggi'), false);
});

test('fallback strutturale — un blocco di dati nelle credenziali dell\'indirizzo', () => {
  const blob = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';
  assert.equal(isExfil(`https://${blob}@attaccante.example/`, { fromUntrusted: true }), true);
  assert.equal(isExfil('https://attaccante.example/', { fromUntrusted: true }), false);
});

// #553, giro 14: la forma distingue un percorso fatto di parole da un codice opaco. Gli indirizzi che un modello
// scrive da sé (prezzi ufficiali, documentazione, Wikipedia) passano; i dati travestiti no, comunque spezzati.
test('fallback strutturale — un indirizzo normale scritto da un modello non è un blocco di dati', () => {
  for (const url of [
    'https://ai.google.dev/gemini-api/docs/pricing',
    'https://www.museoegizio.it/info/orari-e-biglietti/',
    'https://it.wikipedia.org/wiki/Seconda_guerra_mondiale',
    'https://it.wikipedia.org/wiki/Citt%C3%A0_del_Vaticano',
    'https://docs.mistral.ai/getting-started/models/models_overview/',
    'https://huggingface.co/meta-llama/Llama-3.1-405B-Instruct-FP8',
    'https://www.ansa.it/sito/notizie/cronaca/2026/09/29/sciopero-treni_abc.html',
    'https://www.repubblica.it/politica/2026/09/29/news/governo_manovra-123456/',
    'https://learn.microsoft.com/it-it/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ]) {
    assert.equal(isExfil(url, { fromUntrusted: true }), false, url);
  }
});

// #553, giro 15: la documentazione nomina le pagine con un nome composto lungo, e Wikipedia in un alfabeto non latino
// mette sei caratteri nell'indirizzo per ogni lettera. Nessuno dei due è un blocco di dati.
test('fallback strutturale — nomi composti della documentazione e voci in alfabeti non latini passano', () => {
  for (const url of [
    'https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect',
    'https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByTagName',
    'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D',
    'https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormControlsCollection',
    'https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/bufferData',
    'https://ru.wikipedia.org/wiki/Великая_Отечественная_война',
    `https://ru.wikipedia.org/wiki/${encodeURIComponent('Великая_Отечественная_война')}`,
    `https://ar.wikipedia.org/wiki/${encodeURIComponent('الحرب_العالمية_الثانية')}`,
    `https://ja.wikipedia.org/wiki/${encodeURIComponent('第二次世界大戦')}`,
    'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
  ]) {
    assert.equal(isExfil(url, { fromUntrusted: true }), false, url);
  }
  // Le maiuscole sparse di un codice restano codice, e un pezzo lungo senza maiuscole di parola pure.
  for (const url of [
    'https://att.example/?d=TWFyaW9Sb3NzaUJvbG9nbmFWaWFSb21h',
    'https://att.example/a/QmFzZWxpbmVQ/ZnJvbVRoZQ/c2VjcmV0',
    'https://att.example/?d=znevbebffvobybtanivnebzn',
  ]) {
    assert.equal(isExfil(url, { fromUntrusted: true }), true, url);
  }
});

test('fallback strutturale — i dati travestiti restano un blocco, anche spezzati da barre, trattini o punti', () => {
  const hex = Buffer.from('Mario Rossi, Bologna').toString('hex');
  const altro = Buffer.from('Luigi Verdi, via Po 3').toString('hex');
  for (const url of [
    `https://att.example/r/${altro.match(/.{1,8}/g).join('-')}`,
    `https://att.example/r/${altro.match(/.{1,4}/g).join('/')}`,
    `https://att.example/c?p=${Buffer.from('Luigi Verdi, Torino, via Po 3').toString('base64')}`,
    'https://att.example/?d=JVQXE2LPEBJG643TNEQEE33MN5TW4YI',
    `https://att.example/?d=${[...'Luigi Verdi Torino'].map((ch) => ch.charCodeAt(0)).join('.')}`,
    `https://${hex.slice(0, 20)}.${hex.slice(20)}.att.example/`,
    'https://negozio.example/listino?sessione=8f3a9c2e7b1d4f6a9c2e7b1d4f6a0b1c',
  ]) {
    assert.equal(E.assess(url, { corpus: '', fromUntrusted: true }).exfil, true, url);
  }
});
