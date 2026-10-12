// Unit test per src/shared/nomiSito.js (#590): quando un dominio scritto a mano è valido
// per una lista, e come si mostra un nome internazionale all'utente. Logica pura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { domainToASCII, domainToUnicode, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const N = require('../../src/shared/nomiSito.js');

test('valido: un nome con estensione, anche non latina; niente IP né nomi senza punto', () => {
  for (const d of ['facebook.com', 'bbc.co.uk', 'xn--mnchen-3ya.de', domainToASCII('сайт.рф'), domainToASCII('例え.テスト')]) {
    assert.equal(N.valido(d), true, d);
  }
  for (const d of ['facebook', '1.2.3.4', '', 'a.xn--', 'sito.c', '.sito.it', 'sito..it', '*.sito.it']) assert.equal(N.valido(d), false, d);
});

test('leggibile: il nome torna come l\'utente l\'ha scritto, uguale alla decodifica di Node', () => {
  for (const nome of ['münchen.de', 'сайт.рф', '例え.jp', '例え.テスト', 'ελληνικά.ελ', 'україна.укр', 'dämlich-über-straße.de', '🍕.ws']) {
    const ascii = domainToASCII(nome);
    assert.equal(N.leggibile(ascii), domainToUnicode(ascii), nome);
  }
  assert.equal(N.leggibile('blocked.test'), 'blocked.test');
  assert.equal(N.leggibile('xn--.com'), 'xn--.com');
});

test('leggibile: un nome che imita un sito latino resta nella forma «xn--»', () => {
  for (const finto of ['аррӏе.com', 'раураl.com']) {
    const ascii = domainToASCII(finto);
    assert.equal(N.leggibile(ascii), ascii, finto);
  }
});

test('sitoDi: il sito di un indirizzo, porta compresa', () => {
  assert.equal(N.sitoDi('http://xn--mnchen-3ya.de:8080/x'), 'münchen.de:8080');
  assert.equal(N.sitoDi('https://сайт.рф/'), 'сайт.рф');
  assert.equal(N.sitoDi('non è un indirizzo'), '');
});

test('dominio: quello che l\'utente scrive o incolla diventa il sito con cui si confronta (#225, #835)', () => {
  const casi = {
    'facebook.com': 'facebook.com',
    'https://www.YouTube.com/watch?v=1': 'youtube.com',
    '*.sito.it': 'sito.it',
    '.sito.it.': 'sito.it',
    'sito.it:8080/x': 'sito.it',
    '"github.com",': 'github.com',
    '«example.org»': 'example.org',
    'münchen.de': 'xn--mnchen-3ya.de',
  };
  for (const [scritto, atteso] of Object.entries(casi)) assert.equal(N.dominio(scritto), atteso, scritto);
  for (const no of ['', '   ', 'facebook', '1.2.3.4', 'https://', '<script>x</script>.com', 'a b.com', '🍕', 'x'.repeat(5000)]) {
    assert.equal(N.dominio(no), '', no.slice(0, 40));
  }
});

test('righeSiti: una casella di siti, un sito per riga; le righe scartate tornano col loro posto', () => {
  const r = N.righeSiti('tiktok.com\n\n  https://www.tiktok.com/@x \nfacebook\nwww.example.org\n');
  assert.deepEqual(r.valid, ['tiktok.com', 'example.org']);
  assert.deepEqual(r.invalid, ['facebook']);
  assert.deepEqual(r.scartate, [{ riga: 'facebook', dopo: 1 }]);
  assert.deepEqual(N.righeSiti(''), { valid: [], invalid: [], scartate: [] });
});

test('la pagina Sicurezza e la chat leggono un sito allo stesso modo: la regola sta solo in nomiSito.js', () => {
  const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pagina = fs.readFileSync(path.join(radice, 'src/pages/security/security.js'), 'utf8');
  assert.match(pagina, /SN_NOMI_SITO\.dominio/);
  assert.match(pagina, /SN_NOMI_SITO\.righeSiti/);
  assert.doesNotMatch(pagina, /function\s+(cleanDomain|parseBlacklist)\b/, 'la pagina legge di nuovo gli indirizzi da sé');
  globalThis.self = globalThis;
  for (const m of ['constants', 'nomiSito', 'preferences']) require(`../../src/shared/${m}.js`);
  const P = globalThis.SN_PREF;
  for (const scritto of ['https://www.Bücher.de/x', '*.sito.it', 'sito.it:8080', '"github.com"', 'www.example.org']) {
    const chat = P.buildPreferencePartial('siti_bloccati', `aggiungi ${scritto}`).elenco.voci;
    assert.deepEqual(chat, N.righeSiti(scritto).valid, scritto);
  }
});
