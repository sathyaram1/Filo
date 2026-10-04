// Le fusioni bloccate si approvano anche da un browser qualunque (#489): la via d'uscita quando Filo non parte.
// Stessa identità, stessa chiamata del server e stesse card dell'app; non tiene credenziali su disco, non prende
// l'indirizzo del server da fuori e non si disegna dentro un riquadro altrui. Regole: tests/unit/approvazioniWeb.test.mjs.

(function (global) {
  'use strict';

  // Il progetto dell'app (src/main/auth/config.js): il server riconosce l'owner dall'account, non dalla superficie.
  var FIREBASE = Object.freeze({
    apiKey: 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY',
    authDomain: 'filo-8b9cb.firebaseapp.com',
    projectId: 'filo-8b9cb',
  });
  var FUNZIONE = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerMergeApprovals';
  var OGNI_MS = 60 * 1000;

  /** Un errore della chiamata al server, detto all'owner. PURA. */
  function fraseErrore(e) {
    var v = e || {};
    var codice = String(v.codice || '').toUpperCase();
    var dettaglio = String(v.dettaglio || '').trim();
    if (v.rete) return 'Il server non risponde: controlla la connessione e riprova.';
    if (codice === 'PERMISSION_DENIED') return 'Questo account non è quello del proprietario: esci e accedi con quello giusto.';
    if (codice === 'UNAUTHENTICATED') return 'Sessione scaduta: esci e rifai l’accesso.';
    if (Number(v.http) === 404) return 'Il server non espone le approvazioni: vanno rideployate le funzioni di sicurezza.';
    // Le frasi di rifiuto del server (scaduta, già usata…) sono già scritte per l'owner.
    if (dettaglio) return dettaglio;
    if (v.http) return 'Il server ha risposto con un errore ' + v.http + '.';
    return String(v.message || '') || 'Non riuscito.';
  }

  /** Un accesso a Google non riuscito, detto all'owner; '' quando l'ha chiuso lui. PURA. */
  function fraseAccesso(codice) {
    switch (String(codice || '')) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
      case 'auth/user-cancelled':
        return '';
      case 'auth/popup-blocked':
        return 'Il browser ha bloccato la finestra dell’accesso: consentila per questa pagina e riprova.';
      case 'auth/network-request-failed':
        return 'Google non risponde: controlla la connessione e riprova.';
      case 'auth/unauthorized-domain':
        return 'Da questo indirizzo l’accesso non è autorizzato: apri la pagina da https://filo-8b9cb.web.app.';
      case 'auth/operation-not-allowed':
        return 'L’accesso con Google non è attivo sul progetto di Filo.';
      default:
        return 'Accesso non riuscito' + (codice ? ' (' + codice + ')' : '') + ': riprova.';
    }
  }

  /** L'impronta di un elenco: se non cambia non si ridisegna, e una conferma a metà resta dov'è. PURA. */
  function impronta(r) {
    var v = r || {};
    function righe(l) {
      return (Array.isArray(l) ? l : []).map(function (x) {
        var y = x || {};
        return [y.id, y.sha, y.used ? 1 : 0, y.discarded ? 1 : 0, y.outcome || '', y.expiresAtMs || 0, y.decidedAtMs || 0].join(':');
      }).join(',');
    }
    return [righe(v.pending), righe(v.failed), righe(v.recent)].join('|');
  }

  /** Quello che il server ha risposto a un sì o a uno scarto, nella forma che le card sanno leggere. PURA. */
  function rispostaPerCard(r) {
    if (r && r.ok === false) return { ok: false, error: String(r.detail || r.reason || 'Non è riuscita.') };
    return r || { ok: false, error: 'Il server non ha risposto.' };
  }

  function avvia() {
    var doc = global.document;
    var q = function (sel) { return doc.querySelector(sel); };
    var el = {
      account: q('.ap-account'), email: q('.ap-email'), aggiorna: q('.ap-aggiorna'), esci: q('.ap-esci'),
      accesso: q('.ap-accesso'), accedi: q('.ap-accedi'), stato: q('.ap-stato'),
      fusioni: q('.ap-fusioni'), vuoto: q('.ap-vuoto'), recenti: q('.ap-recenti'),
    };

    function dici(testo, tipo) {
      el.stato.hidden = !testo;
      el.stato.textContent = testo || '';
      if (tipo) el.stato.dataset.kind = tipo; else delete el.stato.dataset.kind;
    }

    // Un'altra pagina che ci incornicia potrebbe far cliccare «Approva» a chi non la vede: qui non si disegna niente.
    if (global.top !== global.self) {
      doc.body.replaceChildren();
      return;
    }
    var UI = global.SN_MERGE_APPROVALS;
    var fb = global.firebase;
    if (!UI || !fb || typeof fb.initializeApp !== 'function' || typeof fb.auth !== 'function') {
      dici('La pagina non si è caricata per intero: ricaricala.', 'err');
      return;
    }
    var icone = global.SN_ICONS;
    if (icone && typeof icone.reload === 'function') el.aggiorna.innerHTML = icone.reload(16);

    fb.initializeApp(FIREBASE);
    var auth = fb.auth();
    // In memoria e basta: chiusa la scheda non resta niente che un programma sul computer possa riusare.
    var pronto = Promise.resolve(auth.setPersistence(fb.auth.Auth.Persistence.NONE)).catch(function () {});

    var s = { utente: null, inLettura: false, ancora: false, forza: false, impronta: null, esiti: new Map() };

    function svuota() {
      s.impronta = null;
      s.esiti.clear();
      el.fusioni.replaceChildren(); el.fusioni.hidden = true;
      el.recenti.replaceChildren(); el.recenti.hidden = true;
      el.vuoto.hidden = true;
    }

    async function chiama(op, id) {
      var u = s.utente;
      if (!u) throw { codice: 'UNAUTHENTICATED' };
      var token = await u.getIdToken();
      var res;
      try {
        res = await global.fetch(FUNZIONE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ data: id ? { op: op, id: String(id) } : { op: op } }),
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch (_) {
        throw { rete: true };
      }
      var corpo = null;
      try { corpo = await res.json(); } catch (_) {}
      if (!res.ok) {
        var err = (corpo && corpo.error) || {};
        throw { http: res.status, codice: err.status, dettaglio: err.message };
      }
      return corpo ? corpo.result : null;
    }

    function disegna(r) {
      var imp = impronta(r);
      var occupata = el.fusioni.querySelector('.is-armed, .is-busy');
      if (!s.forza && (imp === s.impronta || occupata)) return;
      s.forza = false;
      s.impronta = imp;
      var vive = new Set((r.pending || []).concat(r.failed || []).map(function (x) { return x && x.id; }));
      s.esiti.forEach(function (_v, id) { if (!vive.has(id)) s.esiti.delete(id); });
      var n = UI.render(el.fusioni, {
        requests: r.pending || [],
        failed: r.failed || [],
        onApprove: function (req) { return decidi('approve', req); },
        onDiscard: function (req) { return decidi('discard', req); },
        onDone: function () { global.setTimeout(function () { leggi({ forza: true }); }, 1200); },
        esitoIniziale: function (req) { return s.esiti.get(req.id) || null; },
      });
      el.vuoto.hidden = n > 0;
      UI.renderRecent(el.recenti, { recent: r.recent || [] });
    }

    async function decidi(op, req) {
      var risposta;
      try {
        risposta = rispostaPerCard(await chiama(op, req.id));
      } catch (e) {
        risposta = { ok: false, error: fraseErrore(e) };
      }
      var msg = UI.outcomeMessage(risposta, req);
      s.esiti.set(req.id, msg);
      // La card di una fusione riuscita sparisce alla rilettura: l'esito resta scritto in cima.
      if (op === 'approve' && (msg.kind === 'ok' || msg.reload)) dici((req.branch ? req.branch + ': ' : '') + msg.text, msg.kind);
      return risposta;
    }

    async function leggi(opzioni) {
      if (!s.utente) return;
      if (opzioni && opzioni.forza) s.forza = true;
      if (s.inLettura) { s.ancora = true; return; }
      s.inLettura = true;
      el.aggiorna.classList.add('is-lettura');
      var prima = s.impronta === null;
      if (prima && el.stato.hidden) dici('Leggo le richieste…', 'wait');
      try {
        var r = await chiama('list');
        if (!r || r.ok === false) throw { dettaglio: r && (r.detail || r.reason) };
        if (!s.utente) return;
        if (prima || el.stato.dataset.kind === 'err' || el.stato.dataset.kind === 'wait') dici('');
        disegna(r);
      } catch (e) {
        dici(fraseErrore(e), 'err');
        if (e && String(e.codice || '').toUpperCase() === 'PERMISSION_DENIED') svuota();
      } finally {
        s.inLettura = false;
        el.aggiorna.classList.remove('is-lettura');
        if (s.ancora) { s.ancora = false; leggi(); }
      }
    }

    function disegnaAccount() {
      var u = s.utente;
      el.account.hidden = !u;
      el.accesso.hidden = !!u;
      el.email.textContent = u ? String(u.email || '') : '';
      if (!u) { svuota(); return; }
      leggi({ forza: true });
    }

    auth.onAuthStateChanged(function (u) {
      s.utente = u || null;
      if (!u) dici('');
      disegnaAccount();
    });

    el.accedi.addEventListener('click', async function () {
      if (el.accedi.disabled) return;
      el.accedi.disabled = true;
      dici('');
      try {
        await pronto;
        var provider = new fb.auth.GoogleAuthProvider();
        // La scelta dell'account si vede ogni volta: è il gesto di chi è davanti allo schermo.
        provider.setCustomParameters({ prompt: 'select_account' });
        await auth.signInWithPopup(provider);
      } catch (e) {
        var frase = fraseAccesso(e && e.code);
        if (frase) dici(frase, 'err');
      } finally {
        el.accedi.disabled = false;
      }
    });
    el.esci.addEventListener('click', function () {
      dici('');
      Promise.resolve(auth.signOut()).catch(function () {});
    });
    el.aggiorna.addEventListener('click', function () { leggi({ forza: true }); });

    // Il terminale manda qui l'owner mentre la pagina può essere già aperta: si accorge da sola delle richieste nuove.
    global.addEventListener('focus', function () { leggi(); });
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible') leggi(); });
    global.setInterval(function () { if (doc.visibilityState === 'visible') leggi(); }, OGNI_MS);
  }

  global.SN_APPROVAZIONI_WEB = {
    FUNZIONE: FUNZIONE,
    fraseErrore: fraseErrore,
    fraseAccesso: fraseAccesso,
    impronta: impronta,
    rispostaPerCard: rispostaPerCard,
  };

  if (global.document) avvia();
})(typeof globalThis !== 'undefined' ? globalThis : self);
