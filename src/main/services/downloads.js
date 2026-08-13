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
// Intercetta il download che il browser fa partire da solo. "Salva
// immagine/video come…" (handlers/misc.js) NON passa di qui — deve scaricare i
// byte a mano per presentare il Referer della pagina — ma dal #436 si iscrive
// allo STESSO registro via beginManual(): per l'utente i due cammini sono la
// stessa cosa, quindi devono avere la stessa barra, lo stesso pannello e la
// stessa cronologia.
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
//     startedAt, endedAt, paused, canResume, canPause }
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
// Le sessioni incognito NON vengono mai agganciate (vedi tabs.js _makeView):
// "nessuna traccia" vale anche per i download.
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

// Nome file sicuro: niente separatori di percorso, caratteri di controllo o
// tentativi di traversal. Stesso spirito di safeImageFilename in handlers/misc.
function safeName(name) {
  let s = String(name || '').trim().replace(/[\x00-\x1f]/g, '');
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!s || s === '.' || s === '..') s = 'download';
  return s.slice(0, 180);
}

// Nome accorciato per gli avvisi: un file può avere un nome lunghissimo (fino a
// 180 caratteri, vedi safeName) e senza accorciarlo l'avviso di fine
// scaricamento diventa un riquadro enorme. Tagliamo in MEZZO così restano
// leggibili sia l'inizio sia l'estensione (che dice di che file si tratta).
function shortName(name, max = 44) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const ext = path.extname(s).slice(0, 12);
  const head = s.slice(0, Math.max(4, max - ext.length - 4));
  return `${head}…${ext}`;
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
      // La barra in alto (shell): riceve il record completo per l'indicatore
      // e il pannello, come da #410.1.
      try { win.webContents.send('shell:download', payload); } catch (_) {}
    }
  } catch (_) {}
  notifyTabs();
}

// Segnale CONTENTLESS alle pagine (schede) — serve alla pagina filo://downloads
// per sapere quando ri-leggere la lista. NON portiamo qui il record: questo
// canale (`filo:broadcast`) raggiunge ANCHE le schede di siti esterni, e il
// record contiene il percorso ASSOLUTO su disco (con lo username). La pagina
// legge i dati veri dal canale DOWNLOADS_LIST, riservato alle superfici interne.
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

// #412 — dopo aver preso in carico un download, avvisa il gestore schede della
// finestra che possiede la webContents che l'ha originato. Serve a chiudere una
// scheda rimasta VUOTA quando un link "Scarica" con target=_blank apre una nuova
// scheda che si trasforma subito in scaricamento (nessuna pagina si committa
// mai). Best-effort e non bloccante: se non c'è una scheda da chiudere è un no-op.
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

// ─── intercettazione ────────────────────────────────────────────────────
function onWillDownload(item, webContents) {
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
  };
  records.set(id, rec);
  liveItems.set(id, item);
  persist();
  broadcast('start', rec);
  // #412 — chiudi la scheda "vuota" aperta apposta da un link Scarica
  // target=_blank. Deferito così il ciclo di vita del download (già preso in
  // carico qui sopra) è completamente cablato prima di toccare l'albero delle view.
  setImmediate(() => notifyDownloadStarted(webContents));

  // ── Argine anti-silenzio ────────────────────────────────────────────────
  // Il problema da cui nasce: quando un server tronca la connessione a metà,
  // Chromium NON conclude lo scaricamento. Lo marca "interrotto" e lo riprende
  // da solo; se il server tronca di nuovo (e ignora le richieste Range,
  // ricominciando da zero) il ciclo si ripete all'infinito e l'utente resta nel
  // silenzio, senza mai un errore — lo stesso problema di #274.
  //
  // La prima versione di questo argine usava un semplice cronometro: "nessun
  // byte nuovo per 6 secondi ⇒ fallito". Sbagliato: un server semplicemente
  // LENTO (rete congestionata, connessione mobile, file che il sito deve
  // generare) fa esattamente la stessa cosa, e veniva ucciso con un errore
  // falso — peggio del silenzio, perché prima il file almeno arrivava.
  //
  // Il segnale giusto non è il TEMPO che passa senza byte, ma il fatto che sia
  // CHROMIUM STESSO a dichiarare caduto il trasferimento: l'evento 'updated'
  // arriva con stato 'interrupted'. Un server lento ma sano non lo emette MAI —
  // la connessione è viva, semplicemente non manda dati — quindi con questo
  // segnale la lentezza non può più essere scambiata per un guasto.
  //
  // Osservato dal vivo (server che tronca a metà ignorando le richieste Range):
  // Chromium ritenta da solo qualche volta, poi si arrende e resta fermo in
  // stato 'interrupted' SENZA emettere mai 'done' — è esattamente lì che
  // nasceva il silenzio. Quindi: alla prima caduta segnalata diamo una FINESTRA
  // DI GRAZIA per la ripresa automatica; se in quella finestra il download non
  // torna a guadagnare terreno, lo dichiariamo fallito. Se invece riprende (rete
  // ballerina che si rimette a posto, server che accetta il Range), la finestra
  // viene annullata e lo scaricamento arriva in fondo come deve.
  //
  // Il cronometro puro resta solo come RETE DI SICUREZZA per il caso limite di
  // una connessione appesa che non emette né progressi né interruzioni: soglia
  // nell'ordine dei MINUTI (non dei secondi) e — soprattutto — senza buttare via
  // i byte già scaricati.
  const STALL_MS = 3 * 60 * 1000;    // 3 minuti di silenzio assoluto
  const INTERRUPT_GRACE_MS = 20_000; // attesa concessa alla ripresa automatica
  let maxRecv = 0;

  function armWatchdog() {
    if (rec._stallTimer) clearTimeout(rec._stallTimer);
    rec._stallTimer = setTimeout(() => {
      rec._stallTimer = null;
      if (rec._final || rec.paused) return;
      // Rete di sicurezza: mettiamo in PAUSA invece di annullare. pause() ferma
      // il trasferimento ma lascia su disco il pezzo già scaricato (cancel() lo
      // cancellerebbe): niente lavoro buttato via, e comunque un avviso.
      finalize('interrupted');
      try { if (!item.isPaused()) item.pause(); } catch (_) {}
    }, STALL_MS);
  }

  // Chromium ha segnalato una caduta: aspettiamo che si riprenda da solo.
  function armInterruptGrace() {
    if (rec._resumeTimer) return;   // finestra già aperta: non riavviarla
    rec._resumeTimer = setTimeout(() => {
      rec._resumeTimer = null;
      if (rec._final || rec.paused) return;
      // Passata la grazia senza riprendersi: è un guasto vero, non lentezza.
      // Annullare qui è necessario per fermare l'eventuale ciclo di ritentativi
      // (e il pezzo su disco è comunque inservibile: ogni ritentativo è
      // ripartito da zero, non ha ripreso da dove era).
      //
      // finalize PRIMA di cancel(): item.cancel() emette 'done' con stato
      // 'cancelled' in modo SINCRONO, e senza il flag _final quel 'done'
      // trasformerebbe l'esito in "annullato" (niente toast d'errore). Marcando
      // l'interruzione qui, il 'done cancelled' che segue diventa un no-op.
      finalize('interrupted');
      try { item.cancel(); } catch (_) {}
    }, INTERRUPT_GRACE_MS);
  }

  function clearInterruptGrace() {
    if (rec._resumeTimer) { clearTimeout(rec._resumeTimer); rec._resumeTimer = null; }
  }

  // Chiude UNA volta sola il ciclo di vita del download (successo o fallimento).
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
      // Toast di conferma con azioni: le azioni dichiarative sono tradotte dalla
      // shell in api.downloads.openFile / openFolder (vedi shell.js onToast).
      shellToast(`Scaricato: ${shortName(rec.filename)}`, {
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

    // Terreno guadagnato: il trasferimento sta davvero procedendo. Ricarica il
    // cronometro e chiudi l'eventuale finestra di grazia: una ripresa produttiva
    // "perdona" le cadute precedenti (è il caso della rete ballerina).
    if (recv > maxRecv) { maxRecv = recv; clearInterruptGrace(); armWatchdog(); }

    if (rec.paused) {
      // Pausa volontaria dell'utente: non è un guasto, sospendi ogni timer.
      rec.state = 'paused';
      clearInterruptGrace();
      if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    } else if (state === 'interrupted') {
      // Chromium dichiara caduto il trasferimento: gli concediamo la finestra di
      // grazia per riprendersi da solo. Per l'utente resta "in corso" — se
      // riparte davvero non deve vedere allarmi inutili.
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
  _shortName: shortName,
  _safeName: safeName,
};
