// Preload dello strato dei riquadri sopra un sito (src/pages/riquadri/, src/main/stratoDeiRiquadri.js): i content script
// di Filo nel mondo isolato, come sui siti, con lo shim chrome.* che il main fa parlare come la pagina sotto. Alla pagina
// dello strato non arriva niente. Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

const { ipcRenderer, webFrame } = require('electron');
const path = require('node:path');

const IN_STRATO = (() => {
  try { return location.protocol === 'filo:' && location.host === 'riquadri'; } catch (_) { return false; }
})();

let streamCounter = 0;
const filoMessage = (msg) => ipcRenderer.invoke('filo:message', msg);
const broadcastListeners = new Set();
ipcRenderer.on('filo:broadcast', (_event, msg) => {
  for (const fn of broadcastListeners) {
    try { fn(msg, { id: 'filo-desktop' }, () => {}); } catch (e) { console.warn('[Filo riquadri] listener err', e); }
  }
});

// Gemello di quello di page-preload.js: le stesse porte, la stessa identità (la pagina sotto).
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
          const requestId = `r${Date.now()}_${++streamCounter}`;
          const offMeta = (_e, data) => onMessage && onMessage({ type: 'meta', ...data });
          const offDelta = (_e, data) => onMessage && onMessage({ type: 'delta', delta: data.delta });
          const offReset = () => onMessage && onMessage({ type: 'reset' });
          const offDone = (_e, data) => {
            cleanup();
            if (onMessage) onMessage({ type: 'done', ...data });
            if (onDisconnect) onDisconnect();
          };
          const offError = (_e, data) => {
            cleanup();
            if (onMessage) onMessage({ type: 'error', ...data });
            if (onDisconnect) onDisconnect();
          };
          const cleanup = () => {
            for (const [s, f] of [['meta', offMeta], ['delta', offDelta], ['reset', offReset], ['done', offDone], ['error', offError]]) {
              ipcRenderer.removeListener(`ai-stream:${requestId}:${s}`, f);
            }
          };
          ipcRenderer.on(`ai-stream:${requestId}:meta`, offMeta);
          ipcRenderer.on(`ai-stream:${requestId}:delta`, offDelta);
          ipcRenderer.on(`ai-stream:${requestId}:reset`, offReset);
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
        const p = filoMessage({ type: '_storage:get', keys }).then((r) => r?.value || {});
        if (typeof callback === 'function') {
          p.then((v) => { try { callback(v); } catch (_) {} })
            .catch(() => { try { callback({}); } catch (_) {} });
          return undefined;
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
          if (m?.type === '_storage:changed') { try { fn(m.changes, 'local'); } catch (_) {} }
        });
      },
      removeListener() {},
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

// Lo strato col suo main: lo stato dei riquadri (posa e tastiera), Sostituisci della Modifica, i gesti del vuoto.
const strato = {
  stato: (d) => ipcRenderer.send('riquadri:stato', d),
  inPagina: (d) => ipcRenderer.send('riquadri:in-pagina', d),
  inoltra: (gesto) => ipcRenderer.send('riquadri:vuoto', gesto),
  onCursore: (fn) => { ipcRenderer.on('riquadri:cursore', (_e, forma) => { try { fn(forma); } catch (_) {} }); },
  onApri: (fn) => { ipcRenderer.on('riquadri:apri', (_e, d) => { try { fn(d); } catch (e) { console.error('[Filo riquadri] apri', e); } }); },
  onEsc: (fn) => { ipcRenderer.on('riquadri:esc', () => { try { fn(); } catch (_) {} }); },
  // La pagina sotto: indirizzo, origine e titolo, per la bozza e il feedback. Chiesta una volta, prima dei moduli.
  pagina: (() => {
    let p = null;
    try { p = ipcRenderer.sendSync('riquadri:chi'); } catch (_) { p = null; }
    return p && typeof p === 'object' ? { url: String(p.url || ''), origine: String(p.origine || ''), titolo: String(p.titolo || '') } : null;
  }),
};

function loadContentScripts() {
  const SHARED = path.join(__dirname, '..', 'shared');
  const CONTENT = path.join(__dirname, '..', 'content');
  const safe = (p) => { try { require(p); } catch (e) { console.error('[Filo riquadri]', p, e.message); } };
  // Lo stesso elenco di internal-preload.js, senza ciò che descrive la scheda (colore, traduzione della pagina):
  // lo strato parla come la pagina, ma non è la pagina.
  safe(path.join(SHARED, 'constants.js'));
  safe(path.join(SHARED, 'contenutoEsterno.js'));
  safe(path.join(SHARED, 'filoUi.js'));
  safe(path.join(SHARED, 'i18n.js'));
  safe(path.join(SHARED, 'clipboardHistory.js'));
  safe(path.join(SHARED, 'messages.js'));
  safe(path.join(SHARED, 'tasti.js'));
  safe(path.join(SHARED, 'disposizioneIcone.js'));
  safe(path.join(SHARED, 'campoTesto.js'));
  safe(path.join(SHARED, 'urlNav.js'));
  safe(path.join(SHARED, 'nomiSito.js'));
  safe(path.join(SHARED, 'wallet.js'));
  safe(path.join(SHARED, 'filoMarkdown.js'));
  safe(path.join(SHARED, 'linkSospetto.js'));
  safe(path.join(SHARED, 'themeTokens.js'));
  safe(path.join(SHARED, 'confirmUi.js'));
  safe(path.join(SHARED, 'chatErrors.js'));
  safe(path.join(SHARED, 'icons.js'));
  safe(path.join(SHARED, 'qr.js'));
  safe(path.join(SHARED, 'calcMarkers.js'));
  safe(path.join(SHARED, 'overlayPlacement.js'));
  safe(path.join(SHARED, 'guardianoStatico.js'));
  safe(path.join(SHARED, 'campiSegreti.js'));
  safe(path.join(CONTENT, 'extractContext.js'));
  safe(path.join(CONTENT, 'gesto.js'));
  safe(path.join(SHARED, 'avvisiTempo.js'));
  safe(path.join(CONTENT, 'popup.js'));
  safe(path.join(CONTENT, 'vistoDavvero.js'));
  safe(path.join(CONTENT, 'menu.js'));
  safe(path.join(CONTENT, 'highlight.js'));
  safe(path.join(CONTENT, 'sidebar.js'));
  safe(path.join(CONTENT, 'coerenza.js'));
  safe(path.join(CONTENT, 'correttoreRegole.js'));
  try { globalThis.SN_DIZIONARIO = require('./dizionario.js')(ipcRenderer, webFrame); } catch (e) { console.error('[Filo riquadri] dizionario', e.message); }
  safe(path.join(CONTENT, 'spellcheck.js'));
  safe(path.join(SHARED, 'feedback.js'));
  safe(path.join(SHARED, 'feedbackClientIdHash.js'));
  safe(path.join(SHARED, 'feedbackAttachTypes.js'));
  safe(path.join(CONTENT, 'feedback.js'));
  safe(path.join(CONTENT, 'redteamAttack.js'));
  safe(path.join(SHARED, 'ttsChunk.js'));
  safe(path.join(SHARED, 'modelCaps.js'));
  safe(path.join(SHARED, 'ttsVoices.js'));
  safe(path.join(SHARED, 'dictationSegmenter.js'));
  safe(path.join(SHARED, 'ascolto.js'));
  safe(path.join(SHARED, 'voceChat.js'));
  if (process.env.NODE_ENV === 'test') safe(path.join(SHARED, '..', '..', 'tests', 'fixtures', 'testModels.js'));
  safe(path.join(CONTENT, 'tts.js'));
  safe(path.join(CONTENT, 'editBox.js'));
  safe(path.join(CONTENT, 'actions.js'));
  safe(path.join(CONTENT, 'menuIcons.js'));
  safe(path.join(CONTENT, 'content.js'));
  safe(path.join(CONTENT, 'stratoRiquadri.js'));
  try { document.documentElement.dataset.filoReady = '1'; } catch (_) {}
}

if (IN_STRATO) {
  globalThis.chrome = chromeShim;
  globalThis.self = globalThis;
  globalThis.SN_STRATO_RIQUADRI = Object.freeze({ ...strato, pagina: strato.pagina() });
  const consegnaScorciatoia = require('./scorciatoia.js');
  ipcRenderer.on('shortcut:triggered', (_event, payload = {}) => consegnaScorciatoia(broadcastListeners, payload, filoMessage));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadContentScripts, { once: true });
  else loadContentScripts();
}
