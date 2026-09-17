// Scaricamenti nativi della navigazione: si segue ogni download di Electron (will-download)
// così la barra ne mostra l'avanzamento. «Salva immagine come…» entra nello stesso registro
// via beginManual(). Cronologia in chrome.storage.local, salvataggio diretto senza dialogo.

const path = require('node:path');
const fs = require('node:fs');

// Tetto della cronologia: 200 è ampio per l'uso reale e non gonfia storage.json.
const HISTORY_LIMIT = 200;

// Ritrovati all'avvio: il DownloadItem non esiste più, la voce va portata a 'interrupted'.
const NON_TERMINAL = new Set(['progressing', 'paused']);

// Fonte di verità in memoria: scaricamenti in corso più la cronologia caricata da storage.
const records = new Map();
// I DownloadItem di Electron non sono serializzabili: non finiscono mai nello storage.
const liveItems = new Map();
// Scaricamenti a mano: niente DownloadItem, i byte li muove handlers/misc.js (beginManual).
const liveManual = new Map();
// Evita doppioni se una sessione torna più volte. Le incognito non si agganciano mai
// (tabs.js _makeView): «nessuna traccia» vale anche per i download.
const attached = new WeakSet();

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

// Nome file sicuro: niente separatori, caratteri di controllo o traversal. Chromium ha già
// cambiato le barre in `_`, quindi ogni fila di due o più punti si comprime a uno, ovunque.
function safeName(name) {
  let s = String(name || '').trim().replace(/[\x00-\x1f]/g, '');
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/[<>:"|?*]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  if (!s || s === '.' || s === '..') s = 'download';
  return s.slice(0, 180);
}

// Un nome lunghissimo farebbe dell'avviso un riquadro enorme: si taglia in MEZZO, così
// restano leggibili sia l'inizio sia l'estensione.
function shortName(name, max = 44) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const ext = path.extname(s).slice(0, 12);
  const head = s.slice(0, Math.max(4, max - ext.length - 4));
  return `${head}…${ext}`;
}

// Cartella Download di sistema (ripiego: home). Nei test un hook d'ambiente la porta sotto
// lo userData isolato, così uno spec fa un download vero senza il dialogo nativo.
function downloadsDir() {
  const test = process.env.FILO_DOWNLOAD_DIR;
  if (test) { try { fs.mkdirSync(test, { recursive: true }); } catch (_) {} return test; }
  try { return electron().app.getPath('downloads'); } catch (_) {}
  try { return electron().app.getPath('home'); } catch (_) { return process.cwd(); }
}

// Non si sovrascrive in silenzio uno scaricamento omonimo: «file.pdf» → «file (2).pdf».
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

// Il file può sparire dopo: si guarda il disco PRIMA, perché su Linux shell.openPath dice
// «riuscito» anche su un percorso inesistente. Cache breve: la lista si rilegge ~8 volte/s.
const EXIST_TTL_MS = 1500;
const existCache = new Map();   // savePath → { at, ok }

function fileExists(p) {
  if (!p) return false;
  const now = Date.now();
  const hit = existCache.get(p);
  if (hit && now - hit.at < EXIST_TTL_MS) return hit.ok;
  let ok = false;
  try { ok = fs.existsSync(p); } catch (_) { ok = false; }
  if (existCache.size > 512) existCache.clear();   // tetto: è solo una cache
  existCache.set(p, { at: now, ok });
  return ok;
}

// Prima di un'azione dell'utente la cache non vale: può averlo spostato un istante fa,
// e su un'azione singola lo stat costa zero.
function forgetExists(p) { if (p) existCache.delete(p); }

// Solo per gli scaricamenti COMPLETATI: per uno interrotto il file non è mai esistito,
// e marcarlo «sparito» direbbe una cosa falsa.
function isMissing(r) {
  if (!r || r.state !== 'completed') return false;
  return !r.savePath || !fileExists(r.savePath);
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
    // Gli scaricamenti a mano non si mettono in pausa: la richiesta http resterebbe appesa e
    // il server la chiuderebbe. Il pannello nasconde il pulsante invece di offrirlo inerte.
    canPause: r.canPause !== false,
    // Il file non è più al suo posto: le superfici lo attenuano e tolgono «Apri file».
    missing: isMissing(r),
  };
}

// Inizio decrescente: shell e cronologia mostrano subito l'ultimo scaricamento.
function listRecords() {
  return Array.from(records.values())
    .map(publicRecord)
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

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
        // Un download «in corso» alla chiusura non può proseguire: il suo DownloadItem è morto.
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

function broadcast(kind, rec) {
  try {
    const { BrowserWindow } = electron();
    const payload = { kind, item: publicRecord(rec) };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      // La barra in alto riceve il record completo, per l'indicatore e per il pannello.
      try { win.webContents.send('shell:download', payload); } catch (_) {}
    }
  } catch (_) {}
  notifyTabs();
}

// Segnale CONTENTLESS: questo canale raggiunge anche le schede dei siti, e il record porta
// il percorso assoluto con lo username. I dati veri passano da DOWNLOADS_LIST, solo interne.
function notifyTabs() {
  try {
    const { BrowserWindow } = electron();
    const type = (globalThis.SN_MSG && globalThis.SN_MSG.MSG.DOWNLOADS_UPDATED) || 'downloads_updated';
    const msg = { type };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      const tm = win._filoTabs;
      if (tm && Array.isArray(tm.tabs)) {
        for (const t of tm.tabs) {
          try { t.view.webContents.send('filo:broadcast', msg); } catch (_) {}
        }
      }
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

// Chiude la scheda rimasta VUOTA quando un link «Scarica» con target=_blank apre una scheda
// che diventa subito scaricamento e non committa mai una pagina (#412). Best-effort.
function notifyDownloadStarted(webContents) {
  if (!webContents) return;
  try {
    const { BrowserWindow } = electron();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      const tm = win._filoTabs;
      if (tm && typeof tm.handleDownloadStarted === 'function') {
        try { tm.handleDownloadStarted(webContents); } catch (_) {}
      }
    }
  } catch (_) {}
}

function onWillDownload(item, webContents) {
  const id = uuid();
  const filename = safeName(item.getFilename() || (function () {
    try { return decodeURIComponent(new URL(item.getURL()).pathname.split('/').pop() || ''); }
    catch (_) { return ''; }
  })() || 'download');

  // setSavePath toglie il dialogo nativo: l'attrito è negativo, e headless non si automatizza.
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
  };
  records.set(id, rec);
  liveItems.set(id, item);
  persist();
  broadcast('start', rec);
  // Deferito: il ciclo di vita del download è cablato prima di toccare l'albero delle view.
  setImmediate(() => notifyDownloadStarted(webContents));

  // Il segnale non è il TEMPO senza byte (un server lento veniva ucciso con un errore falso)
  // ma la caduta dichiarata da Chromium: grazia alla ripresa, poi fallisce se non avanza.
  const STALL_MS = 3 * 60 * 1000;
  const INTERRUPT_GRACE_MS = 20_000;
  let maxRecv = 0;

  function armWatchdog() {
    if (rec._stallTimer) clearTimeout(rec._stallTimer);
    rec._stallTimer = setTimeout(() => {
      rec._stallTimer = null;
      if (rec._final || rec.paused) return;
      // Rete di sicurezza: si mette in PAUSA invece di annullare, perché pause() lascia su disco
      // il pezzo già scaricato mentre cancel() lo butta. E un avviso arriva comunque.
      finalize('interrupted');
      try { if (!item.isPaused()) item.pause(); } catch (_) {}
    }, STALL_MS);
  }

  // Chromium ha segnalato una caduta: si aspetta che si riprenda da solo.
  function armInterruptGrace() {
    if (rec._resumeTimer) return;   // finestra già aperta: non riavviarla
    rec._resumeTimer = setTimeout(() => {
      rec._resumeTimer = null;
      if (rec._final || rec.paused) return;
      // Passata la grazia è un guasto, non lentezza: annullare ferma il ciclo di ritentativi.
      // finalize PRIMA di cancel(): 'done' arriva sincrono e l'esito diventerebbe «annullato».
      finalize('interrupted');
      try { item.cancel(); } catch (_) {}
    }, INTERRUPT_GRACE_MS);
  }

  function clearInterruptGrace() {
    if (rec._resumeTimer) { clearTimeout(rec._resumeTimer); rec._resumeTimer = null; }
  }

  // Chiude UNA volta sola il ciclo di vita del download, successo o fallimento.
  function finalize(state) {
    if (rec._final) return;
    rec._final = true;
    if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    clearInterruptGrace();
    liveItems.delete(id);
    rec.endedAt = new Date().toISOString();
    rec.paused = false;
    rec.canResume = false;
    try { rec.savePath = item.getSavePath() || rec.savePath; } catch (_) {}
    rec.filename = rec.savePath ? path.basename(rec.savePath) : rec.filename;

    if (state === 'completed') {
      rec.state = 'completed';
      persist();
      broadcast('done', rec);
      // Le azioni dichiarative le traduce la shell in openFile / openFolder (shell.js onToast).
      shellToast(`Scaricato: ${shortName(rec.filename)}`, {
        durationSec: 8,
        actions: [
          { label: 'Apri file', openDownloadId: rec.id },
          { label: 'Apri cartella', revealDownloadId: rec.id },
        ],
      });
    } else {
      // 'cancelled' è l'utente, 'interrupted' è rete, 4xx/5xx o spazio finito: niente silenzio.
      rec.state = state === 'cancelled' ? 'cancelled' : 'interrupted';
      persist();
      broadcast('error', rec);
      if (rec.state !== 'cancelled') {
        shellToast(`Scaricamento non riuscito: ${shortName(rec.filename)}`, { durationSec: 8 });
      }
    }
  }

  armWatchdog();
  item.on('updated', (_e, state) => {
    if (rec._final) return;
    const recv = item.getReceivedBytes() || 0;
    rec.receivedBytes = recv;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || 0;
    rec.paused = item.isPaused();
    rec.canResume = item.canResume();

    // Terreno guadagnato: una ripresa produttiva perdona le cadute precedenti (rete ballerina),
    // quindi si ricarica il cronometro e si chiude la finestra di grazia.
    if (recv > maxRecv) { maxRecv = recv; clearInterruptGrace(); armWatchdog(); }

    if (rec.paused) {
      // Pausa volontaria dell'utente: non è un guasto, si sospende ogni timer.
      rec.state = 'paused';
      clearInterruptGrace();
      if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    } else if (state === 'interrupted') {
      // Caduta dichiarata da Chromium: si concede la grazia e per l'utente resta «in corso»,
      // perché se riparte davvero non deve vedere allarmi inutili.
      rec.state = 'progressing';
      armInterruptGrace();
    } else {
      rec.state = 'progressing';
      if (!rec._stallTimer) armWatchdog();   // ripreso dopo una pausa
    }
    broadcast('progress', rec);
  });

  item.once('done', (_e, state) => {
    rec.receivedBytes = item.getReceivedBytes() || rec.receivedBytes;
    if (!rec.totalBytes) rec.totalBytes = item.getTotalBytes() || rec.receivedBytes;
    finalize(state);
  });
}

// Scaricamenti a mano (#436): «Salva immagine come…» muove i byte da sé, unico modo di
// presentare il Referer; senza questo registro quel cammino resterebbe muto per l'utente.
function finalizeManual(rec, state, savePath) {
  if (rec._final) return;
  rec._final = true;
  liveManual.delete(rec.id);
  rec.endedAt = new Date().toISOString();
  rec.paused = false;
  rec.canResume = false;
  if (savePath) { rec.savePath = savePath; rec.filename = path.basename(savePath); }
  rec.state = state;
  persist();
  broadcast(state === 'completed' ? 'done' : 'error', rec);
  // Nessun avviso a fine corsa: chi salva dal menu ha già la conferma nella pagina.
}

function beginManual({ url, filename, totalBytes } = {}) {
  const id = uuid();
  const rec = {
    id,
    filename: safeName(filename || 'download'),
    url: String(url || ''),
    mime: '',
    totalBytes: Number(totalBytes) > 0 ? Number(totalBytes) : 0,
    receivedBytes: 0,
    state: 'progressing',
    savePath: '',
    startedAt: new Date().toISOString(),
    endedAt: null,
    paused: false,
    canResume: false,
    canPause: false,
  };
  records.set(id, rec);
  const requestCancel = () => { rec._cancelled = true; finalizeManual(rec, 'cancelled'); };
  liveManual.set(id, { cancel: requestCancel });
  persist();
  broadcast('start', rec);

  // Su rete veloce 'data' arriva migliaia di volte al secondo e ogni broadcast attraversa
  // l'IPC verso ogni finestra: ~8 aggiornamenti al secondo bastano all'occhio.
  const MIN_PUSH_MS = 120;
  let lastPush = 0;

  return {
    id,
    cancelled: () => !!rec._cancelled,
    progress(received, total) {
      if (rec._final) return;
      rec.receivedBytes = Number(received) || 0;
      if (Number(total) > 0) rec.totalBytes = Number(total);
      const now = Date.now();
      if (now - lastPush < MIN_PUSH_MS) return;
      lastPush = now;
      broadcast('progress', rec);
    },
    done(savePath) {
      // L'ultimo progress() può essere caduto nel freno: a file completo i byte ricevuti SONO
      // il totale, e la riga non deve restare ferma al 95% a scaricamento finito.
      if (rec.totalBytes > 0) rec.receivedBytes = rec.totalBytes;
      finalizeManual(rec, 'completed', savePath);
    },
    fail() { finalizeManual(rec, 'interrupted'); },
    cancel: requestCancel,
  };
}

// Aggancia will-download a una sessione (idempotente).
function attachSession(ses) {
  if (!ses || attached.has(ses)) return;
  attached.add(ses);
  try {
    ses.on('will-download', (_e, item, webContents) => { onWillDownload(item, webContents); });
  } catch (_) {}
}

async function init() {
  await loadHistory();
  try { attachSession(electron().session.defaultSession); } catch (_) {}
}

function list() { return listRecords(); }

function clearCompleted() {
  for (const [id, rec] of records) {
    if (!NON_TERMINAL.has(rec.state)) records.delete(id);
  }
  persist();
  return listRecords();
}

function remove(id) {
  // Un download in corso prima si annulla, poi si rimuove. Vale per entrambi i cammini.
  if (liveItems.has(id)) { try { liveItems.get(id).cancel(); } catch (_) {} }
  if (liveManual.has(id)) { try { liveManual.get(id).cancel(); } catch (_) {} }
  records.delete(id);
  liveItems.delete(id);
  liveManual.delete(id);
  persist();
  return listRecords();
}

// Messaggio unico: barra in alto e pagina elenco devono dirlo con le stesse parole.
const MISSING_TEXT = 'Il file non c’è più: forse è stato spostato o cancellato';
const MISSING_FOLDER_TEXT = 'La cartella non c’è più: forse è stata spostata o cancellata';

function openFile(id) {
  const rec = records.get(id);
  if (!rec) return { ok: false, error: 'Questo scaricamento non è più nell’elenco' };
  // Si guarda il disco PRIMA: l'esito dell'apertura non è affidabile (vedi existCache).
  forgetExists(rec.savePath);
  if (!rec.savePath || !fileExists(rec.savePath)) {
    // La voce è appena diventata «sparita»: le superfici aperte la attenuano senza ricaricare.
    broadcast('missing', rec);
    return { ok: false, missing: true, error: MISSING_TEXT };
  }
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
  if (!rec) return { ok: false, error: 'Questo scaricamento non è più nell’elenco' };
  if (!rec.savePath) return { ok: false, missing: true, error: MISSING_TEXT };
  forgetExists(rec.savePath);
  const here = fileExists(rec.savePath);
  if (!here) broadcast('missing', rec);
  try {
    if (here) { electron().shell.showItemInFolder(rec.savePath); return { ok: true }; }
    // Il file non c'è più ma la cartella spesso sì: aprirla è comunque il passo avanti che
    // l'utente cercava. Solo se manca anche quella non resta niente da aprire.
    const dir = path.dirname(rec.savePath);
    let dirThere = false;
    try { dirThere = fs.existsSync(dir); } catch (_) {}
    if (!dirThere) return { ok: false, missing: true, missingFolder: true, error: MISSING_FOLDER_TEXT };
    const r = electron().shell.openPath(dir);
    // ok:true + missing:true = «cartella aperta, ma il file dentro non c'è più».
    // Se la cartella c'è e il sistema non l'ha aperta è un'altra storia, e va detta com'è.
    const done = (msg) => (msg
      ? { ok: false, missing: true, error: 'Non è stato possibile aprire la cartella' }
      : { ok: true, missing: true });
    if (r && typeof r.then === 'function') return r.then(done);
    return { ok: true, missing: true };
  } catch (e) { return { ok: false, error: e?.message || 'apertura cartella fallita' }; }
}

function cancel(id) {
  const item = liveItems.get(id);
  if (item) { try { item.cancel(); } catch (_) {} }
  const manual = liveManual.get(id);
  if (manual) { try { manual.cancel(); } catch (_) {} }
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
  beginManual,
  // Per chi scarica i byte da sé: il file parziale va nella stessa cartella del download
  // nativo, così la rinomina finale è istantanea invece di una copia fra volumi.
  downloadsDir,
  uniquePath,
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
  _isMissing: isMissing,
  _forgetExists: forgetExists,
  MISSING_TEXT,
  _shortName: shortName,
  _safeName: safeName,
  _publicRecord: publicRecord,
};
