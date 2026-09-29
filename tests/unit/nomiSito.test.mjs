// Unit test per src/shared/nomiSito.js (#590): quando un dominio scritto a mano è valido
// per una lista, e come si mostra un nome internazionale all'utente. Logica pura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { domainToASCII, domainToUnicode } from 'node:url';

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
