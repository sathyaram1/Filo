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
const { coordinataFuoriSchermo, inModalitaTest, silenziaApertureDiSistema } =
  require(join(__dirname, '..', '..', 'src', 'main', 'test-window-mode.js'));

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

// Aperture di sistema (browser, gestore file) durante i test. Su un
// contenitore senza desktop `xdg-open` non esce mai e l'app non si chiude più;
// altrove si apre davvero il browser di chi lancia i test. In modalità test le
// due funzioni dello shell non aprono niente, risolvono subito e lo scrivono su
// stderr; fuori dalla modalità test lo shell resta quello di Electron.

// Uno shell finto che conta le chiamate all'originale.
function shellFinto() {
  const chiamate = [];
  return {
    chiamate,
    shell: {
      openExternal: async (u) => { chiamate.push(['openExternal', u]); },
      openPath: async (p) => { chiamate.push(['openPath', p]); return ''; },
    },
  };
}

test('la modalità test è NODE_ENV=test, e solo quella', () => {
  assert.equal(inModalitaTest({ NODE_ENV: 'test' }), true);
  for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'development' }, { FILO_HIDE_WINDOW: '1' }, null, undefined]) {
    assert.equal(inModalitaTest(env), false, `ambiente ${JSON.stringify(env)} scambiato per test`);
  }
});

test('in modalità test openExternal e openPath non aprono niente e lo dicono su stderr', async () => {
  const { shell, chiamate } = shellFinto();
  const righe = [];
  assert.equal(silenziaApertureDiSistema(shell, { inTest: true, avvisa: (r) => righe.push(r) }), true);
  const a = await shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  const b = await shell.openPath('/una/cartella/file.pdf');
  assert.equal(a, undefined);
  assert.equal(b, '', 'openPath deve rispondere come Electron quando va bene: stringa vuota');
  assert.deepEqual(chiamate, [], 'l\'originale non va chiamato');
  assert.deepEqual(righe, [
    '[test] openExternal soppresso: https://accounts.google.com/o/oauth2/v2/auth?x=1',
    '[test] openPath soppresso: /una/cartella/file.pdf',
  ]);
});

test('fuori dalla modalità test lo shell resta quello di Electron', async () => {
  const { shell, chiamate } = shellFinto();
  const originali = { openExternal: shell.openExternal, openPath: shell.openPath };
  const righe = [];
  assert.equal(silenziaApertureDiSistema(shell, { inTest: false, avvisa: (r) => righe.push(r) }), false);
  assert.equal(shell.openExternal, originali.openExternal);
  assert.equal(shell.openPath, originali.openPath);
  await shell.openExternal('https://esempio.test/');
  await shell.openPath('/tmp/x');
  assert.deepEqual(chiamate, [['openExternal', 'https://esempio.test/'], ['openPath', '/tmp/x']]);
  assert.deepEqual(righe, []);
});

test('uno shell mancante non fa cadere l\'avvio', () => {
  assert.equal(silenziaApertureDiSistema(null, { inTest: true }), false);
  assert.equal(silenziaApertureDiSistema(undefined, { inTest: true }), false);
});
