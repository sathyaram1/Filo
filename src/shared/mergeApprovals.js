// L'AVVISO DELLE FUSIONI IN ATTESA — superficie dell'owner, un pezzo solo.
//
// PERCHÉ ESISTE (SPEC-RIDISEGNO-MAX.md §10)
//   Il controllo deterministico di sicurezza del server blocca le fusioni che
//   toccano le aree protette: le guardie, gli automatismi, le regole del
//   database, le chiavi, l'aggiunta di dipendenze. È giusto per il lavoro delle
//   automazioni — codice scritto da un'IA a partire da testo di sconosciuti.
//
//   Il lavoro LOCALE dell'owner però ci cade dentro quasi sempre, perché in
//   locale si lavora proprio su quelle cose. Il blocco non è un rifiuto secco:
//   il server apre una richiesta che aspetta il sì dell'owner, QUI. Da #908 il
//   lavoro locale di una pratica provata non la apre: fonde e registra i blocchi.
//
// DOVE VIVE (contratto 2026-09-13)
//   Solo in Gestione, mai sulla home. Una richiesta con la sua pratica si apre
//   dal quadrato rosso della scheda, che sta in cima ai Ricevuti; una senza
//   (il lavoro locale di `npm run finish`) sta in cima ad Automazioni.
//   Dal #489 le stesse card si disegnano anche nella pagina da browser (site/approvazioni): è la via
//   d'uscita per il giorno in cui Filo non parte, non un secondo posto da guardare.
//
//   Il modulo resta separato dalla pagina perché tiene insieme le rese — le
//   card da decidere e la traccia delle decisioni passate (Log) — e la parte
//   PURA che gli unit test coprono.
//
//   Le frasi che spiegano COSA è stato bloccato NON stanno qui: le manda il
//   server, che è l'unico posto dove la tabella dei controlli vive. Questo file
//   le mostra e basta — e se una voce arrivasse senza frase, mostra il nome
//   grezzo invece di nascondere il blocco.
//
// Stile: src/styles/mergeApprovals.css.

(function (global) {
  'use strict';

  var MINUTO = 60 * 1000;

  /** I primi caratteri di uno sha: quanto basta a riconoscerlo a occhio. PURA. */
  function shortSha(sha) {
    return String(sha || '').slice(0, 8);
  }

  // «adesso» / «N minuti fa» / «N ore fa» / «N giorni fa». PURA.
  // Una richiesta vive una settimana: servono minuti, ore e giorni.
  function timeAgo(atMs, nowMs) {
    var at = Number(atMs);
    if (!isFinite(at) || at <= 0) return '';
    var s = Math.max(0, Math.round(((Number(nowMs) || Date.now()) - at) / 1000));
    if (s < 45) return 'adesso';
    var m = Math.round(s / 60);
    if (m < 60) return m === 1 ? '1 minuto fa' : m + ' minuti fa';
    var h = Math.round(m / 60);
    if (h < 24) return h === 1 ? '1 ora fa' : h + ' ore fa';
    var d = Math.round(h / 24);
    return d === 1 ? 'ieri' : d + ' giorni fa';
  }

  // Quanto resta prima della scadenza: si dice sempre e PRIMA, perché scoprirlo premendo
  // «Approva» è il modo peggiore. Si arrotonda per DIFETTO: mai promettere più tempo. PURA.
  function expiresIn(expiresAtMs, nowMs) {
    var exp = Number(expiresAtMs);
    if (!isFinite(exp) || exp <= 0) return 'scaduta';
    var left = exp - (Number(nowMs) || Date.now());
    if (left <= 0) return 'scaduta';
    var m = Math.floor(left / MINUTO);
    if (m < 1) return 'scade fra meno di un minuto';
    if (m === 1) return 'scade fra 1 minuto';
    if (m < 60) return 'scade fra ' + m + ' minuti';
    var h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? 'scade fra 1 ora' : 'scade fra ' + h + ' ore';
    var d = Math.floor(h / 24);
    return d === 1 ? 'scade fra 1 giorno' : 'scade fra ' + d + ' giorni';
  }

  /**
   * Il titolo dell'avviso. PURA.
   * Zero richieste → stringa vuota: chi non ne ha non deve vedere niente.
   * Una richiesta già mandata a fondere, o già decisa, non aspetta più il sì di nessuno: conta a parte (#702).
   */
  function headline(count, inCorso, decise) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    var v = Math.max(0, Math.floor(Number(inCorso) || 0));
    var d = Math.max(0, Math.floor(Number(decise) || 0));
    if (n === 1) return 'Una fusione aspetta il tuo via libera';
    if (n > 1) return n + ' fusioni aspettano il tuo via libera';
    if (v === 1) return 'Una fusione in corso';
    if (v > 1) return v + ' fusioni in corso';
    if (d === 1) return 'Una fusione decisa';
    if (d > 1) return d + ' fusioni decise';
    return '';
  }

  /** La frase sotto il titolo, con lo stesso conto: «aspettano il tuo sì» solo se qualcuna aspetta. PURA. */
  var INTRO_FERME = 'I controlli di sicurezza del server le hanno fermate perché toccano parti protette. Aspettano il tuo sì.';
  var INTRO_IN_CORSO = 'I controlli di sicurezza del server l’hanno fermata perché tocca parti protette. È approvata: il server la sta fondendo.';
  // Anche a fusione decisa la frase resta: sparendo, tirava su i tasti sotto il cursore (#550).
  var INTRO_DECISA = 'I controlli di sicurezza del server l’hanno fermata perché tocca parti protette. Hai già deciso: esce da qui alla prossima rilettura.';
  function introText(count, inCorso, decise) {
    if (Math.floor(Number(count) || 0) > 0) return INTRO_FERME;
    if (Math.floor(Number(inCorso) || 0) > 0) return INTRO_IN_CORSO;
    if (Math.floor(Number(decise) || 0) > 0) return INTRO_DECISA;
    return '';
  }

  // I ruoli delle routine in italiano, in un posto solo: li usano il Log di Gestione e le card, anche nella pagina da
  // browser (#555). Un ruolo che questa tabella non conosce si scrive com'è.
  var RUOLI = {
    'new-work': 'Nuovo lavoro',
    verifier: 'Verifica',
    fixer: 'Correzione',
    secaudit: 'Audit sicurezza',
    risposta: 'Gestisci la risposta',
    smistamento: 'Gestisci la domanda',
    compito: 'Compito',
    manutentore: 'Manutenzione',
    prober: 'Esplorazione',
    idle: 'Fermo',
    off: 'Routine spente',
  };
  /** Il nome di un ruolo per l'owner; '' se manca. PURA. */
  function etichettaRuolo(role) {
    var r = String(role == null ? '' : role).trim();
    return Object.prototype.hasOwnProperty.call(RUOLI, r) ? RUOLI[r] : r;
  }

  // Chi ha chiesto la fusione: la superficie esiste per SEPARARE chi chiede da chi approva.
  // Un identificativo tecnico non si stampa: si dice «un accesso senza email». PURA.
  function requestedBy(who, req) {
    var s = String(who == null ? '' : who).trim().slice(0, 120);
    if (!s) return 'chi l’ha chiesta non risulta';
    if (s.indexOf('@') > 0) return 'chiesta da ' + s;
    // Un'automazione un'email non ce l'ha e non l'avrà mai: il server manda il ruolo che stava
    // lavorando («secaudit · slug»), e quello SÌ dice qualcosa a chi decide, detto come nel Log.
    if (originOf(req) === 'routine') {
      var parti = s.split(' · ');
      parti[0] = etichettaRuolo(parti[0]);
      return 'chiesta da ' + parti.join(' · ');
    }
    return 'chiesta da un accesso senza email';
  }

  // Le due provenienze finiscono nello STESSO elenco, ma non si leggono uguale: il locale l'ha
  // fatto l'owner, l'altro un modello dal testo di uno sconosciuto. Assente = `locale`. PURA.
  function originOf(req) {
    return String((req && req.origin) || '') === 'routine' ? 'routine' : 'locale';
  }

  // Senza cancelletto: il server a volte lo manda col `#`, e normalizzarlo qui fa sì che chi
  // stampa ne metta uno solo e chi confronta con la lista feedback confronti la stessa cosa.
  function feedbackNum(req) {
    return String((req && req.num) || '').trim().replace(/^#+/, '');
  }

  function originLabel(req) {
    var num = feedbackNum(req);
    // Da #908 anche il lavoro locale porta la sua pratica.
    if (originOf(req) !== 'routine') return num ? 'lavoro locale · feedback #' + num : 'lavoro tuo, in locale';
    return num ? 'automazione · feedback #' + num : 'automazione';
  }

  // Accanto alla provenienza, cosa dice il documento con l'id della richiesta (#1517): il numero da solo può essere
  // anche di un estraneo. `o.descriviFeedback(req)` → { testo, doppi } o null, lo dà la pagina che sa leggerlo.
  function aggiungiInfoFeedback(head, req, o) {
    var d = o && typeof o.descriviFeedback === 'function' ? o.descriviFeedback(req) : null;
    if (!d) return;
    if (d.testo) {
      var info = el('span', 'sn-mac-fbinfo', d.testo);
      info.title = 'Stato e mittente della segnalazione di questa richiesta, letti dal documento.';
      head.appendChild(info);
    }
    if (Number(d.doppi) > 1) {
      var doppio = el('span', 'sn-mac-fbdoppio', 'numero doppio');
      doppio.title = 'Il numero #' + feedbackNum(req) + ' è di ' + d.doppi + ' segnalazioni: il bottone apre quella di questa richiesta.';
      head.appendChild(doppio);
    }
  }

  function originHint(req) {
    return originOf(req) === 'routine'
      ? 'Questo ramo l’ha scritto un’automazione partendo da una segnalazione: guarda cosa è stato bloccato prima di approvarlo.'
      : 'Questo ramo l’hai scritto tu, in locale.';
  }

  /**
   * Fusa senza passare dall’owner: lavoro fidato (`motivo: 'fiducia'`, #1148: feedback fidato e sessioni tutte pulite)
   * o, sui rami di prima, il lavoro locale di una pratica provata (#908) o approvata dall’owner (#913). L5 ha girato
   * solo per registrare i blocchi. PURA.
   */
  function isSkippedL5(r) {
    return !!(r && r.skippedL5 === true);
  }
  function isFiducia(r) {
    return isSkippedL5(r) && r.motivo === 'fiducia';
  }

  /** Perché quella fusione non ha chiesto: la fiducia, la prova del mittente, o il sì dell’owner a un feedback non suo. PURA. */
  function skippedL5Hint(r) {
    var dopo = ' I controlli hanno solo registrato cosa avrebbero fermato.';
    if (isFiducia(r)) return 'Lavoro fidato: feedback fidato, scritto solo da sessioni col biglietto pulito.' + dopo;
    if (!(r && r.localApproved === true)) return 'Pratica aperta da te o da una sessione locale, con la prova del mittente.' + dopo;
    var by = String(r.preapprovedBy || '').trim().slice(0, 120);
    return 'Feedback di un utente o di una routine, approvato come lavoro locale' + (by ? ' da ' + by : '') + '.' + dopo;
  }

  // Un blocco, in una riga leggibile. Un blocco senza frase si NOMINA lo stesso. PURA.
  function blockLabel(block) {
    var b = block || {};
    var label = String(b.label || '').trim();
    if (label) return label;
    var gate = String(b.gate || '').trim();
    return gate ? 'Controllo di sicurezza scattato (' + gate + ')' : 'Controllo di sicurezza scattato';
  }

  function blockItems(block) {
    var b = block || {};
    var items = Array.isArray(b.items) ? b.items.map(String) : [];
    var more = Math.max(0, Math.floor(Number(b.more) || 0));
    if (more > 0) items = items.concat(['… e altri ' + more]);
    return items;
  }

  /** Un collegamento che si apre: solo pagine https di GitHub, gli altri indirizzi no. PURA. */
  function linkGitHub(url) {
    var s = String(url || '');
    return /^https:\/\/github\.com\/[^\s"'<>\\]+$/.test(s) ? s : '';
  }

  /** Dove sta una voce: «file:riga», «file» o ''. PURA. */
  function doveVoce(voce) {
    var v = voce || {};
    var file = String(v.file || '');
    var riga = Math.floor(Number(v.riga) || 0);
    if (!file) return '';
    return riga > 0 ? file + ':' + riga : file;
  }

  /** Le voci di un blocco (file, riga, testo, intorno): [] per i blocchi di un server di prima, che hanno solo righe. PURA. */
  function blockVoci(block) {
    var b = block || {};
    return Array.isArray(b.voci) ? b.voci.filter(function (v) { return v && (v.file || v.testo); }) : [];
  }

  // Le guardie toccate, le capacità nuove e ciò che il controllo non ha potuto leggere si guardano con occhi diversi:
  // stanno separati (#1404). Il gruppo lo decide il server; un gruppo che questo client non conosce si mostra lo stesso.
  var GRUPPI = [['guardie', 'Guardie toccate'], ['capacita', 'Capacità nuove'], ['contenuto', 'Diff da guardare a mano']];

  /** I blocchi divisi per gruppo, in ordine fisso. Senza gruppi (server di prima): un gruppo solo, senza titolo. PURA. */
  function gruppiDiBlocchi(blocks) {
    var list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
    if (!list.length) return [];
    if (!list.some(function (b) { return b.gruppo; })) return [{ gruppo: '', titolo: '', blocchi: list }];
    var noti = GRUPPI.map(function (g) { return g[0]; });
    var out = [];
    GRUPPI.forEach(function (g) {
      var qui = list.filter(function (b) { return (b.gruppo || 'capacita') === g[0]; });
      if (qui.length) out.push({ gruppo: g[0], titolo: g[1], blocchi: qui });
    });
    var altri = list.filter(function (b) { return b.gruppo && noti.indexOf(b.gruppo) < 0; });
    if (altri.length) out.push({ gruppo: 'altro', titolo: 'Altri controlli', blocchi: altri });
    return out;
  }

  /**
   * Come si riottiene una richiesta che è decaduta. PURA.
   *
   * Dipende da CHI aveva chiesto la fusione, e sbagliarlo manda l'owner a
   * lanciare un comando che non c'entra niente: il lavoro locale si ripropone
   * da questo computer, quello di un'automazione no — lì la segnalazione torna
   * in attesa di una sua decisione.
   */
  /** La prima lettera minuscola, per incastrare una frase dentro un'altra. PURA. */
  function lowerFirst(text) {
    var s = String(text || '');
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }

  function howToRetry(req) {
    return originOf(req) === 'routine'
      ? 'Il lavoro torna alla routine, che riallinea il ramo e rifà i controlli: poi ti arriva una nuova richiesta da approvare.'
      : 'Rilancia npm run finish.';
  }

  // Dopo un sì finito in conflitto il lavoro di una routine torna da sé a riallinearsi (routeRealignment del server):
  // l'owner non deve far partire niente (#1328, #1425).
  var RIALLINEA_DA_SOLA = 'Il lavoro torna da solo alla routine, che riallinea il ramo e rifà i controlli: ti arriva una richiesta nuova solo se c’è qualcosa che non hai ancora visto.';
  /** Una fusione approvata e non avvenuta la riallinea il server da sé? Solo il lavoro di una routine con la sua pratica. PURA. */
  function siRiallineaDaSola(req) {
    return originOf(req) === 'routine' && !!String((req && req.feedbackId) || '').trim();
  }
  /** Cosa succede, o cosa fa l'owner, dopo un sì finito in conflitto. PURA. */
  function dopoIlConflitto(req) {
    if (siRiallineaDaSola(req)) return RIALLINEA_DA_SOLA;
    return originOf(req) === 'routine'
      ? 'Questo lavoro non si riallinea da solo: rimetti la sua pratica In coda per un giro nuovo.'
      : 'Rifai la base del ramo e rilancia npm run finish.';
  }

  // Il motivo del server porta un'etichetta tecnica: qui diventa una frase, il dettaglio fra
  // parentesi resta. Un'etichetta sconosciuta si stampa grezza: dice più di una nascosta.
  var REALIGN_REASONS = {
    realign_unavailable: 'il riallineamento automatico non è disponibile su questo server',
    realign_threw: 'il server si è fermato a metà del riallineamento',
    realign_nothing_to_do: 'il ramo conteneva già main, eppure la fusione era in conflitto',
    realign_malformed: 'il commit di riallineamento è tornato senza sha',
    realign_branch_moved: 'il ramo si era mosso dopo l’approvazione, e il commit di riallineamento non parte da quello approvato',
    realign_request_failed: 'la richiesta nuova per la punta riallineata non si è registrata',
    gates_unavailable: 'i controlli deterministici non erano disponibili',
    bad_branch: 'il nome del ramo non si può riallineare',
    bad_sha: 'il commit approvato non ha la forma di uno sha',
    github_unreachable: 'GitHub non rispondeva',
    github_no_token: 'il server non aveva la credenziale con cui scrive',
    github_404: 'GitHub non ha trovato il commit',
  };
  function realignReasonText(reason) {
    var s = String(reason == null ? '' : reason).trim();
    if (!s) return '';
    return s.replace(/[a-z][a-z0-9_]*/g, function (tok) {
      return Object.prototype.hasOwnProperty.call(REALIGN_REASONS, tok) ? REALIGN_REASONS[tok] : tok;
    });
  }

  // Il server premette «riallineamento automatico non riuscito: » al motivo: qui la frase lo
  // dice già, e ripeterlo faceva tre due-punti di fila. PURA.
  function realignFailureText(reason) {
    var t = realignReasonText(reason).replace(/^riallineamento automatico non riuscito:\s*/i, '');
    return t ? 'Il server ha provato a riallineare da sé, senza riuscirci: ' + t + '.' : '';
  }

  // `supersedes` rimpiazza una richiesta GIÀ approvata: il server ha spostato il ramo su main
  // e rifatto i controlli. I blocchi sotto sono SOLO i nuovi, o si leggerebbero da capo.
  function realignedNote(req) {
    var r = req || {};
    if (!String(r.supersedes || '').trim()) return '';
    var from = r.realigned && r.realigned.from ? shortSha(r.realigned.from) : '';
    return 'Punta riallineata su main dal server' + (from ? ' (era ' + from + ')' : '')
      + ': qui solo ciò che non avevi ancora visto.';
  }

  /**
   * Gli unit sul risultato della fusione (#929): su quale main sono girati, e quando. Al clic non si rifanno, quindi
   * chi approva giorni dopo deve sapere quanto è vecchia la prova. PURA: null per una richiesta senza prova.
   */
  function provaNote(req, nowMs) {
    var p = req && req.provaUnit;
    if (!p || typeof p !== 'object') return null;
    var t = timeAgo(p.atMs, nowMs);
    var quando = t ? (t === 'adesso' ? ' di adesso' : ' di ' + t) : '';
    var titolo = 'Gli unit test sono girati sul risultato della fusione con main com’era allora (' + shortSha(p.mainSha)
      + '). Approvando non si rifanno, quindi se main nel frattempo è andato avanti la combinazione che fondi non l’ha provata nessuno.';
    if (p.esito === 'verde' || p.esito === 'main_contenuto') return { testo: 'Unit verdi sulla fusione con main' + quando, titolo: titolo };
    if (p.esito === 'rosso_anche_su_main') {
      return { testo: 'Unit già rossi su main da solo' + (t ? ' ' + t : '') + ', la fusione non ne rompeva altri', titolo: titolo };
    }
    if (p.esito === 'conflitto') return { testo: 'Unit non provati, la fusione con main' + quando + ' andava in conflitto', titolo: titolo };
    return null;
  }

  /**
   * L'esito di una decisione passata, in due parole. PURA.
   *
   * `stale` con `used: true` è una richiesta CONSUMATA senza fusione: dirla
   * «approvata» racconta una fusione mai avvenuta. Con `realigned` il server
   * l'ha spostata su main e ha chiesto di nuovo per la sola differenza; senza,
   * è semplicemente decaduta.
   */
  function recentOutcome(r) {
    var v = r || {};
    var ria = !!(v.realigned && typeof v.realigned === 'object');
    if (isFiducia(v)) return 'lavoro fidato: controllo registrato';
    if (isSkippedL5(v)) return 'fusa senza chiedere (lavoro locale)';
    if (v.outcome === 'merged') return ria ? 'approvata, riallineata e fusa' : 'approvata e fusa';
    if (v.outcome === 'conflict') return 'approvata, ma in conflitto';
    if (v.outcome === 'stale') return ria ? 'riallineata, chiede di nuovo' : 'decaduta';
    if (v.discarded) return 'scartata';
    if (v.used) return 'approvata';
    return 'scaduta senza risposta';
  }

  // L'esito di un'approvazione, detto all'owner: mai il motivo tecnico lasciato lì da
  // interpretare, sempre cosa è successo e cosa fare adesso. PURA.
  function outcomeMessage(reply, req) {
    var r = reply || {};
    var retry = howToRetry(req);
    if (r.ok === false || r.error) {
      var err = String(r.error || r.detail || r.reason || '');
      if (/scadut/i.test(err)) return { kind: 'warn', text: 'La richiesta è scaduta. ' + retry };
      if (/già stata usata|already_used/i.test(err)) return { kind: 'warn', text: 'Questa richiesta era già stata usata.' };
      if (/scartat|discarded/i.test(err)) return { kind: 'warn', text: 'Questa richiesta era stata scartata.' };
      if (/non esiste|not_found/i.test(err)) return { kind: 'warn', text: 'Questa richiesta non c’è più.' };
      if (/github_no_token/i.test(err)) return { kind: 'err', text: 'Il server non ha la credenziale con cui scrive: nessuna fusione è avvenuta.' };
      if (/unreachable|github_5/i.test(err)) return { kind: 'err', text: 'Server non raggiungibile: nessuna fusione è avvenuta, riprova.' };
      return { kind: 'err', text: err ? 'Non è riuscita: ' + err : 'Non è riuscita. Nessuna fusione è avvenuta.' };
    }
    var shaTxt = r.sha ? ' (' + shortSha(r.sha) + ')' : '';
    var ria = !!(r.realigned && typeof r.realigned === 'object');
    if (r.result === 'merged') {
      return ria
        ? { kind: 'ok', text: 'Fatto: main era andato avanti, il server ha riallineato il ramo, rifatto i controlli e fuso' + shaTxt + '.' }
        : { kind: 'ok', text: 'Fatto: il lavoro è su main' + shaTxt + '.' };
    }
    if (r.result === 'conflict') {
      var tentativo = realignFailureText(r.realignReason);
      return { kind: 'warn', text: 'Main è andato avanti e le modifiche non si incastrano da sole. '
        + (tentativo ? tentativo + ' ' : '') + dopoIlConflitto(req) };
    }
    if (r.result === 'stale') {
      // Riallineata dal server: la richiesta vecchia è consumata ma il lavoro non è perso e non
      // c'è niente da rilanciare — la scheda nuova, con la sola differenza, arriva nell'elenco.
      if (ria) {
        return {
          kind: 'warn',
          reload: true,
          text: 'Main era andato avanti: il server ha riallineato il ramo, ma i controlli hanno trovato qualcosa che non avevi visto. C’è una richiesta nuova con solo quella differenza.',
        };
      }
      return { kind: 'warn', text: 'Il ramo è andato avanti dopo i controlli: la richiesta decade. ' + retry };
    }
    if (r.result === 'discarded') return { kind: 'ok', text: 'Scartata.' };
    return { kind: 'warn', text: 'Esito inatteso: nessuna fusione è avvenuta.' };
  }

  // «Salta il controllo»: ogni esito del server in italiano, uguale nella scheda di Filo e nella pagina da browser.
  var SALTA_ESITI = {
    fuso: { kind: 'ok', text: 'Saltato: il lavoro è entrato in main.' },
    conflitto: { kind: 'err', text: 'Saltato, ma il ramo è in conflitto con main: torna in lavorazione per riallinearlo.' },
    ramo_assente: { kind: 'err', text: 'Il ramo di questa pratica non c’è più: non c’è niente da fondere.' },
    feedback_assente: { kind: 'err', text: 'Il server non trova questa segnalazione.' },
    non_saltabile: { kind: 'err', text: 'Qui non c’è un controllo da saltare: l’audit non ha bocciato niente.' },
    non_owner: { kind: 'err', text: 'Questo lo può fare solo il proprietario.' },
    guasto: { kind: 'err', text: 'GitHub non risponde. Il salto è registrato: ripremi quando torna su.' },
    // Un lavoro anche sul server passa dal cancello del server: prima l'app, poi il server.
    attesa_server: { kind: 'ok', text: 'Saltato. Il lavoro tocca anche il server: entra in main quando la suite di filo-security è verde, prima l’app e poi il server.' },
    server_al_pc: { kind: 'ok', text: 'Saltato. La parte del server la porta su main il tuo PC: npm run orchestra -- fusioni-server.' },
    rimandato: { kind: 'err', text: 'Saltato, ma il lavoro torna alle routine per un altro giro prima di entrare in main.' },
    all_owner: { kind: 'err', text: 'Saltato, ma il cancello del server non lo fonde: la pratica torna a te, col motivo nella conversazione.' },
    // Il salto vale per la versione che verifica e audit hanno letto (#1040.1): niente fusione e niente richiesta.
    mosso: { kind: 'err', text: 'Dopo i controlli il ramo ha preso commit che nessuno ha letto, quindi non entra in main e non chiede il tuo via libera. Rimandala in lavorazione e un giro nuovo li leggerà.', giroNuovo: true },
    senza_controllo: { kind: 'err', text: 'Non trovo quale versione del ramo hanno letto i controlli, e senza quella il ramo non entra in main. Rimandala in lavorazione per un giro nuovo.', giroNuovo: true },
  };

  /**
   * L'esito di «Salta il controllo», detto all'owner. PURA. Un esito sconosciuto si scrive grezzo, mai come un «fatto».
   * Sul blocco del cancello conta lo stato della richiesta (#486): in attesa, già decisa, o non registrata.
   * `opts.doveSiApprova` dice dove sta il via libera sulla superficie che chiama.
   */
  function skipOutcomeMessage(reply, opts) {
    var r = reply || {};
    var esito = String(r.esito || '');
    if (esito !== 'bloccato') return SALTA_ESITI[esito] || { kind: 'err', text: 'Il server ha risposto: ' + (esito || 'niente') + '.' };
    var base = 'Saltato, ma il cancello di fusione ha fermato il ramo';
    var stato = String(r.requestState || '');
    if (!r.requestId) return { kind: 'err', text: base + ', e la richiesta di fusione non si è registrata: nessuna fusione è avvenuta.' };
    if (stato === 'discarded') {
      return { kind: 'warn', text: base + ', e questa versione era già stata scartata: una richiesta decisa non si riapre, non c’è niente da approvare.' };
    }
    if (stato === 'used') {
      if (r.requestOutcome === 'merged') return { kind: 'warn', text: base + ', e questa versione era già stata approvata e fusa su main: non c’è niente da approvare.' };
      var come = r.requestOutcome === 'conflict' ? ', ma la fusione era finita in conflitto' : '';
      return { kind: 'warn', text: base + ', e questa versione era già stata approvata' + come + ': un’approvazione vale una volta sola, non c’è niente da approvare.' };
    }
    var dove = (opts && opts.doveSiApprova) || 'sul quadrato';
    return { kind: 'ok', text: 'Saltato. Il cancello di fusione ha fermato il ramo: ora aspetta il tuo via libera ' + dove + '.' };
  }

  // ── Costruzione (DOM) ─────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  /** Un collegamento a GitHub che si apre in una scheda; un indirizzo che non lo è resta testo. */
  function linkEsterno(cls, testo, url, titolo) {
    var u = linkGitHub(url);
    if (!u) return el('span', cls, testo);
    var a = el('a', cls, testo);
    a.href = u;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (titolo) a.title = titolo;
    return a;
  }

  /**
   * Una voce di un blocco: dove sta (che apre la riga nel diff su GitHub) e la riga. Con l'intorno la riga si apre
   * sulle tre righe prima e dopo, coi segni del diff: l'owner vede cosa fa senza uscire da Gestione.
   */
  function buildVoce(voce) {
    var v = voce || {};
    var li = el('li', 'sn-mac-voce');
    var testa = el('span', 'sn-mac-voce-testa');
    var dove = doveVoce(v);
    if (dove) testa.appendChild(linkEsterno('sn-mac-voce-dove', dove, v.url, 'Apri questa riga nel diff su GitHub'));
    if (v.testo) testa.appendChild(el('code', 'sn-mac-voce-testo', v.testo));
    var prima = Array.isArray(v.prima) ? v.prima.map(String) : [];
    var dopo = Array.isArray(v.dopo) ? v.dopo.map(String) : [];
    if (!v.testo || (!prima.length && !dopo.length)) {
      li.appendChild(testa);
      return li;
    }
    var det = el('details', 'sn-mac-voce-intorno');
    var sum = el('summary', 'sn-mac-voce-sum');
    sum.title = 'Le righe intorno';
    sum.appendChild(testa);
    det.appendChild(sum);
    var pre = el('pre', 'sn-mac-intorno');
    var riga = function (testo, scattata) {
      var r = el('span', 'sn-mac-intorno-riga' + (scattata ? ' is-voce' : ''), testo);
      r.dataset.segno = testo.charAt(0) === '+' ? 'piu' : testo.charAt(0) === '-' ? 'meno' : 'uguale';
      return r;
    };
    prima.forEach(function (t) { pre.appendChild(riga(t, false)); });
    pre.appendChild(riga('+' + v.testo, true));
    dopo.forEach(function (t) { pre.appendChild(riga(t, false)); });
    det.appendChild(pre);
    li.appendChild(det);
    return li;
  }

  /**
   * I blocchi di una richiesta: divisi in guardie toccate, capacità nuove e diff da guardare, ognuno con l'elenco
   * intero delle sue voci (#1404). Un blocco di un server di prima, senza voci, mostra le sue righe come allora.
   */
  function buildBlocchi(blocks) {
    var box = el('div', 'sn-mac-gruppi');
    var gruppi = gruppiDiBlocchi(blocks);
    for (var g = 0; g < gruppi.length; g++) {
      var sez = el('section', 'sn-mac-gruppo');
      if (gruppi[g].gruppo) sez.dataset.gruppo = gruppi[g].gruppo;
      if (gruppi[g].titolo) sez.appendChild(el('p', 'sn-mac-gruppo-title', gruppi[g].titolo));
      var ul = el('ul', 'sn-mac-blocks');
      for (var i = 0; i < gruppi[g].blocchi.length; i++) {
        var b = gruppi[g].blocchi[i];
        var li = el('li', 'sn-mac-block');
        li.dataset.gate = String(b.gate || '');
        li.appendChild(el('span', 'sn-mac-block-label', blockLabel(b)));
        var voci = blockVoci(b);
        var lista = el('ul', 'sn-mac-block-list');
        if (voci.length) {
          voci.forEach(function (v) { lista.appendChild(buildVoce(v)); });
          var more = Math.max(0, Math.floor(Number(b.more) || 0));
          if (more > 0) lista.appendChild(el('li', 'sn-mac-block-items', '… e altre ' + more + ' che non entrano nell’elenco: sono nel diff su GitHub'));
        } else {
          blockItems(b).forEach(function (t) { lista.appendChild(el('li', 'sn-mac-block-items', t)); });
        }
        if (lista.childNodes.length) li.appendChild(lista);
        ul.appendChild(li);
      }
      sez.appendChild(ul);
      box.appendChild(sez);
    }
    return box;
  }

  // Una conferma a metà (tasto armato, o richiesta in volo) blocca ogni ridisegno automatico
  // di `root`: rifatta sotto il cursore, la card perdeva la conferma e spostava i tasti (#550).
  var LIBERA = 'sn-mac-libera';
  var ATTESA_CLIC = { kind: 'wait', text: 'Chiedo al server di fondere…' };
  function occupata(root) {
    return !!(root && root.querySelector
      && root.querySelector('.sn-mac-btn-go.is-armed, .sn-mac-card.is-busy:not(.is-done)'));
  }
  // Rimanda `fn` a quando `root` si libera; vale l'ultima chiesta, perché ognuna ridisegna lo stato di quel momento.
  function quandoLibera(root, fn) {
    if (!root) return;
    if (!occupata(root)) { root.__snMacDopo = null; fn(); return; }
    root.__snMacDopo = fn;
    if (root.__snMacAscolta) return;
    root.__snMacAscolta = true;
    root.addEventListener(LIBERA, function () {
      Promise.resolve().then(function () {
        var f = root.__snMacDopo;
        if (!f || occupata(root)) return;
        root.__snMacDopo = null;
        f();
      });
    });
  }
  function liberata(card) {
    var Ev = global.CustomEvent;
    if (typeof Ev === 'function') card.dispatchEvent(new Ev(LIBERA, { bubbles: true }));
  }
  // Titolo e frase seguono le card: una che sta fondendo, o già decisa, esce dal conto di quelle che aspettano.
  function rititola(box) {
    var t = box && box.querySelector ? box.querySelector('.sn-mac-title-text') : null;
    if (!t) return;
    var cards = box.querySelectorAll('.sn-mac-card');
    var ferme = 0, inCorso = 0, decise = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].classList.contains('is-done')) decise++;
      else if (cards[i].classList.contains('is-merging')) inCorso++;
      else ferme++;
    }
    var testo = headline(ferme, inCorso, decise);
    if (testo) t.textContent = testo;
    var intro = box.querySelector('.sn-mac-intro');
    if (intro) {
      intro.textContent = introText(ferme, inCorso, decise);
      intro.hidden = !intro.textContent;
    }
  }

  // Un'approvazione partita da un'altra strada mentre la card è già sullo schermo (magari col
  // tasto armato, che trattiene i ridisegni): la card la segue subito, senza aspettare (#702).
  function seguiSulPosto(root, id, volo) {
    if (!root || !root.querySelectorAll || !volo) return;
    var cards = root.querySelectorAll('.sn-mac-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.requestId === String(id) && typeof cards[i].__snMacSegui === 'function') {
        cards[i].__snMacSegui(volo.attesa || ATTESA_CLIC, volo.risposta);
      }
    }
  }

  /**
   * Una richiesta = una card.
   *
   * "Approva" è irreversibile (il codice atterra su main e da lì va agli
   * utenti): usa la conferma SUL POSTO — il bottone diventa "Confermi?" e torna
   * com'era da solo — invece di aprire una finestra di mezzo. È lo stesso
   * schema del cestino dell'editor, e qui serve doppiamente: il gesto vale come
   * "sì, so cosa c'è in questo ramo".
   *
   * "Scarta" non distrugge niente di irrecuperabile — la richiesta si rifà con
   * un `npm run finish` — quindi va dritto: chiedere conferma per annullare
   * qualcosa che si riottiene gratis è solo attrito.
   */
  function buildCard(req, opts) {
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var card = el('div', 'sn-mac-card');
    card.dataset.requestId = String(req.id || '');
    card.dataset.branch = String(req.branch || '');

    card.dataset.origin = originOf(req);

    var head = el('div', 'sn-mac-head');
    // La provenienza PRIMA del resto: chi approva deve sapere subito quale delle due guarda.
    // Se nasce da una segnalazione e la pagina sa aprirla, l'etichetta diventa un bottone.
    var origin;
    if (feedbackNum(req) && typeof o.onFeedback === 'function') {
      origin = el('button', 'sn-mac-origin sn-mac-origin-link', originLabel(req));
      origin.type = 'button';
      origin.title = 'Apri la segnalazione #' + feedbackNum(req) + ' da cui nasce questo lavoro.';
      origin.addEventListener('click', function () { o.onFeedback(req); });
    } else {
      origin = el('span', 'sn-mac-origin', originLabel(req));
      origin.title = originHint(req);
    }
    head.appendChild(origin);
    aggiungiInfoFeedback(head, req, o);
    head.appendChild(el('span', 'sn-mac-branch', req.branch || '(ramo sconosciuto)'));
    var sha = linkEsterno('sn-mac-sha', shortSha(req.sha), req.diffUrl);
    sha.title = 'Il commit esaminato: ' + String(req.sha || '') + (linkGitHub(req.diffUrl) ? '\nApri il diff su GitHub' : '');
    head.appendChild(sha);
    // Senza chi ha chiesto, la separazione fra chi chiede e chi approva resta a metà.
    var who = el('span', 'sn-mac-who', requestedBy(req.who, req));
    who.title = 'La richiesta è arrivata con questa identità; approvarla è un gesto tuo, qui.';
    head.appendChild(who);
    var when = el('span', 'sn-mac-when', timeAgo(req.createdAtMs, now));
    when.dataset.da = String(Number(req.createdAtMs) || '');
    head.appendChild(when);
    var exp = el('span', 'sn-mac-expiry', expiresIn(req.expiresAtMs, now));
    exp.dataset.scade = String(Number(req.expiresAtMs) || 0);
    card.classList.toggle('is-expired', exp.textContent === 'scaduta');
    // Anche il suggerimento sotto il puntatore deve sapere di chi è il lavoro: mandare l'owner a
    // pubblicare in locale un ramo di un'automazione è un consiglio che non porta a niente.
    exp.title = 'Vale per il commit esaminato e per una settimana. Passata la scadenza, ' + lowerFirst(howToRetry(req));
    head.appendChild(exp);
    card.appendChild(head);

    var nota = realignedNote(req);
    if (nota) {
      var ria = el('p', 'sn-mac-realigned', nota);
      ria.title = 'L’avevi già approvata, ma main era andato avanti: il server ha fuso main nel ramo e ha rifatto i controlli. '
        + 'Sotto ci sono solo i blocchi che quella approvazione non copriva.';
      card.appendChild(ria);
    }

    var prova = provaNote(req, now);
    if (prova) {
      var pr = el('p', 'sn-mac-prova', prova.testo);
      pr.title = prova.titolo;
      card.appendChild(pr);
    }

    var blocks = Array.isArray(req.blocks) ? req.blocks : [];
    if (blocks.length) {
      card.appendChild(el('p', 'sn-mac-why', nota ? 'Bloccata perché (solo il nuovo):' : 'Bloccata perché:'));
      card.appendChild(buildBlocchi(blocks));
    }

    var status = el('p', 'sn-mac-status');
    status.setAttribute('role', 'status');
    status.hidden = true;

    var actions = el('div', 'sn-mac-actions');
    var discardBtn = el('button', 'sn-mac-btn sn-mac-btn-quiet', 'Scarta');
    discardBtn.type = 'button';
    discardBtn.title = 'Toglila dall’elenco senza fondere niente. ' + howToRetry(req);
    var approveBtn = el('button', 'sn-mac-btn sn-mac-btn-go', 'Approva e fondi');
    approveBtn.type = 'button';
    approveBtn.title = 'Fonde su main esattamente il commit esaminato.';

    var armed = false;
    var armTimer = null;
    function disarm() {
      armed = false;
      approveBtn.textContent = 'Approva e fondi';
      approveBtn.classList.remove('is-armed');
      approveBtn.style.minWidth = '';
      approveBtn.style.minHeight = '';
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      liberata(card);
    }
    function setBusy(on) {
      approveBtn.disabled = !!on;
      discardBtn.disabled = !!on;
      card.classList.toggle('is-busy', !!on);
      if (!on) {
        card.classList.remove('is-merging');
        rititola(card.closest ? card.closest('.sn-mac') : null);
        liberata(card);
      }
    }
    // Esito definitivo: i tasti restano spenti, ma la rilettura che toglie la card può passare.
    function finita() {
      card.classList.add('is-done');
      card.classList.remove('is-merging');
      rititola(card.closest ? card.closest('.sn-mac') : null);
      liberata(card);
    }
    function say(msg) {
      if (!msg) { status.hidden = true; status.textContent = ''; return; }
      status.hidden = false;
      status.textContent = msg.text;
      status.dataset.kind = msg.kind;
    }

    approveBtn.addEventListener('click', function (e) {
      // La coda di un doppio clic (`detail > 1`) non è la conferma: fonderebbe in un gesto solo.
      if (armed && e && e.detail > 1) return;
      if (!armed) {
        // Conferma sul posto: un click solo non manda niente su main. Il secondo
        // clic cade dove è caduto il primo: il tasto armato non si accorcia, o Scarta gli scivola sotto (#550);
        // né si abbassa, se in un pannello stretto «Approva e fondi» andava su due righe.
        armed = true;
        var scatola = approveBtn.getBoundingClientRect();
        approveBtn.style.minWidth = scatola.width + 'px';
        approveBtn.style.minHeight = scatola.height + 'px';
        approveBtn.textContent = 'Confermi?';
        approveBtn.classList.add('is-armed');
        armTimer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      segui(ATTESA_CLIC, o.onApprove ? o.onApprove(req) : null);
    });

    // Un'approvazione in volo, partita da qui o da un'altra strada (il segno «fondi senza
    // chiedermelo»): finché il server non risponde la card lo dice e non se ne manda un'altra (#702).
    var seguita = null;
    function segui(attesa, risposta) {
      // La stessa risposta arriva anche da seguiSulPosto: seguita due volte, l'esito si direbbe due volte.
      if (risposta && seguita === risposta) return;
      seguita = risposta;
      setBusy(true);
      card.classList.add('is-merging');
      rititola(card.closest ? card.closest('.sn-mac') : null);
      say(attesa);
      Promise.resolve(risposta)
        .then(function (reply) {
          var msg = outcomeMessage(reply, req);
          say(msg);
          if ((msg.kind === 'ok' || msg.reload) && o.onDone) { finita(); o.onDone(); }
          else setBusy(false);
        })
        .catch(function (e) {
          say(outcomeMessage({ ok: false, error: (e && e.message) || String(e) }, req));
          setBusy(false);
        });
    }
    card.__snMacSegui = function (attesa, risposta) {
      if (card.classList.contains('is-done')) return;
      if (armed) disarm();
      segui(attesa, risposta);
    };

    discardBtn.addEventListener('click', function () {
      disarm();
      setBusy(true);
      Promise.resolve(o.onDiscard ? o.onDiscard(req) : null)
        .then(function (reply) {
          var msg = outcomeMessage(reply, req);
          if (msg.kind === 'ok' && o.onDone) { finita(); o.onDone(); return; }
          say(msg);
          setBusy(false);
        })
        .catch(function (e) {
          say(outcomeMessage({ ok: false, error: (e && e.message) || String(e) }, req));
          setBusy(false);
        });
    });

    actions.appendChild(discardBtn);
    actions.appendChild(approveBtn);
    // L'esito sotto i tasti: comparendo sopra li spingeva giù, e il clic per riprovare cadeva fuori.
    card.appendChild(actions);
    card.appendChild(status);
    // Un tentativo già fatto — e non riuscito — resta scritto sulla card: un
    // avviso che passa lo legge solo chi è davanti allo schermo in quel momento.
    var volo = o.inVolo ? o.inVolo(req) : null;
    var prima = volo ? null : (o.esitoIniziale ? o.esitoIniziale(req) : null);
    if (volo) segui(volo.attesa || ATTESA_CLIC, volo.risposta);
    else if (prima) {
      say(prima);
      // Già fusa, scartata o sostituita: non c'è più niente da approvare finché la rilettura non la toglie.
      if (prima.kind === 'ok' || prima.reload) { setBusy(true); finita(); }
    }
    return card;
  }

  // Chi la riallinea, e la frase che lo dice: la sola copia, letta anche dal quadrato di Gestione (manageReview).
  // `inCorso` lo sa solo chi conosce la pratica (Gestione, dal suo stato); `null` = non si sa (pagina da browser, richiesta
  // senza pratica in lista): allora la frase non promette niente e dice dove guardare.
  var RIALLINEAMENTO_NON_ANDATO = 'Il riallineamento automatico non è andato: rimetti la sua pratica In coda per un giro nuovo, o segna la fusione come sistemata se te ne sei già occupato.';
  var RIALLINEAMENTO_DA_GUARDARE = 'Se la sua pratica è ancora in lavorazione, la routine riallinea il ramo da sola e ti arriva una richiesta nuova solo se c’è qualcosa che non hai ancora visto; se in Gestione è ferma, rimettila In coda per un giro nuovo.';
  /** La frase su cosa succede dopo un sì finito in conflitto, sapendo (true/false) o no (null) se la routine riallinea. PURA. */
  function testoRiallineamento(req, inCorso) {
    if (inCorso === true) return RIALLINEA_DA_SOLA;
    if (!siRiallineaDaSola(req)) return dopoIlConflitto(req);
    return inCorso === false ? RIALLINEAMENTO_NON_ANDATO : RIALLINEAMENTO_DA_GUARDARE;
  }
  function riallineamentoDi(req, o) {
    var dato = o && typeof o.riallineamento === 'function' ? o.riallineamento(req) : null;
    var inCorso = dato ? !!dato.inCorso : null;
    return { inCorso: inCorso, testo: testoRiallineamento(req, inCorso) };
  }

  // Una fusione APPROVATA e mai avvenuta (conflitto) non chiede un'altra approvazione, ma non
  // può sparire: resta in vista finché non è fusa o finché l'owner non la segna sistemata.
  function buildFailedCard(req, opts) {
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var card = el('div', 'sn-mac-card sn-mac-card-failed');
    card.dataset.requestId = String(req.id || '');
    card.dataset.branch = String(req.branch || '');
    card.dataset.origin = originOf(req);

    var head = el('div', 'sn-mac-head');
    var origin;
    if (feedbackNum(req) && typeof o.onFeedback === 'function') {
      origin = el('button', 'sn-mac-origin sn-mac-origin-link', originLabel(req));
      origin.type = 'button';
      origin.title = 'Apri la segnalazione #' + feedbackNum(req) + ' da cui nasce questo lavoro.';
      origin.addEventListener('click', function () { o.onFeedback(req); });
    } else {
      origin = el('span', 'sn-mac-origin', originLabel(req));
      origin.title = originHint(req);
    }
    head.appendChild(origin);
    aggiungiInfoFeedback(head, req, o);
    head.appendChild(el('span', 'sn-mac-branch', req.branch || '(ramo sconosciuto)'));
    var sha = el('span', 'sn-mac-sha', shortSha(req.sha));
    sha.title = 'Il commit che avevi approvato: ' + String(req.sha || '');
    head.appendChild(sha);
    head.appendChild(el('span', 'sn-mac-who', requestedBy(req.who, req)));
    var quando = el('span', 'sn-mac-when', 'approvata ' + timeAgo(req.decidedAtMs || req.usedAtMs, now));
    quando.dataset.da = String(Number(req.decidedAtMs || req.usedAtMs) || '');
    quando.dataset.prima = 'approvata ';
    head.appendChild(quando);
    card.appendChild(head);

    var tentativo = realignFailureText(req.realignReason);
    var ria = riallineamentoDi(req, o);
    card.dataset.riallineamento = ria.inCorso === true ? 'in_corso' : ria.inCorso === false ? 'fallito' : 'da_guardare';
    card.appendChild(el('p', 'sn-mac-why',
      'L’avevi approvata, ma la fusione NON è avvenuta: main era andato avanti e le modifiche '
      + 'non si incastrano da sole. ' + (tentativo ? tentativo + ' ' : '') + ria.testo
      + ' Quando il lavoro rifatto verrà fuso, questa scheda si toglie da sola.'));

    var status = el('p', 'sn-mac-status');
    status.setAttribute('role', 'status');
    status.hidden = true;

    var actions = el('div', 'sn-mac-actions');
    var okBtn = el('button', 'sn-mac-btn sn-mac-btn-quiet', 'Segna come sistemata');
    okBtn.type = 'button';
    okBtn.title = 'Toglila da qui. Non fonde e non cancella niente: dice solo che te ne sei occupato.';
    okBtn.addEventListener('click', function () {
      okBtn.disabled = true;
      Promise.resolve(o.onDiscard ? o.onDiscard(req) : null)
        .then(function (reply) {
          var msg = outcomeMessage(reply, req);
          if (msg.kind === 'ok' && o.onDone) { o.onDone(); return; }
          status.hidden = false; status.textContent = msg.text; status.dataset.kind = msg.kind;
          okBtn.disabled = false;
        })
        .catch(function (e) {
          var msg = outcomeMessage({ ok: false, error: (e && e.message) || String(e) }, req);
          status.hidden = false; status.textContent = msg.text; status.dataset.kind = msg.kind;
          okBtn.disabled = false;
        });
    });
    actions.appendChild(okBtn);
    card.appendChild(actions);
    card.appendChild(status);
    return card;
  }

  // Il tempo sulle card cammina da solo (#487): si riscrivono solo le scritte, mai la card, così un «Confermi?»
  // armato o una fusione in volo restano dove sono. Passata la scadenza la card dice «scaduta».
  var OROLOGIO_MS = 15000;
  function aggiornaTempi(root, nowMs) {
    var r = root || global.document;
    if (!r || !r.querySelectorAll) return;
    var now = Number(nowMs) || Date.now();
    var scadenze = r.querySelectorAll('.sn-mac-expiry[data-scade]');
    for (var i = 0; i < scadenze.length; i++) {
      var t = expiresIn(Number(scadenze[i].dataset.scade), now);
      if (scadenze[i].textContent !== t) scadenze[i].textContent = t;
      var card = scadenze[i].closest ? scadenze[i].closest('.sn-mac-card') : null;
      if (card) card.classList.toggle('is-expired', t === 'scaduta');
    }
    var quando = r.querySelectorAll('.sn-mac-when[data-da]');
    for (var k = 0; k < quando.length; k++) {
      var fa = timeAgo(Number(quando[k].dataset.da), now);
      var testo = (quando[k].dataset.prima || '') + fa;
      if (fa && quando[k].textContent !== testo) quando[k].textContent = testo;
    }
  }
  var orologio = null;
  function avviaOrologio() {
    if (orologio || typeof global.setInterval !== 'function' || !global.document) return;
    orologio = global.setInterval(function () { aggiornaTempi(global.document); }, OROLOGIO_MS);
    if (orologio && typeof orologio.unref === 'function') orologio.unref();
  }

  function render(host, opts) {
    if (!host) return 0;
    avviaOrologio();
    var o = opts || {};
    var list = Array.isArray(o.requests) ? o.requests : [];
    var failed = Array.isArray(o.failed) ? o.failed : [];
    if (occupata(host)) {
      quandoLibera(host, function () { render(host, o); });
      return list.length + failed.length;
    }
    host.__snMacDopo = null;
    host.replaceChildren();
    host.hidden = list.length === 0 && failed.length === 0;
    if (!list.length && !failed.length) return 0;

    // Prima delle richieste in attesa: più invecchia, più costa accorgersene.
    if (failed.length) {
      // Se le riallinea tutte la routine, il titolo non suona l'allarme: non c'è niente da fare (#1425).
      var tutteInCorso = failed.every(function (r) { return riallineamentoDi(r, o).inCorso === true; });
      var fbox = el('section', 'sn-mac sn-mac-failed' + (tutteInCorso ? ' sn-mac-failed--in-corso' : ''));
      fbox.setAttribute('aria-label', 'Fusioni approvate ma non avvenute');
      var ftitle = el('div', 'sn-mac-title');
      var fico = el('span', 'sn-mac-ico');
      var ficons = global.SN_ICONS;
      fico.innerHTML = (ficons && typeof ficons.lock === 'function') ? ficons.lock(18) : '';
      ftitle.appendChild(fico);
      ftitle.appendChild(el('span', 'sn-mac-title-text', tutteInCorso
        ? (failed.length === 1 ? 'Una fusione approvata è da riallineare' : failed.length + ' fusioni approvate sono da riallineare')
        : (failed.length === 1 ? 'Una fusione approvata non è avvenuta' : failed.length + ' fusioni approvate non sono avvenute')));
      fbox.appendChild(ftitle);
      for (var k = 0; k < failed.length; k++) fbox.appendChild(buildFailedCard(failed[k], o));
      host.appendChild(fbox);
    }

    if (list.length) {
      var box = el('section', 'sn-mac');
      box.setAttribute('aria-label', 'Fusioni in attesa di approvazione');

      var title = el('div', 'sn-mac-title');
      var ico = el('span', 'sn-mac-ico');
      var icons = global.SN_ICONS;
      ico.innerHTML = (icons && typeof icons.lock === 'function') ? icons.lock(18) : '';
      title.appendChild(ico);
      title.appendChild(el('span', 'sn-mac-title-text', headline(list.length)));
      box.appendChild(title);

      var intro = el('p', 'sn-mac-intro', INTRO_FERME);
      box.appendChild(intro);

      for (var i = 0; i < list.length; i++) box.appendChild(buildCard(list[i], o));
      rititola(box);
      host.appendChild(box);
    }
    return list.length + failed.length;
  }

  // ── «Salta il controllo» fuori da Filo (#489) ─────────────────────────────

  var SALTA_ETICHETTA = 'Salta il controllo';
  var ATTESA_SALTA = { kind: 'wait', text: 'Chiedo al server…' };

  /** Il titolo dell'elenco delle bocciature. PURA. */
  function skipsHeadline(count) {
    var n = Number(count) || 0;
    if (n <= 0) return '';
    return n === 1 ? 'Un lavoro bocciato dal controllo di sicurezza' : n + ' lavori bocciati dal controllo di sicurezza';
  }

  /** Cosa dice la card del perché, quando il perché non c'è per intero. PURA. '' se c'è tutto. */
  function skipReasonNote(b) {
    var v = b || {};
    if (v.motivoIlleggibile) return 'La spiegazione del controllo non si apre qui: leggila nella scheda della pratica in Filo.';
    if (!String(v.motivo || '').trim()) return 'Il controllo non ha lasciato una spiegazione per questa pratica.';
    if (v.motivoTagliato) return 'La spiegazione continua: il resto lo leggi nella scheda della pratica in Filo.';
    return '';
  }

  /**
   * Una bocciatura del controllo = una card, con lo stesso gesto della scheda di Filo: «Salta il controllo»
   * con la conferma sul posto. Il cancello di fusione gira comunque dopo il salto.
   */
  function buildSkipCard(b, opts) {
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var card = el('div', 'sn-mac-card sn-mac-card-skip');
    card.dataset.feedbackId = String(b.feedbackId || '');
    card.dataset.origin = 'routine';

    var head = el('div', 'sn-mac-head');
    var num = String(b.num || '').replace(/^#+/, '');
    var origin = el('span', 'sn-mac-origin', num ? 'automazione · feedback #' + num : 'automazione');
    origin.title = 'Lavoro di un’automazione: l’ha fermato il suo controllo di sicurezza.';
    head.appendChild(origin);
    head.appendChild(el('span', 'sn-mac-branch', b.branch || '(ramo sconosciuto)'));
    if (b.atMs) head.appendChild(el('span', 'sn-mac-when', timeAgo(b.atMs, now)));
    card.appendChild(head);

    if (String(b.titolo || '').trim()) card.appendChild(el('p', 'sn-mac-skip-title', b.titolo));
    card.appendChild(el('p', 'sn-mac-why', 'Cosa ha trovato il controllo:'));
    if (String(b.motivo || '').trim()) card.appendChild(el('p', 'sn-mac-skip-reason', b.motivo));
    var nota = skipReasonNote(b);
    if (nota) card.appendChild(el('p', 'sn-mac-status', nota));

    var status = el('p', 'sn-mac-status');
    status.setAttribute('role', 'status');
    status.hidden = true;
    var actions = el('div', 'sn-mac-actions');
    var btn = el('button', 'sn-mac-btn sn-mac-btn-go', SALTA_ETICHETTA);
    btn.type = 'button';
    btn.title = 'Hai letto cosa ha trovato il controllo e vai avanti lo stesso. Il cancello di fusione resta: può fermare il ramo comunque.';

    var armed = false;
    var armTimer = null;
    function disarm() {
      armed = false;
      btn.textContent = SALTA_ETICHETTA;
      btn.classList.remove('is-armed');
      btn.style.minWidth = '';
      btn.style.minHeight = '';
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      liberata(card);
    }
    function say(msg) {
      status.hidden = !msg;
      status.textContent = msg ? msg.text : '';
      if (msg) status.dataset.kind = msg.kind; else delete status.dataset.kind;
    }
    function messaggio(reply) {
      var r = reply || {};
      if (r.ok === false) return { kind: 'err', text: String(r.error || 'Non è riuscito.') };
      return skipOutcomeMessage(r, { doveSiApprova: o.doveSiApprova });
    }
    // Ogni esito con ok vuol dire salto registrato e pratica uscita dalle bocciature, anche quelli del cancello
    // del server: un elenco chiuso qui lasciava la card premibile e l'esito perso alla rilettura.
    function definitivo(reply) {
      return !!(reply && reply.ok !== false && reply.esito);
    }

    btn.addEventListener('click', function (e) {
      // La coda di un doppio clic non è la conferma: salterebbe il controllo in un gesto solo.
      if (armed && e && e.detail > 1) return;
      if (!armed) {
        armed = true;
        var scatola = btn.getBoundingClientRect();
        btn.style.minWidth = scatola.width + 'px';
        btn.style.minHeight = scatola.height + 'px';
        btn.textContent = 'Confermi?';
        btn.classList.add('is-armed');
        armTimer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      btn.disabled = true;
      card.classList.add('is-busy');
      say(ATTESA_SALTA);
      Promise.resolve(o.onSkip ? o.onSkip(b) : null)
        .then(function (reply) {
          say(messaggio(reply));
          if (definitivo(reply)) {
            card.classList.add('is-done');
            liberata(card);
            if (o.onDone) o.onDone(b, reply, messaggio(reply));
            return;
          }
          btn.disabled = false;
          card.classList.remove('is-busy');
          liberata(card);
        })
        .catch(function (err) {
          say({ kind: 'err', text: (err && err.message) || String(err) });
          btn.disabled = false;
          card.classList.remove('is-busy');
          liberata(card);
        });
    });

    actions.appendChild(btn);
    card.appendChild(actions);
    card.appendChild(status);
    var prima = o.esitoIniziale ? o.esitoIniziale(b) : null;
    if (prima) say(prima);
    return card;
  }

  /**
   * Le bocciature del controllo dentro `host`; niente da mostrare = `host` vuoto e nascosto. Come `render`, non
   * ridisegna sotto una conferma a metà. `o.illeggibili`: pratiche ferme che il server non ha potuto aprire.
   * @returns {number} quante card sono state disegnate
   */
  function renderSkips(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var list = Array.isArray(o.skips) ? o.skips : [];
    var illeggibili = Number(o.illeggibili) || 0;
    if (occupata(host)) {
      quandoLibera(host, function () { renderSkips(host, o); });
      return list.length;
    }
    host.__snMacDopo = null;
    host.replaceChildren();
    host.hidden = list.length === 0 && illeggibili === 0;
    if (host.hidden) return 0;
    var box = el('section', 'sn-mac sn-mac-skips');
    box.setAttribute('aria-label', 'Lavori bocciati dal controllo di sicurezza');
    var title = el('div', 'sn-mac-title');
    var ico = el('span', 'sn-mac-ico');
    var icons = global.SN_ICONS;
    ico.innerHTML = (icons && typeof icons.warning === 'function') ? icons.warning(18) : '';
    title.appendChild(ico);
    title.appendChild(el('span', 'sn-mac-title-text', skipsHeadline(list.length) || 'Lavori bocciati dal controllo di sicurezza'));
    box.appendChild(title);
    if (list.length) box.appendChild(el('p', 'sn-mac-intro', 'Saltare il controllo non fonde da solo: il cancello di fusione gira comunque.'));
    for (var i = 0; i < list.length; i++) box.appendChild(buildSkipCard(list[i], o));
    if (illeggibili) {
      box.appendChild(el('p', 'sn-mac-status', (illeggibili === 1 ? 'Una pratica ferma per il controllo non si apre' : illeggibili + ' pratiche ferme per il controllo non si aprono')
        + ' qui: la chiave del server non le legge. Le vedi in Filo, nei Ricevuti di Gestione.'));
    }
    if (o.oltre) box.appendChild(el('p', 'sn-mac-status', 'Ce ne sono altre oltre queste: le vedi in Filo, nei Ricevuti di Gestione.'));
    host.appendChild(box);
    return list.length;
  }

  /**
   * Le decisioni passate, in righe minute. Traccia dell'eccezione: un'apertura
   * di questo tipo che non lascia segno non è verificabile.
   * Vive in Gestione → Log — fra le cose da decidere sarebbe rumore.
   */
  function renderRecent(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var list = Array.isArray(o.recent) ? o.recent : [];
    host.replaceChildren();
    host.hidden = list.length === 0;
    if (!list.length) return 0;
    host.appendChild(el('p', 'sn-mac-recent-title', 'Decise di recente'));
    var ul = el('ul', 'sn-mac-recent');
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var esito = recentOutcome(r);
      var li = el('li', 'sn-mac-recent-row');
      li.appendChild(el('span', 'sn-mac-recent-origin', originLabel(r)));
      li.appendChild(el('span', 'sn-mac-recent-branch', r.branch || '—'));
      li.appendChild(el('span', 'sn-mac-recent-what', esito));
      // La traccia serve a rispondere a «chi, cosa, quando»: senza il chi risponde a due domande
      // su tre.
      li.appendChild(el('span', 'sn-mac-recent-who', requestedBy(r.who, r)));
      li.appendChild(el('span', 'sn-mac-recent-when', timeAgo(r.decidedAtMs || r.expiresAtMs, now)));
      li.dataset.outcome = esito;
      ul.appendChild(li);
    }
    host.appendChild(ul);
    return list.length;
  }

  // La data e l'ora per esteso, in ora locale di chi legge: il controllo a posteriori si fa a
  // distanza di giorni, e «7 giorni fa» non dice quando è successo. PURA.
  function dateTimeText(atMs) {
    var at = Number(atMs);
    if (!isFinite(at) || at <= 0) return '';
    var d = new Date(at);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear()
      + ' alle ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // Quando è stata fusa: la data, e fra parentesi quanto tempo fa. PURA.
  function mergedWhenText(atMs, nowMs) {
    var data = dateTimeText(atMs);
    if (!data) return 'fusa in un momento non registrato';
    return 'fusa il ' + data + ' (' + timeAgo(atMs, nowMs) + ')';
  }

  // Quante fusioni «senza chiedere» il server ha lasciato fuori ('' se ci sono tutte): un
  // elenco tagliato in silenzio è ciò che un controllo a posteriori non può permettersi.
  function preapprovedMoreText(shown, total) {
    var n = Math.max(0, Math.floor(Number(total) || 0) - Math.max(0, Math.floor(Number(shown) || 0)));
    if (!n) return '';
    return n === 1
      ? 'Ce n’è un’altra, più vecchia, che qui non entra.'
      : 'Ce ne sono altre ' + n + ', più vecchie, che qui non entrano.';
  }

  // Il segno che il server lascia quando l'owner approva col clic una richiesta: «<email> · approvazione <id>».
  // Non è pieno: copre solo i blocchi già approvati. Pieno = la pre-approvazione dei rami di prima.
  var RE_SEGNO_DA_APPROVAZIONE = / · approvazione ([0-9a-f]{24})$/;

  /**
   * Il segno con cui una fusione non ha chiesto, letto dalla traccia. PURA.
   * null se non c'è; `tipo` 'pieno' (messo a mano, copre tutto) o
   * 'approvazione' (nato da un sì a una richiesta: blocchi nuovi = si chiede).
   */
  function segnoPreapprovazione(m) {
    if (!m || typeof m !== 'object') return null;
    var by = String(m.by || '').trim();
    if (!by) return null;
    var at = String(m.at || '').trim();
    var hit = RE_SEGNO_DA_APPROVAZIONE.exec(by);
    if (hit) return { tipo: 'approvazione', by: by, at: at, richiesta: hit[1] };
    return { tipo: 'pieno', by: by, at: at };
  }

  function quandoSegno(at) {
    var s = String(at || '').trim();
    if (!s) return '';
    return dateTimeText(Date.parse(s)) || s;
  }

  /** «dal tuo sì alla richiesta del …»: da dove viene un segno nato da un'approvazione. PURA. */
  function origineSegnoDaApprovazione(segno) {
    var quando = quandoSegno(segno && segno.at);
    return quando ? 'dal tuo sì alla richiesta del ' + quando : 'dal tuo sì a una richiesta';
  }

  /** Chi aveva messo il segno sulla pratica, in una frase. PURA. */
  function preapprovedBy(r) {
    var by = String((r && r.preapprovedBy) || '').trim();
    var segno = segnoPreapprovazione({ by: by, at: r && r.preapprovedAt });
    if (segno && segno.tipo === 'approvazione') return 'pre-approvata ' + origineSegnoDaApprovazione(segno);
    by = by.slice(0, 120);
    return by ? 'pre-approvata da ' + by : 'pre-approvata sulla pratica';
  }

  /** Perché una fusione non ha chiesto: 'fiducia', 'pieno' (segno a mano), 'approvazione' (segno da un sì), 'locale'. PURA. */
  function specieFusaSenzaChiedere(r) {
    if (isFiducia(r)) return 'fiducia';
    if (isSkippedL5(r)) return 'locale';
    var segno = segnoPreapprovazione({ by: r && r.preapprovedBy, at: r && r.preapprovedAt });
    return segno && segno.tipo === 'approvazione' ? 'approvazione' : 'pieno';
  }

  // Per specie: `solo` è una frase intera, `misto` segue «Alcuni/altri».
  var PERCHE_SENZA_CHIEDERE = [
    ['fiducia', {
      solo: 'Erano lavoro fidato: feedback fidato, scritto solo da sessioni col biglietto pulito.',
      misto: 'erano lavoro fidato (feedback fidato, scritto solo da sessioni col biglietto pulito)',
    }],
    ['pieno', {
      solo: 'Sulla pratica avevi messo «fondi senza chiedermelo».',
      misto: 'avevano sulla pratica il tuo «fondi senza chiedermelo»',
    }],
    ['approvazione', {
      solo: 'Avevano solo blocchi che avevi già approvato, con un sì a una richiesta precedente sulla stessa pratica.',
      misto: 'avevano solo blocchi che avevi già approvato con un sì a una richiesta precedente',
    }],
    ['locale', {
      solo: 'Venivano da una pratica tua con la prova del mittente, o da un feedback che hai approvato come lavoro locale.',
      misto: 'erano lavoro locale (una pratica tua con la prova del mittente, o un feedback che hai approvato come lavoro locale)',
    }],
  ];

  /**
   * L'introduzione delle «Fuse senza chiedere», detta solo per le specie che l'elenco contiene. PURA.
   * Una frase sola per tutte dava il «fondi senza chiedermelo» anche alle fusioni nate da un sì (#743).
   */
  function preapprovedIntro(list) {
    var righe = Array.isArray(list) ? list : [];
    var presenti = {};
    for (var i = 0; i < righe.length; i++) presenti[specieFusaSenzaChiedere(righe[i])] = true;
    var frasi = PERCHE_SENZA_CHIEDERE.filter(function (p) { return presenti[p[0]]; });
    var testa = 'Lavori fermati dai controlli e fusi lo stesso. ';
    var coda = ' Qui c’è tutto quello che era stato segnalato.';
    if (!frasi.length) return testa.trim() + coda;
    if (frasi.length === 1) return testa + frasi[0][1].solo + coda;
    var soggetti = ['Alcuni ', 'altri ', 'altri ancora '];
    var parti = frasi.map(function (p, k) { return soggetti[k] + p[1].misto; });
    return testa + parti.join('; ') + '.' + coda;
  }

  /**
   * Quando era stato messo il segno, per esteso e in ora locale. PURA.
   * Il momento viaggia come testo ISO (in ora universale): mostrarlo grezzo
   * era un calcolo per chi legge — la stessa cura della data di fusione.
   * '' se manca; se non è una data, il testo così com'è (meglio di niente).
   */
  function preapprovedWhenText(at) {
    var s = String(at || '').trim();
    if (!s) return '';
    var data = dateTimeText(Date.parse(s));
    return 'Segno messo il ' + (data || s);
  }

  /**
   * Le fusioni avvenute SENZA chiedere: l'owner aveva messo il segno sulla
   * pratica, e il server ha fuso da solo quando i controlli hanno bloccato.
   *
   * È il controllo a posteriori, quindi qui l'elenco di ciò che era stato
   * segnalato si mostra PER INTERO — ogni gate, ogni file, ogni riga — non
   * nelle righe minute delle decisioni: la decisione l'owner l'ha presa prima,
   * senza leggere; questa è l'unica occasione in cui legge.
   * Vive in Gestione → Log.
   */
  function renderPreapproved(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var list = Array.isArray(o.preapproved) ? o.preapproved : [];
    host.replaceChildren();
    host.hidden = list.length === 0;
    if (!list.length) return 0;
    host.appendChild(el('p', 'sn-mac-recent-title', 'Fuse senza chiedere'));
    host.appendChild(el('p', 'sn-mac-preapproved-intro', preapprovedIntro(list)));
    var ul = el('ul', 'sn-mac-preapproved');
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var li = el('li', 'sn-mac-preapproved-row');
      var head = el('div', 'sn-mac-preapproved-head');
      if (typeof o.onFeedback === 'function' && feedbackNum(r)) {
        var origin = el('button', 'sn-mac-origin sn-mac-origin-link', originLabel(r));
        origin.type = 'button';
        origin.title = 'Apri la segnalazione';
        origin.addEventListener('click', (function (req) { return function () { o.onFeedback(req); }; })(r));
        head.appendChild(origin);
      } else {
        head.appendChild(el('span', 'sn-mac-recent-origin', originLabel(r)));
      }
      aggiungiInfoFeedback(head, r, o);
      head.appendChild(el('span', 'sn-mac-recent-branch', r.branch || '—'));
      var sha = linkEsterno('sn-mac-sha', shortSha(r.mergeSha || r.sha), r.diffUrl);
      sha.title = 'Il commit esaminato: ' + String(r.sha || '') + (r.mergeSha ? '\nIl commit di fusione: ' + String(r.mergeSha) : '')
        + (linkGitHub(r.diffUrl) ? '\nApri il diff su GitHub' : '');
      head.appendChild(sha);
      var who = el('span', 'sn-mac-recent-who', isFiducia(r) ? 'lavoro fidato: controllo registrato'
        : isSkippedL5(r) ? 'lavoro locale: L5 saltato' : preapprovedBy(r));
      var specie = specieFusaSenzaChiedere(r);
      if (specie === 'locale' || specie === 'fiducia') who.title = skippedL5Hint(r);
      else if (specie === 'approvazione') who.title = 'Il segno l’aveva lasciato il tuo sì e valeva solo per i blocchi già approvati. Con blocchi nuovi ti avrebbe chiesto.';
      else if (r.preapprovedAt) who.title = preapprovedWhenText(r.preapprovedAt);
      head.appendChild(who);
      head.appendChild(el('span', 'sn-mac-recent-when', mergedWhenText(r.decidedAtMs || r.createdAtMs, now)));
      li.appendChild(head);
      var blocks = Array.isArray(r.blocks) ? r.blocks : [];
      if (blocks.length) {
        li.appendChild(buildBlocchi(blocks));
      } else {
        li.appendChild(el('p', 'sn-mac-status', 'Nessun dettaglio registrato su cosa era stato segnalato.'));
      }
      ul.appendChild(li);
    }
    host.appendChild(ul);
    var more = preapprovedMoreText(list.length, o.preapprovedTotal);
    if (more) host.appendChild(el('p', 'sn-mac-status sn-mac-preapproved-more', more));
    return list.length;
  }

  global.SN_MERGE_APPROVALS = {
    shortSha: shortSha,
    realignReasonText: realignReasonText,
    realignFailureText: realignFailureText,
    realignedNote: realignedNote,
    provaNote: provaNote,
    recentOutcome: recentOutcome,
    timeAgo: timeAgo,
    expiresIn: expiresIn,
    headline: headline,
    introText: introText,
    requestedBy: requestedBy,
    originOf: originOf,
    feedbackNum: feedbackNum,
    originLabel: originLabel,
    originHint: originHint,
    isSkippedL5: isSkippedL5,
    skippedL5Hint: skippedL5Hint,
    isFiducia: isFiducia,
    howToRetry: howToRetry,
    blockLabel: blockLabel,
    blockItems: blockItems,
    blockVoci: blockVoci,
    doveVoce: doveVoce,
    linkGitHub: linkGitHub,
    gruppiDiBlocchi: gruppiDiBlocchi,
    outcomeMessage: outcomeMessage,
    skipOutcomeMessage: skipOutcomeMessage,
    skipsHeadline: skipsHeadline,
    skipReasonNote: skipReasonNote,
    renderSkips: renderSkips,
    render: render,
    occupata: occupata,
    quandoLibera: quandoLibera,
    seguiSulPosto: seguiSulPosto,
    renderRecent: renderRecent,
    preapprovedBy: preapprovedBy,
    segnoPreapprovazione: segnoPreapprovazione,
    preapprovedWhenText: preapprovedWhenText,
    dateTimeText: dateTimeText,
    mergedWhenText: mergedWhenText,
    preapprovedMoreText: preapprovedMoreText,
    preapprovedIntro: preapprovedIntro,
    renderPreapproved: renderPreapproved,
    specieFusaSenzaChiedere: specieFusaSenzaChiedere,
    etichettaRuolo: etichettaRuolo,
    aggiornaTempi: aggiornaTempi,
    OROLOGIO_MS: OROLOGIO_MS,
    siRiallineaDaSola: siRiallineaDaSola,
    dopoIlConflitto: dopoIlConflitto,
    testoRiallineamento: testoRiallineamento,
    RIALLINEA_DA_SOLA: RIALLINEA_DA_SOLA,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
