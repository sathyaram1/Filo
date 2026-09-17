// Logica pura del ricalcolo della home: firma degli input e scheduler throttle/coalesce.
// Il cablaggio a memoria, LLM e broadcast sta in handlers.js.
// La scheda serve SEMPRE la cache: si ricalcola in background solo se gli input cambiano.

(function (global) {
  'use strict';

  // djb2: non serve robustezza crittografica, basta che cambi quando cambia l'input.
  function hash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Solo gli input che DETERMINANO il messaggio.
  // Fuori i campi temporali (ora, countdown, «X min fa»): farebbero ricalcolare per niente.
  function computeSignature(inputs = {}) {
    const list = (arr) => (Array.isArray(arr) ? arr : []).map((x) => String(x)).join('|');
    const parts = [
      inputs.profilo || '',
      inputs.preferenze || '',
      inputs.espansioni || '',
      inputs.lezioni || '',
      list(inputs.noteIds),
      list(inputs.notificaIds),
      list(inputs.salvatiUrls),
      list(inputs.timerIds),
      `tabs:${inputs.openTabsCount || 0}`,
      // Fascia GROSSOLANA, mai ora o minuto esatti: il saluto si rinfresca una volta per fascia.
      `part:${inputs.partOfDay || ''}`,
      // Feriale/weekend: il tono cambia, ma sempre coarse, nessun churn.
      `day:${inputs.dayType || ''}`,
      // La home cita il giorno: senza la data, «oggi è martedì» resterebbe in cache di mercoledì.
      `date:${inputs.dateKey || ''}`,
    ];
    return hash(parts.join('\n##\n'));
  }

  // Un `run()` ogni `minIntervalMs`; le richieste in attesa si accorpano, vince l'ultima.
  // Le dipendenze (orologio, timer) sono iniettate perché i test usino un orologio finto.
  function createScheduler({ minIntervalMs, now, setTimer, clearTimer, run }) {
    let lastRunAt = -Infinity; // così il primissimo run può partire subito
    let timer = null;
    let running = false;
    let pending = false;
    let latestContext = null;

    function arm() {
      if (timer || running || !pending) return;
      const wait = Math.max(0, minIntervalMs - (now() - lastRunAt));
      timer = setTimer(fire, wait);
    }

    async function fire() {
      timer = null;
      if (running) return;
      pending = false;
      running = true;
      const ctx = latestContext;
      lastRunAt = now();
      try {
        await run(ctx);
      } finally {
        running = false;
        if (pending) arm();
      }
    }

    return {
      request(context) {
        latestContext = context;
        pending = true;
        arm();
      },
      // Un run fatto fuori dallo scheduler conta comunque per il throttle del prossimo.
      markRan() { lastRunAt = now(); },
      // Introspezione per i test.
      _state() { return { running, pending, armed: !!timer, lastRunAt }; },
    };
  }

  global.SN_DASHBOARD_REFRESH = { computeSignature, createScheduler, hash };
})(typeof globalThis !== 'undefined' ? globalThis : self);
