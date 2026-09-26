// Quanto ci si fida di chi ha scritto una cosa che Filo ha letto (#536).
// Non decide niente da solo: serve a sapere se un compito è CONTAMINATO.
// Regole e racconto: patterns/un-secondo-modello-guarda-il-testo-prima-dellutente.md

(function (global) {
  'use strict';

  // Dalla più fidata alla meno: un compito vale quanto la sua fonte peggiore,
  // quindi «più bassa» vuol dire «più avanti qui».
  const SCALA = ['utente', 'filo', 'sito', 'messaggio'];

  // Da dove in giù il compito ha letto testo di qualcun altro, che poteva
  // avere interesse a parlare all'utente con la voce di Filo.
  const PRIMA_CONTAMINATA = SCALA.indexOf('sito');

  const ETICHETTE = {
    utente: 'te',
    filo: 'Filo',
    sito: 'una pagina web',
    messaggio: 'un messaggio ricevuto',
  };

  // Una classe sconosciuta vale come la peggiore: una fonte che nessuno ha
  // classificato non è fidata solo perché il suo nome manca dalla lista.
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

  // Quanto vale un tipo di contenuto esterno (`SN_ESTERNO.TIPI`). Chi non è
  // nominato qui vale come la classe peggiore: un tipo nuovo di contenuto
  // esterno nasce contaminato, e chi lo aggiunge non deve ricordarsi di
  // scriverlo anche qui perché la protezione lo copra.
  const CLASSE_DEL_TIPO = {
    RICERCA_WEB: 'sito',
    ELEMENTO_PAGINA: 'sito',
    DATI_PAGINA: 'sito',
    TESTO_IN_PAGINA: 'sito',
    OUTLINE_PAGINA: 'sito',
    ISTRUZIONI_SITO: 'sito',
    DATI_LINK: 'sito',
    CONVERSAZIONE_ARCHIVIATA: 'sito',
  };

  function classeDeiTipi(tipi) {
    const list = Array.isArray(tipi) ? tipi : [tipi];
    if (!list.length) return 'utente';
    return piuBassa(list.map((t) => CLASSE_DEL_TIPO[String(t || '')] || 'messaggio'));
  }

  function etichetta(classe) {
    return ETICHETTE[normalizza(classe)] || ETICHETTE.messaggio;
  }

  global.SN_FIDUCIA = {
    SCALA, normalizza, rango, piuBassa, contaminata, etichetta,
    CLASSE_DEL_TIPO, classeDeiTipi,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
