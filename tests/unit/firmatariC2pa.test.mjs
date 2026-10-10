// Unit test di src/main/services/firmatariC2pa.js: l'elenco ufficiale dei firmatari
// C2PA si scarica, resta su disco, e uno scaricato male non prende il posto di quello buono.
// Il fetch è finto e le attese a tempo pure: la prova non tocca la rete, e una macchina carica non decide chi arriva
// prima fra l'elenco e il tempo limite (#1063).

import { test, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { pngFirmato, certificato, elencoPem, USO_MARCA } from '../helpers/immagineFirmata.mjs';

process.env.NODE_ENV = 'test';
const DATI = cartellaTemporanea('filo-firmatari-');
process.env.FILO_USER_DATA = DATI;

const require = createRequire(import.meta.url);
require('../../src/shared/provenienzaImmagine.js');
const F = require('../../src/main/services/firmatariC2pa.js');
const P = globalThis.SN_PROVENIENZA;

const RADICE = certificato({ organizzazione: 'Autorità di prova', nomeComune: 'Radice', ca: true });
const ALTRA = certificato({ organizzazione: 'Altra autorità', nomeComune: 'Radice', ca: true });
const IMMAGINE = pngFirmato({ cert: certificato({ organizzazione: 'OpenAI, Inc.', emittente: RADICE }) });

// Il server finto: per indirizzo il corpo, e un `cancello` che tiene la risposta finché la prova non lo apre.
const risposte = new Map();
const base = 'http://firmatari.prova';
const fetchVero = globalThis.fetch;
globalThis.fetch = async (url) => {
  const { pathname } = new URL(String(url));
  const r = risposte.get(pathname);
  if (!r) return new Response('non trovato', { status: 404 });
  if (r.cancello) await r.cancello;
  return new Response(r.corpo, { status: r.stato || 200, headers: { 'Content-Type': 'text/plain', 'Content-Length': String(Buffer.byteLength(r.corpo)) } });
};
// I tempi limite del modulo (lo scaricamento, il thread di lettura, l'attesa della prima volta) non scadono da soli.
// Il thread di lettura non tiene vivo il processo e i timer finti nemmeno: lo tiene vivo un intervallo vero.
const vivo = setInterval(() => {}, 60_000);
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());
after(() => {
  clearInterval(vivo);
  globalThis.fetch = fetchVero;
  togliCartella(DATI);
});

test('mai scaricato: la firma è valida ma il firmatario resta non verificato', async () => {
  F._dimentica();
  const r = await F.analizzaImmagine(IMMAGINE);
  assert.equal(r.firmatario, 'non_verificato');
  assert.match(P.frase(r), /Firma valida, firmatario non verificato/);
  assert.equal(F.stato().scaricato, false);
});

test('scaricato l’elenco, chi ci sta dentro è riconosciuto, e l’elenco resta su disco', async () => {
  F._dimentica();
  risposte.set('/elenco.pem', { corpo: elencoPem(RADICE) });
  const esito = await F.aggiorna({ forza: true, url: `${base}/elenco.pem` });
  assert.equal(esito.ok, true);
  assert.equal(esito.certificati, 1);
  assert.equal((await F.analizzaImmagine(IMMAGINE)).firmatario, 'riconosciuto');
  assert.ok(existsSync(join(DATI, 'firmatari-c2pa', 'elenco.json')));

  // Al riavvio l'elenco si rilegge dal disco, senza rete.
  F._dimentica();
  assert.equal(await F.carica(), true);
  const r = await F.analizzaImmagine(IMMAGINE);
  assert.equal(r.firmatario, 'riconosciuto');
  assert.equal(P.frase(r), 'Generata con l’AI, lo dichiara OpenAI nelle credenziali firmate.');
});

test('un elenco nuovo senza quell’autorità la fa diventare sconosciuta', async () => {
  risposte.set('/altro.pem', { corpo: elencoPem(ALTRA) });
  assert.equal((await F.aggiorna({ forza: true, url: `${base}/altro.pem` })).ok, true);
  assert.equal((await F.analizzaImmagine(IMMAGINE)).firmatario, 'sconosciuto');
});

test('una pagina d’errore, un 404 o un elenco enorme non prendono il posto di quello buono', async () => {
  risposte.set('/elenco.pem', { corpo: elencoPem(RADICE) });
  assert.equal((await F.aggiorna({ forza: true, url: `${base}/elenco.pem` })).ok, true);

  risposte.set('/pagina.html', { corpo: '<html><body>Manutenzione</body></html>' });
  const pagina = await F.aggiorna({ forza: true, url: `${base}/pagina.html` });
  assert.equal(pagina.ok, false);
  assert.match(pagina.error, /nessun certificato/);

  const assente = await F.aggiorna({ forza: true, url: `${base}/manca.pem` });
  assert.equal(assente.ok, false);
  assert.match(assente.error, /404/);

  risposte.set('/enorme.pem', { corpo: Buffer.alloc(9 * 1024 * 1024, 0x41) });
  const enorme = await F.aggiorna({ forza: true, url: `${base}/enorme.pem` });
  assert.equal(enorme.ok, false);
  assert.match(enorme.error, /tetto di \d+/, 'il rifiuto dice il numero, non tace');

  assert.equal((await F.analizzaImmagine(IMMAGINE)).firmatario, 'riconosciuto', 'resta l’elenco di prima');
  F._dimentica();
  assert.equal(await F.carica(), true, 'anche su disco');
  assert.equal((await F.analizzaImmagine(IMMAGINE)).firmatario, 'riconosciuto');
});

test('alla prima immagine firmata, un elenco in arrivo si aspetta invece di dire «non verificato»', async (t) => {
  F._dimentica();
  assert.ok(togliCartella(join(DATI, 'firmatari-c2pa')));
  let apri;
  risposte.set('/lento.pem', { corpo: elencoPem(RADICE), cancello: new Promise((r) => { apri = r; }) });
  // L'elenco arriva solo dopo che la prima lettura dell'immagine lo ha trovato ancora in viaggio.
  const isolata = require('../../src/main/services/provenienzaIsolata.js');
  const vera = isolata.analizza;
  t.after(() => { isolata.analizza = vera; });
  isolata.analizza = (...a) => vera(...a).then((r) => { setImmediate(apri); return r; });
  const giro = F.aggiorna({ forza: true, url: `${base}/lento.pem` });
  const r = await F.analizzaImmagine(IMMAGINE);
  assert.equal(r.firmatario, 'riconosciuto');
  await giro;
});

test('un aggiornamento non forzato con l’elenco fresco non scarica niente', async () => {
  risposte.set('/elenco.pem', { corpo: elencoPem(RADICE) });
  assert.equal((await F.aggiorna({ forza: true, url: `${base}/elenco.pem` })).ok, true);
  const esito = await F.aggiorna({ url: `${base}/non-chiamato.pem` });
  assert.equal(esito.saltato, true);
});

// #946 — l'elenco delle autorità di marcatura arriva insieme a quello dei firmatari:
// senza, una firma fatta con un certificato oggi scaduto sembrerebbe incompleta.
test('l’elenco delle autorità di marcatura si scarica col resto e resta su disco', async () => {
  F._dimentica();
  const RADICE_TSA = certificato({ organizzazione: 'Marcatura', ca: true });
  const tsa = certificato({ organizzazione: 'Marcatura', emittente: RADICE_TSA, usi: [USO_MARCA], rsa: true });
  const giorno = 86400000;
  const scaduta = pngFirmato({
    cert: certificato({ organizzazione: 'OpenAI, Inc.', emittente: RADICE, da: new Date(Date.now() - 10 * giorno), a: new Date(Date.now() - 2 * giorno) }),
    marca: { tsa, ora: new Date(Date.now() - 5 * giorno) },
  });
  risposte.set('/elenco.pem', { corpo: elencoPem(RADICE) });
  risposte.set('/marche.pem', { corpo: elencoPem(RADICE_TSA) });

  assert.equal((await F.aggiorna({ forza: true, url: `${base}/elenco.pem` })).ok, true);
  assert.match(P.frase(await F.analizzaImmagine(scaduta)), /incomplete/, 'senza l’elenco delle marche il certificato scaduto conta');

  assert.equal((await F.aggiorna({ forza: true, url: `${base}/elenco.pem`, urlTsa: `${base}/marche.pem` })).ok, true);
  assert.equal(F.stato().autoritaMarca, 1);
  assert.equal(P.frase(await F.analizzaImmagine(scaduta)), 'Generata con l’AI, lo dichiara OpenAI nelle credenziali firmate.');

  // Un elenco delle marche che non arriva non fa perdere quello buono, né quello dei firmatari.
  const esito = await F.aggiorna({ forza: true, url: `${base}/elenco.pem`, urlTsa: `${base}/manca.pem` });
  assert.equal(esito.ok, true);
  F._dimentica();
  assert.equal(await F.carica(), true);
  assert.equal(F.stato().autoritaMarca, 1, 'anche su disco');
  assert.equal(P.frase(await F.analizzaImmagine(scaduta)), 'Generata con l’AI, lo dichiara OpenAI nelle credenziali firmate.');
});
