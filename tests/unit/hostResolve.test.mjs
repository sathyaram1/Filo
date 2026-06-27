// Unit test per src/main/services/hostResolve.js — "questo /sito.tld esiste?"
// usato dalla barra comando della dashboard per colorare di rosso (e non
// navigare verso) un dominio inventato.
//
// REGRESSIONE (#feedback "/sito.io inesistente porta a pagina bianca"): un
// dominio che il DNS NON conosce (ENOTFOUND) deve risultare "non esiste" → la
// dashboard lo colora di rosso e non naviga. Ma la politica è conservativa:
// IP/localhost e qualunque errore NON-ENOTFOUND (rete giù, transitorio) NON
// devono bloccare → tornano "esiste".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { hostResolves, isCheckableHost } = require(
  join(__dirname, '..', '..', 'src', 'main', 'services', 'hostResolve.js'),
);

const ok = async () => ({ address: '1.2.3.4', family: 4 });
const fail = (code) => async () => { const e = new Error(code); e.code = code; throw e; };

test('isCheckableHost: domini sì, IP/localhost/non-domini no', () => {
  assert.equal(isCheckableHost('example.com'), true);
  assert.equal(isCheckableHost('sub.example.io'), true);
  assert.equal(isCheckableHost('1.2.3.4'), false);   // IP letterale
  assert.equal(isCheckableHost('::1'), false);        // IPv6
  assert.equal(isCheckableHost('localhost'), false);
  assert.equal(isCheckableHost('app.localhost'), false);
  assert.equal(isCheckableHost('nodot'), false);      // serve almeno un punto
  assert.equal(isCheckableHost(''), false);
});

test('dominio che NON risolve (ENOTFOUND) → non esiste (rosso)', async () => {
  assert.equal(await hostResolves('nonesistedavvero-xyz.io', { lookup: fail('ENOTFOUND') }), false);
});

test('dominio che risolve → esiste', async () => {
  assert.equal(await hostResolves('example.com', { lookup: ok }), true);
});

test('errore di rete/transitorio (NON ENOTFOUND) → non bloccare (esiste)', async () => {
  assert.equal(await hostResolves('example.com', { lookup: fail('EAI_AGAIN') }), true);
  assert.equal(await hostResolves('example.com', { lookup: fail('ETIMEOUT') }), true);
});

test('IP e localhost → sempre esiste, senza interrogare il DNS', async () => {
  const boom = () => { throw new Error('non dovrebbe chiamare lookup'); };
  assert.equal(await hostResolves('1.2.3.4', { lookup: boom }), true);
  assert.equal(await hostResolves('localhost', { lookup: boom }), true);
});

test('host vuoto → non esiste', async () => {
  assert.equal(await hostResolves('', { lookup: ok }), false);
});
