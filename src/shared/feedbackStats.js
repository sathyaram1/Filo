// Statistiche dei feedback (#496) — la parte PURA.
//
// COSA C'È QUI
//   I conti che la scheda "Statistiche feedback" della dashboard di gestione
//   mostra: quante segnalazioni sono arrivate nella finestra scelta (e di che
//   categoria, e da chi), quante lavorazioni si sono chiuse, quante partenze
//   hanno fatto le routine, e quanti giri di verifica costa un lavoro prima di
//   passare.
//
// PERCHÉ È QUI E NON DENTRO LA PAGINA
//   Sono conti su dati veri, e si provano in millisecondi con gli unit test
//   invece che aprendo Electron. Nella pagina resta il disegno.
//
// LE DUE DATE, DETTE E NON NASCOSTE
//   Un feedback ha due istanti che contano e sono diversi: quando è ARRIVATO
//   (`createdAt`) e quando si è MOSSO l'ultima volta (`_updateTime`, che è la
//   scrittura vera registrata da Firestore). "Ricevuti" guarda il primo,
//   "lavorati" il secondo. La pagina lo dice accanto a ogni numero: una
//   finestra che filtra su due date diverse senza dirlo è un numero che sembra
//   una risposta e non lo è.
//
// QUELLO CHE NON SI PUÒ SAPERE SI DICHIARA
//   La dashboard carica i feedback più recenti fino a un tetto
//   (SN_FEEDBACK.LIST_PAGE_SIZE): oltre quello i più vecchi non sono in pagina.
//   `compute` ritorna sempre `copertura`, con cui la pagina scrive "almeno N"
//   invece di un totale che non conosce (CLAUDE.md § Limiti).
//
// PURO: niente DOM, niente rete, niente Firestore.
// Convenzione IIFE del repo: si registra su globalThis come SN_FEEDBACK_STATS.

(function (global) {
  'use strict';

  // In Node (unit test, main process) i moduli fratelli si caricano da soli;
  // in una pagina filo:// vanno inclusi PRIMA di questo con i loro <script>.
  if (typeof require === 'function') {
    if (!global.SN_FB_STATUS) { try { require('./feedbackStatus.js'); } catch (_) { /* pagina */ } }
    if (!global.SN_MANAGE_REVIEW) { try { require('./manageReview.js'); } catch (_) { /* pagina */ } }
    if (!global.SN_FEEDBACK_THREAD) { try { require('./feedbackThread.js'); } catch (_) { /* pagina */ } }
    if (!global.SN_VERIFIER_ROUND) { try { require('./verifierRound.js'); } catch (_) { /* pagina */ } }
  }

  function MR() {
    const m = global.SN_MANAGE_REVIEW;
    if (!m) throw new Error('SN_MANAGE_REVIEW mancante: carica shared/manageReview.js prima di feedbackStats.js');
    return m;
  }
  function TH() {
    const m = global.SN_FEEDBACK_THREAD;
    if (!m) throw new Error('SN_FEEDBACK_THREAD mancante: carica shared/feedbackThread.js prima di feedbackStats.js');
    return m;
  }
  function VR() {
    const m = global.SN_VERIFIER_ROUND;
    if (!m) throw new Error('SN_VERIFIER_ROUND mancante: carica shared/verifierRound.js prima di feedbackStats.js');
    return m;
  }

  const ORA = 3600 * 1000;
  const GIORNO = 24 * ORA;

  // ── La finestra di riferimento ────────────────────────────────────────────
  // Le scelte pronte coprono il caso di tutti i giorni; "Personalizzata" copre
  // "la settimana scorsa", che con una finestra a scorrimento non si può dire.
  const WINDOWS = [
    { key: '24h',    label: '24 ore',    ms: GIORNO },
    { key: '7d',     label: '7 giorni',  ms: 7 * GIORNO },
    { key: '30d',    label: '30 giorni', ms: 30 * GIORNO },
    { key: '90d',    label: '90 giorni', ms: 90 * GIORNO },
    { key: 'all',    label: 'Sempre',    ms: null },
    { key: 'custom', label: 'Dal… al…',  ms: null },
  ];
  const DEFAULT_WINDOW = '30d';

  function windowByKey(key) {
    return WINDOWS.find((w) => w.key === String(key || '')) || null;
  }

  // 'AAAA-MM-GG' → istante locale (inizio o fine del giorno). Null se la data
  // non si legge: chi chiama lo dice, non lo indovina.
  function parseDay(text, endOfDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = endOfDay
      ? new Date(y, mo - 1, d, 23, 59, 59, 999)
      : new Date(y, mo - 1, d, 0, 0, 0, 0);
    // Rifiuta il 31 febbraio invece di farlo scivolare al 3 marzo.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date.getTime();
  }

  /**
   * La selezione della finestra → l'intervallo vero. PURA.
   * @param {{key:string, from?:string, to?:string}} sel
   * @param {number} now
   * @returns {{key, label, from:number|null, to:number|null, valid:boolean}}
   *   from/to null = estremo aperto. `valid:false` = date personalizzate
   *   illeggibili o al contrario (la pagina lo dice invece di mostrare zeri).
   */
  function windowRange(sel, now) {
    const s = sel && typeof sel === 'object' ? sel : { key: DEFAULT_WINDOW };
    const t = Number.isFinite(now) ? now : Date.now();
    const w = windowByKey(s.key) || windowByKey(DEFAULT_WINDOW);
    if (w.key === 'all') return { key: 'all', label: w.label, from: null, to: null, valid: true };
    if (w.key === 'custom') {
      const from = s.from ? parseDay(s.from, false) : null;
      const to = s.to ? parseDay(s.to, true) : null;
      const scritte = !!(s.from || s.to);
      const leggibili = (!s.from || from !== null) && (!s.to || to !== null);
      const ordinate = from === null || to === null || from <= to;
      return {
        key: 'custom', label: w.label, from, to,
        valid: scritte && leggibili && ordinate,
      };
    }
    return { key: w.key, label: w.label, from: t - w.ms, to: t, valid: true };
  }

  // Una data che non si legge non appartiene a nessun periodo — ma «Sempre» non
  // è un periodo: è "tutto quello che c'è". Escluderla anche da lì vuol dire
  // scrivere un numero più piccolo del vero in una finestra che promette il
  // contrario. Le finestre con un estremo, invece, la lasciano fuori davvero, e
  // `compute` ritorna quante ne ha lasciate fuori perché la pagina lo dica.
  function inRange(ms, range) {
    if (!Number.isFinite(ms)) return range.from === null && range.to === null;
    if (range.from !== null && ms < range.from) return false;
    if (range.to !== null && ms > range.to) return false;
    return true;
  }

  // ── Le due date di un feedback ────────────────────────────────────────────
  function toMs(value) {
    if (!value) return NaN;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  /** Quando è arrivato. */
  function createdMs(fb) {
    return toMs(fb && (fb.createdAt || fb._createTime));
  }
  /** Quando si è mosso l'ultima volta (ripiego: quando è arrivato). */
  function movedMs(fb) {
    const u = toMs(fb && fb._updateTime);
    return Number.isFinite(u) ? u : createdMs(fb);
  }

  // ── Categoria di una segnalazione ─────────────────────────────────────────
  // Non è lo status fine (quattordici voci, che raccontano l'iter): è la
  // domanda "che cos'era questa segnalazione", che è quella che si guarda
  // sull'arrivo. Gli stati confermati stanno con i loro (un attacco confermato
  // è un attacco).
  const CATEGORIES = [
    { key: 'valida',    label: 'Valide' },
    { key: 'design',    label: 'Da decidere' },
    { key: 'attacco',   label: 'Attacchi' },
    { key: 'spam',      label: 'Spam' },
    { key: 'file',      label: 'File sospetti' },
    { key: 'da_filtrare', label: 'Non filtrate' },
    { key: 'illeggibile', label: 'Stato illeggibile' },
  ];
  const CATEGORY_LABELS = CATEGORIES.reduce((acc, c) => { acc[c.key] = c.label; return acc; }, {});

  const CATEGORY_BY_STATUS = {
    unlabeled: 'da_filtrare',
    suspicious_file: 'file',
    attack: 'attacco',
    attack_confirmed: 'attacco',
    spam: 'spam',
    spam_confirmed: 'spam',
    design: 'design',
    aligned: 'valida',
    todo: 'valida',
    working: 'valida',
    revision_capability: 'valida',
    revision_security: 'valida',
    done: 'valida',
    archived: 'valida',
  };

  function categoryOf(fb) {
    if (MR().statusUnreadable(fb)) return 'illeggibile';
    const { status } = MR().normalizeStatus(fb);
    return CATEGORY_BY_STATUS[status] || 'da_filtrare';
  }

  // ── Chi l'ha scritta ──────────────────────────────────────────────────────
  // Le stesse categorie che la lista mostra come icona e che gli interruttori
  // dell'automatica regolano: chi si vede separato si conta separato.
  function creatorKeys() {
    const groups = TH().AUTO_APPROVE_GROUPS;
    return Array.isArray(groups) && groups.length
      ? groups.slice()
      : ['owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo'];
  }
  // Le automazioni in cloud, per la scelta rapida "solo le routine".
  const CREATORS_ROUTINE = ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'];
  const CREATORS_PEOPLE = ['owner', 'user', 'filo'];

  function creatorOf(fb) {
    return TH().authorKind(fb && fb.clientId);
  }

  // ── I giri di verifica, letti dalle note ──────────────────────────────────
  //
  // Il verbale di ogni giro finisce nella conversazione del feedback, scritto
  // dal server con SN_VERIFIER_ROUND.roundNote (la stessa fonte che il server
  // incorpora al deploy). Qui lo si rilegge: è l'unico posto dove la dashboard
  // può vedere quanti giri è costato un lavoro — i bilanci vivono sul server.
  //
  // Le quattro forme di esito, e come si chiamano oggi:
  //   'pass'      il giro è superato, il lavoro prosegue;
  //   'fix'       si corregge e si ricontrolla → questo è UN GIRO in più;
  //   'stop'      il lavoro si ferma e passa all'owner (il vecchio «fail»);
  //   'rimandati' funziona, i rilievi vanno in un feedback derivato (il vecchio
  //               «migliorabile»): il lavoro prosegue.
  const ROUND_KINDS = [
    { key: 'pass',      label: 'Superata' },
    { key: 'fix',       label: 'Da correggere' },
    { key: 'stop',      label: 'Bloccante' },
    { key: 'rimandati', label: 'Rilievi rimandati' },
  ];
  // I giri dopo i quali il lavoro VA AVANTI (non torna indietro).
  const ROUND_PASSING = ['pass', 'rimandati'];

  // Le righe che aprono il verbale di un giro. Le prime due sono la forma di
  // oggi (roundNote); le altre tre sono lo storico (dispatch.verifierNoteText),
  // che nelle conversazioni vecchie c'è ancora.
  const ROUND_OPENERS = [
    { re: /^\s*Verifica superata\./i,                       kind: 'pass' },
    { re: /^\s*Verifica:\s*funziona,\s*ma\s*migliorabile/i, kind: 'rimandati' },
    { re: /^\s*Verifica:\s*\d+\s+riliev/i,                  kind: null },
    { re: /^\s*Controllo funzionalità superato\./i,         kind: 'pass' },
    { re: /^\s*Controllo funzionalità NON superato/i,       kind: 'stop' },
  ];
  // Cosa il server ha deciso di fare dei rilievi di quel giro: è scritto in
  // chiaro dentro il verbale, e vale più di qualsiasi deduzione dai livelli.
  //
  // ⚠️ SI CERCA SOLO NELLA TESTA DEL VERBALE, RIGA PER RIGA E DALL'INIZIO.
  // Il server scrive queste frasi su una riga loro, PRIMA dell'elenco dei
  // rilievi (verifierRound.roundNote). Cercarle in tutto il blocco vuol dire
  // cercarle anche dentro il testo dei rilievi, dove il verificatore descrive
  // cosa succede: «quando il registro non risponde il lavoro si ferma» è
  // italiano normale, e trasformava un giro di correzione in un giro bloccante.
  const ROUND_OUTCOME_PHRASES = [
    { re: /^\s*Il lavoro si ferma/i,                  kind: 'stop' },
    { re: /^\s*La correzione riguarda/i,              kind: 'fix' },
    { re: /^\s*Nessun rilievo da correggere adesso/i, kind: 'rimandati' },
  ];
  // Dove finisce la testa del verbale: la prima riga di rilievo («- [2] …»).
  // Stessa forma che legge SN_VERIFIER_ROUND.parseFindings.
  const FINDING_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?\[\s*[0-3]\s*\??\s*\]/;
  // Il marcatore di turno della conversazione: chiude il verbale in corso, così
  // un «[2]» scritto nel report di chi ha lavorato non finisce fra i rilievi
  // della verifica.
  const TURN_MARKER = /^---\s.*\s---\s*$/;

  /**
   * La conversazione di questo feedback è stata TAGLIATA dal tetto? PURA.
   *
   * Quando le note superano SN_FEEDBACK_THREAD.NOTES_MAX, Filo toglie i turni
   * più vecchi e lascia al loro posto una riga che dichiara il taglio. Quei
   * turni erano i primi giri di verifica: contare quello che resta darebbe
   * «passata subito» al lavoro che di giri ne è costati cinque. E a essere
   * tagliate sono soltanto le conversazioni lunghe, cioè le segnalazioni con
   * molti giri: proprio la coda della distribuzione che la torta esiste per
   * mostrare. Quindi non si contano affatto, e la pagina scrive quante sono.
   */
  function notesTruncated(fb) {
    const notes = fb && fb.notes;
    if (typeof notes !== 'string' || !notes) return false;
    if (MR().valueUnreadable(notes)) return false;
    const mark = String((TH().TRIM_MARK) || '').trim();
    if (!mark) return false;
    return notes.replace(/\r\n?/g, '\n').split('\n').some((l) => l.trim() === mark);
  }

  /**
   * I giri di verifica di un feedback, dal più vecchio. PURA.
   * @returns {Array<{kind:string, findings:Array}>}
   */
  function parseRounds(fb) {
    const notes = fb && fb.notes;
    if (typeof notes !== 'string' || !notes) return [];
    if (MR().valueUnreadable(notes)) return [];
    const lines = notes.replace(/\r\n?/g, '\n').split('\n');
    const rounds = [];
    let current = null;
    const chiudi = () => {
      if (!current) return;
      const testo = current.lines.join('\n');
      const parsed = VR().parseFindings(testo);
      let kind = current.kind;
      if (!kind) {
        // Solo la testa: dalla riga d'apertura al primo rilievo.
        const fine = current.lines.findIndex((l) => FINDING_LINE.test(l));
        const testa = fine < 0 ? current.lines : current.lines.slice(0, fine);
        const phrase = ROUND_OUTCOME_PHRASES.find((p) => testa.some((l) => p.re.test(l)));
        if (phrase) kind = phrase.kind;
        else {
          // Verbale senza la frase d'esito (storico, o testo modificato a mano):
          // lo dice il livello più alto — 2 e 3 sono "la cosa chiesta non si
          // ottiene", e lì il lavoro non prosegue.
          const max = VR().maxLevel(parsed.findings);
          kind = max !== null && max >= 2 ? 'stop' : 'rimandati';
        }
      }
      rounds.push({ kind, findings: parsed.findings });
      current = null;
    };
    for (const raw of lines) {
      const opener = ROUND_OPENERS.find((o) => o.re.test(raw));
      if (opener) {
        chiudi();
        current = { kind: opener.kind, lines: [raw] };
        continue;
      }
      if (current) {
        if (TURN_MARKER.test(raw)) chiudi();
        else current.lines.push(raw);
      }
    }
    chiudi();
    return rounds;
  }

  /**
   * Quanti giri è costato un lavoro prima di passare. PURA.
   * `null` = nelle note non c'è nessun verbale di verifica (niente da contare:
   * si conta a parte, non si finge uno zero).
   * @returns {{rounds:Array, passata:boolean, giri:number}|null}
   */
  function loopsBeforePass(fb) {
    const rounds = parseRounds(fb);
    if (!rounds.length) return null;
    const idx = rounds.findIndex((r) => ROUND_PASSING.includes(r.kind));
    return idx < 0
      ? { rounds, passata: false, giri: rounds.length }
      : { rounds, passata: true, giri: idx };
  }

  // ── Lavorazioni ───────────────────────────────────────────────────────────
  // "Lavorato" = la lavorazione si è CHIUSA. Il segno è `resolvedInVersion`
  // (lo scrive chi chiude, con la versione in cui il fix esce) oppure lo stato
  // `done`: i feedback archiviati senza essere mai stati lavorati non entrano.
  const IN_LAVORAZIONE = ['working', 'revision_capability', 'revision_security'];
  function isWorked(fb) {
    if (MR().statusUnreadable(fb)) return false;
    const { status } = MR().normalizeStatus(fb);
    if (status === 'done') return true;
    return status === 'archived' && !!(fb && fb.resolvedInVersion);
  }
  function isInProgress(fb) {
    if (MR().statusUnreadable(fb)) return false;
    return IN_LAVORAZIONE.includes(MR().normalizeStatus(fb).status);
  }
  function isQueued(fb) {
    if (MR().statusUnreadable(fb)) return false;
    return MR().normalizeStatus(fb).status === 'todo';
  }

  // ── Il grafico nel tempo: giorno, settimana o mese ────────────────────────
  // La misura la sceglie l'ampiezza della finestra: sessanta colonne è il
  // massimo che si legge, oltre si passa alla misura più grande.
  const MAX_COLONNE = 60;

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function startOfWeek(ms) {
    const d = new Date(startOfDay(ms));
    const dow = (d.getDay() + 6) % 7; // lunedì = 0
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  function startOfMonth(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  function startOfYear(ms) {
    return new Date(new Date(ms).getFullYear(), 0, 1).getTime();
  }
  function nextBucket(unit, ms) {
    const d = new Date(ms);
    if (unit === 'giorno') { d.setDate(d.getDate() + 1); return d.getTime(); }
    if (unit === 'settimana') { d.setDate(d.getDate() + 7); return d.getTime(); }
    if (unit === 'anno') return new Date(d.getFullYear() + 1, 0, 1).getTime();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }
  function bucketStart(unit, ms) {
    if (unit === 'giorno') return startOfDay(ms);
    if (unit === 'settimana') return startOfWeek(ms);
    if (unit === 'anno') return startOfYear(ms);
    return startOfMonth(ms);
  }
  const GIORNI_PER_UNITA = { giorno: 1, settimana: 7, mese: 30.44, anno: 365.25 };
  function chooseUnit(from, to) {
    const giorni = Math.max(1, Math.ceil((to - from) / GIORNO));
    if (giorni <= MAX_COLONNE) return 'giorno';
    if (giorni <= MAX_COLONNE * 7) return 'settimana';
    if (giorni <= MAX_COLONNE * 30) return 'mese';
    return 'anno';
  }
  function colonneNecessarie(unit, from, to) {
    return Math.ceil(((to - from) / GIORNO) / GIORNI_PER_UNITA[unit]) + 1;
  }

  /**
   * Le colonne del grafico nel tempo, con quante segnalazioni cadono in
   * ciascuna. PURA. Ritorna `null` quando non c'è niente da disegnare.
   */
  function timeline(items, range, now) {
    const t = Number.isFinite(now) ? now : Date.now();
    const stamps = items.map(createdMs).filter(Number.isFinite);
    if (!stamps.length) return null;
    const primo = Math.min.apply(null, stamps);
    let from = range.from !== null ? range.from : primo;
    const to = range.to !== null ? Math.min(range.to, t) : t;
    if (!(to >= from)) return null;
    let unit = chooseUnit(from, to);
    // Una finestra molto più larga dei dati (l'anno d'inizio digitato male:
    // «dal 1900») chiederebbe più colonne di quante se ne possano disegnare, e
    // quelle in eccesso sparirebbero in silenzio — grafico bianco, asse fermo a
    // un anno in cui non è successo niente. Il grafico è degli ARRIVI: si parte
    // da dove gli arrivi cominciano davvero.
    if (colonneNecessarie(unit, from, to) > MAX_COLONNE + 6 && primo > from) {
      from = primo;
      unit = chooseUnit(from, to);
    }
    const buckets = [];
    const index = new Map();
    let cursor = bucketStart(unit, from);
    // Il tetto è la rete di sicurezza: una finestra personalizzata di dieci
    // anni non deve generare quattromila colonne.
    while (cursor <= to && buckets.length < MAX_COLONNE + 6) {
      const b = { start: cursor, n: 0 };
      index.set(cursor, b);
      buckets.push(b);
      cursor = nextBucket(unit, cursor);
    }
    for (const ms of stamps) {
      const key = bucketStart(unit, ms);
      const b = index.get(key);
      if (b) b.n += 1;
    }
    return { unit, buckets };
  }

  // ── Partenze delle routine (il registro dei worker) ───────────────────────
  const ROLE_LABELS = {
    'new-work': 'Nuovo lavoro',
    fixer:      'Correzione',
    verifier:   'Verifica',
    secaudit:   'Audit sicurezza',
    prober:     'Esplorazione',
  };
  function roleLabel(role) {
    const r = String(role || '').trim();
    return ROLE_LABELS[r] || (r || 'Sconosciuto');
  }

  /**
   * Le partenze registrate nella finestra, per ruolo. PURA.
   * `parziale` = il registro non arriva fino all'inizio della finestra: il
   * numero è un minimo, e la pagina lo scrive come tale.
   */
  function launches(entries, range) {
    const list = Array.isArray(entries) ? entries : [];
    const stamps = list.map((e) => toMs(e && e.startedAt)).filter(Number.isFinite);
    const oldest = stamps.length ? Math.min.apply(null, stamps) : null;
    const byRole = new Map();
    let total = 0;
    for (const e of list) {
      const ms = toMs(e && e.startedAt);
      if (!inRange(ms, range)) continue;
      const role = String((e && e.role) || '').trim() || 'sconosciuto';
      byRole.set(role, (byRole.get(role) || 0) + 1);
      total += 1;
    }
    const righe = Array.from(byRole.entries())
      .map(([role, n]) => ({ role, label: roleLabel(role), n }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    return {
      total,
      prober: byRole.get('prober') || 0,
      byRole: righe,
      oldest,
      parziale: !!(list.length && oldest !== null && range.from !== null && oldest > range.from),
    };
  }

  // ── Numeri di comodo ──────────────────────────────────────────────────────
  function median(values) {
    const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }
  function average(values) {
    const v = values.filter(Number.isFinite);
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  /** Una durata come la direbbe una persona ("3 g 4 h", "5 h 10 min"). PURA. */
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const ore = Math.floor(min / 60);
    if (ore < 24) {
      const r = min % 60;
      return r ? `${ore} h ${r} min` : `${ore} h`;
    }
    const giorni = Math.floor(ore / 24);
    const r = ore % 24;
    return r ? `${giorni} g ${r} h` : `${giorni} g`;
  }

  /** Un numero con la virgola, all'italiana, con una cifra dopo. PURA. */
  function formatAvg(n) {
    if (!Number.isFinite(n)) return '—';
    return (Math.round(n * 10) / 10).toString().replace('.', ',');
  }

  // ── Il conto completo ─────────────────────────────────────────────────────
  /**
   * Tutti i numeri della scheda, in un colpo solo. PURA.
   *
   * @param {object} input
   *   feedbacks  la lista caricata dalla dashboard (già decifrata)
   *   workerLog  le partenze registrate dal server ([{role, startedAt, num}])
   *   sel        la finestra scelta ({key, from?, to?})
   *   creators   le categorie d'autore selezionate (vuoto/assente = tutte)
   *   now        l'istante di riferimento
   *   pageSize   il tetto del caricamento (per dire "almeno N")
   */
  function compute(input) {
    const i = input && typeof input === 'object' ? input : {};
    const all = Array.isArray(i.feedbacks) ? i.feedbacks : [];
    const now = Number.isFinite(i.now) ? i.now : Date.now();
    const range = windowRange(i.sel, now);
    const scelti = Array.isArray(i.creators) && i.creators.length ? i.creators.slice() : null;
    const pageSize = Number(i.pageSize) > 0 ? Number(i.pageSize) : 0;

    const statiLeggibili = MR().sectionsReliable(all);

    // Quante ne ha scritte ciascuna categoria d'autore NELLA FINESTRA: si conta
    // prima del filtro, o le caselle direbbero sempre "0" tranne quella accesa.
    const perCreatore = new Map();
    for (const key of creatorKeys()) perCreatore.set(key, 0);
    for (const fb of all) {
      if (!inRange(createdMs(fb), range)) continue;
      const k = creatorOf(fb);
      perCreatore.set(k, (perCreatore.get(k) || 0) + 1);
    }

    const passaCreatore = (fb) => !scelti || scelti.includes(creatorOf(fb));
    const daFiltro = all.filter(passaCreatore);

    // ── Ricevuti (per data d'arrivo) ────────────────────────────────────────
    const ricevuti = daFiltro.filter((fb) => inRange(createdMs(fb), range));
    const perCategoria = new Map();
    for (const c of CATEGORIES) perCategoria.set(c.key, 0);
    for (const fb of ricevuti) {
      const k = categoryOf(fb);
      perCategoria.set(k, (perCategoria.get(k) || 0) + 1);
    }

    // ── Lavorati (per ultimo movimento) ─────────────────────────────────────
    const lavorati = daFiltro.filter((fb) => isWorked(fb) && inRange(movedMs(fb), range));
    const durate = lavorati
      .map((fb) => movedMs(fb) - createdMs(fb))
      .filter((d) => Number.isFinite(d) && d >= 0);

    // ── I giri di verifica delle lavorazioni della finestra ─────────────────
    const distribuzione = new Map();
    const perEsito = { pass: 0, fix: 0, stop: 0, rimandati: 0 };
    const perLivello = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let conDati = 0, senzaDati = 0, ferme = 0, giriTotali = 0, tagliate = 0;
    const giriPerLavoro = [];
    for (const fb of lavorati) {
      // Conversazione tagliata dal tetto: i primi giri non ci sono più. Contare
      // quello che resta darebbe «passata subito» al lavoro più combattuto.
      if (notesTruncated(fb)) { tagliate += 1; continue; }
      const r = loopsBeforePass(fb);
      if (!r) { senzaDati += 1; continue; }
      conDati += 1;
      for (const round of r.rounds) {
        perEsito[round.kind] = (perEsito[round.kind] || 0) + 1;
        giriTotali += 1;
        for (const f of round.findings) {
          if (perLivello[f.level] !== undefined) perLivello[f.level] += 1;
        }
      }
      if (!r.passata) { ferme += 1; continue; }
      giriPerLavoro.push(r.giri);
      distribuzione.set(r.giri, (distribuzione.get(r.giri) || 0) + 1);
    }
    const fette = Array.from(distribuzione.entries())
      .map(([giri, n]) => ({ giri, n }))
      .sort((a, b) => a.giri - b.giri);

    // ── Copertura: fin dove arrivano davvero i dati in pagina ───────────────
    const arrivi = all.map(createdMs).filter(Number.isFinite);
    const piuVecchio = arrivi.length ? Math.min.apply(null, arrivi) : null;
    const tetto = pageSize > 0 && all.length >= pageSize;
    const copertura = {
      tetto,
      pageSize,
      piuVecchio,
      // I numeri sono un MINIMO quando il caricamento ha toccato il tetto e la
      // finestra chiede più indietro del feedback più vecchio che è in pagina.
      parziale: !!(tetto && piuVecchio !== null && (range.from === null || range.from < piuVecchio)),
    };

    return {
      range,
      statiLeggibili,
      copertura,
      creatori: creatorKeys().map((key) => ({ key, n: perCreatore.get(key) || 0 })),
      ricevuti: {
        total: ricevuti.length,
        perCategoria: CATEGORIES.map((c) => ({ key: c.key, label: c.label, n: perCategoria.get(c.key) || 0 })),
        timeline: timeline(ricevuti, range, now),
      },
      lavorati: {
        total: lavorati.length,
        tempoMediano: median(durate),
        tempoMedio: average(durate),
      },
      routine: launches(i.workerLog, range),
      giri: {
        conDati,
        senzaDati,
        ferme,
        giriTotali,
        fette,
        media: average(giriPerLavoro),
        alPrimoColpo: giriPerLavoro.length
          ? giriPerLavoro.filter((g) => g === 0).length / giriPerLavoro.length
          : null,
        perEsito,
        perLivello,
      },
      // L'istantanea di adesso: non dipende dalla finestra, e la pagina lo dice.
      adesso: {
        inCoda: daFiltro.filter(isQueued).length,
        inLavorazione: daFiltro.filter(isInProgress).length,
      },
    };
  }

  global.SN_FEEDBACK_STATS = {
    WINDOWS, DEFAULT_WINDOW, windowByKey, windowRange, parseDay, inRange,
    CATEGORIES, CATEGORY_LABELS, categoryOf,
    creatorKeys, creatorOf, CREATORS_ROUTINE, CREATORS_PEOPLE,
    ROUND_KINDS, ROUND_PASSING, parseRounds, loopsBeforePass,
    isWorked, isInProgress, isQueued,
    createdMs, movedMs, timeline, launches, roleLabel,
    median, average, formatDuration, formatAvg,
    compute,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
