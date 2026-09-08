// Chi ha disegnato questo pezzo di pagina: il sito o Filo?
//
// Sulle pagine web Filo aggiunge roba SUA dentro al DOM del sito — menu del
// tasto destro, avvisi, popup, barra laterale, riquadri di conferma. Chi
// cammina sulla pagina per lavorarci (oggi "Traduci la pagina", e la sentinella
// che si accorge del testo arrivato dopo) deve poterla riconoscere e lasciarla
// stare: è già scritta nella lingua dell'utente, e tradurla vorrebbe dire
// pagare il modello per riscrivere il proprio menu.
//
// La risposta la dà un MARCHIO messo nel momento in cui l'elemento nasce, non
// il suo nome. Indovinarla dal nome — "comincia per sn- o per filo-" — sbaglia
// su siti veri: i portali costruiti con ServiceNow chiamano `sn-qualcosa` ogni
// loro pezzo, e "filo" è una parola italiana normale in un nome di classe. Su
// quei siti interi riquadri restavano in lingua originale sotto un avviso che
// dichiarava la pagina tradotta (#407): la stessa bugia da cui nasce la
// segnalazione. Un marchio che scriviamo noi non può collidere con niente.
//
// Regola per chi aggiunge UI a una pagina web: marca la RADICE del pezzo che
// attacchi al documento (chi cammina si ferma lì e non scende oltre), subito,
// nella stessa funzione che la crea.
//
//   SN_FILO_UI.mark(el)     → marca (ritorna l'elemento, si incatena)
//   SN_FILO_UI.is(el)       → è la radice di un pezzo di UI di Filo?
//   SN_FILO_UI.inside(el)   → sta dentro (o è) un pezzo di UI di Filo?
//   SN_FILO_UI.aperti()     → le radici NOSTRE attaccate al documento adesso
//
// L'attributo e l'elenco rispondono a due domande diverse, e la differenza è
// tutta nel mittente. Chi cammina sulla pagina chiede «questo pezzo lo salto?»:
// lì l'attributo basta, e se un sito se lo mette addosso l'unico effetto è che
// il suo testo non viene tradotto. Chi decide se un tasto era nostro chiede
// «questo pezzo l'ho disegnato IO?»: lì l'attributo non vale niente, perché il
// documento è del sito e un attributo se lo scrive anche lui. Un sito che si
// marcava un elemento invisibile e se lo toglieva a ogni Esc si teneva
// l'utente dentro allo schermo intero a tempo indeterminato (#514). L'elenco
// vive qui dentro, nel mondo isolato dei content script, e ci finisce solo chi
// passa da `mark()`: dalla pagina non ci si arriva.

(function (global) {
  'use strict';

  // `data-sn-ui`: un attributo, non una classe. Le classi le tocca anche il
  // sito (un framework che rifà la lista delle classi cancellerebbe il
  // marchio), e un attributo `data-` non entra in nessun foglio di stile.
  const ATTR = 'data-sn-ui';
  const SELECTOR = '[' + ATTR + ']';

  // Le radici che abbiamo disegnato noi, in ordine di nascita. Non è una WeakSet
  // perché va PERCORSA: la domanda è «quali di queste sono ancora attaccate?».
  const nostre = new Set();
  // Tetto di sicurezza: `mark()` arriva anche prima che l'elemento sia
  // attaccato, quindi la potatura non può guardare `isConnected` qui. Si tiene
  // il numero sotto controllo buttando le più vecchie, che è la direzione
  // sicura: una radice dimenticata vale «non è successo niente», mai «è
  // successo qualcosa».
  const TETTO = 256;

  function mark(el) {
    try { if (el && el.setAttribute) el.setAttribute(ATTR, '1'); } catch (_) {}
    try {
      if (el) {
        nostre.add(el);
        while (nostre.size > TETTO) nostre.delete(nostre.values().next().value);
      }
    } catch (_) {}
    return el;
  }

  // Quelle attaccate al documento adesso. Non si pota qui: `mark()` arriva anche
  // un istante prima dell'inserimento, e una potatura fatta in mezzo butterebbe
  // via un riquadro che stava per nascere. A tenere corto l'elenco pensa il
  // tetto di `mark()`.
  function aperti() {
    const vive = [];
    try {
      for (const el of nostre) if (el && el.isConnected) vive.push(el);
    } catch (_) {}
    return vive;
  }

  function is(el) {
    try { return !!(el && el.getAttribute && el.getAttribute(ATTR) !== null); } catch (_) { return false; }
  }

  // Anche gli antenati: un nodo che compare in fondo a un nostro popup è
  // nostro quanto il popup. `closest` si ferma al confine di un componente
  // isolato, che è esattamente ciò che vogliamo — dentro lo shadow di un
  // riquadro di Filo la radice marcata è l'host, e chi cammina non ci entra.
  function inside(el) {
    try {
      if (is(el)) return true;
      return !!(el && el.closest && el.closest(SELECTOR));
    } catch (_) { return false; }
  }

  global.SN_FILO_UI = { ATTR, SELECTOR, mark, is, inside, aperti };
})(typeof globalThis !== 'undefined' ? globalThis : self);
