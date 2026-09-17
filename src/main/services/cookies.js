// Cookie e consenso, lato main: GPC, blocco dei tracker, partizione per sito, wipe mirato.
// Modalità in settings.security.cookies.mode: manual, default, privacy.
// Banner CMP ed embed YouTube stanno in src/content/cookies.js; l'iniezione GPC in tabs.js.

'use strict';

const { session } = require('electron');

const MODES = { MANUAL: 'manual', DEFAULT: 'default', PRIVACY: 'privacy' };

// Solo host DEDICATI al tracciamento: un dominio buono (google.com) blocca il sito intero.
// Bloccare la richiesta batte cancellare: lo script non si carica e il cookie non nasce.
const TRACKER_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'adservice.google.com',
  'connect.facebook.net',
  'analytics.tiktok.com',
  'static.ads-twitter.com',
  'analytics.twitter.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',
  'ct.pinterest.com',
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

// Siti fidati (eTLD+1) che in modalità privacy restano connessi.
function getTrustedSites(settings) {
  const c = settings && settings.security && settings.security.cookies;
  const list = (c && (c.trustedSites || c.loginWhitelist)) || [];
  return Array.isArray(list) ? list : [];
}

function trustedSetOf(settings) {
  return new Set(getTrustedSites(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean));
}

// Ripiego sull'hostname grezzo quando non c'è un dominio analizzabile (IP, localhost).
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

// Sito fidato: partizione PERSISTENTE, isolata per sito ma superstite alla sessione, così
// l'utente resta connesso; per gli altri effimera. Il nome è ristretto a [a-z0-9.-].
function partitionForUrl(url, trusted) {
  const reg = registrableOf(url);
  if (!reg) return null;
  const slug = reg.replace(/[^a-z0-9.-]/gi, '_');
  const base = 'filo-priv-' + slug;
  const isTrusted = trusted instanceof Set && trusted.has(reg);
  return (isTrusted ? 'persist:' : '') + base;
}

// Electron ammette un solo onBeforeSendHeaders per sessione: una seconda registrazione
// sostituisce la prima, quindi si registra una volta e si accende col flag nella mappa.

const gpcState = new WeakMap(); // session → { enabled }

// Registra il listener se manca, SENZA toccare lo stato GPC.
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

const blockState = new WeakMap(); // session → { enabled }

function applyTrackerBlocking(ses, enabled) {
  if (!ses || !ses.webRequest) return;
  let state = blockState.get(ses);
  if (!state) {
    state = { enabled: !!enabled };
    blockState.set(ses, state);
    // UNICO onBeforeRequest della sessione: Electron ne ammette uno solo per evento, quindi
    // blocco tracker e ad-blocking convivono qui, con gate indipendenti.
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

const { registerFiloProtocolForSession } = require('../protocol');

const siteSessions = new Map(); // partition name → session

function ensureSiteSession(partition, { gpc } = {}) {
  let ses = siteSessions.get(partition);
  if (!ses) {
    ses = session.fromPartition(partition);
    try { registerFiloProtocolForSession(ses); } catch (_) {}
    siteSessions.set(partition, ses);
  }
  const on = gpc !== false;
  applyGpc(ses, on);
  // L'unico onBeforeRequest copre anche l'ad-blocking: così lo ricevono pure i jar per-sito
  // della modalità privacy, non solo la sessione di default.
  applyTrackerBlocking(ses, on);
  return ses;
}

// partition null = sessione di default della finestra (manual/default, filo://, incognito).
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

// Chiamato all'avvio e a ogni UPDATE_SETTINGS; le sessioni per-sito ricevono lo stesso
// trattamento alla creazione. In manual tutto è spento.
function configureForMode(mode) {
  const on = mode !== MODES.MANUAL;
  applyGpc(session.defaultSession, on);
  applyTrackerBlocking(session.defaultSession, on);
  for (const ses of siteSessions.values()) {
    applyGpc(ses, on);
    applyTrackerBlocking(ses, on);
  }
}

// before-quit è sincrono: tiene l'ultima modalità vista, così il wipe non rilegge storage.
let _cached = { mode: MODES.DEFAULT, trustedSites: [] };

function configureFromSettings(settings) {
  _cached = { mode: getMode(settings), trustedSites: getTrustedSites(settings) };
  configureForMode(_cached.mode);
}

function wipeOnExit() {
  return wipeTrackerCookies({ security: { cookies: _cached } });
}

// In 'default' i cookie funzionali restano (login e scelte dell'utente): si ripuliscono solo
// quelli di dominio tracker. In privacy le sessioni sono effimere, in manual non si tocca.
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
  ensureHeaderHook,
  applyGpc,
  applyTrackerBlocking,
  ensureSiteSession,
  configureForMode,
  configureFromSettings,
  wipeTrackerCookies,
  wipeOnExit,
};
