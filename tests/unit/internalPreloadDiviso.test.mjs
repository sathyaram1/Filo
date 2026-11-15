// window.filo e lo shim chrome.* delle pagine filo:// stanno in file loro (#2494): la superficie esposta resta quella
// di prima, nome per nome, e internal-preload.js la monta da lì invece di riscriversela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = join(ROOT, 'src', 'preload');

function ipcFinto() {
  const inviati = [];
  const ascolti = new Map();
  return {
    inviati,
    ascolti,
    invoke: (canale, dati) => { inviati.push(['invoke', canale, dati]); return Promise.resolve({ value: { a: 1 }, id: 7, dataUrl: 'data:x' }); },
    send: (canale, dati) => { inviati.push(['send', canale, dati]); },
    on: (canale, fn) => { ascolti.set(canale, fn); },
    removeListener: (canale) => { ascolti.delete(canale); },
  };
}

test('window.filo espone gli stessi nomi di prima, nello stesso ordine', () => {
  const api = require(join(PRELOAD, 'filo-api.js'))(ipcFinto(), null);
  assert.deepEqual(Object.keys(api), [
    'message', 'getURL', 'sistema', 'percorsoDelFile', 'onBroadcast', 'onReasoning', 'onAnswer', 'onAction',
    'onAperturaFermata', 'aiStream', 'shellExec', 'shellHome', 'shellVaglia', 'shellAnnulla', 'shellWhich',
    'shellVirgoletteIncolla', 'shellPropostaVirgolette', 'siteResolves',
  ]);
  assert.equal(api.sistema, process.platform);
  assert.equal(api.getURL('/pages/x.html'), 'filo://pages/x.html');
  assert.equal(api.percorsoDelFile({}), '');
});

test('flussi del modello e comandi della shell contano con lo stesso numero', () => {
  const ipc = ipcFinto();
  const api = require(join(PRELOAD, 'filo-api.js'))(ipc, null);
  api.aiStream({ action: 'a', payload: {} });
  api.shellExec({ command: 'ls' });
  api.aiStream({ action: 'b', payload: {} });
  const numeri = ipc.inviati.filter(([, c]) => c === 'ai-stream:start' || c === 'shell:start')
    .map(([, , d]) => (d.requestId || d.execId).split('_')[1]);
  assert.deepEqual(numeri, ['1', '2', '3']);
  const avvio = ipc.inviati.find(([, c]) => c === 'shell:start')[2];
  assert.equal(avvio.daFuori, false);
});

test('lo shim chrome.* passa da window.filo', async () => {
  const ipc = ipcFinto();
  const api = require(join(PRELOAD, 'filo-api.js'))(ipc, null);
  const chrome = require(join(PRELOAD, 'chrome-shim.js'))(api);
  assert.deepEqual(Object.keys(chrome), ['runtime', 'storage', 'tabs', 'action', 'commands', 'scripting', 'contextMenus']);
  assert.deepEqual(await chrome.storage.local.get(['a']), { a: 1 });
  assert.equal(await chrome.tabs.captureVisibleTab(), 'data:x');
  assert.deepEqual(ipc.inviati.map(([, , d]) => d.type), ['_storage:get', 'capture_visible_tab']);
  const ricevuti = [];
  chrome.runtime.onMessage.addListener((m) => ricevuti.push(m));
  ipc.ascolti.get('filo:broadcast')(null, { type: 'ciao' });
  assert.deepEqual(ricevuti, [{ type: 'ciao' }]);
  assert.equal(chrome.runtime.onMessage._listeners.size, 1);
});

test('internal-preload.js monta i due pezzi invece di riscriverli', () => {
  const src = readFileSync(join(PRELOAD, 'internal-preload.js'), 'utf8');
  assert.match(src, /const filoApi = require\('\.\/filo-api\.js'\)\(ipcRenderer, webUtils\);/);
  assert.match(src, /const chromeShim = require\('\.\/chrome-shim\.js'\)\(filoApi\);/);
  assert.doesNotMatch(src, /ipcRenderer\.invoke\('(?:filo:message|ai-stream:start|shell:start)'/);
});
