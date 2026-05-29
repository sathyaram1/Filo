// Preload per le pagine web caricate dentro i tab del browser.
//
// Equivalente al "content script" Manifest V3 dell'estensione:
//   - inietta i CSS condivisi (theme, menu, popup, sidebar, highlight,
//     spellcheck, feedback)
//   - espone chrome.* dentro il mondo isolato del preload (NON in main world:
//     la pagina è codice non fidato; i content script girano qui)
//   - carica i moduli SN_* (shared) via require()
//   - carica i content script via require()
//
// contextIsolation è TRUE per queste pagine, quindi globalThis qui è isolato
// dal main world della pagina. Le scritture su globalThis NON sono visibili
// alla pagina, ma il DOM (document, window) è condiviso. Esattamente come
// in Chrome con i content script.

const { ipcRenderer } = require('electron');
const path = require('node:path');

// ─── chrome.* shim per i content script ────────────────────────────────────
//
// Gira nel preload context (mondo isolato), invisibile alla pagina. I content
// script importati sotto useranno questo chrome via globalThis.

let streamCounter = 0;

const filoMessage = (msg) => ipcRenderer.invoke('filo:message', msg);

const broadcastListeners = new Set();
ipcRenderer.on('filo:broadcast', (_event, msg) => {
  for (const fn of broadcastListeners) {
    try { fn(msg, { id: 'filo-desktop' }, () => {}); } catch (e) { console.warn('[Filo CS] listener err', e); }
  }
});

const chromeShim = {
  runtime: {
    id: 'filo-desktop',
    lastError: null,
    sendMessage: (msg, callback) => {
      const p = filoMessage(msg);
      if (typeof callback === 'function') {
        p.then((r) => { try { callback(r); } catch (_) {} },
               (err) => { try { callback({ ok: false, error: err.message }); } catch (_) {} });
        return undefined;
      }
      return p;
    },
    onMessage: {
      addListener(fn) { broadcastListeners.add(fn); },
      removeListener(fn) { broadcastListeners.delete(fn); },
    },
    connect: ({ name } = {}) => {
      let onMessage = null;
      let onDisconnect = null;
      let active = null;
      return {
        name: name || 'unknown',
        postMessage(msg) {
          if (msg?.type !== 'start') return;
          const requestId = `s${Date.now()}_${++streamCounter}`;
          const offMeta = (_e, data) => onMessage && onMessage({ type: 'meta', ...data });
          const offDelta = (_e, data) => onMessage && onMessage({ type: 'delta', delta: data.delta });
          const offDone = (_e, data) => {
            cleanup();
            if (onMessage) onMessage({ type: 'done', ...data });
            if (onDisconnect) onDisconnect();
          };
          const offError = (_e, data) => {
            cleanup();
            if (onMessage) onMessage({ type: 'error', message: data.message, code: data.code });
            if (onDisconnect) onDisconnect();
          };
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
          ipcRenderer.invoke('ai-stream:start', { requestId, action: msg.action, payload: msg.payload });
          active = { abort: () => { ipcRenderer.send('ai-stream:abort', { requestId }); cleanup(); } };
        },
        onMessage: { addListener: (fn) => { onMessage = fn; } },
        onDisconnect: { addListener: (fn) => { onDisconnect = fn; } },
        disconnect() { if (active) active.abort(); },
      };
    },
    getURL: (rel) => 'filo://' + String(rel || '').replace(/^\/+/, ''),
    openOptionsPage: () => filoMessage({ type: 'open_options' }),
  },
  storage: {
    local: {
      get(keys, callback) {
        const p = filoMessage({ type: '_storage:get', keys }).then(r => r?.value || {});
        if (typeof callback === 'function') {
          p.then(v => { try { callback(v); } catch (_) {} })
           .catch(() => { try { callback({}); } catch (_) {} });
          return;
        }
        return p;
      },
      async set(obj) { await filoMessage({ type: '_storage:set', obj }); },
      async remove(keys) { await filoMessage({ type: '_storage:remove', keys }); },
      async clear() { await filoMessage({ type: '_storage:clear' }); },
    },
    onChanged: {
      addListener(fn) {
        broadcastListeners.add((m) => {
          if (m?.type === '_storage:changed') {
            try { fn(m.changes, 'local'); } catch (_) {}
          }
        });
      },
    },
  },
  tabs: {
    async create({ url } = {}) {
      const r = await filoMessage({ type: '_tabs:create', url });
      return { id: r.id };
    },
    async query() { return []; },
    async remove(id) { await filoMessage({ type: '_tabs:remove', id }); },
  },
};

globalThis.chrome = chromeShim;
globalThis.self = globalThis; // i moduli IIFE controllano `self` come fallback

// ─── shortcut hook ─────────────────────────────────────────────────────────
// Lo shortcut globale fa un webContents.send('shortcut:triggered'); il content
// script registra un listener via chrome.runtime.onMessage su MSG.SHORTCUT_TRIGGERED.
// Adattatore: ascolto shortcut:triggered e ribroadcast come filo:broadcast.
ipcRenderer.on('shortcut:triggered', (_event, { command }) => {
  // Il payload deve usare il type MSG.SHORTCUT_TRIGGERED del catalogo messaggi.
  // Lo prendiamo dai constants caricati sopra (SN_MSG popolato da messages.js).
  const t = globalThis.SN_MSG?.MSG?.SHORTCUT_TRIGGERED || 'shortcut_triggered';
  for (const fn of broadcastListeners) {
    try { fn({ type: t, command }, { id: 'filo-desktop' }, () => {}); } catch (_) {}
  }
});

// ─── inject CSS condivisi + carica content script ──────────────────────────
//
// Equivalente a quanto faceva il manifest dell'estensione:
//   "css": [theme.css, menu.css, popup.css, sidebar.css, highlight.css,
//           spellcheck.css, feedback.css]
//   "js":  [constants, i18n, messages, icons, extractContext, popup, menu,
//           highlight, sidebar, spellcheck, feedback shared, feedback content,
//           content]
// Il timing è document_idle nell'estensione; qui caricamento subito dopo
// DOMContentLoaded della pagina ospite.

const STYLES = [
  'theme.css', 'menu.css', 'popup.css', 'sidebar.css',
  'highlight.css', 'spellcheck.css', 'feedback.css',
];

function injectStyles() {
  // Skip se il documento non è una pagina (es. about:blank, data:, view-source).
  if (!document.head) return;
  for (const f of STYLES) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'filo://style/' + f;
    document.head.appendChild(link);
  }
}

const SHARED_DIR = path.join(__dirname, '..', 'shared');
const CONTENT_DIR = path.join(__dirname, '..', 'content');

function loadScripts() {
  // Ordine identico a quello del manifest dell'estensione legacy.
  try { require(path.join(SHARED_DIR, 'constants.js')); } catch (e) { console.error('[Filo CS] constants', e); }
  try { require(path.join(SHARED_DIR, 'i18n.js')); } catch (e) { console.error('[Filo CS] i18n', e); }
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo CS] messages', e); }
  try { require(path.join(SHARED_DIR, 'icons.js')); } catch (e) { console.error('[Filo CS] icons', e); }
  try { require(path.join(SHARED_DIR, 'qr.js')); } catch (e) { console.error('[Filo CS] qr', e); }
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo CS] extractContext', e); }
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo CS] popup', e); }
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo CS] menu', e); }
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo CS] highlight', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo CS] sidebar', e); }
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo CS] spellcheck', e); }
  try { require(path.join(SHARED_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback shared', e); }
  try { require(path.join(CONTENT_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback content', e); }
  try { require(path.join(CONTENT_DIR, 'content.js')); } catch (e) { console.error('[Filo CS] content', e); }
}

function start() {
  injectStyles();
  loadScripts();
  // Marker DOM-visibile per i test: i moduli SN_* girano nel mondo isolato
  // del preload, ma il DOM è condiviso. Annoto sul documentElement quali
  // moduli si sono caricati con successo così smoke/Playwright può verificare.
  try {
    const loaded = ['SN_CONST', 'SN_MSG', 'SN_I18N', 'SN_ICONS', 'SN_EXTRACT',
      'SN_POPUP', 'SN_MENU', 'SN_HIGHLIGHT', 'SN_SIDEBAR', 'SN_SPELLCHECK',
      'SN_FEEDBACK'].filter((k) => typeof globalThis[k] !== 'undefined');
    document.documentElement.dataset.filoModules = loaded.join(',');
    document.documentElement.dataset.filoReady = '1';
  } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

// Helper usato dal main per il save-for-later shortcut: estrae metadata
// senza dipendere dal content script di estensione (che potrebbe non aver
// finito di caricarsi).
window.__sn_collectSavePayload = () => {
  try {
    const desc = document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content || '';
    const favicon = document.querySelector('link[rel*="icon"]')?.href || '';
    const excerpt = (document.body?.innerText || '').slice(0, 600);
    return { description: desc, favicon, excerpt };
  } catch (_) { return {}; }
};
