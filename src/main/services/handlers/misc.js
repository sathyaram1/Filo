// Handler di dominio: cattura schermo, box feedback (annotazione/invio) e
// fetch dei metadati Open Graph di un link.

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const I18n = globalThis.SN_I18N;

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
      const r = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
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

  // I18n è importato per simmetria con gli altri domini ma qui non serve
  // ancora: lasciato fuori dal ctx finché un handler non lo usa.
  void I18n;
};
