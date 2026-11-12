// Disegna sotto il campo di un sito l'email dell'account che il main gli manda (#1124). Non decide niente: la scelta
// e il tasto destro tornano al main, che riempie il campo e rifà i controlli.
(() => {
  'use strict';
  const api = window.propostaEmail;
  if (!api) return;
  const root = document.documentElement;
  const riquadro = document.getElementById('riquadro');
  const voce = document.getElementById('voce');
  const testo = document.getElementById('email');
  let giro = 0;
  let tema = 'system';

  try { document.getElementById('ico').innerHTML = window.SN_ICONS.user(16); } catch (_) {}

  function applicaTema(t) {
    tema = (t && typeof t.theme === 'string' && t.theme) || 'system';
    const scuro = tema === 'dark' || (tema !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.snTheme = scuro ? 'dark' : 'light';
    try { window.SN_THEME_TOKENS?.applyToDocument(document, (t && t.tokens) || {}); } catch (_) {}
  }
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applicaTema({ theme: tema }));
  } catch (_) {}

  // La larghezza che serve all'email intera e l'altezza del riquadro: la vista si fa grande così.
  function misura() {
    riquadro.style.width = 'max-content';
    const w = Math.ceil(riquadro.getBoundingClientRect().width);
    riquadro.style.width = '';
    const h = Math.ceil(riquadro.getBoundingClientRect().height);
    api.misura(giro, w, h);
  }

  api.onStato((s) => {
    if (!s || typeof s !== 'object') return;
    const n = Number(s.giro) || 0;
    if (n < giro) return;
    giro = n;
    applicaTema(s.tema);
    const email = typeof s.email === 'string' ? s.email : '';
    testo.textContent = email;
    voce.setAttribute('aria-label', email);
    voce.classList.toggle('attiva', s.evidenziata === true);
    voce.setAttribute('aria-selected', s.evidenziata === true ? 'true' : 'false');
    riquadro.hidden = !email;
    misura();
  });

  voce.addEventListener('click', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    api.scegli(giro);
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!e.isTrusted) return;
    api.menu(giro, e.clientX, e.clientY);
  });
})();
