// Handler di dominio: cattura schermo, salvataggio immagini su disco, box
// feedback (annotazione/invio) e fetch dei metadati Open Graph di un link.

const { safeFetch } = require('../safe-fetch');
const auth = require('../../auth/google-auth');
// L'identità da allegare a un invio che il server limita per identità: la
// chiede la coda dei percorsi condivisi, al momento in cui spedisce.
const identitaInvio = require('../../auth/identita-invio');
// Serve ownerize(), per marcare gli invii dell'owner. Idempotente se già caricato.
require('../../../shared/feedbackThread.js');

// Referer e cookie della session: i download di Electron perdono sempre il Referer e
// net.request viene bloccato dal webRequest. I byte vanno diretti su disco, mai in RAM.
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

// Una GET sola: su 3xx risolve { redirect, location }, altrimenti scrive il body nel file
// di onHeaders() e risolve a scrittura conclusa.
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
    // Un Accept di sole immagini fa rispondere 406 su un filmato: per i media si chiede il tipo
    // giusto.
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

      // Il Content-Length è ciò che rende l'avanzamento una percentuale: manca sui trasferimenti
      // chunked, e lì la barra resta indeterminata come nei download nativi.
      const expected = parseInt(res.headers['content-length'], 10);
      const total = Number.isFinite(expected) && expected > 0 ? expected : 0;
      const filename = filenameFromHeaders(res.headers, target);

      // Nome e dimensione si sanno solo ora: servono ad aprire la voce nella barra e a scegliere
      // dove far crescere il file parziale.
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
        // Annullato dalla barra: si chiude la connessione invece di consumare rete e disco.
        if (hooks.shouldStop && hooks.shouldStop()) {
          try { req.destroy(new Error('annullato')); } catch (_) {}
        }
      });

      const out = fs.createWriteStream(partPath);
      pipeline(res, out, (err) => {
        if (err) { finish(reject, err instanceof Error ? err : new Error('download interrotto')); return; }
        // Body interrotto o Content-Length non raggiunto: risposta troncata, quindi un errore e non
        // un file valido.
        if (!res.complete || (total && received < total)) {
          finish(reject, new Error('download interrotto'));
          return;
        }
        if (!received) { finish(reject, new Error('file vuoto')); return; }
        finish(resolve, { partPath, filename, totalBytes: total || received, receivedBytes: received });
      });
    });
    req.on('error', (e) => finish(reject, e || new Error('richiesta fallita')));
    // Timeout di INATTIVITÀ: un file da un'ora è legittimo, mezzo minuto di silenzio no.
    req.setTimeout(30000, () => { try { req.destroy(new Error('timeout')); } catch (_) {} });
  });
}

// Stesso volume: rinomina istantanea. Altro disco: copia a blocchi, mai passando dalla
// memoria.
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

// Il nome dal server è dato ostile: separatori, caratteri di controllo e traversal vanno
// neutralizzati, o il file esce dalla cartella scelta.
function safeImageFilename(name) {
  let n = require('node:path').basename(String(name || ''));
  n = n.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  if (!n) n = 'immagine';
  return n.slice(0, 200);
}

module.exports = function register(on, ctx) {
  const { MSG, winOf, getEffectiveSettings, modelForAction, buildAttemptChain, broadcastToTabs } = ctx;
  const ACTIONS = globalThis.SN_CONST.ACTIONS;

  // Titolo generato da un LLM economico: best-effort, si ripiega sulle prime parole del testo
  // — l'invio non deve MAI fallire per colpa del titolo.
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

  // I byte si scaricano nel main: un <a download> vale solo same-origin, e molti CDN con
  // protezione hotlink rifiutano senza Referer, che a un download di Electron non si può dare.
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

    // In test si salva diretto: il dialogo nativo non è automatizzabile. Non rigetta MAI,
    // l'esito sta nel valore.
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
    // Il dialogo si apre alla prima delle due: trasferimento finito, o passato un attimo senza
    // che finisca. Così un file grosso non tiene ferma la connessione aspettando una risposta.
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
          const name = safeImageFilename(filename || filenameFromUrl(url) || fallbackName);
          entry = downloads.beginManual({ url, filename: name, totalBytes });
          // Il nome lo sa solo il server: la destinazione si chiede da qui in poi, mai prima.
          askDest = () => pickDestination(name).then((d) => {
            // Chi annulla il dialogo non vuole più il file: ferma anche i byte.
            if (d && (d.cancelled || d.error)) { try { entry.cancel(); } catch (_) {} }
            return d;
          });
          askTimer = setTimeout(ensureDest, ASK_AFTER_MS);
          // Il file parziale cresce dove atterrerebbe un download nativo: se la destinazione è lì,
          // la consegna è una rinomina e non la copia di un filmato intero.
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

    // Mai arrivati agli header: nessuna voce aperta, nessun file da ripulire.
    if (!entry) return { ok: false, error: downloadError?.message || 'download fallito' };

    // A trasferimento fallito non si chiede dove salvare: sarebbe un dialogo per un file che non
    // c'è. Se era già aperto lo si aspetta, perché da qui non si può richiudere.
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

  // Parte il download NATIVO della scheda: risultato identico al clic sul link, così menu e
  // clic fanno la stessa cosa. Niente gate d'origine: non espone cronologia né percorsi.
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

  // Senza gate un sito leggerebbe la cronologia degli scaricamenti (URL e percorsi con lo
  // username) o farebbe aprire un file scaricato. Confine: vedi handlers/origine.js.
  const DL = () => require('../downloads');
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // `sender.isShell` copre le finestre interne senza URL filo://, fuori da isFilo.
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
    // Alla shell, così l'ombra dell'annotazione copre tutto Filo e non la sola area pagina.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-dim', { on: !!msg.on }); } catch (_) {}
    return { ok: true };
  });

  on(MSG.FEEDBACK_CLEAR_DRAW, async (msg, sender) => {
    // I tratti sulla barra vivono nella shell: «Cancella disegno» deve togliere anche quelli.
    const win = winOf(sender);
    try { win?.webContents?.send('shell:feedback-clear-draw'); } catch (_) {}
    return { ok: true };
  });

  on(MSG.CAPTURE_FEEDBACK_TOPBAR, async (msg, sender) => {
    // Scatto della sola barra: il box lo impila sopra quello della pagina per avere tutta l'app
    // col disegno.
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

  // «Invia» non aspetta la rete: il main consegna in background e ritenta. È idempotente lato
  // server e la coda è persistita: niente duplicati, e riparte al riavvio.
  const Outbox = globalThis.SN_FEEDBACK_OUTBOX;
  if (Outbox?.init) {
    Outbox.init({
      // Titolo breve generato al momento reale dell'invio (offline → fallback).
      prepare: (payload) => generateFeedbackName(payload?.text),
      // Allegato non caricato: si avvisa con un toast, il feedback è comunque partito col resto.
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

  // L'invio è ritardato apposta: l'ora in cui Firestore riceve un percorso è pubblica e, se
  // fosse quella della sessione, ricucirebbe i percorsi di una persona su domini diversi.
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
      // L'invio dell'owner si marca «owner:» per distinguerlo dai tester: l'identità owner è nota
      // solo qui nel main, il content script che genera il clientId non sa di esserlo.
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
      // Non aspetta la rete: l'ack torna appena il feedback è al sicuro in coda, sul disco.
      const r = await Outbox.enqueue(payload);
      return { ok: true, queued: true, id: r?.id };
    } catch (e) {
      console.error('[Filo feedback] submit failed', e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Recap delle versioni saltate: si calcola qui, dove ci sono sia la versione dell'app sia le
  // note.
  function appVersion() {
    try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
  }

  on(MSG.GET_UPDATE_RECAP, async () => {
    const PN = globalThis.SN_PATCH_NOTES;
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    const current = appVersion();
    if (!PN || !globalThis.SN_STORAGE) return { ok: true, current, lastSeen: current, notes: [] };
    const lastSeen = await globalThis.SN_STORAGE.getRaw(KEYS.LAST_SEEN_VERSION, null);
    // Primo avvio: niente recap a sorpresa, ma la versione corrente si marca come vista, così il
    // prossimo aggiornamento parte pulito.
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
      // safeFetch: solo http/https e blocco degli indirizzi privati, a ogni redirect — una pagina
      // non deve poter sondare i servizi locali attraverso il main (SSRF).
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
