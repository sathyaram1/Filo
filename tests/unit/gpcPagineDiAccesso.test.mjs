// Il GPC non parte sulle pagine di accesso dei provider noti (#1616): la regola sta in cookies.js (senzaGpc) e la usano
// tutte e due le porte, l'header Sec-GPC nell'unico onBeforeSendHeaders e la proprietà navigator.globalPrivacyControl
// in tabs.js. Il resto dei siti, YouTube e le pagine pubbliche di GitHub compresi, lo riceve come prima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Cookies = require('../../src/main/services/cookies.js');

test('le pagine di accesso dei provider noti restano senza GPC', () => {
  for (const u of [
    'https://accounts.google.com/signin/v2/identifier', 'https://accounts.google.com/',
    'https://login.microsoftonline.com/common/oauth2/authorize', 'https://appleid.apple.com/auth/authorize',
    'https://github.com/login', 'https://github.com/login/oauth/authorize?client_id=1', 'https://filo.eu.auth0.com/authorize',
    // Con una porta esplicita l'host resta lo stesso: così le prove servono un host di accesso dal loopback.
    'http://login.live.com:8080/login', 'https://accounts.google.com:8443/',
  ]) assert.equal(Cookies.senzaGpc(u), true, u);
});

test('ovunque altrove il GPC resta: YouTube, il resto di Google, le pagine pubbliche di GitHub', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=x', 'https://www.google.com/search?q=x', 'https://mail.google.com/',
    'https://github.com/owner/repo', 'https://github.com/', 'https://example.com/login',
    'https://tracker.example/signin?client_id=1&redirect_uri=x',
  ]) assert.equal(Cookies.senzaGpc(u), false, u);
});

test('un indirizzo che non è una pagina web non è esente, e uno storto non rompe niente', () => {
  for (const u of ['filo://home/home.html', 'about:blank', '', null, undefined, 'non è un url', 'javascript:alert(1)']) {
    assert.equal(Cookies.senzaGpc(u), false, String(u));
  }
});

test('le due porte del GPC passano dalla stessa regola, e i client hints dall\'unico onBeforeSendHeaders', () => {
  const cookies = readFileSync(join(ROOT, 'src', 'main', 'services', 'cookies.js'), 'utf8');
  const hook = cookies.slice(cookies.indexOf('function ensureHeaderHook'), cookies.indexOf('function applyGpc'));
  assert.match(hook, /'Sec-GPC'/);
  assert.match(hook, /!senzaGpc\(details\.url\)/, 'l\'header Sec-GPC si manda senza guardare senzaGpc');
  assert.match(hook, /completaClientHints\(details\.requestHeaders\)/, 'l\'unico onBeforeSendHeaders non completa i client hints');
  assert.equal((cookies.match(/onBeforeSendHeaders\(/g) || []).length, 1,
    'Electron tiene un solo onBeforeSendHeaders per sessione: il secondo sostituirebbe il primo');
  const tabs = readFileSync(join(ROOT, 'src', 'main', 'tabs.js'), 'utf8');
  const i = tabs.indexOf('"globalPrivacyControl"');
  assert.ok(i > 0, 'la proprietà navigator.globalPrivacyControl non si inietta più da tabs.js');
  assert.match(tabs.slice(Math.max(0, i - 600), i), /!Cookies\.senzaGpc\(current\)/, 'la proprietà GPC si inietta senza guardare senzaGpc');
});

test('il frame che chiede conta solo per le risorse, non per le navigazioni', () => {
  const pagina = { url: 'https://accounts.google.com/v3/signin/identifier' };
  assert.equal(Cookies.senzaGpc(Cookies.urlDelFrame({ resourceType: 'script', frame: pagina })), true);
  assert.equal(Cookies.senzaGpc(Cookies.urlDelFrame({ resourceType: 'image', frame: pagina })), true);
  // Dall'accesso si torna al sito: quella navigazione il GPC lo porta.
  assert.equal(Cookies.urlDelFrame({ resourceType: 'mainFrame', frame: pagina }), '');
  assert.equal(Cookies.urlDelFrame({ resourceType: 'subFrame', frame: pagina }), '');
  assert.equal(Cookies.urlDelFrame({ resourceType: 'script', frame: null }), '');
  assert.equal(Cookies.urlDelFrame({ resourceType: 'script', get frame() { throw new Error('frame distrutto'); } }), '');
  assert.equal(Cookies.urlDelFrame(null), '');
});

test('i client hints valgono per ogni sessione, incognito e proxy comprese', () => {
  const main = readFileSync(join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /app\.on\('session-created',[^\n]*ensureHeaderHook\(ses\)/,
    'una sessione nata fuori da cookies.js (incognito, proxy) partirebbe senza client hints');
});
