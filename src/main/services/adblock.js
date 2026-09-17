// Ad-blocking a liste pubbliche (StevenBlack, EasyList), in cache su disco e rinfrescate
// una volta a settimana. Non registra un proprio onBeforeRequest (vedi shouldBlock) e non
// blocca mai i domini in BASE_WHITELIST. Toggle in settings.security.adblock.enabled.

'use strict';

// electron si richiede dentro le funzioni: gli unit test girano senza Electron.
const fsp = require('node:fs/promises');
const path = require('node:path');

// Le sorgenti sono di formato misto: hosts ("0.0.0.0 dominio") ed EasyList ("||dominio^").
const DEFAULT_SOURCES = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://easylist.to/easylist/easylist.txt',
];

// Settimanale: le liste cambiano lentamente.
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Tetto per singola lista scaricata: una sorgente gonfia non deve esaurire la memoria.
const MAX_LIST_BYTES = 16 * 1024 * 1024;

// Domini-ombrello di servizi veri: bloccarli romperebbe siti interi, e la whitelist vince.
// NON aggiungere qui i puri host pubblicitari: devono restare bloccabili.
const BASE_WHITELIST = [
  'google.com', 'gstatic.com', 'googleapis.com', 'youtube.com', 'ytimg.com',
  'facebook.com', 'fbcdn.net', 'instagram.com', 'whatsapp.com',
  'microsoft.com', 'live.com', 'office.com', 'bing.com', 'windows.net',
  'apple.com', 'icloud.com', 'amazon.com', 'amazonaws.com', 'cloudflare.com',
  'cloudfront.net', 'akamai.net', 'akamaihd.net', 'jsdelivr.net', 'unpkg.com',
  'github.com', 'githubusercontent.com', 'wikipedia.org', 'mozilla.org',
  'twitter.com', 'x.com', 'twimg.com', 'linkedin.com', 'reddit.com',
  'paypal.com', 'stripe.com', 'duckduckgo.com',
];

function parseList(text) {
  const out = new Set();
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // '#' apre i commenti dei file hosts, '!' e '[' quelli di EasyList.
    if (line[0] === '!' || line[0] === '[') continue;

    // Regole cosmetiche EasyList ("dominio##.banner"): non sono blocchi di rete, e il
    // selettore non va scambiato per un dominio.
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue;

    // Le eccezioni EasyList («@@») non si implementano, ma non devono finire fra i bloccati.
    if (line.startsWith('@@')) continue;

    if (line.startsWith('||')) {
      const m = line.slice(2).match(/^([a-z0-9_-]+(?:\.[a-z0-9_-]+)+)\^/i);
      if (m) {
        const d = normalizeDomain(m[1]);
        if (d) out.add(d);
      }
      continue;
    }

    if (line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && (parts[0] === '0.0.0.0' || parts[0] === '127.0.0.1')) {
      const d = normalizeDomain(parts[1]);
      // 'localhost' e simili non sono domini da bloccare.
      if (d && d !== 'localhost' && d.includes('.')) out.add(d);
    }
  }
  return out;
}

function normalizeDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^\*\./, '').replace(/^www\./, '');
  if (!/^[a-z0-9_.-]+\.[a-z0-9-]{2,}$/i.test(s)) return '';
  return s;
}

let blockedDomains = new Set();
const whitelistSet = new Set(BASE_WHITELIST.map((d) => d.toLowerCase()));
let enabled = false;
let lastUpdatedAt = 0;            // ms epoch dell'ultimo refresh riuscito
let refreshing = null;            // promise del refresh in corso (dedup)
let refreshTimer = null;

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function isWhitelistedHost(host) {
  return matchesSuffix(host, whitelistSet);
}

// Il match è per suffisso: "a.b.example.com" matcha anche se nel set c'è solo "example.com".
function matchesSuffix(host, set) {
  if (!host || !set.size) return false;
  let h = host;
  while (h) {
    if (set.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

function isBlockedHost(host) {
  if (!host) return false;
  if (isWhitelistedHost(host)) return false;
  return matchesSuffix(host, blockedDomains);
}

function isBlockedUrl(url) {
  return isBlockedHost(hostnameOf(url));
}

// Niente onBeforeRequest nostro: Electron ammette un solo listener per evento per sessione,
// e quel punto è di cookies.js, che chiama shouldBlock().
function shouldBlock(url) {
  return enabled && isBlockedUrl(url);
}

function cacheDir() {
  let base = '';
  try { base = require('electron').app.getPath('userData'); } catch (_) { base = process.env.FILO_USER_DATA || '.'; }
  return path.join(base, 'adblock');
}
function cacheFile() { return path.join(cacheDir(), 'lists.json'); }

async function loadCache() {
  try {
    const raw = await fsp.readFile(cacheFile(), 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.domains)) {
      blockedDomains = new Set(data.domains);
      lastUpdatedAt = Number(data.updatedAt) || 0;
      return true;
    }
  } catch (_) { /* nessuna cache: si parte vuoti finché non si scarica */ }
  return false;
}

async function saveCache() {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true });
    const payload = JSON.stringify({
      updatedAt: lastUpdatedAt,
      count: blockedDomains.size,
      domains: Array.from(blockedDomains),
    });
    await fsp.writeFile(cacheFile(), payload, 'utf8');
  } catch (_) { /* best-effort: la cache è un'ottimizzazione, non un requisito */ }
}

// null se il download fallisce (rete assente, 404, troppo grande): il chiamante tiene la
// cache esistente invece di restare senza blocco.
function fetchList(url) {
  return new Promise((resolve) => {
    let req;
    try { req = require('electron').net.request(url); } catch (_) { resolve(null); return; }
    let body = '';
    let bytes = 0;
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} finish(null); }, 30_000);
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        try { req.abort(); } catch (_) {}
        clearTimeout(timer); finish(null); return;
      }
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_LIST_BYTES) { try { req.abort(); } catch (_) {} clearTimeout(timer); finish(null); return; }
        body += chunk.toString('utf8');
      });
      res.on('end', () => { clearTimeout(timer); finish(body); });
      res.on('error', () => { clearTimeout(timer); finish(null); });
    });
    req.on('error', () => { clearTimeout(timer); finish(null); });
    try { req.end(); } catch (_) { clearTimeout(timer); finish(null); }
  });
}

function refresh({ force = false, sources = DEFAULT_SOURCES } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      // force=true salta il controllo di freschezza (pulsante "aggiorna ora").
      if (!force && lastUpdatedAt && (Date.now() - lastUpdatedAt) < REFRESH_INTERVAL_MS) {
        return { ok: true, skipped: true, count: blockedDomains.size };
      }
      const texts = await Promise.all(sources.map((u) => fetchList(u)));
      const merged = new Set();
      let any = false;
      for (const text of texts) {
        if (!text) continue;
        any = true;
        for (const d of parseList(text)) merged.add(d);
      }
      if (!any || merged.size === 0) {
        return { ok: false, error: 'download_failed', count: blockedDomains.size };
      }
      blockedDomains = merged;
      lastUpdatedAt = Date.now();
      await saveCache();
      return { ok: true, count: blockedDomains.size, updatedAt: lastUpdatedAt };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), count: blockedDomains.size };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function isEnabled(settings) {
  const ad = settings && settings.security && settings.security.adblock;
  // Default-on come gli altri controlli di sicurezza: assente/null → attivo.
  return !ad || ad.enabled !== false;
}

function ensurePeriodicRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (enabled) refresh().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref(); // non tenere vivo il processo
}

async function init(settings) {
  enabled = isEnabled(settings);
  await loadCache();
  // In test non si tocca la rete: le liste si iniettano via setDomainsForTest.
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    if (!blockedDomains.size || !lastUpdatedAt || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS) {
      refresh().catch(() => {});
    }
  }
}

function configureFromSettings(settings) {
  const was = enabled;
  enabled = isEnabled(settings);
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    if (!was && (!blockedDomains.size || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS)) {
      refresh().catch(() => {});
    }
  }
}

function setDomainsForTest(domains) {
  blockedDomains = new Set((Array.isArray(domains) ? domains : []).map((d) => String(d).toLowerCase()));
  lastUpdatedAt = Date.now();
}

function status() {
  return { enabled, count: blockedDomains.size, updatedAt: lastUpdatedAt };
}

module.exports = {
  DEFAULT_SOURCES,
  parseList,
  normalizeDomain,
  isBlockedHost,
  isBlockedUrl,
  isWhitelistedHost,
  shouldBlock,
  refresh,
  init,
  configureFromSettings,
  isEnabled,
  setDomainsForTest,
  status,
};
