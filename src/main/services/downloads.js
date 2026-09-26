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
const NON_TERMINAL = new Set(['progressing', 'paused', 'pending']);

// #588 — un file che il sistema ESEGUE non entra nella cartella Download senza
// una risposta: scende in una cartella riservata (`quarantena` dentro i dati
// dell'app), e da lì si sposta solo se l'utente dice di sì. Stato 'pending'.
// La lista delle estensioni e le frasi stanno in src/shared/eseguibili.js.
function ESE() { return globalThis.SN_ESEGUIBILI; }

// Config letta dalle impostazioni (security.downloads). Il default CHIEDE:
// finché le impostazioni non sono arrivate, un programma si ferma comunque.
let chiediEseguibili = true;
let sitiFidati = [];

function configureFromSettings(settings) {
  const d = (settings && settings.security && settings.security.downloads) || {};
  chiediEseguibili = d.confirmExecutables !== false;
  sitiFidati = Array.isArray(d.trustedSites) ? d.trustedSites.slice() : [];
}

// Un programma da un sito che l'utente ha dichiarato fidato scende come un PDF.
function chiedeConferma(url) {
  if (!chiediEseguibili) return false;
  try { return !ESE().fidato(url, sitiFidati); } catch (_) { return true; }
}

// Record vivi (id → dati). Include gli scaricamenti in corso E la cronologia
// caricata da storage. La mappa è la fonte di verità in memoria.
const records = new Map();
// DownloadItem di Electron per gli scaricamenti in corso (id → item): non è
// serializzabile, quindi vive a parte e non finisce mai nello storage.
const liveItems = new Map();
// Scaricamenti "a mano" in corso (id → { cancel }): non hanno un DownloadItem
// perché i byte li muove handlers/misc.js. Vedi beginManual().
const liveManual = new Map();
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
// Il traversal non arriva solo in testa: Chromium ha già cambiato le barre in
// `_`, e `../../pwned` si presenta come `_.._.._pwned`. Ogni fila di due o più
// punti si comprime a uno, ovunque sia; i punti singoli (`a.b.txt`) restano.
function safeName(name) {
  // I caratteri di direzione (U+202E & co.) non cambiano l'estensione vera ma
  // capovolgono come si LEGGE il nome: «fattura<RLO>txt.exe» si mostra come
  // «fatturaexe.txt». Il file su disco non deve poterlo fare (#588).
  let s = String(name || '');
  try { s = ESE().nomeVisibile(s); } catch (_) {}
  s = s.trim().replace(/[\x00-\x1f]/g, '');
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/[<>:"|?*]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
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

// Cartella di quarantena: dentro i dati dell'app, MAI dentro Download. Un
// programma in attesa di risposta sta qui, dove nessun gestore file lo mostra e
// nessun doppio clic lo trova.
function quarantineDir() {
  let base = '';
  try { base = electron().app.getPath('userData'); } catch (_) { base = downloadsDir(); }
  const dir = path.join(base, 'quarantena');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

// Sposta il file approvato dalla quarantena alla cartella Download. La rinomina
// fallisce fra volumi diversi (userData e Download possono stare su dischi
// diversi): in quel caso si copia e si cancella. Ritorna false se non ce l'ha
// fatta — chi chiama lo DICE, non finge che il file sia arrivato.
function spostaFile(src, dst) {
  try { fs.renameSync(src, dst); return true; } catch (_) {}
  try { fs.copyFileSync(src, dst); } catch (_) { return false; }
  try { fs.unlinkSync(src); } catch (_) { /* copiato: il doppione in quarantena non è un guasto */ }
  return true;
}

// Il file in quarantena non serve più (rifiutato, rimosso, o app riavviata).
function rimuoviQuarantena(rec) {
  const p = rec && rec._quarantena && rec.savePath;
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) {}
  forgetExists(p);
  rec._quarantena = false;
}

// ─── il file può sparire DOPO lo scaricamento ───────────────────────────
// Uno scaricamento finito è una voce che punta a un percorso su disco, ma quel
// percorso è dell'utente: può spostare il file, rinominarlo, cestinarlo. Da quel
// momento "Apri file" non ha più niente da aprire, e va detto invece di fingere.
//
// Non ci si fida dell'esito dell'apertura: su Windows il sistema segnala il
// fallimento, su Linux `shell.openPath` risponde "riuscito" anche su un percorso
// inesistente. L'unica risposta uguale ovunque è guardare il disco PRIMA.
//
// La presenza passa da una cache a scadenza breve: la lista viene ri-lette a
// ogni avanzamento (fino a ~8 volte al secondo, fino a 200 voci), e senza cache
// ogni tacca di una barra di avanzamento costerebbe centinaia di stat.
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

// Prima di un'azione dell'utente la cache non vale: lui il file può averlo
// spostato un istante fa, e su un'azione singola lo stat costa zero.
function forgetExists(p) { if (p) existCache.delete(p); }

// "Il file promesso da questa voce non c'è più". Vale solo per gli scaricamenti
// COMPLETATI: per uno interrotto o annullato il file non è mai esistito, e
// marcarlo "sparito" direbbe una cosa falsa.
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
    // Finché il file è in quarantena il percorso NON esce: è una cartella
    // interna di Filo, e mostrarla (o lasciarla copiare) inviterebbe ad andarci.
    savePath: r.state === 'pending' ? '' : (r.savePath || ''),
    startedAt: r.startedAt || null,
    endedAt: r.endedAt || null,
    paused: !!r.paused,
    canResume: !!r.canResume,
    // Gli scaricamenti "a mano" (#436) non si mettono in pausa: la richiesta
    // http resterebbe appesa e il server la chiuderebbe. Il pannello nasconde
    // il pulsante invece di offrirne uno che non fa niente.
    canPause: r.canPause !== false,
    // Il file scaricato non è più al suo posto (spostato, rinominato,
    // cestinato): le superfici lo mostrano attenuato e senza "Apri file".
    missing: isMissing(r),
    // #588 — è un file che il sistema ESEGUE: le superfici lo marcano a vista e
    // "Apri file" chiede conferma. `site` è il sito da cui arriva, che è la
    // cosa da guardare prima di decidere.
    exe: !!r.exe,
    site: r.site || '',
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
        // Una conferma non sopravvive al riavvio: chi l'avrebbe data non è più
        // davanti a quell'avviso. Il programma resta fuori dalla cartella e la
        // voce dice che non è stato scaricato (#588).
        // Cronologia scritta prima del #588: la marca non c'era, e senza
        // ricalcolarla un .exe già in elenco si aprirebbe senza conferma.
        if (rec.exe === undefined) {
          try { rec.exe = ESE().eEseguibile(rec.filename); } catch (_) { rec.exe = false; }
          if (!rec.site) { try { rec.site = ESE().sito(rec.url); } catch (_) {} }
        }
        if (rec.state === 'pending') {
          rec._quarantena = true;
          rimuoviQuarantena(rec);
          rec.state = 'cancelled'; rec.savePath = ''; rec.paused = false; rec.canResume = false;
        } else if (NON_TERMINAL.has(rec.state)) {
          // Un download che risultava "in corso" alla chiusura non può più
          // proseguire: il suo DownloadItem è morto. Lo marchiamo interrotto.
          rec.state = 'interrupted'; rec.paused = false; rec.canResume = false;
        }
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

// Chiude uno scaricamento arrivato in fondo: se veniva dalla quarantena (#588)
// il file entra ORA nella cartella Download, e solo se ci entra davvero la voce
// dice "completato".
function completa(rec) {
  if (rec._quarantena) {
    const dest = uniquePath(downloadsDir(), rec.filename);
    if (spostaFile(rec.savePath, dest)) {
      forgetExists(rec.savePath);
      rec.savePath = dest;
      rec.filename = path.basename(dest);
      rec._quarantena = false;
    } else {
      // Il file non è arrivato dove l'utente lo cercherà: dirlo è l'unica
      // risposta onesta (e la quarantena si svuota, così non resta un programma
      // in un posto che nessuno guarda).
      rimuoviQuarantena(rec);
      rec.state = 'interrupted';
      rec.savePath = '';
      persist();
      broadcast('error', rec);
      shellToast(`Scaricamento non riuscito: ${shortName(rec.filename)}`, { durationSec: 8 });
      return;
    }
  }
  rec.state = 'completed';
  if (!rec.endedAt) rec.endedAt = new Date().toISOString();
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
}

// ─── intercettazione ────────────────────────────────────────────────────
function onWillDownload(item, webContents) {
  const id = uuid();
  const filename = safeName(item.getFilename() || (function () {
    try { return decodeURIComponent(new URL(item.getURL()).pathname.split('/').pop() || ''); }
    catch (_) { return ''; }
  })() || 'download');

  const url = item.getURL();
  let exe = false;
  try { exe = ESE().eEseguibile(filename); } catch (_) {}
  // Un programma si ferma PRIMA della cartella Download: i byte scendono in
  // quarantena e ci restano finché l'utente non risponde (#588). Il resto dei
  // file non cambia di una virgola: l'attrito va solo dove serve.
  const attesa = exe && chiedeConferma(url);

  // Salvataggio diretto nella cartella Download (niente dialogo "Salva come":
  // vedi nota di filosofia in testa al file). setSavePath disattiva il dialogo
  // nativo — indispensabile anche per i test headless.
  let savePath = '';
  try {
    savePath = uniquePath(attesa ? quarantineDir() : downloadsDir(), filename);
    item.setSavePath(savePath);
  } catch (_) { /* se fallisce, Electron mostrerà comunque il suo dialogo */ }

  const rec = {
    id,
    filename: path.basename(savePath || filename),
    url,
    mime: item.getMimeType() || '',
    totalBytes: item.getTotalBytes() || 0,
    receivedBytes: item.getReceivedBytes() || 0,
    state: attesa ? 'pending' : 'progressing',
    savePath,
    startedAt: new Date().toISOString(),
    endedAt: null,
    paused: false,
    canResume: false,
    exe,
    site: (() => { try { return ESE().sito(url); } catch (_) { return ''; } })(),
    _quarantena: attesa,
  };
  records.set(id, rec);
  liveItems.set(id, item);
  persist();
  broadcast('start', rec);
  if (attesa) {
    // L'avviso NON scade: se sparisse da solo, la risposta di default
    // diventerebbe "il file resta in un posto che l'utente non conosce".
    // Chiuderlo con la X lascia la voce in attesa nell'elenco, dove le stesse
    // due risposte restano a portata.
    let testo = `«${rec.filename}» è un programma: scaricarlo?`;
    try { testo = ESE().testoScarica(rec.filename, url); } catch (_) {}
    shellToast(testo, {
      durationSec: 0,
      actions: [
        { label: 'Scarica', confirmDownloadId: id, allow: true },
        { label: 'Non scaricare', confirmDownloadId: id, allow: false },
      ],
    });
  }
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
      // I byte sono arrivati ma il programma aspetta ancora una risposta: resta
      // in quarantena, e nessun avviso dice "scaricato" per un file che non è
      // nella cartella Download (#588). Ci pensa confirm(), quando l'utente
      // risponde.
      if (rec.state === 'pending') { rec._arrivato = true; persist(); broadcast('progress', rec); return; }
      completa(rec);
    } else {
      // Rifiutato, caduto o annullato: il pezzo in quarantena non deve restare.
      rimuoviQuarantena(rec);
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

    // In attesa di risposta (#588): i byte scendono in quarantena, ma la voce
    // NON diventa "in corso" — non lo è, finché non c'è un sì. Gli argini
    // contro il silenzio restano attivi: un trasferimento morto va dichiarato
    // anche mentre l'avviso è a schermo.
    const inAttesa = rec.state === 'pending';

    if (rec.paused && !inAttesa) {
      // Pausa volontaria dell'utente: non è un guasto, sospendi ogni timer.
      rec.state = 'paused';
      clearInterruptGrace();
      if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    } else if (state === 'interrupted') {
      // Chromium dichiara caduto il trasferimento: gli concediamo la finestra di
      // grazia per riprendersi da solo. Per l'utente resta "in corso" — se
      // riparte davvero non deve vedere allarmi inutili.
      if (!inAttesa) rec.state = 'progressing';
      armInterruptGrace();
    } else {
      if (!inAttesa) rec.state = 'progressing';
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

// ─── scaricamenti "a mano" (#436) ────────────────────────────────────────
// "Salva immagine/video come…" scarica i byte da sé (handlers/misc.js): è
// l'unico modo di presentare il Referer della pagina, che webContents.downloadURL
// perde sempre. Il prezzo era che quel cammino restava MUTO — nessuna barra,
// nessuna percentuale, nessun modo di annullare — mentre un filmato di centinaia
// di MB arrivava. Qui gli diamo lo stesso registro dei download nativi: chi
// guarda la barra non deve sapere quale dei due cammini ha prodotto la riga.
//
// Uso: beginManual() apre la voce, il chiamante la nutre con progress() a ogni
// blocco ricevuto e la chiude con done()/fail(); cancelled() dice se nel
// frattempo l'utente ha premuto "Annulla" nella barra, così il trasferimento si
// può fermare davvero.
function finalizeManual(rec, state, savePath) {
  if (rec._final) return;
  rec._final = true;
  liveManual.delete(rec.id);
  rec.endedAt = new Date().toISOString();
  rec.paused = false;
  rec.canResume = false;
  if (savePath) {
    rec.savePath = savePath;
    rec.filename = path.basename(savePath);
    // Il nome definitivo lo sceglie l'utente nel dialogo di salvataggio: la
    // marca "è un programma" si rifà su QUELLO, non sul nome proposto.
    try { rec.exe = ESE().eEseguibile(rec.filename); } catch (_) {}
  }
  rec.state = state;
  persist();
  broadcast(state === 'completed' ? 'done' : 'error', rec);
  // Nessun avviso a fine corsa: chi ha chiesto il salvataggio dal menu riceve
  // già la sua conferma nella pagina (un secondo avviso sarebbe un doppione).
}

function beginManual({ url, filename, totalBytes } = {}) {
  const id = uuid();
  const nome = safeName(filename || 'download');
  const indirizzo = String(url || '');
  const marca = (fn, ripiego) => { try { return fn(); } catch (_) { return ripiego; } };
  const rec = {
    id,
    filename: nome,
    url: indirizzo,
    // Anche "Salva immagine/video come…" può depositare un programma: la voce
    // lo dichiara e "Apri file" chiede conferma come per ogni altro (#588).
    exe: marca(() => ESE().eEseguibile(nome), false),
    site: marca(() => ESE().sito(indirizzo), ''),
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

  // Su rete veloce l'evento 'data' arriva migliaia di volte al secondo e ogni
  // broadcast attraversa l'IPC verso ogni finestra: senza freno l'avanzamento
  // costerebbe più del download. ~8 aggiornamenti al secondo bastano all'occhio.
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
      // L'ultimo progress() può essere caduto nel freno qui sopra: a file
      // completo i byte ricevuti SONO il totale, e la riga non deve restare
      // ferma al 95% dopo essersi conclusa.
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
  // Nessuna attesa sopravvive a un riavvio (loadHistory le chiude): quello che
  // resta in quarantena è orfano, e un programma orfano non deve restare su
  // disco. Si svuota all'avvio, quando non può esserci niente di vivo dentro.
  try {
    const dir = quarantineDir();
    for (const nome of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, nome), { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
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
  // Un download in corso non si "rimuove" dalla lista: prima lo si annulla.
  // Vale per entrambi i cammini, nativo e "a mano".
  if (liveItems.has(id)) { try { liveItems.get(id).cancel(); } catch (_) {} }
  if (liveManual.has(id)) { try { liveManual.get(id).cancel(); } catch (_) {} }
  // Togliere dall'elenco una voce in attesa È una risposta: il programma in
  // quarantena se ne va con lei, invece di restare su disco senza più nessuno
  // che possa deciderne la sorte (#588).
  const rec = records.get(id);
  if (rec) rimuoviQuarantena(rec);
  records.delete(id);
  liveItems.delete(id);
  liveManual.delete(id);
  persist();
  return listRecords();
}

// Messaggio unico per "il file non c'è più": lo dicono sia la barra in alto sia
// la pagina elenco, e devono dirlo con le stesse parole.
const MISSING_TEXT = 'Il file non c’è più: forse è stato spostato o cancellato';
const MISSING_FOLDER_TEXT = 'La cartella non c’è più: forse è stata spostata o cancellata';

// #588 — risposta alla domanda "questo programma lo scarico?". `allow` viene da
// un clic dell'utente: un no cancella il file dalla quarantena, un sì lo fa
// proseguire (o lo sposta subito, se i byte sono già tutti arrivati).
function confirmDownload(id, allow) {
  const rec = records.get(id);
  if (!rec || rec.state !== 'pending') {
    return { ok: false, error: 'Questo scaricamento non aspetta più una risposta', items: listRecords() };
  }
  if (!allow) {
    const item = liveItems.get(id);
    rec._final = true;   // il 'done' che segue cancel() non deve riscrivere l'esito
    if (rec._stallTimer) { clearTimeout(rec._stallTimer); rec._stallTimer = null; }
    if (rec._resumeTimer) { clearTimeout(rec._resumeTimer); rec._resumeTimer = null; }
    if (item) { try { item.cancel(); } catch (_) {} }
    liveItems.delete(id);
    rimuoviQuarantena(rec);
    rec.state = 'cancelled';
    rec.savePath = '';
    rec.paused = false;
    rec.canResume = false;
    rec.endedAt = new Date().toISOString();
    persist();
    broadcast('error', rec);
    return { ok: true, items: listRecords() };
  }
  if (rec._arrivato) { completa(rec); return { ok: true, items: listRecords() }; }
  // Ancora in corso: prosegue come un download qualsiasi, e il file esce dalla
  // quarantena quando arriva in fondo (completa()).
  rec.state = 'progressing';
  persist();
  broadcast('progress', rec);
  return { ok: true, items: listRecords() };
}

function openFile(id, opts) {
  const rec = records.get(id);
  if (!rec) return { ok: false, error: 'Questo scaricamento non è più nell’elenco' };
  if (rec.state === 'pending') {
    return { ok: false, error: 'Questo programma non è stato scaricato: rispondi prima all’avviso' };
  }
  // Guarda il disco PRIMA di tentare (vedi nota su fileExists): l'esito
  // dell'apertura non è affidabile su tutte le piattaforme.
  forgetExists(rec.savePath);
  if (!rec.savePath || !fileExists(rec.savePath)) {
    // La voce è appena diventata "sparita" agli occhi dell'utente: avvisa le
    // superfici aperte così la vedono attenuata senza dover ricaricare.
    broadcast('missing', rec);
    return { ok: false, missing: true, error: MISSING_TEXT };
  }
  // #588 — l'UNICA porta verso shell.openPath: aprire un programma è eseguirlo,
  // e qui non si passa senza una seconda risposta. Il gate sta nel main perché
  // le superfici che offrono "Apri file" sono tre (avviso, barra, pagina) e una
  // regola per porta sarebbe una porta dimenticata.
  if (rec.exe && !(opts && opts.confirmed) && chiedeConferma(rec.url)) {
    let text = `«${rec.filename}» è un programma: aprirlo vuol dire eseguirlo.`;
    let title = 'Aprire un programma?';
    try { text = ESE().testoApri(rec.filename, rec.url); title = ESE().TITOLO_APRI; } catch (_) {}
    return { ok: false, needsConfirm: true, exe: true, title, text };
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
    // Il file non c'è più, ma la cartella dove stava spesso sì: aprirla è
    // comunque il passo avanti che l'utente cercava (magari il file è lì
    // rinominato). Solo se manca anche quella non resta niente da aprire.
    const dir = path.dirname(rec.savePath);
    let dirThere = false;
    try { dirThere = fs.existsSync(dir); } catch (_) {}
    if (!dirThere) return { ok: false, missing: true, missingFolder: true, error: MISSING_FOLDER_TEXT };
    const r = electron().shell.openPath(dir);
    // ok:true + missing:true = "cartella aperta, ma il file dentro non c'è più".
    // La cartella c'è ma il sistema non l'ha aperta (nessun gestore file, o
    // permessi): è un'altra storia, e va detta com'è invece di dare la colpa a
    // una cartella sparita.
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
  // Serve a chi scarica i byte da sé (#436) per piazzare il file parziale nella
  // stessa cartella in cui atterrerebbe un download nativo: così la rinomina
  // finale resta un'operazione istantanea invece di una copia fra volumi.
  downloadsDir,
  uniquePath,
  list,
  clearCompleted,
  remove,
  confirmDownload,
  configureFromSettings,
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
