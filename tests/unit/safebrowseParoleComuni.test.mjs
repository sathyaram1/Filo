// #728 — una parola comune vicina a un marchio (team/steam, email/gmail) non è un sosia. Dal #1375 lo giudica il
// classificatore delle imitazioni (safebrowse/imitazioni.js): la parola resta pulita, il refuso vero avvisa e da solo
// non blocca, a meno che non sia un travestimento o un refuso a una lettera di un marchio lungo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../src/main/services/safebrowse/engine.js');

const VECCHIO = { ageDays: 900 };          // dominio con anni alle spalle
const GIOVANE = { ageDays: 2 };
const CERT_ROTTO = { ageDays: 900, cert: { status: 'expired' } };

// Parole comuni a una lettera dai marchi di 5-7 lettere citati nella segnalazione, e a due da quelli lunghi.
const PAROLE_COMUNI = [
  'https://team.com/', 'https://email.com/', 'https://photon.com/', 'https://posts.com/', 'https://apply.com/',
  'https://stripes.com/', 'https://www.telegraph.co.uk/', 'https://telegramma.it/', 'https://www.telegrafo.it/',
  'https://linked.com/', 'https://codebase.com/', 'https://macbook.com/',
];

test('una parola comune vicina a un marchio non si prende l’avviso del marchio', () => {
  for (const url of PAROLE_COMUNI) {
    const v = evaluate(url, {}, VECCHIO);
    assert.equal(v.level, 'safe', url);
    assert.equal(v.imp, undefined, url);
  }
});

test('col secondo segnale la parola comune resta senza marchio: il dominio giovane si dice per quello che è', () => {
  for (const url of PAROLE_COMUNI) {
    const v = evaluate(url, {}, GIOVANE);
    assert.notEqual(v.level, 'pericoloso', url);
    assert.ok(!v.imp, url);
  }
});

// Refusi veri di marchi corti: somigliano, e basta.
const SOMIGLIANZE = [
  ['https://paypak.com/', 'PayPal'],
  ['https://gooogle.com/', 'Google'],
  ['https://amazn.com/', 'Amazon'],
];

test('il refuso di un marchio corto resta un avviso da chiudere, e non dà del falso a nessuno', () => {
  for (const [url, marchio] of SOMIGLIANZE) {
    const v = evaluate(url, {}, VECCHIO);
    assert.equal(v.level, 'sospetto', url);
    assert.match(v.message.body, /assomiglia/, url);
    assert.ok(v.message.body.includes(marchio), url);
    assert.doesNotMatch(v.message.title, /^Attenzione: questo non è/, url);
  }
});

test('col secondo segnale il blocco torna: dominio giovane, certificato rotto, password chiesta', () => {
  for (const [url, marchio] of SOMIGLIANZE) {
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

test('«rn» per «m» e «vv» per «w» contano una lettera sola: il sosia di un marchio lungo resta bloccato', () => {
  for (const url of ['https://rnicrosoft.com/', 'https://rnetamask.com/', 'https://vvhatsapp.com/', 'https://instagrarn.com/'])
    assert.equal(evaluate(url, {}, VECCHIO).level, 'pericoloso', url);
});
