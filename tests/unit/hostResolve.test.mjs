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

// ─── #433: i nomi della rete di casa non vanno chiesti al DNS ────────────────
//
// nas.lan, raspberrypi.local, fritz.box li assegna il router: il resolver
// pubblico risponde ENOTFOUND anche quando il dispositivo è lì e risponde.
// Chiederglielo faceva dichiarare "inesistente" un indirizzo valido → l'input
// diventava rosso e l'invio non apriva niente. Senza il fix questi assert
// diventano rossi (il lookup verrebbe chiamato e il risultato sarebbe false).

test('#433 i nomi della rete locale non si interrogano (e non bloccano)', async () => {
  const boom = () => { throw new Error('il DNS pubblico non va interrogato per un nome locale'); };
  for (const h of ['nas.lan', 'raspberrypi.local', 'stampante.home', 'fritz.box',
    'srv.internal', 'wiki.intranet', 'router.home.arpa', 'NAS.LAN']) {
    assert.equal(isCheckableHost(h), false, `${h} non deve essere interrogato`);
    assert.equal(await hostResolves(h, { lookup: boom }), true, `${h} deve poter essere aperto`);
  }
});

test('#433 i domini pubblici restano soggetti al controllo', async () => {
  assert.equal(isCheckableHost('example.com'), true);
  assert.equal(isCheckableHost('mylan.com'), true);   // non basta contenere "lan"
  assert.equal(isCheckableHost('local.example.com'), true);
  assert.equal(await hostResolves('nonesistedavvero-xyz.io', { lookup: fail('ENOTFOUND') }), false);
});
