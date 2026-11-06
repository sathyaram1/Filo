// #1974 — gli scaricamenti a tempo delle regole di YouTube, veri, con la rete e l'orologio finti: all'avvio se la copia
// su disco ha più di un giorno (altrimenti si usa lei), ogni giorno, quando si riaccende l'interruttore, e dopo un
// ripiego subito e poi ogni ora finché la scheda aspetta regole nuove.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { svuota, scorri } from '../helpers/orologio.mjs';

process.env.NODE_ENV = 'test';
process.env.FILO_TEST_LISTE_YOUTUBE = 'https://liste.prova/';
process.env.FILO_USER_DATA = cartellaTemporanea('filo-blocco-youtube-scarica-');
const require = createRequire(import.meta.url);
const R = require('../../src/main/services/regoleYouTube.js');
const PERCORSO = require.resolve('../../src/main/services/bloccoYouTube.js');
const CACHE = join(process.env.FILO_USER_DATA, 'adblock', 'youtube.json');

const ORA = Date.UTC(2026, 10, 6, 10);
const H = 60 * 60 * 1000;
const DISCO = 'www.youtube.com##+js(set, dal.disco, undefined)';
// Una lista vuota è una lista che non è arrivata: le altre portano almeno un commento.
const NIENTE = '! niente per YouTube';
let rete = { 'filters.txt': '!#include filters-2026.txt\nwww.youtube.com##+js(set, dalla.rete, undefined)', 'filters-2026.txt': NIENTE, 'quick-fixes.txt': NIENTE };
let chieste = [];

// Un main appena acceso: il modulo da capo, con la sua copia su disco (o senza).
function avvio({ copiaDi = null } = {}) {
  delete require.cache[PERCORSO];
  rmSync(CACHE, { force: true });
  if (copiaDi !== null) {
    mkdirSync(join(process.env.FILO_USER_DATA, 'adblock'), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ formato: 1, aggiornateIl: ORA - copiaDi, insieme: R.leggi(DISCO) }));
  }
  const B = require(PERCORSO);
  chieste = [];
  B.impostaPrendiPerTest(async (url) => { chieste.push(url); const t = rete[url.slice('https://liste.prova/'.length)]; return t === undefined ? null : t; });
  return B;
}

// Le letture e scritture su disco non passano dall'orologio finto: si lascia correre finché la condizione vale.
async function finché(cond) {
  for (let i = 0; i < 2000 && !cond(); i++) await svuota(1);
  return cond();
}

const scheda = { id: 7, isDestroyed: () => false, mainFrame: { frameTreeNodeId: 1 } };
const regole = (B) => B.regolePer('https://www.youtube.com/watch?v=x', scheda).map((r) => r[1]);

test('all\'avvio la copia di oggi si usa dal disco senza rete; ogni giorno le regole si riscaricano', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: ORA });
  t.after(() => mock.timers.reset());
  const B = avvio({ copiaDi: 3 * H });
  await B.init({});
  await svuota();
  assert.deepEqual(chieste, [], 'copia di tre ore fa: niente rete');
  assert.deepEqual(regole(B), ['dal.disco']);
  await scorri(24 * H);
  assert.ok(await finché(() => regole(B)[0] === 'dalla.rete'), `il giro del giorno dopo: ${JSON.stringify(chieste)}`);
  assert.deepEqual(chieste.slice().sort(), ['filters-2026.txt', 'filters.txt', 'quick-fixes.txt'].map((n) => 'https://liste.prova/' + n));
});

test('all\'avvio con la copia di ieri, o senza copia, le regole si scaricano subito', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: ORA });
  t.after(() => mock.timers.reset());
  for (const copiaDi of [25 * H, null]) {
    const B = avvio({ copiaDi });
    await B.init({});
    assert.ok(await finché(() => regole(B)[0] === 'dalla.rete'), `copia di ${copiaDi}: ${JSON.stringify(chieste)}`);
  }
});

test('spento all\'avvio non scarica; riacceso, con la copia vecchia, scarica', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: ORA });
  t.after(() => mock.timers.reset());
  const B = avvio({ copiaDi: 2 * 24 * H });
  await B.init({ security: { youtubeAds: { enabled: false } } });
  await scorri(H);
  assert.deepEqual(chieste, []);
  B.configureFromSettings({});
  assert.ok(await finché(() => regole(B)[0] === 'dalla.rete'), JSON.stringify(chieste));
});

test('dopo un ripiego le regole si richiedono subito e poi ogni ora, finché non cambiano', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: ORA });
  t.after(() => mock.timers.reset());
  rete = { 'filters.txt': DISCO, 'quick-fixes.txt': NIENTE };
  const B = avvio({ copiaDi: H });
  await B.init({});
  await svuota();
  assert.equal(regole(B).length, 1);
  assert.equal(B.rotto(scheda, { url: 'https://www.youtube.com/watch?v=x', frameTreeNodeId: 1 }, 'fermo', { avvisa() {}, ricarica() {} }).fatto, true);
  assert.ok(await finché(() => chieste.length === 2), `subito: ${JSON.stringify(chieste)}`);
  await finché(() => false);
  assert.ok(B.spentaPerTest(scheda.id), 'le stesse regole non riaccendono la scheda');
  await scorri(H);
  assert.ok(await finché(() => chieste.length === 4), `dopo un'ora: ${JSON.stringify(chieste)}`);
  rete = { 'filters.txt': `${DISCO}\nwww.youtube.com##+js(set, nuove, undefined)`, 'quick-fixes.txt': NIENTE };
  await scorri(H);
  assert.ok(await finché(() => !B.spentaPerTest(scheda.id)), 'le regole nuove riaccendono la scheda');
  const fatte = chieste.length;
  await scorri(3 * H);
  assert.equal(chieste.length, fatte, 'nessuna scheda aspetta più: niente richieste ogni ora');
});
