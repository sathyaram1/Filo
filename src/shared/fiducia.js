// Quanto ci si fida di chi ha scritto una cosa che Filo ha letto (#536).
// Non decide niente da solo: serve a sapere se un compito è CONTAMINATO.
// Regole e racconto: patterns/un-secondo-modello-guarda-il-testo-prima-dellutente.md

(function (global) {
  'use strict';

  // Dalla più fidata alla meno. L'ordine è la scala: un compito vale quanto la
  // sua fonte peggiore, quindi «più bassa» vuol dire «più avanti in questa
  // lista».
  const SCALA = ['utente', 'filo', 'sito', 'messaggio'];

  // Da dove in giù un compito è contaminato: ha letto testo che ha scritto
  // qualcun altro, e quel qualcuno poteva avere interesse a parlare all'utente
  // con la voce di Filo.
  const PRIMA_CONTAMINATA = SCALA.indexOf('sito');

  const ETICHETTE = {
    utente: 'te',
    filo: 'Filo',
    sito: 'una pagina web',
    messaggio: 'un messaggio ricevuto',
  };

  // Una classe che non conosciamo vale come la peggiore: una fonte nuova che
  // nessuno ha classificato non può passare per fidata solo perché il suo nome
  // non è in questa lista.
  function rango(classe) {
    const i = SCALA.indexOf(String(classe || ''));
    return i < 0 ? SCALA.length - 1 : i;
  }

  function normalizza(classe) {
    return SCALA[rango(classe)];
  }

  // La classe più bassa fra quelle passate. Senza fonti il compito è pulito:
  // chi non ha letto niente non ha letto niente di ostile.
  function piuBassa(classi) {
    const list = Array.isArray(classi) ? classi : [classi];
    if (!list.length) return 'utente';
    let peggio = 0;
    for (const c of list) peggio = Math.max(peggio, rango(c));
    return SCALA[peggio];
  }

  function contaminata(classe) {
    return rango(classe) >= PRIMA_CONTAMINATA;
  }

  function etichetta(classe) {
    return ETICHETTE[normalizza(classe)] || ETICHETTE.messaggio;
  }

  global.SN_FIDUCIA = { SCALA, normalizza, rango, piuBassa, contaminata, etichetta };
})(typeof globalThis !== 'undefined' ? globalThis : this);
