// Bootstrap comune per le pagine dell'estensione (options/home/history).
// Imposta il tema su <html> prima del rendering, evita flash.

(function () {
  'use strict';

  function applyTheme(theme) {
    let resolved = theme;
    if (theme === 'system' || !theme) {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.snTheme = resolved;
  }

  // Tema iniziale "best effort" prima che le impostazioni siano caricate.
  applyTheme('system');

  // Aggiorna su preferenza sistema cambiata
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      const t = window.SN_PAGE_THEME || 'system';
      if (t === 'system') applyTheme(t);
    });
  }

  window.SN_PAGE_BOOTSTRAP = { applyTheme };
})();
