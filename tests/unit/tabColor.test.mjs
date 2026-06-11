// Unit test per src/shared/tabColor.js — la regola che decide se un colore
// "ha identità" (brand del sito) o è chrome neutra da scartare.
//
// È il cuore del fix "tinta della tab dal favicon": un theme-color bianco (es.
// YouTube) NON ha identità → si deve ripiegare sul favicon. Questi test
// asseriscono proprio quella decisione, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'tabColor.js'));

const TC = globalThis.SN_TAB_COLOR;

test('tabColor si registra su globalThis con la sua API', () => {
  assert.ok(TC);
  assert.equal(typeof TC.hasIdentity, 'function');
  assert.equal(typeof TC.chroma, 'function');
  assert.equal(TC.IDENTITY_CHROMA_MIN, 24);
});

test('chrome neutra (bianco/nero/grigio) NON ha identità', () => {
  assert.equal(TC.hasIdentity('rgb(255, 255, 255)'), false, 'bianco (theme-color YouTube light)');
  assert.equal(TC.hasIdentity('rgb(0, 0, 0)'), false, 'nero');
  assert.equal(TC.hasIdentity('rgb(15, 15, 15)'), false, 'quasi-nero (YouTube dark)');
  assert.equal(TC.hasIdentity('rgb(128, 128, 128)'), false, 'grigio medio');
  assert.equal(TC.hasIdentity('rgb(250, 250, 252)'), false, 'quasi-bianco (croma 2)');
});

test('un vero colore brand HA identità', () => {
  assert.equal(TC.hasIdentity('rgb(255, 0, 0)'), true, 'rosso YouTube');
  assert.equal(TC.hasIdentity('rgb(29, 161, 242)'), true, 'azzurro');
  assert.equal(TC.hasIdentity('rgb(40, 60, 90)'), true, 'blu scuro brand (croma 50)');
  assert.equal(TC.hasIdentity('rgb(200, 180, 40)'), true, 'giallo/oro');
});

test('soglia: appena sotto/sopra IDENTITY_CHROMA_MIN', () => {
  // croma 23 → no, croma 24 → sì (la soglia è inclusiva).
  assert.equal(TC.hasIdentity('rgb(123, 100, 100)'), false, 'croma 23');
  assert.equal(TC.hasIdentity('rgb(124, 100, 100)'), true, 'croma 24');
});

test('input invalido o nullo → nessuna identità (no crash)', () => {
  assert.equal(TC.hasIdentity(null), false);
  assert.equal(TC.hasIdentity(''), false);
  assert.equal(TC.hasIdentity('non-un-colore'), false);
  assert.equal(TC.chroma(null), 0);
});

test('chroma calcola max-min sui canali', () => {
  assert.equal(TC.chroma('rgb(255, 0, 0)'), 255);
  assert.equal(TC.chroma('rgb(100, 100, 100)'), 0);
  assert.equal(TC.chroma('rgb(200, 150, 100)'), 100);
});
