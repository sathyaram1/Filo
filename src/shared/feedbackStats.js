// Le statistiche dei feedback — la parte PURA (feedback #496).
//
// COSA C'È QUI
//   I conti della scheda «Statistiche feedback» della dashboard di gestione:
//   quanti ne sono arrivati, quanti ne sono stati lavorati, quante
//   esplorazioni sono partite, quanti giri di verifica è costato ogni lavoro,
//   più i tempi e le ripartizioni. Tutto su una FINESTRA di tempo scelta
//   dall'owner e su un filtro per creatore.
//
// DUE SORGENTI, DUE DATE DIVERSE — e non sono intercambiabili:
//   · i FEEDBACK (`allFeedbacks` in pagina) hanno la data di INVIO
//     (`createdAt`): rispondono a «quanti ne sono arrivati»;
//   · il REGISTRO DEI WORKER (`config/automation.workerLog`, che il server
//     scrive al rilascio di ogni biglietto: `{ role, startedAt, num }`) ha la
//     data di LAVORAZIONE: risponde a «quanto lavoro è stato fatto», «quante
//     esplorazioni sono partite» e «quanti giri è costato un fix».
//   Contare i lavorati sulla data d'invio sarebbe una risposta sbagliata data
//   in silenzio: un feedback di marzo lavorato oggi è lavoro di oggi.
//
// PERCHÉ I GIRI SI CONTANO DAL REGISTRO
//   Dal ridisegno del 2026-09-05 (feedback #561) il verificatore non dà più un
//   verdetto a tre valori: registra i rilievi coi livelli e l'esito lo calcola
//   il SERVER dai bilanci. Quello che resta visibile da questo lato è quante
//   volte un verificatore è stato lanciato sullo stesso numero: il primo giro
//   è la verifica, ogni giro in più è una critica che ha rimandato indietro il
//   lavoro. Quindi «critiche prima del via libera» = lanci del verificatore
//   meno uno. Non c'è un contatore sul documento: il conto dei giri vive sul
//   server, e questa è l'unica traccia che arriva al client.
//
// IL REGISTRO È UNA FINESTRA, E LO DICE
//   `workerLog` è un elenco delle ultime esecuzioni, non l'archivio di sempre.
//   Perciò `copertura` porta il primo e l'ultimo istante che il registro
//   contiene: chi disegna la pagina lo dichiara invece di far passare per
//   totale un numero che è un minimo (CLAUDE.md § Limiti; il pattern
//   «Una pagina dei più recenti non è "tutto"»).
//
// PURO: niente DOM, niente rete, niente Date.now() implicito (l'istante lo
// passa il chiamante). Convenzione IIFE del repo: si registra su globalThis
// come SN_FEEDBACK_STATS.

(function (global) {
  'use strict';

  var GIORNO_MS = 24 * 60 * 60 * 1000;

  // ── Le finestre di riferimento ────────────────────────────────────────────
  // `giorni: null` = senza inizio (tutto quello che c'è). `custom` = due date
  // scelte a mano. L'ordine è quello dei pulsanti in pagina.
  var PRESETS = [
    { key: 'oggi',   label: 'Oggi',        giorni: 1 },
    { key: '7g',     label: '7 giorni',    giorni: 7 },
    { key: '30g',    label: '30 giorni',   giorni: 30 },
    { key: '90g',    label: '90 giorni',   giorni: 90 },
    { key: 'tutto',  label: 'Tutto',       giorni: null },
    { key: 'custom', label: 'Scegli tu',   giorni: null, custom: true },
  ];

  function presetOf(key) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return PRESETS[i];
    return null;
  }

  /** Millisecondi da una data ISO (o da un numero). NaN → null. PURA. */
  function ms(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    var t = new Date(String(value)).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /** L'inizio del giorno locale che contiene `t`. PURA. */
  function inizioGiorno(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * La finestra scelta → { key, label, da, a }. `da === null` = senza inizio.
   * `ora` è l'istante "adesso" (il chiamante lo passa: la purezza è il motivo).
   * `custom` = { da: 'YYYY-MM-DD', a: 'YYYY-MM-DD' }, estremi INCLUSI.
   *
   * Le finestre a giorni partono dall'inizio del giorno, non da «24 ore fa»:
   * «Oggi» deve voler dire oggi, non «da ieri a quest'ora». PURA.
   */
  function rangeOf(key, ora, custom) {
    var adesso = ms(ora);
    if (adesso == null) adesso = 0;
    var p = presetOf(key) || presetOf('30g');
    if (p.custom) {
      var gDa = custom && custom.da ? String(custom.da) : '';
      var gA  = custom && custom.a  ? String(custom.a)  : '';
      // Estremi invertiti: si raddrizzano invece di tornare zero risultati
      // senza dire perché. Si scambiano i GIORNI, non gli istanti già
      // costruiti: il primo è la mezzanotte, il secondo la fine della giornata,
      // e scambiare quelli darebbe una finestra storta di un giorno in meno.
      if (gDa && gA && gDa > gA) { var tmp = gDa; gDa = gA; gA = tmp; }
      var da = ms(gDa ? gDa + 'T00:00:00' : null);
      var a  = ms(gA  ? gA  + 'T23:59:59.999' : null);
      // Nessuna data di fine = finestra senza fine, non «fino a adesso»: una
      // segnalazione con l'orologio avanti è pur sempre arrivata, e «Dal 1°
      // marzo» non ha motivo di lasciarla fuori.
      return { key: 'custom', label: etichettaCustom(da, a), da: da, a: a };
    }
    // «Tutto» vuol dire tutto, anche in avanti: una data spostata nel futuro
    // dall'orologio storto di chi ha scritto non deve sparire dall'unica
    // finestra che promette di non lasciare fuori niente.
    if (p.giorni == null) return { key: p.key, label: p.label, da: null, a: null };
    var inizio = inizioGiorno(adesso) - (p.giorni - 1) * GIORNO_MS;
    return { key: p.key, label: p.label, da: inizio, a: adesso };
  }

  function dueCifre(n) { return n < 10 ? '0' + n : String(n); }

  /**
   * Una data locale da anno/mese/giorno, per QUALUNQUE anno. PURA.
   *
   * `new Date(1, 0, 1)` non è il 1° gennaio dell'anno 1: il costruttore mappa
   * gli anni da 0 a 99 sul Novecento, e dà il 1901. Scegliendo a mano una
   * finestra che parte dall'anno 0001 la riga sopra scriveva «dal 1/1/1» e la
   * prima colonna del grafico si chiamava «1901». `setFullYear` è l'unico modo
   * di dire l'anno davvero.
   */
  function dataLocale(anno, mese, giorno) {
    var d = new Date(2000, 0, 1);
    d.setHours(0, 0, 0, 0);
    // Con tre argomenti `setFullYear` fa anche il riporto (mese 12 = gennaio
    // dell'anno dopo, giorno 0 = ultimo del mese prima), che è quello su cui
    // contano il passo successivo e la settimana.
    d.setFullYear(anno, mese || 0, giorno == null ? 1 : giorno);
    return d;
  }

  /** 'YYYY-MM-DD' da un istante. PURA. */
  function giornoDi(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + dueCifre(d.getMonth() + 1) + '-' + dueCifre(d.getDate());
  }

  /** 'D/M/YYYY' da un istante — come lo legge una persona. PURA. */
  function dataBreve(t) {
    if (t == null) return '';
    var d = new Date(t);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function etichettaCustom(da, a) {
    if (da == null && a == null) return 'Scegli tu';
    if (da == null) return 'Fino al ' + dataBreve(a);
    if (a == null) return 'Dal ' + dataBreve(da);
    return dataBreve(da) + ' – ' + dataBreve(a);
  }

  /** L'istante cade nella finestra? Estremi inclusi; `da: null` = da sempre. PURA. */
  function inRange(value, range) {
    var t = ms(value);
    if (t == null) return false;
    var r = range || {};
    if (r.da != null && t < r.da) return false;
    if (r.a != null && t > r.a) return false;
    return true;
  }

  // ── Numeri di segnalazione ────────────────────────────────────────────────
  // Il registro dei worker scrive il numero come stringa ('496', '496.1', a
  // volte col cancelletto). Qui si normalizza da tutte e due le parti, o il
  // registro e la coda non si incontrano mai.

  /** '#496.1' → '496.1'. Vuoto se non è un numero di segnalazione. PURA. */
  function normNum(num) {
    var s = String(num == null ? '' : num).trim().replace(/^#+/, '');
    return /^\d+(\.\d+)?$/.test(s) ? s : '';
  }

  /** Il numero di un feedback ('496' / '496.1'), normalizzato. PURA. */
  function numeroDi(fb) {
    var seq = Number(fb && fb.seq);
    if (!Number.isInteger(seq) || seq <= 0) return '';
    var sub = Number(fb && fb.subSeq);
    return Number.isInteger(sub) && sub > 0 ? seq + '.' + sub : String(seq);
  }

  /** Il numero PADRE di un derivato: '496.1' → '496'; '496' → '496'. PURA. */
  function numeroPadre(num) {
    var n = normNum(num);
    var i = n.indexOf('.');
    return i < 0 ? n : n.slice(0, i);
  }

  // ── Le dipendenze condivise ───────────────────────────────────────────────
  // Si risolvono al momento della chiamata, non al caricamento: così l'ordine
  // degli script in pagina può cambiare senza rompere niente, e se manca
  // davvero il guasto si sente (un ripiego muto direbbe «utente» per tutti e
  // la ripartizione per creatore sarebbe una bugia).
  function deps() {
    var TH = global.SN_FEEDBACK_THREAD;
    var MR = global.SN_MANAGE_REVIEW;
    var ST = global.SN_FB_STATUS;
    if (!TH || typeof TH.authorKind !== 'function') {
      throw new Error('feedbackStats: manca SN_FEEDBACK_THREAD (va caricato prima)');
    }
    if (!MR || typeof MR.normalizeStatus !== 'function') {
      throw new Error('feedbackStats: manca SN_MANAGE_REVIEW (va caricato prima)');
    }
    return { TH: TH, MR: MR, ST: ST };
  }

  // Il mittente non si è potuto leggere: la chiave privata dell'owner non c'è
  // su questo computer, e al posto del `clientId` è arrivato il segnaposto.
  // NON è una categoria d'autore come le altre: sta fuori dall'elenco dei
  // creatori apposta, così non diventa una pasticca del filtro (non si filtra
  // per «non lo so»), ma compare nella ripartizione col suo nome.
  var CREATORE_ILLEGGIBILE = '__illeggibile';
  var ETICHETTA_ILLEGGIBILE = 'Non leggibile con questa chiave';

  /**
   * La categoria d'autore di un feedback ('user', 'prober', …). PURA.
   *
   * Il `clientId` viaggia cifrato come lo stato: senza chiave il main mette al
   * suo posto il segnaposto, e `authorKind` di un segnaposto rispondeva
   * «utente» — cioè la scheda dichiarava illeggibile la categoria e nella
   * stessa riga attribuiva con sicurezza tutti i mittenti a una persona.
   */
  function creatoreDi(fb) {
    var d = deps();
    var id = fb && fb.clientId;
    if (d.MR.valueUnreadable && d.MR.valueUnreadable(id)) return CREATORE_ILLEGGIBILE;
    return d.TH.authorKind(id);
  }

  // I creatori, nell'ordine della coda (prima le persone, poi le istanze di
  // Claude dalla più vicina all'owner, in fondo Filo). Stesso ordine di
  // AUTHOR_RANK in manage.js: chi legge le due superfici non deve reimparare.
  var CREATORI = ['owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo'];

  // ── Le due domande che ci si fa davanti a questa scheda ──────────────────
  // «Quanto è arrivato dalle persone» e «quanto hanno prodotto le routine».
  // Con una pasticca per mittente, la seconda costava sei clic e la
  // conoscenza di quale delle nove voci è una routine: la segnalazione
  // chiedeva per esempio «i feedback lanciati da prober o altre routine
  // cloud», e quello è un gruppo, non un mittente.
  //
  // `filo` sta con le PERSONE, non con le routine: un feedback che nasce da
  // Filo è la voce di un utente vero filtrata da un modello, non un processo
  // dell'owner (stessa scelta di feedbackThread.js). La sessione locale sta
  // invece con le routine: è un'istanza di Claude, gira solo sul computer
  // dell'owner.
  var GRUPPI_CREATORI = [
    { key: '__persone', label: 'Persone', kinds: ['owner', 'user', 'filo'] },
    { key: '__routine', label: 'Routine', kinds: ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'] },
  ];

  // ── Il registro dei worker ────────────────────────────────────────────────

  /** Le voci del registro, normalizzate e con l'istante già in millisecondi. PURA. */
  function normalizeLog(entries) {
    var out = [];
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;
      var t = ms(e.startedAt);
      if (t == null) continue;
      out.push({ role: String(e.role || '').trim(), t: t, num: normNum(e.num) });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  // I ruoli che LAVORANO su una segnalazione (l'esplorazione no: gira sull'app,
  // non su un numero).
  var RUOLI_LAVORO = ['new-work', 'fixer', 'resolver', 'verifier', 'secaudit'];
  function isLavoro(role) { return RUOLI_LAVORO.indexOf(role) >= 0; }

  // ── Conti ─────────────────────────────────────────────────────────────────

  function mediana(valori) {
    if (!valori.length) return null;
    var v = valori.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  }

  function conta(mappa, chiave) {
    mappa[chiave] = (mappa[chiave] || 0) + 1;
  }

  /**
   * Le fette della torta dei giri. `giri` = quante critiche hanno rimandato
   * indietro il lavoro prima del via libera. Da 3 in su si raggruppa: oltre,
   * la torta diventa un ventaglio di spicchi da una fetta ciascuno. PURA.
   */
  function fettaGiri(n) {
    if (n <= 0) return { key: 'g0', label: 'Passato subito' };
    if (n === 1) return { key: 'g1', label: '1 critica' };
    if (n === 2) return { key: 'g2', label: '2 critiche' };
    return { key: 'g3', label: '3 o più critiche' };
  }
  var ORDINE_FETTE = ['g0', 'g1', 'g2', 'g3', 'fermati'];
  var ETICHETTE_FETTE = {
    g0: 'Passato subito',
    g1: '1 critica',
    g2: '2 critiche',
    g3: '3 o più critiche',
    fermati: 'Fermato: decidi tu',
  };

  /**
   * Il lavoro si è fermato e aspetta l'owner? PURA.
   *
   * La regola è lo STATO, non l'elenco dei motivi. `design` vuol dire una sola
   * cosa (FEEDBACK-STATES.md §5): il giro automatico si è fermato e la palla è
   * tornata all'owner, che rispondendo lo rimanda in coda. I motivi sono sei e
   * possono crescere — bilancio delle correzioni esaurito, rilievo che chiede
   * una decisione, fix bocciato dalla sicurezza, ramo fermo al cancello di
   * fusione, lavorazione arenata, routine che ha domande — e tenerne qui un
   * elenco a mano significava, per i tre non elencati, dare per «ancora in
   * lavorazione» un lavoro che aspettava l'owner: il contrario del vero,
   * proprio sul numero che la segnalazione chiedeva.
   */
  function fermato(fb) {
    var MR = deps().MR;
    var n = MR.normalizeStatus(fb) || {};
    if (n.status === 'design') return true;
    var l4 = fb && fb.livelli && fb.livelli.l4;
    return !!(l4 && String(l4.esito || '').trim() === 'fail');
  }

  /**
   * Lo stato di questo lavoro è arrivato cifrato, cioè su questo computer non
   * si legge? PURA. Stessa domanda che la scheda si fa già per dare un nome
   * alla categoria: qui serve a non mettere in una casella del giro un lavoro
   * di cui non si sa in che punto del giro sia.
   */
  function statoIlleggibile(fb) {
    var MR = deps().MR;
    return !!(MR.statusUnreadable && MR.statusUnreadable(fb));
  }

  // Gli stati che si raggiungono SOLO passando la verifica comportamentale
  // (FEEDBACK-STATES.md: revision_capability → revision_security → done →
  // archived). Prima di lì il via libera non c'è ancora stato.
  var STATI_PASSATI = ['revision_security', 'done', 'archived'];

  /**
   * Il lavoro ha avuto il via libera dalla verifica? Serve alla torta: finché
   * la risposta è no, «quante critiche è costato» non è una domanda a cui si
   * può rispondere — il lavoro è ancora in mezzo al giro e le critiche possono
   * aumentare. Contarlo fra i «passati subito» faceva dire alla scheda che un
   * lavoro ancora aperto era il più economico di tutti. PURA.
   */
  function passato(fb) {
    var MR = deps().MR;
    var n = MR.normalizeStatus(fb) || {};
    return STATI_PASSATI.indexOf(n.status) >= 0;
  }

  /** L'esito dell'audit di sicurezza, o '' se non è ancora stato fatto. PURA. */
  function esitoAudit(fb) {
    var l4 = fb && fb.livelli && fb.livelli.l4;
    var e = String((l4 && l4.esito) || '').trim();
    return (e === 'pass' || e === 'fail' || e === 'saltato') ? e : '';
  }

  /**
   * La categoria in cui la dashboard mette il feedback, COL NOME che la
   * dashboard le dà. Il nome sta in `SN_FB_STATUS.STATUSES` (la tabella di
   * presentazione); `CANONICAL` è solo l'elenco delle chiavi, e cercarci dentro
   * per nome dava «Stato ignoto» su ogni riga. PURA.
   */
  function categoriaDi(fb) {
    var d = deps();
    if (d.MR.statusUnreadable && d.MR.statusUnreadable(fb)) {
      return { key: '__illeggibile', label: 'Non leggibile con questa chiave' };
    }
    var n = d.MR.normalizeStatus(fb) || {};
    var tabella = (d.ST && d.ST.STATUSES) || {};
    var info = n.status ? tabella[n.status] : null;
    return { key: n.status || '__ignoto', label: (info && info.label) || 'Stato ignoto' };
  }

  /**
   * La serie temporale degli arrivi, una colonna per PERIODO della finestra,
   * anche per i periodi vuoti. PURA.
   *
   * Saltare i periodi vuoti e accostare quelli pieni toglie il tempo all'asse
   * del tempo: due settimane distanti tre mesi uscivano appiccicate, larghe
   * uguali, e si leggevano come due settimane di fila. Il silenzio è metà di
   * quello che un grafico degli arrivi deve far vedere.
   *
   * Il passo si sceglie sulla lunghezza della finestra, così le colonne
   * restano un numero leggibile: giorni fino a due mesi, settimane fino a un
   * anno e mezzo, mesi fino a dieci anni, poi anni.
   */
  function serieTemporale(voci, range) {
    if (!voci.length) return { passo: 'giorno', punti: [] };
    var istanti = [];
    for (var k = 0; k < voci.length; k++) istanti.push(voci[k].t);
    var minT = Math.min.apply(null, istanti);
    var maxT = Math.max.apply(null, istanti);
    // Senza estremi dichiarati (la finestra «Tutto») li danno i dati. Con la
    // finestra dichiarata si disegna TUTTA la finestra: se hai scelto novanta
    // giorni, le colonne sono novanta giorni, non i due in cui è arrivato
    // qualcosa. Un dato fuori dagli estremi (l'orologio avanti di chi ha
    // scritto) allarga il disegno invece di sparire.
    var da = range && range.da != null ? Math.min(range.da, minT) : minT;
    var a  = range && range.a  != null ? Math.max(range.a,  maxT) : maxT;
    var giorni = Math.max(1, Math.round((a - da) / GIORNO_MS) + 1);
    var passo = giorni > 3650 ? 'anno'
      : (giorni > 550 ? 'mese' : (giorni > 62 ? 'settimana' : 'giorno'));
    var mappa = Object.create(null);
    for (var i = 0; i < voci.length; i++) {
      var ch = chiavePasso(voci[i].t, passo);
      if (!mappa[ch]) mappa[ch] = { chiave: ch, n: 0, ids: [] };
      mappa[ch].n += 1;
      if (voci[i].id) mappa[ch].ids.push(voci[i].id);
    }
    var punti = [];
    var chiavi = chiaviDelPeriodo(da, a, passo);
    for (var j = 0; j < chiavi.length; j++) {
      var ch2 = chiavi[j];
      var p = mappa[ch2] || { chiave: ch2, n: 0, ids: [] };
      // Le date si scrivono come si scrivono nel resto della scheda (25/8/2026),
      // non nella forma tecnica con cui sono state raggruppate (2026-08-25).
      p.label = etichettaPasso(ch2, passo);
      p.t = istantePasso(ch2, passo);
      punti.push(p);
      delete mappa[ch2];
    }
    return { passo: passo, punti: punti };
  }

  /** Tutte le chiavi di periodo da `da` ad `a`, estremi compresi, in ordine. PURA. */
  function chiaviDelPeriodo(da, a, passo) {
    var out = [];
    var cur = istantePasso(chiavePasso(da, passo), passo);
    var fine = istantePasso(chiavePasso(a, passo), passo);
    // Un tetto largo che nessuna finestra sensata raggiunge: serve solo a non
    // far girare a vuoto un ciclo se gli estremi arrivassero storti.
    for (var i = 0; i < 20000 && cur <= fine; i++) {
      out.push(chiavePasso(cur, passo));
      cur = passoDopo(cur, passo);
    }
    return out;
  }

  /** L'inizio del periodo successivo. PURA. */
  function passoDopo(t, passo) {
    var d = new Date(t);
    if (passo === 'anno')  return dataLocale(d.getFullYear() + 1, 0, 1).getTime();
    if (passo === 'mese')  return dataLocale(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    var giorni = passo === 'settimana' ? 7 : 1;
    return dataLocale(d.getFullYear(), d.getMonth(), d.getDate() + giorni).getTime();
  }

  /** L'istante d'inizio del gruppo, dalla sua chiave. PURA. */
  function istantePasso(chiave, passo) {
    var parti = String(chiave).split('-');
    var anno = Number(parti[0]);
    var mese = passo === 'anno' ? 0 : Number(parti[1] || 1) - 1;
    var giorno = (passo === 'mese' || passo === 'anno') ? 1 : Number(parti[2] || 1);
    return dataLocale(anno, mese, giorno).getTime();
  }

  /** Come si legge un gruppo: «25/8/2026», «sett. del 25/8/2026», «8/2026», «2026». PURA. */
  function etichettaPasso(chiave, passo) {
    var t = istantePasso(chiave, passo);
    var d = new Date(t);
    if (passo === 'anno') return String(d.getFullYear());
    if (passo === 'mese') return (d.getMonth() + 1) + '/' + d.getFullYear();
    if (passo === 'settimana') return 'sett. del ' + dataBreve(t);
    return dataBreve(t);
  }

  function chiavePasso(t, passo) {
    var d = new Date(t);
    if (passo === 'anno') return String(d.getFullYear());
    if (passo === 'mese') return d.getFullYear() + '-' + dueCifre(d.getMonth() + 1);
    if (passo === 'settimana') {
      // Il lunedì della settimana che contiene t (getDay(): domenica = 0).
      var g = d.getDay();
      var indietro = (g + 6) % 7;
      var lun = dataLocale(d.getFullYear(), d.getMonth(), d.getDate() - indietro);
      return giornoDi(lun.getTime());
    }
    return giornoDi(t);
  }

  /**
   * Tutti i conti della scheda.
   *
   * @param {object} input
   *   feedbacks  la lista dei feedback (già decifrata)
   *   workerLog  il registro dei worker (`{ role, startedAt, num }`)
   *   range      la finestra (da `rangeOf`)
   *   creatori   array di categorie d'autore da tenere; vuoto/assente = tutte
   *   feedbackParziali  true se la lista dei feedback ha toccato il tetto di
   *                     caricamento (allora i conti sui feedback sono minimi)
   *   registroLetto  false se la lettura del registro dei worker è FALLITA
   *                  (rete giù, errore del server, sessione scaduta). Allora
   *                  tutti i numeri che vengono dal registro escono `null`,
   *                  non `0`: vedi sotto.
   * @returns {object} vedi in fondo alla funzione
   */
  function compute(input) {
    var p = input || {};
    var feedbacks = Array.isArray(p.feedbacks) ? p.feedbacks : [];
    var range = p.range || { da: null, a: null };
    // La porta gemella di `registroLetto`, sull'altra sorgente: la lettura
    // delle segnalazioni è fallita e non c'è nemmeno un ripiego da cui contare.
    // Anche qui zero sarebbe una risposta data in silenzio.
    var feedbackLetti = p.feedbackLetti !== false;
    if (!feedbackLetti) feedbacks = [];
    function seNotoFb(v) { return feedbackLetti ? v : null; }
    var filtro = Array.isArray(p.creatori) && p.creatori.length ? p.creatori : null;
    // Il registro non si è letto: «quante lavorazioni» non è zero, è una
    // domanda senza risposta. Uno zero grande in mezzo alla pagina si legge
    // «non è partito niente», che è il contrario di «non lo so», e una riga
    // piccola sopra i riquadri non basta a disdirlo. Quindi i numeri che
    // vengono dal registro escono `null` e chi disegna scrive un trattino,
    // come già fa per le durate che non conosce.
    var registroLetto = p.registroLetto !== false;
    function seNoto(v) { return registroLetto ? v : null; }
    // Senza la lettura il registro non è «corto» o «vuoto»: non c'è. Si parte
    // da zero voci, così nessun elenco di segnalazioni sopravvive al guasto e
    // nessun riquadro finge di potersi aprire su quello che avrebbe contato.
    var log = normalizeLog(registroLetto ? p.workerLog : []);

    // ── Indice numero → feedback, e il filtro per creatore ──────────────────
    var perNumero = Object.create(null);
    var idsPerCreatore = Object.create(null);
    var tenuto = Object.create(null);   // numero → passa il filtro?
    var derivatiDi = Object.create(null); // numero padre → quanti figli residui
    var i;
    for (i = 0; i < feedbacks.length; i++) {
      var fb = feedbacks[i];
      var num = numeroDi(fb);
      if (num) perNumero[num] = fb;
    }
    for (i = 0; i < feedbacks.length; i++) {
      var f2 = feedbacks[i];
      var n2 = numeroDi(f2);
      if (!n2) continue;
      tenuto[n2] = !filtro || filtro.indexOf(creatoreDi(f2)) >= 0;
      if (creatoreDi(f2) === 'residuo') {
        var padre = numeroPadre(n2);
        if (padre && padre !== n2) derivatiDi[padre] = (derivatiDi[padre] || 0) + 1;
      }
    }
    // Un numero che il registro cita ma che non è nella lista caricata: non si
    // sa di chi è, quindi un filtro attivo lo lascia fuori (contarlo vorrebbe
    // dire attribuirlo a caso) e senza filtro lo si tiene.
    function numeroPassa(num) {
      if (!num) return false;
      if (Object.prototype.hasOwnProperty.call(tenuto, num)) return tenuto[num];
      return !filtro;
    }

    // ── Ricevuti (data d'INVIO) ─────────────────────────────────────────────
    // `perCreatoreTutti` conta SENZA il filtro: è il numero che sta nella
    // pasticca di ogni mittente, e serve proprio a decidere quale accendere
    // dopo. Calcolarlo col filtro attivo mandava a zero tutte le pasticche
    // spente, cioè proprio quelle che si stava per scegliere.
    var ricevutiTot = 0;
    var perCategoria = Object.create(null);
    var perCreatore = Object.create(null);
    var perCreatoreTutti = Object.create(null);
    var vociRicevuti = [];
    var attesePresa = [];
    var attesePresaIds = [];
    var senzaData = 0;
    var mittentiIgnoti = 0;
    for (i = 0; i < feedbacks.length; i++) {
      var f = feedbacks[i];
      // Una data d'arrivo che non si legge non cade in nessuna finestra, «Tutto»
      // compreso: si CONTA a parte, così la scheda può dirlo invece di far
      // sparire la segnalazione in silenzio (CLAUDE.md § Limiti). Il filtro per
      // mittente vale anche qui: contarle tutte faceva dire «una segnalazione
      // non ha una data leggibile» anche a chi stava guardando le sole persone,
      // con quella segnalazione mandata da una routine.
      if (ms(f && f.createdAt) == null) {
        if (!filtro || filtro.indexOf(creatoreDi(f)) >= 0) senzaData += 1;
        continue;
      }
      if (!inRange(f && f.createdAt, range)) continue;
      var kind = creatoreDi(f);
      if (kind === CREATORE_ILLEGGIBILE) mittentiIgnoti += 1;
      conta(perCreatoreTutti, kind);
      if (filtro && filtro.indexOf(kind) < 0) continue;
      ricevutiTot += 1;
      var cat = categoriaDi(f);
      if (!perCategoria[cat.key]) perCategoria[cat.key] = { key: cat.key, label: cat.label, n: 0, ids: [] };
      perCategoria[cat.key].n += 1;
      if (f && f._id) perCategoria[cat.key].ids.push(f._id);
      conta(perCreatore, kind);
      if (!idsPerCreatore[kind]) idsPerCreatore[kind] = [];
      if (f && f._id) idsPerCreatore[kind].push(f._id);
      vociRicevuti.push({ t: ms(f.createdAt), id: f && f._id });
      // Quanto è rimasto nei Ricevuti prima che l'owner lo prendesse in mano.
      var presa = ms(f && f.reviewedAt);
      var inviato = ms(f && f.createdAt);
      if (presa != null && inviato != null && presa >= inviato) {
        attesePresa.push(presa - inviato);
        if (f && f._id) attesePresaIds.push(f._id);
      }
    }

    // ── Lavorati ed esplorazioni (data di LAVORAZIONE) ──────────────────────
    var proberLanciati = 0;
    var lavoratiNumeri = Object.create(null);  // numero → { primo, ultimo, verifiche }
    var verificheTotali = 0;
    var lanciTot = 0;
    var perRuolo = Object.create(null);
    // Quante volte il verificatore è partito su ogni numero in TUTTO il
    // registro, fuori dalla finestra. La finestra dice QUALI lavori guardare;
    // quanto è costato un lavoro è un fatto suo, non del periodo che si sta
    // guardando. Contando solo dentro la finestra, lo stesso lavoro risultava
    // «passato subito» da «Oggi» e «2 critiche» da «30 giorni».
    var verifichePerNumero = Object.create(null);
    for (i = 0; i < log.length; i++) {
      if (log[i].role === 'verifier' && log[i].num) conta(verifichePerNumero, log[i].num);
    }
    for (i = 0; i < log.length; i++) {
      var e = log[i];
      // I lanci si contano TUTTI, qualunque sia il ruolo, COMPRESO quello
      // arrivato senza mestiere scritto: il riquadro promette «tutte le
      // esecuzioni, di qualunque mestiere», e una riga scartata qui spariva
      // dal totale mentre la scheda Log, che legge lo stesso registro, la
      // mostrava. Senza mestiere la chiave resta vuota e chi disegna la
      // chiama «Sconosciuto», con la stessa parola della scheda Log.
      if (inRange(e.t, range)) { lanciTot += 1; conta(perRuolo, e.role); }
      if (e.role === 'prober') {
        if (inRange(e.t, range)) proberLanciati += 1;
        continue;
      }
      if (!isLavoro(e.role) || !e.num) continue;
      if (!inRange(e.t, range)) continue;
      if (!numeroPassa(e.num)) continue;
      var rec = lavoratiNumeri[e.num];
      if (!rec) { rec = lavoratiNumeri[e.num] = { primo: e.t, ultimo: e.t, verifiche: 0 }; }
      if (e.t < rec.primo) rec.primo = e.t;
      if (e.t > rec.ultimo) rec.ultimo = e.t;
      if (e.role === 'verifier') { rec.verifiche += 1; verificheTotali += 1; }
    }
    var numeriLavorati = Object.keys(lavoratiNumeri);

    // I ritrovamenti dell'esplorazione: i feedback che l'esploratore ha
    // mandato nella finestra. Non è «quante esplorazioni hanno trovato
    // qualcosa» (un giro può mandarne più d'uno), ed è detto così in pagina.
    //
    // Il filtro per mittente vale anche QUI. Il numero grande del riquadro
    // (quante volte è partita l'esplorazione) non ha un mittente e il filtro
    // non lo tocca; queste sono SEGNALAZIONI, un mittente ce l'hanno, e
    // contarle con l'esploratore escluso dal filtro faceva dire alla scheda
    // «3 segnalazioni dall'esploratore» proprio mentre stavi guardando le sole
    // segnalazioni delle persone.
    var proberRitrovamenti = 0;
    var proberIds = [];
    var proberNelFiltro = !filtro || filtro.indexOf('prober') >= 0;
    for (i = 0; proberNelFiltro && i < feedbacks.length; i++) {
      if (!inRange(feedbacks[i] && feedbacks[i].createdAt, range)) continue;
      if (creatoreDi(feedbacks[i]) !== 'prober') continue;
      proberRitrovamenti += 1;
      if (feedbacks[i]._id) proberIds.push(feedbacks[i]._id);
    }

    // ── La torta dei giri ───────────────────────────────────────────────────
    // OGNI lavorazione contata dal riquadro «Feedback lavorati» esce da qui in
    // una casella: una fetta, i fermati, quelle ancora in mezzo al giro, o una
    // delle due caselle del «non si sa». Il conto torna sempre, ed è quello
    // che la riga sopra la torta dichiara.
    //
    // Prima si scartava in silenzio ogni lavorazione senza una partenza del
    // verificatore, cioè il caso più comune che ci sia: ogni lavoro che in
    // quel momento è in mano alla correzione. Su quattrocento segnalazioni
    // sparivano trentasei lavorazioni su quarantotto, e la riga che dichiarava
    // quante restavano fuori ne contava sette.
    var fette = Object.create(null);
    var giriValori = [];
    var conRimandati = 0;
    var idsRimandati = [];
    var fermatiN = 0;
    var idsFermati = [];
    var apertiN = 0;      // ancora in mezzo al giro: il via libera non c'è
    var idsAperti = [];
    var statoIgnotoN = 0; // lo stato è cifrato: su questo computer non si legge
    var idsStatoIgnoto = [];
    var ignotiN = 0;      // il registro li cita, la lista non ce li ha
    var senzaGiriN = 0;   // passati, ma il registro non conserva le loro verifiche
    var idsSenzaGiri = [];
    var durateLavoro = [];
    var durateIds = [];
    for (i = 0; i < numeriLavorati.length; i++) {
      var num2 = numeriLavorati[i];
      var r = lavoratiNumeri[num2];
      if (r.ultimo > r.primo) {
        durateLavoro.push(r.ultimo - r.primo);
        if (perNumero[num2] && perNumero[num2]._id) durateIds.push(perNumero[num2]._id);
      }
      var doc = perNumero[num2];
      // Senza il documento non si sa se il via libera è arrivato: si mette da
      // parte e si dichiara, invece di indovinare una fetta.
      if (!doc) { ignotiN += 1; continue; }
      var chiave;
      var fermo = fermato(doc);
      // «Passato lasciando indietro dei rilievi» dipende dall'ESITO del lavoro
      // e dalla segnalazione derivata, non dal fatto che il lavoro entri nella
      // torta. Contandolo in coda al ramo che disegna la fetta, questo numero
      // sbagliava da tutte e due le parti: teneva dentro i lavori FERMATI (lo
      // stesso lavoro risultava insieme fallito e passato) e lasciava fuori
      // ogni lavoro passato che la torta non disegna, per esempio quelli le cui
      // verifiche sono più vecchie di quello che il registro conserva.
      if (!fermo && !statoIlleggibile(doc) && passato(doc) && derivatiDi[num2]) {
        conRimandati += 1;
        if (doc._id) idsRimandati.push(doc._id);
      }
      if (fermo) {
        chiave = 'fermati';
        fermatiN += 1;
        if (doc._id) idsFermati.push(doc._id);
      } else if (statoIlleggibile(doc)) {
        // Lo stato viaggia cifrato: senza la chiave privata dell'owner non si
        // legge, e la scheda lo dice già dove divide per categoria. Dire lì
        // «Non leggibile con questa chiave» e qui «ancora in mezzo al giro»
        // erano due risposte opposte alla stessa domanda, sulla stessa
        // schermata: la seconda è un'affermazione su ciò che la prima dichiara
        // di non sapere, e su un lavoro già chiuso è il contrario del vero.
        statoIgnotoN += 1;
        if (doc._id) idsStatoIgnoto.push(doc._id);
        continue;
      } else if (!passato(doc)) {
        // Ancora in lavorazione o in verifica: le critiche possono ancora
        // aumentare, quindi non entra né nella torta né nella media. Ci sta
        // anche chi il verificatore non l'ha ancora visto: è il lavoro in mano
        // alla correzione adesso, ed è in mezzo al giro quanto gli altri.
        apertiN += 1;
        if (doc._id) idsAperti.push(doc._id);
        continue;
      } else {
        var v = verifichePerNumero[num2] || 0;
        if (!v) {
          // Il via libera è arrivato, ma nel registro non c'è nessuna partenza
          // del verificatore per questo numero: il registro tiene le ultime
          // esecuzioni e le sue sono più vecchie. Quanto è costato non si sa, e
          // metterlo fra i «passati subito» lo farebbe passare per il più
          // economico di tutti.
          senzaGiriN += 1;
          if (doc._id) idsSenzaGiri.push(doc._id);
          continue;
        }
        var giri = Math.max(0, v - 1);
        giriValori.push(giri);
        chiave = fettaGiri(giri).key;
      }
      if (!fette[chiave]) fette[chiave] = { key: chiave, label: ETICHETTE_FETTE[chiave], n: 0, ids: [] };
      fette[chiave].n += 1;
      if (doc._id) fette[chiave].ids.push(doc._id);
    }
    var somma = 0;
    for (i = 0; i < giriValori.length; i++) somma += giriValori[i];
    var mediaGiri = giriValori.length ? somma / giriValori.length : null;

    // ── Audit di sicurezza, arenamenti, stato di oggi (sui lavori della finestra) ──
    var audit = { pass: 0, fail: 0, saltato: 0 };
    var auditIds = { pass: [], fail: [], saltato: [] };
    var arenamenti = 0;
    var feedbackArenati = 0;
    var arenatiIds = [];
    var statiLavorati = Object.create(null);
    for (i = 0; i < numeriLavorati.length; i++) {
      var d2 = perNumero[numeriLavorati[i]];
      if (!d2) {
        // Il registro lo cita ma la lista non ce l'ha: si conta lo stesso fra
        // i lavorati (il lavoro è successo), in una voce che lo dice.
        if (!statiLavorati.__assente) statiLavorati.__assente = { key: '__assente', label: 'Non in questa lista', n: 0, ids: [] };
        statiLavorati.__assente.n += 1;
        continue;
      }
      var cat2 = categoriaDi(d2);
      if (!statiLavorati[cat2.key]) statiLavorati[cat2.key] = { key: cat2.key, label: cat2.label, n: 0, ids: [] };
      statiLavorati[cat2.key].n += 1;
      if (d2._id) statiLavorati[cat2.key].ids.push(d2._id);
      var es = esitoAudit(d2);
      if (es) { audit[es] += 1; if (d2._id) auditIds[es].push(d2._id); }
      var st = Number(d2.stalls) || Number(d2.workingResets) || 0;
      if (st > 0) {
        arenamenti += st;
        feedbackArenati += 1;
        if (d2._id) arenatiIds.push(d2._id);
      }
    }

    // ── Copertura: fin dove arrivano davvero le due sorgenti ───────────────
    var logDa = log.length ? log[0].t : null;
    var logA  = log.length ? log[log.length - 1].t : null;
    var logCorto = !!(logDa != null && range.da != null && range.da < logDa);
    if (logDa != null && range.da == null) logCorto = true;

    return {
      range: range,
      ricevuti: {
        totale: seNotoFb(ricevutiTot),
        ids: idsRicevuti(perCategoria),
        categorie: ordinaPerN(perCategoria),
        creatori: creatoriOrdinati(perCreatore, idsPerCreatore),
        creatoriTutti: creatoriOrdinati(perCreatoreTutti, null),
        serie: serieTemporale(vociRicevuti, range),
        senzaData: senzaData,
        // Quante segnalazioni della finestra hanno un mittente che non si è
        // potuto leggere: chi disegna lo dichiara, invece di lasciar credere
        // che la ripartizione per mittente sia completa.
        mittentiIgnoti: mittentiIgnoti,
      },
      lavorati: {
        totale: seNoto(numeriLavorati.length),
        verifiche: seNoto(verificheTotali),
        durataMediana: seNoto(mediana(durateLavoro)),
        stati: ordinaPerN(statiLavorati),
        ids: idsRicevuti(statiLavorati),
      },
      lanci: { totale: seNoto(lanciTot), perRuolo: ordinaRuoli(perRuolo) },
      // `ritrovamenti` viene dalle SEGNALAZIONI, non dal registro: quello si sa
      // anche quando il registro non risponde, e resta un numero.
      prober: { lanciati: seNoto(proberLanciati), ritrovamenti: seNotoFb(proberRitrovamenti), ritrovamentiIds: proberIds },
      giri: {
        fette: ordinaFette(fette),
        media: mediaGiri,
        conteggio: giriValori.length,
        fermati: seNoto(fermatiN),
        fermatiIds: idsFermati,
        rimandati: seNoto(conRimandati),
        rimandatiIds: idsRimandati,
        aperti: seNoto(apertiN),
        apertiIds: idsAperti,
        statoIgnoto: statoIgnotoN,
        statoIgnotoIds: idsStatoIgnoto,
        ignoti: ignotiN,
        senzaGiri: senzaGiriN,
        senzaGiriIds: idsSenzaGiri,
      },
      tempi: {
        // L'attesa prima della presa in carico si misura sulle SEGNALAZIONI: la
        // si sa anche col registro giù. La durata di una lavorazione no.
        presaInCarico: { mediana: seNotoFb(mediana(attesePresa)), n: seNotoFb(attesePresa.length), ids: attesePresaIds },
        lavorazione: { mediana: seNoto(mediana(durateLavoro)), n: seNoto(durateLavoro.length), ids: durateIds },
      },
      audit: { pass: seNoto(audit.pass), fail: seNoto(audit.fail), saltato: seNoto(audit.saltato) },
      auditIds: auditIds,
      arenati: { lavorazioni: seNoto(arenamenti), feedback: seNoto(feedbackArenati), ids: arenatiIds },
      copertura: {
        logDa: logDa,
        logA: logA,
        logVuoto: log.length === 0,
        logCorto: logCorto,
        // false = la lettura del registro è fallita. Diverso da `logVuoto`, che
        // è una risposta arrivata e vuota.
        registroLetto: registroLetto,
        feedbackLetti: feedbackLetti,
        feedbackParziali: !!p.feedbackParziali,
      },
    };
  }

  function ordinaPerN(mappa) {
    var out = [];
    var chiavi = Object.keys(mappa);
    for (var i = 0; i < chiavi.length; i++) out.push(mappa[chiavi[i]]);
    out.sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
    return out;
  }

  function ordinaRuoli(mappa) {
    var out = [];
    var chiavi = Object.keys(mappa);
    for (var i = 0; i < chiavi.length; i++) out.push({ role: chiavi[i], n: mappa[chiavi[i]] });
    out.sort(function (a, b) { return b.n - a.n || a.role.localeCompare(b.role); });
    return out;
  }

  function creatoriOrdinati(mappa, ids) {
    var out = [];
    function voce(k) { return { kind: k, n: mappa[k], ids: (ids && ids[k]) || [] }; }
    for (var i = 0; i < CREATORI.length; i++) {
      var k = CREATORI[i];
      if (mappa[k]) out.push(voce(k));
    }
    // Una categoria d'autore che non è nell'elenco (non dovrebbe succedere: la
    // lista è chiusa) si mostra lo stesso, in fondo. Sparire sarebbe un conto
    // che non torna, e nessuno saprebbe perché.
    var chiavi = Object.keys(mappa);
    for (var j = 0; j < chiavi.length; j++) {
      if (CREATORI.indexOf(chiavi[j]) < 0) out.push(voce(chiavi[j]));
    }
    return out;
  }

  /** Tutti gli id raccolti in una mappa di voci: il numero grande di un riquadro. PURA. */
  function idsRicevuti(mappa) {
    var out = [];
    var chiavi = Object.keys(mappa);
    for (var i = 0; i < chiavi.length; i++) {
      var v = mappa[chiavi[i]];
      if (v && v.ids) for (var j = 0; j < v.ids.length; j++) out.push(v.ids[j]);
    }
    return out;
  }

  function ordinaFette(mappa) {
    var out = [];
    for (var i = 0; i < ORDINE_FETTE.length; i++) {
      var k = ORDINE_FETTE[i];
      if (mappa[k]) out.push(mappa[k]);
    }
    return out;
  }

  /** Una durata in millisecondi → «3 giorni», «4 ore», «12 min». PURA. */
  function durata(msVal) {
    if (msVal == null || !Number.isFinite(msVal)) return '—';
    var s = Math.max(0, Math.round(msVal / 1000));
    if (s < 90) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 90) return m + ' min';
    var h = Math.round(m / 60);
    if (h < 48) return h === 1 ? '1 ora' : h + ' ore';
    var g = Math.round(h / 24);
    return g === 1 ? '1 giorno' : g + ' giorni';
  }

  global.SN_FEEDBACK_STATS = {
    PRESETS, CREATORI, GRUPPI_CREATORI, RUOLI_LAVORO,
    CREATORE_ILLEGGIBILE, ETICHETTA_ILLEGGIBILE,
    presetOf, rangeOf, inRange, giornoDi, dataBreve, durata, mediana,
    normNum, numeroDi, numeroPadre, normalizeLog,
    creatoreDi, categoriaDi, fermato, passato, statoIlleggibile, esitoAudit, fettaGiri, serieTemporale,
    ETICHETTE_FETTE, ORDINE_FETTE,
    compute,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
