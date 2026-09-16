// #155 — logica PURA del ricalcolo della home (firma degli input + scheduler throttle/coalesce); il cablaggio a memoria, LLM e broadcast sta in handlers.js.
// Rigenerare il messaggio a ogni nuova scheda era una chiamata all'LLM bloccante: la scheda serve SEMPRE la cache e il ricalcolo va in background solo se gli input cambiano davvero, uno ogni N minuti, accorpando le modifiche nel mezzo.

(function (global) {
  'use strict';

  // Hash stabile e veloce (djb2): non serve robustezza crittografica, basta che cambi quando cambia l'input.
  function hash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Solo gli input che DETERMINANO il messaggio. Esclude i campi temporali (ora, countdown, «X min fa»): cambiano di continuo e farebbero ricalcolare per niente.
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
      // Fascia GROSSOLANA: il saluto si rinfresca durante la giornata ma al massimo una volta per fascia. NON usare ora o minuto esatti.
      `part:${inputs.partOfDay || ''}`,
      // Feriale/weekend: il tono cambia, ma sempre coarse, nessun churn.
      `day:${inputs.dayType || ''}`,
      // La home cita il giorno reale della settimana: senza la data «oggi è martedì» resterebbe in cache anche di mercoledì. Cambia una volta al giorno.
      `date:${inputs.dateKey || ''}`,
    ];
    return hash(parts.join('\n##\n'));
  }

  // Garanzie: un `run()` ogni `minIntervalMs` al massimo; le richieste durante l'attesa si accorpano (vince il contesto più recente); quelle arrivate durante un run ne fanno partire un altro dopo, con lo stesso intervallo.
  // Dipendenze iniettate per l'orologio finto dei test: now(), setTimer(fn, ms) → handle, clearTimer(handle), run(context) (può essere async).
  function createScheduler({ minIntervalMs, now, setTimer, clearTimer, run }) {
    let lastRunAt = -Infinity; // così il primissimo run può partire subito
    let timer = null;
    let running = false;
    let pending = false;       // c'è almeno una richiesta in attesa di un run
    let latestContext = null;  // contesto più recente da passare a run()

    function arm() {
      if (timer || running || !pending) return;
      const wait = Math.max(0, minIntervalMs - (now() - lastRunAt));
      timer = setTimer(fire, wait);
    }

    async function fire() {
      timer = null;
      if (running) return;       // safety: non sovrapporre run
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
      // `context` è tenuto come «ultimo vincente».
      request(context) {
        latestContext = context;
        pending = true;
        arm();
      },
      // Un run avvenuto fuori dallo scheduler (es. il primo caricamento sincrono) conta comunque per il throttle del prossimo.
      markRan() { lastRunAt = now(); },
      // Introspezione per i test.
      _state() { return { running, pending, armed: !!timer, lastRunAt }; },
    };
  }

  global.SN_DASHBOARD_REFRESH = { computeSignature, createScheduler, hash };
})(typeof globalThis !== 'undefined' ? globalThis : self);
