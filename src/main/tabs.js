// Le schede: ogni scheda è una WebContentsView attaccata alla finestra, sotto
// la barra della shell. Qui vivono il loro ciclo di vita, il layout, lo schermo
// intero, il proxy per scheda e le guardie sulle navigazioni.

const { WebContentsView, Menu, MenuItem, session, shell, BrowserWindow } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Cookies = require('./services/cookies');
const ProxyTab = require('./services/proxyTab');
const GeoBlock = require('./services/geoBlock');
const GeoBlockRules = require('./services/geoBlockRules');
const { installSafebrowse } = require('./tabs/tabSafebrowse');
const { installGeoBlock } = require('./tabs/tabGeoBlock');
require('../shared/audioState');
const { audibleFromEvent } = globalThis.SN_AUDIO_STATE;
require('../shared/authPopup');
const { isAuthPopup } = globalThis.SN_AUTH_POPUP;
require('../shared/urlNav'); // #398 — sorgente unica di normalizeUrl/isLocalHost (condivisa con la dashboard)
const { normalizeUrl, canonicalizeFiloUrl } = globalThis.SN_URL_NAV;
require('../shared/downloadTabs'); // #412/#441 — schede usa e getta dei download (logica pura)
const { decideCloseOnDownload } = globalThis.SN_DOWNLOAD_TABS;
require('../shared/tasti'); // nome E comportamento delle scorciatoie, per il sistema su cui gira
const { indiceSaltoScheda } = globalThis.SN_TASTI;

// #441 — il cursore che attraversa la pagina non è un'interazione con quella
// scheda. Tutto il resto (clic, tasti, rotella, tocco, gesti) lo è.
const HOVER_INPUT_TYPES = new Set([
  'mouseMove', 'mouseEnter', 'mouseLeave', 'pointerMove', 'pointerRawUpdate',
]);

// #514 — quanto si aspetta la pagina prima di uscire dallo schermo intero per
// conto nostro: il tempo di dire "quell'Esc me lo sono preso io".
// Due tempi, perché i casi sono diversi. Una pagina che RISPONDE risponde
// comunque, quindi l'attesa non è ritardo ma la rete per il caso in cui non
// risponda mai: larga, o una pagina impegnata mezzo secondo arriva fuori tempo
// e si porta via il riquadro che aveva aperto. Una pagina che NON risponde (un
// PDF, una pagina d'errore) non dirà niente: lì è tutto ritardo, e resta corta.
// L'errore possibile è sempre un'uscita tardiva, mai restare chiusi dentro.
const ESC_ATTESA_MS = 400;
const ESC_ATTESA_PAGINA_CHE_RISPONDE_MS = 2500;

// #514 — quante volte di fila la pagina può rivendicare l'Esc prima che non le
// si creda più. Il conto sta nel MAIN perché nella pagina il sito ci arriva: un
// evento finto azzerava quello del content script, e un sito scritto apposta
// teneva l'utente dentro allo schermo intero per sempre. Tre è più dei riquadri
// che si possono impilare, e riparte da zero a ogni altro gesto dell'utente.
const ESC_RIVENDICAZIONI_MAX = 3;

// #514 — la sessione è condivisa fra finestre e schede, ma "l'ultimo tasto era
// l'Esc" è della singola scheda: il gestore dei permessi deve poter risalire.
function tabDiWebContents(wc) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => {
        const c = x && x.view && x.view.webContents;
        return c && !c.isDestroyed() && c.id === wc.id;
      });
      if (t) return t;
    }
  } catch (_) {}
  return null;
}

// #514 — l'Esc NON è un gesto con cui una pagina può prendersi lo schermo. Il
// browser lo conta come gesto dell'utente, quindi una pagina che chiedeva lo
// schermo pieno dentro il proprio gestore dell'Esc lo otteneva senza che
// nessuno avesse cliccato: il tasto diventava un testa o croce, un Esc esce e
// il successivo rientra. Un evento di USCITA non può essere il permesso per
// entrare. Ogni altro permesso resta com'era: di qui il `callback(true)` finale.
function installaPermessi(ses) {
  if (!ses || ses._filoPermessi) return;
  ses._filoPermessi = true;
  try {
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === 'fullscreen') {
        const t = tabDiWebContents(wc);
        if (t && t._ultimoInputEsc) { callback(false); return; }
      }
      callback(true);
    });
  } catch (_) {}
}

// #252 — di una pagina interna ha senso UNA scheda sola: riaprirla deve
// riportare a quella, non fare un doppione. L'unica eccezione è la nuova
// scheda. L'identità è host+path: un ?highlight non fa un'altra pagina.
function filoSingletonKey(url) {
  const s = String(url || '');
  if (!s.startsWith('filo://')) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.hostname === 'newtab') return null;
  return u.hostname + u.pathname;
}

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page-preload.js');
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

// SICUREZZA — gli schemi ammessi per le navigazioni che NASCONO dal contenuto
// web (link, window.open) e dall'agente: tutto il resto è bloccato. `file://`
// soprattutto — su Windows un percorso UNC fa partire l'autenticazione SMB e
// consegna l'hash NTLM a un sito ostile, e `file:///C:/…` espone i file locali;
// `data:` e `javascript:` in cima sono phishing. La barra indirizzi, che è una
// scelta esplicita dell'utente, NON passa di qui.
const WEB_NAV_SCHEMES = new Set(['http:', 'https:', 'filo:', 'about:', 'blob:']);
function isWebUnsafeNav(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  // URL relativo o illeggibile: Electron lo risolve sull'origine corrente, non
  // è un cambio di schema.
  return proto ? !WEB_NAV_SCHEMES.has(proto) : false;
}

// Schemi che un browser completo CONSEGNA al sistema invece di fallire (mailto,
// tel, sms). Elenco volutamente minimo: tutto il resto resta bloccato, o un
// sito ostile innescherebbe gestori di protocollo che non conosciamo.
const OS_DELEGATED_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);
function isOsDelegatedScheme(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  return OS_DELEGATED_SCHEMES.has(proto);
}

// SOLO dopo aver bloccato la navigazione in-app, e SOLO per gli schemi ammessi.
function openExternalScheme(rawUrl) {
  if (!isOsDelegatedScheme(rawUrl)) return false;
  try { shell.openExternal(String(rawUrl)); } catch (_) {}
  return true;
}

// Da tenere in sync con `.tab-row { flex: 0 0 40px }` in shell.css: è l'altezza
// da cui parte la vista quando la shell è in chrome compatto.
const TAB_ROW_HEIGHT = 40;

// Pagine senza content script: qui il tasto destro apre un menu nativo, o
// resterebbe inerte (niente taglia/copia/incolla).
const NATIVE_MENU_PAGES = [
  'filo://options/', 'filo://preferences/', 'filo://security/', 'filo://history/',
  'filo://feedback/', 'filo://spellcheck/', 'filo://editor/', 'filo://admin-defaults/',
  'filo://manage/',
];

// Gli stili di Filo vanno iniettati DAL MAIN con insertCSS, che ignora la CSP
// della pagina: il <link filo://style/...> del content script su molti siti
// (YouTube, Reddit) viene bloccato, e il menu del tasto destro finiva nel DOM
// senza stile — invisibile, cioè "il tasto destro non funziona".
// Stessa lista di page-preload.js: le due vanno tenute insieme.
const fs = require('node:fs');
const CONTENT_STYLE_FILES = ['theme.css', 'menu.css', 'popup.css', 'sidebar.css', 'highlight.css', 'spellcheck.css', 'feedback.css'];
let CONTENT_SCRIPT_CSS = null;
function getContentScriptCss() {
  if (CONTENT_SCRIPT_CSS !== null) return CONTENT_SCRIPT_CSS;
  const dir = path.join(__dirname, '..', 'styles');
  const parts = [];
  for (const f of CONTENT_STYLE_FILES) {
    try { parts.push(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) {}
  }
  CONTENT_SCRIPT_CSS = parts.join('\n');
  return CONTENT_SCRIPT_CSS;
}

/* #146.1 — il colore viene dalle variabili del tema; il valore letterale è il
   ripiego per il primo paint, prima che [data-sn-theme] esista. Niente var()
   nella regola nuda: dentro ::selection non si risolve in modo affidabile. */
const PAGE_SELECTION_CSS = `
::selection { background-color: rgba(196, 90, 59, 0.30) !important; }
::-moz-selection { background-color: rgba(196, 90, 59, 0.30) !important; }
[data-sn-theme] ::selection { background-color: var(--sn-selection-bg, rgba(196, 90, 59, 0.30)) !important; }
[data-sn-theme] ::-moz-selection { background-color: var(--sn-selection-bg, rgba(196, 90, 59, 0.30)) !important; }
`;

function buildNativeContextMenu(wc, params) {
  const { editFlags = {}, isEditable, selectionText, misspelledWord, dictionarySuggestions } = params;
  const menu = new Menu();
  if (misspelledWord && Array.isArray(dictionarySuggestions) && dictionarySuggestions.length) {
    for (const s of dictionarySuggestions.slice(0, 5)) {
      menu.append(new MenuItem({ label: s, click: () => wc.replaceMisspelling(s) }));
    }
    menu.append(new MenuItem({ type: 'separator' }));
  }
  const hasSel = !!(selectionText && selectionText.trim());
  if (isEditable) menu.append(new MenuItem({ label: 'Taglia', role: 'cut', enabled: !!editFlags.canCut }));
  if (isEditable || hasSel) menu.append(new MenuItem({ label: 'Copia', role: 'copy', enabled: !!editFlags.canCopy }));
  if (isEditable) menu.append(new MenuItem({ label: 'Incolla', role: 'paste', enabled: !!editFlags.canPaste }));
  if (isEditable || hasSel) {
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Seleziona tutto', role: 'selectAll' }));
  }
  return menu.items.length ? menu : null;
}

class TabManager {
  constructor(window, shellView, { shellHeight = 88, incognito = false, partition = null } = {}) {
    this.win = window;
    this.shellView = shellView; // WebContentsView della shell — per il broadcast tabs:updated
    this.shellHeight = shellHeight;
    // Incognito: sessione effimera e nessun ripristino su disco. Lo storage
    // filo:// è già coperto a monte dall'overlay in RAM dello shim.
    this.incognito = !!incognito;
    this.partition = partition || null;
    this.tabs = []; // [{ id, view, title, url, favicon, loading, canBack, canFwd }]
    this.activeId = null;
    // §1.2 — così una scheda nuova su un dominio già visto ha subito la sua
    // tinta, senza aspettare che il content script rifaccia il calcolo.
    this._identityColorCache = new Map();
    // §2.1 — l'auto-archiviazione misura l'inattività dell'APP INTERA da qui.
    this._lastAppInteractionAt = Date.now();
    this._triageRunning = false;
    if (!this.incognito) {
      // Soglia e interruttore stanno nelle preferenze e si rileggono a ogni
      // giro: un cambio deve valere senza riavviare.
      this._autoArchiveTimer = setInterval(() => {
        this._autoArchiveTick().catch(() => {});
      }, 5 * 60 * 1000);
      if (this._autoArchiveTimer.unref) this._autoArchiveTimer.unref();
    }
    // Spazio riservato in alto perché un pannello della shell resti visibile:
    // si ABBASSA la vista invece di nasconderla, o resta un'area bianca.
    this.topInset = 0;
    // Contenuto a tutto schermo: la vista attiva copre la finestra e la barra
    // resta sotto. Si esce con Esc.
    this.contentFullscreen = false;
    // Schermo pieno chiesto DALLA pagina (il pulsante di un lettore video): lì
    // l'Esc deve arrivarle, o resta convinta di essere a tutto schermo.
    this.pageFullscreen = false;
    // #514 — la deroga qui sopra vale SOLO per quella scheda: un Esc da
    // un'altra, o dalla barra, alla pagina non arriverebbe mai, e lasciarlo
    // passare chiuderebbe l'utente dentro senza uscite.
    this.pageFullscreenTabId = null;
    // #514 — l'uscita in attesa: l'Esc sulla pagina è prima suo, si esce solo
    // se nessuno se l'è preso (vedi handleFullscreenEscape).
    this._escUscitaTimer = null;
    this._escRivendicazioni = 0;
    // Chrome compatto: la shell decide quando (setChromeCompact), qui se ne
    // tiene solo l'altezza per il layout.
    this.chromeCompact = false;
    this.tabRowHeight = TAB_ROW_HEIGHT;
    // I default qui ricalcano DEFAULT_SETTINGS.security: se setSecurity non
    // viene mai chiamata la protezione dev'essere comunque accesa.
    this.security = { protectIpLeak: true, blockPopups: true };
    // In 'privacy' ogni sito ha una partizione effimera; i siti fidati ne hanno
    // una isolata ma PERSISTENTE, così si resta connessi.
    this.cookieMode = Cookies.MODES.DEFAULT;
    this.trustedSites = [];
    // #151 — l'avviso sul consumo dati si dà una volta per sessione, non a ogni
    // video: ripeterlo sarebbe rumore.
    this._proxyVideoNoted = false;
    // #152 — copia in memoria delle regole "questo sito sempre da X": in
    // navigazione la decisione è SINCRONA e non può attendere lo storage. La
    // verità sta in SN_FILO_MEMORY.listProxyRules.
    this._proxyRules = {};
    this.loadProxyRules().catch(() => {});
    this._wireShellZoomKeys();
  }

  // Le impostazioni nuove valgono anche per le schede GIÀ aperte.
  setSecurity(security) {
    this.security = {
      protectIpLeak: security?.protectIpLeak !== false,
      blockPopups: security?.blockPopups !== false,
    };
    const cookies = security?.cookies || {};
    this.cookieMode = Cookies.getMode({ security: { cookies } });
    this.trustedSites = Cookies.getTrustedSites({ security: { cookies } });
    for (const tab of this.tabs) {
      this._applySecurity(tab);
    }
  }

  // Idempotente: si può richiamare quante volte serve.
  _applySecurity(tab) {
    if (tab.isInternal) return; // le pagine filo:// sono fidate, niente da limitare
    try {
      // In una scheda proxata WebRTC non deve MAI aprire UDP diretto: con STUN
      // qualsiasi sito leggerebbe l'IP vero. Non disattivabile, vince anche
      // sull'impostazione dell'utente.
      const policy = tab.proxy
        ? 'disable_non_proxied_udp'
        : (this.security.protectIpLeak ? 'default_public_interface_only' : 'default');
      tab.view.webContents.setWebRTCIPHandlingPolicy(policy);
    } catch (_) { /* policy non supportata in qualche build */ }
  }

  // Quanta shell resta scoperta dalla vista attiva. Serve a ritagliare lo
  // scatto della barra quando si annota tutta l'app col disegno.
  topChromeHeight() {
    if (this.contentFullscreen) return 0;
    return this.chromeCompact ? this.tabRowHeight : this.shellHeight;
  }

  setTopInset(px) {
    this.topInset = Math.max(0, Math.round(Number(px) || 0));
    this.layout();
  }

  // Idempotente; porta anche la finestra a tutto schermo di sistema, o i due
  // stati divergono. Ritorna lo stato risultante.
  setContentFullscreen(on) {
    on = !!on;
    // La modalità è cambiata: un'uscita ancora in attesa parla di un momento
    // che non c'è più.
    this.annullaUscitaSchermoIntero();
    this.azzeraRivendicazioniEsc();
    if (this.contentFullscreen === on) return on;
    this.contentFullscreen = on;
    this.layout();
    try {
      if (typeof this.win.setFullScreen === 'function') this.win.setFullScreen(on);
    } catch (_) {}
    // Uscita per una strada che non è l'Esc sulla pagina che aveva chiesto lo
    // schermo pieno: lei resterebbe convinta di averlo, col lettore disegnato a
    // schermo pieno dentro una vista tornata sotto la barra.
    if (!on && this.pageFullscreen) this._exitPageFullscreen();
    try {
      const type = globalThis.SN_MSG?.MSG?.FULLSCREEN_CHANGED || 'fullscreen_changed';
      this._broadcastToViews({ type, fullscreen: on });
    } catch (_) {}
    return on;
  }

  toggleContentFullscreen() {
    return this.setContentFullscreen(!this.contentFullscreen);
  }

  // Se la scheda non c'è più resta da dimenticarla: la deroga dell'Esc non deve
  // sopravvivere alla pagina che la giustificava.
  _exitPageFullscreen() {
    const owner = this.tabs.find((t) => t.id === this.pageFullscreenTabId);
    this.pageFullscreen = false;
    this.pageFullscreenTabId = null;
    if (!owner) return;
    try {
      owner.view.webContents
        .executeJavaScript('try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {} true', true)
        .catch(() => {});
    } catch (_) {}
  }

  // #514 — la regola UNICA dell'Esc a schermo intero, per ogni porta d'ingresso
  // e per ogni posto da cui il tasto arriva (la pagina o la barra di Filo, che
  // a tutto schermo è nascosta ma può tenere il fuoco).
  // In una riga: l'Esc premuto sulla pagina è PRIMA della pagina, e la modalità
  // esce solo se nessuno se l'è preso. Prendercelo prima vorrebbe dire
  // scavalcare tutto quello che Filo apre sopra la pagina e si chiude con Esc —
  // menu, risposta, immagine ingrandita, conferma, QR: una lista da tenere a
  // mano invecchia male, quindi non c'è lista. Chi consuma il tasto lo dice
  // (MSG.ESC_CONSUMATO) e l'uscita si annulla; chi tace esce, e chi non risponde
  // affatto esce allo scadere dell'attesa.
  // `tabId` è la scheda da cui arriva il tasto, null se arriva dalla barra.
  // Ritorna true se l'ha gestito: chi chiama fa il preventDefault.
  handleFullscreenEscape(tabId = null) {
    if (!this.contentFullscreen) return false;
    // Dalla barra, o da una scheda che non è davanti: la pagina quel tasto non
    // lo vedrà mai, quindi si decide subito.
    if (tabId == null || tabId !== this.activeId) {
      this.setContentFullscreen(false);
      return true;
    }
    // Troppi Esc di fila senza nient'altro in mezzo: non le si crede più. È il
    // tetto che nessun sito può azzerare.
    if ((this._escRivendicazioni || 0) >= ESC_RIVENDICAZIONI_MAX) {
      this.setContentFullscreen(false);
      return true;
    }
    // #514 — schermo pieno chiesto dalla PAGINA, tasto che arriva da lei. Non
    // si può lasciar passare: il browser lo consuma per uscire dal suo
    // fullscreen e il documento non lo vede mai, quindi ogni riquadro aperto
    // sopra la pagina veniva scavalcato. Ce lo prendiamo — è l'unico modo di
    // fermare l'uscita del browser — e lo consegniamo noi alla pagina.
    const nostro = this.pageFullscreen && tabId === this.pageFullscreenTabId
      ? this._inoltraEscAllaPagina(tabId)
      : false;
    this.armaUscitaSchermoIntero(tabId);
    return nostro;
  }

  // Consegna alla pagina l'Esc che il browser le avrebbe mangiato. Torna true
  // se il messaggio è partito, cioè se il tasto ce lo siamo presi noi.
  _inoltraEscAllaPagina(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed?.()) return false;
    const type = globalThis.SN_MSG?.MSG?.ESC_INOLTRATO || 'esc_inoltrato';
    // Al frame con cui l'utente sta interagendo, dove sarebbe arrivato il tasto
    // vero: un menu aperto dentro un riquadro incorporato vive lì, e mandarlo
    // al frame principale lo lascerebbe aperto (#405 tiene `_filoActiveFrame`).
    let frame = null;
    try {
      const attivo = wc._filoActiveFrame;
      frame = (attivo && !attivo.detached ? attivo : null) || wc.focusedFrame || wc.mainFrame;
    } catch (_) { frame = null; }
    try {
      if (frame && !frame.detached) frame.send('filo:broadcast', { type });
      else wc.send('filo:broadcast', { type });
    } catch (_) { return false; }
    return true;
  }

  // Solo il frame principale può chiedere l'uscita al browser: la richiesta di
  // un riquadro incorporato gliela giriamo noi.
  chiediEscAlFramePrincipale(tabId) {
    const tab = tabId != null ? this.tabs.find((t) => t.id === tabId) : null;
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed?.()) return;
    const type = globalThis.SN_MSG?.MSG?.ESC_CHIEDI_TASTO || 'esc_chiedi_tasto';
    try {
      const mf = wc.mainFrame;
      if (mf && !mf.detached) mf.send('filo:broadcast', { type });
      else wc.send('filo:broadcast', { type });
    } catch (_) {}
  }

  // Lo chiama chi vede l'input VERO, mai la pagina: è ciò che rende il tetto
  // inattaccabile da un evento fabbricato.
  azzeraRivendicazioniEsc() {
    this._escRivendicazioni = 0;
  }

  // L'uscita parte solo se nessuno rivendica il tasto; quanto si aspetta
  // dipende da chi c'è dall'altra parte (ESC_ATTESA_MS).
  armaUscitaSchermoIntero(tabId = null) {
    this.annullaUscitaSchermoIntero();
    const tab = tabId != null ? this.tabs.find((t) => t.id === tabId) : null;
    const attesa = tab && tab._rispondeAllEsc
      ? ESC_ATTESA_PAGINA_CHE_RISPONDE_MS
      : ESC_ATTESA_MS;
    this._escUscitaTimer = setTimeout(() => {
      this._escUscitaTimer = null;
      if (this.contentFullscreen) this.setContentFullscreen(false);
    }, attesa);
    // Un timer non deve tenere sveglio il processo.
    try { this._escUscitaTimer.unref?.(); } catch (_) {}
  }

  // La pagina si è presentata: ha i pezzi di Filo dentro e a un Esc risponde
  // comunque, quindi da qui in poi il main la aspetta invece di uscire a tempo.
  paginaRispondeAllEsc(tabId) {
    if (tabId == null) return;
    const t = this.tabs.find((x) => x.id === tabId);
    if (t) t._rispondeAllEsc = true;
  }

  annullaUscitaSchermoIntero() {
    if (!this._escUscitaTimer) return;
    clearTimeout(this._escUscitaTimer);
    this._escUscitaTimer = null;
  }

  // Tollerante sul mittente: le schede in secondo piano il tasto non lo
  // ricevono, e un riquadro dentro un iframe parla per la sua pagina.
  escConsumato(tabId = null) {
    if (tabId != null && tabId !== this.activeId) return;
    if (this._escUscitaTimer) this._escRivendicazioni = (this._escRivendicazioni || 0) + 1;
    this.annullaUscitaSchermoIntero();
  }

  // Idempotente. La shell la richiama a ogni cambio di pagina attiva.
  setChromeCompact(on) {
    on = !!on;
    if (this.chromeCompact === on) return on;
    this.chromeCompact = on;
    this.layout();
    return on;
  }

  // #514 — a OGNI frame, non al solo principale: anche nei riquadri incorporati
  // c'è il menu del tasto destro, e lì l'Esc va deciso. Al solo frame
  // principale, un riquadro già aperto restava indietro per sempre e la sua
  // voce di menu prometteva il contrario di quello che sarebbe successo.
  _broadcastToViews(message) {
    for (const t of this.tabs) {
      const wc = t.view?.webContents;
      if (!wc || wc.isDestroyed?.()) continue;
      let frames = null;
      try { frames = wc.mainFrame && wc.mainFrame.framesInSubtree; } catch (_) { frames = null; }
      if (!frames || !frames.length) {
        try { wc.send('filo:broadcast', message); } catch (_) {}
        continue;
      }
      for (const f of frames) {
        try { if (!f.detached) f.send('filo:broadcast', message); } catch (_) {}
      }
    }
  }

  // La sessione che una vista deve usare. In privacy ogni sito ha la sua
  // (effimera, o persistente se fidato), sempre isolata dagli altri. Le pagine
  // filo:// restano SEMPRE sulla sessione della finestra: lì vivono storage e
  // protocollo, e una partizione per-sito gliene toglierebbe l'accesso.
  _partitionFor(url) {
    if (this.incognito) return this.partition || null;
    if (!url || url.startsWith('filo://')) return null;
    if (this.cookieMode === Cookies.MODES.PRIVACY) {
      const { partition } = Cookies.partitionForTab(url, {
        mode: this.cookieMode,
        incognito: false,
        trusted: this.trustedSites,
      });
      return partition || null;
    }
    return null;
  }

  // Una scheda proxata vive in proxy:<tabId> finché vive. Partizione diversa
  // vuol dire cookie separati: NON condivide i login con le altre, ed è voluto.
  // Le pagine filo:// restano nella sessione normale anche lì: sono interne.
  _partitionForTab(tab, url) {
    if (tab && tab.proxy && url && !url.startsWith('filo://')) {
      return `proxy:${tab.id}`;
    }
    return this._partitionFor(url);
  }

  _makeView(url, partition, opts = {}) {
    const isInternal = url.startsWith('filo://');
    const webPreferences = {
      preload: isInternal ? INTERNAL_PRELOAD : PAGE_PRELOAD,
      // contextIsolation spento SOLO sulle pagine interne, dove i moduli
      // portati si aspettano chrome.* globale. Le pagine web sono codice non
      // fidato e restano isolate.
      contextIsolation: !isInternal,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: true,
      // #405 — senza questo il preload, e quindi tutto Filo, gira nel solo
      // frame principale: dentro un riquadro incorporato il tasto destro non
      // produceva niente. `nodeIntegration` resta false e contextIsolation
      // true, quindi la pagina (e le terze parti nell'iframe) non guadagnano
      // nulla: Node e lo shim restano nel mondo isolato del preload.
      ...(isInternal ? {} : { nodeIntegrationInSubFrames: true }),
      ...(partition ? { partition } : {}),
    };
    // #145 — le schede ripristinate non devono far ripartire i media da sole.
    // Il blocco lo fa il preload perché `autoplayPolicy` non è onorato dalle
    // WebContentsView: se un giorno lo fosse, quella è la strada giusta.
    if (opts.suppressAutoplay && !isInternal) {
      webPreferences.additionalArguments = [
        ...(webPreferences.additionalArguments || []),
        '--filo-suppress-autoplay',
      ];
    }
    const view = new WebContentsView({ webPreferences });
    // #410.1 — anche le sessioni non predefinite (privacy, proxy), o un
    // download partito da lì resterebbe al buio. Incognito ESCLUSO apposta:
    // "nessuna traccia" vale anche per gli scaricamenti.
    if (!this.incognito) {
      try { require('./services/downloads').attachSession(view.webContents.session); } catch (_) {}
    }
    installaPermessi(view.webContents.session);
    return view;
  }

  openTab(url = 'filo://newtab/', { activate = true, restoreScrollPct = null, restoreZoomLevel = null, suppressAutoplay = false, allowDuplicate = false, openedByLink = false } = {}) {
    // #252 — un indirizzo solo per ogni pagina interna: la forma che produce lo
    // shim torna a quella canonica del menu, o la deduplica non riconoscerebbe
    // che sono la stessa pagina.
    if (typeof url === 'string' && url.startsWith('filo://')) url = canonicalizeFiloUrl(url);

    // #252 — solo per le aperture in primo piano volute dall'utente: chi chiede
    // una copia (Duplica) o apre in sottofondo vuole una scheda vera.
    if (activate && !allowDuplicate) {
      const key = filoSingletonKey(url);
      if (key) {
        const existing = this.tabs.find((t) => filoSingletonKey(t.url) === key);
        if (existing) {
          // Se differisce per query o hash si rinaviga la scheda esistente:
          // quel ?highlight è l'intento di chi ha cliccato.
          if (existing.url !== url) this.navigate(existing.id, url);
          this.activate(existing.id);
          return existing.id;
        }
      }
    }
    // SICUREZZA (#247) — un loadURL programmatico NON emette will-navigate,
    // quindi quella guardia qui non protegge niente. Qui convergono TUTTI gli
    // handler IPC che aprono una scheda: un controllo solo chiude ogni percorso
    // presente e futuro, invece di ripeterlo in ogni chiamante e dimenticarne
    // uno. Se tocchi questo blocco, il cammino IPC → openTab(file://) deve
    // restare bloccato: si è già perso una volta in un merge.
    if (isWebUnsafeNav(url)) {
      openExternalScheme(url); // mailto:/tel:/sms: → consegnati all'OS, il resto bloccato
      return null;
    }
    const id = randomUUID();
    const isInternal = url.startsWith('filo://');
    const partition = this._partitionFor(url);
    const view = this._makeView(url, partition, { suppressAutoplay });

    const tab = {
      id,
      view,
      title: 'Nuova scheda',
      url,
      favicon: '',
      loading: true,
      canBack: false,
      canFwd: false,
      muted: false,
      isInternal,
      openedAt: new Date().toISOString(),
      // §2.1 segnali per la decisione di auto-archiviazione (popolati a runtime).
      lastActiveAt: activate ? Date.now() : null,
      lastInteractionAt: activate ? Date.now() : null,
      audible: false,
      scrollPct: 0,
      formDirty: false,
      // §3.1 — scroll da ripristinare (percentuale), applicato una volta a fine
      // caricamento.
      restoreScrollPct: typeof restoreScrollPct === 'number' ? restoreScrollPct : null,
      // Zoom da ripristinare in una copia (0 = 100%), una volta a fine carico.
      restoreZoomLevel: typeof restoreZoomLevel === 'number' ? restoreZoomLevel : null,
      partition,
      partitionSite: isInternal ? null : Cookies.registrableOf(url),
      proxy: null,
      // #145 — sta sulla scheda, non sulla vista, così sopravvive a una
      // ricreazione (una scheda proxata alla nascita la subisce subito).
      suppressAutoplay: !!suppressAutoplay,
      // #441 — nata da un link target=_blank, non da un indirizzo dell'utente:
      // è la prima condizione per riconoscerla come pagina-ponte di un download.
      _openedByLink: !!openedByLink,
    };

    this._wireEvents(tab);
    this._applySecurity(tab);
    this.win.contentView.addChildView(view);
    this.tabs.push(tab);

    // setBounds PRIMA di loadURL: con dimensione 0x0 il compositor non alloca
    // un display surface valido e le capturePage successive falliscono.
    if (activate) {
      this.activeId = id;
      tab.activateSeq = this._nextActivationSeq();
      this.layout();
    } else {
      // #376 — senza questo layout la vista nuova tiene i bounds di default e
      // si disegna sopra la scheda attiva. NON si chiama setVisible(false): per
      // Chromium la scheda resta visibile (grande 0×0) e può far partire i
      // media, che è il senso di aprire una radio in sottofondo.
      this.layout();
    }
    view.webContents.loadURL(url);
    if (activate) {
      for (const t of this.tabs) t.view.setVisible?.(t.id === id);
    }
    // #152 — con una regola sul dominio la scheda nasce già instradata.
    this._maybeApplyDomainRule(tab, url);
    this._broadcast();
    return id;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    // #514 — chiudendo la scheda che aveva chiesto lo schermo pieno, la deroga
    // dell'Esc resterebbe appesa a una pagina che non c'è più e nessun tasto ne
    // uscirebbe: la modalità se ne va con lei.
    if (this.pageFullscreenTabId === id) {
      this.pageFullscreen = false;
      this.pageFullscreenTabId = null;
      this.setContentFullscreen(false);
    }
    // Un'attesa rivolta a questa scheda non ha più nessuno che risponda.
    this.annullaUscitaSchermoIntero();
    // §3.1/§4 — chiudere è archiviare: i metadati si salvano PRIMA di
    // distruggere la vista, o non c'è più niente da leggere.
    this._archiveClosedTab(tab);
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      // Si torna alla PENULTIMA scheda guardata, non a quella a sinistra: è
      // quella che l'utente si aspetta. Se nessuna è mai stata attivata (tutte
      // aperte in sottofondo) vale l'adiacente.
      const next = this._mostRecentlyActiveTab() || this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/'); // niente tab → nuovo newtab
    }
    this._broadcast();
  }

  // Contatore crescente invece di Date.now(): due attivazioni possono cadere
  // nello stesso millisecondo, e l'ordine deve restare deciso.
  _nextActivationSeq() {
    this._activationSeq = (this._activationSeq || 0) + 1;
    return this._activationSeq;
  }

  _mostRecentlyActiveTab() {
    let best = null;
    for (const t of this.tabs) {
      if (!t.activateSeq) continue;
      if (!best || t.activateSeq > best.activateSeq) best = t;
    }
    return best;
  }

  // #185 — la chat di Filo vive in una scheda interna, quindi "la scheda su cui
  // agire" non può essere l'attiva: se l'attiva è interna si prende l'ultima
  // pagina web guardata.
  _activeWebTab() {
    const active = this.tabs.find((t) => t.id === this.activeId);
    if (active && !active.isInternal) return active;
    let best = null;
    for (const t of this.tabs) {
      if (t.isInternal || !t.activateSeq) continue;
      if (!best || t.activateSeq > best.activateSeq) best = t;
    }
    return best;
  }

  // Il CSS arriva già sanificato da monte. insertCSS ignora la CSP del sito, e
  // le chiavi restano sulla scheda per poter tornare indietro; una navigazione
  // lo azzera da sé.
  async applyPageStyle(css, tabArg = null) {
    if (!css || typeof css !== 'string') return { ok: false, reason: 'empty-css' };
    const tab = tabArg || this._activeWebTab();
    if (!tab || !tab.view || !tab.view.webContents) return { ok: false, reason: 'no-web-tab' };
    try {
      // La Promise va ATTESA: senza, si memorizzerebbe la promessa al posto
      // della chiave e il ripristino non troverebbe niente da togliere.
      const key = await tab.view.webContents.insertCSS(css);
      (tab._filoStyleKeys || (tab._filoStyleKeys = [])).push(key);
      return { ok: true, key, tabId: tab.id };
    } catch (e) {
      console.warn('[Filo] applyPageStyle fallita', e?.message || e);
      return { ok: false, reason: 'insert-failed' };
    }
  }

  // #185 — se si può cambiare lo stile si deve poter tornare indietro.
  async clearPageStyle(tabArg = null) {
    const tab = tabArg || this._activeWebTab();
    if (!tab || !tab.view || !tab.view.webContents) return { ok: false, reason: 'no-web-tab' };
    const keys = tab._filoStyleKeys || [];
    let removed = 0;
    for (const k of keys) {
      try { await tab.view.webContents.removeInsertedCSS(k); removed += 1; } catch (_) { /* chiave stale dopo reload */ }
    }
    tab._filoStyleKeys = [];
    return { ok: true, removed };
  }

  // L'ordine non tocca il layout delle viste native: conta solo per lo snapshot
  // e per la sessione salvata. Ritorna true se è cambiato.
  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return false;
    let to = Math.round(Number(toIndex));
    if (!Number.isFinite(to)) return false;
    to = Math.max(0, Math.min(this.tabs.length - 1, to));
    if (from === to) return false;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this._broadcast();
    return true;
  }

  // Resta una scheda vuota: la finestra non si chiude da sé.
  closeAllTabs() {
    for (const tab of this.tabs) {
      this._archiveClosedTab(tab); // §3.1 — anche "chiudi tutto" archivia
      ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
      try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
      try { tab.view.webContents.close(); } catch (_) {}
    }
    this.tabs = [];
    this.activeId = null;
    this.openTab('filo://newtab/');
  }

  // §3.1 — non bloccante: la chiusura non aspetta l'archivio. NON archivia
  // incognito (§5), pagine interne e nuova scheda: non sono cose da ritrovare.
  _archiveClosedTab(tab, reason = 'manual') {
    try {
      if (!tab || this.incognito) return;
      const Archive = globalThis.SN_ARCHIVED_TABS;
      if (!Archive) return;
      const url = tab.url || '';
      if (!url || tab.isInternal || url.startsWith('filo://')) return;
      if (!/^https?:\/\//i.test(url)) return;
      const coOpenUrls = this.tabs
        .filter((t) => t.id !== tab.id && t.url && /^https?:\/\//i.test(t.url))
        .map((t) => t.url);
      const enrichPayload = { title: tab.title || '', content: tab.contentExtract || '' };
      Promise.resolve(
        Archive.archive({
          url,
          title: tab.title || url,
          favicon: tab.favicon || '',
          identityColor: tab.identityColor || null,
          openedAt: tab.openedAt || null,
          closedAt: new Date().toISOString(),
          reason: reason || 'manual',
          coOpenUrls,
          scrollPosition: typeof tab.scrollPct === 'number' ? tab.scrollPct : null,
          // La location si salva, o riaprendo dall'archivio la scheda
          // rinascerebbe diretta invece che dal paese scelto.
          proxy: tab.proxy && tab.proxy.country
            ? { country: tab.proxy.country, tier: tab.proxy.tier || null }
            : null,
        }),
      ).then((entry) => {
        // §3.1/§3.2 — in sottofondo: la chiusura non deve aspettare un LLM.
        if (entry && entry.id) {
          try { globalThis.SN_TAB_ENRICH && globalThis.SN_TAB_ENRICH(entry.id, enrichPayload); } catch (_) {}
        }
      }).catch(() => {});
    } catch (_) { /* l'archiviazione non deve mai bloccare la chiusura */ }
  }

  // Lo stato vive sulla SCHEDA, non sul WebContents: deve sopravvivere a una
  // ricreazione della vista.
  setMuted(id, muted) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.muted = !!muted;
    try { tab.view.webContents.setAudioMuted(tab.muted); } catch (_) {}
    this._broadcast();
  }

  toggleMute(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.setMuted(id, !tab.muted);
  }

  // "Apri da un altro paese" (proxy-per-tab-spec.md). La scheda si ricrea nella
  // partizione proxy:<tabId>, con i suoi cookie separati, e ci resta finché
  // vive. `tier` è 'datacenter' (default) o 'residential'.
  async setTabProxy(id, country, { tier } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return { ok: false, error: 'no_tab' };
    let settings = null;
    try { settings = await this._readSettings(); } catch (_) {}
    // Senza paese vale l'ultima location usata. Un paese esplicito ma non
    // valido è un ERRORE: mai instradare in silenzio verso un altro.
    const p = (settings && settings.proxy) || {};
    const code = country
      ? ProxyTab.normalizeCountry(country)
      : (ProxyTab.normalizeCountry(p.lastCountry) || ProxyTab.normalizeCountry(p.defaultCountry) || 'us');
    if (!code) return { ok: false, error: 'bad_country' };
    const resolved = ProxyTab.resolve(code, { tier, settings });
    if (!resolved) return { ok: false, error: 'not_configured' };
    const partition = `proxy:${tab.id}`;
    // Sessione effimera (niente 'persist:'). setProxy va ATTESO prima di creare
    // la vista, o le prime richieste partono dirette.
    const ses = session.fromPartition(partition);
    try {
      await ses.setProxy({
        proxyRules: resolved.proxyRules,
        ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
      });
    } catch (e) {
      return { ok: false, error: 'proxy_failed' };
    }
    ProxyTab.setPartitionAuth(partition, ses, resolved.auth);
    tab.proxy = { country: code, tier: resolved.tier };
    // La ricreazione applica anche l'anti-leak WebRTC. Vale pure per il cambio
    // paese: stessa partizione, proxy aggiornato, ricarica dal nuovo endpoint.
    this._recreateView(tab, tab.url || 'filo://newtab/');
    try { globalThis.SN_STORAGE?.updateSettings?.({ proxy: { lastCountry: code } }); } catch (_) {}
    return { ok: true, country: code, tier: resolved.tier };
  }

  clearTabProxy(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return { ok: false, error: 'no_tab' };
    if (!tab.proxy) return { ok: true };
    tab.proxy = null;
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    this._recreateView(tab, tab.url || 'filo://newtab/');
    return { ok: true };
  }

  // #152 — ritorna quante schede ha riportato in diretta.
  clearAllProxies() {
    let n = 0;
    for (const t of this.tabs) {
      if (t.proxy) { this.clearTabProxy(t.id); n += 1; }
    }
    return n;
  }

  // In caso d'errore si tiene la copia precedente: meglio regole vecchie che
  // nessuna regola.
  async loadProxyRules() {
    try {
      const FM = globalThis.SN_FILO_MEMORY;
      this._proxyRules = (FM && (await FM.listProxyRules())) || {};
    } catch (_) {
      this._proxyRules = this._proxyRules || {};
    }
    return this._proxyRules;
  }

  // SINCRONO: lo chiama will-navigate, dove non si può attendere lo storage.
  _ruleForUrl(url) {
    if (!url || url.startsWith('filo://') || !/^https?:\/\//i.test(url)) return null;
    const dom = Cookies.registrableOf(url);
    return (dom && this._proxyRules && this._proxyRules[dom]) || null;
  }

  // NON blocca la navigazione: senza un fornitore configurato non fa niente e
  // la pagina resta diretta — mai una scheda appesa per un proxy che non c'è.
  // Incognito escluso (§6: niente persistenza).
  _maybeApplyDomainRule(tab, url) {
    if (!tab || this.incognito) return false;
    const rule = this._ruleForUrl(url);
    if (!rule || !rule.country) return false;
    const code = ProxyTab.normalizeCountry(rule.country);
    if (!code) return false;
    if (tab.proxy && tab.proxy.country === code) return false; // già a posto
    tab.url = url; // setTabProxy ricrea la view su tab.url attraverso l'endpoint
    this.setTabProxy(tab.id, code, { tier: rule.tier || undefined }).catch(() => {});
    return true;
  }

  // `domain` si riduce al dominio registrabile, la STESSA chiave che usa il
  // confronto in navigazione: con un'altra la regola non scatterebbe mai.
  async setDomainProxyRule(country, { domain } = {}) {
    const code = ProxyTab.normalizeCountry(country);
    if (!code) return { ok: false, error: 'bad_country' };
    const src = String(domain || '');
    const dom = src ? Cookies.registrableOf(/:\/\//.test(src) ? src : `https://${src}`) : null;
    if (!dom) return { ok: false, error: 'no_domain' };
    const FM = globalThis.SN_FILO_MEMORY;
    if (FM) await FM.setProxyRule(dom, { country: code });
    await this.loadProxyRules();
    // Subito anche alle schede già aperte: una regola che vale solo la prossima
    // volta sembra non aver funzionato.
    for (const t of this.tabs) {
      if (t.isInternal || !/^https?:\/\//i.test(t.url || '')) continue;
      if (Cookies.registrableOf(t.url) !== dom) continue;
      if (t.proxy && t.proxy.country === code) continue;
      try { await this.setTabProxy(t.id, code); } catch (_) {}
    }
    return { ok: true, domain: dom, country: code };
  }

  // Non tocca le schede già instradate: toglie solo l'automatismo futuro.
  async removeDomainProxyRule({ domain } = {}) {
    const src = String(domain || '');
    const dom = src ? Cookies.registrableOf(/:\/\//.test(src) ? src : `https://${src}`) : null;
    if (!dom) return { ok: false, error: 'no_domain' };
    const FM = globalThis.SN_FILO_MEMORY;
    if (FM) await FM.removeProxyRule(dom);
    await this.loadProxyRules();
    return { ok: true, domain: dom };
  }


  async _readSettings() {
    try { return await globalThis.SN_STORAGE?.getSettings?.(); } catch (_) { return null; }
  }

  async _autoArchiveTick() {
    if (this.incognito || this._triageRunning) return;
    const s = await this._readSettings();
    const aa = s && s.autoArchive;
    if (!aa || !aa.enabled || !aa.onIdle) return;
    const hours = Number(aa.idleHours) > 0 ? Number(aa.idleHours) : 6;
    if (Date.now() - this._lastAppInteractionAt < hours * 3600 * 1000) return;
    await this.runAutoTriage({ trigger: 'idle' });
    // Senza questo il giro ripartirebbe subito, all'infinito.
    this._lastAppInteractionAt = Date.now();
  }

  // Archiviabili: schede web e pagine interne EFFIMERE (home, impostazioni),
  // purché non attive e senza audio. Escludere tutte le filo:// significava
  // chiudere YouTube ma mai le impostazioni aperte o le home doppie.
  _triageCandidates() {
    const T = globalThis.SN_TAB_TRIAGE;
    return this.tabs.filter((t) => {
      if (t.id === this.activeId || t.audible) return false;
      if (T) return T.isTriageableUrl(t.url);
      return !t.isInternal && /^https?:\/\//i.test(t.url || '');
    });
  }

  async _gatherTriageInput(cands) {
    const now = Date.now();
    const out = [];
    for (const t of cands) {
      let contentExtract = '';
      try {
        contentExtract = await t.view.webContents.executeJavaScript(
          '(function(){try{return (document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,800);}catch(e){return "";}})()',
          true,
        );
      } catch (_) {}
      out.push({
        url: t.url,
        title: t.title,
        ageMin: t.openedAt ? Math.round((now - new Date(t.openedAt).getTime()) / 60000) : null,
        idleMin: t.lastInteractionAt ? Math.round((now - t.lastInteractionAt) / 60000) : null,
        scrollPct: typeof t.scrollPct === 'number' ? t.scrollPct : null,
        formDirty: !!t.formDirty,
        audible: !!t.audible,
        coOpenUrls: this.tabs
          .filter((x) => x.id !== t.id && /^https?:\/\//i.test(x.url || ''))
          .map((x) => x.url).slice(0, 20),
        contentExtract,
      });
    }
    return out;
  }

  // I DUPLICATI esatti si chiudono per regola, mai chiedendolo all'LLM: è una
  // decisione che non ha bisogno di giudizio, e deve funzionare anche senza
  // modello. All'LLM restano i casi di giudizio (un feed già letto).
  async runAutoTriage({ trigger = 'idle' } = {}) {
    if (this.incognito || this._triageRunning) return { archived: 0 };
    const cands = this._triageCandidates();
    if (!cands.length) return { archived: 0 };
    this._triageRunning = true;
    try {
      const T = globalThis.SN_TAB_TRIAGE;
      let dupIdx = new Set();
      if (T) {
        const activeUrl = (this.tabs.find((t) => t.id === this.activeId) || {}).url || '';
        dupIdx = T.findDuplicateIndices(
          cands.map((t) => ({
            url: t.url,
            formDirty: !!t.formDirty,
            lastInteractionAt: t.lastInteractionAt || 0,
          })),
          activeUrl,
        );
      }

      const decide = globalThis.SN_TAB_TRIAGE_DECIDE;
      let decisions = [];
      if (typeof decide === 'function') {
        try {
          const input = await this._gatherTriageInput(cands);
          const r = await decide({ tabs: input, trigger });
          decisions = Array.isArray(r && r.decisions) ? r.decisions : [];
        } catch (_) { decisions = []; }
      }

      // I duplicati vincono sempre su un "tieni" dell'LLM.
      const byIndex = new Map();
      for (const d of decisions) {
        if (d && typeof d.i === 'number') byIndex.set(d.i, d);
      }
      for (const i of dupIdx) {
        byIndex.set(i, { i, action: 'archive', reason: 'duplicato' });
      }
      return this.applyTriageDecisions(cands, [...byIndex.values()]);
    } finally {
      this._triageRunning = false;
    }
  }

  // Mai la scheda attiva né una con audio, qualunque cosa dica l'LLM: è la
  // salvaguardia. `cands` è l'elenco indicizzato che gli era stato passato.
  applyTriageDecisions(cands, decisions) {
    const byIndex = new Map();
    for (const d of (decisions || [])) {
      if (d && typeof d.i === 'number') byIndex.set(d.i, d);
    }
    const toArchive = [];
    cands.forEach((tab, i) => {
      const d = byIndex.get(i);
      if (!d || d.action !== 'archive') return;
      if (tab.id === this.activeId || tab.audible) return; // salvaguardia dura
      toArchive.push({ tab, reason: d.reason || 'auto' });
    });

    for (const { tab, reason } of toArchive) {
      this._archiveClosedTab(tab, reason);
      ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
      const idx = this.tabs.findIndex((t) => t.id === tab.id);
      if (idx >= 0) {
        try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
        try { tab.view.webContents.close(); } catch (_) {}
        this.tabs.splice(idx, 1);
      }
    }

    if (!this.tabs.length) this.openTab('filo://newtab/');
    else if (!this.tabs.some((t) => t.id === this.activeId)) this.activate(this.tabs[0].id);

    // §1.3 — a OGNI giro, non solo quando si è archiviato qualcosa: all'apertura
    // la barra dev'essere riordinata comunque.
    const reordered = this.reorderTabsByColor();
    if (toArchive.length || reordered) this._broadcast();
    if (toArchive.length) this._showTriageToast(toArchive.length);
    return { archived: toArchive.length };
  }

  // §1.3 — le schede senza colore restano in coda nel loro ordine. Ritorna true
  // solo se l'ordine è cambiato davvero.
  reorderTabsByColor() {
    const before = this.tabs;
    const withIdx = before.map((t, i) => ({ t, i }));
    withIdx.sort((a, b) => {
      const ha = hueOf(a.t.identityColor);
      const hb = hueOf(b.t.identityColor);
      if (ha !== hb) return ha - hb;
      return a.i - b.i; // stabile
    });
    const next = withIdx.map((x) => x.t);
    const changed = next.some((t, i) => t !== before[i]);
    this.tabs = next;
    return changed;
  }

  // Riordino chiesto a mano: come §1.3 ma senza chiudere NIENTE. Ritorna
  // { reordered } così la dashboard può dire cos'è successo.
  reorderTabs() {
    const reordered = this.reorderTabsByColor();
    if (reordered) this._broadcast();
    return { reordered };
  }

  _showTriageToast(_n) {
    try {
      this.win.webContents.send('shell:toast', {
        text: 'Tab riordinate e salvate in cronologia',
      });
    } catch (_) {}
  }

  // §1.1 — solo se cambia davvero: i campioni arrivano di continuo durante lo
  // scroll e ridisegnerebbero la barra ogni volta.
  setTabColor(id, color) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const next = color || null;
    if (tab.color === next) return;
    tab.color = next;
    this._broadcast();
  }

  // §1.2 — a differenza del colore campionato (§1.1) NON cambia con lo scroll
  // né si azzera a ogni navigazione: vale finché la scheda resta sul dominio,
  // e si calcola una volta sola per dominio.
  setTabIdentityColor(id, color) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const next = color || null;
    const host = hostOf(tab.url);
    if (next && host) this._identityColorCache.set(host, next);
    if (tab.identityColor === next) return;
    tab.identityColor = next;
    this._broadcast();
  }

  // Copia anche zoom e scroll, non solo l'URL: "duplica" deve dare una scheda
  // uguale a com'era. Ritorna l'id della nuova, o null.
  async duplicateTab(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return null;
    let zoomLevel = null;
    try { zoomLevel = tab.view.webContents.getZoomLevel(); } catch (_) {}
    // Si chiede la posizione ESATTA alla pagina: il valore già tracciato è
    // arrotondato, e serve solo come ripiego se non risponde.
    let scrollPct = typeof tab.scrollPct === 'number' ? tab.scrollPct : null;
    try {
      const exact = await tab.view.webContents.executeJavaScript(
        '(()=>{try{const d=document.documentElement;const max=(d.scrollHeight||0)-window.innerHeight;return max>0?Math.max(0,Math.min(100,(window.scrollY||d.scrollTop||0)/max*100)):0;}catch(e){return null;}})()',
        true,
      );
      if (typeof exact === 'number') scrollPct = exact;
    } catch (_) {}
    return this.openTab(tab.url || 'filo://newtab/', {
      activate: true,
      restoreScrollPct: scrollPct,
      restoreZoomLevel: zoomLevel,
      // #252 — qui la deduplica va saltata: chi duplica vuole una copia, non un
      // ritorno all'originale.
      allowDuplicate: true,
    });
  }

  // Apre l'assistente SU quella scheda, col contesto di dove è stato chiamato.
  // Passa dallo stesso canale delle scorciatoie: una strada sola, che vale
  // anche sulle pagine interne.
  openHelp(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (this.activeId !== id) this.activate(id);
    try {
      tab.view.webContents.send('shortcut:triggered', {
        command: 'open-help-sidebar',
        context: { source: 'tab', url: tab.url, title: tab.title },
      });
    } catch (_) {}
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    // §2.1 — una scheda che diventa attiva è "usata adesso". Approssimazione
    // grossolana: il content script la raffina con gli eventi veri.
    const now = Date.now();
    tab.lastActiveAt = now;
    tab.lastInteractionAt = now;
    tab.activateSeq = this._nextActivationSeq(); // ordine MRU per la chiusura tab
    this._lastAppInteractionAt = now; // attivare una tab = usare Filo (§2.1)
    for (const t of this.tabs) {
      t.view.setVisible?.(t.id === id);
    }
    this.layout();
    this._broadcast();
  }

  // §2.1 — segnali di attività dal content script (input, scroll, modulo
  // sporco). Già limitati lato pagina; qui non si rimbalza se nulla cambia.
  setTabActivity(id, activity) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !activity || typeof activity !== 'object') return;
    // §2.1 — attività in una scheda qualsiasi vuol dire "Filo è in uso".
    this._lastAppInteractionAt = Date.now();
    let changed = false;
    if (typeof activity.lastInteractionAt === 'number') {
      tab.lastInteractionAt = activity.lastInteractionAt; changed = true;
    }
    if (typeof activity.scrollPct === 'number') {
      const v = Math.max(0, Math.min(100, Math.round(activity.scrollPct)));
      if (v !== tab.scrollPct) { tab.scrollPct = v; changed = true; }
    }
    if (typeof activity.formDirty === 'boolean') {
      if (activity.formDirty !== tab.formDirty) { tab.formDirty = activity.formDirty; changed = true; }
    }
    if (changed) this._broadcast();
  }

  navigate(id, url) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const target = normalizeUrl(url);
    // SICUREZZA (#248) — come openTab: questo è un loadURL() PROGRAMMATICO, non
    // emette will-navigate, quindi quel gate non protegge questo percorso.
    // Qui convergono TUTTI gli handler IPC che rinavigano una scheda esistente
    // (tabs:navigate dalla shell, e qualunque chiamante futuro): un controllo
    // unico blocca gli schemi non-web (file:// → leak hash NTLM via SMB su
    // Windows + esposizione file locali; data:/javascript: → phishing/script)
    // prima che loadURL() possa toccarli. mailto:/tel:/sms: vengono consegnati
    // all'OS invece di caricare una scheda, come nel gate di will-navigate.
    if (isWebUnsafeNav(target)) {
      openExternalScheme(target);
      return;
    }
    // Preload e contextIsolation sono fissati alla CREAZIONE della vista: un
    // loadURL non li rivaluta, quindi cambiare partizione o attraversare il
    // confine interno/esterno impone di ricrearla.
    if (this._needsRecreate(tab, target)) {
      this._recreateView(tab, target);
    } else {
      tab.view.webContents.loadURL(target);
    }
    // #152 — DOPO il caricamento normale, mai prima: senza fornitore resta la
    // connessione diretta già caricata, invece di una scheda appesa.
    this._maybeApplyDomainRule(tab, target);
  }

  _needsRepartition(tab, url) {
    const next = this._partitionForTab(tab, url);
    return (next || null) !== (tab.partition || null);
  }

  // Il confine di FIDUCIA: una pagina filo:// nasce col preload privilegiato,
  // un sito esterno con quello isolato, e il preload non cambia con un loadURL.
  // Navigare da interno a esterno sullo stesso WebContents farebbe girare
  // contenuto non fidato con accesso a chiavi e dati.
  _crossesTrustBoundary(tab, url) {
    const nextInternal = String(url || '').startsWith('filo://');
    return nextInternal !== !!tab.isInternal;
  }

  _needsRecreate(tab, url) {
    return this._crossesTrustBoundary(tab, url) || this._needsRepartition(tab, url);
  }

  // Ricrea la vista tenendo id, posizione e stato attivo. La cronologia
  // avanti/indietro è per-WebContents, quindi attraversare un confine di sito
  // in privacy riparte pulita: è il prezzo dell'isolamento.
  // `opts.loadUrl` (#327) carica qualcosa di diverso da `url` lasciando la
  // vista configurata per `url`: serve a mostrare la pagina d'errore in una
  // vista già pronta a ritentare il sito.
  _recreateView(tab, url, opts = {}) {
    const wasActive = tab.id === this.activeId;
    const partition = this._partitionForTab(tab, url);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    const view = this._makeView(url, partition, { suppressAutoplay: tab.suppressAutoplay });
    tab.view = view;
    tab.partition = partition;
    tab.isInternal = url.startsWith('filo://');
    tab.partitionSite = tab.isInternal ? null : Cookies.registrableOf(url);
    this._wireEvents(tab);
    this._applySecurity(tab);
    // Il silenzio è una scelta dell'utente sulla SCHEDA: la vista nuova nasce
    // con l'audio acceso e va rimessa com'era.
    try { view.webContents.setAudioMuted(!!tab.muted); } catch (_) {}
    this.win.contentView.addChildView(view);
    if (wasActive) this.activeId = tab.id;
    // Anche ricreando una scheda NON attiva: senza layout la vista nuova tiene
    // i bounds di default e si disegna sopra quella attiva.
    this.layout();
    view.webContents.loadURL(opts.loadUrl || url);
    for (const t of this.tabs) t.view.setVisible?.(t.id === this.activeId);
    this._broadcast();
  }

  goBack(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.view.webContents.navigationHistory?.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    } else if (tab.view.webContents.canGoBack?.()) {
      tab.view.webContents.goBack();
    }
  }

  goForward(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.view.webContents.navigationHistory?.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    } else if (tab.view.webContents.canGoForward?.()) {
      tab.view.webContents.goForward();
    }
  }

  reload(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    // #327 — ricaricare una pagina d'errore deve RITENTARE il sito, come il
    // bottone "Riprova": due strade per la stessa cosa fanno la stessa cosa.
    const NE = globalThis.SN_NET_ERROR;
    let current = '';
    try { current = tab.view.webContents.getURL() || ''; } catch (_) {}
    const target = NE && NE.targetOf(current);
    if (target) {
      try { tab.view.webContents.loadURL(target); } catch (_) {}
      return;
    }
    tab.view.webContents.reload();
  }

  // Le WebContentsView native si compongono SEMPRE sopra l'HTML della shell e
  // ignorano lo z-index: un pannello che sborda nell'area pagina finirebbe
  // sotto, quindi la vista si nasconde.
  setActiveVisible(visible) {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (tab) tab.view.setVisible?.(visible);
  }


  layout() {
    const [w, h] = this.win.getContentSize();
    for (const tab of this.tabs) {
      if (tab.id === this.activeId) {
        // Altezza di chrome riservata in alto: 0 a tutto schermo, solo la fila
        // di tab se in chrome compatto (barra indirizzi nascosta), altrimenti
        // l'intera shell. A questo si somma l'eventuale topInset dei dropdown.
        const chrome = this.contentFullscreen
          ? 0
          : ((this.chromeCompact ? this.tabRowHeight : this.shellHeight) + this.topInset);
        const top = chrome;
        const b = { x: 0, y: top, width: w, height: Math.max(0, h - top) };
        tab.view.setBounds(b);
        if (process.env.FILO_SMOKE) {
          console.log(`[layout] tab ${tab.id.slice(0, 6)} active bounds`, JSON.stringify(b), 'win', w, 'x', h);
        }
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
  }

  // ─── zoom da tastiera quando il focus è sulla barra di Filo ────────────
  // Ctrl +/-/0 li gestisce il preload della pagina (wheel-zoom.js), ma quel
  // keydown esiste solo se è la PAGINA ad avere il focus. Appena l'utente
  // clicca una scheda il focus passa alla barra, i tasti arrivano qui e lo
  // zoom sembrava morto — stessa asimmetria già vista con Ctrl+T/W/L/R (#404).
  // Li intercettiamo sulla webContents della shell e li inoltriamo alla scheda
  // attiva, che li fa rientrare dal solito punto: così la scelta su chi zooma
  // (e l'opt-out dell'editor, che scala il foglio) resta una sola.
  _wireShellZoomKeys() {
    const shellWc = this.win && this.win.webContents;
    if (!shellWc || typeof shellWc.on !== 'function') return;
    shellWc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!(input.control || input.meta) || input.alt) return;
      const k = String(input.key || '');
      const c = String(input.code || '');
      let dir = null;
      if (k === '+' || k === '=' || c === 'NumpadAdd') dir = 'in';
      else if (k === '-' || k === '_' || c === 'NumpadSubtract') dir = 'out';
      else if (k === '0' || c === 'Numpad0') dir = 'reset';
      if (!dir) return;
      event.preventDefault();
      const active = this.tabs.find((t) => t.id === this.activeId);
      if (!active) return;
      try { active.view.webContents.send('filo:zoom-key', dir); } catch (_) {}
    });
  }

  // ─── eventi della WebContents → aggiorna stato + broadcast ─────────────

  _wireEvents(tab) {
    const wc = tab.view.webContents;
    const update = (patch) => {
      Object.assign(tab, patch);
      this._broadcast();
    };
    // In modalità "contenuto a tutto schermo" la pagina copre la barra, quindi
    // Esc deve riportare la shell. Intercettiamo il tasto prima che la pagina lo
    // gestisca (vale anche per i siti esterni, senza dipendere dai content script).
    // Fullscreen richiesto dalla pagina (pulsante "schermo intero" di un player
    // video, requestFullscreen()): Electron emette enter/leave-html-full-screen.
    // Senza questi handler la view restava confinata sotto la barra e il video
    // non copriva davvero lo schermo. Riusiamo la stessa modalità del menu
    // (view a tutta finestra + fullscreen OS), marcandola come page-initiated.
    // Qui la richiesta è già passata: chi non doveva ottenerla si ferma prima,
    // nel gestore dei permessi della sessione (#514, `installaPermessi`). Non
    // si rifiuta da qui perché quando questo evento arriva la finestra è già a
    // tutto schermo e la modalità è già stata adottata.
    wc.on('enter-html-full-screen', () => {
      this.pageFullscreen = true;
      this.pageFullscreenTabId = tab.id;
      this.setContentFullscreen(true);
    });
    wc.on('leave-html-full-screen', () => {
      // Solo la scheda che il fullscreen l'aveva davvero chiesto spegne la
      // modalità: l'uscita di una pagina a cui l'abbiamo appena rifiutato non
      // deve portare via lo schermo intero che l'utente aveva acceso lui.
      if (!this.pageFullscreen || this.pageFullscreenTabId !== tab.id) return;
      this.pageFullscreen = false;
      this.pageFullscreenTabId = null;
      this.setContentFullscreen(false);
    });
    wc.on('before-input-event', (event, input) => {
      // #514 — l'ultimo tasto era l'Esc? Serve a `enter-html-full-screen`, che
      // da un Esc non fa passare nessuna richiesta di schermo pieno. Qui,
      // perché questo evento arriva PRIMA che il documento veda il tasto, ed è
      // dentro quel giro che la pagina chiede.
      tab._ultimoInputEsc = String(input.key || '') === 'Escape' || String(input.code || '') === 'Escape';
      if (input.type === 'keyDown' && input.key === 'Escape') {
        // Regola unica in tabs.js: handleFullscreenEscape decide (e sa quando
        // l'Esc va invece lasciato alla pagina che ha chiesto il fullscreen).
        if (this.handleFullscreenEscape(tab.id)) {
          event.preventDefault();
          return;
        }
      }
      // Salto alla N-esima scheda: Alt+cifra su Windows/Linux, Cmd+cifra su
      // Mac (lì Opzione+cifra scrive un simbolo, e prendercela impediva di
      // digitarlo). Quale combinazione sia, e come si chiama nell'elenco delle
      // scorciatoie, lo decide un posto solo: src/shared/tasti.js.
      // Intercettiamo qui (per-webContents) invece che con un globalShortcut
      // OS-wide, così la combinazione resta disponibile alle altre app.
      if (input.type === 'keyDown') {
        // Il numero di schede serve alla regola: su Mac la cifra 9 è "l'ultima
        // scheda", perché lo 0 lì è lo zoom e non può essere anche la decima.
        const idx = indiceSaltoScheda(input, undefined, this.tabs.length);
        if (idx != null) {
          const target = this.tabs[idx];
          if (target) {
            event.preventDefault();
            this.activate(target.id);
          }
        }
      }
      // #404 — Ctrl/Cmd+T/W/L/R "da browser". La shell (src/renderer/shell.js)
      // le gestisce nel keydown della barra, ma quel keydown NON riceve eventi
      // quando il focus è dentro una pagina (WebContentsView): risultato, le
      // scorciatoie erano morte proprio mentre si naviga un sito — il caso più
      // comune. Come per il salto di scheda qui sopra, le intercettiamo per-webContents
      // così valgono anche dalle pagine. In un browser questi tasti sono
      // riservati alla shell e vincono SEMPRE sulla pagina: preventDefault li
      // toglie al contenuto (niente doppio reload su Ctrl+R, ecc.). Escludiamo
      // Alt per non catturare AltGr (Ctrl+Alt su Windows), che sui layout
      // europei serve a digitare caratteri mentre si scrive nella pagina.
      // `tab` è la scheda che ha il focus (quella che riceve l'input) = quella
      // che l'utente sta guardando, quindi è la "scheda corrente" su cui agire.
      if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt) {
        const k = String(input.key || '').toLowerCase();
        if (k === 't') { event.preventDefault(); this.openTab('filo://newtab/'); return; }
        if (k === 'w') { event.preventDefault(); this.closeTab(tab.id); return; }
        // L'indirizzo si digita dalla home (la barra indirizzi è stata tolta):
        // Ctrl+L apre la home di Filo, esattamente come nella shell.
        if (k === 'l') { event.preventDefault(); this.navigate(tab.id, 'filo://newtab/'); return; }
        if (k === 'r') { event.preventDefault(); this.reload(tab.id); return; }
      }
    });
    // Navigazione main-frame iniziata dalla pagina (click su link,
    // window.location). Due casi richiedono di RICREARE la view invece di
    // lasciarla navigare in-place, perché preload/partizione sono fissati alla
    // creazione del WebContents:
    //   1) SICUREZZA — confine di fiducia interno↔esterno: una pagina interna
    //      che naviga verso il web (o viceversa) non deve riusare il preload
    //      privilegiato. Ricreiamo con il preload corretto per la destinazione.
    //   2) Privacy — sito diverso in modalità privacy: serve un'altra partizione.
    // Best-effort: i redirect lato server a metà caricamento possono sfuggire a
    // will-navigate; la rete di sicurezza è il gate d'origine in
    // internal-preload.js, che non espone le API se l'origine non è filo:.
    wc.on('will-navigate', (event, url) => {
      // SICUREZZA: blocca le navigazioni top-level verso schemi non-web
      // (file:// → leak hash NTLM via SMB su Windows; data:/javascript: →
      // phishing/script). Vale per le pagine web; le interne navigano filo://.
      // I link "azione OS" (mailto:/tel:/sms:) non sono pagine: invece di
      // fallire li consegniamo al sistema (apre posta/telefono), come un browser.
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
        return;
      }
      // #170.3 — Blocco apertura siti in blacklist. Click su un link generico
      // (o window.location) verso un sito in blacklist: blocca, TRANNE se la
      // pagina di partenza è un motore di ricerca (l'utente l'ha cercato).
      if (this._maybeBlockNavigation(tab, url, { fromUrl: wc.getURL() })) {
        event.preventDefault();
        return;
      }
      if (this._needsRecreate(tab, url)) {
        event.preventDefault();
        this._recreateView(tab, url);
      }
      // #152 — born proxied su click-link/redirect verso un dominio con regola
      // persistente: NON preventDefault (la navigazione in-place prosegue), poi
      // _maybeApplyDomainRule instrada ricreando la view proxata se serve. Così
      // se il proxy non è configurato la pagina resta semplicemente diretta.
      this._maybeApplyDomainRule(tab, url);
    });
    // SICUREZZA (#309) — will-navigate NON scatta sui redirect lato server
    // (301/302/meta-refresh gestiti dal network layer): senza questo gate un
    // sito potrebbe rimbalzare la scheda verso uno schema non-web affidandosi
    // solo al blocco implicito di Chromium, fuori dall'invariante esplicita del
    // #247 ("nessuno schema non-web da NESSUN cammino"). Stessa difesa del
    // will-navigate qui sopra: blocco + delega all'OS dei soli mailto:/tel:/sms:.
    // I redirect legittimi http(s)→http(s) non entrano nel ramo e proseguono.
    wc.on('will-redirect', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
      }
    });
    // Debug helper: in dev relay i log della pagina al main.
    if (process.env.NODE_ENV !== 'production') {
      wc.on('console-message', (_e, level, message, line, source) => {
        const tag = ['log', 'warn', 'error'][level] || 'info';
        const src = source ? ` (${source}:${line})` : '';
        console.log(`[tab:${tab.id.slice(0, 6)}:${tag}] ${message}${src}`);
      });
    }
    // #327 — navigazione fallita (dominio inesistente, server giù, offline):
    // senza gestione il frame resta su chrome-error://chromewebdata/ con body
    // vuoto → scheda completamente bianca e muta. Simmetria con gli errori di
    // certificato (che hanno già il loro percorso, mapCertError → safebrowse):
    // qui carichiamo la pagina d'errore interna con motivo tradotto e "Riprova".
    // -3 (ERR_ABORTED: stop utente, redirect, nostre _recreateView) si ignora.
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[tab:${tab.id.slice(0, 6)}] did-fail-load`, code, desc, failedUrl);
      }
      const NE = globalThis.SN_NET_ERROR;
      if (!NE) return;
      const failed = failedUrl || tab.url || '';
      if (!NE.shouldShowErrorPage({ code, failedUrl: failed, isMainFrame })) return;
      // Per l'utente la scheda resta "sul" sito fallito (titolo/sessione/riprova):
      // la pagina d'errore è solo la faccia del fallimento, come negli altri browser.
      tab.url = failed;
      try {
        if (!wc.isDestroyed()) wc.loadURL(NE.buildUrl(failed, code, desc));
      } catch (_) {}
    });
    // #327 — renderer morto (crash/oom): stessa scheda bianca, stessa cura.
    // loadURL su un webContents col renderer morto ne rilancia uno nuovo.
    wc.on('render-process-gone', (_e, details) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[tab:${tab.id.slice(0, 6)}] render-process-gone`, details);
      }
      const NE = globalThis.SN_NET_ERROR;
      const reason = (details && details.reason) || '';
      // clean-exit = chiusura ordinata (nostre close/_recreateView): non è un crash.
      if (!NE || reason === 'clean-exit') return;
      const current = tab.url || '';
      if (!NE.isRetriableTarget(current) || NE.isErrorPageUrl(current)) return;
      // Anti-loop: se il renderer muore di nuovo mentre stiamo già recuperando
      // (o il recupero stesso crasha), non insistere a raffica.
      const now = Date.now();
      if (tab._crashRecoveryAt && now - tab._crashRecoveryAt < 2000) return;
      tab._crashRecoveryAt = now;
      // RICREA la view invece di riusare il webContents crashato: un loadURL
      // sul processo appena morto fa crashare anche il renderer respawnato
      // quando c'è un preload (verificato con forcefullyCrashRenderer: loop di
      // 'render-process-gone' finché non si passa a una view nuova). La view
      // nuova è configurata per l'URL BERSAGLIO (preload/partition giusti per
      // il "Riprova") ma parte dalla pagina d'errore.
      setTimeout(() => {
        try {
          if (!this.tabs.some((t) => t.id === tab.id)) return; // scheda chiusa nel frattempo
          this._recreateView(tab, current, { loadUrl: NE.buildUrl(current, NE.CRASH_CODE, reason) });
        } catch (_) {}
      }, 300);
    });
    // Colore selezione testo coerente con Filo sui siti esterni. insertCSS
    // ignora la CSP della pagina (che invece blocca il <link filo://> del
    // content script). Reiniettiamo a ogni dom-ready perché lo stylesheet
    // utente non sopravvive alle navigazioni a documento intero.
    // Reiniettiamo a ogni dom-ready perché gli stylesheet inseriti non
    // sopravvivono alle navigazioni a documento intero. Il guard è sull'URL
    // CORRENTE (non su tab.isInternal, fissato alla creazione): così anche una
    // newtab interna che naviga verso un sito esterno riceve gli stili.
    wc.on('dom-ready', () => {
      // Qui NON si annuncia lo schermo intero. Ci si era provato, e l'annuncio
      // arrivava prima che il content script avesse un orecchio: si perdeva, e
      // il menu del tasto destro continuava a offrire "Schermo intero" mentre
      // ci si era già dentro (#514). Adesso è la pagina a CHIEDERE lo stato
      // appena è pronta (MSG.FULLSCREEN_STATE), che è l'unico momento in cui la
      // risposta non può cadere nel vuoto.
      let current = '';
      try { current = wc.getURL() || ''; } catch (_) {}
      if (current.startsWith('filo://')) return; // pagine interne: CSS via <link>
      // cssOrigin 'user' + !important: le dichiarazioni !important di origine
      // "user" battono qualsiasi regola d'autore della pagina (così l'arancione
      // Filo della selezione vince anche su repubblica, ecc.).
      try { wc.insertCSS(PAGE_SELECTION_CSS, { cssOrigin: 'user' }); } catch (_) {}
      // CSS dei content script (menu, popup, sidebar...) come stylesheet
      // d'autore: equivale al <link filo://style/...> ma ignora la CSP della
      // pagina, che altrimenti lo bloccherebbe (YouTube, Reddit, ...).
      try { wc.insertCSS(getContentScriptCss()); } catch (_) {}
      // GPC (Global Privacy Control): proprietà JS nel mondo della pagina, gemella
      // dell'header Sec-GPC. executeJavaScript gira nel main world e ignora la CSP
      // (un <script> iniettato verrebbe bloccato dalla CSP di molti siti). Spenta
      // in modalità manuale. È un segnale "future-proof": oggi pochi siti UE lo
      // rispettano, il lavoro vero lo fa il rifiuto del banner CMP.
      if (this.cookieMode !== Cookies.MODES.MANUAL) {
        try {
          wc.executeJavaScript(
            'try{Object.defineProperty(navigator,"globalPrivacyControl",{get:function(){return true;},configurable:true});}catch(e){}',
            true,
          ).catch(() => {});
        } catch (_) {}
      }
    });

    // §3.1 — ripristino scroll alla riapertura da archivio: a caricamento finito
    // riportiamo la pagina alla percentuale registrata, una sola volta. Best-effort
    // (la pagina potrebbe avere altezza diversa o caricare contenuti lazy).
    wc.on('did-finish-load', () => {
      // Duplicazione tab: replica il livello di zoom della scheda sorgente,
      // una sola volta a caricamento finito.
      if (typeof tab.restoreZoomLevel === 'number') {
        const z = tab.restoreZoomLevel;
        tab.restoreZoomLevel = null;
        try { wc.setZoomLevel(z); } catch (_) {}
      }
      if (typeof tab.restoreScrollPct !== 'number') return;
      const pct = Math.max(0, Math.min(100, tab.restoreScrollPct));
      tab.restoreScrollPct = null; // applica una volta sola
      const js = `(()=>{try{const d=document.documentElement;const max=(d.scrollHeight||0)-window.innerHeight;if(max>0)window.scrollTo(0,max*${pct}/100);}catch(e){}})()`;
      const run = () => { try { wc.executeJavaScript(js, true).catch(() => {}); } catch (_) {} };
      run();
      setTimeout(run, 500); // riprova dopo l'eventuale layout/lazy-load
    });
    // Geo-block livello 1 (deterministico): pattern espliciti nel testo visibile
    // (YouTube "not available in your country", country block di Cloudflare, …).
    // Secondo campione ritardato per i messaggi che i player renderizzano via JS
    // dopo il load. Vedi _geoTextCheck e proxy-per-tab-spec.md §4.
    wc.on('did-finish-load', () => {
      this._geoTextCheck(tab);
      setTimeout(() => this._geoTextCheck(tab), 2000);
    });

    // #327 — URL "per l'utente" della scheda: se il webContents mostra la
    // pagina d'errore interna, la scheda per l'utente è ancora sull'URL fallito
    // (titolo, sessione salvata, ricarica = riprova) — come negli altri browser.
    const userUrl = (raw) => {
      const NE = globalThis.SN_NET_ERROR;
      const target = NE && NE.targetOf(raw);
      return target || raw;
    };
    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => {
      update({
        loading: false,
        url: userUrl(wc.getURL()),
        canBack: canGoBack(wc),
        canFwd: canGoFwd(wc),
      });
      // §3.2 — cattura un estratto del contenuto (best-effort) da usare per la
      // ricerca semantica dell'archivio e per il triage. Solo pagine web.
      if (!tab.isInternal && /^https?:\/\//i.test(wc.getURL() || '')) {
        try {
          wc.executeJavaScript(
            '(function(){try{return (document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,2000);}catch(e){return "";}})()',
            true,
          ).then((txt) => { if (typeof txt === 'string' && txt) tab.contentExtract = txt; }).catch(() => {});
        } catch (_) {}
      }
    });
    wc.on('page-title-updated', (_e, title) => update({ title: title || tab.title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons?.[0] || '' }));
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      // #412 — questa scheda ha committato una vera navigazione main-frame:
      // NON è più il "contenitore vuoto" di un download (una scheda aperta da un
      // link Scarica target=_blank che diventa subito scaricamento non committa
      // MAI, quindi resta a about:blank). Il flag protegge dal chiuderla per
      // sbaglio se poi parte un download da una pagina che ha già contenuto.
      tab._everNavigated = true;
      // Documento nuovo: chi rispondeva era quello vecchio. Il nuovo si
      // ripresenterà da solo appena montato (MSG.FULLSCREEN_STATE); fino ad
      // allora vale l'attesa corta, quella di chi non risponde.
      tab._rispondeAllEsc = false;
      // Documento nuovo: i riquadri di Filo aperti in quello vecchio sono andati
      // via con lui. Se un Esc era in attesa della risposta del documento
      // vecchio, quella risposta non arriverà mai: l'uscita parte adesso.
      if (this._escUscitaTimer) {
        this.annullaUscitaSchermoIntero();
        if (this.contentFullscreen) this.setContentFullscreen(false);
      }
      // #441 — quando la pagina corrente si è committata: una pagina-ponte
      // ("il download partirà a breve…") avvia il file entro pochi secondi da
      // qui. Oltre quella finestra la scheda non è più un semplice ponte.
      tab._navigatedAt = Date.now();
      // Nuova pagina → il colore live (§1.1) del sito precedente non vale più: lo
      // azzeriamo (la tab torna al neutro finché il content script non ricampiona).
      // Il colore IDENTITÀ (§1.2) invece dipende dal DOMINIO: se navighiamo su un
      // host già in cache lo applichiamo subito, altrimenti azzeriamo e aspettiamo
      // che il content script lo ricalcoli per il nuovo sito.
      const cachedIdentity = this._identityColorCache.get(hostOf(url)) || null;
      update({
        url: userUrl(url),
        color: null,
        identityColor: cachedIdentity,
        canBack: canGoBack(wc),
        canFwd: canGoFwd(wc),
      });
      // Rilevamento siti pericolosi: ricontrolla l'URL FINALE (dopo i redirect)
      // appena il main-frame si è committato, prima che la pagina sia
      // interattiva. Best-effort, non blocca mai (vedi _sbOnNavigate).
      this._sbOnNavigate(tab, url);
      // Geo-block livello 1 (deterministico): nuova navigazione → il segnale
      // precedente decade; HTTP 451 è conclusivo, altrimenti vale l'eventuale
      // redirect "di blocco" memorizzato durante questa navigazione.
      const redirectHit = tab._geoRedirectHit || null;
      tab._geoRedirectHit = null;
      tab.geoBlock = null;
      // Status dell'URL finale: serve al livello 2 (classificatore LLM) per
      // riconoscere la coda ambigua (403, pagina vuota). 0 = non osservabile.
      tab._lastStatus = Number(httpResponseCode) || 0;
      if (!/^filo:\/\//i.test(url || '')) {
        if (GeoBlock.matchStatus(httpResponseCode)) {
          this._geoBlockDetected(tab, url, GeoBlock.SOURCES.HTTP_451, 'http_451');
        } else if (redirectHit) {
          this._geoBlockDetected(tab, url, GeoBlock.SOURCES.REDIRECT, redirectHit.detail);
        }
      }
    });
    wc.on('did-navigate-in-page', (_e, url) => update({ url: userUrl(url), canBack: canGoBack(wc), canFwd: canGoFwd(wc) }));
    // #441 — l'utente ha toccato DAVVERO questa scheda? Serve a non chiudere
    // come "pagina-ponte" una scheda con cui ha interagito. Il segnale arriva
    // dal main (non dal content script, che manda un campione di attività anche
    // senza input e non è iniettato ovunque). Il semplice passaggio del mouse
    // NON conta: muovere il cursore sopra una scheda non è usarla.
    wc.on('input-event', (_e, input) => {
      const type = (input && input.type) || '';
      if (!type || HOVER_INPUT_TYPES.has(type)) return;
      tab._userInputAt = Date.now();
      // #514 — qui passa l'input VERO, quello che la pagina non può fabbricare:
      // è il posto giusto per far ripartire da zero il conto delle
      // rivendicazioni dell'Esc. Tutto tranne l'Esc stesso conta come "l'utente
      // ha fatto altro": un clic per aprire un riquadro, una lettera scritta.
      const esc = String(input.key || '') === 'Escape' || String(input.code || '') === 'Escape';
      // Anche il mouse passa di qui, e un clic è il gesto con cui una pagina
      // può legittimamente prendersi lo schermo: l'Esc no (vedi
      // `enter-html-full-screen`).
      tab._ultimoInputEsc = esc;
      if (!esc) this.azzeraRivendicazioniEsc();
    });
    // Redirect main-frame verso URL "di blocco" (/geo, /not-available,
    // /region-block, … — lista curata in geoBlock.js): il match viene
    // memorizzato e diventa segnale al did-navigate dell'URL finale.
    // Firma difensiva: Electron recenti passano i dettagli nell'event object,
    // i vecchi come argomenti posizionali.
    wc.on('did-redirect-navigation', (e, url, _inPlace, isMainFrame) => {
      const target = typeof url === 'string' ? url : (e && e.url) || '';
      const main = typeof isMainFrame === 'boolean' ? isMainFrame : !(e && e.isMainFrame === false);
      if (!main || !target || tab._geoRedirectHit) return;
      const hit = GeoBlock.matchRedirectUrl(target);
      if (hit) tab._geoRedirectHit = { url: target, detail: hit };
    });

    // §2.1 segnale: la tab sta producendo audio? Una tab che riproduce
    // audio/video NON va mai archiviata (decisione utente). L'evento arriva come
    // In Electron 32+ l'audible sta SULL'oggetto evento (un solo argomento); in
    // quelli più vecchi arriva come (event, {audible}) o (event, audible). Su
    // Electron 33 leggere solo il secondo argomento dava sempre false →
    // l'indicatore audio non si attivava mai. audibleFromEvent normalizza tutto.
    wc.on('audio-state-changed', (e, arg) => {
      const audible = audibleFromEvent(e, arg);
      if (tab.audible !== audible) { tab.audible = audible; this._broadcast(); }
    });

    // #151 — consumo dati delle tab proxate: i video via proxy bruciano GB in
    // fretta (spec §1/§5). Se una tab PROXATA riproduce media per oltre 15 min
    // (cumulativi), una nota discreta UNA volta per sessione. La soglia e il gate
    // "già notato" stanno nella logica pura (geoBlockRules.shouldNoteVideoData);
    // qui solo l'accumulo del tempo di riproduzione e il timer.
    wc.on('media-started-playing', () => {
      if (!tab.proxy || this._proxyVideoNoted) return;
      if (!tab._proxyMedia) tab._proxyMedia = { accumulatedMs: 0, playingSince: 0, timer: null };
      const m = tab._proxyMedia;
      if (m.playingSince) return; // già in riproduzione
      m.playingSince = Date.now();
      const remaining = Math.max(0, GeoBlockRules.VIDEO_DATA_NOTE_MS - m.accumulatedMs);
      m.timer = setTimeout(() => {
        const playingMs = m.accumulatedMs + (m.playingSince ? Date.now() - m.playingSince : 0);
        if (GeoBlockRules.shouldNoteVideoData({ proxied: !!tab.proxy, playingMs, alreadyNoted: this._proxyVideoNoted })) {
          this._proxyVideoNoted = true;
          this._geoToast('Le tab aperte da un altro paese consumano più dati — occhio ai video lunghi');
        }
      }, remaining);
      if (m.timer.unref) m.timer.unref();
    });
    wc.on('media-paused', () => {
      const m = tab._proxyMedia;
      if (!m) return;
      if (m.playingSince) { m.accumulatedMs += Date.now() - m.playingSince; m.playingSince = 0; }
      if (m.timer) { clearTimeout(m.timer); m.timer = null; }
    });

    // Errore certificato: registra lo stato (scaduto, autofirmato, mismatch…)
    // per arricchire il verdetto safebrowse. Manteniamo il comportamento sicuro
    // di default (callback(false) = rifiuta la connessione non attendibile).
    wc.on('certificate-error', (event, url, error, _cert, callback) => {
      try {
        const SB = globalThis.SN_SAFEBROWSE;
        const norm = SB && SB.normalize(url);
        if (norm && norm.registrable) SB.recordCert(norm.registrable, mapCertError(error));
      } catch (_) {}
      try { callback(false); } catch (_) {}
    });

    // Spellcheck nativo: Electron è l'unico a conoscere i suggerimenti
    // ortografici della parola sotto lo zigzag rosso. Li spingiamo al
    // content script perché li mostri nel menu di correzione custom.
    wc.on('context-menu', (_e, params) => {
      if (params.misspelledWord) {
        // #405 — il click destro può essere avvenuto dentro un riquadro
        // incorporato (iframe): il menu di correzione lo costruisce il content
        // script DI QUEL frame, quindi i suggerimenti vanno consegnati lì.
        // `wc.send` raggiunge solo il frame principale, e nei campi dentro un
        // riquadro i suggerimenti nativi sarebbero caduti nel vuoto.
        const target = params.frame && !params.frame.detached ? params.frame : wc;
        try {
          target.send('filo:broadcast', {
            type: '_spell:native',
            word: params.misspelledWord,
            suggestions: (params.dictionarySuggestions || []).slice(0, 5),
          });
        } catch (_) {}
      }
    });

    // Apertura nuove tab: tutto resta dentro Filo come nuovo tab — a meno che
    // il popup blocker sia attivo e l'apertura sembri un popup pubblicitario
    // (cioè non un click su <a target="_blank">). Heuristic: il disposition
    // 'new-window' corrisponde a window.open() esplicito con features (size,
    // toolbar, ecc.), che è la firma classica degli ad popup. Disposition
    // 'foreground-tab' e 'background-tab' sono link cliccati dall'utente.
    wc.setWindowOpenHandler((details) => {
      const { url, disposition } = details;
      // SICUREZZA: nega l'apertura (window.open / target=_blank) verso schemi
      // non-web — stessa difesa di will-navigate (file:// → leak NTLM, ecc.).
      // mailto:/tel:/sms: vengono consegnati all'OS invece di essere ignorati.
      if (isWebUnsafeNav(url)) {
        openExternalScheme(url);
        return { action: 'deny' };
      }
      // #209 — i popup di login ("Continua con Google" e simili) NON sono
      // pubblicità: vanno consentiti come VERA finestra popup (action 'allow'),
      // così la relazione opener↔popup che l'OAuth usa per restituire l'esito
      // resta intatta. Una nuova scheda (deny+openTab) la spezzerebbe.
      //
      // #209 (giro successivo) — 'allow' da solo NON basta: senza
      // overrideBrowserWindowOptions Electron crea il popup con un
      // BrowserWindow "nudo", senza ALCUN preload (il preload non è fra le
      // security webPreferences ereditate dall'opener). Il popup nasce quindi
      // SENZA page-preload.js: né l'esenzione anti-fingerprint per i login
      // (services/fingerprint.js → isIdentityProviderHref) né nessun altro
      // pezzo di quel preload raggiungono MAI la pagina di Google/Microsoft/…
      // dentro il popup — solo la scheda opener (claude.ai) lo aveva. Diamo al
      // popup le stesse webPreferences di una scheda esterna normale (vedi
      // _makeView) così il preload gira anche lì, e la stessa partizione che
      // avrebbe una scheda aperta su quella URL (Cookies.MODES.PRIVACY →
      // partizione per-sito; altrimenti null = sessione condivisa), per non
      // spezzare un eventuale login Google già presente in Filo.
      if (tab.isInternal === false && isAuthPopup(url)) {
        return this._allowAuthPopup(url);
      }
      const isAdLikePopup = disposition === 'new-window';
      if (tab.isInternal === false && this.security.blockPopups && isAdLikePopup) {
        this._notifyPopupBlocked(tab.id, url);
        return { action: 'deny' };
      }
      // #170.3 — link verso un sito in blacklist aperto in una nuova scheda
      // (target=_blank / window.open): stesso blocco di will-navigate. Il
      // referrer è la pagina che ha originato l'apertura.
      const fromUrl = (details.referrer && details.referrer.url) || wc.getURL();
      if (this._maybeBlockNavigation(tab, url, { fromUrl })) {
        return { action: 'deny' };
      }
      // #376 — parità con qualsiasi browser: Ctrl+click / click centrale su un
      // link ("aprilo dietro, io continuo a leggere qui") arriva con
      // disposition 'background-tab' e NON deve rubare il primo piano. Prima
      // ogni apertura veniva attivata, quindi l'utente veniva strappato dalla
      // pagina che stava leggendo — lo stesso attrito della musica che passava
      // davanti da sola.
      this.openTab(url, { activate: disposition !== 'background-tab', openedByLink: true });
      return { action: 'deny' };
    });

    // #209 — hardening del popup di login appena consentito. La finestra creata
    // da action:'allow' NON passa da _wireEvents (non è una tab): senza questo
    // hook resterebbe senza le difese che ogni scheda ha. Qui arrivano SOLO i
    // popup di login (ogni altro percorso del handler qui sopra ritorna 'deny').
    wc.on('did-create-window', (child) => {
      this._hardenAuthPopup(child);
    });
  }

  // #209 — risposta 'allow' per un popup di login, con le webPreferences
  // esplicite. Senza overrideBrowserWindowOptions Electron creerebbe il popup
  // con un BrowserWindow "nudo", senza ALCUN preload (il preload non è fra le
  // security webPreferences ereditate dall'opener): né l'esenzione
  // anti-fingerprint per i login (services/fingerprint.js →
  // isIdentityProviderHref) né nessun altro pezzo di page-preload.js
  // raggiungerebbero MAI la pagina di Google/Microsoft/… dentro il popup —
  // solo la scheda opener (es. claude.ai) lo aveva. Diamo al popup le stesse
  // webPreferences di una scheda esterna normale (vedi _makeView) così il
  // preload gira anche lì, e la stessa partizione che avrebbe una scheda
  // aperta su quella URL (Cookies.MODES.PRIVACY → partizione per-sito;
  // altrimenti null = sessione condivisa), per non spezzare un eventuale
  // login Google già presente in Filo.
  _allowAuthPopup(url) {
    const popupPartition = this._partitionFor(url);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: PAGE_PRELOAD,
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          webSecurity: true,
          // #405 — stesse regole di una scheda esterna: anche dentro il popup
          // di login i riquadri incorporati devono avere il tasto destro.
          nodeIntegrationInSubFrames: true,
          ...(popupPartition ? { partition: popupPartition } : {}),
        },
      },
    };
  }

  // #209 — applica al popup di login le STESSE difese di una scheda normale.
  // La finestra nasce fuori da _wireEvents, quindi va cablata qui:
  //   - policy WebRTC anti IP-leak (come _applySecurity sulle tab);
  //   - blocco navigazioni verso schemi non-web (file:// → leak hash NTLM via
  //     SMB su Windows, data:/javascript: → phishing), come il will-navigate
  //     delle tab; mailto:/tel:/sms: consegnati all'OS;
  //   - gate sulle aperture di ULTERIORI finestre dal popup: un secondo popup
  //     di login concatenato (es. scelta account → verifica) resta una vera
  //     finestra (ricorsivamente hardened), tutto il resto torna dentro Filo
  //     come scheda normale — mai finestre libere non gestite.
  _hardenAuthPopup(win) {
    if (!win || !win.webContents) return;
    const pwc = win.webContents;
    try {
      pwc.setWebRTCIPHandlingPolicy(
        this.security.protectIpLeak ? 'default_public_interface_only' : 'default',
      );
    } catch (_) { /* policy non supportata in qualche build */ }
    pwc.on('will-navigate', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
      }
    });
    // SICUREZZA (#309) — come per le tab: will-navigate non copre i redirect
    // lato server, e un IdP compromesso/ostile potrebbe rimbalzare il popup
    // verso file:// (leak hash NTLM) o data:/javascript:. Stesso gate esplicito.
    pwc.on('will-redirect', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
      }
    });
    pwc.setWindowOpenHandler(({ url }) => {
      if (isWebUnsafeNav(url)) {
        openExternalScheme(url);
        return { action: 'deny' };
      }
      if (isAuthPopup(url)) {
        return this._allowAuthPopup(url);
      }
      this.openTab(url, { activate: true });
      return { action: 'deny' };
    });
    pwc.on('did-create-window', (child) => this._hardenAuthPopup(child));
  }

  // Notifica la shell che un popup è stato bloccato sul tab `tabId`. La shell
  // mostra una chip "Bloccato popup da <host> — Apri" cliccabile per aprirlo.
  _notifyPopupBlocked(tabId, url) {
    try {
      let host = '';
      try { host = new URL(url).host; } catch (_) { host = url; }
      this.win.webContents.send('tabs:popup-blocked', { tabId, url, host });
    } catch (_) {}
  }

  // Chiamato da IPC quando l'utente clicca "Apri" sulla chip — il popup era
  // legittimo (es. share dialog, OAuth) e va aperto bypassando il blocco.
  openBlockedPopup(url) {
    this.openTab(url, { activate: true });
  }

  // #412 — un link "Scarica" con target=_blank (o window.open) apre una nuova
  // scheda che, servita con Content-Disposition:attachment, diventa subito uno
  // scaricamento: nessuna pagina si committa mai e la scheda resta a about:blank
  // — bianca, titolo "Nuova scheda", attiva — che l'utente deve chiudere a mano.
  // #441 — stesso attrito, un passo più in là: certi siti aprono una pagina
  // intermedia ("Grazie, il download partirà a breve…") che avvia il file da
  // sola. Ha contenuto vero, quindi la regola del #412 non la tocca, ma resta
  // una scheda usa e getta. La chiudiamo solo con la firma stretta descritta in
  // src/shared/downloadTabs.js (nata da un link, mai navigata dentro, mai
  // toccata dall'utente, download partito entro pochi secondi dal caricamento)
  // e, siccome lì qualcosa da perdere c'era, con un avviso "Riapri".
  // Il gestore download (services/downloads.js) ci passa la webContents che ha
  // originato lo scaricamento. La scheda superflua NON viene archiviata (non è
  // un sito che l'utente ha visitato per il suo contenuto): non passa da
  // closeTab.
  handleDownloadStarted(wc) {
    if (!wc) return;
    const tab = this.tabs.find((t) => {
      try { return t.view && t.view.webContents === wc; } catch (_) { return false; }
    });
    if (!tab) return;
    const decision = decideCloseOnDownload({
      isInternal: !!tab.isInternal,
      everNavigated: !!tab._everNavigated,
      openedByLink: !!tab._openedByLink,
      canBack: !!tab.canBack,
      userInputAt: tab._userInputAt || null,
      navigatedAt: tab._navigatedAt || null,
      now: Date.now(),
    });
    if (!decision.close) return;
    const idx = this.tabs.findIndex((t) => t.id === tab.id);
    if (idx < 0) return;
    // La pagina-ponte aveva contenuto: l'utente deve poter tornare indietro se
    // quella scheda gli serviva davvero (chiudere da soli qualcosa di visibile
    // senza via di ritorno sarebbe peggio dell'attrito che togliamo).
    const undo = decision.reason === 'bridge'
      ? { title: tab.title, url: tab.url }
      : null;
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    this.tabs.splice(idx, 1);
    if (this.activeId === tab.id) {
      // Torna alla scheda di partenza (la più recente fra le rimaste), come fa
      // closeTab; se non ne resta nessuna, apri una newtab fresca.
      const next = this._mostRecentlyActiveTab() || this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/');
    } else {
      this._broadcast();
    }
    if (undo) this._notifyBridgeTabClosed(undo);
  }

  // #441 — avviso discreto dopo aver chiuso una pagina-ponte, con "Riapri".
  _notifyBridgeTabClosed({ title, url }) {
    if (!url) return;
    let label = String(title || '').trim();
    if (!label || label === 'Nuova scheda') {
      try { label = new URL(url).host; } catch (_) { label = url; }
    }
    if (label.length > 40) label = `${label.slice(0, 39)}…`;
    try {
      this.win.webContents.send('shell:toast', {
        text: `Chiusa «${label}»: serviva solo ad avviare lo scaricamento`,
        opts: { actions: [{ label: 'Riapri', openUrl: url }] },
      });
    } catch (_) {}
  }

  // #170.3 — decide se bloccare una navigazione top-level verso un sito in
  // blacklist e, in caso, mostra la notifica. Ritorna true se ha bloccato.
  // Le aperture originate da Filo (openTab dell'azione NAVIGA, navigazione
  // interna filo://) non passano da qui (loadURL programmatico non emette
  // will-navigate), quindi sono naturalmente consentite.
  _maybeBlockNavigation(tab, url, { fromUrl = '' } = {}) {
    let decision;
    try {
      decision = require('./services/siteBlock').shouldBlockNavigation(url, { fromUrl });
    } catch (_) {
      return false;
    }
    if (!decision || !decision.block) return false;
    this._notifyBlocked(decision.host, url);
    return true;
  }

  // Notifica in basso a destra (#170.1): sito bloccato + azione "Apri comunque".
  // L'azione riusa il percorso openBlockedPopup (apertura programmatica, che
  // bypassa il blocco).
  _notifyBlocked(host, url) {
    try {
      const label = host || (() => { try { return new URL(url).host; } catch (_) { return url; } })();
      this.win.webContents.send('shell:toast', {
        text: `Sito bloccato: ${label}`,
        opts: { actions: [{ label: 'Apri comunque', openUrl: url }] },
      });
    } catch (_) {}
  }

  // ─── rilevamento siti pericolosi ─────────────────────────────────────────
  // (vedi src/main/services/safebrowse/ e src/main/tabs/tabSafebrowse.js).
  // I metodi safebrowse (_sbState, _sbApplyState, _sbBroadcast, safebrowseGet,
  // _sbOnNavigate, safebrowseProceed, safebrowseDismiss) sono estratti in
  // tabSafebrowse.js e installati sul prototype in fondo a questo file (mixin).

  // ─── rilevamento geo-block (livello 1 deterministico) + regole d'azione ───
  // (vedi src/main/services/geoBlock.js, proxy-per-tab-spec.md §4-§5 e
  // src/main/tabs/tabGeoBlock.js). I metodi geo-block (_geoBlockDetected,
  // _geoActOnDetected, _geoCountryLabel, _geoToast, _geoBroadcastPropose,
  // _geoState, geoProposeAccept, geoProposeDismiss, _geoTextCheck,
  // _geoLevel2Check) sono estratti in tabGeoBlock.js e installati sul prototype
  // in fondo a questo file (mixin).

  // ─── snapshot stato per la shell ────────────────────────────────────────

  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        loading: t.loading,
        canBack: t.canBack,
        canFwd: t.canFwd,
        muted: !!t.muted,
        color: t.color || null,
        identityColor: t.identityColor || null,
        // §2.1 — segnali per l'auto-archiviazione.
        openedAt: t.openedAt || null,
        lastActiveAt: t.lastActiveAt || null,
        lastInteractionAt: t.lastInteractionAt || null,
        audible: !!t.audible,
        scrollPct: typeof t.scrollPct === 'number' ? t.scrollPct : 0,
        formDirty: !!t.formDirty,
        isInternal: t.isInternal,
        // Proxy per-tab ("Apri da un altro paese"): { country, tier } o null.
        // La shell lo userà per l'indicatore sulla tab (feedback UI separato).
        proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null,
      })),
    };
  }

  _broadcast() {
    // La shell è il primary webContents della BrowserWindow.
    try {
      this.win.webContents.send('tabs:updated', this.snapshot());
    } catch (_) { /* shell non ancora caricata */ }
    this._persistSession();
  }

  // ─── persistenza sessione (riapri i tab alla riapertura di Filo) ──────────

  // Stato minimale da salvare/ripristinare: gli URL dei tab, quale era attivo e
  // il colore identità di ciascuno. `colors` è allineato indice-per-indice a
  // `tabs`: serve a far ripartire la barra già tinta (§1.2) e a dare al riordino
  // cromatico della riapertura (§1.3) i dati subito, senza aspettare che i
  // content script ricalcolino il colore di ogni sito. Campo aggiuntivo: un
  // ripristino vecchio senza `colors` continua a funzionare (viene ignorato).
  sessionState() {
    const kept = this.tabs
      .filter((t) => typeof t.url === 'string' && t.url && t.url !== 'about:blank');
    const tabs = kept.map((t) => t.url);
    const colors = kept.map((t) => t.identityColor || null);
    let activeIndex = this.tabs.findIndex((t) => t.id === this.activeId);
    if (activeIndex < 0) activeIndex = 0;
    return { tabs, colors, activeIndex };
  }

  _sessionKey() {
    return globalThis.SN_CONST?.STORAGE_KEYS?.OPEN_TABS || 'sn_open_tabs';
  }

  // Salvataggio con debounce: _broadcast scatta spesso (load, titolo, favicon),
  // collassiamo le scritture ravvicinate.
  _persistSession() {
    if (this.incognito) return; // incognito: nessuna sessione salvata su disco
    if (this._restoring) return; // non sovrascrivere mentre stiamo ripristinando
    clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => {
      try {
        globalThis.SN_STORAGE?.setRaw?.(this._sessionKey(), this.sessionState());
      } catch (_) {}
    }, 400);
  }

  // Riapre i tab della sessione precedente. Ritorna true se ha ripristinato
  // qualcosa, false se non c'era nulla da ripristinare (il chiamante aprirà
  // allora un newtab vuoto).
  async restoreSession() {
    if (this.incognito) return false; // incognito: nessuna sessione da ripristinare
    let urls = [];
    let colors = [];
    let activeIndex = 0;
    try {
      const saved = await globalThis.SN_STORAGE?.getRaw?.(this._sessionKey(), null);
      if (saved && Array.isArray(saved.tabs)) {
        // Filtro url + colori in lockstep così `colors[i]` resta allineato al
        // tab ripristinato in posizione i (un ripristino vecchio senza `colors`
        // dà semplicemente colori tutti null).
        const savedColors = Array.isArray(saved.colors) ? saved.colors : [];
        saved.tabs.forEach((u, i) => {
          if (typeof u === 'string' && u) {
            urls.push(u);
            colors.push(savedColors[i] || null);
          }
        });
        if (Number.isInteger(saved.activeIndex)) activeIndex = saved.activeIndex;
      }
    } catch (_) {}
    if (!urls.length) return false;

    this._restoring = true;
    try {
      // #145 — suppressAutoplay: i media delle tab ripristinate restano in pausa
      // al boot (niente più video YouTube che ripartono tutti insieme).
      urls.forEach((url, i) => {
        const id = this.openTab(url, { activate: false, suppressAutoplay: true });
        // §1.2/§1.3 — ripristina subito il colore identità salvato: la barra
        // riparte già tinta e il riordino cromatico alla riapertura ha i dati
        // pronti senza attendere il ricalcolo dei content script. Seeda anche la
        // cache per host, così una did-navigate sullo stesso dominio lo conserva.
        if (id && colors[i]) this.setTabIdentityColor(id, colors[i]);
      });
      if (activeIndex < 0 || activeIndex >= this.tabs.length) activeIndex = this.tabs.length - 1;
      const target = this.tabs[activeIndex];
      if (target) this.activate(target.id);
    } finally {
      this._restoring = false;
    }
    this._persistSession();
    // §2.1 decisione utente: a ogni riapertura Filo riordina/archivia le tab.
    // Lo facciamo dopo un attimo, così le pagine hanno tempo di caricarsi e di
    // fornire un estratto del contenuto all'LLM. No-op se la pref è disattivata
    // o manca la chiave.
    this._maybeTriageOnReopen();
    return true;
  }

  async _maybeTriageOnReopen() {
    try {
      const s = await this._readSettings();
      const aa = s && s.autoArchive;
      if (!aa || !aa.enabled || !aa.onClose) return;
      setTimeout(() => { this.runAutoTriage({ trigger: 'reopen' }).catch(() => {}); }, 4000);
    } catch (_) {}
  }
}

// Installa i blocchi estratti come metodi di TabManager (mixin). Le definizioni
// vivono in moduli separati per leggibilità; qui li agganciamo al prototype così
// `this._sbBroadcast(...)`, `this._geoTextCheck(...)`, ecc. restano metodi
// d'istanza identici a prima del refactor.
installSafebrowse(TabManager);
installGeoBlock(TabManager);

// Host di un URL (chiave della cache colore identità §1.2). Solo schemi web:
// le pagine filo:// interne non hanno identità di sito da tinteggiare.
function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host || null;
  } catch (_) { return null; }
}

// Hue (0..360) del colore identità per l'ordine cromatico (§1.3). Le tab senza
// colore tornano Infinity → finiscono in coda.
function hueOf(rgbStr) {
  const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
  if (!m) return Infinity;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return Infinity;
  const r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return Infinity;
  const d = mx - mn;
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h / 6) * 360;
}

function canGoBack(wc) {
  if (wc.navigationHistory?.canGoBack) return wc.navigationHistory.canGoBack();
  if (typeof wc.canGoBack === 'function') return wc.canGoBack();
  return false;
}

function canGoFwd(wc) {
  if (wc.navigationHistory?.canGoForward) return wc.navigationHistory.canGoForward();
  if (typeof wc.canGoForward === 'function') return wc.canGoForward();
  return false;
}

// Mappa il codice errore certificato di Chromium nello stato usato dal motore
// safebrowse (vedi CERT_BAD in services/safebrowse/engine.js). I self-signed
// arrivano come ERR_CERT_AUTHORITY_INVALID → 'untrusted'.
function mapCertError(error) {
  const e = String(error || '');
  if (/ERR_CERT_DATE_INVALID/.test(e)) return 'expired';
  if (/ERR_CERT_COMMON_NAME_INVALID/.test(e)) return 'mismatch';
  if (/ERR_CERT_REVOKED/.test(e)) return 'revoked';
  return 'untrusted';
}

// normalizeUrl / isLocalHost vivono ora in src/shared/urlNav.js (#398): la stessa
// logica serve anche al campo "nuova scheda" della dashboard, che prima aveva una
// copia più povera. Sono importati in cima al file da globalThis.SN_URL_NAV.

module.exports = { TabManager, normalizeUrl, isWebUnsafeNav };
