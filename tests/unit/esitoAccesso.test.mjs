// #678.2 — un accesso che non riesce torna con la frase per l'utente, e un
// accesso abbandonato nel browser non resta in corso per sempre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { spiegaErroreAccesso, FRASI } = require('../../src/main/auth/esitoAccesso.js');
const { _internals } = require('../../src/main/auth/google-auth.js');

function conCodice(code, message = 'x') {
  const e = new Error(message);
  e.code = code;
  return e;
}

test('le cause note diventano la loro frase, mai il messaggio tecnico', () => {
  for (const code of Object.keys(FRASI)) {
    const r = spiegaErroreAccesso(conCodice(code, 'OAuth: dettaglio tecnico'));
    assert.equal(r.code, code);
    assert.equal(r.error, FRASI[code]);
    assert.doesNotMatch(r.error, /OAuth|dettaglio/);
  }
});

test('senza rete: il fetch che fallisce dice che manca la connessione', () => {
  const fetchFallito = new TypeError('fetch failed');
  fetchFallito.cause = conCodice('ENOTFOUND');
  assert.equal(spiegaErroreAccesso(fetchFallito).code, 'rete');
  assert.equal(spiegaErroreAccesso(conCodice('ECONNRESET')).code, 'rete');
  assert.match(spiegaErroreAccesso(fetchFallito).error, /connessione/);
});

test('un errore sconosciuto, o nessun errore, ha comunque una frase', () => {
  for (const e of [new Error('Firebase signInWithIdp fallito (400): {...}'), null, undefined, 'stringa']) {
    const r = spiegaErroreAccesso(e);
    assert.equal(r.code, 'servizio');
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('un accesso interrotto (browser chiuso, sostituito, scaduto) libera la porta e dice perché', async () => {
  const loop = await _internals.startLoopback('stato');
  const attesa = loop.waitForCode();
  loop.abort(conCodice('scaduto'));
  await assert.rejects(attesa, (e) => e.code === 'scaduto');
  const porta = new URL(loop.redirectUri).port;
  await assert.rejects(new Promise((res, rej) => {
    http.get(`http://127.0.0.1:${porta}/?code=c&state=stato`, res).on('error', rej);
  }));
});

test('consenso negato nel browser: annullato, non un guasto', async () => {
  const loop = await _internals.startLoopback('stato');
  const attesa = loop.waitForCode();
  await new Promise((res, rej) => {
    http.get(`${loop.redirectUri}/?error=access_denied&state=stato`, (r) => { r.resume(); r.on('end', res); }).on('error', rej);
  });
  await assert.rejects(attesa, (e) => spiegaErroreAccesso(e).code === 'annullato');
});
