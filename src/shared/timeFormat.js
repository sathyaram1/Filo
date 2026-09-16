// Tempi e durate, logica pura (IIFE su globalThis). Da un'ora in su il conto alla
// rovescia passa a H:MM:SS (non «120:00») e le durate brevi non si arrotondano ai
// minuti: un timer di 30 secondi resta «30 sec», non «0 min» (#323).

(function (global) {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');

  function parts(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return {
      h: Math.floor(sec / 3600),
      m: Math.floor((sec % 3600) / 60),
      s: sec % 60,
    };
  }

  // Mai sotto «0:00».
  function fmtCountdown(totalSeconds) {
    const { h, m, s } = parts(totalSeconds);
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
  }

  // Al massimo due unità, dalla più grande presente, senza mai perdere la
  // componente sotto il minuto.
  function fmtDurationLabel(totalSeconds) {
    const { h, m, s } = parts(totalSeconds);
    if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
    if (m > 0) return s > 0 ? `${m} min ${s} sec` : `${m} min`;
    return `${s} sec`;
  }

  global.SN_TIME = { fmtCountdown, fmtDurationLabel };
})(typeof globalThis !== 'undefined' ? globalThis : self);
