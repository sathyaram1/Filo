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
// #591, settimo giro — il conto della CATENA di navigazioni, cioè di chi
// consuma davvero. I due conti qui sopra limitano la velocità: il primo è di
// chi possiede il sito e chi attacca lo aggira con sotto-indirizzi sempre
// nuovi, il secondo si riapre ogni pochi secondi, quindi in sedici secondi
// partivano trentadue giudizi del modello e trentadue finestre nascoste, per
// sempre. Una catena è una pagina che si porta da sola in giro senza mai
// lasciar passare il tempo che serve a una persona per guardare: il suo conto
// è piccolo e non si riapre finché la catena dura. Chi naviga dopo una pausa
// ne apre una nuova, quindi a una persona non toglie niente.
// I numeri sono abbondanti di proposito: finché la catena dura il conto non si
// riapre, quindi a fermare la raffica basta che esista, e stretto toglierebbe
// il controllo a chi salta in fretta fra le pagine senza togliere niente a chi
// attacca.
// I due stadi profondi spendono dallo stesso conto: sono la stessa risorsa
// vista da due lati, e chi attacca li fa partire sempre insieme. I due numeri
// stanno SOTTO i conti comuni qui sopra di proposito: cosi una catena che si
// esaurisce lascia sempre qualche gettone a chi naviga dopo.
const DEEP_MAX_PER_CATENA = 6;
const LOOKUP_MAX_PER_CATENA = 24;
const catenaSpesa = creaConto(HOUR);
const catenaLookup = creaConto(HOUR);

// Prende un gettone dal conto di chi possiede il sito E dal conto comune.
// Ritorna 'ok', 'suo' (questo sito ne ha già fatte partire troppe: si
// rinuncia e basta) o 'raffica' (in questo momento se ne stanno facendo
// troppe in tutto: si riprova fra poco, perché la rinuncia non è colpa di
// questo sito). Niente si ricorda in nessuno dei due casi.
// `catena` è il conto di chi consuma: si GUARDA per primo e si CONSUMA per
// ultimo, come gli altri due, perché una verifica rimandata dal conto comune
// verrà richiesta di nuovo e non deve pagare due volte.
// #591, ottavo giro — la catena esaurita RIMANDA, non rinuncia: a svuotarla è
// chi naviga, e chi naviga può essere la pagina ostile che subito dopo ti porta
// sulla truffa. Chi riprova è la scheda, e solo finché è rimasta su quella
// pagina: le pagine di una raffica le ha già lasciate.
function prendiGettone(conto, raffica, chi, max = DEEP_MAX_PER_OWNER, maxRaffica = DEEP_MAX_RAFFICA, catena = null) {
  const vivo = catena && catena.chiave;
  if (vivo && catena.conto.valore(catena.chiave) >= catena.max) return 'raffica';
  if (raffica.valore(CHIAVE_TUTTI) >= maxRaffica) return 'raffica';
  if (!conto.prendi(chi, max)) return 'suo';
  raffica.prendi(CHIAVE_TUTTI, maxRaffica);
  if (vivo) catena.conto.prendi(catena.chiave, catena.max);
  return 'ok';
}


// #591, sesto giro — il primo stadio, quello che parte PRIMA dei due profondi.
// La ricerca dell'indirizzo nell'elenco dei siti di truffa (chiave di fabbrica
// dell'owner) e le due domande sull'età del dominio a due servizi pubblici non
// avevano nessun freno: la frase peggiore della segnalazione — «l'unico freno è
// una cache per host, che si aggira con sottodomini sempre nuovi» — era ancora
// vera qui dentro, un piano sotto ai due stadi che il freno l'avevano ricevuto.
// Duecento sottodomini facevano duecento richieste sulla chiave dell'owner e
// duecento domande, tutte per lo STESSO dominio, a servizi pubblici che non le
// hanno chieste a nessuno. Lo stesso conto dei due stadi profondi, con lo stesso
// ragionamento (di chi possiede il sito, più una raffica corta comune) ma più
// largo: questo stadio è il segnale più affidabile che Filo ha, e strozzarlo
// costa protezione.
const LOOKUP_MAX_PER_OWNER = 20;
const LOOKUP_MAX_RAFFICA = 12;
const lookupSpesa = creaConto(30 * MIN);
const lookupRaffica = creaConto(RAFFICA_MS);

// Chiamate già in volo, per proprietario del sito. La cache si riempie solo
// quando la risposta arriva: senza questo, cinquanta sottodomini aperti insieme
// facevano partire cinquanta chiamate prima che la prima rispondesse.
const llmInFlight = new Set();
const sandboxInFlight = new Set();
// #591, sesto giro — lo stesso segno mancava agli stadi di rete, e lì costava
// due volte: i due cammini che a ogni navigazione chiedono il verdetto (la
// scheda che ha finito di navigare e lo script della pagina) partivano tutti e
// due, e cinquanta sottodomini chiedevano cinquanta volte l'età dello stesso
// dominio. L'elenco dei siti di truffa si ricorda per indirizzo, l'età per
// dominio: i due segni seguono quelle due chiavi.
const gsbInFlight = new Set();
const ageInFlight = new Set();

// Fetcher di rete iniettabili (default: assenti = best-effort no-op).
let providers = { gsb: null, rdap: null, ct: null, sandbox: null, llm: null };
function setProviders(fns) { providers = { ...providers, ...(fns || {}) }; }

// Configura i provider dai moduli reali, usando le impostazioni correnti.
//   opts.runGsb       funzione (url) → esito dell'elenco dei siti di truffa
//   opts.runLlm       funzione (messages) → testo, per il giudice LLM
//   opts.enableSandbox  abilita la detonation (default true se Electron c'è)
//   opts.enableNetwork  abilita RDAP/CT (default true)
// `runGsb(rawUrl)` — #591, sesto giro: la ricerca nell'elenco dei siti di truffa
// si paga sulla chiave di fabbrica dell'owner, quindi non la fa più questo
// modulo per conto suo: la inietta handlers.js dopo averla fatta passare dal
// cancello unico. Il ripiego che chiamava il fornitore da qui è stato tolto nel
// settimo giro: nessuno lo percorreva, ma era l'esempio pronto da copiare per
// la chiamata successiva.
function configure(opts = {}) {
  const { runGsb, runLlm, enableSandbox = true, enableNetwork = true } = opts;
  setProviders({
    gsb: typeof runGsb === 'function' ? ((rawUrl) => runGsb(rawUrl)) : null,
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

// La domanda all'elenco dei siti di truffa è su UN indirizzo, quindi la
// risposta si ricorda per quell'indirizzo (#591, ottavo giro). Ricordarla per
// tutto il sito, dove i file sono di persone diverse, faceva due danni opposti:
// un file innocuo visto prima impediva di cercare quello di truffa, e un file
// segnalato metteva la pagina rossa su tutti gli altri.
function chiaveIndirizzo(url, norm) {
  let u = null;
  const s = String(url || '');
  try { u = new URL(s); } catch (_) {
    try { u = new URL('http://' + s); } catch (_) { u = null; }
  }
  return 'u:' + norm.host + (u ? (u.pathname || '/') + (u.search || '') : '');
}

// Assembla i dati di rete già noti (da cache) per il dominio.
function assembleCached(norm, url) {
  if (!norm || !norm.registrable) return {};
  const reg = norm.registrable;
  return {
    gsb: gsbCache.get(chiaveIndirizzo(url, norm)),
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

  // #591, sesto giro — gli indirizzi della rete di casa e le finestre in
  // incognito. Fin qui l'esclusione della rete di casa fermava i due stadi
  // PROFONDI (il verdetto locale dice «local_host» e non c'è niente da
  // approfondire), ma gli stadi di rete partivano lo stesso: aprendo il
  // pannello del router usciva di casa l'indirizzo INTERO, percorso e parametri
  // compresi — e su quelle pagine i parametri sono spesso il codice della
  // sessione — più il nome della macchina, chiesto a due servizi pubblici.
  // In incognito valeva identico, mentre Filo in incognito si astiene da tutto
  // il resto: niente sessione salvata, niente archivio, niente cronologia,
  // niente riordino automatico. Il verdetto LOCALE, che non manda niente a
  // nessuno, continua a lavorare in tutti e due i casi.
  if (psl.isHostPrivato(norm.host) || norm.single || norm.suffixOnly) return first;
  if (ctx && ctx.incognito) return first;

  const reg = norm.registrable;
  // Chi possiede il sito: il conto delle verifiche profonde e il segno "già in
  // volo" stanno qui, non sul dominio (vedi il commento sulle cache).
  const prop = psl.proprietario(norm.host);
  // La catena la dichiara la scheda (src/main/tabs/catenaNavigazione.js): fuori
  // da una scheda non esiste una catena da contare.
  // `insistito` è la scheda che ripresenta la STESSA pagina dove l'utente è
  // rimasto: non è più una raffica, quindi il conto della catena non la
  // riguarda (restano quello di chi possiede il sito e quello comune). Il
  // campo lo scrive la scheda, mai il contesto che arriva dalla pagina.
  const catena = ctx && ctx.catena && !(ctx && ctx.insistito) ? String(ctx.catena) : '';
  const contoCatenaDeep = catena ? { conto: catenaSpesa, chiave: 'p:' + catena, max: DEEP_MAX_PER_CATENA } : null;
  const contoCatenaLookup = catena ? { conto: catenaLookup, chiave: 'l:' + catena, max: LOOKUP_MAX_PER_CATENA } : null;
  const tasks = [];
  const need = assembleCached(norm);
  let rimandare = false;

  // Il primo stadio: un gettone per tutte e tre le domande di rete, preso una
  // volta sola. Sono lo stesso stadio e partono insieme: due conti separati
  // darebbero a chi attacca due raffiche invece di una.
  const serveGsb = providers.gsb && need.gsb === undefined && !gsbInFlight.has(norm.host);
  const serveEta = need.ageDays === undefined
    && !ageInFlight.has(reg)
    && ((providers.rdap) || (providers.ct && !need.cert));
  if (serveGsb || serveEta) {
    const g = prendiGettone(lookupSpesa, lookupRaffica, prop, LOOKUP_MAX_PER_OWNER, LOOKUP_MAX_RAFFICA, contoCatenaLookup);
    if (g === 'ok') {
      if (serveGsb) {
        gsbInFlight.add(norm.host);
        tasks.push(Promise.resolve(providers.gsb(url, norm)).then((r) => {
          if (r) gsbCache.set('u:' + norm.host, r);
        }).catch(() => {}).finally(() => { gsbInFlight.delete(norm.host); }));
      }
      if (serveEta) {
        ageInFlight.add(reg);
        const eta = [];
        if (providers.rdap) {
          eta.push(Promise.resolve(providers.rdap(reg, norm)).then((days) => {
            if (typeof days === 'number') ageCache.set(reg, days);
          }).catch(() => {}));
        }
        if (providers.ct && !need.cert) {
          eta.push(Promise.resolve(providers.ct(reg, norm)).then((r) => {
            // CT dà l'età del PRIMO certificato: usala solo se RDAP non ha risposto.
            if (r && typeof r.firstSeenDays === 'number' && ageCache.get(reg) === undefined) {
              ageCache.set(reg, r.firstSeenDays);
            }
          }).catch(() => {}));
        }
        tasks.push(Promise.allSettled(eta).finally(() => { ageInFlight.delete(reg); }));
      }
    } else if (g === 'raffica') rimandare = true;
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
  if (worthDeepening && providers.llm && need.llm === undefined && !llmInFlight.has(prop)) {
    const g = prendiGettone(llmSpesa, llmRaffica, prop, DEEP_MAX_PER_OWNER, DEEP_MAX_RAFFICA, contoCatenaDeep);
    if (g === 'ok') {
      inVolo(llmInFlight, () => providers.llm(buildLlmMeta(norm, ctx, first)), (r) => llmCache.set(norm.host, r));
    } else if (g === 'raffica') rimandare = true;
  }
  if (worthDeepening && providers.sandbox && need.sandbox === undefined && !sandboxInFlight.has(prop)) {
    const g = prendiGettone(sandboxSpesa, sandboxRaffica, prop, DEEP_MAX_PER_OWNER, DEEP_MAX_RAFFICA, contoCatenaDeep);
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
    lookupSpesa, lookupRaffica, catenaSpesa, catenaLookup,
  },
  // Quante verifiche profonde può far partire chi possiede un sito, quante se
  // ne possono fare in tutto in pochi secondi, e quanto dura quella finestra
  // (test e diagnostica).
  DEEP_MAX_PER_OWNER,
  DEEP_MAX_RAFFICA,
  RAFFICA_MS,
  // Quante domande di rete del primo stadio può far partire chi possiede un
  // sito, e quante se ne possono fare in tutto in pochi secondi.
  LOOKUP_MAX_PER_OWNER,
  LOOKUP_MAX_RAFFICA,
  // Quanti controlli puo far partire UNA catena di navigazioni (test e diagnostica).
  DEEP_MAX_PER_CATENA,
  LOOKUP_MAX_PER_CATENA,
  // Chi possiede il sito (test e diagnostica).
  proprietario: psl.proprietario,
  // Chiamate in volo per proprietario del sito (test e diagnostica).
  _inFlight: { llm: llmInFlight, sandbox: sandboxInFlight, gsb: gsbInFlight, eta: ageInFlight },
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
