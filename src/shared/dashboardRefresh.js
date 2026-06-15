// #155 — logica PURA per il ricalcolo della schermata home (dashboard).
//
// Problema: aprire una nuova scheda rigenerava il messaggio della home con una
// chiamata all'LLM, bloccante e lenta. Soluzione: la nuova scheda serve SEMPRE
// la versione in cache (istantanea) e il ricalcolo avviene in BACKGROUND solo
// quando gli input del prompt cambiano davvero (nuove lezioni/memorie, appunti,
// pagine salvate, notifiche, numero di tab aperte), con un tetto di massimo un
// ricalcolo ogni N minuti e accorpando tutte le modifiche arrivate nel mezzo.
//
// Qui vive solo la logica testabile a parte (firma degli input + scheduler
// throttle/coalesce). Il cablaggio a memoria/LLM/broadcast sta in handlers.js.

(function (global) {
  'use strict';

  // Hash stabile e veloce (djb2) → stringa corta. Non serve robustezza
  // crittografica: ci basta che cambi quando cambia l'input.
  function hash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Firma degli input che DETERMINANO il messaggio della home. Volutamente
  // esclude i campi temporali (ora corrente, countdown dei timer, "X min fa"):
  // quelli cambiano di continuo e farebbero ricalcolare per niente. Include solo
  // ciò che il feedback elenca come motivo di ricalcolo.
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
    ];
    return hash(parts.join('\n##\n'));
  }

  // Scheduler throttle + coalesce.
  //
  // Garanzie:
  //   - al massimo un `run()` ogni `minIntervalMs`;
  //   - le richieste arrivate mentre si attende vengono ACCORPATE in un solo
  //     run (si tiene il contesto più recente, passato a `run`);
  //   - se durante un run arrivano altre richieste, ne parte un altro DOPO,
  //     rispettando di nuovo l'intervallo.
  //
  // Dipendenze iniettate (testabilità con orologio finto):
  //   now()                 → timestamp in ms
  //   setTimer(fn, ms)      → ritorna un handle
  //   clearTimer(handle)
  //   run(context)          → esegue il ricalcolo vero (può essere async)
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
        // Richieste arrivate durante il run: ne pianifichiamo un altro.
        if (pending) arm();
      }
    }

    return {
      // Segnala che gli input potrebbero essere cambiati: accoda un run
      // (coalescente). `context` viene tenuto come "ultimo vincente".
      request(context) {
        latestContext = context;
        pending = true;
        arm();
      },
      // Marca un run già avvenuto fuori dallo scheduler (es. il primo caricamento
      // sincrono): conta per il throttle del prossimo ricalcolo in background.
      markRan() { lastRunAt = now(); },
      // Introspezione per i test.
      _state() { return { running, pending, armed: !!timer, lastRunAt }; },
    };
  }

  global.SN_DASHBOARD_REFRESH = { computeSignature, createScheduler, hash };
})(typeof globalThis !== 'undefined' ? globalThis : self);
