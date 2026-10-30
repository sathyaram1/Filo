// Colore della tab: campiona il colore della cima pagina (§1.1) e il colore identità del
// sito (§1.2: theme-color → manifest → favicon), e li manda al main.
// A tingere le tab è la shell. Caricato prima di content.js.

(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;

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
      const campioni = [];
      for (const y of ys) for (const x of xs) {
        let el = null;
        try { el = document.elementFromPoint(x, y); } catch (_) {}
        const c = el ? bgOf(el) : null;
        if (c) campioni.push(c);
      }
      // Il colore che prevale, non la media: una cima in due colori darebbe un grigio che sulla pagina non c'è (#429).
      // Senza un gruppo che faccia maggioranza (sfumature, foto) la media resta la stima migliore.
      const vicini = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 24;
      let meglio = [];
      for (const c of campioni) {
        const gruppo = campioni.filter((d) => vicini(c, d));
        if (gruppo.length > meglio.length) meglio = gruppo;
      }
      const scelti = meglio.length * 2 > campioni.length ? meglio : campioni;
      const acc = [0, 0, 0]; let n = 0;
      for (const c of scelti) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
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
    // La cima cambia colore anche senza scorrere: il tema del sito acceso dal suo interruttore, un'intestazione
    // che arriva tardi, il tema di sistema. Senza, la scheda restava del colore vecchio fino alla rotella (#429).
    // Una pagina che muta di continuo non deve costare più di quattro campioni al secondo.
    let quieto = null;
    const dopoUnCambio = () => { if (!quieto) quieto = setTimeout(() => { quieto = null; schedule(); }, 250); };
    try {
      new MutationObserver(dopoUnCambio).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'theme', 'dark'],
        childList: true, subtree: true,
      });
    } catch (_) {}
    document.addEventListener('transitionend', dopoUnCambio, { capture: true, passive: true });
    document.addEventListener('animationend', dopoUnCambio, { capture: true, passive: true });
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', dopoUnCambio); } catch (_) {}
    // Lo stile può cambiare senza nessun evento (una regola aggiunta al foglio, un foglio sostituito): un campione
    // al secondo a pagina visibile chiude tutte quelle porte insieme; senza cambio di colore non parte niente.
    setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, 1000);
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
  // dominio. La shell lo mescola col fondo della barra nelle tab inattive.
  // getParams (opzionale): funzione che ritorna i parametri di estrazione
  // correnti (settings.tabColor). Vengono passati a extractIdentityFromPixels,
  // così cambiarli (a voce o nelle Preferenze) cambia il colore estratto. Se
  // assente, l'estrazione usa i default di SN_TAB_COLOR.
  // Un favicon si scarica una volta per pagina: ritentativi e cambi di impostazioni ridisegnano la copia (#1795). Un errore
  // di rete o i 3 s scaduti non restano, così il calcolo dopo riprova; la richiesta rimasta appesa si chiude.
  const iconeScaricate = new Map();
  function scaricaIcona(href) {
    if (iconeScaricate.has(href)) return iconeScaricate.get(href);
    const ctrl = new AbortController();
    const scade = setTimeout(() => ctrl.abort(), 3000);
    const copia = fetch(href, { signal: ctrl.signal })
      .then((res) => (res && res.ok ? res.blob() : null))
      .catch(() => { iconeScaricate.delete(href); return null; })
      .finally(() => clearTimeout(scade));
    iconeScaricate.set(href, copia);
    return copia;
  }

  function reportTabIdentityColor(getParams) {
    let lastSent;
    const params = () => {
      try { return (typeof getParams === 'function' && getParams()) || null; } catch (_) { return null; }
    };

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

    // Il favicon si scarica con fetch e si disegna dalla copia in memoria: un'immagine chiesta alla rete tratterrebbe il
    // «load» della pagina finché il sito non la manda, e un favicon che non arriva la lasciava in caricamento (#1456).
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
        let done = false;
        let copia = '';
        const finish = (v) => {
          if (done) return;
          done = true;
          if (copia) { try { URL.revokeObjectURL(copia); } catch (_) {} }
          resolve(v);
        };
        setTimeout(() => finish(null), 3000);
        const img = new Image();
        img.onerror = () => finish(null);
        img.onload = () => {
          try {
            // L'estrazione vera sta in SN_TAB_COLOR (pura, unit-testata): qui si scala il favicon a
            // 64×64 e si delega, ripiegando sulla media se non è caricata.
            const W = 64, H = 64;
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0, W, H);
            const data = cx.getImageData(0, 0, W, H).data;
            const TC = self.SN_TAB_COLOR;
            if (TC && TC.extractIdentityFromPixels) {
              return finish(TC.extractIdentityFromPixels(data, W, H, params()));
            }
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
        scaricaIcona(href).then((blob) => {
          if (done || !blob) return finish(null);
          copia = URL.createObjectURL(blob);
          img.src = copia;
        });
      });
    }

    async function compute() {
      // Il favicon è la fonte primaria: quasi sempre porta il colore del marchio. theme-color
      // e manifest restano un fallback per i favicon illeggibili; senza identità, tab neutra.
      const TC = self.SN_TAB_COLOR;
      const ident = (c) => c && (!TC || TC.hasIdentity(c));

      const fav = await fromFavicon();
      if (fav) return fav;
      const theme = fromThemeColor();
      if (ident(theme)) return theme;
      const mani = await fromManifest();
      if (ident(mani)) return mani;
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

    // Si parte a testa della pagina letta (c'è il corpo), dove stanno icona e theme-color: non al «load», che su un sito
    // lento arriva dopo secondi (#1456.2), e non prima, quando un sito già visto rischia di perdere il colore ricordato.
    // Si guarda il parser e non un timer, che in una scheda dietro rallenta. I ritentativi servono ai siti che li mettono dopo.
    identitaPartita = true;
    const parti = () => { send(); setTimeout(send, 800); setTimeout(send, 2000); };
    const testaLetta = () => !!document.body || document.readyState !== 'loading';
    if (testaLetta()) { parti(); return; }
    let partito = false;
    let spia = null;
    const prova = () => {
      if (partito || !testaLetta()) return;
      partito = true;
      try { spia && spia.disconnect(); } catch (_) {}
      document.removeEventListener('readystatechange', prova);
      parti();
    };
    try { spia = new MutationObserver(prova); spia.observe(document, { childList: true, subtree: true }); } catch (_) {}
    document.addEventListener('readystatechange', prova);
  }
  let identitaPartita = false;

  global.SN_PAGE_COLOR = { startTabColorSampler, reportTabIdentityColor, identitaPartita: () => identitaPartita };
})(typeof globalThis !== 'undefined' ? globalThis : self);
