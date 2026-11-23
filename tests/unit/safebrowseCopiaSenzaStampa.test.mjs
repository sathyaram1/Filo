// #591.7 — la copia nascosta riceve la pagina e i suoi riquadri in sandbox senza `allow-modals`, così print() non apre la
// finestra del sistema neanche a pagina caricata; la politica del sito resta intera accanto. Regola in safebrowse/sandbox.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDetonator } = require('../../src/main/services/safebrowse/sandbox.js');

function electronFinto({ debuggerRotto = false } = {}) {
  const ascolti = [];
  const fatti = [];
  const ses = {
    on() {},
    clearStorageData: async () => {},
    setProxy: async () => {},
    closeAllConnections: async () => {},
    clearAuthCache: async () => {},
    webRequest: { onHeadersReceived: (fn) => ascolti.push(fn) },
  };
  class BrowserWindow {
    constructor() {
      const on = {};
      this.webContents = {
        on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        loadURL: () => { setTimeout(() => (on['did-stop-loading'] || []).forEach((f) => f({})), 1); return Promise.resolve(); },
      };
    }
    isDestroyed() { return false; }
    destroy() {}
  }
  return { electron: { BrowserWindow, session: { fromPartition: () => ses } }, ascolti };
}

const risposta = (fn, d) => new Promise((ok) => fn(d, ok));

test('la pagina e i riquadri della copia nascosta arrivano in sandbox senza allow-modals, con la politica del sito accanto', async () => {
  const f = electronFinto();
  const D = createDetonator({ electron: f.electron, maxConcurrent: 1, vitaDestinazioneMs: 200, attesaRimandoMs: 5 });
  await D.destinazione('https://bit.ly/a', () => false);
  await D.destinazione('https://bit.ly/b', () => false);
  assert.equal(f.ascolti.length, 1, 'il posto riusato non registra un secondo ascolto');
  const [fn] = f.ascolti;

  const pagina = await risposta(fn, { resourceType: 'mainFrame', responseHeaders: { 'content-security-policy': ["default-src 'self'"] } });
  const politiche = pagina.responseHeaders['content-security-policy'];
  assert.equal(politiche[0], "default-src 'self'");
  assert.match(politiche[1], /^sandbox /);
  assert.ok(politiche[1].split(' ').includes('allow-scripts'));
  assert.ok(!politiche[1].includes('allow-modals'));
  assert.equal(Object.keys(pagina.responseHeaders).length, 1, 'nessuna seconda intestazione con le maiuscole diverse');

  const riquadro = await risposta(fn, { resourceType: 'subFrame', responseHeaders: {} });
  assert.match(riquadro.responseHeaders['Content-Security-Policy'][0], /^sandbox /);

  assert.deepEqual(await risposta(fn, { resourceType: 'image', responseHeaders: {} }), {});
});
