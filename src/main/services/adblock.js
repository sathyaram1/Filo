// Ad-blocking a liste pubbliche (processo main), scaricate a runtime e tenute in cache una settimana: blocca le
// richieste ai domini in lista e dà le regole per nascondere i riquadri rimasti (src/preload/nascondi-pubblicita.js).
// Toggle: settings.security.adblock.enabled. Il listener di rete è di cookies.js, che chiede a shouldBlock.

'use strict';

// electron è richiesto in modo PIGRO (dentro le funzioni che lo usano) così la
// logica pura (parseList, isBlockedHost, …) resta caricabile negli unit test
// node:test, che girano senza Electron.
const fsp = require('node:fs/promises');
const path = require('node:path');

// Formati misti: hosts file ("0.0.0.0 dominio") e liste EasyList ("||dominio^", "dominio##selettore").
// Le liste regionali portano le regole dei siti italiani e francesi, che EasyList non conosce.
const DEFAULT_SOURCES = [
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist-downloads.adblockplus.org/easylistitaly.txt',
  'https://raw.githubusercontent.com/easylist/listefr/master/liste_fr.txt',
];

// Una cache scritta prima delle regole di occultamento (e del parser che non blocca più siti interi per una
// regola di percorso) va riscaricata subito, non fra una settimana.
const CACHE_FORMAT = 3;

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

// Opzioni con cui «||dominio^$…» vuol dire ancora «blocca il dominio». Un'opzione fuori elenco (csp=,
// rewrite=, redirect=, removeparam…) cambia la richiesta invece di bloccarla, e un domain= positivo la
// limita a certi siti: preso come blocco del dominio intero, spegnerebbe un sito o una CDN dappertutto.
const NET_OPTS = new Set([
  'third-party', '3p', 'first-party', '1p', 'popup', 'document', 'doc', 'subdocument', 'frame', 'script',
  'image', 'stylesheet', 'css', 'object', 'xmlhttprequest', 'xhr', 'media', 'font', 'websocket', 'ping',
  'other', 'all', 'important', 'match-case',
]);

function bloccaIlDominio(opts) {
  if (opts === undefined) return true;
  for (let o of opts.split(',')) {
    o = o.trim().toLowerCase();
    if (!o) continue;
    const eq = o.indexOf('=');
    if (eq >= 0) {
      const name = o.slice(0, eq);
      if (name !== 'domain' && name !== 'from') return false;
      if (o.slice(eq + 1).split('|').some((d) => d && d[0] !== '~')) return false;
      continue;
    }
    if (!NET_OPTS.has(o[0] === '~' ? o.slice(1) : o)) return false;
  }
  return true;
}

// Una regola solo di terzi o solo per certi tipi (script, riquadri, immagini) non vale per la pagina che l'utente apre:
// presa per un sito da fermare, quel dominio non si apriva più nemmeno con un clic o scrivendolo (#576).
const TIPI_PAGINA = new Set(['document', 'doc', 'all', 'popup']);

function valePerLaPagina(opts) {
  if (opts === undefined) return true;
  let tipi = false;
  let terzi = false;
  let pagina = false;
  for (let o of opts.split(',')) {
    o = o.trim().toLowerCase();
    if (!o || o[0] === '~' || o.includes('=')) continue;
    if (o === 'third-party' || o === '3p') terzi = true;
    else if (TIPI_PAGINA.has(o)) pagina = true;
    else if (o !== 'first-party' && o !== '1p' && o !== 'important' && o !== 'match-case') tipi = true;
  }
  return pagina || (!terzi && !tipi);
}

// Estrae l'insieme di domini da bloccare dal testo di una lista. Riconosce sia
// il formato hosts (0.0.0.0/127.0.0.1 dominio) sia le regole EasyList con ancora
// di dominio (||dominio^). Ignora commenti, regole cosmetiche (##, #@#), regole
// di eccezione (@@) e tutto ciò che non è un dominio pulito. In `pagine` i domini le cui regole valgono anche per la pagina.
function parseList(text, pagine) {
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

    // EasyList: ancora di dominio "||dominio^" o "||dominio^$opzioni". Con un percorso dopo "^"
    // ("||sito.it^*/ads/") la regola vale per quel percorso, non per il sito.
    if (line.startsWith('||')) {
      const m = line.slice(2).match(/^([a-z0-9_-]+(?:\.[a-z0-9_-]+)+)\^(?:\$(.*))?$/i);
      if (m && bloccaIlDominio(m[2])) {
        const d = normalizeDomain(m[1]);
        if (d) out.add(d);
        if (d && pagine && valePerLaPagina(m[2])) pagine.add(d);
      }
      continue;
    }

    // hosts file: "0.0.0.0 dominio" oppure "127.0.0.1 dominio".
    if (line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && (parts[0] === '0.0.0.0' || parts[0] === '127.0.0.1')) {
      const d = normalizeDomain(parts[1]);
      // 'localhost' e simili non sono domini da bloccare.
      if (d && d !== 'localhost' && d.includes('.')) {
        out.add(d);
        if (pagine) pagine.add(d);
      }
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

// ─── regole di occultamento (logica pura) ───────────────────────────────────

const CB = require('./cookieBanners');

// Un file hosts ha righe «## …» che sono commenti, non regole: le sue righe valgono solo per la rete.
function isHostsFile(text) {
  return /^(?:0\.0\.0\.0|127\.0\.0\.1)\s/m.test(String(text || ''));
}

// I siti dove la lista spegne l'occultamento: tutto ($elemhide) o solo le regole generiche ($generichide).
// Sono le eccezioni scritte per i siti che le regole generiche rompono (account Google, negozi, motori di ricerca).
function emptyOff() { return { all: new Set(), generic: new Set() }; }

function parseHideOff(text, into) {
  const out = into || emptyOff();
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line.startsWith('@@')) continue;
    const dollar = line.lastIndexOf('$');
    if (dollar < 0) continue;
    const opts = line.slice(dollar + 1).toLowerCase().split(',').map((o) => o.trim());
    const all = opts.includes('elemhide') || opts.includes('ehide');
    if (!all && !opts.includes('generichide') && !opts.includes('ghide')) continue;
    const target = all ? out.all : out.generic;
    const dom = opts.find((o) => o.startsWith('domain=') || o.startsWith('from='));
    if (dom) {
      for (const d of dom.slice(dom.indexOf('=') + 1).split('|')) if (d && d[0] !== '~') target.add(d);
      continue;
    }
    const m = line.slice(2, dollar).match(/^\|\|([a-z0-9_.*-]+?)(?:\.)?(?:[\^/?:]|$)/i);
    if (!m) continue;
    const host = m[1].toLowerCase();
    target.add(line.slice(2 + 2 + m[1].length)[0] === '.' ? host + '.*' : host);
  }
  return out;
}

function offFor(off, host) {
  const keys = CB.hostKeys(host);
  return {
    all: keys.some((k) => off.all.has(k)),
    generic: keys.some((k) => off.generic.has(k)),
  };
}

// Un selettore con graffe, commenti o una @ in testa (@import) uscirebbe dalla sua regola e scriverebbe CSS nella pagina.
// Con `gate` ogni regola vale finché la radice della pagina non porta quell'attributo: Electron non sa togliere un foglio
// dell'utente, e spegnere il blocco deve far tornare i riquadri nelle pagine aperte.
function toCss(selectors, gate) {
  const out = [];
  for (const sel of selectors) {
    if (typeof sel !== 'string' || !sel || /[{}]|\/\*|\*\/|^\s*@/.test(sel)) continue;
    const g = gate ? sottoCancello(sel, gate) : sel;
    if (g) out.push(`${g}{display:none!important}`);
  }
  return out.join('\n');
}

const GATE_RE = /^data-filo-[a-z0-9]{1,16}$/;

function cancello(gate) {
  return typeof gate === 'string' && GATE_RE.test(gate) ? gate : '';
}

// Divide l'elenco ai livelli alti e prefissa ogni selettore con la radice aperta; uno che parte dalla radice la porta in sé.
function sottoCancello(sel, gate) {
  const parti = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parti.push(sel.slice(start, i)); start = i + 1; }
  }
  if (quote || depth !== 0) return '';
  parti.push(sel.slice(start));
  const aperta = `:not([${gate}])`;
  return parti.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(html|:root)(?![\w-])/i);
    return m ? m[1] + aperta + p.slice(m[1].length) : `:root${aperta} ${p}`;
  }).join(',');
}

// ─── stato in-memory ────────────────────────────────────────────────────────

let blockedDomains = new Set();   // domini caricati dalle liste
let pageDomains = new Set();      // quelli le cui regole valgono anche per la pagina aperta (blocco dei siti)
const whitelistSet = new Set(BASE_WHITELIST.map((d) => d.toLowerCase()));
let enabled = false;              // toggle utente (settings.security.adblock.enabled)
let lastUpdatedAt = 0;            // ms epoch dell'ultimo refresh riuscito
let refreshing = null;            // promise del refresh in corso (dedup)
let refreshTimer = null;          // setInterval del refresh periodico
let cosmetic = CB.emptyList();    // regole di occultamento delle liste
let hideOff = emptyOff();

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

// Per il blocco dei siti (siteBlock.js): la pagina aperta dall'utente si ferma solo per le regole che valgono per lei.
function isBlockedSite(host) {
  if (!host) return false;
  if (isWhitelistedHost(host)) return false;
  return matchesSuffix(host, pageDomains);
}

function isBlockedUrl(url) {
  return isBlockedHost(hostnameOf(url));
}

// ─── decisione di blocco ────────────────────────────────────────────────────
//
// NON registriamo un nostro onBeforeRequest: Electron consente UN SOLO listener
// per evento per sessione, e quel choke point è già di cookies.js (blocco
// tracker). Quel listener consulta `shouldBlock` per coprire anche l'ad-blocking
// a liste sulla stessa sessione (default + jar per-sito della modalità privacy).
function shouldBlock(url) {
  return enabled && isBlockedUrl(url);
}

// ─── occultamento: cosa la pagina riceve ────────────────────────────────────

function pageHost(href) {
  const s = String(href || '');
  return /^https?:/i.test(s) ? hostnameOf(s) : '';
}

// Alla nascita della pagina: le regole complesse generiche e quelle scritte per il suo sito. `tokens` dice se
// vale la pena mandare dopo gli id e le classi che la pagina incontra.
function cosmeticForPage(href, gate) {
  const host = pageHost(href);
  if (!enabled || !host) return { on: false, css: '', tokens: false };
  const off = offFor(hideOff, host);
  if (off.all) return { on: true, css: '', tokens: false };
  const { complex, specific } = CB.forHostIn(cosmetic, host);
  const generic = !off.generic && (cosmetic.ids.size + cosmetic.classes.size) > 0;
  return { on: true, css: toCss(off.generic ? specific : complex.concat(specific), cancello(gate)), tokens: generic };
}

// Gli id e le classi della pagina che le regole generiche nascondono, come CSS da aggiungere.
function cosmeticForTokens(href, ids, classes, gate) {
  const host = pageHost(href);
  if (!enabled || !host) return '';
  const off = offFor(hideOff, host);
  if (off.all || off.generic) return '';
  const clean = (arr) => (Array.isArray(arr) ? arr.slice(0, 5000).filter((x) => typeof x === 'string' && x && x.length <= 120) : []);
  return toCss(CB.matchTokensIn(cosmetic, host, clean(ids), clean(classes)), cancello(gate));
}

// Un'immagine o un riquadro fermati qui lascerebbero il buco dell'annuncio: il frame che li contiene li chiude
// (preload/nascondi-pubblicita.js). I video no: un lettore che cambia sorgente sullo stesso elemento resterebbe chiuso col film.
const DA_CHIUDERE = new Set(['image', 'subFrame', 'object']);
const RIQUADRO_FERMATO = 'filo:adblock-riquadro-fermato';

// L'elemento porta l'indirizzo di partenza: se un rinvio porta a un server in lista, il blocco vede solo l'ultimo.
const PRIMI_MAX = 2000;
const primi = new Map();

function ricordaRichiesta(details) {
  if (!details || !DA_CHIUDERE.has(details.resourceType) || primi.has(details.id)) return;
  primi.set(details.id, details.url);
  if (primi.size > PRIMI_MAX) primi.delete(primi.keys().next().value);
}

// La pagina d'errore può sostituire il documento prima che lo script parta, e il frame vecchio non risponde più:
// si riprova sul frame di adesso, ritrovato dal padre.
const SEGNALE = `try{parent.postMessage(${JSON.stringify(RIQUADRO_FERMATO)},'*')}catch(e){}`;
function riconosciRiquadro(frame, padre, id) {
  const esegui = (f) => { try { f.executeJavaScript(SEGNALE).catch(() => {}); } catch (_) {} };
  if (frame) esegui(frame);
  if (!padre || id == null) return;
  for (const ms of [250, 1000]) {
    setTimeout(() => {
      try {
        const f = padre.frames.find((x) => x.frameTreeNodeId === id);
        if (f) esegui(f);
      } catch (_) {}
    }, ms);
  }
}

function chiudiInPagina(details) {
  if (!details || !DA_CHIUDERE.has(details.resourceType)) return;
  const urls = [details.url];
  const primo = primi.get(details.id);
  primi.delete(details.id);
  if (typeof primo === 'string' && primo !== details.url) urls.push(primo);
  let frame = null;
  try { frame = details.frame || null; } catch (_) {}
  if (details.resourceType === 'subFrame' && frame) {
    // Il riquadro sta nel frame padre, e uno mandato altrove da uno script non porta l'indirizzo: si fa riconoscere lui.
    let figlio = null;
    try { figlio = frame.frameTreeNodeId; } catch (_) {}
    try { frame = frame.parent || null; } catch (_) { frame = null; }
    riconosciRiquadro(details.frame, frame, figlio);
  }
  if (frame) {
    // Il padre serve anche per un'immagine: dentro un riquadro scritto dalla pagina il preload non gira.
    let padre = null;
    try { padre = details.resourceType === 'subFrame' ? null : frame.parent; } catch (_) {}
    try { if (padre) padre.send('filo:adblock-chiudi', urls); } catch (_) {}
    try { frame.send('filo:adblock-chiudi', urls); return; } catch (_) {}
  }
  const wc = details.webContents;
  try { if (wc && !wc.isDestroyed()) wc.send('filo:adblock-chiudi', urls); } catch (_) {}
}

// Acceso o spento, le pagine già aperte, riquadri compresi, mettono o tolgono i loro riquadri senza essere ricaricate.
function avvisaLePagine() {
  let all = [];
  try { all = require('electron').webContents.getAllWebContents(); } catch (_) { return; }
  for (const wc of all) {
    try {
      if (wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) continue;
      for (const f of wc.mainFrame.framesInSubtree) {
        try { f.send('filo:adblock-stato', enabled); } catch (_) {}
      }
    } catch (_) {}
  }
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
      // Una cache di prima non le distingue: finché non si riscarica valgono tutte, com'era.
      pageDomains = Array.isArray(data.pagine) ? new Set(data.pagine) : blockedDomains;
      const current = data.format === CACHE_FORMAT && data.cosmetic;
      lastUpdatedAt = current ? (Number(data.updatedAt) || 0) : 0;
      if (current) {
        cosmetic = CB.fromJson(data.cosmetic);
        hideOff = { all: new Set(data.hideOff && data.hideOff.all), generic: new Set(data.hideOff && data.hideOff.generic) };
      }
      return true;
    }
  } catch (_) { /* nessuna cache: si parte vuoti finché non si scarica */ }
  return false;
}

async function saveCache() {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true });
    const payload = JSON.stringify({
      format: CACHE_FORMAT,
      updatedAt: lastUpdatedAt,
      count: blockedDomains.size,
      domains: Array.from(blockedDomains),
      pagine: Array.from(pageDomains),
      cosmetic: CB.toJson(cosmetic),
      hideOff: { all: [...hideOff.all], generic: [...hideOff.generic] },
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
function refresh({ force = false, sources = DEFAULT_SOURCES, fetchImpl = fetchList } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      // Niente refresh inutili: se la cache è fresca (<1 settimana) e non è
      // forzato, salta. (force=true bypassa, es. pulsante "aggiorna ora".)
      if (!force && lastUpdatedAt && (Date.now() - lastUpdatedAt) < REFRESH_INTERVAL_MS) {
        return { ok: true, skipped: true, count: blockedDomains.size };
      }
      const texts = await Promise.all(sources.map((u) => fetchImpl(u)));
      const merged = new Set();
      const pagine = new Set();
      const nextCosmetic = CB.emptyList();
      const nextOff = emptyOff();
      let any = false;
      for (const text of texts) {
        if (!text) continue;
        any = true;
        for (const d of parseList(text, pagine)) merged.add(d);
        if (isHostsFile(text)) continue;
        CB.parseCosmetic(text, nextCosmetic, { estese: true });
        parseHideOff(text, nextOff);
      }
      if (!any || merged.size === 0) {
        // Tutti i download falliti (rete assente) → tieni la cache esistente.
        return { ok: false, error: 'download_failed', count: blockedDomains.size };
      }
      blockedDomains = merged;
      pageDomains = pagine;
      // Se solo le liste di occultamento non sono arrivate, si tengono le regole che c'erano.
      if (nextCosmetic.ids.size + nextCosmetic.classes.size + nextCosmetic.complex.length + nextCosmetic.specific.size) {
        cosmetic = nextCosmetic;
        hideOff = nextOff;
      }
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
// Un giro fallito si ritenta a tempo finché il blocco è acceso: vedi retryList.js.
const refreshInBackground = require('./retryList').makeRetry(
  () => refresh(),
  () => enabled && process.env.NODE_ENV !== 'test' && !process.env.FILO_SMOKE,
);

function ensurePeriodicRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (enabled) refreshInBackground().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref(); // non tenere vivo il processo
}

// Chiamato all'avvio: imposta il toggle, carica la cache, e se serve avvia un
// refresh in background (mai bloccante). Il choke point onBeforeRequest è già
// registrato da cookies.js, che consulta shouldBlock().
async function init(settings) {
  enabled = isEnabled(settings);
  await loadCache();
  // In test non si tocca la rete: le liste si iniettano via setDomainsForTest.
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    // Refresh in background se la cache manca o è stantia. Non attendiamo.
    if (!blockedDomains.size || !lastUpdatedAt || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS) {
      refreshInBackground().catch(() => {});
    }
  }
}

// Chiamato a ogni UPDATE_SETTINGS: aggiorna il toggle e, se appena acceso con
// cache vuota/stantia, avvia un refresh in background.
function configureFromSettings(settings) {
  const was = enabled;
  enabled = isEnabled(settings);
  if (was !== enabled) avvisaLePagine();
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  if (enabled) {
    ensurePeriodicRefresh();
    if (!was && (!blockedDomains.size || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS)) {
      refreshInBackground().catch(() => {});
    }
  }
}

// Solo per i test: inietta una lista di domini senza toccare la rete. `pagine` assente: valgono tutti anche per la pagina.
function setDomainsForTest(domains, pagine) {
  blockedDomains = new Set((Array.isArray(domains) ? domains : []).map((d) => String(d).toLowerCase()));
  pageDomains = Array.isArray(pagine) ? new Set(pagine.map((d) => String(d).toLowerCase())) : blockedDomains;
  lastUpdatedAt = Date.now();
}

// Solo per i test: regole di occultamento scritte a mano, senza rete.
function setCosmeticForTest(text) {
  cosmetic = CB.parseCosmetic(text, null, { estese: true });
  hideOff = parseHideOff(text);
}

function status() {
  return {
    enabled,
    count: blockedDomains.size,
    hideRules: cosmetic.ids.size + cosmetic.classes.size + cosmetic.complex.length + cosmetic.specific.size,
    updatedAt: lastUpdatedAt,
  };
}

module.exports = {
  DEFAULT_SOURCES,
  fetchList,
  parseList,
  parseHideOff,
  isHostsFile,
  cosmeticForPage,
  cosmeticForTokens,
  sottoCancello,
  setCosmeticForTest,
  normalizeDomain,
  isBlockedHost,
  isBlockedSite,
  isBlockedUrl,
  isWhitelistedHost,
  shouldBlock,
  chiudiInPagina,
  ricordaRichiesta,
  RIQUADRO_FERMATO,
  refresh,
  init,
  configureFromSettings,
  isEnabled,
  setDomainsForTest,
  status,
};
