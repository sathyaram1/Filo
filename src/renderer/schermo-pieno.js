// Disegna la pillola «<sito> è a schermo intero · Esc per uscire» che il main le manda (#1526). Non decide niente:
// i pezzi della frase arrivano già fatti e si scrivono come testo; uscita, menu e tempi li tiene il main.
(() => {
  'use strict';
  const api = window.schermoPieno;
  if (!api) return;
  // Il margine attorno alla pillola (l'ombra), lo stesso di top/left in schermo-pieno.css.
  const MARGINE = { x: 12, alto: 8, basso: 20 };
  const root = document.documentElement;
  const pillola = document.getElementById('pillola');
  let giro = 0;
  let tema = 'system';

  function applicaTema(t) {
    tema = (t && typeof t.theme === 'string' && t.theme) || 'system';
    const scuro = tema === 'dark' || (tema !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.snTheme = scuro ? 'dark' : 'light';
    try { window.SN_THEME_TOKENS?.applyToDocument(document, (t && t.tokens) || {}); } catch (_) {}
  }
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applicaTema({ theme: tema }); misura(); });
  } catch (_) {}

  // Misura sincrona a ogni disegno: la vista nasce nascosta e grande zero, e lì il ResizeObserver può non partire mai.
  function misura() {
    if (pillola.hidden) { api.misura(giro, 0, 0); return; }
    const r = pillola.getBoundingClientRect();
    api.misura(giro, Math.ceil(r.width) + 2 * MARGINE.x, Math.ceil(r.height) + MARGINE.alto + MARGINE.basso);
  }

  function disegna(parti) {
    pillola.replaceChildren();
    for (const p of parti) {
      const t = String((p && p.t) ?? '');
      if (!t) continue;
      let el;
      if (p.tasto) {
        el = document.createElement('kbd');
        el.textContent = t;
      } else if (p.sito) {
        el = document.createElement('span');
        el.className = 'sito';
        el.textContent = t;
      } else {
        el = document.createTextNode(t);
      }
      pillola.append(el);
    }
  }

  api.onStato((s) => {
    if (!s || typeof s !== 'object') return;
    const n = Number(s.giro) || 0;
    if (n < giro) return;
    giro = n;
    applicaTema(s.tema);
    // Durata delle animazioni e intensità delle ombre scelte dall'utente: solo numeri, solo variabili --sn-*.
    for (const [k, v] of Object.entries((s && s.vars) || {})) {
      if (/^--sn-[a-z-]+$/.test(k) && /^[0-9.]+$/.test(String(v))) root.style.setProperty(k, String(v));
    }
    root.style.setProperty('--max', `${Math.max(160, Math.round(Number(s.max) || 640))}px`);
    disegna(Array.isArray(s.parti) ? s.parti : []);
    pillola.hidden = false;
    // Ogni avviso rientra con la sua animazione, anche se la pillola di prima era ancora lì.
    pillola.style.animation = 'none';
    void pillola.offsetWidth;
    pillola.style.animation = '';
    misura();
  });

  pillola.addEventListener('mouseenter', () => api.sopra(giro, true));
  pillola.addEventListener('mouseleave', () => api.sopra(giro, false));
  pillola.addEventListener('click', () => api.clic(giro));

  const vuoto = window.SN_VUOTO.collega({
    inoltra: (gesto) => api.inoltra(gesto),
    onCursore: api.onCursore,
    proprio: (e) => pillola.contains(e.target),
    // La vista sta tutta dentro la pagina: uscendo di lì il puntatore entra nella pagina.
    versoLaPagina: () => true,
  });

  // Tasto destro sulla pillola: il menu di Filo; nel vuoto è della pagina (già rigirato).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!pillola.contains(e.target) || vuoto.gestoDellaPagina()) return;
    api.menu(giro, e.clientX, e.clientY);
  });
})();
