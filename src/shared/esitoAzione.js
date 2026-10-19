// Com'è andata un'azione di Filo: la risposta sta qui e solo qui, perché il
// diario in diretta e la conversazione riaperta giorni dopo devono raccontare
// la stessa cosa. Regole e casi limite: tests/unit/esitoAzione.test.mjs.

(function (global) {
  'use strict';

  // chiesto  — Filo ha chiesto conferma e l'utente non ha ancora risposto
  // proposto — tocca all'utente finirla, col bottone in chat
  // compiuto — l'utente l'ha finita lui, cliccando
  // fallito  — non è successo niente
  // fatto    — riuscita
  const CHIESTO = 'chiesto';
  const PROPOSTO = 'proposto';
  const COMPIUTO = 'compiuto';
  const FALLITO = 'fallito';
  const FATTO = 'fatto';
  const TUTTI = [CHIESTO, PROPOSTO, COMPIUTO, FALLITO, FATTO];

  function esitoAzione(a) {
    if (!a) return FALLITO;
    const o = (a && a._output) || null;
    if (a._confirm) return CHIESTO;
    if (o && o.fatto) return COMPIUTO;
    if (o && o.proposta) return PROPOSTO;
    if (a._executed === false) return FALLITO;
    // Un comando della finestra che non ha mosso niente (la home chiesta dalla
    // home): il sistema lo segna eseguito, ma raccontarlo come fatto mente.
    if (o && o.already) return FALLITO;
    return FATTO;
  }

  // Un esito che il riassunto può nominare. «Conferma chiesta» e i fallimenti
  // hanno la loro riga nel diario, ma in cima non si contano: «Ha cambiato
  // un'impostazione» su un'impostazione non cambiata è una bugia.
  function conta(esito) {
    return esito === FATTO || esito === PROPOSTO || esito === COMPIUTO;
  }

  function valido(esito) {
    return TUTTI.includes(String(esito || ''));
  }

  // Le azioni di un turno archiviato, sempre nella stessa forma. Le chat
  // salvate prima che l'esito esistesse tengono il solo nome dell'azione: lì
  // non c'è modo di sapere com'è andata, e «fatto» è quello che si leggeva già.
  function voci(azioni) {
    if (!Array.isArray(azioni)) return [];
    return azioni.map((x) => (typeof x === 'string'
      ? { type: x, esito: FATTO }
      : { type: String((x && x.type) || ''), esito: valido(x && x.esito) ? x.esito : FATTO }))
      .filter((v) => v.type);
  }

  global.SN_ESITO = { esitoAzione, conta, valido, voci, CHIESTO, PROPOSTO, COMPIUTO, FALLITO, FATTO };
})(typeof globalThis !== 'undefined' ? globalThis : self);
