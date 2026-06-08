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

  // ── Lettura ad alta voce (text-to-speech) ────────────────────────────────
  function ttsSupported() {
    return typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Popola la select delle voci dalle voci del sistema. getVoices() può tornare
  // [] al primo giro e popolarsi più tardi (evento voiceschanged), quindi la
  // richiamiamo anche da lì. Mantiene la scelta corrente se ancora disponibile.
  function populateVoices(selected) {
    const sel = $('ttsVoice');
    if (!sel || !ttsSupported()) return;
    const want = selected !== undefined ? selected : sel.value;
    const voices = window.speechSynthesis.getVoices() || [];
    sel.innerHTML = '<option value="">Voce predefinita del sistema</option>';
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.voiceURI || v.name;
      o.textContent = `${v.name} (${v.lang})${v.default ? ' — predefinita' : ''}`;
      sel.appendChild(o);
    }
    if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
  }

  function previewTts() {
    if (!ttsSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance('Ciao, sono Filo. Questa è la voce scelta per la lettura ad alta voce.');
    u.rate = parseFloat($('ttsRate').value) || 1;
    u.pitch = parseFloat($('ttsPitch').value) || 1;
    const voiceId = $('ttsVoice').value;
    if (voiceId) {
      const v = (synth.getVoices() || []).find((vo) => vo.voiceURI === voiceId || vo.name === voiceId);
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    synth.speak(u);
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
    const tts = {
      voice: $('ttsVoice').value || '',
      rate: parseFloat($('ttsRate').value) || 1,
      pitch: parseFloat($('ttsPitch').value) || 1,
    };
    const idleHoursRaw = parseInt($('autoArchiveIdleHours').value, 10);
    const autoArchive = {
      enabled: $('autoArchiveEnabled').checked,
      onIdle: true,
      idleHours: Number.isFinite(idleHoursRaw) && idleHoursRaw > 0 ? Math.min(168, idleHoursRaw) : 6,
      onClose: $('autoArchiveOnClose').checked,
    };

    await chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { theme, textScale, showHomeMessage, agentStyle, terminal, tts, autoArchive },
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

    const tts = settings.tts || {};
    if (ttsSupported()) {
      const rate = Number(tts.rate) || 1;
      const pitch = Number(tts.pitch) || 1;
      $('ttsRate').value = String(rate);
      $('ttsRateVal').textContent = rate.toFixed(1) + '×';
      $('ttsPitch').value = String(pitch);
      $('ttsPitchVal').textContent = pitch.toFixed(1);
      populateVoices(tts.voice || '');
    } else {
      const u = $('ttsUnsupported');
      if (u) u.hidden = false;
      ['ttsVoice', 'ttsRate', 'ttsPitch', 'ttsPreview'].forEach((id) => {
        const el = $(id);
        if (el) el.disabled = true;
      });
    }

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
    $('terminalEnabled').addEventListener('change', persist);
    $('terminalShell').addEventListener('change', persist);

    // Lettura ad alta voce: la lista voci può popolarsi in ritardo.
    if (ttsSupported() && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => populateVoices());
    }
    $('ttsVoice').addEventListener('change', persist);
    $('ttsRate').addEventListener('input', () => {
      $('ttsRateVal').textContent = (parseFloat($('ttsRate').value) || 1).toFixed(1) + '×';
      persistDebounced();
    });
    $('ttsPitch').addEventListener('input', () => {
      $('ttsPitchVal').textContent = (parseFloat($('ttsPitch').value) || 1).toFixed(1);
      persistDebounced();
    });
    $('ttsPreview').addEventListener('click', previewTts);

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
