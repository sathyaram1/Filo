// Handler di dominio: cattura schermo, box feedback (annotazione/invio) e
// fetch dei metadati Open Graph di un link.

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
      console.log('[Filo feedback] submit start', {
        textLen: (payload.text || '').length,
        images: (payload.images || []).length,
        url: payload.url,
      });
      payload.name = await generateFeedbackName(payload.text);
      const submitP = globalThis.SN_FEEDBACK.submit(payload);
      const timeoutP = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout (20s) — controlla la rete')), 20000));
      const r = await Promise.race([submitP, timeoutP]);
      console.log('[Filo feedback] submit ok', r);
      return { ok: true, ...r };
    } catch (e) {
      console.error('[Filo feedback] submit failed', e);
      return { ok: false, error: e?.message || String(e) };
    }
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
