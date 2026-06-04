// Gestione cookie / consenso (processo main).
//
// Un solo interruttore a 3 stati (settings.security.cookies.mode):
//   - 'manual'  → nessuna gestione automatica.
//   - 'default' → GPC + rifiuto CMP + YouTube nocookie (content script), e
//                 all'uscita cancella i cookie TRANNE i domini whitelisted.
//   - 'privacy' → come default + ogni sito ha un cookie jar isolato ed effimero
//                 (partizione Electron dedicata, senza 'persist:').
//
// Questo modulo si occupa SOLO della parte main-process:
//   - emette l'header Sec-GPC: 1 sulle sessioni (onBeforeSendHeaders);
//   - risolve la sessione/partizione per ogni navigazione top-level;
//   - cancella i cookie non-whitelisted (wipe).
// Il rifiuto dei banner CMP e la riscrittura degli embed YouTube vivono nel
// content script src/content/cookies.js. L'iniezione di
// navigator.globalPrivacyControl avviene in tabs.js (mondo della pagina).

'use strict';

const { session } = require('electron');

const MODES = { MANUAL: 'manual', DEFAULT: 'default', PRIVACY: 'privacy' };

function getMode(settings) {
  const m = settings && settings.security && settings.security.cookies && settings.security.cookies.mode;
  return m === MODES.MANUAL || m === MODES.PRIVACY ? m : MODES.DEFAULT;
}

function getLoginWhitelist(settings) {
  const wl = settings && settings.security && settings.security.cookies && settings.security.cookies.loginWhitelist;
  return Array.isArray(wl) ? wl : [];
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
// partizione Electron (solo [a-z0-9.-]).
function partitionForUrl(url) {
  const reg = registrableOf(url);
  if (!reg) return null;
  const slug = reg.replace(/[^a-z0-9.-]/gi, '_');
  // NIENTE prefisso 'persist:' → sessione effimera in RAM: isolata per sito e
  // cancellata alla chiusura. Realizza sia "niente correlazione cross-site" sia
  // "niente sopravvive alla sessione".
  return 'filo-priv-' + slug;
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

// ─── sessioni per-sito (modalità privacy) ─────────────────────────────────

const { registerFiloProtocolForSession } = require('../protocol');

const siteSessions = new Map(); // partition name → session

// Ritorna (creando se serve) la sessione effimera per la partizione data,
// registrandovi il protocollo filo:// e applicando GPC. `gpc` segue la modalità.
function ensureSiteSession(partition, { gpc } = {}) {
  let ses = siteSessions.get(partition);
  if (!ses) {
    ses = session.fromPartition(partition);
    try { registerFiloProtocolForSession(ses); } catch (_) {}
    siteSessions.set(partition, ses);
  }
  applyGpc(ses, gpc !== false);
  return ses;
}

// Decide quale partizione deve usare una WebContentsView per `url` nella
// modalità corrente. Ritorna:
//   - { partition: null }            → usa la sessione di default della finestra
//                                       (modalità manual/default, o pagine filo://,
//                                       o finestra incognito che ha già la sua).
//   - { partition: 'filo-priv-...' } → modalità privacy su pagina esterna.
function partitionForTab(url, { mode, incognito } = {}) {
  if (incognito) return { partition: null };           // incognito ha già il suo jar
  if (mode !== MODES.PRIVACY) return { partition: null };
  if (!url || /^filo:\/\//i.test(url)) return { partition: null };
  const partition = partitionForUrl(url);
  if (!partition) return { partition: null };
  ensureSiteSession(partition, { gpc: true });
  return { partition };
}

// ─── configurazione globale GPC ────────────────────────────────────────────

// Applica GPC alla sessione di default in base alla modalità. Chiamato all'avvio
// e a ogni UPDATE_SETTINGS. Le sessioni per-sito ricevono GPC quando vengono
// create (ensureSiteSession). In manual GPC è spento.
function configureForMode(mode) {
  const on = mode !== MODES.MANUAL;
  applyGpc(session.defaultSession, on);
  for (const ses of siteSessions.values()) applyGpc(ses, on);
}

// Ultima modalità/whitelist viste, così before-quit (sincrono) può lanciare il
// wipe senza dover rileggere lo storage in modo asincrono.
let _cached = { mode: MODES.DEFAULT, loginWhitelist: [] };

function configureFromSettings(settings) {
  _cached = { mode: getMode(settings), loginWhitelist: getLoginWhitelist(settings) };
  configureForMode(_cached.mode);
}

// Wipe usando l'ultima configurazione vista (per before-quit). Ritorna una
// promessa che si risolve quando i cookie non-whitelisted sono stati rimossi.
function wipeOnExit() {
  return wipeNonWhitelisted({ security: { cookies: _cached } });
}

// ─── wipe dei cookie non-whitelisted (modalità default) ─────────────────────

// In 'default' la promessa è "nessun profilo persistente": cancelliamo i cookie
// della sessione persistente di default TRANNE quelli dei domini whitelisted
// ("resta connesso qui"). In 'privacy' le sessioni sono effimere e non serve
// (svaniscono da sole). In 'manual' non tocchiamo nulla.
async function wipeNonWhitelisted(settings) {
  if (getMode(settings) !== MODES.DEFAULT) return { removed: 0, skipped: true };
  const whitelist = new Set(
    getLoginWhitelist(settings).map((d) => String(d || '').toLowerCase()).filter(Boolean),
  );
  const ses = session.defaultSession;
  let cookies = [];
  try { cookies = await ses.cookies.get({}); } catch (_) { return { removed: 0 }; }
  let removed = 0;
  await Promise.all(cookies.map(async (c) => {
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain) return;
    const reg = registrableOf('http://' + domain) || domain;
    // Esente se il dominio (o il suo eTLD+1) è whitelisted.
    if (whitelist.has(domain) || whitelist.has(reg)) return;
    const url = (c.secure ? 'https://' : 'http://') + domain + (c.path || '/');
    try { await ses.cookies.remove(url, c.name); removed++; } catch (_) {}
  }));
  return { removed };
}

module.exports = {
  MODES,
  getMode,
  getLoginWhitelist,
  registrableOf,
  partitionForUrl,
  partitionForTab,
  applyGpc,
  ensureSiteSession,
  configureForMode,
  configureFromSettings,
  wipeNonWhitelisted,
  wipeOnExit,
};
