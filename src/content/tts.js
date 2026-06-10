// Audio del content script: lettura ad alta voce (text-to-speech) e dettatura
// (registrazione microfono + trascrizione via modello).
//
// TTS — strategia: prima si tenta la sintesi vocale via MODELLO (Gemini TTS,
// voce di qualità) tramite il main process; se non c'è un modello/chiave o la
// chiamata fallisce, si ripiega sulla voce del browser (Web Speech: gratuita,
// offline, voci del sistema operativo). La voce/velocità/tono del fallback
// arrivano da settings.tts (Preferenze).
//
// Estratto da content.js — viene caricato prima di lui dai preload. content.js
// chiama init() passando le dipendenze che restano sue (settings correnti,
// gestione del pasteContext, blobToDataUrl).

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    getSettings: () => null,
    restorePasteContext: () => false,
    insertTextAtSelection: () => {},
    blobToDataUrl: () => Promise.reject(new Error('SN_TTS non inizializzato')),
  };

  function ttsSupported() {
    return typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Audio in riproduzione dalla sintesi vocale a modello. A livello di modulo
  // così stopReading() può fermarlo e il menu sa se sta "leggendo".
  let ttsAudio = null;

  function ttsBusy() {
    if (ttsAudio && !ttsAudio.paused && !ttsAudio.ended) return true;
    const synth = ttsSupported() ? window.speechSynthesis : null;
    return !!(synth && (synth.speaking || synth.pending));
  }

  function stopReading() {
    if (ttsAudio) {
      const a = ttsAudio;
      ttsAudio = null;
      try { a.pause(); } catch (_) {}
      try { if (a.src) URL.revokeObjectURL(a.src); } catch (_) {}
    }
    if (ttsSupported()) { try { window.speechSynthesis.cancel(); } catch (_) {} }
  }

  // Incapsula PCM 16-bit little-endian mono (quello che torna Gemini TTS,
  // audio/L16;rate=24000) in un WAV riproducibile da <audio>. Ritorna un blob URL.
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

  function sampleRateFromMime(mime) {
    const m = /rate=(\d+)/.exec(String(mime || ''));
    return m ? parseInt(m[1], 10) : 24000;
  }

  // Fallback finale: voce del browser.
  function readAloudBrowser(clean) {
    if (!ttsSupported()) { Popup.showToast(I18n.t('tts_not_supported')); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const settings = deps.getSettings();
    const tts = (settings && settings.tts) || {};
    const rate = Number(tts.rate);
    const pitch = Number(tts.pitch);
    u.rate = rate >= 0.5 && rate <= 2 ? rate : 1;
    u.pitch = pitch >= 0 && pitch <= 2 ? pitch : 1;
    if (tts.voice) {
      const voices = synth.getVoices() || [];
      const v = voices.find((vo) => vo.voiceURI === tts.voice || vo.name === tts.voice);
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    synth.speak(u);
  }

  async function readAloud(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    // Ferma un'eventuale lettura in corso (modello o browser): due letture
    // sovrapposte sono incomprensibili.
    stopReading();
    // Segnale osservabile dell'avvio lettura, indipendente dal motore usato.
    try {
      document.dispatchEvent(new CustomEvent('filo:read-aloud', { detail: { text: clean } }));
    } catch (_) {}

    // 1) Sintesi vocale via modello (qualità migliore).
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.TTS_SYNTH, text: clean });
      if (res && res.ok && res.audioBase64) {
        const url = pcmBase64ToWavUrl(res.audioBase64, sampleRateFromMime(res.mimeType));
        const audio = new Audio(url);
        ttsAudio = audio;
        audio.onended = () => {
          try { URL.revokeObjectURL(url); } catch (_) {}
          if (ttsAudio === audio) ttsAudio = null;
        };
        audio.onerror = () => {
          try { URL.revokeObjectURL(url); } catch (_) {}
          if (ttsAudio === audio) ttsAudio = null;
          readAloudBrowser(clean); // riproduzione fallita → fallback
        };
        await audio.play();
        return;
      }
    } catch (_) {
      // nessun modello/chiave o errore di rete → fallback sotto
    }

    // 2) Fallback finale: voce del browser.
    readAloudBrowser(clean);
  }

  // Voce di menu "Leggi ad alta voce" sul testo selezionato. Mentre una
  // lettura è in corso non la riproponiamo qui: lo stop è una voce globale
  // presente in QUALSIASI menu (vedi buildStopReadingItem in buildMenuItems),
  // così "ferma" è sempre raggiungibile, anche senza selezione.
  function buildReadAloudItem(text) {
    if (ttsBusy()) return null;
    const Icons = global.SN_ICONS;
    return { type: 'item', icon: Icons.readAloud(18), label: I18n.t('menu_read_aloud'), onClick: () => readAloud(text) };
  }

  // Voce "Interrompi lettura": compare in ogni menu mentre la sintesi vocale
  // sta riproducendo, indipendentemente dal contesto cliccato.
  function buildStopReadingItem() {
    const Icons = global.SN_ICONS;
    return { type: 'item', icon: Icons.stopReading(18), label: I18n.t('menu_stop_reading'), onClick: () => stopReading() };
  }

  // Decodifica un blob audio (qualunque formato che il browser sappia leggere
  // — tipicamente webm/opus prodotto da MediaRecorder) e lo ri-encoda come WAV
  // mono al sampleRate richiesto. Necessario perché la Gemini API accetta
  // wav/mp3/ogg/flac/aac/aiff ma NON webm. WAV PCM 16-bit mono a 16kHz è
  // abbondante per la voce e tiene il file piccolo (~32KB/s).
  async function audioBlobToWav(blob, targetSampleRate = 16000) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext non disponibile');
    const arrayBuffer = await blob.arrayBuffer();
    const decoderCtx = new Ctx();
    let decoded;
    try {
      decoded = await decoderCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      try { decoderCtx.close(); } catch (_) {}
    }
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    let off = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)); };
    const writeU32 = (v) => { view.setUint32(off, v, true); off += 4; };
    const writeU16 = (v) => { view.setUint16(off, v, true); off += 2; };
    writeStr('RIFF');
    writeU32(36 + samples.length * 2);
    writeStr('WAVE');
    writeStr('fmt ');
    writeU32(16);
    writeU16(1);                     // PCM
    writeU16(1);                     // mono
    writeU32(targetSampleRate);
    writeU32(targetSampleRate * 2);  // byte rate (sampleRate * channels * 2)
    writeU16(2);                     // block align
    writeU16(16);                    // bits per sample
    writeStr('data');
    writeU32(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Item "Detta": registrazione audio via MediaRecorder + trascrizione con un
  // modello multimodale (default Gemini Flash). La freccetta apre la scelta
  // modello, popolata dinamicamente dai modelli del registry che supportano
  // input audio (per ora solo Gemini — Claude/OpenRouter chat non accettano
  // audio inline).
  function buildDictateItem() {
    const supported = typeof window !== 'undefined'
      && typeof window.MediaRecorder !== 'undefined'
      && navigator?.mediaDevices?.getUserMedia;
    return {
      type: 'split',
      icon: '🎤',
      label: I18n.t('menu_dictate'),
      onClick: () => startDictation(),
      disabled: !supported,
      arrowTitle: I18n.t('menu_dictate_model_select'),
      subItems: supported
        ? [
            { type: 'info', label: I18n.t('menu_dictate_model_select') },
            { type: 'separator' },
            ...buildDictateModelSubItems(),
          ]
        : [
            { type: 'info', label: I18n.t('menu_dictate_not_supported') },
          ],
    };
  }

  function buildDictateModelSubItems() {
    const C = global.SN_CONST;
    const settings = deps.getSettings();
    const registry = (settings && settings.modelRegistry) || C.DEFAULT_MODEL_REGISTRY;
    const currentRaw = (settings && settings.models && settings.models[C.ACTIONS.TRANSCRIBE_AUDIO])
      || C.DEFAULT_MODELS[C.ACTIONS.TRANSCRIBE_AUDIO];
    // Il campo può contenere più nickname (fallback): il "corrente" mostrato
    // come selezionato è il primario (il primo della lista).
    const current = C.parseModelRefs ? (C.parseModelRefs(currentRaw)[0] || currentRaw) : currentRaw;
    const items = [];
    for (const [nickname, entry] of Object.entries(registry)) {
      // Solo modelli con un binding Gemini: per ora è l'unico provider che
      // accetta audio inline tramite la stessa chat completion che usiamo.
      if (!entry || !entry.gemini) continue;
      const checked = nickname === current;
      items.push({
        label: (checked ? '✓ ' : '   ') + (entry.label || nickname),
        onClick: () => pickDictateModel(nickname),
      });
    }
    if (!items.length) {
      items.push({ type: 'info', label: I18n.t('menu_dictate_not_supported') });
    }
    return items;
  }

  async function pickDictateModel(nickname) {
    try {
      await chrome.runtime.sendMessage({
        type: MSG.UPDATE_SETTINGS,
        settings: { models: { [ACTIONS.TRANSCRIBE_AUDIO]: nickname } },
      });
      Popup.showToast(I18n.t('menu_dictate_model_set'));
    } catch (_) {
      Popup.showToast(I18n.t('err_provider_failed'));
    }
  }

  // Stato modulo per la registrazione in corso (al più una alla volta).
  let _dictateState = null;

  async function startDictation() {
    if (_dictateState) { stopDictation(); return; }
    if (typeof window.MediaRecorder === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      Popup.showToast(I18n.t('menu_dictate_not_supported'));
      return;
    }
    if (!deps.restorePasteContext()) {
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      Popup.showToast(I18n.t('menu_dictate_no_mic'));
      return;
    }
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
    let rec;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (_) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    // Pill cliccabile per fermare la registrazione (il toast non è cliccabile).
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'sn-dictate-pill';
    pill.textContent = I18n.t('menu_dictate_listening');
    document.documentElement.appendChild(pill);

    const cleanup = () => {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      if (pill.parentNode) pill.remove();
      _dictateState = null;
    };

    rec.onstop = async () => {
      try {
        const raw = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (!raw.size) { Popup.showToast(I18n.t('menu_dictate_empty')); cleanup(); return; }
        if (pill.parentNode) pill.remove();
        Popup.showToast(I18n.t('menu_dictate_transcribing'), { duration: 2500 });
        // Gemini accetta wav/mp3/ogg/flac/aac/aiff ma non webm: riencodiamo in
        // WAV mono 16kHz (più che sufficiente per voce, file piccolo).
        const wav = await audioBlobToWav(raw, 16000).catch(() => null);
        if (!wav) { Popup.showToast(I18n.t('err_provider_failed')); cleanup(); return; }
        const dataUrl = await deps.blobToDataUrl(wav);
        const res = await chrome.runtime.sendMessage({
          type: MSG.AI_REQUEST,
          action: ACTIONS.TRANSCRIBE_AUDIO,
          payload: { dataUrl, lang: navigator.language || 'it-IT' },
        });
        cleanup();
        if (!res?.ok) { Popup.showToast(I18n.t('err_provider_failed')); return; }
        const text = (res.text || '').trim();
        if (!text) { Popup.showToast(I18n.t('menu_dictate_empty')); return; }
        deps.restorePasteContext();
        deps.insertTextAtSelection(text + ' ');
      } catch (_) {
        Popup.showToast(I18n.t('err_provider_failed'));
        cleanup();
      }
    };

    pill.addEventListener('click', () => stopDictation());

    _dictateState = { rec, stream, pill };
    try { rec.start(); } catch (_) { cleanup(); Popup.showToast(I18n.t('err_provider_failed')); return; }
    // Safety: stop forzato dopo 60s per non lasciare il mic aperto.
    const t = rec;
    setTimeout(() => { if (_dictateState && _dictateState.rec === t) stopDictation(); }, 60_000);
  }

  function stopDictation() {
    if (!_dictateState) return;
    try { _dictateState.rec.stop(); } catch (_) {}
  }

  function init(d) { deps = { ...deps, ...d }; }

  global.SN_TTS = {
    init,
    ttsBusy,
    stopReading,
    readAloud,
    buildReadAloudItem,
    buildStopReadingItem,
    buildDictateItem,
    startDictation,
    stopDictation,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
