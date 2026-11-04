// #1132 — l'accesso con Google che aspetta il browser: richieste ravvicinate (anche a raffica, da qualunque mittente)
// aprono il browser una volta ogni 10 secondi, e riaprirlo non allunga il tetto di dieci minuti.

import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Electron finto: nessuna finestra normale (l'accesso va nel browser) e un browser che registra le aperture.
const aperture = [];
const electronFinto = {
  shell: { openExternal: async (u) => { aperture.push(String(u)); } },
  net: { isOnline: () => true },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
};
const percorsoElectron = require.resolve('electron');
require.cache[percorsoElectron] = { id: percorsoElectron, filename: percorsoElectron, loaded: true, exports: electronFinto };

const auth = require('../../src/main/auth/google-auth.js');

beforeEach(() => {
  aperture.length = 0;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-04T10:00:00Z') });
});
// Un accesso rimasto aperto da un test rosso terrebbe vivo il server loopback: lo chiude il suo tetto.
afterEach(() => { mock.timers.tick(60 * 60 * 1000); mock.timers.reset(); });

// Le promesse in sospeso fanno un giro: il flusso nasce con un server loopback vero.
const giro = () => new Promise((r) => setImmediate(r));
async function finoA(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await giro();
  assert.ok(cond(), 'condizione mai arrivata');
}

test('dieci richieste ravvicinate aprono il browser una volta sola', async () => {
  const esiti = [];
  for (let i = 0; i < 10; i++) esiti.push(auth.signIn().catch((e) => e));
  await finoA(() => aperture.length >= 1);
  for (let i = 0; i < 20; i++) await giro();
  assert.equal(aperture.length, 1);
  // Passati 10 secondi una nuova richiesta lo riapre, sulla stessa pagina.
  mock.timers.tick(10_000);
  esiti.push(auth.signIn().catch((e) => e));
  await finoA(() => aperture.length === 2);
  assert.equal(aperture[1], aperture[0]);
  mock.timers.tick(10 * 60 * 1000);
  for (const e of await Promise.all(esiti)) assert.equal(e && e.code, 'scaduto');
});

test('riaprire il browser non allunga il tetto dei dieci minuti', async () => {
  const primo = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 1);
  // Riaperture a 9 minuti e mezzo: il tetto resta quello della prima richiesta.
  mock.timers.tick(9.5 * 60 * 1000);
  const riaperto = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 2);
  mock.timers.tick(30 * 1000);
  const [a, b] = await Promise.all([primo, riaperto]);
  assert.equal(a && a.code, 'scaduto');
  assert.equal(b && b.code, 'scaduto');
  // Chiuso quell'accesso, la richiesta dopo ne apre uno nuovo, su un'altra pagina.
  const nuovo = auth.signIn().catch((e) => e);
  await finoA(() => aperture.length === 3);
  assert.notEqual(aperture[2], aperture[0]);
  mock.timers.tick(10 * 60 * 1000);
  assert.equal((await nuovo).code, 'scaduto');
});
