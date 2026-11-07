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

test('dalla chat si spegne e si riaccende, senza confondersi con «Salta» e col blocco di pubblicità e tracker', () => {
  require('../../src/shared/constants.js');
  require('../../src/shared/preferences.js');
  const P = Object.keys(globalThis).map((k) => globalThis[k]).find((o) => o && typeof o.buildPreferencePartial === 'function');
  for (const chiave of ['blocca_pubblicita_youtube', 'pubblicità di youtube', 'blocca le pubblicità di YouTube']) {
    assert.deepEqual(P.buildPreferencePartial(chiave, false).partial, { security: { youtubeAds: { enabled: false } } }, chiave);
  }
  assert.deepEqual(P.buildPreferencePartial('blocca_pubblicita_youtube', 'sì').partial, { security: { youtubeAds: { enabled: true } } });
  assert.deepEqual(P.buildPreferencePartial('salta_pubblicita', false).partial, { security: { adSkip: { enabled: false } } });
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

// Una scheda finta coi suoi frame: il primo è il principale, gli altri dicono di chi sono figli.
function conFrame(...frame) {
  for (const f of frame) f.parent = f.parent || null;
  frame[0].framesInSubtree = frame;
  return { ...scheda(), mainFrame: frame[0] };
}

test('regole che non reggono in un articolo con due video: si ricaricano tutti e due i riquadri, l\'articolo no', () => {
  B.impostaListePerTest([LISTA]);
  const articolo = { url: 'https://giornale.it/pezzo' };
  const uno = { url: 'https://www.youtube-nocookie.com/embed/uno', parent: articolo };
  const due = { url: 'https://www.youtube-nocookie.com/embed/due', parent: articolo };
  const dentroDue = { url: 'https://www.youtube.com/iframe_api', parent: due };
  const annuncio = { url: 'https://annunci.it/x', parent: articolo };
  const wc = conFrame(articolo, uno, due, dentroDue, annuncio);
  B.regolePer(uno.url, wc);
  B.regolePer(due.url, wc);
  const ricariche = [];
  assert.equal(B.rotto(wc, uno, 'avviso', { avvisa() {}, ricarica: (w, f) => ricariche.push(f) }).fatto, true);
  assert.deepEqual(ricariche, [uno, due], 'il secondo video aveva le stesse regole: riparte anche lui');
  assert.deepEqual(B.regolePer(due.url, wc), [], 'ricaricato, ha il solo «Salta»');
  assert.equal(B.rotto(wc, due, 'avviso', { avvisa() {}, ricarica: (w, f) => ricariche.push(f) }).fatto, false);
  assert.equal(ricariche.length, 2, 'una ricarica sola per riquadro');

  const yt = { url: 'https://www.youtube.com/watch?v=x' };
  const intera = conFrame(yt, { url: 'https://www.youtube.com/embed/y', parent: yt });
  B.regolePer(yt.url, intera);
  const sola = [];
  B.rotto(intera, yt, 'fermo', { avvisa() {}, ricarica: (w, f) => sola.push(f) });
  assert.deepEqual(sola, [yt], 'la scheda di YouTube si ricarica intera, una volta');
});

test('regole nuove, o interruttore riacceso: i frame di YouTube aperti lo sanno, e solo loro', (t) => {
  const R = require('../../src/main/services/regoleYouTube.js');
  const inviati = [];
  const frame = (url, parent) => ({ url, parent, send: (c) => inviati.push(`${url} ${c}`) });
  const watch = frame('https://www.youtube.com/watch?v=x');
  const articolo = frame('https://giornale.it/');
  const incorporato = frame('https://www.youtube-nocookie.com/embed/a', articolo);
  const altrove = frame('https://esempio.it/');
  const chiusa = { ...conFrame(frame('https://www.youtube.com/watch?v=chiusa')), isDestroyed: () => true };
  const tutte = [conFrame(watch), conFrame(articolo, incorporato), conFrame(altrove), chiusa];
  B.impostaSchedePerTest({ daId: () => null, tutte: () => tutte });
  t.after(() => B.impostaSchedePerTest({ daId: () => null, tutte: () => [] }));
  const attese = [watch.url, incorporato.url].map((u) => `${u} ${R.CANALE_PRONTE}`).sort();

  B.impostaListePerTest([`${LISTA}\nwww.youtube.com##+js(set, offerte.prima, undefined)`]);
  assert.deepEqual(inviati.splice(0).sort(), attese);
  B.impostaListePerTest([`${LISTA}\nwww.youtube.com##+js(set, offerte.prima, undefined)`]);
  assert.deepEqual(inviati, [], 'le stesse regole non svegliano nessuno');

  B.configureFromSettings({ security: { youtubeAds: { enabled: false } } });
  B.impostaListePerTest([`${LISTA}\nwww.youtube.com##+js(set, offerte.seconda, undefined)`]);
  assert.deepEqual(inviati, [], 'spento, niente');
  B.configureFromSettings({});
  assert.deepEqual(inviati.splice(0).sort(), attese, 'riacceso, le pagine aperte lo sanno');
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
