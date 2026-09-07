// Unit test per src/main/test-window-mode.js — dove viene parcheggiata la
// finestra durante i test.
//
// Perché conta. Le coordinate delle finestre sono numeri FISICI a 16 bit
// (±32767); quelle che si passano a Electron sono logiche. Su uno schermo al
// 125% un -32000 logico diventa -40000 fisici: il numero gira e la finestra
// ricompare dall'altra parte (misurato: chiesto -32000, riletto +20428). Da lì
// il sistema smette di aggiornare la vista dentro la finestra, e tre spec del
// menu del tasto destro diventavano rossi solo su uno schermo scalato.
//
// Senza la divisione per il fattore di scala il primo caso qui sotto è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { coordinataFuoriSchermo } = require(join(__dirname, '..', '..', 'src', 'main', 'test-window-mode.js'));

// Il limite vero è 32767: si sta sotto con margine.
const LIMITE = 32000;

test('la coordinata di parcheggio resta nei limiti a ogni fattore di scala', () => {
  for (const scala of [1, 1.25, 1.5, 1.75, 2, 3]) {
    const logica = coordinataFuoriSchermo(scala);
    const fisica = logica * scala;
    assert.ok(Math.abs(fisica) < LIMITE,
      `a scala ${scala} la coordinata fisica è ${fisica}: fuori dai 16 bit, la finestra rimbalza sullo schermo`);
  }
});

test('resta comunque lontana da qualsiasi monitor plausibile', () => {
  for (const scala of [1, 1.25, 1.5, 2]) {
    // Un monitor logico non arriva a 20000 punti nemmeno con più schermi in fila.
    assert.ok(coordinataFuoriSchermo(scala) <= -10000,
      `a scala ${scala} la finestra sarebbe troppo vicina allo schermo`);
  }
});

test('un fattore di scala assurdo o mancante non fa uscire un NaN', () => {
  for (const brutto of [undefined, null, 0, -2, NaN, 'due']) {
    const v = coordinataFuoriSchermo(brutto);
    assert.ok(Number.isFinite(v) && v < 0, `scala ${String(brutto)} → ${v}`);
  }
});
