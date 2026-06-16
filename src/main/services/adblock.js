// Motore di ad-blocking per-dominio basato su liste (processo main).
//
// COSA FA
//   A differenza del blocco tracker "curato" in cookies.js (poche decine di
//   host scritti a mano) e del popup-blocker in tabs.js (disposition new-window),
//   questo è il motore di ad-blocking vero: scarica una o più LISTE pubbliche e
//   gratuite (StevenBlack hosts, EasyList), le tiene in cache locale e le
//   aggiorna da sole una volta a settimana. Ogni richiesta verso un dominio
//   presente nelle liste viene annullata a monte (onBeforeRequest), così lo
//   script pubblicitario/tracker non si carica nemmeno.
//
// PERCHÉ UNA CACHE SU DISCO
//   Le liste sono grandi (StevenBlack supera i 100k domini) e cambiano lentamente.
//   Scaricarle a ogni avvio sprecherebbe rete e rallenterebbe il boot. Le teniamo
//   in userData/adblock/lists.json e ci basiamo su `updatedAt`: si rinfresca solo
//   se la cache manca o ha più di una settimana. Il download è sempre in
//   background e non blocca mai la navigazione; se la rete non c'è, si continua
//   con la cache esistente (o senza blocco, ma la navigazione non si rompe).
//
// SICUREZZA: niente domini legittimi
//   Una whitelist di base (BASE_WHITELIST) protegge i domini "buoni" anche se per
//   errore finissero in una lista: il match in whitelist vince sempre sul blocco.
//
// Il toggle vive in settings.security.adblock.enabled (pagina Sicurezza).

'use strict';

// electron è richiesto in modo PIGRO (dentro le funzioni che lo usano) così la
// logica pura (parseList, isBlockedHost, …) resta caricabile negli unit test
// node:test, che girano senza Electron.
const fsp = require('node:fs/promises');
const path = require('node:path');

// Liste pubbliche e gratuite usate di default. Formati misti gestiti dal parser:
//   - hosts file:  righe "0.0.0.0 dominio" / "127.0.0.1 dominio"
//   - EasyList:    righe con ancora di dominio "||dominio^"
const DEFAULT_SOURCES = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://easylist.to/easylist/easylist.txt',
];

// Aggiornamento automatico: settimanale (le liste cambiano lentamente).
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Dimensione massima per singola lista scaricata (anti-abuso/OOM): 16 MB.
const MAX_LIST_BYTES = 16 * 1024 * 1024;

// Whitelist di base: domini legittimi da non bloccare MAI, anche se una lista li
// includesse per sbaglio. Sono "domini-ombrello" (registrabili) di servizi che
// l'utente usa davvero — bloccarli romperebbe siti interi. NON includere qui i
// puri host pubblicitari (es. doubleclick): quelli devono restare bloccabili.
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

// ─── parsing liste (logica pura, esportata e testata) ───────────────────────

// Estrae l'insieme di domini da bloccare dal testo di una lista. Riconosce sia
// il formato hosts (0.0.0.0/127.0.0.1 dominio) sia le regole EasyList con ancora
// di dominio (||dominio^). Ignora commenti, regole cosmetiche (##, #@#), regole
// di eccezione (@@) e tutto ciò che non è un dominio pulito.
function parseList(text) {
  const out = new Set();
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // Commenti: '#' (hosts) e '!' o '[' (header EasyList).
    if (line[0] === '!' || line[0] === '[') continue;

    // Regole cosmetiche EasyList (element hiding): "dominio##.banner" — non sono
    // blocchi di rete, saltale per non scambiare il selettore per un dominio.
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) continue;

    // Eccezioni EasyList ("@@||dominio^"): NON bloccare. Le saltiamo (non
    // implementiamo le allow-rule, ma non devono finire tra i domini bloccati).
    if (line.startsWith('@@')) continue;

    // EasyList: ancora di dominio "||dominio^..." (eventuali opzioni dopo "^").
    if (line.startsWith('||')) {
      const m = line.slice(2).match(/^([a-z0-9_-]+(?:\.[a-z0-9_-]+)+)\^/i);
      if (m) {
        const d = normalizeDomain(m[1]);
        if (d) out.add(d);
      }
      continue;
    }

    // hosts file: "0.0.0.0 dominio" oppure "127.0.0.1 dominio".
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

// Pulisce/valida un dominio: minuscolo, niente www., solo host con almeno un punto.
function normalizeDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^\*\./, '').replace(/^www\./, '');
  if (!/^[a-z0-9_.-]+\.[a-z0-9-]{2,}$/i.test(s)) return '';
  return s;
}

// ─── stato in-memory ────────────────────────────────────────────────────────

let blockedDomains = new Set();   // domini caricati dalle liste
const whitelistSet = new Set(BASE_WHITELIST.map((d) => d.toLowerCase()));
let enabled = false;              // toggle utente (settings.security.adblock.enabled)
let lastUpdatedAt = 0;            // ms epoch dell'ultimo refresh riuscito
let refreshing = null;            // promise del refresh in corso (dedup)
let refreshTimer = null;          // setInterval del refresh periodico

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

// True se un host (o un suo dominio padre) è nella whitelist di base.
function isWhitelistedHost(host) {
  return matchesSuffix(host, whitelistSet);
}

// True se un host (o un suo dominio padre) è in `set`. "a.b.example.com" matcha
// se nel set c'è "a.b.example.com", "b.example.com" o "example.com".
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

// Decide se un host va bloccato: presente nelle liste E non in whitelist.
function isBlockedHost(host) {
  if (!host) return false;
  if (isWhitelistedHost(host)) return false;
  return matchesSuffix(host, blockedDomains);
}

function isBlockedUrl(url) {
  return isBlockedHost(hostnameOf(url));
}

// ─── hook onBeforeRequest (una registrazione per sessione) ──────────────────

const hookedSessions = new WeakSet();

// Registra (una volta sola) il blocco su una sessione. Il filtro consulta lo
// stato globale `enabled` a ogni richiesta, così attivare/disattivare il toggle
// non richiede di ri-registrare nulla.
function applyAdblock(ses) {
  if (!ses || !ses.webRequest || hookedSessions.has(ses)) return;
  hookedSessions.add(ses);
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (enabled && isBlockedUrl(details.url)) callback({ cancel: true });
    else callback({ cancel: false });
  });
}

// ─── cache su disco ─────────────────────────────────────────────────────────

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

// ─── download liste ─────────────────────────────────────────────────────────

// Scarica una singola lista. Usa net.request (rispetta proxy/sistema). Ritorna
// il testo, o null se fallisce (rete assente, 404, troppo grande): il chiamante
// tiene la cache esistente senza rompere nulla.
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

// Scarica tutte le sorgenti, fonde i domini, e se ne ottiene almeno una valida
// aggiorna lo stato in-memory + la cache. Dedup dei refresh concorrenti.
function refresh({ force = false, sources = DEFAULT_SOURCES } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      // Niente refresh inutili: se la cache è fresca (<1 settimana) e non è
      // forzato, salta. (force=true bypassa, es. pulsante "aggiorna ora".)
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
        // Tutti i download falliti (rete assente) → tieni la cache esistente.
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

// ─── ciclo di vita / configurazione ─────────────────────────────────────────

function isEnabled(settings) {
  const ad = settings && settings.security && settings.security.adblock;
  // Default-on come gli altri controlli di sicurezza: assente/null → attivo.
  return !ad || ad.enabled !== false;
}

// Avvia un refresh periodico (settimanale) finché il blocco è attivo. Idempotente.
function ensurePeriodicRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (enabled) refresh().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref(); // non tenere vivo il processo
}

// Chiamato all'avvio: applica il blocco alla sessione di default, carica la
// cache, e se serve avvia un refresh in background (mai bloccante).
async function init(settings) {
  enabled = isEnabled(settings);
  applyAdblock(require('electron').session.defaultSession);
  await loadCache();
  // In test non si tocca la rete: le liste si iniettano via setDomainsForTest.
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    // Refresh in background se la cache manca o è stantia. Non attendiamo.
    if (!blockedDomains.size || !lastUpdatedAt || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS) {
      refresh().catch(() => {});
    }
  }
}

// Chiamato a ogni UPDATE_SETTINGS: aggiorna il toggle e, se appena acceso con
// cache vuota/stantia, avvia un refresh in background.
function configureFromSettings(settings) {
  const was = enabled;
  enabled = isEnabled(settings);
  applyAdblock(require('electron').session.defaultSession);
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    if (!was && (!blockedDomains.size || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS)) {
      refresh().catch(() => {});
    }
  }
}

// Solo per i test: inietta una lista di domini senza toccare la rete.
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
  applyAdblock,
  refresh,
  init,
  configureFromSettings,
  isEnabled,
  setDomainsForTest,
  status,
};
