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
  const bdList    = document.getElementById('bdList');

  // ── Stato ──────────────────────────────────────────────────────────────
  let signedIn = false;
  let uid = null;               // uid Firebase REALE (claim id token), per votes.<uid>
  let allFeedbacks = [];
  let releasedVersion = '';
  const pending = new Set();    // id feedback con voto in volo (IPC), per disabilitare i pulsanti

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
    return card;
  }

  function renderVote(fb) {
    const tally = FB.tallyVotes(fb.votes);
    const mine = uid ? FB.userVote(fb.votes, uid) : null;

    const wrap = document.createElement('div');
    wrap.className = 'bd-vote';

    const works = mkVoteBtn('works', '✅', tally.works, mine === 'works', fb);
    const broken = mkVoteBtn('broken', '❌', tally.broken, mine === 'broken', fb);
    wrap.appendChild(works);
    wrap.appendChild(broken);
    return wrap;
  }

  function mkVoteBtn(vote, glyph, count, pressed, fb) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bd-vote-btn bd-vote-${vote}`;
    btn.dataset.vote = vote;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.setAttribute('aria-label', vote === 'works' ? 'Funziona' : 'Non funziona');
    btn.innerHTML = `<span aria-hidden="true">${glyph}</span><span class="bd-vote-count">${count}</span>`;
    btn.addEventListener('click', () => onVote(fb, vote));
    return btn;
  }

  // Voto: anonimo → invito al login; loggato → aggiornamento ottimistico locale
  // del conteggio e della scelta. La persistenza su Firestore + ricompensa di 10
  // crediti sono DC2 (vedi TASKS.md): qui non si scrive ancora sul server.
  function onVote(fb, vote) {
    if (!signedIn || !uid) {
      sendToMain({ type: 'auth_signin' })
        .then(() => refreshAuth())
        .then(() => renderList())
        .catch(() => {});
      return;
    }
    // Toggle locale: ri-cliccare la propria scelta la annulla.
    const votes = (fb.votes && typeof fb.votes === 'object') ? { ...fb.votes } : {};
    const current = FB.userVote(votes, uid);
    if (current === vote) {
      delete votes[uid];
    } else {
      votes[uid] = { vote, at: new Date().toISOString(), credibilitySnapshot: 1 };
    }
    fb.votes = votes;
    renderList();
    // DC2: persistere con FB.castVote/clearVote (idToken via main) + accreditare
    // 10 crediti una sola volta per feedback per utente, con animazione.
  }

  // ── Caricamento ─────────────────────────────────────────────────────────
  async function loadData() {
    bdLoading.hidden = false;
    bdList.hidden = true;
    bdEmpty.hidden = true;

    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* senza versione il gate è inattivo: done→bacheca come prima */ }
    }

    try {
      allFeedbacks = await FB.list({ pageSize: 500 });
    } catch (err) {
      console.error('[board] errore caricamento:', err);
      allFeedbacks = [];
    }
    // renderList nasconde sempre il loader (anche a lista vuota), così la pagina
    // raggiunge uno stato stabile a fine caricamento.
    renderList();
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
