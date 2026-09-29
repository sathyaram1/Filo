// Safe Browsing per prefissi d'impronta: canonicalizzazione ed espressioni del protocollo, cache per prefisso, verdetto.
// Verso il servizio escono solo prefissi di 4 byte; l'indirizzo, il sito e il percorso non lasciano mai il computer.
// Indirizzo e formato del servizio stanno in net.js (hashesSearch); le prove in tests/unit/safebrowsePrefissi.test.mjs.

'use strict';

const crypto = require('node:crypto');
const { domainToASCII } = require('node:url');

const MAX_UNESCAPE = 1024;

function unescapeOnce(s) {
  return s.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function escapeBytes(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += (c <= 0x20 || c >= 0x7f || c === 0x23 || c === 0x25)
      ? '%' + c.toString(16).toUpperCase().padStart(2, '0')
      : s[i];
  }
  return out;
}

function schemeOf(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[a-zA-Z]/.test(c)) continue;
    if (/[0-9+\-.]/.test(c)) { if (i === 0) return ['', s]; continue; }
    if (c === ':') return [s.slice(0, i).toLowerCase(), s.slice(i + 1)];
    return ['', s];
  }
  return ['', s];
}

// Un numero di un indirizzo IP scritto come lo accetta un resolver: decimale, ottale (0…) o esadecimale (0x…).
function ipNumber(s) {
  let v;
  if (/^0x[0-9a-f]+$/i.test(s)) v = parseInt(s.slice(2), 16);
  else if (/^0[0-7]*$/.test(s)) v = parseInt(s, 8);
  else if (/^[1-9][0-9]*$/.test(s)) v = Number(s);
  else return null;
  return Number.isFinite(v) && v <= 0xffffffff ? v : null;
}

function canonicalIp(host) {
  if (!/^(?:0x[0-9a-f]+|[0-9.])+$/i.test(host)) return '';
  const parts = host.split('.');
  if (parts.length > 4) return '';
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const v = ipNumber(parts[i]);
    if (v === null) return '';
    const n = i === parts.length - 1 ? 5 - parts.length : 1;
    const bytes = [];
    for (let k = 0, x = v; k < n; k++, x = Math.floor(x / 256)) bytes.unshift(x % 256);
    out.push(...bytes);
  }
  return out.join('.');
}

function canonicalHost(hostish) {
  let host = hostish.slice(hostish.lastIndexOf('@') + 1);
  if (host.startsWith('[') && !host.includes(']')) return null;
  host = host.replace(/:\d+$/, '');
  const raw = unescapeOnce(host);
  if (/[\x81-\xff]/.test(raw)) {
    host = domainToASCII(Buffer.from(raw, 'latin1').toString('utf8'));
    if (!host) return null;
  }
  host = host.replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!host) return null;
  return canonicalIp(host) || host.toLowerCase();
}

function cleanPath(p) {
  if (!p) return '/';
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const r = '/' + out.join('/');
  return r !== '/' && p.endsWith('/') ? r + '/' : r;
}

// Forma canonica del protocollo Safe Browsing. Accetta anche un Buffer, per gli esempi ufficiali scritti a byte.
function canonicalize(input) {
  if (input == null) return null;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  let s = bytes.toString('latin1').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\r\n]/g, '');
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(0, hash);
  for (let i = 0; ; i++) {
    if (i >= MAX_UNESCAPE) return null;
    const t = unescapeOnce(s);
    if (t === s) break;
    s = t;
  }
  s = escapeBytes(s);
  let [scheme, rest] = schemeOf(s);
  const q = rest.indexOf('?');
  const hasQuery = q >= 0;
  const query = hasQuery ? rest.slice(q + 1) : '';
  if (hasQuery) rest = rest.slice(0, q);
  if (scheme) {
    if (!rest.startsWith('//')) return null;
    rest = rest.slice(2);
  } else {
    scheme = 'http';
  }
  const slash = rest.indexOf('/');
  const hostish = slash >= 0 ? rest.slice(0, slash) : rest;
  if (!hostish) return null;
  const host = canonicalHost(hostish);
  if (!host) return null;
  const path = cleanPath(slash >= 0 ? rest.slice(slash) : '');
  return { scheme, host, path, query, url: `${scheme}://${host}${path}${hasQuery ? '?' + query : ''}` };
}

function isIpHost(host) {
  return host.startsWith('[') || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// Espressioni host-suffisso/percorso-prefisso: al massimo 5 host per 6 percorsi, come chiede il protocollo.
function expressions(input) {
  const c = canonicalize(input);
  if (!c) return [];
  const hosts = [c.host];
  if (!isIpHost(c.host)) {
    const comps = c.host.split('.');
    for (let i = Math.max(1, comps.length - 5); i < comps.length - 1; i++) hosts.push(comps.slice(i).join('.'));
  }
  const segs = c.path.split('/').filter(Boolean);
  const paths = ['/'];
  for (let i = 1; i < Math.min(segs.length, 4); i++) paths.push('/' + segs.slice(0, i).join('/') + '/');
  if (c.path !== '/') paths.push(c.path);
  if (c.query) paths.push(c.path + '?' + c.query);
  const out = [];
  for (const h of hosts) for (const p of paths) if (!out.includes(h + p)) out.push(h + p);
  return out;
}

function hashesOf(input) {
  return expressions(input).map((expr) => {
    const full = crypto.createHash('sha256').update(expr, 'latin1').digest();
    return { expr, full: full.toString('base64'), prefix: full.subarray(0, 4).toString('base64') };
  });
}

const SEVERITY = ['malware', 'phishing', 'unwanted'];
const MIN = 60 * 1000;

// `search(prefissi)` → { ok, matches:[{ hash, threatType, category }], cacheMs } | { ok:false, status } | null (nessuna chiave).
function createLookup({ search, now = () => Date.now(), maxEntries = 50000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let failures = 0;
  let pausedUntil = 0;

  function fresh(p) {
    const e = cache.get(p);
    if (!e) return null;
    if (now() >= e.exp) { cache.delete(p); return null; }
    return e;
  }

  function remember(p, e) {
    cache.delete(p);
    cache.set(p, e);
    if (cache.size <= maxEntries) return;
    for (const [k, v] of cache) if (now() >= v.exp) cache.delete(k);
    for (const k of cache.keys()) { if (cache.size <= maxEntries) break; cache.delete(k); }
  }

  function decide(hs, entryOf) {
    const found = [];
    for (const h of hs) {
      const threats = entryOf(h.prefix).full.get(h.full);
      if (threats) found.push(...threats);
    }
    if (!found.length) return { listed: false };
    found.sort((a, b) => SEVERITY.indexOf(a.category) - SEVERITY.indexOf(b.category));
    return { listed: true, category: found[0].category, threatType: found[0].threatType };
  }

  // Verdetto dalla sola cache: undefined se anche un prefisso non ha una risposta valida.
  function peek(url) {
    const hs = hashesOf(url);
    if (!hs.length || hs.some((h) => !fresh(h.prefix))) return undefined;
    return decide(hs, fresh);
  }

  async function request(prefixes) {
    let res;
    try { res = await search(prefixes); } catch (_) { res = { ok: false, status: 0 }; }
    if (!res) return null;
    if (!res.ok) {
      // Solo i rifiuti del servizio rallentano le richieste: offline si riprova alla pagina dopo.
      if (res.status) {
        failures++;
        if (failures >= 2) pausedUntil = now() + Math.min(30 * MIN, MIN * 2 ** (failures - 2) * (1 + Math.random()));
      }
      return null;
    }
    failures = 0;
    const ttl = Math.max(0, Number(res.cacheMs) || 0);
    const got = new Map(prefixes.map((p) => [p, { exp: now() + ttl, full: new Map() }]));
    for (const m of res.matches || []) {
      const e = got.get(Buffer.from(m.hash, 'base64').subarray(0, 4).toString('base64'));
      if (!e) continue;
      const list = e.full.get(m.hash) || [];
      list.push({ threatType: m.threatType, category: m.category });
      e.full.set(m.hash, list);
    }
    if (ttl > 0) for (const [p, e] of got) remember(p, e);
    return got;
  }

  // null quando il verdetto non si conosce (senza chiave, offline, errore del servizio): mai «pulito» per ripiego.
  async function check(url) {
    const hs = hashesOf(url);
    if (!hs.length) return null;
    const prefixes = [...new Set(hs.map((h) => h.prefix))];
    const found = new Map();
    const waits = [];
    const missing = [];
    for (const p of prefixes) {
      const e = fresh(p);
      if (e) found.set(p, e);
      else if (pending.has(p)) waits.push(pending.get(p).then((e2) => { if (e2) found.set(p, e2); }));
      else missing.push(p);
    }
    if (missing.length) {
      if (now() < pausedUntil) return null;
      const req = request(missing);
      for (const p of missing) {
        const one = req.then((m) => (m && m.get(p)) || null);
        pending.set(p, one);
        one.finally(() => { if (pending.get(p) === one) pending.delete(p); });
      }
      waits.push(req.then((m) => { if (m) for (const [p, e] of m) found.set(p, e); }));
    }
    await Promise.all(waits);
    if (prefixes.some((p) => !found.has(p))) return null;
    return decide(hs, (p) => found.get(p));
  }

  function clear() {
    cache.clear();
    pending.clear();
    failures = 0;
    pausedUntil = 0;
  }

  return { peek, check, clear, _cache: cache };
}

module.exports = { canonicalize, expressions, hashesOf, createLookup };
