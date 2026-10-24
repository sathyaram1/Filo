// Rilevamento siti pericolosi per scheda (mixin di TabManager): verdetto, bypass e chiusura per (scheda, dominio).
// L'avviso lo disegna la vista sopra la scheda (src/main/avvisoSito.js), mai la pagina; il content script manda indizi.
// Niente blocca la navigazione. Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

const { pageHints } = require('../../content/safebrowseHints.js');
const Permessi = require('../services/permessiPagine');
const { riquadroArrivato } = require('../services/riquadroArrivato');
const ProxyTab = require('../services/proxyTab');

// Un programma che parte entro questo tempo dall'ultimo clic o tasto vero nella scheda (in qualunque riquadro, o sul link
// che l'ha aperta), anche dopo pagine di passaggio, è voluto. Oltre, o senza, è partito da solo (#814).
const SCARICO_VOLUTO_MS = 30 * 1000;
// Le origini delle pagine già viste nella scheda, per avanti, indietro e ricarica.
const ORIGINI_MAX = 100;

// Il puntatore che resta fermo su un link accorciato (#966), e quanto prima deve averlo portato lì un input vero.
const SOSTA_MS = 500;
const GESTO_MS = 1000;
// Solo il dito: scorrere e pizzicare arrivano anche dal touchpad.
const TOCCO = /^(touch|gesture(TapDown|ShowPress|Tap|TapCancel|ShortPress|LongPress|LongTap|TwoFingerTap|TapUnconfirmed|DoubleTap)$)/;
// Anche la pagina che l'utente fa scorrere (rotella, touchpad, tasti) porta un link sotto il puntatore fermo.
const SCORRE = /^(mouseWheel|gesture(Scroll|Fling|Pinch))/;
const TASTI_GESTO = new Set(['Tab', 'PageDown', 'PageUp', 'End', 'Home', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' ']);
const GRADI = { safe: 0, sospetto: 1, pericoloso: 2 };
const grado = (level) => GRADI[level] || 0;
// #965 — lotti di link in attesa per scheda (la pagina ne manda uno alla volta), e link da avviso tenuti pronti.
const LINK_IN_CODA = 4;
const LINK_SEGNALATI_MAX = 10000;
let avvisiDiLink = 0;
// Il mondo dei content script della pagina (src/content/safebrowseLinks.js).
const MONDO_SCRIPT = 999;

// In un riquadro di un altro sito la pagina sopra non si legge: se è lei a nasconderlo (trasparente, ritagliato,
// coperto) lo dice il motore, che vede tutta la catena dei riquadri. Senza risposta in tempo vale mostrato.
const CODICE_RIQUADRO = `(async () => {
  const mostrati = [];
  const h = (${pageHints.toString()})(document, { mostrati });
  let altroSito = false;
  try { altroSito = window !== window.top && !window.frameElement; } catch (_) { altroSito = true; }
  if (!altroSito || !mostrati.length || typeof IntersectionObserver !== 'function'
    || !('isVisible' in IntersectionObserverEntry.prototype)) return h;
  const visti = await new Promise((ok) => {
    const t = setTimeout(() => ok(null), 600);
    try {
      const io = new IntersectionObserver((es) => { clearTimeout(t); io.disconnect(); ok(new Set(es.filter((e) => e.isVisible).map((e) => e.target))); },
        { trackVisibility: true, delay: 100 });
      for (const m of mostrati) io.observe(m.el);
    } catch (_) { clearTimeout(t); ok(null); }
  });
  if (!visti) return h;
  const vale = (tipo) => mostrati.some((m) => m.tipo === tipo && visti.has(m.el));
  return { ...h, shownPassword: h.shownPassword && vale('pw'), shownPayment: h.shownPayment && vale('carta') };
})()`;

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

  // Un verdetto arrivato in ritardo per un sito da cui la scheda è già andata via non vale più. Quello della pagina che
  // risulta pulita non toglie l'avviso di un link cliccato da lei (`prima`, #965), che aspetta la scelta dell'utente.
  _sbMostra(tab, url, verdict) {
    const wc = tab && tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (url && !stessoSito(url, wc.getURL())) return;
    const level = verdict ? (verdict.level || 'safe') : 'safe';
    // È anche l'input «sito flaggato» delle regole geo-block (#151), che non devono aggirare i controlli di sicurezza.
    tab.sbLevel = level;
    const prima = JSON.stringify(tab.sbAvviso || null);
    const delLink = tab.sbAvviso && tab.sbAvviso.prima ? tab.sbAvviso : null;
    tab.sbAvviso = (level === 'pericoloso' || level === 'sospetto')
      ? { level, message: verdict.message || null, url: url || wc.getURL() } : delLink;
    if (tab.id === this.activeId && JSON.stringify(tab.sbAvviso) !== prima) this.layout();
    if (tab.sbAvviso && tab._sbFinestrelle) for (const segui of [...tab._sbFinestrelle]) { try { segui(); } catch (_) {} }
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

  // Ogni verifica di una pagina di questa finestra passa di qui: l'incognito spegne giudizio del modello e finestra
  // nascosta (#1081). Le pagine qui sono già aperte: niente `daAprire`.
  _sbAnalizza(url, ctx, onUpdate) {
    return globalThis.SN_SAFEBROWSE.analyze(url, { ...ctx, incognito: !!this.incognito }, onUpdate);
  },

  // Lo stesso per un link non ancora aperto: in incognito niente finestra nascosta, e da una scheda col proxy la
  // finestra esce dal suo proxy (#753.1).
  _sbPreverifica(url, pagina, ses) {
    return globalThis.SN_SAFEBROWSE.preverifica(url, { pagina, incognito: !!this.incognito, rete: ProxyTab.reteDellaSessione(ses) });
  },

  // Il puntatore fermo mezzo secondo su un link accorciato o di rimando ne prepara il verdetto prima del clic (#966).
  // Il link sotto il puntatore e un input vero (mouse, scorrimento, Tab) vicini nel tempo, in qualunque ordine: una
  // pagina che cambia il link sotto un mouse fermo non fa partire niente, e col dito resta il controllo all'apertura.
  _sbSeguiPuntatore(tab, wc) {
    let timer = null;
    let gestoAlle = 0;
    let dito = false;
    // `sotto`: l'accorciato sotto il puntatore, anche se arrivato senza gesto; `armato`: quello per cui la sosta è partita.
    let sotto = '';
    let armato = '';
    const ferma = () => { clearTimeout(timer); timer = null; };
    const arma = () => {
      if (!sotto || sotto === armato || dito || Date.now() - gestoAlle > GESTO_MS) return;
      ferma();
      const url = armato = sotto;
      timer = setTimeout(() => {
        timer = null;
        if (wc.isDestroyed()) return;
        try { this._sbPreverifica(url, wc.getURL(), wc.session); } catch (_) {}
      }, SOSTA_MS);
    };
    wc.on('input-event', (_e, input) => {
      const t = (input && input.type) || '';
      if (TOCCO.test(t)) { dito = true; ferma(); return; }
      if (t === 'mouseDown') { dito = false; ferma(); return; }
      if (t === 'mouseMove') dito = false;
      else if (!SCORRE.test(t) && !(t === 'rawKeyDown' && TASTI_GESTO.has(input.key))) return;
      gestoAlle = Date.now();
      arma();
    });
    wc.on('update-target-url', (_e, url) => {
      ferma();
      const SB = globalThis.SN_SAFEBROWSE;
      sotto = url && SB && SB.tipoLink(url) ? url : '';
      armato = '';
      arma();
    });
    // Il link da cui parte una navigazione: il suo verdetto vale per la pagina dove arriva (vedi _sbConLink).
    const segna = (url, principale, redirect) => {
      if (principale === false) return;
      const SB = globalThis.SN_SAFEBROWSE;
      const voce = SB && url ? SB.preverdetto(url) : null;
      if (!redirect) tab._sbLinkInArrivo = null;
      if (!voce || tab._sbLinkInArrivo) return;
      tab._sbLinkInArrivo = url;
      // Il controllo ancora in corso al clic: il suo verdetto raggiunge la pagina appena arriva.
      if (!voce.finito) voce.pronto.then(() => this._sbLinkPronto(tab, url)).catch(() => {});
    };
    wc.on('did-start-navigation', (_e, url, inPagina, principale) => {
      if (principale === false || inPagina) return;
      ferma();
      sotto = '';
      segna(url, principale, false);
    });
    wc.on('did-redirect-navigation', (_e, url, _inPagina, principale) => segna(url, principale, true));
    wc.once('destroyed', ferma);
  },

  // Il verdetto della pagina, o quello del link accorciato che l'ha portata qui se è più grave: la destinazione può
  // sembrare pulita mentre il link, o un suo passaggio, è in lista. La conferma vale per il sito della pagina.
  _sbConLink(tab, url, verdict) {
    const SB = globalThis.SN_SAFEBROWSE;
    const voce = tab._sbLink && SB ? SB.preverdetto(tab._sbLink) : null;
    const v = voce && voce.verdetto;
    if (!v || grado(v.level) <= grado(verdict && verdict.level)) return verdict;
    return { ...v, norm: verdict ? verdict.norm : null, scope: SB.scopeOf(url) };
  },

  _sbDellaScheda(tab, url, verdict) {
    return this._sbApplyState(tab, this._sbConLink(tab, url, verdict));
  },

  // Arriva solo ad alzare l'avviso: quello a schermo può venire da indizi della pagina che qui non si rivedono.
  _sbLinkPronto(tab, link) {
    const wc = tab.view && tab.view.webContents;
    if (tab._sbLink !== link || !wc || wc.isDestroyed()) return;
    const url = tab._urlNavigato;
    const v = url && this._sbConLink(tab, url, { level: 'safe' });
    if (v && grado(v.level) > grado(tab.sbLevel)) this._sbMostra(tab, url, this._sbApplyState(tab, v));
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
      verdict = this._sbAnalizza(url, this._sbCtx(tab, url, ctx), (next) => {
        this._sbMostra(tab, url, this._sbDellaScheda(tab, url, next));
      });
    } catch (_) {
      return { ok: true, level: 'safe', message: null };
    }
    const applied = this._sbDellaScheda(tab, url, verdict);
    this._sbMostra(tab, url, applied);
    return {
      ok: true,
      level: applied.level,
      message: applied.message || null,
      registrable: applied.norm ? applied.norm.registrable : null,
    };
  },

  // #965 — I link che la pagina mostra, ai soli controlli locali appena arrivano: un lotto alla volta per scheda, a
  // fette, così migliaia di link non fermano Filo. Restano quelli da avviso, pronti per il clic, del documento che li ha
  // mandati. Una pagina che riempisse la coda o la memoria non toglie niente: al clic il link si giudica comunque.
  safebrowseLinks(tabId, urls) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!SB || !tab || !Array.isArray(urls)) return Promise.resolve({ ok: false });
    if ((tab._sbLinkInCoda || 0) >= LINK_IN_CODA) return Promise.resolve({ ok: false, error: 'occupato' });
    tab._sbLinkInCoda = (tab._sbLinkInCoda || 0) + 1;
    const giro = tab._sbLinkGiro || 0;
    const wc = tab.view && tab.view.webContents;
    const vivo = () => giro === (tab._sbLinkGiro || 0) && this.tabs.includes(tab) && !!wc && !wc.isDestroyed()
      && tab.view.webContents === wc;
    const esame = (tab._sbLinkCoda || Promise.resolve()).then(async () => {
      const r = await SB.checkLinks(urls, { vivo });
      if (!vivo()) return { ok: true, esaminati: 0 };
      if (!tab._sbLinkSegnalati) tab._sbLinkSegnalati = new Map();
      for (const s of r.segnalati) {
        tab._sbLinkSegnalati.delete(s.url);
        tab._sbLinkSegnalati.set(s.url, s);
        if (tab._sbLinkSegnalati.size > LINK_SEGNALATI_MAX) tab._sbLinkSegnalati.delete(tab._sbLinkSegnalati.keys().next().value);
      }
      return { ok: true, esaminati: r.esaminati };
    }).catch(() => ({ ok: false })).finally(() => { tab._sbLinkInCoda -= 1; });
    tab._sbLinkCoda = esame;
    return esame;
  },

  // Il verdetto di un link al clic: quello pronto dall'esame, o lo stesso esame adesso per un link nato dopo (o un
  // indirizzo scritto da uno script). Vale quello che l'utente ha già confermato o chiuso in questa scheda.
  // `nome`: il nome con cui arriva un file scaricato, che conta come il suo indirizzo.
  _sbVerdettoLink(tab, url, nome = '') {
    const SB = globalThis.SN_SAFEBROWSE;
    if (!SB || typeof SB.checkLink !== 'function') return null;
    let v = (tab._sbLinkSegnalati && tab._sbLinkSegnalati.get(url)) || null;
    if (!v) { try { v = SB.checkLink(url, nome); } catch (_) { v = null; } }
    if (!v) return null;
    const a = this._sbApplyState(tab, v);
    return a && (a.level === 'pericoloso' || a.level === 'sospetto') ? a : null;
  },

  // #965 — Un link da avviso non si apre prima dell'avviso: compare sulla pagina da cui parte, e «Procedi» o «Continua»
  // fanno l'apertura che era stata chiesta (`apri(segna)`, che segna la conferma sulla scheda dove il sito si apre).
  // Dalle pagine web; da una pagina di Filo solo un collegamento che Filo apre per lei (`daFilo`), mai il suo indirizzo. L'avviso
  // della pagina stessa, se c'è, resta il suo. `nome`: vedi _sbVerdettoLink.
  _sbPrimaDelClic(tab, url, apri, { nome = '', daFilo = false } = {}) {
    if (!tab || (tab.isInternal !== false && !daFilo) || !/^https?:\/\//i.test(String(url || ''))) return false;
    if (tab.sbAvviso && !tab.sbAvviso.prima) return false;
    const v = this._sbVerdettoLink(tab, url, nome);
    if (!v) return false;
    // Ogni clic è un avviso nuovo, da ridisegnare da capo (conferma vuota, «Continua» da riarmare); lo stesso link
    // chiesto di nuovo mentre è a schermo no.
    const a = tab.sbAvviso;
    const n = a && a.prima && a.url === String(url) && a.level === v.level ? a.prima.n : ++avvisiDiLink;
    tab.sbAvviso = { level: v.level, message: v.message || null, url: String(url), prima: { apri, n } };
    if (tab.id === this.activeId) this.layout();
    return true;
  },

  // Il clic su un link «scarica» (attributo download), chiesto dal preload prima che lo scaricamento parta: vero se
  // l'avviso lo ferma. Confermato, il link si riclicca nella pagina, che dà al file il suo nome.
  _sbScaricamentoScelto(tab, url, nome) {
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    return this._sbPrimaDelClic(tab, url, (segna) => {
      segna(tab);
      this._sbRifaiDallaPagina(tab, 'SN_RISCARICA', url, () => { try { if (!wc.isDestroyed()) wc.downloadURL(url); } catch (_) {} });
    }, { nome });
  },

  // Uno scaricamento partito senza passare di lì (uno script, un nome dato dal sito): si giudica l'indirizzo cliccato
  // col nome del file, e confermato riparte. Vero se l'avviso l'ha fermato. Un file che la pagina costruisce da sé
  // (blob:, data:, come gli allegati delle chat) non ha un indirizzo suo: vale il sito della pagina col nome del file,
  // e confermato la pagina lo riscarica con quel nome.
  _sbScaricamento(tab, item) {
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    let url = '';
    try { const c = item.getURLChain(); url = (Array.isArray(c) && c[0]) || item.getURL(); } catch (_) { url = ''; }
    let nome = '';
    try { nome = item.getFilename() || ''; } catch (_) {}
    const costruito = /^(blob|data|filesystem):/i.test(url);
    let giudicato = url;
    if (costruito) {
      let pagina = '';
      try { pagina = wc.getURL(); } catch (_) {}
      giudicato = (/^blob:/i.test(url) && sitoDellaPagina(url, [tab._urlNavigato])) || sitoDellaPagina(pagina, [tab._urlNavigato]) || '';
    }
    return this._sbPrimaDelClic(tab, giudicato, (segna) => {
      segna(tab);
      const scarica = () => { try { if (!wc.isDestroyed()) wc.downloadURL(url); } catch (_) {} };
      if (costruito) this._sbRifaiDallaPagina(tab, 'SN_RISCARICA', url, scarica, nome);
      else scarica();
    }, { nome });
  },

  // Un gesto della pagina fermato dall'avviso e confermato si rifà dalla pagina, uguale: l'invio di un modulo coi suoi
  // dati (SN_RIFAI_INVIO), il link «scarica» col nome del suo file (SN_RISCARICA), che l'indirizzo da solo perderebbe.
  // Se la pagina non ha più il gesto da rifare, `altrimenti`. Chi li tiene: il preload e src/content/safebrowseLinks.js.
  _sbRifaiDallaPagina(tab, funzione, url, altrimenti, nome = '') {
    const wc = tab.view && tab.view.webContents;
    const code = `(() => { const f = globalThis.${funzione}; return typeof f === 'function' ? f(${JSON.stringify(String(url))}, ${JSON.stringify(String(nome))}) : false; })()`;
    let p = null;
    try { p = wc && !wc.isDestroyed() ? wc.executeJavaScriptInIsolatedWorld(MONDO_SCRIPT, [{ code }]) : null; } catch (_) { p = null; }
    Promise.resolve(p).then((fatto) => { if (fatto !== true) altrimenti(); }, () => altrimenti());
  },

  // Le scelte sull'avviso di un link non ancora aperto: «Non aprire» lo toglie e basta, la conferma apre.
  _sbSceltaPrima(tab, a, scelta, dati) {
    const via = () => {
      if (tab.sbAvviso !== a) return;
      tab.sbAvviso = null;
      if (tab.id === this.activeId) this.layout();
    };
    const procedi = scelta === 'procedi' && a.level === 'pericoloso' && String(dati.testo || '').trim().toLowerCase() === 'confermo';
    const continua = scelta === 'continua' && a.level === 'sospetto';
    if (procedi || continua) {
      via();
      let chiave = null;
      try { chiave = globalThis.SN_SAFEBROWSE.scopeOf(a.url); } catch (_) {}
      const segna = (t) => {
        if (!t || !chiave) return;
        this._sbState(t);
        (procedi ? t.sbBypass : t.sbDismissed).add(chiave);
      };
      try { a.prima.apri(segna); } catch (_) {}
    } else if (scelta === 'indietro') {
      via();
      // Una scheda che è diventata subito un file fermato dall'avviso non ha una pagina da mostrare (#814).
      if (!tab._everNavigated && tab.isInternal === false) this._dropTab(tab);
    }
  },

  // did-navigate: ricontrolla l'URL FINALE (dopo i redirect). Una pagina che non è un sito (filo://, about:blank)
  // toglie l'avviso del documento di prima.
  _sbOnNavigate(tab, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    if (!tab || !url) return;
    tab._sbLink = tab._sbLinkInArrivo || null;
    tab._sbLinkInArrivo = null;
    // I link esaminati e l'avviso di un link cliccato erano del documento di prima.
    tab._sbLinkGiro = (tab._sbLinkGiro || 0) + 1;
    tab._sbLinkSegnalati = null;
    if (tab.sbAvviso && tab.sbAvviso.prima) {
      tab.sbAvviso = null;
      if (tab.id === this.activeId) this.layout();
    }
    const sito = sitoDellaPagina(url, [tab._urlNavigato, tab._sbApertaDa]);
    this._sbNuovoDocumento(tab, sito);
    if (!sito) { this._sbMostra(tab, null, null); return; }
    if (!SB) return;
    // L'indirizzo da cui la pagina è arrivata davvero: quello che si scrive dopo non sposta il conto (#591), qui e nel
    // blocco geografico.
    tab._urlNavigato = sito;
    try {
      const verdict = this._sbAnalizza(sito, this._sbCtx(tab, sito, {}), (next) => {
        this._sbMostra(tab, sito, this._sbDellaScheda(tab, sito, next));
      });
      this._sbMostra(tab, sito, this._sbDellaScheda(tab, sito, verdict));
    } catch (_) {}
  },

  // Gli indizi del documento (campi, modulo in chiaro, scaricamenti, origine) si sommano a quelli di chi chiede: qualunque
  // porta rifaccia il verdetto, li vede tutti, e un verdetto rifatto senza un indizio non toglie l'avviso che ne viene.
  _sbCtx(tab, url, ctx = {}) {
    const out = { ...ctx, budgetUrl: tab._urlNavigato };
    const doc = tab._sbDoc;
    if (!doc || !doc.url || !stessoSito(url, doc.url)) return out;
    const i = doc.indizi;
    for (const k of ['hasPassword', 'hasPayment', 'insecureForm']) {
      if (ctx[k]) i[k] = true;
      out[k] = !!i[k];
    }
    if (i.autoDownload) out.autoDownload = i.autoDownload;
    if (i.downloadName) out.downloadName = i.downloadName;
    const SB = globalThis.SN_SAFEBROWSE;
    const origine = SB && SB.origineLink(doc.origine, url);
    if (origine) out.linkOrigin = origine;
    return out;
  },

  // Ogni navigazione della pagina intera: da dove parte e se l'ha chiesta un clic. Le aperture di Filo (indirizzo
  // scritto, link da un'altra scheda, pagine sue) lasciano l'origine in `tab._sbOrigine` prima di caricare.
  _sbInizioNavigazione(tab, wc, details) {
    if (!details || details.isMainFrame === false || details.isSameDocument) return;
    let da = '';
    try { da = String((details.initiator && details.initiator.url) || ''); } catch (_) {}
    let origine = null;
    const pre = tab._sbOrigine;
    if (/^https?:/i.test(da)) {
      origine = { tipo: 'link', da, gesto: gestoSulDocumento(tab, wc) || Permessi.navigazioneDaGesto(wc) };
      // La finestra che la pagina tiene e carica da sé (tabs.js, `adotta`) resta della scheda che l'ha aperta, col suo clic.
      if (pre && pre.tipo === 'link' && pre.daScheda) { origine.daScheda = pre.daScheda; origine.gesto = origine.gesto || !!pre.gesto; }
    }
    else if (/^filo:/i.test(da)) origine = { tipo: 'filo' };
    else if (!da) origine = tab._sbOrigine || (tab._sbOrigini && tab._sbOrigini.get(details.url)) || null;
    tab._sbOrigine = null;
    tab._sbGestoDoc = 0;
    const gesto = !!(origine && origine.gesto);
    if (gesto) tab._sbGestoAlle = Date.now();
    tab._sbNav = { url: details.url, at: Date.now(), daPagina: !!da, gesto, origine };
  },

  // Un clic o un tasto vero in un frame della scheda (dal preload: anche nei riquadri di altri siti, che `input-event`
  // non vede). È l'unica sorgente del «voluto» degli scaricamenti, oltre al gesto che ha aperto la scheda.
  _sbGesto(wc) {
    const tab = this.tabs.find((t) => { try { return t.view.webContents === wc; } catch (_) { return false; } });
    if (tab) tab._sbGestoAlle = tab._sbGestoDoc = Date.now();
  },

  // Una scheda che ricrea la vista per un link (pagina di Filo → sito, privacy fra siti) carica da sé: l'origine la porta qui.
  _sbOrigineDelSalto(tab, wc, event) {
    let da = '';
    try { da = String((event && event.initiator && event.initiator.url) || wc.getURL() || ''); } catch (_) {}
    if (/^https?:/i.test(da)) tab._sbOrigine = { tipo: 'link', da, gesto: gestoSulDocumento(tab, wc) };
    else if (/^filo:/i.test(da)) tab._sbOrigine = { tipo: 'filo' };
  },

  _sbNuovoDocumento(tab, sito) {
    const nav = tab._sbNav;
    const origine = nav ? nav.origine : null;
    tab._sbDoc = { url: sito, at: Date.now(), origine, indizi: {} };
    if (!sito || !origine) return;
    if (!tab._sbOrigini) tab._sbOrigini = new Map();
    tab._sbOrigini.delete(sito);
    tab._sbOrigini.set(sito, origine);
    if (tab._sbOrigini.size > ORIGINI_MAX) tab._sbOrigini.delete(tab._sbOrigini.keys().next().value);
  },

  // Uno scaricamento partito dalla pagina della scheda: un programma senza un clic poco prima, o un file col nome di un
  // documento, diventano indizi della pagina. La domanda sui programmi (#588) resta quella di services/downloads.js.
  _sbOnDownload(tab, info = {}) {
    const SB = globalThis.SN_SAFEBROWSE;
    const wc = tab && tab.view && tab.view.webContents;
    const doc = tab && tab._sbDoc;
    if (!SB || !wc || wc.isDestroyed()) return;
    if (!doc || !doc.url) {
      // Una scheda aperta dalla pagina che diventa subito un file: lo scaricamento è della pagina che l'ha aperta.
      const o = !doc && tab._sbNav && tab._sbNav.origine;
      const apritrice = o && o.tipo === 'link' && o.daScheda && this.tabs.find((t) => t.id === o.daScheda && t !== tab);
      if (apritrice) this._sbOnDownload(apritrice, { ...info, chain: [], voluto: !!o.gesto });
      else this._sbFileAperto(tab, info);
      return;
    }
    const sito = sitoDellaPagina(wc.getURL(), [tab._urlNavigato, tab._sbApertaDa]);
    if (!sito || !stessoSito(sito, doc.url)) return;
    const nome = String(info.filename || '');
    const nav = tab._sbNav;
    const primo = String((Array.isArray(info.chain) && info.chain[0]) || info.url || '');
    const suaNav = !!(nav && nav.at >= doc.at && stessoIndirizzo(nav.url, primo));
    // Un indirizzo che Filo ha caricato nella scheda e che è diventato un file non l'ha chiesto la pagina.
    if (suaNav && !nav.daPagina) { this._sbFileAperto(tab, info); return; }
    // Lo scaricamento che è la navigazione stessa di un clic resta voluto anche se il server ci mette più del tempo.
    const voluto = info.voluto || (suaNav && nav.gesto) || Permessi.gestoEntro(wc, SCARICO_VOLUTO_MS)
      || (tab._sbGestoAlle > 0 && Date.now() - tab._sbGestoAlle < SCARICO_VOLUTO_MS);
    const i = doc.indizi;
    let nuovo = false;
    if (info.exe && !voluto && !i.autoDownload) { i.autoDownload = nome || true; nuovo = true; }
    if (!i.downloadName && SB.signals.doppiaEstensione(nome)) { i.downloadName = nome; nuovo = true; }
    if (!nuovo) return;
    try {
      const v = this._sbAnalizza(sito, this._sbCtx(tab, sito, {}), (next) => this._sbMostra(tab, sito, this._sbDellaScheda(tab, sito, next)));
      this._sbMostra(tab, sito, this._sbDellaScheda(tab, sito, v));
    } catch (_) {}
  },

  // Un indirizzo aperto da Filo (scritto, dalla chat, chiesto a parole) che è un programma col nome di un documento: non
  // c'è una pagina, l'avviso va sulla scheda, che resta aperta finché lo mostra. Il giudizio è sul sito che manda il file.
  _sbFileAperto(tab, info = {}) {
    const SB = globalThis.SN_SAFEBROWSE;
    const chain = Array.isArray(info.chain) ? info.chain.filter(Boolean).map(String) : [];
    const url = chain.length ? chain[chain.length - 1] : String(info.url || '');
    if (!SB || !/^https?:\/\//i.test(url)) return;
    const nome = String(info.filename || '');
    const nell = [url, chain[0] || ''].map(ultimoPezzo).find((n) => SB.signals.doppiaEstensione(n));
    if (!SB.signals.doppiaEstensione(nome) && !nell) return;
    const ctx = { downloadName: SB.signals.doppiaEstensione(nome) ? nome : nell, budgetUrl: url };
    const origine = SB.origineLink(tab._sbNav && tab._sbNav.origine, url);
    if (origine) ctx.linkOrigin = origine;
    try {
      const v = this._sbAnalizza(url, ctx, (next) => this._sbMostra(tab, url, this._sbApplyState(tab, next)));
      this._sbMostra(tab, url, this._sbApplyState(tab, v));
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
        // Per il giudizio sui siti la pagina arriva dal sito della scheda che ha aperto la finestrella, non da Filo.
        const da = origine && origine._urlNavigato ? { tipo: 'link', da: origine._urlNavigato, gesto: false } : null;
        const id = this.openTab(url, { activate: true, openedByLink: true, apriComunque: this._siteAllowedIn(origine, url), origine: da });
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
      try { decidi(this._sbAnalizza(sito, hints, decidi)); } catch (_) {}
    };
    pwc.on('did-navigate', () => giudica({}));
    // Il sospetto che nasce dal campo password lo vede solo la pagina caricata.
    pwc.on('did-finish-load', async () => {
      let h = null;
      try { h = await pwc.executeJavaScript(`(${pageHints.toString()})(document)`); } catch (_) {}
      if (h && (h.shownPassword || h.shownPayment)) giudica({ hasPassword: !!h.shownPassword, hasPayment: !!h.shownPayment, insecureForm: !!h.insecureForm });
    });
  },

  // Il modulo sta spesso in un riquadro incorporato, che il content script della pagina non vede, o arriva dopo il
  // caricamento: i riquadri si guardano dove un campo sensibile conta (vedi _sbScanFrames), altrove il dominio basta.
  _sbOnFrameLoad(tab, isMainFrame) {
    if (!tab) return;
    if (isMainFrame) tab._sbCampiUrl = null;
    clearTimeout(tab._sbFrameTimer);
    const giro = (tab._sbScanGiro || 0) + 1;
    tab._sbScanGiro = giro;
    tab._sbFrameTimer = setTimeout(() => this._sbScanFrames(tab, giro), 400);
  },

  // I campi compaiono quando vuole il codice dell'utente: dopo un «Avanti» che non ricarica, dopo un avvio lento.
  // Finché la pagina resta aperta la si riguarda, fino al primo campo sensibile: sulle pagine ospitate, e dove un
  // campo sensibile porterebbe al blocco (un sosia di un brand corto blocca solo se chiede la password, #728).
  async _sbScanFrames(tab, giro) {
    const SB = globalThis.SN_SAFEBROWSE;
    const wc = tab.view && tab.view.webContents;
    if (!SB || !wc || wc.isDestroyed() || tab._sbScanGiro !== giro) return;
    const url = wc.getURL();
    let ospitata = null;
    try { const u = new URL(url); ospitata = SB.whitelist.hostedPlatform(u.hostname, u.pathname); } catch (_) {}
    if (tab._sbCampiUrl === url || !(ospitata || this._sbCampiContano(SB, url))) return;
    const hints = { hasPassword: false, hasPayment: false, insecureForm: false, budgetUrl: tab._urlNavigato };
    let frames = [];
    try { frames = wc.mainFrame.framesInSubtree.filter(riquadroArrivato); } catch (_) {}
    await Promise.all(frames.map(async (f) => {
      try {
        // Un riquadro ostile non deve tenere ferma l'analisi.
        const scade = new Promise((ok) => setTimeout(() => ok(null), 1000));
        const r = await Promise.race([f.executeJavaScript(CODICE_RIQUADRO), scade]);
        // Conta il campo a schermo: un modulo nascosto dietro «Accedi» si vedrà al giro dopo, quando si apre.
        if (r && r.shownPassword) hints.hasPassword = true;
        if (r && r.shownPayment) hints.hasPayment = true;
        if (r && r.insecureForm) hints.insecureForm = true;
      } catch (_) {}
    }));
    if (wc.isDestroyed() || tab._sbScanGiro !== giro) return;
    tab._sbScanConta = (tab._sbScanConta || 0) + 1;
    if (!hints.hasPassword && !hints.hasPayment && tab._sbScanConta % 2 === 1) {
      const c = await this._sbCampiChiusi(wc);
      if (wc.isDestroyed() || tab._sbScanGiro !== giro) return;
      if (c.shownPassword) hints.hasPassword = true;
      if (c.shownPayment) hints.hasPayment = true;
    }
    if ((hints.hasPassword || hints.hasPayment) && wc.getURL() === url) {
      tab._sbCampiUrl = url;
      try {
        const v = this._sbAnalizza(url, this._sbCtx(tab, url, hints), (next) => this._sbMostra(tab, url, this._sbDellaScheda(tab, url, next)));
        if (v && v.level !== 'safe') this._sbMostra(tab, url, this._sbDellaScheda(tab, url, v));
      } catch (_) {}
      return;
    }
    tab._sbFrameTimer = setTimeout(() => this._sbScanFrames(tab, giro), 1500);
  },

  // I componenti chiusi nessuno script della pagina li apre: il protocollo di debug sì, senza toccare la pagina (#728).
  // Solo i documenti del processo della scheda: un riquadro di un altro sito resta fuori.
  async _sbCampiChiusi(wc) {
    const out = { shownPassword: false, shownPayment: false };
    const dbg = wc && wc.debugger;
    if (!dbg) return out;
    let mio = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); mio = true; }
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const chiuse = [];
      const visita = (n) => {
        if (!n || chiuse.length >= 500) return;
        for (const s of n.shadowRoots || []) { if (s.shadowRootType === 'closed') chiuse.push(s.nodeId); visita(s); }
        for (const c of n.children || []) visita(c);
        if (n.contentDocument) visita(n.contentDocument);
      };
      visita(root);
      for (const nodeId of chiuse) {
        const { object } = await dbg.sendCommand('DOM.resolveNode', { nodeId });
        if (!object || !object.objectId) continue;
        const { result } = await dbg.sendCommand('Runtime.callFunctionOn', {
          objectId: object.objectId, returnByValue: true,
          functionDeclaration: `function () { return (${pageHints.toString()})(this.ownerDocument, { radici: [this] }); }`,
        });
        const h = result && result.value;
        if (h && h.shownPassword) out.shownPassword = true;
        if (h && h.shownPayment) out.shownPayment = true;
        if (out.shownPassword && out.shownPayment) break;
      }
    } catch (_) {
    } finally {
      if (mio) { try { dbg.detach(); } catch (_) {} }
    }
    return out;
  },

  // Solo dove il campo porterebbe al blocco: un http con la password resta l'avviso che vede già il content script.
  _sbCampiContano(SB, url) {
    try {
      return SB.checkSync(url, { hasPassword: true }).level === 'pericoloso' && SB.checkSync(url, {}).level !== 'pericoloso';
    } catch (_) { return false; }
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
    if (this.puoTornare(tab, 'indietro')) this.goBack(tabId);
    else { try { wc.loadURL('about:blank'); } catch (_) {} }
    return { ok: true };
  },

  // Pulsanti e tasto destro dell'avviso. «Procedi» vale solo con «confermo» scritto (livello 3, actionLevels.js).
  _sbScelta(tab, scelta, dati = {}) {
    const a = tab && tab.sbAvviso;
    if (!a) return;
    if (a.prima && ['procedi', 'continua', 'indietro'].includes(scelta)) {
      this._sbSceltaPrima(tab, a, scelta, dati);
    } else if (scelta === 'procedi') {
      if (a.level === 'pericoloso' && String(dati.testo || '').trim().toLowerCase() === 'confermo') {
        this.safebrowseProceed(tab.id, a.url);
      }
    } else if (scelta === 'continua') {
      if (a.level === 'sospetto') this.safebrowseDismiss(tab.id, a.url);
    } else if (scelta === 'indietro') {
      if (tab._sbSoloAvviso) { this._dropTab(tab); return; }
      this.safebrowseIndietro(tab.id);
    } else if (scelta === 'copia') {
      try { Promise.resolve(require('electron').clipboard.writeText(a.url)).catch(() => {}); } catch (_) {}
    } else if (scelta === 'chiedi' || scelta === 'segnala') {
      this._sbApriCasa(tab, scelta);
    }
    // Una scheda tenuta aperta solo per l'avviso di un file non ha niente da mostrare quando l'avviso va via (#814).
    if (tab._sbSoloAvviso && !tab.sbAvviso) this._dropTab(tab);
  },

  _sbVociMenu(tab) {
    const prima = !!(tab && tab.sbAvviso && tab.sbAvviso.prima);
    return [
      { label: 'Chiedi a Filo di questo sito', icon: 'help', action: 'avviso-sito:chiedi' },
      { label: 'Segnala un falso allarme', icon: 'feedback', action: 'avviso-sito:segnala' },
      { type: 'separator' },
      { label: 'Copia l\'indirizzo', icon: 'duplicate', action: 'avviso-sito:copia' },
      { label: prima ? 'Non aprire' : 'Torna indietro', icon: 'back', action: 'avviso-sito:indietro' },
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

// Un documento blob, o una pagina vuota con l'origine di chi l'ha scritta (`origineDoc`), vale quanto la pagina che lo
// scrive: la pagina web conosciuta della stessa origine (`note`: quella della scheda, o di chi l'ha aperta), altrimenti
// l'origine. Una pagina che non è un sito: null.
function sitoDellaPagina(url, note = [], origineDoc = null) {
  if (/^https?:\/\//i.test(url || '')) return url;
  let origine = '';
  if (/^blob:/i.test(url || '')) {
    try { origine = new URL(url).origin; } catch (_) {}
  } else if (/^about:/i.test(url || '') && origineDoc) {
    origine = String(origineDoc);
  } else return null;
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

// Un clic o un tasto vero sul documento che la scheda mostra adesso, in un riquadro compreso.
function gestoSulDocumento(tab, wc) {
  return Permessi.gestoRecente(wc) || (tab._sbGestoDoc > 0 && Date.now() - tab._sbGestoDoc < Permessi.GESTO_MS);
}

function ultimoPezzo(u) {
  let p = '';
  try { p = new URL(u).pathname; } catch (_) { return ''; }
  try { p = decodeURIComponent(p); } catch (_) {}
  return p.split('/').pop() || '';
}

function stessoIndirizzo(a, b) {
  try { return new URL(a).href === new URL(b).href; } catch (_) { return false; }
}

// Installa i metodi sul prototype di TabManager (mixin). `this` resta l'istanza.
function installSafebrowse(TabManager) {
  Object.assign(TabManager.prototype, safebrowseMethods);
  // Lo chiama il servizio degli scaricamenti (will-download), che non conosce le schede.
  globalThis.SN_SB_SCARICAMENTO = (item, wc) => {
    if (!wc) return false;
    const { BrowserWindow } = require('electron');
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const tab = tm && tm.tabs.find((t) => t.view && t.view.webContents === wc);
      if (tab) return tm._sbScaricamento(tab, item);
    }
    return false;
  };
}

module.exports = { installSafebrowse };
