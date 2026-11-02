// #1478.1: l'avviso di un host escluso resta in coda finché una pagina in vista lo prende, e la pausa di dieci minuti
// per quell'host parte da lì, non dalla risposta. La porta del main e della pagina: tests/fornitore-escluso-avviso.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { crea, PAUSA_MS } = require('../../src/main/services/avvisiFuoriPolitica.js');

function banco() {
  let t = 1_000_000;
  let n = 0;
  const mandati = [];
  const visti = [];
  const a = crea({ manda: (m) => mandati.push(m), ora: () => t, nuovoId: () => `id${++n}` });
  const componi = (host) => () => ({ messaggio: { type: 'show_toast', text: `da ${host}` }, alMostrare: () => visti.push(host) });
  return { a, mandati, visti, componi, avanti: (ms) => { t += ms; } };
}

test('nessuno lo prende: resta in coda e la pausa non parte, anche dopo dieci minuti', () => {
  const { a, mandati, componi, avanti } = banco();
  const m = a.avvisa('excluded|deepseek', componi('DeepSeek'));
  assert.equal(m.avviso, 'id1');
  assert.equal(mandati.length, 1);
  assert.deepEqual(a.inAttesa().map((x) => x.text), ['da DeepSeek']);
  avanti(PAUSA_MS + 1);
  const di = a.avvisa('excluded|deepseek', componi('DeepSeek'));
  assert.equal(di, m, 'lo stesso avviso, offerto di nuovo');
  assert.equal(mandati.length, 2);
  assert.equal(mandati[0], mandati[1], 'lo stesso oggetto: nel filo entra una volta');
  assert.equal(a.inAttesa().length, 1, 'uno per host e motivo, non uno per risposta');
});

test('lo prende chi lo mostra: da lì dieci minuti di pausa per quell’host, poi riparte', () => {
  const { a, mandati, visti, componi, avanti } = banco();
  a.avvisa('excluded|deepseek', componi('DeepSeek'));
  avanti(60_000);
  assert.deepEqual(a.prendi('id1').map((x) => x.text), ['da DeepSeek']);
  assert.deepEqual(visti, ['DeepSeek'], 'contato quando si vede');
  assert.deepEqual(a.prendi('id1'), [], 'una volta sola');
  assert.equal(a.inAttesa().length, 0);
  avanti(PAUSA_MS - 1);
  assert.equal(a.avvisa('excluded|deepseek', componi('DeepSeek')), null);
  assert.equal(mandati.length, 1);
  avanti(1);
  assert.ok(a.avvisa('excluded|deepseek', componi('DeepSeek')));
  assert.equal(mandati.length, 2);
});

test('la pausa di un host non zittisce un altro host né lo stesso host per un altro motivo', () => {
  const { a, componi } = banco();
  a.avvisa('excluded|deepseek', componi('DeepSeek'));
  a.prendi('id1');
  assert.ok(a.avvisa('excluded|google', componi('Google')));
  assert.ok(a.avvisa('not-producer|deepseek', componi('DeepSeek')));
});

test('senza id si prendono tutti quelli in coda; un id che non c’è non prende niente', () => {
  const { a, componi } = banco();
  a.avvisa('excluded|deepseek', componi('DeepSeek'));
  a.avvisa('excluded|google', componi('Google'));
  assert.deepEqual(a.prendi('altro'), []);
  assert.deepEqual(a.prendi('').map((x) => x.text).sort(), ['da DeepSeek', 'da Google']);
  assert.deepEqual(a.prendi(''), []);
});

test('la pagina prende l’avviso prima di mostrarlo, e al fuoco chiede quelli in coda', () => {
  const content = readFileSync(new URL('../../src/content/content.js', import.meta.url), 'utf8');
  const toast = /if \(msg\?\.type === MSG\.SHOW_TOAST\) \{([\s\S]*?)\n {4}\}/.exec(content)[1];
  assert.match(toast, /msg\.avviso[\s\S]*prendiAvvisiInCoda\(msg\.avviso\)/);
  assert.match(content, /window\.addEventListener\('focus', \(\) => \{ prendiAvvisiInCoda\(\); \}\)/);
  const handlers = readFileSync(new URL('../../src/main/services/handlers.js', import.meta.url), 'utf8');
  const avvisa = /function avvisaFuoriPolitica\([^)]*\) \{([\s\S]*?)\n\}/.exec(handlers)[1];
  assert.match(avvisa, /AvvisiFuoriPolitica\.avvisa\(/);
  assert.doesNotMatch(avvisa, /broadcastToTabs/, 'nessuna spinta che salti la coda');
});

test('tornati su Filo dalla barra delle schede: quelli in coda si offrono di nuovo, quelli presi no', () => {
  const { a, mandati, componi } = banco();
  a.avvisa('excluded|deepseek', componi('DeepSeek'));
  a.avvisa('excluded|google', componi('Google'));
  a.prendi('id2');
  mandati.length = 0;
  a.riproponi();
  assert.deepEqual(mandati.map((m) => m.text), ['da DeepSeek']);
  a.prendi('');
  a.riproponi();
  assert.equal(mandati.length, 1);
});
