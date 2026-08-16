// Macchina a stati dei feedback — vocabolario UNICO (spec: FEEDBACK-STATES.md).
// Espone SN_FB_STATUS su globalThis: lista chiusa degli stati canonici, colori,
// mappatura status→tab della dashboard, tabella delle transizioni legali con
// l'attore autorizzato, mappatura degli stati legacy ritirati.
//
// Il campo `status` persistito su Firestore è la SOLA fonte di verità dello
// stato di un feedback. Chi scrive uno status passa da canTransition; chi legge
// deriva la tab con tabFor. NESSUN consumer ricalcola lo stato da `pipeline.*`,
// `reviewDecision` o dalla modalità automatica (quella agisce una volta sola,
// al momento del giudizio, lato filo-security).
//
// Testabile via `npm run test:unit` (tests/unit/feedbackStatus.test.mjs).
// Pattern IIFE su globalThis: vedi CLAUDE.md → "Convenzione di porting".

(function (global) {
  'use strict';

  // ── Stati canonici (lista CHIUSA — spec §2) ────────────────────────────────
  // tab: 'inbox' Ricevuti | 'queue' In coda | 'resolved' Risolti |
  //      'archived' Archiviati. `done` è l'unico ambivalente (queue finché il
  //      fix non è in una versione rilasciata, poi resolved): tabFor accetta
  //      opts.shipped per scioglierlo.
  // color: bordo/badge nella dashboard; null = nessun colore di rischio.
  // terminal: true = ci resta finché l'owner non lo riapre esplicitamente.
  const STATUSES = {
    unlabeled:           { tab: 'inbox',    color: '#ffffff', label: 'Non filtrato',      severity: 4 },
    suspicious_file:     { tab: 'inbox',    color: '#111111', label: 'File sospetto',     severity: 5 },
    attack:              { tab: 'inbox',    color: '#c0392b', label: 'Attacco',           severity: 3 },
    spam:                { tab: 'inbox',    color: '#e08e0b', label: 'Spam',              severity: 2 },
    design:              { tab: 'inbox',    color: '#2e9e5b', label: 'Design',            severity: 1 },
    aligned:             { tab: 'inbox',    color: '#5b6ee0', label: 'Allineato',         severity: 0 },
    todo:                { tab: 'queue',    color: null,      label: 'In coda',           severity: 0 },
    working:             { tab: 'queue',    color: null,      label: 'In lavorazione',    severity: 0 },
    revision_capability: { tab: 'queue',    color: null,      label: 'Verifica fix',      severity: 0 },
    revision_security:   { tab: 'queue',    color: null,      label: 'Audit sicurezza',   severity: 0 },
    done:                { tab: 'queue',    color: null,      label: 'Risolto',           severity: 0 },
    archived:            { tab: 'archived', color: null,      label: 'Archiviato',        severity: 0 },
    attack_confirmed:    { tab: 'archived', color: '#c0392b', label: 'Attacco confermato', severity: 0, terminal: true },
    spam_confirmed:      { tab: 'archived', color: '#e08e0b', label: 'Spam confermato',    severity: 0, terminal: true },
  };

  const CANONICAL = Object.keys(STATUSES);

  function isCanonical(status) {
    return Object.prototype.hasOwnProperty.call(STATUSES, String(status || ''));
  }

  // ── Tab della dashboard: lookup PURA su status (spec §4) ──────────────────
  // `done` va in 'resolved' SOLO se il fix è davvero uscito (opts.shipped,
  // calcolato dal chiamante con isShipped/resolvedInVersion — gate DB3);
  // altrimenti resta visibile 'queue'. Status sconosciuto/legacy → null: il
  // chiamante deve prima normalizzare (vedi LEGACY sotto).
  function tabFor(status, opts) {
    if (!isCanonical(status)) return null;
    if (status === 'done') return (opts && opts.shipped) ? 'resolved' : 'queue';
    return STATUSES[status].tab;
  }

  // ── Transizioni legali (spec §3) ───────────────────────────────────────────
  // from → { to: [attori autorizzati] }. Attori:
  //   'owner'    dashboard di gestione (solo l'owner fa uscire dagli stati di
  //              revisione umana);
  //   'pipeline' filo-security (giudici + gate file): è l'UNICO che fa uscire
  //              da `unlabeled`;
  //   'routine'  routine Claude via coda triage/Action (iter di lavorazione).
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
      working: ['routine'], // presa in carico (claim git = lock primario)
      design:  ['routine'], // la routine ha domande → chat + statusReason clarify
      // Estensione oltre la spec §3 (documentata in FEEDBACK-STATES.md): i
      // lavori SENZA branch da verificare (es. il pianificatore che spezza una
      // spec in sub-feedback) chiudono direttamente — l'iter revision_* vale
      // solo per i fix su branch.
      done:    ['routine'],
    },
    working: {
      revision_capability: ['routine'], // fix pronto su branch
      design:              ['routine'], // domande a metà lavorazione
      todo:                ['routine'], // TTL 60min scaduto → riconciliazione
      done:                ['routine'], // lavoro senza branch (vedi todo→done)
    },
    revision_capability: {
      revision_security: ['routine'], // PASS verifica comportamentale
      design:            ['routine'], // FAIL×3 → statusReason loop
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

  const ACTORS = ['owner', 'pipeline', 'routine'];

  /**
   * Una transizione è legale? PURA: nessun default permissivo — stato o attore
   * sconosciuti, o coppia non elencata ⇒ false.
   * @param {string} from  status di partenza (canonico)
   * @param {string} to    status di arrivo (canonico)
   * @param {string} actor 'owner' | 'pipeline' | 'routine'
   */
  function canTransition(from, to, actor) {
    const row = TRANSITIONS[String(from || '')];
    if (!row) return false;
    const allowed = row[String(to || '')];
    if (!allowed) return false;
    return allowed.includes(String(actor || ''));
  }

  /** Tutte le destinazioni legali da uno stato per un attore (per la UI). */
  function transitionsFrom(from, actor) {
    const row = TRANSITIONS[String(from || '')];
    if (!row) return [];
    return Object.keys(row).filter((to) => row[to].includes(String(actor || '')));
  }

  /**
   * `to` è raggiungibile da `from` con una CATENA di transizioni tutte legali
   * per lo stesso attore? Serve al writer della coda triage: la coda tiene un
   * solo file per feedback (l'ultima decisione sovrascrive), quindi due passi
   * consecutivi possono collassare in uno (es. todo→working→revision_capability
   * applicato come todo→revision_capability). BFS sul grafo, PURA.
   */
  function canReach(from, to, actor) {
    if (canTransition(from, to, actor)) return true;
    const a = String(actor || '');
    const seen = new Set([String(from || '')]);
    const queue = [String(from || '')];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of transitionsFrom(cur, a)) {
        if (next === String(to || '')) return true;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  }

  // ── Stati legacy RITIRATI (spec §8) ────────────────────────────────────────
  // Mappatura semplice status→status per i legacy che non dipendono da altri
  // campi. `new` e `blocked` NON sono qui: richiedono il documento intero
  // (pipeline/blockReason) → normalizeStatus in manageReview.js li scioglie.
  // statusReason suggerito accanto, per conservare l'origine.
  const LEGACY_SIMPLE = {
    clarify:  { status: 'design',              statusReason: 'clarify' },
    review:   { status: 'revision_capability', statusReason: null },
    verified: { status: 'archived',            statusReason: null },
    ignored:  { status: 'archived',            statusReason: 'legacy-ignored' },
    draft:    { status: 'unlabeled',           statusReason: null },
  };

  const LEGACY_STATUSES = Object.keys(LEGACY_SIMPLE).concat(['new', 'blocked']);

  function isLegacy(status) {
    return LEGACY_STATUSES.includes(String(status || ''));
  }

  // ── Lock di lavorazione (spec §6) ──────────────────────────────────────────
  // TTL del `working`: più vecchio = istanza morta, chiunque lo riporta a todo.
  const WORKING_TTL_MS = 60 * 60 * 1000;

  /**
   * Un `working` è scaduto? true se lo status è working e workingSince manca o
   * è più vecchio del TTL (workingSince assente = non sapremo mai quando è
   * partito: trattalo come morto, torna in coda).
   * @param {object} fb  documento feedback ({ status, workingSince })
   * @param {number} [now]  epoch ms (default Date.now(), iniettabile nei test)
   */
  function isWorkingExpired(fb, now) {
    if (!fb || fb.status !== 'working') return false;
    const t = new Date(fb.workingSince || 0).getTime();
    if (!t) return true;
    return ((now == null ? Date.now() : now) - t) > WORKING_TTL_MS;
  }

  // ── statusPublic (S1.F2.1) per i nuovi stati ───────────────────────────────
  // Enum grossolano in chiaro accanto allo status fine (eventualmente cifrato).
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
  //
  // Effetto collaterale voluto e innocuo: i confermati rientrano nella query
  // dei candidati aperti delle routine (statusPublic == 'open'), dove vengono
  // scartati subito dal filtro sullo status fine (lavorabile = solo `todo`).
  const PUBLIC_MAP = {
    unlabeled: 'open', suspicious_file: 'open', attack: 'open', spam: 'open',
    design: 'open', aligned: 'open', todo: 'open', working: 'open',
    revision_capability: 'open', revision_security: 'open',
    done: 'closed', archived: 'closed',
    attack_confirmed: 'open', spam_confirmed: 'open',
  };

  // ── Lunghezza fissa dello status cifrato (#476) ────────────────────────────
  //
  // La cifratura non imbottisce: il testo cifrato è lungo quanto il testo in
  // chiaro più un preambolo fisso. Gli stati hanno nomi di lunghezza diversa,
  // quindi CONTARE I CARATTERI del campo cifrato equivale a leggerlo — e le
  // letture della collezione sono pubbliche. Misurato sul database vero:
  // `attack_confirmed` e `spam_confirmed` avevano una lunghezza tutta loro, e
  // bastava quella per pescare dal mucchio i feedback beccati, senza chiave e
  // senza login. Tutto il resto del lavoro su #476 non serviva a niente finché
  // restava questo.
  //
  // Rimedio: prima di cifrare, lo status viene portato a una lunghezza FISSA
  // con spazi in coda; chi lo decifra li toglie. Così ogni stato produce un
  // testo cifrato lungo uguale. Vale per TUTTI gli stati, non solo per i due
  // confermati: se solo quelli fossero della stessa lunghezza, sarebbero
  // riconoscibili proprio per questo.
  //
  // La misura è larga: tiene i canonici (il più lungo è 19), i legacy ritirati e
  // spazio per stati futuri. Cambiarla NON rompe i documenti già scritti (chi
  // legge toglie gli spazi comunque), ma non ha senso restringerla.
  const CIPHER_PAD = 32;

  /** Status pronto per la cifratura: lunghezza fissa, così il cifrato non parla. */
  function padForCipher(status) {
    const s = String(status == null ? '' : status);
    return s.length >= CIPHER_PAD ? s : s + ' '.repeat(CIPHER_PAD - s.length);
  }

  /** L'inverso: toglie l'imbottitura dopo la decifratura. Sicuro sui valori vecchi. */
  function unpadFromCipher(status) {
    return typeof status === 'string' ? status.trim() : status;
  }

  /**
   * Il feedback risulta RISOLTO a chi l'ha mandato? È il grilletto della
   * ricompensa e del popup sulla macchina dell'utente, che non ha la chiave
   * privata e quindi può guardare SOLO l'enum grossolano in chiaro.
   *
   * Vive qui, accanto alla mappa, perché è la stessa decisione: se un giorno
   * qualcuno rimette i confermati su 'closed', questa funzione inizia a
   * premiare gli attacchi — e il test che la sorveglia diventa rosso subito,
   * invece di lasciare la scoperta a un attaccante.
   */
  function isResolvedForUser(feedback) {
    const f = feedback && typeof feedback === 'object' ? feedback : {};
    if (f.statusPublic !== undefined) return f.statusPublic === 'closed';
    // Retrocompat: feedback storici senza statusPublic. Status in chiaro →
    // logica vecchia; cifrato → non si sa, e non si premia.
    const s = f.status;
    if (typeof s === 'string' && !s.startsWith('FENC1:')) return s === 'done';
    return false;
  }

  global.SN_FB_STATUS = {
    STATUSES, CANONICAL, isCanonical,
    tabFor,
    TRANSITIONS, ACTORS, canTransition, transitionsFrom, canReach,
    LEGACY_SIMPLE, LEGACY_STATUSES, isLegacy,
    WORKING_TTL_MS, isWorkingExpired,
    PUBLIC_MAP, isResolvedForUser, padForCipher, unpadFromCipher, CIPHER_PAD,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
