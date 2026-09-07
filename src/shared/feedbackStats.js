// Statistiche dei feedback — la parte PURA (feedback #496).
//
// COSA C'È QUI
//   I conti che la scheda «Statistiche feedback» della dashboard di gestione
//   mostra: quanti feedback sono arrivati nella finestra scelta, quanti sono
//   stati lavorati, quante esecuzioni hanno fatto le routine (le esplorazioni
//   fra queste), e quanti giri di verifica serve in media prima che un lavoro
//   passi.
//
// PERCHÉ È UN MODULO A PARTE
//   Sono conti, e i conti si provano con gli unit test in millisecondi. Dentro
//   la pagina sarebbero verificabili solo aprendo Electron, cioè quasi mai.
//   La pagina qui sopra disegna e basta.
//
// DA DOVE VENGONO I NUMERI (e cosa NON possono dire)
//   Due sorgenti, con due orologi diversi, e la finestra si applica a
//   entrambe sul LORO istante:
//     · i FEEDBACK (la lista che la dashboard ha già in mano) → `createdAt`,
//       cioè quando la segnalazione è arrivata. Tutto ciò che riguarda una
//       segnalazione — categoria, creatore, se è stata lavorata, quanti giri
//       di verifica ha richiesto — è ancorato a quell'istante: «i feedback
//       della settimana scorsa» sono quelli ARRIVATI la settimana scorsa,
//       anche se il lavoro è finito ieri;
//     · il REGISTRO DEI WORKER (`config/automation.workerLog`, la stessa
//       fonte della scheda «Log») → `startedAt`, cioè quando un'istanza è
//       partita. «Prober lanciati» conta esecuzioni, non segnalazioni.
//   Il registro dei worker conserva le esecuzioni RECENTI: su una finestra
//   lunga il numero è un minimo, non un totale. Chi disegna lo dice; qui si
//   restituisce anche `runsLogFrom` (l'esecuzione più vecchia che il registro
//   contiene) perché quella frase possa essere vera invece che generica.
//
// I GIRI DI VERIFICA
//   Non esiste un campo «quanti giri» sul documento: l'unica traccia durevole
//   è la conversazione (`notes`), dove ogni verifica lascia la sua nota. Le
//   note le scrivono `SN_VERIFIER_ROUND.roundNote` (formato di oggi) e
//   `verifierNoteText` di dispatch (formato storico, ancora in giro sui
//   feedback vecchi): il riconoscitore qui sotto segue ENTRAMBI, e lo unit
//   test glieli fa produrre da quelle due funzioni invece di ricopiarne le
//   frasi — così se un giorno cambiano le parole, il test diventa rosso qui e
//   non l'anno dopo guardando un grafico sbagliato.
//
// PURO: niente DOM, niente rete, niente Date.now() implicito (l'istante si
// passa). Convenzione IIFE del repo: si registra su globalThis.

(function (global) {
  'use strict';

  // ── Istanti ───────────────────────────────────────────────────────────────

  /**
   * Millisecondi da un valore data di provenienza ignota: stringa ISO, numero,
   * Date, o il timestamp di Firestore ({_seconds} / {seconds}). `null` se non
   * è una data. PURA.
   */
  function toMillis(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
    if (typeof v === 'object') {
      const s = v._seconds != null ? v._seconds : v.seconds;
      const n = Number(s);
      if (Number.isFinite(n)) return n * 1000;
      return null;
    }
    const t = new Date(String(v)).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const DAY = 86400000;

  /**
   * Quante riaperture porta un feedback. PURA.
   *
   * Chi riapre un fix dalla board NON fa avanzare un contatore: Filo scrive una
   * VOCE per ogni persona che l'ha chiesta (`reopenRequests[uid] = { at }`,
   * SN_FEEDBACK.castReopenRequest), ed è quella forma che il resto della
   * dashboard legge (SN_MANAGE_REVIEW.hasReopenRequest). Letta come se fosse un
   * numero, quella mappa dava NaN e la riga «Riaperture chieste» scriveva zero
   * per sempre: non uno zero «non lo so», proprio un numero sbagliato.
   * Si accettano anche numero e lista, per non dipendere dalla forma di domani.
   */
  function reopenCount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  /** Mezzanotte locale del giorno che contiene `ms`. PURA. */
  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // ── La finestra di riferimento ────────────────────────────────────────────
  //
  // «Oggi» e i «giorni» partono da MEZZANOTTE, non da «24 ore fa»: chi guarda
  // le statistiche di lunedì mattina intende lunedì, non da domenica mattina.
  // `days: N` = gli ultimi N giorni di calendario, oggi compreso.
  const WINDOWS = [
    { key: 'today', label: 'Oggi',              days: 1 },
    { key: '7d',    label: 'Ultimi 7 giorni',   days: 7 },
    { key: '30d',   label: 'Ultimi 30 giorni',  days: 30 },
    { key: '90d',   label: 'Ultimi 90 giorni',  days: 90 },
    { key: '365d',  label: 'Ultimo anno',       days: 365 },
    { key: 'all',   label: 'Sempre',            days: null },
    { key: 'custom', label: 'Personalizzata',   days: null },
  ];

  const DEFAULT_WINDOW = '30d';

  /**
   * La finestra scelta, in millisecondi. PURA.
   * @param {string} key    una chiave di WINDOWS
   * @param {object} opts   { now, fromISO, toISO } — le due date solo per 'custom'
   * @returns {{from:number|null, to:number|null, label:string, key:string, nota?:string}}
   *   `from`/`to` a null = nessun limite da quel lato. `to` è ESCLUSIVO (fine
   *   della giornata scelta), così un intervallo «dal 1 al 1» contiene tutto
   *   quel giorno invece di niente.
   */
  function windowRange(key, opts) {
    const o = opts || {};
    const now = toMillis(o.now) != null ? toMillis(o.now) : Date.now();
    const spec = WINDOWS.find((w) => w.key === key) || WINDOWS.find((w) => w.key === DEFAULT_WINDOW);
    if (spec.key === 'all') return { key: 'all', label: spec.label, from: null, to: null };
    if (spec.key === 'custom') {
      const a = toMillis(o.fromISO);
      const b = toMillis(o.toISO);
      // Una sola delle due date è una scelta legittima («da allora in poi»,
      // «fino a quel giorno»): non è un errore, è un limite solo.
      //
      // Nemmeno NESSUNA delle due è un errore: senza limiti la finestra è
      // «sempre», ed è esattamente quello che i numeri qui sotto raccontano.
      // Chiamarlo errore («Scegli almeno una delle due date», in rosso) mentre
      // la riga accanto diceva «da sempre» e le tessere mostravano tutto lo
      // storico faceva dire alla stessa schermata tre cose diverse. È una nota:
      // dice cosa stai guardando e cosa fare per restringere.
      if (a == null && b == null) {
        return {
          key: 'custom', label: 'Personalizzata', from: null, to: null,
          nota: 'Nessuna data scelta: questi sono i numeri di sempre. Scegline una per restringere la finestra.',
        };
      }
      let from = a == null ? null : startOfDay(a);
      let to = b == null ? null : startOfDay(b) + DAY;
      if (from != null && to != null && from >= to) {
        // Invertite: si raddrizzano invece di mostrare zero. Nessuno intende
        // «dal 10 al 3» come «niente».
        const swap = from; from = startOfDay(b); to = swap + DAY;
      }
      return { key: 'custom', label: 'Personalizzata', from, to };
    }
    const to = startOfDay(now) + DAY;
    return { key: spec.key, label: spec.label, from: to - spec.days * DAY, to };
  }

  /**
   * L'istante cade nella finestra? PURA.
   *
   * Un istante IGNOTO (segnalazione senza data d'arrivo, o con una data che non
   * è una data) non cade in nessuna finestra che abbia dei limiti: non si può
   * dire che sia dentro. Ma «Sempre» di limiti non ne ha, e una finestra senza
   * limiti non può lasciare fuori niente: lì ci sta. Prima cadeva fuori anche
   * da «Sempre», e la tessera scriveva un numero più piccolo del vero senza
   * dire quante ne aveva lasciate indietro. Chi disegna riceve comunque il
   * conto di quelle senza data (`senzaData`) e lo dichiara.
   */
  function inRange(ms, range) {
    const r = range || {};
    if (ms == null) return r.from == null && r.to == null;
    if (r.from != null && ms < r.from) return false;
    if (r.to != null && ms >= r.to) return false;
    return true;
  }

  // ── Chi ha creato la segnalazione ─────────────────────────────────────────
  //
  // Le categorie sono quelle di SN_FEEDBACK_THREAD.authorKind (una sola
  // classificazione in tutto Filo: qui si RAGGRUPPA, non si riclassifica).
  // I gruppi servono al filtro: «le routine cloud» è la domanda che si fa
  // davvero, e spuntare cinque caselle a mano per farla è attrito.
  const CREATOR_KINDS = ['owner', 'user', 'filo', 'local', 'prober', 'worker', 'verifier', 'residuo', 'claude'];

  const CREATOR_GROUPS = [
    { key: 'persone', label: 'Persone',      kinds: ['owner', 'user'] },
    { key: 'filo',    label: 'Filo',         kinds: ['filo'] },
    { key: 'locale',  label: 'Sessione locale', kinds: ['local'] },
    { key: 'cloud',   label: 'Routine cloud', kinds: ['prober', 'worker', 'verifier', 'residuo', 'claude'] },
  ];

  /** Le categorie d'autore di un gruppo (o tutte, se il gruppo non esiste). PURA. */
  function kindsOfGroup(key) {
    const g = CREATOR_GROUPS.find((x) => x.key === key);
    return g ? g.kinds.slice() : CREATOR_KINDS.slice();
  }

  /**
   * Il filtro creatore, normalizzato: lista vuota o assente = NESSUN filtro
   * (tutti), mai «nessuno». Un insieme vuoto che significasse «niente» darebbe
   * una pagina di zeri senza dire perché. PURA.
   */
  function normalizeCreators(creators) {
    const list = Array.isArray(creators) ? creators.filter((k) => CREATOR_KINDS.includes(k)) : [];
    return list.length ? list : CREATOR_KINDS.slice();
  }

  // Il ruolo con cui un worker è partito → la categoria d'autore che gli
  // corrisponde, così il filtro creatore vale anche sulle esecuzioni: una
  // esplorazione è «Claude (esplorazione)», una verifica è «Claude (verifica)».
  // Stessa mappa di SN_FEEDBACK_THREAD.authorKind, letta dall'altro verso.
  const ROLE_TO_KIND = {
    prober: 'prober',
    'new-work': 'worker',
    fixer: 'worker',
    verifier: 'verifier',
    secaudit: 'verifier',
  };

  // Le esecuzioni che il registro dei worker racconta, nell'ordine in cui si
  // leggono. `idle`/`off` non sono lavoro: restano fuori dai conti e dalla
  // barra (un «Fermo» in cima alla classifica delle esecuzioni sarebbe una
  // riga che non dice niente).
  const RUN_ROLES = [
    { key: 'prober',   label: 'Esplorazione' },
    { key: 'new-work', label: 'Nuovo lavoro' },
    { key: 'fixer',    label: 'Correzione' },
    { key: 'verifier', label: 'Verifica' },
    { key: 'secaudit', label: 'Audit sicurezza' },
  ];

  // ── Le categorie di una segnalazione ──────────────────────────────────────
  //
  // Raggruppano gli stati canonici in quello che l'owner chiede davvero
  // guardando una torta: quante ne sono arrivate di buone, quante bloccate,
  // quante ancora da decidere. Gli stati «confermati» stanno con i loro
  // sospetti: per un conteggio la conferma è un dettaglio dell'istruttoria.
  const CATEGORIES = [
    { key: 'unlabeled', label: 'Non filtrato',    statuses: ['unlabeled'] },
    { key: 'attacco',   label: 'Attacco',         statuses: ['attack', 'attack_confirmed'] },
    { key: 'spam',      label: 'Spam',            statuses: ['spam', 'spam_confirmed'] },
    { key: 'file',      label: 'File sospetto',   statuses: ['suspicious_file'] },
    { key: 'design',    label: 'Decisione owner', statuses: ['design'] },
    { key: 'aligned',   label: 'Da approvare',    statuses: ['aligned'] },
    { key: 'todo',      label: 'In coda',         statuses: ['todo'] },
    { key: 'lavorazione', label: 'In lavorazione', statuses: ['working', 'revision_capability', 'revision_security'] },
    { key: 'done',      label: 'Risolto',         statuses: ['done'] },
    { key: 'archived',  label: 'Archiviato',      statuses: ['archived'] },
  ];

  const STATUS_TO_CATEGORY = (() => {
    const m = {};
    for (const c of CATEGORIES) for (const s of c.statuses) m[s] = c.key;
    return m;
  })();

  // Una segnalazione «lavorata» è una che è entrata in lavorazione almeno una
  // volta: l'implementazione è partita. Sono gli stati da `working` in poi.
  const WORKED_STATUSES = ['working', 'revision_capability', 'revision_security', 'done', 'archived'];

  // ── Le note di verifica ───────────────────────────────────────────────────
  //
  // Formato di oggi (SN_VERIFIER_ROUND.roundNote):
  //   «Verifica superata.»                                   → nessun rilievo
  //   «Verifica: N rilievi.» + «Il lavoro si ferma: …»       → fermata (fail)
  //   «Verifica: N rilievi.» + «Il verificatore corregge …»  → si corregge
  //   «Verifica: N rilievi.» + «Nessun rilievo da correggere adesso: …»
  // Formato storico (verifierNoteText di dispatch, sui feedback vecchi):
  //   «Controllo funzionalità superato.»                     → pass
  //   «Controllo funzionalità NON superato: …»               → fail
  //   «Verifica: funziona, ma migliorabile — …»              → migliorabile
  const RE_PASS_OGGI    = /(^|\n)\s*Verifica superata\b/i;
  const RE_PASS_STORICO = /(^|\n)\s*Controllo funzionalità superat/i;
  const RE_FAIL_STORICO = /Controllo funzionalità NON superat/i;
  const RE_MIGL_STORICO = /(^|\n)\s*Verifica:\s*funziona,\s*ma migliorabile/i;
  const RE_GIRO_OGGI    = /(^|\n)\s*Verifica:\s*(\d+)\s+rilie/i;
  const RE_STOP         = /Il lavoro si ferma\b/i;
  const RE_FIX          = /Il verificatore corregge\b/i;
  const RE_DERIVATO     = /Nessun rilievo da correggere adesso\b/i;

  // I marcatori che, dentro `notes`, aprono un turno nuovo. Copia MINIMA di
  // quelli di SN_FEEDBACK_THREAD (che è codice di pagina e qui non c'è): serve
  // sapere dove finisce un turno, e se a scriverlo è stata una PERSONA.
  const RE_TURNO = /^---\s*(?:Riaperto il|La tua risposta del|Aggiornamento dell'agente del|Filo ha risposto il)\b/;
  // I due marcatori che aprono un turno dell'UTENTE (stessa coppia di
  // SN_FEEDBACK_THREAD.USER_TURN_RE). Dentro un turno dell'utente non c'è
  // nessuna verifica: c'è quello che una persona ha scritto, e una persona può
  // benissimo scrivere «Verifica superata? non mi pare» o «Verifica: 2 rilievi
  // ancora aperti». Contate come giri, quelle frasi mettevano nella torta un
  // lavoro passato senza critiche che nessuno aveva mai verificato.
  const RE_TURNO_UTENTE = /^---\s*(?:Riaperto il|La tua risposta del)\b/;

  /**
   * I giri di verifica raccontati dalle note, in ordine. PURA.
   *
   * Si leggono solo i turni scritti da un agente: il corpo iniziale delle note
   * (il report di chi ha lavorato) e i turni aperti dai marcatori dell'agente.
   * I turni dell'utente si saltano.
   *
   * @returns {Array<{outcome:'pass'|'fail'|'migliorabile', findings:number}>}
   *   `fail` = il giro ha fermato il lavoro (serve l'owner);
   *   `migliorabile` = ci sono rilievi ma il lavoro prosegue (li corregge il
   *   verificatore, o finiscono nel feedback derivato).
   */
  function parseVerifications(notes) {
    const testo = String(notes == null ? '' : notes).replace(/\r\n?/g, '\n');
    if (!testo.trim()) return [];
    // Un turno per blocco: una nota di verifica non può essere spezzata a metà
    // e contata due volte, né due note nello stesso blocco contate una volta.
    // Il primo blocco non ha marcatore: è il report di chi ha lavorato, quindi
    // di un agente.
    const blocchi = [];
    let corrente = [];
    let diUnUtente = false;
    for (const riga of testo.split('\n')) {
      if (RE_TURNO.test(riga)) {
        blocchi.push({ testo: corrente.join('\n'), utente: diUnUtente });
        corrente = [];
        diUnUtente = RE_TURNO_UTENTE.test(riga);
      } else corrente.push(riga);
    }
    blocchi.push({ testo: corrente.join('\n'), utente: diUnUtente });

    const giri = [];
    for (const blocco of blocchi) {
      if (blocco.utente) continue;
      const b = blocco.testo;
      if (!b.trim()) continue;
      if (RE_FAIL_STORICO.test(b))  { giri.push({ outcome: 'fail', findings: 1 }); continue; }
      if (RE_MIGL_STORICO.test(b))  { giri.push({ outcome: 'migliorabile', findings: 1 }); continue; }
      if (RE_PASS_OGGI.test(b) || RE_PASS_STORICO.test(b)) { giri.push({ outcome: 'pass', findings: 0 }); continue; }
      const m = RE_GIRO_OGGI.exec(b);
      if (m) {
        const findings = Math.max(1, Number(m[2]) || 1);
        // Con rilievi il giro non è un pass. «Si ferma» = serve l'owner (fail);
        // tutto il resto — corretti dal verificatore o passati al feedback
        // derivato — è lavoro che PROSEGUE, cioè «migliorabile».
        giri.push({ outcome: RE_STOP.test(b) ? 'fail' : 'migliorabile', findings });
      }
    }
    return giri;
  }

  /**
   * Il riassunto della verifica di UNA segnalazione. PURA.
   * @returns {{
   *   rounds:number, critiche:number, fail:number, migliorabile:number,
   *   passed:boolean, loopsBeforePass:number|null
   * }}
   *   `loopsBeforePass` = quante critiche sono arrivate PRIMA del primo pass
   *   (0 = passata al primo giro). `null` se un pass non è mai arrivato: quella
   *   segnalazione non ha ancora un numero, e metterla nel secchio «0» direbbe
   *   il contrario di com'è andata.
   */
  function verificationSummary(notes) {
    const giri = parseVerifications(notes);
    let fail = 0, migliorabile = 0, prima = 0, passed = false;
    for (const g of giri) {
      // Dopo il primo pass i giri continuano a contare come critiche (una
      // riapertura ne genera altri), ma non entrano più in `prima`: quel numero
      // risponde a «quanti giri è costato ARRIVARE al pass».
      if (g.outcome === 'pass') { passed = true; continue; }
      if (g.outcome === 'fail') fail += 1; else migliorabile += 1;
      if (!passed) prima += 1;
    }
    return {
      rounds: giri.length,
      critiche: fail + migliorabile,
      fail,
      migliorabile,
      passed,
      loopsBeforePass: passed ? prima : null,
    };
  }

  // Il secchio della torta per un numero di critiche. Oltre il quarto giro il
  // dettaglio non serve più a nessuno: «4 o più» è già la risposta.
  const LOOP_MAX_BUCKET = 4;
  function loopBucketLabel(n) {
    if (n >= LOOP_MAX_BUCKET) return `${LOOP_MAX_BUCKET}+ critiche`;
    if (n === 0) return 'Nessuna critica';
    return n === 1 ? '1 critica' : `${n} critiche`;
  }

  // ── Il conto ──────────────────────────────────────────────────────────────

  // `ids` porta, per ogni gruppo, gli identificativi delle segnalazioni che lo
  // compongono: senza, un numero è un vicolo cieco (non si può andare a vedere
  // CHI c'è dentro) e chi disegna dovrebbe rifare il filtro per conto suo, cioè
  // tenere una seconda copia della stessa regola.
  function sortedEntries(map, order, ids) {
    const conIds = (k) => ({ key: k, count: map[k], ids: (ids && ids[k]) ? ids[k].slice() : [] });
    if (Array.isArray(order)) {
      return order.filter((k) => map[k]).map(conIds);
    }
    return Object.keys(map).map(conIds).sort((a, b) => b.count - a.count);
  }

  /** Aggiunge `id` alla lista del gruppo `k`. Salta gli id vuoti. */
  function pushId(mappa, k, id) {
    if (id == null || id === '') return;
    if (!mappa[k]) mappa[k] = [];
    mappa[k].push(id);
  }

  // Il tetto alle barrette: oltre, il grafico diventa una riga di peli.
  const MAX_BARRE = 60;

  /**
   * Quanto lunga è una barretta dell'andamento: un giorno finché la finestra
   * sta in un mese, poi una settimana, poi un mese, poi un anno. PURA.
   *
   * L'ultimo scalino esiste perché il tetto alle barrette non basta da solo:
   * tenendo il mese su una finestra di dieci anni, tutto quello che sta oltre
   * il tetto finirebbe schiacciato nell'ultima barretta, che conterebbe roba
   * che l'etichetta sotto non nomina — un grafico che dice il falso proprio
   * dove nessuno va a controllare.
   *
   * E neanche l'anno basta: con due date scelte a mano si arriva a intervalli
   * di secoli (basta sbagliare a digitare l'anno di partenza), e lì sessanta
   * barrette annuali coprono sessant'anni su centoventi. Sopra quella soglia
   * la barretta si allarga a QUANTI anni servono perché l'ultima cada dove
   * finisce davvero la finestra. Verificato: dal 1900 a oggi le barrette
   * dicevano che i feedback di quest'anno erano arrivati nel 1959.
   */
  function bucketSizeFor(spanMs) {
    if (spanMs <= 31 * DAY) return { key: 'day', ms: DAY, label: 'al giorno' };
    if (spanMs <= 200 * DAY) return { key: 'week', ms: 7 * DAY, label: 'a settimana' };
    if (spanMs <= MAX_BARRE * 30 * DAY) return { key: 'month', ms: 30 * DAY, label: 'al mese' };
    const YEAR = 365 * DAY;
    if (spanMs <= MAX_BARRE * YEAR) return { key: 'year', ms: YEAR, label: 'all\'anno' };
    const anni = Math.ceil(spanMs / MAX_BARRE / YEAR);
    return { key: 'years', ms: anni * YEAR, label: `ogni ${anni} anni`, anni };
  }

  /**
   * TUTTI i numeri della scheda. PURA.
   *
   * @param {object} p
   *   feedbacks    la lista che la dashboard ha già (decifrata, se si può)
   *   workerLog    [{ role, startedAt, num }] — il registro dei worker, o []
   *   range        da windowRange()
   *   creators     categorie d'autore ammesse (vuoto = tutte)
   *   now          istante di riferimento (per l'andamento)
   *   authorKindOf (fb) => categoria d'autore — SN_FEEDBACK_THREAD.authorKind
   *   statusOf     (fb) => { status, unreadable } — da SN_MANAGE_REVIEW
   */
  function compute(p) {
    const o = p || {};
    const feedbacks = Array.isArray(o.feedbacks) ? o.feedbacks : [];
    const workerLog = Array.isArray(o.workerLog) ? o.workerLog : [];
    const range = o.range || { from: null, to: null };
    const creators = normalizeCreators(o.creators);
    const now = toMillis(o.now) != null ? toMillis(o.now) : Date.now();
    const authorKindOf = typeof o.authorKindOf === 'function' ? o.authorKindOf : (() => 'user');
    const statusOf = typeof o.statusOf === 'function' ? o.statusOf : (() => ({ status: '', unreadable: true }));

    const ammesso = (k) => creators.includes(k);

    // ── I feedback della finestra ────────────────────────────────────────────
    const selezionati = [];
    for (const fb of feedbacks) {
      const ms = toMillis(fb && fb.createdAt);
      if (!inRange(ms, range)) continue;
      const kind = authorKindOf(fb) || 'user';
      if (!ammesso(kind)) continue;
      selezionati.push({ fb, ms, kind });
    }

    const perCategoria = {};
    const perCreatore = {};
    const perPriorita = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const idsCategoria = {};
    const idsCreatore = {};
    // Anche le priorità e i due segnali portano gli id di ciò che hanno
    // contato: senza, «priorità alta: 2» resta un numero da cui non si scende,
    // mentre ogni altra riga della stessa scheda si apre (pattern «Un numero
    // mostrato porta alle cose che ha contato»).
    const idsPriorita = {};
    const idsRiaperti = [];
    const idsArenati = [];
    const idsIlleggibili = [];
    const idsNonLavorati = [];
    let illeggibili = 0;
    let lavorati = 0;
    let risolti = 0;
    let riaperture = 0;
    let stalli = 0;

    for (const it of selezionati) {
      const fbId = it.fb && it.fb._id;
      perCreatore[it.kind] = (perCreatore[it.kind] || 0) + 1;
      pushId(idsCreatore, it.kind, fbId);
      const st = statusOf(it.fb) || {};
      if (st.unreadable || !st.status) {
        illeggibili += 1;
        if (fbId != null && fbId !== '') idsIlleggibili.push(fbId);
      } else {
        const cat = STATUS_TO_CATEGORY[st.status] || 'unlabeled';
        perCategoria[cat] = (perCategoria[cat] || 0) + 1;
        pushId(idsCategoria, cat, fbId);
        if (WORKED_STATUSES.includes(st.status)) lavorati += 1;
        else if (fbId != null && fbId !== '') idsNonLavorati.push(fbId);
        if (st.status === 'done' || st.status === 'archived') risolti += 1;
      }
      const pr = Math.round(Number(it.fb && it.fb.priority) || 0);
      const secchio = pr >= 1 && pr <= 3 ? pr : 0;
      perPriorita[secchio] += 1;
      pushId(idsPriorita, String(secchio), fbId);
      const riap = reopenCount(it.fb && it.fb.reopenRequests);
      riaperture += riap;
      if (riap && fbId != null && fbId !== '') idsRiaperti.push(fbId);
      // Stessa regola della lista: `stalls` è il totale che non si azzera mai,
      // `workingResets` il contatore operativo che una consegna riporta a zero.
      // Si legge il primo che c'è, perché sommarli conterebbe due volte lo
      // stesso arenamento.
      const are = Math.max(0, Math.round(
        Number(it.fb && it.fb.stalls) || Number(it.fb && it.fb.workingResets) || 0
      ));
      stalli += are;
      if (are && fbId != null && fbId !== '') idsArenati.push(fbId);
    }

    // ── I giri di verifica ───────────────────────────────────────────────────
    const loopBuckets = {};
    const idsLoop = {};
    const idsNonPassati = [];
    // Una segnalazione che questo computer non sa decifrare non ha «zero giri»:
    // ha giri che nessuno può leggere. Contarla come le altre la farebbe
    // sparire dalla torta in silenzio, mentre nella ripartizione per categoria
    // viene dichiarata: due parti della stessa scheda direbbero cose diverse
    // sullo stesso documento.
    let conVerifica = 0, passati = 0, nonPassati = 0, nonLeggibili = 0;
    let critFail = 0, critMigliorabile = 0, sommaLoop = 0;
    // Le due fette dell'esito contano CRITICHE, cioè eventi, e un lavoro può
    // averne prese più d'una: l'elenco che si apre porta ai lavori su cui sono
    // successe, come la riga delle riaperture. Senza questi id le due voci
    // erano le uniche della scheda che non si aprivano su niente, accanto a una
    // torta gemella che si apriva.
    const idsFail = [];
    const idsMigliorabile = [];
    for (const it of selezionati) {
      const fbId = it.fb && it.fb._id;
      const st = statusOf(it.fb) || {};
      if (st.unreadable || !st.status) { nonLeggibili += 1; continue; }
      const v = verificationSummary(it.fb && it.fb.notes);
      if (!v.rounds) continue;
      conVerifica += 1;
      critFail += v.fail;
      critMigliorabile += v.migliorabile;
      if (v.fail && fbId != null && fbId !== '') idsFail.push(fbId);
      if (v.migliorabile && fbId != null && fbId !== '') idsMigliorabile.push(fbId);
      if (v.passed) {
        passati += 1;
        sommaLoop += v.loopsBeforePass;
        const b = Math.min(LOOP_MAX_BUCKET, v.loopsBeforePass);
        loopBuckets[b] = (loopBuckets[b] || 0) + 1;
        pushId(idsLoop, b, fbId);
      } else {
        nonPassati += 1;
        if (fbId != null && fbId !== '') idsNonPassati.push(fbId);
      }
    }
    const loop = {
      // Le fette della torta, in ordine di giri: la torta racconta una scala,
      // non una classifica, e riordinarla per dimensione la renderebbe
      // illeggibile («2 critiche» prima di «nessuna critica»).
      slices: Object.keys(loopBuckets)
        .map(Number).sort((a, b) => a - b)
        .map((n) => ({
          key: String(n), loops: n, label: loopBucketLabel(n), count: loopBuckets[n],
          ids: (idsLoop[n] || []).slice(),
        })),
      passati,
      nonPassati,
      nonPassatiIds: idsNonPassati,
      nonLeggibili,
      conVerifica,
      media: passati ? sommaLoop / passati : null,
      critiche: critFail + critMigliorabile,
      fail: critFail,
      failIds: idsFail,
      migliorabile: critMigliorabile,
      migliorabileIds: idsMigliorabile,
    };

    // ── Le esecuzioni delle routine ─────────────────────────────────────────
    // Il filtro creatore vale anche qui: un'esecuzione è di una categoria
    // (l'esplorazione è «Claude (esplorazione)»), e chiedere «solo le persone»
    // deve azzerare le esecuzioni, non lasciarle lì a contraddire il filtro.
    const perRuolo = {};
    let esecuzioni = 0;
    let logDaMs = null;
    for (const e of workerLog) {
      const ms = toMillis(e && e.startedAt);
      if (ms != null && (logDaMs == null || ms < logDaMs)) logDaMs = ms;
      if (!inRange(ms, range)) continue;
      const role = String((e && e.role) || '').trim();
      if (!RUN_ROLES.some((r) => r.key === role)) continue;
      if (!ammesso(ROLE_TO_KIND[role] || 'claude')) continue;
      perRuolo[role] = (perRuolo[role] || 0) + 1;
      esecuzioni += 1;
    }

    // ── L'andamento degli arrivi ────────────────────────────────────────────
    // Gli estremi di ciò che si sta contando, in un giro solo (lo spread di
    // Math.min su una lista lunga la passa tutta come argomenti).
    let primoMs = null, ultimoMs = null;
    for (const it of selezionati) {
      if (primoMs == null || it.ms < primoMs) primoMs = it.ms;
      if (ultimoMs == null || it.ms > ultimoMs) ultimoMs = it.ms;
    }
    const daMs = range.from != null ? range.from
      : (primoMs != null ? primoMs : startOfDay(now));
    // Senza un limite in fondo («Sempre», o una finestra personalizzata con la
    // sola data d'inizio) il grafico arrivava comunque a oggi, e un feedback
    // con la data nel futuro (l'orologio storto di chi ha segnalato) finiva
    // schiacciato nell'ultima barretta, quella etichettata con la data di oggi:
    // la barretta di oggi contava una segnalazione dell'anno prossimo. Il
    // grafico arriva dove arriva ciò che sta contando.
    const aMs = range.to != null ? range.to
      : Math.max(startOfDay(now) + DAY, ultimoMs != null ? startOfDay(ultimoMs) + DAY : 0);
    const bucket = bucketSizeFor(Math.max(DAY, aMs - daMs));
    const nBarre = Math.max(1, Math.min(MAX_BARRE, Math.ceil((aMs - daMs) / bucket.ms)));
    const barre = [];
    for (let i = 0; i < nBarre; i += 1) {
      const from = daMs + i * bucket.ms;
      // Le barrette sono tutte larghe uguale, quindi l'ultima finisce sempre
      // OLTRE la fine della finestra: fino a un secchio più in là. Scritta così
      // com'è, l'etichetta in fondo all'asse prometteva un periodo che non è
      // ancora successo (con «Sempre» una data di venti giorni nel futuro, e
      // partendo dal 1900 il «29/11/2028» sotto una riga che diceva «a oggi»).
      // La barretta resta larga uguale, la sua FINE dichiarata no: si ferma
      // dove finisce la finestra.
      const to = daMs + (i + 1) * bucket.ms;
      barre.push({ from, to: Math.max(from + 1, Math.min(to, aMs)), count: 0 });
    }
    for (const it of selezionati) {
      const i = Math.min(nBarre - 1, Math.max(0, Math.floor((it.ms - daMs) / bucket.ms)));
      barre[i].count += 1;
    }

    return {
      range,
      creators,
      ricevuti: selezionati.length,
      categorie: sortedEntries(perCategoria, CATEGORIES.map((c) => c.key), idsCategoria),
      illeggibili,
      idsIlleggibili,
      idsNonLavorati,
      creatori: sortedEntries(perCreatore, CREATOR_KINDS, idsCreatore),
      priorita: perPriorita,
      idsPriorita,
      lavorati,
      risolti,
      riaperture,
      // Le riaperture e gli arenamenti sono EVENTI: il numero li conta tutti
      // (una segnalazione può essersi arenata due volte), l'elenco porta alle
      // segnalazioni su cui sono successi, che sono quello che si vuole aprire.
      idsRiaperti,
      stalli,
      idsArenati,
      loop,
      esecuzioni,
      prober: perRuolo.prober || 0,
      ruoli: sortedEntries(perRuolo, RUN_ROLES.map((r) => r.key)),
      runsLogFrom: logDaMs,
      runsLogVuoto: workerLog.length === 0,
      andamento: { bucket, barre },
    };
  }

  global.SN_FEEDBACK_STATS = {
    WINDOWS, DEFAULT_WINDOW, CREATOR_KINDS, CREATOR_GROUPS, CATEGORIES, RUN_ROLES,
    ROLE_TO_KIND, WORKED_STATUSES, LOOP_MAX_BUCKET,
    toMillis, startOfDay, windowRange, inRange, kindsOfGroup, normalizeCreators, sortedEntries,
    reopenCount,
    parseVerifications, verificationSummary, loopBucketLabel, bucketSizeFor, MAX_BARRE, compute,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
