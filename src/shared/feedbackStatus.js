// Macchina a stati dei feedback — vocabolario UNICO (spec: FEEDBACK-STATES.md).
// Espone SN_FB_STATUS su globalThis: lista chiusa degli stati canonici, colori,
// mappatura status→tab della dashboard, tabella delle transizioni legali con
// l'attore autorizzato, mappatura degli stati legacy ritirati.
//
// LE TABELLE (stati canonici, transizioni, PUBLIC_MAP, CIPHER_PAD) NON vivono
// più qui: sono DATI in `src/shared/feedbackTransitions.js`, la fonte unica
// che anche il server di filo-security incorpora al deploy
// (SPEC-RIDISEGNO-MAX.md §7). Questo modulo le CONSUMA e ci costruisce sopra
// l'API di sempre (canTransition, canReach, tabFor, padForCipher, …): per i
// chiamanti non cambia niente.
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

  // La fonte dei dati. In Node (main process, script, unit test) questo file
  // se la carica da solo; in una pagina filo:// `require` non esiste e serve
  // il <script> di feedbackTransitions.js PRIMA di questo — se manca, meglio
  // fermarsi subito con un errore chiaro che lavorare con tabelle vuote.
  if (!global.SN_FB_TRANSITIONS && typeof require === 'function') {
    require('./feedbackTransitions.js');
  }
  const DATA = global.SN_FB_TRANSITIONS;
  if (!DATA) {
    throw new Error('SN_FB_TRANSITIONS mancante: carica shared/feedbackTransitions.js prima di feedbackStatus.js');
  }

  // ── Stati canonici: la PRESENTAZIONE (la lista vive in feedbackTransitions) ─
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

  // La lista canonica è quella dei DATI: se la presentazione qui sopra non la
  // copre esattamente (uno stato nuovo aggiunto di là e dimenticato di qua, o
  // viceversa), fermarsi al caricamento è meglio di una dashboard che mostra
  // "undefined" su uno stato vero.
  {
    const a = CANONICAL.slice().sort().join(',');
    const b = DATA.STATUSES.slice().sort().join(',');
    if (a !== b) {
      throw new Error(`feedbackStatus.js e feedbackTransitions.js non coprono gli stessi stati: [${a}] vs [${b}]`);
    }
  }

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
  // La tabella from → { to: [attori] } vive nei DATI (feedbackTransitions.js),
  // insieme ai commenti sul perché di ogni riga. Qui solo l'API sopra di essa.
  const TRANSITIONS = DATA.TRANSITIONS;

  const ACTORS = DATA.ACTORS;

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

  // ── "Qualcuno ci sta lavorando ORA" (dashboard) ────────────────────────────
  // Il battito arriva ogni dieci minuti finché una sessione è viva e collegata;
  // il server lo specchia sul feedback (`beatAt`), perché i semafori vivono in
  // una collezione che l'app non legge. Venticinque minuti tollerano due battiti
  // persi di fila senza dichiarare morto chi è vivo.
  const BEAT_STALE_MS = 25 * 60 * 1000;

  /**
   * Qualcuno sta lavorando a questo feedback in questo momento?
   *
   * Vale l'ULTIMO segno di vita: il battito, oppure la presa in carico per la
   * manciata di minuti prima che arrivi il primo battito. Prima si guardava solo
   * la presa in carico, con un'ora di tolleranza, e la scheda diventava bugiarda
   * su ogni lavorazione lunga — cioè su tutte, visto che la sola suite completa
   * dura mezz'ora: diceva "nessuno ci sta lavorando" mentre un'istanza lavorava.
   */
  function isBeating(fb, now) {
    const t = (now == null ? Date.now() : now);
    const beat = new Date((fb && fb.beatAt) || 0).getTime() || 0;
    const preso = new Date((fb && fb.workingSince) || 0).getTime() || 0;
    const ultimo = Math.max(beat, preso);
    return !!ultimo && (t - ultimo) <= BEAT_STALE_MS;
  }

  // ── statusPublic (S1.F2.1): enum grossolano in chiaro ──────────────────────
  // La mappa e il PERCHÉ (#476: i confermati collassano su 'open', mai un
  // valore nuovo) vivono nei DATI (feedbackTransitions.js).
  //
  // Effetto collaterale voluto e innocuo: i confermati rientrano nella query
  // dei candidati aperti delle routine (statusPublic == 'open'), dove vengono
  // scartati subito dal filtro sullo status fine (lavorabile = solo `todo`).
  const PUBLIC_MAP = DATA.PUBLIC_MAP;

  // ── Lunghezza fissa dello status cifrato (#476) ────────────────────────────
  //
  // La cifratura non imbottisce: il testo cifrato è lungo quanto il testo in
  // chiaro più un preambolo fisso. Gli stati hanno nomi di lunghezza diversa,
  // quindi CONTARE I CARATTERI del campo cifrato equivale a leggerlo — e le
  // letture della collezione sono pubbliche. Misurato sul database vero:
  // `attack_confirmed` e `spam_confirmed` avevano una lunghezza tutta loro, e
  // bastava quella per pescare dal mucchio i feedback beccati, senza chiave e
  // senza login.
  //
  // Rimedio: prima di cifrare, lo status viene portato a una lunghezza FISSA
  // (il valore vive nei DATI) con spazi in coda; chi lo decifra li toglie.
  // Vale per TUTTI gli stati, non solo per i due confermati: se solo quelli
  // fossero della stessa lunghezza, sarebbero riconoscibili proprio per questo.
  const CIPHER_PAD = DATA.CIPHER_PAD;

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
