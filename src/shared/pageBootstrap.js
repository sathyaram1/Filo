// Bootstrap comune per le pagine interne di Filo (dashboard/options/history/…).
// Imposta tema e dimensione del testo su <html> prima del rendering per evitare
// flash. La dimensione testo è un moltiplicatore di zoom salvato nelle
// impostazioni (vedi pagina Preferenze).

(function () {
  'use strict';

  function applyTheme(theme) {
    let resolved = theme;
    if (theme === 'system' || !theme) {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.snTheme = resolved;
  }

  // Scala la UI di Filo. Usiamo `zoom` (Chromium) perché ridimensiona testo e
  // layout in modo uniforme indipendentemente dal fatto che i font siano in
  // px o rem. `scale` è un moltiplicatore (1 = 100%), clampato a un range sano.
  function applyTextScale(scale) {
    const n = Number(scale);
    const clamped = Number.isFinite(n) ? Math.min(2, Math.max(0.8, n)) : 1;
    document.documentElement.style.zoom = clamped === 1 ? '' : String(clamped);
    // Esponiamo il fattore di zoom come variabile CSS così le pagine che
    // riempiono la viewport (es. la home/newtab) possono compensare le altezze
    // basate su `vh`: senza, `zoom > 1` magnifica un layout `100vh` oltre la
    // viewport e fa comparire uno scrollbar che sposta gli elementi
    // (feedback alpha). Vedi `calc(100vh / var(--sn-zoom))` in dashboard.css.
    document.documentElement.style.setProperty('--sn-zoom', String(clamped));
  }

  // Tema/scala iniziali "best effort" prima che le impostazioni siano caricate.
  applyTheme('system');

  // Carica le impostazioni reali appena possibile (lo shim chrome.storage è già
  // disponibile via preload) e applica tema + dimensione testo.
  (async function loadAndApply() {
    try {
      const r = await chrome.storage.local.get('settings');
      const s = (r && r.settings) || {};
      if (s.theme) { window.SN_PAGE_THEME = s.theme; applyTheme(s.theme); }
      applyTextScale(s.textScale);
    } catch (_) {}
  })();

  // Aggiorna su preferenza sistema cambiata
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      const t = window.SN_PAGE_THEME || 'system';
      if (t === 'system') applyTheme(t);
    });
  }

  // Riapplica live se le impostazioni cambiano (es. salvataggio dalla pagina
  // Preferenze in un altro tab). Il canale affidabile cross-tab è il broadcast
  // `settings_updated` (vedi handlers.js → broadcastToTabs): `chrome.storage.
  // onChanged` NON viene propagato fra i WebContentsView, quindi da solo non
  // aggiornava le tab già aperte (feedback alpha: il cambio dimensione testo
  // non si applicava alle schede aperte).
  function applyFromSettings(s) {
    if (!s) return;
    if (s.theme) { window.SN_PAGE_THEME = s.theme; applyTheme(s.theme); }
    applyTextScale(s.textScale);
  }
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'settings_updated') applyFromSettings(msg.settings);
    });
  } catch (_) {}
  // Manteniamo anche il listener storage.onChanged per compatibilità con
  // eventuali futuri bridge che lo propaghino: oggi è un no-op innocuo.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      applyFromSettings(changes.settings.newValue || {});
    });
  } catch (_) {}

  window.SN_PAGE_BOOTSTRAP = { applyTheme, applyTextScale };
})();
