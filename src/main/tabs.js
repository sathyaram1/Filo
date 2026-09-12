// Tab manager: ogni tab è una WebContentsView attaccata alla BrowserWindow,
// posizionata sotto la "shell" (tab bar + barra indirizzi).
// La shell parla con il main via IPC (tabs:* canali); il main risponde con
// broadcast tabs:updated alla shell perché ridisegni la barra.

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

// #441 — eventi di solo PUNTAMENTO: il cursore che attraversa la pagina non è
// un'interazione dell'utente con quella scheda (tutto il resto — click, tasti,
// rotella, tocco, gesti — lo è).
const HOVER_INPUT_TYPES = new Set([
  'mouseMove', 'mouseEnter', 'mouseLeave', 'pointerMove', 'pointerRawUpdate',
]);

// #514 — quanto aspettiamo la pagina prima di uscire dallo schermo intero per
// conto nostro. L'attesa serve a una cosa sola: dare alla pagina il tempo di
// dire "quell'Esc me lo sono preso io".
//
// Due tempi, perché i due casi sono diversi e mescolarli è già costato.
//  · Una pagina che RISPONDE (ha i pezzi di Filo dentro, si è presentata da
//    sola appena montata) risponde in entrambi i casi: se il tasto era suo lo
//    rivendica, se non lo era chiede lei l'uscita. Quindi qui l'attesa non è un
//    ritardo — l'uscita arriva quando arriva la sua risposta — ed è solo la
//    rete di sicurezza per il caso in cui quella risposta non arrivi MAI
//    (renderer morto, script che gira all'infinito). Larga: una pagina
//    impegnata mezzo secondo quando l'utente preme Esc rispondeva fuori tempo
//    massimo, e usciva dallo schermo intero chiudendo insieme il riquadro che
//    stava sopra — il danno di #514 da un'altra porta.
//  · Una pagina che NON risponde (il visore PDF, una pagina d'errore, una
//    scheda ancora vuota) non dirà niente per definizione: lì l'attesa è tutta
//    ritardo, e resta corta.
// In tutti e due i casi l'errore possibile è un'uscita in ritardo, mai restare
// chiusi dentro.
const ESC_ATTESA_MS = 400;
const ESC_ATTESA_PAGINA_CHE_RISPONDE_MS = 2500;

// #514 — quante volte di fila la pagina può dire "quell'Esc me lo sono preso
// io" prima che il main smetta di crederle. Il conto sta QUI, nel main, perché
// nella pagina il sito ci arriva: un evento finto fabbricato dal documento
// azzerava il conto tenuto dal content script, e da lì un sito scritto apposta
// si rivendicava ogni Esc e teneva l'utente dentro allo schermo intero per
// sempre. Il main vede solo l'input vero, che una pagina non può fabbricare.
// Tre è più di quanti riquadri di Filo si possano impilare uno sull'altro, e il
// conto riparte da zero appena l'utente fa qualsiasi altra cosa (un clic, un
// altro tasto) o appena la modalità cambia: aprire un riquadro chiede sempre un
// gesto, quindi in mano a chi usa Filo il tetto non si tocca mai.
const ESC_RIVENDICAZIONI_MAX = 3;

// #514 — la scheda a cui appartiene una WebContents, in qualunque finestra. La
// sessione è condivisa fra finestre e schede, mentre "l'ultimo tasto era l'Esc"
// è una cosa della singola scheda: il gestore dei permessi deve poter risalire
// dall'una all'altra.
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

// #514 — l'Esc NON è un gesto con cui una pagina può prendersi lo schermo.
// Da quando il tasto arriva al documento (serve: è quello che chiude i riquadri
// aperti sopra la pagina, e prendercelo prima li scavalcava), il browser lo
// conta come gesto dell'utente. Una pagina che chiede lo schermo pieno dentro
// il proprio gestore dell'Esc lo otteneva senza che nessuno avesse cliccato
// niente: da lì il tasto di questa segnalazione diventava un testa o croce —
// un Esc esce, il successivo rientra — perché la modalità tornava "della
// pagina" e l'Esc dopo era suo. Si rifiuta qui, prima che succeda qualsiasi
// cosa: un evento di uscita non può essere il permesso per entrare. Su ogni
// altro permesso si resta al comportamento di prima (senza gestore, Electron
// concede), e questo è il motivo del `callback(true)` finale.
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

// #252 — pagina interna filo:// "singleton": ne ha senso UNA sola scheda alla
// volta (le liste "Aperti per dopo"/Cronologia/Archivio/Scaricamenti, le
// pagine Impostazioni, gli editor…). Riaprirla mentre è già aperta deve
// riportare l'utente sulla scheda esistente, non crearne un doppione. L'unica
// pagina filo:// NON singleton è la nuova scheda (`filo://newtab/`): di quella
// se ne vogliono quante se ne aprono. La chiave d'identità è host+path (query
// e hash esclusi: un ?highlight non rende la pagina "un'altra pagina").
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

// SICUREZZA — schemi consentiti per le navigazioni ORIGINATE da contenuto web
// (click su link, window.location, window.open) e dall'agente. Tutto il resto è
// bloccato. In particolare `file://`: su Windows un percorso UNC
// (file://attacker-host/share) fa partire l'autenticazione SMB e fa TRAPELARE
// l'hash NTLM dell'utente a un sito ostile; `file:///C:/…` espone file locali.
// `data:`/`javascript:` top-level sono vettori di phishing/script. Le pagine web
// legittime navigano solo verso http(s); le interne verso filo://. La barra
// indirizzi (navigazione esplicita dell'utente) NON passa da questo gate.
const WEB_NAV_SCHEMES = new Set(['http:', 'https:', 'filo:', 'about:', 'blob:']);
// L'indirizzo è già scritto per intero (schema compreso)? È la domanda che
// separa "https://sito.esempio/x" da "sito.esempio/x": il secondo non è un URL
// finché non gli si mette lo schema davanti, e prima di allora nessun controllo
// che ragiona per host riesce a leggerlo (#590).
function parsesAsUrl(rawUrl) {
  try { new URL(String(rawUrl || '')); return true; } catch (_) { return false; }
}

function isWebUnsafeNav(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  // URL relativo/non parsabile → Electron lo risolve sull'origine corrente
  // (stessa pagina web): non è un cambio di schema, non bloccare.
  return proto ? !WEB_NAV_SCHEMES.has(proto) : false;
}

// Schemi "azione del sistema operativo": NON sono pagine web (quindi bloccati da
// isWebUnsafeNav), ma un browser completo li CONSEGNA all'OS invece di fallire —
// `mailto:` apre il client di posta, `tel:`/`sms:` avviano chiamata/SMS. È una
// ALLOWLIST volutamente minima: solo questi schemi notoriamente innocui passano
// a shell.openExternal. Tutto il resto (file:, data:, javascript:, schemi
// arbitrari che potrebbero lanciare altre app) resta BLOCCATO — non vogliamo che
// un sito ostile inneschi handler di protocollo sconosciuti.
const OS_DELEGATED_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);
function isOsDelegatedScheme(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  return OS_DELEGATED_SCHEMES.has(proto);
}

// Consegna all'OS un link mailto:/tel:/sms: (best-effort). Da chiamare SOLO dopo
// aver bloccato la navigazione in-app, e SOLO per gli schemi dell'allowlist.
function openExternalScheme(rawUrl) {
  if (!isOsDelegatedScheme(rawUrl)) return false;
  try { shell.openExternal(String(rawUrl)); } catch (_) {}
  return true;
}

// Altezza della sola fila di tab (tab + nuova scheda + controlli finestra),
// senza la barra indirizzi. In sync con `.tab-row { flex: 0 0 40px }` in
// src/renderer/shell.css. Quando la shell è in "chrome compatto" (fuori dalla
// home) la WebContentsView attiva parte da qui invece che da SHELL_HEIGHT.
const TAB_ROW_HEIGHT = 40;

// Pagine interne su cui i content script (e quindi il menu Filo del tasto
// destro) NON vengono iniettati — vedi CS_BLOCKLIST in internal-preload.js.
// Qui forniamo un menu contestuale nativo così il tasto destro fa qualcosa
// (taglia/copia/incolla) invece di restare inerte, es. nell'editor.
const NATIVE_MENU_PAGES = [
  'filo://options/', 'filo://preferences/', 'filo://security/', 'filo://history/',
  'filo://feedback/', 'filo://spellcheck/', 'filo://editor/', 'filo://admin-defaults/',
  'filo://manage/',
];

// Colore di selezione del testo coerente con la palette Filo, da iniettare sui
// siti esterni. Il <link filo://style/theme.css> iniettato dal content script
// viene bloccato dalla CSP di molti siti (repubblica, reddit, youtube…), quindi
// la regola ::selection del tema non arriva mai e la selezione resta del blu di
// sistema. insertCSS() inietta a livello di user-agent e ignora la CSL della
// pagina, garantendo l'arancione Filo ovunque. Niente var() qui: i custom
// properties non si risolvono in modo affidabile dentro ::selection.
// CSS dei content script (menu tasto destro, popup, sidebar, ecc.). Sui siti
// con CSP restrittiva (YouTube, Reddit, ...) il <link filo://style/...> iniettato
// dal content script viene BLOCCATO dalla CSP della pagina: il menu Filo veniva
// creato nel DOM ma senza stile (position:static, niente sfondo/z-index) →
// invisibile, e l'utente percepiva "il tasto destro non funziona". Lo iniettiamo
// quindi anche via wc.insertCSS dal main, che ignora la CSP (come già facciamo
// per il colore della selezione). Stessa lista di page-preload.js.
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

/* Segue i token estetici (#146.1): colore/opacità della selezione arrivano
   dalle variabili di theme.css (iniettato anche qui), con fallback letterale
   per il primissimo paint quando [data-sn-theme] non è ancora impostato. */
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
    // Incognito: i tab nascono in una sessione effimera (partition senza
    // 'persist:') e la sessione del browser NON viene salvata/ripristinata su
    // disco. La privacy dello storage filo:// è invece garantita a monte
    // dall'overlay in RAM nello shim (vedi src/main/shim/storage.js).
    this.incognito = !!incognito;
    this.partition = partition || null;
    this.tabs = []; // [{ id, view, title, url, favicon, loading, canBack, canFwd }]
    this.activeId = null;
    // §1.2 — cache del colore identità per dominio (host → 'rgb(r,g,b)'). Così
    // una nuova tab su un dominio già visto mostra subito la sua tinta, senza
    // aspettare che il content script ricalcoli.
    this._identityColorCache = new Map();
    // §2.1 — ultima interazione dell'utente con Filo (qualsiasi tab/azione). Il
    // timer di auto-archiviazione misura l'inattività dell'APP da qui.
    this._lastAppInteractionAt = Date.now();
    this._triageRunning = false;
    if (!this.incognito) {
      // Controllo periodico dell'inattività (ogni 5 min). La soglia vera (ore) e
      // l'on/off vivono nelle preferenze e si leggono ad ogni tick.
      this._autoArchiveTimer = setInterval(() => {
        this._autoArchiveTick().catch(() => {});
      }, 5 * 60 * 1000);
      if (this._autoArchiveTimer.unref) this._autoArchiveTimer.unref();
    }
    // Spazio extra riservato in alto (px): usato quando un dropdown della shell
    // (es. menu App) deve restare visibile sopra la WebContentsView attiva. Si
    // abbassa la view invece di nasconderla, evitando l'area vuota/bianca.
    this.topInset = 0;
    // Modalità "contenuto a tutto schermo": la WebContentsView attiva copre
    // l'intera finestra, nascondendo la barra (tab + indirizzo) della shell.
    // Attivata dal menu (voce "Schermo intero"); si esce con Esc.
    this.contentFullscreen = false;
    // true quando il fullscreen è stato richiesto DALLA pagina (HTML5
    // requestFullscreen: pulsante "schermo intero" di YouTube/player video).
    // In quel caso l'Esc deve passare alla pagina perché esca dal suo
    // fullscreen (poi `leave-html-full-screen` ripristina la shell), invece di
    // intercettarlo noi e lasciare la pagina convinta di essere a tutto schermo.
    this.pageFullscreen = false;
    // Quale scheda ha chiesto quel fullscreen. Serve perché la deroga qui sopra
    // vale SOLO per lei: un Esc che arriva da un'altra scheda (o dalla barra di
    // Filo) alla pagina non arriverebbe mai, e lasciarlo passare chiuderebbe
    // dentro allo schermo intero senza uscite (#514).
    this.pageFullscreenTabId = null;
    // Uscita dallo schermo intero messa in attesa: l'Esc premuto sulla pagina
    // è prima suo (un riquadro di Filo aperto sopra la pagina lo usa per
    // chiudersi), e usciamo solo se nessuno se l'è preso. Vedi
    // handleFullscreenEscape (#514).
    this._escUscitaTimer = null;
    // Quanti Esc di fila la pagina si è presa senza che l'utente facesse altro.
    // Il conto sta nel main perché nella pagina il sito ci arriva (#514).
    this._escRivendicazioni = 0;
    // Chrome compatto: fuori dalla home di Filo la barra indirizzi (icone di
    // navigazione + campo URL) viene nascosta, lasciando solo la fila di tab +
    // controlli finestra. In questo stato la WebContentsView risale a coprire
    // anche lo spazio della barra indirizzi (altezza = solo la tab-row). La
    // shell decide quando attivarlo (setChromeCompact) in base alla pagina
    // attiva; qui ne teniamo solo l'altezza per il layout.
    this.chromeCompact = false;
    // Altezza della sola fila di tab (senza barra indirizzi), in sync con
    // `.tab-row { flex: 0 0 40px }` in src/renderer/shell.css.
    this.tabRowHeight = TAB_ROW_HEIGHT;
    // Snapshot delle impostazioni di sicurezza, ripopolato da setSecurity() ogni
    // volta che l'utente salva da Opzioni. I default qui rispecchiano quelli in
    // DEFAULT_SETTINGS.security così se setSecurity non viene mai chiamato la
    // protezione è comunque attiva.
    this.security = { protectIpLeak: true, blockPopups: true };
    // Modalità cookie corrente ('manual' | 'default' | 'privacy') + siti fidati.
    // Ripopolata da setSecurity quando l'utente salva. In 'privacy' ogni sito
    // naviga in una partizione effimera dedicata; i siti fidati ricevono invece
    // una partizione isolata ma PERSISTENTE (restano connessi).
    this.cookieMode = Cookies.MODES.DEFAULT;
    this.trustedSites = [];
    // #151 — nota consumo dati per tab proxate che riproducono video a lungo
    // (spec §5: una volta per SESSIONE, non bloccante). Flag globale di sessione.
    this._proxyVideoNoted = false;
    // #152 — regole proxy persistenti per dominio ("questo sito sempre da X").
    // Cache in-memory per la decisione SINCRONA "born proxied" in navigazione
    // (will-navigate/navigate/openTab non possono attendere lo storage async).
    // Sorgente di verità: SN_FILO_MEMORY.listProxyRules (storage.json).
    this._proxyRules = {};
    this.loadProxyRules().catch(() => {});
    // Ctrl +/-/0 premuti mentre il focus è sulla barra (vedi _wireShellZoomKeys).
    this._wireShellZoomKeys();
  }

  // Aggiorna le impostazioni di sicurezza e le riapplica a tutti i tab esistenti.
  // Chiamato dal main subito dopo che l'utente salva da Opzioni.
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

  // Applica la policy WebRTC sulla webContents di un singolo tab. È sicuro
  // chiamarla più volte: setWebRTCIPHandlingPolicy è idempotente.
  _applySecurity(tab) {
    if (tab.isInternal) return; // le pagine filo:// sono fidate, niente da limitare
    try {
      // Anti-leak proxy per-tab (OBBLIGATORIO, non disattivabile): in una tab
      // proxata WebRTC non deve mai aprire UDP diretto, o qualsiasi sito legge
      // l'IP reale via STUN. Vince anche su protectIpLeak=false.
      const policy = tab.proxy
        ? 'disable_non_proxied_udp'
        : (this.security.protectIpLeak ? 'default_public_interface_only' : 'default');
      tab.view.webContents.setWebRTCIPHandlingPolicy(policy);
    } catch (_) { /* policy non supportata in qualche build */ }
  }

  // Altezza in CSS px della "barra in alto" di Filo (la parte di shell NON
  // coperta dalla WebContentsView attiva): 0 a tutto schermo, solo la fila di
  // tab in chrome compatto, altrimenti l'intera shell. Serve per ritagliare lo
  // scatto della barra quando si annota tutta l'app col disegno.
  topChromeHeight() {
    if (this.contentFullscreen) return 0;
    return this.chromeCompact ? this.tabRowHeight : this.shellHeight;
  }

  // Riserva (o libera, con px=0) spazio sopra la view attiva e rifà il layout.
  setTopInset(px) {
    this.topInset = Math.max(0, Math.round(Number(px) || 0));
    this.layout();
  }

  // Entra/esce dalla modalità "contenuto a tutto schermo": la view attiva copre
  // tutta la finestra (top=0), così la barra di tab+indirizzo della shell resta
  // sotto e non è visibile. Porta anche la finestra in fullscreen OS per
  // coerenza. Idempotente. Ritorna lo stato risultante.
  setContentFullscreen(on) {
    on = !!on;
    // La modalità cambia per una strada qualunque (voce di menu, gesto di
    // sistema, assistente): un'uscita rimasta in attesa di una risposta parla
    // di un momento che non c'è più.
    this.annullaUscitaSchermoIntero();
    this.azzeraRivendicazioniEsc();
    if (this.contentFullscreen === on) return on;
    this.contentFullscreen = on;
    this.layout();
    try {
      if (typeof this.win.setFullScreen === 'function') this.win.setFullScreen(on);
    } catch (_) {}
    // Uscita per una strada che NON è l'Esc sulla pagina che aveva chiesto il
    // fullscreen (Esc da un'altra scheda, dalla barra, uscita dal fullscreen di
    // sistema, chiusura della scheda): la pagina resterebbe convinta di essere a
    // tutto schermo, col suo player disegnato a schermo pieno dentro una view
    // ormai tornata sotto la barra. Chiediamole di uscire davvero.
    if (!on && this.pageFullscreen) this._exitPageFullscreen();
    // Avvisa i content script così la voce di menu mostra "Esci da schermo
    // intero" (icona shrink) mentre la modalità è attiva.
    try {
      const type = globalThis.SN_MSG?.MSG?.FULLSCREEN_CHANGED || 'fullscreen_changed';
      this._broadcastToViews({ type, fullscreen: on });
    } catch (_) {}
    return on;
  }

  toggleContentFullscreen() {
    return this.setContentFullscreen(!this.contentFullscreen);
  }

  // Fa uscire dal fullscreen HTML5 la pagina che l'aveva chiesto, quando a
  // spegnere lo schermo intero è stato qualcun altro. Best-effort: se la scheda
  // non c'è più (chiusa, processo caduto) resta solo da dimenticarla, così la
  // deroga dell'Esc non sopravvive alla pagina che la giustificava.
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

  // Esc esce dallo schermo intero. Regola UNICA, valida per ogni porta d'ingresso
  // (menu del tasto destro, barra laterale, barra dei menu su Mac, comando
  // dell'assistente, pulsante del player di un sito, schermo intero del sistema)
  // e per ogni posto da cui il tasto può arrivare: la pagina (before-input-event
  // sulla scheda) o la barra di Filo, che a tutto schermo è nascosta sotto la
  // pagina ma continua a tenere il fuoco se l'ultimo clic era lì — era il buco
  // di #514: Esc non faceva niente e si restava chiusi dentro.
  //
  // `tabId` è la scheda da cui arriva il tasto, `null` se arriva dalla barra.
  // Ritorna true se ha gestito il tasto: chi chiama fa il preventDefault.
  //
  // La regola, in una riga: **l'Esc premuto sulla pagina è prima della pagina,
  // e la modalità esce solo se nessuno se l'è preso.** Prendercelo noi prima
  // che la pagina lo veda vuol dire scavalcare tutto quello che Filo apre sopra
  // la pagina e che si chiude con Esc — il menu del tasto destro, la risposta,
  // un'immagine ingrandita, una domanda di conferma, il QR, la selezione di una
  // parte dello schermo. Erano sei riquadri conosciuti e infiniti da scrivere:
  // una lista da tenere aggiornata a mano invecchia male, quindi non c'è più
  // lista (#514). Chi consuma il tasto lo dice (MSG.ESC_CONSUMATO) e l'uscita
  // in attesa si annulla; chi non dice niente esce, e se la pagina non risponde
  // affatto (nessun content script, renderer bloccato) esce lo stesso allo
  // scadere dell'attesa. Il caso peggiore è un'uscita in ritardo di mezzo
  // istante, mai restare chiusi dentro senza uscite.
  handleFullscreenEscape(tabId = null) {
    if (!this.contentFullscreen) return false;
    // Dalla barra di Filo, o da una scheda che non è quella davanti: la pagina
    // quel tasto non lo vedrà mai, quindi decidiamo subito noi.
    if (tabId == null || tabId !== this.activeId) {
      this.setContentFullscreen(false);
      return true;
    }
    // La pagina si è già presa gli ultimi Esc uno dopo l'altro, senza che
    // l'utente facesse nient'altro in mezzo: da qui in avanti non le crediamo
    // più e usciamo noi. È il tetto che nessun sito può azzerare.
    if ((this._escRivendicazioni || 0) >= ESC_RIVENDICAZIONI_MAX) {
      this.setContentFullscreen(false);
      return true;
    }
    // Lo schermo pieno se l'è preso la PAGINA (il pulsante del lettore video) e
    // il tasto arriva da lei. Qui il tasto NON si può lasciar passare: il
    // browser lo consuma per uscire dal suo fullscreen e il documento non lo
    // vede mai — la traccia dei tasti della pagina resta vuota — quindi ogni
    // riquadro che Filo ha aperto sopra la pagina veniva scavalcato, restava
    // aperto e la modalità se ne andava lo stesso (#514, giro 10). Ce lo
    // prendiamo noi (l'unico modo di fermare l'uscita del browser) e lo
    // consegniamo alla pagina, che poi decide con la regola di sempre.
    const nostro = this.pageFullscreen && tabId === this.pageFullscreenTabId
      ? this._inoltraEscAllaPagina(tabId)
      : false;
    this.armaUscitaSchermoIntero(tabId);
    return nostro;
  }

  // Consegna alla pagina l'Esc che il browser le avrebbe mangiato. Va al frame
  // che ha il fuoco, dove sarebbe arrivato il tasto vero: il menu del tasto
  // destro aperto dentro un riquadro incorporato vive lì. Torna true se il
  // messaggio è partito, cioè se il tasto ce lo siamo presi noi.
  _inoltraEscAllaPagina(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed?.()) return false;
    const type = globalThis.SN_MSG?.MSG?.ESC_INOLTRATO || 'esc_inoltrato';
    // Al frame con cui l'utente sta interagendo, dove sarebbe arrivato il tasto
    // vero: il menu del tasto destro aperto dentro un riquadro incorporato vive
    // lì, e consegnarlo al frame principale lo lascerebbe aperto (#405 tiene
    // aggiornato `_filoActiveFrame` a ogni interazione).
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

  // Un riquadro incorporato ha aperto qualcosa di Filo sopra lo schermo pieno,
  // ma il tasto lo può chiedere al browser solo il frame principale: la
  // richiesta gliela giriamo noi.
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

  // L'utente ha fatto qualcosa che non è l'Esc in questione: la volta dopo è una
  // volta nuova. Lo chiama chi vede l'input VERO (mai la pagina).
  azzeraRivendicazioniEsc() {
    this._escRivendicazioni = 0;
  }

  // Mette l'uscita in attesa: parte solo se nessuno rivendica il tasto. Quanto
  // si aspetta dipende da chi c'è dall'altra parte (vedi ESC_ATTESA_MS): una
  // pagina che risponde risponde comunque, e l'attesa è solo la rete di
  // sicurezza per il caso in cui non risponda mai.
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
    // Un timer non deve tenere sveglio il processo se non c'è altro da fare.
    try { this._escUscitaTimer.unref?.(); } catch (_) {}
  }

  // La pagina si è presentata: ha i pezzi di Filo dentro e a un Esc risponde
  // (rivendicandolo o chiedendo lei l'uscita). Da qui in poi il main la aspetta
  // invece di uscire a tempo. Lo dichiara il content script appena montato.
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

  // La pagina davanti dice che quell'Esc se l'è preso un riquadro di Filo.
  // Tollerante sul mittente: le schede in secondo piano il tasto non lo
  // ricevono, e un riquadro dentro un riquadro incorporato parla per la sua
  // pagina.
  escConsumato(tabId = null) {
    if (tabId != null && tabId !== this.activeId) return;
    // Conta solo se c'era davvero un'uscita in attesa: è quella la rivendicazione.
    if (this._escUscitaTimer) this._escRivendicazioni = (this._escRivendicazioni || 0) + 1;
    this.annullaUscitaSchermoIntero();
  }

  // Attiva/disattiva il "chrome compatto": quando true la barra indirizzi è
  // nascosta dalla shell e la WebContentsView attiva risale a coprire anche il
  // suo spazio (top = tabRowHeight invece di shellHeight). La shell lo richiama
  // a ogni cambio di pagina attiva: compatto sui siti, esteso sulla home Filo.
  // Idempotente.
  setChromeCompact(on) {
    on = !!on;
    if (this.chromeCompact === on) return on;
    this.chromeCompact = on;
    this.layout();
    return on;
  }

  // #514 — a OGNI frame, non al solo frame principale. Dentro i riquadri
  // incorporati di un sito (il video, la mappa, il blocco commenti) girano i
  // pezzi di Filo come nella pagina che li ospita: lì c'è il menu del tasto
  // destro, e lì l'Esc va deciso. Mandando l'annuncio al solo frame principale,
  // un riquadro che c'era già quando la modalità è cambiata non lo sapeva mai
  // più: la sua voce del menu diceva «Schermo intero» a chi ci era già dentro
  // (e «Esci da schermo intero» a chi ne era già uscito, rimettendocelo con un
  // clic), e il suo Esc chiudeva il menu portandosi via anche la modalità.
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

  // ─── lifecycle ──────────────────────────────────────────────────────────

  // Partizione (sessione Electron) che una view per `url` deve usare:
  //   - incognito → la partizione effimera della finestra (già isolata);
  //   - privacy + pagina esterna → partizione per-sito (eTLD+1): effimera per i
  //     siti normali (non sopravvive alla sessione), persistente per i siti
  //     fidati (resti connesso), sempre isolata dagli altri siti;
  //   - altrimenti → null (sessione persistente di default della finestra).
  // Le pagine filo:// usano sempre la sessione della finestra (serve a storage
  // e protocollo), mai una partizione per-sito.
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

  // Partizione effettiva per `tab` su `url`: una tab proxata ("Apri da un
  // altro paese") vive nella sua partition dedicata proxy:<tabId> finché vive,
  // su qualsiasi pagina esterna. Partition diversa = cookie jar separato: la
  // tab proxata NON condivide i login con le altre (isolamento voluto, da non
  // rompere). Le pagine filo:// restano nella sessione normale anche su tab
  // proxate (sono interne, niente traffico da instradare).
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
      // Per le pagine interne (filo://) usiamo contextIsolation:false così
      // possiamo overwritare window.chrome direttamente — i file portati
      // dall'estensione si aspettano chrome.* in scope globale. Le pagine
      // web esterne mantengono l'isolation (codice non fidato).
      contextIsolation: !isInternal,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: true,
      // #405 — i riquadri incorporati (video, mappe, commenti, moduli) sono
      // iframe: senza questo flag il preload — e quindi TUTTO Filo (menu del
      // tasto destro, correttore, Spiegazione/Traduci, Incolla con cronologia)
      // — girava solo nel frame principale, e dentro il riquadro il tasto
      // destro non produceva nulla. Con nodeIntegrationInSubFrames il preload
      // parte in ogni sottoframe; `nodeIntegration` resta false e
      // contextIsolation true, quindi il codice della pagina (incluso quello
      // di terze parti dentro l'iframe) NON guadagna alcun accesso a Node né
      // allo shim chrome.*, che vivono solo nel mondo isolato del preload.
      // Il costo si paga solo dove serve: nei sottoframe page-preload.js
      // carica i content script alla PRIMA interazione, non al caricamento.
      ...(isInternal ? {} : { nodeIntegrationInSubFrames: true }),
      // partition: incognito (effimera della finestra) o per-sito in privacy.
      ...(partition ? { partition } : {}),
    };
    // #145 — le tab RIPRISTINATE alla riapertura di Filo non devono far ripartire
    // i media da sole (es. i video YouTube che ripartivano tutti insieme al boot).
    // Passiamo un flag al preload della pagina (page-preload.js), che mette in
    // pausa qualunque media tenti di autopartire finché l'utente non interagisce
    // con quella scheda. NB: webPreferences.autoplayPolicy non è onorato dalle
    // WebContentsView in Electron 33, perciò il blocco lo fa il preload.
    if (opts.suppressAutoplay && !isInternal) {
      webPreferences.additionalArguments = [
        ...(webPreferences.additionalArguments || []),
        '--filo-suppress-autoplay',
      ];
    }
    const view = new WebContentsView({ webPreferences });
    // #410.1 — segui gli scaricamenti anche sulle sessioni NON predefinite
    // (privacy per-sito, proxy "apri da un altro paese"): senza questo, un
    // download partito da una scheda proxata/privacy resterebbe "al buio".
    // Le finestre incognito sono ESCLUSE di proposito: "nessuna traccia" vale
    // anche per i download, che quindi non entrano nella cronologia condivisa
    // (in incognito il browser usa comunque il suo salvataggio nativo).
    if (!this.incognito) {
      try { require('./services/downloads').attachSession(view.webContents.session); } catch (_) {}
    }
    installaPermessi(view.webContents.session);
    return view;
  }

  // Apre una scheda e ritorna il solo id (null se l'apertura è stata negata).
  // È la forma usata ovunque; chi deve SPIEGARE un rifiuto usa openTabResult.
  openTab(url = 'filo://newtab/', opts = {}) {
    return this.openTabResult(url, opts).id;
  }

  // Come openTab, ma ritorna l'esito per esteso: { id, blocked, host }.
  //   blocked: '' consentita | 'scheme' schema non-web | 'site' lista dei siti
  //            bloccati (#590) — la chat lo dice invece di tacere (#482) |
  //            'address' non è un indirizzo apribile (#590).
  // Opzioni oltre a quelle di openTab:
  //   fromUrl:  pagina di partenza / referrer, per l'eccezione "arrivo da un
  //             motore di ricerca" (la passa chi quel referrer ce l'ha, cioè
  //             setWindowOpenHandler).
  //   overrideSiteBlock: scavalco VOLUTO DALL'UTENTE ("Apri comunque").
  openTabResult(url = 'filo://newtab/', { activate = true, restoreScrollPct = null, restoreZoomLevel = null, suppressAutoplay = false, allowDuplicate = false, openedByLink = false, fromUrl = '', overrideSiteBlock = false } = {}) {
    // #252 — INDIRIZZO UNICO per le pagine interne: riporta l'eventuale forma
    // legacy `filo://src/pages/<page>/<file>` (dallo shim getURL) alla forma
    // canonica `filo://<page>/<file>` che usa il menu. Così tutti i punti di
    // ingresso convergono su un solo URL, qualunque chiamante li apra.
    if (typeof url === 'string' && url.startsWith('filo://')) url = canonicalizeFiloUrl(url);

    // #590 — INDIRIZZO "NUDO" (senza schema davanti). navigate() lo riduceva già
    // alla sua forma navigabile prima di ogni controllo; qui no, e la differenza
    // costava due cose: la scheda nasceva BIANCA (loadURL non sa che farsene di
    // "sito.esempio/pagina") mentre la chat raccontava di averla aperta, e i
    // controlli qui sotto — schemi non-web e lista dei siti bloccati — lo
    // vedevano come un indirizzo che non parsa e lo lasciavano passare senza
    // guardarlo. Un modello che propone l'indirizzo senza "https://" davanti
    // (capita, soprattutto coi modelli piccoli) bastava a scavalcare la lista.
    // Se non parsa e NON somiglia a un indirizzo, non c'è niente da aprire:
    // meglio dirlo che aprire una scheda bianca e chiamarla successo.
    if (typeof url === 'string' && !parsesAsUrl(url)) {
      const NAV = globalThis.SN_URL_NAV;
      if (NAV && NAV.looksLikeAddress(url)) url = normalizeUrl(url);
      else return { id: null, blocked: 'address', host: '' };
    }

    // #252 — DEDUPLICA le pagine singleton: se la pagina interna è già aperta
    // in una scheda, riportaci l'utente invece di duplicarla. Solo per aperture
    // in primo piano volute dall'utente (click su menu/link) e non quando si
    // chiede esplicitamente una copia (Duplica scheda → allowDuplicate). Le
    // aperture in background (activate:false) creano schede vere, come prima.
    if (activate && !allowDuplicate) {
      const key = filoSingletonKey(url);
      if (key) {
        const existing = this.tabs.find((t) => filoSingletonKey(t.url) === key);
        if (existing) {
          // URL identico → basta riportare a fuoco. Differisce solo per query/
          // hash (es. ?highlight=…) → rinaviga la scheda esistente al nuovo URL
          // così l'intento (evidenziare l'elemento appena salvato) si applica.
          if (existing.url !== url) this.navigate(existing.id, url);
          this.activate(existing.id);
          return { id: existing.id, blocked: '', host: '' };
        }
      }
    }
    // SICUREZZA (#247) — will-navigate e setWindowOpenHandler bloccano solo le
    // navigazioni che Electron origina da sé (click, window.open): un
    // loadURL() PROGRAMMATICO come questo NON emette will-navigate, quindi
    // quel gate non protegge questo percorso. Qui convergono TUTTI gli
    // handler IPC che aprono una scheda (content script via MSG.OPEN_URL /
    // MSG.OPEN_NEW_TAB / chrome.tabs.create → _tabs:create, l'archivio, la
    // shell): un controllo unico qui chiude ogni percorso presente e futuro,
    // invece di doverlo ripetere in ciascun chiamante (e rischiare di
    // dimenticarne uno, come accaduto). I chiamanti che filtrano già a monte
    // (es. setWindowOpenHandler, l'azione NAVIGA dell'agente) restano
    // corretti: qui il controllo è semplicemente ridondante per loro.
    // NB: questo blocco è già stato perso una volta per un revert accidentale
    // dei merge automatici tra worktree (commit da660251) — se lo tocchi,
    // assicurati che il percorso IPC → openTab(file://) resti bloccato.
    if (isWebUnsafeNav(url)) {
      openExternalScheme(url); // mailto:/tel:/sms: → consegnati all'OS, il resto bloccato
      return { id: null, blocked: 'scheme', host: '' };
    }
    // SICUREZZA (#590) — la LISTA DEI SITI BLOCCATI, sullo stesso cammino e per
    // lo stesso motivo del gate qui sopra: will-navigate non scatta su un
    // loadURL programmatico, quindi senza questo controllo la lista non valeva
    // per l'indirizzo scritto dall'utente nella home, né per l'azione NAVIGA
    // che propone il modello. Un controllo unico qui copre ogni chiamante
    // presente e futuro. L'unico scavalco è quello che l'utente sceglie a mano
    // sulla notifica ("Apri comunque" → openBlockedPopup).
    if (!overrideSiteBlock) {
      const blocco = this._maybeBlockNavigation(url, { fromUrl });
      if (blocco) return { id: null, blocked: 'site', host: blocco.host };
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
      // Quando la tab è stata aperta — metadato dell'archivio (§3.1).
      openedAt: new Date().toISOString(),
      // §2.1 segnali per la decisione di auto-archiviazione (popolati a runtime).
      lastActiveAt: activate ? Date.now() : null,
      lastInteractionAt: activate ? Date.now() : null,
      audible: false,
      scrollPct: 0,
      formDirty: false,
      // §3.1 — quando si riapre una scheda dall'archivio, ripristina la posizione
      // di scroll registrata (percentuale). Applicato una volta a fine caricamento.
      restoreScrollPct: typeof restoreScrollPct === 'number' ? restoreScrollPct : null,
      // Duplicazione tab: ripristina il livello di zoom della scheda sorgente
      // (Electron zoom "level", 0 = 100%). Applicato una volta a fine caricamento.
      restoreZoomLevel: typeof restoreZoomLevel === 'number' ? restoreZoomLevel : null,
      partition,
      partitionSite: isInternal ? null : Cookies.registrableOf(url),
      // Proxy per-tab ("Apri da un altro paese"): { country, tier } finché la
      // tab è instradata da un altro paese, null altrimenti. Vedi setTabProxy.
      proxy: null,
      // #145 — tab nata da un ripristino di sessione: l'autoplay resta bloccato
      // (vedi _makeView). Memorizzato sulla tab così sopravvive a _recreateView
      // (es. se la tab viene proxata alla nascita per una regola di dominio).
      suppressAutoplay: !!suppressAutoplay,
      // #441 — scheda nata da un link target=_blank / window.open (non aperta e
      // indirizzata dall'utente): è la prima condizione perché possa essere
      // riconosciuta come pagina-ponte di uno scaricamento (vedi
      // handleDownloadStarted e src/shared/downloadTabs.js).
      _openedByLink: !!openedByLink,
    };

    this._wireEvents(tab);
    this._applySecurity(tab);
    this.win.contentView.addChildView(view);
    this.tabs.push(tab);

    // IMPORTANTE: setBounds PRIMA di loadURL così la WebContentsView ha una
    // dimensione valida quando il compositor alloca il display surface.
    // Caricare con bounds 0x0 può far andare in fallimento le capturePage
    // successive con "Current display surface not available".
    if (activate) {
      this.activeId = id;
      tab.activateSeq = this._nextActivationSeq();
      this.layout();
    } else {
      // Scheda in SECONDO PIANO (#376): non ruba il primo piano. layout() le dà
      // bounds {0,0,0,0} — senza questa chiamata la view appena creata resta con
      // i bounds di default e può disegnarsi sopra la scheda attiva (stesso
      // motivo per cui _recreateView chiama layout() anche sulle non attive).
      // NB: NON chiamiamo setVisible(false): per Chromium la scheda resta
      // "visibile" (grande 0×0) e può quindi far partire i media da sola — è
      // ciò che rende utile aprire in sottofondo un brano o una radio. La
      // visibilità viene poi normalizzata al primo cambio di scheda (activate).
      this.layout();
    }
    view.webContents.loadURL(url);
    if (activate) {
      // Riaffermo la visibilità su tutti i tab dopo loadURL.
      for (const t of this.tabs) t.view.setVisible?.(t.id === id);
    }
    // #152 — born proxied: se il dominio ha una regola persistente, la scheda
    // nasce instradata da quel paese (ricrea la view nella partition proxata).
    this._maybeApplyDomainRule(tab, url);
    this._broadcast();
    return { id, blocked: '', host: '' };
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    // Se la scheda che se ne va è quella che aveva chiesto il fullscreen al
    // sito (Ctrl+W funziona anche a tutto schermo), lo schermo intero resterebbe
    // acceso con la deroga dell'Esc appesa a una pagina che non esiste più:
    // nessun tasto ne uscirebbe. Spegniamolo insieme a lei (#514).
    if (this.pageFullscreenTabId === id) {
      this.pageFullscreen = false;
      this.pageFullscreenTabId = null;
      this.setContentFullscreen(false);
    }
    // Un'uscita dallo schermo intero in attesa della risposta di questa scheda
    // non ha più nessuno che risponda: se la scheda se ne va, l'attesa se ne va
    // con lei (a spegnere la modalità, se serve, ci pensa il giro qui sopra).
    this.annullaUscitaSchermoIntero();
    // §3.1/§4 — "Chiudi = archivia": prima di distruggere la view salviamo i
    // metadati della tab nell'archivio (consultabile da filo://archive).
    this._archiveClosedTab(tab);
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      // Chiudendo la tab attiva, torna alla PENULTIMA tab che l'utente stava
      // guardando (la più recente per lastActiveAt fra quelle rimaste), non
      // semplicemente a quella a sinistra. Fallback all'adiacente se nessuna
      // delle rimanenti è mai stata attivata (es. tutte aperte in background).
      const next = this._mostRecentlyActiveTab() || this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/'); // niente tab → nuovo newtab
    }
    this._broadcast();
  }

  // Contatore monotòno di attivazione: ordina le tab per "ultima volta vista"
  // in modo deterministico anche quando due attivazioni cadono nello stesso ms
  // (Date.now() non basta). Ogni activate/apertura-attiva incrementa il seq.
  _nextActivationSeq() {
    this._activationSeq = (this._activationSeq || 0) + 1;
    return this._activationSeq;
  }

  // Tab rimasta vista più di recente (= la penultima che l'utente stava
  // guardando prima di quella corrente). Ignora le tab mai attivate.
  _mostRecentlyActiveTab() {
    let best = null;
    for (const t of this.tabs) {
      if (!t.activateSeq) continue;
      if (!best || t.activateSeq > best.activateSeq) best = t;
    }
    return best;
  }

  // La scheda WEB (non filo://) su cui agire quando Filo cambia l'estetica del
  // contenuto via chat (#185). Di norma è la scheda attiva; ma la chat di Filo
  // vive in una scheda interna (dashboard/newtab), quindi se l'attiva è interna
  // ripieghiamo sull'ultima scheda web che l'utente ha guardato (activateSeq più
  // alto). Null se non c'è alcuna pagina web aperta.
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

  // Inietta un blocco CSS (già sanificato a monte) nella scheda web attiva.
  // insertCSS ignora la CSP del sito (come già facciamo per ::selection e per
  // gli stili dei content script), così l'estetica si applica ovunque. Tracciamo
  // le chiavi sulla tab per poterle rimuovere con clearPageStyle. Il CSS è
  // effimero: una navigazione/reload lo azzera da sé (le chiavi diventano stale,
  // removeInsertedCSS le ignora senza errori).
  async applyPageStyle(css, tabArg = null) {
    if (!css || typeof css !== 'string') return { ok: false, reason: 'empty-css' };
    const tab = tabArg || this._activeWebTab();
    if (!tab || !tab.view || !tab.view.webContents) return { ok: false, reason: 'no-web-tab' };
    try {
      // insertCSS è ASINCRONO: ritorna una Promise che risolve nella "chiave"
      // da passare a removeInsertedCSS per togliere lo stile. Va attesa, altrimenti
      // memorizzeremmo la Promise come chiave e il ripristino non troverebbe lo stile.
      const key = await tab.view.webContents.insertCSS(css);
      (tab._filoStyleKeys || (tab._filoStyleKeys = [])).push(key);
      return { ok: true, key, tabId: tab.id };
    } catch (e) {
      console.warn('[Filo] applyPageStyle fallita', e?.message || e);
      return { ok: false, reason: 'insert-failed' };
    }
  }

  // Rimuove tutte le modifiche estetiche che Filo ha iniettato nella scheda web
  // attiva. Reversibilità dell'azione STILE_PAGINA (#185).
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

  // Sposta la tab `id` alla posizione `toIndex` nell'ordine della barra (drag &
  // drop nella shell). Riordina solo l'array `this.tabs` (l'ordine non incide
  // sul layout delle WebContentsView native, solo su snapshot + sessione) e
  // ridisegna. Ritorna true se l'ordine è cambiato.
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

  // Chiude TUTTE le tab e lascia una singola newtab fresca (come Chrome quando
  // si chiude l'ultima scheda: la finestra resta, con una scheda vuota).
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

  // §3.1 — archivia i metadati di una tab che sta per essere chiusa. Best-effort
  // e non bloccante (l'archivio è async; la chiusura della view prosegue subito).
  // NON archivia: sessioni incognito (privacy, §5), pagine interne filo:// e la
  // newtab (non sono "siti" da ritrovare). Senza store caricato, è un no-op.
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
          // §"Apri da un altro paese": se la tab era instradata da un altro
          // paese, salva la location così la riapertura dall'archivio rinasce
          // proxata sulla stessa location (vedi REOPEN_ARCHIVED_TAB).
          proxy: tab.proxy && tab.proxy.country
            ? { country: tab.proxy.country, tier: tab.proxy.tier || null }
            : null,
        }),
      ).then((entry) => {
        // §3.1/§3.2 — arricchisci (riassunto + embedding + snippet) in background,
        // così la tab è cercabile semanticamente e mostra una sintesi. Best-effort.
        if (entry && entry.id) {
          try { globalThis.SN_TAB_ENRICH && globalThis.SN_TAB_ENRICH(entry.id, enrichPayload); } catch (_) {}
        }
      }).catch(() => {});
    } catch (_) { /* l'archiviazione non deve mai bloccare la chiusura */ }
  }

  // Silenzia/riattiva l'audio della tab. Lo stato vive sul tab (non sul
  // WebContents) così sopravvive a una _recreateView. Idempotente.
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

  // ─── proxy per-tab ("Apri da un altro paese", vedi proxy-per-tab-spec.md) ──

  // Instrada la tab attraverso un endpoint nel paese richiesto. La tab viene
  // ricreata nella partition dedicata proxy:<tabId> (cookie jar separato dal
  // resto del browser) con il proxy applicato alla sua session; la scelta vive
  // finché vive la tab. `tier` è 'datacenter' (default) o 'residential'.
  async setTabProxy(id, country, { tier } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return { ok: false, error: 'no_tab' };
    let settings = null;
    try { settings = await this._readSettings(); } catch (_) {}
    // Senza paese esplicito (click diretto su "Apri da un altro paese") si usa
    // l'ultima location usata, altrimenti il default delle impostazioni (USA).
    // Un paese esplicito ma non valido resta un errore: mai proxare in silenzio
    // verso un paese diverso da quello chiesto.
    const p = (settings && settings.proxy) || {};
    const code = country
      ? ProxyTab.normalizeCountry(country)
      : (ProxyTab.normalizeCountry(p.lastCountry) || ProxyTab.normalizeCountry(p.defaultCountry) || 'us');
    if (!code) return { ok: false, error: 'bad_country' };
    const resolved = ProxyTab.resolve(code, { tier, settings });
    if (!resolved) return { ok: false, error: 'not_configured' };
    const partition = `proxy:${tab.id}`;
    // Niente prefisso persist: → la session proxata è effimera (in RAM): i suoi
    // cookie non sopravvivono alla chiusura dell'app. setProxy va applicato e
    // ATTESO prima di creare la view, o le prime richieste partirebbero dirette.
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
    // Ricrea la view nella partition proxata sullo stesso URL (la ricreazione
    // applica anche l'anti-leak WebRTC via _applySecurity). Vale anche per il
    // cambio paese di una tab già proxata: stessa partition, proxy aggiornato,
    // reload attraverso il nuovo endpoint.
    this._recreateView(tab, tab.url || 'filo://newtab/');
    // Memorizza l'ultima location usata: è il default del prossimo click
    // diretto su "Apri da un altro paese". Best-effort.
    try { globalThis.SN_STORAGE?.updateSettings?.({ proxy: { lastCountry: code } }); } catch (_) {}
    return { ok: true, country: code, tier: resolved.tier };
  }

  // "Torna in Italia": rimuove il proxy dalla tab, che viene ricreata nella
  // sessione normale (stesso URL, connessione diretta).
  clearTabProxy(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return { ok: false, error: 'no_tab' };
    if (!tab.proxy) return { ok: true };
    tab.proxy = null;
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    this._recreateView(tab, tab.url || 'filo://newtab/');
    return { ok: true };
  }

  // "Torna in Italia" su TUTTE le tab instradate da un altro paese (comando
  // "chiudi/togli tutte le tab proxate", #152). Ritorna quante ne ha riportate.
  clearAllProxies() {
    let n = 0;
    for (const t of this.tabs) {
      if (t.proxy) { this.clearTabProxy(t.id); n += 1; }
    }
    return n;
  }

  // ─── regole proxy persistenti per dominio (#152) ───────────────────────────

  // Ricarica la cache in-memory delle regole dallo storage (memoria a lungo
  // termine di Filo). Best-effort: in caso d'errore tiene la cache precedente.
  async loadProxyRules() {
    try {
      const FM = globalThis.SN_FILO_MEMORY;
      this._proxyRules = (FM && (await FM.listProxyRules())) || {};
    } catch (_) {
      this._proxyRules = this._proxyRules || {};
    }
    return this._proxyRules;
  }

  // Regola persistente per l'URL (match sul dominio registrabile), o null.
  // Sincrono: usato in will-navigate dove non si può attendere lo storage.
  _ruleForUrl(url) {
    if (!url || url.startsWith('filo://') || !/^https?:\/\//i.test(url)) return null;
    const dom = Cookies.registrableOf(url);
    return (dom && this._proxyRules && this._proxyRules[dom]) || null;
  }

  // Se `url` ha una regola persistente e la tab non è già instradata su quel
  // paese, avvia il proxy (born proxied). NON blocca né previene la navigazione:
  // setTabProxy ricrea la view nella partition proxata SOLO se il provider è
  // configurato — altrimenti è un no-op silenzioso e la pagina resta diretta
  // (mai una tab "appesa" perché il proxy non è configurato). Ritorna true se
  // ha avviato l'instradamento. Incognito escluso (nessuna persistenza, §6).
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

  // Salva la regola "questo sito sempre da <paese>" e la applica subito alle
  // tab già aperte su quel dominio. `domain` può essere un host nudo o una URL:
  // lo riduciamo al dominio registrabile — la STESSA chiave usata dal match in
  // navigazione (_ruleForUrl), così la regola scatta davvero alla riapertura.
  async setDomainProxyRule(country, { domain } = {}) {
    const code = ProxyTab.normalizeCountry(country);
    if (!code) return { ok: false, error: 'bad_country' };
    const src = String(domain || '');
    const dom = src ? Cookies.registrableOf(/:\/\//.test(src) ? src : `https://${src}`) : null;
    if (!dom) return { ok: false, error: 'no_domain' };
    const FM = globalThis.SN_FILO_MEMORY;
    if (FM) await FM.setProxyRule(dom, { country: code });
    await this.loadProxyRules();
    // Applica subito alle tab già aperte su quel dominio (born proxied immediato).
    for (const t of this.tabs) {
      if (t.isInternal || !/^https?:\/\//i.test(t.url || '')) continue;
      if (Cookies.registrableOf(t.url) !== dom) continue;
      if (t.proxy && t.proxy.country === code) continue;
      try { await this.setTabProxy(t.id, code); } catch (_) {}
    }
    return { ok: true, domain: dom, country: code };
  }

  // Toglie la regola persistente per il dominio. Non tocca le tab già proxate
  // (l'utente può "tornare in Italia" a parte): rimuove solo l'automatismo
  // futuro alla navigazione.
  async removeDomainProxyRule({ domain } = {}) {
    const src = String(domain || '');
    const dom = src ? Cookies.registrableOf(/:\/\//.test(src) ? src : `https://${src}`) : null;
    if (!dom) return { ok: false, error: 'no_domain' };
    const FM = globalThis.SN_FILO_MEMORY;
    if (FM) await FM.removeProxyRule(dom);
    await this.loadProxyRules();
    return { ok: true, domain: dom };
  }

  // ─── §2.1 auto-archiviazione / riordino ─────────────────────────────────

  async _readSettings() {
    try { return await globalThis.SN_STORAGE?.getSettings?.(); } catch (_) { return null; }
  }

  // Tick periodico: se Filo è inattivo da ≥ soglia (preferenze), avvia il triage.
  async _autoArchiveTick() {
    if (this.incognito || this._triageRunning) return;
    const s = await this._readSettings();
    const aa = s && s.autoArchive;
    if (!aa || !aa.enabled || !aa.onIdle) return;
    const hours = Number(aa.idleHours) > 0 ? Number(aa.idleHours) : 6;
    if (Date.now() - this._lastAppInteractionAt < hours * 3600 * 1000) return;
    await this.runAutoTriage({ trigger: 'idle' });
    // Evita ritrigger immediato finché l'utente non torna a usare Filo.
    this._lastAppInteractionAt = Date.now();
  }

  // Candidati archiviabili: schede web + pagine interne EFFIMERE (home/nuova
  // scheda, impostazioni), non attiva, non in riproduzione audio. Prima erano
  // esclusi TUTTI i filo:// interni, quindi il riordino poteva chiudere un sito
  // (es. YouTube) ma mai le impostazioni aperte o le home duplicate. (Incognito
  // è escluso a monte: niente timer in incognito.)
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

  // Esegue un giro di triage: raccoglie i candidati, collassa i DUPLICATI esatti
  // in modo deterministico (home duplicate / doppioni — mai lasciato al giudizio
  // dell'LLM), poi chiede all'LLM (batch su tutte le tab) per i casi di giudizio
  // (feed consumati, dead-end, impostazioni ormai chiuse) e applica le decisioni.
  // Se l'LLM manca o fallisce, i duplicati vengono comunque collassati.
  async runAutoTriage({ trigger = 'idle' } = {}) {
    if (this.incognito || this._triageRunning) return { archived: 0 };
    const cands = this._triageCandidates();
    if (!cands.length) return { archived: 0 };
    this._triageRunning = true;
    try {
      // 1) Duplicati esatti: decisione deterministica e affidabile.
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

      // 2) LLM per il resto (giudizio). No-op sui duplicati (già decisi sopra).
      const decide = globalThis.SN_TAB_TRIAGE_DECIDE;
      let decisions = [];
      if (typeof decide === 'function') {
        try {
          const input = await this._gatherTriageInput(cands);
          const r = await decide({ tabs: input, trigger });
          decisions = Array.isArray(r && r.decisions) ? r.decisions : [];
        } catch (_) { decisions = []; }
      }

      // 3) Fondi: i duplicati deterministici vincono sempre su "keep".
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

  // Applica le decisioni LLM: archivia+chiude le tab marcate 'archive' (mai la
  // attiva o con audio — salvaguardia), poi riordina cromaticamente i superstiti
  // (§1.3) e mostra il toast (§2.3). `cands` è l'elenco indicizzato passato all'LLM.
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

    // §1.3 — riordino cromatico della striscia. Avviene a OGNI giro di triage
    // (riapertura di Filo, inattività, richiesta manuale), NON solo quando
    // qualcosa è stato archiviato: all'apertura l'utente si aspetta comunque la
    // barra riordinata per colore anche se non c'era nulla da chiudere. Se
    // l'ordine non cambia (tab senza identità, una sola tab) è un no-op e non
    // ribroadcastiamo inutilmente.
    const reordered = this.reorderTabsByColor();
    if (toArchive.length || reordered) this._broadcast();
    if (toArchive.length) this._showTriageToast(toArchive.length);
    return { archived: toArchive.length };
  }

  // §1.3 — riordina la striscia per colore (arcobaleno) in base all'identityColor.
  // Le tab senza colore (interne, identità ignota) restano in coda nell'ordine.
  // Ritorna true se l'ordine è effettivamente cambiato (per decidere se
  // ribroadcastare alla shell).
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

  // Riordino cromatico ESPLICITO ("/riordina"): riordina la striscia per colore
  // come alla riapertura di Filo (§1.3), ma SENZA archiviare/chiudere nulla — a
  // differenza del triage tutte le tab restano aperte. Ribroadcasta (e quindi
  // ripersiste la sessione col nuovo ordine) solo se l'ordine è cambiato davvero.
  // Ritorna { reordered } così la dashboard può dare feedback all'utente.
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

  // "Vetro smerigliato" (§1.1): registra il colore dominante della cima della
  // pagina, campionato dal content script. Solo se cambia davvero (i sample
  // arrivano spesso durante lo scroll) per non inondare la shell di redraw.
  setTabColor(id, color) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const next = color || null;
    if (tab.color === next) return;
    tab.color = next;
    this._broadcast();
  }

  // Colore IDENTITÀ del sito (§1.2): theme-color/manifest/favicon calcolato dal
  // content script. Lo cachiamo per dominio (calcolo una volta sola, come da
  // spec) e lo mettiamo sullo snapshot; la shell lo applica ATTENUATO alle tab
  // inattive. A differenza del colore live (§1.1) non cambia con lo scroll né si
  // azzera a ogni navigazione: persiste finché la tab resta sullo stesso dominio.
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

  // Apre una copia della tab (stesso URL), attivandola — come "Duplica" di Chrome.
  // A differenza di Chrome, replica anche lo zoom e la posizione di scroll della
  // scheda sorgente: la copia è davvero "uguale a com'era", non solo stesso URL.
  // Ritorna l'id della nuova tab, o null se l'originale non esiste.
  async duplicateTab(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return null;
    // Zoom: leggibile in modo sincrono dal webContents (0 = 100%).
    let zoomLevel = null;
    try { zoomLevel = tab.view.webContents.getZoomLevel(); } catch (_) {}
    // Scroll: prova a leggere la posizione ESATTA dalla pagina sorgente (più
    // precisa del segnale `scrollPct` arrotondato dal content script); se la
    // pagina non risponde (es. interna senza diritto di esecuzione) ricadi sul
    // valore già tracciato.
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
      // "Duplica" chiede ESPLICITAMENTE una copia: salta la deduplica #252 delle
      // pagine interne, altrimenti riporterebbe solo a fuoco l'originale.
      allowDuplicate: true,
    });
  }

  // Voce "Aiuto" del menu tasto destro su tab: apre la sidebar Aiuto (l'agente
  // con visione) SU quella scheda, passandole il contesto "invocata da click
  // sulla tab" (url + titolo) così l'agente sa da dove parte. Riusa lo stesso
  // canale degli shortcut (page-preload / internal-preload → MSG.SHORTCUT_TRIGGERED).
  // Anche le pagine interne filo:// lo gestiscono (adattatore in internal-preload.js),
  // esattamente come Alt+H.
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
    // §2.1 segnale: quando una tab diventa attiva è "usata adesso". Aggiorna sia
    // il momento di ultima attivazione sia l'ultima interazione (proxy grossolano;
    // il content script raffina con i veri eventi di input).
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

  // §2.1 — segnali di attività riportati dal content script (input, scroll,
  // form sporco). Merge parziale sullo snapshot. Best-effort: throttled lato
  // pagina, qui non rimbalziamo se nulla cambia in modo significativo.
  setTabActivity(id, activity) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !activity || typeof activity !== 'object') return;
    // Qualsiasi attività in una tab conta come "Filo è in uso": resetta il
    // contatore di inattività dell'app (§2.1).
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
    // SICUREZZA (#590) — e la lista dei siti bloccati, per lo stesso motivo:
    // questa è la strada dell'indirizzo scritto a mano nella barra della shell
    // (tabs:navigate), che prima non incontrava nessun controllo. Nessun
    // fromUrl: la pagina su cui si trova la scheda non è il referrer di un
    // indirizzo digitato, e non deve poter aprire l'eccezione "arrivo da un
    // motore di ricerca" solo perché la scheda stava su Google.
    if (this._maybeBlockNavigation(target)) return;
    // La WebContentsView va RICREATA (non basta un loadURL) quando cambia la
    // partizione (privacy, fra siti diversi) oppure quando si attraversa il
    // confine di fiducia interno↔esterno: il preload e contextIsolation sono
    // fissati alla creazione della view e un loadURL non li rivaluta, quindi
    // riusare la view caricherebbe il contenuto col preload sbagliato.
    if (this._needsRecreate(tab, target)) {
      this._recreateView(tab, target);
    } else {
      tab.view.webContents.loadURL(target);
    }
    // #152 — born proxied: se il dominio di destinazione ha una regola
    // persistente e la scheda non è già instradata su quel paese, instradala.
    // Dopo il caricamento normale (mai prima): se il provider non è configurato
    // resta la connessione diretta appena caricata, senza appendere la scheda.
    this._maybeApplyDomainRule(tab, target);
  }

  // true se navigare `tab` verso `url` richiede una partizione diversa da quella
  // con cui la view è stata creata: in modalità privacy fra siti diversi, oppure
  // entrando/uscendo dalla partition proxata di una tab "da un altro paese".
  _needsRepartition(tab, url) {
    const next = this._partitionForTab(tab, url);
    return (next || null) !== (tab.partition || null);
  }

  // true se l'URL di destinazione attraversa il confine di FIDUCIA della view.
  // La view nasce con un preload scelto in base all'internal-ness dell'URL:
  // filo:// → preload privilegiato + contextIsolation:false (espone window.filo
  // e chrome.storage); web esterno → preload isolato. Quel preload è legato al
  // WebContents e NON cambia con un loadURL. Navigare una scheda interna verso un
  // sito esterno sullo stesso WebContents farebbe quindi girare contenuto NON
  // fidato col preload privilegiato (lettura chiavi API + dati). Va ricreata.
  _crossesTrustBoundary(tab, url) {
    const nextInternal = String(url || '').startsWith('filo://');
    return nextInternal !== !!tab.isInternal;
  }

  // La view va ricreata (non basta un loadURL) se cambia partizione (privacy) o
  // se si attraversa il confine di fiducia interno↔esterno (preload sbagliato).
  _needsRecreate(tab, url) {
    return this._crossesTrustBoundary(tab, url) || this._needsRepartition(tab, url);
  }

  // Ricrea la WebContentsView di `tab` nella partizione corretta per `url`,
  // preservando id/posizione/stato attivo. Necessario in privacy ai cambi di
  // sito: la partizione non è modificabile dopo la creazione della view.
  // NOTA: la cronologia avanti/indietro è per-WebContents, quindi attraversare
  // un confine di sito in privacy riparte con cronologia pulita (è il prezzo
  // dell'isolamento per-sito; resta intatta entro lo stesso sito).
  // `opts.loadUrl` (#327): URL da caricare al posto di `url` — la view resta
  // configurata (preload/partition/isInternal) per `url`. Usato dal recupero
  // crash per mostrare la pagina d'errore in una view pronta a ritentare il sito.
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
    // Lo stato "mutato" è una scelta dell'utente sulla tab, non sul WebContents:
    // la nuova view nasce con audio attivo, quindi riapplichiamo tab.muted.
    try { view.webContents.setAudioMuted(!!tab.muted); } catch (_) {}
    this.win.contentView.addChildView(view);
    if (wasActive) this.activeId = tab.id;
    // layout() dà alla scheda attiva i bounds pieni e a TUTTE le altre {0,0,0,0}.
    // Va chiamato anche quando si ricrea una scheda NON attiva: la sua view
    // appena creata avrebbe altrimenti bounds di default e potrebbe disegnarsi
    // sopra la scheda attiva.
    this.layout();
    view.webContents.loadURL(opts.loadUrl || url);
    // Visibilità coerente con lo stato attivo: solo la scheda attiva è visibile,
    // le altre (inclusa la view appena ricreata se non attiva) restano nascoste.
    for (const t of this.tabs) t.view.setVisible?.(t.id === this.activeId);
    this._broadcast();
  }

  // SICUREZZA (#590, terzo giro) — avanti e indietro sono un cambio di
  // indirizzo della scheda come gli altri, e non passavano dal punto unico:
  // né will-navigate né will-redirect scattano su una navigazione di
  // cronologia. Un sito visitato prima e messo in lista dopo tornava a schermo
  // al primo clic su "indietro", senza nemmeno la notifica. È il caso normale:
  // un sito lo si mette in lista proprio mentre ce l'hai davanti.
  // L'indirizzo della voce di cronologia si chiede PRIMA di muoversi.
  _urlVoceCronologia(wc, delta) {
    try {
      const h = wc.navigationHistory;
      if (!h || typeof h.getActiveIndex !== 'function') return '';
      const voce = h.getEntryAtIndex(h.getActiveIndex() + delta);
      return (voce && voce.url) || '';
    } catch (_) {
      return '';
    }
  }

  goBack(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const wc = tab.view.webContents;
    if (wc.navigationHistory?.canGoBack()) {
      if (this._maybeBlockNavigation(this._urlVoceCronologia(wc, -1))) return;
      wc.navigationHistory.goBack();
    } else if (wc.canGoBack?.()) {
      if (this._maybeBlockNavigation(this._urlVoceCronologia(wc, -1))) return;
      wc.goBack();
    }
  }

  goForward(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const wc = tab.view.webContents;
    if (wc.navigationHistory?.canGoForward()) {
      if (this._maybeBlockNavigation(this._urlVoceCronologia(wc, 1))) return;
      wc.navigationHistory.goForward();
    } else if (wc.canGoForward?.()) {
      if (this._maybeBlockNavigation(this._urlVoceCronologia(wc, 1))) return;
      wc.goForward();
    }
  }

  reload(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    // #327 — parità di cammini: ricaricare una scheda che mostra la pagina
    // d'errore deve RITENTARE il sito fallito (come il bottone "Riprova"),
    // non ricaricare la pagina d'errore stessa.
    const NE = globalThis.SN_NET_ERROR;
    let current = '';
    try { current = tab.view.webContents.getURL() || ''; } catch (_) {}
    const target = NE && NE.targetOf(current);
    // SICUREZZA (#590, quarto giro) — ricaricare è ricaricare un INDIRIZZO, e
    // quell'indirizzo può essere finito in lista dopo che la pagina era già a
    // schermo. È il caso normale: un sito lo si mette in lista proprio mentre
    // ce l'hai davanti. Il tasto indietro, che è la strada gemella, lo ferma
    // dal giro prima; qui non lo fermava nessuno, quindi le due strade
    // raccontavano due cose diverse e la lista sembrava non funzionare.
    // Vale sia per la pagina mostrata sia per il sito che la pagina d'errore
    // sta per ritentare.
    if (this._maybeBlockNavigation(target || current)) return;
    if (target) {
      try { tab.view.webContents.loadURL(target); } catch (_) {}
      return;
    }
    tab.view.webContents.reload();
  }

  // Nasconde/mostra la view del tab attivo. Serve alla shell per far apparire
  // dropdown HTML (es. menu App) sopra l'area contenuti: le WebContentsView
  // native vengono sempre composte sopra l'HTML della shell e ignorano lo
  // z-index CSS, quindi un menu che sborda nell'area pagina finirebbe coperto.
  setActiveVisible(visible) {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (tab) tab.view.setVisible?.(visible);
  }

  // ─── layout ─────────────────────────────────────────────────────────────

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
      if (this._maybeBlockNavigation(url, { fromUrl: wc.getURL() })) {
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
        return;
      }
      // #590 — e la LISTA DEI SITI BLOCCATI, per lo stesso identico motivo. Il
      // gate di will-navigate guarda l'indirizzo CHIESTO; dove si finisce
      // davvero lo decide il server, e un rimbalzo 301/302 (gli accorciatori di
      // link, i contatori di clic, mezzo web) portava la scheda sul sito della
      // lista senza incontrare nessun controllo. Non serviva nemmeno far
      // scrivere al modello l'indirizzo della lista: bastava un accorciatore.
      // Il referrer per l'eccezione "arrivo da un motore di ricerca" è la
      // pagina da cui siamo partiti, come in will-navigate.
      if (this._maybeBlockNavigation(url, { fromUrl: wc.getURL() })) {
        event.preventDefault();
        // La scheda era già nata per questo indirizzo e non ha mai caricato
        // niente: fermare il rimbalzo la lascia vuota, senza indirizzo, senza
        // titolo e senza contenuto, e l'utente deve chiuderla a mano quando la
        // notifica se n'è già andata. Se invece la scheda aveva una pagina
        // (l'utente ha cliccato un link da lì), quella pagina resta dov'era e
        // non c'è niente da chiudere.
        if (!tab._everNavigated) this._chiudiSchedaRimastaVuota(tab);
      }
    });
    // SICUREZZA (#590, quarto giro) — LA RICARICA CHIESTA DALLA PAGINA.
    // `location.reload()` e il meta refresh non emettono will-navigate: per
    // Chromium la scheda resta dov'era. Una pagina che si aggiorna da sola
    // (caselle di posta, cruscotti, risultati in diretta) continuava quindi a
    // ricaricare un sito finito in lista nel frattempo, senza che servisse
    // nemmeno un clic. Qui guardiamo solo le ricariche, cioè le navigazioni
    // verso l'indirizzo su cui la scheda si trova già: le prime aperture non
    // entrano (le ha già filtrate openTab, ed è così che il ripristino della
    // sessione e "Apri comunque" restano quello che sono).
    wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      let corrente = '';
      try { corrente = wc.getURL() || ''; } catch (_) { return; }
      if (!corrente || url !== corrente) return;
      if (!this._maybeBlockNavigation(url)) return;
      try { wc.stop(); } catch (_) {}
    });
    // SICUREZZA (#590, quarto giro) — I RIQUADRI INCORPORATI. La lista guardava
    // solo l'indirizzo della scheda, quindi un sito della lista messo dentro un
    // riquadro da un'altra pagina si vedeva per intero, e il riquadro lo sceglie
    // la pagina, non l'utente: bastava farlo grande quanto lo schermo. I siti
    // che uno si mette in lista sono anche quelli che mezzo web incorpora a
    // pezzi. Il riferimento per l'eccezione "arrivo da un motore di ricerca"
    // resta la pagina che OSPITA il riquadro, come per i popup.
    if (typeof wc.on === 'function') {
      wc.on('will-frame-navigate', (event) => {
        if (!event || event.isMainFrame) return; // il frame principale ha già i suoi gate
        const url = event.url;
        if (isWebUnsafeNav(url)) { event.preventDefault(); return; }
        let decisione = null;
        try {
          decisione = require('./services/siteBlock').shouldBlockNavigation(url, { fromUrl: wc.getURL() });
        } catch (_) { return; }
        if (!decisione || !decisione.block) return;
        event.preventDefault();
        // Una pagina può incorporare venti riquadri dello stesso sito: la
        // notifica si dice UNA volta per sito e per scheda, altrimenti al
        // posto di una spiegazione arriva una raffica che copre tutto.
        if (!tab._sitiIncorporatiDetti) tab._sitiIncorporatiDetti = new Set();
        if (tab._sitiIncorporatiDetti.has(decisione.host)) return;
        tab._sitiIncorporatiDetti.add(decisione.host);
        this._notifyBlockedFrame(decisione.host);
      });
    }
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
      // #590 (quarto giro) — prima di riconoscere un login si chiede alla
      // lista. "Somiglia a un accesso" lo decide l'indirizzo che la pagina
      // scrive (basta un percorso /login, /signin, /oauth), quindi qualunque
      // pagina poteva far comparire un sito della lista dentro una finestrella.
      // Il giro prima aveva chiuso gli spostamenti DENTRO quella finestrella,
      // non il suo primo indirizzo: la finestra nasceva, il primo caricamento
      // veniva fermato, e all'utente restava a schermo un rettangolo vuoto da
      // chiudere a mano. Chiedendo qui la finestra non nasce affatto.
      if (tab.isInternal === false && isAuthPopup(url)) {
        if (this._maybeBlockNavigation(url, { fromUrl: wc.getURL() })) return { action: 'deny' };
        return this._allowAuthPopup(url);
      }
      const isAdLikePopup = disposition === 'new-window';
      if (tab.isInternal === false && this.security.blockPopups && isAdLikePopup) {
        this._notifyPopupBlocked(tab.id, url);
        return { action: 'deny' };
      }
      // #170.3 — link verso un sito in blacklist aperto in una nuova scheda
      // (target=_blank / window.open): stesso blocco di will-navigate. Il
      // referrer è la pagina che ha originato l'apertura, e va PASSATO a
      // openTab (#590), che è il punto in cui la lista viene applicata: senza,
      // l'eccezione "arrivo da un motore di ricerca" non varrebbe per i
      // risultati aperti in una scheda nuova.
      // #590 (terzo giro) — la pagina di partenza è quella su cui sta la
      // scheda, non il referrer che la richiesta si porta dietro. Il referrer
      // fuori dal proprio dominio arriva quasi sempre ridotto alla sola origine
      // ("https://motore.esempio/"), cioè senza la domanda che rende quella
      // pagina un risultato di ricerca, e l'eccezione andava concessa a
      // qualunque pagina di quel sito. Ed è anche il valore più solido: dentro
      // un riquadro incorporato il referrer è del riquadro, mentre a comandare
      // la scheda è la pagina che lo ospita.
      const fromUrl = wc.getURL() || (details.referrer && details.referrer.url) || '';
      // #376 — parità con qualsiasi browser: Ctrl+click / click centrale su un
      // link ("aprilo dietro, io continuo a leggere qui") arriva con
      // disposition 'background-tab' e NON deve rubare il primo piano. Prima
      // ogni apertura veniva attivata, quindi l'utente veniva strappato dalla
      // pagina che stava leggendo — lo stesso attrito della musica che passava
      // davanti da sola.
      this.openTab(url, { activate: disposition !== 'background-tab', openedByLink: true, fromUrl });
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
    // #590 — la finestrella di accesso era l'ultima superficie rimasta fuori dal
    // passaggio unico: applicava le difese sugli schemi ma non la lista dei
    // siti bloccati, quindi dentro quella finestra un sito della lista si
    // apriva. Qui le due difese vanno insieme, come in una scheda normale.
    const gatePopup = (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
        return;
      }
      if (this._maybeBlockNavigation(url, { fromUrl: pwc.getURL() })) event.preventDefault();
    };
    pwc.on('will-navigate', gatePopup);
    // SICUREZZA (#309) — come per le tab: will-navigate non copre i redirect
    // lato server, e un IdP compromesso/ostile potrebbe rimbalzare il popup
    // verso file:// (leak hash NTLM) o data:/javascript:. Stesso gate esplicito.
    pwc.on('will-redirect', gatePopup);
    pwc.setWindowOpenHandler(({ url }) => {
      if (isWebUnsafeNav(url)) {
        openExternalScheme(url);
        return { action: 'deny' };
      }
      // #590 (quarto giro) — anche qui la lista viene prima del riconoscimento
      // del login, come nel gate delle schede: una finestrella che ne apre
      // un'altra non deve essere la strada che scavalca la lista.
      if (isAuthPopup(url)) {
        if (this._maybeBlockNavigation(url, { fromUrl: pwc.getURL() })) return { action: 'deny' };
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

  // Chiamato da IPC quando l'utente clicca "Apri" sulla chip del BLOCCO POPUP
  // — il popup era legittimo (es. share dialog, OAuth) e va aperto come scheda.
  //
  // Qui NON si scavalca la lista dei siti bloccati (#590, terzo giro). Per un
  // giro questo metodo è stato l'unico ingresso di tutti i bottoni "apri lo
  // stesso", e il permesso che concede è cresciuto: da "questa apertura" a
  // "questo sito, per tutta la sessione, su ogni strada". La chip dei popup
  // però chiede un'altra cosa ("fai passare questa finestrella") e il sito che
  // la fa comparire lo sceglie la pagina, non l'utente: un clic lì smontava la
  // lista che l'utente aveva scritto, e da quel momento nemmeno l'apertura
  // chiesta dal modello incontrava più un controllo. Il permesso grande lo dà
  // solo il bottone che lo nomina: apriSitoComunque, qui sotto.
  openBlockedPopup(url) {
    this.openTab(url, { activate: true });
  }

  // Chiamato da IPC quando l'utente clicca "Apri comunque" sulla notifica
  // "Sito bloccato". È l'UNICO scavalco della lista dei siti bloccati, e lo
  // sceglie una persona che sta guardando il nome del sito che ha fermato.
  //
  // Il sì si REGISTRA (#590, secondo giro), non vale solo per la richiesta che
  // parte adesso. Un sito che risponde "vai qui" invece di dare la pagina (il
  // salto da http a https, la barra iniziale che porta alla home: quasi ogni
  // sito vero) finiva contro il controllo del rimbalzo, che del sì non sapeva
  // niente: la scheda restava vuota e il sito non si apriva più in nessun modo.
  // Lo stesso al primo link cliccato dentro il sito, alla ricarica, e a una
  // scheda nuova aperta da lì.
  // E si torna indietro (#590, terzo giro): il sì dura tutta la sessione, e un
  // permesso che dura va detto a chi lo dà e tolto quando ci ripensa. Chi
  // clicca "Apri comunque" per guardare una pagina non sta dicendo "tieni quel
  // sito aperto fino a stasera", e l'unica marcia indietro era rimettere mano
  // all'elenco dei siti bloccati, che li azzera tutti e che nessuno indovina.
  apriSitoComunque(url) {
    let sito = '';
    try {
      sito = require('./services/siteBlock').allowHost(new URL(url).hostname);
    } catch (_) { /* indirizzo non analizzabile: resta il solo scavalco qui sotto */ }
    this.openTab(url, { activate: true, overrideSiteBlock: true });
    if (sito) this._notifyAllowed(sito);
  }

  // Il permesso appena dato, a parole, con la strada per toglierlo.
  _notifyAllowed(sito) {
    try {
      const NAV = globalThis.SN_URL_NAV;
      const label = (NAV && NAV.hostLeggibile(sito)) || sito;
      this.win.webContents.send('shell:toast', {
        text: `${label} resta aperto fino alla chiusura di Filo`,
        opts: { actions: [{ label: 'Rimetti il blocco', restoreBlockHost: sito }] },
      });
    } catch (_) {}
  }

  // L'utente ci ha ripensato: quel sito torna a valere come gli altri in lista.
  rimettiIlBlocco(sito) {
    try { require('./services/siteBlock').revokeHost(sito); } catch (_) {}
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

  // #170.3/#590 — IL PUNTO DI PASSAGGIO UNICO della lista dei siti bloccati.
  // Ogni cambio di indirizzo di una scheda passa di qui, da qualunque strada
  // arrivi: link cliccato (will-navigate), popup/target=_blank
  // (setWindowOpenHandler), apertura programmatica (openTab: barra della home,
  // azione NAVIGA del modello, IPC, shim chrome.tabs), rinavigazione
  // programmatica (navigate: barra degli indirizzi della shell), RIMBALZO del
  // server (will-redirect: 301/302, dove si finisce lo decide il server e non
  // l'indirizzo cliccato) e la finestrella di accesso (_hardenAuthPopup).
  //
  // Prima erano solo le prime due: chi scriveva l'indirizzo a mano e il
  // modello che emetteva NAVIGA non incontravano nessun controllo, quindi una
  // pagina ostile che convinceva il modello (NAVIGA è livello 1, senza
  // conferma) apriva qualunque sito della lista.
  //
  // Quando blocca mostra la notifica con "Apri comunque" e ritorna la
  // decisione ({ block, host, reason }) — truthy, così i chiamanti possono
  // usarla come booleano e chi deve SPIEGARE il rifiuto (la chat) ha l'host.
  // Ritorna null quando la navigazione è consentita.
  _maybeBlockNavigation(url, { fromUrl = '' } = {}) {
    let decision;
    try {
      decision = require('./services/siteBlock').shouldBlockNavigation(url, { fromUrl });
    } catch (_) {
      return null;
    }
    if (!decision || !decision.block) return null;
    this._notifyBlocked(decision.host, url);
    return decision;
  }

  // #590 — la scheda nata per un indirizzo che è rimbalzato su un sito della
  // lista. Niente da archiviare (non è un sito che l'utente ha visitato: non ha
  // mai caricato nulla), quindi non passa da closeTab. La chiusura è rimandata
  // di un giro perché qui siamo dentro il gestore dell'evento di navigazione di
  // questa stessa scheda: distruggerla mentre sta parlando fa cadere tutto.
  _chiudiSchedaRimastaVuota(tab) {
    if (!tab || tab._chiusuraVuotaInCorso) return;
    tab._chiusuraVuotaInCorso = true;
    setImmediate(() => {
      const idx = this.tabs.findIndex((t) => t.id === tab.id);
      if (idx < 0) return;
      if (tab._everNavigated) return; // nel frattempo ha caricato qualcosa: non è più vuota
      try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
      try { tab.view.webContents.close(); } catch (_) {}
      ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
      this.tabs.splice(idx, 1);
      if (this.activeId === tab.id) {
        const next = this._mostRecentlyActiveTab() || this.tabs[idx] || this.tabs[idx - 1];
        if (next) this.activate(next.id);
        else this.openTab('filo://newtab/');
      } else {
        this._broadcast();
      }
    });
  }

  // Notifica in basso a destra (#170.1): sito bloccato + azione "Apri comunque".
  // L'azione è DICHIARATA a parte (`openAnywayUrl`, non il generico `openUrl`)
  // perché è l'unica che scavalca la lista: gli altri bottoni "apri" che
  // passano da un toast — la scheda-ponte richiusa, la chip dei popup —
  // aprono e basta (#590, terzo giro).
  //
  // Il nome del sito si mostra come l'utente lo scriverebbe: un indirizzo in
  // cirillico o in giapponese viaggia sulla rete come "xn--…", e una notifica
  // che dice "Sito bloccato: xn--80aswg.xn--p1ai" non nomina niente.
  _notifyBlocked(host, url) {
    try {
      const grezzo = host || (() => { try { return new URL(url).host; } catch (_) { return url; } })();
      const NAV = globalThis.SN_URL_NAV;
      const label = (NAV && NAV.hostLeggibile(grezzo)) || grezzo;
      this.win.webContents.send('shell:toast', {
        text: `Sito bloccato: ${label}`,
        opts: { actions: [{ label: 'Apri comunque', openAnywayUrl: url }] },
      });
    } catch (_) {}
  }

  // #590 (quarto giro) — un RIQUADRO dentro la pagina, non la pagina. Qui non
  // c'è "Apri comunque": l'utente non stava aprendo quel sito, e aprire in una
  // scheda il pezzo che una pagina si incorpora (uno script, un widget) non è
  // una cosa che qualcuno voglia. Il nome del sito però va detto, altrimenti la
  // pagina sembra rotta invece che potata.
  _notifyBlockedFrame(host) {
    try {
      const NAV = globalThis.SN_URL_NAV;
      const label = (NAV && NAV.hostLeggibile(host)) || host;
      this.win.webContents.send('shell:toast', {
        text: `${label} è in lista: un riquadro di questa pagina non è stato caricato`,
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
        // overrideSiteBlock (#590): il ripristino non è una NAVIGAZIONE nuova,
        // è la sessione di prima che torna com'era. Bloccarlo qui toglierebbe
        // all'utente schede che aveva già aperte, e lo farebbe MUTO: al boot
        // la shell non è ancora in ascolto, quindi la notifica "Apri comunque"
        // non arriverebbe a nessuno — esattamente il blocco silenzioso che
        // sembra un guasto (#482). La lista torna a valere al primo
        // spostamento di quelle schede.
        const id = this.openTab(url, { activate: false, suppressAutoplay: true, overrideSiteBlock: true });
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
