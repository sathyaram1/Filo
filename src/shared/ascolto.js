// Il microfono di Filo: ascolta, spezza in frasi (SN_DICTATION_SEGMENTER), le fa trascrivere dal main e le consegna.
// Lo usano «Detta» (src/content/tts.js) e il tasto microfono delle chat (voceChat.js); ogni guasto lo dice qui, mai in silenzio.
// Regole: patterns/voce-dettatura-e-vettori-passano-dal-router-come-le-chat.md.

(function (global) {
  'use strict';
  // Caricato sia dalla pagina sia dal preload: la seconda volta non deve dimenticare la sessione aperta.
  if (global.SN_ASCOLTO) return;

  // Al modello basta la voce a 16 kHz, e gli spezzoni restano piccoli (~32 KB al secondo).
  const RATE = 16000;
  const MAX_MS = 5 * 60 * 1000;
  // Errori di configurazione dei modelli: arrivano già scritti per l'utente e dicono cosa fare.
  const SPIEGATI = ['NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL', 'NO_ALLOWED_HOST'];

  let attiva = null;

  function t(k, ...a) {
    const I = global.SN_I18N;
    return I ? I.t(k, ...a) : k;
  }

  function supportato() {
    return typeof window !== 'undefined'
      && Boolean(navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      && Boolean(window.AudioContext || window.webkitAudioContext)
      && Boolean(global.SN_DICTATION_SEGMENTER);
  }

  function avvisa(frase) {
    if (!frase) return;
    try { global.SN_POPUP.showToast(frase, { duration: 9000 }); } catch (_) { console.warn('[Filo voce]', frase); }
  }

  // Il posto dove si dà il permesso cambia col sistema.
  function fraseMicrofono(err) {
    const nome = String((err && err.name) || '');
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(nome)) return t('voce_err_mic_assente');
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(nome)) return t('voce_err_mic_occupato');
    const sistema = global.SN_TASTI ? global.SN_TASTI.piattaforma() : '';
    const dove = sistema === 'darwin' ? t('voce_dove_mac') : sistema === 'win32' ? t('voce_dove_windows') : t('voce_dove_linux');
    return t('voce_err_mic_negato', dove);
  }

  function fraseTrascrizione(res) {
    if (res && res.error && SPIEGATI.includes(res.code)) return res.error;
    const E = global.SN_CHAT_ERRORS;
    const motivo = E ? E.friendly({ message: (res && res.error) || '', code: res && res.code }) : '';
    return t('voce_err_trascrizione', motivo || t('voce_riprova'));
  }

  function chiama(fn, ...a) {
    if (typeof fn !== 'function') return;
    try { fn(...a); } catch (e) { console.error('[Filo voce]', e); }
  }

  // op: provvisorie (frasi a metà, costano), fineDaSola ({ silenceMs, waitMs }: chi ha finito di parlare),
  //     lang, suLivello(0..1), suProvvisoria(testo), suFrase(testo), suStato('trascrive'), suFine({ frasi, errore, motivo }).
  // → la sessione ({ ferma(motivo) }) o null se non è partita (e l'utente sa già perché).
  // motivo: 'utente' | 'finito' | 'muto' | 'tempo' | 'errore' | 'altro' (ne parte un'altra) | 'annulla' (butta il resto).
  async function avvia(op = {}) {
    if (attiva) attiva.ferma('altro');
    if (!supportato()) { avvisa(t('menu_dictate_not_supported')); return null; }
    const { ACTIONS } = global.SN_CONST;
    const { MSG } = global.SN_MSG;
    let stream;
    try {
      // Il microfono lo chiede Filo, non il sito: senza lasciapassare la domanda uscirebbe col nome del sito.
      try { await chrome.runtime.sendMessage({ type: MSG.PERMESSO_FILO, tipo: 'media' }); } catch (_) {}
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      avvisa(fraseMicrofono(e));
      return null;
    }
    if (attiva) attiva.ferma('altro');
    const Seg = global.SN_DICTATION_SEGMENTER;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx; let source; let proc;
    try {
      ctx = new Ctx();
      source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor: un AudioWorklet vorrebbe un modulo caricato da un URL, che un content script non ha.
      proc = ctx.createScriptProcessor(4096, 1, 1);
      // Un contesto nato «sospeso» (politica di autoplay) non manderebbe nessun campione.
      try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (_) {}
    } catch (_) {
      try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
      try { if (ctx) ctx.close(); } catch (_) {}
      avvisa(t('voce_err_mic_occupato'));
      return null;
    }

    const lang = op.lang || navigator.language || 'it-IT';
    const s = { fermata: false, frasi: 0, errore: false, annullata: false, inVolo: false, coda: Promise.resolve(), fine: null };
    const manda = (seg, interim) => chrome.runtime.sendMessage({
      type: MSG.AI_REQUEST,
      action: ACTIONS.TRANSCRIBE_AUDIO,
      payload: {
        audioBase64: Seg.bytesToBase64(Seg.pcm16ToWav(Seg.floatToInt16(seg.samples), seg.sampleRate)),
        format: 'wav', lang, interim,
      },
    });
    const sessione = {};
    // Il primo guasto ferma tutto e si dice una volta: le frasi dopo non avrebbero dove andare.
    const guasto = (res) => {
      if (s.errore || s.annullata) return;
      s.errore = true;
      avvisa(fraseTrascrizione(res));
      sessione.ferma('errore');
    };

    const segmenter = Seg.createSegmenter({
      sampleRate: RATE,
      interimEveryMs: op.provvisorie ? 1200 : Number.POSITIVE_INFINITY,
      onInterim: op.provvisorie ? (seg) => {
        if (s.inVolo || s.fermata || s.errore) return;
        s.inVolo = true;
        manda(seg, true)
          .then((res) => {
            if (res && res.ok) { if (!s.fermata) chiama(op.suProvvisoria, String(res.text || '').trim()); }
            // Un errore di configurazione non passa da sé: si dice subito, non a fine frase.
            else if (res && SPIEGATI.includes(res.code)) guasto(res);
          })
          .catch(() => {})
          .finally(() => { s.inVolo = false; });
      } : null,
      // In coda, una alla volta: il testo entra nell'ordine in cui è stato detto.
      onFinal: (seg) => {
        s.coda = s.coda.then(async () => {
          if (s.errore || s.annullata) return;
          let res = null;
          try { res = await manda(seg, false); } catch (_) { res = null; }
          if (s.annullata) return;
          if (!res || !res.ok) { guasto(res); return; }
          const testo = String(res.text || '').trim();
          if (!testo) return;
          s.frasi++;
          chiama(op.suProvvisoria, '');
          chiama(op.suFrase, testo);
        });
      },
    });

    proc.onaudioprocess = (e) => {
      if (s.fermata) return;
      try {
        segmenter.push(Seg.downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate, RATE));
        const st = segmenter.state();
        chiama(op.suLivello, st.level);
        const fine = op.fineDaSola ? Seg.endOfSpeech(st, op.fineDaSola) : '';
        if (fine) sessione.ferma(fine === 'done' ? 'finito' : 'muto');
      } catch (_) {}
    };
    source.connect(proc);
    // Lo ScriptProcessor lavora solo collegato all'uscita; non scrivendo nel buffer, dalle casse non esce niente.
    proc.connect(ctx.destination);
    const tetto = setTimeout(() => sessione.ferma('tempo'), MAX_MS);

    sessione.ferma = (motivo = 'utente') => {
      if (s.fine) return s.fine;
      s.fermata = true;
      if (motivo === 'annulla') s.annullata = true;
      clearTimeout(tetto);
      try { proc.onaudioprocess = null; proc.disconnect(); source.disconnect(); } catch (_) {}
      try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
      try { ctx.close(); } catch (_) {}
      // L'ultima frase è definitiva anche senza pausa.
      if (!s.annullata && motivo !== 'errore') { try { segmenter.flush(); } catch (_) {} }
      chiama(op.suLivello, 0);
      chiama(op.suStato, 'trascrive');
      s.fine = s.coda.then(() => {
        if (attiva === sessione) attiva = null;
        if (!s.frasi && !s.errore && !s.annullata && motivo !== 'altro') {
          avvisa(t(motivo === 'muto' ? 'voce_err_muto' : 'voce_vuoto'));
        }
        const esito = { frasi: s.frasi, errore: s.errore, motivo };
        chiama(op.suFine, esito);
        return esito;
      });
      return s.fine;
    };
    attiva = sessione;
    return sessione;
  }

  global.SN_ASCOLTO = {
    avvia, supportato, fraseMicrofono, fraseTrascrizione,
    attiva: () => attiva,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
