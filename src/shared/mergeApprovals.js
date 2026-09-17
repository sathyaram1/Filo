// L'avviso delle fusioni in attesa (SPEC-RIDISEGNO-MAX.md §10): il server apre una
// richiesta invece di rifiutare e l'owner la approva QUI, davanti allo schermo — una
// sessione catturata ha le credenziali, non le mani dell'owner. Le frasi le manda il server.

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

  // Il titolo dell'avviso. Zero richieste → stringa vuota: chi non ne ha non vede niente.
  function headline(count) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n) return '';
    if (n === 1) return 'Una fusione aspetta il tuo via libera';
    return n + ' fusioni aspettano il tuo via libera';
  }

  // Chi ha chiesto la fusione: la superficie esiste per SEPARARE chi chiede da chi approva.
  // Un identificativo tecnico non si stampa: si dice «un accesso senza email». PURA.
  function requestedBy(who, req) {
    var s = String(who == null ? '' : who).trim().slice(0, 120);
    if (!s) return 'chi l’ha chiesta non risulta';
    if (s.indexOf('@') > 0) return 'chiesta da ' + s;
    // Un'automazione un'email non ce l'ha e non l'avrà mai: il server manda il ruolo che stava
    // lavorando, e quello SÌ dice qualcosa a chi decide.
    if (originOf(req) === 'routine') return 'chiesta da ' + s;
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
    if (originOf(req) !== 'routine') return 'lavoro tuo, da questo computer';
    var num = feedbackNum(req);
    return num ? 'automazione · feedback #' + num : 'automazione';
  }

  function originHint(req) {
    return originOf(req) === 'routine'
      ? 'Questo ramo l’ha scritto un’automazione partendo da una segnalazione: guarda cosa è stato bloccato prima di approvarlo.'
      : 'Questo ramo l’hai scritto tu su questo computer.';
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

  // Come si riottiene una richiesta decaduta dipende da CHI l'aveva chiesta: il lavoro locale
  // si ripropone da questo computer, quello di un'automazione torna in attesa. PURA.
  function lowerFirst(text) {
    var s = String(text || '');
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }

  function howToRetry(req) {
    return originOf(req) === 'routine'
      ? 'Il lavoro torna alla routine, che riallinea il ramo e rifà i controlli: poi ti arriva una nuova richiesta da approvare.'
      : 'Rilancia npm run finish.';
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

  // `stale` con `used: true` = richiesta consumata senza fusione: dirla «approvata»
  // racconterebbe una fusione mai avvenuta; con `realigned` è rifatta sulla sola differenza.
  function recentOutcome(r) {
    var v = r || {};
    var ria = !!(v.realigned && typeof v.realigned === 'object');
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
      var base = originOf(req) === 'routine'
        ? 'Main è andato avanti e le modifiche non si incastrano da sole: serve un giro nuovo dell’automazione.'
        : 'Main è andato avanti e le modifiche non si incastrano da sole: rifai la base del ramo e rilancia npm run finish.';
      var tentativo = realignFailureText(r.realignReason);
      return { kind: 'warn', text: tentativo ? base + ' ' + tentativo : base };
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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  // «Approva» è irreversibile (il codice atterra su main): conferma SUL POSTO, e il gesto vale
  // «so cosa c'è in questo ramo». «Scarta» va dritto: la richiesta si rifà con un finish.
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
    if (originOf(req) === 'routine' && feedbackNum(req) && typeof o.onFeedback === 'function') {
      origin = el('button', 'sn-mac-origin sn-mac-origin-link', originLabel(req));
      origin.type = 'button';
      origin.title = 'Apri la segnalazione #' + feedbackNum(req) + ' da cui nasce questo lavoro.';
      origin.addEventListener('click', function () { o.onFeedback(req); });
    } else {
      origin = el('span', 'sn-mac-origin', originLabel(req));
      origin.title = originHint(req);
    }
    head.appendChild(origin);
    head.appendChild(el('span', 'sn-mac-branch', req.branch || '(ramo sconosciuto)'));
    var sha = el('span', 'sn-mac-sha', shortSha(req.sha));
    sha.title = 'Il commit esaminato: ' + String(req.sha || '');
    head.appendChild(sha);
    // Senza chi ha chiesto, la separazione fra chi chiede e chi approva resta a metà.
    var who = el('span', 'sn-mac-who', requestedBy(req.who, req));
    who.title = 'La richiesta è arrivata con questa identità; approvarla è un gesto tuo, qui.';
    head.appendChild(who);
    var when = el('span', 'sn-mac-when', timeAgo(req.createdAtMs, now));
    head.appendChild(when);
    var exp = el('span', 'sn-mac-expiry', expiresIn(req.expiresAtMs, now));
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

    var blocks = Array.isArray(req.blocks) ? req.blocks : [];
    if (blocks.length) {
      card.appendChild(el('p', 'sn-mac-why', nota ? 'Bloccata perché (solo il nuovo):' : 'Bloccata perché:'));
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
          if ((msg.kind === 'ok' || msg.reload) && o.onDone) o.onDone();
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
    if (originOf(req) === 'routine' && feedbackNum(req) && typeof o.onFeedback === 'function') {
      origin = el('button', 'sn-mac-origin sn-mac-origin-link', originLabel(req));
      origin.type = 'button';
      origin.title = 'Apri la segnalazione #' + feedbackNum(req) + ' da cui nasce questo lavoro.';
      origin.addEventListener('click', function () { o.onFeedback(req); });
    } else {
      origin = el('span', 'sn-mac-origin', originLabel(req));
      origin.title = originHint(req);
    }
    head.appendChild(origin);
    head.appendChild(el('span', 'sn-mac-branch', req.branch || '(ramo sconosciuto)'));
    var sha = el('span', 'sn-mac-sha', shortSha(req.sha));
    sha.title = 'Il commit che avevi approvato: ' + String(req.sha || '');
    head.appendChild(sha);
    head.appendChild(el('span', 'sn-mac-who', requestedBy(req.who, req)));
    head.appendChild(el('span', 'sn-mac-when', 'approvata ' + timeAgo(req.decidedAtMs || req.usedAtMs, now)));
    card.appendChild(head);

    var tentativo = realignFailureText(req.realignReason);
    card.appendChild(el('p', 'sn-mac-why',
      'L’avevi approvata, ma la fusione NON è avvenuta: main era andato avanti e le modifiche '
      + 'non si incastrano da sole. ' + (tentativo ? tentativo + ' ' : '') + howToRetry(req)
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
    card.appendChild(status);
    card.appendChild(actions);
    return card;
  }

  function render(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var list = Array.isArray(o.requests) ? o.requests : [];
    var failed = Array.isArray(o.failed) ? o.failed : [];
    host.replaceChildren();
    host.hidden = list.length === 0 && failed.length === 0;
    if (!list.length && !failed.length) return 0;

    // Prima delle richieste in attesa: sono un sì già dato che non ha prodotto niente, e più
    // invecchia più costa accorgersene.
    if (failed.length) {
      var fbox = el('section', 'sn-mac sn-mac-failed');
      fbox.setAttribute('aria-label', 'Fusioni approvate ma non avvenute');
      var ftitle = el('div', 'sn-mac-title');
      var fico = el('span', 'sn-mac-ico');
      var ficons = global.SN_ICONS;
      fico.innerHTML = (ficons && typeof ficons.lock === 'function') ? ficons.lock(18) : '';
      ftitle.appendChild(fico);
      ftitle.appendChild(el('span', 'sn-mac-title-text',
        failed.length === 1
          ? 'Una fusione approvata non è avvenuta'
          : failed.length + ' fusioni approvate non sono avvenute'));
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

      var intro = el('p', 'sn-mac-intro',
        'I controlli di sicurezza del server le hanno fermate perché toccano parti protette. '
        + 'Approvarle da qui è l’unica strada: il terminale, da solo, non può.');
      box.appendChild(intro);

      for (var i = 0; i < list.length; i++) box.appendChild(buildCard(list[i], o));
      host.appendChild(box);
    }
    return list.length + failed.length;
  }

  // Le decisioni passate, in righe minute: senza traccia non sono verificabili. Vivono in
  // Automazioni — fra le cose da decidere sarebbero rumore.
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

  function preapprovedBy(r) {
    var by = String((r && r.preapprovedBy) || '').trim().slice(0, 120);
    return by ? 'pre-approvata da ' + by : 'pre-approvata sulla pratica';
  }

  // Il momento viaggia come testo ISO in ora universale: mostrarlo grezzo era un calcolo per
  // chi legge. '' se manca; se non è una data, il testo com'è (meglio di niente). PURA.
  function preapprovedWhenText(at) {
    var s = String(at || '').trim();
    if (!s) return '';
    var data = dateTimeText(Date.parse(s));
    return 'Segno messo il ' + (data || s);
  }

  // Fusioni avvenute SENZA chiedere: l'owner aveva messo il segno prima, senza leggere. È il
  // controllo a posteriori, quindi ciò che era stato segnalato si mostra PER INTERO.
  function renderPreapproved(host, opts) {
    if (!host) return 0;
    var o = opts || {};
    var now = Number(o.nowMs) || Date.now();
    var list = Array.isArray(o.preapproved) ? o.preapproved : [];
    host.replaceChildren();
    host.hidden = list.length === 0;
    if (!list.length) return 0;
    host.appendChild(el('p', 'sn-mac-recent-title', 'Fuse senza chiedere'));
    var intro = el('p', 'sn-mac-preapproved-intro',
      'Lavori delle automazioni fermati dai controlli e fusi lo stesso, perché sulla pratica avevi detto «fondi senza chiedermelo». '
      + 'Qui c’è tutto quello che era stato segnalato.');
    host.appendChild(intro);
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
      head.appendChild(el('span', 'sn-mac-recent-branch', r.branch || '—'));
      var sha = el('span', 'sn-mac-sha', shortSha(r.mergeSha || r.sha));
      sha.title = 'Il commit esaminato: ' + String(r.sha || '') + (r.mergeSha ? '\nIl commit di fusione: ' + String(r.mergeSha) : '');
      head.appendChild(sha);
      var who = el('span', 'sn-mac-recent-who', preapprovedBy(r));
      if (r.preapprovedAt) who.title = preapprovedWhenText(r.preapprovedAt);
      head.appendChild(who);
      head.appendChild(el('span', 'sn-mac-recent-when', mergedWhenText(r.decidedAtMs || r.createdAtMs, now)));
      li.appendChild(head);
      var blocks = Array.isArray(r.blocks) ? r.blocks : [];
      if (blocks.length) {
        var bl = el('ul', 'sn-mac-blocks');
        for (var j = 0; j < blocks.length; j++) {
          var b = el('li', 'sn-mac-block');
          b.appendChild(el('span', 'sn-mac-block-label', blockLabel(blocks[j])));
          var items = blockItems(blocks[j]);
          if (items.length) {
            // Ogni voce sulla sua riga: qui l'elenco è la cosa da leggere, e cinquanta percorsi in
            // una riga sola non si leggono.
            var il = el('ul', 'sn-mac-block-list');
            for (var k = 0; k < items.length; k++) il.appendChild(el('li', 'sn-mac-block-items', items[k]));
            b.appendChild(il);
          }
          bl.appendChild(b);
        }
        li.appendChild(bl);
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
    recentOutcome: recentOutcome,
    timeAgo: timeAgo,
    expiresIn: expiresIn,
    headline: headline,
    requestedBy: requestedBy,
    originOf: originOf,
    feedbackNum: feedbackNum,
    originLabel: originLabel,
    originHint: originHint,
    howToRetry: howToRetry,
    blockLabel: blockLabel,
    blockItems: blockItems,
    outcomeMessage: outcomeMessage,
    render: render,
    renderRecent: renderRecent,
    preapprovedBy: preapprovedBy,
    preapprovedWhenText: preapprovedWhenText,
    dateTimeText: dateTimeText,
    mergedWhenText: mergedWhenText,
    preapprovedMoreText: preapprovedMoreText,
    renderPreapproved: renderPreapproved,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
