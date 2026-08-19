// Macchina a stati dei feedback — le TABELLE, promosse a DATI.
//
// FONTE DI VERITÀ SINGOLA (SPEC-RIDISEGNO-MAX.md §7): queste tabelle vivevano
// in DUE copie a mano — la dashboard qui, il server in filo-security — e due
// copie che divergono sono peggio di una sola permissiva: la dashboard mostra
// una regola e il server ne applica un'altra. Da qui in avanti:
//   - la dashboard le LEGGE da questo file (via src/shared/feedbackStatus.js,
//     che espone l'API canTransition/canReach/… e resta identico per i
//     chiamanti);
//   - il server le INCORPORA AL DEPLOY: filo-security/functions/tools/
//     bake-shared.js legge questo file dal checkout pubblico e genera
//     functions/src/routine/stateMachine.data.js. Il comportamento del server
//     cambia solo al rideploy, che è lo stesso livello di fiducia di prima.
//
// SOLO DATI: niente funzioni, niente stato. Le funzioni stanno in
// feedbackStatus.js (dashboard) e stateMachine.js (server).
//
// Pattern IIFE su globalThis: vedi CLAUDE.md → convenzione dei moduli shared.

(function (global) {
  'use strict';

  // ── Stati canonici (lista CHIUSA — FEEDBACK-STATES.md §2) ──────────────────
  // L'ordine è quello storico della tabella; la presentazione (tab, colori,
  // etichette) resta in feedbackStatus.js, che verifica di coprire ESATTAMENTE
  // questa lista.
  const STATUSES = [
    'unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned',
    'todo', 'working', 'revision_capability', 'revision_security', 'done',
    'archived', 'attack_confirmed', 'spam_confirmed',
  ];

  const ACTORS = ['owner', 'pipeline', 'routine'];

  // ── Transizioni legali (FEEDBACK-STATES.md §3) ─────────────────────────────
  // from → { to: [attori autorizzati] }. Attori:
  //   'owner'    dashboard di gestione (solo l'owner fa uscire dagli stati di
  //              revisione umana);
  //   'pipeline' filo-security (giudici + gate file): è l'UNICO che fa uscire
  //              da `unlabeled`;
  //   'routine'  routine Claude via canale autenticato (iter di lavorazione).
  // Una coppia (from,to) assente = transizione ILLEGALE: il writer la rifiuta.
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
      todo: ['owner'],      // approvazione manuale (anche bulk)
    },
    todo: {
      working: ['routine'], // presa in carico (il semaforo lo tiene il server)
      design:  ['routine'], // la routine ha domande → chat + statusReason clarify
      // NB: il passo diretto todo→done (attore routine) è stato RITIRATO col
      // ridisegno (SPEC-RIDISEGNO-MAX.md §1): esisteva per il pianificatore che
      // spezzava le spec in sotto-feedback, che non esiste più. Le chiusure
      // manuali senza branch (npm run feedback -- <id> done --come-routine)
      // restano legali come CATENA di passi (canReach attraversa l'iter).
    },
    working: {
      revision_capability: ['routine'], // fix pronto su branch
      design:              ['routine'], // domande a metà lavorazione
      todo:                ['routine'], // TTL 60min scaduto → riconciliazione
    },
    revision_capability: {
      revision_security: ['routine'], // PASS verifica comportamentale
      design:            ['routine'], // fail cap raggiunto → statusReason loop
    },
    revision_security: {
      done:   ['routine'], // PASS secaudit + merge-gate fonde su main
      design: ['routine'], // FAIL fixer-loop → statusReason loop
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

  // ── statusPublic (S1.F2.1): enum grossolano IN CHIARO ──────────────────────
  // Sta accanto allo status fine (eventualmente cifrato).
  // ⚠️ SICUREZZA: tutti gli stati "beccati" (attack/spam/suspicious_file e i
  // confermati) DEVONO collassare sugli stessi valori dei feedback normali —
  // mai un valore distinto, o chi legge Firestore senza chiave riconosce un
  // attacco intercettato e fa hill-climbing.
  //
  // MA NON BASTA COLLASSARE: conta SU QUALE valore (#476). I confermati stavano
  // su 'closed', lo stesso dei risolti — che di per sé non dice niente, se non
  // fosse che 'closed' non è un'etichetta passiva: è il grilletto di due cose
  // che l'attaccante VEDE.
  //   1. il popup delle ricompense premia i feedback 'closed' → chi manda un
  //      attacco riceve 50 crediti e la notifica "risolto";
  //   2. la sanificazione per la bacheca pubblica lavora i feedback 'closed' →
  //      il feedback dell'attaccante finisce in vetrina (a pagamento).
  // Cioè gli confermavamo il colpo, e lo pagavamo pure.
  //
  // I confermati stanno quindi su 'open': per chi li ha mandati restano per
  // sempre "in lavorazione", che è il silenzio. Nessun valore nuovo — quello
  // sarebbe di nuovo un segnale, solo con un altro nome.
  const PUBLIC_MAP = {
    unlabeled: 'open', suspicious_file: 'open', attack: 'open', spam: 'open',
    design: 'open', aligned: 'open', todo: 'open', working: 'open',
    revision_capability: 'open', revision_security: 'open',
    done: 'closed', archived: 'closed',
    attack_confirmed: 'open', spam_confirmed: 'open',
  };

  // ── Lunghezza fissa dello status cifrato (#476) ────────────────────────────
  // La cifratura non imbottisce: contare i caratteri del campo cifrato equivale
  // a leggerlo. Prima di cifrare, lo status va portato a questa lunghezza fissa
  // con spazi in coda (padForCipher in feedbackStatus.js / stateMachine.js).
  // La misura è larga: tiene i canonici (il più lungo è 19), i legacy ritirati
  // e spazio per stati futuri. Cambiarla NON rompe i documenti già scritti.
  const CIPHER_PAD = 32;

  // ── Contatori del verificatore a tre esiti (SPEC-RIDISEGNO-MAX.md §13) ─────
  // DEFAULT quando la config non dice niente. I valori EFFETTIVI li detta
  // l'owner dalla dashboard (doc Firestore `config/routines`, campi `failCap`
  // e `improvableCap`; il campo legacy `loopCap` vale come alias di `failCap`)
  // e li applica il SERVER quando registra i verdetti — mai il prompt, mai un
  // conteggio dichiarato dal client.
  //   improvableCap (N): quanti verdetti «migliorabile» tornano in correzione;
  //                      al giro N+1 il lavoro passa e i rilievi non risolti
  //                      diventano un feedback nuovo (`routine:residuo`).
  //   failCap (M):       quante bocciature «fail» prima di fermare la pratica
  //                      e chiamare l'owner (statusReason `loop`).
  // failCap = 10 è una scelta di misura per la prima settimana sul piano Max
  // (osservazione del processo), non una stima di quanto serve: si abbassa
  // dalla dashboard senza toccare il codice.
  const VERIFIER_CAPS = { improvableCap: 3, failCap: 10 };

  global.SN_FB_TRANSITIONS = {
    STATUSES, ACTORS, TRANSITIONS, PUBLIC_MAP, CIPHER_PAD, VERIFIER_CAPS,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
