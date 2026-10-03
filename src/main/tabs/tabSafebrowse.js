// Rilevamento siti pericolosi per scheda (mixin di TabManager): verdetto, bypass e chiusura per (scheda, dominio).
// L'avviso lo disegna la vista sopra la scheda (src/main/avvisoSito.js), mai la pagina; il content script manda indizi.
// Niente blocca la navigazione. Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

const { pageHints } = require('../../content/safebrowseHints.js');

const safebrowseMethods = {
  _sbState(tab) {
    if (!tab.sbBypass) tab.sbBypass = new Set();      // domini confermati su "pericoloso"
    if (!tab.sbDismissed) tab.sbDismissed = new Set(); // banner "sospetto" già chiuso
    return tab;
  },

  // Abbassa il verdetto a "safe" se l'utente ha già confermato/chiuso l'avviso
  // per questo dominio in questo tab.
  _sbApplyState(tab, verdict) {
    if (!verdict || verdict.level === 'safe') return verdict;
    const reg = verdict.scope || (verdict.norm && verdict.norm.registrable);
    if (!reg) return verdict;
    this._sbState(tab);
    if (verdict.level === 'pericoloso' && tab.sbBypass.has(reg)) {
      return { ...verdict, level: 'safe', message: null };
    }
    if (verdict.level === 'sospetto' && tab.sbDismissed.has(reg)) {
      return { ...verdict, level: 'safe', message: null };
    }
    return verdict;
  },

  // Un verdetto arrivato in ritardo per un sito da cui la scheda è già andata via non vale più.
  _sbMostra(tab, url, verdict) {
    const wc = tab && tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (url && !stessoSito(url, wc.getURL())) return;
    const level = verdict ? (verdict.level || 'safe') : 'safe';
    // È anche l'input «sito flaggato» delle regole geo-block (#151), che non devono aggirare i controlli di sicurezza.
    tab.sbLevel = level;
    const prima = JSON.stringify(tab.sbAvviso || null);
    tab.sbAvviso = (level === 'pericoloso' || level === 'sospetto')
      ? { level, message: verdict.message || null, url: url || wc.getURL() } : null;
    if (tab.id === this.activeId && JSON.stringify(tab.sbAvviso) !== prima) this.layout();
  },

  // Una scheda con l'avviso non riceve tasti, nemmeno nascosta sotto un menu della barra. Se il fuoco torna a lei, o a
  // una scheda dietro (una pagina che chiama focus() mentre carica), mentre l'avviso è a schermo, torna all'avviso.
  _sbGuardiaTastiera(tab, wc) {
    wc.on('before-input-event', (event, input) => {
      if (event.daAvvisoSito || !tab.sbAvviso || tab.view.webContents !== wc) return;
      event.preventDefault();
      if (input.type === 'keyDown' && this.avvisoSito.coperta() === tab) this.avvisoSito.prendiTastiera();
    });
    wc.on('focus', () => setTimeout(() => {
      const coperta = this.avvisoSito && this.avvisoSito.coperta();
      if (!coperta || tab.view.webContents !== wc) return;
      if (coperta === tab || tab.id !== this.activeId) this.avvisoSito.prendiTastiera();
    }, 0));
  },

  // Chiesto dal content script (SAFEBROWSE_GET) all'apertura del documento e quando compaiono campi sensibili: il
  // verdetto sincrono si mostra subito, quello dei segnali di rete quando arriva.
  safebrowseGet(tabId, url, ctx = {}) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!SB || !tab) return { ok: true, level: 'safe', message: null };
    url = sitoDellaPagina(url, [tab._urlNavigato, tab._sbApertaDa]);
    if (!url) return { ok: true, level: 'safe', message: null };
    let verdict;
    try {
      verdict = SB.analyze(url, { ...ctx, budgetUrl: tab._urlNavigato }, (next) => {
        this._sbMostra(tab, url, this._sbApplyState(tab, next));
      });
    } catch (_) {
      return { ok: true, level: 'safe', message: null };
    }
    const applied = this._sbApplyState(tab, verdict);
    this._sbMostra(tab, url, applied);
    return {
      ok: true,
      level: applied.level,
      message: applied.message || null,
      registrable: applied.norm ? applied.norm.registrable : null,
    };
  },

  // did-navigate: ricontrolla l'URL FINALE (dopo i redirect). Una pagina che non è un sito (filo://, about:blank)
  // toglie l'avviso del documento di prima.
  _sbOnNavigate(tab, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    if (!tab || !url) return;
    const sito = sitoDellaPagina(url, [tab._urlNavigato, tab._sbApertaDa]);
    if (!sito) { this._sbMostra(tab, null, null); return; }
    if (!SB) return;
    // L'indirizzo da cui la pagina è arrivata davvero: quello che si scrive dopo non sposta il conto (#591), qui e nel
    // blocco geografico.
    tab._urlNavigato = sito;
    try {
      const verdict = SB.analyze(sito, {}, (next) => {
        this._sbMostra(tab, sito, this._sbApplyState(tab, next));
      });
      this._sbMostra(tab, sito, this._sbApplyState(tab, verdict));
    } catch (_) {}
  },

  // Una finestrella di accesso non ha l'avviso: se ci si apre un sito da avviso, torna in una scheda, dove l'avviso c'è.
  // Il sito è quello che ne scrive il documento (l'origine, anche di una pagina vuota scritta da chi l'ha aperta), e
  // vale quanto la scheda che l'ha aperta: quando lei riceve l'avviso, la finestrella del suo sito la segue.
  // `origine`: la scheda che l'ha aperta, il cui «confermo» vale anche qui.
  _sbGuardaFinestrella(win, origine) {
    const SB = globalThis.SN_SAFEBROWSE;
    const pwc = win && win.webContents;
    if (!SB || !pwc) return;
    const note = () => [origine && origine._urlNavigato];
    const sitoOra = () => {
      if (pwc.isDestroyed()) return null;
      let o = null;
      try { o = pwc.mainFrame.origin; } catch (_) {}
      return sitoDellaPagina(pwc.getURL(), note(), o);
    };
    let spostata = false;
    const sposta = () => {
      if (spostata || win.isDestroyed() || pwc.isDestroyed()) return;
      spostata = true;
      // Una pagina vuota scritta dal sito non si ricarica in una scheda: ci va il sito, sotto il suo avviso.
      const url = /^(https?|blob):/i.test(pwc.getURL()) ? pwc.getURL() : sitoOra();
      if (url) {
        const id = this.openTab(url, { activate: true, openedByLink: true, apriComunque: this._siteAllowedIn(origine, url) });
        const nuova = this.tabs.find((t) => t.id === id);
        if (nuova && origine) nuova._sbApertaDa = origine._urlNavigato;
      }
      setImmediate(() => { try { win.close(); } catch (_) {} try { this.win.focus(); } catch (_) {} });
    };
    const segueLApritore = () => {
      const a = origine && origine.sbAvviso;
      const sito = a && sitoOra();
      if (sito && stessoSito(sito, a.url)) sposta();
    };
    if (origine) {
      if (!origine._sbFinestrelle) origine._sbFinestrelle = new Set();
      origine._sbFinestrelle.add(segueLApritore);
      win.once('closed', () => origine._sbFinestrelle.delete(segueLApritore));
    }
    // Il verdetto in ritardo vale finché la finestrella mostra lo stesso sito, anche con l'indirizzo cambiato sul posto.
    const giudica = (hints) => {
      const sito = sitoOra();
      if (!sito) return;
      segueLApritore();
      if (spostata) return;
      const decidi = (v) => {
        const a = origine ? this._sbApplyState(origine, v) : v;
        const ora = sitoOra();
        if (a && (a.level === 'pericoloso' || a.level === 'sospetto') && ora && stessoSito(sito, ora)) sposta();
      };
      try { decidi(SB.analyze(sito, hints, decidi)); } catch (_) {}
    };
    pwc.on('did-navigate', () => giudica({}));
    // Il sospetto che nasce dal campo password lo vede solo la pagina caricata.
    pwc.on('did-finish-load', async () => {
      let h = null;
      try { h = await pwc.executeJavaScript(`(${pageHints.toString()})(document)`); } catch (_) {}
      if (h && (h.hasPassword || h.hasPayment)) giudica({ hasPassword: !!h.hasPassword, hasPayment: !!h.hasPayment });
    });
  },

  // Sulle pagine ospitate il modulo sta spesso in un riquadro incorporato, che il content script della pagina non vede.
  // Solo lì si guardano i riquadri: altrove il dominio parla già per la pagina.
  _sbOnFrameLoad(tab, isMainFrame) {
    if (!tab) return;
    if (isMainFrame) tab._sbCampiUrl = null;
    clearTimeout(tab._sbFrameTimer);
    const giro = (tab._sbScanGiro || 0) + 1;
    tab._sbScanGiro = giro;
    tab._sbFrameTimer = setTimeout(() => this._sbScanFrames(tab, giro), 400);
  },

  // I campi compaiono quando vuole il codice dell'utente: dopo un «Avanti» che non ricarica, dopo un avvio lento.
  // Finché la pagina ospitata resta aperta la si riguarda, fino al primo campo sensibile.
  async _sbScanFrames(tab, giro) {
    const SB = globalThis.SN_SAFEBROWSE;
    const wc = tab.view && tab.view.webContents;
    if (!SB || !wc || wc.isDestroyed() || tab._sbScanGiro !== giro) return;
    const url = wc.getURL();
    let ospitata = null;
    try { const u = new URL(url); ospitata = SB.whitelist.hostedPlatform(u.hostname, u.pathname); } catch (_) {}
    if (!ospitata || tab._sbCampiUrl === url) return;
    const hints = { hasPassword: false, hasPayment: false, budgetUrl: tab._urlNavigato };
    const codice = `(${pageHints.toString()})(document)`;
    let frames = [];
    try { frames = wc.mainFrame.framesInSubtree; } catch (_) {}
    await Promise.all(frames.map(async (f) => {
      try {
        // Un riquadro ostile non deve tenere ferma l'analisi.
        const scade = new Promise((ok) => setTimeout(() => ok(null), 1000));
        const r = await Promise.race([f.executeJavaScript(codice), scade]);
        if (r && r.hasPassword) hints.hasPassword = true;
        if (r && r.hasPayment) hints.hasPayment = true;
      } catch (_) {}
    }));
    if (wc.isDestroyed() || tab._sbScanGiro !== giro) return;
    if ((hints.hasPassword || hints.hasPayment) && wc.getURL() === url) {
      tab._sbCampiUrl = url;
      try {
        const v = SB.analyze(url, hints, (next) => this._sbMostra(tab, url, this._sbApplyState(tab, next)));
        if (v && v.level !== 'safe') this._sbMostra(tab, url, this._sbApplyState(tab, v));
      } catch (_) {}
      return;
    }
    tab._sbFrameTimer = setTimeout(() => this._sbScanFrames(tab, giro), 1500);
  },

  // L'utente ha scritto "confermo" sull'avviso "pericoloso": bypass per (scheda, dominio), l'avviso va via.
  safebrowseProceed(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const key = SB && SB.scopeOf(url);
      if (key) tab.sbBypass.add(key);
    } catch (_) {}
    this._sbMostra(tab, url, { level: 'safe', message: null });
    return { ok: true };
  },

  // L'utente ha scelto «Continua» sul "sospetto": non riproporlo per questo dominio in questa scheda.
  safebrowseDismiss(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const key = SB && SB.scopeOf(url);
      if (key) tab.sbDismissed.add(key);
    } catch (_) {}
    this._sbMostra(tab, url, { level: 'safe', message: null });
    return { ok: true };
  },

  // «Torna indietro» non conferma mai il sito (#288): si torna alla pagina di prima, o si esce su una pagina vuota.
  safebrowseIndietro(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    const wc = tab.view.webContents;
    let puo = false;
    try { puo = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(); } catch (_) {}
    if (puo) this.goBack(tabId);
    else { try { wc.loadURL('about:blank'); } catch (_) {} }
    return { ok: true };
  },

  // Pulsanti e tasto destro dell'avviso. «Procedi» vale solo con «confermo» scritto (livello 3, actionLevels.js).
  _sbScelta(tab, scelta, dati = {}) {
    const a = tab && tab.sbAvviso;
    if (!a) return;
    if (scelta === 'procedi') {
      if (a.level === 'pericoloso' && String(dati.testo || '').trim().toLowerCase() === 'confermo') {
        this.safebrowseProceed(tab.id, a.url);
      }
    } else if (scelta === 'continua') {
      if (a.level === 'sospetto') this.safebrowseDismiss(tab.id, a.url);
    } else if (scelta === 'indietro') {
      this.safebrowseIndietro(tab.id);
    } else if (scelta === 'copia') {
      try { require('electron').clipboard.writeText(a.url); } catch (_) {}
    } else if (scelta === 'chiedi' || scelta === 'segnala') {
      this._sbApriCasa(tab, scelta);
    }
  },

  _sbVociMenu() {
    return [
      { label: 'Chiedi a Filo di questo sito', icon: 'help', action: 'avviso-sito:chiedi' },
      { label: 'Segnala un falso allarme', icon: 'feedback', action: 'avviso-sito:segnala' },
      { type: 'separator' },
      { label: 'Copia l\'indirizzo', icon: 'duplicate', action: 'avviso-sito:copia' },
      { label: 'Torna indietro', icon: 'back', action: 'avviso-sito:indietro' },
    ];
  },

  // Domanda e segnalazione si fanno in una scheda di Filo: la pagina sotto l'avviso non deve vedere né il pannello né
  // quello che ci si scrive. La home appena aperta se le prende con CASA_RICHIESTA, una volta sola.
  _sbApriCasa(tab, tipo) {
    const a = tab.sbAvviso;
    if (!a) return;
    const titolo = (a.message && a.message.title) || '';
    const corpo = (a.message && a.message.body) || '';
    const cosa = a.level === 'pericoloso' ? 'pericoloso' : 'sospetto';
    // Nella domanda va solo quello che Filo ha scritto da sé: il corpo può portare il giudizio di un modello sulla
    // pagina, che è testo di fuori e non entra nel messaggio dell'utente.
    const testo = tipo === 'chiedi'
      ? `Filo mi ha avvisato che questo sito è ${cosa}: ${a.url}${titolo ? ` («${titolo}»)` : ''}. `
        + 'È davvero da evitare? Cosa mi consigli di fare?'
      : `Falso allarme: Filo ha segnalato come ${cosa} ${a.url}${titolo ? `\nAvviso: ${titolo}` : ''}`
        + `${corpo ? `\n${corpo}` : ''}\nPerché non lo è: `;
    const id = this.openTab('filo://newtab/', { allowDuplicate: true });
    const nuova = this.tabs.find((t) => t.id === id);
    if (nuova) nuova._richiestaCasa = { tipo, testo };
  },

  richiestaCasa(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const r = (tab && tab._richiestaCasa) || null;
    if (tab) tab._richiestaCasa = null;
    return r;
  },
};

// Un documento blob: lo scrive la pagina che l'ha creato e vale quanto lei: la pagina web conosciuta della stessa
// origine (`note`: quella della scheda, o di chi l'ha aperta), altrimenti l'origine. Una pagina che non è un sito: null.
function sitoDellaPagina(url, note = []) {
  if (/^https?:\/\//i.test(url || '')) return url;
  if (!/^blob:/i.test(url || '')) return null;
  let origine = '';
  try { origine = new URL(url).origin; } catch (_) {}
  if (!/^https?:\/\//i.test(origine)) return null;
  for (const n of note) {
    try { if (n && new URL(n).origin === origine) return n; } catch (_) {}
  }
  return origine + '/';
}

function hostDi(u) {
  const x = new URL(u);
  return x.protocol === 'blob:' ? new URL(x.pathname).host : x.host;
}

function stessoSito(a, b) {
  try { return hostDi(a) === hostDi(b); } catch (_) { return true; }
}

// Installa i metodi sul prototype di TabManager (mixin). `this` resta l'istanza.
function installSafebrowse(TabManager) {
  Object.assign(TabManager.prototype, safebrowseMethods);
}

module.exports = { installSafebrowse };
