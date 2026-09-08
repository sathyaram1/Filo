// Da quanto si sta aspettando, in parole (#520).
//
// PERCHÉ ESISTE
//   Le chat di Filo sono più di una (la home, i mazzi) e aspettano tutte la
//   stessa cosa: una risposta del modello che può tardare. La prima verifica di
//   #520 ha trovato il cronometro e il bottone «Interrompi» solo nella chat dei
//   mazzi: nella home, che è la prima in cui si scrive, l'attesa restava muta.
//   Due chat che mostrano la stessa attesa devono mostrarla allo stesso modo,
//   quindi la regola sta qui una volta sola (vedi
//   patterns/sezioni-con-lo-stesso-nome-una-regola-sola-e-la-regola.md).
//
// API
//   SN_ATTESA.etichetta(startedAt, adesso?) → '' | '12s' | '2m 05s'
//     Sotto la soglia non scrive niente: una risposta rapida non ha bisogno di
//     un cronometro, e un numero che lampeggia per due secondi è rumore.
//     Oltre il minuto e mezzo i secondi nudi si leggono male ("137s"): minuti
//     e secondi.
//   SN_ATTESA.SOGLIA_MS      — sotto questa attesa non si scrive niente
//   SN_ATTESA.INTERVALLO_MS  — ogni quanto ridisegnare il cronometro
//   SN_ATTESA.TESTO_INTERROTTA — cosa dice la chat quando l'utente ha fermato
//     l'attesa. Non è un errore del servizio e non va scritto come tale.
//
// Logica PURA: unit-testabile senza Electron.

(function (global) {
  'use strict';

  const SOGLIA_MS = 5000;
  const INTERVALLO_MS = 1000;
  const TESTO_INTERROTTA = 'Attesa interrotta. Riprova quando vuoi.';

  function etichetta(startedAt, adesso) {
    const t0 = Number(startedAt);
    if (!Number.isFinite(t0) || t0 <= 0) return '';
    const ora = Number.isFinite(Number(adesso)) && Number(adesso) > 0 ? Number(adesso) : Date.now();
    const ms = ora - t0;
    if (!(ms >= SOGLIA_MS)) return '';
    const s = Math.floor(ms / 1000);
    if (s < 90) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }

  global.SN_ATTESA = { etichetta, SOGLIA_MS, INTERVALLO_MS, TESTO_INTERROTTA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
