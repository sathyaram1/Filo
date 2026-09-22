// Rilevamento siti pericolosi (safebrowse) — estratto da tabs.js come livello
// separato. (vedi src/main/services/safebrowse/.) Tutto best-effort: NIENTE
// blocca mai la navigazione. L'overlay "pericoloso"/banner "sospetto" vive in
// un content script sulla pagina; qui calcoliamo il verdetto e lo spingiamo via
// broadcast SAFEBROWSE_UPDATE. Bypass (confermo) e dismiss (ok) sono per
// (tab, dominio) e durano solo finché il tab vive.
//
// Questi metodi vengono installati sul prototype di TabManager (mixin): `this`
// è l'istanza TabManager, quindi `this.tabs`, `this._sbBroadcast(...)`, ecc.
// funzionano identici a quando vivevano inline in tabs.js. Le dipendenze sono
// solo i globali SN_SAFEBROWSE / SN_MSG (caricati dal loader), come prima.

const { catenaDi } = require('./catenaNavigazione');

// #591, quarto giro. Il conto comune delle verifiche profonde è una raffica
// corta: quando è pieno, `analyze` rinuncia e lo dice (`rimandato`). La
// rinuncia non è colpa del sito che si sta guardando, quindi non deve costargli
// il controllo: finché l'utente è rimasto su quella pagina, la si richiede.
// Le pagine della raffica, che la scheda ha già lasciato, non tornano in fila.
const SB_RINVII_MAX = 3;
const SB_RINVIO_MS = 5250;

const safebrowseMethods = {
  // #591, sesto giro. In incognito Filo si astiene da tutto il resto — niente
  // sessione salvata, niente archivio, niente cronologia, niente riordino
  // automatico — mentre gli stadi di RETE della verifica dei siti pericolosi
  // partivano lo stesso, e portavano fuori l'indirizzo intero di ogni pagina
  // guardata lì, parametri compresi. Il verdetto LOCALE non manda niente a
  // nessuno e continua a lavorare anche in incognito: è solo la rete che si
  // ferma. Il contesto che arriva dallo script della pagina non è fidato, e
  // questo campo lo decide la scheda: si sovrascrive sempre.
  // `catena` dice a chi addebitare i controlli costosi: una pagina che si porta
  // da sola su indirizzi sempre nuovi resta la stessa catena e ha un conto
  // solo, mentre chi naviga dopo una pausa ne apre una nuova (#591, giro 7).
  // `insistito` è la ripresentazione della pagina dove la scheda È RIMASTA: la
  // decide solo questo livello (il contesto della pagina non la può scrivere),
  // e vale come prova che non si tratta di una raffica (#591, giro 8).
  _sbCtx(ctx, tab, insistito = false) {
    return {
      ...(ctx || {}), incognito: !!this.incognito, catena: catenaDi(tab), insistito: !!insistito,
    };
  },

  _sbState(tab) {
    if (!tab.sbBypass) tab.sbBypass = new Set();      // siti confermati su "pericoloso"
    if (!tab.sbDismissed) tab.sbDismissed = new Set(); // banner "sospetto" già chiuso
    return tab;
  },

  // Chi possiede il sito: è la chiave con cui si ricordano il «confermo» e
  // l'avviso chiuso (#591, giro 4). Prima era il dominio principale, e sulle
  // piattaforme dove ogni utente riceve un sotto-indirizzo gratuito quel
  // dominio è la PIATTAFORMA: chi aveva proseguito una volta su un sito di
  // truffa ospitato lì non vedeva più la pagina rossa su nessun altro sito
  // ospitato lì, nemmeno su una truffa diversa e di un altro proprietario.
  // Per un dominio normale le due chiavi coincidono, quindi il «confermo» vale
  // come prima per tutti i sottodomini del sito.
  _sbChi(norm) {
    if (!norm) return '';
    const SB = globalThis.SN_SAFEBROWSE;
    const host = norm.host || '';
    if (SB && typeof SB.proprietario === 'function' && host) {
      const chi = SB.proprietario(host);
      if (chi) return chi;
    }
    return norm.registrable || host;
  },

  // Abbassa il verdetto a "safe" se l'utente ha già confermato/chiuso l'avviso
  // per questo dominio in questo tab.
  _sbApplyState(tab, verdict) {
    if (!verdict || verdict.level === 'safe') return verdict;
    const reg = this._sbChi(verdict.norm);
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
  },

  // La verifica profonda ha rinunciato per il conto comune: si riprova fra
  // qualche secondo, ma solo se la scheda è ancora su quella pagina.
  _sbRimanda(tab, url, ctx) {
    if (!tab.sbRinvii || tab.sbRinvii.url !== url) {
      if (tab.sbRinvii && tab.sbRinvii.timer) clearTimeout(tab.sbRinvii.timer);
      tab.sbRinvii = { url, n: 0, timer: null };
    }
    const r = tab.sbRinvii;
    if (r.timer || r.n >= SB_RINVII_MAX) return;
    r.n += 1;
    r.timer = setTimeout(() => {
      r.timer = null;
      const SB = globalThis.SN_SAFEBROWSE;
      const wc = tab.view && tab.view.webContents;
      if (!SB || !wc || (wc.isDestroyed && wc.isDestroyed())) return;
      let current = '';
      try { current = wc.getURL() || ''; } catch (_) { return; }
      if (current !== url) return; // l'utente è andato altrove: non è più affar suo
      let verdict;
      try {
        verdict = SB.analyze(url, ctx, (next) => {
          this._sbBroadcast(tab, url, this._sbApplyState(tab, next));
        });
      } catch (_) { return; }
      this._sbBroadcast(tab, url, this._sbApplyState(tab, verdict));
      if (verdict && verdict.rimandato) this._sbRimanda(tab, url, ctx);
    }, SB_RINVIO_MS);
    if (r.timer && typeof r.timer.unref === 'function') r.timer.unref();
  },

  // Richiesto dal content script (SAFEBROWSE_GET) quando la pagina parte. Ritorna
  // SUBITO il verdetto sincrono (rispettando bypass/dismiss) e, se ci sono
  // segnali di rete da approfondire, li avvia: a verdetto cambiato fa broadcast.
  safebrowseGet(tabId, url, ctxIn = {}) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!SB || !tab) return { ok: true, level: 'safe', message: null };
    const ctx = this._sbCtx(ctxIn, tab);
    let verdict;
    try {
      verdict = SB.analyze(url, ctx, (next) => {
        this._sbBroadcast(tab, url, this._sbApplyState(tab, next));
      });
    } catch (_) {
      return { ok: true, level: 'safe', message: null };
    }
    if (verdict && verdict.rimandato) this._sbRimanda(tab, url, ctx);
    const applied = this._sbApplyState(tab, verdict);
    return {
      ok: true,
      level: applied.level,
      message: applied.message || null,
      registrable: applied.norm ? applied.norm.registrable : null,
    };
  },

  // did-navigate: ricontrolla l'URL FINALE (dopo i redirect) e spinge il verdetto
  // al content script. Salta le pagine interne filo://.
  _sbOnNavigate(tab, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    if (!SB || !tab || !url || /^filo:\/\//i.test(url)) return;
    const ctx = this._sbCtx({}, tab);
    try {
      const verdict = SB.analyze(url, ctx, (next) => {
        this._sbBroadcast(tab, url, this._sbApplyState(tab, next));
      });
      this._sbBroadcast(tab, url, this._sbApplyState(tab, verdict));
      if (verdict && verdict.rimandato) this._sbRimanda(tab, url, ctx);
    } catch (_) {}
  },

  // L'utente ha scritto "confermo" sull'interstitial "pericoloso": registra il
  // bypass per (tab, dominio) e ridisegna (l'overlay sparisce).
  safebrowseProceed(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const norm = SB && SB.normalize(url);
      const chi = this._sbChi(norm);
      if (chi) tab.sbBypass.add(chi);
    } catch (_) {}
    this._sbBroadcast(tab, url, { level: 'safe', message: null });
    return { ok: true };
  },

  // L'utente ha chiuso con "ok" il banner "sospetto": non riproporlo per questo
  // dominio in questo tab.
  safebrowseDismiss(tabId, url) {
    const SB = globalThis.SN_SAFEBROWSE;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return { ok: false };
    this._sbState(tab);
    try {
      const norm = SB && SB.normalize(url);
      const chi = this._sbChi(norm);
      if (chi) tab.sbDismissed.add(chi);
    } catch (_) {}
    this._sbBroadcast(tab, url, { level: 'safe', message: null });
    return { ok: true };
  },
};

// Installa i metodi sul prototype di TabManager (mixin). `this` resta l'istanza.
function installSafebrowse(TabManager) {
  Object.assign(TabManager.prototype, safebrowseMethods);
}

module.exports = { installSafebrowse };
