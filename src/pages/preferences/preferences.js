// Logica pagina Preferenze: tema + dimensione del testo della UI di Filo.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;

  function $(id) { return document.getElementById(id); }

  async function load() {
    const settings = await Storage.getSettings();
    $('theme').value = settings.theme || 'system';
    // Allinea la select al valore salvato (default 1 se assente/ignoto).
    const scale = String(settings.textScale ?? 1);
    const opt = [...$('textScale').options].find((o) => o.value === scale);
    $('textScale').value = opt ? scale : '1';

    $('showHomeMessage').checked = settings.showHomeMessage !== false;

    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
  }

  async function save() {
    const theme = $('theme').value;
    const textScale = parseFloat($('textScale').value) || 1;
    const showHomeMessage = $('showHomeMessage').checked;
    await chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { theme, textScale, showHomeMessage },
    });

    window.SN_PAGE_THEME = theme;
    Bootstrap.applyTheme(theme);
    Bootstrap.applyTextScale(textScale);

    const hint = $('savedHint');
    hint.classList.add('sn-show');
    setTimeout(() => hint.classList.remove('sn-show'), 1500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('save').addEventListener('click', save);
    // Anteprima immediata della dimensione testo mentre si sceglie.
    $('textScale').addEventListener('change', () => {
      Bootstrap.applyTextScale(parseFloat($('textScale').value) || 1);
    });
    $('theme').addEventListener('change', () => Bootstrap.applyTheme($('theme').value));
  });
})();
