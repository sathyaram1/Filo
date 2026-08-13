// Handler di dominio: cattura schermo, salvataggio immagini su disco, box
// feedback (annotazione/invio) e fetch dei metadati Open Graph di un link.

const { safeFetch } = require('../safe-fetch');
const auth = require('../../auth/google-auth');
// Registra SN_FEEDBACK_THREAD su globalThis (IIFE): ci serve ownerize() per
// marcare gli invii dell'owner. Idempotente se già caricato dal loader.
require('../../../shared/feedbackThread.js');

// ── "Salva immagine/video/audio come…" (#274, #400): byte scaricati nel main ─

// Scarica i byte di un'immagine/media presentando il Referer della pagina e i
// cookie della session — l'unico modo, in Electron 33, di far arrivare il
// Referer a valle (i download via webContents.downloadURL lo perdono SEMPRE,
// sia con l'opzione { headers } sia riscrivendolo in onBeforeSendHeaders:
// verificato). Usiamo http/https di Node invece di net.request perché la
// richiesta di un download partita dal main viene bloccata
// (ERR_BLOCKED_BY_CLIENT) dal webRequest della session; il salvataggio
// esplicito di un'immagine che l'utente già vede non deve passare per
// l'ad/tracker-blocking.
//
// #436 — I byte vanno DIRETTAMENTE SU DISCO man mano che arrivano, non in un
// Buffer in memoria. Prima il file intero veniva accumulato in RAM prima di
// scriverlo: serviva un tetto (64MB per le immagini, 512MB per i media) oltre il
// quale il salvataggio si rifiutava, e anche sotto il tetto un filmato da
// qualche centinaio di MB appesantiva tutta l'app. Scrivendo di continuo il
// tetto non serve più — si salva quello che ci sta sul disco — e i byte
// ricevuti diventano un dato di avanzamento da mostrare.
//
// Segue i redirect (max 5) ricalcolando i cookie per l'host di destinazione,
// come farebbe un browser. Risolve { partPath, filename, totalBytes,
// receivedBytes } o rigetta con un errore leggibile (HTTP 4xx/5xx, connessione
// troncata, file vuoto).
async function fetchToFile({ url, referrer, session, kind = 'image', onHeaders, onProgress, shouldStop }) {
  const MAX_REDIRECTS = 5;
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await httpGetToFile(target, referrer, session, kind, { onHeaders, onProgress, shouldStop });
    if (res.redirect) {
      try { target = new URL(res.location, target).href; } catch (_) { throw new Error('redirect non valido'); }
      if (!/^https?:/i.test(target)) throw new Error('redirect non http');
      continue;
    }
    return res;
  }
  throw new Error('troppi redirect');
}

// Una singola richiesta GET. Risolve { redirect:true, location } su 3xx; oppure
// scrive il body nel file indicato da onHeaders() e risolve a scrittura
// conclusa. Rigetta su errore/troncamento.
async function httpGetToFile(target, referrer, session, kind, hooks) {
  const isMedia = kind === 'video' || kind === 'audio';
  let u;
  try { u = new URL(target); } catch (_) { throw new Error('URL non valido'); }
  const mod = u.protocol === 'https:' ? require('node:https') : require('node:http');
  const fs = require('node:fs');
  const { pipeline } = require('node:stream');

  // Cookie della session per QUESTO host (immagini dietro login), come un browser.
  let cookieHeader = '';
  try {
    const cookies = await session.cookies.get({ url: target });
    cookieHeader = (cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (_) {}

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    // Un Accept che dichiara solo immagini fa rispondere 406 ad alcuni server
    // quando l'URL è un filmato: per i media chiediamo il tipo giusto.
    Accept: isMedia ? `${kind}/*,*/*;q=0.8` : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  if (/^https?:/i.test(referrer)) headers.Referer = referrer;
  if (cookieHeader) headers.Cookie = cookieHeader;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; fn(arg); };

    const req = mod.get(target, { headers }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // scarta il body del redirect
        finish(resolve, { redirect: true, location: res.headers.location });
        return;
      }
      if (status >= 400) { res.resume(); finish(reject, new Error('HTTP ' + status)); return; }

      // Content-Length: è il dato che rende l'avanzamento una PERCENTUALE
      // invece di un contatore di byte. Manca sui trasferimenti chunked, e lì
      // la barra resta indeterminata — come per i download nativi.
      const expected = parseInt(res.headers['content-length'], 10);
      const total = Number.isFinite(expected) && expected > 0 ? expected : 0;
      const filename = filenameFromHeaders(res.headers, target);

      // Solo ORA sappiamo nome e dimensione: il chiamante li usa per aprire la
      // voce nella barra e per decidere dove far crescere il file parziale.
      let partPath;
      try {
        partPath = hooks.onHeaders({ filename, totalBytes: total });
      } catch (e) {
        res.resume();
        try { req.destroy(); } catch (_) {}
        finish(reject, e instanceof Error ? e : new Error('destinazione non disponibile'));
        return;
      }

      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        try { hooks.onProgress && hooks.onProgress(received, total); } catch (_) {}
        // L'utente ha premuto "Annulla" nella barra: chiudi la connessione
        // invece di continuare a consumare rete e disco.
        if (hooks.shouldStop && hooks.shouldStop()) {
          try { req.destroy(new Error('annullato')); } catch (_) {}
        }
      });

      const out = fs.createWriteStream(partPath);
      pipeline(res, out, (err) => {
        if (err) { finish(reject, err instanceof Error ? err : new Error('download interrotto')); return; }
        // Connessione chiusa prima della fine del body (res.complete=false) o
        // Content-Length dichiarato ma non raggiunto ⇒ risposta troncata: è un
        // errore, non un file valido (niente più silenzio sul download a metà).
        if (!res.complete || (total && received < total)) {
          finish(reject, new Error('download interrotto'));
          return;
        }
        if (!received) { finish(reject, new Error('file vuoto')); return; }
        finish(resolve, { partPath, filename, totalBytes: total || received, receivedBytes: received });
      });
    });
    req.on('error', (e) => finish(reject, e || new Error('richiesta fallita')));
    // Timeout di INATTIVITÀ (si riarma a ogni byte): un file da un'ora è
    // legittimo, mezzo minuto di silenzio assoluto no.
    req.setTimeout(30000, () => { try { req.destroy(new Error('timeout')); } catch (_) {} });
  });
}

// Sposta il file finito dalla sua posizione di lavoro alla destinazione scelta.
// Quasi sempre è una rinomina istantanea (stesso volume); se l'utente ha scelto
// un altro disco/chiavetta la rinomina non è possibile e si copia — comunque a
// blocchi, mai passando dalla memoria.
async function moveInto(from, to) {
  const fs = require('node:fs');
  try {
    await fs.promises.rename(from, to);
    return;
  } catch (e) {
    if (!e || (e.code !== 'EXDEV' && e.code !== 'EPERM' && e.code !== 'EACCES')) throw e;
  }
  await fs.promises.copyFile(from, to);
  try { await fs.promises.unlink(from); } catch (_) {}
}

// Nome file dal Content-Disposition (se presente), altrimenti dal path dell'URL.
function filenameFromHeaders(hdrs, url) {
  try {
    const cd = hdrs && hdrs['content-disposition'];
    if (cd) {
      // filename*=UTF-8''… (RFC 5987) ha priorità su filename=…
      let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
      if (m) { try { return decodeURIComponent(m[1].trim().replace(/^["']|["']$/g, '')); } catch (_) { return m[1]; } }
      m = /filename=("?)([^";]+)\1/i.exec(cd);
      if (m) return m[2].trim();
    }
  } catch (_) {}
  return filenameFromUrl(url);
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
    return base || '';
  } catch (_) { return ''; }
}

// Neutralizza separatori di percorso, caratteri di controllo e traversal: il
// nome del server è dato ostile e non deve poter uscire dalla cartella scelta.
function safeImageFilename(name) {
  let n = require('node:path').basename(String(name || ''));
  n = n.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  if (!n) n = 'immagine';
  return n.slice(0, 200);
}

module.exports = function register(on, ctx) {
  const { MSG, winOf, getEffectiveSettings, modelForAction, buildAttemptChain, broadcastToTabs } = ctx;
  const ACTIONS = globalThis.SN_CONST.ACTIONS;

  // Titolo breve del feedback, generato da un LLM economico al momento
  // dell'invio (es. "gestione segreti"). Best-effort: se la catena modelli non
  // è configurata o tarda, si ripiega sulle prime parole del testo — l'invio
  // del feedback non deve MAI fallire per colpa del titolo.
  async function generateFeedbackName(text) {
    const fallback = globalThis.SN_FEEDBACK?.fallbackName?.(text) || '';
    const t = String(text || '').trim();
    if (!t) return fallback;
    try {
      const settings = await getEffectiveSettings();
      const attempts = buildAttemptChain(
        settings, modelForAction(settings, ACTIONS.FEEDBACK_TITLE), ACTIONS.FEEDBACK_TITLE,
      );
      const messages = [{
        role: 'user',
        content: 'Genera un titolo brevissimo (2-6 parole, nella stessa lingua del testo) che riassuma questo feedback su un\'app. Rispondi SOLO col titolo, senza virgolette e senza punto finale.\n\nFeedback:\n' + t.slice(0, 1500),
      }];
      const r = await Promise.race([
        globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout titolo (8s)')), 8000)),
      ]);
      const name = String(r?.text || '').trim()
        .split('\n')[0]
        .replace(/^["'«\s]+|["'»\s.]+$/g, '')
        .slice(0, 120);
      return name || fallback;
    } catch (e) {
      console.warn('[Filo feedback] titolo LLM non disponibile:', e?.message || e);
      return fallback;
    }
  }

  on(MSG.CAPTURE_VISIBLE_TAB, async (msg, sender) => {
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: false, error: 'no window' };
    const tab = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
    if (!tab) return { ok: false, error: 'no active tab' };
    const img = await tab.view.webContents.capturePage();
    return { ok: true, dataUrl: img.toDataURL() };
  });

  // "Salva immagine come…" (#274). Il vecchio cammino era un <a download>
  // creato dal content script: Chromium onora l'attributo `download` SOLO per
  // URL same-origin/blob:/data: — per un'immagine su un ALTRO dominio (la
  // stragrande maggioranza) lo ignorava e la scheda navigava sull'immagine
  // senza scaricare nulla.
  //
  // Scarichiamo i byte QUI nel main con net.request, poi li scriviamo su disco.
  // Perché non webContents.downloadURL: molti CDN con protezione hotlink
  // rispondono 403 alle richieste "anonime" (senza Referer) anche per immagini
  // che nella pagina si vedono benissimo — e NON c'è modo di presentare il
  // Referer a un download di Electron 33: né l'opzione { headers } di
  // downloadURL né una riscrittura in onBeforeSendHeaders vengono onorate per
  // la richiesta di download (verificato: la richiesta arriva sempre senza
  // Referer). net.request invece lascia impostare qualsiasi header e usa i
  // cookie/auth della session del tab, così il salvataggio riesce a prescindere
  // dall'origine E sui siti con hotlink protection. Un fetch che si interrompe
  // a metà diventa naturalmente un errore (niente più silenzio), e l'utente
  // sceglie dove salvare col dialogo nativo "Salva come…".
  // Un solo cammino per immagini, video e audio: cambia solo `kind` (nome di
  // ripiego, header Accept e tetto di dimensione). Registrato su DUE messaggi
  // perché il chiamante dichiara cosa sta salvando (#400: prima del fix il
  // menu su un <video> non offriva alcun salvataggio).
  const handleDownload = async (msg, sender) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const kind = ['image', 'video', 'audio'].includes(msg.kind) ? msg.kind : 'image';
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    const path = require('node:path');
    const fs = require('node:fs');
    const { dialog, app, BrowserWindow } = require('electron');
    const ses = wc.session;
    const referrer = String(sender?.tab?.url || sender?.url || '');

    // 1) Scarica i byte (con Referer della pagina + cookie della session).
    let buffer, suggested;
    try {
      const r = await fetchImageBytes({ url, referrer, session: ses, kind });
      buffer = r.buffer;
      suggested = r.filename;
    } catch (e) {
      return { ok: false, error: e?.message || 'download fallito' };
    }

    // 2) Nome file sicuro: preferisci il Content-Disposition del server, poi il
    // path dell'URL; neutralizza separatori e tentativi di traversal.
    const fallbackName = kind === 'video' ? 'video' : (kind === 'audio' ? 'audio' : 'immagine');
    const filename = safeImageFilename(suggested || filenameFromUrl(url) || fallbackName);

    // 3) Scegli il percorso e scrivi.
    const testDir = process.env.FILO_DOWNLOAD_DIR;
    let savePath;
    if (testDir) {
      // Hook per i test/headless: salvataggio diretto senza dialogo nativo.
      try { fs.mkdirSync(testDir, { recursive: true }); } catch (_) {}
      savePath = path.join(testDir, filename);
    } else {
      // Dialogo "Salva come…" pre-compilato con la cartella Download e il nome
      // dedotto — stesso comportamento che il salvataggio same-origin aveva già.
      try {
        const win = BrowserWindow.fromWebContents(wc) || winOf(sender) || null;
        const opts = { defaultPath: path.join(app.getPath('downloads'), filename) };
        const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
        // Annullato dall'utente: non è un errore, nessun toast.
        if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
        savePath = res.filePath;
      } catch (e) {
        return { ok: false, error: e?.message || 'dialogo non disponibile' };
      }
    }

    try {
      await fs.promises.writeFile(savePath, buffer);
      return { ok: true, path: savePath, filename: path.basename(savePath) };
    } catch (e) {
      return { ok: false, error: e?.message || 'scrittura fallita' };
    }
  };

  on(MSG.DOWNLOAD_IMAGE, handleDownload);
  on(MSG.DOWNLOAD_MEDIA, handleDownload);

  // "Salva file" su un link a un file (#410.2). A differenza di
  // DOWNLOAD_IMAGE/MEDIA (byte scaricati a mano nel main), qui facciamo partire
  // il download NATIVO della scheda: webContents.downloadURL emette
  // will-download sulla sessione della scheda, che services/downloads.js (#410.1)
  // già intercetta e segue. Risultato IDENTICO al clic sul link — avanzamento in
  // barra, salvataggio in cartella Download, toast finale, cronologia — così i
  // due cammini (menu e clic) producono lo stesso effetto visibile. Il nome-file
  // ostile del server è neutralizzato a valle da downloads.js (safeName), come
  // per il salvataggio immagini. Non serve il gate "solo superfici interne": far
  // partire uno scaricamento di un URL è esattamente ciò che il clic sul link fa
  // già, e non espone cronologia né percorsi su disco (quelli restano riservati).
  on(MSG.DOWNLOAD_LINK, async (msg, sender) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    try {
      wc.downloadURL(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'download non avviato' };
    }
  });

  // ── Download "nativi" della navigazione (#410.1): la shell legge la
  //    cronologia e comanda i singoli scaricamenti. Il tracking vero vive in
  //    services/downloads.js (ascolta will-download della sessione). ──────────
  //
  // SICUREZZA — confine d'origine (stesso pattern di handlers/storage.js e
  // handlers/nav.js). Questi handler sono registrati sul canale generico
  // `filo:message`, raggiungibile ANCHE dai content script delle pagine web
  // esterne. Senza gate, un sito qualsiasi potrebbe:
  //   - leggere l'intera cronologia degli scaricamenti (nomi dei file, URL di
  //     provenienza e percorso ASSOLUTO su disco, che contiene lo username);
  //   - far APRIRE al sistema operativo un file appena scaricato (su Windows
  //     equivale a farlo eseguire) o rivelarne la cartella;
  //   - annullare un download in corso o svuotare la cronologia.
  // Nessuna pagina web ha motivo di toccare gli scaricamenti: la cronologia e i
  // comandi sono UI di Filo. Ammessi solo dalle superfici interne (shell e
  // pagine filo://), come gli altri canali privilegiati.
  const DL = () => require('../downloads');
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // La shell (barra in alto) è la finestra stessa: `filo://shell/shell.html`,
  // quindi isFilo la copre già; `sender.isShell` è la conferma strutturale per
  // eventuali finestre interne senza URL filo://.
  const internalOnly = (fn) => async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return fn(msg, sender, origin);
  };
  on(MSG.DOWNLOADS_LIST, internalOnly(async () => ({ ok: true, items: DL().list() })));
  on(MSG.DOWNLOADS_CLEAR, internalOnly(async () => ({ ok: true, items: DL().clearCompleted() })));
  on(MSG.DOWNLOAD_REMOVE, internalOnly(async (msg) => ({ ok: true, items: DL().remove(msg.id) })));
  on(MSG.DOWNLOAD_OPEN_FILE, internalOnly(async (msg) => DL().openFile(msg.id)));
  on(MSG.DOWNLOAD_OPEN_FOLDER, internalOnly(async (msg) => DL().openFolder(msg.id)));
  on(MSG.DOWNLOAD_CANCEL, internalOnly(async (msg) => DL().cancel(msg.id)));
  on(MSG.DOWNLOAD_PAUSE, internalOnly(async (msg) => DL().pause(msg.id)));
  on(MSG.DOWNLOAD_RESUME, internalOnly(async (msg) => DL().resume(msg.id)));

  on(MSG.FEEDBACK_ANNOTATE, async (msg, sender) => {
    // Il box feedback è appena entrato/uscito dalla modalità annotazione.
    // Inoltriamo alla shell (barra in alto) così l'ombra copre TUTTO Filo,
    // non solo l'area pagina dove vive il content script.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-dim', { on: !!msg.on }); } catch (_) {}
    return { ok: true };
  });

  on(MSG.FEEDBACK_CLEAR_DRAW, async (msg, sender) => {
    // "Cancella disegno" dal box (pagina): cancella anche i tratti sulla barra
    // in alto, che vivono nella shell.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-clear-draw'); } catch (_) {}
    return { ok: true };
  });

  on(MSG.CAPTURE_FEEDBACK_TOPBAR, async (msg, sender) => {
    // Scatto annotato della SOLA barra in alto di Filo (shell): il box lo
    // impila sopra lo screenshot della pagina per ottenere un'immagine di
    // tutta l'app col disegno. I tratti sono già parte del DOM della shell
    // (canvas di disegno), quindi vengono catturati direttamente.
    const win = winOf(sender);
    if (!win || !win._filoTabs) return { ok: false, error: 'no window' };
    try {
      const barH = win._filoTabs.topChromeHeight();
      if (barH <= 0) return { ok: false, error: 'no topbar' };
      const [w] = win.getContentSize();
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: barH });
      return { ok: true, dataUrl: img.toDataURL(), barHeight: barH };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Coda d'invio del feedback (#341): "Invia" NON aspetta più la rete. Il box
  // sparisce subito e il main si fa carico di consegnare il feedback in
  // background, ritentando da solo finché la connessione torna. L'invio è
  // idempotente (submissionId → dedup lato server), quindi i ritentativi non
  // creano duplicati. La coda è persistita: un feedback accodato offline
  // sopravvive anche alla chiusura dell'app e riparte al riavvio.
  const Outbox = globalThis.SN_FEEDBACK_OUTBOX;
  if (Outbox?.init) {
    Outbox.init({
      // Titolo breve generato al momento reale dell'invio (offline → fallback).
      prepare: (payload) => generateFeedbackName(payload?.text),
      // A invio riuscito: se qualche allegato non è stato caricato, avvisa
      // l'utente (l'unico canale disponibile dal main verso le pagine è il
      // broadcast di un toast). Il feedback è comunque partito col resto.
      onDone: (_item, result) => {
        const failed = Array.isArray(result?.failed) ? result.failed : [];
        if (!failed.length) return;
        const names = failed.map((f) => f?.name || 'allegato').join(', ');
        try {
          broadcastToTabs({
            type: MSG.SHOW_TOAST,
            text: `Feedback inviato, ma non sono riuscito a caricare: ${names}`,
            duration: 6000,
          });
        } catch (_) {}
      },
      log: (...a) => { try { console.log('[Filo feedback]', ...a); } catch (_) {} },
    });
  }

  on(MSG.SUBMIT_FEEDBACK, async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.submit) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      if (!Outbox?.enqueue) {
        throw new Error('SN_FEEDBACK_OUTBOX non caricato nel main process');
      }
      const payload = msg.payload || {};
      // Se l'utente è loggato come admin (l'owner), marca il suo invio come
      // "owner:" così la dashboard lo distingue (verde) dai feedback dei tester
      // esterni (arancione). L'identità owner è nota solo qui nel main (auth
      // singleton): il content script che genera il clientId non sa di esserlo.
      try {
        if (auth.isAdmin() && globalThis.SN_FEEDBACK_THREAD?.ownerize) {
          payload.clientId = globalThis.SN_FEEDBACK_THREAD.ownerize(payload.clientId);
        }
      } catch (_) {}
      console.log('[Filo feedback] submit start', {
        textLen: (payload.text || '').length,
        images: (payload.images || []).length,
        url: payload.url,
      });
      // Accoda e prova a inviare subito, ma NON aspettare la rete: l'ack torna
      // appena il feedback è al sicuro in coda (persistito). Il titolo lo genera
      // la coda al momento dell'invio (anche offline, col fallback).
      const r = await Outbox.enqueue(payload);
      return { ok: true, queued: true, id: r?.id };
    } catch (e) {
      console.error('[Filo feedback] submit failed', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ── Recap aggiornamento (C4) ────────────────────────────────────────────────
  // Calcola, lato main (qui c'è sia app.getVersion() sia le note caricate), il
  // recap delle versioni saltate dall'ultima vista dall'utente. La pagina home
  // (dashboard) lo mostra come popup all'avvio.
  function appVersion() {
    try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
  }

  on(MSG.GET_UPDATE_RECAP, async () => {
    const PN = globalThis.SN_PATCH_NOTES;
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    const current = appVersion();
    if (!PN || !globalThis.SN_STORAGE) return { ok: true, current, lastSeen: current, notes: [] };
    const lastSeen = await globalThis.SN_STORAGE.getRaw(KEYS.LAST_SEEN_VERSION, null);
    // Primissimo avvio (nessuna versione vista): non mostrare nulla a sorpresa,
    // ma marca la versione corrente come "vista" così il prossimo update parte
    // pulito. Niente note ritornate → niente popup.
    if (!lastSeen) {
      try { await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, current); } catch (_) {}
      return { ok: true, current, lastSeen: null, notes: [] };
    }
    const notes = PN.since(lastSeen, current);
    return { ok: true, current, lastSeen, notes };
  });

  on(MSG.MARK_UPDATE_SEEN, async () => {
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    try { await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, appVersion()); } catch (_) {}
    return { ok: true };
  });

  on('fetch_link_meta', async (msg) => {
    try {
      const url = msg.url;
      if (!url) return { ok: false, error: 'url mancante' };
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      // safeFetch: solo http/https + blocco di loopback/IP privati, rivalidando
      // ogni redirect. Evita che una pagina usi questa fetch del main per
      // sondare/leggere servizi locali o interni (SSRF).
      const r = await safeFetch(url, { signal: controller.signal });
      clearTimeout(t);
      let html = '';
      const reader = r.body?.getReader?.();
      if (reader) {
        const dec = new TextDecoder('utf-8', { fatal: false });
        let total = 0;
        while (total < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          html += dec.decode(value, { stream: true });
          if (html.includes('</head>')) break;
        }
        try { reader.cancel(); } catch (_) {}
      } else {
        html = await r.text();
      }
      const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
      const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                      pick(/<title[^>]*>([^<]+)<\/title>/i);
      const ogDescription = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                            pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      return { ok: true, ogTitle, ogDescription };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
};
