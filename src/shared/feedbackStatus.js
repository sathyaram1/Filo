// Macchina a stati dei feedback, vocabolario UNICO (spec: FEEDBACK-STATES.md): stati canonici, colori, status→tab della dashboard, transizioni legali con l'attore autorizzato, stati legacy ritirati.
// Le TABELLE non vivono qui: sono DATI in `src/shared/feedbackTransitions.js`, la fonte unica che anche il server di filo-security incorpora al deploy (SPEC-RIDISEGNO-MAX.md §7). Qui solo l'API costruita sopra.
// Il campo `status` su Firestore è la SOLA fonte di verità: chi scrive passa da canTransition, chi legge deriva la tab con tabFor. Nessun consumer ricalcola lo stato da `pipeline.*`, `reviewDecision` o dalla modalità automatica.

(function (global) {
  'use strict';

  // In Node il file si carica i dati da solo; in una pagina filo:// serve il <script> di feedbackTransitions.js PRIMA di questo. Se manca, meglio fermarsi con un errore chiaro che lavorare con tabelle vuote.
  if (!global.SN_FB_TRANSITIONS && typeof require === 'function') {
    require('./feedbackTransitions.js');
  }
  const DATA = global.SN_FB_TRANSITIONS;
  if (!DATA) {
    throw new Error('SN_FB_TRANSITIONS mancante: carica shared/feedbackTransitions.js prima di feedbackStatus.js');
  }

  // Solo la PRESENTAZIONE: la lista degli stati vive in feedbackTransitions. tab: 'inbox' | 'queue' | 'resolved' | 'archived'; color per bordo e badge in dashboard, null = nessun rischio; terminal = ci resta finché l'owner non lo riapre.
  // `done` è l'unico ambivalente (queue finché il fix non è in una versione rilasciata, poi resolved): tabFor accetta opts.shipped per scioglierlo.
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

  // La lista canonica è quella dei DATI: se la presentazione qui sopra non la copre esattamente, fermarsi al caricamento è meglio di una dashboard che mostra «undefined» su uno stato vero.
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

  // `done` va in 'resolved' SOLO se il fix è davvero uscito (opts.shipped, calcolato dal chiamante col gate DB3), altrimenti resta visibile in 'queue'. Status sconosciuto o legacy → null: il chiamante deve prima normalizzare.
  function tabFor(status, opts) {
    if (!isCanonical(status)) return null;
    if (status === 'done') return (opts && opts.shipped) ? 'resolved' : 'queue';
    return STATUSES[status].tab;
  }

  // La tabella from → { to: [attori] } vive nei DATI, insieme al perché di ogni riga. Qui solo l'API.
  const TRANSITIONS = DATA.TRANSITIONS;

  const ACTORS = DATA.ACTORS;

  /**
  * PURA, senza default permissivi: stato o attore sconosciuti, o coppia non elencata, danno false.
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
  * `to` è raggiungibile da `from` con una CATENA di transizioni tutte legali per lo stesso attore? BFS sul grafo, PURA.
  * Serve al writer della coda triage: la coda tiene un solo file per feedback e l'ultima decisione sovrascrive, quindi due passi consecutivi possono collassare in uno.
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

  // Stati legacy RITIRATI (spec §8), mappatura semplice status→status con lo statusReason accanto per conservarne l'origine.
  // `new` e `blocked` NON sono qui: richiedono il documento intero (pipeline/blockReason), li scioglie normalizeStatus in manageReview.js.
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

  // TTL del `working`: più vecchio = istanza morta, e chiunque lo riporta a todo.
  const WORKING_TTL_MS = 60 * 60 * 1000;

  /**
  * Un `working` è scaduto? Sì se workingSince manca o è più vecchio del TTL: senza workingSince non sapremo mai quando è partito, quindi si tratta come morto e torna in coda.
  * @param {number} [now] epoch ms, iniettabile nei test
  */
  function isWorkingExpired(fb, now) {
    if (!fb || fb.status !== 'working') return false;
    const t = new Date(fb.workingSince || 0).getTime();
    if (!t) return true;
    return ((now == null ? Date.now() : now) - t) > WORKING_TTL_MS;
  }

  // Il battito arriva ogni dieci minuti finché una sessione è viva, e il server lo specchia sul feedback (`beatAt`) perché i semafori stanno in una collezione che l'app non legge. Venticinque minuti tollerano due battiti persi di fila senza dichiarare morto chi è vivo.
  const BEAT_STALE_MS = 25 * 60 * 1000;

  /**
  * Qualcuno ci sta lavorando ORA? Vale l'ULTIMO segno di vita: il battito, o la presa in carico per i pochi minuti prima che il primo battito arrivi.
  * Guardare solo la presa in carico rendeva la scheda bugiarda su ogni lavorazione lunga, cioè su tutte: la sola suite completa dura mezz'ora.
  */
  function isBeating(fb, now) {
    const t = (now == null ? Date.now() : now);
    const beat = new Date((fb && fb.beatAt) || 0).getTime() || 0;
    const preso = new Date((fb && fb.workingSince) || 0).getTime() || 0;
    const ultimo = Math.max(beat, preso);
    return !!ultimo && (t - ultimo) <= BEAT_STALE_MS;
  }

  // statusPublic (S1.F2.1): enum grossolano in chiaro. La mappa e il perché (#476: i confermati collassano su 'open', mai un valore nuovo) vivono nei DATI.
  // Effetto voluto e innocuo: i confermati rientrano nella query dei candidati aperti delle routine, dove il filtro sullo status fine li scarta subito.
  const PUBLIC_MAP = DATA.PUBLIC_MAP;

  // Lunghezza fissa dello status cifrato (#476). La cifratura non imbottisce, e siccome gli stati hanno nomi di lunghezza diversa CONTARE i caratteri del campo cifrato equivale a leggerlo — con letture pubbliche: sul database vero bastava la lunghezza per pescare i feedback beccati, senza chiave e senza login.
  // Rimedio: prima di cifrare lo status va a lunghezza FISSA (il valore sta nei DATI) con spazi in coda, e chi decifra li toglie. Vale per TUTTI gli stati: se solo i confermati fossero uguali, sarebbero riconoscibili proprio per quello.
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
  * Il feedback risulta RISOLTO a chi l'ha mandato? È il grilletto della ricompensa sulla macchina dell'utente, che non ha la chiave privata e vede SOLO l'enum grossolano in chiaro.
  * Vive accanto alla mappa perché è la stessa decisione: rimettere i confermati su 'closed' farebbe premiare gli attacchi, e il test che la sorveglia diventa rosso subito.
  */
  function isResolvedForUser(feedback) {
    const f = feedback && typeof feedback === 'object' ? feedback : {};
    if (f.statusPublic !== undefined) return f.statusPublic === 'closed';
    // Retrocompat per i feedback storici senza statusPublic: status in chiaro → logica vecchia; cifrato → non si sa, e non si premia.
    const s = f.status;
    if (typeof s === 'string' && !s.startsWith('FENC1:')) return s === 'done';
    return false;
  }

  global.SN_FB_STATUS = {
    STATUSES, CANONICAL, isCanonical,
    tabFor,
    TRANSITIONS, ACTORS, canTransition, transitionsFrom, canReach,
    LEGACY_SIMPLE, LEGACY_STATUSES, isLegacy,
    WORKING_TTL_MS, isWorkingExpired, BEAT_STALE_MS, isBeating,
    PUBLIC_MAP, isResolvedForUser, padForCipher, unpadFromCipher, CIPHER_PAD,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
