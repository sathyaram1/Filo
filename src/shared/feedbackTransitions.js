// Macchina a stati dei feedback: le TABELLE come DATI, fonte di verità singola.
// La dashboard le legge via feedbackStatus.js; il server le INCORPORA al deploy,
// quindi cambia comportamento solo al rideploy. SOLO DATI: le funzioni stanno altrove.

(function (global) {
  'use strict';

  // Stati canonici, lista CHIUSA (FEEDBACK-STATES.md §2).
  // La presentazione sta in feedbackStatus.js, che verifica di coprire ESATTAMENTE questa.
  const STATUSES = [
    'unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned',
    'todo', 'working', 'revision_capability', 'revision_security', 'done',
    'archived', 'attack_confirmed', 'spam_confirmed',
  ];

  const ACTORS = ['owner', 'pipeline', 'routine'];

  // Transizioni legali: from → { to: [attori] }. 'pipeline' è l'UNICO che esce da `unlabeled`,
  // 'owner' l'unico che esce dalla revisione umana. Coppia assente = transizione ILLEGALE.
  const TRANSITIONS = {
    unlabeled: {
      suspicious_file: ['pipeline'], // gate file (corre prima dei giudici)
      attack:          ['pipeline'],
      spam:            ['pipeline'],
      design:          ['pipeline'],
      todo:            ['pipeline'], // sicuro + automatica ON (letta al giudizio)
      aligned:         ['pipeline'], // sicuro + automatica OFF
    },
    suspicious_file: {
      todo:             ['owner'],
      attack_confirmed: ['owner'],
      spam_confirmed:   ['owner'],
      archived:         ['owner'],
    },
    attack: {
      attack_confirmed: ['owner'],
      todo:             ['owner'],   // falso positivo
      unlabeled:        ['pipeline'], // mittente fidato flaggato per errore → ri-giudizio
    },
    spam: {
      spam_confirmed: ['owner'],
      todo:           ['owner'],
      unlabeled:      ['pipeline'],
    },
    design: {
      todo:     ['owner'],  // l'owner risponde in chat e rimette in coda
      archived: ['owner'],  // oppure decide che non si fa
    },
    aligned: {
      todo:     ['owner'],  // approvazione manuale (anche bulk)
      archived: ['owner'],  // un doppione, o una cosa che non si farà: si chiude qui, senza approvarla prima
    },
    todo: {
      working: ['routine'], // presa in carico (il semaforo lo tiene il server)
      design:  ['routine'], // la routine ha domande → chat + statusReason clarify
      // Niente passo diretto todo→done: le chiusure manuali restano legali come CATENA di passi,
      // che canReach attraversa.
    },
    working: {
      revision_capability: ['routine'], // fix pronto su branch
      design:              ['routine'], // domande a metà lavorazione
      // Arenato: il ramo fermo da un'ora torna in coda da solo (FEEDBACK-STATES.md §6a).
      // Alla terza volta va in `design`.
      todo:                ['routine'],
    },
    revision_capability: {
      revision_security: ['routine'], // PASS verifica comportamentale
      design:            ['routine'], // fail cap raggiunto → statusReason loop
    },
    revision_security: {
      done:   ['routine'], // PASS secaudit + merge-gate fonde su main
      design: ['routine'], // FAIL fixer-loop → statusReason loop
      // Conflitto di fusione: non è una bocciatura di qualità, il ramo torna in lavorazione
      // per il riallineamento. Senza questa riga il giro moriva alla consegna, rifiutato.
      revision_capability: ['routine'],
    },
    done: {
      archived: ['owner'],  // verifica umana ok
      todo:     ['owner'],  // "manca qualcosa" → riapertura
    },
    archived: {
      todo: ['owner'],      // ripristino
    },
    attack_confirmed: {
      todo: ['owner'],      // "era legittimo"
    },
    spam_confirmed: {
      todo: ['owner'],
    },
  };

  // SICUREZZA: gli stati «beccati» DEVONO collassare sui valori dei feedback normali, o chi
  // legge senza chiave fa hill-climbing. Su 'open', mai 'closed' (premia) né un valore nuovo.
  const PUBLIC_MAP = {
    unlabeled: 'open', suspicious_file: 'open', attack: 'open', spam: 'open',
    design: 'open', aligned: 'open', todo: 'open', working: 'open',
    revision_capability: 'open', revision_security: 'open',
    done: 'closed', archived: 'closed',
    attack_confirmed: 'open', spam_confirmed: 'open',
  };

  // Lunghezza fissa dello status cifrato (#476): la cifratura non imbottisce, e contare i
  // caratteri equivale a leggerlo. La misura è larga apposta e cambiarla non rompe i vecchi.
  const CIPHER_PAD = 32;

  // I NUMERI li detta l'owner dalla dashboard e li applica il SERVER: nessun default qui,
  // o la verifica locale userebbe numeri diversi. Le regole stanno in verifierRound.js.
  const VERIFIER_CAP_KEYS = ['cap2', 'cap1', 'cap0'];
  global.SN_FB_TRANSITIONS = {
    STATUSES, ACTORS, TRANSITIONS, PUBLIC_MAP, CIPHER_PAD, VERIFIER_CAP_KEYS,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
