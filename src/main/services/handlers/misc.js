// Handler di dominio: cattura schermo, salvataggio immagini su disco, box
// feedback (annotazione/invio) e fetch dei metadati Open Graph di un link.

const { safeFetch } = require('../safe-fetch');
const auth = require('../../auth/google-auth');
// L'identità da allegare a un invio che il server limita per identità: la
// chiede la coda dei percorsi condivisi, al momento in cui spedisce.
const identitaInvio = require('../../auth/identita-invio');
// Di SN_FEEDBACK_THREAD serve ownerize(), per marcare gli invii dell'owner. Idempotente se già caricato dal loader.
require('../../../shared/feedbackThread.js');

// Scarica i byte di un'immagine o di un media presentando il Referer della pagina e i cookie della session: in Electron 33 è l'unico modo di far arrivare il Referer a valle, perché i download via webContents.downloadURL lo perdono SEMPRE (verificato, sia con l'opzione { headers } sia riscrivendolo in onBeforeSendHeaders).
// Si usano http/https di Node invece di net.request perché la richiesta di un download partita dal main viene bloccata (ERR_BLOCKED_BY_CLIENT) dal webRequest della session: il salvataggio esplicito di un'immagine che l'utente già vede non deve passare per l'ad/tracker-blocking.
// #436 — i byte vanno DIRETTAMENTE su disco mentre arrivano: prima il file si accumulava in RAM, serviva un tetto oltre il quale il salvataggio si rifiutava, e anche sotto il tetto un filmato appesantiva tutta l'app. Segue i redirect (max 5) ricalcolando i cookie per l'host di destinazione.
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

// Una singola GET: risolve { redirect:true, location } su 3xx, oppure scrive il body nel file indicato da onHeaders() e risolve a scrittura conclusa.
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
    // Un Accept che dichiara solo immagini fa rispondere 406 ad alcuni server quando l'URL è un filmato: per i media si chiede il tipo giusto.
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

      // Il Content-Length è ciò che rende l'avanzamento una PERCENTUALE invece di un contatore di byte: manca sui trasferimenti chunked, e lì la barra resta indeterminata come per i download nativi.
      const expected = parseInt(res.headers['content-length'], 10);
      const total = Number.isFinite(expected) && expected > 0 ? expected : 0;
      const filename = filenameFromHeaders(res.headers, target);

      // Solo ORA si sanno nome e dimensione: il chiamante li usa per aprire la voce nella barra e per decidere dove far crescere il file parziale.
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
        // L'utente ha premuto "Annulla" nella barra: si chiude la connessione invece di continuare a consumare rete e disco.
        if (hooks.shouldStop && hooks.shouldStop()) {
          try { req.destroy(new Error('annullato')); } catch (_) {}
        }
      });

      const out = fs.createWriteStream(partPath);
      pipeline(res, out, (err) => {
        if (err) { finish(reject, err instanceof Error ? err : new Error('download interrotto')); return; }
        // Connessione chiusa prima della fine del body, o Content-Length dichiarato e non raggiunto: risposta troncata, quindi un errore e non un file valido.
        if (!res.complete || (total && received < total)) {
          finish(reject, new Error('download interrotto'));
          return;
        }
        if (!received) { finish(reject, new Error('file vuoto')); return; }
        finish(resolve, { partPath, filename, totalBytes: total || received, receivedBytes: received });
      });
    });
    req.on('error', (e) => finish(reject, e || new Error('richiesta fallita')));
    // Timeout di INATTIVITÀ, si riarma a ogni byte: un file da un'ora è legittimo, mezzo minuto di silenzio assoluto no.
    req.setTimeout(30000, () => { try { req.destroy(new Error('timeout')); } catch (_) {} });
  });
}

// Quasi sempre una rinomina istantanea (stesso volume); se l'utente ha scelto un altro disco si copia, comunque a blocchi e mai passando dalla memoria.
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

// Nome file dal Content-Disposition se c'è, altrimenti dal path dell'URL.
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

// Il nome che arriva dal server è dato ostile: separatori di percorso, caratteri di controllo e traversal vanno neutralizzati, o può uscire dalla cartella scelta.
function safeImageFilename(name) {
  let n = require('node:path').basename(String(name || ''));
  n = n.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  if (!n) n = 'immagine';
  return n.slice(0, 200);
}

module.exports = function register(on, ctx) {
  const { MSG, winOf, getEffectiveSettings, modelForAction, buildAttemptChain, broadcastToTabs } = ctx;
  const ACTIONS = globalThis.SN_CONST.ACTIONS;

  // Titolo breve del feedback, generato da un LLM economico al momento dell'invio. Best-effort: se la catena non è configurata o tarda si ripiega sulle prime parole del testo — l'invio non deve MAI fallire per colpa del titolo.
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

  // "Salva immagine come…" (#274): il vecchio cammino era un <a download> del content script, che Chromium onora SOLO per URL same-origin/blob:/data: — per un'immagine su un altro dominio la scheda ci navigava sopra senza scaricare niente.
  // I byte si scaricano qui nel main perché molti CDN con protezione hotlink rispondono 403 alle richieste senza Referer, e a un download di Electron il Referer non si può dare (vedi fetchToFile). Un fetch che si interrompe a metà diventa naturalmente un errore, e l'utente sceglie dove salvare col dialogo nativo.
  // Un solo cammino per immagini, video e audio: cambia solo `kind` (nome di ripiego e header Accept), registrato su DUE messaggi perché il chiamante dichiara cosa sta salvando (#400). Dal #436 il trasferimento si iscrive alla barra degli scaricamenti come un download qualsiasi.
  const handleDownload = async (msg, sender) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const kind = ['image', 'video', 'audio'].includes(msg.kind) ? msg.kind : 'image';
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    const path = require('node:path');
    const fs = require('node:fs');
    const { dialog, app, BrowserWindow } = require('electron');
    const downloads = require('../downloads');
    const ses = wc.session;
    const referrer = String(sender?.tab?.url || sender?.url || '');
    const fallbackName = kind === 'video' ? 'video' : (kind === 'audio' ? 'audio' : 'immagine');

    // In test si salva diretto (il dialogo nativo non è automatizzabile), altrimenti "Salva come…" pre-compilato con cartella Download e nome dedotto. Non rigetta MAI: l'esito è nel valore.
    const pickDestination = async (filename) => {
      const testDir = process.env.FILO_DOWNLOAD_DIR;
      if (testDir) {
        try { fs.mkdirSync(testDir, { recursive: true }); } catch (_) {}
        return { filePath: path.join(testDir, filename) };
      }
      try {
        const win = BrowserWindow.fromWebContents(wc) || winOf(sender) || null;
        const opts = { defaultPath: path.join(app.getPath('downloads'), filename) };
        const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
        // Annullato dall'utente: non è un errore, nessun toast.
        if (res.canceled || !res.filePath) return { cancelled: true };
        return { filePath: res.filePath };
      } catch (e) {
        return { error: e?.message || 'dialogo non disponibile' };
      }
    };

    let entry = null;        // voce nella barra scaricamenti
    let partPath = '';       // file che cresce mentre i byte arrivano
    let destPromise = null;  // scelta della destinazione (una volta sola)
    let askDest = null;      // come aprirla, quando serve
    let askTimer = null;
    // Il dialogo si apre alla prima delle due: trasferimento finito, oppure passato un attimo senza che finisca (è un file grosso). Così un salvataggio istantaneo si comporta come prima, mentre un filmato lungo non tiene ferma la connessione aspettando una risposta.
    const ASK_AFTER_MS = 1200;
    const ensureDest = () => {
      if (!destPromise && askDest) destPromise = askDest();
      return destPromise;
    };
    const dropPart = async () => {
      if (!partPath) return;
      try { await fs.promises.unlink(partPath); } catch (_) {}
    };

    let result = null;
    let downloadError = null;
    try {
      result = await fetchToFile({
        url,
        referrer,
        session: ses,
        kind,
        onHeaders: ({ filename, totalBytes }) => {
          // Nome file sicuro: prima il Content-Disposition del server, poi il path dell'URL.
          const name = safeImageFilename(filename || filenameFromUrl(url) || fallbackName);
          entry = downloads.beginManual({ url, filename: name, totalBytes });
          // Il nome da proporre lo sa solo il server (Content-Disposition): per questo la destinazione si chiede da qui in poi, mai prima.
          askDest = () => pickDestination(name).then((d) => {
            // Chi annulla il dialogo non vuole più il file: ferma anche i byte.
            if (d && (d.cancelled || d.error)) { try { entry.cancel(); } catch (_) {} }
            return d;
          });
          askTimer = setTimeout(ensureDest, ASK_AFTER_MS);
          // Il file parziale cresce nella cartella dove atterrerebbe un download nativo: se la destinazione è lì (quasi sempre) la consegna finale è una rinomina istantanea invece della copia di un filmato intero.
          partPath = downloads.uniquePath(downloads.downloadsDir(), `${name}.filo-part`);
          return partPath;
        },
        onProgress: (received, total) => { if (entry) entry.progress(received, total); },
        shouldStop: () => !!entry && entry.cancelled(),
      });
    } catch (e) {
      downloadError = e;
    }
    if (askTimer) { clearTimeout(askTimer); askTimer = null; }

    // Mai arrivati agli header (URL morto, 404, host irraggiungibile): nessuna voce aperta, nessun file da ripulire.
    if (!entry) return { ok: false, error: downloadError?.message || 'download fallito' };

    // Se il trasferimento è fallito NON si chiede dove salvare: sarebbe un dialogo per un file che non c'è. Se era già aperto lo si aspetta, perché da qui non si può richiudere.
    if (!downloadError && !entry.cancelled()) ensureDest();
    const dest = destPromise ? await destPromise : null;
    const cancelled = entry.cancelled() || !!(dest && dest.cancelled);

    if (cancelled) { await dropPart(); return { ok: false, cancelled: true }; }
    if (downloadError) { entry.fail(); await dropPart(); return { ok: false, error: downloadError.message || 'download fallito' }; }
    if (!dest || dest.error || !dest.filePath) {
      entry.fail(); await dropPart();
      return { ok: false, error: (dest && dest.error) || 'destinazione non disponibile' };
    }

    try {
      await moveInto(result.partPath, dest.filePath);
    } catch (e) {
      entry.fail(); await dropPart();
      return { ok: false, error: e?.message || 'scrittura fallita' };
    }
    entry.done(dest.filePath);
    return { ok: true, path: dest.filePath, filename: path.basename(dest.filePath) };
  };

  on(MSG.DOWNLOAD_IMAGE, handleDownload);
  on(MSG.DOWNLOAD_MEDIA, handleDownload);

  // "Salva file" su un link (#410.2): qui parte il download NATIVO della scheda, che services/downloads.js già intercetta e segue. Risultato IDENTICO al clic sul link — avanzamento in barra, cartella Download, toast finale, cronologia — così menu e clic producono lo stesso effetto visibile.
  // Niente gate "solo superfici interne": far partire uno scaricamento di un URL è esattamente ciò che il clic sul link fa già, e non espone cronologia né percorsi su disco.
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

  // SICUREZZA — confine d'origine (stesso pattern di handlers/storage.js e nav.js): questi handler stanno sul canale generico `filo:message`, raggiungibile ANCHE dai content script dei siti esterni. Senza gate, un sito qualsiasi potrebbe leggere l'intera cronologia degli scaricamenti (nomi, URL di provenienza e percorso ASSOLUTO su disco, che contiene lo username), far APRIRE al sistema operativo un file appena scaricato (su Windows equivale a farlo eseguire), o annullare un download e svuotare la cronologia.
  // Nessuna pagina web ha motivo di toccare gli scaricamenti: cronologia e comandi sono UI di Filo.
  const DL = () => require('../downloads');
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // La shell è `filo://shell/shell.html`, quindi isFilo la copre già; `sender.isShell` è la conferma strutturale per eventuali finestre interne senza URL filo://.
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
    // Si inoltra alla shell così l'ombra dell'annotazione copre TUTTO Filo, non solo l'area pagina dove vive il content script.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-dim', { on: !!msg.on }); } catch (_) {}
    return { ok: true };
  });

  on(MSG.FEEDBACK_CLEAR_DRAW, async (msg, sender) => {
    // "Cancella disegno" dal box cancella anche i tratti sulla barra in alto, che vivono nella shell.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-clear-draw'); } catch (_) {}
    return { ok: true };
  });

  on(MSG.CAPTURE_FEEDBACK_TOPBAR, async (msg, sender) => {
    // Scatto annotato della SOLA barra in alto: il box lo impila sopra lo screenshot della pagina per ottenere un'immagine di tutta l'app col disegno.
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

  // Coda d'invio del feedback (#341): "Invia" NON aspetta la rete — il box sparisce subito e il main consegna in background, ritentando finché la connessione torna. L'invio è idempotente lato server, quindi i ritentativi non creano duplicati, e la coda è persistita: un feedback accodato offline riparte al riavvio.
  const Outbox = globalThis.SN_FEEDBACK_OUTBOX;
  if (Outbox?.init) {
    Outbox.init({
      // Titolo breve generato al momento reale dell'invio (offline → fallback).
      prepare: (payload) => generateFeedbackName(payload?.text),
      // A invio riuscito, se qualche allegato non è stato caricato si avvisa l'utente con un toast: il feedback è comunque partito col resto.
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

  // Coda dei percorsi condivisi dell'Aiuto (#584): l'invio è ritardato apposta perché l'ora in cui Firestore riceve un percorso è pubblica e, se fosse quella della sessione, ricucirebbe i percorsi di una persona su domini diversi. Qui si riprende quello rimasto in coda alla chiusura.
  // L'identità si chiede AL MOMENTO DELL'INVIO, non quando il percorso viene raccolto: in mezzo passano ore e un token di allora sarebbe scaduto (vedi src/main/auth/identita-invio.js).
  try {
    globalThis.SN_PATHS_COLLECTOR?.init?.({
      ottieniIdToken: identitaInvio.ottieniIdToken,
    });
  } catch (_) {}

  on(MSG.SUBMIT_FEEDBACK, async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.submit) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      if (!Outbox?.enqueue) {
        throw new Error('SN_FEEDBACK_OUTBOX non caricato nel main process');
      }
      const payload = msg.payload || {};
      // Se l'utente è loggato come admin il suo invio si marca "owner:", così la dashboard lo distingue dai feedback dei tester esterni: l'identità owner è nota solo qui nel main, e il content script che genera il clientId non sa di esserlo.
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
      // Accoda e prova a inviare subito, ma NON aspetta la rete: l'ack torna appena il feedback è al sicuro in coda (persistito).
      const r = await Outbox.enqueue(payload);
      return { ok: true, queued: true, id: r?.id };
    } catch (e) {
      console.error('[Filo feedback] submit failed', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Recap delle versioni saltate dall'ultima vista dall'utente: si calcola qui, dove ci sono sia la versione dell'app sia le note. La home lo mostra come popup all'avvio.
  function appVersion() {
    try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
  }

  on(MSG.GET_UPDATE_RECAP, async () => {
    const PN = globalThis.SN_PATCH_NOTES;
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    const current = appVersion();
    if (!PN || !globalThis.SN_STORAGE) return { ok: true, current, lastSeen: current, notes: [] };
    const lastSeen = await globalThis.SN_STORAGE.getRaw(KEYS.LAST_SEEN_VERSION, null);
    // Primissimo avvio (nessuna versione vista): non si mostra nulla a sorpresa, ma si marca la versione corrente come vista, così il prossimo aggiornamento parte pulito.
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
      // safeFetch: solo http/https e blocco di loopback/IP privati, rivalidando ogni redirect — evita che una pagina usi questa fetch del main per sondare o leggere servizi locali e interni (SSRF).
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
