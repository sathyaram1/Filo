// Tab manager: ogni tab è una WebContentsView attaccata alla BrowserWindow,
// posizionata sotto la "shell" (tab bar + barra indirizzi).
// La shell parla con il main via IPC (tabs:* canali); il main risponde con
// broadcast tabs:updated alla shell perché ridisegni la barra.

const { WebContentsView, Menu, MenuItem, session, shell, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Cookies = require('./services/cookies');
const { spingiAllaScheda } = require('./services/impostazioniPerOrigine');
const ProxyTab = require('./services/proxyTab');
const { registerFiloProtocolForSession } = require('./protocol');
const GeoBlock = require('./services/geoBlock');
const GeoBlockRules = require('./services/geoBlockRules');
const { installSafebrowse } = require('./tabs/tabSafebrowse');
const { installGeoBlock } = require('./tabs/tabGeoBlock');
const { installCookies } = require('./tabs/tabCookies');
const Permessi = require('./services/permessiPagine');
require('../shared/audioState');
const { audibleFromEvent } = globalThis.SN_AUDIO_STATE;
require('../shared/authPopup');
const { isAuthPopup } = globalThis.SN_AUTH_POPUP;
require('../shared/urlNav'); // #398 — sorgente unica di normalizeUrl/isLocalHost (condivisa con la dashboard)
const { normalizeUrl, canonicalizeFiloUrl } = globalThis.SN_URL_NAV;
require('../shared/downloadTabs'); // #412/#441 — schede usa e getta dei download (logica pura)
const { decideCloseOnDownload } = globalThis.SN_DOWNLOAD_TABS;
require('../shared/tasti'); // nome E comportamento delle scorciatoie, per il sistema su cui gira
const { indiceSaltoScheda, comandoNavigazione } = globalThis.SN_TASTI;
const { collegaScorciatoie } = require('./shortcuts');
const { AvvisiSopraPagina } = require('./avvisiSopraPagina');
const { AnteprimeSchede } = require('./tabs/anteprime');
const { VisiteSchede } = require('./tabs/visite');
const CartaAnteprima = require('./popup-anteprima');
const { AvvisoSito } = require('./avvisoSito');

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

// #514 — quante volte di fila la pagina può dire "quell'Esc me lo sono preso io"
// prima che il main smetta di crederle: è la rete contro una pagina ostile, non
// il budget di chi usa Filo, che i riquadri li impila davvero (#648). Il conto
// sta qui, dove arriva l'input vero: nella pagina un evento finto lo azzerava.
const ESC_RIVENDICAZIONI_MAX = 10;

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

// #514 — l'Esc NON è un gesto con cui una pagina può prendersi lo schermo: chi chiede lo schermo pieno dentro il
// proprio gestore dell'Esc lo otteneva senza un clic, e un evento di uscita non può essere il permesso per entrare.
// Microfono, fotocamera, appunti e posizione li decide l'utente (#591.1): regole in services/permessiPagine.js.
function installaPermessi(ses) {
  Permessi.installa(ses, {
    prima: (wc, permission, callback) => {
      if (permission !== 'fullscreen') return false;
      const t = tabDiWebContents(wc);
      if (t && t._ultimoInputEsc) { callback(false); return true; }
      return false;
    },
    schedaDi: schedaPerPermessi,
    esterno: isOsDelegatedScheme,
  });
}

// La domanda va alla cornice della finestra che mostra la pagina: lì la pagina non la copre e non la imita.
function schedaPerPermessi(wc) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const t = tm && Array.isArray(tm.tabs) && tm.tabs.find((x) => {
        const c = x && x.view && x.view.webContents;
        return c && !c.isDestroyed() && c.id === wc.id;
      });
      if (!t) continue;
      return {
        tabId: t.id,
        avvisa: (evento, dati) => {
          if (w.isDestroyed() || w.webContents.isDestroyed()) return;
          w.webContents.send(evento === 'chiedi' ? 'tabs:permesso' : 'tabs:permesso-fine', dati);
        },
      };
    }
  } catch (_) {}
  return null;
}

// #252 — pagina interna filo:// "singleton": ne ha senso UNA sola scheda alla
// volta (le liste "Aperti per dopo"/Cronologia/Archivio/Scaricamenti, le
// pagine Impostazioni, gli editor…). Riaprirla mentre è già aperta deve
// riportare l'utente sulla scheda esistente, non crearne un doppione. L'unica
// pagina filo:// NON singleton è la nuova scheda (`filo://newtab/`): di quella
// se ne vogliono quante se ne aprono. La chiave d'identità è host+path (query
// e hash esclusi: un ?highlight non rende la pagina "un'altra pagina").
// Chromium tiene lo zoom per sito: la chiave del suo evento è l'host, e per le pagine di Filo il loro indirizzo.
function ospiteDelloZoom(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'filo:' ? `filo://${u.hostname}` : u.hostname.replace(/^www\./, '');
  } catch (_) { return ''; }
}

function filoSingletonKey(url) {
  const s = String(url || '');
  if (!s.startsWith('filo://')) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.hostname === 'newtab') return null;
  return u.hostname + u.pathname;
}

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page-preload.js');
// Esito di una scheda aperta da NAVIGA (#590): quanto si aspetta, dopo l'arrivo della prima pagina,
// che la pagina si sposti da sé su un sito della lista. Tetto e margine dopo il caricamento.
const ASSESTAMENTO_MS = 1500;
const DOPO_CARICAMENTO_MS = 300;
// Dopo l'attesa, un blocco sulla stessa scheda arriva lo stesso alla chat che l'ha aperta,
// finché l'utente non la tocca e per questo tempo al massimo.
const SEGUI_APERTURA_MS = 60_000;
// Il rinvio che la pagina dichiara di sé (meta refresh), in secondi, o -1.
const RINVIO_DICHIARATO_JS = '(()=>{try{const m=document.querySelector(\'meta[http-equiv="refresh" i]\');const s=m?parseFloat(m.getAttribute("content")):NaN;return Number.isFinite(s)&&s>=0?s:-1;}catch(e){return -1;}})()';
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

// La lista dei bloccati si salva mentre si scrive (#590.2): una riga a metà non sposta le schede aperte,
// né verso la pagina «Sito bloccato» né fuori. La seguono quando la lista sta ferma per questo tempo, o quando l'utente le guarda.
const LISTA_FERMA_MS = 3000;

// webContents → sito di un «Apri comunque»: il sì vale anche per il blocco delle richieste.
const permessiApriComunque = new Map();
Cookies.permettiRichieste((d) => {
  const sito = d && d.webContentsId != null ? permessiApriComunque.get(d.webContentsId) : null;
  return !!sito && siteBlockSiteOf(d.url) === sito;
});

// Il sito su cui vale un «Apri comunque» (#590): dominio registrabile, solo web.
function siteBlockSiteOf(url) {
  const s = String(url || '');
  return /^https?:\/\//i.test(s) ? (Cookies.registrableOf(s) || null) : null;
}

// L'indirizzo chiesto e quello che arriva a will-navigate differiscono per forma («Sito.it» / «sito.it/»).
function indirizzoCanonico(url) {
  try { return new URL(String(url)).href; } catch (_) { return String(url || ''); }
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
    this.visite = new VisiteSchede({ incognito: this.incognito });
    this.anteprime = new AnteprimeSchede(this, {
      suNuova: (id, dato) => CartaAnteprima.precarica(window, id, dato),
      suTolte: (ids) => CartaAnteprima.dimentica(window, ids),
    });
    if (window && typeof window.once === 'function') window.once('closed', () => this.anteprime.chiudi());
    this.avvisi = new AvvisiSopraPagina(window, {
      alto: () => this._altezzaCornice(),
      restituisciTastiera: () => this._tastieraAllaSchedaAttiva(),
      schedaAttiva: () => {
        const t = this.tabs.find((x) => x.id === this.activeId);
        return (t && t.view) || null;
      },
    });
    this.avvisoSito = new AvvisoSito(window, {
      schedaAttiva: () => this.tabs.find((x) => x.id === this.activeId) || null,
      scegli: (tab, scelta, dati) => this._sbScelta(tab, scelta, dati),
      menu: (tab) => this._sbVociMenu(tab),
      restituisciTastiera: () => this._tastieraAllaSchedaAttiva(),
    });
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
    for (const ev of ['minimize', 'restore', 'hide', 'show']) {
      try { this.win.on?.(ev, () => this._annunciaVista()); } catch (_) {}
    }
    // La finestra torna a disegnare: le anteprime rimaste da scattare ripartono (#430). Il fuoco copre la finestra
    // che era solo coperta da un'altra, che non avvisa quando smette di disegnare.
    for (const ev of ['restore', 'show', 'focus']) {
      try { this.win.on?.(ev, () => this.anteprime.riprendi()); } catch (_) {}
    }
  }

  // Chi guarda: la scheda attiva di una finestra né nascosta né ridotta a
  // icona. `document.hidden` in una WebContentsView non lo dice (resta falso).
  inVista(tabId) {
    if (!tabId || tabId !== this.activeId) return false;
    try {
      if (this.win.isDestroyed?.() || this.win.isMinimized?.()) return false;
      if (this.win.isVisible && !this.win.isVisible()) return false;
    } catch (_) { return false; }
    return true;
  }

  // Alle pagine filo:// che hanno cambiato stato, e solo a loro: chi legge a
  // intervalli (la Gestione) smette da nascosta e si riallinea al rientro.
  _annunciaVista() {
    for (const t of this.tabs) {
      const ora = this.inVista(t.id);
      if (t._inVista === ora) continue;
      t._inVista = ora;
      const wc = t.view?.webContents;
      try {
        if (!wc || wc.isDestroyed?.() || !String(wc.getURL() || '').startsWith('filo://')) continue;
        wc.send('filo:broadcast', { type: 'tab_in_vista', inVista: ora });
      } catch (_) {}
    }
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
    const sfiduciata = (this._escRivendicazioni || 0) >= ESC_RIVENDICAZIONI_MAX;
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
    // Al tetto si esce, ma il tasto resta della pagina: prendercelo lasciava
    // aperto il riquadro in cima e portava via la modalità (#514 fatto da noi).
    if (sfiduciata) this.setContentFullscreen(false);
    else this.armaUscitaSchermoIntero(tabId);
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
    for (const t of this.tabs) spingiAllaScheda(t.view?.webContents, message, { inVista: t.id === this.activeId });
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
    // (privacy, proxy, incognito): una sessione non agganciata scarica col
    // dialogo nativo, senza barra e senza il controllo sui programmi (#588.2).
    // L'incognito ha il suo ambito: le sue voci non vanno su disco.
    try {
      require('./services/downloads').attachSession(view.webContents.session, { scope: this.incognito ? (this.partition || 'incognito') : '' });
    } catch (_) {}
    installaPermessi(view.webContents.session);
    Permessi.seguiGesti(view.webContents);
    require('./services/homeNetwork').attach(view.webContents.session);
    return view;
  }

  // `apriComunque`: la scheda non passa dalla lista dei siti bloccati per quel sito.
  // `permessoRichieste`: è un «Apri comunque» vero, e passa anche il blocco delle richieste.
  // `bloccoInPagina`: se la lista la ferma, la scheda nasce sulla pagina «Sito bloccato» invece di non nascere.
  openTab(url = 'filo://newtab/', { activate = true, restoreScrollPct = null, restoreZoomLevel = null, suppressAutoplay = false, allowDuplicate = false, openedByLink = false, apriComunque = false, permessoRichieste = false, bloccoInPagina = false } = {}) {
    // #252 — INDIRIZZO UNICO per le pagine interne: riporta l'eventuale forma
    // legacy `filo://src/pages/<page>/<file>` (dallo shim getURL) alla forma
    // canonica `filo://<page>/<file>` che usa il menu. Così tutti i punti di
    // ingresso convergono su un solo URL, qualunque chiamante li apra.
    if (typeof url === 'string' && url.startsWith('filo://')) url = canonicalizeFiloUrl(url);
    // Un indirizzo nudo («sito.com/pagina», come a volte lo manda il modello) caricato così resta bianco.
    else if (typeof url === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) url = normalizeUrl(url);

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
          return existing.id;
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
      return null;
    }
    const bloccata = apriComunque ? null : this._decisioneBlocco(null, url);
    if (bloccata && !bloccoInPagina) {
      this._notifyBlocked(bloccata);
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
      // #754 — banner dei cookie di questo sito: { site, rejected, hidden } (vedi tabs/tabCookies.js).
      cookieOutcome: null,
      // #145 — tab nata da un ripristino di sessione: l'autoplay resta bloccato
      // (vedi _makeView). Memorizzato sulla tab così sopravvive a _recreateView
      // (es. se la tab viene proxata alla nascita per una regola di dominio).
      suppressAutoplay: !!suppressAutoplay,
      // #441 — scheda nata da un link target=_blank / window.open (non aperta e
      // indirizzata dall'utente): è la prima condizione perché possa essere
      // riconosciuta come pagina-ponte di uno scaricamento (vedi
      // handleDownloadStarted e src/shared/downloadTabs.js).
      _openedByLink: !!openedByLink,
      // #590 — «Apri comunque» vale per quel sito dentro questa scheda: i suoi
      // link e redirect interni non vanno ribloccati a ogni passo.
      siteBlockAllowed: apriComunque ? siteBlockSiteOf(url) : null,
      // Non per la sessione ripristinata né per un duplicato: toglierebbe il blocco pubblicità al loro sito.
      _permessoRichieste: !!(apriComunque && permessoRichieste),
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
      this.anteprime.congeda(this.tabs.find((t) => t.id === this.activeId));
      this.activeId = id;
      tab.activateSeq = this._nextActivationSeq();
      this.layout();
    } else {
      this.anteprime.nataDietro(tab);
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
    if (bloccata) this._mostraPaginaBloccata(tab, url, bloccata);
    else view.webContents.loadURL(url);
    if (activate) {
      // Riaffermo la visibilità su tutti i tab dopo loadURL.
      for (const t of this.tabs) t.view.setVisible?.(this._visibile(t));
      this._tastieraAllaSchedaAttiva();
    }
    // #152 — born proxied: se il dominio ha una regola persistente, la scheda
    // nasce instradata da quel paese (ricrea la view nella partition proxata).
    if (!bloccata) this._maybeApplyDomainRule(tab, url);
    this._broadcast();
    return id;
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
      const enrichPayload = { title: tab.title || '', content: tab.contentExtract || '', url };
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

  // «Apri da un altro paese» esiste solo con un fornitore: ogni porta della
  // funzione (chat, regole, livello 2 del riconoscimento) chiede qui (#771).
  async proxyAvailable() {
    return ProxyTab.isConfigured(await this._readSettings());
  }

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
    // Senza filo:// qui la pagina d'errore non si carica e un proxy muto lascia la scheda vuota.
    if (!ses.protocol.isProtocolHandled('filo')) registerFiloProtocolForSession(ses);
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
    // Una regola che non potrà mai instradare niente è una promessa falsa.
    if (!(await this.proxyAvailable())) return { ok: false, error: 'not_configured' };
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
      // La copia eredita l'«Apri comunque» della scheda, non ne concede uno nuovo:
      // la copia di una pagina «Sito bloccato» è ancora quella pagina (#590).
      apriComunque: this._siteAllowedIn(tab, tab.url),
      permessoRichieste: this._siteAllowedIn(tab, tab.url) && !!tab._permessoRichieste,
      bloccoInPagina: true,
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
    if (this.avvisoSito.coperta() === tab) { this._sbScelta(tab, 'chiedi'); return; }
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
    if (this.activeId !== id) this.anteprime.congeda(this.tabs.find((t) => t.id === this.activeId));
    this.anteprime.mostrata(tab);
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
      t.view.setVisible?.(this._visibile(t));
    }
    this.layout();
    this._tastieraAllaSchedaAttiva();
    if (tab._listaTimer) this._seguiLista(tab, { ora: true });
    this._broadcast();
  }

  // La scheda davanti prende la tastiera se questa era su una scheda che non si
  // vede più, o su niente perché la view chiusa se l'è portata via: senza, dopo
  // Ctrl+W, Alt+cifra o Alt+S i tasti non arrivano a nessuno finché non si
  // clicca (#838). La barra che ha la tastiera la tiene; Filo dietro non la ruba.
  // Una scheda coperta dall'avviso del sito pericoloso dà la tastiera all'avviso, mai alla pagina (#813.5).
  _tastieraAllaSchedaAttiva() {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || this.win.isDestroyed() || !this.win.isFocused()) return;
    const avviso = this.avvisoSito.coperta() === tab ? this.avvisoSito.webContents() : null;
    const dest = avviso || tab.view.webContents;
    const col = require('electron').webContents.getFocusedWebContents();
    if (col === this.win.webContents || col === dest) return;
    try { dest.focus(); } catch (_) {}
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
    if (this._maybeBlockNavigation(tab, target)) return;
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
    // La pagina che la vista vecchia mostrava: se il primo salto della nuova si ferma sulla lista, si torna lì.
    let prima = '';
    try { prima = opts.ritorno ? '' : (tab.view.webContents.getURL() || ''); } catch (_) {}
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    const view = this._makeView(url, partition, { suppressAutoplay: tab.suppressAutoplay });
    tab.view = view;
    tab._vistaNuova = { wc: view.webContents, prima: /^(https?|filo):/i.test(prima) ? prima : '' };
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
    // Proxy e ritorno in Italia ricaricano l'indirizzo della scheda senza will-navigate (#590).
    const bloccata = !opts.loadUrl && this._decisioneBlocco(tab, url);
    if (bloccata) this._mostraPaginaBloccata(tab, url, bloccata);
    else view.webContents.loadURL(opts.loadUrl || url);
    // Visibilità coerente con lo stato attivo: solo la scheda attiva è visibile,
    // le altre (inclusa la view appena ricreata se non attiva) restano nascoste.
    for (const t of this.tabs) t.view.setVisible?.(this._visibile(t));
    if (wasActive) this._tastieraAllaSchedaAttiva();
    this._broadcast();
  }

  // La voce della cronologia a `passo` da quella attuale: la storia della scheda
  // è un cambio d'indirizzo come gli altri, e passa dalla lista (#590).
  _vocePassoStoria(tab, passo) {
    try {
      const h = tab.view.webContents.navigationHistory;
      const voce = h.getEntryAtIndex(h.getActiveIndex() + passo);
      return (voce && voce.url) || '';
    } catch (_) { return ''; }
  }

  goBack(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const meta = this._vocePassoStoria(tab, -1);
    if (meta && this._maybeBlockNavigation(tab, meta)) return;
    if (tab.view.webContents.navigationHistory?.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    } else if (tab.view.webContents.canGoBack?.()) {
      tab.view.webContents.goBack();
    }
  }

  // Indietro/avanti della scheda che l'utente sta guardando. Tutte le porte
  // passano di qui (scorciatoia, barra dei menu, tasti laterali del mouse,
  // scorrimento a due dita su Mac) così "la scheda corrente" e il "non c'è dove
  // andare" hanno una definizione sola (#685).
  navigaCronologia(verso, id) {
    const target = id || this.activeId;
    if (!target) return;
    if (verso === 'avanti') this.goForward(target);
    else this.goBack(target);
  }

  goForward(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const meta = this._vocePassoStoria(tab, 1);
    if (meta && this._maybeBlockNavigation(tab, meta)) return;
    if (tab.view.webContents.navigationHistory?.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    } else if (tab.view.webContents.canGoForward?.()) {
      tab.view.webContents.goForward();
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
    // La pagina «Sito bloccato» ricaricata resta sé stessa finché il sito è in lista (#590).
    if (NE && NE.isBlockedPageUrl(current) && this._decisioneBlocco(tab, target)) {
      try { tab.view.webContents.reload(); } catch (_) {}
      return;
    }
    if (this._maybeBlockNavigation(tab, target || current)) return;
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
    // Con la scheda davanti nascosta, una di dietro allargata per la sua anteprima si vedrebbe.
    this._attivaNascosta = !visible;
    if (visible) this.anteprime.riprendi(); else this.anteprime.interrompi();
    this.avvisoSito.nascondi(!visible);
  }

  // Solo la scheda davanti si vede; una aperta dietro resta «visibile» a 0×0 finché non ha l'anteprima (#430).
  _visibile(t) {
    return t.id === this.activeId || this.anteprime.tieneSveglia(t);
  }

  // ─── layout ─────────────────────────────────────────────────────────────

  // Altezza di chrome riservata in alto: 0 a tutto schermo, solo la fila di tab
  // se in chrome compatto (barra indirizzi nascosta), altrimenti l'intera shell.
  // A questo si somma l'eventuale topInset dei dropdown.
  _altezzaCornice() {
    if (this.contentFullscreen) return 0;
    return (this.chromeCompact ? this.tabRowHeight : this.shellHeight) + this.topInset;
  }

  layout() {
    const [w, h] = this.win.getContentSize();
    for (const tab of this.tabs) {
      if (tab.id === this.activeId) {
        const top = this._altezzaCornice();
        const b = { x: 0, y: top, width: w, height: Math.max(0, h - top) };
        tab.view.setBounds(b);
        if (process.env.FILO_SMOKE) {
          console.log(`[layout] tab ${tab.id.slice(0, 6)} active bounds`, JSON.stringify(b), 'win', w, 'x', h);
        }
      } else if (this.anteprime.inCattura(tab)) {
        const top = this._altezzaCornice();
        tab.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
    // L'ordine conta: l'avviso del sito sta sopra la scheda, gli avvisi della barra sopra di lui.
    this.avvisoSito.posa();
    this.avvisi.posa();
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
    // Stessa asimmetria per indietro/avanti: appena si clicca una scheda il
    // fuoco lascia la pagina e da lì il tasto non passava da nessuna parte.
    shellWc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const verso = comandoNavigazione(input);
      if (!verso) return;
      event.preventDefault();
      this.navigaCronologia(verso);
    });
  }

  // Zoom della scheda attiva chiesto da fuori la tastiera (oggi: la chat).
  // Passa dalla STESSA porta dei tasti, così la memoria per sito e l'opt-out
  // delle pagine che zoomano da sé restano di chi già li tiene. Il preload
  // risponde con la percentuale che ha davvero applicato: chi chiede un valore
  // fuori scala deve poterlo dire all'utente invece di tacere il taglio.
  // Il cambio applicato diventa un evento del filo nel contesto di chi l'ha chiesto (#867).
  async applicaZoom(spec, bersaglio = null) {
    const tab = bersaglio || this.tabs.find((t) => t.id === this.activeId);
    const esito = await this._chiediZoom(tab, spec);
    if (esito && typeof esito.prima === 'number' && typeof esito.percentuale === 'number') {
      try {
        require('./services/registroCambi').registraZoom(
          { host: ospiteDelloZoom(tab.url), prima: esito.prima, dopo: esito.percentuale },
          { incognito: !!this.incognito },
        );
      } catch (_) {}
    }
    return esito;
  }

  // «Rimetti com'era» uno zoom: sulla scheda di quel sito che si vede, o su un'altra dello stesso sito.
  async zoomSulSito(host, percentuale) {
    const stessi = this.tabs.filter((t) => t.view && ospiteDelloZoom(t.url) === host);
    if (!stessi.length) return false;
    const tab = stessi.find((t) => t.id === this.activeId) || stessi[0];
    const esito = await this.applicaZoom({ percentuale }, tab);
    return !!(esito && !esito.muto);
  }

  _chiediZoom(active, spec) {
    if (!active || !active.view) return Promise.resolve(null);
    const wc = active.view.webContents;
    const rid = `zoom-${randomUUID()}`;
    return new Promise((resolve) => {
      let chiuso = false;
      const fine = (v) => {
        if (chiuso) return;
        chiuso = true;
        clearTimeout(scadenza);
        try { ipcMain.removeListener('filo:zoom-applicato', onEco); } catch (_) {}
        resolve(v);
      };
      // Solo la scheda a cui l'abbiamo chiesto può rispondere: un'altra pagina
      // non deve poter mettere un numero in bocca a Filo.
      const onEco = (e, msg) => {
        if (!msg || String(msg.rid || '') !== rid) return;
        if (e.sender !== wc) return;
        fine(msg);
      };
      // Nessuna risposta: la pagina non ha il nostro preload (un visualizzatore
      // interno, una pagina d'errore) o non è ancora in piedi. È diverso da
      // «non c'è nessuna scheda», e chi riferisce all'utente deve poterlo dire.
      const scadenza = setTimeout(() => fine({ muto: true }), 2000);
      ipcMain.on('filo:zoom-applicato', onEco);
      try { wc.send('filo:zoom-key', { ...spec, rid }); } catch (_) { fine({ muto: true }); }
    });
  }

  // ─── eventi della WebContents → aggiorna stato + broadcast ─────────────

  _wireEvents(tab) {
    const wc = tab.view.webContents;
    this._registraPermessoRichieste(tab);
    try { wc.once('destroyed', () => this.visite.chiusa(wc)); } catch (_) {}
    const update = (patch) => {
      Object.assign(tab, patch);
      this._broadcast();
    };
    // Una pagina di Filo che scala il proprio contenuto (l'editor scala il
    // foglio) dichiara qui a quanto sta: il livello della finestra per lei
    // resta 100%, e senza questo Filo riferirebbe in chat il numero sbagliato
    // (#686). Il canale è quello della singola scheda: muore con lei.
    try {
      wc.ipc.on('filo:zoom-proprio', (_e, perc) => {
        const n = Math.round(Number(perc));
        tab.zoomProprio = Number.isFinite(n) && n > 0 ? n : null;
      });
    } catch (_) {}
    // Una raffica di tasti o di rotella finita: un evento del filo (#867). Solo dal frame principale,
    // e solo numeri dentro i limiti dello zoom.
    try {
      wc.ipc.on('filo:zoom-registra', (e, d) => {
        if (e.senderFrame && wc.mainFrame && e.senderFrame !== wc.mainFrame) return;
        const Z = globalThis.SN_ZOOM;
        const dentro = (x) => Number.isFinite(Number(x)) && (!Z || (Number(x) >= Z.MIN_PERCENTUALE - 1 && Number(x) <= Z.MAX_PERCENTUALE + 1));
        if (!d || !dentro(d.prima) || !dentro(d.dopo)) return;
        const R = require('./services/registroCambi');
        R.con({ via: 'interfaccia', dove: 'zoom' }, () => R.registraZoom(
          { host: ospiteDelloZoom(tab.url), prima: d.prima, dopo: d.dopo },
          { incognito: !!this.incognito },
        ));
      });
    } catch (_) {}
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
    collegaScorciatoie(wc, () => this.win);
    this._sbGuardiaTastiera(tab, wc);
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
      // Indietro e avanti (#685). Qui, nel main, e non nel content script:
      // `before-input-event` arriva PRIMA che il documento veda il tasto, così
      // la combinazione vale anche con un campo di testo a fuoco e anche sulle
      // pagine dove i content script non girano (le filo:// e quelle bloccate).
      // Quale combinazione sia lo decide src/shared/tasti.js: su Mac è Cmd+[ e
      // Cmd+], perché lì Opzione+freccia muove il cursore.
      if (input.type === 'keyDown') {
        const verso = comandoNavigazione(input);
        if (verso) {
          event.preventDefault();
          this.navigaCronologia(verso, tab.id);
          return;
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
      // «Apri comunque» della pagina «Sito bloccato» che il main ha messo in questa scheda (#590).
      if (this._apriComunqueDallaPagina(tab, url, event)) this._concediApriComunque(tab, url);
      // #170.3 — link o window.location verso un sito della lista: fermato.
      if (this._fermaSaltoDellaScheda(tab, url)) {
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
      // #590 — un redirect è un cambio d'indirizzo come gli altri: senza, un
      // accorciatore o un redirect aperto porta a un sito della lista.
      if (event.isMainFrame === false) return;
      const fermata = this._fermaSaltoDellaScheda(tab, url);
      if (!fermata) return;
      event.preventDefault();
      // Una scheda nata per quell'indirizzo resterebbe bianca e senza storia.
      if (!tab._everNavigated && !tab.isInternal) {
        setImmediate(() => this._dropTab(tab));
      } else if (tab._vistaNuova && tab._vistaNuova.wc === wc) {
        // Una vista appena ricreata (privacy fra siti, pagina di Filo → web) non ha niente dietro:
        // torna la pagina di prima, com'è quando la vista resta la stessa.
        const prima = tab._vistaNuova.prima;
        setImmediate(() => {
          if (!this.tabs.includes(tab) || tab.view.webContents !== wc) return;
          if (prima) this._recreateView(tab, prima, { ritorno: true });
          else this._mostraPaginaBloccata(tab, url, fermata);
        });
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
        if (!wc.isDestroyed()) wc.loadURL(NE.buildUrl(failed, code, desc, { altroPaese: !!tab.proxy }));
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

    // I riquadri si guardano da quando nascono: uno che non finisce mai di caricarsi mostra già il modulo (#813.1).
    wc.on('did-frame-navigate', (_e, _url, _code, _text, isMainFrame) => this._sbOnFrameLoad(tab, isMainFrame));
    wc.on('did-frame-finish-load', (_e, isMainFrame) => this._sbOnFrameLoad(tab, isMainFrame));

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
      if (tab.view && tab.view.webContents === wc) this.anteprime.caricata(tab);
      this.visite.caricata(wc);
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
    wc.on('page-title-updated', (_e, title) => {
      update({ title: title || tab.title });
      this.visite.titolo(wc, title);
    });
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons?.[0] || '' }));
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      // #412 — questa scheda ha committato una vera navigazione main-frame:
      // NON è più il "contenitore vuoto" di un download (una scheda aperta da un
      // link Scarica target=_blank che diventa subito scaricamento non committa
      // MAI, quindi resta a about:blank). Il flag protegge dal chiuderla per
      // sbaglio se poi parte un download da una pagina che ha già contenuto.
      tab._everNavigated = true;
      if (tab.view && tab.view.webContents === wc) this.anteprime.navigata(tab);
      if (tab._vistaNuova && tab._vistaNuova.wc === wc) tab._vistaNuova = null;
      this._sostituisciVoceBloccata(wc, url);
      // #590 — una navigazione già partita quando il suo sito è entrato in lista arriva lo stesso: si ferma qui.
      const bloccata = /^https?:\/\//i.test(url) && this._decisioneBlocco(tab, url);
      if (bloccata) {
        this._esitoApertura(tab, bloccata);
        this._mostraPaginaBloccata(tab, url, bloccata);
        return;
      }
      this._assestaEsito(tab);
      this.visite.navigata(wc, tab.id, url);
      // Documento nuovo: lo zoom che la pagina vecchia dichiarava di sé non
      // vale più (#686).
      tab.zoomProprio = null;
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
      this._cookieOnNavigate(tab, url);
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
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      update({ url: userUrl(url), canBack: canGoBack(wc), canFwd: canGoFwd(wc) });
      if (isMainFrame === true && tab.view && tab.view.webContents === wc) this.anteprime.navigata(tab, { inPagina: true });
      if (isMainFrame === true) this.visite.navigata(wc, tab.id, url, { inPagina: true });
    });
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
        if (norm && norm.host) SB.recordCert(norm.host, mapCertError(error));
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
      // Da una pagina di Filo l'indirizzo l'ha scelto quasi sempre un modello: passa dalla porta delle uscite (#810).
      if (tab.isInternal && typeof globalThis.SN_USCITA_DA_FILO === 'function') {
        globalThis.SN_USCITA_DA_FILO(url, wc, () => {
          this.apriDaCollegamento(url, { sfondo: disposition === 'background-tab' });
        }).catch(() => {});
        return { action: 'deny' };
      }
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
      const accesso = tab.isInternal === false && isAuthPopup(url);
      if (accesso) {
        if (this._maybeBlockNavigation(tab, url)) return { action: 'deny' };
        // Una pagina sotto l'avviso del sito pericoloso non apre finestre, che starebbero fuori dall'avviso: la
        // finestrella diventa una scheda, dove l'avviso c'è.
        if (!tab.sbAvviso) return this._allowAuthPopup(url);
      }
      const isAdLikePopup = disposition === 'new-window';
      if (!accesso && tab.isInternal === false && this.security.blockPopups && isAdLikePopup) {
        this._notifyPopupBlocked(tab.id, url);
        return { action: 'deny' };
      }
      // #170.3 — la lista dei siti bloccati la applica openTab; un «Apri comunque»
      // dato qui vale anche per le schede che apre sullo stesso sito.
      // #376 — parità con qualsiasi browser: Ctrl+click / click centrale su un
      // link ("aprilo dietro, io continuo a leggere qui") arriva con
      // disposition 'background-tab' e NON deve rubare il primo piano. Prima
      // ogni apertura veniva attivata, quindi l'utente veniva strappato dalla
      // pagina che stava leggendo — lo stesso attrito della musica che passava
      // davanti da sola.
      const aperta = this.openTab(url, {
        activate: disposition !== 'background-tab',
        openedByLink: true,
        apriComunque: this._siteAllowedIn(tab, url),
        permessoRichieste: this._siteAllowedIn(tab, url) && !!tab._permessoRichieste,
      });
      // Un blob: aperto dalla pagina si giudica come lei (src/main/tabs/tabSafebrowse.js).
      const nuova = this.tabs.find((t) => t.id === aperta);
      if (nuova) nuova._sbApertaDa = tab._urlNavigato;
      return { action: 'deny' };
    });

    // #209 — hardening del popup di login appena consentito. La finestra creata
    // da action:'allow' NON passa da _wireEvents (non è una tab): senza questo
    // hook resterebbe senza le difese che ogni scheda ha. Qui arrivano SOLO i
    // popup di login (ogni altro percorso del handler qui sopra ritorna 'deny').
    wc.on('did-create-window', (child) => {
      this._hardenAuthPopup(child, tab);
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
    // Una partizione mai vista da una scheda non ha gestore, ed Electron concederebbe tutto al popup.
    if (popupPartition) installaPermessi(session.fromPartition(popupPartition));
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
  // `origine`: la scheda da cui nasce il popup. Il suo «Apri comunque» vale anche qui (#590).
  _hardenAuthPopup(win, origine = null) {
    if (!win || !win.webContents) return;
    const pwc = win.webContents;
    installaPermessi(pwc.session);
    Permessi.seguiGesti(pwc);
    try {
      pwc.setWebRTCIPHandlingPolicy(
        this.security.protectIpLeak ? 'default_public_interface_only' : 'default',
      );
    } catch (_) { /* policy non supportata in qualche build */ }
    if (origine && origine.siteBlockAllowed && origine._permessoRichieste) {
      const wcId = pwc.id;
      permessiApriComunque.set(wcId, origine.siteBlockAllowed);
      pwc.once('destroyed', () => permessiApriComunque.delete(wcId));
    }
    let mostrata = false;
    pwc.on('did-navigate', () => { mostrata = true; });
    // Una finestrella fermata prima di mostrare qualcosa resterebbe vuota a schermo.
    const ferma = (event) => {
      event.preventDefault();
      if (!mostrata) setImmediate(() => { try { win.close(); } catch (_) {} });
    };
    pwc.on('will-navigate', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
        return;
      }
      if (this._maybeBlockNavigation(origine, url)) ferma(event);
    });
    // SICUREZZA (#309) — come per le tab: will-navigate non copre i redirect
    // lato server, e un IdP compromesso/ostile potrebbe rimbalzare il popup
    // verso file:// (leak hash NTLM) o data:/javascript:. Stesso gate esplicito.
    pwc.on('will-redirect', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        openExternalScheme(url);
        return;
      }
      if (event.isMainFrame === false) return;
      if (this._maybeBlockNavigation(origine, url)) ferma(event);
    });
    pwc.setWindowOpenHandler(({ url }) => {
      if (isWebUnsafeNav(url)) {
        openExternalScheme(url);
        return { action: 'deny' };
      }
      if (isAuthPopup(url)) {
        if (this._maybeBlockNavigation(origine, url)) return { action: 'deny' };
        return this._allowAuthPopup(url);
      }
      this.openTab(url, {
        activate: true,
        apriComunque: this._siteAllowedIn(origine, url),
        permessoRichieste: this._siteAllowedIn(origine, url) && !!(origine && origine._permessoRichieste),
      });
      return { action: 'deny' };
    });
    pwc.on('did-create-window', (child) => this._hardenAuthPopup(child, origine));
    this._sbGuardaFinestrella(win, origine);
  }

  // Notifica la shell che un popup è stato bloccato sul tab `tabId`. La shell
  // mostra l'avviso "Bloccato popup da <host>" con «Apri» per aprirlo.
  _notifyPopupBlocked(tabId, url) {
    try {
      const host = globalThis.SN_NOMI_SITO.sitoDi(url) || url;
      this.win.webContents.send('tabs:popup-blocked', { tabId, url, host });
    } catch (_) {}
  }

  // Chiamato da IPC quando l'utente clicca "Apri" sull'avviso — il popup era
  // legittimo (es. share dialog, OAuth) e va aperto bypassando il blocco dei
  // popup, NON la lista dei siti bloccati: quella la scavalca solo `apriComunque`,
  // l'«Apri comunque» della notifica di sito bloccato.
  // `daScheda`: la scheda che aveva chiesto il popup, il cui «Apri comunque» vale anche per lui.
  openBlockedPopup(url, { apriComunque = false, daScheda = null } = {}) {
    const origine = daScheda ? this.tabs.find((t) => t.id === daScheda) : null;
    const eredita = this._siteAllowedIn(origine, url);
    this.openTab(url, {
      activate: true,
      apriComunque: !!apriComunque || eredita,
      permessoRichieste: !!apriComunque || (eredita && !!origine._permessoRichieste),
    });
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
    // La pagina-ponte aveva contenuto: l'utente deve poter tornare indietro se
    // quella scheda gli serviva davvero (chiudere da soli qualcosa di visibile
    // senza via di ritorno sarebbe peggio dell'attrito che togliamo).
    const undo = decision.reason === 'bridge'
      ? { title: tab.title, url: tab.url }
      : null;
    if (this._dropTab(tab) && undo) this._notifyBridgeTabClosed(undo);
  }

  // Toglie una scheda che non ha mai mostrato niente di suo (ponte di un
  // download, redirect bloccato): senza archiviarla, a differenza di closeTab.
  _dropTab(tab) {
    const idx = this.tabs.findIndex((t) => t.id === tab.id);
    if (idx < 0) return false;
    this._esitoApertura(tab, null);
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
    return true;
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

  // Un collegamento che Filo apre per conto di una pagina, dopo la porta delle uscite (#810): la posta al sistema, i
  // siti in blacklist fermati come un clic, il resto in una scheda nuova.
  apriDaCollegamento(url, { sfondo = false } = {}) {
    if (isWebUnsafeNav(url)) return openExternalScheme(url);
    if (this._maybeBlockNavigation(null, url)) return false;
    this.openTab(url, { activate: !sfondo, openedByLink: true });
    return true;
  }

  // #590 — L'UNICO punto che applica la lista dei siti bloccati: ci passano
  // openTab, navigate, will-navigate, will-redirect, la storia, le viste ricreate e il commit.
  // Ritorna la decisione ({ host, reason, target }) se la lista ferma `url`, altrimenti
  // null; non avvisa. `tab` è la scheda di partenza, che può avere un «Apri comunque».
  _decisioneBlocco(tab, url) {
    if (this._siteAllowedIn(tab, url)) return null;
    // Un indirizzo nudo («sito.com», come lo manda a volte il modello) si
    // giudica per quello che diventerà caricandolo.
    const target = /^[a-z][a-z0-9+.-]*:/i.test(String(url || '')) ? url : normalizeUrl(url);
    let decision;
    try {
      decision = require('./services/siteBlock').shouldBlockNavigation(target);
    } catch (_) {
      return null;
    }
    if (!decision || !decision.block) return null;
    return { ...decision, target };
  }

  // Come è finita la prima apertura di una scheda appena nata (#590): `bloccata` è la decisione
  // della lista se l'ha fermata un rimbalzo del server o della pagina (rinvio, script), null se la
  // pagina è arrivata e ci è rimasta o dopo `tetto` ms. Serve a chi l'ha aperta per conto
  // dell'utente (NAVIGA) per non dire «aperta» a vuoto.
  esitoApertura(id, { tetto = 5000 } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || tab._everNavigated) return Promise.resolve({ bloccata: null });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this._esitoApertura(tab, null), tetto);
      if (!tab._attesaEsito) tab._attesaEsito = [];
      tab._attesaEsito.push((bloccata) => { clearTimeout(timer); resolve({ bloccata }); });
    });
  }

  // La chat che ha chiesto l'apertura di `id`, con l'id dell'azione: dopo l'attesa di esitoApertura,
  // un blocco che la pagina provoca da sé le arriva lo stesso. `assistente`: l'assistente sulla pagina,
  // che ascolta coi content script invece che sul canale della home.
  seguiApertura(id, { wc, callId, assistente = false } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !wc || !callId) return;
    tab._aperturaChat = { wc, callId, assistente: !!assistente, da: Date.now() };
  }

  // «Apri comunque» dell'assistente sulla pagina: una pagina web lo può chiedere solo per un
  // indirizzo che la lista ha fermato a un'apertura chiesta da lei stessa.
  ricordaApribile(wc, url) {
    if (!wc || !url) return;
    if (!this._apribiliAssistente) this._apribiliAssistente = new WeakMap();
    let set = this._apribiliAssistente.get(wc);
    if (!set) { set = new Set(); this._apribiliAssistente.set(wc, set); }
    set.add(String(url));
  }

  apribileDallAssistente(wc, url) {
    const set = wc && this._apribiliAssistente && this._apribiliAssistente.get(wc);
    return !!set && set.has(String(url || ''));
  }

  _bloccoDopoApertura(tab, bloccata) {
    const c = tab._aperturaChat;
    tab._aperturaChat = null;
    if (!c || (tab._userInputAt || 0) >= c.da || Date.now() - c.da > SEGUI_APERTURA_MS) return;
    const dati = { callId: c.callId, host: bloccata.host, reason: bloccata.reason || '', url: bloccata.target };
    try {
      if (c.wc.isDestroyed()) return;
      if (c.assistente) {
        this.ricordaApribile(c.wc, dati.url);
        c.wc.send('filo:broadcast', { type: globalThis.SN_MSG?.MSG?.APERTURA_FERMATA || 'apertura_fermata', ...dati });
      } else {
        c.wc.send('filo:apertura-fermata', dati);
      }
    } catch (_) {}
  }

  _esitoApertura(tab, bloccata) {
    const attese = tab._attesaEsito;
    if (!attese) {
      if (bloccata && tab._aperturaChat) this._bloccoDopoApertura(tab, bloccata);
      return;
    }
    tab._attesaEsito = null;
    // Detto adesso a chi aspettava: non va ridetto dopo.
    if (bloccata) tab._aperturaChat = null;
    clearTimeout(tab._assestamento);
    tab._assestamento = null;
    for (const a of attese) a(bloccata);
  }

  // Arrivata la prima pagina, l'esito aspetta che finisca di caricare e un attimo dopo: un rinvio
  // scritto nella pagina parte a caricamento finito. Al massimo ASSESTAMENTO_MS dopo l'arrivo.
  _assestaEsito(tab) {
    if (!tab._attesaEsito || tab._assestamento) return;
    const arrivata = () => this._esitoApertura(tab, null);
    tab._assestamento = setTimeout(arrivata, ASSESTAMENTO_MS);
    const wc = tab.view.webContents;
    const riprogramma = (ms) => {
      if (!tab._attesaEsito) return;
      clearTimeout(tab._assestamento);
      tab._assestamento = setTimeout(arrivata, ms);
    };
    try {
      wc.once('did-stop-loading', () => {
        if (!tab._attesaEsito) return;
        // Una pagina che dichiara di spostarsi fra poco è un passaggio: si aspetta dove porta
        // (dentro il tetto di esitoApertura). Quello che fa più tardi lo dice _bloccoDopoApertura.
        wc.executeJavaScript(RINVIO_DICHIARATO_JS, false)
          .then((sec) => riprogramma((Number(sec) >= 0 ? Number(sec) * 1000 : 0) + DOPO_CARICAMENTO_MS))
          .catch(() => riprogramma(DOPO_CARICAMENTO_MS));
      });
    } catch (_) {}
  }

  // Come _decisioneBlocco, e se blocca lo dice con la notifica «Sito bloccato».
  _maybeBlockNavigation(tab, url) {
    const decision = this._decisioneBlocco(tab, url);
    if (decision) this._notifyBlocked(decision);
    return decision;
  }

  // Un salto della pagina della scheda (link, rinvio, rimbalzo del server) fermato dalla lista: oltre
  // alla notifica, l'esito va a chi aveva chiesto di aprire la scheda, qualunque forma abbia il salto.
  _fermaSaltoDellaScheda(tab, url) {
    const fermata = this._maybeBlockNavigation(tab, url);
    if (fermata) this._esitoApertura(tab, fermata);
    return fermata;
  }

  // La scheda passa alla pagina «Sito bloccato» al posto di `url`, che per l'utente
  // resta il suo indirizzo (sessione, ricarica, duplica).
  _mostraPaginaBloccata(tab, url, decision) {
    const NE = globalThis.SN_NET_ERROR;
    if (!NE) return;
    if (!tab._pagineBloccate) tab._pagineBloccate = new Set();
    tab._pagineBloccate.add(indirizzoCanonico(url));
    tab.url = url;
    try { tab.view.webContents.loadURL(NE.buildUrl(url, NE.BLOCKED_CODE, decision.reason)); } catch (_) {}
  }

  // Il salto da una pagina «Sito bloccato» messa dal main al suo sito è il suo «Apri comunque»:
  // la pagina lo fa solo al clic. Una pagina «Sito bloccato» aperta da altri non concede niente.
  _apriComunqueDallaPagina(tab, url, event) {
    const NE = globalThis.SN_NET_ERROR;
    if (!NE || !tab._pagineBloccate) return false;
    try {
      const corrente = tab.view.webContents.getURL() || '';
      const da = (event && event.initiator && event.initiator.url) || corrente;
      if (!NE.isBlockedPageUrl(corrente) || da !== corrente) return false;
      const bersaglio = indirizzoCanonico(NE.targetOf(corrente));
      return bersaglio === indirizzoCanonico(url) && tab._pagineBloccate.has(bersaglio);
    } catch (_) { return false; }
  }

  _concediApriComunque(tab, url) {
    const sito = siteBlockSiteOf(url);
    if (!sito) return;
    tab.siteBlockAllowed = sito;
    tab._permessoRichieste = true;
    this._registraPermessoRichieste(tab);
  }

  // Il sì di un «Apri comunque» vale anche per il blocco delle richieste di quel webContents.
  _registraPermessoRichieste(tab) {
    if (!tab.siteBlockAllowed || !tab._permessoRichieste) return;
    const wc = tab.view.webContents;
    const wcId = wc.id;
    const nuovo = !permessiApriComunque.has(wcId);
    permessiApriComunque.set(wcId, tab.siteBlockAllowed);
    if (nuovo) wc.once('destroyed', () => permessiApriComunque.delete(wcId));
  }

  // La pagina «Sito bloccato» prende nella storia il posto del suo sito, e viceversa:
  // senza, indietro da lì riporta sul sito e si ferma di nuovo.
  _sostituisciVoceBloccata(wc, url) {
    const NE = globalThis.SN_NET_ERROR;
    if (!NE) return;
    try {
      const h = wc.navigationHistory;
      const i = h.getActiveIndex();
      if (i < 1) return;
      const prima = (h.getEntryAtIndex(i - 1) || {}).url || '';
      const gemelle = (NE.isBlockedPageUrl(url) && NE.targetOf(url) === prima)
        || (NE.isBlockedPageUrl(prima) && NE.targetOf(prima) === url);
      if (gemelle) h.removeEntryAtIndex(i - 1);
    } catch (_) {}
  }

  // #590 — la lista è cambiata: una scheda su un sito appena messo in lista passa
  // alla pagina «Sito bloccato»; una ferma lì per un sito uscito dalla lista torna sul sito.
  riapplicaListaBloccati(opts) {
    if (opts && opts.mentreScrive) this._listaCambiaFino = Date.now() + LISTA_FERMA_MS;
    for (const tab of this.tabs) this._seguiLista(tab);
  }

  // Con `ora` (la scheda viene guardata) la lista vale subito, anche se è a metà.
  _seguiLista(tab, { ora = false } = {}) {
    clearTimeout(tab._listaTimer);
    tab._listaTimer = null;
    const NE = globalThis.SN_NET_ERROR;
    if (!NE || !this.tabs.includes(tab)) return;
    let grezzo = '';
    try { grezzo = tab.view.webContents.getURL() || ''; } catch (_) { return; }
    let passo = null;
    if (NE.isBlockedPageUrl(grezzo)) {
      const target = this._daRiaprire(tab);
      if (target) passo = () => { try { tab.view.webContents.loadURL(target); } catch (_) {} };
    } else {
      // Anche una pagina d'errore di rete: per l'utente la scheda sta sul sito che non si è aperto.
      const sito = NE.targetOf(grezzo) || grezzo;
      const decision = /^https?:\/\//i.test(sito) ? this._decisioneBlocco(tab, sito) : null;
      if (decision) passo = () => this._mostraPaginaBloccata(tab, sito, decision);
    }
    if (!passo) return;
    const attesa = (this._listaCambiaFino || 0) - Date.now();
    if (ora || attesa <= 0) passo();
    else tab._listaTimer = setTimeout(() => this._seguiLista(tab), attesa);
  }

  // Il sito della pagina «Sito bloccato» messa dal main, se adesso la lista lo lascia aprire.
  _daRiaprire(tab) {
    const NE = globalThis.SN_NET_ERROR;
    if (!NE || !tab._pagineBloccate || !this.tabs.includes(tab)) return null;
    let grezzo = '';
    try { grezzo = tab.view.webContents.getURL() || ''; } catch (_) { return null; }
    if (!NE.isBlockedPageUrl(grezzo)) return null;
    const target = NE.targetOf(grezzo);
    return target && !this._decisioneBlocco(tab, target) ? target : null;
  }

  _siteAllowedIn(tab, url) {
    return !!(tab && tab.siteBlockAllowed && siteBlockSiteOf(url) === tab.siteBlockAllowed);
  }

  // Notifica in basso a destra (#170.1): sito bloccato + azione "Apri comunque", che riusa
  // openBlockedPopup. `decision` viene da _decisioneBlocco: il motivo distingue le liste pubbliche.
  _notifyBlocked({ host, target, reason }) {
    try {
      const label = host || globalThis.SN_NOMI_SITO.sitoDi(target) || target;
      const perche = reason === 'lists' ? ' · pubblicità e tracciamento' : '';
      this.win.webContents.send('shell:toast', {
        text: `Sito bloccato: ${label}${perche}`,
        // Una pagina che riprova in continuazione non impila notifiche: finché questa è a schermo resta una.
        opts: { unica: `sito-bloccato:${label}`, actions: [{ label: 'Apri comunque', openUrl: target, apriComunque: true }] },
      });
    } catch (_) {}
  }

  // ─── rilevamento siti pericolosi ─────────────────────────────────────────
  // (vedi src/main/services/safebrowse/ e src/main/tabs/tabSafebrowse.js).
  // I metodi safebrowse sono estratti in tabSafebrowse.js e installati sul
  // prototype in fondo a questo file (mixin); l'avviso lo disegna avvisoSito.js.

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
        // Banner dei cookie del sito, per il menu della scheda: null se Filo non li gestisce qui.
        cookies: this._cookieState(t),
      })),
    };
  }

  _broadcast() {
    this.anteprime.pota(new Set(this.tabs.map((t) => t.id)));
    // La shell è il primary webContents della BrowserWindow.
    try {
      this.win.webContents.send('tabs:updated', this.snapshot());
    } catch (_) { /* shell non ancora caricata */ }
    this._annunciaVista();
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
        // Una scheda su un sito della lista torna sulla pagina «Sito bloccato»:
        // non sparisce dalla sessione e il sito non si riapre da solo (#590).
        const id = this.openTab(url, { activate: false, suppressAutoplay: true, bloccoInPagina: true });
        const nata = id && this.tabs.find((t) => t.id === id);
        if (nata) this.visite.giaVista(nata.view.webContents, url);
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
// `this._sbMostra(...)`, `this._geoTextCheck(...)`, ecc. restano metodi
// d'istanza identici a prima del refactor.
installSafebrowse(TabManager);
installGeoBlock(TabManager);
installCookies(TabManager);

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

// Il visore dei PDF è un webContents a sé che prende la tastiera: i suoi tasti non
// passano dal before-input-event della scheda e vanno portati agli stessi ascolti (#838).
function inoltraTastiDegliOspiti(app) {
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() !== 'remote') return;
    wc.on('input-event', (_ev, input) => {
      const tipo = input && { rawKeyDown: 'keyDown', keyDown: 'keyDown', keyUp: 'keyUp' }[input.type];
      if (!tipo) return;
      // Un tasto della barra dei menu (su Mac Cmd+W, Cmd+T…) lo esegue già lei.
      if (tipo === 'keyDown' && require('./menu').tastoDellaBarra(input)) return;
      // Chi ha la tastiera sta nella finestra davanti, nella scheda attiva.
      const win = BrowserWindow.getFocusedWindow();
      const tabs = win && win._filoTabs;
      const tab = tabs && tabs.tabs.find((t) => t.id === tabs.activeId);
      if (!tab || tab.view.webContents === wc || tab.view.webContents.isDestroyed()) return;
      tab.view.webContents.emit('before-input-event', { preventDefault() {} }, { ...input, type: tipo });
    });
  });
}

module.exports = { TabManager, normalizeUrl, isWebUnsafeNav, inoltraTastiDegliOspiti };
