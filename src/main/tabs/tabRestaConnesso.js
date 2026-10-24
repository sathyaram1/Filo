// «Resta connesso qui»: in Privacy massima la proposta dopo un accesso riuscito e il passaggio dell'accesso fra jar
// effimero e persistente quando cambia l'elenco dei fidati; in Privacy e in Automatico la voce del menu della scheda.
// Mixin di TabManager come tabCookies.js; jar ed elenco stanno in services/cookies.js.

const { BrowserWindow } = require('electron');
const Cookies = require('../services/cookies');
const { riquadroArrivato } = require('../services/riquadroArrivato');
const Sito = require('../../shared/stessoSito');
const Google = require('../../shared/dominiGoogle');
const { looksLikeLoginCookie } = require('../services/geoBlockRules');
const { DB_CODIFICA, DB_TETTO } = require('../../preload/semina-database');

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

// L'accesso non è finito finché resta in vista un campo password (password sbagliata) o il campo del codice di un
// secondo fattore: sulla pagina del codice il sito ha già messo i suoi cookie, ma l'utente non è ancora dentro.
const STATO_MODULO = `
  const vede = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const NOMI = /one-?time|otp|totp|2fa|mfa|two-?factor|second-?factor|verification|verifica|passcode|sms-?code|auth-?code|security-?code|challenge/i;
  const SOLO = /^(code|codice|otp|pin|token)$/i;
  let pw = false, codice = false, caselle = 0;
  try {
    for (const el of document.querySelectorAll('input')) {
      const t = String(el.type || 'text').toLowerCase();
      if (t === 'password') { if (!pw && vede(el)) pw = true; continue; }
      if (codice || !['text', 'tel', 'number'].includes(t) || !vede(el)) continue;
      const nomi = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder].join(' ');
      if (/one-time-code/i.test(el.getAttribute('autocomplete') || '') || NOMI.test(nomi) || SOLO.test(el.name || '') || SOLO.test(el.id || '')) codice = true;
      else if (el.maxLength === 1) caselle++;
    }
  } catch (_) {}
  // Il codice a caselle da una cifra (da 4 a 8).
  if (caselle >= 4 && caselle <= 8) codice = true;`;

const GUARDA_PAGINA = `(() => {${STATO_MODULO}
  let chiave = false;
  try { chiave = Object.keys(localStorage).some((k) => /token|auth|sess|jwt|login|logged/i.test(k)); } catch (_) {}
  return { pw, codice, chiave };
})()`;

// L'accesso fatto in un riquadro (src/content/cookies.js) segue la stessa regola nel riquadro.
const MODULO_RIQUADRO = `(() => {${STATO_MODULO}
  return pw || codice;
})()`;

// Un indirizzo da passo intermedio dell'accesso (codice, conferma sull'app): la pagina può non avere campi.
const PASSO_INTERMEDIO = /(?:^|[/#._-])(?:2fa|mfa|otp|totp|challenge|two-?factor|second-?factor|verify|verification|verifica|sca|strong-?auth|step-?up)(?:$|[/#?._-])/i;

function passoIntermedio(url) {
  try { const u = new URL(url); return PASSO_INTERMEDIO.test(u.pathname + u.hash); } catch (_) { return false; }
}

async function moduloNeiRiquadri(wc) {
  let frames = [];
  try { frames = wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame && riquadroArrivato(f)); } catch (_) { return false; }
  for (const f of frames) {
    try { if (await f.executeJavaScript(MODULO_RIQUADRO) === true) return true; } catch (_) {}
  }
  return false;
}

// Tutto quello che la pagina ha salvato e che i cookie non portano: memoria semplice, memoria della scheda e database
// del sito (Firebase, molte app). Un database con dentro oggetti che non si possono copiare (chiavi crittografiche,
// file) o oltre il tetto resta indietro intero, e lo si dice all'utente: una copia a metà lascerebbe l'app incoerente.
const LEGGI_MEMORIA = `(async () => {
  const voci = (st) => { try { return Object.entries(st); } catch (_) { return []; } };
  ${DB_CODIFICA}
  const database = [];
  const persi = [];
  let elenco = [];
  try { elenco = (await indexedDB.databases()) || []; } catch (_) {}
  let peso = 0;
  const req = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  for (const info of elenco) {
    if (!info || typeof info.name !== 'string') continue;
    let db = null;
    try {
      db = await new Promise((ok, ko) => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
        r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) {} };
      });
      const negozi = [];
      const nomi = Array.from(db.objectStoreNames);
      if (nomi.length) {
        const tx = db.transaction(nomi, 'readonly');
        for (const nome of nomi) {
          const st = tx.objectStore(nome);
          const [valori, chiavi] = await Promise.all([req(st.getAll()), req(st.getAllKeys())]);
          const indici = Array.from(st.indexNames).map((n) => { const ix = st.index(n); return { n, k: ix.keyPath, u: ix.unique, m: ix.multiEntry }; });
          const righe = valori.map((v, i) => [codifica(chiavi[i]), codifica(v)]);
          negozi.push({ n: nome, k: st.keyPath, a: st.autoIncrement, i: indici, r: righe });
        }
      }
      const voce = JSON.stringify({ n: db.name, v: db.version, s: negozi });
      peso += voce.length;
      if (peso > ${DB_TETTO}) throw new Error('tetto');
      database.push(voce);
    } catch (_) { persi.push(info.name); }
    try { if (db) db.close(); } catch (_) {}
  }
  return { locale: voci(localStorage), sessione: voci(sessionStorage), database, persi };
})()`;

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
// Sito cambiato dal menu o dalla proposta → la finestra che l'ha chiesto: lì l'avviso di conferma dice già se c'è
// da rientrare, e l'esito le resta in `esiti` anche se lo spostamento finisce prima che lo chieda.
const conAvviso = new Map();
const esiti = new Map();

function onTrustChange(sito, fidato) {
  const lavoro = coda.then(() => spostaAccesso(sito, fidato)).catch(() => []);
  coda = lavoro;
  inCorso.set(sito, lavoro);
  lavoro.then((persi) => {
    if (inCorso.get(sito) === lavoro) inCorso.delete(sito);
    const chi = conAvviso.get(sito);
    if (chi) esiti.set(sito, persi || []);
    for (const tm of persi || []) if (tm !== chi) avvisaRientro(tm, sito, fidato);
  });
}

function testoRientro(nome, fidato) {
  return fidato
    ? `${nome} tiene l'accesso in un archivio che Filo non riesce a spostare: rientra una volta, poi resti connesso.`
    : `${nome} tiene l'accesso in un archivio che Filo non riesce a spostare: per continuare devi rientrare.`;
}

function avvisaRientro(tm, sito, fidato) {
  try {
    tm.win.webContents.send('shell:toast', { text: testoRientro(nomeLeggibile(sito), fidato), opts: { durationSec: 10, key: `resta-connesso-rientro:${sito}`, tipo: 'resta_connesso_rientro' } });
  } catch (_) {}
}
Cookies.setTrustChangeHandler(onTrustChange);

// Fidato: l'accesso del jar effimero (anche a scheda appena chiusa) passa nel persistente. Tolto: le schede aperte
// lo portano nel jar effimero; il persistente si svuota all'uscita dal sito (services/cookies.js, dimenticaFidato).
async function spostaAccesso(sito, fidato) {
  const managers = managersNormali();
  const persi = [];
  if (Cookies.currentMode(false) === Cookies.MODES.PRIVACY) {
    const aperto = managers.some((tm) => tm.tabs.some((t) => tm._jarDi(t) === sito));
    let orig = null;
    if (fidato) orig = Cookies.sessioneEffimera(sito);
    else if (aperto) orig = Cookies.ensureSiteSession(Cookies.partitionForSite(sito, true), { gpc: true });
    const dest = orig || aperto ? Cookies.ensureSiteSession(Cookies.partitionForSite(sito, fidato), { gpc: true }) : null;
    if (orig && dest) await Cookies.copiaBarattolo(orig, dest);
    for (const tm of managers) {
      try { if (dest && await tm._spostaSchede(sito, dest) > 0) persi.push(tm); } catch (_) {}
    }
  }
  // La voce del menu della scheda dice «Resta» o «Non restare»: la barra lo deve sapere anche senza spostamenti.
  for (const tm of managers) { try { tm._broadcast(); } catch (_) {} }
  return persi;
}

// La voce di un elenco salvato copre `sito` con le regole che scelgono il jar: stesso sito (#876), Google intero (#1123).
function copre(voce, sito) {
  if (Sito.voceSalvata(sito, [voce])) return true;
  return Google.diGoogle(sito) && Google.diGoogle(String(voce || ''));
}

const restaConnessoMethods = {
  // Il sito su cui la voce del menu ha senso: profilo normale, pagina web diretta (una scheda «da un altro paese» ha
  // un jar suo, che nessun elenco tocca), cookie in Privacy massima o in Automatico. In Automatico la voce tiene i
  // cookie del sito anche nei suoi contenuti incorporati altrove (#758); in Manuale Filo non tocca niente.
  _connessoSito(tab) {
    if (!tab || tab.isInternal || tab.proxy || this.incognito) return null;
    if (this.cookieMode !== Cookies.MODES.PRIVACY && this.cookieMode !== Cookies.MODES.DEFAULT) return null;
    if (!/^https?:/i.test(String(tab.url || ''))) return null;
    return Cookies.registrableOf(tab.url) || null;
  },

  // La proposta dopo un accesso serve solo in Privacy: in Automatico l'accesso resta da solo.
  _propostaSito(tab) {
    return this.cookieMode === Cookies.MODES.PRIVACY ? this._connessoSito(tab) : null;
  },

  // Il sito del jar della scheda in Privacy, come lo nomina services/cookies.js quando cambia la fiducia.
  _jarDi(tab) {
    const sito = this._propostaSito(tab);
    return sito && Google.diGoogle(sito) ? Google.SITO_GOOGLE : sito;
  },

  _fidato(sito) {
    return (this.trustedSites || []).some((d) => copre(d, sito));
  },

  // In Automatico un sito dove Filo ti ha visto entrare tiene già i cookie dei suoi contenuti incorporati.
  _entrato(sito) {
    return this.cookieMode === Cookies.MODES.DEFAULT && (this.loggedSites || []).some((d) => copre(d, sito));
  },

  // Per il menu della scheda: null se la voce non va mostrata.
  _connessoState(tab) {
    const sito = this._connessoSito(tab);
    return sito ? { sito, fidato: this._fidato(sito) || this._entrato(sito) } : null;
  },

  // Modalità o elenchi cambiati da qualunque strada: la voce del menu della scheda va ridetta alla barra.
  _connessoImpostazioni(cookies) {
    this.loggedSites = Array.isArray(cookies && cookies.loggedSites) ? cookies.loggedSites : [];
    const firma = [this.cookieMode, (this.trustedSites || []).join(','), this.loggedSites.join(',')].join('|');
    const prima = this._firmaConnesso;
    this._firmaConnesso = firma;
    if (prima !== undefined && prima !== firma) { try { this._broadcast(); } catch (_) {} }
  },

  // Il content script ha visto mandare una password scritta dall'utente (src/content/cookies.js).
  accessoTentato(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const sito = this._propostaSito(tab);
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
    const sito = this._propostaSito(tab);
    if (sito && sito === partito) this._accessoSegna(tab, sito);
  },

  // Chiusa la finestrella d'accesso aperta dalla scheda: il sito della scheda potrebbe averla appena usata.
  _accessoDopoFinestrella(tab) {
    if (!tab || !this.tabs.includes(tab)) return;
    const sito = this._propostaSito(tab);
    if (sito) this._accessoSegna(tab, sito, { dopoCarico: true });
  },

  // Riuscito vuol dire: nessun campo password in vista sul sito, e il sito si è segnato un accesso.
  async _accessoVerifica(tab) {
    const a = tab && tab._accesso;
    if (!a || !this.tabs.includes(tab)) return;
    const scade = a.dopoCarico ? FINESTRELLA_MS : ACCESSO_MS;
    if (Date.now() - a.at > scade || proposti.has(a.sito) || this._fidato(a.sito)) { tab._accesso = null; return; }
    if (this._propostaSito(tab) !== a.sito || (a.dopoCarico && !a.caricata)) return;
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    let pagina = null;
    try { pagina = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: GUARDA_PAGINA }]); } catch (_) { return; }
    if (!pagina || pagina.pw || pagina.codice || passoIntermedio(wc.getURL()) || await moduloNeiRiquadri(wc)) return;
    let cookies = [];
    try { cookies = await wc.session.cookies.get({ url: tab.url }); } catch (_) {}
    if (!pagina.chiave && !cookies.some(looksLikeLoginCookie)) return;
    if (tab._accesso !== a || proposti.has(a.sito) || this._propostaSito(tab) !== a.sito) return;
    tab._accesso = null;
    this._proponiConnesso(a.sito);
  },

  // Una volta per sito: chiusa, scaduta o accettata, non torna.
  _proponiConnesso(sito) {
    proposti.add(sito);
    try {
      this.win.webContents.send('shell:toast', {
        text: `Hai fatto l'accesso a ${nomeLeggibile(sito)}. Vuoi restare connesso anche quando chiudi la scheda o riapri Filo?`,
        opts: {
          durationSec: 15,
          sound: false,
          key: `resta-connesso:${sito}`,
          tipo: 'resta_connesso_proposta',
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
    const ck = (settings.security && settings.security.cookies) || {};
    const salvati = Array.isArray(ck.trustedSites) ? ck.trustedSites.filter((d) => typeof d === 'string') : [];
    // Togliere vuol dire che nessuna voce copre più il sito, anche una salvata come sottodominio o un altro dominio di Google.
    const lista = salvati.filter((d) => !copre(d, s));
    if (on) lista.push(s);
    lista.sort();
    const cambio = { trustedSites: lista };
    // In Automatico «Non restare connesso» vale anche per un sito dove Filo ti ha visto entrare (#758).
    const modo = Cookies.getMode(settings);
    if (!on && modo === Cookies.MODES.DEFAULT && Array.isArray(ck.loggedSites)) {
      const entrati = ck.loggedSites.filter((d) => !copre(d, s));
      if (entrati.length !== ck.loggedSites.length) cambio.loggedSites = entrati;
    }
    const { applySettingsUpdate } = require('../services/handlers');
    const jar = Google.diGoogle(s) ? Google.SITO_GOOGLE : s;
    let persi = [];
    conAvviso.set(jar, this);
    esiti.delete(jar);
    try {
      await applySettingsUpdate({ security: { cookies: cambio } });
      try { await inCorso.get(jar); } catch (_) {}
      persi = esiti.get(jar) || [];
    } finally { conAvviso.delete(jar); esiti.delete(jar); }
    return { ok: true, sito: s, nome: nomeLeggibile(s), fidato: !!on, modo, rientra: persi.includes(this) };
  },

  // Le schede del sito passano nel jar giusto: i cookie del sito vanno con loro, e la memoria della pagina
  // arriva alla pagina nuova prima dei suoi script (takeSemina). La pagina si ricarica. Torna quanti database
  // sono rimasti indietro.
  async _spostaSchede(sito, dest) {
    const propri = new Set([Cookies.partitionForSite(sito, true), Cookies.partitionForSite(sito, false)]);
    let persi = 0;
    for (const tab of this.tabs.slice()) {
      if (this._jarDi(tab) !== sito) continue;
      const url = tab.url;
      if (!this._needsRepartition(tab, url)) continue;
      const wc = tab.view && tab.view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      // Un ritorno da un altro sito con un redirect del server lascia la pagina nel jar di quel sito.
      if (!propri.has(tab.partition)) await Cookies.copiaBarattolo(wc.session, dest, sito);
      let mem = null;
      try { mem = await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: LEGGI_MEMORIA }]); } catch (_) {}
      if (!this.tabs.includes(tab) || !tab.view || tab.view.webContents !== wc) continue;
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch (_) {}
      const locale = mem && Array.isArray(mem.locale) ? mem.locale : [];
      const sessione = mem && Array.isArray(mem.sessione) ? mem.sessione : [];
      const database = mem && Array.isArray(mem.database) ? mem.database : [];
      if (mem && Array.isArray(mem.persi)) persi += mem.persi.length;
      tab._semina = (locale.length || sessione.length || database.length) && origin
        ? { origin, locale, sessione, database, at: Date.now() } : null;
      this._recreateView(tab, url);
    }
    return persi;
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
    return { locale: s.locale, sessione: s.sessione, database: s.database || [] };
  },
};

function installRestaConnesso(TabManager) {
  Object.assign(TabManager.prototype, restaConnessoMethods);
}

module.exports = { installRestaConnesso };
