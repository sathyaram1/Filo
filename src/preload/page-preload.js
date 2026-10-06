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

// ─── #405 — riquadri incorporati (iframe) ───────────────────────────────────
//
// Da quando la scheda usa nodeIntegrationInSubFrames, questo preload gira in
// OGNI frame: la pagina e ciascun riquadro incorporato (video, mappa, modulo,
// blocco commenti, post social). Prima girava solo nel frame principale, e
// dentro il riquadro Filo non esisteva: tasto destro morto, niente correttore,
// niente Spiegazione/Traduci, niente Incolla con la cronologia.
//
// Ma un riquadro NON è una pagina: caricare tutti i content script in ognuno
// significherebbe pagare decine di volte lo stesso prezzo su una pagina piena
// di pubblicità e widget, per frame che l'utente non tocca mai. Quindi:
//   - nel frame principale tutto resta com'era (caricamento al DOMContentLoaded);
//   - in un riquadro non si carica NIENTE finché l'utente non lo tocca davvero
//     (tasto destro, clic, tasto premuto, o una scorciatoia di Filo diretta a
//     quel frame). Alla prima interazione il riquadro monta l'intero Filo.
// Le funzioni di PAGINA (colore della scheda, segnali di attività, avviso del
// sito pericoloso, traduzione della pagina) restano appannaggio del frame
// principale: dentro un riquadro descriverebbero il rettangolo sbagliato.
// Il modulo cookie è l'eccezione (#754): vedi startCookiesInFrame più sotto.
const IS_SUBFRAME = (() => {
  try { return window.top !== window.self; } catch (_) { return true; }
})();

// ─── #145 — blocco autoplay sulle schede RIPRISTINATE al boot ───────────────
//
// Le schede riaperte all'avvio di Filo nascono con il flag
// '--filo-suppress-autoplay' (passato via additionalArguments dal main): i loro
// media non devono partire da soli (i video YouTube ripartivano tutti insieme).
// Installiamo SUBITO — prima ancora del caricamento della pagina — un listener
// 'play' in fase di cattura che rimette in pausa qualunque media tenti di
// autopartire. Si disattiva alla PRIMA interazione dell'utente con la scheda:
// da lì in poi i media partono normalmente (è l'utente a comandarli). Il
// listener vive nel mondo isolato del preload ma ascolta il DOM condiviso.
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
let contextMenuHandler = null;
try {
  globalThis.__snSetContextMenuHandler = (fn) => { contextMenuHandler = fn; };
  window.addEventListener('contextmenu', (e) => {
    // Solo il tasto destro dell'utente: uno fabbricato dallo script del sito aprirebbe il menu, e con lui
    // Incolla e la cronologia degli appunti, senza che l'utente l'abbia chiesto (#589.8).
    if (!e.isTrusted) return;
    // Il sito non deve vedere il clic che apre il menu di Filo, nemmeno dal suo ascolto in cattura su window: se lo annulla,
    // il main non sa che l'utente ha aperto il menu e Incolla resta senza cronologia (#589.4). Chromium lo emette lo stesso.
    if (typeof contextMenuHandler === 'function') {
      contextMenuHandler(e);
      if (!e.shiftKey) { try { e.stopImmediatePropagation(); } catch (_) {} }
      return;
    }
    // #405 — primo tasto destro dentro un riquadro: i content script non sono
    // ancora montati (li montiamo solo all'uso). Montali ORA e rigioca questo
    // stesso clic appena l'handler è pronto, così il primo tentativo apre il
    // menu invece di andare perso — l'utente non deve cliccare due volte.
    if (!IS_SUBFRAME) return;
    // Shift resta la via di fuga anche qui: con Shift premuto non tocchiamo
    // l'evento e lasciamo che il riquadro faccia quello che farebbe da solo.
    if (e.shiftKey) return;
    try { e.stopImmediatePropagation(); } catch (_) {}
    replayContextMenu(e);
    ensureContentScripts();
  }, { capture: true });
} catch (_) { /* il bridge non deve MAI impedire il caricamento della pagina */ }

// Copia inerte del clic destro da rigiocare quando l'handler vero è pronto.
// Il vero evento, una volta consegnato, perde composedPath() (torna vuoto):
// fotografiamo SUBITO l'elemento reale — quello sotto shadow DOM compreso — e
// i dati che l'handler legge, così il menu si apre sull'elemento giusto.
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

// Modalità zoom con la rotella attivata dal click centrale (sostituisce
// l'autoscroll nativo). Sulle pagine web abilitiamo anche lo zoom con Ctrl/Cmd
// (pinch del trackpad, Ctrl+rotella, Ctrl +/-/0). Vedi wheel-zoom.js.
// Solo nel frame principale: lo zoom e il suo badge valgono per la scheda
// intera, e un badge dentro un riquadro sarebbe un secondo indicatore che
// contraddice il primo.
if (!IS_SUBFRAME) {
  try { require('./wheel-zoom.js')(webFrame, { pageZoom: true, ipcRenderer }); } catch (e) { console.error('[Filo CS] wheel-zoom', e); }
}

// ─── Protezione anti-fingerprinting ────────────────────────────────────────
//
// Inietta nel MAIN WORLD (prima degli script di pagina) gli override di
// canvas/WebGL/audio che aggiungono rumore deterministico per-sito ai segnali
// ad alta entropia. Il seed arriva SINCRONO dal main (HMAC col master secret),
// così il secret non tocca mai il mondo non fidato della pagina. Solo http(s);
// se la protezione è spenta (livello 0) non iniettiamo nulla.
// Solo nel frame principale: la protezione si applica alla pagina che l'utente
// ha aperto. Estenderla a ogni riquadro incorporato cambierebbe i segnali di
// widget di terze parti (mappe, player) che oggi non tocchiamo — è una scelta
// a sé, non un effetto collaterale del tasto destro nei riquadri (#405).
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

// #576 — i riquadri della pubblicità che il blocco di rete lascia vuoti o che il sito serve da sé: regole in preload/nascondi-pubblicita.js.
// Ciò che il blocco ferma si chiude in ogni frame, riquadri compresi: lì può stare l'annuncio.
try {
  const nascondi = require('./nascondi-pubblicita.js');
  nascondi.chiudiBloccati({ ipcRenderer, webFrame });
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  if (!IS_SUBFRAME && /^https?:/i.test(loc)) nascondi({ ipcRenderer, webFrame, href: loc });
} catch (e) { /* come sopra: mai bloccare il caricamento */ }

// Il sito è entrato o uscito dall'elenco coi banner dei cookie: la sua risposta va via prima che i suoi script
// la leggano (regola e chiavi le decide il main, tabs/tabCookies.js). Solo nel frame principale.
if (!IS_SUBFRAME) try {
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  if (/^https?:/i.test(loc)) {
    const w = ipcRenderer.sendSync('filo:cookie-wipe', loc);
    if (w && typeof w.pattern === 'string') {
      const re = new RegExp(w.pattern, 'i');
      const extra = new Set(Array.isArray(w.keys) ? w.keys : []);
      for (const st of [window.localStorage, window.sessionStorage]) {
        try { for (const k of Object.keys(st)) if (re.test(k) || extra.has(k)) st.removeItem(k); } catch (_) {}
      }
    }
  }
} catch (e) { /* come sopra: mai bloccare il caricamento */ }

// Le notifiche si leggono «da chiedere» finché l'utente non ha deciso (#591): regole in preload/stato-permessi.js.
if (!IS_SUBFRAME) try {
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  // Anche un documento blob è la pagina del sito che l'ha creato (#591, giro 20).
  if (/^(https?|blob):/i.test(loc)) {
    const { buildStatoPermessiSource } = require('./stato-permessi.js');
    // Senza gesto: con `true` la pagina riceverebbe un clic mai fatto.
    webFrame.executeJavaScript(buildStatoPermessiSource(ipcRenderer.sendSync('filo:permessi-stato', loc)), false).catch(() => {});
  }
} catch (e) { /* come sopra: mai bloccare il caricamento */ }

// ─── chrome.* shim per i content script ────────────────────────────────────
//
// Gira nel preload context (mondo isolato), invisibile alla pagina. I content
// script importati sotto useranno questo chrome via globalThis.

let streamCounter = 0;

const filoMessage = (msg) => ipcRenderer.invoke('filo:message', msg);

// ─── #664 — il collegamento d'invito cliccato dentro Filo ──────────────────
// `filo://invito/<codice>` non è una pagina: da fuori lo consegna il sistema e
// Filo riscatta. Dentro Filo lo stesso clic deve fare lo stesso, ma solo un
// clic VERO: una pagina che lo spinge da sé non riscatta niente (il main la
// ferma). Il tipo è letterale: qui SN_MSG non c'è ancora.
try {
  const INVITO = /^filo:\/*invito(?:[/?#]|$)/i;
  const suInvito = (e) => {
    if (!e.isTrusted || (e.type === 'click' ? e.button !== 0 : e.button !== 1)) return;
    const a = (e.composedPath ? e.composedPath() : []).find((n) => n && typeof n.href === 'string' && /^(A|AREA)$/.test(n.tagName));
    if (!a || !INVITO.test(a.href)) return;
    e.preventDefault();
    filoMessage({ type: 'wallet_invite_open', link: a.href }).catch(() => {});
  };
  window.addEventListener('click', suInvito, true);
  window.addEventListener('auxclick', suInvito, true);
} catch (_) { /* mai bloccare il caricamento della pagina */ }

const broadcastListeners = new Set();
// #407 — messaggi che devono SVEGLIARE un riquadro incorporato. Dentro un
// riquadro i content script si montano solo quando l'utente lo tocca; ma
// «Traduci la pagina» arriva dalla pagina che lo ospita, non da un clic lì
// dentro, e un riquadro addormentato lascerebbe il suo testo in lingua
// originale sotto un avviso che dichiara finito. La costante di SN_MSG qui non
// c'è ancora (i moduli condivisi si caricano dopo): il valore letterale è
// l'unico modo, ed è lo stesso trucco della consegna delle scorciatoie.
const WAKE_BROADCASTS = new Set(['frame_translate']);

// #503 — il giudizio di chi ospita il riquadro, arrivato per lettera dalla finestra madre (translatePage.js lo
// scrive con la stessa chiave). Un riquadro che lei non vede non si sveglia, non risponde al conto e non si paga.
const VERDETTO_ATTESA_MS = 1500;
const verdettiRiquadro = new Map();
const inAttesaDiVerdetto = new Set();
function riquadriFigli() {
  try { return Array.from(document.querySelectorAll('iframe, frame')); } catch (_) { return []; }
}
if (IS_SUBFRAME) try {
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || typeof d !== 'object' || d.filoFrameVerdict !== 1 || e.source !== window.parent) return;
    const runId = typeof d.runId === 'string' ? d.runId.slice(0, 64) : '';
    if (!runId) return;
    const visto = d.visible === true;
    verdettiRiquadro.delete(runId);
    verdettiRiquadro.set(runId, visto);
    if (verdettiRiquadro.size > 20) verdettiRiquadro.delete(verdettiRiquadro.keys().next().value);
    // Nascosto io, nascosti quelli dentro di me: nessuno qui dentro può farsi vedere.
    if (!visto) {
      for (const f of riquadriFigli()) {
        try { f.contentWindow.postMessage({ filoFrameVerdict: 1, runId, visible: false }, '*'); } catch (_) {}
      }
    }
    for (const fn of inAttesaDiVerdetto) fn();
  });
} catch (_) { /* mai bloccare il caricamento della pagina */ }

// Senza un giudizio entro l'attesa (chi ospita non ha Filo dentro) vale quello di prima: si traduce.
function conVerdetto(runId, fn) {
  if (verdettiRiquadro.has(runId)) { fn(verdettiRiquadro.get(runId)); return; }
  let fatto = false;
  const chiudi = (visto) => {
    if (fatto) return;
    fatto = true;
    inAttesaDiVerdetto.delete(guarda);
    clearTimeout(timer);
    fn(visto);
  };
  const guarda = () => { if (verdettiRiquadro.has(runId)) chiudi(verdettiRiquadro.get(runId)); };
  const timer = setTimeout(() => chiudi(true), VERDETTO_ATTESA_MS);
  inAttesaDiVerdetto.add(guarda);
}

ipcRenderer.on('filo:broadcast', (_event, msg) => {
  if (IS_SUBFRAME && msg && msg.type === 'frame_translate' && msg.mode !== 'restore') {
    conVerdetto(String(msg.runId || ''), (visto) => { if (visto) consegnaBroadcast(msg); });
    return;
  }
  consegnaBroadcast(msg);
});

function consegnaBroadcast(msg) {
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
// Le scorciatoie Alt+E (Spiegazione) e Alt+T (Traduci) lavorano sul testo
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
// La scorciatoia (shortcuts.js) fa un webContents.send('shortcut:triggered'); il content
// script registra un listener via chrome.runtime.onMessage su MSG.SHORTCUT_TRIGGERED.
// Adattatore: ascolto shortcut:triggered e ribroadcast come filo:broadcast.
// `context` è opzionale: lo usa la voce "Aiuto" del menu tasto destro su una
// tab per dire all'agente da dove è stato invocato (url + titolo della scheda).
const consegnaScorciatoia = require('./scorciatoia.js');
ipcRenderer.on('shortcut:triggered', (_event, payload = {}) => {
  const deliver = () => consegnaScorciatoia(broadcastListeners, payload, filoMessage);
  // #405 — una scorciatoia indirizzata a un riquadro (Alt+E su testo
  // selezionato dentro un video incorporato) può arrivare prima che il
  // riquadro abbia montato Filo: montalo e consegna appena è pronto.
  if (IS_SUBFRAME && !contentScriptsStarted) {
    ensureContentScripts();
    waitForContentScripts(deliver);
    return;
  }
  // Premuta a pagina ancora in caricamento, aspetta che Filo ci sia invece di perdersi.
  if (!contenutiPronti()) { waitForContentScripts(deliver); return; }
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
  'theme.css', 'menu.css', 'popup.css', 'sidebar.css', 'voce.css',
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

// Stesso elenco di loadContentScripts() in internal-preload.js: le differenze
// ammesse stanno in tests/unit/contentScriptPreload.test.mjs.
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
  try { require(path.join(SHARED_DIR, 'contenutoEsterno.js')); } catch (e) { console.error('[Filo CS] contenutoEsterno', e); } // #593 — imbusta il contenuto esterno: PRIMA di sidebar.js e spellcheck.js
  // Per primo fra i moduli che toccano il DOM: chi disegna un pezzo di UI di
  // Filo dentro la pagina lo marca alla nascita, e chi cammina sulla pagina
  // (traduzione, sentinella del testo nuovo) lo riconosce da quel marchio.
  try { require(path.join(SHARED_DIR, 'filoUi.js')); } catch (e) { console.error('[Filo CS] filoUi', e); }
  try { require(path.join(SHARED_DIR, 'i18n.js')); } catch (e) { console.error('[Filo CS] i18n', e); }
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo CS] messages', e); }
  try { require(path.join(SHARED_DIR, 'tasti.js')); } catch (e) { console.error('[Filo CS] tasti', e); } // nomi delle scorciatoie per il sistema di chi legge: PRIMA di menu/actions/content
  try { require(path.join(SHARED_DIR, 'disposizioneIcone.js')); } catch (e) { console.error('[Filo CS] disposizioneIcone', e); } // dove sta ogni icona globale: PRIMA di menuIcons
  try { require(path.join(SHARED_DIR, 'campoTesto.js')); } catch (e) { console.error('[Filo CS] campoTesto', e); } // "si sta scrivendo qui?": PRIMA di content.js, che ci decide Ctrl+Z
  try { require(path.join(SHARED_DIR, 'urlNav.js')); } catch (e) { console.error('[Filo CS] urlNav', e); } // #437 — "è davvero un indirizzo?" per Copia URL/Condividi
  try { require(path.join(SHARED_DIR, 'wallet.js')); } catch (e) { console.error('[Filo CS] wallet', e); } // #664 — «è un link d'invito?» per il tasto destro
  try { require(path.join(SHARED_DIR, 'filoMarkdown.js')); } catch (e) { console.error('[Filo CS] filoMarkdown', e); }
  try { require(path.join(SHARED_DIR, 'linkSospetto.js')); } catch (e) { console.error('[Filo CS] linkSospetto', e); } // #725 — link sospetti: euristica e frasi, PRIMA di actions.js
  try { require(path.join(SHARED_DIR, 'themeTokens.js')); } catch (e) { console.error('[Filo CS] themeTokens', e); }
  try { require(path.join(SHARED_DIR, 'confirmUi.js')); } catch (e) { console.error('[Filo CS] confirmUi', e); }
  try { require(path.join(SHARED_DIR, 'chatErrors.js')); } catch (e) { console.error('[Filo CS] chatErrors', e); } // #360 — errori tecnici → frasi per l'utente
  try { require(path.join(SHARED_DIR, 'icons.js')); } catch (e) { console.error('[Filo CS] icons', e); }
  try { require(path.join(SHARED_DIR, 'qr.js')); } catch (e) { console.error('[Filo CS] qr', e); }
  try { require(path.join(SHARED_DIR, 'calcMarkers.js')); } catch (e) { console.error('[Filo CS] calcMarkers', e); } // #724 — calcolatrice e marker [[calc:]]: PRIMA di popup.js
  try { require(path.join(SHARED_DIR, 'overlayPlacement.js')); } catch (e) { console.error('[Filo CS] overlayPlacement', e); } // #500 — geometria di menu e riquadro risposta: PRIMA di popup.js e menu.js
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo CS] extractContext', e); }
  try { require(path.join(SHARED_DIR, 'avvisiTempo.js')); } catch (e) { console.error('[Filo CS] avvisiTempo', e); } // tempi della pila degli avvisi: PRIMA di popup.js
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo CS] popup', e); }
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo CS] menu', e); }
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo CS] highlight', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo CS] sidebar', e); }
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo CS] spellcheck', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'safebrowse.js')); } catch (e) { console.error('[Filo CS] safebrowse', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'geoProposal.js')); } catch (e) { console.error('[Filo CS] geoProposal', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookieRules.js')); } catch (e) { console.error('[Filo CS] cookieRules', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookieBanners.js')); } catch (e) { console.error('[Filo CS] cookieBanners', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookies.js')); } catch (e) { console.error('[Filo CS] cookies', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'riquadroRotto.js')); } catch (e) { console.error('[Filo CS] riquadroRotto', e); } // #760 — la proposta sopra il riquadro
  try { require(path.join(CONTENT_DIR, 'adSkip.js')); } catch (e) { console.error('[Filo CS] adSkip', e); } // #737 — nei riquadri è già partito da solo
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
  try { require(path.join(SHARED_DIR, 'ascolto.js')); } catch (e) { console.error('[Filo CS] ascolto', e); } // microfono e trascrizione: Detta e le chat
  try { require(path.join(SHARED_DIR, 'voceChat.js')); } catch (e) { console.error('[Filo CS] voceChat', e); } // tasto microfono delle chat, a cui «Detta» passa la mano
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

// #754 — molti banner dei cookie vivono in un riquadro (Sourcepoint, TrustArc, varianti di Didomi e
// Quantcast): lì il modulo cookie parte da solo, senza il resto di Filo, e solo sulle pagine web.
// #737 — così il «Salta» delle pubblicità: il lettore incorporato e quello di Google IMA stanno in un riquadro.
function startCookiesInFrame() {
  let href = '';
  try { href = window.location.href || ''; } catch (_) {}
  if (!/^https?:/i.test(href)) return;
  const go = () => {
    try { require(path.join(CONTENT_DIR, 'cookieRules.js')); } catch (e) { console.error('[Filo CS] cookieRules (riquadro)', e); }
    try { require(path.join(CONTENT_DIR, 'cookies.js')); } catch (e) { console.error('[Filo CS] cookies (riquadro)', e); }
    try { require(path.join(CONTENT_DIR, 'riquadroRotto.js')); } catch (e) { console.error('[Filo CS] riquadroRotto (riquadro)', e); } // #760
    try { require(path.join(CONTENT_DIR, 'adSkip.js')); } catch (e) { console.error('[Filo CS] adSkip (riquadro)', e); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
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
// Su una pagina dove Filo è spento (sito escluso, pagina di sistema) content.js
// non mette ascoltatori: lo dichiara, e chi aspetta non resta appeso tre secondi.
function contenutiPronti() {
  try { if (document.documentElement.dataset.filoContentReady === '1') return true; } catch (_) {}
  return globalThis.__snFiloSpento === true;
}

function waitForContentScripts(fn) {
  const deadline = Date.now() + 3000;
  const tick = () => {
    if (contenutiPronti() || Date.now() > deadline) { try { fn(); } catch (_) {} return; }
    setTimeout(tick, 16);
  };
  tick();
}

// Il modulo di pagamento o di accesso di un altro sito, in un riquadro, rende delicata la pagina che lo contiene (#1004):
// il content script della pagina non lo vede. Si guarda a pagina caricata e quando si entra in un campo, e si dice una volta.
function vediCampiDelicati() {
  let detto = false;
  const guarda = () => {
    if (detto) return;
    let h = null;
    try { h = require(path.join(CONTENT_DIR, 'safebrowseHints.js')).pageHints(document); } catch (_) { return; }
    if (!h || !(h.shownPassword || h.shownPayment)) return;
    detto = true;
    filoMessage({ type: 'campi_delicati', hasPassword: !!h.shownPassword, hasPayment: !!h.shownPayment }).catch(() => {});
  };
  try {
    window.addEventListener('load', guarda, { once: true });
    window.addEventListener('focusin', (e) => { if (e.target && e.target.tagName === 'INPUT') guarda(); }, { capture: true, passive: true });
  } catch (_) {}
}

// L'avviso del sito pericoloso non aspetta la pagina costruita: un modulo password già a schermo sopra uno script che
// non arriva mai resterebbe scrivibile senza avviso (#813.1). loadScripts() ritrova questi moduli già caricati.
function startSafebrowse() {
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo CS] messages', e); }
  try { require(path.join(CONTENT_DIR, 'safebrowse.js')); } catch (e) { console.error('[Filo CS] safebrowse', e); }
}

if (!IS_SUBFRAME) {
  contentScriptsStarted = true;
  startSafebrowse();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
} else {
  startCookiesInFrame();
  vediCampiDelicati();
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

