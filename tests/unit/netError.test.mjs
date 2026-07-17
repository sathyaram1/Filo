// Unit test per src/shared/netError.js (SN_NET_ERROR) — logica pura della
// pagina d'errore di rete (#327): roundtrip URL, gate shouldShowErrorPage,
// validazione del bersaglio "Riprova", traduzione codici → messaggi.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/netError.js');
const NE = globalThis.SN_NET_ERROR;

test('buildUrl/parse: roundtrip di url, code e desc', () => {
  const u = NE.buildUrl('https://esempio.com/pagina?a=1&b=2', -105, 'ERR_NAME_NOT_RESOLVED');
  assert.ok(u.startsWith('filo://error/error.html?'));
  const p = NE.parse(u);
  assert.equal(p.target, 'https://esempio.com/pagina?a=1&b=2');
  assert.equal(p.code, '-105');
  assert.equal(p.desc, 'ERR_NAME_NOT_RESOLVED');
  assert.equal(NE.targetOf(u), 'https://esempio.com/pagina?a=1&b=2');
});

test('parse: url non della pagina errore → null', () => {
  assert.equal(NE.parse('https://esempio.com/'), null);
  assert.equal(NE.parse('filo://newtab/'), null);
  assert.equal(NE.targetOf('https://esempio.com/'), null);
});

test('sicurezza: bersagli non-web nella query NON diventano mai navigabili', () => {
  for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'data:text/html,x', '']) {
    const u = NE.buildUrl(bad, -105, 'ERR');
    assert.equal(NE.parse(u).target, null, `bersaglio ${JSON.stringify(bad)} deve essere scartato`);
    assert.equal(NE.targetOf(u), null);
  }
  // http/https/filo restano ri-tentabili.
  assert.ok(NE.isRetriableTarget('http://x.it/'));
  assert.ok(NE.isRetriableTarget('https://x.it/'));
  assert.ok(NE.isRetriableTarget('filo://editor/editor.html'));
  assert.ok(!NE.isRetriableTarget('javascript:alert(1)'));
});

test('shouldShowErrorPage: sì per errori di rete main-frame su pagine web', () => {
  assert.ok(NE.shouldShowErrorPage({ code: -105, failedUrl: 'https://refuso-xyz.com/', isMainFrame: true }));
  assert.ok(NE.shouldShowErrorPage({ code: -102, failedUrl: 'http://127.0.0.1:59999/', isMainFrame: true }));
});

test('shouldShowErrorPage: no per abort, subframe, pagina errore stessa, url vuoto', () => {
  // -3 = ERR_ABORTED (stop utente, redirect, ricreazione della view): non è un errore.
  assert.ok(!NE.shouldShowErrorPage({ code: -3, failedUrl: 'https://x.it/', isMainFrame: true }));
  assert.ok(!NE.shouldShowErrorPage({ code: 0, failedUrl: 'https://x.it/', isMainFrame: true }));
  assert.ok(!NE.shouldShowErrorPage({ code: -105, failedUrl: 'https://x.it/', isMainFrame: false }));
  assert.ok(!NE.shouldShowErrorPage({ code: -105, failedUrl: '', isMainFrame: true }));
  const errUrl = NE.buildUrl('https://x.it/', -105, 'ERR');
  assert.ok(!NE.shouldShowErrorPage({ code: -105, failedUrl: errUrl, isMainFrame: true }),
    'la pagina d\'errore che fallisce non deve mai innescare un loop');
});

test('describe: codici noti tradotti, ignoti → ripiego generico', () => {
  const dns = NE.describe(-105, 'ERR_NAME_NOT_RESOLVED');
  assert.match(dns.title, /Impossibile trovare/);
  assert.ok(dns.hint.length > 0);
  const offline = NE.describe(-106, 'ERR_INTERNET_DISCONNECTED');
  assert.equal(offline.offline, true);
  const refused = NE.describe(-102, 'ERR_CONNECTION_REFUSED');
  assert.match(refused.title, /rifiutato/);
  const unknown = NE.describe(-999, 'ERR_QUALCOSA_DI_STRANO');
  assert.match(unknown.title, /Impossibile caricare/);
  assert.equal(unknown.offline, false);
});

test('describe: ripiego per famiglia dalla descrizione simbolica', () => {
  assert.match(NE.describe(-9999, 'ERR_NAME_NOT_RESOLVED').title, /Impossibile trovare/);
  assert.equal(NE.describe(-9999, 'ERR_INTERNET_DISCONNECTED').offline, true);
  assert.match(NE.describe(-9999, 'ERR_CONNECTION_TIMED_OUT').title, /non risponde/);
});

test('describe: crash del renderer ha il suo messaggio', () => {
  const c = NE.describe(NE.CRASH_CODE, 'oom');
  assert.match(c.title, /si è bloccata/);
});
