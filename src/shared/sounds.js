// Suoni dell'interfaccia (toni sintetici, nessun file audio).
// Punto unico: Preferenze (anteprima), notifiche della shell e suoneria di
// timer e sveglie suonano gli stessi motivi. Chi lo carica trova `SN_SOUNDS`.
(function (global) {
  'use strict';

  // Sequenze [frequenzaHz, durataMs]; freq 0 = pausa. Gli stessi quattro
  // motivi della suoneria del timer, riusati per le notifiche.
  const TONES = {
    default: [[880, 150], [0, 80], [880, 150], [0, 80], [880, 150], [0, 400]],
    gentle:  [[523, 200], [0, 100], [659, 200], [0, 100], [784, 300], [0, 600]],
    urgent:  [[1047, 80], [0, 50], [1047, 80], [0, 50], [1047, 80], [0, 50],
              [1047, 80], [0, 50], [1047, 80], [0, 300]],
    chime:   [[1046, 120], [0, 60], [1318, 120], [0, 60], [1568, 120], [0, 60],
              [2093, 200], [0, 700]],
  };
  const TONE_IDS = Object.keys(TONES);

  // Etichette leggibili (per i <select> delle Preferenze).
  const TONE_LABELS = {
    default: 'Standard',
    gentle: 'Delicata',
    urgent: 'Urgente',
    chime: 'Carillon',
  };

  // Volume come percentuale 0-100 (100 = il livello di sempre). L'utente lo
  // cambia in Preferenze: una sveglia al mattino e un timer in cucina non
  // vogliono la stessa voce, e a 0 la suoneria resta muta di proposito.
  const GUADAGNO_PIENO = 0.35;
  const VOLUME_PIENO = 100;
  function guadagno(volume) {
    const v = Number.isFinite(Number(volume)) ? Number(volume) : VOLUME_PIENO;
    return GUADAGNO_PIENO * Math.min(1, Math.max(0, v / VOLUME_PIENO));
  }

  let _ctx = null;
  function ctx() {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    return _ctx;
  }

  // Note già programmate sulla linea del tempo dell'AudioContext: tenerne il
  // riferimento è l'unico modo di zittire SUBITO quando l'utente preme Ferma.
  let _live = [];
  let _ringTone = null;
  let _ringVolume = VOLUME_PIENO;
  let _ringTimer = null;

  function durataMs(toneId) {
    const notes = TONES[toneId] || TONES.default;
    let ms = 0;
    for (const [, d] of notes) ms += d;
    return ms;
  }

  // Programma `ripetizioni` giri del motivo in CODA a quanto già programmato
  // (`daQuando`), mai da adesso: un lotto che ricomincia da capo mentre il
  // precedente non è finito fa suonare due copie della stessa suoneria insieme.
  // Ritorna il momento in cui la coda finisce.
  function programma(c, toneId, ripetizioni, daQuando, volume) {
    const notes = TONES[toneId] || TONES.default;
    const picco = guadagno(volume);
    // A volume zero non si programma niente: un guadagno 0 farebbe esplodere la
    // rampa esponenziale, che di zero non sa che farsene.
    if (picco <= 0) {
      let fine = Math.max(c.currentTime, Number(daQuando) || 0);
      for (let i = 0; i < ripetizioni; i++) for (const [, d] of notes) fine += d / 1000;
      return fine;
    }
    let t = Math.max(c.currentTime, Number(daQuando) || 0);
    for (let i = 0; i < ripetizioni; i++) {
      for (const [freq, durMs] of notes) {
        if (freq > 0) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(picco, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000 - 0.01);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(t);
          osc.stop(t + durMs / 1000);
          _live.push(osc);
          osc.onended = () => { const i2 = _live.indexOf(osc); if (i2 >= 0) _live.splice(i2, 1); };
        }
        t += durMs / 1000;
      }
    }
    return t;
  }

  // Riproduce un tono una volta. Non lancia mai (audio non disponibile/headless =
  // no-op silenzioso). Ritorna true se la riproduzione è stata avviata.
  function play(toneId, volume) {
    try {
      const c = ctx();
      if (!c) return false;
      const start = () => { programma(c, toneId, 1, 0, volume); };
      if (c.state === 'suspended') c.resume().then(start).catch(() => {});
      else start();
      return true;
    } catch (_) {
      return false;
    }
  }

  // Quanta suoneria programmiamo in un colpo solo. Un timer che scade con Filo
  // ridotto a icona suona in una pagina NASCOSTA, dove i setTimeout vengono
  // strozzati a uno al minuto: la linea del tempo dell'AudioContext no, quindi
  // un lotto lungo continua a suonare anche se il rifornimento arriva tardi.
  const LOTTO_MS = 60000;

  // Suoneria insistente: va avanti finché non si chiama silence(). Idempotente
  // sullo stesso tono (la ripetizione del broadcast non la fa ripartire da capo).
  function ring(toneId, volume) {
    const id = TONES[toneId] ? toneId : 'default';
    const vol = Number.isFinite(Number(volume)) ? Number(volume) : VOLUME_PIENO;
    // Il volume entra nel confronto: cambiarlo mentre suona deve sentirsi, e
    // senza questo la ripetizione del broadcast lo ignorerebbe.
    if (_ringTone === id && _ringVolume === vol) return true;
    silence();
    try {
      const c = ctx();
      if (!c) return false;
      _ringTone = id;
      _ringVolume = vol;
      const giro = Math.max(1, durataMs(id));
      const ripetizioni = Math.max(1, Math.ceil(LOTTO_MS / giro));
      let fine = 0;
      const lotto = () => {
        if (_ringTone !== id) return;
        fine = programma(c, id, ripetizioni, fine, vol);
        _ringTimer = global.setTimeout(lotto, Math.round(giro * ripetizioni * 0.8));
      };
      if (c.state === 'suspended') c.resume().then(lotto).catch(() => {});
      else lotto();
      return true;
    } catch (_) {
      _ringTone = null;
      return false;
    }
  }

  // Zittisce la suoneria adesso, comprese le note già programmate.
  function silence() {
    _ringTone = null;
    _ringVolume = VOLUME_PIENO;
    if (_ringTimer) { try { global.clearTimeout(_ringTimer); } catch (_) {} }
    _ringTimer = null;
    for (const osc of _live.slice()) { try { osc.stop(); } catch (_) {} }
    _live = [];
  }

  // Stato dell'AudioContext ('running', 'suspended', null se non c'è audio):
  // è l'unico modo, in un test, di distinguere "suona" da "ho chiamato play".
  function state() { return _ctx ? _ctx.state : null; }

  const isRinging = () => _ringTone !== null;

  global.SN_SOUNDS = {
    TONES, TONE_IDS, TONE_LABELS, VOLUME_PIENO, play, ring, silence, isRinging, state,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
