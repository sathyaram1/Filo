// Storage adapter su disco: rimpiazza chrome.storage.local.
// Implementazione:
//   - un singolo file JSON in userData/storage.json
//   - lettura/scrittura atomica con write-then-rename
//   - debounce delle scritture (100ms) per evitare I/O di troppo
//   - listener onChanged compatibili con l'API chrome
//
// API esposta: get / set / remove / clear (compatibili chrome.storage.local).

const { app } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

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
    STATE.data = JSON.parse(txt) || {};
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

async function flush() {
  STATE.flushTimer = null;
  const target = filePath();
  const tmp = target + '.tmp';
  try {
    const txt = JSON.stringify(STATE.data);
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
  if (keysOrNull == null) return { ...STATE.data };
  if (typeof keysOrNull === 'string') {
    return { [keysOrNull]: STATE.data[keysOrNull] };
  }
  if (Array.isArray(keysOrNull)) {
    const out = {};
    for (const k of keysOrNull) out[k] = STATE.data[k];
    return out;
  }
  if (typeof keysOrNull === 'object') {
    // formato { key: default }
    const out = {};
    for (const k of Object.keys(keysOrNull)) {
      out[k] = STATE.data[k] !== undefined ? STATE.data[k] : keysOrNull[k];
    }
    return out;
  }
  return {};
}

async function set(obj) {
  await loadIfNeeded();
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
    fs.writeFileSync(filePath(), JSON.stringify(STATE.data), 'utf8');
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
  setSync,
};
