// #1974 — il blocco delle pubblicità di YouTube dal lato del main: chi riceve le regole, il ripiego al solo «Salta»
// (una ricarica, un avviso, la scheda spenta finché le regole non cambiano) e lo scaricamento con i suoi «!#include».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

process.env.NODE_ENV = 'test';
// La copia delle regole su disco va in una cartella di prova, non nel repo.
process.env.FILO_USER_DATA = cartellaTemporanea('filo-blocco-youtube-');
const require = createRequire(import.meta.url);
const B = require('../../src/main/services/bloccoYouTube.js');

const LISTA = 'www.youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)\nwww.youtube.com##+js(json-prune, adPlacements)';
let prossimo = 100;
const scheda = () => ({ id: prossimo++, isDestroyed: () => false, mainFrame: { frameTreeNodeId: 1 } });
const frame = (url, id = 1) => ({ url, frameTreeNodeId: id });

test('acceso di serie, spento solo da un false esplicito', () => {
  assert.equal(B.attivo(undefined), true);
  assert.equal(B.attivo({ security: {} }), true);
  assert.equal(B.attivo({ security: { youtubeAds: { enabled: false } } }), false);
});

test('le regole vanno solo ai frame di YouTube, e niente con l\'interruttore spento', async () => {
  B.impostaListePerTest([LISTA]);
  await B.init({});
  const wc = scheda();
  assert.equal(B.regolePer('https://www.youtube.com/watch?v=x', wc).length, 2);
  assert.deepEqual(B.regolePer('https://esempio.it/', wc), []);
  assert.deepEqual(B.regolePer('filo://dashboard', wc), []);
  B.configureFromSettings({ security: { youtubeAds: { enabled: false } } });
  assert.deepEqual(B.regolePer('https://www.youtube.com/watch?v=x', wc), []);
  B.configureFromSettings({});
  assert.equal(B.regolePer('https://www.youtube.com/watch?v=x', wc).length, 2);
});

test('regole che non reggono: la scheda torna al solo «Salta», si ricarica una volta e lo dice', () => {
  B.impostaListePerTest([LISTA]);
  const wc = scheda();
  const avvisi = [];
  const ricariche = [];
  const opz = { avvisa: (m) => avvisi.push(m), ricarica: (w, f) => ricariche.push(f) };
  assert.equal(B.rotto(wc, frame('https://www.youtube.com/watch?v=x'), 'fermo', opz).fatto, false, 'senza regole ricevute non c\'è niente da spegnere');
  B.regolePer('https://www.youtube.com/watch?v=x', wc);
  assert.equal(B.rotto(wc, frame('https://esempio.it/'), 'fermo', opz).fatto, false, 'un frame fuori da YouTube non spegne niente');
  assert.equal(B.rotto(wc, frame('https://www.youtube.com/watch?v=x'), 'fermo', opz).fatto, true);
  assert.deepEqual(avvisi, ['fermo']);
  assert.equal(ricariche.length, 1);
  assert.ok(B.spentaPerTest(wc.id));
  assert.deepEqual(B.regolePer('https://www.youtube.com/watch?v=x', wc), [], 'ricaricata, la scheda ha il solo «Salta»');
  assert.equal(B.rotto(wc, frame('https://www.youtube.com/watch?v=x'), 'fermo', opz).fatto, false);
  assert.equal(ricariche.length, 1, 'una ricarica sola');
  const altra = scheda();
  assert.equal(B.regolePer('https://www.youtube.com/watch?v=y', altra).length, 2, 'le altre schede tengono il blocco');
});

test('alle regole nuove la scheda spenta riprova; le stesse regole riscaricate non la riaccendono', () => {
  B.impostaListePerTest([LISTA]);
  const wc = scheda();
  B.regolePer('https://www.youtube.com/', wc);
  B.rotto(wc, frame('https://www.youtube.com/'), 'avviso', { avvisa() {}, ricarica() {} });
  B.impostaListePerTest([LISTA]);
  assert.ok(B.spentaPerTest(wc.id), 'stessa impronta: resta spenta');
  B.impostaListePerTest([`${LISTA}\nwww.youtube.com##+js(set, playerResponse.adPlacements, undefined)`]);
  assert.ok(!B.spentaPerTest(wc.id));
  assert.equal(B.regolePer('https://www.youtube.com/', wc).length, 3);
});

test('lo scaricamento prende filters.txt coi suoi «!#include» accanto e quick-fixes.txt; se una manca tiene le regole di prima', async () => {
  B.impostaListePerTest([LISTA]);
  const chieste = [];
  const testi = {
    'filters.txt': '!#include filters-2026.txt\n!#include ../fuori.txt\nwww.youtube.com##+js(set, a.b, false)',
    'filters-2026.txt': 'youtube.com##+js(set, c.d, false)',
    'quick-fixes.txt': 'www.youtube.com##+js(json-prune, adSlots)',
  };
  const prendi = async (url) => {
    chieste.push(url);
    const nome = url.slice(B.CARTELLA_LISTE.length);
    return testi[nome] || null;
  };
  const r = await B.aggiorna({ forza: true, prendi });
  assert.equal(r.ok, true);
  assert.equal(r.cambiate, true);
  assert.deepEqual(chieste.sort(), ['filters-2026.txt', 'filters.txt', 'quick-fixes.txt'].map((n) => B.CARTELLA_LISTE + n));
  const wc = scheda();
  assert.deepEqual(B.regolePer('https://www.youtube.com/', wc).map((x) => x[1]), ['a.b', 'c.d', 'adSlots']);
  const ko = await B.aggiorna({ forza: true, prendi: async (url) => (url.endsWith('quick-fixes.txt') ? null : prendi(url)) });
  assert.equal(ko.ok, false);
  assert.equal(B.regolePer('https://www.youtube.com/', wc).length, 3, 'le regole di prima restano');
  const presto = await B.aggiorna({ prendi });
  assert.equal(presto.saltato, true, 'meno di un giorno dopo non si riscarica');
});
