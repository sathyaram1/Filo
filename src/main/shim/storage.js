// chrome.storage.local su un file solo, userData/storage.json, scritto con debounce e sempre per intero.
// Scrittura e lettura passano da scritturaAtomica: un file rovinato o illeggibile non viene mai sovrascritto (#1087).
// Prove: tests/unit/storageDurevole.test.mjs, tests/unit/storageFlushRace.test.mjs.

const { app, safeStorage } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const Disco = require('../services/scritturaAtomica');

// Le chiavi API sono un segreto: a riposo si cifrano con `safeStorage` dell'OS, in memoria
// restano in chiaro. Senza keyring si ricade sul chiaro, e uno storage vecchio si migra.
const ENC_PREFIX = 'safeStorage:v1:';

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

// L'ultima cifratura fatta: chiavi uguali non si ricifrano a ogni scrittura (#1089), e il file non cambia.
let ultimaCifratura = { chiaro: null, blob: null };

// Gli esiti del disco per i contatori anonimi (#1466): solo nomi dell'elenco chiuso (SN_CONTATORI.EVENTI_STORAGE), mai
// una chiave, un percorso o un messaggio. Li ritira src/main/services/contatori.js, che a contatori spenti li butta.
const CONTI = new Map();
let dimensione = null;
let cifraturaContata = false;
function contaDisco(cosa, dato) {
  try {
    const C = globalThis.SN_CONTATORI;
    if (!C) return;
    const da = { lettura: C.eventoLettura, salvataggio: C.eventoSalvataggio, flush: C.eventoFlush }[cosa];
    const evento = da ? da(dato) : cosa;
    if (C.EVENTI_STORAGE.includes(evento)) CONTI.set(evento, (CONTI.get(evento) || 0) + 1);
  } catch (_) {}
}

// Le impostazioni come vanno su disco: settings.apiKeys (in chiaro, in memoria) diventa
// settings.apiKeysEnc (base64 del blob cifrato). Non muta `s`.
function impostazioniPerDisco(s) {
  try {
    if (!s || typeof s !== 'object' || !s.apiKeys || typeof s.apiKeys !== 'object') return s;
    if (!canEncrypt()) { // niente keyring OS → resta com'era (no perdita dati), e l'utente lo sa
      if (Object.values(s.apiKeys).some((v) => typeof v === 'string' && v.trim())) chiaviInChiaro();
      // Prima di `ready` il portachiavi risulta assente anche dove c'è: si conta solo dopo, una volta per sessione.
      if (!cifraturaContata && typeof app.isReady === 'function' && app.isReady()) { cifraturaContata = true; contaDisco('cifratura_assente'); }
      return s;
    }
    const chiaro = JSON.stringify(s.apiKeys);
    if (chiaro !== ultimaCifratura.chiaro) {
      ultimaCifratura = { chiaro, blob: safeStorage.encryptString(chiaro).toString('base64') };
    }
    return { ...s, apiKeys: undefined, apiKeysEnc: ENC_PREFIX + ultimaCifratura.blob };
  } catch (_) { return s; }
}

// Inverso di impostazioniPerDisco: al load ripristina settings.apiKeys in chiaro in
// memoria a partire dal blob cifrato, e rimuove il campo apiKeysEnc.
function deserializeFromDisk(data) {
  try {
    const s = data && data.settings;
    if (!s || typeof s !== 'object' || typeof s.apiKeysEnc !== 'string') return data;
    if (!s.apiKeysEnc.startsWith(ENC_PREFIX) || !canEncrypt()) return data;
    const blob = s.apiKeysEnc.slice(ENC_PREFIX.length);
    const chiaro = safeStorage.decryptString(Buffer.from(blob, 'base64'));
    const apiKeys = JSON.parse(chiaro);
    ultimaCifratura = { chiaro: JSON.stringify(apiKeys), blob };
    const ns = { ...s, apiKeys };
    delete ns.apiKeysEnc;
    return { ...data, settings: ns };
  } catch (_) {
    // Blob illeggibile (cifrato da un altro utente o un'altra chiave OS): si resta senza
    // apiKeys e l'utente le reinserisce, come in token-store.
    return data;
  }
}

const STATE = {
  loaded: false,
  loading: null,
  data: {},
  filePath: null,
  pending: null,
  flushTimer: null,
  listeners: new Set(),
  scritture: new Set(),
  // Il file si compone chiave per chiave (#1089): `testi` è il JSON di ogni valore come è stato scritto,
  // `suDisco` la sua forma nel file (chiavi API cifrate), `sporche` le chiavi da riserializzare.
  testi: new Map(),
  suDisco: new Map(),
  sporche: new Set(),
  avvisate: new Set(),
  osservate: new Set(),
  // Il file c'è ma non si è potuto leggere né spostare: scriverci sopra lo cancellerebbe.
  solaMemoria: false,
  // Ogni scrittura ha il suo numero: una in volo più vecchia di quella di chiusura non le passa sopra.
  generazione: 0,
  genSuDisco: 0,
  ritentaTimer: null,
  ritentaMs: 0,
  avvisatoSalvataggio: false,
  ultimoErrore: null,
  avvisi: [],
  copia: null,
  copiaTimer: null,
  genCopia: 0,
  copiaSuDisco: 0,
  pulizia: null,
};

// Una chiave che qualcuno osserva in scrittura non si presta mai viva, né in lettura né in scrittura: chi muta
// la lista letta prima di set() toglierebbe all'osservatore il valore di prima (#1088).
function staccata(k, v) {
  if (!STATE.osservate.has(k) || !v || typeof v !== 'object') return v;
  // Una funzione dentro il valore non arriverebbe comunque sul disco: la copia la lascia cadere come il JSON.
  try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
}

// === Modalità incognito ===========================================
// Le finestre incognito non devono lasciare tracce su disco: né dati di
// navigazione (cronologia AI, salvati, costi, cache, memoria dashboard, ...) né
// poter LEGGERE quelli persistenti delle finestre normali. Implementiamo la
// garanzia QUI, all'unico punto di strozzatura dove TUTTE le scritture/letture
// del main passano (sia via chrome.storage.local sia via SN_STORAGE).
//
// Meccanismo: un contesto AsyncLocalStorage. Quando un messaggio IPC parte da
// una finestra incognito, l'IPC avvolge l'handler in runIncognito(): tutte le
// get/set/remove/clear che ne discendono (anche dopo await) vedono il flag e
// vengono dirottate su un overlay in RAM.
const als = new AsyncLocalStorage();

// Ciò che l'incognito scrive vive solo qui, finché la sessione incognito è aperta.
const INCOGNITO = {
  data: {},               // { key: value } scritti durante la sessione incognito
  tombstones: new Set(),  // chiavi rimosse: mascherano l'eventuale valore su disco
};

// Allowlist FAIL-CLOSED: dal disco l'incognito legge SOLO queste chiavi di configurazione.
// Qualunque altra, comprese quelle future, è invisibile: la finestra parte vuota.
const INCOGNITO_READABLE = new Set([
  'settings', 'blocklist', 'sn_personal_dict', 'sn_autocorrect', 'sn_correttore_imparato', 'sn_icon_layout',
  // La disposizione delle carte della home (#870): come le icone, la scelta dell'utente vale anche in incognito.
  'filo_carte_home',
]);

// I conti di Filo (spesa del mese contro il limite, saldo dei crediti) valgono per tutte le finestre: in incognito si
// leggono e si scrivono sul disco come fuori, se no il limite di spesa lì dentro non esiste (#591). Sono totali, non navigazione.
const INCOGNITO_SHARED = new Set(['costs', 'credits']);

function inIncognito() {
  const s = als.getStore();
  return !!(s && s.incognito);
}

// Il contesto si propaga anche attraverso la catena async, non solo fino al primo await.
function runIncognito(fn) {
  return als.run({ incognito: true }, fn);
}

// Il contrario, per chi scrive da una coda condivisa: la sua scrittura va sul disco anche se
// la catena che l'ha messa in fila era partita da una finestra incognito.
function runNormale(fn) {
  return als.run({ incognito: false }, fn);
}

// Il filo (src/main/services/ilFilo.js) migra le chat dal disco anche se la prima richiesta arriva da un incognito.
function fuoriDaIncognito(fn) {
  return als.run({ incognito: false }, fn);
}

// Azzera l'overlay incognito. Chiamato dalla chiusura dell'ultima finestra
// incognito: nulla di ciò che è stato navigato/scritto sopravvive.
function resetIncognito() {
  INCOGNITO.data = {};
  INCOGNITO.tombstones = new Set();
}

// In incognito una chiave si legge dall'overlay, o è mascherata da un tombstone; dal disco
// arrivano solo le chiavi di configurazione in allowlist, il resto è invisibile.
function incognitoReadKey(k) {
  if (INCOGNITO_SHARED.has(k)) return STATE.data[k];
  if (k in INCOGNITO.data) return INCOGNITO.data[k];
  if (INCOGNITO.tombstones.has(k)) return undefined;
  if (INCOGNITO_READABLE.has(k)) return STATE.data[k];
  return undefined;
}

function filePath() {
  if (!STATE.filePath) {
    // FILO_USER_DATA isola i test: mai lo storage reale dell'utente.
    const root = process.env.FILO_USER_DATA || app.getPath('userData');
    STATE.filePath = path.join(root, 'storage.json');
  }
  return STATE.filePath;
}

// Una lettura sola, e chi arriva mentre è in corso aspetta quella: due letture
// in parallelo all'avvio rimettevano il file sopra una scrittura appena fatta (#897).
function loadIfNeeded() {
  if (STATE.loaded) return Promise.resolve();
  if (!STATE.loading) STATE.loading = leggiFile();
  return STATE.loading;
}

const CHIAVE_LETTURA = 'dati-letti';
const CHIAVE_SALVATAGGIO = 'dati-non-salvati';

function avvisa(testo, chiave, durataSec = 0, detto, errore = '') {
  STATE.avvisi.push({ testo, chiave });
  try {
    const A = require('../services/avvisoFinestra');
    if (durataSec) A.avvisoNellaFinestra(testo, { chiave, durataSec, errore, tipo: errore || 'dati_avviso' });
    else A.avvisoQuandoPronta(testo, { chiave, detto, errore, tipo: errore || 'dati_avviso' });
  } catch (_) {}
}

// Senza portachiavi le chiavi API vanno sul disco in chiaro: lo si dice una volta per installazione (#905), e
// la volta conta solo se una finestra l'ha mostrato. Il segno sta nello storage, così «Cancella tutto» lo porta via.
const CHIAVE_IN_CHIARO = 'avvisoChiaviInChiaro';
let inChiaroInCorso = false;

function testoChiaviInChiaro() {
  const base = 'Filo non trova un portachiavi di sistema, quindi salva le tue chiavi API in chiaro nella sua cartella dei dati. Chi può aprire i tuoi file può leggerle.';
  let backend = '';
  try { backend = safeStorage.getSelectedStorageBackend?.() || ''; } catch (_) {}
  const consiglio = require('../portachiavi').consiglioPortachiavi({ platform: process.platform, backend, perChe: 'Per cifrarle' });
  return consiglio ? `${base} ${consiglio}` : base;
}

function chiaviInChiaro() {
  // Prima di `ready` il portachiavi risulta assente anche dove c'è.
  if (inChiaroInCorso || STATE.data[CHIAVE_IN_CHIARO] || (typeof app.isReady === 'function' && !app.isReady())) return;
  inChiaroInCorso = true;
  // Fuori dal giro di serializzazione in corso, e sul disco anche se la scrittura era partita da un incognito.
  setImmediate(() => avvisa(testoChiaviInChiaro(), 'chiavi-in-chiaro', 0, () => {
    runNormale(() => set({ [CHIAVE_IN_CHIARO]: Date.now() })).catch(() => {});
  }));
}

function quando(ms) {
  try {
    return new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return new Date(ms).toISOString(); }
}

function motivo(err) {
  const c = err && err.code;
  if (c === 'EACCES' || c === 'EPERM') return 'il sistema non dà il permesso';
  if (c === 'EBUSY') return 'lo tiene aperto un altro programma';
  if (c === 'EIO') return 'errore del disco';
  return c || String((err && err.message) || err || 'errore sconosciuto');
}

// Solo un oggetto è uno storage: null, un numero o un elenco vengono da un file rovinato o scritto a mano.
function interpreta(testo) {
  try {
    const v = JSON.parse(Disco.togliBom(testo));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (_) { return null; }
}

async function leggiCopia(target) {
  try {
    const buf = await Disco.leggi(`${target}.bak`);
    const dati = buf ? interpreta(buf.toString('utf8')) : null;
    if (!dati) return null;
    let mtime = Date.now();
    try { mtime = (await fsp.stat(`${target}.bak`)).mtimeMs; } catch (_) {}
    return { dati, quando: quando(mtime) };
  } catch (_) { return null; }
}

function testoIlleggibile(err, copia) {
  const inizio = `Filo non riesce a leggere il file con i tuoi dati (${motivo(err)}).`;
  const fine = 'Chiudi e riapri Filo. Se succede ancora, controlla il disco.';
  return copia
    ? `${inizio} Ti mostra la copia di riserva del ${copia.quando}, ma in questa sessione non salva niente, per non sovrascrivere il file. ${fine}`
    : `${inizio} Per non sovrascriverlo, in questa sessione parte vuoto e non salva niente. ${fine}`;
}

function testoRovinato(daParte, copia) {
  if (!daParte) {
    return copia
      ? `Il file con i tuoi dati si è rovinato e Filo non riesce a spostarlo. Ti mostra la copia di riserva del ${copia.quando}, ma in questa sessione non salva niente, per non cancellare il file rovinato. Chiudi e riapri Filo per riprovare.`
      : 'Il file con i tuoi dati si è rovinato e Filo non riesce a spostarlo. Per non cancellarlo, in questa sessione parte vuoto e non salva niente. Chiudi e riapri Filo per riprovare.';
  }
  const dove = `Il file rovinato è rimasto nella cartella dei dati, col nome «${path.basename(daParte)}».`;
  return copia
    ? `Il file con i tuoi dati si era rovinato. Filo è ripartito dalla copia di riserva del ${copia.quando}, quindi manca solo quello che hai cambiato dopo. ${dove}`
    : `Il file con i tuoi dati si era rovinato e non c'era una copia di riserva, quindi Filo riparte da zero. ${dove}`;
}

// Un errore di lettura non è «non ci sono dati»: diventava uno storage vuoto, e la prima scrittura cancellava quello vero.
async function leggiFile() {
  const target = filePath();
  let buf;
  try {
    buf = await Disco.leggi(target);
  } catch (err) {
    console.warn('[Filo storage] read failed:', err.message);
    contaDisco('lettura', 'illeggibile');
    STATE.solaMemoria = true;
    const copia = await leggiCopia(target);
    STATE.data = copia ? deserializeFromDisk(copia.dati) : {};
    STATE.loaded = true;
    avviaVerifica();
    avvisa(testoIlleggibile(err, copia), CHIAVE_LETTURA, 0, null, 'dati_illeggibili');
    return;
  }
  STATE.pulizia = Disco.togliTemporanei(target).catch(() => {});
  if (buf === null) {
    STATE.data = {};
    // Le prove automatiche (playwright.config.js) partono da un utente già accolto, da qualunque avvio: senza, la home
    // comincia l'intervista appena c'è un modello e la chat della prova ci scrive dentro (#663.6).
    if (process.env.FILO_TEST_ACCOLTO === '1') STATE.data = { filo_onboarding: { done: true } };
    contaDisco('lettura', 'vuoto');
    STATE.loaded = true;
    avviaVerifica();
    return;
  }
  dimensione = buf.length;
  const testo = Disco.togliBom(buf.toString('utf8'));
  const dati = interpreta(testo);
  if (dati) {
    contaDisco('lettura', 'ok');
    STATE.data = deserializeFromDisk(dati);
    STATE.loaded = true;
    avviaVerifica();
    scriviCopia(testo);
    return;
  }
  let daParte = null;
  try { daParte = await Disco.mettiDaParte(target); } catch (e) {
    console.warn('[Filo storage] file rovinato, non spostato:', e?.message || e);
  }
  if (!daParte) STATE.solaMemoria = true;
  const copia = await leggiCopia(target);
  contaDisco('lettura', !daParte ? 'non_spostato_sola_memoria' : copia ? 'rovinato_con_copia' : 'rovinato_senza_copia');
  STATE.data = copia ? deserializeFromDisk(copia.dati) : {};
  STATE.loaded = true;
  avviaVerifica();
  // Senza storage.json un arresto adesso farebbe ripartire vuoto il prossimo avvio, che non guarda la copia.
  if (daParte && copia) scheduleFlush();
  avvisa(testoRovinato(daParte, copia), CHIAVE_LETTURA, 0, null, 'dati_illeggibili');
}

// La copia di riserva segue il file con un minuto di ritardo al più: ferma all'avvio terrebbe sul disco, per tutta
// la sessione, quello che l'utente ha appena cancellato (sentinella in tests/unit/archivedTabsStore.test.mjs).
const COPIA_DOPO_MS = 60_000;

function scriviCopia(testo) {
  const mia = ++STATE.genCopia;
  STATE.copia = (STATE.copia || Promise.resolve())
    .then(() => Disco.scrivi(`${filePath()}.bak`, testo, { primaDiRinominare: () => STATE.copiaSuDisco < mia }))
    .then((scritta) => { if (scritta) STATE.copiaSuDisco = mia; })
    .catch((e) => console.warn('[Filo storage] copia di riserva non scritta:', e?.message || e));
  return STATE.copia;
}

function copiaPiuTardi() {
  if (STATE.copiaTimer || STATE.solaMemoria) return;
  STATE.copiaTimer = setTimeout(aggiornaCopia, COPIA_DOPO_MS);
  STATE.copiaTimer.unref?.();
}

function aggiornaCopia() {
  if (STATE.copiaTimer) { clearTimeout(STATE.copiaTimer); STATE.copiaTimer = null; }
  if (STATE.solaMemoria) return Promise.resolve();
  return scriviCopia(testoDelFile());
}

function scheduleFlush() {
  if (STATE.flushTimer) return;
  STATE.flushTimer = setTimeout(flush, 100);
}

// I flush sono SERIALIZZATI: con uno storage grande la scrittura dura più del debounce, e due in volo
// possono arrivare alla rename in ordine inverso, lasciando sul disco la copia più vecchia.
async function flush() {
  STATE.flushTimer = null;
  STATE.flushChain = (STATE.flushChain || Promise.resolve()).then(doFlush);
  return STATE.flushChain;
}

// Scrive subito, senza aspettare il debounce. Ritorna la catena: due chiamate ravvicinate
// si accodano invece di accavallarsi.
function flushNow() {
  if (STATE.flushTimer) { clearTimeout(STATE.flushTimer); STATE.flushTimer = null; }
  return flush();
}

// Attende che non resti NIENTE in sospeso: né un flush in attesa del debounce,
// né uno in volo, né la copia di riserva in attesa del suo minuto, né la pulizia
// dei temporanei dell'avvio. Quello che è in attesa lo fa scattare subito, così
// non c'è nessuna attesa a tempo.
//
// Serve ai test: aspettare "abbastanza secondi" che una scrittura grande
// arrivi su disco è affidabile a macchina scarica e diventa un falso allarme
// sotto carico — e il fallimento che ne esce parla di dati incoerenti invece
// che di un'attesa scaduta, mandando fuori strada chi lo legge.
async function whenSettled() {
  await scrittureFerme();
  if (STATE.copiaTimer) await aggiornaCopia();
  else await STATE.copia;
  await STATE.pulizia;
}

async function scrittureFerme() {
  for (let i = 0; i < 1000; i++) {
    if (STATE.flushTimer) {
      clearTimeout(STATE.flushTimer);
      STATE.flushTimer = null;
      await flush();
      continue;
    }
    const chain = STATE.flushChain;
    if (!chain) return;
    await chain;
    // Nessun nuovo flush accodato mentre aspettavamo: siamo fermi.
    if (STATE.flushChain === chain && !STATE.flushTimer) return;
  }
}

function serializzaChiave(k) {
  const v = STATE.data[k];
  let t;
  try {
    t = JSON.stringify(v);
  } catch (err) {
    // Un valore che non si serializza tiene nel file la sua ultima forma buona e non ferma le altre chiavi.
    console.error('[Filo storage] chiave non serializzabile:', k, err.message);
    contaDisco('chiave_non_serializzabile');
    STATE.sporche.delete(k);
    return;
  }
  STATE.testi.set(k, t);
  const disco = k === 'settings' ? impostazioniPerDisco(v) : v;
  STATE.suDisco.set(k, disco === v ? t : JSON.stringify(disco));
  STATE.sporche.delete(k);
}

// Lo stesso testo di JSON.stringify(STATE.data) con le chiavi API cifrate: stesso ordine, stesso formato.
function testoDelFile({ tutte = false } = {}) {
  const parti = [];
  for (const k of Object.keys(STATE.data)) {
    if (tutte || STATE.sporche.has(k) || !STATE.suDisco.has(k)) serializzaChiave(k);
    const t = STATE.suDisco.get(k);
    if (t !== undefined) parti.push(JSON.stringify(k) + ':' + t);
  }
  STATE.sporche.clear();
  return '{' + parti.join(',') + '}';
}

// Rete per chi cambia un valore letto senza riscriverlo con set: prima ci pensava il flush intero
// successivo, ora lo trova questo giro (raro, e solo sulle chiavi non già in coda).
function verificaMutazioni() {
  if (!STATE.loaded) return [];
  const cambiate = [];
  for (const k of Object.keys(STATE.data)) {
    if (STATE.sporche.has(k) || !STATE.testi.has(k)) continue;
    let t;
    try { t = JSON.stringify(STATE.data[k]); } catch (_) { continue; }
    if (t === STATE.testi.get(k)) continue;
    cambiate.push(k);
    contaDisco('cambiato_senza_set');
    STATE.sporche.add(k);
    if (!STATE.avvisate.has(k)) {
      STATE.avvisate.add(k);
      console.warn('[Filo storage] valore cambiato senza set, salvato dal controllo periodico:', k);
    }
  }
  if (cambiate.length) scheduleFlush();
  return cambiate;
}
const VERIFICA_OGNI_MS = 60_000;
let giroVerifica = null;
function avviaVerifica() {
  if (giroVerifica) return;
  giroVerifica = setInterval(verificaMutazioni, VERIFICA_OGNI_MS);
  if (giroVerifica.unref) giroVerifica.unref();
}

async function doFlush() {
  const target = filePath();
  if (STATE.solaMemoria) return;
  // Contatore delle scritture in volo: è l'invariante del serializzatore qui sopra, e a differenza del
  // guasto (che dipende dall'ordine di arrivo) si rompe SEMPRE se la serializzazione salta.
  STATE.flushInFlight = (STATE.flushInFlight || 0) + 1;
  if (STATE.flushInFlight > (STATE.flushMaxInFlight || 0)) STATE.flushMaxInFlight = STATE.flushInFlight;
  const mia = ++STATE.generazione;
  const t0 = Date.now();
  try {
    const txt = testoDelFile();
    const scritta = await Disco.scrivi(target, txt, { primaDiRinominare: () => STATE.genSuDisco < mia });
    if (scritta) {
      STATE.genSuDisco = mia;
      dimensione = Buffer.byteLength(txt);
      contaDisco('flush', Date.now() - t0);
    }
    salvataggioRiuscito();
    copiaPiuTardi();
  } catch (err) {
    console.error('[Filo storage] flush failed:', err);
    // Il file non ha l'ultima versione: la prossima set non va scartata come «già scritta».
    STATE.testi.clear();
    contaDisco('salvataggio', err);
    salvataggioFallito(err);
  } finally {
    STATE.flushInFlight -= 1;
  }
}

function testoNonSalvato(err) {
  const c = err && err.code;
  const resta = 'Il file salvato prima resta intatto, e quello che fai adesso resta in memoria finché Filo è aperto.';
  if (c === 'ENOSPC') return `Il disco è pieno e Filo non riesce a salvare i tuoi dati. ${resta} Libera un po' di spazio e Filo riprova da solo.`;
  if (c === 'EACCES' || c === 'EPERM' || c === 'EROFS') return `Filo non riesce a salvare i tuoi dati perché il sistema non gli lascia scrivere nella sua cartella. ${resta} Filo riprova da solo.`;
  return `Filo non riesce a salvare i tuoi dati sul disco (${motivo(err)}). ${resta} Filo riprova da solo.`;
}

// Se nessuno scrive più il debounce non riparte: il ritentativo sì, con attese che crescono fino a cinque minuti.
function salvataggioFallito(err) {
  STATE.ultimoErrore = { code: (err && err.code) || '', message: String((err && err.message) || err), at: Date.now() };
  if (!STATE.avvisatoSalvataggio) {
    STATE.avvisatoSalvataggio = true;
    avvisa(testoNonSalvato(err), CHIAVE_SALVATAGGIO, 0, null, 'dati_non_salvati');
  }
  STATE.ritentaMs = Math.min(Math.max(STATE.ritentaMs * 2, 10_000), 5 * 60_000);
  if (!STATE.ritentaTimer) {
    STATE.ritentaTimer = setTimeout(() => { STATE.ritentaTimer = null; flush(); }, STATE.ritentaMs);
    STATE.ritentaTimer.unref?.();
  }
}

function salvataggioRiuscito() {
  const eraFallito = !!STATE.ultimoErrore;
  STATE.ultimoErrore = null;
  STATE.ritentaMs = 0;
  if (STATE.ritentaTimer) { clearTimeout(STATE.ritentaTimer); STATE.ritentaTimer = null; }
  if (eraFallito) contaDisco('salvataggio_tornato');
  if (eraFallito && STATE.avvisatoSalvataggio) avvisa('I tuoi dati sono di nuovo salvati.', CHIAVE_SALVATAGGIO, 6);
}

/** Gli esiti del disco da quando li si è ritirati l'ultima volta, rinomine riprovate comprese; poi si azzerano. */
function contiDisco() {
  const out = Object.fromEntries(CONTI);
  CONTI.clear();
  try {
    const C = globalThis.SN_CONTATORI;
    for (const [codice, n] of Object.entries(Disco.ritentiRinomina())) {
      const evento = C ? C.eventoRinomina(codice) : '';
      if (evento) out[evento] = (out[evento] || 0) + n;
    }
  } catch (_) {}
  return out;
}

/** I byte del file com'era all'ultima lettura o scrittura; null prima della prima. */
function dimensioneDisco() {
  return dimensione;
}

/** Per le prove e per chi deve dire all'utente se i suoi dati arrivano sul disco. */
function statoDisco() {
  return {
    solaMemoria: STATE.solaMemoria,
    ultimoErrore: STATE.ultimoErrore,
    avvisi: STATE.avvisi.slice(),
    copia: STATE.copia,
  };
}

/** Quante scritture su disco sono arrivate a sovrapporsi (deve restare 1). */
function maxFlushOverlap() {
  return STATE.flushMaxInFlight || 0;
}

function emitChange(changes) {
  for (const fn of STATE.listeners) {
    try { fn(changes, 'local'); } catch (e) { console.warn('[Filo storage] listener err', e); }
  }
}

async function get(keysOrNull) {
  await loadIfNeeded();
  const incog = inIncognito();
  if (keysOrNull == null) {
    const out = {};
    if (!incog) {
      Object.assign(out, STATE.data);
    } else {
      // Vista incognito di "tutto": solo le chiavi config dal disco (meno quelle
      // tombstoned) + ciò che l'incognito ha scritto nell'overlay.
      for (const k of Object.keys(STATE.data)) {
        if ((INCOGNITO_READABLE.has(k) && !INCOGNITO.tombstones.has(k)) || INCOGNITO_SHARED.has(k)) out[k] = STATE.data[k];
      }
      for (const k of Object.keys(INCOGNITO.data)) out[k] = INCOGNITO.data[k];
    }
    for (const k of STATE.osservate) if (k in out) out[k] = staccata(k, out[k]);
    return out;
  }
  const pick = (k) => staccata(k, incog ? incognitoReadKey(k) : STATE.data[k]);
  if (typeof keysOrNull === 'string') {
    return { [keysOrNull]: pick(keysOrNull) };
  }
  if (Array.isArray(keysOrNull)) {
    const out = {};
    for (const k of keysOrNull) out[k] = pick(k);
    return out;
  }
  if (typeof keysOrNull === 'object') {
    // formato { key: default }
    const out = {};
    for (const k of Object.keys(keysOrNull)) {
      const v = pick(k);
      out[k] = v !== undefined ? v : keysOrNull[k];
    }
    return out;
  }
  return {};
}

async function set(obj) {
  await loadIfNeeded();
  let keys = Object.keys(obj);
  // Chi tiene il registro dei cambi (src/main/services/registroCambi.js) vede OGNI scrittura,
  // anche quelle dell'incognito: sono loro che decidono dove finisce l'evento, non questo file.
  const incog = inIncognito();
  if (STATE.scritture.size) {
    const visti = {};
    for (const k of keys) visti[k] = { oldValue: incog ? incognitoReadKey(k) : STATE.data[k], newValue: obj[k] };
    for (const fn of STATE.scritture) {
      try { fn(visti, { incognito: incog }); } catch (e) { console.warn('[Filo storage] scrittura osservata, errore', e); }
    }
  }
  if (incog) {
    // Scrive solo nell'overlay in RAM: niente disco, niente flush e niente
    // emitChange (così non contamina i listener delle finestre normali).
    for (const k of keys) {
      if (INCOGNITO_SHARED.has(k)) continue;
      INCOGNITO.data[k] = staccata(k, obj[k]);
      INCOGNITO.tombstones.delete(k);
    }
    keys = keys.filter((k) => INCOGNITO_SHARED.has(k));
    if (!keys.length) return;
  }
  const changes = {};
  let cambiate = 0;
  for (const k of keys) {
    const newValue = obj[k];
    // Uguale a quello già nel file: niente scrittura né evento. Si confronta il testo, non l'oggetto: chi
    // ha cambiato dentro il valore letto e lo riscrive passa lo stesso riferimento. Il riferimento nuovo
    // si tiene comunque, così chi lo cambia ancora dopo lo ritrova in memoria.
    if (!STATE.sporche.has(k) && STATE.testi.has(k)) {
      let t = null;
      try { t = JSON.stringify(newValue); } catch (_) {}
      if (t !== null && t === STATE.testi.get(k)) { STATE.data[k] = staccata(k, newValue); continue; }
    }
    const oldValue = STATE.data[k];
    STATE.data[k] = staccata(k, newValue);
    STATE.sporche.add(k);
    changes[k] = { oldValue, newValue };
    cambiate++;
  }
  if (!cambiate) return;
  scheduleFlush();
  emitChange(changes);
}

async function remove(keys) {
  await loadIfNeeded();
  let list = Array.isArray(keys) ? keys : [keys];
  if (inIncognito()) {
    // Tombstone: la lettura successiva torna undefined anche se la chiave esiste su disco,
    // e il disco delle finestre normali resta intatto.
    for (const k of list) {
      if (INCOGNITO_SHARED.has(k)) continue;
      delete INCOGNITO.data[k];
      INCOGNITO.tombstones.add(k);
    }
    list = list.filter((k) => INCOGNITO_SHARED.has(k));
    if (!list.length) return;
  }
  const changes = {};
  for (const k of list) {
    if (k in STATE.data) {
      changes[k] = { oldValue: STATE.data[k], newValue: undefined };
      delete STATE.data[k];
      dimenticaTesto(k);
    }
  }
  if (Object.keys(changes).length) {
    scheduleFlush();
    emitChange(changes);
  }
}

async function clear() {
  await loadIfNeeded();
  if (inIncognito()) {
    // Svuota solo l'overlay: il disco delle finestre normali non si tocca.
    INCOGNITO.data = {};
    INCOGNITO.tombstones = new Set();
    return;
  }
  const changes = {};
  for (const k of Object.keys(STATE.data)) {
    changes[k] = { oldValue: STATE.data[k], newValue: undefined };
  }
  STATE.data = {};
  for (const k of Object.keys(changes)) dimenticaTesto(k);
  scheduleFlush();
  emitChange(changes);
  await togliCopie();
}

// «Cancella tutto» vale anche per la copia di riserva e per i file rovinati messi da parte: hanno gli stessi dati.
async function togliCopie() {
  const target = filePath();
  try { await STATE.copia; } catch (_) {}
  await fsp.rm(`${target}.bak`, { force: true }).catch(() => {});
  try {
    const base = `${path.basename(target)}.rovinato-`;
    for (const n of await fsp.readdir(path.dirname(target))) {
      if (n.startsWith(base)) await fsp.rm(path.join(path.dirname(target), n), { force: true }).catch(() => {});
    }
  } catch (_) {}
}

function dimenticaTesto(k) {
  STATE.testi.delete(k);
  STATE.suDisco.delete(k);
  STATE.sporche.delete(k);
}

function onChanged(fn) {
  STATE.listeners.add(fn);
  return () => STATE.listeners.delete(fn);
}

// Come onChanged, ma chiamato PRIMA della scrittura e anche in incognito, con { incognito }.
// `chiavi`: quelle che l'osservatore confronta prima/dopo; da qui in poi non si prestano vive.
function onScrittura(fn, chiavi = []) {
  for (const k of chiavi) STATE.osservate.add(k);
  STATE.scritture.add(fn);
  return () => STATE.scritture.delete(fn);
}

// Alla chiusura, dove non si può aspettare: sincrona, ma se non arriva in fondo il file di prima resta com'era.
// Riserializza tutto, così niente cambiato senza set resta fuori.
function flushSync() {
  if (!STATE.loaded || STATE.solaMemoria) return;
  const mia = ++STATE.generazione;
  const testo = testoDelFile({ tutte: true });
  try {
    Disco.scriviSync(filePath(), testo);
    STATE.genSuDisco = mia;
  } catch (e) { console.error('[Filo storage] flush failed alla chiusura:', e?.message || e); return; }
  // Una copia in attesa del suo minuto non arriverebbe più: si scrive adesso, o resterebbe quella con i dati cancellati.
  if (!STATE.copiaTimer) return;
  clearTimeout(STATE.copiaTimer);
  STATE.copiaTimer = null;
  const miaCopia = ++STATE.genCopia;
  try {
    Disco.scriviSync(`${filePath()}.bak`, testo);
    STATE.copiaSuDisco = miaCopia;
  } catch (e) { console.warn('[Filo storage] copia di riserva non scritta alla chiusura:', e?.message || e); }
}

// Scrittura sincrona per il cammino di chiusura (before-quit), dove non si può aspettare il
// debounce né i microtask di set(). Assume STATE già caricato, vero dopo il boot.
function setSync(obj) {
  try {
    if (!STATE.loaded) return;
    for (const k of Object.keys(obj)) STATE.data[k] = staccata(k, obj[k]);
    flushSync();
  } catch (e) { /* ignore */ }
}

module.exports = {
  get,
  set,
  remove,
  clear,
  onChanged,
  onScrittura,
  flushSync,
  whenSettled,
  flushNow,
  maxFlushOverlap,
  verificaMutazioni,
  statoDisco,
  contiDisco,
  dimensioneDisco,
  setSync,
  runIncognito,
  runNormale,
  fuoriDaIncognito,
  resetIncognito,
  inIncognito,
};

// app.evaluate gira nel main ma senza `require`, quindi i test non potrebbero pilotare
// l'incognito: sotto NODE_ENV=test l'API si espone su globalThis, in produzione mai.
if (process.env.NODE_ENV === 'test') {
  globalThis.__filoStorage = module.exports;
}
