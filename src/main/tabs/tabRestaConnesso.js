// «Resta connesso qui» in Privacy massima: la proposta dopo un accesso riuscito, la voce del menu della scheda e
// il passaggio dell'accesso fra il jar effimero e quello persistente del sito quando cambia l'elenco dei fidati.
// Mixin di TabManager come tabCookies.js; jar ed elenco stanno in services/cookies.js.

const { BrowserWindow } = require('electron');
const Cookies = require('../services/cookies');
const { looksLikeLoginCookie } = require('../services/geoBlockRules');

// Un secondo fattore può prendere un paio di minuti fra la password e la pagina d'arrivo.
const ACCESSO_MS = 3 * 60 * 1000;
// Chiusa la finestrella d'accesso, il sito che ha davvero ricevuto l'accesso reagisce subito: più tardi è un'altra pagina.
const FINESTRELLA_MS = 30 * 1000;
// Una pagina che cambia da sé dopo l'invio, senza caricarne un'altra, si riguarda a questi intervalli.
const RIGUARDA_MS = [1500, 4000, 10000, 25000, 60000];
// La memoria della pagina portata nel jar nuovo vale per il primo caricamento, non per sempre.
const SEMINA_MS = 60 * 1000;

// Siti già proposti o tolti dall'utente: non si ripropongono. Solo in memoria, perché in Privacy Filo non tiene
// sul disco cosa sa dei siti non fidati (services/cookies.js, keepsSiteData), nemmeno dove accedi.
const proposti = new Set();

// Un campo password ancora in vista vuol dire che l'accesso non è finito (password sbagliata, secondo passo).
const GUARDA_PAGINA = `(() => {
  let pw = false;
  try {
    for (const el of document.querySelectorAll('input[type="password"]')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden') { pw = true; break; }
    }
  } catch (_) {}
  let chiave = false;
  try { chiave = Object.keys(localStorage).some((k) => /token|auth|sess|jwt|login|logged/i.test(k)); } catch (_) {}
  return { pw, chiave };
})()`;

const LEGGI_MEMORIA = '(() => { try { return Object.entries(localStorage); } catch (_) { return null; } })()';

function nomeLeggibile(sito) {
  const N = globalThis.SN_NOMI_SITO;
  return N && N.leggibile ? N.leggibile(sito) : sito;
}

function managersNormali() {
  try {
    return BrowserWindow.getAllWindows().filter((w) => !w._filoIncognito && w._filoTabs).map((w) => w._filoTabs);
  } catch (_) { return []; }
}

// Un cambio alla volta: «resta» e «non restare» di fila non devono incrociare le copie dei jar.
let coda = Promise.resolve();
const inCorso = new Map();

function onTrustChange(sito, fidato) {
  const lavoro = coda.then(() => spostaAccesso(sito, fidato)).catch(() => {});
  coda = lavoro;
  inCorso.set(sito, lavoro);
  lavoro.then(() => { if (inCorso.get(sito) === lavoro) inCorso.delete(sito); });
}
Cookies.setTrustChangeHandler(onTrustChange);

// Il sito diventa fidato: l'accesso fatto nel jar effimero passa in quello persistente, e le schede aperte lo
// seguono. Esce dai fidati: l'accesso resta fino alla chiusura (jar effimero) e il disco si svuota.
async function spostaAccesso(sito, fidato) {
  if (Cookies.currentMode(false) === Cookies.MODES.PRIVACY) {
    const dest = Cookies.ensureSiteSession(Cookies.partitionForSite(sito, fidato), { gpc: true });
    const orig = fidato ? Cookies.sessioneEffimera(sito) : Cookies.ensureSiteSession(Cookies.partitionForSite(sito, true), { gpc: true });
    if (orig) await Cookies.copiaBarattolo(orig, dest);
    for (const tm of managersNormali()) {
      try { await tm._spostaSchede(sito, dest); } catch (_) {}
    }
  }
  if (!fidato) await Cookies.dimenticaSito(sito);
  // La voce del menu della scheda dice «Resta» o «Non restare»: la barra lo deve sapere anche senza spostamenti.
  for (const tm of managersNormali()) { try { tm._broadcast(); } catch (_) {} }
}

const restaConnessoMethods = {
  // Il sito su cui la proposta e la voce del menu hanno senso: Privacy massima, profilo normale, pagina web
  // diretta (una scheda «da un altro paese» ha un jar suo, che nessun elenco tocca).
  _connessoSito(tab) {
    if (!tab || tab.isInternal || tab.proxy || this.incognito) return null;
    if (this.cookieMode !== Cookies.MODES.PRIVACY) return null;
    if (!/^https?:/i.test(String(tab.url || ''))) return null;
    return Cookies.registrableOf(tab.url) || null;
  },

  _fidato(sito) {
    return (this.trustedSites || []).some((d) => String(d || '').toLowerCase() === sito);
  },

  // Per il menu della scheda: null se la voce non va mostrata.
  _connessoState(tab) {
    const sito = this._connessoSito(tab);
    return sito ? { sito, fidato: this._fidato(sito) } : null;
  },

  // Il content script ha visto mandare una password scritta dall'utente (src/content/cookies.js).
  accessoTentato(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const sito = this._connessoSito(tab);
    if (!sito) return { ok: false };
    this._accessoSegna(tab, sito);
    return { ok: true };
  },

  // `dopoCarico`: l'esito si guarda solo dopo che la pagina ha reagito (una finestrella chiusa senza accedere
  // lascia la pagina com'era, senza password in vista, e non deve sembrare un accesso).
  _accessoSegna(tab, sito, { dopoCarico = false } = {}) {
    if (!tab || !sito || proposti.has(sito) || this._fidato(sito)) return;
    const a = { sito, at: Date.now(), dopoCarico, caricata: false };
    tab._accesso = a;
    for (const ms of RIGUARDA_MS) {
      const t = setTimeout(() => { if (tab._accesso === a) this._accessoVerifica(tab).catch(() => {}); }, ms);
      if (t.unref) t.unref();
    }
  },

  // Pagina caricata o cambiata nella scheda: se aspettava l'esito di un accesso, lo guarda.
  _accessoDopoCarico(tab) {
    if (!tab || !tab._accesso) return;
    tab._accesso.caricata = true;
    this._accessoVerifica(tab).catch(() => {});
  },

  // «Continua con Google» nella scheda stessa: sito → fornitore d'identità → di nuovo lo stesso sito.
  _accessoDaNavigazione(tab, prima, url) {
    const AP = globalThis.SN_AUTH_POPUP;
    if (!AP || !prima || prima === url) return;
    const daIdentita = AP.isIdentityAuthSurface(prima);
    const suIdentita = AP.isIdentityAuthSurface(url);
    if (suIdentita && !daIdentita) {
      tab._partitoPerAccesso = /^https?:/i.test(prima) ? Cookies.registrableOf(prima) : null;
      return;
    }
    if (!daIdentita || suIdentita) return;
    const partito = tab._partitoPerAccesso;
    tab._partitoPerAccesso = null;
    const sito = this._connessoSito(tab);
    if (sito && sito === partito) this._accessoSegna(tab, sito);
  },

  // Chiusa la finestrella d'accesso aperta dalla scheda: il sito della scheda potrebbe averla appena usata.
  _accessoDopoFinestrella(tab) {
    if (!tab || !this.tabs.includes(tab)) return;
    const sito = this._connessoSito(tab);
    if (sito) this._accessoSegna(tab, sito, { dopoCarico: true });
  },

  // Riuscito vuol dire: nessun campo password in vista sul sito, e il sito si è segnato un accesso.
  async _accessoVerifica(tab) {
    const a = tab && tab._accesso;
    if (!a || !this.tabs.includes(tab)) return;
    const scade = a.dopoCarico ? FINESTRELLA_MS : ACCESSO_MS;
    if (Date.now() - a.at > scade || proposti.has(a.sito) || this._fidato(a.sito)) { tab._accesso = null; return; }
    if (this._connessoSito(tab) !== a.sito || (a.dopoCarico && !a.caricata)) return;
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    let pagina = null;
    try { pagina = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: GUARDA_PAGINA }]); } catch (_) { return; }
    if (!pagina || pagina.pw) return;
    let cookies = [];
    try { cookies = await wc.session.cookies.get({ url: tab.url }); } catch (_) {}
    if (!pagina.chiave && !cookies.some(looksLikeLoginCookie)) return;
    if (tab._accesso !== a || proposti.has(a.sito) || this._connessoSito(tab) !== a.sito) return;
    tab._accesso = null;
    this._proponiConnesso(a.sito);
  },

  // Una volta per sito: chiusa, scaduta o accettata, non torna.
  _proponiConnesso(sito) {
    proposti.add(sito);
    try {
      this.win.webContents.send('shell:toast', {
        text: `Hai fatto l'accesso a ${nomeLeggibile(sito)}. Vuoi restare connesso anche quando riapri Filo?`,
        opts: {
          durationSec: 15,
          sound: false,
          key: `resta-connesso:${sito}`,
          actions: [{ label: 'Resta connesso', restaConnesso: sito }],
        },
      });
    } catch (_) {}
  },

  // Dal menu della scheda (tabId) o dalla proposta (sito, solo uno proposto). Cambia l'elenco dei fidati;
  // jar e schede li sposta onTrustChange, la stessa strada di Sicurezza e chat.
  async restaConnesso({ tabId, sito, on } = {}) {
    let s = null;
    if (sito) {
      s = String(sito).toLowerCase();
      if (!proposti.has(s)) return { ok: false, error: 'no_site' };
    } else {
      s = this._connessoSito(this.tabs.find((t) => t.id === tabId));
    }
    if (!s) return { ok: false, error: 'no_site' };
    proposti.add(s);
    const Storage = globalThis.SN_STORAGE;
    const settings = await Storage.getSettings();
    const lista = Cookies.getTrustedSites(settings).filter((d) => String(d || '').toLowerCase() !== s);
    if (on) lista.push(s);
    lista.sort();
    const { applySettingsUpdate } = require('../services/handlers');
    await applySettingsUpdate({ security: { cookies: { trustedSites: lista } } });
    try { await inCorso.get(s); } catch (_) {}
    return { ok: true, sito: s, nome: nomeLeggibile(s), fidato: !!on };
  },

  // Le schede del sito passano nel jar giusto: i cookie del sito vanno con loro, e la memoria della pagina
  // arriva alla pagina nuova prima dei suoi script (takeSemina). La pagina si ricarica.
  async _spostaSchede(sito, dest) {
    const propri = new Set([Cookies.partitionForSite(sito, true), Cookies.partitionForSite(sito, false)]);
    for (const tab of this.tabs.slice()) {
      if (this._connessoSito(tab) !== sito) continue;
      const url = tab.url;
      if (!this._needsRepartition(tab, url)) continue;
      const wc = tab.view && tab.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      // Un ritorno da un altro sito con un redirect del server lascia la pagina nel jar di quel sito.
      if (!propri.has(tab.partition)) await Cookies.copiaBarattolo(wc.session, dest, sito);
      let voci = null;
      try { voci = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: LEGGI_MEMORIA }]); } catch (_) {}
      if (!this.tabs.includes(tab) || !tab.view || tab.view.webContents !== wc) continue;
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch (_) {}
      tab._semina = Array.isArray(voci) && voci.length && origin ? { origin, voci, at: Date.now() } : null;
      this._recreateView(tab, url);
    }
  },

  // Il preload della pagina che sta per caricarsi chiede se c'è memoria da rimettere (src/main/ipc.js).
  takeSemina(wc, href) {
    const tab = this.tabs.find((t) => t.view && t.view.webContents === wc);
    const s = tab && tab._semina;
    if (!s) return null;
    if (Date.now() - s.at > SEMINA_MS) { tab._semina = null; return null; }
    let origin = '';
    try { origin = new URL(href).origin; } catch (_) { return null; }
    if (origin !== s.origin) return null;
    tab._semina = null;
    return s.voci;
  },
};

function installRestaConnesso(TabManager) {
  Object.assign(TabManager.prototype, restaConnessoMethods);
}

module.exports = { installRestaConnesso };
