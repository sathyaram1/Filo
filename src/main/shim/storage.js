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

const STATE = {
  loaded: false,
  data: {},
  filePath: null,
  pending: null,
  flushTimer: null,
  listeners: new Set(),
};

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

module.exports = {
  get,
  set,
  remove,
  clear,
  onChanged,
  flushSync,
};
