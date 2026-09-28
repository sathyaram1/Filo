// EasyList Cookie per NASCONDERE i banner senza «rifiuta» (processo main). La lista è GPLv3 / CC BY-SA:
// non si impacchetta, si scarica a runtime come le liste di adblock.js e si tiene in cache.
// Qui solo le regole di occultamento (##, #@#); il blocco di rete non si usa. Chi le applica: src/content/cookieBanners.js.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const PRIMARY = 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt';
// Le stesse regole, dai sorgenti del progetto EasyList: servono se il sito della lista non risponde.
const FALLBACK = [
  'easylist_cookie_general_hide.txt',
  'easylist_cookie_specific_hide.txt',
  'easylist_cookie_international_specific_hide.txt',
  'easylist_cookie_allowlist_general_hide.txt',
].map((f) => 'https://raw.githubusercontent.com/easylist/easylist/master/easylist_cookie/' + f);

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Sintassi che un selettore CSS non sa dire (regole procedurali di uBO/ABP): si saltano.
const PROCEDURAL = /:(has-text|-abp-|xpath|matches-css|matches-attr|matches-prop|matches-path|min-text-length|upward|remove|style|watch-attr|others|if|if-not|nth-ancestor|contains)\b|^\+js\(|^\^/i;

function emptyList() {
  return {
    ids: new Set(),
    classes: new Set(),
    complex: [],
    specific: new Map(),
    exceptions: new Map(),
    genericExceptions: new Set(),
  };
}

function pushMap(map, key, sel) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(sel);
}

// Legge il testo di una lista e ne tiene le sole regole di occultamento. PURA.
function parseCosmetic(text, into) {
  const out = into || emptyList();
  if (!text) return out;
  const seenComplex = new Set(out.complex);
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;
    let sep = '##';
    let at = line.indexOf('#@#');
    if (at >= 0) sep = '#@#';
    else {
      if (line.includes('#?#') || line.includes('#$#') || line.includes('#%#') || line.includes('#$?#')) continue;
      at = line.indexOf('##');
      if (at < 0) continue;
    }
    const domains = line.slice(0, at).trim();
    const sel = line.slice(at + sep.length).trim();
    if (!sel || PROCEDURAL.test(sel)) continue;
    const doms = domains ? domains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
    if (sep === '#@#') {
      if (!doms.length) out.genericExceptions.add(sel);
      for (const d of doms) if (d[0] !== '~') pushMap(out.exceptions, d, sel);
      continue;
    }
    const pos = doms.filter((d) => d[0] !== '~');
    const neg = doms.filter((d) => d[0] === '~').map((d) => d.slice(1));
    for (const d of neg) pushMap(out.exceptions, d, sel);
    if (pos.length) {
      for (const d of pos) pushMap(out.specific, d, sel);
      continue;
    }
    if (/^#[A-Za-z0-9_-]+$/.test(sel)) out.ids.add(sel.slice(1));
    else if (/^\.[A-Za-z0-9_-]+$/.test(sel)) out.classes.add(sel.slice(1));
    else if (!seenComplex.has(sel)) { seenComplex.add(sel); out.complex.push(sel); }
  }
  return out;
}

// Le chiavi sotto cui la lista può aver scritto regole per `host`: i domini padre e le forme «nome.*».
function hostKeys(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return [];
  const keys = [];
  const labels = h.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const d = labels.slice(i).join('.');
    keys.push(d);
    const parts = d.split('.');
    for (let k = 1; k <= 2 && parts.length - k >= 1; k++) keys.push(parts.slice(0, -k).join('.') + '.*');
  }
  return [...new Set(keys)];
}

let list = emptyList();
let lastUpdatedAt = 0;
let enabled = false;
let refreshing = null;
let refreshTimer = null;

function exceptionsFor(host) {
  const set = new Set(list.genericExceptions);
  for (const k of hostKeys(host)) for (const s of (list.exceptions.get(k) || [])) set.add(s);
  return set;
}

// Quello che la pagina di `host` riceve subito: le regole complesse generiche e quelle scritte per quel sito.
function forHost(host) {
  const exc = exceptionsFor(host);
  const specific = [];
  for (const k of hostKeys(host)) for (const s of (list.specific.get(k) || [])) if (!exc.has(s)) specific.push(s);
  return {
    complex: list.complex.filter((s) => !exc.has(s)),
    specific: [...new Set(specific)],
    count: list.ids.size + list.classes.size + list.complex.length,
  };
}

// Gli id e le classi presenti in pagina che la lista nasconde: la pagina li chiede man mano che li incontra.
function matchTokens(host, ids, classes) {
  const exc = exceptionsFor(host);
  const out = [];
  for (const id of Array.isArray(ids) ? ids.slice(0, 5000) : []) {
    const sel = '#' + id;
    if (typeof id === 'string' && list.ids.has(id) && !exc.has(sel)) out.push(sel);
  }
  for (const c of Array.isArray(classes) ? classes.slice(0, 5000) : []) {
    const sel = '.' + c;
    if (typeof c === 'string' && list.classes.has(c) && !exc.has(sel)) out.push(sel);
  }
  return out;
}

// ─── cache e download ────────────────────────────────────────────────────────

function cacheFile() {
  let base = '';
  try { base = require('electron').app.getPath('userData'); } catch (_) { base = process.env.FILO_USER_DATA || '.'; }
  return path.join(base, 'adblock', 'cookie-banners.json');
}

function toJson(l) {
  return {
    ids: [...l.ids], classes: [...l.classes], complex: l.complex,
    specific: Object.fromEntries(l.specific), exceptions: Object.fromEntries(l.exceptions),
    genericExceptions: [...l.genericExceptions],
  };
}

function fromJson(d) {
  const l = emptyList();
  for (const x of d.ids || []) l.ids.add(x);
  for (const x of d.classes || []) l.classes.add(x);
  l.complex = Array.isArray(d.complex) ? d.complex : [];
  for (const [k, v] of Object.entries(d.specific || {})) if (Array.isArray(v)) l.specific.set(k, v);
  for (const [k, v] of Object.entries(d.exceptions || {})) if (Array.isArray(v)) l.exceptions.set(k, v);
  for (const x of d.genericExceptions || []) l.genericExceptions.add(x);
  return l;
}

async function loadCache() {
  try {
    const d = JSON.parse(await fsp.readFile(cacheFile(), 'utf8'));
    list = fromJson(d);
    lastUpdatedAt = Number(d.updatedAt) || 0;
    return true;
  } catch (_) { return false; }
}

async function saveCache() {
  try {
    await fsp.mkdir(path.dirname(cacheFile()), { recursive: true });
    await fsp.writeFile(cacheFile(), JSON.stringify({ updatedAt: lastUpdatedAt, ...toJson(list) }), 'utf8');
  } catch (_) {}
}

function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!force && lastUpdatedAt && (Date.now() - lastUpdatedAt) < REFRESH_INTERVAL_MS) return { ok: true, skipped: true };
      const { fetchList } = require('./adblock');
      let texts = [await fetchList(PRIMARY)];
      if (!texts[0]) texts = await Promise.all(FALLBACK.map((u) => fetchList(u)));
      const next = emptyList();
      let any = false;
      for (const t of texts) { if (t) { any = true; parseCosmetic(t, next); } }
      if (!any || !(next.ids.size + next.classes.size + next.complex.length)) return { ok: false, error: 'download_failed' };
      list = next;
      lastUpdatedAt = Date.now();
      await saveCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function offline() {
  return process.env.NODE_ENV === 'test' || !!process.env.FILO_SMOKE;
}

// Un giro fallito si ritenta a tempo finché la lista serve: vedi retryList.js.
const refreshInBackground = require('./retryList').makeRetry(() => refresh(), () => enabled && !offline());

function ensurePeriodicRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { if (enabled) refreshInBackground().catch(() => {}); }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref();
}

function isOn(settings) {
  const m = settings && settings.security && settings.security.cookies && settings.security.cookies.mode;
  return m !== 'manual';
}

async function init(settings) {
  enabled = isOn(settings);
  await loadCache();
  if (offline() || !enabled) return;
  ensurePeriodicRefresh();
  if (!lastUpdatedAt || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS) refreshInBackground().catch(() => {});
}

function configureFromSettings(settings) {
  const was = enabled;
  enabled = isOn(settings);
  if (offline() || !enabled) return;
  ensurePeriodicRefresh();
  if (!was && (!lastUpdatedAt || (Date.now() - lastUpdatedAt) >= REFRESH_INTERVAL_MS)) refreshInBackground().catch(() => {});
}

// Solo per i test: una lista scritta a mano, senza rete.
function setListForTest(text) {
  list = parseCosmetic(text);
  lastUpdatedAt = Date.now();
}

module.exports = {
  PRIMARY,
  FALLBACK,
  parseCosmetic,
  hostKeys,
  forHost,
  matchTokens,
  refresh,
  init,
  configureFromSettings,
  setListForTest,
};
