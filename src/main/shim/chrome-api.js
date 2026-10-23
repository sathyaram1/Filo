// Shim chrome.* per il processo main: storage, runtime, tabs, action, commands ricreati su
// storage adapter, IPC e finestre Electron, così i moduli portati girano invariati.
// I content script vedono un `chrome` diverso, iniettato da src/preload/page-preload.js.

const storage = require('./storage');

// La finestra con le schede, non la prima della lista: menu, suggerimento e carta d'anteprima sono finestre figlie
// senza schede e possono stare in testa (con loro chrome.tabs rispondeva «nessuna scheda»).
function finestraConSchede() {
  const wins = require('electron').BrowserWindow.getAllWindows();
  return wins.find((w) => w._filoTabs && !w.isDestroyed()) || null;
}

// `globalThis.chrome` ci dà un namespace simile a quello di MV3.
const chromeShim = {
  storage: {
    local: {
      get: (keys) => storage.get(keys ?? null),
      set: (obj) => storage.set(obj),
      remove: (keys) => storage.remove(keys),
      // «Cancella tutti i dati» vale anche per gli archivi che stanno in file suoi.
      clear: async () => {
        await storage.clear();
        await globalThis.SN_ARCHIVED_TABS?.clear();
        await globalThis.SN_HISTORY?.clear();
        await globalThis.SN_SEGNALAZIONI_MIE?.svuota();
        // Le copie delle icone delle voci appena cancellate (#1273).
        if (!storage.inIncognito()) await require('../services/copieIcone').pulisci();
      },
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
      const win = finestraConSchede();
      if (win && win._filoTabs) {
        const id = win._filoTabs.openTab(url || 'filo://newtab/');
        return { id };
      }
      return null;
    },
    // #593 (secondo giro di verifica) — questa rispondeva sempre «nessuna
    // scheda», e l'unico a chiederglielo è lo stato che l'assistente della
    // nuova scheda riceve a ogni messaggio (src/shared/filoState.js). Risultato:
    // «che schede ho aperte?» si sentiva rispondere nessuna con dieci pagine
    // davanti, e il suggerimento di fare pulizia, che nasce dal loro numero,
    // non compariva mai. Le schede le possiede il TabManager della finestra:
    // qui se ne espone la vista piatta che il chiamante si aspetta.
    async query() {
      const zoomDi = (t) => {
        // Una pagina che scala il proprio contenuto (l'editor scala il foglio)
        // lascia la finestra al 100%: il numero vero lo dichiara lei (#686).
        if (typeof t.zoomProprio === 'number') return t.zoomProprio;
        try { return Math.round(t.view.webContents.getZoomFactor() * 100); }
        catch (_) { return null; }
      };
      const win = finestraConSchede();
      const tm = win && win._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) return [];
      return tm.tabs.map((t) => ({
        id: t.id,
        url: t.url || '',
        title: t.title || '',
        active: t.id === tm.activeId,
        // Il nome del campo è quello di chrome.tabs: chi legge ordina per
        // ultima attività e ripiega sull'id quando manca.
        lastAccessed: t.lastActiveAt || null,
        // #686 — lo zoom della pagina entra nello stato della chat: senza, a
        // «ingrandisci un po'» Filo non sapeva da dove partire.
        zoomPercent: zoomDi(t),
      }));
    },
    async remove(id) {
      const win = finestraConSchede();
      if (win && win._filoTabs) win._filoTabs.closeTab(id);
    },
    async sendMessage() { /* ai content script: gestito da ipc */ },
    async goBack(id) {
      const win = finestraConSchede();
      if (win && win._filoTabs) win._filoTabs.goBack(id);
    },
    async goForward(id) {
      const win = finestraConSchede();
      if (win && win._filoTabs) win._filoTabs.goForward(id);
    },
    async reload(id) {
      const win = finestraConSchede();
      if (win && win._filoTabs) win._filoTabs.reload(id);
    },
    async captureVisibleTab(_winId, _options) {
      const win = finestraConSchede();
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
