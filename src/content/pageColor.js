// Colore della tab: campionatore del colore dominante della cima pagina
// (spec §1.1, "vetro smerigliato" della tab attiva) + colore identità del
// sito (spec §1.2, theme-color → manifest → favicon). Entrambi mandano il
// risultato al main via IPC; la shell tinge le tab di conseguenza.
// Estratto da content.js — viene caricato prima di lui dai preload.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;

  // ------------------------------------------------------------
  // Campionatore colore dominante della cima pagina (spec §1.1)
  // ------------------------------------------------------------
  function startTabColorSampler() {
    let lastSent;        // ultimo colore inviato (dedup)
    let scheduled = false;
    let lastTime = 0;

    function parseRGB(str) {
      const m = /rgba?\(([^)]+)\)/.exec(str || '');
      if (!m) return null;
      const p = m[1].split(',').map((s) => parseFloat(s.trim()));
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
      const a = p.length >= 4 ? p[3] : 1;
      if (a < 0.5) return null; // troppo trasparente per "contare" come sfondo
      return [p[0], p[1], p[2]];
    }
    // Risale dagli antenati finché trova uno sfondo opaco (max 6 salti).
    function bgOf(el) {
      let node = el; let hops = 0;
      while (node && node.nodeType === 1 && hops < 6) {
        const c = parseRGB(getComputedStyle(node).backgroundColor);
        if (c) return c;
        node = node.parentElement; hops++;
      }
      return null;
    }
    function compute() {
      const w = Math.max(1, window.innerWidth);
      const xs = [w * 0.2, w * 0.5, w * 0.8];
      const ys = [6, 16, 28];
      const acc = [0, 0, 0]; let n = 0;
      for (const y of ys) for (const x of xs) {
        let el = null;
        try { el = document.elementFromPoint(x, y); } catch (_) {}
        const c = el ? bgOf(el) : null;
        if (c) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
      }
      if (!n) {
        const c = parseRGB(getComputedStyle(document.body || document.documentElement).backgroundColor)
          || parseRGB(getComputedStyle(document.documentElement).backgroundColor);
        if (c) { acc[0] = c[0]; acc[1] = c[1]; acc[2] = c[2]; n = 1; }
      }
      if (!n) return null;
      return `rgb(${Math.round(acc[0] / n)}, ${Math.round(acc[1] / n)}, ${Math.round(acc[2] / n)})`;
    }
    function sample() {
      scheduled = false;
      lastTime = performance.now();
      let color = null;
      try { color = compute(); } catch (_) {}
      if (color === lastSent) return;
      lastSent = color;
      try { Promise.resolve(chrome.runtime.sendMessage({ type: MSG.TAB_DOMINANT_COLOR, color })).catch(() => {}); } catch (_) {}
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      const since = performance.now() - lastTime;
      const delay = Math.max(0, 100 - since); // almeno ~100ms fra due campionamenti
      if (delay > 0) setTimeout(() => requestAnimationFrame(sample), delay);
      else requestAnimationFrame(sample);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Primo campione subito + ritardati per le pagine che colorano dopo il paint.
    schedule();
    setTimeout(schedule, 400);
    setTimeout(schedule, 1200);
  }

  // ------------------------------------------------------------
  // Colore identità del sito (spec §1.2)
  // ------------------------------------------------------------
  // Si calcola UNA VOLTA per pagina (con qualche retry per i siti che settano
  // theme-color/favicon dopo il paint) e si manda al main, che lo cacha per
  // dominio. La shell lo applica attenuato alle tab inattive.
  function reportTabIdentityColor() {
    let lastSent;

    // Risolve qualsiasi stringa colore CSS (#hex, named, hsl…) in "rgb(r,g,b)".
    function toRGB(str) {
      if (!str) return null;
      try {
        const probe = document.createElement('span');
        probe.style.display = 'none';
        probe.style.color = '';
        probe.style.color = String(str).trim();
        if (!probe.style.color) return null; // valore non valido → ignora
        (document.body || document.documentElement).appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        const m = /rgba?\(([^)]+)\)/.exec(resolved || '');
        if (!m) return null;
        const p = m[1].split(',').map((s) => parseFloat(s.trim()));
        if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
        const a = p.length >= 4 ? p[3] : 1;
        if (a < 0.5) return null;
        return `rgb(${Math.round(p[0])}, ${Math.round(p[1])}, ${Math.round(p[2])})`;
      } catch (_) { return null; }
    }

    function fromThemeColor() {
      // Più <meta name="theme-color">: prendi quello senza media query (o il
      // primo che risolve), così rispettiamo la scelta di default del sito.
      const metas = document.querySelectorAll('meta[name="theme-color"]');
      for (const meta of metas) {
        if (meta.media && meta.media.trim()) continue;
        const c = toRGB(meta.getAttribute('content'));
        if (c) return c;
      }
      for (const meta of metas) {
        const c = toRGB(meta.getAttribute('content'));
        if (c) return c;
      }
      return null;
    }

    async function fromManifest() {
      try {
        const link = document.querySelector('link[rel="manifest"]');
        if (!link || !link.href) return null;
        const res = await fetch(link.href, { credentials: 'omit' });
        if (!res || !res.ok) return null;
        const j = await res.json();
        return toRGB(j && j.theme_color);
      } catch (_) { return null; }
    }

    function fromFavicon() {
      return new Promise((resolve) => {
        let href = '';
        try {
          const link = document.querySelector(
            'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
          );
          href = (link && link.href) || (location.origin + '/favicon.ico');
        } catch (_) { href = ''; }
        if (!href) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        img.onerror = () => finish(null);
        img.onload = () => {
          try {
            const W = 16, H = 16;
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0, W, H);
            const data = cx.getImageData(0, 0, W, H).data; // può lanciare se tainted
            const acc = [0, 0, 0]; let n = 0;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
              if (a < 128) continue;                 // trasparente
              const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              if (mx - mn < 24) continue;            // grigio/bianco/nero → niente identità
              acc[0] += r; acc[1] += g; acc[2] += b; n++;
            }
            if (!n) return finish(null);
            finish(`rgb(${Math.round(acc[0] / n)}, ${Math.round(acc[1] / n)}, ${Math.round(acc[2] / n)})`);
          } catch (_) { finish(null); }
        };
        img.src = href;
        // Failsafe: se l'immagine non carica entro 3s, rinuncia.
        setTimeout(() => finish(null), 3000);
      });
    }

    async function compute() {
      // theme-color e manifest sono comodi ma spesso valgono la "chrome" neutra
      // della pagina (YouTube dichiara theme-color BIANCO) — non l'identità del
      // sito. Li accettiamo solo se hanno croma sufficiente (stessa regola del
      // campionatore favicon); altrimenti si ripiega sul favicon, che è il vero
      // segnale di brand. Se SN_TAB_COLOR non è caricato, degrada al vecchio
      // comportamento (accetta comunque il theme-color).
      const TC = self.SN_TAB_COLOR;
      const ident = (c) => c && (!TC || TC.hasIdentity(c));

      const theme = fromThemeColor();
      if (ident(theme)) return theme;
      const mani = await fromManifest();
      if (ident(mani)) return mani;
      const fav = await fromFavicon();
      if (fav) return fav;
      // Niente di "colorato": meglio nessuna tinta che il bianco/grigio neutro
      // (che daremmo a YouTube). La tab resta neutra.
      return null;
    }

    async function send() {
      let color = null;
      try { color = await compute(); } catch (_) {}
      if (color === lastSent) return;
      lastSent = color;
      try {
        Promise.resolve(chrome.runtime.sendMessage({ type: MSG.TAB_IDENTITY_COLOR, color })).catch(() => {});
      } catch (_) {}
    }

    send();
    setTimeout(send, 800);
    setTimeout(send, 2000);
  }

  global.SN_PAGE_COLOR = { startTabColorSampler, reportTabIdentityColor };
})(typeof globalThis !== 'undefined' ? globalThis : self);
