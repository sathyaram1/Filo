// Shim chrome.* per il processo main: storage, runtime, tabs, action, commands ricreati su
// storage adapter, IPC e finestre Electron, così i moduli portati girano invariati.
// I content script vedono un `chrome` diverso, iniettato da src/preload/page-preload.js.

const storage = require('./storage');

const chromeShim = {
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

  runtime: {
    id: 'filo-desktop',
    lastError: null,
    sendMessage: async () => { /* no-op nel main: i moduli si chiamano diretti */ },
    onMessage: {
      addListener: () => { /* gestito da src/main/ipc.js */ },
    },
    onConnect: {
      addListener: () => { /* streaming via ipc, vedi ipc.js */ },
    },
    onInstalled: {
      addListener: (fn) => {
        // Chiamato una volta al boot: «install» per Electron vuol dire un'altra cosa.
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

  // Interfaccia sottile sul TabManager, per i soli moduli background portati.
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

  action: {
    onClicked: {
      addListener: () => { /* riservato: icona in shell renderer */ },
    },
  },

  commands: {
    onCommand: {
      addListener: () => { /* registrate da src/main/shortcuts.js */ },
    },
  },

  // scripting e contextMenus: no-op nel main, non servono.
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
