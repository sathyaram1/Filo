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
  const TabColor = window.SN_TAB_COLOR;

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

  // ── Ripristino completo (#184) ───────────────────────────────────────────
  // Un solo bottone riporta TUTTE le impostazioni ai predefiniti: non solo i
  // token estetici o il colore delle tab (che hanno il loro reset locale), ma
  // anche tema, dimensione del testo, gestione schede, notifiche, ecc. Risolve
  // il caso in cui una personalizzazione fatta a voce ("colore della barra")
  // resta appiccicata e i reset parziali non bastano a toglierla. Le chiavi API
  // si preservano (lo fa il main): un reset estetico non deve sloggare l'utente.
  async function resetAllSettings() {
    const Ui = window.SN_CONFIRM_UI;
    const text = 'Riporta TUTTE le impostazioni di Filo ai valori predefiniti: '
      + 'tema, colori e aspetto, colore delle schede, dimensione del testo, '
      + 'notifiche, gestione delle schede e ogni altra preferenza. '
      + 'Le tue chiavi API restano salvate. L’operazione non si può annullare.';
    const ok = Ui
      ? await Ui.confirm({ title: 'Ripristina tutte le impostazioni', text, okLabel: 'Ripristina tutto' })
      : window.confirm(`${text} Procedo?`);
    if (!ok) return;
    await chrome.runtime.sendMessage({ type: MSG.RESET_SETTINGS });
    // Ricarica la pagina: si ri-bootstrappa dai valori ora predefiniti (tema,
    // token, colore tab applicati da zero), evitando qualunque stato residuo.
    flashSaved('resetAllSavedHint');
    setTimeout(() => { try { location.reload(); } catch (_) {} }, 350);
  }

  // ── Rilancio dell'intervista di benvenuto (#524) ─────────────────────────
  // Azzera spunte e conversazione e riporta l'utente dove l'intervista vive:
  // una scheda nuova. Non tocca né la memoria né le impostazioni già applicate
  // — rifarla non è disfare quello che Filo ha imparato — e nemmeno la
  // conversazione di prima: quella finisce nell'archivio qui sotto.
  async function restartOnboarding() {
    const r = await chrome.runtime.sendMessage({ type: MSG.FILO_RESTART_ONBOARDING });
    if (!r || !r.ok) return;
    flashSaved('onboardingHint');
    renderOnboardingArchive(r.onboarding);
    chrome.runtime.sendMessage({ type: MSG.OPEN_URL, url: 'filo://newtab/' });
  }

  function onboardingWhen(conv) {
    const iso = conv.startedAt || conv.closedAt;
    if (!iso) return 'Intervista di benvenuto';
    try {
      return new Date(iso).toLocaleString('it-IT', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return 'Intervista di benvenuto'; }
  }

  // Le interviste conservate, rileggibili. La prima conversazione con Filo è la
  // prima cosa che l'utente gli ha raccontato di sé: rifarne una non la deve
  // cancellare, e senza un posto dove rileggerla "conservata" non vuol dire
  // niente. (Portarle anche nella cronologia delle chat è un feedback a parte.)
  function renderOnboardingArchive(state) {
    const box = $('onboardingArchive');
    if (!box) return;
    const O = window.SN_ONBOARDING;
    const list = O ? O.conversations(state) : [];
    box.innerHTML = '';
    box.hidden = list.length === 0;
    if (!list.length) return;
    list.forEach((conv, i) => {
      const det = document.createElement('details');
      det.className = 'onb-conv';
      const sum = document.createElement('summary');
      const when = document.createElement('span');
      when.className = 'onb-conv-when';
      when.textContent = onboardingWhen(conv);
      const meta = document.createElement('span');
      meta.className = 'onb-conv-turns';
      const scambi = conv.thread.filter((m) => m.role === 'user').length;
      meta.textContent = conv.current && !state.done
        ? 'in corso'
        : `${scambi} ${scambi === 1 ? 'risposta tua' : 'tue risposte'}`;
      sum.appendChild(when);
      sum.appendChild(meta);
      det.appendChild(sum);
      const lines = document.createElement('div');
      lines.className = 'onb-lines';
      for (const m of conv.thread) {
        const row = document.createElement('div');
        row.className = 'onb-line';
        const who = document.createElement('span');
        who.className = 'onb-who';
        who.textContent = m.role === 'filo' ? 'Filo' : 'Tu';
        const what = document.createElement('span');
        what.className = 'onb-what';
        what.textContent = m.text;
        row.appendChild(who);
        row.appendChild(what);
        lines.appendChild(row);
      }
      det.appendChild(lines);
      if (i === 0) det.open = true;
      box.appendChild(det);
    });
  }

  async function loadOnboardingArchive() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.FILO_GET_ONBOARDING, peek: true });
      if (r?.ok && r.onboarding) renderOnboardingArchive(r.onboarding);
    } catch (_) {}
  }

  // ── Sezione "colore identità delle tab" (Preferenze avanzate) ────────────
  // Stessa estetica "a codice" dei token: una riga per ognuno dei sei parametri
  // di src/shared/tabColor.js, con nome, valore numerico editabile, intervallo
  // ammesso e commento. Modificare un valore lo clampa al range, lo persiste e
  // (via SETTINGS_UPDATED) aggiorna live il colore delle tab. ↺ riporta il
  // singolo parametro al predefinito; il bottone in fondo li azzera tutti.
  let currentTabColor = {};
  let tabColorSaveTimer = null;

  function buildTabColorSection() {
    const box = $('tabColorCode');
    if (!box || !TabColor || !Array.isArray(TabColor.IDENTITY_PARAM_META)) return;
    box.textContent = '';
    for (const m of TabColor.IDENTITY_PARAM_META) {
      const row = document.createElement('div');
      row.className = 'sn-token-row';
      row.dataset.param = m.key;

      // Nessun campione colore qui: occupa lo spazio (allineamento con i token).
      const spacer = document.createElement('span');
      spacer.className = 'sn-token-swatch';
      spacer.style.visibility = 'hidden';
      row.appendChild(spacer);

      const label = document.createElement('label');
      label.className = 'sn-token-name';
      label.setAttribute('for', `tabcol-${m.key}`);
      label.title = m.comment || m.label;
      label.textContent = `${m.key}:`;
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'sn-token-input';
      input.id = `tabcol-${m.key}`;
      input.min = String(m.min);
      input.max = String(m.max);
      input.step = String(m.step);
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `${m.label} (${m.min}–${m.max})`);
      input.addEventListener('input', () => onTabColorInput(m.key));
      input.addEventListener('blur', () => renderTabColorRow(m.key));
      row.appendChild(input);

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'sn-token-reset';
      reset.textContent = '↺';
      reset.title = `Ripristina il predefinito (${m.def})`;
      reset.setAttribute('aria-label', `Ripristina ${m.key}`);
      reset.addEventListener('click', () => resetTabColorParam(m.key));
      row.appendChild(reset);

      // Intervallo + commento, su una riga dedicata sotto al controllo.
      const help = document.createElement('span');
      help.className = 'sn-token-error';
      help.hidden = false;
      help.style.color = 'var(--sn-muted, #888)';
      help.style.gridColumn = '2 / -1';
      help.textContent = `intervallo ${m.min}–${m.max} · ${m.comment}`;
      row.appendChild(help);

      box.appendChild(row);
      renderTabColorRow(m.key);
    }
  }

  function tabColorMeta(key) {
    return (TabColor && TabColor.IDENTITY_PARAM_META || []).find((m) => m.key === key) || null;
  }

  function renderTabColorRow(key) {
    const input = $(`tabcol-${key}`);
    const m = tabColorMeta(key);
    if (!input || !m) return;
    const v = Number(currentTabColor[key]);
    const val = Number.isFinite(v) ? v : m.def;
    input.value = String(val);
    const row = input.closest('.sn-token-row');
    if (row) row.classList.toggle('sn-token-modified', val !== m.def);
  }

  function onTabColorInput(key) {
    const input = $(`tabcol-${key}`);
    const m = tabColorMeta(key);
    if (!input || !m) return;
    let n = parseFloat(String(input.value).replace(',', '.'));
    if (!Number.isFinite(n)) return; // campo intermedio (vuoto/"-"): non salvare ora
    n = Math.max(m.min, Math.min(m.max, n));
    if (m.step >= 1) n = Math.round(n);
    currentTabColor[key] = n;
    const row = input.closest('.sn-token-row');
    if (row) row.classList.toggle('sn-token-modified', n !== m.def);
    persistTabColorDebounced();
  }

  function resetTabColorParam(key) {
    const m = tabColorMeta(key);
    if (!m) return;
    currentTabColor[key] = m.def;
    renderTabColorRow(key);
    persistTabColor();
  }

  function resetAllTabColor() {
    currentTabColor = TabColor ? TabColor.defaultParams() : {};
    if (TabColor && Array.isArray(TabColor.IDENTITY_PARAM_META)) {
      for (const m of TabColor.IDENTITY_PARAM_META) renderTabColorRow(m.key);
    }
    persistTabColor();
  }

  function persistTabColor() {
    const clamped = TabColor ? TabColor.clampParams(currentTabColor) : currentTabColor;
    currentTabColor = clamped;
    chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { tabColor: clamped },
    });
    flashSaved('tabColorSavedHint');
  }

  function persistTabColorDebounced() {
    clearTimeout(tabColorSaveTimer);
    tabColorSaveTimer = setTimeout(persistTabColor, 400);
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

  // Tendina della voce NATURALE (del modello): una voce per riga, raggruppate
  // per lingua; la prima scelta è "automatica" (segue la lingua del testo).
  // Le voci sono quelle del MODELLO di lettura in uso (le dice il main: ogni
  // modello ha i suoi nomi). L'ultima riga, «Altra voce», apre un campo di
  // testo: è la strada per un modello che Filo non conosce, o per una voce
  // che non è nell'elenco. Una voce salvata che non è fra le opzioni finisce
  // lì dentro, così non sparisce.
  const CUSTOM_VOICE = '__custom__';
  function currentModelVoice() {
    const sel = $('ttsModelVoice');
    if (!sel) return '';
    if (sel.value === CUSTOM_VOICE) return ($('ttsModelVoiceCustom').value || '').trim();
    return sel.value || '';
  }
  function syncCustomVoiceField() {
    const sel = $('ttsModelVoice');
    const input = $('ttsModelVoiceCustom');
    if (!sel || !input) return;
    input.hidden = sel.value !== CUSTOM_VOICE;
  }
  async function populateModelVoices(selected) {
    const sel = $('ttsModelVoice');
    const input = $('ttsModelVoiceCustom');
    const where = $('ttsModelVoiceModel');
    if (!sel) return;
    const want = selected !== undefined ? selected : currentModelVoice();
    let info = null;
    try { info = await chrome.runtime.sendMessage({ type: MSG.TTS_VOICES }); } catch (_) { info = null; }
    const groups = (info && info.ok && Array.isArray(info.groups)) ? info.groups : [];
    const required = info && info.ok ? info.required !== false : true;
    sel.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = groups.length
      ? 'Automatica: segue la lingua del testo'
      : (required ? 'Automatica' : 'Automatica: la sceglie il modello');
    sel.appendChild(auto);
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label.charAt(0).toUpperCase() + g.label.slice(1);
      for (const v of g.voices) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = v.label;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    const custom = document.createElement('option');
    custom.value = CUSTOM_VOICE;
    custom.textContent = 'Altra voce: scrivi il nome…';
    sel.appendChild(custom);
    if (where) {
      const model = info && info.model ? info.model : '';
      where.textContent = model ? `Modello: ${model}` : '';
      where.title = info && info.catalogName ? `Voci di ${info.catalogName}` : '';
    }
    if (want && [...sel.options].some((o) => o.value === want && o.value !== CUSTOM_VOICE)) {
      sel.value = want;
      if (input) input.value = '';
    } else if (want) {
      sel.value = CUSTOM_VOICE;
      if (input) input.value = want;
    } else {
      sel.value = '';
      if (input) input.value = '';
    }
    syncCustomVoiceField();
  }

  const MODEL_VOICE_SAMPLES = {
    it: 'Ciao, sono Filo. Questa è la voce naturale scelta per la lettura ad alta voce.',
    en: 'Hi, I am Filo. This is the natural voice chosen for reading aloud.',
    es: 'Hola, soy Filo. Esta es la voz natural elegida para la lectura en voz alta.',
    fr: 'Bonjour, je suis Filo. Voici la voix naturelle choisie pour la lecture à voix haute.',
    pt: 'Olá, eu sou o Filo. Esta é a voz natural escolhida para a leitura em voz alta.',
  };

  // PCM 16 bit mono → WAV in un blob URL (stesso incapsulamento del content script).
  function pcmBase64ToWavUrl(base64, sampleRate) {
    const bin = atob(base64);
    const n = bin.length;
    const buffer = new ArrayBuffer(44 + n);
    const view = new DataView(buffer);
    let off = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
    const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
    const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
    writeStr('RIFF'); writeU32(36 + n); writeStr('WAVE');
    writeStr('fmt '); writeU32(16); writeU16(1); writeU16(1);
    writeU32(sampleRate); writeU32(sampleRate * 2); writeU16(2); writeU16(16);
    writeStr('data'); writeU32(n);
    for (let i = 0; i < n; i++) view.setUint8(off++, bin.charCodeAt(i) & 0xff);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  let modelPreviewAudio = null;
  // Ascolta la voce naturale scelta: una frase nella sua lingua, sintetizzata
  // dal modello (passa dal main come una lettura vera).
  async function previewModelVoice() {
    const btn = $('ttsModelPreview');
    const status = $('ttsModelPreviewStatus');
    const V = window.SN_TTS_VOICES;
    const voice = currentModelVoice();
    const lang = ((voice && V) ? V.langOfVoice(voice) : '') || (navigator.language || 'it').split('-')[0];
    const text = MODEL_VOICE_SAMPLES[lang] || MODEL_VOICE_SAMPLES.en;
    if (modelPreviewAudio) { try { modelPreviewAudio.pause(); } catch (_) {} modelPreviewAudio = null; }
    btn.disabled = true;
    status.textContent = '…';
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.TTS_SYNTH, text, lang, voice });
      if (!res || !res.ok) {
        status.textContent = (res && res.error) || 'Voce naturale non disponibile in questo momento';
        return;
      }
      const m = /rate=(\d+)/.exec(String(res.mimeType || ''));
      const url = pcmBase64ToWavUrl(res.audioBase64, m ? parseInt(m[1], 10) : 24000);
      const audio = new Audio(url);
      modelPreviewAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (modelPreviewAudio === audio) modelPreviewAudio = null; };
      await audio.play();
      status.textContent = '';
    } catch (e) {
      status.textContent = (e && e.message) || 'Errore';
    } finally {
      btn.disabled = false;
    }
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
  // I toni (sequenze di note + player AudioContext) vivono nel modulo condiviso
  // SN_SOUNDS, riusato anche dalla shell per il suono delle notifiche (#170.1).
  const Sounds = window.SN_SOUNDS;

  // Riempie il <select> dei suoni notifica con le stesse voci della suoneria.
  function populateNotifSounds() {
    const sel = $('notifSound');
    if (!sel || sel.options.length) return;
    const labels = (Sounds && Sounds.TONE_LABELS) || { default: 'Standard' };
    const ids = (Sounds && Sounds.TONE_IDS) || ['default'];
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = labels[id] || id;
      sel.appendChild(o);
    }
  }

  function previewRingtone() {
    if (Sounds) Sounds.play($('timerRingtone').value);
  }
  function previewNotifSound() {
    if (Sounds) Sounds.play($('notifSound').value);
  }

  // Clamp dei due campi numerici "liberi" (li usano sia il salvataggio sia il
  // riallineamento visivo al blur, così ciò che si vede è sempre ciò che è
  // salvato). idleHours: 1..168 (0/negativo/vuoto → 6 predefinito).
  function clampIdleHours(raw) {
    return Number.isFinite(raw) && raw > 0 ? Math.min(168, raw) : 6;
  }
  // durata notifica in secondi: 0..120 (0 = resta finché non la chiudi;
  // negativo/vuoto → 5 predefinito).
  function clampNotifDurationSec(raw) {
    return Number.isFinite(raw) && raw >= 0 ? Math.min(120, raw) : 5;
  }

  // Riallinea un campo numerico al valore realmente salvato (clampato al
  // range), come fa renderTabColorRow per i parametri del colore delle tab:
  // appena si lascia il campo, sparisce il numero fuori scala digitato e
  // compare il valore in uso.
  function canonAutoArchiveIdle() {
    const input = $('autoArchiveIdleHours');
    if (!input) return;
    input.value = String(clampIdleHours(parseInt(input.value, 10)));
  }
  function canonNotifDuration() {
    const input = $('notifDuration');
    if (!input) return;
    input.value = String(clampNotifDurationSec(parseInt(input.value, 10)));
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
      modelVoice: currentModelVoice(),
    };
    const autoArchive = {
      enabled: $('autoArchiveEnabled').checked,
      onIdle: true,
      idleHours: clampIdleHours(parseInt($('autoArchiveIdleHours').value, 10)),
      onClose: $('autoArchiveOnClose').checked,
    };
    const notifications = {
      durationSec: clampNotifDurationSec(parseInt($('notifDuration').value, 10)),
      soundEnabled: $('notifSoundEnabled').checked,
      sound: $('notifSound').value || 'default',
    };

    await chrome.runtime.sendMessage({
      type: MSG.UPDATE_SETTINGS,
      settings: { theme, textScale, showHomeMessage, agentStyle, timerRingtone, terminal, tts, autoArchive, notifications },
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
    // PowerShell e cmd esistono solo su Windows. Fuori da lì il comando parte
    // comunque (il main ricade su /bin/sh — vedi src/main/services/terminal.js),
    // ma offrire tre shell di Windows a chi sta su un Mac è un menu che mente:
    // qui si mostrano quelle vere. Il valore salvato di una macchina Windows
    // (es. "powershell") si legge come "la shell di sistema".
    const suWindows = (() => { try { return (window.filo?.sistema || 'win32') === 'win32'; } catch (_) { return true; } })();
    const sel = $('terminalShell');
    if (!suWindows) {
      sel.innerHTML = '';
      for (const [value, label] of [['sh', 'Shell di sistema (sh)'], ['bash', 'Bash']]) {
        const o = document.createElement('option');
        o.value = value; o.textContent = label;
        sel.appendChild(o);
      }
    }
    const salvata = terminal.shell || (suWindows ? 'powershell' : 'sh');
    const predefinita = suWindows ? 'powershell' : 'sh';
    const shellOpt = [...sel.options].find((o) => o.value === salvata);
    sel.value = shellOpt ? salvata : predefinita;

    // Notifiche (durata + suono)
    populateNotifSounds();
    const notif = settings.notifications || {};
    const dur = Number(notif.durationSec);
    $('notifDuration').value = String(Number.isFinite(dur) && dur >= 0 ? dur : 5);
    $('notifSoundEnabled').checked = notif.soundEnabled === true;
    const notifSound = notif.sound || 'default';
    const nsOpt = [...$('notifSound').options].find((o) => o.value === notifSound);
    $('notifSound').value = nsOpt ? notifSound : 'default';

    // Suoneria timer
    const ringtone = settings.timerRingtone || 'default';
    const ringOpt = [...$('timerRingtone').options].find((o) => o.value === ringtone);
    $('timerRingtone').value = ringOpt ? ringtone : 'default';

    const tts = settings.tts || {};
    populateModelVoices(tts.modelVoice || '');
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

    // Colore identità delle tab: parti dai valori salvati (clampati ai range),
    // o dai default se mancano.
    currentTabColor = TabColor
      ? TabColor.clampParams(settings.tabColor || {})
      : { ...(settings.tabColor || {}) };
    buildTabColorSection();
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
    // Al blur riallinea il campo al valore realmente salvato (clampato), così
    // un numero fuori scala non resta a schermo a mentire sul valore in uso.
    $('autoArchiveIdleHours').addEventListener('blur', canonAutoArchiveIdle);
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
    $('ttsModelPreview').addEventListener('click', previewModelVoice);
    $('ttsModelVoice').addEventListener('change', () => {
      syncCustomVoiceField();
      if ($('ttsModelVoice').value === CUSTOM_VOICE) $('ttsModelVoiceCustom').focus();
      else persist();
    });
    $('ttsModelVoiceCustom').addEventListener('input', persistDebounced);

    // Notifiche: durata + suono.
    $('notifDuration').addEventListener('change', persist);
    $('notifDuration').addEventListener('blur', canonNotifDuration);
    $('notifSoundEnabled').addEventListener('change', persist);
    $('notifSound').addEventListener('change', persist);
    $('notifSoundPreview').addEventListener('click', previewNotifSound);

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

    // Colore identità delle tab: reset globale ai predefiniti.
    const resetTabColorBtn = $('resetAllTabColor');
    if (resetTabColorBtn) resetTabColorBtn.addEventListener('click', resetAllTabColor);

    // Ripristino completo di TUTTE le impostazioni ai predefiniti (#184).
    const resetAllBtn = $('resetAllSettings');
    if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllSettings);

    const onbBtn = $('restartOnboarding');
    if (onbBtn) onbBtn.addEventListener('click', restartOnboarding);
    loadOnboardingArchive();

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
