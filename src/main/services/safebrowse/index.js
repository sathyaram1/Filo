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
  clear() { this.m.clear(); }
}

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Verdetti calcolati: TTL breve (un dominio può diventare malevolo dopo essere
// stato visto pulito). Età dominio: stabile, TTL lungo.
const gsbCache = new TtlCache(30 * MIN);
const ageCache = new TtlCache(7 * DAY);
const certCache = new TtlCache(HOUR);
// #591 — giudizio del modello e finestra nascosta sono i due stadi che costano
// (soldi l'uno, una finestra con JavaScript attivo l'altro), e bastavano
// sottodomini sempre nuovi sullo stesso dominio per farli ripartire all'infinito.
//
// #591, secondo giro — il freno va sul DOMINIO, il verdetto resta
// dell'INDIRIZZO. Spostare anche il verdetto sul dominio registrabile fermava
// sì la spruzzata, ma sulle piattaforme dove ogni utente riceve un suo
// sotto-indirizzo (pages.dev, github.io, vercel.app, i blog ospitati) il
// dominio registrabile è la PIATTAFORMA: il verdetto di un sito di truffa
// sbarrava con la pagina rossa tutti i siti innocenti ospitati lì, e al
// contrario il «pulito» di un sito innocente impediva del tutto il controllo
// del sito di truffa vicino. Quindi il verdetto torna sull'host completo, e a
// fermare la spruzzata resta un CONTO per dominio registrabile: quante
// verifiche profonde quel dominio può far partire nella finestra di tempo
// della sua cache. Duecento sottodomini non fanno duecento chiamate, e due
// siti diversi sulla stessa piattaforma hanno ciascuno il suo verdetto.
//
// #591, terzo giro — il conto non è del DOMINIO, è di CHI POSSIEDE IL SITO.
// Sulle piattaforme dove ogni utente riceve un sotto-indirizzo gratuito il
// dominio registrabile è la piattaforma: contare lì dentro voleva dire che
// quattro sotto-indirizzi di chi attacca spegnevano la verifica profonda per
// tutti i siti ospitati accanto, truffa vera compresa. Il conto è passato al
// proprietario (psl.proprietario), e accanto c'è un tetto COMPLESSIVO, che
// copre le piattaforme che l'elenco non conosce ancora: senza, dare a ogni
// sotto-indirizzo il suo conto avrebbe rimesso in piedi la spruzzata.
const sandboxCache = new TtlCache(30 * MIN);
const llmCache = new TtlCache(HOUR);
const DEEP_MAX_PER_OWNER = 4;
// #591, quarto giro — il conto comune a tutti i siti era un FONDO: sessanta
// verifiche, e chi le aveva spese le aveva spese per tutti fino allo scadere
// della finestra. Una pagina ostile si portava da sola su sessanta indirizzi
// di seguito (sui servizi che regalano un sotto-indirizzo a testa ogni
// indirizzo è un proprietario diverso, quindi ognuno aveva il suo gettone da
// spendere sul fondo comune) e da lì in poi, per mezz'ora, nessun ALTRO sito
// riceveva più né il giudizio del modello né la finestra nascosta: la truffa
// vera arrivava a fondo vuoto.
//
// Adesso il conto comune è una RAFFICA, non un fondo: poche verifiche in
// pochi secondi, e la finestra si riapre subito. Una raffica di sessanta
// navigazioni viene strozzata mentre avviene, e chi vuole tenere il conto
// vuoto deve continuare a navigare per sempre — cioè tenere l'utente su
// pagine sue, che è l'opposto di quello che gli serve. Il tetto vero alla
// spesa è il limite mensile, che da questo lavoro in poi vale anche per
// queste chiamate.
const DEEP_MAX_RAFFICA = 8;
const RAFFICA_MS = 5 * 1000;
// Una verifica rinunciata per il conto comune non si butta: `analyze` lo dice
// a chi chiama (`rimandato: true`) e la scheda riprova finché l'utente è
// rimasto su quella pagina (src/main/tabs/tabSafebrowse.js). Il rinvio sta lì
// e non qui di proposito: le pagine della raffica la scheda le ha già
// lasciate, e riprovarle da qui le farebbe tornare in fila proprio quando
// tocca alla pagina dove l'utente è davvero.
const CHIAVE_TUTTI = '\u0000tutti';

// Conto a finestra FISSA: la finestra parte al primo gettone e scade da sola.
// Un conto che rimandasse la scadenza a ogni gettone (come fa una cache con
// TTL) lascerebbe spegnere le verifiche per un'ora intera a chi tiene il
// contatore caldo.
function creaConto(finestraMs) {
  const m = new Map();
  const vivo = (e, ora) => e && ora < e.fino;
  return {
    prendi(chiave, max, maxTotale) {
      const ora = Date.now();
      const suo = m.get(chiave);
      const tutti = m.get(CHIAVE_TUTTI);
      const nSuo = vivo(suo, ora) ? suo.n : 0;
      const nTutti = vivo(tutti, ora) ? tutti.n : 0;
      if (nSuo >= max || nTutti >= maxTotale) return false;
      if (vivo(suo, ora)) suo.n = nSuo + 1; else m.set(chiave, { n: 1, fino: ora + finestraMs });
      if (vivo(tutti, ora)) tutti.n = nTutti + 1; else m.set(CHIAVE_TUTTI, { n: 1, fino: ora + finestraMs });
      // Le voci scadute non servono più a nessuno: si buttano quando si passa.
      if (m.size > 256) for (const [k, e] of m) if (!vivo(e, ora)) m.delete(k);
      return true;
    },
    valore(chiave) {
      const e = m.get(chiave);
      return vivo(e, Date.now()) ? e.n : 0;
    },
    clear() { m.clear(); },
  };
}

const llmSpesa = creaConto(HOUR);
const sandboxSpesa = creaConto(30 * MIN);
// Il conto comune vive a parte, con la sua finestra corta.
const llmRaffica = creaConto(RAFFICA_MS);
const sandboxRaffica = creaConto(RAFFICA_MS);

// Prende un gettone dal conto di chi possiede il sito E dal conto comune.
// Ritorna 'ok', 'suo' (questo sito ne ha già fatte partire troppe: si
// rinuncia e basta) o 'raffica' (in questo momento se ne stanno facendo
// troppe in tutto: si riprova fra poco, perché la rinuncia non è colpa di
// questo sito). Niente si ricorda in nessuno dei due casi.
function prendiGettone(conto, raffica, chi, max = DEEP_MAX_PER_OWNER) {
  if (raffica.valore(CHIAVE_TUTTI) >= DEEP_MAX_RAFFICA) return 'raffica';
  if (!conto.prendi(chi, max)) return 'suo';
  raffica.prendi(CHIAVE_TUTTI, DEEP_MAX_RAFFICA);
  return 'ok';
}


// Chiamate già in volo, per proprietario del sito. La cache si riempie solo
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
// #591, quarto giro — si ricorda per CHI POSSIEDE il sito, non per il dominio
// principale: su una piattaforma di hosting il dominio principale è la
// piattaforma, e il certificato scaduto di un sito ospitato metteva l'avviso
// «connessione non protetta» su tutti i siti vicini, col nome della
// piattaforma al posto del nome del sito. Accetta sia un host sia un dominio:
// per un dominio normale le due cose coincidono.
function recordCert(host, status) {
  if (host && status) certCache.set(psl.proprietario(host) || host, { status });
}

// Assembla i dati di rete già noti (da cache) per il dominio.
function assembleCached(norm) {
  if (!norm || !norm.registrable) return {};
  const reg = norm.registrable;
  return {
    gsb: gsbCache.get('u:' + norm.host) || gsbCache.get(reg),
    ageDays: ageCache.get(reg),
    cert: certCache.get(psl.proprietario(norm.host) || reg),
    // Il verdetto è di QUESTO indirizzo, non del dominio: vedi il commento
    // sulle cache qui sopra.
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
  // Chi possiede il sito: il conto delle verifiche profonde e il segno "già in
  // volo" stanno qui, non sul dominio (vedi il commento sulle cache).
  const prop = psl.proprietario(norm.host);
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
    insieme.add(prop);
    tasks.push((async () => {
      try {
        const r = await avvia();
        if (r) salva(r);
      } catch (_) {
        /* best-effort: uno stadio profondo che non risponde non ferma il resto */
      } finally {
        insieme.delete(prop);
      }
    })());
  };
  // `prendiGettone` va per ultimo: è l'unico con un effetto: il gettone si
  // consuma solo quando la chiamata parte davvero. Se a dire di no è il conto
  // comune, la verifica si rimanda invece di perderla.
  let rimandare = false;
  if (worthDeepening && providers.llm && need.llm === undefined && !llmInFlight.has(prop)) {
    const g = prendiGettone(llmSpesa, llmRaffica, prop);
    if (g === 'ok') {
      inVolo(llmInFlight, () => providers.llm(buildLlmMeta(norm, ctx, first)), (r) => llmCache.set(norm.host, r));
    } else if (g === 'raffica') rimandare = true;
  }
  if (worthDeepening && providers.sandbox && need.sandbox === undefined && !sandboxInFlight.has(prop)) {
    const g = prendiGettone(sandboxSpesa, sandboxRaffica, prop);
    if (g === 'ok') {
      inVolo(sandboxInFlight, () => providers.sandbox(url, norm), (r) => sandboxCache.set(norm.host, r));
    } else if (g === 'raffica') rimandare = true;
  }
  // Il conto comune era pieno: chi ha chiesto il verdetto lo saprà e riproverà
  // se l'utente è rimasto lì.
  if (rimandare) first.rimandato = true;

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
  _caches: {
    gsbCache, ageCache, certCache, sandboxCache, llmCache,
    llmSpesa, sandboxSpesa, llmRaffica, sandboxRaffica,
  },
  // Quante verifiche profonde può far partire chi possiede un sito, quante se
  // ne possono fare in tutto in pochi secondi, e quanto dura quella finestra
  // (test e diagnostica).
  DEEP_MAX_PER_OWNER,
  DEEP_MAX_RAFFICA,
  RAFFICA_MS,
  // Chi possiede il sito (test e diagnostica).
  proprietario: psl.proprietario,
  // Chiamate in volo per proprietario del sito (test e diagnostica).
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
