// Logica pagina Preferenze: tema, dimensione del testo, commento home e stile
// dell'agente. Niente pulsante "Salva": ogni modifica viene applicata e
// persistita subito (con un breve "Salvato" come conferma).

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const { AGENT_STYLE_PRESETS } = window.SN_CONST;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;

  const CUSTOM_KEY = '__custom__';

  function $(id) { return document.getElementById(id); }

  let saveTimer = null;

  function flashSaved() {
    const hint = $('savedHint');
    hint.classList.add('sn-show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => hint.classList.remove('sn-show'), 1200);
  }

  // Restituisce lo stile testuale corrente dal textarea.
  function currentStyleText() {
    return $('agentStyleText').value;
  }

  // Allinea la select dei preset al testo corrente: se combacia con un preset
  // noto seleziona quello, altrimenti "Personalizzato".
  function syncPresetSelect() {
    const text = currentStyleText().trim();
    const match = AGENT_STYLE_PRESETS.find((p) => p.text.trim() === text);
    $('agentStylePreset').value = match ? match.key : CUSTOM_KEY;
  }

  async function persist() {
    const theme = $('theme').value;
    const textScale = parseFloat($('textScale').value) || 1;
    const showHomeMessage = $('showHomeMessage').checked;
    const agentStyle = currentStyleText().trim();
    const terminal = {
      enabled: $('terminalEnabled').checked,
      shell: $('terminalShell').value,
    };

    await chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { theme, textScale, showHomeMessage, agentStyle, terminal },
    });

    window.SN_PAGE_THEME = theme;
    Bootstrap.applyTheme(theme);
    Bootstrap.applyTextScale(textScale);
    flashSaved();
  }

  function persistDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  function buildPresetOptions() {
    const sel = $('agentStylePreset');
    sel.innerHTML = '';
    for (const p of AGENT_STYLE_PRESETS) {
      const o = document.createElement('option');
      o.value = p.key;
      o.textContent = p.label;
      sel.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = CUSTOM_KEY;
    custom.textContent = 'Personalizzato';
    sel.appendChild(custom);
  }

  async function load() {
    const settings = await Storage.getSettings();
    $('theme').value = settings.theme || 'system';
    const scale = String(settings.textScale ?? 1);
    const opt = [...$('textScale').options].find((o) => o.value === scale);
    $('textScale').value = opt ? scale : '1';
    $('showHomeMessage').checked = settings.showHomeMessage !== false;

    buildPresetOptions();
    $('agentStyleText').value = settings.agentStyle || '';
    syncPresetSelect();

    const terminal = settings.terminal || {};
    $('terminalEnabled').checked = terminal.enabled === true;
    const shell = terminal.shell || 'powershell';
    const shellOpt = [...$('terminalShell').options].find((o) => o.value === shell);
    $('terminalShell').value = shellOpt ? shell : 'powershell';

    Bootstrap.applyTheme(settings.theme);
    Bootstrap.applyTextScale(settings.textScale);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();

    // Tema e dimensione testo: anteprima immediata + salvataggio.
    $('theme').addEventListener('change', () => { Bootstrap.applyTheme($('theme').value); persist(); });
    $('textScale').addEventListener('change', () => {
      Bootstrap.applyTextScale(parseFloat($('textScale').value) || 1);
      persist();
    });
    $('showHomeMessage').addEventListener('change', persist);

    // Stile agente: scegliere un preset riempie il textarea; scrivere a mano
    // riallinea la select su "Personalizzato".
    $('agentStylePreset').addEventListener('change', () => {
      const key = $('agentStylePreset').value;
      if (key !== CUSTOM_KEY) {
        const preset = AGENT_STYLE_PRESETS.find((p) => p.key === key);
        $('agentStyleText').value = preset ? preset.text : '';
      } else {
        $('agentStyleText').focus();
      }
      persist();
    });
    $('agentStyleText').addEventListener('input', () => { syncPresetSelect(); persistDebounced(); });
  });
})();
