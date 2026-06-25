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
  },

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
      if (norm && norm.registrable) tab.sbBypass.add(norm.registrable);
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
      if (norm && norm.registrable) tab.sbDismissed.add(norm.registrable);
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
