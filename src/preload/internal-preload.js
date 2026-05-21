// Preload per le pagine interne (filo://...).
//
// contextIsolation è DISATTIVATO per queste pagine (vedi tabs.js): è codice
// nostro fidato e ha bisogno di chrome.* in scope globale per riusare 1:1
// quanto portato dall'estensione. Possiamo assegnare direttamente window.*
// e l'assegnazione è visibile alla pagina.

const { ipcRenderer } = require('electron');

let streamCounter = 0;

const filoApi = {
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
  getURL: (rel) => 'filo://' + String(rel || '').replace(/^\/+/, ''),
  onBroadcast: (fn) => {
    const wrapped = (_event, msg) => { try { fn(msg); } catch (_) {} };
    ipcRenderer.on('filo:broadcast', wrapped);
    return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
  },
  aiStream: ({ action, payload, onMeta, onDelta, onDone, onError }) => {
    const requestId = `s${Date.now()}_${++streamCounter}`;
    const offMeta = (_e, data) => onMeta && onMeta(data);
    const offDelta = (_e, data) => onDelta && onDelta(data.delta);
    const offDone = (_e, data) => { cleanup(); onDone && onDone(data); };
    const offError = (_e, data) => { cleanup(); onError && onError(data); };
    const cleanup = () => {
      ipcRenderer.removeListener(`ai-stream:${requestId}:meta`, offMeta);
      ipcRenderer.removeListener(`ai-stream:${requestId}:delta`, offDelta);
      ipcRenderer.removeListener(`ai-stream:${requestId}:done`, offDone);
      ipcRenderer.removeListener(`ai-stream:${requestId}:error`, offError);
    };
    ipcRenderer.on(`ai-stream:${requestId}:meta`, offMeta);
    ipcRenderer.on(`ai-stream:${requestId}:delta`, offDelta);
    ipcRenderer.on(`ai-stream:${requestId}:done`, offDone);
    ipcRenderer.on(`ai-stream:${requestId}:error`, offError);
    ipcRenderer.invoke('ai-stream:start', { requestId, action, payload });
    return {
      abort: () => { ipcRenderer.send('ai-stream:abort', { requestId }); cleanup(); },
    };
  },
};

window.filo = filoApi;

// Shim chrome.* compatibile con il codice estensione: i file portati lo usano
// senza sapere che siamo in Electron. Overscriviamo l'oggetto chrome stub
// che Chromium predefinisce nel renderer.
const chromeShim = {
  runtime: {
    id: 'filo-desktop',
    lastError: null,
    sendMessage: (msg, callback) => {
      const p = filoApi.message(msg);
      if (typeof callback === 'function') {
        p.then((r) => { try { callback(r); } catch (_) {} },
               (err) => { try { callback({ ok: false, error: err.message }); } catch (_) {} });
        return undefined;
      }
      return p;
    },
    onMessage: {
      _listeners: new Set(),
      addListener(fn) {
        this._listeners.add(fn);
        if (!this._wired) {
          this._wired = true;
          filoApi.onBroadcast((m) => {
            for (const l of this._listeners) {
              try { l(m, { id: 'filo-desktop' }, () => {}); } catch (e) { console.warn('[Filo] listener err', e); }
            }
          });
        }
      },
      removeListener(fn) { this._listeners.delete(fn); },
    },
    connect: ({ name } = {}) => {
      let onMessage = null;
      let onDisconnect = null;
      let active = null;
      return {
        name: name || 'unknown',
        postMessage(msg) {
          if (msg?.type !== 'start') return;
          active = filoApi.aiStream({
            action: msg.action, payload: msg.payload,
            onMeta: (m) => onMessage && onMessage({ type: 'meta', ...m }),
            onDelta: (delta) => onMessage && onMessage({ type: 'delta', delta }),
            onDone: (d) => {
              if (onMessage) onMessage({ type: 'done', ...d });
              if (onDisconnect) onDisconnect();
            },
            onError: (e) => {
              if (onMessage) onMessage({ type: 'error', message: e.message, code: e.code });
              if (onDisconnect) onDisconnect();
            },
          });
        },
        onMessage: { addListener: (fn) => { onMessage = fn; } },
        onDisconnect: { addListener: (fn) => { onDisconnect = fn; } },
        disconnect() { if (active) active.abort(); },
      };
    },
    getURL: filoApi.getURL,
    openOptionsPage: () => filoApi.message({ type: 'open_options' }),
  },
  storage: {
    local: {
      async get(keys) {
        const r = await filoApi.message({ type: '_storage:get', keys });
        return r.value || {};
      },
      async set(obj) { await filoApi.message({ type: '_storage:set', obj }); },
      async remove(keys) { await filoApi.message({ type: '_storage:remove', keys }); },
      async clear() { await filoApi.message({ type: '_storage:clear' }); },
    },
    onChanged: {
      addListener(fn) {
        filoApi.onBroadcast((m) => {
          if (m?.type === '_storage:changed') {
            try { fn(m.changes, 'local'); } catch (_) {}
          }
        });
      },
      removeListener() {},
    },
  },
  tabs: {
    async create({ url } = {}) {
      const r = await filoApi.message({ type: '_tabs:create', url });
      return { id: r.id };
    },
    async query() { return []; },
    async remove(id) { await filoApi.message({ type: '_tabs:remove', id }); },
    async captureVisibleTab() {
      const r = await filoApi.message({ type: 'capture_visible_tab' });
      return r.dataUrl;
    },
  },
  action: { onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  scripting: { executeScript: async () => ({}) },
  contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
};

// Sovrascrivi lo stub di Chromium. La proprietà è configurabile, quindi
// l'assegnazione diretta funziona (a differenza di contextBridge che fallisce).
try {
  Object.defineProperty(window, 'chrome', {
    value: chromeShim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
} catch (e) {
  // Fallback: prova l'assegnazione semplice.
  try { window.chrome = chromeShim; } catch (_) { console.warn('[Filo] impossibile sovrascrivere window.chrome', e); }
}
