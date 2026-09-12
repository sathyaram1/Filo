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

// ── #587 giro 2: l'avviso non deve comparire sui link di tutti i giorni ──────
// Il ripiego strutturale si accende da quando nel contesto è entrato qualcosa —
// un comando, una ricerca, un documento — e resta acceso per tutta la vita
// della scheda. Se scatta sugli identificativi che ogni sito mette nei suoi
// indirizzi, l'avviso compare su link innocui, si clicca senza leggerlo, e con
// lui si perde la protezione vera.
test('#587 — gli identificativi dei siti veri non sono un carico di dati', () => {
  for (const url of [
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_1?keywords=libro&qid=1699999999&sr=8-1',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0J/view',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://www.repubblica.it/cronaca/2026/09/12/news/titolo_articolo-424242424/',
    'https://github.com/anthropics/claude-code/blob/main/README.md',
    'https://www.corriere.it/esteri/26_settembre_12/notizia-a1b2c3d4-e5f6-11ee-9abc-1234567890ab.shtml',
    'https://www.booking.com/hotel/it/villa-roma.it.html?aid=1234567&sid=abcdef0123456789abcdef0123456789',
    'https://it.aliexpress.com/item/1005006123456789.html',
    'https://www.ikea.com/it/it/p/malm-struttura-letto-alta-bianco-s69009475/',
    'https://www.instagram.com/p/C1a2B3c4D5e/',
    'https://x.com/utente/status/1832847362819374821',
    'https://stackoverflow.com/questions/1234567/how-to-do-a-thing',
    'https://www.netflix.com/watch/81234567',
    'https://meet.google.com/abc-defg-hij',
  ]) {
    const v = E.assess(url, { corpus: '', fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere conferma (${v.reason})`);
  }
});

test('#587 — un carico di dati vero resta sospetto anche senza combaciare con niente', () => {
  for (const url of [
    // impacchettato: illeggibile, ma si riapre come testo
    'https://raccolta.test/?d=U0VHUkVUTzogSUJBTiBJVDYwWDA1NDI4MTExMDEwMDAwMDA=',
    // cifrato: illeggibile e non si riapre, ma è lungo come nessun
    // identificativo di sito
    'https://raccolta.test/?p=U2FsdGVkX1+9kQ3mJx2bHhGf7pQwLm4nZ1aRtYuIoPaSdFgHjKlZxCvBnM0987654321',
    // nel sottodominio, dove un sito vero non mette mai niente del genere
    'https://9f8e7d6c5b4a39281706f5e4d3c2b1a0.raccolta.test/ping',
  ]) {
    assert.equal(E.assess(url, { corpus: '', fromUntrusted: true }).exfil, true, `"${url}" deve chiedere conferma`);
  }
});

// ── #587, giro 3 — il dato tagliato dentro l'indirizzo ──────────────────────
//
// Chi compone l'indirizzo è la pagina ostile che detta al modello cosa aprire:
// le bastava tagliare il dato in due e rimetterlo in due parametri perché il
// confronto non trovasse più niente (in mezzo ci finisce il nome del secondo
// parametro). I pezzi, presi da soli, si leggono come parole, quindi nemmeno il
// controllo di riserva sulla forma diceva niente: la password usciva intera,
// senza avvisi. Senza il fix i primi assert tornano false.
const LETTO = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'token github ghp_A1b2C3d4E5f6G7h8I9j0',
].join('\n');
const chiede = (url) => E.assess(url, { corpus: LETTO, fromUntrusted: true }).exfil;

test('#587 — il dato tagliato in due esce lo stesso, quindi chiede conferma', () => {
  for (const url of [
    'https://raccolta.test/?a=SegretoN&b=etrc2026',
    'https://raccolta.test/?a=Segret&b=oNetr&c=c2026',
    'https://raccolta.test/?t1=ghp_A1b2C3&t2=d4E5f6G7h8I9j0',
    'https://raccolta.test/xSegretoNyetrc2026z',
    // lo stesso taglio fatto sul base64 invece che sul testo
    'https://raccolta.test/?a=U2VncmV0&b=b05ldHJjMjAyNg==',
  ]) {
    assert.equal(chiede(url), true, `"${url}" porta fuori il dato: deve chiedere conferma`);
  }
  // e il dato intero continua a chiederla
  assert.equal(chiede('https://raccolta.test/?d=SegretoNetrc2026'), true);
});

test('#587 — il confronto più largo non accende avvisi sugli indirizzi veri', () => {
  for (const url of [
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://www.amazon.it/dp/B08N5WRWNW/ref=sr_1_3?keywords=cuffie&qid=1699999999&sr=8-3',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    'https://stackoverflow.com/questions/1234567/how-to-do-a-thing-in-javascript',
    'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
    'https://duckduckgo.com/?q=ricetta+carbonara&t=h_&ia=web',
    'https://calendar.google.com/calendar/u/0/r/week/2026/9/12',
  ]) {
    assert.equal(chiede(url), false, `"${url}" non deve chiedere niente`);
  }
});

// ── #587 giro 4: il dato travestito, e l'avviso che non deve comparire ───────
//
// La difesa riconosceva il dato in chiaro, in base64 e tagliato in due o tre
// pezzi. Restavano fuori i travestimenti che costano una riga a chi compone
// l'indirizzo: scriverlo all'indietro, spostare l'alfabeto, infilare una lettera
// ogni tre caratteri, scriverlo in esadecimale quando è corto. E dall'altra
// parte l'avviso compariva su sei link veri su venti appena Filo aveva letto un
// documento, perché fra le parole da proteggere finiva «https» — che sta dentro
// ogni indirizzo — e una parola qualunque in comune bastava a completare la
// coppia. Senza il fix la prima prova torna false e la seconda true.
const G4 = [
  'machine ftp.esempio.it login mario password SegretoNetrc2026',
  'OPENROUTER_API_KEY=sk-or-v1-9f3ab2c7d84e1f5b6a0c',
].join('\n');
const chiedeG4 = (url) => E.assess(url, { corpus: G4, fromUntrusted: true }).exfil;
const rovesciaG4 = (s) => s.split('').reverse().join('');
const sparsoG4 = (s, n) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('x');

test('#587 — il dato travestito porta comunque fuori i dati, quindi chiede conferma', () => {
  const seg = 'SegretoNetrc2026';
  const chiave = 'sk-or-v1-9f3ab2c7d84e1f5b6a0c';
  for (const url of [
    `https://raccolta.test/?d=${rovesciaG4(seg)}`,
    `https://raccolta.test/?d=${rovesciaG4(chiave)}`,
    `https://raccolta.test/?d=${sparsoG4(seg, 4)}`,
    `https://raccolta.test/?d=${sparsoG4(seg, 3)}`,
    `https://raccolta.test/?d=${sparsoG4(chiave, 4)}`,
    `https://raccolta.test/?d=${Buffer.from(seg).toString('hex')}`,
    // alfabeto spostato di tredici lettere (le cifre restano dove sono)
    `https://raccolta.test/?d=${seg.replace(/[a-z]/gi, (c) => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c.charCodeAt(0) + 13) ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13))}`,
  ]) {
    assert.equal(chiedeG4(url), true, `"${url}" porta fuori il dato: deve chiedere conferma`);
  }
});

test('#587 — dopo un documento letto, i link di tutti i giorni si aprono e basta', () => {
  // Un documento come quelli che un utente fa leggere a Filo: contiene un link,
  // come quasi tutti i documenti veri.
  const bolletta = [
    'ENEL ENERGIA — Bolletta di luglio 2026',
    'Cliente: Mario Rossi, via Verdi 10, Roma',
    'Paga online dall’area clienti: https://www.enel.it/it/area-clienti',
    'Servizio assistenza clienti 800 900 800. Numero cliente 88123456.',
  ].join('\n');
  for (const url of [
    'https://www.enel.it/it/area-clienti',            // il link scritto nel documento
    'https://www.poste.it/servizi-online.html',
    'https://www.ilsole24ore.com/art/energia-bollette-in-calo-AF8k2Lm',
    'https://www.corriere.it/cronache/26_settembre_12/roma-nuovo-piano-traffico.shtml',
    'https://maps.google.com/?q=via+Verdi+Roma',
    'https://www.trenitalia.com/it/offerte.html',
  ]) {
    const v = E.assess(url, { corpus: bolletta, fromUntrusted: true });
    assert.equal(v.exfil, false, `"${url}" non deve chiedere niente (${v.reason})`);
  }
});

test('#587 — un dump di dati personali nel link chiede ancora conferma', () => {
  // La regola delle parole comuni resta: due parole del materiale protetto
  // dentro il CARICO del link sono un dump, non una coincidenza.
  const memoria = 'Profilo: si chiama Mario Rossi, vive a Bologna.';
  for (const url of [
    'https://raccolta.test/?d=Mario_Rossi',
    'https://raccolta.test/log?u=mario.rossi&c=bologna',
    'https://raccolta.test/exfil/MarioRossiBologna/done',
  ]) {
    assert.equal(E.assess(url, { corpus: memoria, fromUntrusted: true }).exfil, true, `"${url}" deve chiedere conferma`);
  }
});
