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

  // ── Transizioni legali (FEEDBACK-STATES.md §3) ─────────────────────────────
  // from → { to: [attori autorizzati] }. Attori:
  //   'owner'    Gestione, pagina dei feedback e `npm run feedback`: una riga per
  //              ogni azione di ownerActions (manageReview.js), sentinella in
  //              tests/unit/ownerActionsTransizioni.test.mjs; mai → done;
  //   'pipeline' filo-security (giudici + gate file);
  //   'routine'  routine Claude via canale autenticato (iter di lavorazione).
  // Una coppia (from,to) assente = transizione ILLEGALE: il writer la rifiuta.
  const TRANSITIONS = {
    unlabeled: {
      suspicious_file: ['pipeline'], // gate file (corre prima dei giudici)
      attack:          ['pipeline'],
      spam:            ['pipeline'],
      design:          ['pipeline'],
      todo:            ['pipeline', 'owner'], // pipeline: sicuro + automatica ON; owner: «→ In coda» dai Ricevuti
      aligned:         ['pipeline'], // sicuro + automatica OFF
      archived:        ['owner'],
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
      archived:         ['owner'],   // non si fa, senza confermarlo attacco
      unlabeled:        ['pipeline'], // mittente fidato flaggato per errore → ri-giudizio
    },
    spam: {
      spam_confirmed: ['owner'],
      todo:           ['owner'],
      archived:       ['owner'],
      unlabeled:      ['pipeline'],
    },
    design: {
      // 'pipeline': solo un derivato fermo con la sua origine (origine_bloccata), che la segue quando l'owner la libera.
      todo:      ['owner', 'pipeline'],  // l'owner risponde in chat e rimette in coda
      archived:  ['owner'],  // oppure decide che non si fa
      unlabeled: ['pipeline'],
      aligned:   ['pipeline'],
    },
    aligned: {
      // 'pipeline': solo un derivato tornato qui con l'origine chiusa (origine_chiusa), che la segue quando l'owner la ripristina.
      todo:      ['owner', 'pipeline'],  // approvazione manuale (anche bulk)
      archived:  ['owner'],  // un doppione, o una cosa che non si farà: si chiude qui, senza approvarla prima
      unlabeled: ['pipeline'],
    },
    todo: {
      working:  ['routine'], // presa in carico (il semaforo lo tiene il server)
      design:   ['routine'], // la routine ha domande → chat + statusReason clarify
      // routine: solo il riordino della coda e l'unione (ambiti `coda` e `unisci`, #1153), su un lavoro non iniziato.
      archived: ['owner', 'routine'], // un doppione, o una cosa che non si farà più
      // Il worker che l'ha letto da vicino lo giudica attacco o spam (statusReason worker): Ricevuti L3 (#1358).
      attack:   ['routine'],
      spam:     ['routine'],
      // NB: il passo diretto todo→done (attore routine) è stato RITIRATO col
      // ridisegno (SPEC-RIDISEGNO-MAX.md §1): esisteva per il pianificatore che
      // spezzava le spec in sotto-feedback, che non esiste più. Le chiusure
      // manuali senza branch (npm run feedback -- <id> done --come-routine)
      // restano legali come CATENA di passi (canReach attraversa l'iter).
    },
    working: {
      revision_capability: ['routine'], // fix pronto su branch
      design:              ['routine'], // domande a metà lavorazione
      // Arenato: il ramo fermo da un'ora torna in coda da solo (FEEDBACK-STATES.md §6a).
      // Alla terza volta va in `design`.
      todo:                ['routine'],
      archived:            ['owner'],
      attack:              ['routine'],
      spam:                ['routine'],
    },
    revision_capability: {
      revision_security: ['routine'], // PASS verifica comportamentale
      design:            ['routine'], // fail cap raggiunto → statusReason loop
      archived:          ['owner'],
      attack:            ['routine'],
      spam:              ['routine'],
    },
    revision_security: {
      done:     ['routine'], // PASS secaudit + merge-gate fonde su main
      design:   ['routine'], // FAIL fixer-loop → statusReason loop
      archived: ['owner'],
      // Conflitto di fusione: main è andato avanti mentre il lavoro aspettava
      // e le modifiche non si incastrano più da sole. Non è una bocciatura di
      // qualità: il ramo torna in lavorazione per il RIALLINEAMENTO (rifare la
      // base su main risolvendo i conflitti) e ripassa verifica e sicurezza
      // sul contenuto nuovo. Senza questa riga il giro di riallineamento
      // moriva alla consegna: la macchina rifiutava il rientro.
      revision_capability: ['routine'],
      attack:              ['routine'],
      spam:                ['routine'],
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

  // ── I quattro bilanci dei giri di correzione (feedback #561, §4) ────────
  // I NUMERI non stanno qui. Li detta l'owner dalla dashboard (doc Firestore
  // `config/routines`, campi `cap3`, `cap2`, `cap1`, `cap0`, Gestione →
  // Automazioni) e li applica il SERVER quando registra la critica — mai il
  // prompt, mai un conteggio dichiarato dal client. Dal 2026-09-16 nel codice
  // non c'è un default: chi ha bisogno dei bilanci li legge dal server, e se
  // non ci sono si ferma con un errore che dice cosa manca. Qui restano solo i
  // NOMI dei campi, uno per livello. Le regole che li consumano stanno in
  // `verifierRound.js` (decideRound), incorporato anch'esso dal server al
  // deploy; una sentinella tiene questa lista uguale alla sua e ai campi della
  // dashboard.
  //   cap3: giri di correzione per i rilievi di livello 3 (sicurezza, soldi,
  //         Filo inutilizzabile). A bilancio finito un 3 ferma la pratica e
  //         chiama l'owner (statusReason `loop`): è l'unico che ferma.
  //   cap2: giri per i rilievi di livello 2 (la cosa chiesta non si ottiene nel
  //         caso normale). A bilancio finito un 2 NON ferma: diventa un
  //         feedback a parte a priorità 2, e il lavoro passa (2026-09-23).
  //   cap1: giri per i rilievi di livello 1 (di rado, cosmetica evidente). A
  //         bilancio finito un 1 va nel feedback derivato.
  //   cap0: giri per i soli rilievi di livello 0 (casi rari). Con 0 gli 0 da
  //         soli non si correggono mai: solo insieme ad altro.
  // Ogni giro consuma UN giro dal bilancio del livello più alto corretto.
  const VERIFIER_CAP_KEYS = ['cap3', 'cap2', 'cap1', 'cap0'];

  global.SN_FB_TRANSITIONS = {
    STATUSES, ACTORS, TRANSITIONS, PUBLIC_MAP, CIPHER_PAD, VERIFIER_CAP_KEYS,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
