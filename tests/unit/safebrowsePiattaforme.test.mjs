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
  ]) assert.notEqual(livello(url), 'safe', url);
});

test('GitHub su un suffisso che non è suo resta sospetto', () => {
  assert.notEqual(livello('https://github.co/'), 'safe');
});
