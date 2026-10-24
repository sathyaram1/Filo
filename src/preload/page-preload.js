// Preload per le pagine web caricate dentro i tab del browser.
//
// Equivalente al "content script" Manifest V3 dell'estensione:
//   - inietta i CSS condivisi (theme, menu, popup, sidebar, highlight,
//     spellcheck, feedback)
//   - espone chrome.* dentro il mondo isolato del preload (NON in main world:
//     la pagina è codice non fidato; i content script girano qui)
//   - carica i moduli SN_* (shared) e i content script via require(): gira in
//     sandbox, impacchettato con tutto ciò che richiede (src/main/preloadPacchetto.js)
//
// contextIsolation è TRUE per queste pagine, quindi globalThis qui è isolato
// dal main world della pagina. Le scritture su globalThis NON sono visibili
// alla pagina, ma il DOM (document, window) è condiviso. Esattamente come
// in Chrome con i content script.

const { ipcRenderer, webFrame } = require('electron');
const path = require('node:path');

// Prima di qualunque HTML scritto da Filo: la CSP della pagina non è la sua (#1122).
try { require('./mondo-esente.js')(webFrame); } catch (e) { console.error('[Filo CS] mondo esente', e); }

// Prima di ogni ascoltatore: una pagina che si riscrive non spegne Filo (#686.1).
let riscrittura = null;
try { riscrittura = require('./riscrittura.js')(); } catch (e) { console.error('[Filo CS] riscrittura', e); }

// Prima che nasca un riquadro: chi lo tocca mentre carica il suo indirizzo gli toglie il preload (#1560).
try {
  require(path.join(__dirname, '..', 'shared', 'riquadriInArrivo.js'));
  globalThis.SN_RIQUADRI_IN_ARRIVO.osserva(window);
} catch (e) { console.error('[Filo CS] riquadri in arrivo', e); }

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

// #145 — le schede riaperte all'avvio non fanno partire i media da sole, o ripartono tutte
// insieme: il listener si installa prima della pagina e cade alla prima interazione.
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

// Va registrato prima degli script di pagina: certi siti fermano il contextmenu in capture,
// e a parità di fase vince chi si è registrato prima.
let contextMenuHandler = null;
// I siti col menu proprio (#975): la sonda va nel mondo della pagina prima dei suoi script. content.js dice, coi siti
// scelti nelle impostazioni, se qui il tasto destro va prima alla pagina; Shift allora porta al menu di Filo.
let MenuDelSito = null;
try { MenuDelSito = require('./menu-del-sito.js').crea({ webFrame, riserva: (clic) => menuDiRiserva(clic) }); } catch (e) { console.error('[Filo CS] menu del sito', e); }
let menuDelSitoPrima = () => false;
try {
  globalThis.__snMenuDelSito = MenuDelSito;
  globalThis.__snSetMenuDelSitoPrima = (fn) => { if (typeof fn === 'function') menuDelSitoPrima = fn; };
} catch (_) {}
function sitoPrima() {
  try { return !!MenuDelSito && menuDelSitoPrima() === true; } catch (_) { return false; }
}
// Ogni tasto destro dell'utente apre un menu: quello di Filo o, se non parte (guasto, pagina ancora in caricamento,
// Filo spento sul sito, Shift), quello di riserva del main, salvo che la pagina mostri il suo (#1122).
// `clic` è l'ora del gesto: il main la usa per accoppiarlo al suo `context-menu`, non a quello di un clic prima.
function menuDiRiserva(clic, motivo = '') {
  try { ipcRenderer.send('filo:menu-di-riserva', { clic, motivo: String(motivo || '').slice(0, 2000) }); } catch (_) {}
}
function riservaSeLaPaginaTace(e, clic) {
  setTimeout(() => { if (!e.defaultPrevented) menuDiRiserva(clic); }, 0);
}
function apriMenuDiFilo(e, clic = Date.now(), opzioni = undefined) {
  let esito;
  try { esito = contextMenuHandler(e, opzioni); } catch (err) { esito = Promise.reject(err); }
  Promise.resolve(esito).catch((err) => {
    console.error('[Filo CS] menu del tasto destro', err);
    menuDiRiserva(clic, (err && err.stack) || err || 'errore');
  });
}
try {
  globalThis.__snSetContextMenuHandler = (fn) => { contextMenuHandler = fn; };
  window.addEventListener('contextmenu', (e) => {
    // Solo il tasto destro dell'utente: uno fabbricato dallo script del sito aprirebbe il menu, e con lui
    // Incolla e la cronologia degli appunti, senza che l'utente l'abbia chiesto (#589.8).
    if (!e.isTrusted) return;
    const clic = Date.now();
    // Filo spento sul sito (#843): il clic è della pagina, e se lei tace il menu di riserva offre di riaccenderlo.
    if (globalThis.__snFiloSpento === true) { riservaSeLaPaginaTace(e, clic); return; }
    const prima = typeof contextMenuHandler === 'function' && sitoPrima();
    // Shift lascia l'evento alla pagina: se non mostra un menu suo, compare quello del browser. Sui siti dove il tasto
    // destro apre il loro menu, Shift è la strada per quello di Filo.
    if (e.shiftKey && !prima) { riservaSeLaPaginaTace(e, clic); return; }
    if (prima && !e.shiftKey) {
      MenuDelSito.lasciaAllaPagina(e, (copia) => apriMenuDiFilo(copia, clic));
      return;
    }
    // Il sito non deve vedere il clic che apre il menu di Filo, nemmeno dal suo ascolto in cattura su window: se lo annulla,
    // il main non sa che l'utente ha aperto il menu e Incolla resta senza cronologia (#589.4). Chromium lo emette lo stesso.
    if (typeof contextMenuHandler === 'function') {
      apriMenuDiFilo(e, clic, prima ? { conMaiusc: true } : undefined);
      try { e.stopImmediatePropagation(); } catch (_) {}
      return;
    }
    if (!IS_SUBFRAME) { riservaSeLaPaginaTace(e, clic); return; }
    // #405 — primo tasto destro dentro un riquadro: i content script non sono
    // ancora montati (li montiamo solo all'uso). Montali ORA e rigioca questo
    // stesso clic appena l'handler è pronto, così il primo tentativo apre il
    // menu invece di andare perso — l'utente non deve cliccare due volte.
    try { e.stopImmediatePropagation(); } catch (_) {}
    replayContextMenu(e, clic);
    ensureContentScripts();
  }, { capture: true });
} catch (_) { /* il bridge non deve MAI impedire il caricamento della pagina */ }

// Un tasto scritto in un riquadro chiuso di Filo lo prende Filo prima di ogni script del sito, anche in cattura (#1071):
// per questo l'ascolto nasce qui, a document_start. Lo smista SN_FILO_UI.tastoNelRiquadro (src/shared/filoUi.js).
try {
  for (const tipo of ['keydown', 'keypress', 'keyup']) {
    const ascolto = (e) => {
      const UI = globalThis.SN_FILO_UI;
      // L'Esc va prima a ogni ascolto di Filo: un sito che lo ferma sulla finestra lasciava aperto il riquadro (#859).
      if (tipo === 'keydown' && e.key === 'Escape') { escPrimaAFilo(e, ascolto, UI); return; }
      if (UI && typeof UI.tastoNelRiquadro === 'function') UI.tastoNelRiquadro(e);
    };
    window.addEventListener(tipo, ascolto, { capture: true });
  }
} catch (_) { /* il bridge non deve MAI impedire il caricamento della pagina */ }

// Solo il tasto dell'utente, o quello che il main ci consegna sopra lo schermo pieno del sito: uno fabbricato dal sito
// fa il giro di sempre.
function escPrimaAFilo(e, ascolto, UI) {
  try {
    if (!riscrittura || typeof riscrittura.anticipa !== 'function') return;
    if (!e.isTrusted && !(UI && typeof UI.veroONostro === 'function' && UI.veroONostro(e))) return;
    if (riscrittura.anticipa(e, ascolto)) e.stopImmediatePropagation();
  } catch (_) {}
}

// Il clic destro si rigioca, in copia, quando l'handler vero è pronto.
function replayContextMenu(e, clic) {
  const copy = require('./menu-del-sito.js').copiaDelClic(e);
  const deadline = Date.now() + 3000;
  const tick = () => {
    if (globalThis.__snFiloSpento === true) { menuDiRiserva(clic); return; }
    if (typeof contextMenuHandler === 'function') { apriMenuDiFilo(copy, clic); return; }
    if (Date.now() > deadline) { menuDiRiserva(clic); return; }
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}

// Modalità zoom con la rotella (clic centrale) e zoom con Ctrl/Cmd: vedi
// wheel-zoom.js. Zoom e riquadro sono della scheda intera e stanno nel frame
// principale; un riquadro incorporato gli passa solo i gesti (#686.1).
if (!IS_SUBFRAME) {
  try { require('./wheel-zoom.js')(webFrame, { pageZoom: true, ipcRenderer }); } catch (e) { console.error('[Filo CS] wheel-zoom', e); }
} else {
  try { require('./wheel-zoom.js').riquadro(webFrame, { ipcRenderer }); } catch (e) { console.error('[Filo CS] wheel-zoom riquadro', e); }
}

// In ogni frame, riquadri compresi: il tasto arriva solo al frame che ha il fuoco.
try { require('./cmd-freccia.js')(window, ipcRenderer); } catch (e) { console.error('[Filo CS] cmd-freccia', e); }

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
      webFrame.executeJavaScript(buildGuardSource(cfg.seed, cfg.level), false).catch(() => {});
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
    // «Resta connesso»: la scheda è passata in un altro jar e la memoria della pagina la segue.
    for (const [chiave, st] of [['semina', 'localStorage'], ['seminaSessione', 'sessionStorage']]) {
      if (!w || !Array.isArray(w[chiave])) continue;
      for (const voce of w[chiave]) {
        try { if (Array.isArray(voce)) window[st].setItem(String(voce[0]), String(voce[1])); } catch (_) {}
      }
    }
    if (w && Array.isArray(w.seminaDb) && w.seminaDb.length) require('./semina-database.js').semina(window.indexedDB, w.seminaDb);
  }
} catch (e) { /* come sopra: mai bloccare il caricamento */ }

// Nel mondo della pagina, e nei riquadri vuoti che lei si crea (#1057, regole in preload/riquadri-vuoti.js): lo schermo
// alla maniera vecchia fa la domanda di sempre e poi riceve un no, senza far morire la scheda (#586, preload/
// schermo-vecchio.js; un avviso finto della pagina fa negare solo la sua prossima domanda), e nel frame principale i
// permessi mai decisi si leggono «da chiedere» (#591, preload/stato-permessi.js).
try {
  const loc = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  if (!/^(filo|devtools):/i.test(loc)) {
    const { buildSchermoVecchioCorpo, EVENTO_SCHERMO_VECCHIO } = require('./schermo-vecchio.js');
    const { buildRiquadriVuotiSource } = require('./riquadri-vuoti.js');
    const corpi = [buildSchermoVecchioCorpo()];
    const ascolti = [[EVENTO_SCHERMO_VECCHIO, () => { try { ipcRenderer.sendSync('filo:schermo-vecchio'); } catch (_) {} }]];
    // Anche un documento blob è la pagina del sito che l'ha creato (#591, giro 20).
    if (!IS_SUBFRAME && /^(https?|blob):/i.test(loc)) try {
      const { buildStatoPermessiCorpo, SCRITTURA, SCRITTURA_FINE, SCRITTURA_NIENTE, SI_DATO, PARTI_LETTE } = require('./stato-permessi.js');
      corpi.push(buildStatoPermessiCorpo(ipcRenderer.sendSync('filo:permessi-stato', loc)));
      // La pagina chiede di scrivere su un file che ha già; a risposta data rilegge il permesso da Chromium (#1069).
      ascolti.push([SCRITTURA, () => {
        ipcRenderer.invoke('filo:permessi-scrittura').catch(() => null)
          .then((r) => window.dispatchEvent(new Event(r === null ? SCRITTURA_NIENTE : SCRITTURA_FINE)));
      }]);
      for (const parte of new Set(Object.values(PARTI_LETTE))) {
        ascolti.push([SI_DATO + parte, (e) => { try { if (ipcRenderer.sendSync('filo:permessi-si', parte) === true) e.preventDefault(); } catch (_) {} }]);
      }
    } catch (_) {}
    // La riscrittura da capo (document.open) toglie gli ascolti della finestra: si rimettono.
    const ascolta = () => { for (const [tipo, f] of ascolti) window.addEventListener(tipo, f, true); };
    ascolta();
    new MutationObserver(ascolta).observe(document, { childList: true });
    // Senza gesto: con `true` la pagina riceverebbe un clic mai fatto.
    webFrame.executeJavaScript(buildRiquadriVuotiSource(corpi), false).catch(() => {});
  }
} catch (e) { /* come sopra: mai bloccare il caricamento */ }

// ─── chrome.* shim per i content script ────────────────────────────────────
//
// Gira nel preload context (mondo isolato), invisibile alla pagina. I content
// script importati sotto useranno questo chrome via globalThis.

let streamCounter = 0;

const filoMessage = (msg) => ipcRenderer.invoke('filo:message', msg);

// Le conferme di Filo su un sito le disegna il main sopra la scheda, fuori dal documento
// che il sito può ridisegnare (#592.6): SN_CONFIRM_UI manda qui la domanda. Ai tasti che
// l'utente batte sul popup mentre scriveva risponde il suo campo, in questo frame.
const tastiConferme = new Map();
let seqConferme = 0;
ipcRenderer.on('filo:conferma-tasto', (_event, d) => {
  const suTasto = d && tastiConferme.get(d.id);
  if (suTasto) suTasto(d.tasto);
});
globalThis.SN_CONFERMA_FUORI = (richiesta, suTasto, segnale) => {
  const id = ++seqConferme;
  tastiConferme.set(id, suTasto);
  const ritira = () => ipcRenderer.send('filo:conferma-ritira', { id });
  const ascolta = segnale && typeof segnale.addEventListener === 'function';
  if (ascolta) segnale.addEventListener('abort', ritira, { once: true });
  return ipcRenderer.invoke('filo:conferma', { ...richiesta, id }).finally(() => {
    tastiConferme.delete(id);
    if (ascolta) segnale.removeEventListener('abort', ritira);
  });
};
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
// #407 — messaggi che devono SVEGLIARE un riquadro: senza, resterebbe in lingua originale
// sotto un avviso che dice «fatto». Valore letterale: qui SN_MSG non è ancora caricato.
const WAKE_BROADCASTS = new Set(['frame_translate']);

// #503 — il giudizio di chi ospita il riquadro, arrivato per lettera dalla finestra madre (translatePage.js lo
// scrive con la stessa chiave). Un riquadro che lei non vede non si sveglia, non risponde al conto e non si paga.
const VERDETTO_ATTESA_MS = 1500;
const verdettiRiquadro = new Map();
const inAttesaDiVerdetto = new Set();
// Anche quelli dentro un riquadro riempito dalla pagina (about:, srcdoc): lì non c'è un Filo che passi parola.
function riquadriFigli() {
  const out = [];
  const docs = [document];
  while (docs.length && out.length < 500) {
    let lista = [];
    try { lista = Array.from(docs.pop().querySelectorAll('iframe, frame')); } catch (_) {}
    for (const f of lista) {
      out.push(f);
      const R = globalThis.SN_RIQUADRI_IN_ARRIVO;
      try {
        const w = R && R.finestra(f);
        const d = w && w.location.protocol === 'about:' ? R.documento(f) : null;
        if (d) docs.push(d);
      } catch (_) {}
    }
  }
  return out;
}
// Il giudizio arriva da chi ha un Filo e mi vede: la madre, o un antenato quando fra noi c'è solo un riquadro riempito
// dalla pagina, che un Filo non ce l'ha.
function daUnAntenato(src) {
  try {
    for (let w = window.parent, hops = 0; w && hops < 16; hops++) {
      if (src === w) return true;
      if (w === w.parent) break;
      w = w.parent;
    }
  } catch (_) {}
  return false;
}
if (IS_SUBFRAME) try {
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || typeof d !== 'object' || d.filoFrameVerdict !== 1 || !daUnAntenato(e.source)) return;
    const runId = typeof d.runId === 'string' ? d.runId.slice(0, 64) : '';
    if (!runId) return;
    const visto = d.visible === true;
    verdettiRiquadro.delete(runId);
    verdettiRiquadro.set(runId, visto);
    if (verdettiRiquadro.size > 20) verdettiRiquadro.delete(verdettiRiquadro.keys().next().value);
    // Nascosto io, nascosti quelli dentro di me: nessuno qui dentro può farsi vedere.
    if (!visto) {
      for (const f of riquadriFigli()) {
        try { globalThis.SN_RIQUADRI_IN_ARRIVO?.finestra(f)?.postMessage({ filoFrameVerdict: 1, runId, visible: false }, '*'); } catch (_) {}
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
  // Il ritorno all'originale non sveglia: un riquadro che dorme non ha tradotto.
  const wakes = WAKE_BROADCASTS.has(type) && msg.mode !== 'restore';
  if (IS_SUBFRAME && !contentScriptsStarted && wakes) {
    ensureContentScripts();
    waitForContentScripts(deliver);
    return;
  }
  deliver();
}

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
          // #273 — reset: provider caduto a metà, i delta accumulati si buttano.
          const offReset = () => onMessage && onMessage({ type: 'reset' });
          const offDone = (_e, data) => {
            cleanup();
            if (onMessage) onMessage({ type: 'done', ...data });
            if (onDisconnect) onDisconnect();
          };
          const offError = (_e, data) => {
            cleanup();
            // Tutto quello che il main ha detto sull'errore, non i due campi
            // che servivano ieri: chi mostra l'errore ne ha bisogno per
            // ricomporre la frase già scritta per l'utente (#663).
            if (onMessage) onMessage({ type: 'error', ...data });
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

// Prima degli script della pagina: un'immagine lasciata dove la pagina non la vuole va all'Aiuto (#1623). Il pannello
// vive nel frame principale: da un riquadro, che Filo forse non l'ha ancora montato, le immagini lette passano dal main.
try {
  const leggi = (f) => new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => ok('');
    r.readAsDataURL(f);
  });
  require('./rilascio-file.js')(window, IS_SUBFRAME ? {
    pronta: () => true,
    consegna: async (files) => {
      const voci = [];
      for (const f of files) {
        if (!/^image\//i.test(f.type || '')) { voci.push({ nome: f.name || '', altro: true }); continue; }
        const dataUrl = await leggi(f);
        if (dataUrl) voci.push({ nome: f.name || '', dataUrl });
      }
      if (voci.length) { try { ipcRenderer.send('filo:rilascio-riquadro', voci); } catch (_) {} }
    },
  } : {
    pronta: () => globalThis.SN_SIDEBAR?.accoglieRilascio?.() === true,
    consegna: (files) => globalThis.SN_SIDEBAR.allega(files),
    pannello: (t) => globalThis.SN_SIDEBAR?.contiene?.(t) === true,
  });
} catch (e) { console.error('[Filo CS] rilascio', e); }

// Il gesto che vale per finestre e schermo pieno lo dice solo questo ascolto, in ogni frame, prima della pagina: è
// l'unico a sapere se l'input è caduto sull'interfaccia di Filo (#737.1 giri 6 e 7). Solo l'input vero: la pagina non
// lo fabbrica. Il collegamento cliccato si apre anche se la pagina ha speso il gesto per sé. Regole: services/permessiPagine.js.
try {
  let ultimoGesto = 0;
  let ultimoDiFilo = 0;
  // Gli stessi tasti che nella pagina non sono un gesto (TASTI_SENZA_GESTO in services/permessiPagine.js).
  const SENZA_GESTO = new Set(['Escape', 'Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Symbol', 'SymbolLock']);
  const suUiDiFilo = (e) => {
    const ui = globalThis.SN_FILO_UI;
    if (!ui || typeof ui.aperti !== 'function') return false;
    const radici = ui.aperti();
    if (!radici.length) return false;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    return radici.some((r) => {
      for (let n = r, k = 0; n && k < 32; k++) {
        if (percorso.includes(n)) return true;
        const radice = n.getRootNode && n.getRootNode();
        n = radice && radice.host ? radice.host : null;
      }
      return false;
    });
  };
  const gesto = (e) => {
    if (!e.isTrusted || (e.type === 'keydown' && SENZA_GESTO.has(e.key))) return;
    const ora = Date.now();
    if (suUiDiFilo(e)) {
      // pointerdown e mousedown dello stesso clic sono un gesto solo.
      if (e.type === 'mousedown' && ora - ultimoDiFilo < 100) return;
      if (e.type === 'pointerdown') ultimoDiFilo = ora;
      try { ipcRenderer.sendSync('filo:gesto-di-filo'); } catch (_) {}
      return;
    }
    if (e.type === 'pointerdown' && e.pointerType === 'touch') return;
    if (e.type === 'mousedown' && ora - ultimoGesto < 100) return;
    if (e.type === 'pointerdown') ultimoGesto = ora;
    const tasto = e.type === 'keydown'
      ? { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey } : null;
    try { ipcRenderer.sendSync('filo:gesto-pagina', tasto); } catch (_) {}
  };
  const SCHEMI_APRIBILI = /^(https?|mailto|tel|sms):/i;
  // Il pulsante d'invio cliccato porta dove lo manda il suo modulo: con GET i campi diventano la domanda dell'indirizzo.
  const indirizzoDelModulo = (percorso) => {
    try {
      const b = percorso.find((n) => n && n.form && /^(submit|image)$/i.test(n.type || ''));
      if (!b) return '';
      const f = b.form;
      const u = new URL(b.hasAttribute('formaction') ? b.formAction : f.action, (b.ownerDocument || document).baseURI);
      if (String(b.formMethod || f.method || 'get').toLowerCase() === 'get') u.search = new URLSearchParams(new FormData(f, b)).toString();
      return u.href;
    } catch (_) { return ''; }
  };
  const scelto = (e) => {
    if (!e.isTrusted || (e.type === 'auxclick' && e.button !== 1)) return;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const a = percorso.find((n) => n && (n.localName === 'a' || n.localName === 'area') && n.href);
    const url = a ? String(a.href) : indirizzoDelModulo(percorso);
    if (!SCHEMI_APRIBILI.test(url)) return;
    try { ipcRenderer.sendSync('filo:apertura-scelta', url); } catch (_) {}
  };
  // Un collegamento file: da una pagina web lo rifiuta Chromium prima che Filo lo veda, senza dire niente (#482): il clic
  // dell'utente che la pagina non ha fermato lo riferisce, e Filo lo dice. data: no: con «download» scarica davvero.
  const rifiutato = (e) => {
    if (!e.isTrusted || e.defaultPrevented || (e.type === 'auxclick' && e.button !== 1)) return;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const a = percorso.find((n) => n && (n.localName === 'a' || n.localName === 'area') && n.href);
    if (!a || !/^file:/i.test(String(a.href))) return;
    try { ipcRenderer.send('filo:indirizzo-rifiutato', String(a.href)); } catch (_) {}
  };
  // #965 — un link «scarica» verso un file da avviso non parte: l'avviso compare sulla pagina, come per un link che apre.
  // Dopo la pagina, che può gestire il clic da sé; confermato, il main lo riclicca da qui (SN_RISCARICA).
  let scaricaDaRifare = null;
  const scaricaScelto = (e) => {
    if (!e.isTrusted || e.defaultPrevented || e.button !== 0) return;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const a = percorso.find((n) => n && (n.localName === 'a' || n.localName === 'area') && n.href && n.hasAttribute('download'));
    if (!a || !/^https?:/i.test(String(a.href))) return;
    let fermo = false;
    try { fermo = ipcRenderer.sendSync('filo:scaricamento-scelto', String(a.href), String(a.getAttribute('download') || '')) === true; } catch (_) {}
    if (!fermo) return;
    e.preventDefault();
    scaricaDaRifare = a;
  };
  // `nome`: un file che la pagina ha costruito da sé (blob:, data:) e scaricato senza un link cliccato, rifatto col suo nome.
  globalThis.SN_RISCARICA = (url, nome) => {
    const a = scaricaDaRifare;
    scaricaDaRifare = null;
    if (a && a.isConnected && String(a.href) === String(url)) { a.click(); return true; }
    if (!nome || !/^(blob|data|filesystem):/i.test(String(url))) return false;
    const b = document.createElement('a');
    b.href = String(url);
    b.download = String(nome);
    b.style.display = 'none';
    (document.body || document.documentElement).appendChild(b);
    b.click();
    b.remove();
    return true;
  };
  const ascolta = (win) => {
    // Solo l'inizio di un gesto, come nella pagina: il rilascio dello stesso clic non è un gesto nuovo (il tocco finisce).
    for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchend']) {
      win.addEventListener(ev, gesto, { capture: true, passive: true });
    }
    // Prima della pagina e dopo di lei: un sito che riscrive il collegamento al clic apre quello riscritto.
    for (const ev of ['click', 'auxclick']) {
      win.addEventListener(ev, scelto, { capture: true, passive: true });
      win.addEventListener(ev, scelto, { passive: true });
      win.addEventListener(ev, rifiutato, { passive: true });
    }
    win.addEventListener('click', scaricaScelto);
    win.addEventListener('pointerover', confine, { capture: true, passive: true });
  };
  // I documenti che la pagina si scrive da sé non hanno un preload loro (il riquadro vuoto riempito dallo script), o
  // perdono gli ascolti (la riscrittura da capo): il gesto si ascolta anche lì (#737.1 giro 8). Regole nel pattern.
  // Il segno lo mette solo il preload di un frame per sé; lo vedono i preload degli altri frame dello stesso sito.
  const PRELOAD_PROPRIO = Symbol.for('filo:gesto-preload-proprio');
  const seguiti = new WeakSet();
  // Visto per la prima volta con un indirizzo, si presume in arrivo: in una radice ombra il conto dei load non c'è.
  const conIndirizzo = (f) => (f.hasAttribute('src') && !/^(about:blank)?$/i.test(f.getAttribute('src').trim())) || f.hasAttribute('srcdoc');
  const senzaPreload = (f, caricato) => {
    if (!caricato && conIndirizzo(f)) return null;
    try { const w = globalThis.SN_RIQUADRI_IN_ARRIVO?.finestra(f); return w && w.document && !w[PRELOAD_PROPRIO] ? w : null; } catch (_) { return null; }
  };
  // Riquadri che aspettano il primo load: finché c'è, nessuna finestra si tocca alla cieca.
  const inAttesa = new Set();
  // Lo stesso riquadro cambia documento tenendo la finestra (il vuoto iniziale, la riscrittura): si riaggancia al load.
  const riquadro = (f) => {
    if (seguiti.has(f)) return;
    seguiti.add(f);
    f.addEventListener('load', () => { inAttesa.delete(f); const w = senzaPreload(f, true); if (w) segui(w); }, true);
    if (conIndirizzo(f)) inAttesa.add(f);
    const w = senzaPreload(f, false);
    if (w) segui(w);
  };
  const segui = (win) => {
    ascolta(win);
    let doc = null;
    try { doc = win.document; } catch (_) {}
    if (!doc || seguiti.has(doc)) return;
    seguiti.add(doc);
    new MutationObserver(() => ascolta(win)).observe(doc, { childList: true });
    const riquadri = doc.getElementsByTagName('iframe');
    const nuovi = () => { for (const f of riquadri) riquadro(f); };
    new MutationObserver(nuovi).observe(doc, { childList: true, subtree: true });
    nuovi();
  };
  // Un riquadro dentro una radice ombra sfugge agli osservatori del documento e a window.frames (#737.1 giro 10): si
  // cerca quando il puntatore passa, prima della pressione. Una radice chiusa mostra solo l'ospite: lì il riquadro lo
  // trova l'albero dei frame, e si presenta lui nel mondo isolato del preload (lo stesso in tutti i frame).
  const OSPITI_DI_FINESTRE = 'iframe,frame,object,embed';
  const NASCOSTO = Symbol.for('filo:gesto-riquadro-nascosto');
  const MONDO_DEL_PRELOAD = 999;
  const PRESENTATI = `(()=>{try{const f=parent[Symbol.for('filo:gesto-riquadro-nascosto')];if(typeof f==='function'&&!window[Symbol.for('filo:gesto-preload-proprio')])f(window)}catch(_){}})()`;
  let figliContati = 0;
  const inOmbre = (doc) => {
    let n = 0;
    const visita = (radice) => {
      const passi = doc.createTreeWalker(radice, NodeFilter.SHOW_ELEMENT);
      for (let el = passi.nextNode(); el; el = passi.nextNode()) {
        const r = el.shadowRoot;
        if (!r) continue;
        for (const f of r.querySelectorAll(OSPITI_DI_FINESTRE)) { n++; if (f.localName === 'iframe' || f.localName === 'frame') riquadro(f); }
        visita(r);
      }
    };
    visita(doc);
    return n;
  };
  const confine = (e) => {
    if (!e.isTrusted) return;
    const n = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
    if (n && (n.localName === 'iframe' || n.localName === 'frame')) { riquadro(n); return; }
    if (e.currentTarget !== window) return;
    const figli = [];
    try { for (let c = webFrame.firstChild; c && figli.length < 256; c = c.nextSibling) figli.push(c); } catch (_) { return; }
    if (!figli.length || figli.length === figliContati) return;
    let visti = document.querySelectorAll(OSPITI_DI_FINESTRE).length;
    if (figli.length > visti) visti += inOmbre(document);
    if (figli.length > visti) {
      for (const f of inAttesa) if (!f.isConnected) inAttesa.delete(f);
      // Toccato prima del suo load un riquadro perde il preload: alla cieca solo quando nessuno è in arrivo.
      if (inAttesa.size || globalThis.SN_RIQUADRI_IN_ARRIVO?.qualcunoInArrivo()) return;
      for (const c of figli) { try { c.executeJavaScriptInIsolatedWorld(MONDO_DEL_PRELOAD, [{ code: PRESENTATI }], false).catch(() => {}); } catch (_) {} }
    }
    figliContati = figli.length;
  };
  try {
    Object.defineProperty(window, NASCOSTO, { value: (w) => { try { if (w && w.parent === window && !seguiti.has(w.document)) segui(w); } catch (_) {} } });
  } catch (_) {}
  try { Object.defineProperty(window, PRELOAD_PROPRIO, { value: true }); } catch (_) {}
  segui(window);
  // Il menu del tasto destro si disegna nello strato sopra la scheda (#1054)? Lo dice il main, una volta per riquadro.
  let stratoMenu = null;
  globalThis.SN_STRATO_MENU_ACCESO = () => {
    if (stratoMenu === null) { try { stratoMenu = ipcRenderer.sendSync('filo:strato-menu') === true; } catch (_) { stratoMenu = false; } }
    return stratoMenu;
  };
  // Le voci del menu di Filo che aprono un indirizzo lo dichiarano qui prima di aprirlo.
  // `azione`: l'azione del menu che apre (#1461), misurata dal main fino alla pagina caricata.
  globalThis.SN_APERTURA_SCELTA = (url, azione) => {
    const a = azione && typeof azione === 'object' ? { id: String(azione.id || ''), t0: Number(azione.t0) } : null;
    try { ipcRenderer.sendSync('filo:apertura-scelta', String(url || ''), a); } catch (_) {}
  };
} catch (_) {}

// Electron fa di window.close() la chiusura dell'intera finestra di Filo, da ogni pagina e riquadro: qui la pagina chiede
// e il main chiude solo la sua scheda, quando un browser lo permetterebbe (#737.1 giro 11, ipc.js `filo:chiudi-pagina`).
try {
  const CHIUDI = 'filo:chiudi-pagina';
  const chiudi = () => { try { ipcRenderer.send(CHIUDI); } catch (_) {} };
  const ascolta = () => window.addEventListener(CHIUDI, chiudi, true);
  ascolta();
  // La riscrittura da capo (document.open, la ricevuta scritta dalla pagina che l'ha aperta) toglie gli ascolti.
  new MutationObserver(ascolta).observe(document, { childList: true });
  webFrame.executeJavaScript(`(()=>{const w=window,d=EventTarget.prototype.dispatchEvent,E=Event;
    Object.defineProperty(w,'close',{value:function close(){d.call(w,new E(${JSON.stringify(CHIUDI)}))},writable:true,configurable:true,enumerable:true})})()`, false).catch(() => {});
} catch (_) {}

// ─── shortcut hook ─────────────────────────────────────────────────────────
// La scorciatoia (shortcuts.js) fa un webContents.send('shortcut:triggered'); il content
// script registra un listener via chrome.runtime.onMessage su MSG.SHORTCUT_TRIGGERED.
// Il microfono di Filo su una pagina web lo apre la cornice (#586): qui arrivano i campioni a 16 kHz per SN_ASCOLTO,
// solo nel mondo di Filo. La pagina non riceve il permesso, nemmeno durante una dettatura. Main: services/microfonoDiFilo.js.
const microfoniAperti = new Map();
ipcRenderer.on('microfono:dati', (_event, d) => {
  const m = d && microfoniAperti.get(d.id);
  if (!m) return;
  if (d.fine) { microfoniAperti.delete(d.id); try { m.suFine(); } catch (_) {} return; }
  if (d.dati) { try { m.suDati(d.dati instanceof Float32Array ? d.dati : Float32Array.from(d.dati)); } catch (_) {} }
});
globalThis.SN_MICROFONO_CORNICE = {
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

const STYLES = [
  'theme.css', 'menu.css', 'popup.css', 'sidebar.css', 'voce.css',
  'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css',
];

let stiliMessi = false;
function injectStyles() {
  // Non è una pagina: about:blank, data:, view-source.
  if (!document.head) return;
  stiliMessi = true;
  for (const f of STYLES) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'filo://style/' + f;
    document.head.appendChild(link);
  }
}

// La testa del documento riscritto è nuova: i fogli di Filo vanno rimessi.
if (riscrittura) {
  riscrittura.allaRiscrittura(() => {
    if (!stiliMessi) return;
    if (document.head) injectStyles();
    else document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
  });
}

const SHARED_DIR = path.join(__dirname, '..', 'shared');
const CONTENT_DIR = path.join(__dirname, '..', 'content');

// Stesso elenco di loadContentScripts() in internal-preload.js: le differenze
// ammesse stanno in tests/unit/contentScriptPreload.test.mjs.
function loadScripts() {
  // #405 — `PAGE_ONLY` marca i moduli che parlano della SCHEDA intera (banner, colore della
  // tab): in un riquadro descriverebbero il rettangolo sbagliato e lì non si caricano.
  const PAGE_ONLY = !IS_SUBFRAME;
  try { require(path.join(SHARED_DIR, 'constants.js')); } catch (e) { console.error('[Filo CS] constants', e); }
  try { require(path.join(SHARED_DIR, 'immaginiChat.js')); } catch (e) { console.error('[Filo CS] immaginiChat', e); } // #1623 — le immagini date all'Aiuto: PRIMA di sidebar.js
  try { require(path.join(SHARED_DIR, 'contenutoEsterno.js')); } catch (e) { console.error('[Filo CS] contenutoEsterno', e); } // #593 — imbusta il contenuto esterno: PRIMA di sidebar.js e spellcheck.js
  // Per primo fra i moduli che toccano il DOM: chi disegna un pezzo di UI di
  // Filo dentro la pagina lo marca alla nascita, e chi cammina sulla pagina
  // (traduzione, sentinella del testo nuovo) lo riconosce da quel marchio.
  try { require(path.join(SHARED_DIR, 'filoUi.js')); } catch (e) { console.error('[Filo CS] filoUi', e); }
  try { require(path.join(SHARED_DIR, 'i18n.js')); } catch (e) { console.error('[Filo CS] i18n', e); }
  try { require(path.join(SHARED_DIR, 'clipboardHistory.js')); } catch (e) { console.error('[Filo CS] clipboardHistory', e); } // #256 — PRIMA di menu.js
  try { require(path.join(SHARED_DIR, 'messages.js')); } catch (e) { console.error('[Filo CS] messages', e); }
  try { require(path.join(SHARED_DIR, 'tasti.js')); } catch (e) { console.error('[Filo CS] tasti', e); } // nomi delle scorciatoie per il sistema di chi legge: PRIMA di menu/actions/content
  try { require(path.join(SHARED_DIR, 'disposizioneIcone.js')); } catch (e) { console.error('[Filo CS] disposizioneIcone', e); } // dove sta ogni icona globale: PRIMA di menuIcons
  try { require(path.join(SHARED_DIR, 'campoTesto.js')); } catch (e) { console.error('[Filo CS] campoTesto', e); } // "si sta scrivendo qui?": PRIMA di content.js, che ci decide Ctrl+Z
  try { require(path.join(SHARED_DIR, 'urlNav.js')); } catch (e) { console.error('[Filo CS] urlNav', e); } // #437 — "è davvero un indirizzo?" per Copia URL/Condividi
  try { require(path.join(SHARED_DIR, 'nomiSito.js')); } catch (e) { console.error('[Filo CS] nomiSito', e); } // #843 — il sito di «Spegni Filo su questo sito»
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
  try { require(path.join(SHARED_DIR, 'guardianoStatico.js')); } catch (e) { console.error('[Filo CS] guardianoStatico', e); } // #810.7 — la forma di un numero di carta: PRIMA di extractContext
  try { require(path.join(SHARED_DIR, 'campiSegreti.js')); } catch (e) { console.error('[Filo CS] campiSegreti', e); } // #810.7 — campi che non vanno al modello: PRIMA di extractContext
  try { require(path.join(CONTENT_DIR, 'extractContext.js')); } catch (e) { console.error('[Filo CS] extractContext', e); }
  try { require(path.join(CONTENT_DIR, 'gesto.js')); } catch (e) { console.error('[Filo CS] gesto', e); } // #1070 — «l'utente ha appena fatto qualcosa?»: PRIMA di spellcheck.js e actions.js
  try { require(path.join(SHARED_DIR, 'avvisiTempo.js')); } catch (e) { console.error('[Filo CS] avvisiTempo', e); } // tempi della pila degli avvisi: PRIMA di popup.js
  try { require(path.join(CONTENT_DIR, 'popup.js')); } catch (e) { console.error('[Filo CS] popup', e); }
  try { require(path.join(CONTENT_DIR, 'vistoDavvero.js')); } catch (e) { console.error('[Filo CS] vistoDavvero', e); } // #589.11 — un clic sul menu conta solo se la voce si vedeva: PRIMA di menu.js
  try { require(path.join(CONTENT_DIR, 'menu.js')); } catch (e) { console.error('[Filo CS] menu', e); }
  try { require(path.join(SHARED_DIR, 'menuDescritto.js')); } catch (e) { console.error('[Filo CS] menuDescritto', e); } // #1054 — il menu come dati per lo strato
  try { require(path.join(CONTENT_DIR, 'menuNelloStrato.js')); } catch (e) { console.error('[Filo CS] menuNelloStrato', e); } // #1054 — DOPO menu.js, PRIMA di chi lo usa
  try { require(path.join(CONTENT_DIR, 'highlight.js')); } catch (e) { console.error('[Filo CS] highlight', e); }
  try { require(path.join(CONTENT_DIR, 'sidebar.js')); } catch (e) { console.error('[Filo CS] sidebar', e); }
  try { require(path.join(CONTENT_DIR, 'coerenza.js')); } catch (e) { console.error('[Filo CS] coerenza', e); } // #1115 — date e citazioni del segno ocra: PRIMA di spellcheck.js
  try { require(path.join(CONTENT_DIR, 'correttoreRegole.js')); } catch (e) { console.error('[Filo CS] correttoreRegole', e); } // #1446 — PRIMA di spellcheck.js
  try { require(path.join(CONTENT_DIR, 'correttoreAutomatica.js')); } catch (e) { console.error('[Filo CS] correttoreAutomatica', e); } // #1447 — DOPO correttoreRegole.js, PRIMA di spellcheck.js
  try { globalThis.SN_DIZIONARIO = require('./dizionario.js')(ipcRenderer, webFrame); } catch (e) { console.error('[Filo CS] dizionario', e); } // #1446 — PRIMA di spellcheck.js
  try { require(path.join(CONTENT_DIR, 'spellcheck.js')); } catch (e) { console.error('[Filo CS] spellcheck', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'safebrowse.js')); } catch (e) { console.error('[Filo CS] safebrowse', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'geoProposal.js')); } catch (e) { console.error('[Filo CS] geoProposal', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookieRules.js')); } catch (e) { console.error('[Filo CS] cookieRules', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookieBanners.js')); } catch (e) { console.error('[Filo CS] cookieBanners', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'cookies.js')); } catch (e) { console.error('[Filo CS] cookies', e); }
  if (PAGE_ONLY) try { require(path.join(CONTENT_DIR, 'riquadroRotto.js')); } catch (e) { console.error('[Filo CS] riquadroRotto', e); } // #760 — la proposta sopra il riquadro
  try { require(path.join(CONTENT_DIR, 'adSkip.js')); } catch (e) { console.error('[Filo CS] adSkip', e); } // #737 — nei riquadri è già partito da solo
  try { require(path.join(SHARED_DIR, 'campoAccesso.js')); } catch (e) { console.error('[Filo CS] campoAccesso', e); } // #1124 — quali campi chiedono l'email
  try { require(path.join(CONTENT_DIR, 'propostaEmail.js')); } catch (e) { console.error('[Filo CS] propostaEmail', e); } // #1124 — anche nei riquadri: il campo può stare lì
  try { require(path.join(SHARED_DIR, 'feedback.js')); } catch (e) { console.error('[Filo CS] feedback shared', e); }
  try { require(path.join(SHARED_DIR, 'feedbackClientIdHash.js')); } catch (e) { console.error('[Filo CS] feedbackClientIdHash', e); }
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
  // I moduli girano nel mondo isolato: il DOM è l'unico posto da cui i test
  // possono vedere che si sono caricati.
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
  try { require(path.join(CONTENT_DIR, 'safebrowseLinks.js')); } catch (e) { console.error('[Filo CS] safebrowseLinks', e); } // #965
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
  // #1124 — un campo email in un riquadro qui dentro chiede dove sta: il gesto è stato là, ma la misura tocca a noi.
  try {
    window.addEventListener('message', (e) => {
      const segno = e.data && typeof e.data === 'object' ? e.data.filoPropostaEmail : null;
      if (contentScriptsStarted || typeof segno !== 'string' || !e.source) return;
      const sorgente = e.source;
      ensureContentScripts();
      waitForContentScripts(() => { try { globalThis.SN_PROPOSTA_EMAIL?.segno?.(segno, sorgente); } catch (_) {} });
    });
  } catch (_) {}
}

