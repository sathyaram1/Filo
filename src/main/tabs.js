// Tab manager: ogni tab è una WebContentsView attaccata alla BrowserWindow,
// posizionata sotto la "shell" (tab bar + barra indirizzi).
// La shell parla con il main via IPC (tabs:* canali); il main risponde con
// broadcast tabs:updated alla shell perché ridisegni la barra.

const { WebContentsView, Menu, MenuItem, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Cookies = require('./services/cookies');
const ProxyTab = require('./services/proxyTab');
const GeoBlock = require('./services/geoBlock');
const GeoBlockRules = require('./services/geoBlockRules');

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
      // partition: incognito (effimera della finestra) o per-sito in privacy.
      ...(partition ? { partition } : {}),
    };
    // #145 — le tab RIPRISTINATE alla riapertura di Filo non devono far ripartire
    // i media da sole (es. i video YouTube che ripartivano tutti insieme al boot).
    // Il default di Electron è 'no-user-gesture-required' (autoplay sempre libero);
    // qui imponiamo l'attivazione utente: il video resta in pausa finché l'utente
    // non interagisce con quella pagina. Come si comporta un browser normale.
    if (opts.suppressAutoplay) webPreferences.autoplayPolicy = 'document-user-activation-required';
    return new WebContentsView({ webPreferences });
  }

  openTab(url = 'filo://newtab/', { activate = true, restoreScrollPct = null, restoreZoomLevel = null, suppressAutoplay = false } = {}) {
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
    // #152 — born proxied: se il dominio ha una regola persistente, la scheda
    // nasce instradata da quel paese (ricrea la view nella partition proxata).
    this._maybeApplyDomainRule(tab, url);
    this._broadcast();
    return id;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    // §3.1/§4 — "Chiudi = archivia": prima di distruggere la view salviamo i
    // metadati della tab nell'archivio (consultabile da filo://archive).
    this._archiveClosedTab(tab);
    ProxyTab.clearPartitionAuth(`proxy:${tab.id}`);
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

  // Candidati archiviabili: tab web, non attiva, non in riproduzione audio, non
  // interne. (Incognito è escluso a monte: niente timer in incognito.)
  _triageCandidates() {
    return this.tabs.filter((t) =>
      t.id !== this.activeId
      && !t.audible
      && !t.isInternal
      && /^https?:\/\//i.test(t.url || ''));
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

  // Esegue un giro di triage: raccoglie i candidati, chiede all'LLM (batch su
  // tutte le tab) e applica le decisioni. Se manca la chiave o l'LLM fallisce,
  // è un no-op silenzioso (non tocca le tab).
  async runAutoTriage({ trigger = 'idle' } = {}) {
    if (this.incognito || this._triageRunning) return { archived: 0 };
    const decide = globalThis.SN_TAB_TRIAGE_DECIDE;
    if (typeof decide !== 'function') return { archived: 0 };
    const cands = this._triageCandidates();
    if (!cands.length) return { archived: 0 };
    this._triageRunning = true;
    try {
      const input = await this._gatherTriageInput(cands);
      let decisions = [];
      try {
        const r = await decide({ tabs: input, trigger });
        decisions = Array.isArray(r && r.decisions) ? r.decisions : [];
      } catch (_) { return { archived: 0 }; }
      return this.applyTriageDecisions(cands, decisions);
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

    if (toArchive.length) {
      this.reorderTabsByColor();
      this._broadcast();
      this._showTriageToast(toArchive.length);
    }
    return { archived: toArchive.length };
  }

  // §1.3 — riordina la striscia per colore (arcobaleno) in base all'identityColor.
  // Le tab senza colore (interne, identità ignota) restano in coda nell'ordine.
  reorderTabsByColor() {
    const withIdx = this.tabs.map((t, i) => ({ t, i }));
    withIdx.sort((a, b) => {
      const ha = hueOf(a.t.identityColor);
      const hb = hueOf(b.t.identityColor);
      if (ha !== hb) return ha - hb;
      return a.i - b.i; // stabile
    });
    this.tabs = withIdx.map((x) => x.t);
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
    });
  }

  // Voce "Aiuto" del menu tasto destro su tab: apre la sidebar Aiuto (l'agente
  // con visione) SU quella scheda, passandole il contesto "invocata da click
  // sulla tab" (url + titolo) così l'agente sa da dove parte. Riusa lo stesso
  // canale degli shortcut (page-preload → MSG.SHORTCUT_TRIGGERED). Sulle pagine
  // interne senza content script non succede nulla, come per Alt+H.
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
  _recreateView(tab, url) {
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
    view.webContents.loadURL(url);
    // Visibilità coerente con lo stato attivo: solo la scheda attiva è visibile,
    // le altre (inclusa la view appena ricreata se non attiva) restano nascoste.
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

    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => {
      update({
        loading: false,
        url: wc.getURL(),
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
      // Nuova pagina → il colore live (§1.1) del sito precedente non vale più: lo
      // azzeriamo (la tab torna al neutro finché il content script non ricampiona).
      // Il colore IDENTITÀ (§1.2) invece dipende dal DOMINIO: se navighiamo su un
      // host già in cache lo applichiamo subito, altrimenti azzeriamo e aspettiamo
      // che il content script lo ricalcoli per il nuovo sito.
      const cachedIdentity = this._identityColorCache.get(hostOf(url)) || null;
      update({
        url,
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
    wc.on('did-navigate-in-page', (_e, url) => update({ url, canBack: canGoBack(wc), canFwd: canGoFwd(wc) }));
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
    // (event, {audible}) nelle versioni recenti di Electron e come (event, audible)
    // nelle vecchie: gestiamo entrambe.
    wc.on('audio-state-changed', (_e, arg) => {
      const audible = arg && typeof arg === 'object' ? !!arg.audible : !!arg;
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
    // Memorizza l'ultimo livello di sicurezza applicato al tab: è l'input
    // "sito flaggato sospetto/pericoloso" delle regole d'azione geo-block
    // (#151), che NON deve mai aggirare i controlli di sicurezza di Filo.
    try { tab.sbLevel = verdict ? (verdict.level || 'safe') : 'safe'; } catch (_) {}
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

  // ─── rilevamento geo-block (livello 1 deterministico) ────────────────────
  // (vedi src/main/services/geoBlock.js e proxy-per-tab-spec.md §4). Qui SOLO
  // rilevamento + segnale interno: NESSUNA azione (niente retry via proxy,
  // niente proposta UI) — le regole d'azione sono un livello separato che
  // consuma GeoBlock.onDetected(). Un solo segnale per navigazione: la prima
  // fonte che matcha vince (status > redirect > testo).

  _geoBlockDetected(tab, url, source, detail) {
    if (tab.geoBlock && tab.geoBlock.url === url) return; // già segnalato
    let host = '';
    try { host = new URL(url).hostname; } catch (_) {}
    tab.geoBlock = { url, host, source, detail, at: Date.now() };
    GeoBlock.emitDetected({ tabId: tab.id, url, host, source, detail, at: tab.geoBlock.at });
    // Livello decisionale (regole d'azione, #151). Vive nello stesso TabManager
    // che possiede il tab: lo chiamiamo diretto invece di passare per il registro
    // onDetected (che resta per consumatori esterni). La logica PURA della
    // matrice sta in geoBlockRules.js; qui solo la raccolta degli input reali e
    // l'azione. Best-effort, mai bloccante.
    Promise.resolve().then(() => this._geoActOnDetected(tab)).catch(() => {});
  }

  // ─── regole d'azione su geo-block (livello decisionale, #151) ─────────────
  // (proxy-per-tab-spec.md §5). Dato un geo-block rilevato, decide e agisce:
  //   - retry silenzioso via datacenter (sito non flaggato, nessun login) → toast
  //   - proposta inline (login attivo) — MAI retry silenzioso a sessione attiva
  //   - niente (sito flaggato pericoloso/sospetto: il proxy non aggira la sicurezza)
  //   - escalation datacenter→residenziale UNA volta se l'IP datacenter è bloccato
  // L'escalation usa lo stato per-tab tab.geoRetry (per host): la ri-rilevazione
  // del blocco dopo un retry significa che quell'IP è a sua volta bloccato.
  async _geoActOnDetected(tab) {
    if (!tab || !tab.geoBlock) return;
    const host = tab.geoBlock.host || '';
    const url = tab.geoBlock.url || '';
    if (!host || !/^https?:\/\//i.test(url)) return;
    // L'utente ha già rifiutato la proposta per questo dominio nel tab: non
    // riproporre, non riprovare.
    this._geoState(tab);
    if (tab.geoDismissed.has(host)) return;

    // Stadio del retry per QUESTO host (geoBlockRules.STAGES).
    const gr = tab.geoRetry;
    const sameHost = gr && gr.host === host;
    if (sameHost && gr.stage === 'settled') return; // già gestito per questo host
    let stage = GeoBlockRules.STAGES.INITIAL;
    if (sameHost && gr.stage === 'datacenter_tried') stage = GeoBlockRules.STAGES.DATACENTER_FAILED_IPBLOCK;
    else if (sameHost && gr.stage === 'residential_tried') stage = GeoBlockRules.STAGES.RESIDENTIAL_FAILED;

    // Input reali della matrice.
    let settings = null;
    try { settings = await this._readSettings(); } catch (_) {}
    const proxyConfigured = ProxyTab.isConfigured(settings);
    const flaggedDangerous = tab.sbLevel === 'sospetto' || tab.sbLevel === 'pericoloso';
    let hasLoginCookies = false;
    try {
      const ses = tab.view && tab.view.webContents && tab.view.webContents.session;
      if (ses && ses.cookies) {
        const cookies = await ses.cookies.get({ url });
        hasLoginCookies = GeoBlockRules.hasLoginCookie(cookies);
      }
    } catch (_) {}

    const decision = GeoBlockRules.decideGeoAction({ flaggedDangerous, hasLoginCookies, proxyConfigured, stage });

    // Paese di destinazione: ultima location usata, altrimenti default, altrimenti USA.
    const p = (settings && settings.proxy) || {};
    const country = ProxyTab.normalizeCountry(p.lastCountry) || ProxyTab.normalizeCountry(p.defaultCountry) || 'us';
    const label = this._geoCountryLabel(country);

    if (decision.action === GeoBlockRules.ACTIONS.NONE) {
      tab.geoRetry = { host, stage: 'settled' };
      return;
    }

    if (decision.action === GeoBlockRules.ACTIONS.PROPOSE) {
      this._geoBroadcastPropose(tab, url, country, label);
      tab.geoRetry = { host, stage: 'settled' };
      return;
    }

    // SILENT_RETRY: riapri la tab proxata sul tier deciso. Se l'applicazione del
    // proxy fallisce del tutto (es. tier non configurato), non c'è retry: si propone.
    const tier = decision.tier;
    let res = { ok: false };
    try { res = await this.setTabProxy(tab.id, country, { tier }); } catch (_) { res = { ok: false }; }
    if (res && res.ok) {
      // Informare, non chiedere (spec §5): toast discreto. La ri-rilevazione del
      // blocco dopo il reload proxato (se l'IP è bloccato) farà scattare l'escalation.
      this._geoToast(`Aperto da ${label}`);
      tab.geoRetry = { host, stage: tier === GeoBlockRules.TIERS.RESIDENTIAL ? 'residential_tried' : 'datacenter_tried' };
    } else {
      // Il proxy non si è potuto applicare: niente loop, si propone all'utente.
      this._geoBroadcastPropose(tab, url, country, label);
      tab.geoRetry = { host, stage: 'settled' };
    }
  }

  // Etichetta leggibile del paese ('us' → 'Stati Uniti'); fallback al codice
  // maiuscolo per i paesi fuori dalla lista curata (il linguaggio naturale, #152,
  // può chiederne altri).
  _geoCountryLabel(code) {
    const c = String(code || '').toLowerCase();
    const hit = (ProxyTab.LOCATIONS || []).find((l) => l.code === c);
    return hit ? hit.label : c.toUpperCase();
  }

  // Toast discreto nella shell ("Aperto da {paese}"): informa senza chiedere.
  _geoToast(text) {
    try { this.win.webContents.send('shell:toast', { text }); } catch (_) {}
  }

  // Proposta inline al content script del tab (login attivo, o retry esaurito):
  // "Questo contenuto è bloccato in Italia. Lo apro da {paese}? In questa tab non
  // sarai loggato." con i bottoni Apri/No.
  _geoBroadcastPropose(tab, url, country, label) {
    const T = (globalThis.SN_MSG && globalThis.SN_MSG.MSG && globalThis.SN_MSG.MSG.GEO_PROPOSE) || 'geo_propose';
    try {
      tab.view.webContents.send('filo:broadcast', { type: T, url, country, countryLabel: label });
    } catch (_) {}
  }

  _geoState(tab) {
    if (!tab.geoDismissed) tab.geoDismissed = new Set(); // host con proposta rifiutata
    return tab;
  }

  // L'utente ha accettato la proposta inline: instrada la tab dal paese indicato
  // (cookie jar separato → nella tab proxata non sarà loggato, come avvertito).
  async geoProposeAccept(tabId, country) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false, error: 'no_tab' };
    // Accettando, l'host esce dallo stato "settled/dismissed": è una scelta esplicita.
    let host = '';
    try { host = tab.geoBlock ? tab.geoBlock.host : (tab.url ? new URL(tab.url).hostname : ''); } catch (_) {}
    this._geoState(tab);
    if (host) tab.geoDismissed.delete(host);
    tab.geoRetry = { host, stage: 'settled' }; // scelta presa: niente auto-escalation
    return this.setTabProxy(tabId, country);
  }

  // L'utente ha rifiutato/chiuso la proposta: non riproporla per questo dominio
  // nel tab (simmetrico al dismiss del banner "sospetto").
  geoProposeDismiss(tabId, url) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false, error: 'no_tab' };
    this._geoState(tab);
    let host = '';
    try { host = url ? new URL(url).hostname : (tab.geoBlock ? tab.geoBlock.host : ''); } catch (_) {}
    if (host) tab.geoDismissed.add(host);
    tab.geoRetry = { host, stage: 'settled' };
    return { ok: true };
  }

  // Campiona titolo + testo visibile della pagina e applica i pattern espliciti
  // noti (geoBlock.js). Best-effort: mai bloccante, ricontrolla che la tab non
  // abbia navigato altrove nel frattempo.
  _geoTextCheck(tab) {
    const wc = tab.view && tab.view.webContents;
    if (!wc || (wc.isDestroyed && wc.isDestroyed())) return;
    let url = '';
    try { url = wc.getURL() || ''; } catch (_) { return; }
    if (!/^https?:\/\//i.test(url)) return;
    if (tab.geoBlock && tab.geoBlock.url === url) return; // già rilevato
    try {
      wc.executeJavaScript(
        '(function(){try{return document.title+"\\n"+(((document.body&&document.body.innerText)||"").slice(0,3000));}catch(e){return "";}})()',
        true,
      ).then((txt) => {
        if (typeof txt !== 'string') return;
        const hit = GeoBlock.matchText(txt);
        let current = '';
        try { current = wc.getURL() || ''; } catch (_) { return; }
        if (current !== url) return; // nel frattempo ha navigato altrove
        if (hit) { this._geoBlockDetected(tab, url, GeoBlock.SOURCES.TEXT, hit); return; }
        // Niente pattern deterministico: passa la coda ambigua al livello 2
        // (classificatore LLM). Best-effort, mai bloccante.
        this._geoLevel2Check(tab, url, txt);
      }).catch(() => {});
    } catch (_) {}
  }

  // Livello 2 del rilevamento geo-block (proxy-per-tab-spec.md §4): per i casi
  // che i pattern deterministici non risolvono (403, pagina sostanzialmente
  // vuota, "non disponibile" generico) chiede al classificatore LLM cosa sia
  // il blocco. Il gate (shouldClassify) evita la chiamata sui casi non ambigui,
  // quindi nella stragrande maggioranza delle pagine NON si chiama il modello.
  // Solo `geo_block` emette il segnale (con SOURCES.LLM); le altre classi
  // (paywall/login_wall/bot_block/errore_generico) non attivano nulla.
  _geoLevel2Check(tab, url, text) {
    const classify = globalThis.SN_GEO_CLASSIFY;
    if (typeof classify !== 'function') return;
    if (tab.geoBlock) return; // già rilevato (livello 1)
    let host = '';
    try { host = new URL(url).hostname; } catch (_) { return; }
    const input = { title: tab.title || '', text, statusCode: tab._lastStatus || 0, host, url };
    Promise.resolve()
      .then(() => classify(input))
      .then((res) => {
        if (!res || res.skipped) return;
        if (!res.route || !res.route.proxy) return; // solo geo_block agisce
        const wc = tab.view && tab.view.webContents;
        if (!wc || (wc.isDestroyed && wc.isDestroyed())) return;
        let current = '';
        try { current = wc.getURL() || ''; } catch (_) { return; }
        if (current !== url) return; // nel frattempo ha navigato altrove
        if (tab.geoBlock) return; // livello 1 nel frattempo ha vinto
        this._geoBlockDetected(tab, url, GeoBlock.SOURCES.LLM, res.class);
      })
      .catch(() => {});
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
