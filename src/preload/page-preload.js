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

const { ipcRenderer, webFrame } = require('electron');
const path = require('node:path');

// ─── #145 — blocco autoplay sulle schede RIPRISTINATE al boot ───────────────
//
// Le schede riaperte all'avvio di Filo nascono con il flag
// '--filo-suppress-autoplay' (passato via additionalArguments dal main): i loro
// media non devono partire da soli né emettere audio (i video YouTube
// ripartivano tutti insieme, e un primo fix lasciava un breve "blip" audio
// prima di fermare il media — feedback #145 riaperto).
//
// #145.2 — irrobustito su tre fronti:
//   1) blip audio: oltre a pause() su 'play', ascoltiamo ANCHE 'playing' (il
//      media può emettere già un frame audio fra 'play' e 'playing') e
//      mutiamo il media finché la suppressione è attiva, ripristinando il
//      muted originale al release. Così anche il frammento che il motore
//      audio ha già in coda non si sente.
//   2) reset posizione: NON tocchiamo currentTime qui — lo fa tabs.js via
//      did-finish-load, restoreMediaTime. Questo listener si occupa solo di
//      "non deve suonare/non deve partire", non della posizione.
//   3) release "ovunque" → release "solo sul media": prima qualunque
//      pointerdown/keydown/click sulla FINESTRA disattivava la suppressione,
//      quindi bastava scrollare o cliccare altrove per far ripartire il video
//      (feedback: "la pausa deve riattivarsi solo se clicco per levarlo dalla
//      pausa"). Ora il release scatta SOLO se l'interazione ha come target (o
//      antenato) un <video>/<audio>, o se è uno spazio/K mentre la pagina ha
//      focus su un elemento media (controlli nativi/YouTube spesso spostano
//      il focus sul player). Click/scroll sul resto della pagina non rilascia.
//
// Installiamo SUBITO — prima ancora del caricamento della pagina — i listener
// in fase di cattura. Il listener vive nel mondo isolato del preload ma
// ascolta il DOM condiviso.
if (process.argv.includes('--filo-suppress-autoplay')) {
  try {
    let active = true;
    const mutedByUs = new WeakSet(); // media che abbiamo mutato noi (per non sovrascrivere un muted scelto dalla pagina)
    const suppress = (m) => {
      if (!m || typeof m.pause !== 'function') return;
      try {
        if (!m.muted) { m.muted = true; mutedByUs.add(m); }
        m.pause();
      } catch (_) {}
    };
    const onPlayLike = (e) => {
      if (!active) return;
      suppress(e.target);
    };
    document.addEventListener('play', onPlayLike, true);
    document.addEventListener('playing', onPlayLike, true);

    const isMediaTarget = (node) => {
      let n = node;
      let hops = 0;
      while (n && hops < 6) {
        const tag = n.tagName;
        if (tag === 'VIDEO' || tag === 'AUDIO') return true;
        n = n.parentNode || (n.getRootNode && n.getRootNode().host) || null;
        hops += 1;
      }
      return false;
    };
    const isMediaFocused = () => {
      const a = document.activeElement;
      return !!a && (a.tagName === 'VIDEO' || a.tagName === 'AUDIO');
    };

    const release = () => {
      if (!active) return;
      active = false;
      document.removeEventListener('play', onPlayLike, true);
      document.removeEventListener('playing', onPlayLike, true);
      // Ripristina il muted SOLO sui media che abbiamo mutato noi.
      try {
        for (const m of document.querySelectorAll('video, audio')) {
          if (mutedByUs.has(m)) { try { m.muted = false; } catch (_) {} }
        }
      } catch (_) {}
      for (const ev of ['pointerdown', 'keydown', 'click', 'touchstart']) {
        window.removeEventListener(ev, onMediaInteract, true);
      }
    };

    function onMediaInteract(e) {
      if (!active) return;
      const type = e.type;
      if (type === 'keydown') {
        // Spazio/K: scorciatoie play/pause universali, ma rilascia solo se
        // l'utente ha il focus sul media (altrimenti spaziare la pagina o
        // digitare altrove rilascerebbe comunque — non è interazione col media).
        const key = e.key;
        if ((key === ' ' || key === 'Spacebar' || key === 'k' || key === 'K') && isMediaFocused()) {
          release();
        }
        return;
      }
      // pointerdown/click/touchstart: rilascia solo se il target è/è dentro un media.
      if (isMediaTarget(e.target)) release();
    }
    for (const ev of ['pointerdown', 'keydown', 'click', 'touchstart']) {
      window.addEventListener(ev, onMediaInteract, true);
    }

    // Proattivo: se al momento dell'iniezione (document-start può comunque
    // correre dopo che la pagina ha già creato/avviato un <video> in casi rari,
    // es. media creati da script inline molto precoci) c'è già un media in
    // play, sopprimilo subito invece di aspettare l'evento.
    const sweepExisting = () => {
      if (!active) return;
      try { for (const m of document.querySelectorAll('video, audio')) { if (!m.paused) suppress(m); } } catch (_) {}
    };
    sweepExisting();
    document.addEventListener('DOMContentLoaded', sweepExisting, { once: true });
  } catch (_) { /* il blocco non deve MAI impedire il caricamento della pagina */ }
}

// ─── Bridge contextmenu installato a document_start ─────────────────────────
//
// Alcuni siti (YouTube, Reddit, …) registrano il PROPRIO listener `contextmenu`
// in fase di CATTURA su window al primo script di pagina e lo bloccano con
// stopImmediatePropagation() per mostrare il loro menu. Se il nostro content
// script si registrasse solo a DOMContentLoaded arriverebbe DOPO il loro
// listener window+capture: a parità di target/fase vince chi si registra prima,
// quindi il loro stopImmediatePropagation impediva al nostro handler di partire
// e il menu Filo non compariva (feedback alpha: «tasto destro non funziona su
// YouTube»). Il preload gira PRIMA di qualunque script di pagina: registrando
// qui — subito, a document_start — il listener window+capture, siamo sempre i
// primi a ricevere l'evento, su ogni sito. Il vero handler (in content.js, che
// ha bisogno di settings/spellcheck/Menu) si installa più tardi via
// __snSetContextMenuHandler; fino ad allora il bridge non fa nulla.
try {
  let contextMenuHandler = null;
  globalThis.__snSetContextMenuHandler = (fn) => { contextMenuHandler = fn; };
  window.addEventListener('contextmenu', (e) => {
    if (typeof contextMenuHandler === 'function') contextMenuHandler(e);
  }, { capture: true });
} catch (_) { /* il bridge non deve MAI impedire il caricamento della pagina */ }

// Modalità zoom con la rotella attivata dal click centrale (sostituisce
// l'autoscroll nativo). Vedi wheel-zoom.js.
try { require('./wheel-zoom.js')(webFrame); } catch (e) { console.error('[Filo CS] wheel-zoom', e); }

// ─── Protezione anti-fingerprinting ────────────────────────────────────────
//
// Inietta nel MAIN WORLD (prima degli script di pagina) gli override di
// canvas/WebGL/audio che aggiungono rumore deterministico per-sito ai segnali
// ad alta entropia. Il seed arriva SINCRONO dal main (HMAC col master secret),
// così il secret non tocca mai il mondo non fidato della pagina. Solo http(s);
// se la protezione è spenta (livello 0) non iniettiamo nulla.
try {
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  if (/^https?:/i.test(loc)) {
    const cfg = ipcRenderer.sendSync('filo:fp-config', loc) || { level: 0, seed: 0 };
    if (cfg && cfg.level > 0) {
      const { buildGuardSource } = require('./fingerprint-guard.js');
      webFrame.executeJavaScript(buildGuardSource(cfg.seed, cfg.level), true).catch(() => {});
    }
  }
} catch (e) { /* la protezione non deve MAI bloccare il caricamento della pagina */ }

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
ipcRenderer.on('shortcut:triggered', (_event, { command, context } = {}) => {
  // Il payload deve usare il type MSG.SHORTCUT_TRIGGERED del catalogo messaggi.
  // Lo prendiamo dai constants caricati sopra (SN_MSG popolato da messages.js).
  // `context` è opzionale: lo usa la voce "Aiuto" del menu tasto destro su una
  // tab per dire all'agente da dove è stato invocato (url + titolo della scheda).
  const t = globalThis.SN_MSG?.MSG?.SHORTCUT_TRIGGERED || 'shortcut_triggered';
  for (const fn of broadcastListeners) {
    try { fn({ type: t, command, context }, { id: 'filo-desktop' }, () => {}); } catch (_) {}
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
  try { require(path.join(SHARED_DIR, 'themeTokens.js')); } catch (e) { console.error('[Filo CS] themeTokens', e); }
  try { require(path.join(SHARED_DIR, 'icons.js')); } catch (e) { console.error('[Filo CS] icons', e); }
  try { require(path.join(SHARED_DIR, 'qr.js')); } catch (e) { console.error('[Filo CS] qr', e); }
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo CS] extractContext', e); }
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo CS] popup', e); }
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo CS] menu', e); }
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo CS] highlight', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo CS] sidebar', e); }
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo CS] spellcheck', e); }
  try { require(path.join(CONTENT_DIR, 'safebrowse.js')); } catch (e) { console.error('[Filo CS] safebrowse', e); }
  try { require(path.join(CONTENT_DIR, 'geoProposal.js')); } catch (e) { console.error('[Filo CS] geoProposal', e); }
  try { require(path.join(CONTENT_DIR, 'cookies.js')); } catch (e) { console.error('[Filo CS] cookies', e); }
  try { require(path.join(SHARED_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback shared', e); }
  try { require(path.join(CONTENT_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback content', e); }
  try { require(path.join(SHARED_DIR, 'tabColor.js')); } catch (e) { console.error('[Filo CS] tabColor', e); }
  try { require(path.join(CONTENT_DIR, 'pageColor.js')); } catch (e) { console.error('[Filo CS] pageColor', e); }
  try { require(path.join(CONTENT_DIR, 'translatePage.js')); } catch (e) { console.error('[Filo CS] translatePage', e); }
  try { require(path.join(SHARED_DIR, 'ttsChunk.js')); } catch (e) { console.error('[Filo CS] ttsChunk', e); }
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
