// Storage adapter su disco: rimpiazza chrome.storage.local.
// Implementazione:
//   - un singolo file JSON in userData/storage.json
//   - lettura/scrittura atomica con write-then-rename
//   - debounce delle scritture (100ms) per evitare I/O di troppo
//   - listener onChanged compatibili con l'API chrome
//
// API esposta: get / set / remove / clear (compatibili chrome.storage.local).

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

// === Cifratura a riposo delle chiavi API ===========================
// Le chiavi API dei provider AI (settings.apiKeys) sono un segreto: a riposo NON
// devono stare in chiaro nel storage.json (qualsiasi altro processo dell'utente,
// un backup o un altro utente del FS potrebbe leggerle). Le cifriamo con
// `safeStorage` di Electron (DPAPI su Windows, Keychain su macOS, libsecret su
// Linux) — la stessa difesa già usata per i token di sessione (auth/token-store).
// In MEMORIA (STATE.data) restano in chiaro: chi legge i settings (getSettings)
// non cambia. La cifratura tocca solo il blob serializzato su disco.
//
// Compatibilità: un storage.json vecchio (apiKeys in chiaro) viene letto e, alla
// prima scrittura, riscritto cifrato — migrazione trasparente. Se la cifratura
// OS non è disponibile (es. Linux headless senza keyring), si ricade sul
// comportamento precedente (apiKeys in chiaro) senza perdere dati.
const ENC_PREFIX = 'safeStorage:v1:';

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

// Copia DA SCRIVERE su disco: sostituisce settings.apiKeys (in chiaro, in
// memoria) con settings.apiKeysEnc (base64 del blob cifrato). Non muta `data`.
function serializeForDisk(data) {
  try {
    const s = data && data.settings;
    if (!s || typeof s !== 'object' || !s.apiKeys || typeof s.apiKeys !== 'object') return data;
    if (!canEncrypt()) return data; // niente keyring OS → resta com'era (no perdita dati)
    const blob = safeStorage.encryptString(JSON.stringify(s.apiKeys)).toString('base64');
    const ns = { ...s, apiKeys: undefined, apiKeysEnc: ENC_PREFIX + blob };
    return { ...data, settings: ns };
  } catch (_) { return data; }
}

// Inverso di serializeForDisk: al load ripristina settings.apiKeys in chiaro in
// memoria a partire dal blob cifrato, e rimuove il campo apiKeysEnc.
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
    // Blob illeggibile (cifrato con un'altra chiave OS / altro utente): lascia
    // i settings senza apiKeys (l'utente le re-inserisce), come fa token-store.
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

// Overlay in memoria: ciò che l'incognito scrive vive solo qui, finché la
// sessione incognito è aperta. resetIncognito() lo azzera alla chiusura
// dell'ultima finestra incognito.
const INCOGNITO = {
  data: {},               // { key: value } scritti durante la sessione incognito
  tombstones: new Set(),  // chiavi rimosse: mascherano l'eventuale valore su disco
};

// Allowlist FAIL-CLOSED: SOLO queste chiavi sono leggibili dal disco in
// incognito (config/impostazioni che l'utente si aspetta di ereditare: modelli,
// tema, blocklist, dizionario, autocorrezione, layout icone). QUALSIASI altra
// chiave — comprese quelle aggiunte in futuro — è invisibile dal disco in
// incognito: la finestra parte "vuota" e ciò che scrive resta in RAM.
// Vedi STORAGE_KEYS in src/shared/constants.js.
const INCOGNITO_READABLE = new Set([
  'settings', 'blocklist', 'sn_personal_dict', 'sn_autocorrect', 'sn_icon_layout',
]);

function inIncognito() {
  const s = als.getStore();
  return !!(s && s.incognito);
}

// Esegue fn in un contesto incognito. Ritorna ciò che fn ritorna (anche una
// Promise: AsyncLocalStorage propaga il contesto attraverso la catena async).
function runIncognito(fn) {
  return als.run({ incognito: true }, fn);
}

// Azzera l'overlay incognito. Chiamato dalla chiusura dell'ultima finestra
// incognito: nulla di ciò che è stato navigato/scritto sopravvive.
function resetIncognito() {
  INCOGNITO.data = {};
  INCOGNITO.tombstones = new Set();
}

// Risolve la lettura di UNA chiave nella vista incognito:
//   1) scritta in questa sessione  → valore dall'overlay
//   2) rimossa in questa sessione  → undefined (maschera il disco)
//   3) chiave di config in allowlist → valore dal disco (ereditato)
//   4) altrimenti (memoria/navigazione) → undefined (invisibile)
function incognitoReadKey(k) {
  if (k in INCOGNITO.data) return INCOGNITO.data[k];
  if (INCOGNITO.tombstones.has(k)) return undefined;
  if (INCOGNITO_READABLE.has(k)) return STATE.data[k];
  return undefined;
}

function filePath() {
  if (!STATE.filePath) {
    // FILO_USER_DATA override per i test: ogni run mette un tempdir isolato
    // così non si tocca lo storage reale dell'utente.
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

// I flush sono SERIALIZZATI: due flush concorrenti condividono lo stesso file
// .tmp, e la rename del secondo trova il tmp già consumato dal primo (ENOENT).
// Con uno storage grande la scrittura async dura abbastanza da far scattare un
// nuovo timer di debounce mentre la precedente è ancora in volo.
async function flush() {
  STATE.flushTimer = null;
  STATE.flushChain = (STATE.flushChain || Promise.resolve()).then(doFlush);
  return STATE.flushChain;
}

// Attende che non resti NIENTE in sospeso: né un flush in attesa del debounce,
// né uno in volo. Se il debounce è pendente lo fa scattare subito invece di
// aspettarlo, così non c'è nessuna attesa a tempo.
//
// Serve ai test: aspettare "abbastanza secondi" che una scrittura grande
// arrivi su disco è affidabile a macchina scarica e diventa un falso allarme
// sotto carico — e il fallimento che ne esce parla di dati incoerenti invece
// che di un'attesa scaduta, mandando fuori strada chi lo legge.
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
  try {
    const txt = JSON.stringify(serializeForDisk(STATE.data));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(tmp, txt, 'utf8');
    await fsp.rename(tmp, target);
  } catch (err) {
    console.error('[Filo storage] flush failed:', err);
  }
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
    // Vista incognito di "tutto": solo le chiavi config dal disco (meno quelle
    // tombstoned) + ciò che l'incognito ha scritto nell'overlay.
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
    // Scrive solo nell'overlay in RAM: niente disco, niente flush e niente
    // emitChange (così non contamina i listener delle finestre normali).
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
    // Rimuove dall'overlay e mette un tombstone: una lettura successiva torna
    // undefined anche se la chiave esiste su disco (finestre normali intatte).
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

// Scrittura sincrona best-effort: aggiorna lo stato in memoria e scrive subito
// su disco. Usata sul path di chiusura (before-quit), dove non possiamo
// aspettare il debounce né i microtask del set() async. Assume STATE già
// caricato (vero a runtime, dopo il boot).
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
  setSync,
  runIncognito,
  resetIncognito,
  inIncognito,
};

// Hook per i test (Playwright): app.evaluate gira nel main process ma in un
// contesto dove `require` non è disponibile, quindi i test non possono caricare
// questo modulo per pilotare runIncognito/resetIncognito. Sotto NODE_ENV=test
// (impostato dal fixture) esponiamo l'API su globalThis. In produzione il ramo
// non viene mai preso, quindi nessuna superficie extra.
if (process.env.NODE_ENV === 'test') {
  globalThis.__filoStorage = module.exports;
}
