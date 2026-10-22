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

// Host del fornitore (mai le credenziali del template): la pagina Sicurezza lo
// dichiara a chi apre schede da un altro paese. '' se manca o non si legge.
function providerHost(settings, env = process.env) {
  const tmpl = configFrom(settings, env).datacenter;
  if (!tmpl) return '';
  const ep = endpointFor(tmpl, 'us');
  if (!ep) return '';
  try { return new URL(ep.proxyRules).hostname || ''; } catch (_) { return ''; }
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

// Accanto alle credenziali, le regole: chi esce per conto della scheda (la finestra nascosta dei link) le ripete uguali.
const authBySession = new Map(); // partition → { ses, auth, rete: { proxyRules, proxyBypassRules } | null }
let loginWired = false;

function wireLoginHandler() {
  if (loginWired) return;
  let app = null;
  try { ({ app } = require('electron')); } catch (_) { return; }
  if (!app || typeof app.on !== 'function') return;
  loginWired = true;
  app.on('login', (event, webContents, _request, authInfo, callback) => {
    if (!authInfo || !authInfo.isProxy || !webContents) return;
    const auth = credenzialiDellaSessione(webContents.session);
    if (!auth) return;
    event.preventDefault();
    try { callback(auth.username, auth.password); } catch (_) {}
  });
}

// Le ultime regole e credenziali date a ogni sessione, anche dopo clearPartitionAuth: la sessione le ricorda lei.
const ultimaReteDi = new WeakMap();

// Chromium ricorda la password del proxy per indirizzo: un fornitore col paese nel nome utente ha lo stesso indirizzo
// per ogni paese, e senza dimenticare le credenziali vecchie si uscirebbe dal paese di prima (#1272).
function dimenticaSeCambia(ses, chiave) {
  if (!ses || typeof ses !== 'object') return null;
  const prima = ultimaReteDi.get(ses);
  ultimaReteDi.set(ses, chiave);
  if (prima === undefined || prima === chiave) return null;
  return Promise.resolve()
    .then(() => (typeof ses.clearAuthCache === 'function' ? ses.clearAuthCache() : null))
    .then(() => (typeof ses.closeAllConnections === 'function' ? ses.closeAllConnections() : null))
    .catch(() => {});
}

// La partition proxata con regole e credenziali di `resolved` (quello di resolve()). Torna la promessa da aspettare
// prima di caricare quando le credenziali vecchie vanno dimenticate, altrimenti null.
function registraRete(partition, ses, { proxyRules = '', bypassRules = '', auth = null } = {}) {
  const conAuth = auth && auth.username ? auth : null;
  const rete = proxyRules ? { proxyRules, ...(bypassRules ? { proxyBypassRules: bypassRules } : {}) } : null;
  const dimentica = dimenticaSeCambia(ses, JSON.stringify([proxyRules, bypassRules, conAuth && conAuth.username, conAuth && conAuth.password]));
  if (!conAuth && !rete) { authBySession.delete(partition); return dimentica; }
  authBySession.set(partition, { ses, auth: conAuth, rete });
  if (conAuth) wireLoginHandler();
  return dimentica;
}

function clearPartitionAuth(partition) {
  authBySession.delete(partition);
}

function voceDellaSessione(ses) {
  if (!ses) return null;
  for (const v of authBySession.values()) if (v.ses === ses) return v;
  return null;
}

function credenzialiDellaSessione(ses) {
  const v = voceDellaSessione(ses);
  return v && v.auth ? v.auth : null;
}

// { proxyRules, proxyBypassRules?, auth } della sessione proxata, o null per una sessione che esce come il sistema.
function reteDellaSessione(ses) {
  const v = voceDellaSessione(ses);
  return v && v.rete ? { ...v.rete, auth: v.auth } : null;
}

module.exports = {
  LOCATIONS,
  TIERS,
  normalizeCountry,
  normalizeTier,
  configFrom,
  isConfigured,
  providerHost,
  endpointFor,
  resolve,
  registraRete,
  clearPartitionAuth,
  credenzialiDellaSessione,
  reteDellaSessione,
};
