// Perché qualche scheda resta aperta dopo una chiusura in blocco (#413, #1695): il conto per motivo e la frase, uguali
// nel diario della chat e nell'avviso di «Chiudi le altre schede». Logica pura. Regole: tests/unit/restanoAperte.test.mjs.

(function (global) {
  'use strict';

  const PERCHE = {
    testo: (n) => (n === 1 ? 'una resta aperta col testo non inviato' : `${n} restano aperte col testo non inviato`),
    sempre: (n) => (n === 1 ? 'una resta aperta, è di un sito tenuto sempre aperto' : `${n} restano aperte, sono di siti tenuti sempre aperti`),
    nuova: (n) => (n === 1 ? 'una aperta dopo la richiesta resta' : `${n} aperte dopo la richiesta restano`),
    chiusa: (n) => (n === 1 ? 'una era già chiusa' : `${n} erano già chiuse`),
  };

  // Dai motivi, uno per scheda rimasta, a { restano, restanoPer }; vuoto se non ne resta nessuna.
  function conto(motivi) {
    const lista = Array.isArray(motivi) ? motivi : [];
    if (!lista.length) return {};
    const restanoPer = {};
    for (const m of lista) restanoPer[m] = (restanoPer[m] || 0) + 1;
    return { restano: lista.length, restanoPer };
  }

  // Da { restano, restanoPer } alla frase, senza maiuscola né punto: chi la usa la mette nella sua.
  function frase(o) {
    const r = Number(o && o.restano) || 0;
    if (!r) return '';
    const per = o.restanoPer && typeof o.restanoPer === 'object' ? o.restanoPer : null;
    const parti = per ? Object.keys(PERCHE).filter((k) => Number(per[k]) > 0).map((k) => PERCHE[k](Number(per[k]))) : [];
    return parti.length ? parti.join(', ') : (r === 1 ? 'una resta aperta' : `${r} restano aperte`);
  }

  const api = { conto, frase };
  global.SN_RESTANO_APERTE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
