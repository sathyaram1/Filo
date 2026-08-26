// L'AVVISO DELLE FUSIONI IN ATTESA — superficie dell'owner, un pezzo solo.
//
// PERCHÉ ESISTE (SPEC-RIDISEGNO-MAX.md §10)
//   Il controllo deterministico di sicurezza del server blocca le fusioni che
//   toccano le aree protette: le guardie, gli automatismi, le regole del
//   database, le chiavi, l'aggiunta di dipendenze. È giusto per il lavoro delle
//   automazioni — codice scritto da un'IA a partire da testo di sconosciuti.
//
//   Il lavoro LOCALE dell'owner però ci cade dentro quasi sempre, perché in
//   locale si lavora proprio su quelle cose. Da oggi il blocco non è un rifiuto
//   secco: il server apre una richiesta in attesa, e l'owner la approva QUI —
//   davanti allo schermo, su una superficie diversa dal terminale. È questo che
//   rende l'eccezione accettabile: una sessione catturata ha le credenziali
//   della macchina, non le mani dell'owner sulla finestra di Filo.
//
// DOVE VIVE (scelta dell'owner, 2026-08-26)
//   SOLO nella dashboard di gestione, in cima ai Ricevuti: i Ricevuti sono le
//   cose che aspettano una decisione dell'owner, e questa È una decisione —
//   sta lì, prima dei feedback, non su una superficie a parte. Prima l'avviso
//   viveva anche sulla prima schermata del browser: due posti per la stessa
//   decisione erano rumore per la home di tutti i giorni.
//
//   Il modulo resta separato dalla pagina perché tiene insieme le due rese —
//   l'avviso da decidere (Ricevuti) e la traccia delle decisioni passate
//   (Automazioni) — e la parte PURA che gli unit test coprono.
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

  /**
   * "adesso" / "N minuti fa" / "N ore fa". PURA.
   * Una richiesta vive un giorno: servono sia i minuti sia le ore.
   */
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

  /**
   * Quanto resta prima che la richiesta scada. PURA.
   *
   * Si dice sempre, e si dice PRIMA: scoprire che è scaduta premendo "Approva"
   * è il modo peggiore. Sotto il minuto non si finge precisione ("meno di un
   * minuto"): un conto alla rovescia al secondo su una cosa da decidere con
   * calma è solo ansia.
   *
   * La finestra è di un giorno (il perché sta nel server, dove il valore vive),
   * quindi la scala normale sono le ORE: si arrotondano per DIFETTO, così
   * l'avviso non promette mai più tempo di quanto ce n'è davvero.
   */
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
    return h === 1 ? 'scade fra 1 ora' : 'scade fra ' + h + ' ore';
  }

  /**
   * Il titolo dell'avviso. PURA.
   * Zero richieste → stringa vuota: chi non ne ha non deve vedere niente.
   */
  function headline(count) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n) return '';
    if (n === 1) return 'Una fusione aspetta il tuo via libera';
    return n + ' fusioni aspettano il tuo via libera';
  }

  /**
   * Chi ha chiesto la fusione, in una frase. PURA.
   *
   * Questa superficie esiste per SEPARARE chi chiede da chi approva: tacere chi
   * ha chiesto le toglie metà del senso. Il server manda l'identità con cui la
   * richiesta è arrivata — di norma un'email, altrimenti l'identificativo
   * tecnico dell'accesso.
   *
   * Un identificativo tecnico non si stampa: a chi legge non dice niente e
   * somiglia a rumore. Si dice invece COSA significa ("un accesso senza
   * email"), che è l'informazione vera: la richiesta è arrivata da una sessione
   * autenticata di cui non si conosce l'intestatario.
   */
  function requestedBy(who, req) {
    var s = String(who == null ? '' : who).trim().slice(0, 120);
    if (!s) return 'chi l’ha chiesta non risulta';
    if (s.indexOf('@') > 0) return 'chiesta da ' + s;
    // Un'automazione un'email non ce l'ha e non l'avrà mai: quello che il
    // server manda è il ruolo che stava lavorando, e quello SÌ dice qualcosa a
    // chi decide. Dirgli "un accesso senza email" sarebbe vero e inutile.
    if (originOf(req) === 'routine') return 'chiesta da ' + s;
    return 'chiesta da un accesso senza email';
  }

  /**
   * Da dove arriva il lavoro fermato. PURA.
   *
   * Le due provenienze finiscono nello STESSO elenco — un blocco che non si
   * vede è un lavoro fermo per sempre — ma non sono la stessa cosa da leggere:
   * il lavoro locale l'owner l'ha fatto con le sue mani, quello di
   * un'automazione l'ha scritto un modello partendo dal testo di uno
   * sconosciuto. Chi approva deve saperlo prima di dire di sì.
   *
   * Origine assente = `locale`: è il caso storico (le richieste esistevano
   * solo per il finish locale), e va letto così, non come "non si sa".
   */
  function originOf(req) {
    return String((req && req.origin) || '') === 'routine' ? 'routine' : 'locale';
  }

  /** L'etichetta della provenienza, col numero del feedback quando c'è. PURA. */
  function originLabel(req) {
    if (originOf(req) !== 'routine') return 'lavoro tuo, da questo computer';
    var num = String((req && req.num) || '').trim();
    return num ? 'automazione · feedback #' + num : 'automazione';
  }

  /** Cosa spiegare all'owner sulla provenienza, sotto il puntatore. PURA. */
  function originHint(req) {
    return originOf(req) === 'routine'
      ? 'Questo ramo l’ha scritto un’automazione partendo da una segnalazione: guarda cosa è stato bloccato prima di approvarlo.'
      : 'Questo ramo l’hai scritto tu su questo computer.';
  }

  /** Un blocco, in una riga leggibile. PURA. Un blocco senza frase si NOMINA lo stesso. */
  function blockLabel(block) {
    var b = block || {};
    var label = String(b.label || '').trim();
    if (label) return label;
    var gate = String(b.gate || '').trim();
    return gate ? 'Controllo di sicurezza scattato (' + gate + ')' : 'Controllo di sicurezza scattato';
  }

  /** I dettagli di un blocco (percorsi toccati, righe). PURA. */
  function blockItems(block) {
    var b = block || {};
    var items = Array.isArray(b.items) ? b.items.map(String) : [];
    var more = Math.max(0, Math.floor(Number(b.more) || 0));
    if (more > 0) items = items.concat(['… e altri ' + more]);
    return items;
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
      ? 'Il lavoro resta fermo e la segnalazione torna a te.'
      : 'Rilancia npm run finish.';
  }

  /**
   * L'esito di un'approvazione, detto all'owner. PURA.
   *
   * Vale la stessa regola delle bolle di chat: mai il motivo tecnico lasciato
   * lì da interpretare, sempre cosa è successo e cosa fare adesso.
   */
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
    if (r.result === 'merged') return { kind: 'ok', text: 'Fatto: il lavoro è su main' + (r.sha ? ' (' + shortSha(r.sha) + ')' : '') + '.' };
    if (r.result === 'conflict') {
      return {
        kind: 'warn',
        text: originOf(req) === 'routine'
          ? 'Main è andato avanti e le modifiche non si incastrano da sole: serve un giro nuovo dell’automazione.'
          : 'Main è andato avanti e le modifiche non si incastrano da sole: rifai la base del ramo e rilancia npm run finish.',
      };
    }
    if (r.result === 'stale') return { kind: 'warn', text: 'Il ramo è andato avanti dopo i controlli: la richiesta decade. ' + retry };
    if (r.result === 'discarded') return { kind: 'ok', text: 'Scartata.' };
    return { kind: 'warn', text: 'Esito inatteso: nessuna fusione è avvenuta.' };
  }

  // ── Costruzione (DOM) ─────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
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
    // Da dove viene il lavoro, PRIMA del resto: le due provenienze stanno nello
    // stesso elenco, e chi approva deve sapere subito quale delle due sta
    // guardando.
    var origin = el('span', 'sn-mac-origin', originLabel(req));
    origin.title = originHint(req);
    head.appendChild(origin);
    head.appendChild(el('span', 'sn-mac-branch', req.branch || '(ramo sconosciuto)'));
    var sha = el('span', 'sn-mac-sha', shortSha(req.sha));
    sha.title = 'Il commit esaminato: ' + String(req.sha || '');
    head.appendChild(sha);
    // Chi ha chiesto: il dato arriva dal server e senza di lui la separazione
    // fra chi chiede e chi approva resta a metà.
    var who = el('span', 'sn-mac-who', requestedBy(req.who, req));
    who.title = 'La richiesta è arrivata con questa identità; approvarla è un gesto tuo, qui.';
    head.appendChild(who);
    var when = el('span', 'sn-mac-when', timeAgo(req.createdAtMs, now));
    head.appendChild(when);
    var exp = el('span', 'sn-mac-expiry', expiresIn(req.expiresAtMs, now));
    // Anche il suggerimento sotto il puntatore deve sapere di chi è il lavoro:
    // mandare l'owner a lanciare la pubblicazione locale per un ramo scritto da
    // un'automazione è un consiglio che non porta a niente.
    exp.title = 'Vale per il commit esaminato e per un giorno. Passata la scadenza, ' + lowerFirst(howToRetry(req));
    head.appendChild(exp);
    card.appendChild(head);

    var blocks = Array.isArray(req.blocks) ? req.blocks : [];
    if (blocks.length) {
      card.appendChild(el('p', 'sn-mac-why', 'Bloccata perché:'));
      var ul = el('ul', 'sn-mac-blocks');
      for (var i = 0; i < blocks.length; i++) {
        var li = el('li', 'sn-mac-block');
        li.appendChild(el('span', 'sn-mac-block-label', blockLabel(blocks[i])));
        var items = blockItems(blocks[i]);
        if (items.length) li.appendChild(el('span', 'sn-mac-block-items', items.join(' · ')));
        ul.appendChild(li);
      }
      card.appendChild(ul);
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
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    }
    function setBusy(on) {
      approveBtn.disabled = !!on;
      discardBtn.disabled = !!on;
      card.classList.toggle('is-busy', !!on);
    }
    function say(msg) {
      if (!msg) { status.hidden = true; status.textContent = ''; return; }
      status.hidden = false;
      status.textContent = msg.text;
      status.dataset.kind = msg.kind;
    }

    approveBtn.addEventListener('click', function () {
      if (!armed) {
        // Conferma sul posto: un click solo non manda niente su main.
        armed = true;
        approveBtn.textContent = 'Confermi?';
        approveBtn.classList.add('is-armed');
        armTimer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      setBusy(true);
      say({ kind: 'wait', text: 'Chiedo al server di fondere…' });
      Promise.resolve(o.onApprove ? o.onApprove(req) : null)
        .then(function (reply) {
          var msg = outcomeMessage(reply, req);
          say(msg);
          if (msg.kind === 'ok' && o.onDone) o.onDone();
          else setBusy(false);
        })
        .catch(function (e) {
          say(outcomeMessage({ ok: false, error: (e && e.message) || String(e) }, req));
          setBusy(false);
        });
    });

    discardBtn.addEventListener('click', function () {
      disarm();
      setBusy(true);
      Promise.resolve(o.onDiscard ? o.onDiscard(req) : null)
        .then(function (reply) {
          var msg = outcomeMessage(reply, req);
          if (msg.kind === 'ok' && o.onDone) { o.onDone(); return; }
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
    card.appendChild(status);
    card.appendChild(actions);
    return card;
  }

  /**
   * Disegna l'avviso dentro `host`.
   *
   * NIENTE RICHIESTE = NIENTE AVVISO: `host` resta vuoto e nascosto. È la
   * condizione che tiene la prima schermata pulita per chi non ha nulla in
   * sospeso — cioè quasi sempre, e per chiunque non sia il proprietario.
   *
   * @returns {number} quante richieste sono state disegnate
   */
  function render(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var list = Array.isArray(o.requests) ? o.requests : [];
    host.replaceChildren();
    host.hidden = list.length === 0;
    if (!list.length) return 0;

    var box = el('section', 'sn-mac');
    box.setAttribute('aria-label', 'Fusioni in attesa di approvazione');

    var title = el('div', 'sn-mac-title');
    var ico = el('span', 'sn-mac-ico');
    var icons = global.SN_ICONS;
    ico.innerHTML = (icons && typeof icons.lock === 'function') ? icons.lock(18) : '';
    title.appendChild(ico);
    title.appendChild(el('span', 'sn-mac-title-text', headline(list.length)));
    box.appendChild(title);

    var intro = el('p', 'sn-mac-intro',
      'I controlli di sicurezza del server le hanno fermate perché toccano parti protette. '
      + 'Approvarle da qui è l’unica strada: il terminale, da solo, non può.');
    box.appendChild(intro);

    for (var i = 0; i < list.length; i++) box.appendChild(buildCard(list[i], o));
    host.appendChild(box);
    return list.length;
  }

  /**
   * Le decisioni passate, in righe minute. Traccia dell'eccezione: un'apertura
   * di questo tipo che non lascia segno non è verificabile.
   * Vive SOLO nella pagina di gestione — sulla prima schermata sarebbe rumore.
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
      var esito = r.outcome === 'merged' ? 'approvata e fusa'
        : r.outcome === 'conflict' ? 'approvata, ma in conflitto'
          : r.discarded ? 'scartata'
            : r.used ? 'approvata'
              : 'scaduta senza risposta';
      var li = el('li', 'sn-mac-recent-row');
      li.appendChild(el('span', 'sn-mac-recent-origin', originLabel(r)));
      li.appendChild(el('span', 'sn-mac-recent-branch', r.branch || '—'));
      li.appendChild(el('span', 'sn-mac-recent-what', esito));
      // La traccia serve a rispondere a "chi, cosa, quando": senza il chi
      // risponde a due domande su tre.
      li.appendChild(el('span', 'sn-mac-recent-who', requestedBy(r.who, r)));
      li.appendChild(el('span', 'sn-mac-recent-when', timeAgo(r.decidedAtMs || r.expiresAtMs, now)));
      li.dataset.outcome = esito;
      ul.appendChild(li);
    }
    host.appendChild(ul);
    return list.length;
  }

  global.SN_MERGE_APPROVALS = {
    shortSha: shortSha,
    timeAgo: timeAgo,
    expiresIn: expiresIn,
    headline: headline,
    requestedBy: requestedBy,
    originOf: originOf,
    originLabel: originLabel,
    originHint: originHint,
    howToRetry: howToRetry,
    blockLabel: blockLabel,
    blockItems: blockItems,
    outcomeMessage: outcomeMessage,
    render: render,
    renderRecent: renderRecent,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
