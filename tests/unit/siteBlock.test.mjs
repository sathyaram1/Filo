// Unit test per il blocco apertura siti in blacklist (#170.3,
// src/main/services/siteBlock.js). Assertano i DUE CASI della spec:
//   1) apertura diretta di un sito in blacklist  → BLOCCATO
//   2) stessa apertura ma con referrer di un motore di ricerca → CONSENTITA
// #590 ha tolto il terzo caso ("originata da Filo → consentita"): la decisione
// non guarda più CHI apre, perché l'azione NAVIGA la propone il modello e una
// pagina ostile poteva usarla per scavalcare la lista.
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

test('#590: CHI apre non cambia la decisione — nessun parametro apre un varco', () => {
  reset();
  // Il vecchio viaFilo:true consentiva l'apertura. Ora è un campo ignoto e
  // ignorato: il sito resta bloccato anche quando ad aprirlo è Filo (azione
  // NAVIGA proposta dal modello, indirizzo scritto dall'utente, link).
  const d = SB.shouldBlockNavigation('https://evil.example/page', { viaFilo: true });
  assert.equal(d.block, true);
  assert.equal(d.host, 'evil.example');
});

test('#590: searx solo come dominio registrabile, non come label iniziale', () => {
  reset();
  // Il caso della spec: prima /(^|\.)searx\b/ non aveva ancora finale, quindi
  // searx.esempio.com si spacciava per motore di ricerca e apriva l'eccezione.
  for (const ref of [
    'https://searx.esempio.com/',
    'https://searx.evil.com/search?q=x',
    'https://www.searx.phishing.io/',
    'https://searx.com.evil.net/',
  ]) {
    assert.equal(SB.isSearchEngineUrl(ref), false, `${ref} non è un motore`);
    assert.equal(
      SB.shouldBlockNavigation('https://evil.example/', { fromUrl: ref }).block,
      true,
      `dovrebbe BLOCCARE con referrer-civetta ${ref}`,
    );
  }
  // Le istanze vere restano riconosciute.
  for (const ref of ['https://searx.be/', 'https://searx.info/search?q=x', 'https://www.searx.co.uk/']) {
    assert.equal(SB.isSearchEngineUrl(ref), true, `${ref} è un motore`);
    assert.equal(
      SB.shouldBlockNavigation('https://evil.example/', { fromUrl: ref }).block,
      false,
      `dovrebbe consentire da ${ref}`,
    );
  }
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

// ─── #590 giro 2: lo STESSO sito scritto in un'altra forma ───────────────────
//
// La rete risolve identici nomi che il confronto con la lista trattava come
// diversi: bastava scriverne uno e la lista non valeva più, su tutte le strade
// insieme (tutte chiedono a questa funzione).

test('#590: il PUNTO FINALE dell\'host non scavalca la lista', () => {
  reset();
  // "evil.example." è la forma assoluta di "evil.example": stessa pagina, in
  // qualunque browser. Prima passava: il confronto falliva su quel carattere.
  for (const u of [
    'https://evil.example./',
    'https://evil.example./pagina?x=1',
    'https://deep.sub.evil.example./',
    'https://evil.example../', // più punti: comunque lo stesso nome
    'https://EVIL.EXAMPLE./',
    'https://evil.example.:8443/',
  ]) {
    const d = SB.shouldBlockNavigation(u);
    assert.equal(d.block, true, `dovrebbe BLOCCARE ${u}`);
    // L'host che finisce nella notifica è quello pulito: senza punto finale e
    // in minuscolo, altrimenti l'utente legge un nome che non ha mai scritto.
    assert.ok(!d.host.endsWith('.'), `host senza punto finale per ${u}, letto "${d.host}"`);
    assert.equal(d.host, d.host.toLowerCase(), `host in minuscolo per ${u}`);
  }
  // E l'host riportato è quello vero anche per i sottodomini.
  assert.equal(SB.shouldBlockNavigation('https://sub.evil.example./').host, 'sub.evil.example');
  // Un sito fuori lista resta fuori: la pulizia non allarga il blocco.
  assert.equal(SB.shouldBlockNavigation('https://wikipedia.org./').block, false);
});

test('#590: il punto finale vale anche nella voce scritta dall\'utente e nel referrer', () => {
  // Voce della lista scritta con il punto finale: deve bloccare l'una e l'altra forma.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['evil.example.'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, true);
  assert.equal(SB.shouldBlockNavigation('https://evil.example./').block, true);

  // Un motore di ricerca col punto finale resta un motore di ricerca: la
  // pulizia non deve trasformare l'eccezione in un blocco a sorpresa.
  reset();
  assert.equal(SB.isSearchEngineUrl('https://www.google.com./search?q=x'), true);
  assert.equal(
    SB.shouldBlockNavigation('https://evil.example/', { fromUrl: 'https://www.google.com./search?q=x' }).block,
    false,
  );
});

test('#590: una voce scritta in alfabeto non latino entra nella lista e blocca davvero', () => {
  // L'indirizzo viaggia sulla rete in punycode: se la voce resta in unicode non
  // combacia mai — e prima veniva anche scartata in silenzio come "non valida",
  // lasciando l'utente convinto di aver bloccato qualcosa.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['münchen.example'] });
  assert.equal(SB.status().blacklistSize, 1);
  assert.equal(SB.shouldBlockNavigation('https://münchen.example/pagina').block, true);
  assert.equal(SB.shouldBlockNavigation('https://xn--mnchen-3ya.example/pagina').block, true);
  assert.equal(SB.shouldBlockNavigation('https://altro.example/').block, false);
});

test('#590: canonicalHost è la forma unica di un nome di host', () => {
  assert.equal(SB.canonicalHost('EVIL.Example.'), 'evil.example');
  assert.equal(SB.canonicalHost('evil.example...'), 'evil.example');
  assert.equal(SB.canonicalHost('  evil.example  '), 'evil.example');
  assert.equal(SB.canonicalHost('münchen.example'), 'xn--mnchen-3ya.example');
  assert.equal(SB.canonicalHost(''), '');
  assert.equal(SB.canonicalHost('.'), '');
  assert.equal(SB.canonicalHost(null), '');
});

// ─── #590 giro 2 — il sì dell'utente ("Apri comunque") si ricorda ────────────

test('#590: dopo "Apri comunque" il sito si apre, e ci si può navigare dentro', () => {
  reset();
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, true);
  SB.allowHost('evil.example');
  // La prima pagina.
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, false);
  // Dove il server rimbalza subito dopo (http→https, / → /home): è lo stesso
  // sito, ed era la porta che lasciava una scheda vuota e nessun modo di aprirlo.
  assert.equal(SB.shouldBlockNavigation('https://evil.example/home').block, false);
  // Un link cliccato dentro il sito, con la pagina del sito come partenza.
  assert.equal(
    SB.shouldBlockNavigation('https://evil.example/altra', { fromUrl: 'https://evil.example/' }).block,
    false,
  );
  // E i sottodomini dello stesso sito (www → nome nudo e ritorno).
  assert.equal(SB.shouldBlockNavigation('https://www.evil.example/').block, false);
});

test('#590: il sì vale per il sito che l\'utente ha messo in lista, non per gli altri', () => {
  reset();
  // Il blocco può scattare su un sottodominio: il sì si lega comunque alla voce
  // di lista, altrimenti il primo salto fra www e nome nudo ricadrebbe nel blocco.
  assert.equal(SB.allowHost('www.evil.example'), 'evil.example');
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, false);
  // Gli altri siti della lista restano bloccati: il sì non è un interruttore.
  assert.equal(SB.shouldBlockNavigation('https://ads.test/').block, true);
  assert.equal(SB.isAllowedHost('ads.test'), false);
  assert.equal(SB.isAllowedHost('evil.example'), true);
});

test('#590: cambiare la lista è il modo di tornare indietro su un "Apri comunque"', () => {
  const impostazioni = (blacklist) => ({ security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist } } });
  SB.configureFromSettings(impostazioni(['evil.example']));
  SB.allowHost('evil.example');
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, false);

  // Le Preferenze si risalvano a ogni modifica di QUALSIASI impostazione: se la
  // lista non cambia, il sì deve reggere (altrimenti durerebbe pochi secondi).
  SB.configureFromSettings(impostazioni(['evil.example']));
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, false);

  // La lista cambia davvero → i sì di questa sessione cadono.
  SB.configureFromSettings(impostazioni(['evil.example', 'ads.test']));
  assert.equal(SB.shouldBlockNavigation('https://evil.example/').block, true);
  assert.equal(SB.status().allowedSize, 0);
});

test('#590: un sito con l\'estensione non latina si può mettere in lista', () => {
  // .рф, .テスト, .中国, .укр esistono e si usano. Sulla rete viaggiano in
  // punycode (xn--…), e la vecchia regola pretendeva solo lettere latine: la
  // voce veniva scartata e quei siti non si potevano bloccare affatto.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['сайт.рф', '例え.テスト'] });
  assert.equal(SB.status().blacklistSize, 2);
  assert.equal(SB.shouldBlockNavigation('https://сайт.рф/pagina').block, true);
  assert.equal(SB.shouldBlockNavigation('https://xn--80aswg.xn--p1ai/pagina').block, true);
  assert.equal(SB.shouldBlockNavigation('https://例え.テスト/').block, true);
  // E quello che non è un nome di sito resta fuori, come prima.
  SB.setForTest({ enabled: true, useAdblockLists: false, blacklist: ['facebook', '1.2.3.4', 'x..y.com'] });
  assert.equal(SB.status().blacklistSize, 0);
});
