// SINGOLA SORGENTE del recap aggiornamento (popup all'avvio) e del calcolo
// "quante patch sei indietro". Vedi CLAUDE.md → "Patch notes".
//
// Ogni volta che chiudi un fix o aggiungi una feature VISIBILE all'utente,
// aggiungi una riga al blocco della versione corrente (features/fixes), in
// italiano e NON tecnica. Le voci interne (refactor/test/infra) NON vanno qui.
//
// Formato (lista ordinata dalla versione PIÙ RECENTE alla più vecchia):
//   { version: '0.2.50', date: '2026-06-18',
//     features: ['Testo per l’utente…'],
//     fixes: ['Testo per l’utente…'] }

(function (global) {
  'use strict';

  const NOTES = [
    // ↓ Nuove versioni in cima.
    {
      version: '0.2.53', date: '2026-06-18',
      features: [],
      fixes: [
        'L’icona Home del menu del tasto destro ora ti riporta davvero alla home, sostituendo la pagina su cui sei (prima apriva la lista "Aperti per dopo").',
      ],
    },
    {
      version: '0.2.52', date: '2026-06-18',
      features: [
        'Quando attivi la modalità terminale, Filo può svolgere compiti a più passi da solo: esegue un comando, ne legge l’output e prosegue col successivo finché non ha finito, senza che tu debba rilanciarlo ogni volta. Sui comandi rischiosi chiede comunque conferma.',
        'Se ricevi crediti in regalo, Filo te lo comunica con un avviso all’apertura (una volta sola).',
      ],
      fixes: [
        'Concatenare comandi sicuri (come spostarsi in una cartella ed elencarne subito il contenuto) non chiede più la conferma riservata alle azioni irreversibili: la richiesta scatta solo se almeno un comando della sequenza è davvero rischioso.',
      ],
    },
    {
      version: '0.2.51', date: '2026-06-18',
      features: [],
      fixes: [
        'Ora puoi scegliere un modello OpenRouter che legge le immagini (es. una "vision") per la descrizione delle immagini: prima veniva rifiutato anche quando era adatto.',
      ],
    },
    {
      version: '0.2.50', date: '2026-06-17',
      features: [
        'Quando Filo si aggiorna ti mostra un recap delle novità e delle correzioni, con un pulsante per condividerlo.',
        'Quando un tuo feedback viene risolto, Filo ti ringrazia, ti spiega cosa è cambiato e ti premia con crediti in base alla priorità.',
        'Mentre Filo pensa nella nuova scheda, ora scorre il suo ragionamento reale (per i modelli che lo forniscono), non più frasi generiche.',
        'Ora puoi zoomare le pagine web tenendo Ctrl e usando la rotella o pizzicando il trackpad, oppure con Ctrl + / Ctrl - / Ctrl 0.',
      ],
      fixes: [
        'I comandi eseguiti da Filo e le loro risposte ora si vedono sempre, in riquadri ben leggibili: i comandi senza output (come spostarsi tra cartelle) mostrano dove sei finito.',
        'Nelle impostazioni, il menu per scegliere il modello ora ha lo stile di Filo invece dei colori grigi di sistema, coerente con gli altri menu a tendina.',
        'Le schede che riproducono audio ora si riconoscono di nuovo a colpo d’occhio: bagliore del colore del sito e icona dell’altoparlante a fine scheda (prima non comparivano).',
        'Il login con Google (e altri "Continua con…") nei siti aperti in Filo ora funziona: la finestra di accesso non viene più scambiata per un popup pubblicitario e bloccata.',
        'Il correttore ortografico ora suggerisce in italiano e non più parole inglesi a caso sulle parole italiane.',
      ],
    },
    {
      version: '0.2.49', date: '2026-06-17',
      features: [
        'Nuova pagina Crediti nel profilo: vedi il saldo e un grafico di come hai usato i crediti.',
        'Ogni feedback che invii ti regala 5 crediti: le monete volano verso il tuo profilo.',
      ],
      fixes: [],
    },
  ];

  // Confronto versioni stile semver leggero ('0.2.49' vs '0.2.5' → corretto).
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Note delle versioni STRETTAMENTE successive a `lastSeen` (escluso), fino a
  // `current` incluso. Se `lastSeen` è nullo/assente → tutte (primo avvio non
  // mostra nulla a sorpresa: lo decide il chiamante). Ordinate dalla più recente.
  function since(lastSeen, current = latestVersion()) {
    return NOTES
      .filter((n) => cmpVersion(n.version, current) <= 0
        && (!lastSeen || cmpVersion(n.version, lastSeen) > 0))
      .sort((x, y) => cmpVersion(y.version, x.version));
  }

  // Quante "patch" (versioni con note) separano lastSeen da current.
  function countBehind(lastSeen, current = latestVersion()) {
    return since(lastSeen, current).length;
  }

  function latestVersion() {
    return NOTES.length ? NOTES[0].version : '0.0.0';
  }

  global.SN_PATCH_NOTES = { NOTES, cmpVersion, since, countBehind, latestVersion };
})(typeof globalThis !== 'undefined' ? globalThis : self);
