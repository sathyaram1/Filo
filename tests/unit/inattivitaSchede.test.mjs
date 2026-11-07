// #1618 — l'inattività che decide la pulizia delle schede la fanno i gesti dell'utente: un segnale della pagina senza
// gesto (scorrimento, modulo ricontrollato) non la azzera, e la sessione si porta dietro l'ultima interazione.
// Electron è finto: qui conta il gestore delle schede. Il flusso vero: tests/tab-pulizia-inattivita.spec.mjs.

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

const ORE_FA = Date.now() - 7 * 3600_000;

function gestore() {
  const tm = Object.create(TabManager.prototype);
  tm.tabs = [
    { id: 'a', url: 'https://chat.esempio.it/', title: 'Chat', lastInteractionAt: ORE_FA, scrollPct: 0, formDirty: false },
    { id: 'b', url: 'https://altro.it/', title: 'Altro', lastInteractionAt: null, scrollPct: 0, formDirty: false },
  ];
  tm.activeId = 'b';
  tm.incognito = false;
  tm._lastAppInteractionAt = ORE_FA;
  return tm;
}

test('scorrimenti, moduli ricontrollati e impronte senza gesto non azzerano l’inattività', () => {
  const tm = gestore();
  tm.setTabActivity('a', { scrollPct: 80 });
  tm.setTabActivity('a', { formDirty: false });
  tm.setTabActivity('a', { impronte: ['x'] });
  tm.setTabActivity('a', { lastInteractionAt: 'adesso' });
  tm.setTabActivity('a', { lastInteractionAt: Number.NaN });
  assert.equal(tm._lastAppInteractionAt, ORE_FA);
  assert.equal(tm.tabs[0].lastInteractionAt, ORE_FA);
  assert.equal(tm.tabs[0].scrollPct, 80);
});

test('un gesto dell’utente la azzera, e un orario nel futuro vale adesso', () => {
  const tm = gestore();
  const prima = Date.now();
  tm.setTabActivity('a', { lastInteractionAt: Date.now() + 24 * 3600_000, scrollPct: 10 });
  assert.ok(tm._lastAppInteractionAt >= prima);
  assert.ok(tm.tabs[0].lastInteractionAt >= prima && tm.tabs[0].lastInteractionAt <= Date.now());
});

test('la sessione salva l’ultima interazione di ogni scheda, al minuto', () => {
  const tm = gestore();
  const s = tm.sessionState();
  assert.equal(s.usate.length, s.tabs.length);
  assert.equal(s.usate[0], new Date(Math.floor(ORE_FA / 60_000) * 60_000).toISOString());
  assert.equal(s.usate[1], null);
  // Due gesti nello stesso minuto lasciano la sessione uguale: non si riscrive a ogni aggiornamento della barra.
  tm.tabs[0].lastInteractionAt = Math.floor(ORE_FA / 60_000) * 60_000 + 59_000;
  assert.deepEqual(tm.sessionState(), s);
});
