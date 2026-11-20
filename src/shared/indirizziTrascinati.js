// L'indirizzo che un trascinamento porta (text/uri-list): il primo vero, saltando le righe di commento; senza elenco il
// testo. Più di uno arriva solo da altre app, e Chrome apre il primo. Lo usano la fila delle schede e la barra dei siti.

(function (global) {
  'use strict';

  function primo(uriList, testo = '') {
    for (const riga of String(uriList || '').split(/\r?\n/)) {
      const r = riga.trim();
      if (r && !r.startsWith('#')) return r;
    }
    return String(testo || '').trim();
  }

  global.SN_INDIRIZZI_TRASCINATI = { primo };
})(typeof globalThis !== 'undefined' ? globalThis : self);
