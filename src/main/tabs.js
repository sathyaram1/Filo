// Le schede: ogni scheda è una WebContentsView attaccata alla finestra, sotto
// la barra della shell. Qui vivono il loro ciclo di vita, il layout, lo schermo
// intero, il proxy per scheda e le guardie sulle navigazioni.

const { WebContentsView, Menu, MenuItem, session, shell, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Cookies = require('./services/cookies');
const Sito = require('../shared/stessoSito');
const { spingiAllaScheda } = require('./services/impostazioniPerOrigine');
const { testoDellaRichiesta, corpoDa } = require('./services/testoInviato');
const ProxyTab = require('./services/proxyTab');
const { registerFiloProtocolForSession } = require('./protocol');
const GeoBlock = require('./services/geoBlock');
const GeoBlockRules = require('./services/geoBlockRules');
const { installSafebrowse } = require('./tabs/tabSafebrowse');
const { installGeoBlock } = require('./tabs/tabGeoBlock');
const { installZoom } = require('./tabs/tabZoom');
const { installCookies } = require('./tabs/tabCookies');
const { installRestaConnesso } = require('./tabs/tabRestaConnesso');
const Permessi = require('./services/permessiPagine');
const { avvisoIndirizzoFermato } = require('./services/indirizzoFermato');
const MenuDiRiserva = require('./menuDiRiserva');
const IconaScheda = require('./services/iconaScheda');
const ChiusuraConCaselle = require('./tabs/chiusuraConCaselle');
const AzioniContate = require('./services/azioniContate');
const ContatoriFinestra = require('./services/contatoriFinestra');
const ContatoriSicurezza = require('./services/contatoriSicurezza');
require('../shared/audioState');
const { audibleFromEvent } = globalThis.SN_AUDIO_STATE;
require('../shared/authPopup');
const { isAuthPopup } = globalThis.SN_AUTH_POPUP;
require('../shared/urlNav');
const { normalizeUrl, canonicalizeFiloUrl } = globalThis.SN_URL_NAV;
require('../shared/downloadTabs'); // #412/#441 — schede usa e getta dei download (logica pura)
const { decideCloseOnDownload } = globalThis.SN_DOWNLOAD_TABS;
require('../shared/tabColor');
const { compareRainbow } = globalThis.SN_TAB_COLOR;
require('../shared/tasti'); // nome E comportamento delle scorciatoie, per il sistema su cui gira
const { indiceSaltoScheda, indiceSchedaVicina, comandoNavigazione, comandoNavigazioneFuoriDalCampo } = globalThis.SN_TASTI;
const { collegaScorciatoie, staRegistrandoTasti } = require('./shortcuts');
const { AvvisiSopraPagina } = require('./avvisiSopraPagina');
const { ConfermeSopraPagina, registraFinestraDelSito } = require('./confermeSopraPagina');
const { BarraLaterale } = require('./barraLaterale');
const { SchedeInAlto } = require('./schedeInAlto');
const RisposteInAttesa = require('./risposteInAttesa');
const { AnteprimeSchede } = require('./tabs/anteprime');
const { RiservaNuovaScheda, vistePerAnnunci } = require('./tabs/riservaNuovaScheda');
const { VisiteSchede } = require('./tabs/visite');
const { CodaRiapertura, perVicinanza } = require('./tabs/codaRiapertura');
const CartaAnteprima = require('./popup-anteprima');
const { AvvisoSito } = require('./avvisoSito');
const { AvvisoSchermoPieno, partiDellAvviso } = require('./avvisoSchermoPieno');
const { PropostaEmail } = require('./propostaEmail');
const { StratoDelMenu } = require('./stratoDelMenu');
const Storia = require('./tabs/storia');

// #441 — il cursore che attraversa la pagina non è un'interazione con quella
// scheda. Tutto il resto (clic, tasti, rotella, tocco, gesti) lo è.
const HOVER_INPUT_TYPES = new Set([
  'mouseMove', 'mouseEnter', 'mouseLeave', 'pointerMove', 'pointerRawUpdate',
]);

// Per le pagine visitate (#1525) vale come gesto un input vero sulla scheda o una navigazione chiesta a Filo.
const gestoPerIlFilo = (tab) => Math.max(tab._userInputAt || 0, tab._gestoFiloAt || 0);
// Il salto dalla pagina d'errore al sito è un «Riprova» premuto se arriva entro questo tempo da un input vero (#1469).
const RIPROVA_GESTO_MS = 5_000;

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

const tastoEsc = () => (globalThis.SN_TASTI ? globalThis.SN_TASTI.etichetta('Esc') : 'Esc');

// #514 — l'Esc NON è un gesto con cui una pagina può prendersi lo schermo: chi chiede lo schermo pieno dentro il
// proprio gestore dell'Esc lo otteneva senza un clic, e un evento di uscita non può essere il permesso per entrare.
// Microfono, fotocamera, appunti e posizione li decide l'utente (#591.1): regole in services/permessiPagine.js.
function installaPermessi(ses) {
  Permessi.installa(ses, {
    prima: (wc, permission, callback, details) => {
      if (permission !== 'fullscreen') return false;
      // A schermo intero la finestrella di accesso perderebbe la barra col sito (#1066).
      if (wc && wc._filoFinestrella) { callback(false); return true; }
      const t = tabDiWebContents(wc);
      if (t && t._ultimoInputEsc) { callback(false); return true; }
      // #1526 — il frame che chiede (anche un riquadro di un altro sito): la pillola dello schermo pieno lo nomina.
      if (t) t._schermoPienoDa = { url: String((details && details.requestingUrl) || ''), alle: Date.now() };
      return false;
    },
    schedaDi: schedaPerPermessi,
    esterno: isOsDelegatedScheme,
    aggiorna: (wc) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs;
        if (tm && Array.isArray(tm.tabs) && tm.tabs.some((x) => x && x.view && x.view.webContents === wc)) { tm._broadcast(); return; }
      }
    },
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

// Le pagine web girano nella sandbox di Chromium: il loro preload è page-preload.js impacchettato in un file (#834).
const { percorsoDelPreload } = require('./preloadPacchetto');
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
// La sessione scritta per ultima, in JSON: la chiave è una sola per tutte le finestre, quindi anche il ricordo.
let sessioneScritta = null;

// SICUREZZA — schemi ammessi alle navigazioni che nascono dal web o dall'agente (mai dalla
// barra): `file://` consegna l'hash NTLM via UNC, `data:`/`javascript:` sono phishing.
const WEB_NAV_SCHEMES = new Set(['http:', 'https:', 'filo:', 'about:', 'blob:']);
function isWebUnsafeNav(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  // URL relativo/non parsabile → Electron lo risolve sull'origine corrente
  // (stessa pagina web): non è un cambio di schema, non bloccare.
  if (!proto) return false;
  // `filo://invito/…` non è una pagina (#664): in una scheda diventava un
  // indirizzo interno che non esiste, e la pagina dell'invito spariva. Fermato
  // qui, lo porta dentro `invitoFermato`.
  if (globalThis.SN_WALLET?.isInviteDeepLink?.(rawUrl)) return true;
  return !WEB_NAV_SCHEMES.has(proto);
}

// Schemi che un browser consegna al sistema invece di fallire. Elenco volutamente minimo:
// il resto resta bloccato, o un sito ostile innescherebbe gestori che non conosciamo.
const OS_DELEGATED_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);
function isOsDelegatedScheme(rawUrl) {
  let proto = '';
  try { proto = new URL(String(rawUrl || '')).protocol.toLowerCase(); } catch (_) { return false; }
  return OS_DELEGATED_SCHEMES.has(proto);
}

const RIAPERTURA_ACCESSO_MS = 5000;
const MONDO_RIAPERTURA = 1003;

// Il dominio registrato, la parte che chi attacca non sceglie; una pagina scritta dal sito (about:blank, blob:) è sua.
function titoloFinestrella(url, origine = '') {
  const da = /^https?:/i.test(origine) ? origine : String(url || '');
  if (!/^https?:/i.test(da)) return da.split(/[?#]/)[0] || 'about:blank';
  return Permessi.nomeDaMostrare(da).dominio;
}

// La pagina sceglie misure e posizione, ma la finestrella sta tutta nello schermo, come in Chrome: fuori, con la barra
// del titolo, uscirebbe l'unico posto dove si legge il sito (#1066 giro 1). Windows non la rimette dentro da solo.
function dentroLoSchermo(b) {
  const a = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, a.width);
  const height = Math.min(b.height, a.height);
  return {
    width, height,
    x: Math.min(Math.max(b.x, a.x), a.x + a.width - width),
    y: Math.min(Math.max(b.y, a.y), a.y + a.height - height),
  };
}

// Electron passa alla finestra ogni chiave delle `features` di window.open (frame=no, fullscreen, titleBarStyle…):
// alla pagina restano solo le misure, il resto torna com'è di suo, o il titolo col sito sparirebbe (#1066).
const MISURE_FINESTRELLA = new Set(['width', 'height', 'left', 'top', 'x', 'y']);
function senzaOpzioniDellaPagina(features) {
  const via = {};
  for (const coppia of String(features || '').split(',')) {
    const chiave = coppia.split('=')[0].trim();
    if (chiave && !MISURE_FINESTRELLA.has(chiave)) via[chiave] = undefined;
  }
  return via;
}

// Consegna all'OS un link mailto:/tel:/sms: (best-effort). Da chiamare SOLO dopo
// aver bloccato la navigazione in-app, e SOLO per gli schemi dell'allowlist.
function openExternalScheme(rawUrl) {
  if (!isOsDelegatedScheme(rawUrl)) return false;
  try { shell.openExternal(String(rawUrl)); } catch (_) {}
  return true;
}

// Un `filo://invito/…` fermato su una navigazione non si tace (#664): da qualunque porta (barra, «Apri in nuova tab», un
// pulsante che naviga da script) riscatta e apre Crediti. Da una pagina solo dopo un gesto vero su quella pagina, contato
// dal main (la pagina non lo può fingere); senza `wc` lo chiede Filo stesso. Prova: tests/link-invito.spec.mjs.
function invitoFermato(rawUrl, { win = null, wc = null } = {}) {
  const W = globalThis.SN_WALLET;
  if (!W || !W.isInviteDeepLink(rawUrl)) return false;
  if (wc && !Permessi.gestoRecente(wc) && !Permessi.navigazioneDaGesto(wc)) return true;
  try { globalThis.SN_WALLET_MAIN?.portaDentroInvito?.(W.inviteCodeFromDeepLink(rawUrl), win); } catch (_) {}
  return true;
}
// Un indirizzo fermato non resta muto (#482): il silenzio sembra un'app rotta. Solo testo, niente «Apri comunque».
function avvisaIndirizzoFermato(rawUrl, win) {
  const a = avvisoIndirizzoFermato(rawUrl);
  if (!a || !win || win.isDestroyed?.()) return;
  try { win.webContents.send('shell:toast', { text: a.testo, opts: { unica: a.chiave, tipo: 'indirizzo_fermato' } }); } catch (_) {}
}
// Vero se l'indirizzo ha avuto la sua strada (invito, posta al sistema); falso se è stato fermato, e allora lo dice.
function fermaNavigazione(rawUrl, ctx) {
  if (invitoFermato(rawUrl, ctx) || openExternalScheme(rawUrl)) return true;
  avvisaIndirizzoFermato(rawUrl, ctx && ctx.win);
  return false;
}
// La pagina intera passa da will-navigate; qui solo i riquadri, e solo l'invito.
function fermaInvitoNelRiquadro(event, ctx) {
  if (!event || event.isMainFrame !== false || !globalThis.SN_WALLET?.isInviteDeepLink?.(event.url)) return;
  event.preventDefault();
  invitoFermato(event.url, ctx);
}

// La lista dei bloccati si salva mentre si scrive (#590.2): una riga a metà non sposta le schede aperte,
// né verso la pagina «Sito bloccato» né fuori. La seguono quando la lista sta ferma per questo tempo, o quando l'utente le guarda.
const LISTA_FERMA_MS = 3000;

// Il riordino della riapertura parte non prima di questo dall'apertura, e un attimo dopo che la coda ha caricato
// tutto: i siti a pagina unica riempiono il testo dopo la fine del caricamento.
const TRIAGE_RIAPERTURA_MS = 4000;
const TRIAGE_DOPO_CODA_MS = 1500;
// Una pagina bloccata non risponde mai alla lettura del testo: la pulizia va avanti senza il suo estratto (#1618).
const ESTRATTO_TETTO_MS = 1500;
// Lettura delle pagine più giudizio del modello: oltre, il giro finisce come giudizio mancato e la pulizia si sblocca.
const GIUDIZIO_TETTO_MS = 5 * 60_000;
const GESTI_DELLA_BARRA = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'mouseWheel', 'touchStart']);
// Oltre, la pagina che arriva non è più la risposta all'invio di un modulo (#824).
const INVIO_PAGINA_MS = 120_000;
const PAGINA_DI_ACCESSO = /(?:^|[^a-z])(?:log-?in|sign-?in|accedi|accesso|auth|anmelden|connexion|iniciar-sesion)(?:[^a-z]|$)/i;

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

// Pagine senza content script: qui il tasto destro apre un menu nativo, o
// resterebbe inerte (niente taglia/copia/incolla).
const NATIVE_MENU_PAGES = [
  'filo://options/', 'filo://preferences/', 'filo://security/', 'filo://history/',
  'filo://feedback/', 'filo://spellcheck/', 'filo://editor/',
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
// per il colore della selezione). Stessa lista di page-preload.js (sentinella: contentScriptPreload.test.mjs).
const fs = require('node:fs');
const CONTENT_STYLE_FILES = [
  'theme.css', 'menu.css', 'popup.css', 'sidebar.css', 'voce.css',
  'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css',
];
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

// #146.1 — il colore viene dal tema; il letterale è il ripiego per il primo paint. Niente
// var() nella regola nuda: dentro ::selection non si risolve in modo affidabile.
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
    const schedaDavanti = () => this.tabs.find((x) => x.id === this.activeId) || null;
    this.conferme = new ConfermeSopraPagina(window, {
      sotto: () => { const t = schedaDavanti(); return (t && t.view && t.view.webContents) || null; },
      area: () => { const t = schedaDavanti(); return t && t.view ? t.view.getBounds() : null; },
      dopoInCima: () => { if (this.barra) this.barra._inCima(); },
    });
    this.visite = new VisiteSchede({ incognito: this.incognito });
    this.anteprime = new AnteprimeSchede(this, {
      suNuova: (id, dato) => CartaAnteprima.precarica(window, id, dato),
      suTolte: (ids) => CartaAnteprima.dimentica(window, ids),
    });
    this.riserva = new RiservaNuovaScheda(this);
    this.codaRiapertura = new CodaRiapertura({ carica: (tab) => this._caricaRinviata(tab) });
    if (window && typeof window.once === 'function') {
      window.once('closed', () => { this.anteprime.chiudi(); this.riserva.spegni(); this.codaRiapertura.chiudi(); });
    }
    this.avvisi = new AvvisiSopraPagina(window, {
      dopoInCima: () => { if (this.propostaEmail) this.propostaEmail.inCima(); this.conferme.inCima(); if (this.strato) this.strato.inCima(); },
      alto: () => this._altezzaCornice(),
      restituisciTastiera: () => this._tastieraAllaSchedaAttiva(),
      schedaAttiva: () => {
        const t = this.tabs.find((x) => x.id === this.activeId);
        return (t && t.view) || null;
      },
      sottoIlVuoto: () => this.vistaSottoIlVuoto(),
    });
    this.barra = new BarraLaterale(window, this, { alto: () => this._altezzaCornice() });
    this.schedeInAlto = new SchedeInAlto(window, this);
    // L'email dell'account sotto il campo di accesso della scheda davanti (#1124): sopra gli avvisi, sotto la conferma.
    this.propostaEmail = new PropostaEmail(window, {
      area: (wc) => {
        const t = schedaDavanti();
        if (!t || !t.view || t.view.webContents !== wc || this._attivaNascosta) return null;
        if (this.avvisoSito.coperta() === t || (this.conferme && this.conferme.mostrata)) return null;
        const b = t.view.getBounds();
        return b.width > 0 && b.height > 0 ? b : null;
      },
      restituisci: () => this._tastieraAllaSchedaAttiva(),
      sotto: () => [...this.tabs.map((t) => t.view), this.avvisoSito.vista, this.avvisi.vista].filter(Boolean),
      dopoInCima: () => { this.conferme.inCima(); this.barra._inCima(); },
    });
    // Lo strato del menu del tasto destro (#1053): sopra tutto, grande quanto la scheda davanti.
    this.strato = new StratoDelMenu(window, {
      schedaAttiva: () => { const t = schedaDavanti(); return (t && t.view && t.view.webContents) || null; },
      area: () => {
        const t = schedaDavanti();
        return t && t.view && !this._attivaNascosta ? t.view.getBounds() : null;
      },
      scheda: (wc) => { const t = this.tabs.find((x) => x.view && x.view.webContents === wc); return t ? { id: t.id, url: t.url } : null; },
      barra: () => this.barra || null,
    });
    this.avvisoSito = new AvvisoSito(window, {
      schedaAttiva: () => this.tabs.find((x) => x.id === this.activeId) || null,
      scegli: (tab, scelta, dati) => this._sbScelta(tab, scelta, dati),
      menu: (tab) => this._sbVociMenu(tab),
      restituisciTastiera: () => this._tastieraAllaSchedaAttiva(),
      inCima: () => { if (this.barra) this.barra._inCima(); },
      cambiata: () => { if (this.barra) this.barra.aggiornaNav(); },
      input: (wc, input) => {
        if (this.barra) this.barra.inputDa(wc, input);
        if (this.schedeInAlto) this.schedeInAlto.dallaPagina(wc, input);
      },
    });
    // #1526 — chi si è preso lo schermo pieno: sopra la scheda e l'avviso del sito, sotto conferme, barra e menu.
    this.schermoPieno = new AvvisoSchermoPieno(window, {
      area: () => {
        const t = schedaDavanti();
        return t && t.view && this.contentFullscreen && !this._attivaNascosta ? t.view.getBounds() : null;
      },
      sotto: () => this.vistaSottoIlVuoto(),
      restituisciTastiera: () => this._tastieraAllaSchedaAttiva(),
      dopoInCima: () => {
        if (this.propostaEmail) this.propostaEmail.inCima();
        this.conferme.inCima();
        if (this.barra) this.barra._inCima();
        if (this.strato) this.strato.inCima();
      },
      esci: () => this.setContentFullscreen(false),
      regola: () => {
        this.setContentFullscreen(false);
        this.openTab('filo://preferences/preferences.html#sec-schermo-pieno');
      },
    });
    // §1.2 — cache del colore identità per dominio (host → 'rgb(r,g,b)'). Così
    // una nuova tab su un dominio già visto mostra subito la sua tinta, senza
    // aspettare che il content script ricalcoli.
    this._identityColorCache = new Map();
    // §2.1 — l'auto-archiviazione misura l'inattività dell'APP INTERA da qui: gesti nelle schede, scheda attivata, barra.
    this._lastAppInteractionAt = Date.now();
    try {
      this.win.webContents.on('input-event', (_e, input) => {
        if (GESTI_DELLA_BARRA.has(input && input.type)) this._lastAppInteractionAt = Date.now();
      });
    } catch (_) {}
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
    // #514 — la deroga vale SOLO per quella scheda: un Esc da un'altra, o dalla barra, alla
    // pagina non arriverebbe mai e chiuderebbe l'utente dentro senza uscite.
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
    // #152 — in navigazione la decisione è SINCRONA e non può attendere lo storage: qui una
    // copia in memoria. La verità sta in SN_FILO_MEMORY.listProxyRules.
    this._proxyRules = {};
    this.loadProxyRules().catch(() => {});
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
      // Una home che torna in vista (scheda o finestra) rivede subito batteria e rete (#873).
      if (ora) { try { globalThis.SN_SISTEMA_MAIN?.schedaDavanti?.(wc); } catch (_) {} }
      try {
        if (!wc || wc.isDestroyed?.() || !String(wc.getURL() || '').startsWith('filo://')) continue;
        wc.send('filo:broadcast', { type: 'tab_in_vista', inVista: ora });
      } catch (_) {}
    }
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
    this._connessoImpostazioni(cookies);
    for (const tab of this.tabs) {
      this._applySecurity(tab);
    }
  }

  // Idempotente: si può richiamare quante volte serve.
  _applySecurity(tab) {
    if (tab.isInternal) return; // le pagine filo:// sono fidate, niente da limitare
    try {
      // In una scheda proxata WebRTC non deve MAI aprire UDP diretto: con STUN qualsiasi sito
      // leggerebbe l'IP vero. Non disattivabile, vince sull'impostazione dell'utente.
      const policy = tab.proxy
        ? 'disable_non_proxied_udp'
        : (this.security.protectIpLeak ? 'default_public_interface_only' : 'default');
      tab.view.webContents.setWebRTCIPHandlingPolicy(policy);
    } catch (_) { /* policy non supportata in qualche build */ }
  }

  // Quanta shell resta scoperta dalla vista attiva. Serve a ritagliare lo
  // scatto della barra quando si annota tutta l'app col disegno.
  topChromeHeight() {
    if (this.contentFullscreen && !(this.schedeInAlto && this.schedeInAlto.visibili)) return 0;
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
    if (!on) this.schermoPieno.nascondi();
    // La modalità è cambiata: un'uscita ancora in attesa parla di un momento
    // che non c'è più.
    this.annullaUscitaSchermoIntero();
    this.azzeraRivendicazioniEsc();
    if (this.contentFullscreen === on) return on;
    this.contentFullscreen = on;
    this.schedeInAlto.azzera();
    this.strato.nascondi();
    this.layout();
    try {
      if (typeof this.win.setFullScreen === 'function') this.win.setFullScreen(on);
    } catch (_) {}
    // Uscita per una strada diversa dall'Esc sulla pagina che aveva chiesto lo schermo pieno:
    // lei resterebbe convinta di averlo, col lettore dentro una vista tornata sotto la barra.
    if (!on && this.pageFullscreen) this._exitPageFullscreen();
    try {
      const type = globalThis.SN_MSG?.MSG?.FULLSCREEN_CHANGED || 'fullscreen_changed';
      this._broadcastToViews({ type, fullscreen: on });
      // La shell cambia il quadrato in «Esci da schermo intero».
      if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) this.win.webContents.send('filo:broadcast', { type, fullscreen: on });
    } catch (_) {}
    return on;
  }

  toggleContentFullscreen() {
    return this.setContentFullscreen(!this.contentFullscreen);
  }

  // Lo schermo pieno l'ha chiesto questa pagina col suo pulsante (un video): il tasto dello schermo intero
  // premuto lì è suo, come l'Esc. Da un'altra scheda o dalla barra vale il tasto di Filo.
  schermoPienoDi(wc) {
    if (!this.pageFullscreen || !wc) return false;
    const t = this.tabs.find((x) => x.id === this.pageFullscreenTabId);
    return !!(t && t.view && t.view.webContents === wc);
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
        .executeJavaScript('try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {} true', false)
        .catch(() => {});
    } catch (_) {}
  }

  // #514 — regola UNICA dell'Esc a schermo intero: premuto sulla pagina è PRIMA suo, e si
  // esce solo se nessuno se l'è preso. `tabId` null = arriva dalla barra. True = gestito.
  handleFullscreenEscape(tabId = null) {
    if (!this.contentFullscreen) return false;
    // Dalla barra, o da una scheda che non è davanti: la pagina quel tasto non
    // lo vedrà mai, quindi si decide subito.
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

  // Consegna alla pagina l'Esc che il browser le avrebbe mangiato. Torna true
  // se il messaggio è partito, cioè se il tasto ce lo siamo presi noi.
  _inoltraEscAllaPagina(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed?.()) return false;
    const type = globalThis.SN_MSG?.MSG?.ESC_INOLTRATO || 'esc_inoltrato';
    // Al frame con cui l'utente sta interagendo (#405): un menu aperto dentro un riquadro
    // incorporato vive lì, e mandarlo al frame principale lo lascerebbe aperto.
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
    const t = this._perScheda(tabId);
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

  // #514 — a OGNI frame, non al solo principale: anche nei riquadri incorporati c'è il menu
  // del tasto destro, e lì l'Esc va deciso, o la voce di menu promette il contrario.
  _broadcastToViews(message) {
    for (const { wc, inVista } of vistePerAnnunci(this)) spingiAllaScheda(wc, message, { inVista });
  }

  // In privacy ogni sito ha la sua sessione, isolata dagli altri. Le pagine filo:// restano
  // SEMPRE su quella della finestra: lì vivono storage e protocollo.
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

  // Una scheda proxata vive in proxy:<tabId> finché vive: partizione diversa vuol dire cookie
  // separati, quindi niente login condivisi, ed è voluto. Le filo:// restano interne.
  _partitionForTab(tab, url) {
    if (tab && tab.proxy && url && !url.startsWith('filo://')) {
      return `proxy:${tab.id}`;
    }
    return this._partitionFor(url);
  }

  _makeView(url, partition, opts = {}) {
    const webPreferences = this._preferenzeWeb(url, partition, opts);
    // `opts.webContents`: la finestra che una pagina ha aperto col clic, tenuta da lei (setWindowOpenHandler).
    // Con una finestra già nata le preferenze vanno ridate, o il preload non parte nei suoi documenti.
    const view = new WebContentsView(opts.webContents ? { webContents: opts.webContents, webPreferences } : { webPreferences });
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

  _preferenzeWeb(url, partition, opts = {}) {
    const isInternal = url.startsWith('filo://');
    const webPreferences = {
      preload: isInternal ? INTERNAL_PRELOAD : percorsoDelPreload(),
      // Per le pagine interne (filo://) usiamo contextIsolation:false così
      // possiamo overwritare window.chrome direttamente — i file portati
      // dall'estensione si aspettano chrome.* in scope globale. Le pagine
      // web esterne mantengono l'isolation (codice non fidato).
      contextIsolation: !isInternal,
      // Un buco nell'isolamento di una pagina web troverebbe un processo chiuso, non Node (#834). Le pagine interne
      // si decidono a parte: il loro preload richiede ancora i moduli da disco.
      sandbox: !isInternal,
      nodeIntegration: false,
      webSecurity: true,
      // #405 — i riquadri incorporati (video, mappe, commenti, moduli) sono
      // iframe: senza questo flag il preload — e quindi TUTTO Filo (menu del
      // tasto destro, correttore, Spiegazione/Traduci, Incolla con cronologia)
      // — girava solo nel frame principale, e dentro il riquadro il tasto
      // destro non produceva nulla. Con nodeIntegrationInSubFrames il preload
      // parte in ogni sottoframe; `nodeIntegration` resta false e
      // contextIsolation true, quindi il codice della pagina (incluso quello
      // di terze parti dentro l'iframe) NON guadagna alcun accesso allo shim
      // chrome.*, che vive solo nel mondo isolato del preload; e con la
      // sandbox nemmeno quel mondo ha Node.
      // Il costo si paga solo dove serve: nei sottoframe page-preload.js
      // carica i content script alla PRIMA interazione, non al caricamento.
      ...(isInternal ? {} : { nodeIntegrationInSubFrames: true }),
      ...(partition ? { partition } : {}),
    };
    // #145 — le schede ripristinate non devono far ripartire i media da sole. Lo blocca il
    // preload perché `autoplayPolicy` non è onorato dalle WebContentsView.
    if (opts.suppressAutoplay && !isInternal) {
      webPreferences.additionalArguments = [
        ...(webPreferences.additionalArguments || []),
        '--filo-suppress-autoplay',
      ];
    }
    return webPreferences;
  }

  // `apriComunque`: la scheda non passa dalla lista dei siti bloccati per quel sito.
  // `permessoRichieste`: è un «Apri comunque» vero, e passa anche il blocco delle richieste.
  // `bloccoInPagina`: se la lista la ferma, la scheda nasce sulla pagina «Sito bloccato» invece di non nascere.
  // `adotta`: { webContents, partition, sito } della finestra che una pagina ha aperto e tiene; si carica da sé.
  // `rinvia`: la scheda dietro nasce senza caricarsi; la carica la coda della riapertura, o chi la apre (_caricaRinviata).
  // `idRimessa`: l'id che la scheda aveva prima di chiudere Filo, se nessuna lo porta già.
  openTab(url = 'filo://newtab/', { activate = true, restoreScrollPct = null, restoreZoomLevel = null, suppressAutoplay = false, allowDuplicate = false, openedByLink = false, apriComunque = false, permessoRichieste = false, bloccoInPagina = false, daGesto = false, adotta = null, rinvia = false, invio = null, origine = null, azioneMisurata = null, idRimessa = null } = {}) {
    // #252 — INDIRIZZO UNICO per le pagine interne: riporta l'eventuale forma
    // legacy `filo://src/pages/<page>/<file>` (dallo shim getURL) alla forma
    // canonica `filo://<page>/<file>` che usa il menu. Così tutti i punti di
    // ingresso convergono su un solo URL, qualunque chiamante li apra.
    if (typeof url === 'string' && url.startsWith('filo://')) url = canonicalizeFiloUrl(url);
    // Un indirizzo nudo («sito.com/pagina», come a volte lo manda il modello) caricato così resta bianco.
    else if (typeof url === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) url = normalizeUrl(url);

    // Aprire una pagina di Filo è un'azione contata da qualunque strada ci si arrivi (#1461): menu, carte, barra dei
    // menu, link. Chi l'ha già aperta come gesto suo la misura lui; il ripristino apre dietro e non è un gesto.
    // Una voce del menu che apre una scheda (Cerca, Cerca l'immagine) finisce con la pagina caricata, non col clic.
    if (azioneMisurata && !AzioniContate.inCorso()) {
      const opzioni = { ...arguments[1], azioneMisurata: null };
      return AzioniContate.azione(azioneMisurata.id, () => this.openTab(url, opzioni), { incognito: this.incognito, t0: azioneMisurata.t0 });
    }
    const C = globalThis.SN_CONTATORI;
    const azionePagina = activate && !adotta && C && !AzioniContate.inCorso() ? C.azioneDiPagina(url) : '';
    if (azionePagina) {
      const opzioni = arguments[1];
      return AzioniContate.azione(azionePagina, () => this.openTab(url, opzioni), { incognito: this.incognito });
    }

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
    // SICUREZZA (#247) — un loadURL programmatico non emette will-navigate: qui convergono
    // TUTTI gli handler IPC che aprono una scheda, e il cammino IPC → file:// va tenuto chiuso.
    if (isWebUnsafeNav(url)) {
      fermaNavigazione(url, { win: this.win }); // mailto:/tel:/sms: → consegnati all'OS, il resto bloccato
      return null;
    }
    const bloccata = apriComunque ? null : this._decisioneBlocco(null, url);
    if (bloccata && !bloccoInPagina) {
      this._notifyBlocked(bloccata);
      this._contaBloccato(bloccata);
      return null;
    }
    const isInternal = url.startsWith('filo://');
    const rinviata = !!rinvia && !activate && !adotta;
    const partition = adotta ? adotta.partition : this._partitionFor(url);
    // La home già pronta (#1128) vale per la scheda che si apre davanti e non ha niente da rifare al caricamento.
    const pronta = activate && !adotta && !bloccata && restoreScrollPct == null && restoreZoomLevel == null
      ? this.riserva.prendi(url, this._sessionePer(partition))
      : null;
    const id = pronta ? pronta.id : (idRimessa && !idInUso(idRimessa) ? idRimessa : randomUUID());
    const view = pronta ? pronta.vista : this._makeView(url, partition, { suppressAutoplay, webContents: adotta && adotta.webContents });

    const tab = {
      id,
      view,
      title: rinviata ? titoloInAttesa(url) : 'Nuova scheda',
      url,
      // Il data: URL scaricato con la sessione della scheda: lo vede la barra, e salvati e archivio ne tengono la copia.
      favicon: '',
      loading: true,
      canBack: false,
      canFwd: false,
      muted: false,
      isInternal,
      openedAt: new Date().toISOString(),
      // Aperta da Filo, non dalla pagina che l'ha chiesta con window.open: per il filo è un gesto (#1525).
      _gestoFiloAt: adotta ? 0 : Date.now(),
      // Da quando c'è la pagina in vista: dopo un collegamento seguito nella stessa scheda non è più l'apertura (#826).
      paginaDal: null,
      _paginaUrl: senzaAncora(url),
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
      partitionSite: isInternal ? null : (adotta && adotta.sito) || Cookies.registrableOf(url),
      // Proxy per-tab ("Apri da un altro paese"): { country, tier } finché la
      // tab è instradata da un altro paese, null altrimenti. Vedi setTabProxy.
      proxy: null,
      // #754 — banner dei cookie di questo sito: { site, rejected, hidden } (vedi tabs/tabCookies.js).
      cookieOutcome: null,
      // #145 — tab nata da un ripristino di sessione: l'autoplay resta bloccato
      // (vedi _makeView). Memorizzato sulla tab così sopravvive a _recreateView
      // (es. se la tab viene proxata alla nascita per una regola di dominio).
      suppressAutoplay: !!suppressAutoplay,
      // #441 — nata da un link target=_blank, non da un indirizzo dell'utente:
      // è la prima condizione per riconoscerla come pagina-ponte di un download.
      _openedByLink: !!openedByLink,
      // #590 — «Apri comunque» vale per quel sito dentro questa scheda: i suoi
      // link e redirect interni non vanno ribloccati a ogni passo.
      siteBlockAllowed: apriComunque ? siteBlockSiteOf(url) : null,
      // Non per la sessione ripristinata né per un duplicato: toglierebbe il blocco pubblicità al loro sito.
      _permessoRichieste: !!(apriComunque && permessoRichieste),
      // Da dove arriva la prima pagina, per il giudizio sui siti pericolosi (tabs/tabSafebrowse.js). Chi non lo dice non
      // si sa: una porta dimenticata dà «sconosciuta», mai «aperta da Filo», che per il giudice è la più rassicurante.
      _sbOrigine: origine || null,
    };

    this._wireEvents(tab);
    this._applySecurity(tab);
    // Anche la riserva, che è già figlia della finestra: aggiungerla di nuovo la porta in cima, come una vista nuova.
    this.win.contentView.addChildView(view);
    this.tabs.push(tab);
    if (pronta) this._daRiserva(tab, pronta);
    // Le schede rimesse alla riapertura di Filo non sono aperte adesso: erano già aperte (#1561).
    if (!this._restoring) this._nelFilo('schedaAperta', tab, { davanti: !!activate });

    // setBounds PRIMA di loadURL: con dimensione 0x0 il compositor non alloca
    // un display surface valido e le capturePage successive falliscono.
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
    // Una scheda aperta da un clic vero eredita il gesto per la sua prima navigazione e i suoi rinvii (#664 giro 2).
    if (daGesto) view.webContents._filoGestoAlle = Date.now();
    if (rinviata) tab._rinviata = true;
    else if (bloccata) this._mostraPaginaBloccata(tab, url, bloccata);
    // `invio`: i dati di un modulo da mandare con l'apertura (un invio fermato dall'avviso e confermato, #965).
    else if (!adotta && !pronta) {
      AzioniContate.scheda(view.webContents);
      view.webContents.loadURL(url, invio && Array.isArray(invio.data) ? {
        postData: invio.data,
        extraHeaders: `Content-Type: ${invio.contentType || 'application/x-www-form-urlencoded'}${invio.boundary ? `; boundary=${invio.boundary}` : ''}`,
      } : undefined);
    }
    // La pagina che l'ha aperta può chiuderla (window.close): la scheda se ne va con lei.
    if (adotta) {
      const wc = view.webContents;
      AzioniContate.scheda(wc);
      wc.once('destroyed', () => setImmediate(() => { if (this.tabs.includes(tab) && tab.view.webContents === wc) this.closeTab(tab.id, { daSola: true }); }));
    }
    if (activate) {
      // Riaffermo la visibilità su tutti i tab dopo loadURL.
      for (const t of this.tabs) t.view.setVisible?.(this._visibile(t));
      // Una home che si carica si prende la tastiera da sola, anche dalla barra (Ctrl+T, «+»); quella pronta è già
      // carica e la riceve qui, o quello che si scrive subito resta alla barra (#1128).
      if (pronta && !this.win.isDestroyed() && this.win.isFocused()) {
        try { view.webContents.focus(); } catch (_) {}
      } else this._tastieraAllaSchedaAttiva();
    }
    // #152 — born proxied: se il dominio ha una regola persistente, la scheda
    // nasce instradata da quel paese (ricrea la view nella partition proxata).
    if (!bloccata && !rinviata) this._maybeApplyDomainRule(tab, url);
    this._broadcast();
    this.riserva.prepara(pronta ? { fra: 0 } : undefined);
    return id;
  }

  // Una scheda nata in attesa si carica una volta sola, dalla prima strada che ci arriva; la lista dei siti
  // bloccati si guarda adesso, perché può essere cambiata mentre aspettava.
  _caricaRinviata(tab) {
    if (!tab || !tab._rinviata || !this.tabs.includes(tab)) return false;
    tab._rinviata = false;
    tab._gestoFiloAt = Date.now();
    let wc;
    try { wc = tab.view.webContents; if (wc.isDestroyed()) return false; } catch (_) { return false; }
    const url = tab.url;
    const bloccata = this._decisioneBlocco(tab, url);
    if (bloccata) this._mostraPaginaBloccata(tab, url, bloccata);
    else {
      Promise.resolve(wc.loadURL(url)).catch(() => {});
      this._maybeApplyDomainRule(tab, url);
    }
    return true;
  }

  // Caricata da un'altra strada (un indirizzo nuovo, la vista ricreata): alla coda non tocca più.
  _rinviataPresa(tab) {
    if (!tab || !tab._rinviata) return;
    tab._rinviata = false;
    this.codaRiapertura.togli(tab);
  }

  // Gli eventi del caricamento la riserva li ha già avuti da sola: la scheda parte da dove è arrivata la pagina, con
  // quello che la pagina ha detto di sé intanto (colore, risposta all'Esc).
  _daRiserva(tab, pronta) {
    const wc = tab.view.webContents;
    try {
      // Prima del <title> Chromium dà l'indirizzo come titolo: lì resta quello di ogni scheda nuova.
      const titolo = wc.getTitle();
      if (titolo && titolo !== wc.getURL() && !/^filo:/i.test(titolo)) tab.title = titolo;
      tab.loading = wc.isLoading();
    } catch (_) {}
    Object.assign(tab, pronta.campi);
    this._misuraStoria(tab, wc);
    if (pronta.icone) this._aggiornaIcona(tab, wc, pronta.icone);
  }

  // Una scheda che c'è, o la riserva che lo diventerà con questo id: quello che la pagina dice di sé vale per tutte e due.
  _perScheda(id) {
    return this.tabs.find((t) => t.id === id) || this.riserva.campiPer(id);
  }

  // La sessione di una partizione come la vede una vista nata lì (null è quella di sempre).
  _sessionePer(partition) {
    try { return partition ? session.fromPartition(partition) : session.defaultSession; } catch (_) { return null; }
  }

  // Chi ha aperto una scheda per seguirne il percorso (l'accesso a Google, #1123) riceve i suoi indirizzi e la sua
  // chiusura, anche attraverso le viste ricreate. `fn(evento, dati)`; null smette.
  sorveglia(id, fn) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return false;
    tab._sorvegliante = typeof fn === 'function' ? fn : null;
    this._persistSession();
    return true;
  }

  // Aperta, chiusa, portata davanti: il filo lo sa da qui, chiunque l'abbia chiesto (#1561).
  _nelFilo(cosa, tab, opzioni = {}) {
    try { require('./services/accaduti')[cosa](tab, { ...opzioni, incognito: this.incognito }); } catch (_) {}
  }

  _avvisaSorvegliante(tab, evento, dati = {}) {
    const fn = tab && tab._sorvegliante;
    if (!fn) return;
    // Chiusa mentre Filo la seguiva: è un passaggio, e l'archivio non la deve riaprire.
    if (evento === 'chiusa') { tab._sorvegliante = null; tab._passaggio = true; }
    try { fn(evento, dati); } catch (_) {}
  }

  _seguiPercorso(tab, wc) {
    const avvisa = (url, principale) => { if (principale && url) this._avvisaSorvegliante(tab, 'naviga', { url }); };
    try {
      wc.on('did-start-navigation', (_e, url, _inPagina, principale) => avvisa(url, principale));
      wc.on('did-redirect-navigation', (_e, url, _inPagina, principale) => avvisa(url, principale));
      wc.on('did-fail-load', (_e, code, _desc, url, principale) => {
        if (principale && code !== -3) this._avvisaSorvegliante(tab, 'fallita', { url, code });
      });
    } catch (_) {}
  }

  // Una scheda aperta da Filo per un passaggio (la pagina d'accesso) se ne va senza finire nell'archivio.
  chiudiDiServizio(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return false;
    tab._sorvegliante = null;
    return this._dropTab(tab);
  }

  // `via`: come la si chiude, per i contatori della finestra (#1470). `daSola`: chiusa senza che la persona o la pulizia
  // l'abbiano chiesto (la pagina stessa, un'estensione, un crash).
  closeTab(id, { via = 'altro', daSola = false } = {}) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    ContatoriFinestra.misura('chiusa', tab, via, { incognito: this.incognito });
    this._smontaScheda(tab, { daSola });
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      // Si torna alla PENULTIMA scheda guardata, non a quella a sinistra: è quella che l'utente
      // si aspetta. Se nessuna è mai stata attivata vale l'adiacente.
      const next = this._mostRecentlyActiveTab() || this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/'); // niente tab → nuovo newtab
    }
    this._broadcast();
  }

  // Più schede in un colpo, chieste alla chat (#413): come closeTab per ognuna, con una sola attivazione alla fine,
  // così una scheda che sta per chiudersi non si carica solo per passarci sopra. Torna gli id chiusi davvero.
  chiudiSchede(ids) {
    const via = new Set(Array.isArray(ids) ? ids : []);
    const chiuse = this.tabs.filter((t) => via.has(t.id));
    if (!chiuse.length) return [];
    const eraAttiva = chiuse.some((t) => t.id === this.activeId);
    for (const tab of chiuse) {
      ContatoriFinestra.misura('chiusa', tab, 'chat', { incognito: this.incognito });
      this._smontaScheda(tab);
    }
    this.tabs = this.tabs.filter((t) => !via.has(t.id));
    if (eraAttiva) {
      const next = this._mostRecentlyActiveTab() || this.tabs[0];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/');
    }
    this._broadcast();
    return chiuse.map((t) => t.id);
  }

  // A «chiudile tutte» chiesto in chat (#413) restano il testo scritto e non inviato e i siti tenuti sempre aperti:
  // la funzione che torna dice 'testo', 'sempre' o '' (si chiude).
  async motiviPerRestare() {
    await this._caricaSempreAperte();
    return (tab) => {
      if (!tab) return '';
      if (tab.formDirty || this._invioNonTenuto(tab)) return 'testo';
      return this._sempreAperta(tab) ? 'sempre' : '';
    };
  }

  // Quello che ogni chiusura chiesta fa a una scheda prima di toglierla dall'elenco.
  _smontaScheda(tab, { daSola = false } = {}) {
    const id = tab.id;
    this._avvisaSorvegliante(tab, 'chiusa');
    this._nelFilo('schedaChiusa', tab);
    // Se la scheda che se ne va è quella che aveva chiesto il fullscreen al
    // sito (Ctrl+W funziona anche a tutto schermo), lo schermo intero resterebbe
    // acceso con la deroga dell'Esc appesa a una pagina che non esiste più:
    // nessun tasto ne uscirebbe. Spegniamolo insieme a lei (#514).
    if (this.pageFullscreenTabId === id) {
      this.pageFullscreen = false;
      this.pageFullscreenTabId = null;
      this.setContentFullscreen(false);
    }
    // Un'attesa rivolta a questa scheda non ha più nessuno che risponda.
    this.annullaUscitaSchermoIntero();
    // §3.1/§4 — chiudere è archiviare: i metadati si salvano PRIMA di
    // distruggere la vista, o non c'è più niente da leggere.
    this._archiveClosedTab(tab, 'manual', { daSola });
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    ChiusuraConCaselle.chiudi(tab.view.webContents);
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

  // #185 — la chat di Filo vive in una scheda interna, quindi «la scheda su cui agire» non
  // può essere l'attiva: se è interna si prende l'ultima pagina web guardata.
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

  // insertCSS ignora la CSP del sito. Le chiavi restano sulla scheda per poter tornare
  // indietro; una navigazione le azzera da sé.
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
    ContatoriFinestra.misura('trascinata', this, Math.abs(to - from));
    this._broadcast();
    return true;
  }

  // Resta una scheda vuota: la finestra non si chiude da sé.
  closeAllTabs() {
    for (const tab of this.tabs) {
      ContatoriFinestra.misura('chiusa', tab, 'chiudi_tutto', { incognito: this.incognito });
      this._avvisaSorvegliante(tab, 'chiusa');
      this._nelFilo('schedaChiusa', tab);
      this._archiveClosedTab(tab); // §3.1 — anche "chiudi tutto" archivia
      ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
      try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
      ChiusuraConCaselle.chiudi(tab.view.webContents);
    }
    this.tabs = [];
    this.activeId = null;
    this.openTab('filo://newtab/');
  }

  // §3.1 — non bloccante: la chiusura non aspetta l'archivio. NON archivia
  // incognito (§5), pagine interne e nuova scheda: non sono cose da ritrovare.
  _archiveClosedTab(tab, reason = 'manual', { daSola = false } = {}) {
    try {
      if (!tab || this.incognito || tab._passaggio) return;
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
          // I byte che la scheda ha già scaricato con la sua sessione, proxy compreso: l'archivio ne tiene la copia (#1273).
          favicon: tab.favicon || '',
          identityColor: tab.identityColor || null,
          openedAt: tab.openedAt || null,
          closedAt: new Date().toISOString(),
          reason: reason || 'manual',
          ...(daSola ? { chiusaDaSola: true } : {}),
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
  // Instradata entra nel filo da qui, com'è andata, chiunque l'abbia chiesto (#1561): il menu della scheda, la proposta
  // sulla pagina bloccata, Filo da sé (`daSola`). Non con `conseguenza`: una regola per sito, una scheda riaperta com'era.
  async setTabProxy(id, country, { tier, daSola, conseguenza = false } = {}) {
    const r = await this._instradaScheda(id, country, { tier });
    if (!conseguenza && !(r && r.error === 'no_tab')) {
      const esito = r && r.ok ? { eseguita: true } : { eseguita: false, errore: (r && r.error) || 'non riuscito' };
      const paese = (r && r.country) || (typeof country === 'string' ? country : undefined);
      try { require('./services/accaduti').azioneDalPunto('PROXY_TAB', paese ? { country: paese } : {}, esito, { incognito: this.incognito, daSola }); } catch (_) {}
    }
    return r;
  }

  async _instradaScheda(id, country, { tier } = {}) {
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
    // Ogni instradamento, da qualunque strada (blocco per paese, proposta, menu, chat, regola del sito): riuscito o no (#1469).
    const conta = (ok) => this._contaNavigazione((N) => N.proxy(code, resolved ? resolved.tier : tier, ok));
    if (!resolved) { conta(false); return { ok: false, error: 'not_configured' }; }
    const partition = `proxy:${tab.id}`;
    // Sessione effimera (niente 'persist:'). setProxy va ATTESO prima di creare
    // la vista, o le prime richieste partono dirette.
    const ses = session.fromPartition(partition);
    // Senza filo:// qui la pagina d'errore non si carica e un proxy muto lascia la scheda vuota.
    if (!ses.protocol.isProtocolHandled('filo')) registerFiloProtocolForSession(ses);
    // Anche qui il testo scritto risulta partito quando esce verso il sito (#824).
    Cookies.ensureRequestHook(ses);
    try { Cookies.coverAdblock(ses); } catch (_) {}
    try {
      await ses.setProxy({
        proxyRules: resolved.proxyRules,
        ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
      });
    } catch (e) {
      conta(false);
      return { ok: false, error: 'proxy_failed' };
    }
    await ProxyTab.registraRete(partition, ses, resolved);
    tab.proxy = { country: code, tier: resolved.tier };
    // La ricreazione applica anche l'anti-leak WebRTC. Vale pure per il cambio
    // paese: stessa partizione, proxy aggiornato, ricarica dal nuovo endpoint.
    this._recreateView(tab, tab.url || 'filo://newtab/');
    try { globalThis.SN_STORAGE?.updateSettings?.({ proxy: { lastCountry: code } }); } catch (_) {}
    conta(true);
    return { ok: true, country: code, tier: resolved.tier };
  }

  clearTabProxy(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return { ok: false, error: 'no_tab' };
    if (!tab.proxy) return { ok: true };
    try { require('./services/accaduti').azioneDalPunto('RIMUOVI_PROXY', { country: tab.proxy.country }, { eseguita: true }, { incognito: this.incognito }); } catch (_) {}
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
    const dom = Sito.voceSalvata(url, Object.keys(this._proxyRules || {}));
    return (dom && this._proxyRules[dom]) || null;
  }

  // NON blocca la navigazione: senza un fornitore configurato la pagina resta diretta, mai
  // una scheda appesa per un proxy che non c'è. Incognito escluso: niente persistenza.
  _maybeApplyDomainRule(tab, url) {
    if (!tab || this.incognito) return false;
    const rule = this._ruleForUrl(url);
    if (!rule || !rule.country) return false;
    const code = ProxyTab.normalizeCountry(rule.country);
    if (!code) return false;
    if (tab.proxy && tab.proxy.country === code) return false; // già a posto
    tab.url = url; // setTabProxy ricrea la view su tab.url attraverso l'endpoint
    this.setTabProxy(tab.id, code, { tier: rule.tier || undefined, conseguenza: true }).catch(() => {});
    return true;
  }

  // `domain` si riduce al dominio registrabile, la STESSA chiave che usa il
  // confronto in navigazione: con un'altra la regola non scatterebbe mai.
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
    // Subito anche alle schede già aperte: una regola che vale solo la prossima
    // volta sembra non aver funzionato.
    for (const t of this.tabs) {
      if (t.isInternal || !/^https?:\/\//i.test(t.url || '')) continue;
      if (Sito.voceSalvata(t.url, [dom]) !== dom) continue;
      if (t.proxy && t.proxy.country === code) continue;
      try { await this.setTabProxy(t.id, code, { conseguenza: true }); } catch (_) {}
    }
    return { ok: true, domain: dom, country: code };
  }

  // Non tocca le schede già instradate: toglie solo l'automatismo futuro.
  async removeDomainProxyRule({ domain } = {}) {
    const src = String(domain || '');
    const url = /:\/\//.test(src) ? src : `https://${src}`;
    const dom = src ? (Sito.voceSalvata(url, Object.keys(this._proxyRules || {})) || Cookies.registrableOf(url)) : null;
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

  // Mai chiuse dalla pulizia, qualunque cosa decida il modello: l'attiva, quella con audio,
  // quella di un sito tenuto sempre aperto, quella con testo scritto e non inviato (#824, spec §2.1).
  _intoccabileDalTriage(tab) {
    return tab.id === this.activeId || !!tab.audible || this._sempreAperta(tab) || !!tab.formDirty || this._invioNonTenuto(tab);
  }

  // Un modulo col testo dell'utente mandato cambiando pagina: se il sito risponde con un errore, non
  // risponde o chiede di accedere, il testo vive solo nella pagina di prima (Indietro lo rimette).
  _dopoInvio(tab, url, httpResponseCode) {
    const NE = globalThis.SN_NET_ERROR;
    const paginaErrore = !!(NE && NE.isErrorPageUrl && NE.isErrorPageUrl(url));
    if (tab._invioPagina && Date.now() - tab._invioPagina < INVIO_PAGINA_MS) {
      tab._invioRespinto = { codice: Number(httpResponseCode) || 0, fallito: !!tab._invioFallito, accesso: null, caricata: false, pwPrima: !!tab._invioPwPrima };
    } else if (paginaErrore && tab._invioRespinto && tab._invioFallito) {
      // La pagina d'errore di Filo arriva con una navigazione sua, dopo quella fallita.
      tab._invioRespinto.fallito = true;
    } else {
      tab._invioRespinto = null;
    }
    tab._invioPagina = 0;
    tab._invioFallito = false;
    tab._invioPwPrima = false;
  }

  _invioNonTenuto(tab) {
    const r = tab._invioRespinto;
    return !!r && (r.fallito || !(r.codice >= 200 && r.codice < 400) || r.accesso === true);
  }

  // La pulizia decide da cosa c'è nei campi adesso, non da cosa c'era: ogni scheda
  // lo riconferma frame per frame (un campo svuotato dopo l'invio, un riquadro
  // sparito, un editor che ha messo il testo dopo l'ultimo segnale).
  async _ricontrollaModuli() {
    let chiesto = false;
    for (const tab of this.tabs) {
      let frames = [];
      try { frames = tab.view.webContents.mainFrame.framesInSubtree || []; } catch (_) {}
      // Senza l'elenco dei frame non si toglie niente: nel dubbio la scheda resta protetta.
      if (!frames.length) continue;
      const vivi = new Set(frames.map(chiaveFrame));
      for (const k of [...(tab._moduli || [])]) if (!vivi.has(k)) tab._moduli.delete(k);
      for (const k of [...(tab._impronte ? tab._impronte.keys() : [])]) if (!vivi.has(k)) tab._impronte.delete(k);
      tab.formDirty = !!(tab._moduli && tab._moduli.size);
      const inv = tab._invioRespinto;
      if (inv && inv.accesso === null && !this._invioNonTenuto(tab)) {
        // Il sito che a sessione scaduta rimanda all'accesso risponde come a un invio riuscito.
        try {
          const p = await Promise.race([
            tab.view.webContents.executeJavaScript(
              '(function(){try{return {pw:Array.prototype.some.call(document.querySelectorAll("input[type=password]"),function(e){return e.getClientRects().length>0;}),dove:location.pathname,titolo:document.title};}catch(e){return {};}})()',
              false,
            ),
            new Promise((r) => setTimeout(() => r(null), 1000)),
          ]);
          // Una password che c'era già nella pagina dell'invio (l'accesso in testata) non dice che la sessione è scaduta.
          if (p) inv.accesso = (!!p.pw && !inv.pwPrima) || PAGINA_DI_ACCESSO.test(String(p.dove || '')) || PAGINA_DI_ACCESSO.test(String(p.titolo || ''));
        } catch (_) {}
      }
      // Le impronte del documento di prima: la pagina nuova può mostrare il testo mandato al server.
      const impronte = tab._improntePrima || [];
      spingiAllaScheda(tab.view.webContents, { type: globalThis.SN_MSG?.MSG?.FORM_RECHECK || 'form_recheck', impronte }, { inVista: tab.id === this.activeId });
      chiesto = true;
    }
    if (chiesto) await new Promise((r) => setTimeout(r, 400));
  }

  // Candidati archiviabili: schede web + pagine interne EFFIMERE (home/nuova
  // scheda, impostazioni). Prima erano esclusi TUTTI i filo:// interni, quindi
  // il riordino poteva chiudere un sito (es. YouTube) ma mai le impostazioni
  // aperte o le home duplicate. (Incognito è escluso a monte.)
  _triageCandidates() {
    const T = globalThis.SN_TAB_TRIAGE;
    return this.tabs.filter((t) => {
      if (this._intoccabileDalTriage(t)) return false;
      if (T) return T.isTriageableUrl(t.url);
      return !t.isInternal && /^https?:\/\//i.test(t.url || '');
    });
  }

  // «Tieni sempre aperto X» (#823): la regola la applica Filo, qualunque cosa risponda il modello.
  async _caricaSempreAperte() {
    try {
      const FM = globalThis.SN_FILO_MEMORY;
      this._sempreAperte = FM ? Object.keys(await FM.listKeepOpen()) : [];
    } catch (_) {
      this._sempreAperte = this._sempreAperte || [];
    }
  }

  _sempreAperta(tab) {
    const T = globalThis.SN_TAB_TRIAGE;
    return !!(T && tab && T.voceTenuta(tab.url, this._sempreAperte));
  }

  async _gatherTriageInput(cands) {
    // Senza la regola non si sa: nel dubbio ogni pagina vale delicata, come negli altri lavori automatici (#1004).
    let fuori = () => 'campi';
    let guasto = true;
    try { fuori = await globalThis.SN_DELICATE.filtro(); guasto = false; } catch (_) {}
    // Di una pagina delicata il testo non si legge nemmeno: al modello arriva solo il tipo (#1004).
    const delicate = cands.map((t) => fuori(t.url));
    for (const d of delicate) {
      if (d) ContatoriSicurezza.misura('paginaDelicata', guasto ? 'filtro_guasto' : d, 'riordino_schede', { incognito: !!this.incognito });
    }
    const estratti = await Promise.all(cands.map((t, i) => (delicate[i] || t._rinviata ? '' : leggiEstratto(t))));
    const now = Date.now();
    const minutiDa = (ms) => (Number.isFinite(ms) && ms > 0 ? Math.max(0, Math.round((now - ms) / 60000)) : null);
    const out = [];
    for (const [i, t] of cands.entries()) {
      const delicata = delicate[i];
      const contentExtract = typeof estratti[i] === 'string' ? estratti[i] : '';
      out.push({
        url: t.url,
        title: t.title,
        ageMin: minutiDa(Date.parse(t.openedAt)),
        // Mai toccata da quando c'è: inattiva da quando è arrivata la sua pagina (#1618).
        idleMin: minutiDa(t.lastInteractionAt || Date.parse(t.paginaDal) || Date.parse(t.openedAt)),
        scrollPct: typeof t.scrollPct === 'number' ? t.scrollPct : null,
        formDirty: !!t.formDirty,
        audible: !!t.audible,
        coOpenUrls: this.tabs
          .filter((x) => x.id !== t.id && /^https?:\/\//i.test(x.url || ''))
          .map((x) => x.url).slice(0, 20),
        contentExtract,
        delicata,
      });
    }
    return out;
  }

  // I DUPLICATI esatti si chiudono per regola, mai chiedendolo all'LLM: non serve giudizio e
  // deve funzionare anche senza modello. All'LLM restano i casi di giudizio.
  // `da`: 'chat' quando l'ha chiesto la chat, per i contatori della finestra (#1470).
  async runAutoTriage({ trigger = 'idle', da = '' } = {}) {
    if (this.incognito) return { archived: 0 };
    // Chi chiede il riordino mentre ne gira già uno non ha ottenuto niente:
    // rispondergli «nessuna scheda da archiviare» è la frase di un riordino
    // riuscito, e i due casi si confondono.
    if (this._triageRunning) {
      ContatoriFinestra.misura('giroRiordino', trigger, { giaInCorso: true });
      return { archived: 0, giaInCorso: true };
    }
    this._triageRunning = true;
    try {
      await this._ricontrollaModuli();
      await this._caricaSempreAperte();
      const cands = this._triageCandidates();
      // Un giro si conta coi suoi numeri, mai con le schede (#1467): quante candidate, archiviate, duplicate.
      const contaGiro = (archiviate, duplicati, giudizioMancato) => {
        try {
          globalThis.SN_CONTATORI_MAIN?.attivita('pulizia', { trigger, candidate: cands.length, archiviate, duplicati, giudizioMancato }, { incognito: !!this.incognito });
        } catch (_) {}
      };
      if (!cands.length) {
        ContatoriFinestra.misura('giroRiordino', trigger, {});
        contaGiro(0, 0, false);
        return { archived: 0 };
      }
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
      // Il giudizio può non arrivare (crediti finiti, chiave sbagliata, rete
      // giù): chi ha chiesto il riordino deve saperlo, o legge lo stesso esito
      // di un riordino riuscito in cui non c'era niente da chiudere.
      const decide = globalThis.SN_TAB_TRIAGE_DECIDE;
      let decisions = [];
      let giudizioMancato = true;
      let errore = null;
      if (typeof decide === 'function') {
        let tetto = null;
        try {
          const giudizio = (async () => {
            const input = await this._gatherTriageInput(cands);
            const r = await decide({ tabs: input, trigger });
            if (!Array.isArray(r && r.decisions)) throw erroreDiPulizia('Il modello ha risposto senza dire quali schede tenere. Riprova, o scegli un altro modello per «Gestione schede» in Opzioni → Modelli per azione.', 'ALTRO_MODELLO');
            return r.decisions;
          })();
          giudizio.catch(() => {});
          const scaduto = new Promise((_, no) => {
            tetto = setTimeout(() => no(erroreDiPulizia('Il modello non ha risposto in tempo. Riprova più tardi.')), GIUDIZIO_TETTO_MS);
            tetto.unref?.();
          });
          decisions = await Promise.race([giudizio, scaduto]);
          giudizioMancato = false;
        } catch (e) {
          decisions = [];
          errore = e;
        } finally {
          clearTimeout(tetto);
        }
      }
      this._dichiaraGiudizio(giudizioMancato, errore, trigger);

      // I duplicati vincono sempre su un "tieni" dell'LLM.
      const byIndex = new Map();
      for (const d of decisions) {
        if (d && typeof d.i === 'number') byIndex.set(d.i, d);
      }
      for (const i of dupIdx) {
        byIndex.set(i, { i, action: 'archive', reason: 'duplicato' });
      }
      const esito = this.applyTriageDecisions(cands, [...byIndex.values()], { via: da === 'chat' ? 'chat' : 'riordino_automatico' });
      ContatoriFinestra.misura('giroRiordino', trigger, { duplicati: esito.duplicati, modello: esito.archived - esito.duplicati, giudizioMancato });
      contaGiro(esito.archived, dupIdx.size, giudizioMancato);
      return giudizioMancato ? { ...esito, giudizioMancato: true } : esito;
    } finally {
      this._triageRunning = false;
    }
  }

  // Una pulizia partita da sola senza il giudizio del modello lo dice (#1618): l'avviso resta finché non lo si chiude,
  // perché il giro dell'inattività parte quando l'utente non c'è, e torna solo se cambia il motivo. Quella chiesta a
  // mano lo dice già a chi l'ha chiesta.
  _dichiaraGiudizio(mancato, errore, trigger) {
    if (!mancato) { this._giudizioMancatoDetto = null; return; }
    console.warn(`[Filo] pulizia delle schede (${trigger}) senza giudizio del modello:`, errore ? (errore.message || errore) : 'nessuna funzione di giudizio');
    if (trigger === 'manual') return;
    let perche = '';
    let pagina = null;
    try {
      const CE = globalThis.SN_CHAT_ERRORS;
      perche = String((errore && errore.userMessage) || (errore && CE ? CE.sentence(errore) : '') || '');
      pagina = errore && CE ? CE.rimedioPagina(errore) : null;
    } catch (_) {}
    if (this._giudizioMancatoDetto === perche) return;
    this._giudizioMancatoDetto = perche;
    const testo = `La pulizia automatica non è riuscita a valutare le schede.${perche ? ` ${perche}` : ''}`;
    const actions = pagina ? [{ label: pagina.label, openUrl: pagina.url }] : [];
    try { this.win.webContents.send('shell:toast', { text: testo, opts: { durationSec: 0, unica: 'pulizia-schede-mancata', tipo: 'riordino_mancato', actions } }); } catch (_) {}
  }

  // Applica le decisioni LLM: archivia+chiude le tab marcate 'archive', poi
  // riordina cromaticamente i superstiti (§1.3) e mostra il toast (§2.3).
  // `cands` è l'elenco indicizzato passato all'LLM.
  applyTriageDecisions(cands, decisions, { via = 'riordino_automatico' } = {}) {
    const byIndex = new Map();
    for (const d of (decisions || [])) {
      if (d && typeof d.i === 'number') byIndex.set(d.i, d);
    }
    const toArchive = [];
    cands.forEach((tab, i) => {
      const d = byIndex.get(i);
      if (!d || d.action !== 'archive') return;
      // Ricontrollata qui: mentre il modello rispondeva l'utente può aver scritto.
      if (this._intoccabileDalTriage(tab)) return;
      toArchive.push({ tab, reason: d.reason || 'auto' });
    });

    for (const { tab, reason } of toArchive) {
      ContatoriFinestra.misura('chiusa', tab, via, { incognito: this.incognito });
      this._avvisaSorvegliante(tab, 'chiusa');
      this._archiveClosedTab(tab, reason);
      ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
      const idx = this.tabs.findIndex((t) => t.id === tab.id);
      if (idx >= 0) {
        // Solo se c'è ancora: chiusa mentre il modello decideva, l'ha già detto chi l'ha chiusa.
        this._nelFilo('schedaChiusa', tab, { come: 'archiviata', daSola: 'automazione' });
        try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
        ChiusuraConCaselle.chiudi(tab.view.webContents);
        this.tabs.splice(idx, 1);
      }
    }

    if (!this.tabs.length) this.openTab('filo://newtab/');
    else if (!this.tabs.some((t) => t.id === this.activeId)) this.activate(this.tabs[0].id);

    // §1.3 — a OGNI giro, non solo quando si è archiviato qualcosa: all'apertura
    // la barra dev'essere riordinata comunque.
    const reordered = this.reorderTabsByColor();
    if (reordered) ContatoriFinestra.misura('riordinatoPerColore', this);
    if (toArchive.length || reordered) this._broadcast();
    if (toArchive.length) this._showTriageToast(toArchive.length);
    return { archived: toArchive.length, duplicati: toArchive.filter((x) => x.reason === 'duplicato').length };
  }

  // §1.3 — riordina la striscia per colore con la stessa regola della Cronologia (compareRainbow).
  // Ritorna true se l'ordine è effettivamente cambiato (per decidere se
  // ribroadcastare alla shell).
  reorderTabsByColor() {
    const before = this.tabs;
    const withIdx = before.map((t, i) => ({ t, i }));
    withIdx.sort((a, b) => compareRainbow(a.t.identityColor, b.t.identityColor) || a.i - b.i);
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
        text: 'Schede riordinate. Quelle chiuse restano nel filo della home',
        opts: { tipo: 'riordino_schede' },
      });
    } catch (_) {}
  }

  // §1.1 — solo se cambia davvero: i campioni arrivano di continuo durante lo
  // scroll e ridisegnerebbero la barra ogni volta.
  setTabColor(id, color) {
    const tab = this._perScheda(id);
    if (!tab) return;
    const next = color || null;
    if (tab.color === next) return;
    tab.color = next;
    if (this.tabs.includes(tab)) this._broadcast();
  }

  // L'icona la scarica il main con la sessione di questa scheda: la barra riceve solo byte già scaricati (#1083).
  // Fino all'arrivo resta quella di prima: un'icona che cambia nella stessa pagina (un contatore) non lampeggia.
  _aggiornaIcona(tab, wc, candidati) {
    const lista = (Array.isArray(candidati) ? candidati : []).filter((u) => typeof u === 'string' && u);
    const giro = (tab._giroIcona || 0) + 1;
    tab._giroIcona = giro;
    const vivo = () => tab._giroIcona === giro && !!tab.view && tab.view.webContents === wc && !wc.isDestroyed();
    let pagina = '';
    try { pagina = wc.getURL() || ''; } catch (_) {}
    const interna = /^filo:/i.test(pagina);
    IconaScheda.iconaPer(wc.session, lista, { interna, vivo, pagina }).then(({ dato }) => {
      if (!vivo()) return;
      try { tab._origineIcona = origineDi(wc.getURL()); } catch (_) {}
      if (tab.favicon === dato) return;
      tab.favicon = dato;
      this._broadcast();
    }, () => {});
  }

  // §1.2 — a differenza del colore campionato non cambia con lo scroll né si azzera a ogni
  // navigazione: vale finché la scheda resta sul dominio, e si calcola una volta per host.
  setTabIdentityColor(id, color) {
    const tab = this._perScheda(id);
    if (!tab) return;
    const next = color || null;
    const host = hostOf(tab.url);
    if (next && host) this._identityColorCache.set(host, next);
    if (tab.identityColor === next) return;
    tab.identityColor = next;
    if (this.tabs.includes(tab)) this._broadcast();
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
        false,
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
      // La copia eredita l'«Apri comunque» della scheda, non ne concede uno nuovo:
      // la copia di una pagina «Sito bloccato» è ancora quella pagina (#590).
      apriComunque: this._siteAllowedIn(tab, tab.url),
      permessoRichieste: this._siteAllowedIn(tab, tab.url) && !!tab._permessoRichieste,
      bloccoInPagina: true,
    });
  }

  // Apre l'assistente SU quella scheda, col contesto di dove è stato chiamato. Stesso canale
  // delle scorciatoie: una strada sola, che vale anche sulle pagine interne.
  openHelp(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (this.activeId !== id) this.activate(id);
    if (this.avvisoSito.coperta() === tab) {
      require('./services/interruttoreAiuto').seAcceso(this.win, () => this._sbScelta(tab, 'chiedi'));
      return;
    }
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
    const cambiata = this.activeId !== id;
    if (cambiata) this.anteprime.congeda(this.tabs.find((t) => t.id === this.activeId));
    this.anteprime.mostrata(tab);
    this.activeId = id;
    if (cambiata && !this._restoring) this._nelFilo('schedaDavanti', tab);
    // §2.1 — una scheda che diventa attiva è "usata adesso". Approssimazione
    // grossolana: il content script la raffina con gli eventi veri.
    const now = Date.now();
    tab.lastActiveAt = now;
    tab.lastInteractionAt = now;
    tab.activateSeq = this._nextActivationSeq(); // ordine MRU per la chiusura tab
    this._lastAppInteractionAt = now; // attivare una tab = usare Filo (§2.1)
    for (const t of this.tabs) {
      t.view.setVisible?.(this._visibile(t));
    }
    this.layout();
    // Dopo layout(): la pagina si carica con le misure della scheda davanti.
    if (tab._rinviata && !this.codaRiapertura.subito(tab)) this._caricaRinviata(tab);
    this._tastieraAllaSchedaAttiva();
    if (tab._listaTimer) this._seguiLista(tab, { ora: true });
    if (cambiata) this._avvisaSchermoPieno();
    this._broadcast();
  }

  // #1526 — chi si è preso lo schermo pieno lo dice la pillola: il frame che l'ha chiesto, letto adesso dal gestore
  // dei permessi, mai il titolo.
  _schermoPienoChiesto(tab) {
    let pagina = '';
    try { pagina = tab.view.webContents.getURL(); } catch (_) { pagina = ''; }
    const da = tab._schermoPienoDa;
    tab._schermoPienoDa = null;
    const chiede = da && Date.now() - da.alle < 10_000 ? da.url : '';
    tab._schermoPienoParti = partiDellAvviso(pagina || tab.url, chiede, tastoEsc());
  }

  // La frase per la scheda davanti finché lo schermo pieno l'ha chiesto un sito, o null. Un'altra scheda (anche una
  // che la pagina ha aperto col suo clic) sta a schermo pieno senza averlo chiesto: si nomina da sé, Filo escluso.
  _partiSchermoPieno(tab) {
    if (!tab || !this.pageFullscreen || !this.contentFullscreen || tab.id !== this.activeId) return null;
    if (tab.id === this.pageFullscreenTabId) return tab._schermoPienoParti || null;
    let url = '';
    try { url = tab.view.webContents.getURL(); } catch (_) { url = ''; }
    url = url || tab.url || '';
    if (/^filo:/i.test(url)) return null;
    tab._schermoPienoParti = partiDellAvviso(url, '', tastoEsc());
    return tab._schermoPienoParti;
  }

  _avvisaSchermoPieno() {
    const parti = this._partiSchermoPieno(this.tabs.find((t) => t.id === this.activeId));
    if (parti) this.schermoPieno.mostra(parti);
    else this.schermoPieno.nascondi();
  }

  // Col puntatore sul bordo alto la pillola torna, o se è già lì riparte il suo tempo.
  _ricompariSchermoPieno(tab) {
    const parti = this._partiSchermoPieno(tab);
    if (parti) this.schermoPieno.ricompari(parti);
  }

  // La scheda davanti che non l'ha chiesto va altrove (quella aperta dalla pagina nasce vuota e poi carica il suo
  // sito): se cambia chi si nomina, la pillola lo dice.
  _schermoPienoNavigata(tab) {
    const prima = JSON.stringify(tab._schermoPienoParti || null);
    const parti = this._partiSchermoPieno(tab);
    if (parti && JSON.stringify(parti) !== prima) this.schermoPieno.mostra(parti);
  }

  // La scheda davanti prende la tastiera se questa era su una scheda che non si
  // vede più, o su niente perché la view chiusa se l'è portata via: senza, dopo
  // Ctrl+W, Alt+cifra o Alt+S i tasti non arrivano a nessuno finché non si
  // clicca (#838). La barra che ha la tastiera la tiene; Filo dietro non la ruba.
  // Una scheda coperta dall'avviso del sito pericoloso dà la tastiera all'avviso, mai alla pagina (#813.5).
  // Quello che l'utente vede sotto le viste posate sulla pagina (barra, avvisi): l'avviso del sito quando copre la
  // scheda, sennò la scheda. I gesti del loro vuoto vanno qui, mai alla pagina che l'avviso nasconde.
  vistaSottoIlVuoto() {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab) return null;
    const domanda = this.conferme && this.conferme.mostrata ? this.conferme.vista : null;
    const avviso = this.avvisoSito && this.avvisoSito.coperta() === tab && this.avvisoSito.webContents() ? this.avvisoSito.vista : null;
    return domanda || avviso || tab.view || null;
  }

  _tastieraAllaSchedaAttiva() {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || this.win.isDestroyed() || !this.win.isFocused()) return;
    const avviso = this.avvisoSito.coperta() === tab ? this.avvisoSito.webContents() : null;
    const dest = avviso || tab.view.webContents;
    const col = require('electron').webContents.getFocusedWebContents();
    if (col === this.win.webContents || col === dest) return;
    try { dest.focus(); } catch (_) {}
  }

  // §2.1 — segnali di attività del content script (input, scroll, form sporco), arrivano a ogni clic e
  // scorrimento. Servono solo al main (triage, archivio): niente broadcast né salvataggio di sessione (#1089).
  setTabActivity(id, activity, frame = null) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !activity || typeof activity !== 'object') return;
    // Solo un gesto dell'utente dice «Filo è in uso»: scorrimenti e moduli ricontrollati arrivano anche da soli (#1618).
    if (Number.isFinite(activity.lastInteractionAt) && activity.lastInteractionAt > 0) {
      const adesso = Date.now();
      tab.lastInteractionAt = Math.min(activity.lastInteractionAt, adesso);
      this._lastAppInteractionAt = adesso;
    }
    if (typeof activity.scrollPct === 'number') tab.scrollPct = Math.max(0, Math.min(100, Math.round(activity.scrollPct)));
    if (typeof activity.formDirty === 'boolean') {
      // Una voce per frame: il «niente» della pagina non cancella il testo di un riquadro.
      if (!tab._moduli) tab._moduli = new Set();
      const k = frame ? chiaveFrame(frame) : '';
      if (activity.formDirty) tab._moduli.add(k); else tab._moduli.delete(k);
      tab.formDirty = tab._moduli.size > 0;
    }
    if (activity.invioPagina === true) { tab._invioPagina = Date.now(); tab._invioFallito = false; tab._invioPwPrima = activity.pwPrima === true; }
    if (Array.isArray(activity.impronte)) {
      if (!tab._impronte) tab._impronte = new Map();
      const imp = activity.impronte.filter((x) => typeof x === 'string' && x.length <= 32).slice(0, 50);
      tab._impronte.set(frame ? chiaveFrame(frame) : '', imp);
    }
  }

  navigate(id, url) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab._gestoFiloAt = Date.now();
    // Un indirizzo nuovo chiesto mentre «Riprova» era in volo: il suo esito non è più quello della pagina d'errore.
    tab._riprova = null;
    const target = normalizeUrl(url);
    // SICUREZZA (#248) — come openTab: un loadURL programmatico non emette will-navigate, e qui
    // convergono TUTTI gli handler IPC che rinavigano una scheda. mailto/tel/sms vanno all'OS.
    if (isWebUnsafeNav(target)) {
      fermaNavigazione(target, { win: this.win });
      return;
    }
    if (this._maybeBlockNavigation(tab, target)) return;
    this._rinviataPresa(tab);
    // La WebContentsView va RICREATA (non basta un loadURL) quando cambia la
    // partizione (privacy, fra siti diversi) oppure quando si attraversa il
    // confine di fiducia interno↔esterno: il preload e contextIsolation sono
    // fissati alla creazione della view e un loadURL non li rivaluta, quindi
    // riusare la view caricherebbe il contenuto col preload sbagliato.
    if (this._needsRecreate(tab, target)) {
      this._recreateView(tab, target, { nuova: true });
    } else {
      tab.view.webContents.loadURL(target);
    }
    AzioniContate.scheda(tab.view.webContents);
    // #152 — DOPO il caricamento normale, mai prima: senza fornitore resta la
    // connessione diretta già caricata, invece di una scheda appesa.
    this._maybeApplyDomainRule(tab, target);
  }

  _needsRepartition(tab, url) {
    const next = this._partitionForTab(tab, url);
    return (next || null) !== (tab.partition || null);
  }

  // Confine di FIDUCIA: una pagina filo:// nasce col preload privilegiato e il preload non
  // cambia con un loadURL — navigarci un sito esterno gli darebbe chiavi e dati.
  _crossesTrustBoundary(tab, url) {
    const nextInternal = String(url || '').startsWith('filo://');
    return nextInternal !== !!tab.isInternal;
  }

  _needsRecreate(tab, url) {
    return this._crossesTrustBoundary(tab, url) || this._needsRepartition(tab, url);
  }

  // Ricrea la WebContentsView di `tab` nella partizione corretta per `url`,
  // preservando id/posizione/stato attivo. Necessario in privacy ai cambi di
  // sito: la partizione non è modificabile dopo la creazione della view.
  // La cronologia è per-WebContents: le voci della vista vecchia restano nella
  // scheda (tab.storia, src/main/tabs/storia.js), e Indietro e Avanti ci arrivano.
  // `opts.loadUrl` (#327): URL da caricare al posto di `url` — la view resta
  // configurata (preload/partition/isInternal) per `url`. Usato dal recupero
  // crash per mostrare la pagina d'errore in una view pronta a ritentare il sito.
  _recreateView(tab, url, opts = {}) {
    this._rinviataPresa(tab);
    const wasActive = tab.id === this.activeId;
    const partition = this._partitionForTab(tab, url);
    // La pagina che la vista vecchia mostrava: se il primo salto della nuova si ferma sulla lista, si torna lì.
    let prima = '';
    try { prima = opts.ritorno ? '' : (tab.view.webContents.getURL() || this._inArrivo(tab).url || ''); } catch (_) {}
    if (!opts.storia) {
      const modo = opts.ritorno ? 'ritorno' : opts.nuova ? 'nuova' : 'stessa';
      tab.storia = Storia.conserva(tab.storia, this._vociDellaVista(tab), modo, url);
    }
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    ChiusuraConCaselle.chiudi(tab.view.webContents);
    const view = this._makeView(url, partition, { suppressAutoplay: tab.suppressAutoplay });
    tab.view = view;
    tab._vistaNuova = { wc: view.webContents, prima: /^(https?|filo):/i.test(prima) ? prima : '', meta: { url, titolo: opts.titolo || '' } };
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
    tab._gestoFiloAt = Date.now();
    if (!canGoBack(tab.view.webContents)) { this._vaiFuori(tab, 'indietro', 0); return; }
    const meta = this._vocePassoStoria(tab, -1);
    if (meta && this._maybeBlockNavigation(tab, meta)) return;
    tab._passoStoria = true;
    AzioniContate.scheda(tab.view.webContents);
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

  // Cmd+freccia su Mac dalle viste di Filo senza un preload che lo rimandi (la barra in alto, la
  // barra laterale): diventa indietro/avanti solo se lì non si scrive. true = ha navigato.
  async _navigaSeNonScrive(wc, verso, id) {
    try {
      if (await require('./menu').staScrivendo(wc)) return false;
    } catch (_) { return false; }
    this.navigaCronologia(verso, id);
    return true;
  }

  // Cmd+freccia che la pagina non ha usato (src/preload/cmd-freccia.js). Vale solo
  // per un tasto vero appena visto passare dal main su quella scheda: è lui che sa
  // se siamo su Mac, e una pagina non deve poter navigare da sé con questo messaggio.
  cmdFrecciaNonUsata(wc, verso) {
    const visto = wc && wc._filoCmdFreccia;
    if (!visto || visto.verso !== verso || Date.now() - visto.t > 3000) return;
    wc._filoCmdFreccia = null;
    const tab = this.tabs.find((t) => t.view && t.view.webContents === wc);
    if (tab) this.navigaCronologia(verso, tab.id);
  }

  // I tasti del browser (#404, #685) da qualunque vista della finestra abbia il fuoco: la scheda, e la barra
  // laterale aperta da tastiera (#871 giro 9). `tab` è la scheda su cui agire. true = preso.
  tastoDelBrowser(input, tab) {
    if (!input || !tab) return false;
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
          AzioniContate.azione('switch-tab-by-number', () => this.activate(target.id), { incognito: !!this.win._filoIncognito });
          return true;
        }
      }
      // Ctrl+Tab e Ctrl+Shift+Tab (#590.14). Un'azione di Filo che l'utente ci aveva messo prima resta sua.
      const vicina = globalThis.SN_TASTI.azioneFiloDaTasto(input)
        ? null : indiceSchedaVicina(input, this.tabs.indexOf(tab), this.tabs.length);
      if (vicina != null) {
        if (this.tabs[vicina] && this.tabs[vicina] !== tab) this.activate(this.tabs[vicina].id);
        return true;
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
        AzioniContate.azione('navigate-back-forward', () => this.navigaCronologia(verso, tab.id), { incognito: !!this.win._filoIncognito });
        return true;
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
      const conta = (azione, fn) => { AzioniContate.azione(azione, fn, { incognito: !!this.win._filoIncognito }); return true; };
      if (k === 't') return conta('new-tab', () => this.openTab('filo://newtab/'));
      if (k === 'w') return conta('close-tab', () => this.closeTab(tab.id, { via: 'ctrl_w' }));
      // L'indirizzo si digita dalla home (la barra indirizzi è stata tolta):
      // Ctrl+L apre la home di Filo, esattamente come nella shell.
      if (k === 'l') return conta('address-bar', () => this.navigate(tab.id, 'filo://newtab/'));
      if (k === 'r') return conta('reload', () => this.reload(tab.id));
    }
    return false;
  }
  // Le pagine dietro (o davanti) nella cronologia della scheda, dalla più vicina: il tasto destro su
  // Indietro e Avanti della barra laterale le elenca, e sceglierne una ci torna con vaiAllaVoce.
  vociCronologia(verso, id) {
    const tab = this.tabs.find((t) => t.id === (id || this.activeId));
    const h = tab && tab.view.webContents.navigationHistory;
    if (!h || typeof h.getEntryAtIndex !== 'function') return [];
    const attiva = h.getActiveIndex();
    const passo = verso === 'avanti' ? 1 : -1;
    const out = [];
    for (let i = attiva + passo; i >= 0 && i < h.length(); i += passo) {
      const e = h.getEntryAtIndex(i);
      if (e) out.push({ indice: i, titolo: String(e.title || ''), url: String(e.url || '') });
    }
    return [...out, ...Storia.elenco(tab.storia, verso, h.length())];
  }

  vaiAllaVoce(id, indice) {
    const tab = this.tabs.find((t) => t.id === id);
    const h = tab && tab.view.webContents.navigationHistory;
    const i = Math.round(Number(indice));
    if (!h || !Number.isFinite(i) || i === h.getActiveIndex()) return;
    tab._gestoFiloAt = Date.now();
    const f = Storia.fuori(i, h.length());
    if (f) { this._vaiFuori(tab, f.verso, f.k); return; }
    tab._passoStoria = true;
    h.goToIndex(i);
  }

  // ── la cronologia oltre la vista (src/main/tabs/storia.js) ──
  _urlUtente(raw) {
    const NE = globalThis.SN_NET_ERROR;
    return (NE && NE.targetOf(raw)) || raw;
  }

  // La pagina che la vista appena nata sta ancora caricando: fino al primo commit la sua cronologia è vuota.
  _inArrivo(tab) {
    const n = tab && tab._vistaNuova;
    return (n && tab.view && n.wc === tab.view.webContents && n.meta) || { url: '' };
  }

  _vociDellaVista(tab) {
    const inArrivo = this._inArrivo(tab);
    try {
      const h = tab.view.webContents.navigationHistory;
      const entries = [];
      for (let i = 0; i < h.length(); i++) entries.push(h.getEntryAtIndex(i) || {});
      return Storia.vociDellaVista(entries, h.getActiveIndex(), (u) => this._urlUtente(u), inArrivo);
    } catch (_) { return Storia.vociDellaVista([], 0, (u) => u, inArrivo); }
  }

  // Indietro e Avanti hanno dove andare: nella vista, o nella cronologia che la scheda ha tenuto da quelle di prima.
  puoTornare(tab, verso, wc = tab && tab.view && tab.view.webContents) {
    if (!tab || !wc) return false;
    let inVista = false;
    try { inVista = verso === 'avanti' ? canGoFwd(wc) : canGoBack(wc); } catch (_) {}
    const s = tab.storia;
    return inVista || !!(s && (verso === 'avanti' ? s.dopo : s.prima).length);
  }

  _vaiFuori(tab, verso, k) {
    const salto = Storia.salta(tab.storia, this._vociDellaVista(tab).voci, verso, k);
    if (!salto) return false;
    if (this._maybeBlockNavigation(tab, salto.meta.url)) return true;
    tab.storia = salto.storia;
    this._recreateView(tab, salto.meta.url, { storia: true, titolo: salto.meta.titolo });
    return true;
  }

  // Una pagina nuova nella stessa vista toglie il davanti che la scheda teneva fuori dalla vista.
  _misuraStoria(tab, wc) {
    let ora = null;
    try { ora = { wc, n: wc.navigationHistory.length(), a: wc.navigationHistory.getActiveIndex() }; } catch (_) { return; }
    const prima = tab._misuraStoria && tab._misuraStoria.wc === wc ? tab._misuraStoria : null;
    if (tab.storia && tab.storia.dopo.length && Storia.paginaNuova(prima, ora, tab._passoStoria)) tab.storia = { prima: tab.storia.prima, dopo: [] };
    tab._misuraStoria = ora;
    tab._passoStoria = false;
  }

  goForward(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab._gestoFiloAt = Date.now();
    if (!canGoFwd(tab.view.webContents)) { this._vaiFuori(tab, 'avanti', 0); return; }
    const meta = this._vocePassoStoria(tab, 1);
    if (meta && this._maybeBlockNavigation(tab, meta)) return;
    tab._passoStoria = true;
    AzioniContate.scheda(tab.view.webContents);
    if (tab.view.webContents.navigationHistory?.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    } else if (tab.view.webContents.canGoForward?.()) {
      tab.view.webContents.goForward();
    }
  }

  reload(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab._gestoFiloAt = Date.now();
    // Una scheda ancora in coda non ha niente da ricaricare: chi lo chiede la vuole adesso.
    if (tab._rinviata) {
      if (!this.codaRiapertura.subito(tab)) this._caricaRinviata(tab);
      return;
    }
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
    AzioniContate.scheda(tab.view.webContents);
    if (target) {
      this._segnaRiprova(tab, current);
      try { tab.view.webContents.loadURL(target); } catch (_) {}
      return;
    }
    tab.view.webContents.reload();
  }

  // Le WebContentsView native si compongono SEMPRE sopra l'HTML della shell e ignorano lo
  // z-index: un pannello che sborda finirebbe sotto, quindi la vista si nasconde.
  setActiveVisible(visible) {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (tab) tab.view.setVisible?.(visible);
    // Con la scheda davanti nascosta, una di dietro allargata per la sua anteprima si vedrebbe.
    this._attivaNascosta = !visible;
    if (visible) this.anteprime.riprendi(); else this.anteprime.interrompi();
    this.avvisoSito.nascondi(!visible);
    this.schermoPieno.posa();
    this.propostaEmail.posa();
    this.strato.posa();
  }

  // Solo la scheda davanti si vede; una aperta dietro resta «visibile» a 0×0 finché non ha l'anteprima (#430).
  _visibile(t) {
    return t.id === this.activeId || this.anteprime.tieneSveglia(t);
  }


  // Altezza di chrome riservata in alto: 0 a tutto schermo (salvo le schede scese dal bordo alto), solo la fila di tab
  // se in chrome compatto (barra indirizzi nascosta), altrimenti l'intera shell.
  // A questo si somma l'eventuale topInset dei dropdown.
  _altezzaCornice() {
    if (this.contentFullscreen && !(this.schedeInAlto && this.schedeInAlto.visibili)) return 0;
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
    this.riserva.posa();
    // L'ordine conta: l'avviso del sito sta sopra la scheda, gli avvisi della barra sopra di lui.
    this.avvisoSito.posa();
    this.avvisi.posa();
    this.schermoPieno.posa();
    this.propostaEmail.posa();
    this.conferme.posa();
    this.barra.posa();
    this.strato.posa();
  }

  // ─── zoom da tastiera quando il focus è sulla barra di Filo ────────────
  // Sulla scheda Ctrl +/-/0 li prende tabs/tabZoom.js; appena l'utente clicca
  // una scheda il focus passa alla barra e i tasti arrivano qui (#404). Vanno
  // alla scheda attiva dalla stessa porta, così l'opt-out dell'editor resta uno.
  _wireShellZoomKeys() {
    const shellWc = this.win && this.win.webContents;
    if (!shellWc || typeof shellWc.on !== 'function') return;
    shellWc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const dir = globalThis.SN_ZOOM ? globalThis.SN_ZOOM.tastoZoom(input) : null;
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
      if (verso) {
        event.preventDefault();
        this.navigaCronologia(verso);
        return;
      }
      const fuoriDalCampo = comandoNavigazioneFuoriDalCampo(input);
      if (fuoriDalCampo) this._navigaSeNonScrive(shellWc, fuoriDalCampo);
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


  _wireEvents(tab) {
    const wc = tab.view.webContents;
    // Tasti dello zoom e gesti dei riquadri: li tiene il main, non la pagina (#686.1).
    installZoom(wc);
    this._registraPermessoRichieste(tab);
    try { wc.once('destroyed', () => this.visite.chiusa(wc)); } catch (_) {}
    this._seguiPercorso(tab, wc);
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
        // Una raffica di zoom è un'azione contata (#1461): dal menu, dai tasti o dalla rotella, a effetto immediato.
        AzioniContate.azione('page-zoom', () => {}, { incognito: !!this.incognito });
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
      // Dentro lo schermo intero di Filo un video si prende tutto lo schermo: le schede scese tornano su.
      this.schedeInAlto.nascondi();
      this.setContentFullscreen(true);
      this._schermoPienoChiesto(tab);
      // Davanti può già esserci la scheda che la pagina ha aperto con lo stesso clic: la pillola è per chi si vede.
      this._avvisaSchermoPieno();
    });
    wc.on('leave-html-full-screen', () => {
      // Solo la scheda che l'aveva chiesto spegne la modalità: l'uscita di una pagina appena
      // rifiutata non deve portarsi via lo schermo intero acceso dall'utente.
      if (!this.pageFullscreen || this.pageFullscreenTabId !== tab.id) return;
      this.pageFullscreen = false;
      this.pageFullscreenTabId = null;
      this.setContentFullscreen(false);
    });
    collegaScorciatoie(wc, () => this.win);
    this._sbGuardiaTastiera(tab, wc);
    this._sbSeguiPuntatore(tab, wc);
    wc.on('before-input-event', (event, input) => {
      // #514 — si segna qui perché questo evento arriva PRIMA che il documento
      // veda il tasto, ed è dentro quel giro che la pagina chiede lo schermo.
      tab._ultimoInputEsc = String(input.key || '') === 'Escape' || String(input.code || '') === 'Escape';
      if (staRegistrandoTasti(wc)) return;
      if (this.strato.tasto(input)) {
        event.preventDefault();
        return;
      }
      // La barra laterale prima di tutto: il suo tasto, e l'Esc che la chiude prima della modalità.
      if (this.barra.tasto(input)) {
        event.preventDefault();
        return;
      }
      // Con l'email proposta sotto un campo, frecce, Invio ed Esc scelgono o la chiudono prima della pagina e della modalità.
      if (this.propostaEmail.tasto(wc, input)) {
        event.preventDefault();
        return;
      }
      if (input.type === 'keyDown' && input.key === 'Escape') {
        if (this.handleFullscreenEscape(tab.id)) {
          event.preventDefault();
          return;
        }
      }
      if (this.tastoDelBrowser(input, tab)) { event.preventDefault(); return; }
      // Cmd+freccia resta alla pagina: se non la usa, la rimanda il suo preload (`cmdFrecciaNonUsata`).
      if (input.type === 'keyDown') {
        const fuoriDalCampo = comandoNavigazioneFuoriDalCampo(input);
        if (fuoriDalCampo) wc._filoCmdFreccia = { verso: fuoriDalCampo, t: Date.now() };
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
    // Un invito chiesto da un riquadro della pagina (un pulsante che lo apre in un iframe nascosto) segue la regola della pagina intera (#664).
    wc.on('will-frame-navigate', (event) => fermaInvitoNelRiquadro(event, { win: this.win, wc }));
    wc.on('will-navigate', (event, url) => {
      // SICUREZZA: niente schemi non-web in cima. mailto/tel/sms non sono
      // pagine e vanno consegnati al sistema invece di fallire.
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        if (tab.isInternal === false) this._esternoDallaPagina(wc, tab.id, url, undefined, { navigazione: true });
        else fermaNavigazione(url, { win: this.win, wc });
        return;
      }
      // «Apri comunque» della pagina «Sito bloccato» che il main ha messo in questa scheda (#590).
      if (this._apriComunqueDallaPagina(tab, url, event)) this._concediApriComunque(tab, url);
      else if (this._riprovaDallaPagina(tab, wc, url, event)) this._segnaRiprova(tab, wc.getURL());
      // #170.3 — link o window.location verso un sito della lista: fermato.
      if (this._fermaSaltoDellaScheda(tab, url)) {
        event.preventDefault();
        return;
      }
      // #965 — un link da avviso non si apre prima dell'avviso, che compare qui, sulla pagina da cui parte.
      if (this._sbPrimaDelClic(tab, url, (segna) => { segna(tab); this._sbRifaiDallaPagina(tab, 'SN_RIFAI_INVIO', url, () => this.navigate(tab.id, url)); })) {
        event.preventDefault();
        return;
      }
      if (this._needsRecreate(tab, url)) {
        event.preventDefault();
        this._sbOrigineDelSalto(tab, wc, event);
        this._recreateView(tab, url, { nuova: true });
      }
      // #152 — niente preventDefault: la navigazione prosegue e l'instradamento
      // arriva dopo, così senza proxy configurato la pagina resta diretta.
      this._maybeApplyDomainRule(tab, url);
    });
    // SICUREZZA (#309) — will-navigate NON scatta sui redirect lato server: senza questa
    // guardia un sito potrebbe rimbalzare la scheda verso uno schema non-web.
    wc.on('will-redirect', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        if (tab.isInternal === false) this._esternoDallaPagina(wc, tab.id, url, undefined, { navigazione: true });
        else fermaNavigazione(url, { win: this.win, wc });
        // Una scheda nata per un collegamento che rimbalza sull'invito o sulla posta resterebbe bianca (#664 giro 2).
        if (event.isMainFrame !== false && !tab._everNavigated && !tab.isInternal) setImmediate(() => this._dropTab(tab));
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
    if (process.env.NODE_ENV !== 'production') {
      wc.on('console-message', ({ level, message, lineNumber, sourceId }) => {
        const tag = { warning: 'warn', error: 'error', info: 'log' }[level] || level || 'log';
        const src = sourceId ? ` (${sourceId}:${lineNumber})` : '';
        console.log(`[tab:${tab.id.slice(0, 6)}:${tag}] ${message}${src}`);
      });
    }
    // #327 — senza questo una navigazione fallita lascia la scheda bianca su chrome-error://:
    // si carica la pagina d'errore interna. -3 (ERR_ABORTED) si ignora, è uno stop voluto.
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[tab:${tab.id.slice(0, 6)}] did-fail-load`, code, desc, failedUrl);
      }
      // Fallito l'invio di un modulo, non un collegamento seguito dopo dalla pagina che gli ha risposto.
      if (isMainFrame && code !== -3 && (tab._invioPagina || (tab._invioRespinto && !tab._invioRespinto.caricata))) tab._invioFallito = true;
      const NE = globalThis.SN_NET_ERROR;
      if (!NE) return;
      const failed = failedUrl || tab.url || '';
      if (!NE.shouldShowErrorPage({ code, failedUrl: failed, isMainFrame })) {
        // Fermato (Esc) o diventato uno scaricamento: quel «Riprova» non ha un esito da contare.
        if (isMainFrame && tab._riprova && tab._riprova.wc === wc) tab._riprova = null;
        return;
      }
      // Per l'utente la scheda resta SUL sito fallito: la pagina d'errore è la
      // faccia del fallimento, non una destinazione.
      tab.url = failed;
      this._erroreVisto(`rete:${Math.trunc(Number(code)) || 0}`);
      this._contaNavigazione((N) => N.navFallita(code, !!tab.proxy));
      this._esitoRiprova(tab, wc, false);
      try {
        if (!wc.isDestroyed()) wc.loadURL(NE.buildUrl(failed, code, desc, { altroPaese: !!tab.proxy }));
      } catch (_) {}
    });
    // L'esito di «Riprova» lo dà solo il viaggio verso il sito ritentato: Indietro, Avanti o un'altra pagina lo annullano.
    wc.on('did-start-navigation', (details) => {
      const r = tab._riprova;
      if (!r || r.wc !== wc || !details || details.isMainFrame === false || details.isSameDocument) return;
      if (indirizzoCanonico(details.url) !== r.verso) tab._riprova = null;
    });
    wc.on('did-navigate', (_e, url) => {
      if (tab._riprova &&!(globalThis.SN_NET_ERROR && globalThis.SN_NET_ERROR.isErrorPageUrl(url))) this._esitoRiprova(tab, wc, true);
    });
    wc.on('did-finish-load', () => { if (tab._invioRespinto) tab._invioRespinto.caricata = true; });
    // #327 — renderer morto (crash/oom): stessa scheda bianca, stessa cura.
    // loadURL su un webContents col renderer morto ne rilancia uno nuovo.
    wc.on('render-process-gone', (_e, details) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[tab:${tab.id.slice(0, 6)}] render-process-gone`, details);
      }
      // Il pannello Aiuto è morto con la pagina (#1432).
      if (tab.view && tab.view.webContents === wc) {
        tab.aiuto = null;
        RisposteInAttesa.dimentica(tab);
        try { this.barra.aggiornaNav(); } catch (_) {}
      }
      const NE = globalThis.SN_NET_ERROR;
      const reason = (details && details.reason) || '';
      // clean-exit è una chiusura nostra, non un crash.
      if (!NE || reason === 'clean-exit') return;
      const current = tab.url || '';
      if (!NE.isRetriableTarget(current) || NE.isErrorPageUrl(current)) return;
      // Se muore di nuovo mentre stiamo recuperando, non si insiste a raffica; lo sanno i contatori anonimi (#1466).
      const now = Date.now();
      if (tab._crashRecoveryAt && now - tab._crashRecoveryAt < 2000) {
        try { globalThis.SN_CONTATORI_MAIN?.processoMorto('scheda_in_recupero', reason, { incognito: !!this.incognito }); } catch (_) {}
        return;
      }
      tab._crashRecoveryAt = now;
      // Si RICREA la vista: un loadURL sul processo appena morto fa crashare anche il renderer
      // nuovo quando c'è un preload, e si entra in un giro senza fine.
      setTimeout(() => {
        try {
          if (!this.tabs.some((t) => t.id === tab.id)) return; // scheda chiusa nel frattempo
          this._recreateView(tab, current, { loadUrl: NE.buildUrl(current, NE.CRASH_CODE, reason) });
        } catch (_) {}
      }, 300);
    });
    // Gli stili si rimettono a OGNI dom-ready: non sopravvivono a una navigazione di documento.
    // Si guarda l'URL CORRENTE, non `tab.isInternal`, che è fissato alla creazione.
    wc.on('dom-ready', () => {
      // #514 — qui NON si annuncia lo schermo intero: arriverebbe prima che il content script
      // abbia un orecchio. È la pagina a chiederlo appena è pronta.
      let current = '';
      try { current = wc.getURL() || ''; } catch (_) {}
      if (current.startsWith('filo://')) return; // pagine interne: CSS via <link>
      // cssOrigin 'user' più !important è l'unica combinazione che batte le
      // regole d'autore della pagina.
      try { wc.insertCSS(PAGE_SELECTION_CSS, { cssOrigin: 'user' }); } catch (_) {}
      try { wc.insertCSS(getContentScriptCss()); } catch (_) {}
      // GPC: gemella dell'header Sec-GPC, via executeJavaScript perché uno <script> iniettato lo
      // bloccherebbe la CSP. Segnale per il futuro: oggi il lavoro lo fa il rifiuto del banner.
      if (this.cookieMode !== Cookies.MODES.MANUAL && !Cookies.senzaGpc(current)) {
        try {
          wc.executeJavaScript(
            'try{Object.defineProperty(navigator,"globalPrivacyControl",{get:function(){return true;},configurable:true});}catch(e){}',
            false,
          ).catch(() => {});
        } catch (_) {}
      }
    });

    // I riquadri si guardano da quando nascono: uno che non finisce mai di caricarsi mostra già il modulo (#813.1).
    wc.on('did-start-navigation', (details) => this._sbInizioNavigazione(tab, wc, details));
    wc.on('did-frame-navigate', (_e, _url, _code, _text, isMainFrame) => this._sbOnFrameLoad(tab, isMainFrame));
    wc.on('did-frame-finish-load', (_e, isMainFrame) => this._sbOnFrameLoad(tab, isMainFrame));

    // §3.1 — ripristino scroll alla riapertura da archivio: a caricamento finito
    // riportiamo la pagina alla percentuale registrata, una sola volta. Best-effort
    // (la pagina potrebbe avere altezza diversa o caricare contenuti lazy).
    wc.on('did-finish-load', () => {
      if (typeof tab.restoreZoomLevel === 'number') {
        const z = tab.restoreZoomLevel;
        tab.restoreZoomLevel = null;
        try { wc.setZoomLevel(z); } catch (_) {}
      }
      if (typeof tab.restoreScrollPct !== 'number') return;
      const pct = Math.max(0, Math.min(100, tab.restoreScrollPct));
      tab.restoreScrollPct = null; // applica una volta sola
      const js = `(()=>{try{const d=document.documentElement;const max=(d.scrollHeight||0)-window.innerHeight;if(max>0)window.scrollTo(0,max*${pct}/100);}catch(e){}})()`;
      const run = () => { try { wc.executeJavaScript(js, false).catch(() => {}); } catch (_) {} };
      run();
      setTimeout(run, 500); // riprova dopo l'eventuale layout/lazy-load
    });
    // Blocco geografico per regola, sul testo visibile. Il secondo campione ritardato serve ai
    // messaggi che i lettori video disegnano dopo il load.
    wc.on('did-finish-load', () => {
      this._geoTextCheck(tab);
      setTimeout(() => this._geoTextCheck(tab), 2000);
      this._accessoDopoCarico(tab);
    });

    // #327 — l'URL che l'utente vede: con la pagina d'errore davanti, la scheda
    // è ancora "sul" sito fallito per titolo, sessione salvata e ricarica.
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
        canBack: this.puoTornare(tab, 'indietro', wc),
        canFwd: this.puoTornare(tab, 'avanti', wc),
      });
      if (tab.view && tab.view.webContents === wc) {
        this.anteprime.caricata(tab);
        this.codaRiapertura.caricata(tab);
        if (tab._sessioneVista) { const vista = tab._sessioneVista; tab._sessioneVista = null; vista(); }
      }
      this.visite.caricata(wc);
      // §3.2 — cattura un estratto del contenuto (best-effort) da usare per la
      // ricerca semantica dell'archivio e per il triage. Solo pagine web.
      if (!tab.isInternal && /^https?:\/\//i.test(wc.getURL() || '')) {
        try {
          const letta = wc.getURL();
          wc.executeJavaScript(
            '(function(){try{return (document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,2000);}catch(e){return "";}})()',
            false,
          ).then((txt) => {
            if (typeof txt === 'string' && txt && !wc.isDestroyed() && wc.getURL() === letta) tab.contentExtract = txt;
          }).catch(() => {});
        } catch (_) {}
      }
    });
    wc.on('page-title-updated', (_e, title) => {
      update({ title: title || tab.title });
      this.visite.titolo(wc, title);
    });
    wc.on('page-favicon-updated', (_e, favicons) => this._aggiornaIcona(tab, wc, favicons));
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      const urlPrima = tab.url;
      // #412 — questa scheda ha committato una vera navigazione main-frame:
      // NON è più il "contenitore vuoto" di un download (una scheda aperta da un
      // link Scarica target=_blank che diventa subito scaricamento non committa
      // MAI, quindi resta a about:blank). Il flag protegge dal chiuderla per
      // sbaglio se poi parte un download da una pagina che ha già contenuto.
      tab._everNavigated = true;
      if (this.pageFullscreen && tab.id !== this.pageFullscreenTabId && tab.view && tab.view.webContents === wc) this._schermoPienoNavigata(tab);
      // Documento nuovo: il pannello Aiuto e le risposte da leggere erano di quello vecchio (#1432).
      if (tab.view && tab.view.webContents === wc) { tab.aiuto = null; RisposteInAttesa.dimentica(tab); }
      segnaPagina(tab, url);
      // L'icona in volo era del documento di prima; quella mostrata vale ancora solo sullo stesso sito.
      tab._giroIcona = (tab._giroIcona || 0) + 1;
      if (origineDi(url) !== tab._origineIcona) tab.favicon = '';
      // Testo e titolo letti sono della pagina di prima: sotto l'indirizzo nuovo partirebbero col suo nome (#1004).
      // Una pagina senza titolo non lo cambia mai: vale quello del documento nuovo, cioè l'indirizzo, come negli altri browser.
      tab.contentExtract = '';
      if (/^https?:\/\//i.test(url || '')) {
        let nuovo = '';
        try { nuovo = wc.getTitle() || ''; } catch (_) {}
        tab.title = nuovo || userUrl(url);
      }
      // Prima della misura: la storia che conta è quella senza la voce gemella.
      this._sostituisciVoceGemella(wc, url);
      if (tab.view && tab.view.webContents === wc) { this.anteprime.navigata(tab); this._misuraStoria(tab, wc); }
      if (tab._vistaNuova && tab._vistaNuova.wc === wc) tab._vistaNuova = null;
      // #590 — una navigazione già partita quando il suo sito è entrato in lista arriva lo stesso: si ferma qui.
      const bloccata = /^https?:\/\//i.test(url) && this._decisioneBlocco(tab, url);
      if (bloccata) {
        this._esitoApertura(tab, bloccata);
        this._mostraPaginaBloccata(tab, url, bloccata);
        return;
      }
      this._assestaEsito(tab);
      this.visite.navigata(wc, tab.id, url, { gesto: gestoPerIlFilo(tab), chiave: tab });
      // Documento nuovo: lo zoom che la pagina vecchia dichiarava di sé non
      // vale più (#686).
      tab.zoomProprio = null;
      // Documento nuovo: chi rispondeva era quello vecchio. Il nuovo si
      // ripresenterà da solo appena montato (MSG.FULLSCREEN_STATE); fino ad
      // allora vale l'attesa corta, quella di chi non risponde.
      tab._rispondeAllEsc = false;
      // I riquadri del documento vecchio se ne sono andati con lui: una
      // risposta in attesa non arriverà mai, l'uscita parte adesso.
      if (this._escUscitaTimer) {
        this.annullaUscitaSchermoIntero();
        if (this.contentFullscreen) this.setContentFullscreen(false);
      }
      // #441 — una pagina-ponte avvia il file entro pochi secondi da qui: oltre
      // quella finestra la scheda non è più un ponte.
      tab._navigatedAt = Date.now();
      // Il colore campionato (§1.1) muore con la pagina; quello identità (§1.2)
      // dipende dal DOMINIO, quindi su un host già visto si riapplica subito.
      const cachedIdentity = this._identityColorCache.get(hostOf(url)) || null;
      tab._moduli = null;
      this._dopoInvio(tab, url, httpResponseCode);
      tab._improntePrima = [...(tab._impronte ? tab._impronte.values() : [])].flat().slice(-50);
      tab._impronte = null;
      update({
        url: userUrl(url),
        color: null,
        identityColor: cachedIdentity,
        // Il testo scritto nel documento vecchio è stato inviato o è già perso:
        // senza, una ricerca fatta una volta proteggerebbe la scheda per sempre (#824).
        formDirty: false,
        canBack: this.puoTornare(tab, 'indietro', wc),
        canFwd: this.puoTornare(tab, 'avanti', wc),
      });
      // Si ricontrolla l'URL FINALE, dopo i redirect: quello di partenza può
      // essere innocuo. Non blocca mai la navigazione.
      this._sbOnNavigate(tab, url);
      this._cookieOnNavigate(tab, url);
      this._accessoDaNavigazione(tab, urlPrima, url);
      // Geo-block livello 1 (deterministico): nuova navigazione → il segnale
      // precedente decade; HTTP 451 è conclusivo, altrimenti vale l'eventuale
      // redirect "di blocco" memorizzato durante questa navigazione.
      const redirectHit = tab._geoRedirectHit || null;
      tab._geoRedirectHit = null;
      tab.geoBlock = null;
      // Serve al livello 2 per la coda ambigua (403, pagina vuota). 0 = ignoto.
      tab._lastStatus = Number(httpResponseCode) || 0;
      if (!/^filo:\/\//i.test(url || '')) {
        if (GeoBlock.matchStatus(httpResponseCode)) {
          this._geoBlockDetected(tab, url, GeoBlock.SOURCES.HTTP_451, 'http_451');
        } else if (redirectHit) {
          this._geoBlockDetected(tab, url, GeoBlock.SOURCES.REDIRECT, redirectHit.detail);
        }
      }
    });
    // Un riquadro che cambia documento si porta via il testo che c'era (#824).
    wc.on('did-frame-navigate', (_e, _url, _code, _text, isMainFrame, pid, rid) => {
      if (isMainFrame) return;
      const k = `${pid}:${rid}`;
      const imp = tab._impronte && tab._impronte.get(k);
      if (imp) { tab._improntePrima = [...(tab._improntePrima || []), ...imp].slice(-50); tab._impronte.delete(k); }
      if (!tab._moduli || !tab._moduli.delete(k)) return;
      if (!tab._moduli.size && tab.formDirty) update({ formDirty: false });
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame === true && tab.view && tab.view.webContents === wc) this._misuraStoria(tab, wc);
      update({ url: userUrl(url), canBack: this.puoTornare(tab, 'indietro', wc), canFwd: this.puoTornare(tab, 'avanti', wc) });
      if (isMainFrame === true && tab.view && tab.view.webContents === wc) this.anteprime.navigata(tab, { inPagina: true });
      if (isMainFrame === true) this.visite.navigata(wc, tab.id, url, { inPagina: true, gesto: gestoPerIlFilo(tab), chiave: tab });
      if (isMainFrame === true) this._accessoDopoCarico(tab);
      if (isMainFrame === true) segnaPagina(tab, url);
    });
    // #441 — l'utente ha toccato DAVVERO questa scheda? Serve a non chiudere
    // come "pagina-ponte" una scheda con cui ha interagito. Il segnale arriva
    // dal main (non dal content script, che manda un campione di attività anche
    // senza input e non è iniettato ovunque). Il semplice passaggio del mouse
    // NON conta: muovere il cursore sopra una scheda non è usarla.
    // Il bordo in alto a schermo intero sopra un riquadro di un altro sito: `input-event` vede solo il principale.
    wc.on('before-mouse-event', (_e, input) => this.schedeInAlto.dalRiquadro(wc, input));
    wc.on('input-event', (_e, input) => {
      const type = (input && input.type) || '';
      this.barra.inputDa(wc, input);
      this.schedeInAlto.dallaPagina(wc, input);
      if (this.pageFullscreen && tab.id === this.activeId && this.schermoPieno.sulBordoAlto(input)) this._ricompariSchermoPieno(tab);
      if (!type || HOVER_INPUT_TYPES.has(type)) return;
      tab._userInputAt = Date.now();
      // #514 — qui passa l'input VERO, che la pagina non può fabbricare: è il
      // posto dove il conto delle rivendicazioni dell'Esc riparte da zero.
      const esc = String(input.key || '') === 'Escape' || String(input.code || '') === 'Escape';
      // Un clic è un gesto con cui una pagina può legittimamente prendersi lo
      // schermo; l'Esc no.
      tab._ultimoInputEsc = esc;
      if (!esc) this.azzeraRivendicazioniEsc();
    });
    // Redirect verso un URL «di blocco»: si memorizza e diventa segnale al did-navigate. Firma
    // difensiva: le versioni vecchie di Electron passano i dettagli come argomenti posizionali.
    wc.on('did-redirect-navigation', (e, url, _inPlace, isMainFrame) => {
      const target = typeof url === 'string' ? url : (e && e.url) || '';
      const main = typeof isMainFrame === 'boolean' ? isMainFrame : !(e && e.isMainFrame === false);
      if (!main || !target || tab._geoRedirectHit) return;
      const hit = GeoBlock.matchRedirectUrl(target);
      if (hit) tab._geoRedirectHit = { url: target, detail: hit };
    });

    // §2.1 — una scheda che suona NON si archivia mai. La forma dell'evento cambia da una
    // versione di Electron all'altra: audibleFromEvent le normalizza tutte.
    wc.on('audio-state-changed', (e, arg) => {
      const audible = audibleFromEvent(e, arg);
      if (tab.audible !== audible) { tab.audible = audible; this._broadcast(); }
    });

    // #151 — un video via proxy brucia GB in fretta: dopo un po' una nota discreta, una volta
    // per sessione. Soglia e regola in geoBlockRules.shouldNoteVideoData; qui solo l'accumulo.
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

    // Si registra lo stato per il verdetto, ma il comportamento resta quello
    // sicuro: callback(false) rifiuta la connessione.
    wc.on('certificate-error', (event, url, error, _cert, callback) => {
      // Un certificato rotto che il verdetto non riceve lascia passare il sito senza dirlo: i contatori lo vedono (#1474).
      let esito = 'fallito';
      try {
        const SB = globalThis.SN_SAFEBROWSE;
        const norm = SB && SB.normalize(url);
        if (norm && norm.host) { SB.recordCert(norm.host, mapCertError(error)); esito = 'ok'; }
      } catch (_) {}
      ContatoriSicurezza.misura('controllo', 'cert', esito, null, { incognito: !!this.incognito });
      try { callback(false); } catch (_) {}
    });

    MenuDiRiserva.segui(wc);
    // Spellcheck nativo: Electron è l'unico a conoscere i suggerimenti
    // ortografici della parola sotto lo zigzag rosso. Li spingiamo al
    // content script perché li mostri nel menu di correzione custom.
    wc.on('context-menu', (_e, params) => {
      if (this.strato.acceso) this.strato.segnaClic(wc, params);
      if (params.misspelledWord) {
        // #405 — il menu lo costruisce il content script DEL FRAME cliccato, e `wc.send` raggiunge
        // solo il principale: nei campi dentro un riquadro i suggerimenti cadrebbero nel vuoto.
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

    // Apertura nuove tab: tutto resta dentro Filo come nuovo tab. Col blocco dei popup attivo passa solo ciò che segue
    // un gesto vero dell'utente, uno per gesto e di chi l'ha ricevuto (#737.1), qualunque forma chieda la pagina.
    wc.setWindowOpenHandler((details) => {
      const { url, disposition, referrer } = details;
      // Da una pagina di Filo l'indirizzo l'ha scelto quasi sempre un modello: passa dalla porta delle uscite (#810).
      if (tab.isInternal && typeof globalThis.SN_USCITA_DA_FILO === 'function') {
        const gesto = Permessi.gestoRecente(wc);
        globalThis.SN_USCITA_DA_FILO(url, wc, () => {
          this.apriDaCollegamento(url, { sfondo: disposition === 'background-tab', daScheda: this.tabs.includes(tab) ? tab : null, gesto });
        }).catch(() => {});
        return { action: 'deny' };
      }
      // SICUREZZA: nega l'apertura (window.open / target=_blank) verso schemi
      // non-web — stessa difesa di will-navigate (file:// → leak NTLM, ecc.).
      // mailto:/tel:/sms: vengono consegnati all'OS invece di essere ignorati.
      if (isWebUnsafeNav(url)) {
        if (tab.isInternal === false) this._esternoDallaPagina(wc, tab.id, url, referrer);
        else fermaNavigazione(url, { win: this.win, wc });
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
      // Si legge prima che la finestra la spenda (perUnaFinestra).
      const scelta = tab.isInternal === false && Permessi.sceltaDallUtente(wc, url);
      const azioneMisurata = Permessi.azioneDellApertura(wc, url);
      // Anche la finestra di un accesso vero nasce da un clic su «Accedi con…»: l'indirizzo lo sceglie la pagina.
      const riaperta = accesso && this._riaperturaDiAccesso(tab, url);
      // Una finestra senza barra dell'indirizzo la apre solo il clic, anche a blocco spento: da sola la pagina
      // fingerebbe l'accesso di un altro sito (#1066), e la sua richiesta segue la strada delle altre.
      const gesto = riaperta || (tab.isInternal === false && (this.security.blockPopups || accesso)
        && Permessi.perUnaFinestra(wc, url, referrer));
      if (tab.isInternal === false && this.security.blockPopups && !gesto) {
        // «Apri» sull'avviso la fa ripartire dalla pagina, perché l'accesso possa tornarle l'esito.
        if (accesso) tab._accessoBloccato = { url, nome: details.frameName || '', misure: details.features || '', pagina: wc.getURL() };
        this._notifyPopupBlocked(tab.id, url, wc);
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
      const daGesto = Permessi.gestoRecente(wc);
      const opzioni = {
        activate: disposition !== 'background-tab',
        openedByLink: true,
        apriComunque: this._siteAllowedIn(tab, url),
        permessoRichieste: this._siteAllowedIn(tab, url) && !!tab._permessoRichieste,
        daGesto,
        azioneMisurata,
        origine: tab.isInternal ? { tipo: 'filo' } : { tipo: 'link', da: tab._urlNavigato || wc.getURL(), gesto: daGesto || scelta, daScheda: tab.id },
      };
      // Un blob: aperto dalla pagina si giudica come lei (src/main/tabs/tabSafebrowse.js).
      const daLei = (aperta) => {
        const nuova = this.tabs.find((t) => t.id === aperta);
        if (nuova) nuova._sbApertaDa = tab._urlNavigato;
      };
      // #965 — un link da avviso non si apre prima dell'avviso, sulla pagina da cui parte; confermato, in una scheda.
      if (this._sbPrimaDelClic(tab, url, (segna) => {
        const id = this.openTab(url, { ...opzioni, invio: details.postBody || null });
        daLei(id);
        segna(this.tabs.find((t) => t.id === id));
      })) return { action: 'deny' };
      if (accesso && gesto) {
        if (this._maybeBlockNavigation(tab, url)) return { action: 'deny' };
        // Una pagina sotto l'avviso del sito pericoloso non apre finestre, che starebbero fuori dall'avviso: la
        // finestrella diventa una scheda, dove l'avviso c'è.
        if (!tab.sbAvviso) return this._allowAuthPopup(url, details.features);
      }
      // La finestra resta in mano alla pagina che l'ha chiesta (la riempie, la porta altrove, la chiude), come in un
      // browser; si può solo se la scheda nuova starebbe nella sua stessa partizione, altrove nasce staccata.
      if (this._finestraDellaPagina(tab, url, opzioni.apriComunque)) {
        const partition = tab.partition || null;
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences: this._preferenzeWeb('about:blank', partition) },
          createWindow: (options) => {
            // Un collegamento (Maiuscolo+clic, target=_blank) non dà una finestra da tenere: la scheda carica da sé.
            if (!options.webContents) { daLei(this.openTab(url, opzioni)); return undefined; }
            daLei(this.openTab(url || 'about:blank', { ...opzioni, adotta: { webContents: options.webContents, partition, sito: tab.partitionSite } }));
            return options.webContents;
          },
        };
      }
      daLei(this.openTab(url, opzioni));
      return { action: 'deny' };
    });

    // #209 — la finestra nata da 'allow' NON passa da _wireEvents: senza questo
    // aggancio resterebbe senza le difese che ha ogni scheda.
    wc.on('did-create-window', (child) => {
      this._hardenAuthPopup(child, tab);
    });
  }

  // Come in un browser una pagina chiude la sua scheda se l'ha aperta una pagina, o se è ancora alla prima pagina.
  chiusaDallaPagina(wc) {
    const tab = this.tabs.find((t) => t.view.webContents === wc);
    if (!tab || tab.isInternal !== false) return;
    let storia = 1;
    try { storia = wc.navigationHistory.length(); } catch (_) {}
    if (tab._openedByLink || storia <= 1) this.closeTab(tab.id, { daSola: true });
  }

  // Una scheda proxata ha la partizione sua, e in privacy ogni sito la sua: lì la finestra non può restare alla pagina.
  _finestraDellaPagina(tab, url, apriComunque) {
    if (!tab || tab.isInternal !== false || tab.proxy) return false;
    const u = String(url || '');
    if (u && u !== 'about:blank') {
      if (!/^https?:/i.test(u)) return false;
      if ((this._partitionFor(u) || null) !== (tab.partition || null)) return false;
    }
    return Boolean(apriComunque || !this._decisioneBlocco(null, u || 'about:blank'));
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
  _allowAuthPopup(url, features = '') {
    // #758 — l'accesso fatto nella finestrella conta come quello fatto in una scheda: i contenuti del provider
    // incorporati altrove devono tenere i cookie.
    try { require('./services/cookieIncorporati').paginaDiAccesso(url); } catch (_) {}
    const popupPartition = this._partitionFor(url);
    // Una partizione mai vista da una scheda non ha gestore, ed Electron concederebbe tutto al popup.
    if (popupPartition) installaPermessi(session.fromPartition(popupPartition));
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...senzaOpzioniDellaPagina(features),
        title: titoloFinestrella(url),
        frame: true,
        titleBarStyle: 'default',
        webPreferences: {
          preload: percorsoDelPreload(),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          // #405 — anche nel popup i riquadri devono avere il tasto destro.
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
    // Nata da una finestra in incognito, è incognito anche lei: il suo IPC resta in memoria e i contatori non la vedono.
    if (this.incognito) win._filoIncognito = true;
    const pwc = win.webContents;
    // Senza barra dell'indirizzo il titolo è l'unico posto dove si legge il sito: lo scrive Filo, mai la pagina (#1066).
    const mostraSito = () => {
      if (win.isDestroyed() || pwc.isDestroyed()) return;
      let o = '';
      try { o = pwc.mainFrame.origin; } catch (_) {}
      try { win.setTitle(titoloFinestrella(pwc.getURL(), o)); } catch (_) {}
    };
    win.on('page-title-updated', (e) => e.preventDefault());
    pwc._filoFinestrella = true;
    // Come per le schede: fuori produzione i log della finestrella arrivano al main.
    if (process.env.NODE_ENV !== 'production') {
      pwc.on('console-message', ({ level, message }) => { console.log(`[popup:${level || 'log'}] ${message}`); });
    }
    const rientra = (b) => {
      if (!win.isDestroyed()) try { win.setBounds(dentroLoSchermo(b)); } catch (_) {}
    };
    rientra(win.getBounds());
    // window.moveTo/resizeTo della pagina: lo spostamento dell'utente, col mouse, resta libero.
    pwc.on('content-bounds-updated', (e, b) => { e.preventDefault(); rientra(b); });
    pwc.on('did-navigate', mostraSito);
    pwc.on('did-navigate-in-page', mostraSito);
    installZoom(pwc);
    registraFinestraDelSito(win, this.win);
    installaPermessi(pwc.session);
    Permessi.seguiGesti(pwc);
    MenuDiRiserva.segui(pwc);
    this._stratoNellaFinestrella(win, pwc);
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
    if (origine) win.once('closed', () => this._accessoDopoFinestrella(origine));
    // Una finestrella fermata prima di mostrare qualcosa resterebbe vuota a schermo.
    const ferma = (event) => {
      event.preventDefault();
      if (!mostrata) setImmediate(() => { try { win.close(); } catch (_) {} });
    };
    pwc.on('will-frame-navigate', (event) => fermaInvitoNelRiquadro(event, { win: this.win, wc: pwc }));
    pwc.on('will-navigate', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        this._esternoDallaPagina(pwc, origine ? origine.id : null, url, undefined, { navigazione: true });
        return;
      }
      if (this._maybeBlockNavigation(origine, url)) ferma(event);
    });
    // SICUREZZA (#309) — come per le schede: will-navigate non copre i redirect
    // lato server, e un fornitore d'identità ostile potrebbe rimbalzare qui.
    pwc.on('will-redirect', (event, url) => {
      if (isWebUnsafeNav(url)) {
        event.preventDefault();
        this._esternoDallaPagina(pwc, origine ? origine.id : null, url, undefined, { navigazione: true });
        return;
      }
      if (event.isMainFrame === false) return;
      if (this._maybeBlockNavigation(origine, url)) ferma(event);
    });
    pwc.setWindowOpenHandler(({ url, referrer, features }) => {
      if (isWebUnsafeNav(url)) {
        this._esternoDallaPagina(pwc, origine ? origine.id : null, url, referrer);
        return { action: 'deny' };
      }
      const accesso = isAuthPopup(url);
      const gesto = (this.security.blockPopups || accesso) && Permessi.perUnaFinestra(pwc, url, referrer);
      if (this.security.blockPopups && !gesto) {
        this._notifyPopupBlocked(origine ? origine.id : null, url, pwc);
        return { action: 'deny' };
      }
      if (accesso && gesto) {
        if (this._maybeBlockNavigation(origine, url)) return { action: 'deny' };
        return this._allowAuthPopup(url, features);
      }
      this.openTab(url, {
        activate: true,
        apriComunque: this._siteAllowedIn(origine, url),
        permessoRichieste: this._siteAllowedIn(origine, url) && !!(origine && origine._permessoRichieste),
        origine: { tipo: 'link', da: pwc.getURL(), gesto: Permessi.gestoRecente(pwc) },
      });
      return { action: 'deny' };
    });
    pwc.on('did-create-window', (child) => this._hardenAuthPopup(child, origine));
    this._sbGuardaFinestrella(win, origine);
  }

  // La finestrella è una pagina del sito come una scheda: il suo menu del tasto destro sta nel suo strato (#1054), mai
  // nel documento, che è proprio quello dove si incollano le password.
  _stratoNellaFinestrella(win, pwc) {
    const strato = new StratoDelMenu(win, {
      schedaAttiva: () => (pwc.isDestroyed() ? null : pwc),
      area: () => {
        if (win.isDestroyed()) return null;
        const [width, height] = win.getContentSize();
        return { x: 0, y: 0, width, height };
      },
      scheda: (wc) => (wc === pwc && !pwc.isDestroyed() ? { id: `finestrella-${pwc.id}`, url: pwc.getURL() } : null),
    });
    if (!strato.acceso) return;
    win._filoStrato = strato;
    pwc.on('context-menu', (_e, params) => strato.segnaClic(pwc, params));
    win.on('resize', () => strato.posa());
  }

  // Notifica la shell che un popup è stato bloccato sul tab `tabId`. La shell
  // mostra l'avviso "Bloccato popup da <host>" con «Apri» per aprirlo.
  // `pagina`: l'avviso chiuso dall'utente tace finché la scheda resta su quella pagina.
  _notifyPopupBlocked(tabId, url, wc = null) {
    try {
      let pagina = '';
      try { pagina = wc ? String(wc.getURL() || '').split('#')[0] : ''; } catch (_) {}
      // Posta, telefono e SMS non hanno un sito: l'avviso nomina la pagina che ci ha provato e l'app, non l'indirizzo.
      const app = isOsDelegatedScheme(url) ? new URL(url).protocol.toLowerCase().slice(0, -1) : '';
      const host = (app ? globalThis.SN_NOMI_SITO.sitoDi(pagina) : globalThis.SN_NOMI_SITO.sitoDi(url)) || (app ? '' : url);
      this.win.webContents.send('tabs:popup-blocked', { tabId, url, host, pagina, app });
    } catch (_) {}
  }

  // Posta, telefono e SMS chiesti da una pagina: col blocco dei popup acceso partono solo da un gesto, come le finestre.
  // `navigazione`: la navigazione è già partita, e il gesto che la porta Permessi l'ha messo da parte.
  _esternoDallaPagina(wc, tabId, url, referrer, { navigazione = false } = {}) {
    const invito = Boolean(globalThis.SN_WALLET?.isInviteDeepLink?.(url));
    if (!invito && !isOsDelegatedScheme(url)) {
      // Il clic dell'utente su un indirizzo fermato (zoommtg:, ms-teams:…) lo dice (#482); la pagina da sola resta muta.
      const dalClic = Permessi.perUnaFinestra(wc, url, referrer)
        || (navigazione && (Permessi.gestoPerLaNavigazione(wc) || Permessi.navigazioneDaGesto(wc)));
      if (dalClic) avvisaIndirizzoFermato(url, this.win);
      return;
    }
    // Per l'invito il clic che ha fatto partire la navigazione lo conta `invitoFermato`, che lo spegne all'arrivo (#664).
    const gesto = Permessi.perUnaFinestra(wc, url, referrer) || (!invito && navigazione && Permessi.gestoPerLaNavigazione(wc));
    // L'invito scelto dall'utente (anche dal menu di Filo, che alla pagina non dà il gesto) lo porta dentro Filo.
    if (invito) { invitoFermato(url, { win: this.win, wc: gesto ? null : wc }); return; }
    if (this.security.blockPopups && !gesto) {
      this._notifyPopupBlocked(tabId, url, wc);
      return;
    }
    openExternalScheme(url);
  }

  // Il collegamento file: che Chromium ha rifiutato a una pagina (page-preload.js): vale solo dopo un input vero, che
  // la pagina non può fingere.
  indirizzoRifiutatoDallaPagina(wc, url) {
    if (!/^file:/i.test(String(url || '')) || !Permessi.gestoRecente(wc)) return;
    avvisaIndirizzoFermato(url, this.win);
  }

  // Il lasciapassare che «Apri» dà alla finestra di accesso che la pagina richiede su suo ordine: una volta, subito.
  _riaperturaDiAccesso(tab, url) {
    const r = tab && tab._riaperturaAccesso;
    if (!r || r.url !== url || Date.now() > r.fino) return false;
    tab._riaperturaAccesso = null;
    return true;
  }

  // Chiamato da IPC quando l'utente clicca "Apri" sull'avviso — il popup era
  // legittimo (es. share dialog, OAuth) e va aperto bypassando il blocco dei
  // popup, NON la lista dei siti bloccati: quella la scavalca solo `apriComunque`,
  // l'«Apri comunque» della notifica di sito bloccato.
  // `daScheda`: la scheda che aveva chiesto il popup, il cui «Apri comunque» vale anche per lui.
  openBlockedPopup(url, { apriComunque = false, daScheda = null } = {}) {
    const origine = daScheda ? this.tabs.find((t) => t.id === daScheda) : null;
    if (openExternalScheme(url)) return;
    if (this._riapriAccessoDallaPagina(origine, url)) return;
    const eredita = this._siteAllowedIn(origine, url);
    if (apriComunque) this._contaApriComunque(url);
    // Per il giudizio sui siti il popup resta chiesto dalla pagina: il clic su «Apri» è sulla notifica, non sul sito.
    // Senza una scheda di partenza è l'«Apri comunque» della chat.
    const da = (!origine || origine.isInternal) ? { tipo: 'filo' }
      : { tipo: 'link', da: origine._urlNavigato || origine.view.webContents.getURL(), gesto: false };
    this.openTab(url, {
      activate: true,
      apriComunque: !!apriComunque || eredita,
      permessoRichieste: !!apriComunque || (eredita && !!origine._permessoRichieste),
      origine: da,
    });
  }

  // Una finestra di accesso aperta da Filo sarebbe staccata dal sito e l'esito non gli tornerebbe: la riapre la pagina
  // stessa, dal mondo isolato (che la pagina non può alterare), finché è ancora quella che l'aveva chiesta.
  _riapriAccessoDallaPagina(tab, url) {
    const a = tab && tab._accessoBloccato;
    if (!a || a.url !== url || tab.isInternal !== false || !isAuthPopup(url)) return false;
    let wc = null;
    try { wc = tab.view.webContents; } catch (_) {}
    if (!wc || wc.isDestroyed() || wc.getURL() !== a.pagina) return false;
    tab._accessoBloccato = null;
    tab._riaperturaAccesso = { url, fino: Date.now() + RIAPERTURA_ACCESSO_MS };
    const codice = `void window.open(${JSON.stringify(url)}, ${JSON.stringify(a.nome)}, ${JSON.stringify(a.misure)})`;
    try { wc.executeJavaScriptInIsolatedWorld(MONDO_RIAPERTURA, [{ code: codice }], false).catch(() => {}); } catch (_) { return false; }
    return true;
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
  handleDownloadStarted(wc, info = null) {
    if (!wc) return;
    const tab = this.tabs.find((t) => {
      try { return t.view && t.view.webContents === wc; } catch (_) { return false; }
    });
    if (!tab) return;
    if (info) this._sbOnDownload(tab, info);
    // Una scheda che è diventata un file e porta l'avviso del sito resta: l'avviso sta su di lei (#814).
    if (tab.sbAvviso && !tab._everNavigated) { tab._sbSoloAvviso = true; return; }
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
    this._avvisaSorvegliante(tab, 'chiusa');
    this._nelFilo('schedaChiusa', tab, { come: 'servizio' });
    this._esitoApertura(tab, null);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    ChiusuraConCaselle.chiudi(tab.view.webContents);
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
    this.tabs.splice(idx, 1);
    if (this.activeId === tab.id) {
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
        opts: { tipo: 'scheda_ponte_chiusa', actions: [{ label: 'Riapri', openUrl: url }] },
      });
    } catch (_) {}
  }

  // Un collegamento che Filo apre per conto di una pagina, dopo la porta delle uscite (#810): la posta al sistema, i
  // siti in blacklist fermati come un clic, il resto in una scheda nuova. `gesto`: l'ha chiesto un clic dell'utente,
  // che vale per la pagina d'arrivo come un clic su un sito (lo scaricamento della pagina di ringraziamento è voluto).
  // `fromUrl`: la pagina web che ha messo il collegamento davanti; per il giudizio sui siti arriva da lei, non da Filo.
  // `daScheda`: la pagina dove l'utente ha scelto il link (menu di riserva, una pagina di Filo, l'assistente sopra una
  // pagina), dove compare l'avviso che lo precede (#965).
  apriDaCollegamento(url, { sfondo = false, daScheda = null, gesto = false, fromUrl = '' } = {}) {
    if (isWebUnsafeNav(url)) return fermaNavigazione(url, { win: this.win });
    if (this._maybeBlockNavigation(null, url)) return false;
    const origine = /^https?:/i.test(String(fromUrl || '')) ? { tipo: 'link', da: String(fromUrl), gesto: !!gesto } : { tipo: 'filo', gesto: !!gesto };
    const apri = (segna) => {
      const id = this.openTab(url, { activate: !sfondo, openedByLink: true, origine });
      if (segna) segna(this.tabs.find((t) => t.id === id));
    };
    if (daScheda && this._sbPrimaDelClic(daScheda, url, apri, { daFilo: true })) return true;
    apri();
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
    if (decision) { this._notifyBlocked(decision); this._contaBloccato(decision); }
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
    this._erroreVisto('rete:bloccato');
    this._contaBloccato(decision);
    try { tab.view.webContents.loadURL(NE.buildUrl(url, NE.BLOCKED_CODE, decision.reason)); } catch (_) {}
  }

  // La pagina d'errore che la persona vede è un errore visto (#1461): il codice di Chromium, un numero, mai l'indirizzo.
  _erroreVisto(tipo) {
    try { globalThis.SN_CONTATORI_MAIN && globalThis.SN_CONTATORI_MAIN.erroreVisto(tipo, { incognito: !!this.win._filoIncognito }); } catch (_) {}
  }

  // I contatori della navigazione (#1469): `costruisci` riceve SN_CONTATORI.NAV e ne sceglie la voce.
  _contaNavigazione(costruisci) {
    try {
      const M = globalThis.SN_CONTATORI_MAIN;
      const C = globalThis.SN_CONTATORI;
      if (M && C) M.navigazione(costruisci(C.NAV), { incognito: !!(this.incognito || (this.win && this.win._filoIncognito)) });
    } catch (_) {}
  }

  // Un sito bloccato si conta una volta per sito ogni mezzo minuto: una pagina che riprova di continuo è un blocco solo.
  _contaBloccato(decision) {
    const host = String((decision && decision.host) || '');
    const ora = Date.now();
    if (!this._bloccatiContati) this._bloccatiContati = new Map();
    const prima = this._bloccatiContati.get(host);
    if (prima != null && ora - prima < 30 * 1000) return;
    this._bloccatiContati.set(host, ora);
    if (this._bloccatiContati.size > 200) this._bloccatiContati.delete(this._bloccatiContati.keys().next().value);
    this._contaNavigazione((N) => N.sitoBloccato(decision && decision.reason));
  }

  // «Riprova» sulla pagina d'errore (#1469), o la ricarica che fa lo stesso: l'esito lo dice la navigazione che segue,
  // arrivata (did-navigate) o fallita di nuovo (did-fail-load). Un minuto senza esito non conta.
  _segnaRiprova(tab, paginaErrore) {
    const NE = globalThis.SN_NET_ERROR;
    const p = NE && NE.parse(paginaErrore);
    if (!p || !p.target || p.code === NE.BLOCKED_CODE || p.code === NE.CRASH_CODE) return;
    tab._riprova = { codice: p.code, wc: tab.view.webContents, t: Date.now(), verso: indirizzoCanonico(p.target) };
  }

  // Il salto chiesto dalla pagina d'errore stessa verso il suo sito: il suo «Riprova». Solo dietro un input vero:
  // la pagina «Sei offline» riprova da sola al ritorno della rete, e quello non è un «Riprova» premuto.
  _riprovaDallaPagina(tab, wc, url, event) {
    const NE = globalThis.SN_NET_ERROR;
    if (Date.now() - (tab._userInputAt || 0) > RIPROVA_GESTO_MS) return false;
    try {
      const corrente = wc.getURL() || '';
      const da = (event && event.initiator && event.initiator.url) || corrente;
      const target = NE && NE.isErrorPageUrl(corrente) ? NE.targetOf(corrente) : null;
      return !!target && da === corrente && indirizzoCanonico(target) === indirizzoCanonico(url);
    } catch (_) { return false; }
  }

  _esitoRiprova(tab, wc, riuscita) {
    const r = tab._riprova;
    if (!r || r.wc !== wc) return;
    tab._riprova = null;
    if (Date.now() - r.t > 60 * 1000) return;
    this._contaNavigazione((N) => N.navRiprova(r.codice, riuscita));
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
    this._contaApriComunque(url);
    tab.siteBlockAllowed = sito;
    tab._permessoRichieste = true;
    this._registraPermessoRichieste(tab);
  }

  // «Apri comunque» su un sito ancora in lista, dalla pagina, dalla notifica o dalla chat: il conto per lista (#1469).
  _contaApriComunque(url) {
    const d = this._decisioneBlocco(null, url);
    if (d) this._contaNavigazione((N) => N.apriComunque(d.reason));
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

  // Una pagina che sta per un indirizzo (errore di rete, «Sito bloccato») ne prende il posto nella storia, e
  // viceversa: senza, Indietro da lì riapre l'indirizzo, che fallisce o si ferma di nuovo (#871 giro 9).
  _sostituisciVoceGemella(wc, url) {
    const NE = globalThis.SN_NET_ERROR;
    if (!NE) return;
    try {
      const h = wc.navigationHistory;
      for (let i = h.getActiveIndex(); i >= 1; i--) {
        const prima = (h.getEntryAtIndex(i - 1) || {}).url || '';
        const gemelle = (NE.isErrorPageUrl(url) || NE.isErrorPageUrl(prima)) && this._urlUtente(prima) === this._urlUtente(url);
        if (!gemelle) return;
        h.removeEntryAtIndex(i - 1);
      }
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
        opts: { unica: `sito-bloccato:${label}`, tipo: 'sito_bloccato', indirizzo: target, actions: [{ label: 'Apri comunque', openUrl: target, apriComunque: true }] },
      });
    } catch (_) {}
  }

  // ─── rilevamento siti pericolosi ─────────────────────────────────────────
  // (vedi src/main/services/safebrowse/ e src/main/tabs/tabSafebrowse.js).
  // I metodi safebrowse sono estratti in tabSafebrowse.js e installati sul
  // prototype in fondo a questo file (mixin); l'avviso lo disegna avvisoSito.js.


  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        // In coda la pagina non è pronta (le anteprime aspettano) ma non sta caricando: niente rotella (#1127).
        loading: t.loading && !t._rinviata,
        canBack: t.canBack,
        canFwd: t.canFwd,
        muted: !!t.muted,
        color: t.color || null,
        identityColor: t.identityColor || null,
        openedAt: t.openedAt || null,
        lastActiveAt: t.lastActiveAt || null,
        lastInteractionAt: t.lastInteractionAt || null,
        audible: !!t.audible,
        scrollPct: typeof t.scrollPct === 'number' ? t.scrollPct : 0,
        formDirty: !!t.formDirty,
        isInternal: t.isInternal,
        proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null,
        // Banner dei cookie del sito, per il menu della scheda: null se Filo non li gestisce qui.
        cookies: this._cookieState(t),
        // «Resta connesso qui» (Privacy massima e Automatico): null se la voce non va mostrata.
        connesso: this._connessoState(t),
        // Cosa il sito della pagina ha avuto o si è visto negare (#586): il segno sulla scheda.
        permessi: Permessi.segniDi(t.view && t.view.webContents),
      })),
    };
  }

  _broadcast() {
    ContatoriFinestra.misura('schede', { incognito: this.incognito });
    this.anteprime.pota(new Set(this.tabs.map((t) => t.id)));
    this.codaRiapertura.pota(this.tabs);
    // La shell è il primary webContents della BrowserWindow.
    try {
      this.win.webContents.send('tabs:updated', this._snapshotPerBarra());
    } catch (_) { /* shell non ancora caricata */ }
    this.barra.aggiornaNav();
    this._annunciaVista();
    this._persistSession();
  }

  // Alla barra un'icona viaggia solo quando cambia: rispedirle tutte a ogni aggiornamento la bloccava con icone pesanti (#1083).
  // Chi la riceve riprende le altre dall'ultimo snapshot; quello chiesto con tabs:snapshot resta intero.
  _snapshotPerBarra() {
    const snap = this.snapshot();
    const prima = this._iconeInviate || new Map();
    this._iconeInviate = new Map();
    for (const t of snap.tabs) {
      this._iconeInviate.set(t.id, t.favicon);
      if (t.favicon && prima.get(t.id) === t.favicon) {
        delete t.favicon;
        t.faviconUguale = true;
      }
    }
    return snap;
  }

  // ─── persistenza sessione (riapri i tab alla riapertura di Filo) ──────────

  // `colors` è allineato indice-per-indice a `tabs`: fa ripartire la barra già tinta e dà i
  // dati al riordino cromatico. Un salvataggio vecchio senza `colors` regge.
  sessionState() {
    // Una scheda seguita da Filo (l'accesso a Google, #1123) è un passaggio: riaperta dopo un riavvio porterebbe a un
    // ritorno che non ascolta più. Quando Filo smette di seguirla diventa dell'utente e si salva.
    const kept = this.tabs
      .filter((t) => typeof t.url === 'string' && t.url && t.url !== 'about:blank' && !t._sorvegliante);
    const tabs = kept.map((t) => t.url);
    const colors = kept.map((t) => t.identityColor || null);
    // Dopo un riavvio la scheda è ancora quella aperta allora: l'Aiuto risponde a «quando l'ho aperta?» (#826).
    const aperte = kept.map((t) => t.openedAt || null);
    const pagine = kept.map((t) => t.paginaDal || null);
    // L'ultima volta che l'utente l'ha toccata: alla riapertura la pulizia vede l'inattività vera (#1618). Al minuto,
    // così i gesti non riscrivono la sessione a ogni aggiornamento della barra (#1089).
    const usate = kept.map((t) => (t.lastInteractionAt > 0 ? new Date(Math.floor(t.lastInteractionAt / 60_000) * 60_000).toISOString() : null));
    // Riaperta, la scheda resta quella di prima anche per il filo (#1561): le sue visite portano questo id.
    const ids = kept.map((t) => t.id);
    let activeIndex = kept.findIndex((t) => t.id === this.activeId);
    if (activeIndex < 0) activeIndex = 0;
    return { tabs, colors, aperte, pagine, usate, ids, activeIndex };
  }

  _sessionKey() {
    return globalThis.SN_CONST?.STORAGE_KEYS?.OPEN_TABS || 'sn_open_tabs';
  }

  // Salvataggio con debounce: _broadcast scatta spesso (load, titolo, favicon), e titolo, icona e
  // caricamento non cambiano la sessione: se è uguale a quella scritta non si riscrive (#1089).
  _persistSession() {
    if (this.incognito) return; // incognito: nessuna sessione salvata su disco
    if (this._restoring) return; // non sovrascrivere mentre stiamo ripristinando
    clearTimeout(this._sessionTimer);
    this._sessionTimer = null;
    if (JSON.stringify(this.sessionState()) === sessioneScritta) return;
    this._sessionTimer = setTimeout(() => {
      this._sessionTimer = null;
      const stato = this.sessionState();
      const testo = JSON.stringify(stato);
      if (testo === sessioneScritta) return;
      sessioneScritta = testo;
      try {
        Promise.resolve(globalThis.SN_STORAGE?.setRaw?.(this._sessionKey(), stato))
          .catch(() => { if (sessioneScritta === testo) sessioneScritta = null; });
      } catch (_) { sessioneScritta = null; }
    }, 400);
  }

  // Ritorna false se non c'era niente da ripristinare: allora il chiamante apre
  // una scheda vuota.
  async restoreSession() {
    if (this.incognito) return false; // incognito: nessuna sessione da ripristinare
    const t0 = Date.now();
    const contatori = globalThis.SN_CONTATORI_MAIN;
    let letturaFallita = false;
    let urls = [];
    let colors = [];
    const aperte = [];
    const pagine = [];
    const usate = [];
    const ids = [];
    let activeIndex = 0;
    try {
      const saved = await globalThis.SN_STORAGE?.getRaw?.(this._sessionKey(), null);
      if (saved && Array.isArray(saved.tabs)) {
        // url e colori si filtrano INSIEME, o `colors[i]` finisce sulla scheda
        // sbagliata.
        const savedColors = Array.isArray(saved.colors) ? saved.colors : [];
        const savedAperte = Array.isArray(saved.aperte) ? saved.aperte : [];
        const savedPagine = Array.isArray(saved.pagine) ? saved.pagine : [];
        const savedUsate = Array.isArray(saved.usate) ? saved.usate : [];
        const savedIds = Array.isArray(saved.ids) ? saved.ids : [];
        saved.tabs.forEach((u, i) => {
          if (typeof u === 'string' && u) {
            urls.push(u);
            colors.push(savedColors[i] || null);
            aperte.push(aperturaValida(savedAperte[i]));
            pagine.push(aperturaValida(savedPagine[i]));
            usate.push(aperturaValida(savedUsate[i]));
            ids.push(idRimettibile(savedIds[i]));
          }
        });
        if (Number.isInteger(saved.activeIndex)) activeIndex = saved.activeIndex;
      }
    } catch (_) { letturaFallita = true; }
    // L'esito della riapertura e i suoi tempi vanno ai contatori anonimi (#1466).
    if (!urls.length) {
      try { contatori?.sessione({ esito: letturaFallita ? 'lettura_fallita' : 'niente' }); } catch (_) {}
      return false;
    }

    this._restoring = true;
    const nate = [];
    let target = null;
    try {
      // #145 — suppressAutoplay: i media delle tab ripristinate restano in pausa
      // al boot (niente più video YouTube che ripartono tutti insieme).
      // #1127 — nascono tutte senza caricarsi: la coda carica prima quella in vista, poi le vicine.
      const perIndice = urls.map((url, i) => {
        // Una scheda su un sito della lista torna sulla pagina «Sito bloccato»:
        // non sparisce dalla sessione e il sito non si riapre da solo (#590).
        const id = this.openTab(url, { activate: false, suppressAutoplay: true, bloccoInPagina: true, rinvia: true, origine: { tipo: 'filo' }, idRimessa: ids[i] });
        const nata = id ? this.tabs.find((t) => t.id === id) : null;
        if (!nata) return null;
        this.visite.giaVista(nata.view.webContents, url);
        // §1.2/§1.3 — ripristina subito il colore identità salvato: la barra
        // riparte già tinta e il riordino cromatico alla riapertura ha i dati
        // pronti senza attendere il ricalcolo dei content script. Seeda anche la
        // cache per host, così una did-navigate sullo stesso dominio lo conserva.
        if (colors[i]) this.setTabIdentityColor(id, colors[i]);
        if (aperte[i]) nata.openedAt = aperte[i];
        nata.paginaDal = pagine[i] || null;
        if (usate[i]) nata.lastInteractionAt = Date.parse(usate[i]);
        nate.push(nata);
        return nata;
      });
      const i = activeIndex >= 0 && activeIndex < perIndice.length ? activeIndex : perIndice.length - 1;
      target = perIndice[i] || nate[nate.length - 1] || null;
      this.codaRiapertura.accoda(perVicinanza(nate, target));
      if (target) this.activate(target.id);
      this.codaRiapertura.avanti();
    } finally {
      this._restoring = false;
    }
    if (!nate.length) {
      try { contatori?.sessione({ esito: 'niente' }); } catch (_) {}
      return false;
    }
    ContatoriFinestra.misura('sessione', this, nate);
    try {
      const misura = contatori?.sessione({ esito: 'ripristinata', schede: nate.length, t0 });
      if (misura) {
        if (target) target._sessioneVista = misura.vista;
        this.codaRiapertura.finita().then(() => misura.coda(), () => misura.coda());
      }
    } catch (_) {}
    this._persistSession();
    // §2.1 decisione utente: a ogni riapertura Filo riordina/archivia le tab, a pagine
    // caricate (forniscono l'estratto all'LLM). No-op se la pref è disattivata o manca la chiave.
    this._maybeTriageOnReopen();
    return true;
  }

  async _maybeTriageOnReopen() {
    const inizio = Date.now();
    try {
      const s = await this._readSettings();
      const aa = s && s.autoArchive;
      if (!aa || !aa.enabled || !aa.onClose) return;
      // Il riordino legge il contenuto delle pagine: parte quando la coda della riapertura le ha caricate tutte.
      await this.codaRiapertura.finita();
      const attesa = Math.max(TRIAGE_DOPO_CODA_MS, TRIAGE_RIAPERTURA_MS - (Date.now() - inizio));
      setTimeout(() => { this.runAutoTriage({ trigger: 'reopen' }).catch(() => {}); }, attesa);
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
installRestaConnesso(TabManager);

// Il sito ha ricevuto il testo dell'utente quando una richiesta che lo porta ha risposta senza errore
// (#824); lo si dice ai frame di quel sito. Un altro sito (le registrazioni delle sessioni) non conta.
const RICHIESTE_CON_TESTO = new Set(['xhr', 'ping', 'mainFrame', 'subFrame', 'other']);
// La richiesta del service worker del sito non ha scheda: vale per le schede di quel sito, e
// ciascuna ci cerca solo il suo testo.
function schedeConTestoDi(d) {
  const out = [];
  const sitoPagina = d.webContentsId ? '' : Cookies.registrableOf(d.referrer || '');
  if (!d.webContentsId && !sitoPagina) return out;
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      try {
        if (!t.formDirty) continue;
        if (d.webContentsId ? t.view.webContents.id === d.webContentsId : Cookies.registrableOf(t.url) === sitoPagina) out.push({ tab: t, w });
      } catch (_) {}
    }
  }
  return out;
}
const inViaggio = new Map();
const chiaveRichiesta = (d) => `${d.webContentsId || 'sw'}:${d.id}`;
Cookies.osservaRichieste((d) => {
  if (!d || !RICHIESTE_CON_TESTO.has(d.resourceType)) return;
  const sito = Cookies.registrableOf(d.url);
  if (!sito) return;
  let da = '';
  try { da = (d.frame && d.frame.url) || ''; } catch (_) {}
  const schede = schedeConTestoDi(d).filter((s) => Cookies.registrableOf(da || d.referrer || s.tab.url) === sito);
  if (!schede.length) return;
  if (inViaggio.size >= 200) inViaggio.delete(inViaggio.keys().next().value);
  inViaggio.set(chiaveRichiesta(d), { schede, sito, url: d.url, corpo: corpoDa(d.uploadData) });
}, (d, riuscita) => {
  const k = d ? chiaveRichiesta(d) : '';
  const r = inViaggio.get(k);
  if (!r) return;
  inViaggio.delete(k);
  if (riuscita && d.statusCode >= 200 && d.statusCode < 400) for (const s of r.schede) accodaRicevuta({ ...s, sito: r.sito, url: r.url, corpo: r.corpo });
});
// Una richiesta alla volta, cedendo il passo fra l'una e l'altra: una pagina che ne manda tante
// non ferma Filo. Oltre la coda si lasciano andare, e nel dubbio la scheda resta protetta.
const ricevute = [];
let leggendo = false;
function accodaRicevuta(r) {
  if (ricevute.length >= 8) return;
  ricevute.push(r);
  if (!leggendo) { leggendo = true; setImmediate(leggiRicevuta); }
}
function leggiRicevuta() {
  const r = ricevute.shift();
  if (!r) { leggendo = false; return; }
  try {
    const testo = testoDellaRichiesta(r);
    const type = globalThis.SN_MSG?.MSG?.FORM_SENT || 'form_sent';
    const inVista = !!(r.w._filoTabs && r.w._filoTabs.activeId === r.tab.id);
    if (testo) spingiAllaScheda(r.tab.view.webContents, { type, testo }, { inVista, soloFrame: (url) => Cookies.registrableOf(url) === r.sito });
  } catch (_) {}
  setImmediate(leggiRicevuta);
}

function chiaveFrame(f) {
  try { return `${f.processId}:${f.routingId}`; } catch (_) { return ''; }
}

function origineDi(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function senzaAncora(url) {
  return String(url || '').split('#')[0];
}

// Cambia solo col documento: l'ancora, la ricarica o il ritorno della stessa pagina dopo un riavvio non contano.
function segnaPagina(tab, url) {
  const u = senzaAncora(url);
  if (!u || u === tab._paginaUrl) return;
  tab._paginaUrl = u;
  tab.paginaDal = new Date().toISOString();
}

// Una pulizia senza giudizio che Filo sa spiegare da sé: la frase va all'utente così com'è, il codice dice dove si rimedia.
function erroreDiPulizia(frase, code = '') {
  const e = new Error(frase);
  e.userMessage = frase;
  if (code) e.code = code;
  return e;
}

// Il testo della pagina per il giudizio, o '' se la pagina non risponde entro il tetto.
function leggiEstratto(tab) {
  let tetto = null;
  const lettura = Promise.resolve()
    .then(() => tab.view.webContents.executeJavaScript(
      '(function(){try{return (document.body&&document.body.innerText||"").replace(/\\s+/g," ").slice(0,800);}catch(e){return "";}})()',
      false,
    ))
    .catch(() => '');
  const scaduto = new Promise((r) => { tetto = setTimeout(() => r(''), ESTRATTO_TETTO_MS); });
  return Promise.race([lettura, scaduto]).finally(() => clearTimeout(tetto));
}

// L'apertura salvata nella sessione, se è una data vera e non nel futuro; sennò la scheda riparte da adesso.
// L'id salvato di una scheda torna solo se ha la forma di quelli che Filo dà, e nessuna scheda aperta lo porta.
const ID_SCHEDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idRimettibile(v) {
  return typeof v === 'string' && ID_SCHEDA.test(v) ? v : null;
}
function idInUso(id) {
  for (const w of BrowserWindow.getAllWindows()) {
    const tm = w && !w.isDestroyed?.() && w._filoTabs;
    if (tm && Array.isArray(tm.tabs) && tm.tabs.some((t) => t.id === id)) return true;
  }
  return false;
}

function aperturaValida(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 && t <= Date.now() + 60_000 ? new Date(t).toISOString() : null;
}

// Una scheda riaperta in coda porta il nome del suo sito finché la pagina non le dà il titolo vero.
function titoloInAttesa(url) {
  const host = hostOf(url);
  return host ? host.replace(/^www\./i, '') : 'Nuova scheda';
}

// §1.2 — solo schemi web: una pagina filo:// non ha un sito da tinteggiare.
function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host || null;
  } catch (_) { return null; }
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

// Dal codice errore di Chromium allo stato del motore (CERT_BAD in
// services/safebrowse/engine.js).
function mapCertError(error) {
  const e = String(error || '');
  if (/ERR_CERT_DATE_INVALID/.test(e)) return 'expired';
  if (/ERR_CERT_COMMON_NAME_INVALID/.test(e)) return 'mismatch';
  if (/ERR_CERT_REVOKED/.test(e)) return 'revoked';
  return 'untrusted';
}

// #398 — normalizeUrl e isLocalHost stanno in src/shared/urlNav.js: la stessa
// logica serve al campo "nuova scheda" della dashboard, e una sola ne esiste.

module.exports = { TabManager, normalizeUrl, isWebUnsafeNav };
