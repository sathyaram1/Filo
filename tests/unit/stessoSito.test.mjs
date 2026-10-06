// «Stesso sito» ha una definizione sola (src/main/services/stessoSito.js): il rumore anti-impronta e i cookie la
// chiamano entrambi, così uno script presente su alice.github.io e bob.github.io vede due browser diversi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Sito = require('../../src/main/services/stessoSito.js');
const FP = require('../../src/main/services/fingerprint.js');
const Cookies = require('../../src/main/services/cookies.js');

const seme = (url) => FP.configForHref(url).seed;

for (const mode of ['default', 'privacy']) {
  test(`impronte (${mode}): siti diversi sulla stessa piattaforma, sotto un suffisso nazionale o su IP diversi hanno semi diversi`, () => {
    FP.setMode({ security: { fingerprint: { mode } } });
    for (const [a, b] of [
      ['https://alice.github.io/', 'https://bob.github.io/progetto/'],
      ['https://uno.vercel.app/', 'https://due.vercel.app/'],
      ['https://blog-a.blogspot.com/', 'https://blog-b.blogspot.com/'],
      ['https://shop.com.tw/', 'https://altro.com.tw/'],
      ['https://negozio.co.id/', 'https://toko.co.id/'],
      ['https://tienda.com.co/', 'https://otra.com.co/'],
      ['https://uno.com.pe/', 'https://due.com.pe/'],
      ['https://ena.com.gr/', 'https://dio.com.gr/'],
      ['https://comune.bergamo.it/', 'https://altro.bergamo.it/'],
      ['https://uno.com.pg/', 'https://due.com.pg/'],
      ['https://a.chiyoda.tokyo.jp/', 'https://b.chiyoda.tokyo.jp/'],
      ['https://a.lib.ca.us/', 'https://b.lib.ca.us/'],
      ['https://x.公司.cn/', 'https://y.公司.cn/'],
      ['http://192.168.1.10/', 'http://10.0.1.10/'],
      ['http://[::1]:8080/', 'http://[fe80::1]/'],
      ['http://localhost:3000/', 'http://127.0.0.1:3000/'],
    ]) {
      assert.ok(seme(a) > 0 && seme(b) > 0, `${a} e ${b} devono essere protetti`);
      assert.notEqual(seme(a), seme(b), `${a} e ${b} sono due siti`);
    }
  });

  test(`impronte (${mode}): i sottodomini dello stesso sito condividono il seme`, () => {
    FP.setMode({ security: { fingerprint: { mode } } });
    for (const [a, b] of [
      ['https://a.example.com/', 'https://b.example.com/x'],
      ['https://news.bbc.co.uk/', 'https://www.bbc.co.uk/'],
      ['https://www.shop.com.tw/', 'https://shop.com.tw/cart'],
      ['https://www.alice.github.io/', 'https://alice.github.io/'],
      ['https://www.tienda.com.co/', 'https://tienda.com.co/carrito'],
      ['https://example.com./', 'https://EXAMPLE.com/'],
    ]) assert.equal(seme(a), seme(b), `${a} e ${b} sono lo stesso sito`);
    // accounts.google.com è esente dal rumore (login): il seme del suo sito resta quello di google.com.
    assert.equal(FP.seedForHref('https://accounts.google.com/'), FP.seedForHref('https://www.google.com/'));
    assert.equal(FP.seedForHref('https://accounts.google.com/'), seme('https://www.google.com/search?q=filo'));
  });
}

test('il sito di un indirizzo: dominio registrabile, piattaforme comprese, IP e localhost interi', () => {
  for (const [url, sito] of [
    ['https://accounts.google.com/', 'google.com'],
    ['https://news.bbc.co.uk/', 'bbc.co.uk'],
    ['https://example.com/', 'example.com'],
    ['https://alice.github.io/', 'alice.github.io'],
    ['https://myblog.wordpress.com/', 'wordpress.com'],
    ['https://github.io/', 'github.io'],
    ['http://192.168.1.10:8080/x', '192.168.1.10'],
    ['http://localhost:3000/', 'localhost'],
    ['alice.github.io', 'alice.github.io'],
    // Regole a jolly, a tre etichette, con eccezione e non latine: la sezione ICANN della lista pubblica intera.
    ['https://uno.com.pg/', 'uno.com.pg'],
    ['https://www.scuola.distretto.sch.uk/', 'scuola.distretto.sch.uk'],
    ['https://www.a.chiyoda.tokyo.jp/', 'a.chiyoda.tokyo.jp'],
    ['https://www.city.kawasaki.jp/', 'city.kawasaki.jp'],
    ['https://www.x.公司.cn/', 'x.xn--55qx5d.cn'],
    ['https://www.foo.kw/', 'foo.kw'],
  ]) assert.equal(Sito.sitoDi(url), sito, url);
  for (const vuoto of ['', '   ', null, undefined, 'about:blank', 'data:text/plain,x', 'non è un indirizzo']) {
    assert.equal(Sito.sitoDi(vuoto), null, String(vuoto));
  }
});

test('impronte e cookie chiamano la stessa funzione', () => {
  const vera = Sito.sitoDi;
  const viste = [];
  Sito.sitoDi = (url) => { viste.push(url); return 'sito-spia.test'; };
  try {
    assert.equal(Cookies.registrableOf('https://uno.example/'), 'sito-spia.test');
    FP.setMode({ security: { fingerprint: { mode: 'default' } } });
    assert.equal(FP.configForHref('https://due.example/').seed, FP.seedForOrigin('sito-spia.test'));
    assert.deepEqual(viste, ['https://uno.example/', 'https://due.example/']);
  } finally {
    Sito.sitoDi = vera;
  }
});

test('una sola lista di suffissi: la Public Suffix List di safebrowse/psl.js', () => {
  const radice = fileURLToPath(new URL('../../', import.meta.url));
  const src = join(radice, 'src');
  const fuori = [];
  const giro = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) giro(p);
      else if (/\.(m?js)$/.test(nome) && /['"]co\.uk['"]/.test(readFileSync(p, 'utf8'))) {
        fuori.push(relative(radice, p).split('\\').join('/'));
      }
    }
  };
  giro(src);
  assert.deepEqual(fuori, ['src/main/services/safebrowse/psl.js']);
});

// Una scelta salvata quando gov.it o com.co contavano come un sito solo non deve smettere di valere: la voce copre ancora
// i siti sotto di lei (fidati, banner, accessi, regole di paese); una voce che non è un suffisso resta un sito solo.
test('scelte salvate su un dominio diventato suffisso pubblico continuano a valere sui siti sotto di lui', () => {
  assert.equal(Sito.voceSalvata('https://www.agenziaentrate.gov.it/portale/', ['gov.it']), 'gov.it');
  assert.equal(Sito.voceSalvata('https://tienda.com.co/', new Set(['com.co'])), 'com.co');
  assert.equal(Sito.voceSalvata('https://comune.milano.it/', ['milano.it']), 'milano.it');
  assert.equal(Sito.voceSalvata('https://www.example.com/', ['example.com']), 'example.com');
  assert.equal(Sito.voceSalvata('https://alice.github.io/', ['github.io']), null, 'una piattaforma non copre i suoi utenti');
  assert.equal(Sito.voceSalvata('https://shop.example.com/', ['other.example.com']), 'other.example.com',
    'una voce col sottodominio vale per il suo sito: il vaso di cookie è uno per sito');
  assert.equal(Sito.voceSalvata('https://shop.example.org/', ['other.example.com']), null);
  assert.equal(Sito.voceSalvata('http://10.0.1.10/', ['1.10']), null);

  assert.equal(Cookies.partitionForUrl('https://www.agenziaentrate.gov.it/', new Set(['gov.it'])), 'persist:filo-priv-gov.it',
    'il vaso persistente che tiene l\'accesso resta quello di prima');
  assert.match(Cookies.partitionForUrl('https://alice.github.io/', new Set(['github.io'])), /^filo-priv-alice\.github\.io/);
  assert.equal(Cookies.isBannerSiteIn(['gov.it'], 'https://www.salute.gov.it/'), true);
  assert.equal(Cookies.isBannerSiteIn(['salute.gov.it'], 'https://www.inps.gov.it/'), false);

  const elenco = new Sito.ElencoSiti(['gov.it', 'esempio.it']);
  assert.ok(elenco.has('salute.gov.it') && elenco.has('esempio.it') && elenco.has('gov.it'));
  assert.ok(!elenco.has('altro.it') && !elenco.has('x.esempio.it') && !elenco.has(''));
});

// #796 giro 5 — un sito fidato scritto col suo sottodominio vale per il suo sito; un suffisso pubblico non è un sito,
// e la chat non lo aggiunge fra i fidati (la pagina Sicurezza lo chiede al main: tests/security-settings.spec.mjs).
test('la voce scritta col sottodominio vale per il sito; un suffisso pubblico non entra fra i fidati', () => {
  assert.equal(Sito.voceSalvata('https://webmail.libero.it/', ['webmail.libero.it']), 'webmail.libero.it');
  assert.equal(Sito.voceSalvata('https://mail.google.com/', new Set(['mail.google.com'])), 'mail.google.com');
  assert.match(Cookies.partitionForUrl('https://webmail.libero.it/', new Set(['webmail.libero.it'])), /^persist:/);
  assert.ok(new Sito.ElencoSiti(['webmail.libero.it']).has('libero.it'));
  assert.equal(Sito.voceSalvata('https://alice.github.io/', ['bob.github.io']), null, 'due utenti della piattaforma restano due siti');
  assert.equal(Sito.voceSalvata('https://www.bbc.co.uk/', ['www.argos.co.uk']), null);

  for (const d of ['co.uk', 'gov.it', 'com.co', 'milano.it']) assert.equal(Sito.suffissoPubblico(d), true, d);
  for (const d of ['bbc.co.uk', 'github.io', 'libero.it']) assert.equal(Sito.suffissoPubblico(d), false, d);

  require('../../src/shared/nomiSito.js');
  require('../../src/shared/preferences.js');
  const P = globalThis.SN_PREF;
  assert.match(String(P.buildPreferencePartial('siti_fidati_cookie', 'aggiungi co.uk').rifiuto || ''), /non è un sito/);
  assert.deepEqual(P.buildPreferencePartial('siti_fidati_cookie', 'aggiungi bbc.co.uk').elenco.voci, ['bbc.co.uk']);
  assert.ok(P.buildPreferencePartial('siti_fidati_cookie', 'togli gov.it').elenco, 'una voce vecchia si toglie');
});
