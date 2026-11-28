// #2086 — una scheda bloccata: la pulizia non la vede, il riordino per colore non la sposta, il blocco torna con la
// sessione, un gesto di chiusura la lascia e lo dice, la chat in blocco la salta e per numero la chiude a costo 2.
// Electron è finto: qui conta cosa fa il gestore delle schede, non la finestra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const finto = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, finto)), apply: () => new Proxy(function () {}, finto), construct: () => new Proxy({}, finto) };
const electron = new Proxy({ app: { getPath: () => tmpdir(), on() {}, isPackaged: false, getVersion: () => '0.0.0' } }, finto);
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  return origLoad.call(this, request, parent, isMain);
};
const { TabManager } = require(join(ROOT, 'src', 'main', 'tabs.js'));
require(join(ROOT, 'src', 'shared', 'tabTriage.js'));
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'restanoAperte']) require(join(ROOT, 'src', 'shared', `${f}.js`));
const ChiudiSchede = require(join(ROOT, 'src', 'main', 'services', 'chiudiSchede.js'));
const L = globalThis.SN_ACTION_LEVELS;
const R = globalThis.SN_RESTANO_APERTE;

const BLU = 'rgb(40, 80, 200)';
const VERDE = 'rgb(40, 200, 80)';
const ROSSO = 'rgb(200, 40, 40)';

// Aperte blu → verde → rosso: per tinta l'ordine è rosso → verde → blu. L'attiva è la home, mai candidata.
function gestore() {
  const tm = Object.create(TabManager.prototype);
  const scheda = (id, url, identityColor) => ({ id, url, title: id, identityColor, scrollPct: 0, formDirty: false, view: {}, _dallaSessione: true, bloccata: false });
  tm.tabs = [scheda('blu', 'https://blu.example/', BLU), scheda('verde', 'https://verde.example/', VERDE),
    scheda('rosso', 'https://rosso.example/', ROSSO), scheda('home', 'filo://newtab/', null)];
  tm.activeId = 'home';
  tm._riapertaAlle = Date.now() - 1000;
  tm.incognito = false;
  tm._sempreAperte = [];
  tm._identityColorCache = new Map();
  tm.avvisi = [];
  tm.win = { webContents: { send: (canale, dati) => { if (canale === 'shell:toast') tm.avvisi.push(dati); } } };
  tm._broadcast = function () {};
  tm._ricontrollaModuli = async () => {};
  tm._caricaSempreAperte = async () => {};
  tm._gatherTriageInput = async (cands) => cands.map((t) => ({ url: t.url, title: t.title }));
  return tm;
}
const ordine = (tm) => tm.tabs.map((t) => t.id);

async function conDecisione(decide, fn) {
  const prima = globalThis.SN_TAB_TRIAGE_DECIDE;
  globalThis.SN_TAB_TRIAGE_DECIDE = decide;
  try { return await fn(); } finally { globalThis.SN_TAB_TRIAGE_DECIDE = prima; }
}

test('la pulizia che archivia tutto lascia la bloccata, e al modello non arriva', async () => {
  const tm = gestore();
  assert.equal(tm.bloccaScheda('verde', true), true);
  const viste = [];
  const esito = await conDecisione(async ({ tabs }) => {
    viste.push(...tabs.map((t) => t.title));
    return { decisions: tabs.map((_, i) => ({ i, action: 'archive' })) };
  }, () => tm.runAutoTriage({ trigger: 'reopen' }));
  assert.equal(viste.includes('verde'), false, 'la bloccata è arrivata al modello che decide');
  assert.deepEqual(ordine(tm).sort(), ['home', 'verde']);
  assert.equal(esito.archived, 2, 'l\'avviso conta solo le chiuse');
});

test('il riordino per colore non sposta la bloccata: le altre si riordinano negli spazi che lascia', () => {
  const tm = gestore();
  tm.bloccaScheda('blu', true);
  tm.reorderTabsByColor();
  assert.equal(ordine(tm)[0], 'blu', 'la bloccata si è spostata');
  assert.deepEqual(ordine(tm).slice(1, 3), ['rosso', 'verde']);
});

test('il blocco si salva con la sessione e torna alla riapertura', async () => {
  const tm = gestore();
  tm.bloccaScheda('verde', true);
  const stato = tm.sessionState();
  assert.deepEqual(stato.bloccate, [null, true, null, null]);

  const dopo = gestore();
  dopo._gatherTriageInput = undefined;
  const prima = globalThis.SN_STORAGE;
  globalThis.SN_STORAGE = { getRaw: async () => stato, setRaw: async () => {} };
  try {
    Object.assign(dopo, {
      tabs: [], _sessioneDaLeggere: true, visite: { giaVista() {} },
      codaRiapertura: { accoda() {}, avanti() {}, finita: () => new Promise(() => {}) },
      activate() {}, _persistSession() {}, _maybeTriageOnReopen() {}, setTabIdentityColor() {},
      openTab(url) {
        const t = { id: `t${dopo.tabs.length}`, url, view: { webContents: {} }, scrollPct: 0, bloccata: false };
        dopo.tabs.push(t);
        return t.id;
      },
    });
    assert.equal(await dopo.restoreSession(), true);
  } finally {
    globalThis.SN_STORAGE = prima;
  }
  assert.deepEqual(dopo.tabs.map((t) => t.bloccata), [false, true, false, false]);
});

test('un gesto di chiusura su una bloccata la lascia e offre «Sblocca e chiudi»', () => {
  const tm = gestore();
  tm.bloccaScheda('rosso', true);
  tm.closeTab('rosso', { via: 'pulsante_x' });
  assert.ok(tm.tabs.some((t) => t.id === 'rosso'), 'la bloccata si è chiusa');
  const a = tm.avvisi.at(-1);
  assert.equal(a.text, 'Scheda bloccata');
  assert.deepEqual(a.opts.actions, [{ label: 'Sblocca e chiudi', sbloccaEChiudi: 'rosso' }]);
});

test('le chiusure in blocco della chat saltano la bloccata, quella per numero la prende', async () => {
  const tm = gestore();
  tm.bloccaScheda('verde', true);
  const motivo = await tm.motiviPerRestare();
  const viste = tm.tabs.map((t) => t.id);
  for (const action of [{ tutte: true }, { sito: 'verde.example' }, { tranne: [1] }]) {
    const s = ChiudiSchede.risolvi(action, { schede: tm.tabs, viste, numerate: 12, chat: 'home', resta: (t) => motivo(t) });
    assert.equal(s.chiudere.some((t) => t.id === 'verde'), false, JSON.stringify(action));
    assert.deepEqual(s.restano.map((x) => x.perche), ['bloccata'], JSON.stringify(action));
  }
  const perNumero = ChiudiSchede.risolvi({ schede: [2] }, { schede: tm.tabs, viste, numerate: 12, chat: 'home', resta: (t) => motivo(t) });
  assert.deepEqual(perNumero.chiudere.map((t) => t.id), ['verde']);
});

test('chiudere proprio la bloccata costa 2, una scheda qualunque 1; il conto delle rimaste lo dice', () => {
  const chiudi = (extra) => ({ type: 'CHIUDI_SCHEDE', _targets: ['Verde'], _targetIds: ['verde'], ...extra });
  assert.equal(L.costoFor(chiudi({ _bloccate: 1 })), 2);
  assert.equal(L.costoFor(chiudi({ _bloccate: 0 })), 1);
  assert.equal(L.costoFor({ type: 'BLOCCA_SCHEDA' }), 1);
  assert.equal(L.costoFor({ type: 'SBLOCCA_SCHEDA', scheda: 3 }), 1);
  assert.equal(R.frase(R.conto(['bloccata'])), 'una era bloccata e l\'ho lasciata');
});
