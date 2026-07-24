// Formattazione dei tempi/durate — logica pura, condivisa (IIFE su globalThis).
//
// Due esigenze diverse:
//  - `fmtCountdown`  → conto alla rovescia "da orologio" nella card del timer.
//    Sotto l'ora resta M:SS; da un'ora in su passa a H:MM:SS così un timer di
//    2 ore mostra "2:00:00" e non "120:00" (#323).
//  - `fmtDurationLabel` → etichetta umana per il chip di conferma in chat.
//    Non arrotonda ai minuti: un "timer di 30 secondi" resta "30 sec" e non
//    "0 min" (#323). Compone ore/minuti/secondi con abbreviazioni.

(function (global) {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');

  // Scompone secondi (>=0) in { h, m, s } interi.
  function parts(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return {
      h: Math.floor(sec / 3600),
      m: Math.floor((sec % 3600) / 60),
      s: sec % 60,
    };
  }

  // Conto alla rovescia stile orologio: M:SS oppure H:MM:SS quando c'è almeno
  // un'ora. Sempre >= "0:00".
  function fmtCountdown(totalSeconds) {
    const { h, m, s } = parts(totalSeconds);
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
  }

  // Etichetta durata leggibile: "30 sec", "45 min", "1 min 30 sec", "2 h",
  // "1 h 30 min". Mostra al massimo due unità (dalla più grande presente) e non
  // perde mai la componente sotto il minuto per durate brevi.
  function fmtDurationLabel(totalSeconds) {
    const { h, m, s } = parts(totalSeconds);
    if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
    if (m > 0) return s > 0 ? `${m} min ${s} sec` : `${m} min`;
    return `${s} sec`;
  }

  global.SN_TIME = { fmtCountdown, fmtDurationLabel };
})(typeof globalThis !== 'undefined' ? globalThis : self);
