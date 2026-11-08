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
function registraRete(partition, ses, { proxyRules = '', bypassRules = '', auth = null, country = '', tier = '' } = {}) {
  const conAuth = auth && auth.username ? auth : null;
  const rete = proxyRules ? { proxyRules, ...(bypassRules ? { proxyBypassRules: bypassRules } : {}) } : null;
  const dimentica = dimenticaSeCambia(ses, JSON.stringify([proxyRules, bypassRules, conAuth && conAuth.username, conAuth && conAuth.password]));
  if (!conAuth && !rete) { authBySession.delete(partition); return dimentica; }
  const paese = normalizeCountry(country) ? { country: normalizeCountry(country), tier: normalizeTier(tier) } : null;
  authBySession.set(partition, { ses, auth: conAuth, rete, paese });
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

// La regola «apri sempre da un altro paese» (#152) che vale per `url`, o null: la sceglie qui sia la scheda che naviga sia
// chi decide se un sito si può contattare dalla connessione vera (#1273.3).
function regolaPer(url, regole) {
  if (!regole || !/^https?:\/\//i.test(String(url || ''))) return null;
  const dom = require('../../shared/stessoSito').voceSalvata(String(url), Object.keys(regole));
  return (dom && regole[dom] && regole[dom].country && regole[dom]) || null;
}

// Le regole lette dalla memoria di Filo. Un errore si propaga: chi le chiede per contattare un sito, nel dubbio non lo contatta.
async function leggiRegole() {
  const FM = globalThis.SN_FILO_MEMORY;
  return (FM && (await FM.listProxyRules())) || {};
}

// Un programma esterno (yt-dlp) vuole il proxy come indirizzo intero; i socks con i nomi risolti dal proxy, come fa
// Chromium: il DNS di casa direbbe il sito a chi guarda la rete. '' per uno schema che il programma non sa usare.
const SCHEMI_PROGRAMMA = Object.freeze({ http: 'http', https: 'https', socks4: 'socks4a', socks5: 'socks5h' });
function indirizzoPerProgramma(proxyRules, auth = null) {
  let u;
  try { u = new URL(String(proxyRules || '').trim()); } catch (_) { return ''; }
  const schema = SCHEMI_PROGRAMMA[u.protocol.replace(/:$/, '').toLowerCase()];
  if (!schema || !u.hostname) return '';
  const chi = auth && auth.username ? `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password || '')}@` : '';
  return `${schema}://${chi}${u.host}`;
}

const paeseDi = (p) => (p && normalizeCountry(p.country) ? { country: normalizeCountry(p.country), tier: normalizeTier(p.tier) } : null);

// Da dove esce un programma che scarica per conto di una scheda (#2301): dal proxy della sua sessione, dal paese già
// scelto per quel lavoro (`paese`, per «Riprova») o dalla regola del sito. Se uno di questi vale ma non si può usare,
// `{ rifiuto }`: mai la connessione vera al suo posto. `paese` torna solo se non viene dalla regola, che si rilegge.
async function uscitaPerProgramma({ ses = null, url = '', paese = null, regole = leggiRegole,
  impostazioni = async () => globalThis.SN_STORAGE?.getSettings?.() } = {}) {
  const voce = voceDellaSessione(ses);
  if (voce && voce.rete) {
    const proxy = indirizzoPerProgramma(voce.rete.proxyRules, voce.auth);
    return proxy ? { proxy, paese: voce.paese || null } : { rifiuto: true, paese: voce.paese || null };
  }
  let scelta = paeseDi(paese);
  const tieni = scelta;
  if (!scelta) {
    try { scelta = paeseDi(regolaPer(url, await regole())); } catch (_) { return { rifiuto: true, paese: null }; }
  }
  if (!scelta) return { proxy: '', paese: null };
  let settings = null;
  try { settings = await impostazioni(); } catch (_) {}
  const resolved = resolve(scelta.country, { tier: scelta.tier, settings });
  const proxy = resolved ? indirizzoPerProgramma(resolved.proxyRules, resolved.auth) : '';
  return proxy ? { proxy, paese: tieni } : { rifiuto: true, paese: tieni };
}

module.exports = {
  regolaPer,
  leggiRegole,
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
