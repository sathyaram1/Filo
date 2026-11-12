// Sentinella (#1053): lo strato del menu del tasto destro resta spento di serie finché il passo 4 non lo accende, e il
// punto che riceve sta sempre dentro la scheda. Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Strato = require('../../src/main/stratoDelMenu.js');

test('spento di serie: lo accende solo FILO_STRATO_MENU=1', () => {
  const prima = process.env.FILO_STRATO_MENU;
  try {
    assert.equal(Strato.ACCESO_DI_SERIE, false);
    delete process.env.FILO_STRATO_MENU;
    assert.equal(Strato.acceso(), false);
    process.env.FILO_STRATO_MENU = '0';
    assert.equal(Strato.acceso(), false);
    process.env.FILO_STRATO_MENU = '1';
    assert.equal(Strato.acceso(), true);
  } finally {
    if (prima === undefined) delete process.env.FILO_STRATO_MENU; else process.env.FILO_STRATO_MENU = prima;
  }
});

test('spento, non nasce nessuna vista e non si apre', () => {
  const prima = process.env.FILO_STRATO_MENU;
  delete process.env.FILO_STRATO_MENU;
  try {
    let toccata = false;
    const win = new Proxy({}, { get: () => { toccata = true; return () => {}; } });
    const s = new Strato.StratoDelMenu(win, { schedaAttiva: () => null, area: () => ({ x: 0, y: 0, width: 10, height: 10 }) });
    assert.equal(toccata, false, 'spento non ascolta la finestra');
    assert.equal(s.mostra({ isDestroyed: () => false }, { x: 1, y: 1 }), false);
    assert.equal(s.vista, null);
  } finally {
    if (prima !== undefined) process.env.FILO_STRATO_MENU = prima;
  }
});

test('il punto resta dentro la scheda, e senza area o numeri non c\'è punto', () => {
  const area = { x: 0, y: 88, width: 800, height: 600 };
  assert.deepEqual(Strato.puntoNellArea({ x: 120.6, y: 40.2 }, area), { x: 121, y: 40 });
  assert.deepEqual(Strato.puntoNellArea({ x: -5, y: 9000 }, area), { x: 0, y: 599 });
  assert.equal(Strato.puntoNellArea({ x: 'a', y: 1 }, area), null);
  assert.equal(Strato.puntoNellArea({ x: NaN, y: 1 }, area), null);
  assert.equal(Strato.puntoNellArea({ x: 1, y: 1 }, null), null);
  assert.equal(Strato.puntoNellArea(null, area), null);
});
