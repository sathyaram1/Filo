// Preload per le pagine interne (filo://...).
//
// contextIsolation è DISATTIVATO per queste pagine (vedi tabs.js): è codice
// nostro fidato e ha bisogno di chrome.* in scope globale per riusare 1:1
// quanto portato dall'estensione. Possiamo assegnare direttamente window.*
// e l'assegnazione è visibile alla pagina.

const { ipcRenderer, webFrame } = require('electron');

// Modalità zoom con la rotella attivata dal click centrale (sostituisce
// l'autoscroll nativo) + zoom con Ctrl/Cmd (rotella, pinch del trackpad,
// Ctrl +/-/0): sulle pagine interne funziona come su quelle web. Le pagine che
// zoomano da sé si tirano fuori con `dataset.filoOwnZoom`. Vedi wheel-zoom.js.
try { require('./wheel-zoom.js')(webFrame, { pageZoom: true, ipcRenderer }); } catch (e) { console.error('[Filo internal] wheel-zoom', e); }

// ─── SICUREZZA: gate d'origine ─────────────────────────────────────────────
// Questo preload è PRIVILEGIATO: espone window.filo (IPC, shell, AI stream) e
// uno shim chrome.* con accesso a storage (chiavi API + TUTTI i dati utente) e
// alle tab. È assegnato solo alle schede nate come filo://, ma il preload è
// legato al WebContents, non all'URL corrente: se per qualunque motivo (un
// redirect lato server a metà caricamento, o una navigazione in-place sfuggita
// al guard will-navigate di tabs.js) un documento NON-filo finisse a girare qui,
// NON deve ricevere le API privilegiate, altrimenti un sito esterno potrebbe
// leggere/esfiltrare lo storage. Il preload gira DOPO il commit della
// navigazione, quindi `location` riflette già l'origine reale del documento: se
// non è filo:, non esponiamo nulla e non iniettiamo i content script.
const IS_FILO_ORIGIN = (() => {
  try { return location.protocol === 'filo:'; } catch (_) { return false; }
})();

let streamCounter = 0;

const filoApi = {
  message: (msg) => ipcRenderer.invoke('filo:message', msg),
  getURL: (rel) => 'filo://' + String(rel || '').replace(/^\/+/, ''),
  // Su quale sistema gira Filo: 'darwin' (Mac), 'win32' (Windows), 'linux'.
  // Le pagine interne ne hanno bisogno per non MENTIRE all'utente — le
  // scorciatoie hanno una forma diversa su Mac, e le shell fra cui scegliere
  // nella modalità terminale non sono le stesse. È un dato pubblico del
  // sistema, non un'informazione dell'utente: nessuna superficie in più.
  sistema: process.platform,
  onBroadcast: (fn) => {
    const wrapped = (_event, msg) => { try { fn(msg); } catch (_) {} };
    ipcRenderer.on('filo:broadcast', wrapped);
    return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
  },
  // Reasoning "vero" in diretta dal modello durante una FILO_CHAT. Il main
  // pusha { reqId, text } sul canale 'filo:reasoning' man mano che arrivano i
  // thought summary; il chiamante filtra per reqId. Ritorna un unsubscribe.
  onReasoning: (fn) => {
    const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
    ipcRenderer.on('filo:reasoning', wrapped);
    return () => ipcRenderer.removeListener('filo:reasoning', wrapped);
  },
  // #420 — la RISPOSTA in diretta durante una FILO_CHAT. Il main pusha
  // { reqId, delta } (nuovi caratteri del testo) oppure { reqId, reset: true }
  // (fallback provider: butta il testo mostrato finora) sul canale 'filo:answer'.
  // Il chiamante filtra per reqId. Ritorna un unsubscribe.
  onAnswer: (fn) => {
    const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
    ipcRenderer.on('filo:answer', wrapped);
    return () => ipcRenderer.removeListener('filo:answer', wrapped);
  },
  aiStream: ({ action, payload, onMeta, onDelta, onReset, onDone, onError }) => {
    const requestId = `s${Date.now()}_${++streamCounter}`;
    const offMeta = (_e, data) => onMeta && onMeta(data);
    const offDelta = (_e, data) => onDelta && onDelta(data.delta);
    // reset = il provider è caduto a metà stream e il main riparte col fallback:
    // il chiamante deve buttare i delta accumulati finora (#273).
    const offReset = (_e, data) => onReset && onReset(data);
    const offDone = (_e, data) => { cleanup(); onDone && onDone(data); };
    const offError = (_e, data) => { cleanup(); onError && onError(data); };
    const cleanup = () => {
      ipcRenderer.removeListener(`ai-stream:${requestId}:meta`, offMeta);
      ipcRenderer.removeListener(`ai-stream:${requestId}:delta`, offDelta);
      ipcRenderer.removeListener(`ai-stream:${requestId}:reset`, offReset);
      ipcRenderer.removeListener(`ai-stream:${requestId}:done`, offDone);
      ipcRenderer.removeListener(`ai-stream:${requestId}:error`, offError);
    };
    ipcRenderer.on(`ai-stream:${requestId}:meta`, offMeta);
    ipcRenderer.on(`ai-stream:${requestId}:delta`, offDelta);
    ipcRenderer.on(`ai-stream:${requestId}:reset`, offReset);
    ipcRenderer.on(`ai-stream:${requestId}:done`, offDone);
    ipcRenderer.on(`ai-stream:${requestId}:error`, offError);
    ipcRenderer.invoke('ai-stream:start', { requestId, action, payload });
    return {
      abort: () => { ipcRenderer.send('ai-stream:abort', { requestId }); cleanup(); },
    };
  },
  // Esecuzione shell (modalità terminale della dashboard), gemella di aiStream.
  // onData({chunk, stream}), onExit({code, cwd}), onError({message}).
  // Ritorna { sendInput(text), abort() }.
  shellExec: ({ command, cwd, shell, onData, onExit, onError }) => {
    const execId = `sh${Date.now()}_${++streamCounter}`;
    const offData = (_e, data) => onData && onData(data);
    const offExit = (_e, data) => { cleanup(); onExit && onExit(data); };
    const offError = (_e, data) => { cleanup(); onError && onError(data); };
    const cleanup = () => {
      ipcRenderer.removeListener(`shell:${execId}:data`, offData);
      ipcRenderer.removeListener(`shell:${execId}:exit`, offExit);
      ipcRenderer.removeListener(`shell:${execId}:error`, offError);
    };
    ipcRenderer.on(`shell:${execId}:data`, offData);
    ipcRenderer.on(`shell:${execId}:exit`, offExit);
    ipcRenderer.on(`shell:${execId}:error`, offError);
    ipcRenderer.invoke('shell:start', { execId, command, cwd, shell });
    return {
      sendInput: (text) => ipcRenderer.send('shell:input', { execId, text }),
      abort: () => { ipcRenderer.send('shell:abort', { execId }); cleanup(); },
    };
  },
  shellHome: () => ipcRenderer.invoke('shell:home'),
  // Esiste questo comando nella shell? Per l'evidenziazione live (rosso = non
  // riconosciuto) della dashboard in modalità terminale.
  shellWhich: (opts) => ipcRenderer.invoke('shell:which', opts),
  // Questo "/dominio.tld" risolve davvero? Per colorare di rosso (e non
  // navigare verso) un sito inesistente dalla barra comando della dashboard.
  siteResolves: (opts) => ipcRenderer.invoke('net:resolves', opts),
};

// Espone window.filo SOLO su origine filo:// (vedi IS_FILO_ORIGIN sopra).
if (IS_FILO_ORIGIN) window.filo = filoApi;

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
            onReset: () => onMessage && onMessage({ type: 'reset' }),
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
      get(keys, callback) {
        const p = filoApi.message({ type: '_storage:get', keys }).then(r => r?.value || {});
        if (typeof callback === 'function') {
          p.then(v => { try { callback(v); } catch (_) {} })
           .catch(() => { try { callback({}); } catch (_) {} });
          return;
        }
        return p;
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

// ─── shortcut hook ─────────────────────────────────────────────────────────
// Gemello dell'adattatore in page-preload.js. Lo shortcut globale (Alt+E/Alt+T/
// Alt+H in shortcuts.js) e la voce "Aiuto" del menu tasto destro sulla linguetta
// (TabManager.openHelp in tabs.js) fanno webContents.send('shortcut:triggered')
// sul tab attivo. Il content script (content.js) ascolta MSG.SHORTCUT_TRIGGERED
// via chrome.runtime.onMessage: qui traduco l'evento IPC grezzo nel messaggio del
// catalogo e lo consegno ai listener del nostro shim. Senza questo adattatore le
// scorciatoie erano mute sulle pagine filo:// (i content script c'erano ma non
// ricevevano l'evento — asimmetria vs pagine web). `context` è opzionale (lo usa
// la voce "Aiuto" per dire all'agente da dove è stato invocato). Solo su origine
// filo://, dove lo shim e i content script sono davvero installati.
if (IS_FILO_ORIGIN) {
  ipcRenderer.on('shortcut:triggered', (_event, { command, context } = {}) => {
    const t = globalThis.SN_MSG?.MSG?.SHORTCUT_TRIGGERED || 'shortcut_triggered';
    for (const fn of chromeShim.runtime.onMessage._listeners) {
      try { fn({ type: t, command, context }, { id: 'filo-desktop' }, () => {}); } catch (_) {}
    }
  });
}

// Inietta i content script (menu, popup, sidebar, highlight, spellcheck,
// feedback) su tutte le pagine filo:// — il tasto destro Filo deve funzionare
// ovunque, come richiesto dall'utente.
const path = require('node:path');
const shouldInjectContentScripts = () => true;
function injectContentScriptStyles() {
  const STYLES = ['theme.css', 'menu.css', 'popup.css', 'sidebar.css',
    'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css'];
  for (const f of STYLES) {
    if (document.querySelector(`link[href="filo://style/${f}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'filo://style/' + f;
    document.head.appendChild(link);
  }
}
function loadContentScripts() {
  const SHARED = path.join(__dirname, '..', 'shared');
  const CONTENT = path.join(__dirname, '..', 'content');
  // i moduli SN_CONST/I18N/MSG/ICONS sono già caricati via <script> nelle
  // pagine interne; require() li reseguirà ma è idempotente (riassegna gli
  // stessi oggetti su globalThis).
  const safe = (p) => { try { require(p); } catch (e) { console.error('[Filo CS]', p, e.message); } };
  safe(path.join(SHARED, 'constants.js'));
  // Il marchio della UI di Filo (menu, avvisi, popup): lo mettono i moduli che
  // la disegnano, lo legge chi cammina sulla pagina.
  safe(path.join(SHARED, 'filoUi.js'));
  safe(path.join(SHARED, 'i18n.js'));
  safe(path.join(SHARED, 'messages.js'));
  safe(path.join(SHARED, 'tasti.js')); // nomi delle scorciatoie per il sistema di chi legge: PRIMA di menu/actions/content
  safe(path.join(SHARED, 'campoTesto.js')); // "si sta scrivendo qui?": PRIMA di content.js, che ci decide Ctrl+Z
  safe(path.join(SHARED, 'urlNav.js')); // #437 — "è davvero un indirizzo?" per Copia URL/Condividi
  safe(path.join(SHARED, 'themeTokens.js'));
  safe(path.join(SHARED, 'confirmUi.js'));
  safe(path.join(SHARED, 'chatErrors.js')); // #360 — errori tecnici → frasi per l'utente
  safe(path.join(SHARED, 'icons.js'));
  safe(path.join(SHARED, 'qr.js'));
  safe(path.join(SHARED, 'overlayPlacement.js')); // #500 — geometria di menu e riquadro risposta: PRIMA di popup.js e menu.js
  safe(path.join(CONTENT, 'extractContext.js'));
  safe(path.join(CONTENT, 'popup.js'));
  safe(path.join(CONTENT, 'menu.js'));
  safe(path.join(CONTENT, 'highlight.js'));
  safe(path.join(CONTENT, 'sidebar.js'));
  safe(path.join(CONTENT, 'spellcheck.js'));
  safe(path.join(SHARED, 'feedback.js'));
  safe(path.join(SHARED, 'feedbackClientIdHash.js')); // S1.F2.2
  safe(path.join(SHARED, 'feedbackAttachTypes.js')); // allowlist tipi allegato
  safe(path.join(CONTENT, 'feedback.js'));
  safe(path.join(CONTENT, 'redteamAttack.js'));
  safe(path.join(SHARED, 'tabColor.js'));
  safe(path.join(CONTENT, 'pageColor.js'));
  safe(path.join(CONTENT, 'translatePage.js'));
  safe(path.join(SHARED, 'ttsChunk.js'));
  safe(path.join(SHARED, 'modelCaps.js'));
  safe(path.join(SHARED, 'ttsVoices.js'));
  safe(path.join(SHARED, 'dictationSegmenter.js'));
  // Solo nei test: modelli di prova (vedi loader.js).
  if (process.env.NODE_ENV === 'test') safe(path.join(SHARED, '..', '..', 'tests', 'fixtures', 'testModels.js'));
  safe(path.join(CONTENT, 'tts.js'));
  safe(path.join(CONTENT, 'editBox.js'));
  safe(path.join(CONTENT, 'actions.js'));
  safe(path.join(CONTENT, 'menuIcons.js'));
  safe(path.join(CONTENT, 'content.js'));
  try {
    document.documentElement.dataset.filoReady = '1';
    document.documentElement.dataset.filoContentScripts = '1';
  } catch (_) {}
}
// Self è già aliasato a window/globalThis via il primo `globalThis.self = ...`
// del shim chrome più sotto? No — non l'abbiamo fatto qui. I content script
// usano `self.SN_*`. Con contextIsolation:false, `self` è già aliased a
// window dal browser (è una proprietà standard del WindowOrWorkerGlobalScope).
// Sovrascrivi lo stub di Chromium PRIMA di caricare i content script, così
// chrome.runtime.sendMessage è già il nostro shim IPC quando content.js fa
// fetchSettings() durante init().
// Installa lo shim chrome.* SOLO su origine filo:// (vedi IS_FILO_ORIGIN). Su
// un'origine non-filo finita qui per errore non esponiamo storage/IPC alla
// pagina non fidata.
if (IS_FILO_ORIGIN) {
  try {
    Object.defineProperty(window, 'chrome', {
      value: chromeShim,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    try { window.chrome = chromeShim; } catch (_) { console.warn('[Filo] impossibile sovrascrivere window.chrome', e); }
  }
}

function bootContentScripts() {
  if (!shouldInjectContentScripts()) return;
  injectContentScriptStyles();
  loadContentScripts();
}
// I content script (e il loro accesso a chrome.*) girano solo sulle pagine
// interne fidate. Su origine non-filo non iniettiamo nulla.
if (IS_FILO_ORIGIN) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootContentScripts, { once: true });
  } else {
    bootContentScripts();
  }
} else {
  try {
    console.warn('[Filo] internal-preload su origine non-filo:', location.href,
      '— API privilegiate non esposte');
  } catch (_) {}
}
