// Audio del content script: lettura ad alta voce e dettatura, dipendenze passate da init().
// TTS: voce di un modello scelta sulla lingua; senza chiave o su errore, quella del browser.
// Dettatura: microfono a blocchi; ogni frase chiusa da una pausa va al modello e nel campo.

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const { MSG } = global.SN_MSG;
  const I18n = global.SN_I18N;
  const Popup = global.SN_POPUP;
  const Chunk = global.SN_TTS_CHUNK;

  // Dipendenze iniettate da content.js (vedi init in fondo).
  let deps = {
    getSettings: () => null,
    restorePasteContext: () => false,
    insertDictatedText: () => {},
    blobToDataUrl: () => Promise.reject(new Error('SN_TTS non inizializzato')),
  };

  function ttsSupported() {
    return typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Evidenziazione con la CSS Custom Highlight API, non avvolgendo le parole in <span>: non
  // tocca il DOM, quindi niente layout rotto nemmeno sulle pagine React.
  const HL_NAME = 'filo-reading';
  const hlSupported = typeof CSS !== 'undefined'
    && CSS.highlights && typeof window.Highlight === 'function';

  // Token della lettura: {text, start, end, range}, con start/end offset nel testo letto.
  let readTokens = [];
  let hlIndex = -1;
  let lastScrollMs = 0;

  function ensureReadStyle() {
    if (!hlSupported) return;
    if (document.getElementById('sn-read-style')) return;
    const st = document.createElement('style');
    st.id = 'sn-read-style';
    global.SN_FILO_UI?.mark(st);
    // ::highlight accetta poche proprietà (background-color, color, text-decoration);
    // il ripiego letterale serve alle pagine senza theme.css.
    st.textContent =
      `::highlight(${HL_NAME}){background-color:color-mix(in srgb,var(--sn-accent,#c45a3b) 32%,transparent);border-radius:2px;}`;
    (document.head || document.documentElement).appendChild(st);
  }

  function setHighlight(idx) {
    if (!hlSupported || idx < 0 || idx >= readTokens.length || idx === hlIndex) return;
    const tok = readTokens[idx];
    if (!tok || !tok.range) return;
    hlIndex = idx;
    try { CSS.highlights.set(HL_NAME, new window.Highlight(tok.range)); } catch (_) {}
    maybeScrollIntoView(tok.range);
  }

  function clearHighlight() {
    hlIndex = -1;
    if (hlSupported) { try { CSS.highlights.delete(HL_NAME); } catch (_) {} }
  }

  // Al più ogni 400ms e solo 'nearest': scorrere di più strapperebbe la pagina sotto l'utente.
  function maybeScrollIntoView(range) {
    try {
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top >= 48 && rect.bottom <= vh - 48) return;
      const now = Date.now();
      if (now - lastScrollMs < 400) return;
      lastScrollMs = now;
      const anchor = range.startContainer.parentElement;
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: 'nearest' });
    } catch (_) {}
  }

  // I Range si catturano QUI, alla costruzione del menu, perché lì la selezione esiste
  // ancora; null se non c'è selezione testuale.
  function buildReadModel() {
    if (!hlSupported) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const selRange = sel.getRangeAt(0);
    const rootEl = selRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? selRange.commonAncestorContainer.parentNode
      : selRange.commonAncestorContainer;
    if (!rootEl) return null;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.data || !selRange.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p) {
          const cs = window.getComputedStyle(p);
          if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = '';
    const spans = []; // { node, nodeStart, globalStart, len }
    let node;
    while ((node = walker.nextNode())) {
      let s = 0;
      let e = node.data.length;
      if (node === selRange.startContainer) s = selRange.startOffset;
      if (node === selRange.endContainer) e = selRange.endOffset;
      if (e <= s) continue;
      const piece = node.data.slice(s, e);
      // Separatore fra nodi adiacenti, o parole di blocchi diversi si fonderebbero; lo spazio
      // non appartiene a nessuno span e i token non lo includono mai.
      if (text.length && !/\s$/.test(text) && !/^\s/.test(piece)) text += ' ';
      spans.push({ node, nodeStart: s, globalStart: text.length, len: piece.length });
      text += piece;
    }
    if (!text.trim()) return null;

    const tokens = [];
    for (const t of Chunk.tokenize(text)) {
      const sp = spans.find((x) => t.start >= x.globalStart && t.start < x.globalStart + x.len);
      if (!sp) continue;
      const range = document.createRange();
      const localStart = sp.nodeStart + (t.start - sp.globalStart);
      const localEnd = Math.min(sp.nodeStart + (t.end - sp.globalStart), sp.nodeStart + sp.len);
      try {
        range.setStart(sp.node, localStart);
        range.setEnd(sp.node, localEnd);
      } catch (_) { continue; }
      tokens.push({ text: t.text, start: t.start, end: t.end, range });
    }
    return { text, tokens };
  }

  // stopReading marca cancellata la sessione corrente: gli step async guardano sessionAlive()
  // per non proseguire una lettura fermata o sostituita.
  let session = null;
  function newSession() {
    session = { id: ((session && session.id) || 0) + 1, cancelled: false };
    return session;
  }
  function sessionAlive(s) { return session === s && !s.cancelled; }

  // A livello di modulo così stopReading() può fermarlo e il menu sa se sta leggendo.
  let ttsAudio = null;

  function ttsBusy() {
    if (ttsAudio && !ttsAudio.paused && !ttsAudio.ended) return true;
    const synth = ttsSupported() ? window.speechSynthesis : null;
    return !!(synth && (synth.speaking || synth.pending));
  }

  // La lettura suona dov'è partita ma si deve poter fermare da un'altra scheda: avvio e
  // arresto si segnalano al main, che rimanda indietro un flag globale.
  let reportedReading = false; // ultimo stato segnalato al main (dedup)
  let globalReading = false;   // qualche scheda (anche un'altra) sta leggendo
  function reportReadingState(active) {
    if (active === reportedReading) return;
    reportedReading = active;
    try { chrome.runtime.sendMessage({ type: MSG.TTS_READING_STATE, reading: active }); } catch (_) {}
  }
  function isAnyReading() {
    return ttsBusy() || globalReading;
  }
  function requestStopReading() {
    stopReading();
    try { chrome.runtime.sendMessage({ type: MSG.TTS_STOP_READING }); } catch (_) {}
  }
  // Broadcast in arrivo dal main, instradati da content.js.
  function handleBroadcast(msg) {
    if (!msg) return false;
    if (msg.type === MSG.TTS_GLOBAL_READING) { globalReading = !!msg.active; return true; }
    if (msg.type === MSG.TTS_STOP) { stopReading(); return true; }
    return false;
  }

  function stopReading() {
    if (session) session.cancelled = true;
    if (ttsAudio) {
      const a = ttsAudio;
      ttsAudio = null;
      try { a.pause(); } catch (_) {}
      try { if (a.src) URL.revokeObjectURL(a.src); } catch (_) {}
    }
    if (ttsSupported()) { try { window.speechSynthesis.cancel(); } catch (_) {} }
    clearHighlight();
    readTokens = [];
    reportReadingState(false);
  }

  // Il modello torna PCM 16-bit little-endian mono (audio/pcm;rate=24000): qui diventa un
  // WAV che <audio> sa suonare.
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

  // `baseChar` è l'offset di `utterText` nel testo completo: mappa l'onboundary sui token
  // globali quando il ripiego parte a metà.
  function playBrowserChunk(s, utterText, baseChar) {
    if (!ttsSupported()) { Popup.showToast(I18n.t('tts_not_supported')); clearHighlight(); reportReadingState(false); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(utterText);
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
    // La voce del browser dà tempi esatti per parola (onboundary): evidenziazione precisa.
    if (readTokens.length) {
      u.onboundary = (e) => {
        if (!sessionAlive(s)) return;
        if (e.name && e.name !== 'word') return;
        setHighlight(Chunk.charIndexToToken(readTokens, baseChar + (e.charIndex || 0)));
      };
    }
    u.onend = () => { if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); } };
    // Se la voce del browser fallisce la lettura finisce comunque: uno stato «sta leggendo»
    // appeso darebbe alle altre schede uno stop morto. L'evidenziazione qui NON si azzera.
    u.onerror = () => { if (sessionAlive(s)) reportReadingState(false); };
    synth.speak(u);
  }

  // Con l'audio del modello la parola corrente è solo una stima (frazione di durata → token).
  function playModelChunk(s, res, chunk) {
    return new Promise((resolve) => {
      let url;
      try { url = pcmBase64ToWavUrl(res.audioBase64, sampleRateFromMime(res.mimeType)); }
      catch (_) { resolve(false); return; }
      const audio = new Audio(url);
      ttsAudio = audio;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try { URL.revokeObjectURL(url); } catch (_) {}
        if (ttsAudio === audio) ttsAudio = null;
        resolve(ok);
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      // Se l'utente ferma (stopReading mette in pausa), sblocca la pipeline.
      audio.onpause = () => { if (!sessionAlive(s)) finish(true); };
      if (chunk.from >= 0 && readTokens.length) {
        audio.ontimeupdate = () => {
          if (!sessionAlive(s)) return;
          const d = audio.duration;
          if (!d || !isFinite(d)) return;
          setHighlight(Chunk.tokenIndexAtFraction(readTokens, chunk.from, chunk.to, audio.currentTime / d));
        };
      }
      audio.play().catch(() => finish(false));
    });
  }

  // La PRIMA volta che la voce del modello manca si dice perché: senza, «modello impostato»
  // resta un mistero e l'utente non sa che (per dire) manca la chiave. Dedup nel main.
  function notifyModelFallback(res) {
    if (!res || !res.firstFallback) return;      // deduplicato dal main
    if (!ttsSupported()) return;                 // playBrowserChunk mostrerà già tts_not_supported
    // Il messaggio di questi errori arriva già scritto per l'utente e dice dove si mette a
    // posto: mostrarlo com'è vale più di una frase generica.
    const spiegato = ['NO_MODEL_FOR_ACTION', 'TTS_VOICE_REQUIRED', 'TTS_VOICE_UNKNOWN'];
    if (spiegato.includes(res.errorCode) && res.error) {
      try { Popup.showToast(I18n.t('tts_model_fallback_reason', String(res.error))); } catch (_) {}
      return;
    }
    const key = res.error === 'no_tts_model' ? 'tts_model_fallback_nokey' : 'tts_model_fallback';
    try { Popup.showToast(I18n.t(key)); } catch (_) {}
  }

  // Anti-attesa: la prima frase, corta, suona subito mentre le altre si preparano in
  // parallelo; il tempo prima della prima parola crolla.
  async function readAloud(text, tokens) {
    const full = String(text == null ? '' : text);
    if (!full.trim()) return;
    // Due letture sovrapposte sono incomprensibili: prima si ferma quella in corso.
    stopReading();
    const s = newSession();
    reportReadingState(true);
    readTokens = Array.isArray(tokens) ? tokens.slice() : [];
    ensureReadStyle();
    // Feedback immediato: evidenzia la prima parola appena si parte.
    if (readTokens.length) setHighlight(0);
    try {
      document.dispatchEvent(new CustomEvent('filo:read-aloud', { detail: { text: full.trim() } }));
    } catch (_) {}

    // Senza token non c'è evidenziazione possibile: un chunk unico, from=-1.
    const chunks = readTokens.length
      ? Chunk.chunkTokens(readTokens, {})
      : [{ from: -1, to: -1, start: 0, end: full.length }];

    // Al più il chunk corrente e il successivo in volo; i già letti li serve la cache del main.
    const fetches = new Array(chunks.length);
    const startFetch = (ci) => {
      if (ci < 0 || ci >= chunks.length || fetches[ci]) return;
      const c = chunks[ci];
      const ctext = full.slice(c.start, c.end);
      // Serve l'intero esito, non il solo audio: `error` e `firstFallback` spiegano all'utente
      // perché si passa alla voce del browser.
      fetches[ci] = chrome.runtime.sendMessage({ type: MSG.TTS_SYNTH, text: ctext, lang: pageLang() })
        .then((res) => res || null)
        .catch(() => null);
    };

    for (let ci = 0; ci < chunks.length; ci++) {
      if (!sessionAlive(s)) return;
      startFetch(ci);
      startFetch(ci + 1);
      const res = await fetches[ci];
      if (!sessionAlive(s)) return;
      if (res && res.ok && res.audioBase64) {
        startFetch(ci + 1); // mantieni il successivo in volo mentre si suona
        await playModelChunk(s, res, chunks[ci]);
        if (!sessionAlive(s)) return;
      } else {
        // Dal chunk fallito in poi la voce del browser legge tutto il resto, in un'unica
        // utterance con onboundary.
        notifyModelFallback(res);
        playBrowserChunk(s, full.slice(chunks[ci].start), chunks[ci].start);
        return;
      }
    }
    if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); }
  }

  // Mentre si legge questa voce non si ripropone: lo stop è una voce globale di ogni menu.
  // Il modello di lettura si cattura qui perché al click la selezione può non esserci più.
  function buildReadAloudItem(text) {
    if (ttsBusy()) return null;
    const Icons = global.SN_ICONS;
    let model = null;
    try { model = buildReadModel(); } catch (_) {}
    const readText = (model && model.text) || text;
    const readWords = (model && model.tokens) || null;
    return {
      type: 'item',
      icon: Icons.readAloud(18),
      label: I18n.t('menu_read_aloud'),
      onClick: () => readAloud(readText, readWords),
    };
  }

  // Compare in ogni menu mentre la sintesi riproduce, qualunque cosa sia stata cliccata.
  function buildStopReadingItem() {
    const Icons = global.SN_ICONS;
    return { type: 'item', icon: Icons.stopReading(18), label: I18n.t('menu_stop_reading'), onClick: () => requestStopReading() };
  }

  // Lingua: quella dichiarata dalla pagina, altrimenti quella dell'app; sceglie la voce del
  // modello, salvo una voce fissata in Preferenze.
  function pageLang() {
    try {
      const l = document.documentElement && document.documentElement.lang;
      return (l && String(l).trim()) || navigator.language || '';
    } catch (_) { return ''; }
  }

  function dictationSupported() {
    return typeof window !== 'undefined'
      && Boolean(navigator?.mediaDevices?.getUserMedia)
      && Boolean(window.AudioContext || window.webkitAudioContext)
      && Boolean(global.SN_DICTATION_SEGMENTER);
  }

  function buildDictateItem() {
    const supported = dictationSupported();
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
    // Solo i modelli CONFIGURATI: elencare quelli scritti nel codice
    // mostrerebbe scelte che l'app non userebbe mai.
    const registry = (settings && settings.modelRegistry) || {};
    const currentRaw = (settings && settings.models && settings.models[C.ACTIONS.TRANSCRIBE_AUDIO]) || '';
    // Più nickname di fallback nel campo: il «corrente» è il primario, cioè il primo.
    const current = C.parseModelRefs ? (C.parseModelRefs(currentRaw)[0] || currentRaw) : currentRaw;
    const Caps = global.SN_MODEL_CAPS;
    const items = [];
    for (const [nickname, entry] of Object.entries(registry)) {
      if (!entry) continue;
      const checked = nickname === current;
      // Solo i modelli che dichiarano di ascoltare un audio: uno di chat qui non funzionerebbe.
      // Quello scelto resta in lista comunque, così si vede cos'è impostato.
      if (!checked) {
        const provider = entry.provider || 'openrouter';
        const model = entry.model || entry.openrouter || '';
        const meta = (C.entryModalities && C.entryModalities(entry, nickname)) || undefined;
        const caps = Caps && Caps.capabilitiesFor ? Caps.capabilitiesFor(provider, model, meta) : null;
        const listens = caps && !caps.uncertain && caps.inputs.includes('audio')
          && Caps.modelMatchesAction(provider, model, C.ACTIONS.TRANSCRIBE_AUDIO, meta).ok;
        if (!listens) continue;
      }
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

  // Stato modulo per la dettatura in corso (al più una alla volta).
  let _dictateState = null;
  // Sicurezza: il microfono non resta aperto oltre questo tempo.
  const DICTATE_MAX_MS = 5 * 60 * 1000;
  // Per la voce 16 kHz bastano, e tengono gli spezzoni piccoli (~32 KB al secondo).
  const DICTATE_RATE = 16000;
  // Quanti caratteri della frase provvisoria si vedono nel riquadro: la coda, cioè la parte
  // che cambia mentre si parla.
  const DICTATE_LIVE_CHARS = 140;

  // Perché la dettatura non è partita, detto all'utente. Un errore di configurazione dei
  // modelli arriva già spiegato e va mostrato com'è: dice cosa fare per rimetterla in piedi.
  function explainDictationFailure(res) {
    const spiegato = (res?.code === 'NO_MODEL_FOR_ACTION' || res?.code === 'NO_OPEN_WEIGHTS_MODEL')
      && res.error;
    if (spiegato) Popup.showToast(res.error, { duration: 9000 });
    else Popup.showToast(I18n.t('err_provider_failed'));
  }

  async function startDictation() {
    if (_dictateState) { stopDictation(); return; }
    if (!dictationSupported()) {
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
    const Seg = global.SN_DICTATION_SEGMENTER;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx; let source; let proc;
    try {
      ctx = new Ctx();
      source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor: deprecato ma ovunque e senza file esterni (un AudioWorklet vuole un
      // modulo da URL, che un content script non ha). 4096 campioni ≈ 85 ms a 48 kHz.
      proc = ctx.createScriptProcessor(4096, 1, 1);
      // Un contesto audio può nascere sospeso (autoplay): senza resume non arriva un campione.
      try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (_) {}
    } catch (_) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { if (ctx) ctx.close(); } catch (_) {}
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    const lang = navigator.language || 'it-IT';

    // Riquadro cliccabile e non toast: al click ferma, e un toast non si può cliccare.
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'sn-dictate-pill';
    const label = document.createElement('span');
    label.className = 'sn-dictate-pill-label';
    label.textContent = I18n.t('menu_dictate_listening');
    const live = document.createElement('span');
    live.className = 'sn-dictate-pill-live';
    live.hidden = true;
    pill.append(label, live);
    // Fermando dalla pill il fuoco non si sposta: il cursore resta dov'era e il testo dettato
    // ci atterra sopra (in un contenteditable la selezione viva si perderebbe).
    pill.addEventListener('mousedown', (e) => e.preventDefault());
    // Nello stack degli avvisi (#409) per non finire sotto o sopra un toast. `sticky` perché è
    // l'unico comando per fermare la dettatura: il tetto dello stack non deve sfrattarlo.
    Popup.mountToast(pill, { sticky: true });

    const state = {
      stream, ctx, pill, stopped: false, interimBusy: false, finals: 0, failed: false,
      queue: Promise.resolve(),
    };
    _dictateState = state;

    const showLive = (text) => {
      const t = String(text || '').trim();
      if (!t) { live.hidden = true; live.textContent = ''; return; }
      live.textContent = t.length > DICTATE_LIVE_CHARS ? '…' + t.slice(-DICTATE_LIVE_CHARS) : t;
      live.hidden = false;
    };

    const toWavBase64 = (seg) =>
      Seg.bytesToBase64(Seg.pcm16ToWav(Seg.floatToInt16(seg.samples), seg.sampleRate));

    const transcribe = (seg, interim) => chrome.runtime.sendMessage({
      type: MSG.AI_REQUEST,
      action: ACTIONS.TRANSCRIBE_AUDIO,
      payload: { audioBase64: toWavBase64(seg), format: 'wav', lang, interim },
    });

    const segmenter = Seg.createSegmenter({
      sampleRate: DICTATE_RATE,
      // Frase in corso, provvisoria e solo nel riquadro. Una alla volta: se la precedente è
      // ancora in volo si salta questo giro.
      onInterim: (seg) => {
        if (state.interimBusy || state.stopped || state.failed) return;
        state.interimBusy = true;
        transcribe(seg, true)
          .then((res) => { if (res?.ok && !state.stopped) showLive(res.text); })
          .catch(() => {})
          .finally(() => { state.interimBusy = false; });
      },
      // Frase definitiva, nel campo. In coda e una alla volta, così il testo entra nell'ordine
      // in cui è stato detto anche se una risposta è più lenta.
      onFinal: (seg) => {
        state.queue = state.queue.then(async () => {
          if (state.failed) return;
          let res = null;
          try { res = await transcribe(seg, false); } catch (_) { res = null; }
          if (!res?.ok) {
            state.failed = true;
            explainDictationFailure(res);
            stopDictation();
            return;
          }
          const text = (res.text || '').trim();
          if (!text) return;
          state.finals++;
          showLive('');
          // Si inserisce dove il cursore è ADESSO, non dov'era all'apertura del menu: mentre detta,
          // l'utente può aver scritto o spostato il cursore.
          deps.insertDictatedText(text + ' ');
        });
      },
    });

    proc.onaudioprocess = (e) => {
      if (state.stopped) return;
      try {
        const input = e.inputBuffer.getChannelData(0);
        segmenter.push(Seg.downsample(input, ctx.sampleRate, DICTATE_RATE));
      } catch (_) {}
    };
    source.connect(proc);
    // Lo ScriptProcessor lavora solo se collegato all'uscita; non scrivendo nulla nel buffer
    // di uscita, dalle casse non esce niente.
    proc.connect(ctx.destination);

    state.stop = async () => {
      if (state.stopped) return;
      state.stopped = true;
      try { proc.disconnect(); source.disconnect(); } catch (_) {}
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { await ctx.close(); } catch (_) {}
      // L'ultima frase, se c'è, è definitiva anche senza pausa.
      try { segmenter.flush(); } catch (_) {}
      label.textContent = I18n.t('menu_dictate_transcribing');
      await state.queue;
      if (pill.parentNode) Popup.unmountToast(pill);
      if (!state.finals && !state.failed) Popup.showToast(I18n.t('menu_dictate_empty'));
      if (_dictateState === state) _dictateState = null;
    };

    pill.addEventListener('click', () => stopDictation());
    setTimeout(() => { if (_dictateState === state) stopDictation(); }, DICTATE_MAX_MS);
  }

  function stopDictation() {
    if (!_dictateState || typeof _dictateState.stop !== 'function') return;
    _dictateState.stop().catch(() => {});
  }

  function init(d) {
    deps = { ...deps, ...d };
    // Una scheda appena aperta può non aver ricevuto il broadcast: si chiede lo stato al main,
    // così il menu mostra subito «Interrompi lettura» anche qui.
    try {
      const p = chrome.runtime.sendMessage({ type: MSG.TTS_READING_STATUS });
      if (p && typeof p.then === 'function') {
        p.then((r) => { if (r && typeof r.active === 'boolean') globalReading = r.active; }).catch(() => {});
      }
    } catch (_) {}
  }

  global.SN_TTS = {
    init,
    ttsBusy,
    isAnyReading,
    handleBroadcast,
    stopReading,
    readAloud,
    buildReadAloudItem,
    buildStopReadingItem,
    buildDictateItem,
    startDictation,
    stopDictation,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
