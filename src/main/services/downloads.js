// Gestore degli scaricamenti "nativi" della navigazione (#410.1).
//
// Cosa intercetta: i download che partono cliccando un link a un file (PDF,
// ZIP, allegato) o quando un server risponde con Content-Disposition:attachment.
// Electron emette `will-download` sulla sessione che ha originato la richiesta:
// qui ascoltiamo la sessione di navigazione predefinita (e, opportunisticamente,
// le sessioni per-scheda di privacy/proxy/incognito) e SEGUIAMO ogni download —
// nome, dimensione, byte ricevuti, stato — così la barra in alto di Filo può
// mostrarne l'avanzamento fedele invece di lasciarlo "al buio".
//
// NON è il cammino di "Salva immagine/video come…": quello scarica i byte a mano
// nel main su richiesta esplicita del menu (handlers/misc.js) e resta com'è.
// Qui si intercetta il download che il browser fa partire da solo.
//
// Filosofia: "l'attrito è negativo" + "non salvare mai [a mano]". Per questo NON
// apriamo un dialogo "Salva come" a ogni file: salviamo direttamente nella
// cartella Download di sistema (risolvendo le collisioni di nome con un suffisso
// " (2)", " (3)"…) e mostriamo il file a fine scaricamento con "Apri file" /
// "Apri cartella". L'utente non deve decidere dove mettere ogni cosa.
//
// Persistenza: la cronologia (nome, dimensione, stato, data, percorso) vive in
// chrome.storage.local sotto STORAGE_KEYS.DOWNLOADS e sopravvive al riavvio: la
// pagina elenco (#410.3) la leggerà da lì. Schema di una voce (`publicRecord`):
//   { id, filename, url, mime, totalBytes, receivedBytes, state, savePath,
//     startedAt, endedAt, paused, canResume }
//   state ∈ 'progressing' | 'paused' | 'completed' | 'interrupted' | 'cancelled'

const path = require('node:path');
const fs = require('node:fs');

// Tetto della cronologia persistita: teniamo le voci più recenti. 200 è ampio
// per l'uso reale e non gonfia storage.json (poche centinaia di byte a voce).
const HISTORY_LIMIT = 200;

// Stati non terminali: se li ritroviamo all'avvio (record salvato mentre un
// download era in corso, poi l'app si è chiusa) il DownloadItem non esiste più,
// quindi la voce va normalizzata a 'interrupted'.
const NON_TERMINAL = new Set(['progressing', 'paused']);

// Record vivi (id → dati). Include gli scaricamenti in corso E la cronologia
// caricata da storage. La mappa è la fonte di verità in memoria.
const records = new Map();
// DownloadItem di Electron per gli scaricamenti in corso (id → item): non è
// serializzabile, quindi vive a parte e non finisce mai nello storage.
const liveItems = new Map();
// Sessioni già agganciate (evita doppioni se una session torna più volte).
const attached = new WeakSet();
// Sessioni per cui NON persistere la cronologia (incognito): l'invariante di
// privacy è che nulla della sessione effimera sopravvive al riavvio.
const ephemeralSessions = new WeakSet();

let loaded = false;

function electron() {
  return require('electron');
}

function uuid() {
  try { return require('node:crypto').randomUUID(); }
  catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

function storageKey() {
  return (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.DOWNLOADS) || 'downloads';
}

// Nome file sicuro: niente separatori di percorso, caratteri di controllo o
// tentativi di traversal. Stesso spirito di safeImageFilename in handlers/misc.
function safeName(name) {
  let s = String(name || '').trim().replace(/[\x00-\x1f]/g, '');
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!s || s === '.' || s === '..') s = 'download';
  return s.slice(0, 180);
}

// Cartella Download di sistema (ripiego: home). In test un hook d'ambiente la
// forza sotto lo userData isolato, così uno spec può far partire un download
// reale senza il dialogo nativo (impossibile da automatizzare headless) — lo
// stesso meccanismo di FILO_DOWNLOAD_DIR usato dal salvataggio immagini.
function downloadsDir() {
  const test = process.env.FILO_DOWNLOAD_DIR;
  if (test) { try { fs.mkdirSync(test, { recursive: true }); } catch (_) {} return test; }
  try { return electron().app.getPath('downloads'); } catch (_) {}
  try { return electron().app.getPath('home'); } catch (_) { return process.cwd(); }
}

// Percorso non ancora usato nella cartella: "file.pdf" → "file (2).pdf" se
// esiste già. Evita di sovrascrivere silenziosamente uno scaricamento omonimo.
function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

// La sola forma che esce verso la shell e lo storage (niente riferimenti nativi).
function publicRecord(r) {
  return {
    id: r.id,
    filename: r.filename,
    url: r.url,
    mime: r.mime || '',
    totalBytes: r.totalBytes || 0,
    receivedBytes: r.receivedBytes || 0,
    state: r.state,
    savePath: r.savePath || '',
    startedAt: r.startedAt || null,
    endedAt: r.endedAt || null,
    paused: !!r.paused,
    canResume: !!r.canResume,
  };
}

// Ordina per inizio decrescente (più recente prima) — così la shell e la
// cronologia mostrano subito l'ultimo scaricamento.
function listRecords() {
  return Array.from(records.values())
    .map(publicRecord)
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

// ─── persistenza ─────────────────────────────────────────────────────────
async function loadHistory() {
  if (loaded) return;
  loaded = true;
  try {
    const res = await chrome.storage.local.get(storageKey());
    const arr = res[storageKey()];
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        if (!raw || !raw.id) continue;
        const rec = { ...raw };
        // Un download che risultava "in corso" alla chiusura non può più
        // proseguire: il suo DownloadItem è morto. Lo marchiamo interrotto.
        if (NON_TERMINAL.has(rec.state)) { rec.state = 'interrupted'; rec.paused = false; rec.canResume = false; }
        records.set(rec.id, rec);
      }
    }
  } catch (_) { /* best-effort: senza cronologia si riparte da zero */ }
}

function persist() {
  try {
    const arr = listRecords().slice(0, HISTORY_LIMIT);
    chrome.storage.local.set({ [storageKey()]: arr });
  } catch (_) { /* best-effort */ }
}

// ─── broadcast verso la shell ───────────────────────────────────────────
function broadcast(kind, rec) {
  try {
    const { BrowserWindow } = electron();
    const payload = { kind, item: publicRecord(rec) };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      try { win.webContents.send('shell:download', payload); } catch (_) {}
    }
  } catch (_) {}
}

function shellToast(text, opts) {
  try {
    const { BrowserWindow } = electron();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.() || !win._filoTabs) continue;
      try { win.webContents.send('shell:toast', { text, opts }); } catch (_) {}
    }
  } catch (_) {}
}

// ─── intercettazione ────────────────────────────────────────────────────
function onWillDownload(item, persistThis) {
  const id = uuid();
  const filename = safeName(item.getFilename() || (function () {
    try { return decodeURIComponent(new URL(item.getURL()).pathname.split('/').pop() || ''); }
    catch (_) { return ''; }
  })() || 'download');

  // Salvataggio diretto nella cartella Download (niente dialogo "Salva come":
  // vedi nota di filosofia in testa al file). setSavePath disattiva il dialogo
  // nativo — indispensabile anche per i test headless.
  let savePath = '';
  try {
    savePath = uniquePath(downloadsDir(), filename);
    item.setSavePath(savePath);
  } catch (_) { /* se fallisce, Electron mostrerà comunque il suo dialogo */ }

  const rec = {
    id,
    filename: path.basename(savePath || filename),
    url: item.getURL(),
    mime: item.getMimeType() || '',
    totalBytes: item.getTotalBytes() || 0,
    receivedBytes: item.getReceivedBytes() || 0,
    state: 'progressing',
    savePath,
    startedAt: new Date().toISOString(),
    endedAt: null,
    paused: false,
    canResume: false,
    _persist: !!persistThis,
  };
  records.set(id, rec);
  liveItems.set(id, item);
  if (rec._persist) persist();
  broadcast('start', rec);

  // Tempo (ms) dopo cui un download che risulta "interrotto" ma non conclude
  // (Chromium lo lascia in sospeso "riprendibile" quando il server tronca la
  // connessione) viene dichiarato fallito: senza questo l'utente resterebbe nel
  // silenzio per sempre — lo stesso problema di #274 sul salvataggio immagini.
  const STALL_MS = 2500;

  // Chiude UNA volta sola il ciclo di vita del download (successo o fallimento).
  function finalize(state) {
    if (rec._final) return;
    rec._final = true;
    if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    liveItems.delete(id);
    rec.endedAt = new Date().toISOString();
    rec.paused = false;
    rec.canResume = false;
    try { rec.savePath = item.getSavePath() || rec.savePath; } catch (_) {}
    rec.filename = rec.savePath ? path.basename(rec.savePath) : rec.filename;

    if (state === 'completed') {
      rec.state = 'completed';
      if (rec._persist) persist();
      broadcast('done', rec);
      // Toast di conferma con azioni: le azioni dichiarative sono tradotte dalla
      // shell in api.downloads.openFile / openFolder (vedi shell.js onToast).
      shellToast(`Scaricato: ${rec.filename}`, {
        durationSec: 8,
        actions: [
          { label: 'Apri file', openDownloadId: rec.id },
          { label: 'Apri cartella', revealDownloadId: rec.id },
        ],
      });
    } else {
      // 'cancelled' (annullato dall'utente) o 'interrupted' (rete caduta, 4xx/5xx,
      // spazio finito): niente silenzio.
      rec.state = state === 'cancelled' ? 'cancelled' : 'interrupted';
      if (rec._persist) persist();
      broadcast('error', rec);
      if (rec.state !== 'cancelled') {
        shellToast(`Scaricamento non riuscito: ${rec.filename}`, { durationSec: 8 });
      }
    }
  }

  try { if (process.env.FILO_DOWNLOAD_DIR) fs.appendFileSync('/tmp/dlsvc.log', `willdl ${rec.filename} total=${rec.totalBytes}\n`); } catch (_) {}
  item.on('updated', (_e, state) => {
    try { if (process.env.FILO_DOWNLOAD_DIR) fs.appendFileSync('/tmp/dlsvc.log', `updated ${state} recv=${item.getReceivedBytes()} paused=${item.isPaused()} canResume=${item.canResume()}\n`); } catch (_) {}
    if (rec._final) return;
    rec.receivedBytes = item.getReceivedBytes() || rec.receivedBytes;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || 0;
    rec.paused = item.isPaused();
    rec.canResume = item.canResume();
    if (state === 'interrupted' && !rec.paused) {
      // Sospeso: se non riparte entro STALL_MS lo dichiariamo fallito. Se nel
      // frattempo l'utente lo mette in pausa (rec.paused) NON è un guasto.
      rec.state = 'progressing';
      if (!rec._stallTimer) {
        rec._stallTimer = setTimeout(() => {
          try { item.cancel(); } catch (_) {}
          finalize('interrupted');
        }, STALL_MS);
      }
    } else {
      // Progressi (o pausa volontaria): annulla l'eventuale timer di stallo.
      if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
      rec.state = rec.paused ? 'paused' : 'progressing';
    }
    broadcast('progress', rec);
  });

  item.once('done', (_e, state) => {
    rec.receivedBytes = item.getReceivedBytes() || rec.receivedBytes;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || rec.receivedBytes;
    finalize(state);
  });
}

// Aggancia will-download a una sessione (idempotente). `persistThis:false` per
// le sessioni effimere (incognito), i cui download non devono lasciare traccia.
function attachSession(ses, { persist: persistThis = true } = {}) {
  if (!ses || attached.has(ses)) return;
  attached.add(ses);
  if (!persistThis) ephemeralSessions.add(ses);
  try {
    ses.on('will-download', (_e, item) => {
      onWillDownload(item, !ephemeralSessions.has(ses));
    });
  } catch (_) {}
}

async function init() {
  await loadHistory();
  try { attachSession(electron().session.defaultSession, { persist: true }); } catch (_) {}
}

// ─── API per gli handler IPC (comandi dalla shell) ─────────────────────────
function list() { return listRecords(); }

function clearCompleted() {
  for (const [id, rec] of records) {
    if (!NON_TERMINAL.has(rec.state)) records.delete(id);
  }
  persist();
  return listRecords();
}

function remove(id) {
  const rec = records.get(id);
  // Un download in corso non si "rimuove" dalla lista: prima lo si annulla.
  if (rec && liveItems.has(id)) { try { liveItems.get(id).cancel(); } catch (_) {} }
  records.delete(id);
  liveItems.delete(id);
  persist();
  return listRecords();
}

function openFile(id) {
  const rec = records.get(id);
  if (!rec || !rec.savePath) return { ok: false, error: 'file non disponibile' };
  try {
    const r = electron().shell.openPath(rec.savePath);
    // openPath ritorna una stringa d'errore (non vuota) se non riesce.
    if (r && typeof r.then === 'function') {
      return r.then((msg) => (msg ? { ok: false, error: msg } : { ok: true }));
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e?.message || 'apertura fallita' }; }
}

function openFolder(id) {
  const rec = records.get(id);
  if (!rec || !rec.savePath) return { ok: false, error: 'file non disponibile' };
  try { electron().shell.showItemInFolder(rec.savePath); return { ok: true }; }
  catch (e) { return { ok: false, error: e?.message || 'apertura cartella fallita' }; }
}

function cancel(id) {
  const item = liveItems.get(id);
  if (item) { try { item.cancel(); } catch (_) {} }
  return { ok: true };
}
function pause(id) {
  const item = liveItems.get(id);
  if (item && !item.isPaused()) { try { item.pause(); } catch (_) {} }
  return { ok: true };
}
function resume(id) {
  const item = liveItems.get(id);
  if (item && item.canResume()) { try { item.resume(); } catch (_) {} }
  return { ok: true };
}

module.exports = {
  init,
  attachSession,
  list,
  clearCompleted,
  remove,
  openFile,
  openFolder,
  cancel,
  pause,
  resume,
  // per i test
  _records: records,
};
