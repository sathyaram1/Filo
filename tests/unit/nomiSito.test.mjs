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

// #843 — la riduzione di tutti gli elenchi di siti: quello che l'utente incolla diventa il nome con cui il sito si confronta.
test('daScritto: un indirizzo incollato, con www., maiuscole, spazi e virgolette, diventa il nome del sito', () => {
  const casi = {
    'https://www.Docs.Google.com/document/d/x': 'docs.google.com',
    '  docs.google.com  ': 'docs.google.com',
    'WWW.ESEMPIO.IT': 'esempio.it',
    'http://esempio.it:8080/percorso?q=1#a': 'esempio.it',
    '*.esempio.it': 'esempio.it',
    '.esempio.it.': 'esempio.it',
    '«esempio.it»,': 'esempio.it',
    '"https://esempio.it/x";': 'esempio.it',
    'münchen.de': 'xn--mnchen-3ya.de',
    'esempio.it/una/pagina': 'esempio.it',
  };
  for (const [scritto, atteso] of Object.entries(casi)) assert.equal(N.daScritto(scritto), atteso, scritto);
  for (const no of ['', '   ', 'facebook', '127.0.0.1', 'http://localhost:3000/', 'non è un sito', '<b>x</b>', '😀', 'ftp://', 'https://']) {
    assert.equal(N.daScritto(no), '', no);
  }
  assert.equal(N.daScritto(null), '');
  assert.equal(N.daScritto('a'.repeat(5000) + '.com').length > 0, true, 'un nome lunghissimo non rompe niente');
});

test('elencoDaTesto e testoDaElenco: i siti ridotti senza doppioni, le righe scartate dette e rimesse al loro posto', () => {
  const r = N.elencoDaTesto('https://www.Docs.Google.com/document/d/x\n\nfaceb\ndocs.google.com\n  esempio.it  \n127.0.0.1');
  assert.deepEqual(r.valid, ['docs.google.com', 'esempio.it']);
  assert.deepEqual(r.invalid, ['faceb', '127.0.0.1']);
  assert.equal(N.testoDaElenco(r.valid, r.scartate), 'docs.google.com\nfaceb\nesempio.it\n127.0.0.1');
  assert.equal(N.testoDaElenco(['xn--mnchen-3ya.de']), 'münchen.de');
  assert.equal(N.testoDaElenco(null), '');
  assert.deepEqual(N.elencoDaTesto('').valid, []);
});

test('elencoDaTesto: più siti incollati sulla stessa riga valgono uno per uno, un indirizzo con virgole resta uno', () => {
  assert.deepEqual(N.elencoDaTesto('docs.google.com, figma.com').valid, ['docs.google.com', 'figma.com']);
  assert.deepEqual(N.elencoDaTesto('docs.google.com figma.com;notion.so').valid, ['docs.google.com', 'figma.com', 'notion.so']);
  const r = N.elencoDaTesto('faceb, figma.com');
  assert.deepEqual(r.valid, ['figma.com']);
  assert.deepEqual(r.invalid, ['faceb']);
  assert.equal(N.testoDaElenco(r.valid, r.scartate), 'faceb\nfigma.com');
  assert.deepEqual(N.elencoDaTesto('https://www.esempio.it/cerca?q=a,b c').valid, ['esempio.it']);
  // Una riga dove nessun pezzo è un sito resta una riga: scartata, si dice e si rimette com'era scritta.
  const s = N.elencoDaTesto('studio rossi\nfigma.com');
  assert.deepEqual(s.invalid, ['studio rossi']);
  assert.equal(N.testoDaElenco(s.valid, s.scartate), 'studio rossi\nfigma.com');
  // Anche accanto a un sito: quello che non è un sito si dice intero, com'era scritto, e torna al suo posto (#718.3).
  const m = N.elencoDaTesto('banca.it studio rossi, poste.it\nstudio, rossi; figma.com');
  assert.deepEqual(m.valid, ['banca.it', 'poste.it', 'figma.com']);
  assert.deepEqual(m.invalid, ['studio rossi', 'studio, rossi']);
  assert.equal(N.testoDaElenco(m.valid, m.scartate), 'banca.it\nstudio rossi\nposte.it\nstudio, rossi\nfigma.com');
});

test('pezziDi: un sito per pezzo, il resto fra due siti in un pezzo solo; le parole da saltare separano', () => {
  assert.deepEqual(N.pezziDi('  studio   rossi  '), ['studio   rossi']);
  assert.deepEqual(N.pezziDi('studio rossi banca.it'), ['studio rossi', 'banca.it']);
  assert.deepEqual(N.pezziDi('https://x.it/?a=1,2'), ['https://x.it/?a=1,2']);
  assert.deepEqual(N.elencoDaTesto('https://mail.google.com/mail/u/0/, news.bbc.co.uk').valid, ['mail.google.com', 'news.bbc.co.uk']);
  const salta = new Set(['e', 'il', 'sito']);
  assert.deepEqual(N.pezziDi('il sito studio rossi e faceb e banca.it', salta), ['studio rossi', 'faceb', 'banca.it']);
  assert.deepEqual(N.pezziDi('il sito e', salta), []);
  assert.deepEqual(N.pezziDi(''), []);
  assert.deepEqual(N.pezziDi(null), []);
});

test('ripulisciElenco: un elenco salvato prima della riduzione torna ai nomi; quello che non è un sito resta com\'era', () => {
  assert.deepEqual(N.ripulisciElenco(['https://docs.google.com/document', 'DOCS.google.com', 'www.esempio.it', '127.0.0.1', '', 3, '  ']),
    ['docs.google.com', 'esempio.it', '127.0.0.1']);
  assert.equal(N.ripulisciElenco('rotto'), 'rotto');
});

test('copre: la voce vale per il sito e i suoi sottodomini, non per un nome che finisce allo stesso modo', () => {
  assert.equal(N.copre('google.com', 'docs.google.com'), true);
  assert.equal(N.copre('google.com', 'google.com'), true);
  assert.equal(N.copre('google.com', 'Docs.Google.Com.'), true);
  assert.equal(N.copre('google.com', 'notgoogle.com'), false);
  assert.equal(N.copre('docs.google.com', 'google.com'), false);
  assert.equal(N.copre('', 'google.com'), false);
  assert.equal(N.copre('google.com', ''), false);
});
