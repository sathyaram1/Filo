// Logica pagina Preferenze: tema, dimensione del testo, commento home e stile
// dell'agente. Niente pulsante "Salva": ogni modifica viene applicata e
// persistita subito (con un breve "Salvato" come conferma).

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const { AGENT_STYLE_PRESETS } = window.SN_CONST;
  const Storage = window.SN_STORAGE;
  const Bootstrap = window.SN_PAGE_BOOTSTRAP;
  const Tokens = window.SN_THEME_TOKENS;

  const CUSTOM_KEY = '__custom__';

  function $(id) { return document.getElementById(id); }

  let saveTimer = null;

  // Indicatore "Salvato": può lampeggiare su più ancore (quella globale a fondo
  // pagina e quella locale della sezione token), così la conferma è visibile
  // vicino al controllo toccato.
  const _savedTimers = {};
  function flashSaved(id = 'savedHint') {
    const hint = $(id);
    if (!hint) return;
    hint.classList.add('sn-show');
    clearTimeout(_savedTimers[id]);
    _savedTimers[id] = setTimeout(() => hint.classList.remove('sn-show'), 1200);
  }

  // ── Sezione "token estetici" (#146.3) ────────────────────────────────────
  // Mostra TUTTI i token del registro (themeTokens.js) coi valori predefiniti,
  // in forma di config testuale "a codice". Modificare un valore applica
  // l'override live e lo persiste; i valori personalizzati sono evidenziati e
  // hanno un ↺ per tornare al predefinito; in fondo un reset globale. Un valore
  // non valido viene rifiutato con un errore puntuale, senza toccare gli altri.
  //
  // Modello: gli override vivono in una mappa piatta { token: valore }
  // (settings.themeTokens, REPLACE in storage). Un token è "personalizzato"
  // SOLO se ha un override diretto valido; i token che ereditano da una
  // categoria sovrascritta mostrano il valore ereditato (effectiveValue) ma non
  // risultano personalizzati finché non li si tocca direttamente.

  let currentOverrides = {};
  let tokensSaveTimer = null;

  // Tema risolto (light/dark) com'è applicato ora su <html>: i default di alcuni
  // token differiscono fra chiaro e scuro.
  function resolvedTheme() {
    return document.documentElement.dataset.snTheme === 'dark' ? 'dark' : 'light';
  }

  function isColorToken(name) {
    const t = Tokens && Tokens.get(name);
    return !!t && t.type === 'color';
  }

  // Messaggio d'errore puntuale per tipo di token.
  function tokenErrorMsg(name) {
    const t = Tokens && Tokens.get(name);
    switch (t && t.type) {
      case 'color': return 'Colore non valido: usa #rrggbb (o #rgb) oppure rgb(…)/rgba(…).';
      case 'size': return 'Misura non valida: usa un numero con unità, es. 6px, 0.5rem, 50%.';
      case 'opacity': return 'Opacità non valida: un numero fra 0 e 1, es. 0.3.';
      case 'font': return 'Font non valido: solo nomi di famiglie separati da virgola.';
      default: return 'Valore non valido.';
    }
  }

  // (Ri)disegna una singola riga dal modello: valore effettivo, stato
  // "personalizzato", anteprima colore. Cancella eventuali errori.
  function renderTokenRow(name) {
    const input = $(`tok-${name}`);
    if (!input || !Tokens) return;
    const row = input.closest('.sn-token-row');
    const eff = Tokens.effectiveValue(name, currentOverrides, resolvedTheme()) || '';
    input.value = eff;
    input.dataset.orig = eff;
    const modified = Tokens.validate(name, currentOverrides[name]);
    row.classList.toggle('sn-token-modified', !!modified);
    row.classList.remove('sn-token-invalid');
    if (isColorToken(name)) {
      const sw = row.querySelector('.sn-token-swatch');
      if (sw) sw.style.background = eff;
    }
    const err = row.querySelector('.sn-token-error');
    if (err) { err.hidden = true; err.textContent = ''; }
  }

  function buildTokenSection() {
    const box = $('tokenCode');
    if (!box || !Tokens) return;
    box.textContent = '';
    for (const name of Tokens.names()) {
      const t = Tokens.get(name);
      const row = document.createElement('div');
      row.className = 'sn-token-row';
      row.dataset.token = name;

      const swatch = document.createElement('span');
      swatch.className = 'sn-token-swatch';
      if (t.type !== 'color') swatch.style.visibility = 'hidden';
      row.appendChild(swatch);

      const label = document.createElement('label');
      label.className = 'sn-token-name';
      label.setAttribute('for', `tok-${name}`);
      label.title = t.label || name;
      label.textContent = `${name}:`;
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sn-token-input';
      input.id = `tok-${name}`;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', t.label || name);
      input.addEventListener('input', () => onTokenInput(name));
      input.addEventListener('blur', () => {
        const v = input.value.trim();
        if (v !== '' && !Tokens.validate(name, v)) {
          // Lasciato un valore non valido: errore puntuale, gli altri token
          // restano intatti. Teniamo il testo così l'utente può correggerlo.
          const errEl = row.querySelector('.sn-token-error');
          errEl.hidden = false;
          errEl.textContent = tokenErrorMsg(name);
          row.classList.add('sn-token-invalid');
          return;
        }
        renderTokenRow(name); // canonicalizza al valore effettivo
      });
      row.appendChild(input);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'sn-token-reset';
      reset.textContent = '↺';
      reset.title = 'Ripristina il predefinito';
      reset.setAttribute('aria-label', `Ripristina ${name}`);
      reset.addEventListener('click', () => resetToken(name));
      row.appendChild(reset);

      const err = document.createElement('span');
      err.className = 'sn-token-error';
      err.hidden = true;
      err.setAttribute('role', 'alert');
      row.appendChild(err);

      box.appendChild(row);
      renderTokenRow(name);
    }
  }

  function applyTokensLive() {
    Bootstrap.applyThemeTokens(currentOverrides);
  }

  function persistTokens() {
    chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { themeTokens: currentOverrides },
    });
    flashSaved('tokenSavedHint');
  }

  function persistTokensDebounced() {
    clearTimeout(tokensSaveTimer);
    tokensSaveTimer = setTimeout(persistTokens, 400);
  }

  // Ridisegna tutte le righe TRANNE quella in `exceptName` (che l'utente sta
  // editando): serve quando si cambia un token-categoria, così i token che ne
  // ereditano (es. link.color da accent) mostrano subito il valore ereditato.
  function renderOtherTokenRows(exceptName) {
    if (!Tokens) return;
    for (const name of Tokens.names()) if (name !== exceptName) renderTokenRow(name);
  }

  function onTokenInput(name) {
    const input = $(`tok-${name}`);
    const row = input.closest('.sn-token-row');
    const err = row.querySelector('.sn-token-error');
    const v = input.value.trim();

    // Mentre si digita NON mostriamo l'errore (eviterebbe di lampeggiare "non
    // valido" a ogni carattere di un colore scritto a mano): l'errore puntuale
    // compare al blur. Finché il valore non è valido, non applichiamo nulla.
    err.hidden = true;
    err.textContent = '';
    row.classList.remove('sn-token-invalid');
    if (v !== '' && !Tokens.validate(name, v)) return;

    if (v === '' || v === Tokens.defaultValue(name, resolvedTheme())) {
      // Vuoto o uguale al predefinito del tema corrente: nessun override.
      delete currentOverrides[name];
    } else {
      currentOverrides[name] = v;
    }
    row.classList.toggle('sn-token-modified', !!Tokens.validate(name, currentOverrides[name]));
    if (isColorToken(name)) {
      const sw = row.querySelector('.sn-token-swatch');
      if (sw) sw.style.background = Tokens.effectiveValue(name, currentOverrides, resolvedTheme()) || '';
    }
    renderOtherTokenRows(name);
    applyTokensLive();
    persistTokensDebounced();
  }

  function resetToken(name) {
    delete currentOverrides[name];
    renderTokenRow(name);
    renderOtherTokenRows(name); // se era una categoria, aggiorna chi ereditava
    applyTokensLive();
    persistTokens();
  }

  function resetAllTokens() {
    currentOverrides = {};
    if (Tokens) for (const name of Tokens.names()) renderTokenRow(name);
    applyTokensLive();
    persistTokens();
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

  // ── Suoneria timer (anteprima tramite WebAudio API) ─────────────────────
  // Stesso catalogo della dashboard (RINGTONES): riproduce una sequenza di
  // beep senza file audio. Usato dal pulsante "Prova" in questa pagina.
  let _previewCtx = null;
  const RINGTONE_NOTES = {
    default: [[880, 150], [0, 80], [880, 150], [0, 80], [880, 150], [0, 400]],
    gentle:  [[523, 200], [0, 100], [659, 200], [0, 100], [784, 300], [0, 600]],
    urgent:  [[1047, 80], [0, 50], [1047, 80], [0, 50], [1047, 80], [0, 50],
              [1047, 80], [0, 50], [1047, 80], [0, 300]],
    chime:   [[1046, 120], [0, 60], [1318, 120], [0, 60], [1568, 120], [0, 60],
              [2093, 200], [0, 700]],
  };

  function previewRingtone() {
    try {
      if (!_previewCtx) _previewCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _previewCtx;
      const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      const toneId = $('timerRingtone').value;
      const notes = RINGTONE_NOTES[toneId] || RINGTONE_NOTES.default;
      resume.then(() => {
        let t = ctx.currentTime;
        for (const [freq, durMs] of notes) {
          if (freq > 0) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000 - 0.01);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + durMs / 1000);
          }
          t += durMs / 1000;
        }
      }).catch(() => {});
    } catch (_) {}
  }

  async function persist() {
    const theme = $('theme').value;
    const textScale = parseFloat($('textScale').value) || 1;
    const showHomeMessage = $('showHomeMessage').checked;
    const agentStyle = currentStyleText().trim();
    const timerRingtone = $('timerRingtone').value || 'default';
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
      settings: { theme, textScale, showHomeMessage, agentStyle, timerRingtone, terminal, tts, autoArchive },
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

    const aa = settings.autoArchive || {};
    $('autoArchiveEnabled').checked = aa.enabled !== false;
    $('autoArchiveOnClose').checked = aa.onClose !== false;
    $('autoArchiveIdleHours').value = String(Number(aa.idleHours) > 0 ? Number(aa.idleHours) : 6);

    const terminal = settings.terminal || {};
    $('terminalEnabled').checked = terminal.enabled === true;
    const shell = terminal.shell || 'powershell';
    const shellOpt = [...$('terminalShell').options].find((o) => o.value === shell);
    $('terminalShell').value = shellOpt ? shell : 'powershell';

    // Suoneria timer
    const ringtone = settings.timerRingtone || 'default';
    const ringOpt = [...$('timerRingtone').options].find((o) => o.value === ringtone);
    $('timerRingtone').value = ringOpt ? ringtone : 'default';

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

    // Token estetici: il tema è già applicato su <html>, quindi i default
    // mostrati riflettono il tema risolto corrente.
    currentOverrides = { ...(settings.themeTokens || {}) };
    buildTokenSection();
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();

    // Tema e dimensione testo: anteprima immediata + salvataggio.
    $('theme').addEventListener('change', () => {
      Bootstrap.applyTheme($('theme').value);
      // I default di alcuni token cambiano fra chiaro e scuro: ridisegna le
      // righe così i valori predefiniti mostrati seguono il nuovo tema (gli
      // override diretti sono indipendenti dal tema e restano).
      if (Tokens) for (const name of Tokens.names()) renderTokenRow(name);
      persist();
    });
    $('textScale').addEventListener('change', () => {
      Bootstrap.applyTextScale(parseFloat($('textScale').value) || 1);
      persist();
    });
    $('showHomeMessage').addEventListener('change', persist);
    $('autoArchiveEnabled').addEventListener('change', persist);
    $('autoArchiveOnClose').addEventListener('change', persist);
    $('autoArchiveIdleHours').addEventListener('change', persist);
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

    // Suoneria timer: salva al cambio + anteprima.
    $('timerRingtone').addEventListener('change', persist);
    $('timerRingtonePreview').addEventListener('click', previewRingtone);

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

    // Token estetici: reset globale ai predefiniti.
    $('resetAllTokens').addEventListener('click', resetAllTokens);

    // Con tema "Come il sistema", il tema risolto può cambiare quando l'OS passa
    // chiaro↔scuro: ridisegna le righe così i default mostrati restano corretti.
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if ((window.SN_PAGE_THEME || 'system') !== 'system' || !Tokens) return;
        for (const name of Tokens.names()) renderTokenRow(name);
      });
    }
  });
})();
