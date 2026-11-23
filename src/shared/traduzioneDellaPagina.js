// La traduzione della pagina chiesta a parole (chat e Aiuto, #504): le risposte che può dare e come si legge «torna
// all'originale», in un posto solo per chi le dà (translatePage.js, page-preload.js, naviga.js) e chi le riferisce.
// Sentinella: tests/unit/traduciPaginaChat.test.mjs (ogni stato scritto da chi risponde sta qui, con tutti i suoi testi).

(function (global) {
  'use strict';

  // Il modello può scrivere il booleano come testo: chat, popup e Aiuto devono capire la stessa cosa.
  function alOriginale(v) {
    return v === true || String(v ?? '').trim().toLowerCase() === 'true';
  }

  const DILLO = ' Dillo all\'utente, e non ripetere l\'azione uguale.';
  const NON_QUI = () => 'traduci la pagina: qui non si può tradurre';

  // `fatta`: la pagina è come l'utente l'ha chiesta, anche se lo era già. `cambiata`: è cambiata davvero (chiude il turno
  // da sé e conta come uso). `aiuto`: la riga nel diario dell'Aiuto; `modello`: quello che la chat rilegge.
  const STATI = Object.freeze({
    partita: Object.freeze({
      fatta: true,
      cambiata: true,
      aiuto: (r) => (r.come === 'ripresa' ? 'traduzione della pagina ripresa da dove si era fermata'
        : r.come === 'nuovo' ? 'traduzione partita sul solo testo comparso dopo' : 'traduzione della pagina partita'),
      modello: (o) => {
        if (o.come === 'ripresa') {
          const quanti = o.mancanti && o.di ? ` (mancavano ${o.mancanti} blocchi su ${o.di})` : '';
          return `Traduzione ripresa da dove si era fermata${quanti}: la parte già tradotta non si rifà. La pagina mostra a che punto è e avvisa quando ha finito.`;
        }
        if (o.come === 'nuovo') return 'Traduzione partita sul solo testo comparso dopo; il resto era già tradotto. La pagina avvisa quando ha finito.';
        return 'Traduzione della pagina partita: la pagina mostra a che punto è e avvisa quando ha finito.';
      },
    }),
    in_corso: Object.freeze({
      fatta: true,
      cambiata: false,
      aiuto: () => 'la pagina si sta già traducendo',
      modello: () => `La pagina si sta già traducendo: niente rilanciato.${DILLO}`,
    }),
    gia_tradotta: Object.freeze({
      fatta: true,
      cambiata: false,
      aiuto: () => 'la pagina è già tradotta tutta',
      modello: () => `La pagina è già tradotta tutta: non c'è altro da tradurre.${DILLO} Per tornare alla lingua originale: scheda(traduci, originale).`,
    }),
    originale: Object.freeze({
      fatta: true,
      cambiata: true,
      aiuto: () => 'pagina rimessa nella lingua originale',
      modello: () => 'Pagina rimessa nella lingua originale.',
    }),
    fermata: Object.freeze({
      fatta: true,
      cambiata: true,
      aiuto: () => 'traduzione fermata, pagina rimessa nella lingua originale',
      modello: () => 'Traduzione fermata a metà e pagina rimessa nella lingua originale.',
    }),
    niente: Object.freeze({
      fatta: true,
      cambiata: false,
      aiuto: () => 'la pagina non era tradotta: è già nella lingua originale',
      modello: () => `La pagina non era tradotta: è già nella lingua originale.${DILLO}`,
    }),
    spento: Object.freeze({
      fatta: false,
      cambiata: false,
      aiuto: NON_QUI,
      modello: () => `Non fatto: Filo è spento su questo sito, e lì non traduce.${DILLO}`,
    }),
    muto: Object.freeze({
      fatta: false,
      cambiata: false,
      aiuto: NON_QUI,
      modello: () => `Non fatto: la pagina davanti non risponde (può essere una pagina di sistema, un PDF, o non aver finito di caricare).${DILLO}`,
    }),
    'no-page': Object.freeze({
      fatta: false,
      cambiata: false,
      aiuto: NON_QUI,
      modello: () => `Non fatto: non c'è nessuna pagina web aperta.${DILLO}`,
    }),
    coperta: Object.freeze({
      fatta: false,
      cambiata: false,
      aiuto: NON_QUI,
      modello: () => `Non fatto: la pagina è coperta dall'avviso di sito pericoloso, e finché l'utente non sceglie lì non si traduce.${DILLO}`,
    }),
  });

  // Una risposta che non si conosce vale «la pagina non risponde»: mai un «fatto» detto a vuoto.
  function stato(s) {
    return typeof s === 'string' && Object.hasOwn(STATI, s) ? s : 'muto';
  }

  global.SN_TRADUZIONE_PAGINA = { STATI, alOriginale, stato };
})(typeof globalThis !== 'undefined' ? globalThis : self);
