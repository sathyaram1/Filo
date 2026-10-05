// Gestione cookie / consenso (processo main).
//
// Un solo interruttore a 3 stati (settings.security.cookies.mode):
//   - 'manual'  → nessuna gestione automatica.
//   - 'default' → "Automatico": GPC + rifiuto CMP + YouTube nocookie (content
//                 script) + BLOCCO a monte dei tracker noti (Google Analytics,
//                 ad network, social pixel…). I cookie funzionali/di prima parte
//                 (login, preferenze, le tue scelte) NON vengono cancellati: le
//                 tue scelte restano. All'uscita ripulisce solo eventuali cookie
//                 di domini-tracker rimasti.
//   - 'privacy' → come default + ogni sito ha un cookie jar isolato ed effimero
//                 (partizione Electron dedicata, senza 'persist:'). I "siti
//                 fidati" (trustedSites) ricevono invece una partizione isolata
//                 ma PERSISTENTE ('persist:filo-priv-…'), così resti connesso
//                 anche in Privacy senza rinunciare all'isolamento per-sito.
//
// Questo modulo si occupa SOLO della parte main-process:
//   - emette l'header Sec-GPC: 1 sulle sessioni (onBeforeSendHeaders);
//   - blocca le richieste ai tracker noti (onBeforeRequest);
//   - risolve la sessione/partizione per ogni navigazione top-level;
//   - ripulisce i cookie dei tracker (wipe mirato, modalità 'default').
// Il rifiuto dei banner CMP e la riscrittura degli embed YouTube vivono nel
// content script src/content/cookies.js. L'iniezione di
// navigator.globalPrivacyControl avviene in tabs.js (mondo della pagina).

'use strict';

const { session } = require('electron');

const MODES = { MANUAL: 'manual', DEFAULT: 'default', PRIVACY: 'privacy' };

// ─── lista tracker (curata) ────────────────────────────────────────────────
//
// Domini/host di tracciamento noti. Bloccare la RICHIESTA verso questi host
// impedisce allo script di tracciamento di caricarsi del tutto: niente cookie
// (es. il _ga di Google Analytics non viene mai creato perché googletagmanager
// non si scarica), niente dati inviati. È più efficace del cancellare il cookie
// dopo: lo intercetta a monte.
//
// REGOLA: includere solo host DEDICATI al tracciamento. Mai domini "buoni" come
// google.com o facebook.com, altrimenti si bloccherebbe il sito intero. Per i
// servizi che vivono su un dominio legittimo si elenca l'host specifico
// (es. 'analytics.google.com', non 'google.com'). Il match è per host:
// host === voce  oppure  host che termina con '.' + voce.
const TRACKER_HOSTS = [
  // Google: analytics, tag manager, ads (host/dominî dedicati)
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'adservice.google.com',
  // Social pixel / insight tag (host dedicati; i domini base restano leciti)
  'connect.facebook.net',
  'analytics.tiktok.com',
  'static.ads-twitter.com',
  'analytics.twitter.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',
  'ct.pinterest.com',
  // Analytics / heatmap / session replay di terze parti
  'hotjar.com',
  'mixpanel.com',
  'mxpnl.com',
  'segment.com',
  'segment.io',
  'amplitude.com',
  'fullstory.com',
  'mc.yandex.ru',
  'clarity.ms',
  'scorecardresearch.com',
  'quantserve.com',
  'quantcount.com',
  // Ad network / RTB
  'adnxs.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'rubiconproject.com',
  'pubmatic.com',
  'casalemedia.com',
  'adsrvr.org',
];

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

// true se l'host è (o è un sottodominio di) un host-tracker noto.
function isTrackerHost(host) {
  if (!host) return false;
  host = String(host).toLowerCase().replace(/^\./, '');
  for (const d of TRACKER_HOSTS) {
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

function isTrackerUrl(url) {
  return isTrackerHost(hostnameOf(url));
}

function getMode(settings) {
  const m = settings && settings.security && settings.security.cookies && settings.security.cookies.mode;
  return m === MODES.MANUAL || m === MODES.PRIVACY ? m : MODES.DEFAULT;
}

// Siti "fidati" (eTLD+1) che in Privacy restano connessi (partizione isolata ma
// persistente). Legge trustedSites; per retrocompatibilità accetta anche la
// vecchia chiave loginWhitelist.
function getTrustedSites(settings) {
  const c = settings && settings.security && settings.security.cookies;
  const list = (c && (c.trustedSites || c.loginWhitelist)) || [];
  return Array.isArray(list) ? list : [];
}

// Siti (eTLD+1) dove l'utente ha chiesto di rivedere i banner dei cookie: lì Filo non rifiuta e non nasconde.
function getBannerSites(settings) {
  const c = settings && settings.security && settings.security.cookies;
  const list = (c && c.bannerSites) || [];
  return Array.isArray(list) ? list.map((d) => String(d || '').toLowerCase()).filter(Boolean) : [];
}

function isBannerSiteIn(sites, url) {
  if (!/^https?:/i.test(String(url || ''))) return false;
  const reg = registrableOf(url);
  return !!reg && sites.includes(reg);
}

function trustedSetOf(settings) {
  return new Set(getTrustedSites(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean));
}

// eTLD+1 per i cookie: solo le piattaforme che il web già separa (un blog su wordpress.com resta con wordpress.com).
// Ripiego sull'hostname grezzo se il normalizzatore manca o l'URL non ha dominio (IP, localhost).
function registrableOf(url) {
  try {
    const SB = globalThis.SN_SAFEBROWSE;
    if (SB && typeof SB.normalize === 'function') {
      const norm = SB.normalize(url, { soloPsl: true });
      if (norm && norm.registrable) return norm.registrable;
    }
  } catch (_) {}
  try { return new URL(url).hostname.toLowerCase() || null; } catch (_) { return null; }
}

// Chiave di partizione per-sito in modalità privacy. Slug sicuro per il nome di
// partizione Electron (solo [a-z0-9.-]). Se il sito è "fidato" la partizione è
// PERSISTENTE ('persist:'): resta isolata per-sito ma sopravvive alla sessione,
// così l'utente resta connesso. Altrimenti è effimera (in RAM).
function baseDelSito(reg) {
  return 'filo-priv-' + String(reg || '').replace(/[^a-z0-9.-]/gi, '_');
}

function partitionForUrl(url, trusted) {
  const reg = registrableOf(url);
  if (!reg) return null;
  return partitionForSite(reg, trusted instanceof Set && trusted.has(reg));
}

// 'persist:' → jar isolato per-sito ma persistente (resta connesso).
// Senza prefisso → jar isolato ed effimero, buttato all'uscita dal sito (vedi «uscita dal sito»).
function partitionForSite(site, persistent) {
  const reg = String(site || '').toLowerCase();
  if (!reg) return null;
  const base = baseDelSito(reg);
  if (persistent) return 'persist:' + base;
  sitoDelJar.set(base, reg);
  const g = jarGen.get(base);
  return g && g.n ? `${base}~${g.n}` : base;
}

// I cookie di un jar ricopiati in un altro, così l'accesso segue il sito quando passa fra jar effimero e
// persistente («Resta connesso»). Le scadenze restano quelle del sito: un cookie di sessione resta di sessione.
function cookieDaCopiare(c) {
  const host = String((c && c.domain) || '').replace(/^\./, '');
  if (!host || !c.name) return null;
  const d = {
    url: (c.secure ? 'https://' : 'http://') + host + (c.path || '/'),
    name: c.name,
    value: String(c.value == null ? '' : c.value),
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
  };
  if (!c.hostOnly) d.domain = c.domain;
  if (!c.session && Number(c.expirationDate) > 0) d.expirationDate = Number(c.expirationDate);
  if (c.sameSite && c.sameSite !== 'unspecified') d.sameSite = c.sameSite;
  return d;
}

// `sito`: da un jar che non è quello del sito si prendono solo i cookie del sito.
async function copiaBarattolo(da, a, sito) {
  if (!da || !a || da === a || !da.cookies || !a.cookies) return 0;
  let tutti = [];
  try { tutti = await da.cookies.get({}); } catch (_) { return 0; }
  const suo = (c) => {
    const dom = String(c.domain || '').replace(/^\./, '').toLowerCase();
    return dom === sito || dom.endsWith('.' + sito);
  };
  let copiati = 0;
  await Promise.all(tutti.map(async (c) => {
    if (sito && !suo(c)) return;
    const d = cookieDaCopiare(c);
    if (!d) return;
    try { await a.cookies.set(d); copiati++; } catch (_) {}
  }));
  // Sul disco subito: un'uscita brusca subito dopo il sì non deve perdere l'accesso.
  try { await a.cookies.flushStore(); } catch (_) {}
  return copiati;
}

// La sessione ancora viva del jar effimero del sito (generazione in uso), senza crearla.
function sessioneEffimera(site) {
  return siteSessions.get(partitionForSite(site, false)) || null;
}

// ─── GPC: header Sec-GPC: 1 ───────────────────────────────────────────────
//
// Una sola registrazione onBeforeSendHeaders per sessione (Electron consente un
// solo listener per evento/sessione: una seconda registrazione SOSTITUISCE la
// prima). Emette l'header Sec-GPC: 1, gated dal flag enabled nella mappa
// (accendi/spegni senza ri-registrare).

const gpcState = new WeakMap(); // session → { enabled }

// Registra (se manca) l'unico listener onBeforeSendHeaders della sessione,
// SENZA toccare lo stato GPC.
function ensureHeaderHook(ses) {
  if (!ses || !ses.webRequest) return null;
  let state = gpcState.get(ses);
  if (!state) {
    state = { enabled: false };
    gpcState.set(ses, state);
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const s = gpcState.get(ses);
      let headers = details.requestHeaders;
      if (s && s.enabled) headers = { ...headers, 'Sec-GPC': '1' };
      callback({ requestHeaders: headers });
    });
  }
  return state;
}

function applyGpc(ses, enabled) {
  const state = ensureHeaderHook(ses);
  if (state) state.enabled = !!enabled;
}

// ─── blocco tracker: cancella le richieste ai tracker noti ──────────────────
//
// Una sola registrazione onBeforeRequest per sessione (come per GPC). Quando
// attivo, ogni richiesta verso un host-tracker viene annullata: lo script non
// si carica, il cookie non viene creato, nessun dato parte.

const blockState = new WeakMap(); // session → { enabled, filtri }

// Host chiusi a prescindere dalla modalità: li accende solo la modalità test
// (src/main/test-servizi-chiusi.js), che per questo passa dallo stesso listener.
let hostChiusoFn = null;
function chiudiHost(fn) { hostChiusoFn = typeof fn === 'function' ? fn : null; }

// Richieste che l'utente ha fatto passare con «Apri comunque» (#590): senza, il sì
// sulla lista dei siti bloccati si ferma qui e la scheda finisce su una pagina d'errore.
let permessoFn = null;
function permettiRichieste(fn) { permessoFn = typeof fn === 'function' ? fn : null; }

// Registra (se manca) l'unico listener onBeforeRequest della sessione. Tracker e
// ad-blocking restano spenti finché applyTrackerBlocking non accende i filtri.
function ensureRequestHook(ses) {
  if (!ses || !ses.webRequest) return null;
  let state = blockState.get(ses);
  if (state) return state;
  state = { enabled: false, filtri: false };
  blockState.set(ses, state);
  // UNICO choke point onBeforeRequest per sessione: Electron consente un solo
  // listener per evento per sessione (una seconda registrazione SOSTITUISCE la
  // prima), quindi il blocco tracker (curato) e il motore ad-blocking (liste)
  // devono convivere qui dentro. I due hanno gate indipendenti: il tracker è
  // legato alla modalità cookie (s.enabled), l'ad-blocking ha il suo toggle.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (hostChiusoFn && hostChiusoFn(details.url)) {
      callback({ cancel: true });
      return;
    }
    const s = blockState.get(ses);
    if (!s || !s.filtri || (permessoFn && permessoFn(details))) {
      callback({ cancel: false });
      return;
    }
    if (s.enabled && isTrackerUrl(details.url)) {
      callback({ cancel: true });
      return;
    }
    let ad = null;
    try { ad = require('./adblock'); } catch (_) {}
    if (ad && ad.shouldBlock && ad.shouldBlock(details.url)) {
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
  return state;
}

function applyTrackerBlocking(ses, enabled) {
  const state = ensureRequestHook(ses);
  if (!state) return;
  state.filtri = true;
  state.enabled = !!enabled;
}

// ─── sessioni per-sito (modalità privacy) ─────────────────────────────────

const { registerFiloProtocolForSession } = require('../protocol');

const siteSessions = new Map(); // partition name → session

// Ritorna (creando se serve) la sessione effimera/persistente per la partizione
// data, registrandovi il protocollo filo:// e applicando GPC + blocco tracker.
function ensureSiteSession(partition, { gpc } = {}) {
  let ses = siteSessions.get(partition);
  if (!ses) {
    ses = session.fromPartition(partition);
    try { registerFiloProtocolForSession(ses); } catch (_) {}
    siteSessions.set(partition, ses);
    if (!partition.startsWith('persist:')) seguiUscite(partition, ses);
  }
  const on = gpc !== false;
  applyGpc(ses, on);
  // applyTrackerBlocking registra l'UNICO onBeforeRequest che copre sia il
  // blocco tracker sia il motore ad-blocking (vedi la nota lì): così anche i
  // jar per-sito della modalità privacy ricevono l'ad-blocking, non solo la
  // sessione di default.
  applyTrackerBlocking(ses, on);
  return ses;
}

// ─── uscita dal sito (modalità privacy) ───────────────────────────────────
//
// Un jar effimero si butta quando nessun webContents lo usa più (schede di ogni finestra, popup) e nessuno
// scaricamento ci passa, dopo un margine: chiudere per sbaglio e riaprire subito non fa uscire dal sito (#756).
const MARGINE_USCITA_MS = 5 * 60 * 1000;
let margineUscita = MARGINE_USCITA_MS;
const jarGen = new Map();          // base → { n: generazione in uso, svuota: generazioni che si stanno svuotando }
const sitoDelJar = new Map();      // base → eTLD+1
const jarDellaSessione = new WeakMap();
const uscite = new Map();          // partizione → timer
const scaricamenti = new Map();    // partizione → Set<DownloadItem>
const seguiti = new Set();         // partizioni già seguite: un secondo giro raddoppierebbe i listener
const fidatiDaButtare = new Set(); // partizioni persist: di siti tolti dai fidati, in attesa che il sito si chiuda
let seguendo = false;

// Manopola dei test: senza argomento torna al margine vero.
function impostaMargineUscita(ms) {
  margineUscita = Number.isFinite(ms) && ms >= 0 ? ms : MARGINE_USCITA_MS;
}

function seguiUscite(partition, ses) {
  if (seguiti.has(partition)) return;
  seguiti.add(partition);
  jarDellaSessione.set(ses, partition);
  try {
    ses.on('will-download', (_e, item) => {
      let set = scaricamenti.get(partition);
      if (!set) scaricamenti.set(partition, (set = new Set()));
      set.add(item);
      item.on('updated', (_ev, state) => { if (state === 'interrupted') armaUscita(partition); });
      item.once('done', () => { set.delete(item); armaUscita(partition); });
    });
  } catch (_) {}
  if (seguendo) return;
  seguendo = true;
  require('electron').app.on('web-contents-created', (_e, wc) => {
    let p = null;
    try { p = jarDellaSessione.get(wc.session); } catch (_) {}
    if (p) wc.once('destroyed', () => armaUscita(p));
  });
}

// Un jar persistente si butta solo se il sito è stato tolto dai fidati: finché è fidato resta, è la sua eccezione.
function daButtare(partition) {
  return !partition.startsWith('persist:') || fidatiDaButtare.has(partition);
}

function armaUscita(partition) {
  if (!daButtare(partition)) return;
  clearTimeout(uscite.get(partition));
  const t = setTimeout(() => { uscite.delete(partition); controllaUscita(partition); }, margineUscita);
  uscite.set(partition, t);
}

function inUso(partition, ses) {
  try {
    const { webContents } = require('electron');
    if (webContents.getAllWebContents().some((wc) => !wc.isDestroyed() && wc.session === ses)) return true;
  } catch (_) { return true; }
  for (const item of scaricamenti.get(partition) || []) {
    try { if (item.getState() === 'progressing') return true; } catch (_) {}
  }
  return false;
}

function controllaUscita(partition) {
  if (!daButtare(partition)) return;
  const ses = siteSessions.get(partition);
  if (ses && !inUso(partition, ses)) buttaJar(partition, ses);
}

// Il sito non è più un'eccezione: quello che aveva salvato se ne va come per gli altri siti, ma mai mentre
// è aperto in una scheda (lo butterebbe fuori a metà sessione): lì aspetta che la chiuda, come un jar normale.
function dimenticaFidato(site) {
  const partition = 'persist:' + baseDelSito(site);
  let ses = siteSessions.get(partition);
  try { if (!ses) ses = session.fromPartition(partition); } catch (_) { return; }
  siteSessions.set(partition, ses);
  sitoDelJar.set(partition, site);
  fidatiDaButtare.add(partition);
  seguiUscite(partition, ses);
  // Le schede già aperte sono nate prima che seguissimo questo jar: la loro chiusura va agganciata adesso.
  try {
    for (const wc of require('electron').webContents.getAllWebContents()) {
      if (!wc.isDestroyed() && wc.session === ses) wc.once('destroyed', () => armaUscita(partition));
    }
  } catch (_) {}
  if (inUso(partition, ses)) return;
  buttaJar(partition, ses);
}

// Un sito tolto dai fidati mentre la sua scheda era aperta, e Filo chiuso prima che la chiudesse, lascerebbe
// il suo jar sul disco per sempre: qui se ne vanno tutti quelli che non sono più fidati, da qualunque strada.
function spazzaFidatiOrfani(trusted) {
  let nomi = [];
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(require('electron').app.getPath('userData'), 'Partitions');
    nomi = fs.readdirSync(dir, { withFileTypes: true })
      .filter((v) => v.isDirectory() && v.name.startsWith('filo-priv-'))
      .map((v) => v.name);
  } catch (_) { return; }
  const vivi = new Set([...trusted].map((s) => baseDelSito(s)));
  for (const nome of nomi) {
    if (vivi.has(nome)) continue;
    const partition = 'persist:' + nome;
    try {
      const ses = siteSessions.get(partition) || session.fromPartition(partition);
      if (inUso(partition, ses)) continue;   // la scheda è ancora aperta: aspetta che la chiuda
      siteSessions.set(partition, ses);
      fidatiDaButtare.add(partition);
      buttaJar(partition, ses);
    } catch (_) {}
  }
}

// Rimesso fra i fidati prima che il suo jar se ne andasse: resta dov'è, l'utente ha disdetto.
function tieniFidato(site) {
  const partition = 'persist:' + baseDelSito(site);
  if (!fidatiDaButtare.delete(partition)) return;
  clearTimeout(uscite.get(partition));
  uscite.delete(partition);
}

// Il sito riparte subito in un'altra generazione: chi lo riapre mentre il vecchio jar si svuota non perde i cookie a metà.
function buttaJar(partition, ses) {
  const [base, gen] = partition.split('~');
  const idx = Number(gen) || 0;
  let g = jarGen.get(base);
  if (!g) jarGen.set(base, (g = { n: 0, svuota: new Set() }));
  g.svuota.add(idx);
  if (g.n === idx) {
    let i = 0;
    while (g.svuota.has(i)) i++;
    g.n = i;
  }
  scaricamenti.delete(partition);
  fidatiDaButtare.delete(partition);
  try { require('./permessiPagine').dimenticaSessione(ses); } catch (_) {}
  const pulisci = (fn) => Promise.resolve().then(fn).catch(() => {});
  Promise.all([
    pulisci(() => (typeof ses.clearData === 'function' ? ses.clearData() : Promise.all([ses.clearStorageData(), ses.clearCache()]))),
    pulisci(() => ses.clearAuthCache()),
    pulisci(() => typeof ses.closeAllConnections === 'function' && ses.closeAllConnections()),
  ]).then(() => g.svuota.delete(idx));
  const site = sitoDelJar.get(base);
  try { if (site && jarWipe) jarWipe(site); } catch (_) {}
}

let jarWipe = null;
function setJarWipeHandler(fn) { jarWipe = typeof fn === 'function' ? fn : null; }

// Decide quale partizione deve usare una WebContentsView per `url` nella
// modalità corrente. Ritorna:
//   - { partition: null }            → usa la sessione di default della finestra
//                                       (modalità manual/default, o pagine filo://,
//                                       o finestra incognito che ha già la sua).
//   - { partition: 'filo-priv-...' } → modalità privacy, sito effimero.
//   - { partition: 'persist:filo-priv-...' } → modalità privacy, sito fidato.
function partitionForTab(url, { mode, incognito, trusted } = {}) {
  if (incognito) return { partition: null };           // incognito ha già il suo jar
  if (mode !== MODES.PRIVACY) return { partition: null };
  if (!url || /^filo:\/\//i.test(url)) return { partition: null };
  const trustedSet = trusted instanceof Set ? trusted : new Set(
    (Array.isArray(trusted) ? trusted : []).map((d) => String(d || '').toLowerCase()),
  );
  const partition = partitionForUrl(url, trustedSet);
  if (!partition) return { partition: null };
  ensureSiteSession(partition, { gpc: true });
  return { partition };
}

// ─── configurazione globale (GPC + blocco tracker) ─────────────────────────

// Applica GPC e blocco tracker alla sessione di default in base alla modalità.
// Chiamato all'avvio e a ogni UPDATE_SETTINGS. Le sessioni per-sito ricevono lo
// stesso trattamento quando vengono create (ensureSiteSession). In manual tutto
// è spento.
function configureForMode(mode) {
  const on = mode !== MODES.MANUAL;
  applyGpc(session.defaultSession, on);
  applyTrackerBlocking(session.defaultSession, on);
  for (const ses of siteSessions.values()) {
    applyGpc(ses, on);
    applyTrackerBlocking(ses, on);
  }
}

// Ultima modalità/siti fidati visti, così before-quit (sincrono) può lanciare il
// wipe senza dover rileggere lo storage in modo asincrono.
let _cached = { mode: MODES.DEFAULT, trustedSites: [], bannerSites: [] };
let _configured = false;
// Impostazioni cambiate da una finestra incognito: valgono solo lì, il profilo normale non le vede (#754).
// null = l'incognito non ha cambiato niente e vede quelle del profilo normale.
let _incognito = null;

function inIncognito() {
  try { return !!require('../shim/storage').inIncognito(); } catch (_) { return false; }
}

function incognitoSessions() {
  try {
    const { BrowserWindow } = require('electron');
    return BrowserWindow.getAllWindows()
      .filter((w) => w._filoIncognito && w._filoTabs && w._filoTabs.partition)
      .map((w) => session.fromPartition(w._filoTabs.partition));
  } catch (_) { return []; }
}

// Un sito che entra o esce dall'elenco coi banner dimentica la risposta data: se no il banner non torna
// (entra) o resta la scelta fatta a mano (esce). Vale per ogni strada: menu della scheda, Sicurezza, import.
// I cookie si tolgono qui; la memoria della pagina e cosa Filo sapeva del sito li toglie `listChange`.
function wipeChanged(prev, next, sessions, scope) {
  for (const site of new Set([...prev, ...next])) {
    if (prev.includes(site) === next.includes(site)) continue;
    const answer = answerOf(site);
    for (const ses of sessions) wipeConsentCookies(ses, site, answer.cookies).catch(() => {});
    try { if (listChange) listChange(site, answer, scope); } catch (_) {}
  }
}

let listChange = null;
function setListChangeHandler(fn) { listChange = typeof fn === 'function' ? fn : null; }

// Modalità o elenchi cambiati: chi tiene dati per sito li riguarda (tabs/tabCookies.js, cosa resta sul disco).
let configChange = null;
function setConfigChangeHandler(fn) { configChange = typeof fn === 'function' ? fn : null; }

// Un sito entra o esce dai fidati, da qualunque strada (proposta, menu della scheda, chat, Sicurezza, import,
// annulla): chi tiene le schede (tabs/tabRestaConnesso.js) sposta l'accesso nel jar giusto.
let trustChange = null;
function setTrustChangeHandler(fn) { trustChange = typeof fn === 'function' ? fn : null; }
function fiduciaCambiata(prev, next) {
  if (!trustChange) return;
  const norma = (l) => new Set(l.map((d) => String(d || '').toLowerCase()).filter(Boolean));
  const prima = norma(prev);
  const dopo = norma(next);
  for (const s of dopo) if (!prima.has(s)) { try { trustChange(s, true); } catch (_) {} }
  for (const s of prima) if (!dopo.has(s)) { try { trustChange(s, false); } catch (_) {} }
}

function sitoFidato(url) {
  const reg = /^https?:/i.test(String(url || '')) ? registrableOf(url) : null;
  return !!reg && trustedSetOf({ security: { cookies: _cached } }).has(reg);
}

// In Privacy un sito non fidato non tiene niente oltre la sessione, nemmeno quello che Filo sa di lui.
function keepsSiteData(site) {
  if (_cached.mode !== MODES.PRIVACY) return true;
  const s = String(site || '').toLowerCase();
  return _cached.trustedSites.some((d) => String(d || '').toLowerCase() === s);
}

// I nomi che il sito ha dato alla sua risposta, visti dopo il clic sul banner: li tiene tabs/tabCookies.js.
let answerLookup = null;
function setAnswerLookup(fn) { answerLookup = typeof fn === 'function' ? fn : null; }
function answerOf(site) {
  try { const a = answerLookup && answerLookup(site); if (a) return { cookies: a.cookies || [], storage: a.storage || [] }; } catch (_) {}
  return { cookies: [], storage: [] };
}

// Ritorna true se cambia qualcosa che le pagine devono sapere (modalità o siti coi banner).
function configureFromSettings(settings) {
  if (inIncognito()) {
    const prev = _incognito || _cached;
    _incognito = { mode: getMode(settings), bannerSites: getBannerSites(settings) };
    wipeChanged(prev.bannerSites, _incognito.bannerSites, incognitoSessions(), { normal: false, incognito: true });
    return prev.mode !== _incognito.mode || prev.bannerSites.join('\n') !== _incognito.bannerSites.join('\n');
  }
  const prev = _cached.bannerSites;
  const prevMode = _cached.mode;
  const prevTrustedList = _cached.trustedSites;
  const prevTrusted = prevTrustedList.join('\n');
  _cached = { mode: getMode(settings), trustedSites: getTrustedSites(settings), bannerSites: getBannerSites(settings) };
  configureForMode(_cached.mode);
  const changed = prevMode !== _cached.mode || prev.join('\n') !== _cached.bannerSites.join('\n');
  if (_configured) {
    wipeChanged(prev, _cached.bannerSites, [session.defaultSession, ...siteSessions.values(), ...(_incognito ? [] : incognitoSessions())],
      { normal: true, incognito: !_incognito });
  }
  const trustedOra = _cached.trustedSites.join('\n');
  if (!_configured || prevTrusted !== trustedOra) {
    const prima = new Set(prevTrusted.split('\n').map((d) => d.toLowerCase()).filter(Boolean));
    const adesso = trustedSetOf(settings);
    if (_configured) {
      for (const site of prima) if (!adesso.has(site)) dimenticaFidato(site);
      for (const site of adesso) if (!prima.has(site)) tieniFidato(site);
    }
    spazzaFidatiOrfani(adesso);
    if (_configured) fiduciaCambiata(prevTrustedList, _cached.trustedSites);
  }
  _configured = true;
  if (prevMode !== _cached.mode || prevTrusted !== trustedOra) {
    try { if (configChange) configChange(); } catch (_) {}
  }
  return changed;
}

// Chiusa l'ultima finestra incognito: la prossima riparte dalle impostazioni del profilo normale.
function resetIncognito() { _incognito = null; }

function profile(incognito) { return (incognito && _incognito) || _cached; }

function currentMode(incognito) { return profile(incognito).mode; }

function isBannerSite(url, incognito) { return isBannerSiteIn(profile(incognito).bannerSites, url); }

// Wipe usando l'ultima configurazione vista (per before-quit). Ritorna una
// promessa che si risolve quando i cookie dei tracker sono stati rimossi.
function wipeOnExit() {
  return wipeTrackerCookies({ security: { cookies: _cached } });
}

// ─── wipe mirato dei cookie-tracker (modalità default) ──────────────────────
//
// In 'default' (Automatico) NON cancelliamo i cookie funzionali: le scelte e i
// login dell'utente devono restare. Ripuliamo solo eventuali cookie il cui
// dominio è un tracker noto (per lo più già bloccati a monte, ma possono essere
// rimasti da prima di attivare l'Automatico o da una sessione precedente). In
// 'privacy' le sessioni sono effimere e non serve. In 'manual' non tocchiamo
// nulla.
async function wipeTrackerCookies(settings) {
  if (getMode(settings) !== MODES.DEFAULT) return { removed: 0, skipped: true };
  const ses = session.defaultSession;
  let cookies = [];
  try { cookies = await ses.cookies.get({}); } catch (_) { return { removed: 0 }; }
  let removed = 0;
  await Promise.all(cookies.map(async (c) => {
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain) return;
    if (!isTrackerHost(domain)) return;        // tieni i cookie funzionali
    const url = (c.secure ? 'https://' : 'http://') + domain + (c.path || '/');
    try { await ses.cookies.remove(url, c.name); removed++; } catch (_) {}
  }));
  return { removed };
}

// ─── «mostra il banner»: via la risposta che il sito si era segnato ──────────
//
// Un banner rifiutato non ricompare da solo: il sito ha scritto la scelta in un cookie. Si tolgono solo i
// cookie di consenso del sito (nomi dei CMP noti), mai login o carrello; lo stesso per la memoria della pagina.
const CONSENT_NAME = /(consent|euconsent|cookielaw|optanon|onetrust|didomi|cookiebot|cybot|^_sp_|sp_consent|cmp|cmapi|cmplz|borlabs|_iub_cs|iubenda|notice_(gdpr|pref|behavior)|usprivacy|gdpr|cookieyes|cky-|^uc_|usercentrics|osano|truste|tarteaucitron|klaro|axeptio|cookiefirst|termly|viewed_cookie_policy|cookie_?notice|cookie_?banner|cookies?_?accepted|cookie_?policy)/i;

function isConsentName(name) {
  return CONSENT_NAME.test(String(name || ''));
}

// `names`: i cookie che il sito ha scritto come risposta dopo il clic, qualunque nome abbiano.
async function wipeConsentCookies(ses, site, names) {
  if (!ses || !ses.cookies || !site) return 0;
  const extra = new Set(Array.isArray(names) ? names : []);
  let all = [];
  try { all = await ses.cookies.get({}); } catch (_) { return 0; }
  let removed = 0;
  await Promise.all(all.map(async (c) => {
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (!(domain === site || domain.endsWith('.' + site))) return;
    if (!isConsentName(c.name) && !extra.has(c.name)) return;
    const url = (c.secure ? 'https://' : 'http://') + domain + (c.path || '/');
    try { await ses.cookies.remove(url, c.name); removed++; } catch (_) {}
  }));
  return removed;
}

module.exports = {
  MODES,
  getMode,
  getTrustedSites,
  getBannerSites,
  isBannerSiteIn,
  isBannerSite,
  currentMode,
  isConsentName,
  wipeConsentCookies,
  setListChangeHandler,
  setConfigChangeHandler,
  setTrustChangeHandler,
  sitoFidato,
  partitionForSite,
  cookieDaCopiare,
  copiaBarattolo,
  sessioneEffimera,
  setJarWipeHandler,
  impostaMargineUscita,
  keepsSiteData,
  setAnswerLookup,
  resetIncognito,
  registrableOf,
  isTrackerHost,
  isTrackerUrl,
  partitionForUrl,
  partitionForTab,
  ensureHeaderHook,
  applyGpc,
  applyTrackerBlocking,
  ensureRequestHook,
  chiudiHost,
  permettiRichieste,
  ensureSiteSession,
  configureForMode,
  configureFromSettings,
  wipeTrackerCookies,
  wipeOnExit,
};
