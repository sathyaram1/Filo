// Audio del content script: lettura ad alta voce (text-to-speech) e dettatura
// (registrazione microfono + trascrizione via modello).
//
// TTS — strategia: prima si tenta la sintesi vocale via MODELLO (voce
// naturale di un modello a pesi aperti, scelta in base alla lingua del testo)
// tramite il main process; se non c'è un modello/chiave o la chiamata
// fallisce, si ripiega sulla voce del browser (Web Speech: gratuita, offline,
// voci del sistema operativo). La voce/velocità/tono del fallback arrivano da
// settings.tts (Preferenze).
//
// Dettatura — l'ascolto è di SN_ASCOLTO (src/shared/ascolto.js): ogni frase
// chiusa da una pausa entra nel campo; nel frattempo la frase in corso si vede,
// provvisoria, nel riquadro rosso. Nella casella di una chat di Filo «Detta» è
// il tasto microfono della chat (SN_VOCE_CHAT).
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
    // La prova di una voce chiesta in chat (#1619): la manda il main solo alla pagina della chat.
    if (msg.type === MSG.TTS_PROVA) { readAloud(msg.testo, null, { voce: typeof msg.voce === 'string' ? msg.voce : '' }); return true; }
    return false;
  }

  // Una lettura si conta una volta, quando finisce o si ferma (#1467): con che voce, perché il ripiego, fin dove.
  // Escono il codice del guasto e la quota letta, mai il testo.
  // Finché legge, il main ne tiene l'ultimo stato e la conta lui se la scheda si chiude (chiudere non dà eventi).
  function datiLettura(s, finita) {
    const r = s.ripiego && s.ripiego.res;
    return {
      misura: 'lettura', voce: !s.ripiego ? 'modello' : s.pezziModello > 0 ? 'mista' : 'browser', ripiego: !!s.ripiego,
      codice: String((r && r.errorCode) || ''), chiaveRifiutata: !!(r && r.keyRefused), senzaModello: !!(r && r.error === 'no_tts_model'),
      // Finita senza che si sia sentito niente (l'audio rifiutato) non è letta fino in fondo.
      quota: Math.min(1, (s.letti || 0) / s.totale), finita: finita === true && (s.letti || 0) > 0, id: s.idConto,
    };
  }
  function contaLettura(s, finita) {
    if (!s || s.contata || !s.totale) return;
    s.contata = true;
    try { Popup.conta(datiLettura(s, finita)); } catch (_) {}
  }
  function segnaLettura(s, subito = false) {
    if (!s || s.contata || !s.totale) return;
    const ora = Date.now();
    if (!subito && ora - (s.segnata || 0) < 1000) return;
    s.segnata = ora;
    try { Popup.conta({ ...datiLettura(s, false), misura: 'in-corso', cosa: 'lettura' }); } catch (_) {}
  }
  try { window.addEventListener('pagehide', () => { if (session && !session.cancelled) contaLettura(session, false); }); } catch (_) {}

  function stopReading() {
    if (session && !session.cancelled) contaLettura(session, false);
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
    if (!ttsSupported()) { Popup.toastErrore('tts_not_supported'); clearHighlight(); reportReadingState(false); contaLettura(s, false); return; }
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
    // La voce del browser dà tempi esatti per parola (onboundary): evidenziazione precisa, e fin dove è arrivata.
    u.onboundary = (e) => {
      if (!sessionAlive(s)) return;
      s.letti = Math.max(s.letti || 0, baseChar + (e.charIndex || 0));
      segnaLettura(s);
      if (!readTokens.length || (e.name && e.name !== 'word')) return;
      setHighlight(Chunk.charIndexToToken(readTokens, baseChar + (e.charIndex || 0)));
    };
    u.onend = () => { if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); contaLettura(s, true); } };
    // Se la voce del browser fallisce la lettura finisce comunque: uno stato «sta leggendo»
    // appeso darebbe alle altre schede uno stop morto. L'evidenziazione qui NON si azzera.
    u.onerror = () => { if (sessionAlive(s)) { reportReadingState(false); contaLettura(s, false); } };
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
      audio.addEventListener('timeupdate', () => {
        const d = audio.duration;
        if (!sessionAlive(s) || !d || !isFinite(d)) return;
        s.letti = Math.max(s.letti || 0, chunk.start + (chunk.end - chunk.start) * (audio.currentTime / d));
        segnaLettura(s);
      });
      // La voce del modello conta da quando si sente, non da quando l'audio è arrivato.
      audio.addEventListener('playing', () => { if (!chunk.sentito && sessionAlive(s)) { chunk.sentito = true; s.pezziModello += 1; } });
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
    // Nessun modello impostato per la lettura (o la scorciatoia citata non
    // esiste): il messaggio arriva già scritto per l'utente e dice dove si
    // imposta — mostrarlo com'è vale molto più di una frase generica.
    // Stesso trattamento quando il modello c'è ma pretende il nome di una voce
    // che Filo non conosce: il messaggio dice dove scriverlo.
    // E quando nessun fornitore ammesso serve il modello, o manca l'invito: la richiesta non è partita.
    // L'avviso porta il tasto della pagina che la frase nomina (#663, #1344.1).
    const CE = global.SN_CHAT_ERRORS;
    const rimedio = { code: res.errorCode, keyRefused: !!res.keyRefused, reason: res.reason };
    const spiegato = [...((CE && CE.CODICI_GIA_SCRITTI) || ['NO_MODEL_FOR_ACTION', 'NO_ALLOWED_HOST', 'NO_API_KEY']), 'TTS_VOICE_REQUIRED', 'TTS_VOICE_UNKNOWN'];
    if (spiegato.includes(res.errorCode) && res.error) {
      try { Popup.toastErrore('tts_model_fallback_reason', { duration: 9000, rimedio }, String(res.error)); } catch (_) {}
      return;
    }
    // La chiave rifiutata (crediti finiti compresi): il perché in italiano, non «non disponibile ora».
    if (res.keyRefused && CE) {
      const frase = CE.sentence(CE.fromResponse({
        error: res.error, status: res.status, provider: res.provider, userMessage: res.userMessage, keyRefused: true,
      }, ''));
      try { Popup.toastErrore('tts_model_fallback_reason', { duration: 9000, rimedio }, frase); } catch (_) {}
      return;
    }
    const key = res.error === 'no_tts_model' ? 'tts_model_fallback_nokey' : 'tts_model_fallback';
    try { Popup.toastErrore(key); } catch (_) {}
  }

  // Anti-attesa: la prima frase, corta, suona subito mentre le altre si preparano in
  // parallelo; il tempo prima della prima parola crolla.
  async function readAloud(text, tokens) {
    const full = String(text == null ? '' : text);
    if (!full.trim()) return;
    // Due letture sovrapposte sono incomprensibili: prima si ferma quella in corso.
    stopReading();
    const s = newSession();
    Object.assign(s, {
      totale: full.length, letti: 0, pezziModello: 0, ripiego: null, contata: false,
      idConto: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    });
    segnaLettura(s, true);
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
      // Teniamo l'intero esito (non solo null): quando il modello non è
      // disponibile ci serve `error`/`firstFallback` per spiegare all'utente
      // perché la lettura passa alla voce del browser (vedi notifyModelFallback).
      // Una lettura è un uso: lo conta il primo pezzo, gli altri solo se si guastano (#969).
      fetches[ci] = chrome.runtime.sendMessage({ type: MSG.TTS_SYNTH, text: ctext, lang: pageLang(), ...(ci > 0 ? { parteDiUnUso: true } : {}) })
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
        const suonato = await playModelChunk(s, res, chunks[ci]);
        if (!sessionAlive(s)) return;
        if (suonato && chunks[ci].sentito) s.letti = Math.max(s.letti, chunks[ci].end);
        segnaLettura(s, true);
      } else {
        // Dal chunk fallito in poi la voce del browser legge tutto il resto, in un'unica
        // utterance con onboundary.
        s.ripiego = { res };
        segnaLettura(s, true);
        notifyModelFallback(res);
        playBrowserChunk(s, full.slice(chunks[ci].start), chunks[ci].start);
        return;
      }
    }
    if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); contaLettura(s, true); }
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
      azione: 'read-aloud',
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
    return Boolean(global.SN_ASCOLTO && global.SN_ASCOLTO.supportato());
  }

  // Item "Detta": ascolto del microfono + trascrizione in diretta con un
  // modello di dettatura. La freccetta apre la scelta modello, popolata dai
  // modelli del registro che dichiarano di ascoltare un audio.
  // Nella casella di una chat di Filo «Detta» è il suo tasto microfono: ne mostra anche la scorciatoia.
  function buildDictateItem(target) {
    const supported = dictationSupported();
    const Voce = global.SN_VOCE_CHAT;
    return {
      type: 'split',
      icon: '🎤',
      label: I18n.t('menu_dictate'),
      shortcut: Voce && Voce.gestisce(target) ? Voce.etichettaTasto() : undefined,
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
    } catch (_) {
      Popup.toastErrore('err_provider_failed');
      return;
    }
    // Lo stesso avviso delle Opzioni (#1141): il modello resta scelto, ma si sa subito che con lui non parte.
    let avviso = '';
    try {
      const entry = ((deps.getSettings() || {}).modelRegistry || {})[nickname] || {};
      const r = await chrome.runtime.sendMessage({
        type: MSG.AUDIO_HOST_CHECK, action: ACTIONS.TRANSCRIBE_AUDIO, nickname, label: entry.label || nickname,
      });
      avviso = (r && typeof r.warning === 'string' && r.warning) || '';
    } catch (_) {}
    if (avviso) Popup.showToast(`${I18n.t('menu_dictate_model_set')}. ${avviso}`, { duration: 8000 });
    else Popup.showToast(I18n.t('menu_dictate_model_set'));
  }

  // La dettatura in corso col suo riquadro (al più una alla volta): l'ascolto vero è di SN_ASCOLTO.
  let _dictateState = null;
  // Quanti caratteri della frase provvisoria si vedono nel riquadro (la coda: è quella che cambia mentre si parla).
  const DICTATE_LIVE_CHARS = 140;

  async function startDictation() {
    if (_dictateState) { stopDictation(); return; }
    if (!dictationSupported()) {
      Popup.toastErrore('menu_dictate_not_supported');
      return;
    }
    if (!deps.restorePasteContext()) {
      Popup.toastErrore('err_provider_failed');
      return;
    }
    // Nella casella di una chat di Filo dettare è parlare a Filo: stessa strada del tasto microfono, stesso invio.
    const Voce = global.SN_VOCE_CHAT;
    if (Voce && Voce.gestisce(document.activeElement)) { Voce.premi(document.activeElement); return; }

    // Riquadro cliccabile: dice che ascolta, mostra la frase in corso, e al click ferma (il toast non è cliccabile).
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
    // Il fuoco resta al campo anche cliccando la pill: il testo dettato atterra dove stava il cursore
    // (negli editor contenteditable la selezione viva si perde se il fuoco passa a un bottone).
    pill.addEventListener('mousedown', (e) => e.preventDefault());

    const showLive = (text) => {
      const t = String(text || '').trim();
      if (!t) { live.hidden = true; live.textContent = ''; return; }
      live.textContent = t.length > DICTATE_LIVE_CHARS ? '…' + t.slice(-DICTATE_LIVE_CHARS) : t;
      live.hidden = false;
    };
    const state = { pill, sessione: null };
    _dictateState = state;
    const chiudi = () => {
      if (pill.parentNode) Popup.unmountToast(pill);
      if (_dictateState === state) _dictateState = null;
    };
    const sessione = await global.SN_ASCOLTO.avvia({
      provvisorie: true,
      suProvvisoria: showLive,
      // Dove il cursore si trova ADESSO: mentre si detta si può continuare a scrivere o spostarsi nel campo.
      suFrase: (text) => deps.insertDictatedText(text + ' '),
      suStato: (st) => { if (st === 'trascrive') label.textContent = I18n.t('menu_dictate_transcribing'); },
      // Nel campo di una pagina il testo resta dov'è: non c'è un invio da contare.
      suFine: (esito) => { chiudi(); global.SN_ASCOLTO.contaSessione(esito, 'nessuno'); },
    });
    if (!sessione) { chiudi(); return; }
    state.sessione = sessione;
    // Nello stack degli avvisi in pagina (#409), `sticky` perché è l'unico comando per fermare: il tetto
    // dello stack non deve sfrattarlo. Chiuderla è fermare: un microfono acceso senza pill non si fermerebbe più.
    if (_dictateState === state) Popup.mountToast(pill, { sticky: true, chiudi: () => stopDictation() });
    pill.addEventListener('click', () => stopDictation());
  }

  function stopDictation() {
    const st = _dictateState;
    if (!st || !st.sessione) return;
    st.sessione.ferma('utente');
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
