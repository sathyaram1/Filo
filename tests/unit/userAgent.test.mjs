// Unit test della pulizia UA (src/main/userAgent.js). Verifica che i token che
// fanno scattare il blocco "browser embedded" dei provider di login vengano
// rimossi, e che la parte Chrome (quella che i siti vogliono vedere) resti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripEmbeddedUaTokens } = require('../../src/main/userAgent.js');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) filo/0.2.47 Chrome/126.0.6478.127 Electron/31.2.0 Safari/537.36';

test('rimuove il token Electron/<ver>', () => {
  const out = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  assert.ok(!/Electron/i.test(out), `Electron ancora presente: ${out}`);
});

test('rimuove il token nomeApp/<ver>', () => {
  const out = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  assert.ok(!/\bfilo\//i.test(out), `token filo/ ancora presente: ${out}`);
});

test('mantiene la parte Chrome con la versione (i siti la richiedono)', () => {
  const out = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  assert.match(out, /Chrome\/126\.0\.6478\.127/);
  assert.match(out, /Safari\/537\.36/);
  assert.match(out, /Mozilla\/5\.0/);
});

test('niente doppi spazi dopo la rimozione', () => {
  const out = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  assert.ok(!/ {2,}/.test(out), `doppi spazi in: ${out}`);
});

test('risultato è una UA Chrome plausibile e completa', () => {
  const out = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  assert.equal(
    out,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36',
  );
});

test('idempotente: ripassare una UA già pulita non la cambia', () => {
  const once = stripEmbeddedUaTokens(DEFAULT_UA, 'filo');
  const twice = stripEmbeddedUaTokens(once, 'filo');
  assert.equal(once, twice);
});

test('gestisce UA vuota/nulla senza esplodere', () => {
  assert.equal(stripEmbeddedUaTokens('', 'filo'), '');
  assert.equal(stripEmbeddedUaTokens(undefined, 'filo'), '');
});

test('nome app con caratteri regex non rompe (escaping)', () => {
  const ua = 'Mozilla/5.0 app.name/1.2.3 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36';
  const out = stripEmbeddedUaTokens(ua, 'app.name');
  assert.ok(!/app\.name\//.test(out));
  assert.ok(!/Electron/i.test(out));
  assert.match(out, /Chrome\/126/);
});
