// Unit test di src/main/services/firmatariC2pa.js: l'elenco ufficiale dei firmatari
// C2PA si scarica, resta su disco, e uno scaricato male non prende il posto di quello buono.
// Il server è locale: la prova non tocca mai la rete vera.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { pngFirmato, certificato, elencoPem } from '../helpers/immagineFirmata.mjs';

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

const risposte = new Map();
let server;
let base;
before(async () => {
  server = createServer((req, res) => {
    const r = risposte.get(req.url);
    if (!r) { res.writeHead(404); res.end('non trovato'); return; }
    setTimeout(() => {
      res.writeHead(r.stato || 200, { 'Content-Type': 'text/plain' });
      res.end(r.corpo);
    }, r.ritardo || 0);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(DATI, { recursive: true, force: true });
});

test('mai scaricato: la firma è valida ma il firmatario resta non verificato', async () => {
  F._dimentica();
  const r = await F.analizzaImmagine(IMMAGINE);
  assert.equal(r.firmatario, 'non_verificato');
  assert.match(P.frase(r), /firma valida, firmatario non verificato/);
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

test('alla prima immagine firmata, un elenco in arrivo si aspetta invece di dire «non verificato»', async () => {
  F._dimentica();
  rmSync(join(DATI, 'firmatari-c2pa'), { recursive: true, force: true });
  risposte.set('/lento.pem', { corpo: elencoPem(RADICE), ritardo: 400 });
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
