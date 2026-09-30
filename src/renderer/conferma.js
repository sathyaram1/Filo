// Disegna sopra la scheda la conferma chiesta da un sito (#592.6), col popup di sempre (SN_CONFIRM_UI).
// Non decide niente: la domanda arriva dal main, e ci tornano la risposta e i tasti per il campo della pagina.
(() => {
  'use strict';
  const api = window.conferma;
  const Ui = window.SN_CONFIRM_UI;
  if (!api || !Ui) return;
  const root = document.documentElement;
  let corrente = 0;
  let tema = 'system';

  function applicaTema(t) {
    tema = (t && typeof t.theme === 'string' && t.theme) || 'system';
    const scuro = tema === 'dark' || (tema !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.snTheme = scuro ? 'dark' : 'light';
    try { window.SN_THEME_TOKENS?.applyToDocument(document, (t && t.tokens) || {}); } catch (_) {}
  }
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applicaTema({ theme: tema }));
  } catch (_) {}

  api.onMostra((r) => {
    if (!r || !r.id) return;
    applicaTema(r.tema);
    // Un'altra domanda era a schermo: la sua scheda è andata dietro, e tornando la si richiede.
    corrente = 0;
    Ui.chiudi();
    const id = r.id;
    corrente = id;
    const opts = {};
    for (const k of ['title', 'text', 'okLabel', 'cancelLabel', 'word']) if (typeof r[k] === 'string') opts[k] = r[k];
    const ospite = { scriveva: r.scriveva === true, campo: r.campo === true, tasto: (t) => api.tasto(id, t) };
    const apri = r.tipo === 'typed' ? Ui.confirmTyped : r.tipo === 'notify' ? Ui.notify : Ui.confirm;
    apri(opts, ospite).then((ok) => {
      if (corrente !== id) return;
      corrente = 0;
      api.esito(id, ok === true);
    });
  });

  api.onVia(() => {
    corrente = 0;
    Ui.chiudi();
  });
})();
