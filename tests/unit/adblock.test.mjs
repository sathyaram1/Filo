// Unit test per il motore di ad-blocking (src/main/services/adblock.js):
// parsing delle liste (hosts + EasyList), matching per-dominio con suffissi e
// whitelist di base. electron è richiesto in modo pigro, quindi il modulo si
// carica qui senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const A = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'adblock.js'));

test('parseList: formato hosts (0.0.0.0 / 127.0.0.1) → estrae i domini', () => {
  const set = A.parseList([
    '# commento',
    '0.0.0.0 ads.example.com',
    '127.0.0.1 tracker.test',
    '0.0.0.0 localhost',      // non è un dominio: va ignorato
    '0.0.0.0 broadcasthost',  // niente punto: ignorato
  ].join('\n'));
  assert.ok(set.has('ads.example.com'));
  assert.ok(set.has('tracker.test'));
  assert.ok(!set.has('localhost'));
  assert.ok(!set.has('broadcasthost'));
});

test('parseList: regole EasyList con ancora di dominio (||dominio^)', () => {
  const set = A.parseList([
    '! Title: EasyList',
    '[Adblock Plus 2.0]',
    '||doubleclick.net^',
    '||cdn.ads.io^$third-party',   // opzioni dopo ^: il dominio si estrae comunque
    '@@||allowed.com^',            // eccezione: NON deve finire tra i bloccati
    'example.org##.banner',        // regola cosmetica: ignorata
    '/banner/*/img',               // regola di path generica: ignorata
  ].join('\n'));
  assert.ok(set.has('doubleclick.net'));
  assert.ok(set.has('cdn.ads.io'));
  assert.ok(!set.has('allowed.com'), 'le eccezioni @@ non si bloccano');
  assert.ok(!set.has('example.org'), 'le regole cosmetiche non sono domini');
});

test('isBlockedHost: match esatto e su sottodomini', () => {
  A.setDomainsForTest(['ads.example.com', 'doubleclick.net']);
  assert.equal(A.isBlockedHost('ads.example.com'), true);
  // un sottodominio di un dominio bloccato è bloccato anch'esso
  assert.equal(A.isBlockedHost('img.ads.example.com'), true);
  assert.equal(A.isBlockedHost('doubleclick.net'), true);
  assert.equal(A.isBlockedHost('sub.doubleclick.net'), true);
  // un dominio non in lista passa
  assert.equal(A.isBlockedHost('example.com'), false);
  assert.equal(A.isBlockedHost('notads.com'), false);
});

test('whitelist di base: i domini legittimi non si bloccano mai', () => {
  // Anche se finissero in lista per errore, la whitelist vince.
  A.setDomainsForTest(['google.com', 'youtube.com', 'paypal.com']);
  assert.equal(A.isBlockedHost('google.com'), false);
  assert.equal(A.isBlockedHost('mail.google.com'), false);
  assert.equal(A.isBlockedHost('www.youtube.com'), false);
  assert.equal(A.isBlockedHost('paypal.com'), false);
  assert.ok(A.isWhitelistedHost('accounts.google.com'));
});

test('isBlockedUrl: estrae l\'host dall\'URL', () => {
  A.setDomainsForTest(['ad-server.test']);
  assert.equal(A.isBlockedUrl('https://ad-server.test/banner.js?x=1'), true);
  assert.equal(A.isBlockedUrl('https://sub.ad-server.test/x'), true);
  assert.equal(A.isBlockedUrl('https://legit.example/page'), false);
  assert.equal(A.isBlockedUrl('non-un-url'), false);
});

test('isEnabled: default-on, disattivabile col toggle', () => {
  assert.equal(A.isEnabled({}), true);                                         // assente → on
  assert.equal(A.isEnabled({ security: {} }), true);
  assert.equal(A.isEnabled({ security: { adblock: {} } }), true);
  assert.equal(A.isEnabled({ security: { adblock: { enabled: true } } }), true);
  assert.equal(A.isEnabled({ security: { adblock: { enabled: false } } }), false);
});
