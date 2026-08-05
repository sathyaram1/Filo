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

test('#230: referrer che INIZIA per google./yahoo./yandex. ma NON è il motore → NON concede eccezione', () => {
  reset();
  // Domini-civetta: 'google'/'yahoo'/'yandex' sono solo una sottodominio-label,
  // il dominio registrabile è un altro. Prima del fix passavano per motori di
  // ricerca e il sito in blacklist si apriva lo stesso.
  for (const ref of [
    'https://yahoo.phishing.io/',
    'https://google.evil.com/',
    'https://yandex.bad.net/',
    'https://google.com.evil.com/',
    'https://www.google.co.evil.com/',
  ]) {
    const d = SB.shouldBlockNavigation('https://evil.example/', { fromUrl: ref });
    assert.equal(d.block, true, `dovrebbe BLOCCARE con referrer-civetta ${ref}`);
    assert.equal(SB.isSearchEngineUrl(ref), false, `${ref} non è un motore`);
  }
});

test('#230: i motori multi-TLD legittimi restano riconosciuti', () => {
  reset();
  for (const ref of [
    'https://www.google.com/search?q=x',
    'https://google.co.uk/search?q=x',
    'https://www.google.com.au/search?q=x',
    'https://search.yahoo.com/search?p=x',
    'https://es.search.yahoo.com/search?p=x',
    'https://yahoo.co.jp/',
    'https://yandex.ru/search/?text=x',
    'https://yandex.com.tr/search/?text=x',
  ]) {
    assert.equal(SB.isSearchEngineUrl(ref), true, `${ref} è un motore`);
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

test('voci senza estensione (es. "facebook") non entrano nella blacklist e non fingono di bloccare', () => {
  // Pre-condizione: senza validazione, "facebook" entrava nel Set ma non
  // matchava mai un host reale (facebook.com/com), dando falsa sicurezza.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['facebook'] });
  assert.equal(SB.status().blacklistSize, 0, '"facebook" non deve entrare nel Set');
  assert.equal(SB.shouldBlockNavigation('https://www.facebook.com/feed').block, false);
});

test('un URL intero in blacklist viene normalizzato a dominio e blocca davvero', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['https://www.facebook.com/feed'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('https://www.facebook.com/feed').block, true);
  assert.equal(SB.shouldBlockNavigation('https://m.facebook.com/x').block, true);
});

test('un IP in blacklist blocca davvero (host reale, match esatto)', () => {
  // Pre-condizione: gli IP venivano scartati in silenzio dalla blacklist —
  // l'utente scriveva 192.168.1.1, non vedeva nulla di anomalo e credeva di
  // essere protetto mentre il sito si apriva regolarmente.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['192.168.1.1'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('http://192.168.1.1/admin').block, true);
  // Con la porta, e con l'URL intero scritto dall'utente.
  assert.equal(SB.shouldBlockNavigation('http://192.168.1.1:8080/x').block, true);
  SB.setForTest({ blacklist: ['http://192.168.1.1:8080/admin'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('http://192.168.1.1/').block, true);
});

test('per un IP il match è esatto: nessun blocco a sorpresa per "suffisso"', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['192.168.1.1'] });
  assert.equal(SB.shouldBlockNavigation('http://10.0.0.1/').block, false);
  // "0.1" non è un suffisso di 192.168.1.1: metterlo in lista non blocca l'IP.
  SB.setForTest({ blacklist: ['1.1'] });
  assert.equal(SB.shouldBlockNavigation('http://192.168.1.1/').block, false);
});

test('IPv6 fra parentesi: entra in blacklist intero e blocca', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['[::1]'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('http://[::1]:9000/x').block, true);
});

test('configureFromSettings scarta le voci non valide dalla blacklist salvata', () => {
  SB.configureFromSettings({
    security: { siteBlock: { enabled: true, useAdblockLists: false,
      blacklist: ['facebook', 'evil.example', 'localhost', 'ADS.test/path'] } },
  });
  // Solo evil.example e ads.test sono domini validi.
  assert.equal(SB.status().blacklistSize, 2);
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, true);
  assert.equal(SB.shouldBlockNavigation('https://ads.test/').block, true);
});
