// #728 — una parola comune che dista una lettera da un marchio corto (team/steam,
// email/gmail) non è un sosia: avvisa, non blocca. Regola in safebrowse/signals.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../src/main/services/safebrowse/engine.js');

const VECCHIO = { ageDays: 900 };          // dominio con anni alle spalle
const GIOVANE = { ageDays: 2 };
const CERT_ROTTO = { ageDays: 900, cert: { status: 'expired' } };

// Parole comuni a una lettera dai marchi di 5-7 lettere citati nella segnalazione.
const PAROLE_COMUNI = [
  ['https://team.com/', 'Steam'],
  ['https://email.com/', 'Gmail'],
  ['https://photon.com/', 'Proton'],
  ['https://posts.com/', 'Poste Italiane'],
  ['https://apply.com/', 'Apple'],
  ['https://stripes.com/', 'Stripe'],
  ['https://tictok.com/', 'TikTok'],
];

test('una parola comune vicina a un marchio corto non manda il blocco a tutta pagina', () => {
  for (const [url] of PAROLE_COMUNI) {
    const v = evaluate(url, {}, VECCHIO);
    assert.notEqual(v.level, 'pericoloso', url);
  }
});

test('resta un avviso da chiudere, e non dà del falso a un sito vero', () => {
  for (const [url, marchio] of PAROLE_COMUNI) {
    const v = evaluate(url, {}, VECCHIO);
    assert.equal(v.level, 'sospetto', url);
    assert.ok(v.message && v.message.body, url);
    assert.match(v.message.body, /assomiglia/, url);
    assert.ok(v.message.body.includes(marchio), url);
    assert.doesNotMatch(v.message.title, /^Attenzione: questo non è/, url);
  }
});

test('col secondo segnale il blocco torna: dominio giovane, certificato rotto, password chiesta', () => {
  for (const [url, marchio] of PAROLE_COMUNI) {
    for (const [ctx, asyncData] of [
      [{}, GIOVANE],
      [{}, CERT_ROTTO],
      [{ hasPassword: true }, VECCHIO],
    ]) {
      const v = evaluate(url, ctx, asyncData);
      assert.equal(v.level, 'pericoloso', url + ' ' + JSON.stringify(asyncData));
      assert.ok(v.message.body.includes(marchio), url);
      assert.match(v.message.title, /^Attenzione: questo non è/, url);
    }
  }
});

test('il sosia fatto di lettere che si somigliano resta un blocco anche da solo', () => {
  for (const url of [
    'https://paypa1.com/',            // 1 al posto della l
    'https://xn--80ak6aa92e.com/',    // аррӏе in cirillico
    'https://st3am.com/',             // 3 al posto della e
    'https://g00gle.com/',
  ]) assert.equal(evaluate(url, {}, VECCHIO).level, 'pericoloso', url);
});

test('sui marchi lunghi il refuso da solo blocca ancora', () => {
  for (const url of [
    'https://facebok.com/', 'https://instagrarn.com/', 'https://micrsoft.com/',
    'https://whatsap.com/', 'https://linkedln.com/',
  ]) assert.equal(evaluate(url, {}, VECCHIO).level, 'pericoloso', url);
});

test('i marchi veri e i domini senza somiglianza restano puliti', () => {
  for (const url of [
    'https://steampowered.com/', 'https://gmail.com/', 'https://proton.me/',
    'https://poste.it/', 'https://apple.com/', 'https://stripe.com/',
    'https://wikipedia.org/', 'https://enciclopedia.it/',
  ]) assert.equal(evaluate(url, {}, VECCHIO).level, 'safe', url);
});
