// SN_SAFEBROWSE: punto d'ingresso del rilevamento siti pericolosi.
//
// Espone:
//   checkSync(url, ctx)            verdetto immediato dai SOLI segnali locali +
//                                  dati di rete già in cache (mai blocca).
//   analyze(url, ctx, onUpdate)    come sopra ma avvia in background le chiamate
//                                  di rete (GSB/RDAP/CT/sandbox/LLM); quando un
//                                  dato arriva e cambia il verdetto, richiama
//                                  onUpdate(verdict). Le chiamate NON bloccano.
//                                  ctx.daAprire: un link non ancora aperto (solo
//                                  lì la sandbox); ctx.incognito: niente LLM né sandbox.
//   preverifica(url, ctx)          puntatore fermo su un link accorciato o di rimando
//                                  (#966): lista nera e destinazione prima del clic.
//   preverdetto(url)               il risultato di preverifica per quel link, se c'è.
//   checkLink(url) / checkLinks()  i link di una pagina, coi soli controlli locali (links.js).
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
const gsb = require('./gsb');
const llm = require('./llm');
const sandbox = require('./sandbox');
const rimandi = require('./rimandi');
const links = require('./links');
const { origineLink } = require('./origine');

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
// stato visto pulito). Età dominio: stabile, TTL lungo. Safe Browsing ha la sua cache per prefisso, coi tempi di Google.
const ageCache = new TtlCache(7 * DAY);
const certCache = new TtlCache(HOUR);
const sandboxCache = new TtlCache(30 * MIN);
const llmCache = new TtlCache(HOUR);

// Fetcher di rete iniettabili (default: assenti = best-effort no-op). gsbPeek dà il verdetto già in cache, senza rete.
let providers = { gsb: null, gsbPeek: null, rdap: null, ct: null, sandbox: null, destinazione: null, llm: null };
// Chiave GSB letta a ogni verifica: la decide chi è dentro ADESSO (l'admin esce o entra senza ricollegare nulla, #679.4).
let gsbKeyOf = null;
function setProviders(fns) {
  const next = { ...(fns || {}) };
  if ('gsb' in next) {
    gsbKeyOf = null;
    if (!('gsbPeek' in next)) next.gsbPeek = null;
  }
  providers = { ...providers, ...next };
}
function currentGsbKey() {
  try { return String((gsbKeyOf && gsbKeyOf()) || '').trim(); } catch (_) { return ''; }
}
const gsbLookup = gsb.createLookup({ search: (prefixes) => net.hashesSearch(prefixes, currentGsbKey()) });

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
    gsb: keyOf ? ((rawUrl) => (currentGsbKey() ? gsbLookup.check(rawUrl) : null)) : null,
    gsbPeek: keyOf ? ((rawUrl) => gsbLookup.peek(rawUrl)) : null,
    rdap: enableNetwork ? ((reg) => net.rdapAgeDays(reg)) : null,
    ct: enableNetwork ? ((reg) => net.ctFirstSeenDays(reg)) : null,
    llm: typeof runLlm === 'function' ? ((meta) => llm.judge(meta, runLlm)) : null,
    // `rete`: il proxy della scheda da cui parte il link, che la finestra nascosta ripete (#753.1).
    sandbox: enableSandbox ? ((url, _norm, rete) => sandbox.detonate(url, (finalUrl) => checkSync(finalUrl), { rete })) : null,
    destinazione: enableSandbox ? ((url, rete) => sandbox.destinazione(url, rimandi.siApre, { rete })) : null,
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
  const hosted = url && whitelist.hostedPlatform(norm.host, pathOf(norm, url));
  return hosted ? norm.host + pathOf(norm, url) : norm.host;
}

const pathOf = (norm, url) => whitelist.pagePath(norm.host, url);

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
  const owner = whitelist.hostedOwner(norm.host, pathOf(norm, url));
  return owner !== null ? norm.host + owner : norm.registrable;
}

// Di chi è un indirizzo, per il conto di ogni chiamata che Filo fa da solo. Una pagina si riscrive il percorso senza
// navigare (history.pushState): il conto va a chi l'ha servita davvero, `loadedUrl`, l'ultimo indirizzo navigato.
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

// Le analisi ancora in corso: una prova aspetta che finiscano, non un numero di millisecondi (#1063).
const running = new Set();
function track(p) {
  running.add(p);
  p.then(() => running.delete(p), () => running.delete(p));
  return p;
}
async function settled() {
  while (running.size) await Promise.allSettled([...running]);
}

// In volo una per pagina, qualunque indizio abbia l'analisi che arriva dopo: la risposta si ricorda per pagina.
function deepen(stage, bKey, pKey, siteKey, run, store) {
  const fly = stage + ':' + pKey;
  const k = stage + ':' + siteKey;
  if (inflight.has(fly)) return inflight.get(fly);
  if (deepFailed.has(k) || !spend(stage + ':' + bKey)) return null;
  return once(fly, () => Promise.resolve(run()).then((r) => {
    if (!r) { deepFailed.set(k, true); return null; }
    store(r);
    return r;
  }, () => { deepFailed.set(k, true); return null; }));
}

// La rete di casa (router, NAS, stampanti, localhost) non ha niente da chiedere fuori: nessuno stadio di rete parte.
const UrlNav = globalThis.SN_URL_NAV || (require('../../../shared/urlNav.js'), globalThis.SN_URL_NAV);
const isHomeNetwork = (norm) => Boolean(UrlNav && UrlNav.isHomeNetworkHost(norm.host));

// «Non si sa» si ricorda anche lui: un giorno se il registro ha risposto senza l'età, pochi minuti se non ha risposto.
const AGE_UNKNOWN_MS = DAY;
const AGE_RETRY_MS = 5 * MIN;

// Nessun registro ha l'età utile: un IP, il sito di un utente su una piattaforma, una pagina ospitata sotto un dominio
// in whitelist (l'età sarebbe della piattaforma), un sito in whitelist.
function ageUnknowable(norm, url) {
  return norm.isIp || norm.ospitato || whitelist.isWhitelisted(norm.registrable) || !!whitelist.hostedPlatform(norm.host, pathOf(norm, url));
}

// Un indizio non conclusivo, mai su un sito in whitelist: lì l'identità è certa e il giudizio non ha niente da aggiungere.
const deepWorth = (v) => !v.whitelisted && (v.level === 'sospetto' || v.needsLlm);

const settle = (v) => Promise.resolve(v).then((r) => r, () => net.TRANSIENT);

// crt.sh solo se RDAP non ha dato l'età.
async function lookupAge(reg, norm, ctOk) {
  let transient = false;
  if (providers.rdap) {
    const r = await settle(providers.rdap(reg, norm));
    if (typeof r === 'number') { ageCache.set(reg, r); return; }
    if (r && r.transient) transient = true;
  }
  if (providers.ct && ctOk) {
    const r = await settle(providers.ct(reg, norm));
    if (r && typeof r.firstSeenDays === 'number') { ageCache.set(reg, r.firstSeenDays); return; }
    if (r && r.transient) transient = true;
  }
  ageCache.set(reg, null, transient ? AGE_RETRY_MS : AGE_UNKNOWN_MS);
}

// Assembla i dati di rete già noti (da cache) per il dominio.
function assembleCached(norm, url) {
  if (!norm || !norm.registrable) return {};
  const reg = norm.registrable;
  return {
    gsb: providers.gsbPeek && url ? providers.gsbPeek(url) : undefined,
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

// Il verdetto sincrono torna SUBITO: il resto aggiorna le cache in background.
function analyze(url, ctx = {}, onUpdate) {
  const norm = normalizeMod.normalize(url);
  if (!norm || !norm.ok) return engine.evaluate(url, ctx, {});
  const first = engine.evaluate(url, ctx, assembleCached(norm, url));

  // Se è già pericoloso da blacklist/strict, non serve altro. Un verdetto Safe Browsing dato da una parte dell'indirizzo
  // si completa in sottofondo: la pagina può essere in lista con una categoria più grave di quella del sito.
  if (first.level === 'pericoloso' && (first.reasons || []).some((r) => /^gsb_|strict/.test(r))) {
    if (first.gsb && first.gsb.partial && providers.gsb && typeof onUpdate === 'function') {
      Promise.resolve(providers.gsb(url, norm)).then((r) => {
        if (!r || r.partial) return;
        const next = engine.evaluate(url, ctx, { ...assembleCached(norm, url), gsb: r });
        if (verdictChanged(first, next)) onUpdate(next);
      }).catch(() => {});
    }
    return first;
  }

  const pending = UrlNav && UrlNav.homeNetworkPending(norm.host);
  if (pending) {
    track(pending.then(() => {
      const next = analyze(url, ctx, onUpdate);
      if (typeof onUpdate === 'function' && verdictChanged(first, next)) onUpdate(next);
    }));
    return first;
  }
  if (isHomeNetwork(norm)) return first;

  const reg = norm.registrable;
  const tasks = [];
  const need = assembleCached(norm, url);
  const key = pageKey(norm, url);
  // Il nome del sito esce verso i registri solo con lo stesso indizio che chiama il giudice (#894).
  const worthDeepening = deepWorth(first);

  // La risposta decide questa verifica anche quando Google chiede di non tenerla in cache.
  let gsbNow;
  if (providers.gsb && need.gsb === undefined) {
    // In volo una per indirizzo: l'arrivo e la pagina pronta chiedono a pochi millisecondi (#813.1).
    const gsb = providers.gsb;
    tasks.push(once('gsb:' + url, () => gsb(url, norm)).then((r) => {
      if (r) gsbNow = r;
    }).catch(() => {}));
  }
  const known = () => {
    const data = assembleCached(norm, url);
    if (data.gsb === undefined && gsbNow) data.gsb = gsbNow;
    return data;
  };
  let last = first;
  const notify = () => {
    if (typeof onUpdate !== 'function') return;
    const next = engine.evaluate(url, ctx, known());
    if (verdictChanged(last, next)) { last = next; try { onUpdate(next); } catch (_) {} }
  };
  let ageTask = null;
  if (worthDeepening && need.ageDays === undefined && (providers.rdap || providers.ct) && !ageUnknowable(norm, url)) {
    const ctOk = !need.cert;
    ageTask = once('age:' + reg, () => lookupAge(reg, norm, ctOk)).then(notify);
    tasks.push(ageTask);
  }
  // LLM e sandbox solo se c'è un sospetto non conclusivo (mai su pulito/whitelist). Con l'età in arrivo si decide dopo
  // l'età: un sito vecchio con una password perde l'indizio senza spendere giudizio e finestra, e il giudizio la riceve.
  const bKey = budgetKey(norm, url, ctx.budgetUrl);
  const deepTasks = (verdict) => {
    // Chi legge una pagina per il modello (LEGGI_PAGINA) li salta: la sandbox farebbe girare il codice di un sito scelto dal modello (#553).
    if (ctx.senzaApprofondire || !deepWorth(verdict)) return [];
    const siteKey = key + '|' + cluesOf(norm, ctx, verdict);
    const out = [];
    // In incognito nessun lavoro che consuma crediti o visita il sito di nuovo (#1081).
    if (ctx.incognito) return out;
    if (providers.llm && llmCache.get(key) === undefined) {
      const llm = providers.llm;
      const meta = buildLlmMeta(norm, ctx, verdict);
      out.push(deepen('llm', bKey, key, siteKey, () => llm(meta), (r) => llmCache.set(key, r)));
    }
    // Riaprire una pagina già aperta è una seconda visita, senza cookie, che ripete quello che il suo indirizzo fa al
    // GET (una conferma, un token monouso): la finestra nascosta prova solo un link prima che si apra (#1081).
    if (providers.sandbox && ctx.daAprire === true && sandboxCache.get(key) === undefined) {
      const detonate = providers.sandbox;
      out.push(deepen('sb', bKey, key, siteKey, () => detonate(url, norm, ctx.rete || null), (r) => sandboxCache.set(key, r)));
    }
    return out.filter(Boolean);
  };
  if (worthDeepening && ageTask) {
    tasks.push(ageTask.then(() => Promise.allSettled(deepTasks(engine.evaluate(url, ctx, known())))));
  } else if (worthDeepening) {
    tasks.push(...deepTasks(first));
  }

  if (tasks.length) track(Promise.allSettled(tasks).then(notify));
  return first;
}

// ── Link accorciati e di rimando, prima del clic (#966) ─────────────────
// Il risultato è del link esatto: due link dello stesso accorciatore portano in posti diversi.
const PRE_TTL = 30 * MIN;
const preCache = new TtlCache(PRE_TTL);
// Per sito della pagina: chi ci passa sopra a mano non arriva al tetto, una pagina che cambia i link sotto il puntatore sì.
const PRE_PER_ORA = 120;
const preBudget = createOwnerBudget({ perHour: PRE_PER_ORA });
const MAX_PASSI = 8;

function preverdetto(url) {
  return preCache.get(String(url || '')) || null;
}

// Un link qualunque non manda niente in rete prima del clic: solo un accorciato o un rimando noto. La lista nera per
// ogni indirizzo da cui il link passa; la finestra nascosta solo se la destinazione non è scritta nel link, mai in
// incognito (#1081). Torna la promessa del risultato, o null se non parte niente.
function preverifica(url, ctx = {}) {
  const link = String(url || '');
  if (!rimandi.tipo(link) || (!providers.gsb && !providers.destinazione)) return null;
  const gia = preCache.get(link);
  // Senza finestra (in incognito, o a interruttore spento) la destinazione non si è cercata: dove si può, si cerca.
  if (gia && !(gia.finito && gia.senzaFinestra && !ctx.incognito && providers.destinazione)) return gia.pronto;
  const chi = (ctx.pagina && ownerOf(ctx.pagina)) || 'filo';
  if (!preBudget.spend(chi)) {
    console.warn(`[safebrowse] ${PRE_PER_ORA} link accorciati controllati in un'ora su ${chi}: ${link} si controlla all'apertura`);
    return null;
  }
  const voce = { link, passi: [link], destinazione: null, verdetto: null, finito: false };
  voce.pronto = track(preEsegui(voce, ctx).catch(() => {}).then(() => {
    voce.finito = true;
    // Lasciato a un link più recente: ripassandoci sopra si ricomincia, a meno che la lista nera abbia già parlato.
    if (voce.annullato && !(voce.verdetto && voce.verdetto.level !== 'safe')) preCache.delete(link);
    else preCache.set(link, voce, voce.destinazione ? PRE_TTL : FAILED_RETRY_MS);
    return voce;
  }));
  preCache.set(link, voce);
  return voce.pronto;
}

async function preEsegui(voce, ctx) {
  const chieste = new Map();
  const chiedi = (u) => {
    if (chieste.has(u)) return;
    const n = normalizeMod.normalize(u);
    const gsb = providers.gsb;
    chieste.set(u, gsb && n && n.ok && !isHomeNetwork(n)
      ? once('gsb:' + u, () => gsb(u, n)).catch(() => null) : Promise.resolve(null));
  };
  chiedi(voce.link);
  voce.destinazione = await preDestinazione(voce, ctx);
  for (const p of voce.passi) chiedi(p);
  const esiti = new Map();
  await Promise.all([...chieste].map(([u, p]) => p.then((r) => { esiti.set(u, r); })));
  voce.verdetto = verdettoDelLink(voce, esiti);
}

async function preDestinazione(voce, ctx) {
  let cur = voce.link;
  for (let i = 0; i < MAX_PASSI; i++) {
    const t = rimandi.tipo(cur);
    if (!t) return cur;
    if (t.destinazione) { cur = t.destinazione; voce.passi.push(cur); continue; }
    if (ctx.incognito || !providers.destinazione) { voce.senzaFinestra = true; return null; }
    const r = await providers.destinazione(cur, ctx.rete || null);
    if (!r || r.annullato) { voce.annullato = true; return null; }
    voce.passi.push(...(r.passi || []).slice(1));
    if (!r.destinazione) return null;
    cur = r.destinazione;
  }
  return null;
}

const breve = (u) => {
  try { const x = new URL(u); const s = x.host + x.pathname; return s.length > 60 ? s.slice(0, 59) + '…' : s; } catch (_) { return String(u); }
};

// Il verdetto della destinazione; ma se un indirizzo da cui il link passa è in lista, il link è pericoloso comunque.
function verdettoDelLink(voce, esiti) {
  const dest = voce.destinazione;
  let v = null;
  if (dest) {
    const n = normalizeMod.normalize(dest);
    const dati = n && n.ok ? assembleCached(n, dest) : {};
    if (dati.gsb === undefined && esiti.get(dest)) dati.gsb = esiti.get(dest);
    v = engine.evaluate(dest, {}, dati);
  }
  const inLista = voce.passi.find((u) => u !== dest && esiti.get(u) && esiti.get(u).listed);
  if (!inLista || (v && v.level === 'pericoloso')) return v;
  const g = esiti.get(inLista);
  return {
    level: 'pericoloso',
    reasons: ['gsb_' + (g.category || 'listed'), 'link'],
    message: {
      title: 'Link segnalato come pericoloso',
      body: `Questo link passa da ${breve(inLista)}, che Google Safe Browsing classifica come ${engine.gsbText(g.category)}.`,
    },
    gsb: g,
  };
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
  return whitelist.hostedPlatform(norm.host, pathOf(norm, url)) ? norm.host + pathOf(norm, url) : norm.registrable;
}

const API = {
  checkSync,
  // #965 — il verdetto locale di un link non ancora aperto ({ url, level, message, scope } o null), e i link a fette.
  checkLink: (url, nome) => links.esaminaLink(url, checkSync, nome),
  checkLinks: (urls, opts = {}) => links.esaminaAFette(urls, { ...opts, checkSync }),
  scopeOf,
  origineLink,
  ownerOf,
  createOwnerBudget,
  analyze,
  preverifica,
  preverdetto,
  tipoLink: rimandi.tipo,
  evaluate: engine.evaluate,
  recordCert,
  setProviders,
  configure,
  // Quali stadi di rilevamento sono attivi dopo l'ultima configure() (diagnostica e test).
  activeProviders() {
    return {
      gsb: !!providers.gsb && (gsbKeyOf ? !!currentGsbKey() : true),
      rdap: !!providers.rdap,
      ct: !!providers.ct,
      llm: !!providers.llm,
      sandbox: !!providers.sandbox,
      destinazione: !!providers.destinazione,
    };
  },
  // cache (per test / invalidazione)
  DEEP_BUDGET,
  PRE_PER_ORA,
  _caches: { ageCache, certCache, sandboxCache, llmCache, deepBudget, deepFailed, preCache, preBudget },
  _settled: settled,
  _gsbLookup: gsbLookup,
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
  gsb,
  llm,
  sandbox,
  rimandi,
  links,
};

globalThis.SN_SAFEBROWSE = API;
module.exports = API;
