// SN_SAFEBROWSE: punto d'ingresso del rilevamento siti pericolosi.
//
// Espone:
//   checkSync(url, ctx)            verdetto immediato dai SOLI segnali locali +
//                                  dati di rete già in cache (mai blocca).
//   analyze(url, ctx, onUpdate)    come sopra ma avvia in background le chiamate
//                                  di rete (GSB/RDAP/CT/sandbox/LLM); quando un
//                                  dato arriva e cambia il verdetto, richiama
//                                  onUpdate(verdict). Le chiamate NON bloccano.
//   recordCert(registrable, st)    registra l'esito del certificato visto da
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
function setProviders(fns) { providers = { ...providers, ...(fns || {}) }; }

// Esito certificato osservato dalla webview reale (la fonte più affidabile).
function recordCert(registrable, status) {
  if (registrable && status) certCache.set(registrable, { status });
}

// Assembla i dati di rete già noti (da cache) per il dominio.
function assembleCached(norm) {
  if (!norm || !norm.registrable) return {};
  const reg = norm.registrable;
  return {
    gsb: gsbCache.get('u:' + norm.host) || gsbCache.get(reg),
    ageDays: ageCache.get(reg),
    cert: certCache.get(reg),
    sandbox: sandboxCache.get(norm.host),
    llm: llmCache.get(norm.host),
  };
}

function checkSync(url, ctx = {}) {
  const norm = normalizeMod.normalize(url);
  const asyncData = norm ? assembleCached(norm) : {};
  return engine.evaluate(url, ctx, asyncData);
}

// Avvia le chiamate di rete mancanti in background. Aggiorna le cache e, se il
// verdetto cambia, richiama onUpdate. Ritorna SUBITO il verdetto sincrono.
function analyze(url, ctx = {}, onUpdate) {
  const norm = normalizeMod.normalize(url);
  if (!norm || !norm.ok) return engine.evaluate(url, ctx, {});
  const first = engine.evaluate(url, ctx, assembleCached(norm));

  // Se è già pericoloso da blacklist/strict, non serve altro.
  if (first.level === 'pericoloso' && (first.reasons || []).some((r) => /^gsb_|strict/.test(r))) {
    return first;
  }

  const reg = norm.registrable;
  const tasks = [];
  const need = assembleCached(norm);

  if (providers.gsb && need.gsb === undefined) {
    tasks.push(Promise.resolve(providers.gsb(url, norm)).then((r) => {
      if (r) gsbCache.set('u:' + norm.host, r);
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
  if (worthDeepening && providers.llm && need.llm === undefined) {
    tasks.push(Promise.resolve(providers.llm(buildLlmMeta(norm, ctx, first))).then((r) => {
      if (r) llmCache.set(norm.host, r);
    }).catch(() => {}));
  }
  if (worthDeepening && providers.sandbox && need.sandbox === undefined) {
    tasks.push(Promise.resolve(providers.sandbox(url, norm)).then((r) => {
      if (r) sandboxCache.set(norm.host, r);
    }).catch(() => {}));
  }

  if (tasks.length && typeof onUpdate === 'function') {
    Promise.allSettled(tasks).then(() => {
      const next = engine.evaluate(url, ctx, assembleCached(norm));
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

const API = {
  checkSync,
  analyze,
  evaluate: engine.evaluate,
  recordCert,
  setProviders,
  // cache (per test / invalidazione)
  _caches: { gsbCache, ageCache, certCache, sandboxCache, llmCache },
  // sotto-moduli (per test)
  normalize: normalizeMod.normalize,
  parseHost: normalizeMod.parseHost,
  signals,
  brands,
  whitelist,
  confusables,
  psl,
  engine,
};

globalThis.SN_SAFEBROWSE = API;
module.exports = API;
