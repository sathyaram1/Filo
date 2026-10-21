// #1089 — i segnali di attività di una pagina (clic, scorrimento, form) arrivano ogni mezzo secondo mentre si
// usa Filo: non ridisegnano la barra né riscrivono la sessione; una sessione uguale a quella scritta non si riscrive.
// Electron è finto: qui conta cosa fa il gestore delle schede, non la finestra.

import { test, mock } from 'node:test';
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

const scritture = [];
globalThis.SN_STORAGE = { setRaw: async (k, v) => { scritture.push([k, v]); } };

function gestore() {
  const tm = Object.create(TabManager.prototype);
  tm.tabs = [
    { id: 'a', url: 'https://esempio.it/', title: 'Esempio', identityColor: null, scrollPct: 0, formDirty: false },
    { id: 'b', url: 'https://altro.it/', title: 'Altro', identityColor: null, scrollPct: 0, formDirty: false },
  ];
  tm.activeId = 'a';
  tm.incognito = false;
  tm.broadcast = 0;
  tm._broadcast = function () { this.broadcast++; this._persistSession(); };
  return tm;
}

test('venti segnali di attività con scorrimenti diversi: nessun ridisegno della barra e nessuna scrittura', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tm = gestore();
    scritture.length = 0;
    for (let i = 0; i < 20; i++) {
      tm.setTabActivity('a', { lastInteractionAt: Date.now() + i, scrollPct: i * 5, formDirty: i % 2 === 0 });
      mock.timers.tick(500);
    }
    mock.timers.tick(5000);
    assert.equal(tm.broadcast, 0, 'ogni segnale di attività ridisegnava la barra delle schede');
    assert.equal(scritture.length, 0, 'ogni segnale di attività riscriveva lo storage');
    // I segnali servono al triage: devono restare sulla scheda.
    const a = tm.tabs[0];
    assert.equal(a.scrollPct, 95);
    assert.equal(a.formDirty, false);
    assert.ok(a.lastInteractionAt > 0);
  } finally {
    mock.timers.reset();
  }
});

test('la sessione si riscrive solo quando cambia: titolo, icona e caricamento non la toccano', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tm = gestore();
    scritture.length = 0;
    tm._broadcast();
    mock.timers.tick(500);
    // Un altro test può aver già scritto la stessa sessione: la prima volta conta solo che sia quella giusta.
    const prima = scritture.length;
    assert.ok(prima <= 1);
    if (prima) assert.deepEqual(scritture[0][1].tabs, ['https://esempio.it/', 'https://altro.it/']);
    for (let i = 0; i < 10; i++) {
      tm.tabs[1].title = 'Altro ' + i;
      tm.tabs[1].loading = i % 2 === 0;
      tm._broadcast();
      mock.timers.tick(500);
    }
    assert.equal(scritture.length, prima, 'una sessione identica è stata riscritta');

    tm.tabs[1].url = 'https://altro.it/pagina';
    tm._broadcast();
    mock.timers.tick(500);
    assert.equal(scritture.length, prima + 1, 'una sessione cambiata non è stata scritta');
    assert.deepEqual(scritture.at(-1)[1].tabs, ['https://esempio.it/', 'https://altro.it/pagina']);

    tm.activeId = 'b';
    tm._broadcast();
    mock.timers.tick(500);
    assert.equal(scritture.length, prima + 2, 'il cambio di scheda attiva non è stato salvato');
    assert.equal(scritture.at(-1)[1].activeIndex, 1);
  } finally {
    mock.timers.reset();
  }
});

test('una raffica che torna allo stato scritto non scrive niente', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tm = gestore();
    tm._broadcast();
    mock.timers.tick(500);
    scritture.length = 0;
    tm.activeId = 'b';
    tm._broadcast();
    tm.activeId = 'a';
    tm._broadcast();
    mock.timers.tick(500);
    assert.equal(scritture.length, 0);
  } finally {
    mock.timers.reset();
  }
});
