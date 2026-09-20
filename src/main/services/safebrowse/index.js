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

// ── Cache TTL semplice, con un fondo ────────────────────────────────────
// #591 — la scadenza da sola non basta a tenerla piccola: chi controlla un
// dominio può far comparire host sempre nuovi più in fretta di quanto scadano.
// Oltre `max` esce la voce inserita per prima.
class TtlCache {
  constructor(ttlMs, max = 2000) { this.ttl = ttlMs; this.max = max; this.m = new Map(); }
  get(k) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k, v, ttl) {
    if (this.m.size >= this.max && !this.m.has(k)) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
    this.m.set(k, { v, exp: Date.now() + (ttl || this.ttl) });
    return v;
  }
  has(k) { return this.get(k) !== undefined; }
  delete(k) { this.m.delete(k); }
}

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Verdetti calcolati: TTL breve (un dominio può diventare malevolo dopo essere
// stato visto pulito). Età dominio: stabile, TTL lungo.
const gsbCache = new TtlCache(30 * MIN);
const ageCache = new TtlCache(7 * DAY);
const certCache = new TtlCache(HOUR);
// #591 — giudizio del modello e finestra nascosta si ricordano per DOMINIO
// REGISTRABILE, non per host completo: con la chiave sull'host bastavano
// sottodomini sempre nuovi sullo stesso dominio per far ripartire ogni volta
// una chiamata al modello e una finestra nascosta, aggirando l'unico freno che
// c'era. Sono i due stadi che costano (soldi l'uno, una finestra con
// JavaScript attivo l'altro); gli altri restano come stavano.
const sandboxCache = new TtlCache(30 * MIN);
const llmCache = new TtlCache(HOUR);

// Chiamate già in volo, per dominio registrabile. La cache si riempie solo
// quando la risposta arriva: senza questo, cinquanta sottodomini aperti insieme
// facevano partire cinquanta chiamate prima che la prima rispondesse.
const llmInFlight = new Set();
const sandboxInFlight = new Set();

// Fetcher di rete iniettabili (default: assenti = best-effort no-op).
let providers = { gsb: null, rdap: null, ct: null, sandbox: null, llm: null };
function setProviders(fns) { providers = { ...providers, ...(fns || {}) }; }

// Configura i provider dai moduli reali, usando le impostazioni correnti.
//   opts.gsbKey       chiave Google Safe Browsing (se assente → stage 1 saltato)
//   opts.runLlm       funzione (messages) → testo, per il giudice LLM
//   opts.enableSandbox  abilita la detonation (default true se Electron c'è)
//   opts.enableNetwork  abilita RDAP/CT (default true)
function configure(opts = {}) {
  const { gsbKey, runLlm, enableSandbox = true, enableNetwork = true } = opts;
  setProviders({
    gsb: gsbKey ? ((rawUrl) => net.safeBrowsingLookup(rawUrl, gsbKey)) : null,
    rdap: enableNetwork ? ((reg) => net.rdapAgeDays(reg)) : null,
    ct: enableNetwork ? ((reg) => net.ctFirstSeenDays(reg)) : null,
    llm: typeof runLlm === 'function' ? ((meta) => llm.judge(meta, runLlm)) : null,
    sandbox: enableSandbox ? ((url) => sandbox.detonate(url, (finalUrl) => checkSync(finalUrl))) : null,
  });
}

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
    sandbox: sandboxCache.get(reg),
    llm: llmCache.get(reg),
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
  // Il segno "già in volo" si toglie SEMPRE, anche se il provider salta subito:
  // un segno rimasto lì spegnerebbe il controllo su quel dominio per sempre.
  const inVolo = (insieme, avvia, salva) => {
    insieme.add(reg);
    tasks.push((async () => {
      try {
        const r = await avvia();
        if (r) salva(r);
      } catch (_) {
        /* best-effort: uno stadio profondo che non risponde non ferma il resto */
      } finally {
        insieme.delete(reg);
      }
    })());
  };
  if (worthDeepening && providers.llm && need.llm === undefined && !llmInFlight.has(reg)) {
    inVolo(llmInFlight, () => providers.llm(buildLlmMeta(norm, ctx, first)), (r) => llmCache.set(reg, r));
  }
  if (worthDeepening && providers.sandbox && need.sandbox === undefined && !sandboxInFlight.has(reg)) {
    inVolo(sandboxInFlight, () => providers.sandbox(url, norm), (r) => sandboxCache.set(reg, r));
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
  configure,
  // Quali stadi di rilevamento sono attivi dopo l'ultima configure() (diagnostica
  // e test): gsb=true significa che la chiave Google Safe Browsing è in uso.
  activeProviders() {
    return {
      gsb: !!providers.gsb,
      rdap: !!providers.rdap,
      ct: !!providers.ct,
      llm: !!providers.llm,
      sandbox: !!providers.sandbox,
    };
  },
  // cache (per test / invalidazione)
  _caches: { gsbCache, ageCache, certCache, sandboxCache, llmCache },
  // Chiamate in volo per dominio registrabile (test e diagnostica).
  _inFlight: { llm: llmInFlight, sandbox: sandboxInFlight },
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
