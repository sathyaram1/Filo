// Macchina a stati dei feedback: le TABELLE come DATI, fonte di verità singola
// (SPEC-RIDISEGNO-MAX.md §7). Vivevano in due copie a mano — dashboard e server — e due
// copie che divergono sono peggio di una sola permissiva. La dashboard le legge via
// feedbackStatus.js; il server le INCORPORA al deploy (bake-shared.js →
// stateMachine.data.js), quindi cambia comportamento solo al rideploy.
// SOLO DATI: le funzioni stanno in feedbackStatus.js e stateMachine.js.

(function (global) {
  'use strict';

  // Stati canonici, lista CHIUSA (FEEDBACK-STATES.md §2). La presentazione (tab, colori,
  // etichette) sta in feedbackStatus.js, che verifica di coprire ESATTAMENTE questa lista.
  const STATUSES = [
    'unlabeled', 'suspicious_file', 'attack', 'spam', 'design', 'aligned',
    'todo', 'working', 'revision_capability', 'revision_security', 'done',
    'archived', 'attack_confirmed', 'spam_confirmed',
  ];

  const ACTORS = ['owner', 'pipeline', 'routine'];

  // Transizioni legali (FEEDBACK-STATES.md §3): from → { to: [attori autorizzati] }.
  // 'owner' = dashboard di gestione, l'unico che fa uscire dagli stati di revisione umana;
  // 'pipeline' = filo-security (giudici + gate file), l'UNICO che fa uscire da `unlabeled`;
  // 'routine' = routine Claude via canale autenticato.
  // Una coppia (from,to) assente è una transizione ILLEGALE: il writer la rifiuta.
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
      // Il passo diretto todo→done è stato RITIRATO (SPEC-RIDISEGNO-MAX.md §1): serviva al
      // pianificatore che spezzava le spec in sotto-feedback, che non esiste più. Le chiusure
      // manuali senza branch restano legali come CATENA di passi (canReach attraversa l'iter).
    },
    working: {
      revision_capability: ['routine'], // fix pronto su branch
      design:              ['routine'], // domande a metà lavorazione
      // Arenato: il ramo non avanza da un'ora → il pacemaker lo rimette in coda
      // da solo (FEEDBACK-STATES.md §6a). Alla terza volta va in `design`.
      todo:                ['routine'],
    },
    revision_capability: {
      revision_security: ['routine'], // PASS verifica comportamentale
      design:            ['routine'], // fail cap raggiunto → statusReason loop
    },
    revision_security: {
      done:   ['routine'], // PASS secaudit + merge-gate fonde su main
      design: ['routine'], // FAIL fixer-loop → statusReason loop
      // Conflitto di fusione: main è andato avanti mentre il lavoro aspettava e le modifiche non
      // si incastrano più. Non è una bocciatura di qualità — il ramo torna in lavorazione per il
      // RIALLINEAMENTO e ripassa verifica e sicurezza sul contenuto nuovo. Senza questa riga il
      // giro di riallineamento moriva alla consegna: la macchina rifiutava il rientro.
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

  // statusPublic (S1.F2.1): enum grossolano IN CHIARO, accanto allo status fine (cifrato).
  // SICUREZZA: tutti gli stati «beccati» (attack/spam/suspicious_file e i confermati) DEVONO
  // collassare sugli stessi valori dei feedback normali, o chi legge Firestore senza chiave
  // riconosce un attacco intercettato e fa hill-climbing. E conta SU QUALE valore (#476):
  // 'closed' non è passivo, è il grilletto del premio da 50 crediti con notifica «risolto» e
  // della sanificazione per la bacheca pubblica — gli confermavamo il colpo e lo pagavamo.
  // I confermati stanno su 'open': per chi li ha mandati restano per sempre «in lavorazione»,
  // che è il silenzio. Nessun valore nuovo: sarebbe di nuovo un segnale, con un altro nome.
  const PUBLIC_MAP = {
    unlabeled: 'open', suspicious_file: 'open', attack: 'open', spam: 'open',
    design: 'open', aligned: 'open', todo: 'open', working: 'open',
    revision_capability: 'open', revision_security: 'open',
    done: 'closed', archived: 'closed',
    attack_confirmed: 'open', spam_confirmed: 'open',
  };

  // Lunghezza fissa dello status cifrato (#476): la cifratura non imbottisce, e contare i
  // caratteri del campo cifrato equivale a leggerlo. Prima di cifrare lo status si porta a
  // questa lunghezza con spazi in coda (padForCipher). La misura è larga apposta (canonici,
  // legacy e stati futuri) e cambiarla NON rompe i documenti già scritti.
  const CIPHER_PAD = 32;

  // I tre bilanci dei giri di correzione (#561 §4): qui ci stanno solo i NOMI dei campi. I NUMERI li detta l'owner dalla dashboard (`config/routines`: cap2, cap1, cap0) e li applica il SERVER quando registra la critica, mai il prompt e mai un conteggio dichiarato dal client.
  // Nessun default nel codice (2026-09-16: un 5/2/0 qui faceva ragionare la verifica locale con numeri diversi da quelli della dashboard) — chi ha bisogno dei bilanci li legge dal server, e se non ci sono si ferma con un errore che dice cosa manca. Le regole che li consumano stanno in verifierRound.js (decideRound).
  // cap2: giri per i rilievi di livello 3 e 2 (la cosa chiesta non si ottiene, cammino principale). A bilancio finito la pratica si ferma e chiama l'owner (`loop`).
  // cap1: giri per i rilievi di livello 1 (cosmetica, attrito fuori cammino). A bilancio finito un 1 va nel feedback derivato invece di essere corretto.
  // cap0: con z = 0 gli 0 da soli non si correggono mai, solo insieme ad altro.
  // Ogni giro consuma UN giro dal bilancio del livello più alto corretto. I vecchi nomi (`failCap`/`improvableCap`, gli esiti pass/migliorabile/fail) sono aboliti: l'esito lo calcola il server dai livelli e dai bilanci.
  const VERIFIER_CAP_KEYS = ['cap2', 'cap1', 'cap0'];
  global.SN_FB_TRANSITIONS = {
    STATUSES, ACTORS, TRANSITIONS, PUBLIC_MAP, CIPHER_PAD, VERIFIER_CAP_KEYS,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
