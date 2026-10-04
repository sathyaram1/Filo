// Unit test per il TETTO del caricamento dei feedback e per come si scrive un
// conteggio che ne deriva (src/shared/feedback.js): LIST_PAGE_SIZE, listHitCap,
// countLabel. Logica pura, gira via `npm run test:unit` senza Electron né rete.
//
// Perché esiste: le pagine che elencano i feedback ne caricano al massimo
// LIST_PAGE_SIZE, dal più recente al più vecchio. Superata quella soglia un
// conteggio calcolato in pagina NON è un totale, e scriverlo come tale ("312")
// è peggio che non scriverlo: sembra una risposta. Il "+" è la forma onesta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

const lista = (n) => Array.from({ length: n }, (_, i) => ({ _id: `f${i}` }));

test('feedback espone il tetto del caricamento e i suoi due aiutanti', () => {
  assert.equal(typeof FB.LIST_PAGE_SIZE, 'number');
  assert.ok(FB.LIST_PAGE_SIZE > 0);
  assert.equal(typeof FB.listHitCap, 'function');
  assert.equal(typeof FB.countLabel, 'function');
  assert.equal(typeof FB.COUNT_CAP_HINT, 'string');
  // L'hover deve dire QUANTI se ne sono caricati: un "+" senza spiegazione è un enigma.
  assert.ok(FB.COUNT_CAP_HINT.includes(String(FB.LIST_PAGE_SIZE)));
});

test('listHitCap: il tetto è toccato solo quando la pagina è piena', () => {
  assert.equal(FB.listHitCap(lista(FB.LIST_PAGE_SIZE - 1), FB.LIST_PAGE_SIZE), false);
  assert.equal(FB.listHitCap(lista(FB.LIST_PAGE_SIZE), FB.LIST_PAGE_SIZE), true);
  // Più del tetto (dati iniettati, o tetto alzato altrove): resta "almeno".
  assert.equal(FB.listHitCap(lista(FB.LIST_PAGE_SIZE + 10), FB.LIST_PAGE_SIZE), true);
  // Vuoto e non-array non toccano niente.
  assert.equal(FB.listHitCap([], FB.LIST_PAGE_SIZE), false);
  assert.equal(FB.listHitCap(null, FB.LIST_PAGE_SIZE), false);
  assert.equal(FB.listHitCap(undefined, FB.LIST_PAGE_SIZE), false);
  // Tetto assente o insensato → si ricade su quello di default.
  assert.equal(FB.listHitCap(lista(FB.LIST_PAGE_SIZE)), true);
  assert.equal(FB.listHitCap(lista(3), 0), false);
});

test('countLabel: "(24)" è un totale, "(24+)" è un minimo', () => {
  assert.equal(FB.countLabel(24, false), '(24)');
  assert.equal(FB.countLabel(24, true), '(24+)');
  // Zero è una risposta quando il dato è completo…
  assert.equal(FB.countLabel(0, false), '(0)');
  // …e resta un minimo quando non lo è: la sezione può non essere vuota davvero.
  assert.equal(FB.countLabel(0, true), '(0+)');
});

test('countLabel: numeri storti non producono etichette storte', () => {
  assert.equal(FB.countLabel(undefined, false), '(0)');
  assert.equal(FB.countLabel(null, false), '(0)');
  assert.equal(FB.countLabel(NaN, false), '(0)');
  assert.equal(FB.countLabel(-3, false), '(0)');
  assert.equal(FB.countLabel(2.7, false), '(2)');
  assert.equal(FB.countLabel('7', true), '(7+)');
});
