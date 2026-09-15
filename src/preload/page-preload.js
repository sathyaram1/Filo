// Preload delle pagine web: inietta CSS e content script di Filo.
// La pagina è codice NON fidato, quindi tutto gira nel mondo isolato del
// preload (contextIsolation) — di condiviso c'è solo il DOM.

const { ipcRenderer, webFrame } = require('electron');
const path = require('node:path');

// #405 — questo preload gira in OGNI frame, pagina e riquadri incorporati.
// Regola: nel frame principale si carica tutto al DOMContentLoaded; in un
// riquadro NIENTE finché l'utente non lo tocca davvero (una pagina piena di
// widget pagherebbe decine di volte il prezzo per frame che nessuno usa).
// Le funzioni di PAGINA (colore della scheda, banner, traduzione) restano del
// solo frame principale: in un riquadro descriverebbero il rettangolo sbagliato.
const IS_SUBFRAME = (() => {
  try { return window.top !== window.self; } catch (_) { return true; }
})();

// #145 — le schede riaperte all'avvio nascono col flag '--filo-suppress-autoplay'
// e i loro media non devono partire da soli (ripartivano tutti insieme). Il
// listener si installa SUBITO, prima della pagina, e cade alla prima
// interazione dell'utente: da lì in poi comanda lui.
if (process.argv.includes('--filo-suppress-autoplay')) {
  try {
    let active = true;
    const onPlay = (e) => {
      if (!active) return;
      const m = e.target;
      if (m && typeof m.pause === 'function') { try { m.pause(); } catch (_) {} }
    };
    document.addEventListener('play', onPlay, true);
    const release = () => {
      if (!active) return;
      active = false;
      document.removeEventListener('play', onPlay, true);
      for (const ev of ['pointerdown', 'keydown', 'click', 'touchstart']) {
        window.removeEventListener(ev, release, true);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'click', 'touchstart']) {
      window.addEventListener(ev, release, true);
    }
  } catch (_) { /* il blocco non deve MAI impedire il caricamento della pagina */ }
}

// Il listener `contextmenu` va registrato QUI, prima di ogni script di pagina:
// certi siti (YouTube, Reddit) registrano il proprio su window+capture e lo
// fermano con stopImmediatePropagation, e a parità di fase vince chi arriva
// prima — registrandoci al DOMContentLoaded il menu di Filo non compariva.
// L'handler vero si aggancia dopo via __snSetContextMenuHandler.
let contextMenuHandler = null;
try {
  globalThis.__snSetContextMenuHandler = (fn) => { contextMenuHandler = fn; };
  window.addEventListener('contextmenu', (e) => {
    if (typeof contextMenuHandler === 'function') { contextMenuHandler(e); return; }
    // #405 — primo tasto destro in un riquadro: monta Filo e RIGIOCA questo
    // stesso clic, o il primo tentativo va perso e si deve cliccare due volte.
    if (!IS_SUBFRAME) return;
    // Shift è la via di fuga: l'evento resta al riquadro, intatto.
    if (e.shiftKey) return;
    try { e.stopPropagation(); } catch (_) {}
    replayContextMenu(e);
    ensureContentScripts();
  }, { capture: true });
} catch (_) { /* il bridge non deve MAI impedire il caricamento della pagina */ }

// L'evento vero, una volta consegnato, perde composedPath(): l'elemento reale
// (shadow DOM compreso) va fotografato SUBITO, o il menu si apre sul posto
// sbagliato quando lo rigiochiamo.
function replayContextMenu(e) {
  let node = null;
  try { node = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target; }
  catch (_) { node = e.target; }
  const copy = {
    target: node,
    currentTarget: node,
    clientX: e.clientX, clientY: e.clientY,
    pageX: e.pageX, pageY: e.pageY,
    screenX: e.screenX, screenY: e.screenY,
    button: e.button,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
    defaultPrevented: false,
    composedPath: () => (node ? [node] : []),
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
  };
  const deadline = Date.now() + 3000;
  const tick = () => {
    if (typeof contextMenuHandler === 'function') { try { contextMenuHandler(copy); } catch (_) {} return; }
    if (Date.now() > deadline) return;
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}

// Zoom della scheda (wheel-zoom.js), solo nel frame principale: un badge dentro
// un riquadro sarebbe un secondo indicatore che contraddice il primo.
if (!IS_SUBFRAME) {
  try { require('./wheel-zoom.js')(webFrame, { pageZoom: true, ipcRenderer }); } catch (e) { console.error('[Filo CS] wheel-zoom', e); }
}

// Anti-fingerprint nel MAIN WORLD, prima degli script di pagina. Il seed arriva
// SINCRONO dal main: il master secret non tocca mai il mondo non fidato. Solo
// http(s) e solo nel frame principale — coprire anche i riquadri cambierebbe i
// segnali dei widget di terzi, ed è una scelta a sé, non una conseguenza (#405).
if (!IS_SUBFRAME) try {
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  if (/^https?:/i.test(loc)) {
    const cfg = ipcRenderer.sendSync('filo:fp-config', loc) || { level: 0, seed: 0 };
    if (cfg && cfg.level > 0) {
      const { buildGuardSource } = require('./fingerprint-guard.js');
      webFrame.executeJavaScript(buildGuardSource(cfg.seed, cfg.level), true).catch(() => {});
    }
  }
} catch (e) { /* la protezione non deve MAI bloccare il caricamento della pagina */ }

// Shim chrome.* nel mondo isolato: invisibile alla pagina, che non deve poterlo
// né vedere né chiamare.

let streamCounter = 0;

const filoMessage = (msg) => ipcRenderer.invoke('filo:message', msg);

const broadcastListeners = new Set();
// #407 — messaggi che devono SVEGLIARE un riquadro: «Traduci la pagina» arriva
// dalla pagina ospite, non da un clic lì dentro, e un riquadro addormentato
// resterebbe in lingua originale sotto un avviso che dice "fatto". Valore
// letterale perché SN_MSG qui non è ancora caricato.
const WAKE_BROADCASTS = new Set(['frame_translate']);
ipcRenderer.on('filo:broadcast', (_event, msg) => {
  const deliver = () => {
    for (const fn of broadcastListeners) {
      try { fn(msg, { id: 'filo-desktop' }, () => {}); } catch (e) { console.warn('[Filo CS] listener err', e); }
    }
  };
  const type = msg && msg.type;
  // Il ritorno all'originale non sveglia nessuno: un riquadro che dorme non ha
  // mai tradotto niente, e montarci Filo dentro per non fare nulla sarebbe
  // lavoro pagato per niente.
  const wakes = WAKE_BROADCASTS.has(type) && msg.mode !== 'restore';
  if (IS_SUBFRAME && !contentScriptsStarted && wakes) {
    ensureContentScripts();
    waitForContentScripts(deliver);
    return;
  }
  deliver();
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
          // reset = provider caduto a metà stream, il main riparte col fallback:
          // il consumer deve buttare i delta accumulati finora (#273).
          const offReset = () => onMessage && onMessage({ type: 'reset' });
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
            ipcRenderer.removeListener(`ai-stream:${requestId}:reset`, offReset);
            ipcRenderer.removeListener(`ai-stream:${requestId}:done`, offDone);
            ipcRenderer.removeListener(`ai-stream:${requestId}:error`, offError);
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

// ─── #405 — quale frame sta usando l'utente ────────────────────────────────
//
// Le scorciatoie globali (Alt+E Spiegazione, Alt+T Traduci) lavorano sul testo
// selezionato. Con i riquadri incorporati il testo selezionato può stare dentro
// il riquadro, ma `webContents.send` consegna SOLO al frame principale: la
// scorciatoia arrivava a chi non aveva nessuna selezione e non succedeva nulla.
// Ogni frame segnala al main quando l'utente ci sta interagendo (limitato a una
// segnalazione ogni mezzo secondo), così il main sa a chi consegnare.
try {
  let lastClaim = 0;
  const claim = () => {
    const now = Date.now();
    if (now - lastClaim < 500) return;
    lastClaim = now;
    try { ipcRenderer.send('filo:frame-active'); } catch (_) {}
  };
  for (const ev of ['pointerdown', 'keydown', 'focusin']) {
    window.addEventListener(ev, claim, { capture: true, passive: true });
  }
} catch (_) { /* mai bloccare il caricamento della pagina */ }

// ─── shortcut hook ─────────────────────────────────────────────────────────
// Lo shortcut globale fa un webContents.send('shortcut:triggered'); il content
// script registra un listener via chrome.runtime.onMessage su MSG.SHORTCUT_TRIGGERED.
// Adattatore: ascolto shortcut:triggered e ribroadcast come filo:broadcast.
ipcRenderer.on('shortcut:triggered', (_event, { command, context } = {}) => {
  // Il payload deve usare il type MSG.SHORTCUT_TRIGGERED del catalogo messaggi.
  // Lo prendiamo dai constants caricati sopra (SN_MSG popolato da messages.js).
  // `context` è opzionale: lo usa la voce "Aiuto" del menu tasto destro su una
  // tab per dire all'agente da dove è stato invocato (url + titolo della scheda).
  const t = globalThis.SN_MSG?.MSG?.SHORTCUT_TRIGGERED || 'shortcut_triggered';
  const deliver = () => {
    for (const fn of broadcastListeners) {
      try { fn({ type: t, command, context }, { id: 'filo-desktop' }, () => {}); } catch (_) {}
    }
  };
  // #405 — una scorciatoia indirizzata a un riquadro (Alt+E su testo
  // selezionato dentro un video incorporato) può arrivare prima che il
  // riquadro abbia montato Filo: montalo e consegna appena è pronto.
  if (IS_SUBFRAME && !contentScriptsStarted) {
    ensureContentScripts();
    waitForContentScripts(deliver);
    return;
  }
  deliver();
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
  'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css',
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
  // `PAGE_ONLY` marca i moduli che descrivono o modificano la SCHEDA nel suo
  // insieme (banner del sito pericoloso, proposta geografica, banner cookie,
  // colore della tab): dentro un riquadro incorporato parlerebbero del
  // rettangolo sbagliato — un avviso "sito pericoloso" disegnato dentro un
  // video, il colore della scheda preso da una pubblicità — quindi lì non si
  // caricano affatto (#405).
  const PAGE_ONLY = !IS_SUBFRAME;
  try { require(path.join(SHARED_DIR, 'constants.js')); } catch (e) { console.error('[Filo CS] constants', e); }
  // Per primo fra i moduli che toccano il DOM: chi disegna un pezzo di UI di
  // Filo dentro la pagina lo marca alla nascita, e chi cammina sulla pagina
  // (traduzione, sentinella del testo nuovo) lo riconosce da quel marchio.
  try { require(path.join(SHARED_DIR, 'filoUi.js')); } catch (e) { console.error('[Filo CS] filoUi', e); }
  try { require(path.join(SHARED_DIR, 'i18n.js')); } catch (e) { console.error('[Filo CS] i18n', e); }
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo CS] messages', e); }
  try { require(path.join(SHARED_DIR, 'tasti.js')); } catch (e) { console.error('[Filo CS] tasti', e); } // nomi delle scorciatoie per il sistema di chi legge: PRIMA di menu/actions/content
  try { require(path.join(SHARED_DIR, 'campoTesto.js')); } catch (e) { console.error('[Filo CS] campoTesto', e); } // "si sta scrivendo qui?": PRIMA di content.js, che ci decide Ctrl+Z
  try { require(path.join(SHARED_DIR, 'urlNav.js')); } catch (e) { console.error('[Filo CS] urlNav', e); } // #437 — "è davvero un indirizzo?" per Copia URL/Condividi
  try { require(path.join(SHARED_DIR, 'filoMarkdown.js')); } catch (e) { console.error('[Filo CS] filoMarkdown', e); }
  try { require(path.join(SHARED_DIR, 'themeTokens.js')); } catch (e) { console.error('[Filo CS] themeTokens', e); }
  try { require(path.join(SHARED_DIR, 'confirmUi.js')); } catch (e) { console.error('[Filo CS] confirmUi', e); }
  try { require(path.join(SHARED_DIR, 'chatErrors.js')); } catch (e) { console.error('[Filo CS] chatErrors', e); } // #360 — errori tecnici → frasi per l'utente
  try { require(path.join(SHARED_DIR, 'icons.js')); } catch (e) { console.error('[Filo CS] icons', e); }
  try { require(path.join(SHARED_DIR, 'qr.js')); } catch (e) { console.error('[Filo CS] qr', e); }
  try { require(path.join(SHARED_DIR, 'overlayPlacement.js')); } catch (e) { console.error('[Filo CS] overlayPlacement', e); } // #500 — geometria di menu e riquadro risposta: PRIMA di popup.js e menu.js
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo CS] extractContext', e); }
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo CS] popup', e); }
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo CS] menu', e); }
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo CS] highlight', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo CS] sidebar', e); }
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo CS] spellcheck', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'safebrowse.js')); } catch (e) { console.error('[Filo CS] safebrowse', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'geoProposal.js')); } catch (e) { console.error('[Filo CS] geoProposal', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookies.js')); } catch (e) { console.error('[Filo CS] cookies', e); }
  try { require(path.join(SHARED_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback shared', e); }
  try { require(path.join(SHARED_DIR, 'feedbackClientIdHash.js')); } catch (e) { console.error('[Filo CS] feedbackClientIdHash', e); } // S1.F2.2
  try { require(path.join(SHARED_DIR, 'feedbackAttachTypes.js')); } catch (e) { console.error('[Filo CS] feedbackAttachTypes', e); }
  try { require(path.join(CONTENT_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback content', e); }
  try { require(path.join(CONTENT_DIR, 'redteamAttack.js')); } catch (e) { console.error('[Filo CS] redteamAttack content', e); }
  try { require(path.join(SHARED_DIR, 'tabColor.js')); } catch (e) { console.error('[Filo CS] tabColor', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'pageColor.js')); } catch (e) { console.error('[Filo CS] pageColor', e); }
  try { require(path.join(CONTENT_DIR, 'translatePage.js')); } catch (e) { console.error('[Filo CS] translatePage', e); }
  try { require(path.join(SHARED_DIR, 'ttsChunk.js')); } catch (e) { console.error('[Filo CS] ttsChunk', e); }
  try { require(path.join(SHARED_DIR, 'modelCaps.js')); } catch (e) { console.error('[Filo CS] modelCaps', e); }
  try { require(path.join(SHARED_DIR, 'ttsVoices.js')); } catch (e) { console.error('[Filo CS] ttsVoices', e); }
  try { require(path.join(SHARED_DIR, 'dictationSegmenter.js')); } catch (e) { console.error('[Filo CS] dictationSegmenter', e); }
  try { require(path.join(CONTENT_DIR, 'tts.js')); } catch (e) { console.error('[Filo CS] tts', e); }
  try { require(path.join(CONTENT_DIR, 'editBox.js')); } catch (e) { console.error('[Filo CS] editBox', e); }
  try { require(path.join(CONTENT_DIR, 'actions.js')); } catch (e) { console.error('[Filo CS] actions', e); }
  try { require(path.join(CONTENT_DIR, 'menuIcons.js')); } catch (e) { console.error('[Filo CS] menuIcons', e); }
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
      'SN_FEEDBACK', 'SN_COOKIES_CS'].filter((k) => typeof globalThis[k] !== 'undefined');
    document.documentElement.dataset.filoModules = loaded.join(',');
    document.documentElement.dataset.filoReady = '1';
  } catch (_) {}
}

// #405 — montaggio dei content script in un riquadro incorporato: una volta
// sola, alla prima interazione dell'utente con quel riquadro.
let contentScriptsStarted = false;
function ensureContentScripts() {
  if (contentScriptsStarted) return;
  contentScriptsStarted = true;
  try { start(); } catch (e) { console.error('[Filo CS] avvio nel riquadro', e); }
}

// Chiama `fn` quando i content script del riquadro hanno finito di installare i
// propri listener (content.js marca `filoContentReady` a fine init).
function waitForContentScripts(fn) {
  const deadline = Date.now() + 3000;
  const tick = () => {
    let ready = false;
    try { ready = document.documentElement.dataset.filoContentReady === '1'; } catch (_) {}
    if (ready || Date.now() > deadline) { try { fn(); } catch (_) {} return; }
    setTimeout(tick, 16);
  };
  tick();
}

if (!IS_SUBFRAME) {
  contentScriptsStarted = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
} else {
  // Un clic, un tasto premuto o il fuoco su un campo dentro il riquadro dicono
  // "sto usando questa cosa": da lì in poi il riquadro deve rispondere come il
  // resto della pagina. Il tasto destro ha il suo cammino (il bridge qui sopra),
  // che monta e rigioca il clic.
  for (const ev of ['pointerdown', 'keydown', 'focusin']) {
    try {
      window.addEventListener(ev, ensureContentScripts, { capture: true, passive: true, once: true });
    } catch (_) {}
  }
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
