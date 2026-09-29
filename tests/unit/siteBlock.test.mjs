// Unit test per il blocco apertura siti in blacklist (#170.3,
// src/main/services/siteBlock.js):
//   1) apertura diretta di un sito in blacklist  → BLOCCATO
//   2) nessuna provenienza è esente, né una ricerca né Filo o il modello (#590)
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

test('#590: nessuna provenienza scavalca la lista, nemmeno una pagina di risultati', () => {
  reset();
  // Scelta dell'owner: niente eccezione «arrivo da una ricerca». Un secondo argomento
  // (il vecchio `fromUrl`, il vecchio `viaFilo`) non deve riaprire nessuna porta.
  for (const ref of [
    'https://www.google.com/search?q=evil', 'https://www.bing.com/search?q=x', 'https://duckduckgo.com/?q=x',
    'https://searx.esempio.com/search?q=x', 'https://searx.xyz/search?q=x', 'https://sites.google.com/view/pagina',
    'https://baijiahao.baidu.com/s?id=1', 'filo://newtab/', '',
  ]) {
    assert.equal(SB.shouldBlockNavigation('https://evil.example/page', { fromUrl: ref, viaFilo: true }).block, true, `da ${ref || 'nessuna pagina'}`);
  }
  assert.equal('isSearchEngineUrl' in SB, false);
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

test('un IP non entra nella blacklist (non è un host per suffisso)', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['192.168.1.1'] });
  assert.equal(SB.status().blacklistSize, 0);
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

test('#590: il punto finale del nome non aggira la lista, e un dominio con accenti blocca davvero', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['evil.example', 'münchen-evil.de'] });
  assert.equal(SB.shouldBlockNavigation('https://evil.example./x').block, true);
  assert.equal(SB.shouldBlockNavigation('https://www.evil.example../x').block, true);
  // L'URL porta il nome in punycode: la voce scritta con l'accento deve combaciare.
  assert.equal(SB.shouldBlockNavigation('https://münchen-evil.de/').block, true);
  assert.equal(SB.shouldBlockNavigation('https://xn--mnchen-evil-thb.de/').block, true);
});

test('#590: un sito con l\'estensione in caratteri non latini entra in lista e blocca; il nome si legge com\'è scritto', () => {
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['сайт.рф', 'xn--r8jz45g.xn--zckzah', 'münchen.de'] });
  assert.equal(SB.status().blacklistSize, 3);
  const d = SB.shouldBlockNavigation('https://сайт.рф/pagina');
  assert.equal(d.block, true);
  assert.equal(d.host, 'сайт.рф');
  assert.equal(SB.shouldBlockNavigation('https://例え.テスト/').block, true);
  assert.equal(SB.shouldBlockNavigation('https://münchen.de/').host, 'münchen.de');
});
