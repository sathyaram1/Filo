// SN_SAFEBROWSE: punto d'ingresso del rilevamento siti pericolosi.
//
// Espone:
//   checkSync(url, ctx)            verdetto immediato dai SOLI segnali locali +
//                                  dati di rete già in cache (mai blocca).
//   analyze(url, ctx, onUpdate)    come sopra ma avvia in background le chiamate
//                                  di rete (GSB/RDAP/CT/sandbox/LLM); quando un
//                                  dato arriva e cambia il verdetto, richiama
//                                  onUpdate(verdict). Le chiamate NON bloccano.
//   recordCert(host, st)           registra l'esito del certificato visto da
//                                  Electron (certificate-error / did-navigate).
//   setProviders(fns)              inietta i fetcher di rete (Task 4/5).
//
// Tutte le forme normalizzate, segnali, brand e whitelist sono raggiungibili da
// qui per i test. Pattern: registra su globalThis (come gli altri moduli) e
// anche su module.exports per require diretto.

'use strict';

const engine = require('./engine');
const normalizeMod = require('./normalize');
const signals = require('./signals');
const brands = require('./brands');
const whitelist = require('./whitelist');
const confusables = require('./confusables');
const psl = require('./psl');
const net = require('./net');
const llm = require('./llm');
const sandbox = require('./sandbox');

// ── Cache TTL semplice ──────────────────────────────────────────────────
class TtlCache {
  constructor(ttlMs) { this.ttl = ttlMs; this.m = new Map(); }
  get(k) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k, v, ttl) { this.m.set(k, { v, exp: Date.now() + (ttl || this.ttl) }); return v; }
  has(k) { return this.get(k) !== undefined; }
  delete(k) { this.m.delete(k); }
}

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Verdetti calcolati: TTL breve (un dominio può diventare malevolo dopo essere
// stato visto pulito). Età dominio: stabile, TTL lungo.
const gsbCache = new TtlCache(30 * MIN);
const ageCache = new TtlCache(7 * DAY);
const certCache = new TtlCache(HOUR);
const sandboxCache = new TtlCache(30 * MIN);
const llmCache = new TtlCache(HOUR);

// Fetcher di rete iniettabili (default: assenti = best-effort no-op).
let providers = { gsb: null, rdap: null, ct: null, sandbox: null, llm: null };
// Chiave GSB letta a ogni verifica: la decide chi è dentro ADESSO (l'admin esce o entra senza ricollegare nulla, #679.4).
let gsbKeyOf = null;
function setProviders(fns) {
  if (fns && 'gsb' in fns) gsbKeyOf = null;
  providers = { ...providers, ...(fns || {}) };
}
function currentGsbKey() {
  try { return String((gsbKeyOf && gsbKeyOf()) || '').trim(); } catch (_) { return ''; }
}

// Configura i provider dai moduli reali, usando le impostazioni correnti.
//   opts.gsbKey       chiave Google Safe Browsing, o funzione che la dà al momento
//                     della verifica (se assente o vuota → stage 1 saltato)
//   opts.runLlm       funzione (messages) → testo, per il giudice LLM
//   opts.enableSandbox  abilita la detonation (default true se Electron c'è)
//   opts.enableNetwork  abilita RDAP/CT (default true)
function configure(opts = {}) {
  const { gsbKey, runLlm, enableSandbox = true, enableNetwork = true } = opts;
  const keyOf = typeof gsbKey === 'function' ? gsbKey : (gsbKey ? () => gsbKey : null);
  setProviders({
    gsb: keyOf ? ((rawUrl) => {
      const k = currentGsbKey();
      return k ? net.safeBrowsingLookup(rawUrl, k) : null;
    }) : null,
    rdap: enableNetwork ? ((reg) => net.rdapAgeDays(reg)) : null,
    ct: enableNetwork ? ((reg) => net.ctFirstSeenDays(reg)) : null,
    llm: typeof runLlm === 'function' ? ((meta) => llm.judge(meta, runLlm)) : null,
    sandbox: enableSandbox ? ((url) => sandbox.detonate(url, (finalUrl) => checkSync(finalUrl))) : null,
  });
  gsbKeyOf = keyOf;
}

// Esito certificato osservato dalla webview reale (la fonte più affidabile). Vale per l'host che l'ha mostrato: su una
// piattaforma di hosting il certificato rotto di un sito non dice niente dei vicini.
function recordCert(host, status) {
  if (host && status) certCache.set(String(host).toLowerCase(), { status });
}

// Una pagina ospitata ha un verdetto suo: con la chiave del solo host un modulo segnalato colpirebbe tutti gli altri.
function pageKey(norm, url) {
  const hosted = url && whitelist.hostedPlatform(norm.host, pathOf(url));
  return hosted ? norm.host + pathOf(url) : norm.host;
}

function pathOf(url) {
  try { return new URL(String(url)).pathname; } catch (_) { return '/'; }
}

// Il freno conta le chiamate, il verdetto resta del sito (#591): su una piattaforma di hosting che Filo non conosce un
// dominio è di migliaia di proprietari, e la risposta di uno non vale per un altro. Il conto è per proprietario
// dell'indirizzo, che una pagina non può inventarsi: qualche controllo all'ora, oltre i siti nuovi restano col verdetto locale.
const DEEP_BUDGET = 5;

// Una rete: chi ha un server ha di solito un /64 IPv6 (e spesso un /48), cioè miliardi di indirizzi suoi.
function networkOf(ip) {
  const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = (s) => s.split('.').slice(0, 3).join('.') + '.0/24';
  if (!a.includes(':')) return v4(a);
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  let head = a;
  let tail = [];
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    head = a.slice(0, -dotted[1].length).replace(/:$/, '');
    tail = [((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)];
  }
  const [l, r] = head.split('::');
  const left = l ? l.split(':') : [];
  const right = (r !== undefined && r) ? r.split(':') : [];
  const fill = head.includes('::') ? Array(Math.max(0, 8 - left.length - right.length - tail.length)).fill('0') : [];
  const h = left.concat(fill, right, tail).map((x) => parseInt(x || '0', 16));
  // Un IPv4 scritto come IPv6 (::ffff:1.2.3.4) è quell'IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return v4([h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255].join('.'));
  }
  return h.slice(0, 3).map((x) => x.toString(16)).join(':') + '::/48';
}

function ownerKey(norm, url) {
  if (norm.isIp) return networkOf(norm.host);
  const owner = whitelist.hostedOwner(norm.host, pathOf(url));
  return owner !== null ? norm.host + owner : norm.registrable;
}

// Di chi è un indirizzo, per il conto di ogni chiamata che Filo fa da solo (anche il blocco geografico). Una pagina si
// riscrive l'indirizzo senza navigare (history.pushState) sulla stessa origine e con qualunque percorso: il conto va a
// chi l'ha servita davvero, `loadedUrl`, l'ultimo indirizzo navigato dalla scheda.
function ownerOf(url, loadedUrl) {
  const norm = normalizeMod.normalize(url);
  return norm && norm.ok ? budgetKey(norm, url, loadedUrl) : null;
}

function budgetKey(norm, url, loaded) {
  if (loaded && loaded !== url) {
    try {
      if (new URL(String(loaded)).origin === new URL(String(url)).origin) return ownerOf(loaded) || ownerKey(norm, url);
    } catch (_) {}
  }
  return ownerKey(norm, url);
}

// Qualche chiamata all'ora per chiave; la stessa regola per ogni lavoro automatico che chiama il modello.
function createOwnerBudget({ perHour = DEEP_BUDGET, max = 5000 } = {}) {
  const m = new Map();
  return {
    m,
    spend(k) {
      const now = Date.now();
      const recent = (m.get(k) || []).filter((t) => now - t < HOUR);
      m.delete(k);
      if (recent.length >= perHour) { m.set(k, recent); return false; }
      recent.push(now);
      m.set(k, recent);
      // Tetto largo: una chiave dimenticata riparte col conto pieno, e costa qualche chiamata, non un buco.
      if (m.size > max) m.delete(m.keys().next().value);
      return true;
    },
  };
}

// Gli indizi che vede il giudice: lo stesso sito con indizi diversi è un'altra domanda.
function cluesOf(norm, ctx, verdict) {
  const imp = verdict.imp || null;
  return [
    imp ? imp.brand.display : '', imp ? imp.kind : '', verdict.hosted || '',
    ctx.linkOrigin || '', ctx.hasPassword ? 'pw' : '', ctx.hasPayment ? 'pay' : '', norm.secure ? 'tls' : '',
  ].join('|');
}

const deepBudget = createOwnerBudget();
const spend = (k) => deepBudget.spend(k);

// Un controllo che non ha dato verdetto (risposta illeggibile, fornitore in errore) non si ripete sullo stesso sito per poco.
const FAILED_RETRY_MS = 5 * MIN;
const deepFailed = new TtlCache(FAILED_RETRY_MS);

// Due analisi dello stesso sito con gli stessi indizi in volo insieme fanno una chiamata sola.
const inflight = new Map();
function once(key, run) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(run).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function deepen(stage, bKey, siteKey, run, store) {
  const k = stage + ':' + siteKey;
  if (inflight.has(k)) return inflight.get(k);
  if (deepFailed.has(k) || !spend(stage + ':' + bKey)) return null;
  return once(k, () => Promise.resolve(run()).then((r) => {
    if (!r) { deepFailed.set(k, true); return null; }
    store(r);
    return r;
  }, () => { deepFailed.set(k, true); return null; }));
}

// La rete di casa (router, NAS, stampanti, localhost) non ha niente da chiedere fuori: nessuno stadio di rete parte.
const UrlNav = globalThis.SN_URL_NAV || (require('../../../shared/urlNav.js'), globalThis.SN_URL_NAV);
const isHomeNetwork = (norm) => Boolean(UrlNav && UrlNav.isHomeNetworkHost(norm.host));

// Assembla i dati di rete già noti (da cache) per il dominio.
function assembleCached(norm, url) {
  if (!norm || !norm.registrable) return {};
  const reg = norm.registrable;
  return {
    gsb: gsbCache.get('u:' + pageKey(norm, url)) || gsbCache.get(reg),
    ageDays: ageCache.get(reg),
    cert: certCache.get(norm.host),
    sandbox: sandboxCache.get(pageKey(norm, url)),
    llm: llmCache.get(pageKey(norm, url)),
  };
}

function checkSync(url, ctx = {}) {
  const norm = normalizeMod.normalize(url);
  const asyncData = norm ? assembleCached(norm, url) : {};
  return engine.evaluate(url, ctx, asyncData);
}

// Avvia le chiamate di rete mancanti in background. Aggiorna le cache e, se il
// verdetto cambia, richiama onUpdate. Ritorna SUBITO il verdetto sincrono.
function analyze(url, ctx = {}, onUpdate) {
  const norm = normalizeMod.normalize(url);
  if (!norm || !norm.ok) return engine.evaluate(url, ctx, {});
  const first = engine.evaluate(url, ctx, assembleCached(norm, url));

  // Se è già pericoloso da blacklist/strict, non serve altro.
  if (first.level === 'pericoloso' && (first.reasons || []).some((r) => /^gsb_|strict/.test(r))) {
    return first;
  }

  const pending = UrlNav && UrlNav.homeNetworkPending(norm.host);
  if (pending) {
    pending.then(() => {
      const next = analyze(url, ctx, onUpdate);
      if (typeof onUpdate === 'function' && verdictChanged(first, next)) onUpdate(next);
    });
    return first;
  }
  if (isHomeNetwork(norm)) return first;

  const reg = norm.registrable;
  const tasks = [];
  const need = assembleCached(norm, url);
  const key = pageKey(norm, url);

  if (providers.gsb && need.gsb === undefined) {
    tasks.push(Promise.resolve(providers.gsb(url, norm)).then((r) => {
      if (r) gsbCache.set('u:' + key, r);
    }).catch(() => {}));
  }
  if (providers.rdap && need.ageDays === undefined) {
    tasks.push(Promise.resolve(providers.rdap(reg, norm)).then((days) => {
      if (typeof days === 'number') ageCache.set(reg, days);
    }).catch(() => {}));
  }
  if (providers.ct && need.ageDays === undefined && !need.cert) {
    tasks.push(Promise.resolve(providers.ct(reg, norm)).then((r) => {
      // CT dà l'età del PRIMO certificato: usala solo se RDAP non ha risposto.
      if (r && typeof r.firstSeenDays === 'number' && ageCache.get(reg) === undefined) {
        ageCache.set(reg, r.firstSeenDays);
      }
    }).catch(() => {}));
  }
  // LLM e sandbox solo se c'è un sospetto non conclusivo (mai su pulito/whitelist).
  const worthDeepening = first.level === 'sospetto' || first.needsLlm;
  const bKey = budgetKey(norm, url, ctx.budgetUrl);
  const siteKey = key + '|' + cluesOf(norm, ctx, first);
  const deep = (t) => { if (t) tasks.push(t); };
  if (worthDeepening && providers.llm && need.llm === undefined) {
    const llm = providers.llm;
    const meta = buildLlmMeta(norm, ctx, first);
    deep(deepen('llm', bKey, siteKey, () => llm(meta), (r) => llmCache.set(key, r)));
  }
  if (worthDeepening && providers.sandbox && need.sandbox === undefined) {
    const detonate = providers.sandbox;
    deep(deepen('sb', bKey, siteKey, () => detonate(url, norm), (r) => sandboxCache.set(key, r)));
  }

  if (tasks.length && typeof onUpdate === 'function') {
    Promise.allSettled(tasks).then(() => {
      const next = engine.evaluate(url, ctx, assembleCached(norm, url));
      if (verdictChanged(first, next)) onUpdate(next);
    });
  }
  return first;
}

// Metadati (MAI contenuto pagina) passati all'LLM: solo provenienza/identità.
function buildLlmMeta(norm, ctx, verdict) {
  const imp = verdict.imp || null;
  return {
    host: norm.hostUnicode,
    registrable: norm.registrableUnicode,
    publicSuffix: norm.publicSuffix,
    looksLikeBrand: imp ? imp.brand.display : null,
    impersonationKind: imp ? imp.kind : null,
    hostedOn: verdict.hosted || null,
    ageDays: assembleCached(norm).ageDays ?? null,
    certStatus: assembleCached(norm).cert?.status ?? null,
    linkOrigin: ctx.linkOrigin || null,
    hasPassword: !!ctx.hasPassword,
    hasPayment: !!ctx.hasPayment,
    secure: norm.secure,
  };
}

function verdictChanged(a, b) {
  if (!a || !b) return true;
  if (a.level !== b.level) return true;
  const am = a.message && a.message.body, bm = b.message && b.message.body;
  return am !== bm;
}

function scopeOf(url) {
  const norm = normalizeMod.normalize(url);
  if (!norm || !norm.ok) return null;
  return whitelist.hostedPlatform(norm.host, pathOf(url)) ? norm.host + pathOf(url) : norm.registrable;
}

const API = {
  checkSync,
  scopeOf,
  ownerOf,
  createOwnerBudget,
  analyze,
  evaluate: engine.evaluate,
  recordCert,
  setProviders,
  configure,
  // Quali stadi di rilevamento sono attivi dopo l'ultima configure() (diagnostica
  // e test): gsb=true significa che la chiave Google Safe Browsing è in uso.
  activeProviders() {
    return {
      gsb: !!providers.gsb && (gsbKeyOf ? !!currentGsbKey() : true),
      rdap: !!providers.rdap,
      ct: !!providers.ct,
      llm: !!providers.llm,
      sandbox: !!providers.sandbox,
    };
  },
  // cache (per test / invalidazione)
  DEEP_BUDGET,
  _caches: { gsbCache, ageCache, certCache, sandboxCache, llmCache, deepBudget, deepFailed },
  // sotto-moduli (per test)
  normalize: normalizeMod.normalize,
  parseHost: normalizeMod.parseHost,
  signals,
  brands,
  whitelist,
  confusables,
  psl,
  engine,
  net,
  llm,
  sandbox,
};

globalThis.SN_SAFEBROWSE = API;
module.exports = API;
