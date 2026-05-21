// Shim chrome.* per il processo main.
//
// Il codice background dell'estensione legacy chiama chrome.storage.local,
// chrome.runtime.sendMessage, chrome.tabs.*, chrome.action.*, chrome.commands.*,
// chrome.scripting.*, chrome.contextMenus.*. Ricreiamo queste API in Node
// usando i nostri storage adapter + IPC + finestre Electron, così i moduli
// shared/* e background/* girano invariati.
//
// Il fatto che molti file usino `chrome.storage.local.get/set` direttamente
// e altri usino i wrapper shared/storage.js significa che il shim deve essere
// completo (non basta esporre il wrapper).
//
// I content script vedranno un `chrome` diverso (più snello), iniettato dal
// preload del singolo tab — vedi src/preload/page-preload.js.

const storage = require('./storage');

// `globalThis.chrome` ci dà un namespace simile a quello di MV3.
const chromeShim = {
  // ─── storage ─────────────────────────────────────────────────────────────
  storage: {
    local: {
      get: (keys) => storage.get(keys ?? null),
      set: (obj) => storage.set(obj),
      remove: (keys) => storage.remove(keys),
      clear: () => storage.clear(),
    },
    onChanged: {
      addListener: (fn) => storage.onChanged(fn),
      removeListener: () => { /* lo shim restituisce un disposer, qui ignoriamo */ },
    },
  },

  // ─── runtime ─────────────────────────────────────────────────────────────
  runtime: {
    id: 'filo-desktop',
    lastError: null,
    // sendMessage diventa: dispatch sull'event bus interno. Le pagine interne
    // useranno IPC vero (preload + contextBridge), i moduli main importano
    // direttamente l'handler.
    sendMessage: async () => { /* no-op nel main: i moduli si chiamano diretti */ },
    onMessage: {
      addListener: () => { /* gestito da src/main/ipc.js */ },
    },
    onConnect: {
      addListener: () => { /* streaming via ipc, vedi ipc.js */ },
    },
    onInstalled: {
      addListener: (fn) => {
        // Lo invochiamo una volta al boot del main process, simulando "install".
        // L'app Electron ha una nozione diversa di "install" che non interessa qui.
        setTimeout(() => {
          try { fn({ reason: 'startup' }); } catch (e) { console.warn('[shim] onInstalled fn err', e); }
        }, 0);
      },
    },
    getURL: (rel) => 'filo://' + String(rel || '').replace(/^\/+/, ''),
    openOptionsPage: async () => {
      const { openInternalPage } = require('../ipc');
      await openInternalPage('options');
    },
  },

  // ─── tabs ───────────────────────────────────────────────────────────────
  // Il main process possiede il TabManager. Esponiamo qui un'interfaccia
  // sottile pensata per i moduli background portati.
  tabs: {
    async create({ url } = {}) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && win._filoTabs) {
        const id = win._filoTabs.openTab(url || 'filo://newtab/');
        return { id };
      }
      return null;
    },
    async query() { return []; },
    async remove(id) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && win._filoTabs) win._filoTabs.closeTab(id);
    },
    async sendMessage() { /* ai content script: gestito da ipc */ },
    async goBack(id) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && win._filoTabs) win._filoTabs.goBack(id);
    },
    async goForward(id) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && win._filoTabs) win._filoTabs.goForward(id);
    },
    async reload(id) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && win._filoTabs) win._filoTabs.reload(id);
    },
    async captureVisibleTab(_winId, _options) {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (!win || !win._filoTabs) return '';
      const tab = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
      if (!tab) return '';
      const img = await tab.view.webContents.capturePage();
      return img.toDataURL();
    },
  },

  // ─── action (toolbar icon) ──────────────────────────────────────────────
  action: {
    onClicked: {
      addListener: () => { /* riservato: icona in shell renderer */ },
    },
  },

  // ─── commands (hotkey) ──────────────────────────────────────────────────
  commands: {
    onCommand: {
      addListener: () => { /* registrate da src/main/shortcuts.js */ },
    },
  },

  // ─── scripting / contextMenus: no-op nel main (non servono) ─────────────
  scripting: {
    executeScript: async () => ({}),
  },
  contextMenus: {
    create: () => {},
    onClicked: { addListener: () => {} },
  },
};

if (typeof globalThis.chrome === 'undefined') {
  globalThis.chrome = chromeShim;
}

module.exports = chromeShim;
