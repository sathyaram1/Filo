// Bacheca utente di Filo (filo://board/, DC1 + DC2).
//
// Superficie a PERMESSI RIDOTTI, NON owner-gated: gli anonimi leggono, per
// votare serve il login. Mostra SOLO i miglioramenti già IN PRODUZIONE (fix
// chiusi e usciti in una versione rilasciata, DB3) in chiave POSITIVA. Il
// red-team resta invisibile: ZERO info di sicurezza (niente stato, priorità,
// verdetti dei giudici, pipeline, mittente, orario, testo grezzo). L'unico
// contenuto mostrato è il TITOLO breve già generato (`name`) — mai il testo
// libero (che è cifrato e può contenere dettagli tecnici/personali) né nulla
// che provenga dal pipeline di sicurezza.
//
// La struttura dati dei voti (works/broken per uid) è DB4; il filtro "in
// produzione + niente blocchi" è la pura `SN_MANAGE_REVIEW.listBoardTab`.
// Il voto (DC2) persiste su Firestore tramite l'handler IPC BOARD_CAST_VOTE/
// BOARD_CLEAR_VOTE: il main allega l'ID token del votante (mai esposto qui) e
// premia +10 crediti una sola volta per feedback per utente (anti-doppio-
// premio nel credit store). Il conteggio mostrato è il tally REALE ritornato
// dal main dopo la scrittura, non solo l'aggiornamento ottimistico locale.

(function () {
  'use strict';

  const FB = window.SN_FEEDBACK;
  const MR = window.SN_MANAGE_REVIEW;

  const bdAuthMsg = document.getElementById('bdAuthMsg');
  const bdSignIn  = document.getElementById('bdSignIn');
  const bdLoading = document.getElementById('bdLoading');
  const bdEmpty   = document.getElementById('bdEmpty');
  const bdError   = document.getElementById('bdError');
  const bdErrorMsg = document.getElementById('bdErrorMsg');
  const bdRetry   = document.getElementById('bdRetry');
  const bdList    = document.getElementById('bdList');

  // Timeout della fetch dei miglioramenti: senza limite, offline la richiesta
  // resta muta ~13 s prima che il sistema la lasci cadere. Arrendersi prima e
  // mostrare l'errore è meno attrito che aspettare al buio (filo_design: l'attesa
  // muta è attrito).
  const LOAD_TIMEOUT_MS = 8000;

  // ── Stato ──────────────────────────────────────────────────────────────
  let signedIn = false;
  let uid = null;               // uid Firebase REALE (claim id token), per votes.<uid>
  let allFeedbacks = [];
  let releasedVersion = '';
  const pending = new Set();    // id feedback con voto in volo (IPC), per disabilitare i pulsanti
  let openReopenAfterLogin = null; // id del fix il cui form "Ancora rotto?" va riaperto dopo un login riuscito

  function sendToMain(msg) {
    if (window.filo?.message)                return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // ── Auth (anonimi leggono; per votare serve login) ──────────────────────
  // `uid` è il claim Firebase REALE (request.auth.uid nelle Firestore rules),
  // non l'email: è la chiave con cui i voti sono salvati in `votes.<uid>` (DB4).
  // Senza questo, dopo un reload "il mio voto" non si riconoscerebbe più
  // (i voti salvati sono sempre per uid reale, mai per email).
  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      signedIn = !!(r && r.signedIn);
      uid = (r && r.uid) || null;
    } catch (_) {
      signedIn = false; uid = null;
    }
    reflectAuth();
  }

  function reflectAuth() {
    if (signedIn) {
      bdAuthMsg.textContent = 'Sei connesso: vota i miglioramenti qui sotto.';
      bdSignIn.hidden = true;
    } else {
      bdAuthMsg.textContent = 'Accedi per votare i miglioramenti.';
      bdSignIn.hidden = false;
    }
  }

  bdSignIn.addEventListener('click', () => {
    sendToMain({ type: 'auth_signin' })
      .then(() => refreshAuth())
      .then(() => renderList())
      .catch(() => {});
  });

  // ── Titolo SICURO di un miglioramento ───────────────────────────────────
  // Solo il titolo breve già generato (`name`). Mai il testo grezzo (cifrato /
  // potenzialmente tecnico). Se manca, un'etichetta neutra col numero.
  function safeTitle(fb) {
    const name = (fb && typeof fb.name === 'string') ? fb.name.trim() : '';
    if (name) return name;
    const num = FB.formatNum(fb && fb.seq, fb && fb.subSeq);
    return num ? `Miglioramento #${num}` : 'Miglioramento';
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function renderList() {
    const items = MR.listBoardTab(allFeedbacks, { releasedVersion });
    bdLoading.hidden = true;
    if (bdError) bdError.hidden = true;
    bdList.innerHTML = '';

    if (!items.length) {
      bdEmpty.hidden = false;
      bdList.hidden = true;
      return;
    }
    bdEmpty.hidden = true;
    bdList.hidden = false;

    for (const fb of items) {
      bdList.appendChild(renderCard(fb));
    }
  }

  function renderCard(fb) {
    const card = document.createElement('div');
    card.className = 'bd-card';
    card.dataset.id = fb._id || '';

    const main = document.createElement('div');
    main.className = 'bd-card-main';
    const title = document.createElement('div');
    title.className = 'bd-card-title';
    title.textContent = safeTitle(fb);
    main.appendChild(title);
    const num = FB.formatNum(fb.seq, fb.subSeq);
    if (num) {
      const sub = document.createElement('div');
      sub.className = 'bd-card-sub';
      sub.textContent = `#${num}`;
      main.appendChild(sub);
    }
    card.appendChild(main);

    card.appendChild(renderVote(fb));

    const reopen = renderReopen(fb);
    if (reopen) card.appendChild(reopen);

    return card;
  }

  // ── Riapertura a pagamento (DC4) ────────────────────────────────────────
  // Link discreto "Ancora rotto?" sotto i voti: apre un piccolo form inline
  // (textarea + invia) invece di un prompt nativo, per restare nel tema di
  // Filo (vedi PATTERNS.md — niente window.prompt). Non mostrato se l'utente
  // ha già chiesto la riapertura di QUESTO fix (reopenRequests non vuoto):
  // l'eventuale ❌ è già stata raccolta nei voti, e la riapertura è UNA volta
  // sola per fix (vedi guard SN_MANAGE_REVIEW.canReopen), non per voto.
  function renderReopen(fb) {
    if (MR.hasReopenRequest(fb)) {
      const done = document.createElement('div');
      done.className = 'bd-reopen-done';
      done.textContent = 'Hai già segnalato che questo fix non funziona ancora.';
      return done;
    }

    const wrap = document.createElement('div');
    wrap.className = 'bd-reopen';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'bd-reopen-link';
    link.textContent = 'Ancora rotto?';

    const form = document.createElement('div');
    form.className = 'bd-reopen-form';
    const reopenAfterLogin = openReopenAfterLogin === fb._id;
    form.hidden = !reopenAfterLogin;

    const hint = document.createElement('p');
    hint.className = 'bd-reopen-hint';
    hint.textContent = `Spiega cosa non funziona ancora. Costa ${SN_CONST.CREDIT.BOARD_REOPEN} crediti, per evitare segnalazioni a caso.`;

    const textarea = document.createElement('textarea');
    textarea.className = 'bd-reopen-text';
    textarea.placeholder = 'Cosa succede ancora?';
    textarea.maxLength = 2000;

    const actions = document.createElement('div');
    actions.className = 'bd-reopen-actions';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Invia';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Annulla';
    cancelBtn.className = 'bd-reopen-cancel';
    actions.appendChild(sendBtn);
    actions.appendChild(cancelBtn);

    const err = document.createElement('p');
    err.className = 'bd-reopen-err';
    err.hidden = true;

    form.appendChild(hint);
    form.appendChild(textarea);
    form.appendChild(err);
    form.appendChild(actions);

    // Se l'utente non è ancora autenticato, l'intenzione (aprire il form "Ancora
    // rotto?") non va persa: dopo un login riuscito `renderList()` ricrea il DOM,
    // quindi segniamo l'id del fix in `openReopenAfterLogin` e lo controlliamo
    // in `renderReopen` alla ricostruzione, per riaprire il form da solo.
    link.addEventListener('click', () => {
      if (!signedIn || !uid) {
        openReopenAfterLogin = fb._id;
        sendToMain({ type: 'auth_signin' })
          .then((r) => refreshAuth().then(() => r))
          .then((r) => {
            // `openReopenAfterLogin` resta impostato fino a QUESTO render finale
            // (i render intermedi innescati da refreshAuth/AUTH_CHANGED non lo
            // devono consumare prima del tempo, altrimenti il form si richiude
            // subito dopo essersi aperto): se il login non è riuscito lo si
            // azzera PRIMA di ridisegnare, altrimenti resta impostato per
            // questo render (che apre il form) e viene azzerato subito dopo.
            const ok = !!(r && r.ok && signedIn && uid);
            if (!ok) openReopenAfterLogin = null;
            renderList();
            if (ok) openReopenAfterLogin = null;
          })
          .catch(() => { openReopenAfterLogin = null; renderList(); });
        return;
      }
      form.hidden = !form.hidden;
      if (!form.hidden) textarea.focus();
    });
    cancelBtn.addEventListener('click', () => {
      form.hidden = true;
      err.hidden = true;
      textarea.value = '';
    });
    sendBtn.addEventListener('click', () => onReopen(fb, textarea, sendBtn, err));

    wrap.appendChild(link);
    wrap.appendChild(form);

    // Form riaperto da solo dopo il login: sposta il focus sulla textarea
    // appena il nodo è nel DOM (subito dopo renderList l'ha già inserito).
    if (reopenAfterLogin) {
      requestAnimationFrame(() => { try { textarea.focus(); } catch (_) {} });
    }

    return wrap;
  }

  // Invio della riapertura: scala crediti + crea il feedback collegato lato
  // main (BOARD_REOPEN). Bottone disabilitato durante l'invio; errore mostrato
  // inline (testo vuoto, saldo insufficiente, fix già riaperto, sessione
  // scaduta…). A successo il link/form scompare e compare la conferma — niente
  // duplicati possibili senza ricaricare la pagina.
  function onReopen(fb, textarea, sendBtn, errEl) {
    const text = textarea.value.trim();
    errEl.hidden = true;
    if (!text) {
      errEl.textContent = 'Scrivi cosa non funziona ancora.';
      errEl.hidden = false;
      return;
    }
    const id = fb._id;
    if (!id || pending.has(`reopen:${id}`)) return;
    pending.add(`reopen:${id}`);
    sendBtn.disabled = true;

    sendToMain({ type: 'board_reopen', id, text })
      .then((r) => {
        if (r && r.ok) {
          fb.reopenRequests = { ...(fb.reopenRequests || {}), [uid]: { at: new Date().toISOString() } };
          renderList();
        } else {
          errEl.textContent = (r && r.error) || 'Invio non riuscito, riprova.';
          errEl.hidden = false;
          sendBtn.disabled = false;
        }
      })
      .catch(() => {
        errEl.textContent = 'Invio non riuscito, riprova.';
        errEl.hidden = false;
        sendBtn.disabled = false;
      })
      .finally(() => { pending.delete(`reopen:${id}`); });
  }

  function renderVote(fb) {
    const tally = FB.tallyVotes(fb.votes);
    const mine = uid ? FB.userVote(fb.votes, uid) : null;
    const busy = pending.has(fb._id);

    const wrap = document.createElement('div');
    wrap.className = 'bd-vote';

    const works = mkVoteBtn('works', '✅', tally.works, mine === 'works', fb, busy);
    const broken = mkVoteBtn('broken', '❌', tally.broken, mine === 'broken', fb, busy);
    wrap.appendChild(works);
    wrap.appendChild(broken);
    return wrap;
  }

  function mkVoteBtn(vote, glyph, count, pressed, fb, busy) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bd-vote-btn bd-vote-${vote}`;
    btn.dataset.vote = vote;
    btn.disabled = !!busy;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.setAttribute('aria-label', vote === 'works' ? 'Funziona' : 'Non funziona');
    btn.innerHTML = `<span aria-hidden="true">${glyph}</span><span class="bd-vote-count">${count}</span>`;
    btn.addEventListener('click', () => onVote(fb, vote, btn));
    return btn;
  }

  // Voto: anonimo → invito al login; loggato → scrive su Firestore tramite il
  // main (BOARD_CAST_VOTE/BOARD_CLEAR_VOTE, DC2), che allega l'idToken del
  // votante e accredita +10 crediti una sola volta per feedback per utente.
  // Aggiornamento ottimistico locale per reattività immediata, poi sostituito
  // dal tally REALE che il main rilegge da Firestore dopo la scrittura.
  //
  // Se l'utente non è ancora autenticato, il voto scelto NON va perso: dopo un
  // login riuscito il flusso riprende da solo e il voto viene eseguito subito
  // (niente secondo click). `renderList()` ricrea il DOM (perde `btn`), quindi
  // il retry richiama onVote con l'`fb` fresco preso dalla lista ricreata.
  function onVote(fb, vote, btn) {
    if (!signedIn || !uid) {
      sendToMain({ type: 'auth_signin' })
        .then((r) => refreshAuth().then(() => r))
        .then((r) => {
          renderList();
          if (r && r.ok && signedIn && uid) {
            const freshFb = allFeedbacks.find((x) => x._id === fb._id) || fb;
            onVote(freshFb, vote, null);
          }
        })
        .catch(() => {});
      return;
    }
    const id = fb._id;
    if (!id || pending.has(id)) return;

    // Ottimistico: ri-cliccare la propria scelta la annulla (toggle).
    const prevVotes = (fb.votes && typeof fb.votes === 'object') ? fb.votes : {};
    const current = FB.userVote(prevVotes, uid);
    const clearing = current === vote;
    const optimistic = { ...prevVotes };
    if (clearing) {
      delete optimistic[uid];
    } else {
      optimistic[uid] = { vote, at: new Date().toISOString(), credibilitySnapshot: 1 };
    }
    fb.votes = optimistic;
    pending.add(id);
    renderList();

    const originRect = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
    const msg = clearing
      ? { type: 'board_clear_vote', id }
      : { type: 'board_cast_vote', id, vote };

    sendToMain(msg)
      .then((r) => {
        if (r && r.ok) {
          // Tally autorevole dal server: sostituisce l'ottimistico (può
          // includere voti di altri utenti arrivati nel frattempo).
          fb.votes = (r.votes && typeof r.votes === 'object') ? r.votes : fb.votes;
          if (r.uid) uid = r.uid;
          if (r.awarded && r.credits) flyCreditsFromButton(originRect, r.credits);
        } else {
          // Errore: torna allo stato precedente al click.
          fb.votes = prevVotes;
        }
      })
      .catch(() => { fb.votes = prevVotes; })
      .finally(() => {
        pending.delete(id);
        renderList();
      });
  }

  // ── Animazione ricompensa crediti ───────────────────────────────────────
  // Variante locale alla bacheca (pagina senza icona account in vista): vola
  // dal pulsante di voto verso l'angolo in alto a destra. Stesso spirito di
  // flyCredits (content/feedback.js) e flyCreditsToAccount (dashboard.js).
  // Decorativa, best-effort, rispetta prefers-reduced-motion.
  function flyCreditsFromButton(originRect, amount) {
    try {
      const n = Math.max(1, Math.round(Number(amount) || 0));
      const reduce = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      const r = originRect && originRect.width
        ? originRect
        : { left: window.innerWidth / 2 - 20, top: window.innerHeight - 80, width: 40, height: 40 };
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      const tx = Math.max(24, window.innerWidth - 26);
      const ty = 26;
      const GOLD = '#e0a93f';

      const layer = document.createElement('div');
      layer.className = 'bd-credit-fly';
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        pointerEvents: 'none', overflow: 'hidden',
      });
      document.body.appendChild(layer);

      const label = document.createElement('div');
      label.textContent = `+${n}`;
      Object.assign(label.style, {
        position: 'fixed', left: ox + 'px', top: (oy - 8) + 'px',
        font: '700 16px system-ui, sans-serif', color: GOLD,
        textShadow: '0 1px 3px rgba(0,0,0,.45)', whiteSpace: 'nowrap',
      });
      layer.appendChild(label);
      try {
        label.animate(
          [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-22px)', opacity: 0 }],
          { duration: 900, easing: 'ease-out', fill: 'forwards' }
        );
      } catch (_) {}

      let maxEnd = 900;
      if (!reduce) {
        const coinSvg = (window.SN_ICONS?.credits?.(20)) || '●';
        const count = Math.min(7, Math.max(4, n));
        for (let i = 0; i < count; i++) {
          const c = document.createElement('div');
          c.innerHTML = coinSvg;
          Object.assign(c.style, {
            position: 'fixed', left: '0', top: '0', width: '20px', height: '20px',
            color: GOLD, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
            willChange: 'transform, opacity',
          });
          layer.appendChild(c);
          const sx = ox + (Math.random() - 0.5) * 60;
          const sy = oy + (Math.random() - 0.5) * 20;
          const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 60;
          const my = Math.min(sy, ty) - 40 - Math.random() * 40;
          const delay = i * 40;
          const dur = 650 + i * 50 + Math.random() * 120;
          maxEnd = Math.max(maxEnd, delay + dur);
          try {
            c.animate([
              { transform: `translate(${sx}px,${sy}px) scale(.6)`, opacity: 0 },
              { transform: `translate(${mx}px,${my}px) scale(1.05)`, opacity: 1, offset: 0.5 },
              { transform: `translate(${tx}px,${ty}px) scale(.45)`, opacity: 0 },
            ], { duration: dur, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
          } catch (_) {}
        }
      }
      setTimeout(() => { try { layer.remove(); } catch (_) {} }, maxEnd + 200);
    } catch (_) {}
  }

  // ── Caricamento ─────────────────────────────────────────────────────────
  // Stato d'errore, DISTINTO dal vuoto: se la fetch fallisce (niente rete, rete
  // caduta) mostriamo un messaggio comprensibile + "Riprova", invece di ripiegare
  // su "Nessun miglioramento…" — che direbbe il falso (i miglioramenti ci sono,
  // solo non scaricati). Riusa SN_CHAT_ERRORS (stesso pattern delle chat): frase
  // per l'utente, mai il messaggio grezzo dell'eccezione.
  function showLoadError(err) {
    bdLoading.hidden = true;
    bdList.hidden = true;
    bdEmpty.hidden = true;
    if (!bdError || !bdErrorMsg) return;
    const msg = (window.SN_CHAT_ERRORS && SN_CHAT_ERRORS.sentence)
      ? SN_CHAT_ERRORS.sentence(err)
      : 'Non è stato possibile caricare i miglioramenti: controlla la connessione e riprova.';
    bdErrorMsg.textContent = msg;
    bdError.hidden = false;
    if (bdRetry) bdRetry.disabled = false;
  }

  async function loadData() {
    bdLoading.hidden = false;
    bdList.hidden = true;
    bdEmpty.hidden = true;
    if (bdError) bdError.hidden = true;

    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* senza versione il gate è inattivo: done→bacheca come prima */ }
    }

    try {
      allFeedbacks = await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: LOAD_TIMEOUT_MS });
    } catch (err) {
      // Il caricamento è FALLITO: non fingere "lista vuota". Mostra l'errore con
      // il tasto Riprova e fermati qui (renderList mostrerebbe #bdEmpty).
      console.error('[board] errore caricamento:', err);
      showLoadError(err);
      return;
    }
    // renderList nasconde sempre il loader (anche a lista vuota), così la pagina
    // raggiunge uno stato stabile a fine caricamento.
    renderList();
  }

  // "Riprova": ritenta il caricamento (il tasto si disabilita mentre è in volo,
  // così un doppio click non lancia due fetch). loadData rimette a posto loader/
  // stato a ogni giro.
  if (bdRetry) {
    bdRetry.addEventListener('click', () => {
      bdRetry.disabled = true;
      loadData();
    });
  }

  async function init() {
    await refreshAuth();
    await loadData();
  }

  // ── Hook di test (Playwright) — inerte in produzione ────────────────────
  window.__boardTest = {
    setData(fbs) { allFeedbacks = Array.isArray(fbs) ? fbs : []; renderList(); },
    setSignedIn(email) { signedIn = !!email; uid = email || null; reflectAuth(); renderList(); },
    setReleasedVersion(v) { releasedVersion = v || ''; renderList(); },
    // Rilancia il caricamento reale (loadData): usato dai test per esercitare il
    // cammino d'errore (FB.list che rigetta → stato d'errore) e il retry, senza
    // dover simulare la rete davvero assente.
    reload() { return loadData(); },
    // Sostituisce la sorgente dati usata da loadData con una funzione di test
    // (che risolve o rigetta). Va scritta sulla stessa reference `FB` che
    // loadData usa: su pagine filo:// `window.SN_FEEDBACK` può essere una vista
    // diversa da quella catturata qui, quindi i test non possono affidarsi a
    // rimpiazzare `window.SN_FEEDBACK.list`.
    setList(fn) { if (typeof fn === 'function') FB.list = fn; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
