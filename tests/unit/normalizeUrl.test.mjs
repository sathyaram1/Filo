// Unit test per normalizeUrl (src/main/tabs.js) — la funzione che decide, dalla
// barra degli indirizzi, se un input è un INDIRIZZO da aprire o un testo da
// CERCARE su Google. Electron è mockato così la logica gira sotto node:test
// senza avviare Electron (tabs.js richiede electron in cima).
//
// REGRESSIONE (#233 "gli indirizzi con porta finiscono in ricerca"): un input
// del tipo host:porta (localhost:3000, 127.0.0.1:8080, example.com:8443/admin)
// veniva classificato come ricerca invece che come indirizzo. Anche un host
// locale senza punto ("localhost") finiva in ricerca. Questi test ASSERISCONO
// che ora Filo NAVIGHI verso l'indirizzo (e con lo schema giusto: http per i
// server locali, https per i domini pubblici). Senza il fix diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock minimo di 'electron': tabs.js ne importa i simboli al require ma
// normalizeUrl (pura) non li usa. Basta che l'import non esploda.
const noop = () => {};
class FakeView {}
const electronMock = {
  WebContentsView: FakeView,
  Menu: class { constructor() { this.items = []; } append() {} },
  MenuItem: class { constructor(o) { Object.assign(this, o); } },
  session: { fromPartition: () => ({ setProxy: async () => {} }) },
  shell: { openExternal: noop },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

const { normalizeUrl } = require(join(__dirname, '..', '..', 'src', 'main', 'tabs.js'));

Module._load = origLoad; // ripristina: non inquinare gli altri test

// ─── il cuore del fix #233: host:porta naviga, non cerca ───────────────────

test('#233 localhost:3000 → naviga al server locale in http (non ricerca)', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
});

test('#233 127.0.0.1:8080 → naviga al loopback in http', () => {
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
});

test('#233 example.com:8443/admin → naviga al dominio pubblico in https, path incluso', () => {
  assert.equal(normalizeUrl('example.com:8443/admin'), 'https://example.com:8443/admin');
});

test('#233 host a etichetta singola con porta (myserver:8080) → naviga (intranet, http)', () => {
  assert.equal(normalizeUrl('myserver:8080'), 'http://myserver:8080');
});

test('#233 localhost senza porta né punto → naviga in http (non ricerca)', () => {
  assert.equal(normalizeUrl('localhost'), 'http://localhost');
});

test('#233 IP privato (router/IoT) → http', () => {
  assert.equal(normalizeUrl('192.168.1.1'), 'http://192.168.1.1');
  assert.equal(normalizeUrl('192.168.1.1:8080'), 'http://192.168.1.1:8080');
  assert.equal(normalizeUrl('10.0.0.5:9000'), 'http://10.0.0.5:9000');
});

// ─── comportamento invariato (nessuna regressione) ─────────────────────────

test('dominio con punto senza porta → https (come prima)', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('sub.example.com/path?q=1'), 'https://sub.example.com/path?q=1');
});

test('schema esplicito → passa immutato', () => {
  assert.equal(normalizeUrl('http://foo.com'), 'http://foo.com');
  assert.equal(normalizeUrl('https://foo.com:8443/x'), 'https://foo.com:8443/x');
  assert.equal(normalizeUrl('filo://newtab/'), 'filo://newtab/');
});

test('input vuoto → newtab', () => {
  assert.equal(normalizeUrl('   '), 'filo://newtab/');
  assert.equal(normalizeUrl(''), 'filo://newtab/');
});

test('testo di ricerca resta ricerca (parola singola, frase con spazi, ratio con spazio)', () => {
  assert.equal(normalizeUrl('reddit'), 'https://www.google.com/search?q=reddit');
  assert.ok(normalizeUrl('come stai oggi').startsWith('https://www.google.com/search?q='));
  // "score 3:0" ha uno spazio nella parte host → non è un indirizzo → ricerca.
  assert.ok(normalizeUrl('score 3:0').startsWith('https://www.google.com/search?q='));
  // porta fuori range (>65535) → non è un indirizzo valido → ricerca.
  assert.ok(normalizeUrl('capitolo:99999').startsWith('https://www.google.com/search?q='));
});

test('IP pubblico letterale con porta → https', () => {
  assert.equal(normalizeUrl('8.8.8.8:443'), 'https://8.8.8.8:443');
});
