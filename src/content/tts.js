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
// Dettatura — il microfono viene ascoltato a blocchi e spezzato in frasi
// (SN_DICTATION_SEGMENTER): ogni frase chiusa da una pausa va al modello di
// trascrizione e il testo entra nel campo; nel frattempo la frase in corso si
// vede, provvisoria, nel riquadro rosso. Nessuna registrazione da fermare e
// aspettare: si parla, e il testo arriva.
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

  // ─── Evidenziazione della parola letta (CSS Custom Highlight API) ──────────
  //
  // Usiamo la Highlight API (CSS.highlights + ::highlight()) invece di avvolgere
  // le parole in <span>: NON modifica il DOM della pagina (niente layout rotto,
  // niente reflow, funziona anche su pagine React). Registriamo un Range sulla
  // parola corrente sotto il nome 'filo-reading' e lo stiliamo via CSS.
  const HL_NAME = 'filo-reading';
  const hlSupported = typeof CSS !== 'undefined'
    && CSS.highlights && typeof window.Highlight === 'function';

  // Token (parole) della lettura corrente: { text, start, end, range }.
  // start/end sono offset di carattere nel testo letto; range è il Range DOM.
  let readTokens = [];
  let hlIndex = -1;
  let lastScrollMs = 0;

  function ensureReadStyle() {
    if (!hlSupported) return;
    if (document.getElementById('sn-read-style')) return;
    const st = document.createElement('style');
    st.id = 'sn-read-style';
    global.SN_FILO_UI?.mark(st);
    // color-mix con l'accent del tema (con fallback letterale se il token manca,
    // es. pagine senza theme.css). ::highlight accetta solo poche proprietà:
    // background-color/color/text-decoration sono tra queste.
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

  // Se la parola corrente è fuori dallo schermo, scorri (con parsimonia: al più
  // ogni 400ms, e solo 'nearest' per non strappare la pagina sotto l'utente).
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

  // Costruisce il "modello di lettura" dalla selezione corrente: il testo da
  // leggere + i token-parola con i loro Range DOM (per l'evidenziazione).
  // Cattura i Range AL MOMENTO della costruzione del menu, quando la selezione
  // esiste ancora. Ritorna null se non c'è una selezione testuale.
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
      // Separatore tra nodi adiacenti così parole di blocchi diversi non si
      // fondono ("Ciao"+"mondo"). Lo spazio non appartiene ad alcuno span:
      // i token (run di non-spazi) non lo includono mai.
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

  // Sessione di lettura: ogni readAloud ne apre una nuova; stopReading marca
  // cancellata quella corrente. Gli step async controllano sessionAlive() per
  // non continuare una lettura che l'utente ha fermato (o sostituito).
  let session = null;
  function newSession() {
    session = { id: ((session && session.id) || 0) + 1, cancelled: false };
    return session;
  }
  function sessionAlive(s) { return session === s && !s.cancelled; }

  // Audio in riproduzione dalla sintesi vocale a modello. A livello di modulo
  // così stopReading() può fermarlo e il menu sa se sta "leggendo".
  let ttsAudio = null;

  function ttsBusy() {
    if (ttsAudio && !ttsAudio.paused && !ttsAudio.ended) return true;
    const synth = ttsSupported() ? window.speechSynthesis : null;
    return !!(synth && (synth.speaking || synth.pending));
  }

  // ─── Stato lettura condiviso tra le schede ────────────────────────────────
  // La lettura suona nella scheda dove è partita, ma l'utente vuole poterla
  // fermare anche stando in un'altra scheda. Per questo segnaliamo al main
  // l'avvio/arresto (reportReadingState) e riceviamo da lui un flag globale
  // (globalReading) che dice se QUALCHE scheda sta leggendo. Il menu usa
  // isAnyReading() = lettura locale OPPURE lettura altrove.
  let reportedReading = false; // ultimo stato segnalato al main (dedup)
  let globalReading = false;   // qualche scheda (anche un'altra) sta leggendo
  function reportReadingState(active) {
    if (active === reportedReading) return;
    reportedReading = active;
    try { chrome.runtime.sendMessage({ type: MSG.TTS_READING_STATE, reading: active }); } catch (_) {}
  }
  // Lettura attiva dal punto di vista del menu: locale o in un'altra scheda.
  function isAnyReading() {
    return ttsBusy() || globalReading;
  }
  // Ferma la lettura ovunque sia: quella locale subito, e — se sta leggendo
  // un'altra scheda — chiede al main di inoltrare lo stop a tutte le schede.
  function requestStopReading() {
    stopReading();
    try { chrome.runtime.sendMessage({ type: MSG.TTS_STOP_READING }); } catch (_) {}
  }
  // Broadcast in arrivo dal main (instradati da content.js).
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

  // Incapsula PCM 16-bit little-endian mono (quello che torna il modello di
  // lettura, audio/pcm;rate=24000) in un WAV riproducibile da <audio>. Ritorna
  // un blob URL.
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

  // Fallback voce-del-browser per una porzione di testo. `utterText` è il testo
  // pronunciato; `baseChar` è l'offset di quel testo nel testo letto completo
  // (per mappare l'onboundary ai token globali quando il fallback parte a metà).
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
    // La voce del browser dà tempi ESATTI per parola (onboundary) → evidenzia
    // con precisione, a differenza dell'audio del modello (solo stima).
    if (readTokens.length) {
      u.onboundary = (e) => {
        if (!sessionAlive(s)) return;
        if (e.name && e.name !== 'word') return;
        setHighlight(Chunk.charIndexToToken(readTokens, baseChar + (e.charIndex || 0)));
      };
    }
    u.onend = () => { if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); } };
    // Se la voce del browser fallisce, la lettura finisce comunque: non lasciamo
    // lo stato "sta leggendo" appeso (le altre schede mostrerebbero uno stop
    // morto). NON azzeriamo l'evidenziazione qui: in ambienti senza voci di
    // sistema 'error' scatta subito e cancellerebbe l'evidenziazione della prima
    // parola appena impostata (che è il segnale visibile che la lettura è
    // partita) — la pulizia avviene comunque allo stop o alla fine reale.
    u.onerror = () => { if (sessionAlive(s)) reportReadingState(false); };
    synth.speak(u);
  }

  // Riproduce un chunk già sintetizzato dal modello. Durante la riproduzione
  // stima la parola corrente (frazione di durata → token) e la evidenzia.
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

  // Avvisa (una sola volta per sessione dell'app — la deduplica vive nel main,
  // via `firstFallback`) che la lettura a voce naturale del modello non è
  // disponibile e sta subentrando la voce del browser. Serve a spiegare
  // "modello impostato ma lettura automatica": il ripiego resta silenzioso e
  // grazioso (la lettura parte comunque), ma la PRIMA volta diciamo perché, così
  // l'utente sa se deve intervenire (es. manca la chiave per la voce a modello).
  function notifyModelFallback(res) {
    if (!res || !res.firstFallback) return;      // deduplicato dal main
    if (!ttsSupported()) return;                 // playBrowserChunk mostrerà già tts_not_supported
    // Nessun modello impostato per la lettura (o la scorciatoia citata non
    // esiste): il messaggio arriva già scritto per l'utente e dice dove si
    // imposta — mostrarlo com'è vale molto più di una frase generica.
    if (res.errorCode === 'NO_MODEL_FOR_ACTION' && res.error) {
      try { Popup.showToast(I18n.t('tts_model_fallback_reason', String(res.error))); } catch (_) {}
      return;
    }
    const key = res.error === 'no_tts_model' ? 'tts_model_fallback_nokey' : 'tts_model_fallback';
    try { Popup.showToast(I18n.t(key)); } catch (_) {}
  }

  // Lettura ad alta voce. Strategia anti-attesa: il testo viene spezzato in
  // frasi (chunk); la prima — corta — viene sintetizzata e suonata subito,
  // mentre le successive si preparano in parallelo. Così il tempo prima della
  // PRIMA parola crolla rispetto a sintetizzare tutto in un colpo solo. La
  // parola in corso viene evidenziata sulla pagina (se `tokens` è presente).
  async function readAloud(text, tokens) {
    const full = String(text == null ? '' : text);
    if (!full.trim()) return;
    // Ferma un'eventuale lettura in corso: due letture sovrapposte sono
    // incomprensibili (stopReading apre la strada e azzera lo stato).
    stopReading();
    const s = newSession();
    // Segnala al main che questa scheda sta leggendo: le altre schede mostreranno
    // "Interrompi lettura" finché non arriva il reading:false (sotto).
    reportReadingState(true);
    readTokens = Array.isArray(tokens) ? tokens.slice() : [];
    ensureReadStyle();
    // Feedback immediato: evidenzia la prima parola appena si parte.
    if (readTokens.length) setHighlight(0);
    try {
      document.dispatchEvent(new CustomEvent('filo:read-aloud', { detail: { text: full.trim() } }));
    } catch (_) {}

    // Chunk in base ai token (frasi); senza token, un chunk unico (niente
    // evidenziazione, from=-1).
    const chunks = readTokens.length
      ? Chunk.chunkTokens(readTokens, {})
      : [{ from: -1, to: -1, start: 0, end: full.length }];

    // Prefetch dell'audio del modello per chunk (al più corrente + successivo
    // in volo). La cache nel main rende istantanei i chunk già letti.
    const fetches = new Array(chunks.length);
    const startFetch = (ci) => {
      if (ci < 0 || ci >= chunks.length || fetches[ci]) return;
      const c = chunks[ci];
      const ctext = full.slice(c.start, c.end);
      // Teniamo l'intero esito (non solo null): quando il modello non è
      // disponibile ci serve `error`/`firstFallback` per spiegare all'utente
      // perché la lettura passa alla voce del browser (vedi notifyModelFallback).
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
        // Modello non disponibile/fallito da qui in poi → voce del browser per
        // tutto il testo rimanente (un'unica utterance con onboundary). Se
        // l'utente aveva un modello di lettura impostato, glielo diciamo: senza
        // avviso "modello impostato ma lettura automatica" resta un mistero.
        notifyModelFallback(res);
        playBrowserChunk(s, full.slice(chunks[ci].start), chunks[ci].start);
        return;
      }
    }
    if (sessionAlive(s)) { clearHighlight(); reportReadingState(false); }
  }

  // Voce di menu "Leggi ad alta voce" sul testo selezionato. Mentre una
  // lettura è in corso non la riproponiamo qui: lo stop è una voce globale
  // presente in QUALSIASI menu (vedi buildStopReadingItem in buildMenuItems),
  // così "ferma" è sempre raggiungibile, anche senza selezione.
  //
  // Cattura QUI il modello di lettura (testo + Range delle parole) perché la
  // selezione esiste ancora alla costruzione del menu; al click potrebbe non
  // esserci più. Se la cattura fallisce, si legge comunque il testo (senza
  // evidenziazione).
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

  // Voce "Interrompi lettura": compare in ogni menu mentre la sintesi vocale
  // sta riproducendo, indipendentemente dal contesto cliccato.
  function buildStopReadingItem() {
    const Icons = global.SN_ICONS;
    return { type: 'item', icon: Icons.stopReading(18), label: I18n.t('menu_stop_reading'), onClick: () => requestStopReading() };
  }

  // Lingua del testo che si legge: quella dichiarata dalla pagina, altrimenti
  // quella dell'app. Sceglie la voce del modello (salvo una voce fissata in
  // Preferenze).
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

  // Item "Detta": ascolto del microfono + trascrizione in diretta con un
  // modello di dettatura. La freccetta apre la scelta modello, popolata dai
  // modelli del registro che dichiarano di ascoltare un audio.
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
    // Il campo può contenere più nickname (fallback): il "corrente" mostrato
    // come selezionato è il primario (il primo della lista).
    const current = C.parseModelRefs ? (C.parseModelRefs(currentRaw)[0] || currentRaw) : currentRaw;
    const Caps = global.SN_MODEL_CAPS;
    const items = [];
    for (const [nickname, entry] of Object.entries(registry)) {
      if (!entry) continue;
      const checked = nickname === current;
      // Solo i modelli che dichiarano di ascoltare un audio (la voce del
      // registro lo dice, o il nome lo lascia capire: whisper, asr…). Un
      // modello di chat qui non funzionerebbe. Quello scelto resta in lista
      // comunque, così si vede cos'è impostato.
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
  // Frequenza a cui si manda l'audio al modello: per la voce basta e tiene
  // gli spezzoni piccoli (~32 KB al secondo).
  const DICTATE_RATE = 16000;
  // Quanti caratteri della frase provvisoria si vedono nel riquadro (la coda:
  // è quella che cambia mentre si parla).
  const DICTATE_LIVE_CHARS = 140;

  // Perché la dettatura non è partita, detto all'utente. Un errore di
  // CONFIGURAZIONE dei modelli (nessun modello per questa funzione, o «solo
  // pesi aperti» senza un modello che ascolti) arriva già spiegato e va
  // mostrato com'è: dice cosa fare per rimetterla in piedi.
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
      // ScriptProcessor: deprecato ma disponibile ovunque e senza file esterni
      // (un AudioWorklet vorrebbe un modulo caricato da un URL, che un content
      // script non ha). 4096 campioni ≈ 85 ms a 48 kHz: latenza trascurabile.
      proc = ctx.createScriptProcessor(4096, 1, 1);
    } catch (_) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { if (ctx) ctx.close(); } catch (_) {}
      Popup.showToast(I18n.t('err_provider_failed'));
      return;
    }
    const lang = navigator.language || 'it-IT';

    // Riquadro cliccabile: dice che ascolta, mostra la frase in corso, e al
    // click ferma (il toast non è cliccabile).
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
    // Non rubare il focus/caret al campo quando l'utente clicca la pill per
    // fermare: così il cursore resta dove l'utente stava scrivendo e il testo
    // dettato ci atterra sopra (vale soprattutto per gli editor contenteditable,
    // dove la selezione viva va persa se il focus passa a un bottone).
    pill.addEventListener('mousedown', (e) => e.preventDefault());
    // Nello stack degli avvisi in pagina (#409), così non finisce sotto o sopra
    // un toast che arriva nel frattempo. `sticky`: è l'unico comando per
    // fermare la dettatura, il tetto dello stack non deve poterlo sfrattare.
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
      // Frase in corso: trascrizione provvisoria, solo nel riquadro. Una alla
      // volta: se la precedente è ancora in volo, si salta questo giro.
      onInterim: (seg) => {
        if (state.interimBusy || state.stopped || state.failed) return;
        state.interimBusy = true;
        transcribe(seg, true)
          .then((res) => { if (res?.ok && !state.stopped) showLive(res.text); })
          .catch(() => {})
          .finally(() => { state.interimBusy = false; });
      },
      // Frase chiusa da una pausa: trascrizione definitiva, nel campo. In
      // coda, una alla volta, così il testo entra nell'ordine in cui è stato
      // detto anche se una risposta è più lenta dell'altra.
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
          // Inserisci dove il cursore si trova ADESSO, non dove era all'apertura
          // del menu: mentre si detta l'utente può aver continuato a scrivere
          // o spostato il cursore nello stesso campo.
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
    // Lo ScriptProcessor lavora solo se è collegato all'uscita; non scrivendo
    // nulla nel buffer di uscita, dalle casse non esce niente.
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
    // Una scheda appena aperta potrebbe non aver mai ricevuto il broadcast
    // "sta leggendo" (la lettura era già partita altrove prima che esistesse):
    // chiediamo lo stato corrente al main così il menu mostra subito "Interrompi
    // lettura" anche qui.
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
