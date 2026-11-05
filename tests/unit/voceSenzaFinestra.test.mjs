// #2031 — Su Mac, con Filo acceso senza finestre con schede, le voci della barra che aprono qualcosa la ridanno.
// Qui la regola di src/main/window.js (ridaiFinestraNormale, quandoPronta); il percorso vero: tests/seconda-apertura.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let finestre = [];
const nate = [];
function BrowserWindow() {
  const una = {};
  const w = {
    una, distrutta: false, isDestroyed() { return this.distrutta; }, on() {}, loadURL() {},
    once(ev, cb) { (una[`win:${ev}`] = una[`win:${ev}`] || []).push(cb); },
    webContents: { on() {}, once(ev, cb) { (una[ev] = una[ev] || []).push(cb); } },
    isMinimized: () => false, restore() {}, show() {}, showInactive() {}, moveTop() {}, focus() {}, setOpacity() {}, setPosition() {},
  };
  nate.push(w);
  finestre.push(w);
  return w;
}
BrowserWindow.getAllWindows = () => finestre.slice();
const electron = { BrowserWindow, session: {}, screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) }, app: { on() {} } };

let daRidare = true;
class SchedeFinte {
  constructor() { this.tabs = []; }
  async restoreSession() { return daRidare; }
  openTab(url) { this.tabs.push(url); }
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  const daFinestra = parent && /[\\/]src[\\/]main[\\/]window\.js$/.test(parent.filename || '');
  if (daFinestra && request === './tabs') return { TabManager: SchedeFinte };
  if (daFinestra && request === './shortcuts') return { collegaScorciatoie() {} };
  if (daFinestra && request === './protocol') return { registerFiloProtocolForSession() {} };
  return origLoad.call(this, request, parent, isMain);
};
const W = require(join(ROOT, 'src', 'main', 'window.js'));
Module._load = origLoad;

const carica = async (w) => { for (const cb of w.una['did-finish-load'] || []) await cb(); };

test('prima che l\'avvio abbia fatto la sua finestra, una voce della barra non ne fa un\'altra', () => {
  assert.equal(W.ridaiFinestraNormale(), null);
  assert.equal(nate.length, 0, 'due finestre all\'avvio: quella della voce e quella dell\'avvio');
});

test('chiusa la principale, la voce la ridà e aspetta le schede riaperte prima di agire', async () => {
  W.createMainWindow();
  finestre = [];
  nate.length = 0;
  daRidare = true;
  const win = W.ridaiFinestraNormale();
  assert.equal(nate.length, 1, 'senza finestre con schede la voce non fa niente');
  let esito = 'in attesa';
  W.quandoPronta(win).then((e) => { esito = e; });
  await new Promise((r) => setImmediate(r));
  assert.equal(esito, 'in attesa', 'una scheda aperta adesso finirebbe dietro quelle riaperte');
  await carica(win);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(esito, { ripristinata: true });
  assert.equal(W.ridaiFinestraNormale(), win, 'con la finestra viva non ne nasce un\'altra');
});

test('senza schede da ridare la finestra nasce con la sua scheda nuova, e lo dice', async () => {
  finestre = [];
  daRidare = false;
  const win = W.ridaiFinestraNormale();
  await carica(win);
  assert.deepEqual(await W.quandoPronta(win), { ripristinata: false });
  assert.deepEqual(win._filoTabs.tabs, ['filo://newtab/']);
});

test('chiusa prima di essere pronta, chi aspetta non resta appeso', async () => {
  finestre = [];
  const win = W.ridaiFinestraNormale();
  win.distrutta = true;
  for (const cb of win.una['win:closed'] || []) cb();
  assert.equal(await W.quandoPronta(win), null);
});
