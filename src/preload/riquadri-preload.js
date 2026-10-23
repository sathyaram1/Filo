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
  // Dalla pagina sotto all'Aiuto che sta qui (#1509.3): icona premuta di nuovo, Aiuto spento, passo da scoprire, gesto sul passo.
  onAiuto: (fn) => { ipcRenderer.on('riquadri:aiuto', (_e, d) => { try { fn(d); } catch (e) { console.error('[Filo riquadri] aiuto', e); } }); },
  // La pagina sotto: indirizzo, origine e titolo, per la bozza e il feedback. Chiesta una volta, prima dei moduli.
  pagina: (() => {
    let p = null;
    try { p = ipcRenderer.sendSync('riquadri:chi'); } catch (_) { p = null; }
    return p && typeof p === 'object' ? { url: String(p.url || ''), origine: String(p.origine || ''), titolo: String(p.titolo || '') } : null;
  }),
};

// Il microfono di Filo lo apre la cornice della finestra (#586), come sui siti: qui arrivano solo i campioni.
const microfoniAperti = new Map();
ipcRenderer.on('microfono:dati', (_event, d) => {
  const m = d && microfoniAperti.get(d.id);
  if (!m) return;
  if (d.fine) { microfoniAperti.delete(d.id); try { m.suFine(); } catch (_) {} return; }
  if (d.dati) { try { m.suDati(d.dati instanceof Float32Array ? d.dati : Float32Array.from(d.dati)); } catch (_) {} }
});
const microfonoDellaCornice = {
  async apri({ suDati, suFine } = {}) {
    let r = null;
    try { r = await ipcRenderer.invoke('microfono:apri'); } catch (_) { r = null; }
    if (!r || !r.ok || !r.id) throw Object.assign(new Error('microfono'), { name: (r && r.errore) || 'NotAllowedError' });
    microfoniAperti.set(r.id, { suDati: suDati || (() => {}), suFine: suFine || (() => {}) });
    return {
      rate: r.rate,
      chiudi: () => {
        if (!microfoniAperti.delete(r.id)) return;
        ipcRenderer.invoke('microfono:chiudi', { id: r.id }).catch(() => {});
      },
    };
  },
};

const SHARED_DIR = path.join(__dirname, '..', 'shared');
const CONTENT_DIR = path.join(__dirname, '..', 'content');

// Lo stesso elenco di internal-preload.js, senza il colore della scheda: lo strato parla come la pagina, ma non è la
// pagina. Ogni require si legge da fermo: il pacchetto in sandbox lo porta dentro.
function loadContentScripts() {
  try { require(path.join(SHARED_DIR, 'constants.js')); } catch (e) { console.error('[Filo riquadri] constants.js', e); }
  try { require(path.join(SHARED_DIR, 'contenutoEsterno.js')); } catch (e) { console.error('[Filo riquadri] contenutoEsterno.js', e); }
  try { require(path.join(SHARED_DIR, 'filoUi.js')); } catch (e) { console.error('[Filo riquadri] filoUi.js', e); }
  try { require(path.join(SHARED_DIR, 'i18n.js')); } catch (e) { console.error('[Filo riquadri] i18n.js', e); }
  try { require(path.join(SHARED_DIR, 'clipboardHistory.js')); } catch (e) { console.error('[Filo riquadri] clipboardHistory.js', e); }
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo riquadri] messages.js', e); }
  try { require(path.join(SHARED_DIR, 'tasti.js')); } catch (e) { console.error('[Filo riquadri] tasti.js', e); }
  try { require(path.join(SHARED_DIR, 'disposizioneIcone.js')); } catch (e) { console.error('[Filo riquadri] disposizioneIcone.js', e); }
  try { require(path.join(SHARED_DIR, 'campoTesto.js')); } catch (e) { console.error('[Filo riquadri] campoTesto.js', e); }
  try { require(path.join(SHARED_DIR, 'urlNav.js')); } catch (e) { console.error('[Filo riquadri] urlNav.js', e); }
  try { require(path.join(SHARED_DIR, 'nomiSito.js')); } catch (e) { console.error('[Filo riquadri] nomiSito.js', e); }
  try { require(path.join(SHARED_DIR, 'wallet.js')); } catch (e) { console.error('[Filo riquadri] wallet.js', e); }
  try { require(path.join(SHARED_DIR, 'filoMarkdown.js')); } catch (e) { console.error('[Filo riquadri] filoMarkdown.js', e); }
  try { require(path.join(SHARED_DIR, 'linkSospetto.js')); } catch (e) { console.error('[Filo riquadri] linkSospetto.js', e); }
  try { require(path.join(SHARED_DIR, 'themeTokens.js')); } catch (e) { console.error('[Filo riquadri] themeTokens.js', e); }
  try { require(path.join(SHARED_DIR, 'confirmUi.js')); } catch (e) { console.error('[Filo riquadri] confirmUi.js', e); }
  try { require(path.join(SHARED_DIR, 'chatErrors.js')); } catch (e) { console.error('[Filo riquadri] chatErrors.js', e); }
  try { require(path.join(SHARED_DIR, 'icons.js')); } catch (e) { console.error('[Filo riquadri] icons.js', e); }
  try { require(path.join(SHARED_DIR, 'qr.js')); } catch (e) { console.error('[Filo riquadri] qr.js', e); }
  try { require(path.join(SHARED_DIR, 'calcMarkers.js')); } catch (e) { console.error('[Filo riquadri] calcMarkers.js', e); }
  try { require(path.join(SHARED_DIR, 'overlayPlacement.js')); } catch (e) { console.error('[Filo riquadri] overlayPlacement.js', e); }
  try { require(path.join(SHARED_DIR, 'guardianoStatico.js')); } catch (e) { console.error('[Filo riquadri] guardianoStatico.js', e); }
  try { require(path.join(SHARED_DIR, 'campiSegreti.js')); } catch (e) { console.error('[Filo riquadri] campiSegreti.js', e); }
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo riquadri] extractContext.js', e); }
  try { require(path.join(CONTENT_DIR, 'gesto.js')); } catch (e) { console.error('[Filo riquadri] gesto.js', e); }
  try { require(path.join(SHARED_DIR, 'avvisiTempo.js')); } catch (e) { console.error('[Filo riquadri] avvisiTempo.js', e); }
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo riquadri] popup.js', e); }
  try { require(path.join(CONTENT_DIR, 'vistoDavvero.js')); } catch (e) { console.error('[Filo riquadri] vistoDavvero.js', e); }
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo riquadri] menu.js', e); }
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo riquadri] highlight.js', e); }
  try { require(path.join(CONTENT_DIR, 'aiutoPagina.js')); } catch (e) { console.error('[Filo riquadri] aiutoPagina.js', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo riquadri] sidebar.js', e); }
  try { require(path.join(CONTENT_DIR, 'coerenza.js')); } catch (e) { console.error('[Filo riquadri] coerenza.js', e); }
  try { require(path.join(CONTENT_DIR, 'correttoreRegole.js')); } catch (e) { console.error('[Filo riquadri] correttoreRegole.js', e); }
  try { globalThis.SN_DIZIONARIO = require('./dizionario.js')(ipcRenderer, webFrame); } catch (e) { console.error('[Filo riquadri] dizionario', e); }
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo riquadri] spellcheck.js', e); }
  try { require(path.join(SHARED_DIR, 'feedback.js')); } catch (e) { console.error('[Filo riquadri] feedback.js', e); }
  try { require(path.join(SHARED_DIR, 'feedbackClientIdHash.js')); } catch (e) { console.error('[Filo riquadri] feedbackClientIdHash.js', e); }
  try { require(path.join(SHARED_DIR, 'feedbackAttachTypes.js')); } catch (e) { console.error('[Filo riquadri] feedbackAttachTypes.js', e); }
  try { require(path.join(CONTENT_DIR, 'feedback.js')); } catch (e) { console.error('[Filo riquadri] feedback.js', e); }
  try { require(path.join(CONTENT_DIR, 'redteamAttack.js')); } catch (e) { console.error('[Filo riquadri] redteamAttack.js', e); }
  try { require(path.join(CONTENT_DIR, 'translatePage.js')); } catch (e) { console.error('[Filo riquadri] translatePage.js', e); }
  try { require(path.join(SHARED_DIR, 'ttsChunk.js')); } catch (e) { console.error('[Filo riquadri] ttsChunk.js', e); }
  try { require(path.join(SHARED_DIR, 'modelCaps.js')); } catch (e) { console.error('[Filo riquadri] modelCaps.js', e); }
  try { require(path.join(SHARED_DIR, 'ttsVoices.js')); } catch (e) { console.error('[Filo riquadri] ttsVoices.js', e); }
  try { require(path.join(SHARED_DIR, 'dictationSegmenter.js')); } catch (e) { console.error('[Filo riquadri] dictationSegmenter.js', e); }
  try { require(path.join(SHARED_DIR, 'ascolto.js')); } catch (e) { console.error('[Filo riquadri] ascolto.js', e); }
  try { require(path.join(SHARED_DIR, 'voceChat.js')); } catch (e) { console.error('[Filo riquadri] voceChat.js', e); }
  try { require(path.join(CONTENT_DIR, 'tts.js')); } catch (e) { console.error('[Filo riquadri] tts.js', e); }
  try { require(path.join(CONTENT_DIR, 'editBox.js')); } catch (e) { console.error('[Filo riquadri] editBox.js', e); }
  try { require(path.join(CONTENT_DIR, 'actions.js')); } catch (e) { console.error('[Filo riquadri] actions.js', e); }
  try { require(path.join(CONTENT_DIR, 'menuIcons.js')); } catch (e) { console.error('[Filo riquadri] menuIcons.js', e); }
  try { require(path.join(CONTENT_DIR, 'content.js')); } catch (e) { console.error('[Filo riquadri] content.js', e); }
  try { require(path.join(CONTENT_DIR, 'stratoRiquadri.js')); } catch (e) { console.error('[Filo riquadri] stratoRiquadri.js', e); }
  try { document.documentElement.dataset.filoReady = '1'; } catch (_) {}
}

if (IN_STRATO) {
  globalThis.chrome = chromeShim;
  globalThis.self = globalThis;
  globalThis.SN_STRATO_RIQUADRI = Object.freeze({ ...strato, pagina: strato.pagina() });
  globalThis.SN_MICROFONO_CORNICE = microfonoDellaCornice;
  const consegnaScorciatoia = require('./scorciatoia.js');
  ipcRenderer.on('shortcut:triggered', (_event, payload = {}) => consegnaScorciatoia(broadcastListeners, payload, filoMessage));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadContentScripts, { once: true });
  else loadContentScripts();
}
