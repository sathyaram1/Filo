// Rilevamento + regole d'azione geo-block — estratto da tabs.js come livello
// separato. (vedi src/main/services/geoBlock.js e proxy-per-tab-spec.md §4-§5.)
// Qui rilevamento (livello 1 deterministico + livello 2 LLM) e regole d'azione
// (livello decisionale, #151): retry via proxy, proposta inline, escalation.
//
// Questi metodi vengono installati sul prototype di TabManager (mixin): `this`
// è l'istanza TabManager, quindi `this.tabs`, `this.setTabProxy(...)`,
// `this._geoTextCheck(...)`, `this._readSettings(...)` funzionano identici a
// quando vivevano inline in tabs.js. Le dipendenze module-scoped (ProxyTab,
// GeoBlock, GeoBlockRules) erano già `require`ate in tabs.js: qui le ririchiamo
// dagli stessi moduli services. Il classificatore LLM arriva dal globale
// SN_GEO_CLASSIFY (caricato dal loader), come prima.

const ProxyTab = require('../services/proxyTab');
const GeoBlock = require('../services/geoBlock');
const GeoBlockRules = require('../services/geoBlockRules');

const geoBlockMethods = {
  // ─── rilevamento geo-block (livello 1 deterministico) ────────────────────
  // Qui SOLO rilevamento + segnale interno + azione (#151). Un solo segnale per
  // navigazione: la prima fonte che matcha vince (status > redirect > testo).

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
  },

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
  },

  // Etichetta leggibile del paese ('us' → 'Stati Uniti'); fallback al codice
  // maiuscolo per i paesi fuori dalla lista curata (il linguaggio naturale, #152,
  // può chiederne altri).
  _geoCountryLabel(code) {
    const c = String(code || '').toLowerCase();
    const hit = (ProxyTab.LOCATIONS || []).find((l) => l.code === c);
    return hit ? hit.label : c.toUpperCase();
  },

  // Toast discreto nella shell ("Aperto da {paese}"): informa senza chiedere.
  _geoToast(text) {
    try { this.win.webContents.send('shell:toast', { text }); } catch (_) {}
  },

  // Proposta inline al content script del tab (login attivo, o retry esaurito):
  // "Questo contenuto è bloccato in Italia. Lo apro da {paese}? In questa tab non
  // sarai loggato." con i bottoni Apri/No.
  _geoBroadcastPropose(tab, url, country, label) {
    const T = (globalThis.SN_MSG && globalThis.SN_MSG.MSG && globalThis.SN_MSG.MSG.GEO_PROPOSE) || 'geo_propose';
    try {
      tab.view.webContents.send('filo:broadcast', { type: T, url, country, countryLabel: label });
    } catch (_) {}
  },

  _geoState(tab) {
    if (!tab.geoDismissed) tab.geoDismissed = new Set(); // host con proposta rifiutata
    return tab;
  },

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
  },

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
  },

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
  },

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
  },
};

// Installa i metodi sul prototype di TabManager (mixin). `this` resta l'istanza.
function installGeoBlock(TabManager) {
  Object.assign(TabManager.prototype, geoBlockMethods);
}

module.exports = { installGeoBlock };
