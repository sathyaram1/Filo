// Macchina a stati dei feedback, vocabolario unico (FEEDBACK-STATES.md): qui solo l'API.
// Le TABELLE sono DATI in feedbackTransitions.js, che anche il server incorpora al deploy.
// Il campo `status` è la SOLA fonte di verità: nessuno ricalcola lo stato da `pipeline.*`.

(function (global) {
  'use strict';

  // In una pagina serve il <script> di feedbackTransitions.js PRIMA di questo file.
  // Se manca, meglio un errore chiaro che lavorare con tabelle vuote.
  if (!global.SN_FB_TRANSITIONS && typeof require === 'function') {
    require('./feedbackTransitions.js');
  }
  const DATA = global.SN_FB_TRANSITIONS;
  if (!DATA) {
    throw new Error('SN_FB_TRANSITIONS mancante: carica shared/feedbackTransitions.js prima di feedbackStatus.js');
  }

  // Solo la PRESENTAZIONE: la lista degli stati vive in feedbackTransitions.
  // `done` è l'unico ambivalente: tabFor accetta opts.shipped per scioglierlo.
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

  // La lista canonica è quella dei DATI: se la presentazione non la copre esattamente,
  // fermarsi al caricamento è meglio di una dashboard che mostra «undefined».
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

  // `done` va in 'resolved' solo col fix davvero uscito (opts.shipped), altrimenti 'queue'.
  // Status sconosciuto o legacy → null: il chiamante deve prima normalizzare.
  function tabFor(status, opts) {
    if (!isCanonical(status)) return null;
    if (status === 'done') return (opts && opts.shipped) ? 'resolved' : 'queue';
    return STATUSES[status].tab;
  }

  // La tabella e il perché di ogni riga vivono nei DATI; qui solo l'API.
  const TRANSITIONS = DATA.TRANSITIONS;

  const ACTORS = DATA.ACTORS;

  // Senza default permissivi: stato o attore sconosciuti, o coppia non elencata, danno false.
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

  // `to` è raggiungibile da `from` con una CATENA di transizioni legali per lo stesso attore?
  // Serve alla coda triage: un solo file per feedback, quindi due passi possono collassare.
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

  // Stati legacy RITIRATI: status→status, con lo statusReason che ne conserva l'origine.
  // `new` e `blocked` non sono qui: li scioglie normalizeStatus, che vede il documento intero.
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

  // Senza workingSince non sapremo mai quando è partito: si tratta come morto e torna in coda.
  function isWorkingExpired(fb, now) {
    if (!fb || fb.status !== 'working') return false;
    const t = new Date(fb.workingSince || 0).getTime();
    if (!t) return true;
    return ((now == null ? Date.now() : now) - t) > WORKING_TTL_MS;
  }

  // Il battito arriva ogni dieci minuti e il server lo specchia sul feedback, perché i
  // semafori stanno altrove. Venticinque minuti tollerano due battiti persi di fila.
  const BEAT_STALE_MS = 25 * 60 * 1000;

  // Vale l'ULTIMO segno di vita: il battito, o la presa in carico nei minuti prima del primo.
  // Guardare solo la presa in carico rendeva la scheda bugiarda su ogni lavorazione lunga.
  function isBeating(fb, now) {
    const t = (now == null ? Date.now() : now);
    const beat = new Date((fb && fb.beatAt) || 0).getTime() || 0;
    const preso = new Date((fb && fb.workingSince) || 0).getTime() || 0;
    const ultimo = Math.max(beat, preso);
    return !!ultimo && (t - ultimo) <= BEAT_STALE_MS;
  }

  // statusPublic: enum grossolano in chiaro. La mappa e il perché vivono nei DATI.
  // Effetto voluto: i confermati rientrano nei candidati aperti, e il filtro fine li scarta.
  const PUBLIC_MAP = DATA.PUBLIC_MAP;

  // Lunghezza fissa dello status cifrato: la regola sta in feedbackTransitions.js (#476).
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

  // Il feedback risulta RISOLTO a chi l'ha mandato? È il grilletto della ricompensa,
  // sulla macchina dell'utente, che vede SOLO l'enum grossolano in chiaro.
  function isResolvedForUser(feedback) {
    const f = feedback && typeof feedback === 'object' ? feedback : {};
    if (f.statusPublic !== undefined) return f.statusPublic === 'closed';
    // Feedback storici senza statusPublic: se lo status è cifrato non si sa, e non si premia.
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
