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
    if (global.SN_MICROFONO_CORNICE) return Boolean(global.SN_DICTATION_SEGMENTER);
    return typeof window !== 'undefined'
      && Boolean(navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      && Boolean(window.AudioContext || window.webkitAudioContext)
      && Boolean(global.SN_DICTATION_SEGMENTER);
  }

  // `rimedio`: la risposta d'errore del main, quando la frase nomina dove si rimedia (l'avviso porta il tasto, #663).
  function avvisa(frase, rimedio = null) {
    if (!frase) return;
    try { global.SN_POPUP.showToast(frase, { duration: 9000, rimedio }); } catch (_) { console.warn('[Filo voce]', frase); }
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
    // Ricomposta come ogni altra risposta d'errore: col solo codice si perdevano il rifiuto della chiave e la frase
    // che il main scrive sui crediti finiti.
    const motivo = E ? E.friendly(E.fromResponse(res, '')) : '';
    return t('voce_err_trascrizione', motivo || t('voce_riprova'));
  }

  function chiama(fn, ...a) {
    if (typeof fn !== 'function') return;
    try { fn(...a); } catch (e) { console.error('[Filo voce]', e); }
  }

  // Il microfono di questo documento: le pagine di Filo, che non sono un sito a cui dare un permesso.
  async function microfonoQui() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      throw Object.assign(new Error('microfono occupato'), { occupato: true });
    }
    return {
      rate: ctx.sampleRate,
      collega(suCampioni) {
        proc.onaudioprocess = (e) => suCampioni(e.inputBuffer.getChannelData(0));
        source.connect(proc);
        // Lo ScriptProcessor lavora solo collegato all'uscita; non scrivendo nel buffer, dalle casse non esce niente.
        proc.connect(ctx.destination);
      },
      chiudi() {
        try { proc.onaudioprocess = null; proc.disconnect(); source.disconnect(); } catch (_) {}
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      },
    };
  }

  // Su una pagina web ascolta la cornice di Filo e qui arrivano solo i campioni: il sito non riceve mai il microfono,
  // nemmeno durante una dettatura, e Detta funziona anche dove l'utente gliel'ha negato (#586; preload/page-preload.js).
  async function microfonoDellaCornice(cornice) {
    let suCampioni = null; let suChiusa = null;
    const f = await cornice.apri({
      suDati: (x) => { if (suCampioni) suCampioni(x); },
      suFine: () => { if (suChiusa) suChiusa(); },
    });
    return {
      rate: f.rate,
      collega(fn, chiusa) { suCampioni = fn; suChiusa = chiusa; },
      chiudi: f.chiudi,
    };
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
    let mic;
    try {
      mic = global.SN_MICROFONO_CORNICE ? await microfonoDellaCornice(global.SN_MICROFONO_CORNICE) : await microfonoQui();
    } catch (e) {
      avvisa(e && e.occupato ? t('voce_err_mic_occupato') : fraseMicrofono(e));
      return null;
    }
    if (attiva) attiva.ferma('altro');
    const Seg = global.SN_DICTATION_SEGMENTER;

    const lang = op.lang || navigator.language || 'it-IT';
    const s = { fermata: false, frasi: 0, errore: false, annullata: false, inVolo: false, coda: Promise.resolve(), fine: null };
    // Per i contatori (#1467): finché ascolta, il main sa cosa contare se la scheda si chiude. `invioSeLasciata`:
    // l'invio di una dettatura rimasta a metà con delle frasi (di serie nessuno: Detta scrive in un campo).
    const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const inCorso = () => segnaSessione({ frasi: s.frasi, motivo: 'altro', provvisorie: !!op.provvisorie, id },
      s.frasi > 0 ? op.invioSeLasciata || 'nessuno' : 'nessuno');
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
      avvisa(fraseTrascrizione(res), res);
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
          inCorso();
        });
      },
    });

    mic.collega((campioni) => {
      if (s.fermata) return;
      try {
        segmenter.push(Seg.downsample(campioni, mic.rate, RATE));
        const st = segmenter.state();
        chiama(op.suLivello, st.level);
        const fine = op.fineDaSola ? Seg.endOfSpeech(st, op.fineDaSola) : '';
        if (fine) sessione.ferma(fine === 'done' ? 'finito' : 'muto');
      } catch (_) {}
    }, () => {
      // La cornice ha smesso di ascoltare (finestra chiusa, microfono staccato): si dice, non si tace.
      if (s.fermata) return;
      avvisa(t('voce_err_mic_occupato'));
      sessione.ferma('utente');
    });
    const tetto = setTimeout(() => sessione.ferma('tempo'), MAX_MS);

    sessione.ferma = (motivo = 'utente') => {
      if (s.fine) return s.fine;
      s.fermata = true;
      if (motivo === 'annulla') s.annullata = true;
      clearTimeout(tetto);
      try { mic.chiudi(); } catch (_) {}
      // L'ultima frase è definitiva anche senza pausa.
      if (!s.annullata && motivo !== 'errore') { try { segmenter.flush(); } catch (_) {} }
      chiama(op.suLivello, 0);
      chiama(op.suStato, 'trascrive');
      s.fine = s.coda.then(() => {
        if (attiva === sessione) attiva = null;
        if (!s.frasi && !s.errore && !s.annullata && motivo !== 'altro') {
          avvisa(t(motivo === 'muto' ? 'voce_err_muto' : 'voce_vuoto'));
        }
        const esito = { frasi: s.frasi, errore: s.errore, motivo, provvisorie: !!op.provvisorie, id };
        chiama(op.suFine, esito);
        return esito;
      });
      return s.fine;
    };
    attiva = sessione;
    return sessione;
  }

  // Una sessione si conta una volta (#1467), da chi sa che fine ha fatto il testo: `invio` dall'elenco dei contatori
  // (SN_CONTATORI.INVII_DETTATURA). Escono il motivo, quante frasi e l'invio, mai le parole.
  function contaSessione(esito, invio) {
    if (!esito || esito.contata) return;
    esito.contata = true;
    try {
      const r = chrome.runtime.sendMessage({
        type: global.SN_MSG.MSG.CONTATORI_EVENTO, misura: 'dettatura', motivo: esito.motivo, frasi: esito.frasi,
        invio: String(invio || ''), provvisorie: !!esito.provvisorie,
      });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) {}
  }

  global.SN_ASCOLTO = {
    avvia, supportato, fraseMicrofono, fraseTrascrizione, contaSessione,
    attiva: () => attiva,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
