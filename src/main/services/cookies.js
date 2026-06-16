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

function trustedSetOf(settings) {
  return new Set(getTrustedSites(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean));
}

// eTLD+1 di un URL, via il normalizzatore della pipeline safebrowse (PSL).
// Fallback all'hostname grezzo se il normalizzatore non è disponibile o l'URL
// non ha un dominio analizzabile (es. IP, localhost).
function registrableOf(url) {
  try {
    const SB = globalThis.SN_SAFEBROWSE;
    if (SB && typeof SB.normalize === 'function') {
      const norm = SB.normalize(url);
      if (norm && norm.registrable) return norm.registrable;
    }
  } catch (_) {}
  try { return new URL(url).hostname.toLowerCase() || null; } catch (_) { return null; }
}

// Chiave di partizione per-sito in modalità privacy. Slug sicuro per il nome di
// partizione Electron (solo [a-z0-9.-]). Se il sito è "fidato" la partizione è
// PERSISTENTE ('persist:'): resta isolata per-sito ma sopravvive alla sessione,
// così l'utente resta connesso. Altrimenti è effimera (in RAM).
function partitionForUrl(url, trusted) {
  const reg = registrableOf(url);
  if (!reg) return null;
  const slug = reg.replace(/[^a-z0-9.-]/gi, '_');
  const base = 'filo-priv-' + slug;
  const isTrusted = trusted instanceof Set && trusted.has(reg);
  // 'persist:' → jar isolato per-sito ma persistente (resta connesso).
  // Senza prefisso → jar isolato ed effimero: niente correlazione cross-site e
  // niente sopravvive alla sessione.
  return (isTrusted ? 'persist:' : '') + base;
}

// ─── GPC: header Sec-GPC: 1 ───────────────────────────────────────────────
//
// Una sola registrazione onBeforeSendHeaders per sessione (Electron consente un
// solo listener per evento/sessione). Il flag enabled è in una mappa così
// possiamo accendere/spegnere GPC senza ri-registrare.

const gpcState = new WeakMap(); // session → { enabled }

function applyGpc(ses, enabled) {
  if (!ses || !ses.webRequest) return;
  let state = gpcState.get(ses);
  if (!state) {
    state = { enabled: !!enabled };
    gpcState.set(ses, state);
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const s = gpcState.get(ses);
      if (s && s.enabled) {
        const headers = { ...details.requestHeaders, 'Sec-GPC': '1' };
        callback({ requestHeaders: headers });
      } else {
        callback({ requestHeaders: details.requestHeaders });
      }
    });
  } else {
    state.enabled = !!enabled;
  }
}

// ─── blocco tracker: cancella le richieste ai tracker noti ──────────────────
//
// Una sola registrazione onBeforeRequest per sessione (come per GPC). Quando
// attivo, ogni richiesta verso un host-tracker viene annullata: lo script non
// si carica, il cookie non viene creato, nessun dato parte.

const blockState = new WeakMap(); // session → { enabled }

function applyTrackerBlocking(ses, enabled) {
  if (!ses || !ses.webRequest) return;
  let state = blockState.get(ses);
  if (!state) {
    state = { enabled: !!enabled };
    blockState.set(ses, state);
    // UNICO choke point onBeforeRequest per sessione: Electron consente un solo
    // listener per evento per sessione (una seconda registrazione SOSTITUISCE la
    // prima), quindi il blocco tracker (curato) e il motore ad-blocking (liste)
    // devono convivere qui dentro. I due hanno gate indipendenti: il tracker è
    // legato alla modalità cookie (s.enabled), l'ad-blocking ha il suo toggle.
    ses.webRequest.onBeforeRequest((details, callback) => {
      const s = blockState.get(ses);
      if (s && s.enabled && isTrackerUrl(details.url)) {
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
  } else {
    state.enabled = !!enabled;
  }
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
  }
  const on = gpc !== false;
  applyGpc(ses, on);
  applyTrackerBlocking(ses, on);
  // Anche il motore ad-blocking (liste) deve coprire i jar per-sito della
  // modalità privacy, non solo la sessione di default. Il toggle vive in
  // adblock.js: qui registriamo solo il filtro su questa sessione.
  try { require('./adblock').applyAdblock(ses); } catch (_) {}
  return ses;
}

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
let _cached = { mode: MODES.DEFAULT, trustedSites: [] };

function configureFromSettings(settings) {
  _cached = { mode: getMode(settings), trustedSites: getTrustedSites(settings) };
  configureForMode(_cached.mode);
}

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

module.exports = {
  MODES,
  getMode,
  getTrustedSites,
  registrableOf,
  isTrackerHost,
  isTrackerUrl,
  partitionForUrl,
  partitionForTab,
  applyGpc,
  applyTrackerBlocking,
  ensureSiteSession,
  configureForMode,
  configureFromSettings,
  wipeTrackerCookies,
  wipeOnExit,
};
