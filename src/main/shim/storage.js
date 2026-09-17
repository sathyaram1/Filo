// Storage su disco al posto di chrome.storage.local: un JSON in userData, scritture atomiche
// e con debounce, listener onChanged compatibili. API: get / set / remove / clear.
// Qui passano tutte le letture e scritture del main: è il punto dove vive l'incognito.

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

// Le chiavi API sono un segreto: a riposo si cifrano con `safeStorage` dell'OS, in memoria
// restano in chiaro. Senza keyring si ricade sul chiaro, e uno storage vecchio si migra.
const ENC_PREFIX = 'safeStorage:v1:';

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

// Copia da scrivere: apiKeys in chiaro diventa apiKeysEnc (base64 del blob cifrato).
// Non muta `data`, che in memoria resta in chiaro.
function serializeForDisk(data) {
  try {
    const s = data && data.settings;
    if (!s || typeof s !== 'object' || !s.apiKeys || typeof s.apiKeys !== 'object') return data;
    if (!canEncrypt()) return data; // niente keyring OS: si scrive in chiaro, meglio che perdere i dati
    const blob = safeStorage.encryptString(JSON.stringify(s.apiKeys)).toString('base64');
    const ns = { ...s, apiKeys: undefined, apiKeysEnc: ENC_PREFIX + blob };
    return { ...data, settings: ns };
  } catch (_) { return data; }
}

// Inverso di serializeForDisk: in memoria le apiKeys tornano in chiaro.
function deserializeFromDisk(data) {
  try {
    const s = data && data.settings;
    if (!s || typeof s !== 'object' || typeof s.apiKeysEnc !== 'string') return data;
    if (!s.apiKeysEnc.startsWith(ENC_PREFIX) || !canEncrypt()) return data;
    const buf = Buffer.from(s.apiKeysEnc.slice(ENC_PREFIX.length), 'base64');
    const apiKeys = JSON.parse(safeStorage.decryptString(buf));
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
  data: {},
  filePath: null,
  pending: null,
  flushTimer: null,
  listeners: new Set(),
};

// Incognito: la garanzia sta QUI, l'unico punto da cui passano tutte le letture e scritture.
// Un contesto AsyncLocalStorage dirotta su un overlay in RAM tutto ciò che ne discende.
const als = new AsyncLocalStorage();

// Ciò che l'incognito scrive vive solo qui, finché la sessione incognito è aperta.
const INCOGNITO = {
  data: {},               // { key: value } scritti durante la sessione incognito
  tombstones: new Set(),  // chiavi rimosse: mascherano l'eventuale valore su disco
};

// Allowlist FAIL-CLOSED: dal disco l'incognito legge SOLO queste chiavi di configurazione.
// Qualunque altra, comprese quelle future, è invisibile: la finestra parte vuota.
const INCOGNITO_READABLE = new Set([
  'settings', 'blocklist', 'sn_personal_dict', 'sn_autocorrect', 'sn_icon_layout',
]);

function inIncognito() {
  const s = als.getStore();
  return !!(s && s.incognito);
}

// Il contesto si propaga anche attraverso la catena async, non solo fino al primo await.
function runIncognito(fn) {
  return als.run({ incognito: true }, fn);
}

// Chiamata alla chiusura dell'ultima finestra incognito: niente deve sopravviverle.
function resetIncognito() {
  INCOGNITO.data = {};
  INCOGNITO.tombstones = new Set();
}

// In incognito una chiave si legge dall'overlay, o è mascherata da un tombstone; dal disco
// arrivano solo le chiavi di configurazione in allowlist, il resto è invisibile.
function incognitoReadKey(k) {
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

async function loadIfNeeded() {
  if (STATE.loaded) return;
  try {
    const txt = await fsp.readFile(filePath(), 'utf8');
    STATE.data = deserializeFromDisk(JSON.parse(txt) || {});
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[Filo storage] read failed:', err.message);
    STATE.data = {};
  }
  STATE.loaded = true;
}

function scheduleFlush() {
  if (STATE.flushTimer) return;
  STATE.flushTimer = setTimeout(flush, 100);
}

// I flush sono SERIALIZZATI: due insieme condividono lo stesso .tmp e la rename del secondo
// non lo trova più (ENOENT). Con uno storage grande il debounce li fa accavallare davvero.
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

// Attende che non resti niente in sospeso, facendo scattare subito un debounce pendente:
// serve ai test, dove aspettare «abbastanza secondi» è un falso allarme sotto carico.
async function whenSettled() {
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

async function doFlush() {
  const target = filePath();
  const tmp = target + '.tmp';
  // Contatore delle scritture in volo: è l'invariante del serializzatore qui sopra, e si
  // rompe SEMPRE se salta, mentre l'ENOENT vero dipende dall'ordine ed è ballerino.
  STATE.flushInFlight = (STATE.flushInFlight || 0) + 1;
  if (STATE.flushInFlight > (STATE.flushMaxInFlight || 0)) STATE.flushMaxInFlight = STATE.flushInFlight;
  try {
    const txt = JSON.stringify(serializeForDisk(STATE.data));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(tmp, txt, 'utf8');
    await fsp.rename(tmp, target);
  } catch (err) {
    console.error('[Filo storage] flush failed:', err);
  } finally {
    STATE.flushInFlight -= 1;
  }
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
    if (!incog) return { ...STATE.data };
    // Vista incognito di «tutto»: le sole chiavi in allowlist, più l'overlay, meno i tombstone.
    const out = {};
    for (const k of Object.keys(STATE.data)) {
      if (INCOGNITO_READABLE.has(k) && !INCOGNITO.tombstones.has(k)) out[k] = STATE.data[k];
    }
    for (const k of Object.keys(INCOGNITO.data)) out[k] = INCOGNITO.data[k];
    return out;
  }
  const pick = (k) => (incog ? incognitoReadKey(k) : STATE.data[k]);
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
  if (inIncognito()) {
    // Solo overlay in RAM: niente disco e niente emitChange, o i listener delle finestre
    // normali vedrebbero l'incognito.
    for (const k of Object.keys(obj)) {
      INCOGNITO.data[k] = obj[k];
      INCOGNITO.tombstones.delete(k);
    }
    return;
  }
  const changes = {};
  for (const k of Object.keys(obj)) {
    const oldValue = STATE.data[k];
    const newValue = obj[k];
    STATE.data[k] = newValue;
    changes[k] = { oldValue, newValue };
  }
  scheduleFlush();
  emitChange(changes);
}

async function remove(keys) {
  await loadIfNeeded();
  const list = Array.isArray(keys) ? keys : [keys];
  if (inIncognito()) {
    // Tombstone: la lettura successiva torna undefined anche se la chiave esiste su disco,
    // e il disco delle finestre normali resta intatto.
    for (const k of list) {
      delete INCOGNITO.data[k];
      INCOGNITO.tombstones.add(k);
    }
    return;
  }
  const changes = {};
  for (const k of list) {
    if (k in STATE.data) {
      changes[k] = { oldValue: STATE.data[k], newValue: undefined };
      delete STATE.data[k];
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
  scheduleFlush();
  emitChange(changes);
}

function onChanged(fn) {
  STATE.listeners.add(fn);
  return () => STATE.listeners.delete(fn);
}

// Flush sincrono best-effort prima della chiusura.
function flushSync() {
  try {
    if (!STATE.loaded) return;
    fs.writeFileSync(filePath(), JSON.stringify(serializeForDisk(STATE.data)), 'utf8');
  } catch (e) { /* ignore */ }
}

// Scrittura sincrona per il cammino di chiusura (before-quit), dove non si può aspettare il
// debounce né i microtask di set(). Assume STATE già caricato, vero dopo il boot.
function setSync(obj) {
  try {
    if (!STATE.loaded) return;
    for (const k of Object.keys(obj)) STATE.data[k] = obj[k];
    flushSync();
  } catch (e) { /* ignore */ }
}

module.exports = {
  get,
  set,
  remove,
  clear,
  onChanged,
  flushSync,
  whenSettled,
  flushNow,
  maxFlushOverlap,
  setSync,
  runIncognito,
  resetIncognito,
  inIncognito,
};

// app.evaluate gira nel main ma senza `require`, quindi i test non potrebbero pilotare
// l'incognito: sotto NODE_ENV=test l'API si espone su globalThis, in produzione mai.
if (process.env.NODE_ENV === 'test') {
  globalThis.__filoStorage = module.exports;
}
