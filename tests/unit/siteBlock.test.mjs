// Unit test per il blocco apertura siti in blacklist (#170.3,
// src/main/services/siteBlock.js). Assertano i TRE CASI richiesti dalla spec:
//   1) apertura diretta di un sito in blacklist  → BLOCCATO
//   2) stessa apertura ma con referrer di un motore di ricerca → CONSENTITA
//   3) stessa apertura ma originata da Filo (viaFilo) → CONSENTITA
// più i bordi: schemi non-web, host non in lista, blocco disattivato, match per
// suffisso/sottodominio. electron è richiesto in modo pigro (solo da adblock),
// e qui usiamo useAdblockLists:false, quindi il modulo gira senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SB = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'siteBlock.js'));

// Blacklist dedicata di test; niente liste pubbliche per renderlo deterministico.
function reset() {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['evil.example', 'ads.test'] });
}

test('caso 1: apertura DIRETTA di un sito in blacklist → bloccato', () => {
  reset();
  const d = SB.shouldBlockNavigation('https://evil.example/page');
  assert.equal(d.block, true);
  assert.equal(d.host, 'evil.example');
});

test('caso 2: apertura da un motore di ricerca (referrer Google) → consentita', () => {
  reset();
  const d = SB.shouldBlockNavigation('https://evil.example/page', {
    fromUrl: 'https://www.google.com/search?q=evil',
  });
  assert.equal(d.block, false);
});

test('caso 3: apertura originata da Filo (viaFilo) → consentita', () => {
  reset();
  const d = SB.shouldBlockNavigation('https://evil.example/page', { viaFilo: true });
  assert.equal(d.block, false);
});

test('referrer di ricerca robusto su TLD e sottodomini diversi', () => {
  reset();
  for (const ref of [
    'https://www.google.it/search?q=x',
    'https://google.co.uk/search?q=x',
    'https://www.bing.com/search?q=x',
    'https://duckduckgo.com/?q=x',
    'https://search.brave.com/search?q=x',
    'https://search.yahoo.com/search?p=x',
    'https://yandex.ru/search/?text=x',
  ]) {
    const d = SB.shouldBlockNavigation('https://evil.example/', { fromUrl: ref });
    assert.equal(d.block, false, `dovrebbe consentire da ${ref}`);
  }
});

test('referrer NON di ricerca non concede eccezioni', () => {
  reset();
  const d = SB.shouldBlockNavigation('https://evil.example/', {
    fromUrl: 'https://news.example/article',
  });
  assert.equal(d.block, true);
});

test('match per suffisso: i sottodomini di un dominio in blacklist sono bloccati', () => {
  reset();
  assert.equal(SB.shouldBlockNavigation('https://deep.sub.evil.example/').block, true);
  assert.equal(SB.isBlacklistedHost('a.b.ads.test'), true);
});

test('host non in blacklist → consentito', () => {
  reset();
  assert.equal(SB.shouldBlockNavigation('https://wikipedia.org/').block, false);
});

test('schemi non-web (filo://, about:, data:) non si bloccano mai', () => {
  reset();
  assert.equal(SB.shouldBlockNavigation('filo://newtab/').block, false);
  assert.equal(SB.shouldBlockNavigation('about:blank').block, false);
  assert.equal(SB.shouldBlockNavigation('data:text/html,evil.example').block, false);
});

test('blocco disattivato → non blocca nulla', () => {
  SB.setForTest({ enabled: false, useAdblockLists: false, blacklist: ['evil.example'] });
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, false);
});

test('configureFromSettings legge security.siteBlock', () => {
  SB.configureFromSettings({
    security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: ['HTTP://Bad.Example/path'] } },
  });
  // normalizza schema/path/case
  assert.equal(SB.shouldBlockNavigation('https://bad.example/x').block, true);
});

test('isSearchEngineUrl riconosce i motori e ignora gli altri', () => {
  assert.equal(SB.isSearchEngineUrl('https://www.google.com/search?q=a'), true);
  assert.equal(SB.isSearchEngineUrl('https://example.com/'), false);
});
