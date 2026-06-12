// Proxy per-tab — "Apri da un altro paese" (vedi proxy-per-tab-spec.md).
//
// Questo modulo è l'astrazione ProxyProvider: traduce (paese, tier) in una
// configurazione proxy applicabile a una session Electron. NESSUN provider
// commerciale è integrato qui: l'endpoint arriva da env o impostazioni come
// template URL, con `{country}` sostituito dal codice paese — è il formato
// con cui i provider reali fanno il geo-targeting (di solito nel campo
// username, es. `socks5://user-{country}:pass@gate.provider.com:7000`).
//
// Config (env vince sulle impostazioni, così i test e il deploy non toccano
// lo storage utente):
//   FILO_PROXY_DATACENTER  / settings.proxy.datacenter   → tier default
//   FILO_PROXY_RESIDENTIAL / settings.proxy.residential  → tier fallback
//   FILO_PROXY_BYPASS      / settings.proxy.bypass       → proxyBypassRules
//
// Anti-leak DNS: con schema socks5 Chromium risolve i nomi LATO PROXY
// (semantica socks5h) — verificato dal test di accettazione in
// tests/proxy-tab.spec.mjs, che fa caricare un hostname irrisolvibile in
// locale attraverso un SOCKS5 di test. L'anti-leak WebRTC vive in tabs.js
// (_applySecurity: policy disable_non_proxied_udp sulle tab proxate).
//
// Niente require('electron') a livello di modulo: la parte pura (resolve,
// parsing) deve girare anche sotto node:test (tests/unit/).

'use strict';

// Location curate per la UI (~7, non 50 — vedi spec §3). Il codice paese è
// ISO 3166-1 alpha-2 minuscolo; `resolve` accetta comunque qualsiasi codice
// a 2 lettere (il linguaggio naturale può chiedere paesi fuori lista).
const LOCATIONS = [
  { code: 'us', label: 'Stati Uniti', flag: '🇺🇸' },
  { code: 'gb', label: 'Regno Unito', flag: '🇬🇧' },
  { code: 'fr', label: 'Francia', flag: '🇫🇷' },
  { code: 'de', label: 'Germania', flag: '🇩🇪' },
  { code: 'es', label: 'Spagna', flag: '🇪🇸' },
  { code: 'nl', label: 'Paesi Bassi', flag: '🇳🇱' },
  { code: 'jp', label: 'Giappone', flag: '🇯🇵' },
];

// Due tier di costo (spec §1): datacenter è il default, residenziale è il
// fallback quando il sito blocca gli IP datacenter (decisione che vive nel
// livello "regole d'azione", feedback separato — qui solo la selezione).
const TIERS = { DATACENTER: 'datacenter', RESIDENTIAL: 'residential' };

// Codice paese normalizzato ('FR' → 'fr') o null se non è un alpha-2 valido.
function normalizeCountry(country) {
  const c = String(country || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : null;
}

function normalizeTier(tier) {
  return tier === TIERS.RESIDENTIAL ? TIERS.RESIDENTIAL : TIERS.DATACENTER;
}

// Config effettiva del provider: env > impostazioni. `settings` è l'oggetto
// delle impostazioni (può mancare), `env` è iniettabile per i test.
function configFrom(settings, env = process.env) {
  const s = (settings && settings.proxy) || {};
  return {
    datacenter: String(env.FILO_PROXY_DATACENTER || s.datacenter || '').trim(),
    residential: String(env.FILO_PROXY_RESIDENTIAL || s.residential || '').trim(),
    bypass: String(env.FILO_PROXY_BYPASS || s.bypass || '').trim(),
  };
}

function isConfigured(settings, env = process.env) {
  return !!configFrom(settings, env).datacenter;
}

// Sostituisce {country}/{COUNTRY} nel template e separa le credenziali
// dall'endpoint: Chromium non accetta user:pass dentro proxyRules — per i
// proxy HTTP le credenziali passano dall'evento `login` (vedi sotto); per
// SOCKS5 Chromium non supporta l'autenticazione (i provider usano l'IP
// whitelisting o il geo-targeting via username su HTTP).
function endpointFor(template, country) {
  const filled = String(template)
    .replace(/\{country\}/g, country)
    .replace(/\{COUNTRY\}/g, country.toUpperCase());
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(filled) ? filled : `socks5://${filled}`;
  let u;
  try { u = new URL(withScheme); } catch (_) { return null; }
  if (!u.hostname) return null;
  const scheme = u.protocol.replace(/:$/, '');
  const hostPort = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  const auth = u.username
    ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') }
    : null;
  return { proxyRules: `${scheme}://${hostPort}`, auth };
}

// (paese, tier) → { proxyRules, bypassRules, auth, country, tier } oppure
// null se il tier richiesto non è configurato. Non fa fallback fra tier:
// la scelta datacenter→residenziale è una decisione del chiamante.
function resolve(country, { tier, settings, env } = {}) {
  const code = normalizeCountry(country);
  if (!code) return null;
  const t = normalizeTier(tier);
  const cfg = configFrom(settings, env || process.env);
  const template = t === TIERS.RESIDENTIAL ? cfg.residential : cfg.datacenter;
  if (!template) return null;
  const ep = endpointFor(template, code);
  if (!ep) return null;
  return {
    country: code,
    tier: t,
    proxyRules: ep.proxyRules,
    bypassRules: cfg.bypass || '',
    auth: ep.auth,
  };
}

// ─── credenziali proxy HTTP: registro partition → auth ─────────────────────
// Chromium chiede le credenziali del proxy con l'evento `login` su app
// (authInfo.isProxy). Mappiamo la session della partition proxata alle sue
// credenziali; l'handler globale risponde solo per le session registrate.

const authBySession = new Map(); // partition → { ses, auth }
let loginWired = false;

function wireLoginHandler() {
  if (loginWired) return;
  let app = null;
  try { ({ app } = require('electron')); } catch (_) { return; }
  if (!app || typeof app.on !== 'function') return;
  loginWired = true;
  app.on('login', (event, webContents, _request, authInfo, callback) => {
    if (!authInfo || !authInfo.isProxy || !webContents) return;
    for (const { ses, auth } of authBySession.values()) {
      if (webContents.session === ses) {
        event.preventDefault();
        try { callback(auth.username, auth.password); } catch (_) {}
        return;
      }
    }
  });
}

// Registra (o rimuove, con auth=null) le credenziali per una partition proxata.
function setPartitionAuth(partition, ses, auth) {
  if (auth && auth.username) {
    authBySession.set(partition, { ses, auth });
    wireLoginHandler();
  } else {
    authBySession.delete(partition);
  }
}

function clearPartitionAuth(partition) {
  authBySession.delete(partition);
}

module.exports = {
  LOCATIONS,
  TIERS,
  normalizeCountry,
  normalizeTier,
  configFrom,
  isConfigured,
  endpointFor,
  resolve,
  setPartitionAuth,
  clearPartitionAuth,
};
