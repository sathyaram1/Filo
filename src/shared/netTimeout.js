// Scadenza delle chiamate di rete lunghe (#520).
//
// PERCHÉ ESISTE
//   `fetch` non ha una scadenza propria: se il server accetta la connessione e
//   poi tace, la promessa non si risolve MAI. Nel percorso dei modelli e in
//   quello dell'archivio carte questo diventa, per l'utente, "l'app si è
//   bloccata e non vedo risposta": la bolla resta su "sta pensando" per sempre,
//   la chat resta occupata e non c'è nessun errore da leggere. Peggio ancora
//   per Scryfall, dove le richieste passano da una coda serializzata: una sola
//   chiamata appesa blocca TUTTE quelle dopo.
//
//   Qui non si accorcia niente: si mette un fondo all'attesa. I tetti sono
//   volutamente larghi (un modello che ragiona può stare zitto a lungo) e
//   servono solo a trasformare un'attesa INFINITA in un errore che si può
//   leggere e in una richiesta che si può rifare.
//
// API
//   SN_NET_TIMEOUT.watch({ stallMs, totalMs, signal })
//     → { signal, touch(), done(), expired }
//       `signal` va passato a fetch; `touch()` rimette a zero il conto dello
//       stallo (è arrivato qualcosa); `done()` spegne i timer; `expired` dice
//       se è scattata la sorveglianza ('stallo' | 'tetto' | '').
//   SN_NET_TIMEOUT.timeoutError(motivo, { provider, cosa })
//     → Error con `code: 'TIMEOUT'` (SN_CHAT_ERRORS lo traduce per l'utente).
//   SN_NET_TIMEOUT.LIMITI — i tetti, sovrascrivibili da variabile d'ambiente
//     nei test (FILO_AI_STALLO_MS, FILO_AI_TETTO_MS, FILO_DATI_TETTO_MS).
//
// Logica quasi pura (AbortController + timer): unit-testabile senza Electron.

(function (global) {
  'use strict';

  function envMs(nome, fallback) {
    try {
      if (typeof process === 'undefined' || !process.env) return fallback;
      const v = Number(process.env[nome]);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    } catch (_) { return fallback; }
  }

  // Tetti in millisecondi. Getter e non costanti: i test li stringono con una
  // variabile d'ambiente invece di aspettare i minuti veri.
  const LIMITI = {
    // Modelli, risposta in streaming: silenzio totale (nessun byte, nemmeno di
    // ragionamento) oltre il quale la chiamata è considerata morta. Due minuti
    // sono abbondanti anche per un modello che pensa a lungo prima di parlare.
    get aiStalloMs() { return envMs('FILO_AI_STALLO_MS', 120_000); },
    // Modelli, tetto duro del singolo tentativo: vale anche per le chiamate
    // NON in streaming, dove la risposta arriva tutta insieme alla fine e non
    // c'è nessun segnale intermedio da sorvegliare. Dieci minuti: nessuna
    // chiamata vera ci arriva, un'attesa infinita sì.
    get aiTettoMs() { return envMs('FILO_AI_TETTO_MS', 600_000); },
    // Archivi di dati (Scryfall): una risposta JSON secca. Venti secondi sono
    // già molto sopra il caso peggiore realistico.
    get datiTettoMs() { return envMs('FILO_DATI_TETTO_MS', 20_000); },
  };

  function timeoutError(motivo, opts) {
    const o = opts || {};
    const cosa = o.cosa ? `${o.cosa}: ` : '';
    const e = new Error(motivo === 'stallo'
      ? `${cosa}nessuna risposta per troppo tempo, attesa interrotta`
      : `${cosa}tempo massimo superato, attesa interrotta`);
    e.code = 'TIMEOUT';
    e.reason = motivo;
    if (o.provider) e.provider = o.provider;
    return e;
  }

  // Sorveglianza di una singola chiamata. Il segnale del chiamante (se c'è)
  // resta valido: quando aborta lui, abortiamo anche noi — ma `expired` resta
  // vuoto, così chi traduce l'errore sa distinguere "l'utente ha interrotto"
  // da "il servizio è morto".
  function watch(opts) {
    const o = opts || {};
    const stallMs = Number(o.stallMs) > 0 ? Number(o.stallMs) : 0;
    const totalMs = Number(o.totalMs) > 0 ? Number(o.totalMs) : 0;
    const esterno = o.signal || null;
    const ac = new AbortController();
    let scattata = '';
    let stallTimer = null;
    let totalTimer = null;

    function spegni() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      if (totalTimer) { clearTimeout(totalTimer); totalTimer = null; }
      if (esterno && typeof esterno.removeEventListener === 'function') {
        try { esterno.removeEventListener('abort', daEsterno); } catch (_) {}
      }
    }

    function daEsterno() {
      spegni();
      try { ac.abort(); } catch (_) {}
    }

    function scatta(motivo) {
      if (scattata) return;
      scattata = motivo;
      spegni();
      try { ac.abort(); } catch (_) {}
    }

    function armaStallo() {
      if (!stallMs || scattata || ac.signal.aborted) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => scatta('stallo'), stallMs);
      if (stallTimer && typeof stallTimer.unref === 'function') stallTimer.unref();
    }

    if (totalMs) {
      totalTimer = setTimeout(() => scatta('tetto'), totalMs);
      if (totalTimer && typeof totalTimer.unref === 'function') totalTimer.unref();
    }
    if (esterno) {
      if (esterno.aborted) daEsterno();
      else if (typeof esterno.addEventListener === 'function') {
        esterno.addEventListener('abort', daEsterno, { once: true });
      }
    }
    armaStallo();

    return {
      signal: ac.signal,
      touch: armaStallo,
      done: spegni,
      get expired() { return scattata; },
    };
  }

  global.SN_NET_TIMEOUT = { watch, timeoutError, LIMITI };
})(typeof globalThis !== 'undefined' ? globalThis : self);
