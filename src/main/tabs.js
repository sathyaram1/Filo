// Tab manager: ogni tab è una WebContentsView attaccata alla BrowserWindow,
// posizionata sotto la "shell" (tab bar + barra indirizzi).
// La shell parla con il main via IPC (tabs:* canali); il main risponde con
// broadcast tabs:updated alla shell perché ridisegni la barra.

const { WebContentsView, Menu, MenuItem } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Cookies = require('./services/cookies');

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page-preload.js');
const INTERNAL_PRELOAD = path.join(__dirname, '..', 'preload', 'internal-preload.js');

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

const PAGE_SELECTION_CSS = `
::selection { background-color: rgba(196, 90, 59, 0.30) !important; }
::-moz-selection { background-color: rgba(196, 90, 59, 0.30) !important; }
[data-sn-theme="light"] ::selection { background-color: rgba(196, 90, 59, 0.25) !important; }
[data-sn-theme="light"] ::-moz-selection { background-color: rgba(196, 90, 59, 0.25) !important; }
[data-sn-theme="dark"] ::selection { background-color: rgba(196, 90, 59, 0.35) !important; }
[data-sn-theme="dark"] ::-moz-selection { background-color: rgba(196, 90, 59, 0.35) !important; }
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
    // Spazio extra riservato in alto (px): usato quando un dropdown della shell
    // (es. menu App) deve restare visibile sopra la WebContentsView attiva. Si
    // abbassa la view invece di nasconderla, evitando l'area vuota/bianca.
    this.topInset = 0;
    // Modalità "contenuto a tutto schermo": la WebContentsView attiva copre
    // l'intera finestra, nascondendo la barra (tab + indirizzo) della shell.
    // Attivata dal menu (voce "Schermo intero"); si esce con Esc.
    this.contentFullscreen = false;
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
      const policy = this.security.protectIpLeak ? 'default_public_interface_only' : 'default';
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
    if (this.contentFullscreen === on) return on;
    this.contentFullscreen = on;
    this.layout();
    try {
      if (typeof this.win.setFullScreen === 'function') this.win.setFullScreen(on);
    } catch (_) {}
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

  _broadcastToViews(message) {
    for (const t of this.tabs) {
      try { t.view.webContents.send('filo:broadcast', message); } catch (_) {}
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

  _makeView(url, partition) {
    const isInternal = url.startsWith('filo://');
    return new WebContentsView({
      webPreferences: {
        preload: isInternal ? INTERNAL_PRELOAD : PAGE_PRELOAD,
        // Per le pagine interne (filo://) usiamo contextIsolation:false così
        // possiamo overwritare window.chrome direttamente — i file portati
        // dall'estensione si aspettano chrome.* in scope globale. Le pagine
        // web esterne mantengono l'isolation (codice non fidato).
        contextIsolation: !isInternal,
        sandbox: false,
        nodeIntegration: false,
        webSecurity: true,
        // partition: incognito (effimera della finestra) o per-sito in privacy.
        ...(partition ? { partition } : {}),
      },
    });
  }

  openTab(url = 'filo://newtab/', { activate = true } = {}) {
    const id = randomUUID();
    const isInternal = url.startsWith('filo://');
    const partition = this._partitionFor(url);
    const view = this._makeView(url, partition);

    const tab = {
      id,
      view,
      title: 'Nuova scheda',
      url,
      favicon: '',
      loading: true,
      canBack: false,
      canFwd: false,
      isInternal,
      partition,
      partitionSite: isInternal ? null : Cookies.registrableOf(url),
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
      this.layout();
    }
    view.webContents.loadURL(url);
    if (activate) {
      // Riaffermo la visibilità su tutti i tab dopo loadURL.
      for (const t of this.tabs) t.view.setVisible?.(t.id === id);
    }
    this._broadcast();
    return id;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      const next = this.tabs[idx] || this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.openTab('filo://newtab/'); // niente tab → nuovo newtab
    }
    this._broadcast();
  }

  // Chiude TUTTE le tab e lascia una singola newtab fresca (come Chrome quando
  // si chiude l'ultima scheda: la finestra resta, con una scheda vuota).
  closeAllTabs() {
    for (const tab of this.tabs) {
      try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
      try { tab.view.webContents.close(); } catch (_) {}
    }
    this.tabs = [];
    this.activeId = null;
    this.openTab('filo://newtab/');
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    for (const t of this.tabs) {
      t.view.setVisible?.(t.id === id);
    }
    this.layout();
    this._broadcast();
  }

  navigate(id, url) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const target = normalizeUrl(url);
    // La WebContentsView va RICREATA (non basta un loadURL) quando cambia la
    // partizione (privacy, fra siti diversi) oppure quando si attraversa il
    // confine di fiducia interno↔esterno: il preload e contextIsolation sono
    // fissati alla creazione della view e un loadURL non li rivaluta, quindi
    // riusare la view caricherebbe il contenuto col preload sbagliato.
    if (this._needsRecreate(tab, target)) {
      this._recreateView(tab, target);
      return;
    }
    tab.view.webContents.loadURL(target);
  }

  // true se navigare `tab` verso `url` richiede una partizione diversa da quella
  // con cui la view è stata creata (solo in modalità privacy, fra siti diversi).
  _needsRepartition(tab, url) {
    if (this.cookieMode !== Cookies.MODES.PRIVACY || this.incognito) return false;
    const next = this._partitionFor(url);
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
  _recreateView(tab, url) {
    const wasActive = tab.id === this.activeId;
    const partition = this._partitionFor(url);
    try { this.win.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
    const view = this._makeView(url, partition);
    tab.view = view;
    tab.partition = partition;
    tab.isInternal = url.startsWith('filo://');
    tab.partitionSite = tab.isInternal ? null : Cookies.registrableOf(url);
    this._wireEvents(tab);
    this._applySecurity(tab);
    this.win.contentView.addChildView(view);
    if (wasActive) {
      this.activeId = tab.id;
      this.layout();
    }
    view.webContents.loadURL(url);
    if (wasActive) {
      for (const t of this.tabs) t.view.setVisible?.(t.id === tab.id);
    }
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
    wc.on('before-input-event', (event, input) => {
      if (this.contentFullscreen && input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        this.setContentFullscreen(false);
      }
    });
    // Privacy: navigazione main-frame iniziata dalla pagina (click su link,
    // window.location) verso un sito diverso → serve un'altra partizione, che
    // non si può cambiare a view viva. Blocchiamo questa navigazione e ricreiamo
    // la view nella partizione del nuovo sito. Best-effort: i redirect lato
    // server a metà caricamento possono sfuggire (restano nel jar precedente),
    // limite accettabile per una modalità privacy opt-in.
    wc.on('will-navigate', (event, url) => {
      if (this._needsRepartition(tab, url)) {
        event.preventDefault();
        this._recreateView(tab, url);
      }
    });
    // Debug helper: in dev relay i log della pagina al main.
    if (process.env.NODE_ENV !== 'production') {
      wc.on('console-message', (_e, level, message, line, source) => {
        const tag = ['log', 'warn', 'error'][level] || 'info';
        const src = source ? ` (${source}:${line})` : '';
        console.log(`[tab:${tab.id.slice(0, 6)}:${tag}] ${message}${src}`);
      });
      wc.on('render-process-gone', (_e, details) => {
        console.error(`[tab:${tab.id.slice(0, 6)}] render-process-gone`, details);
      });
      wc.on('did-fail-load', (_e, code, desc, url) => {
        console.error(`[tab:${tab.id.slice(0, 6)}] did-fail-load`, code, desc, url);
      });
    }
    // Colore selezione testo coerente con Filo sui siti esterni. insertCSS
    // ignora la CSP della pagina (che invece blocca il <link filo://> del
    // content script). Reiniettiamo a ogni dom-ready perché lo stylesheet
    // utente non sopravvive alle navigazioni a documento intero.
    // Reiniettiamo a ogni dom-ready perché gli stylesheet inseriti non
    // sopravvivono alle navigazioni a documento intero. Il guard è sull'URL
    // CORRENTE (non su tab.isInternal, fissato alla creazione): così anche una
    // newtab interna che naviga verso un sito esterno riceve gli stili.
    wc.on('dom-ready', () => {
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

    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => {
      update({
        loading: false,
        url: wc.getURL(),
        canBack: canGoBack(wc),
        canFwd: canGoFwd(wc),
      });
    });
    wc.on('page-title-updated', (_e, title) => update({ title: title || tab.title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons?.[0] || '' }));
    wc.on('did-navigate', (_e, url) => {
      update({ url, canBack: canGoBack(wc), canFwd: canGoFwd(wc) });
      // Rilevamento siti pericolosi: ricontrolla l'URL FINALE (dopo i redirect)
      // appena il main-frame si è committato, prima che la pagina sia
      // interattiva. Best-effort, non blocca mai (vedi _sbOnNavigate).
      this._sbOnNavigate(tab, url);
    });
    wc.on('did-navigate-in-page', (_e, url) => update({ url, canBack: canGoBack(wc), canFwd: canGoFwd(wc) }));

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
        try {
          wc.send('filo:broadcast', {
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
      const isAdLikePopup = disposition === 'new-window';
      if (tab.isInternal === false && this.security.blockPopups && isAdLikePopup) {
        this._notifyPopupBlocked(tab.id, url);
        return { action: 'deny' };
      }
      this.openTab(url, { activate: true });
      return { action: 'deny' };
    });
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

  // ─── rilevamento siti pericolosi ─────────────────────────────────────────
  // (vedi src/main/services/safebrowse/). Tutto best-effort: NIENTE blocca mai
  // la navigazione. L'overlay "pericoloso"/banner "sospetto" vive in un content
  // script sulla pagina; qui calcoliamo il verdetto e lo spingiamo via broadcast
  // SAFEBROWSE_UPDATE. Bypass (confermo) e dismiss (ok) sono per (tab, dominio)
  // e durano solo finché il tab vive.

  _sbState(tab) {
    if (!tab.sbBypass) tab.sbBypass = new Set();      // domini confermati su "pericoloso"
    if (!tab.sbDismissed) tab.sbDismissed = new Set(); // banner "sospetto" già chiuso
    return tab;
  }

  // Abbassa il verdetto a "safe" se l'utente ha già confermato/chiuso l'avviso
  // per questo dominio in questo tab.
  _sbApplyState(tab, verdict) {
    if (!verdict || verdict.level === 'safe') return verdict;
    const reg = verdict.norm && verdict.norm.registrable;
    if (!reg) return verdict;
    this._sbState(tab);
    if (verdict.level === 'pericoloso' && tab.sbBypass.has(reg)) {
      return { ...verdict, level: 'safe', message: null };
    }
    if (verdict.level === 'sospetto' && tab.sbDismissed.has(reg)) {
      return { ...verdict, level: 'safe', message: null };
    }
    return verdict;
  }

  // Spinge il verdetto al content script del tab (l'overlay/banner si ridisegna).
  _sbBroadcast(tab, url, verdict) {
    const T = (globalThis.SN_MSG && globalThis.SN_MSG.MSG && globalThis.SN_MSG.MSG.SAFEBROWSE_UPDATE) || 'safebrowse_update';
    try {
      tab.view.webContents.send('filo:broadcast', {
        type: T,
        url,
        level: verdict ? verdict.level : 'safe',
        message: verdict ? (verdict.message || null) : null,
      });
    } catch (_) {}
  }

  // Richiesto dal content script (SAFEBROWSE_GET) quando la pagina parte. Ritorna
  // SUBITO il verdetto sincrono (rispettando bypass/dismiss) e, se ci sono
  // segnali di rete da approfondire, li avvia: a verdetto cambiato fa broadcast.
  safebrowseGet(tabId, url, ctx = {}) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!SB || !tab) return { ok: true, level: 'safe', message: null };
    let verdict;
    try {
      verdict = SB.analyze(url, ctx, (next) => {
        this._sbBroadcast(tab, url, this._sbApplyState(tab, next));
      });
    } catch (_) {
      return { ok: true, level: 'safe', message: null };
    }
    const applied = this._sbApplyState(tab, verdict);
    return {
      ok: true,
      level: applied.level,
      message: applied.message || null,
      registrable: applied.norm ? applied.norm.registrable : null,
    };
  }

  // did-navigate: ricontrolla l'URL FINALE (dopo i redirect) e spinge il verdetto
  // al content script. Salta le pagine interne filo://.
  _sbOnNavigate(tab, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    if (!SB || !tab || !url || /^filo:\/\//i.test(url)) return;
    try {
      const verdict = SB.analyze(url, {}, (next) => {
        this._sbBroadcast(tab, url, this._sbApplyState(tab, next));
      });
      this._sbBroadcast(tab, url, this._sbApplyState(tab, verdict));
    } catch (_) {}
  }

  // L'utente ha scritto "confermo" sull'interstitial "pericoloso": registra il
  // bypass per (tab, dominio) e ridisegna (l'overlay sparisce).
  safebrowseProceed(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const norm = SB && SB.normalize(url);
      if (norm && norm.registrable) tab.sbBypass.add(norm.registrable);
    } catch (_) {}
    this._sbBroadcast(tab, url, { level: 'safe', message: null });
    return { ok: true };
  }

  // L'utente ha chiuso con "ok" il banner "sospetto": non riproporlo per questo
  // dominio in questo tab.
  safebrowseDismiss(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const norm = SB && SB.normalize(url);
      if (norm && norm.registrable) tab.sbDismissed.add(norm.registrable);
    } catch (_) {}
    this._sbBroadcast(tab, url, { level: 'safe', message: null });
    return { ok: true };
  }

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
        isInternal: t.isInternal,
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

  // Stato minimale da salvare/ripristinare: gli URL dei tab e quale era attivo.
  sessionState() {
    const tabs = this.tabs
      .map((t) => t.url)
      .filter((u) => typeof u === 'string' && u && u !== 'about:blank');
    let activeIndex = this.tabs.findIndex((t) => t.id === this.activeId);
    if (activeIndex < 0) activeIndex = 0;
    return { tabs, activeIndex };
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
    let activeIndex = 0;
    try {
      const saved = await globalThis.SN_STORAGE?.getRaw?.(this._sessionKey(), null);
      if (saved && Array.isArray(saved.tabs)) {
        urls = saved.tabs.filter((u) => typeof u === 'string' && u);
        if (Number.isInteger(saved.activeIndex)) activeIndex = saved.activeIndex;
      }
    } catch (_) {}
    if (!urls.length) return false;

    this._restoring = true;
    try {
      for (const url of urls) this.openTab(url, { activate: false });
      if (activeIndex < 0 || activeIndex >= this.tabs.length) activeIndex = this.tabs.length - 1;
      const target = this.tabs[activeIndex];
      if (target) this.activate(target.id);
    } finally {
      this._restoring = false;
    }
    this._persistSession();
    return true;
  }
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

// Trasforma input dell'utente in un URL navigabile:
//   - se sembra URL (ha schema o "." al centro) → naviga
//   - altrimenti → google search
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'filo://newtab/';
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('filo://')) return raw;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(raw)) return 'https://' + raw;
  return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
}

module.exports = { TabManager, normalizeUrl };
