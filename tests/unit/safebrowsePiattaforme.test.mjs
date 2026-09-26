// Siti ospitati su piattaforme a sottodominio per utente (github.io, vercel.app…): il dominio che conta è
// quello dell'utente, non la piattaforma. Regola in src/main/services/safebrowse/psl.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getDomainInfo } = require('../../src/main/services/safebrowse/psl.js');
const { evaluate } = require('../../src/main/services/safebrowse/engine.js');

test('una pagina personale su github.io non passa per «GitHub su un altro dominio»', () => {
  const v = evaluate('https://sathya.github.io/la-soglia/');
  assert.equal(v.level, 'safe', JSON.stringify(v));
  assert.equal(getDomainInfo('sathya.github.io').registrable, 'sathya.github.io');
});

test('lo stesso vale per gitlab.io', () => {
  assert.equal(evaluate('https://qualcuno.gitlab.io/').level, 'safe');
});

test('un sosia ospitato su una piattaforma viene ancora segnalato', () => {
  const gh = evaluate('https://paypal-login.github.io/');
  assert.notEqual(gh.level, 'safe', JSON.stringify(gh));
  assert.match(gh.message.title, /PayPal/);
  // Prima la whitelist di vercel.app copriva ogni pagina ospitata lì.
  const vc = evaluate('https://paypal-verifica.vercel.app/');
  assert.notEqual(vc.level, 'safe', JSON.stringify(vc));
});

test('GitHub su un suffisso che non è suo resta sospetto', () => {
  assert.notEqual(evaluate('https://github.co/').level, 'safe');
});
