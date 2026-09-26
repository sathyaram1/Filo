// Siti ospitati su piattaforme a sottodominio per utente (github.io, vercel.app, s3…): il dominio che conta è
// quello dell'utente, non la piattaforma. Regola in src/main/services/safebrowse/psl.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getDomainInfo } = require('../../src/main/services/safebrowse/psl.js');
const { evaluate } = require('../../src/main/services/safebrowse/engine.js');

const livello = (url) => evaluate(url).level;
const dominio = (host) => getDomainInfo(host).registrable;

test('una pagina personale su github.io non passa per «GitHub su un altro dominio»', () => {
  const v = evaluate('https://sathya.github.io/la-soglia/');
  assert.equal(v.level, 'safe', JSON.stringify(v));
  assert.equal(dominio('sathya.github.io'), 'sathya.github.io');
  assert.equal(livello('https://qualcuno.gitlab.io/'), 'safe');
});

test('le piattaforme stesse e i loro siti ufficiali restano tranquilli', () => {
  for (const url of [
    'https://github.io/', 'https://gitlab.io/', 'https://medium.com/', 'https://www.medium.com/',
    'https://wordpress.com/', 'https://vercel.app/', 'https://s3.amazonaws.com/bucket/file',
    'https://storage.googleapis.com/bucket/file', 'https://fonts.googleapis.com/css',
    'https://lh3.googleusercontent.com/x', 'https://microsoft.sharepoint.com/',
    'https://googleblog.blogspot.com/', 'https://contoso-my.sharepoint.com/',
  ]) assert.equal(livello(url), 'safe', url);
  assert.equal(dominio('medium.com'), 'medium.com');
});

test('un sosia ospitato su una piattaforma viene ancora segnalato', () => {
  const gh = evaluate('https://paypal-login.github.io/');
  assert.notEqual(gh.level, 'safe', JSON.stringify(gh));
  assert.match(gh.message.title, /PayPal/);
  assert.equal(gh.message.body.startsWith('paypal-login.github.io '), true, gh.message.body);
});

test('una piattaforma in whitelist non copre più le pagine che ospita', () => {
  for (const url of [
    'https://paypal-verifica.vercel.app/', 'https://paypal-verifica.netlify.app/',
    'https://paypal-conto.s3.amazonaws.com/index.html', 'https://intesa-accesso.sharepoint.com/',
    'https://poste-rimborso.wordpress.com/', 'https://binance-premi.medium.com/',
    'https://paypal-login.s3.us-east-1.amazonaws.com/', 'https://paypal-login.s3.eu-west-1.amazonaws.com/index.html',
    'https://paypal-login.s3-website-us-east-1.amazonaws.com/', 'https://paypal-login.s3-website.eu-west-1.amazonaws.com/',
  ]) assert.notEqual(livello(url), 'safe', url);
  assert.equal(dominio('paypal-login.s3.us-east-1.amazonaws.com'), 'paypal-login.s3.us-east-1.amazonaws.com');
  assert.equal(livello('https://mio-sito.s3-website.eu-west-1.amazonaws.com/'), 'safe');
});

test('GitHub su un suffisso che non è suo resta sospetto', () => {
  assert.notEqual(livello('https://github.co/'), 'safe');
});

test('il nome di un sito ospitato non passa per un errore di battitura del marchio', () => {
  for (const url of [
    'https://email.github.io/', 'https://posts.github.io/', 'https://apply.github.io/', 'https://photon.github.io/',
    'https://team.netlify.app/', 'https://stream.vercel.app/',
  ]) assert.equal(livello(url), 'safe', url);
  // Il sosia fatto di lettere che si somigliano resta un blocco, anche ospitato.
  assert.equal(livello('https://paypa1.github.io/'), 'pericoloso');
});

test('gli indirizzi ufficiali dei marchi non fanno scattare l\'avviso', () => {
  for (const url of [
    'https://login.microsoftonline.com/', 'https://www.microsoft365.com/', 'https://github.dev/',
    'https://fuzzy-space-8080.app.github.dev/', 'https://www.amazon.nl/', 'https://www.amazon.ca/',
    'https://www.ebay.de/', 'https://www.google.ch/', 'https://www.paypal.it/', 'https://negozio.myshopify.com/',
    'https://myshopify.com/', 'https://dl.dropboxusercontent.com/s/x', 'https://app.auth.us-east-1.amazoncognito.com/login',
  ]) assert.equal(livello(url), 'safe', url);
});

test('i cookie della modalità privacy seguono solo le piattaforme che il web già separa', async () => {
  const { normalize } = require('../../src/main/services/safebrowse/normalize.js');
  const perCookie = (url) => normalize(url, { soloPsl: true }).registrable;
  assert.equal(perCookie('https://myblog.wordpress.com/'), 'wordpress.com');
  assert.equal(perCookie('https://someone.medium.com/'), 'medium.com');
  assert.equal(perCookie('https://contoso-my.sharepoint.com/'), 'sharepoint.com');
  assert.equal(perCookie('https://sathya.github.io/'), 'sathya.github.io');
  // Per il giudizio invece il blog è un sito a sé.
  assert.equal(normalize('https://myblog.wordpress.com/').registrable, 'myblog.wordpress.com');
  const { readFileSync } = await import('node:fs');
  const cookies = readFileSync(new URL('../../src/main/services/cookies.js', import.meta.url), 'utf8');
  assert.match(cookies, /SB\.normalize\(url, \{ soloPsl: true \}\)/);
});
