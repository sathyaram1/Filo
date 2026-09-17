// Proxy per-tab «Apri da un altro paese»: (paese, tier) → config proxy per una session.
// Nessun provider integrato: l'endpoint è un template con `{country}`, da env o settings.
// Con socks5 i nomi li risolve il proxy. Niente electron qui: la parte pura gira sotto node.

'use strict';

// Location curate per la UI; `resolve` accetta comunque qualsiasi codice a due lettere: il
// linguaggio naturale può chiedere paesi fuori lista.
const LOCATIONS = [
  { code: 'us', label: 'Stati Uniti', flag: '🇺🇸' },
  { code: 'gb', label: 'Regno Unito', flag: '🇬🇧' },
  { code: 'fr', label: 'Francia', flag: '🇫🇷' },
  { code: 'de', label: 'Germania', flag: '🇩🇪' },
  { code: 'es', label: 'Spagna', flag: '🇪🇸' },
  { code: 'nl', label: 'Paesi Bassi', flag: '🇳🇱' },
  { code: 'jp', label: 'Giappone', flag: '🇯🇵' },
];

// Datacenter di default, residenziale quando il sito blocca gli IP datacenter; la decisione
// sta nelle regole d'azione, qui c'è solo la selezione.
const TIERS = { DATACENTER: 'datacenter', RESIDENTIAL: 'residential' };

// Codice paese normalizzato ('FR' → 'fr') o null se non è un alpha-2 valido.
function normalizeCountry(country) {
  const c = String(country || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : null;
}

function normalizeTier(tier) {
  return tier === TIERS.RESIDENTIAL ? TIERS.RESIDENTIAL : TIERS.DATACENTER;
}

// env > impostazioni; `env` è iniettabile per i test.
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

// Le credenziali stanno fuori dall'endpoint perché Chromium non accetta user:pass in
// proxyRules: su HTTP passano dall'evento `login`, su SOCKS5 l'autenticazione non c'è.
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

// Niente fallback fra tier: la scelta è del chiamante. null se il tier non è configurato.
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

// Chromium chiede le credenziali del proxy con l'evento `login` su app: si mappa la session
// della partition alle sue, e l'handler globale risponde solo per quelle registrate.

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

// auth=null rimuove le credenziali della partition.
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
