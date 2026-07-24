// Handler di dominio: cattura schermo, salvataggio immagini su disco, box
// feedback (annotazione/invio) e fetch dei metadati Open Graph di un link.

const { safeFetch } = require('../safe-fetch');
const auth = require('../../auth/google-auth');
// Registra SN_FEEDBACK_THREAD su globalThis (IIFE): ci serve ownerize() per
// marcare gli invii dell'owner. Idempotente se già caricato dal loader.
require('../../../shared/feedbackThread.js');

module.exports = function register(on, ctx) {
  const { MSG, winOf, getEffectiveSettings, buildAttemptChain } = ctx;

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
      const attempts = buildAttemptChain(settings, 'flash-lite');
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
  // senza scaricare nulla. Qui il salvataggio parte dal main con
  // webContents.downloadURL, che scarica sempre, a prescindere dall'origine.
  // Nessun handler will-download era registrato sulle session delle tab
  // normali: ne agganciamo uno usa-e-getta filtrato sul nostro URL, così i
  // download nati altrove (es. <a download> same-origin delle pagine) tengono
  // il comportamento di default.
  on(MSG.DOWNLOAD_IMAGE, (msg, sender) => {
    const url = String(msg.url || '').trim();
    if (!/^https?:/i.test(url)) return { ok: false, error: 'URL non scaricabile' };
    const wc = sender && sender.wc;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: 'no sender' };
    const path = require('node:path');
    const ses = wc.session;

    // Referer della pagina: molti CDN con protezione hotlink rifiutano (403) le
    // richieste "anonime" anche per immagini che nella pagina si vedono
    // benissimo. downloadURL({ headers }) NON basta: Chromium ignora un header
    // extra chiamato Referer (verificato: la richiesta arrivava sempre anonima).
    // L'unico punto dove il motore lo lascia impostare è onBeforeSendHeaders:
    // registriamo l'URL nel registro download-referrer, consultato dall'unico
    // listener per sessione (services/cookies.js), che copre anche i redirect e
    // gli eventuali resume.
    let releaseReferrer = () => {};
    const referrer = String(sender?.tab?.url || sender?.url || '');
    const dbgRef = /^https?:/i.test(referrer) ? referrer : '';

    return new Promise((resolve) => {
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        try { releaseReferrer(); } catch (_) {}
        resolve(r);
      };

      const onWillDownload = (_e, item) => {
        // Sulla stessa session possono partire altri download: agganciamo solo
        // il nostro (l'URL richiesto è il primo della catena redirect).
        let chain = [];
        try { chain = item.getURLChain() || []; } catch (_) {}
        if (item.getURL() !== url && chain[0] !== url) return;
        ses.removeListener('will-download', onWillDownload);
        clearTimeout(startTimer);

        // Nome file: lo decide Chromium (Content-Disposition → URL → mime),
        // molto più affidabile del parsing dell'URL lato pagina.
        const filename = item.getFilename() || 'immagine';
        const testDir = process.env.FILO_DOWNLOAD_DIR;
        if (testDir) {
          // Hook per i test/headless: salvataggio diretto senza dialogo.
          try { require('node:fs').mkdirSync(testDir, { recursive: true }); } catch (_) {}
          item.setSavePath(path.join(testDir, filename));
        } else {
          // Dialogo "Salva come…" (il default di Electron quando savePath non è
          // impostato), pre-compilato con la cartella Download e il nome dedotto
          // — stesso comportamento che il salvataggio same-origin aveva già.
          try {
            const { app } = require('electron');
            item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), filename) });
          } catch (_) {}
        }
        // Download troncato a metà (connessione chiusa dal server): se Chromium
        // lo considera riprendibile NON emette 'done' — l'item resta in stato
        // 'interrupted' per sempre e l'utente non riceverebbe MAI un riscontro
        // (né file né errore). Un tentativo di ripresa, poi annulliamo noi così
        // 'done' arriva e l'errore raggiunge l'utente.
        let resumeTried = false;
        let forcedError = null;
        item.on('updated', (_ev, state) => {
          if (state !== 'interrupted') return;
          if (!resumeTried && item.canResume()) {
            resumeTried = true;
            setTimeout(() => {
              try { if (item.canResume()) { item.resume(); return; } } catch (_) {}
              forcedError = 'interrupted';
              try { item.cancel(); } catch (_) { finish({ ok: false, error: 'interrupted' }); }
            }, 500);
          } else {
            forcedError = 'interrupted';
            try { item.cancel(); } catch (_) { finish({ ok: false, error: 'interrupted' }); }
          }
        });
        item.once('done', (_ev, state) => {
          if (state === 'completed') {
            const p = item.getSavePath() || '';
            finish({ ok: true, path: p, filename: p ? path.basename(p) : filename });
          } else {
            // 'cancelled' = l'utente ha chiuso il dialogo: non è un errore.
            // Se però l'abbiamo annullato NOI dopo un'interruzione irrecuperabile
            // (forcedError), per l'utente È un errore e il toast deve dirlo.
            const cancelledByUser = !forcedError && state === 'cancelled';
            finish({ ok: false, cancelled: cancelledByUser, error: forcedError || state });
          }
        });
      };
      ses.on('will-download', onWillDownload);

      // Se il download non parte affatto (URL irraggiungibile / bloccato) non
      // lasciamo né listener orfani né la risposta appesa. Il timer copre SOLO
      // l'avvio: una volta partito, l'attesa del dialogo/download è illimitata.
      const startTimer = setTimeout(() => {
        ses.removeListener('will-download', onWillDownload);
        finish({ ok: false, error: 'download non partito' });
      }, 30000);

      try {
        // Il Referer viaggia via onBeforeSendHeaders (registro download-referrer,
        // registrato sopra): l'opzione { headers } di downloadURL NON funziona
        // per quel header, Chromium la ignora.
        wc.downloadURL(url);
      } catch (e2) {
        ses.removeListener('will-download', onWillDownload);
        clearTimeout(startTimer);
        finish({ ok: false, error: e2?.message || String(e2) });
      }
    });
  });

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

  on(MSG.SUBMIT_FEEDBACK, async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.submit) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
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
      payload.name = await generateFeedbackName(payload.text);
      const submitP = globalThis.SN_FEEDBACK.submit(payload);
      // Timeout generoso (#370): un upload lento ma riuscito deve poter riportare
      // il VERO esito, invece di un falso errore che spinge l'utente a re-inviare.
      // Anche se scatta, il re-invio è ormai idempotente (submissionId → dedup
      // lato server), quindi non crea comunque duplicati.
      const timeoutP = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout (45s) — controlla la rete')), 45000));
      const r = await Promise.race([submitP, timeoutP]);
      console.log('[Filo feedback] submit ok', r);
      return { ok: true, ...r };
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
