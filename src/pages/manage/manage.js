// Dashboard di gestione unificata di Filo (filo://manage/, owner-only).
// Tab-lista (Ricevuti / In coda / Risolti / Archiviati) che condividono un
// layout a 3 colonne (lista filtrata per tab / dettaglio / pannello laterale):
// la lista a sinistra mostra il sottoinsieme di feedback della tab corrente,
// il dettaglio al centro ne mostra la conversazione + azioni contestuali
// (sblocco per i bloccati, risposta per i chiarimenti). Le tab "Statistiche
// Red Team" e "Modelli di supporto" sono segnaposto per ora.

(function () {
  'use strict';

  // ── Elementi DOM ──────────────────────────────────────────────────────────
  const mgTabs       = document.getElementById('mgTabs');
  const mgBanner     = document.getElementById('mgBanner');
  const mgSignInBtn  = document.getElementById('mgSignIn');

  // Switch "Modalità automatica" (sempre visibile, owner-only)
  const mgAutoSwitch = document.getElementById('mgAutoSwitch');
  const mgAutoToggle = document.getElementById('mgAutoToggle');
  const mgAutoState  = document.getElementById('mgAutoState');

  // Lista (tab corrente)
  const mgListHead     = document.getElementById('mgListHead');
  const mgListLoading  = document.getElementById('mgListLoading');
  const mgList         = document.getElementById('mgList');
  const mgListEmpty    = document.getElementById('mgListEmpty');
  const mgArchiveFilter = document.getElementById('mgArchiveFilter');
  const mgStarFilter    = document.getElementById('mgStarFilter');

  // Revisione — dettaglio
  const mgDetailEmpty = document.getElementById('mgDetailEmpty');
  const mgDetail      = document.getElementById('mgDetail');
  const mgDetailHead  = document.getElementById('mgDetailHead');
  const mgJudgesRow   = document.getElementById('mgJudgesRow');
  const mgThread      = document.getElementById('mgThread');

  // Revisione — pannello laterale
  const mgSideEmpty  = document.getElementById('mgSideEmpty');
  const mgSide       = document.getElementById('mgSide');
  const mgSideTitle  = document.getElementById('mgSideTitle');
  const mgSideClose  = document.getElementById('mgSideClose');
  const mgSideBody   = document.getElementById('mgSideBody');

  // Azioni (accetta/sblocca un bloccato, owner-only)
  const mgActions       = document.getElementById('mgActions');
  const mgAcceptComment = document.getElementById('mgAcceptComment');
  const mgAcceptBtn     = document.getElementById('mgAcceptBtn');
  const mgActionMsg     = document.getElementById('mgActionMsg');

  // Risposta ai chiarimenti (owner-only)
  const mgClarify     = document.getElementById('mgClarify');
  const mgClarifyText = document.getElementById('mgClarifyText');
  const mgClarifyBtn  = document.getElementById('mgClarifyBtn');
  const mgClarifyMsg  = document.getElementById('mgClarifyMsg');

  // Gestione feedback: preferito ⭐ + archivia/ripristina (owner-only)
  const mgManage     = document.getElementById('mgManage');
  const mgStarBtn    = document.getElementById('mgStarBtn');
  const mgArchiveBtn = document.getElementById('mgArchiveBtn');
  const mgManageMsg  = document.getElementById('mgManageMsg');

  // Lightbox
  const mgLightbox    = document.getElementById('mgLightbox');
  const mgLightboxImg = document.getElementById('mgLightboxImg');

  // ── Stato ─────────────────────────────────────────────────────────────────
  let isAdmin       = false;
  let allFeedbacks  = [];       // tutti i feedback caricati
  let currentTab    = 'inbox';  // tab lista attiva (inbox/queue/resolved/archived)
  let currentList   = [];       // feedback della tab corrente, ordinati
  let selectedId    = null;     // ID del feedback selezionato nel pannello centrale
  let allByClient   = {};       // clientId → array di feedback (per il pannello mittente)
  let starredOnly   = false;    // filtro ⭐ della tab Archiviati (DB2)
  let releasedVersion = '';     // versione dell'app in esecuzione = ultima rilasciata (DB3)

  // Etichette/testi vuoto per le tab-lista (DB1).
  const TAB_LABELS = {
    inbox: 'Ricevuti', queue: 'In coda', resolved: 'Risolti', archived: 'Archiviati',
  };
  const TAB_EMPTY = {
    inbox:    'Nessun feedback ricevuto.',
    queue:    'Nessun feedback in coda.',
    resolved: 'Nessun feedback risolto.',
    archived: 'Nessun feedback archiviato.',
  };
  const LIST_TABS = ['inbox', 'queue', 'resolved', 'archived'];

  const FB  = window.SN_FEEDBACK;
  const MR  = window.SN_MANAGE_REVIEW;
  const AUTO_MODE_KEY = (window.SN_CONST?.STORAGE_KEYS?.AUTO_MODE) || 'filo_auto_mode';

  // ── Canale main process ───────────────────────────────────────────────────
  function sendToMain(msg) {
    if (window.filo?.message)               return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      isAdmin = !!(r && r.isAdmin);
    } catch (_) {
      isAdmin = false;
    }
    mgBanner.hidden = isAdmin;
  }

  mgSignInBtn.addEventListener('click', () => {
    sendToMain({ type: 'auth_signin' }).catch(() => {});
  });

  // ── Switch "Modalità automatica" ──────────────────────────────────────────
  // Stato persistito in chrome.storage.local; lo switch è sempre visibile ma
  // modificabile solo dall'owner (read-only per gli altri, come il resto della
  // pagina).
  function reflectAutoMode(on) {
    mgAutoToggle.checked = !!on;
    mgAutoState.textContent = on ? 'On' : 'Off';
  }

  async function loadAutoMode() {
    try {
      const data = await chrome.storage.local.get(AUTO_MODE_KEY);
      reflectAutoMode(!!data[AUTO_MODE_KEY]);
    } catch (_) {
      reflectAutoMode(false);
    }
  }

  mgAutoToggle.addEventListener('change', async () => {
    const on = mgAutoToggle.checked;
    reflectAutoMode(on);
    try {
      await chrome.storage.local.set({ [AUTO_MODE_KEY]: on });
    } catch (err) {
      // Ripristina lo stato precedente se il salvataggio fallisce.
      reflectAutoMode(!on);
      console.error('[manage] salvataggio modalità automatica fallito:', err);
    }
  });

  function applyAutoModeGate() {
    mgAutoToggle.disabled = !isAdmin;
    mgAutoSwitch.classList.toggle('mg-switch--disabled', !isAdmin);
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  // Le tab-lista (inbox/queue/resolved/archived) condividono il pannello
  // `panel-list`: cambia solo quale sottoinsieme di feedback popola la lista a
  // sinistra. Le tab segnaposto (stats/models) hanno il loro pannello.
  function selectTab(tab) {
    document.querySelectorAll('.mg-tab').forEach((t) => {
      t.classList.toggle('mg-tab--active', t.dataset.tab === tab);
    });
    const isList = LIST_TABS.includes(tab);
    const panelId = isList ? 'panel-list' : `panel-${tab}`;
    document.querySelectorAll('.mg-panel').forEach((p) => {
      p.classList.toggle('mg-panel--active', p.id === panelId);
    });
    if (isList) {
      currentTab = tab;
      // Cambiando tab si azzera la selezione: il feedback aperto potrebbe non
      // appartenere alla nuova lista.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      mgManage.hidden = true;
      closeSidebar();
      renderList();
    }
  }

  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  // Filtro ⭐ della tab Archiviati: ricalcola la lista (la selezione resta).
  if (mgStarFilter) {
    mgStarFilter.addEventListener('change', () => {
      starredOnly = mgStarFilter.checked;
      renderList();
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  function openLightbox(src) {
    mgLightboxImg.src = src;
    mgLightbox.classList.add('open');
  }
  mgLightbox.addEventListener('click', () => {
    mgLightbox.classList.remove('open');
    mgLightboxImg.src = '';
  });

  // ── Utilità date ──────────────────────────────────────────────────────────
  function formatDate(isoOrTs) {
    if (!isoOrTs) return '—';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function daysAgo(isoOrTs) {
    if (!isoOrTs) return '—';
    const d = new Date(isoOrTs);
    if (isNaN(d.getTime())) return '—';
    const diff = Math.round((Date.now() - d.getTime()) / 86_400_000);
    if (diff <= 0) return 'oggi';
    if (diff === 1) return 'ieri';
    return `${diff} giorni fa`;
  }

  // ── Rendering colonna sinistra ────────────────────────────────────────────
  function renderList() {
    mgListLoading.hidden = true;
    if (mgListHead) mgListHead.textContent = TAB_LABELS[currentTab] || '';
    mgListEmpty.textContent = TAB_EMPTY[currentTab] || 'Nessun feedback.';

    // Il filtro ⭐ esiste solo nella tab Archiviati (DB2).
    const isArchived = currentTab === 'archived';
    if (mgArchiveFilter) mgArchiveFilter.hidden = !isArchived;

    // Sottoinsieme della tab corrente, ordinato (logica pura condivisa).
    if (isArchived) {
      // OFF = solo i feedback `archived`; ON = tutti i preferiti ⭐ (ogni stato).
      currentList = MR.listArchiveTab(allFeedbacks, { starredOnly });
      mgListEmpty.textContent = starredOnly
        ? 'Nessun feedback preferito.'
        : (TAB_EMPTY.archived || 'Nessun feedback archiviato.');
    } else {
      // DB3: passa la versione rilasciata così "Risolti" contiene solo i fix
      // davvero in produzione; i done-ma-non-ancora-spediti restano in "In coda".
      currentList = MR.listForManageTab(allFeedbacks, currentTab, { releasedVersion });
    }

    // Svuota SEMPRE: se la lista torna vuota (es. dopo uno sblocco) non deve
    // restare la card vecchia in un contenitore nascosto.
    mgList.innerHTML = '';

    if (currentList.length === 0) {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      return;
    }
    mgListEmpty.hidden = true;
    mgList.hidden = false;

    for (const fb of currentList) {
      const cl = MR.classifyBlock(fb);
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';

      const item = document.createElement('div');
      item.className = 'mg-item' + (fb._id === selectedId ? ' mg-item--selected' : '');
      item.dataset.id = fb._id;
      item.style.borderLeftColor = cl ? cl.color : 'transparent';
      // Una riga sola: #N · titolo (ellissi). Il motivo (attacco/spam/…) resta
      // implicito nel colore del border-left; il titolo completo nel tooltip.
      item.title = (num ? `#${num} · ` : '') + title;
      item.innerHTML = `
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
      `;
      item.addEventListener('click', () => openDetail(fb._id));
      mgList.appendChild(item);
    }
  }

  // ── Rendering pannello centrale ───────────────────────────────────────────
  function openDetail(id) {
    selectedId = id;

    // Aggiorna selezione visiva nella lista
    document.querySelectorAll('.mg-item').forEach((el) => {
      el.classList.toggle('mg-item--selected', el.dataset.id === id);
    });

    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;

    mgDetailEmpty.hidden = true;
    mgDetail.hidden = false;

    // Intestazione
    const clientId = fb.clientId || 'anonimo';
    const dateStr  = formatDate(fb.createdAt);
    mgDetailHead.innerHTML = `Da <a class="mg-sender-link" id="senderLink" href="#" data-client="${esc(clientId)}">${esc(clientId)}</a> il ${dateStr}`;
    document.getElementById('senderLink').addEventListener('click', (e) => {
      e.preventDefault();
      openSidebarSender(clientId);
    });

    // Riga giudici (4 pallini, riassunto a colpo d'occhio). Il click su un
    // pallino apre QUEL giudice (nome + classe + reasoning) nel pannello destro.
    renderJudgesRow(fb);

    // Bolle chat
    renderThread(fb);

    // Azioni contestuali (owner-only):
    //  - feedback bloccato dal pipeline → "Accetta e sblocca";
    //  - feedback in chiarimento → box di risposta che lo rimette in coda;
    //  - altrimenti nessuna azione.
    const isBlocked = MR.classifyBlock(fb) !== null;
    const isClarify = (fb.status || 'new') === 'clarify';
    mgActions.hidden = !(isAdmin && isBlocked);
    mgAcceptComment.value = '';
    setActionMsg('', '');
    mgClarify.hidden = !(isAdmin && isClarify);
    mgClarifyText.value = '';
    setClarifyMsg('', '');

    // Gestione (⭐ + archivia/ripristina): visibile per l'owner su QUALUNQUE
    // feedback selezionato, accanto alle azioni contestuali.
    mgManage.hidden = !isAdmin;
    reflectManage(fb);
    setManageMsg('', '');

    // Chiudi pannello laterale
    closeSidebar();
  }

  // Riflette lo stato corrente del feedback sui controlli di gestione:
  // il bottone ⭐ acceso se è preferito; "Archivia" o "Ripristina" a seconda
  // che il feedback sia già archiviato.
  function reflectManage(fb) {
    mgStarBtn.disabled = false;
    mgArchiveBtn.disabled = false;
    const starred = MR.isStarred(fb);
    mgStarBtn.setAttribute('aria-pressed', starred ? 'true' : 'false');
    mgStarBtn.textContent = starred ? '★ Preferito' : '☆ Preferito';
    mgStarBtn.title = starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    const archived = (fb.status || '') === 'archived';
    mgArchiveBtn.textContent = archived ? 'Ripristina' : 'Archivia';
    mgArchiveBtn.title = archived
      ? 'Riporta il feedback in coda'
      : 'Sposta il feedback negli archiviati';
  }

  function setManageMsg(text, kind) {
    mgManageMsg.textContent = text || '';
    mgManageMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  // ── Azione: preferito ⭐ (toggle) ───────────────────────────────────────────
  // Il flag `starred` è indipendente dallo stato: l'owner può "parcheggiare"
  // qualunque feedback per il futuro. Compare nel filtro ⭐ della tab Archiviati.
  async function toggleStarred() {
    if (!selectedId) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const next = !MR.isStarred(fb);

    mgStarBtn.disabled = true;
    setManageMsg(next ? 'Aggiungo ai preferiti…' : 'Rimuovo dai preferiti…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, starred: next });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      fb.starred = next;
      reflectManage(fb);
      setManageMsg(next ? 'Aggiunto ai preferiti.' : 'Rimosso dai preferiti.', 'ok');
      // Se il filtro ⭐ è attivo, un feedback de-preferito deve sparire dalla lista.
      if (currentTab === 'archived' && starredOnly) renderList();
    } catch (e) {
      setManageMsg(e.message || 'Errore', 'err');
    } finally {
      mgStarBtn.disabled = false;
    }
  }

  // ── Azione: archivia / ripristina ───────────────────────────────────────────
  // Archivia → status `archived` (tab Archiviati). Su un feedback già archiviato
  // il bottone ripristina, riportandolo in coda (todo): invariante UX "se puoi
  // archiviare, puoi togliere dall'archivio".
  async function toggleArchive() {
    if (!selectedId) return;
    const id = selectedId;
    const fb = allFeedbacks.find((f) => f._id === id);
    if (!fb) return;
    const wasArchived = (fb.status || '') === 'archived';
    const next = wasArchived ? 'todo' : 'archived';
    // Override owner (DC3, SN_BOARD_ARCHIVE.hasOwnerOverride): un'azione manuale
    // qui è sempre esplicita → vince per sempre sull'auto-archiviazione a
    // punteggio. Archivio a mano → 'archived' (non riarchiviabile/non
    // riapribile dall'automazione); ripristino a mano → 'keep_open' (il
    // punteggio NON lo farà ri-archiviare anche se sopra soglia).
    const nextOverride = wasArchived ? 'keep_open' : 'archived';

    mgArchiveBtn.disabled = true;
    setManageMsg(wasArchived ? 'Ripristino…' : 'Archivio…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: next, archiveOverride: nextOverride });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      fb.status = next;
      fb.archiveOverride = nextOverride;
      // Il feedback cambia tab: chiudi il dettaglio e ricalcola la lista corrente.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      mgManage.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      setManageMsg(e.message || 'Errore', 'err');
      mgArchiveBtn.disabled = false;
    }
  }

  mgStarBtn.addEventListener('click', toggleStarred);
  mgArchiveBtn.addEventListener('click', toggleArchive);

  function setClarifyMsg(text, kind) {
    mgClarifyMsg.textContent = text || '';
    mgClarifyMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  // Risposta dell'owner a un feedback in `clarify`: la risposta si appende alle
  // note (come turno utente, preservando lo storico) e il feedback rientra in
  // coda (todo) per la prossima passata.
  async function sendClarifyReply() {
    if (!selectedId) return;
    const id = selectedId;
    const reply = (mgClarifyText.value || '').trim();
    if (!reply) { mgClarifyText.focus(); return; }
    const fb = allFeedbacks.find((f) => f._id === id);
    const oldNotes = (fb && fb.notes) || '';
    const newNotes = window.SN_FEEDBACK_THREAD
      ? window.SN_FEEDBACK_THREAD.appendUserTurn(oldNotes, reply, {})
      : (oldNotes ? `${oldNotes}\n\n${reply}` : reply);

    mgClarifyBtn.disabled = true;
    setClarifyMsg('Invio in corso…', '');
    try {
      const r = await sendToMain({ type: 'feedback_update', id, status: 'todo', notes: newNotes });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      if (fb) { fb.status = 'todo'; fb.notes = newNotes; }
      // Il feedback non è più in chiarimento: esce dalla tab Ricevuti.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgClarify.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      setClarifyMsg(e.message || 'Errore nell\'invio', 'err');
    } finally {
      mgClarifyBtn.disabled = false;
    }
  }

  mgClarifyBtn.addEventListener('click', sendClarifyReply);

  // ── Azione: accetta e sblocca un feedback bloccato ──────────────────────────
  function setActionMsg(text, kind) {
    mgActionMsg.textContent = text || '';
    mgActionMsg.className = 'mg-action-msg' + (kind ? ` mg-${kind}` : '');
  }

  async function acceptSelected() {
    if (!selectedId) return;
    const id = selectedId;
    const comment = (mgAcceptComment.value || '').trim();
    mgAcceptBtn.disabled = true;
    setActionMsg('Sblocco in corso…', '');
    try {
      // Override owner: il feedback esce dai bloccati e rientra nella coda (todo).
      const r = await sendToMain({
        type: 'feedback_update',
        id,
        reviewDecision: 'accepted',
        reviewComment: comment,
        reviewedAt: new Date().toISOString(),
        status: 'todo',
      });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');

      // Aggiorna lo stato locale (ottimistico): l'override "accepted" toglie il
      // blocco e il feedback diventa un `todo` — resta in "In coda", non più tra
      // i bloccati. renderList ricalcola la lista dalla sorgente.
      const fb = allFeedbacks.find((f) => f._id === id);
      if (fb) { fb.reviewDecision = 'accepted'; fb.reviewComment = comment; fb.status = 'todo'; }

      // Il feedback non è più in revisione: torna allo stato vuoto del dettaglio.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      mgClarify.hidden = true;
      closeSidebar();
      renderList();
    } catch (e) {
      setActionMsg(e.message || 'Errore nello sblocco', 'err');
    } finally {
      mgAcceptBtn.disabled = false;
    }
  }

  mgAcceptBtn.addEventListener('click', acceptSelected);

  function renderJudgesRow(fb) {
    // Pulisce tutto tranne la label
    const label = mgJudgesRow.querySelector('.mg-judge-label');
    mgJudgesRow.innerHTML = '';
    if (label) mgJudgesRow.appendChild(label);
    else {
      const lbl = document.createElement('span');
      lbl.className = 'mg-judge-label';
      lbl.textContent = 'Giudici:';
      mgJudgesRow.appendChild(lbl);
    }

    const verdicts = (fb.pipeline && fb.pipeline.verdicts) || [];
    const judgeLetters = ['A', 'B', 'C', 'D'];

    // Senza alcun verdetto la riga giudici non ha senso (es. feedback ricevuti o
    // in chiarimento, mai passati dal pipeline): nascondila del tutto.
    if (verdicts.length === 0) { mgJudgesRow.hidden = true; return; }
    mgJudgesRow.hidden = false;

    for (let i = 0; i < 4; i++) {
      const v = verdicts[i];
      const dot = document.createElement('span');
      dot.className = 'mg-dot';
      if (v) {
        const cls = v.class || '';
        if (cls) dot.classList.add(`mg-dot--${cls}`);
        dot.classList.add('mg-dot--clickable');
        dot.title = `Giudice ${judgeLetters[i]}: ${cls}`;
        // Click sul pallino → apre QUEL giudice nel pannello destro.
        dot.addEventListener('click', () => openSidebarJudge(fb, i));
      } else {
        // Pipeline già passata (la riga compare solo con ≥1 verdetto): un pallino
        // vuoto = quel giudice NON ha emesso un verdetto in quella run (timeout/
        // errore/giudice non configurato), non "in attesa".
        dot.classList.add('mg-dot--empty');
        dot.title = `Giudice ${judgeLetters[i]}: nessun verdetto`;
      }
      mgJudgesRow.appendChild(dot);
    }
  }

  function renderThread(fb) {
    mgThread.innerHTML = '';

    // Bolla 1: il feedback dell'utente
    const bUser = document.createElement('div');
    bUser.className = 'mg-bubble mg-bubble--user';
    let bodyHtml = `<div class="mg-bubble-who">Utente</div>`;
    bodyHtml += `<div class="mg-bubble-body">${esc(fb.text || '')}</div>`;

    const imgs = Array.isArray(fb.images) ? fb.images : [];
    if (imgs.length) {
      bodyHtml += `<div class="mg-bubble-imgs">`;
      for (const url of imgs) {
        bodyHtml += `<img src="${esc(url)}" alt="allegato" data-src="${esc(url)}" loading="lazy">`;
      }
      bodyHtml += `</div>`;
    }
    bUser.innerHTML = bodyHtml;

    // Click sulle immagini → lightbox
    bUser.querySelectorAll('.mg-bubble-imgs img').forEach((img) => {
      img.addEventListener('click', () => openLightbox(img.dataset.src || img.src));
    });
    mgThread.appendChild(bUser);

    // Bolla 2: commento di Filo
    const bModel = document.createElement('div');
    bModel.className = 'mg-bubble mg-bubble--model';
    const summary = fb.pipeline && fb.pipeline.filoSummary;
    bModel.innerHTML = `
      <div class="mg-bubble-who">Filo</div>
      <div class="mg-bubble-body">${
        summary
          ? esc(summary)
          : '<em>Filo non ha ancora un parere su questo feedback (giudici non attivi).</em>'
      }</div>
    `;
    mgThread.appendChild(bModel);
  }

  // ── Pannello laterale ─────────────────────────────────────────────────────
  function openSidebar(title, html) {
    mgSideEmpty.hidden = true;
    mgSide.hidden = false;
    mgSideTitle.textContent = title;
    mgSideBody.innerHTML = html;
  }

  function closeSidebar() {
    mgSide.hidden = true;
    mgSideEmpty.hidden = false;
    mgSideTitle.textContent = '';
    mgSideBody.innerHTML = '';
  }

  mgSideClose.addEventListener('click', closeSidebar);

  // Click su un pallino giudice → apre QUEL giudice nel pannello destro.
  // Titolo: per l'OWNER è il MODELLO reale che ha emesso il verdetto (così l'owner
  // vede subito quale modello ha votato cosa); per i non-owner è anonimizzato e
  // posizionale ("Giudice A/B/C/D" — mai l'id interno del giudice né il modello).
  function openSidebarJudge(fb, i) {
    const verdicts = (fb.pipeline && fb.pipeline.verdicts) || [];
    const v = verdicts[i];
    if (!v) return;

    const letters = ['A', 'B', 'C', 'D'];
    const anonLabel = `Giudice ${letters[i] || String(i + 1)}`;
    const cls     = v.class || '';
    const badgeClass = cls ? `mg-class-badge--${cls}` : '';

    // Modello reale del verdetto (campo `model` del backend). All'owner lo
    // mostriamo come TITOLO del pannello; se non è registrato (verdetti di
    // pipeline vecchie, precedenti all'aggiunta del campo) ripieghiamo
    // sull'etichetta anonima e lo dichiariamo nel corpo.
    const model = v && (v.model || v.judgeModel);
    const title = (isAdmin && model) ? String(model) : anonLabel;

    // Corpo: la riga "Modello" serve solo quando il modello NON è nel titolo, cioè
    // all'owner quando il modello manca (lo dichiara invece di sparire).
    const modelRow = (isAdmin && !model)
      ? `<div class="mg-judge-model"><em>Modello non registrato</em></div>`
      : '';

    const html = `
      <div class="mg-judge-detail">
        <span class="mg-class-badge ${badgeClass}">${esc(cls || '—')}</span>
        ${modelRow}
        <div class="mg-reasoning">${
          v.reasoning ? esc(v.reasoning) : '<em>Nessun ragionamento disponibile.</em>'
        }</div>
      </div>
    `;
    openSidebar(title, html);
  }

  function openSidebarSender(clientId) {
    const group = allByClient[clientId] || [];
    const total = group.length;

    // Età account: createdAt più vecchio
    let oldest = null;
    for (const fb of group) {
      if (!fb.createdAt) continue;
      const t = new Date(fb.createdAt).getTime();
      if (!oldest || t < oldest.time) oldest = { time: t, iso: fb.createdAt };
    }

    const oldestStr = oldest
      ? `Primo feedback il ${formatDate(oldest.iso)} · ${daysAgo(oldest.iso)}`
      : '—';

    let listHtml = '';
    for (const fb of group) {
      const cl  = MR.classifyBlock(fb);
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const color = cl ? cl.color : 'var(--sn-border)';
      listHtml += `
        <div class="mg-sender-item" data-id="${esc(fb._id)}" style="border-left-color:${color}">
          ${num ? `<span class="mg-sender-item-num">#${esc(num)}</span>` : ''}
          <span class="mg-sender-item-title">${esc(title)}</span>
        </div>
      `;
    }

    const html = `
      <div class="mg-sender-info">
        <div class="mg-sender-stat"><strong>${esc(clientId)}</strong></div>
        <div class="mg-sender-stat">${esc(oldestStr)}</div>
        <div class="mg-sender-stat">Feedback totali: <strong>${total}</strong></div>
        <div class="mg-sender-list" id="senderFbList">${listHtml || '<em>Nessun feedback.</em>'}</div>
      </div>
    `;
    openSidebar('Mittente', html);

    // Click su un feedback del mittente → carica nel pannello centrale
    const listEl = document.getElementById('senderFbList');
    if (listEl) {
      listEl.querySelectorAll('.mg-sender-item[data-id]').forEach((el) => {
        el.addEventListener('click', () => openDetail(el.dataset.id));
      });
    }
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Caricamento dati ──────────────────────────────────────────────────────
  async function loadData() {
    mgListLoading.hidden = false;
    mgList.hidden = true;
    mgListEmpty.hidden = true;

    // DB3: la versione dell'app in esecuzione è, per definizione, l'ultima
    // rilasciata (l'owner gira una build pubblicata). La leggiamo dal recap
    // aggiornamento, che il main calcola con app.getVersion().
    if (!releasedVersion) {
      try {
        const r = await sendToMain({ type: 'get_update_recap' });
        if (r && r.current) releasedVersion = r.current;
      } catch (_) { /* gate inattivo: senza versione, done→Risolti come prima */ }
    }

    try {
      allFeedbacks = await FB.list({ pageSize: 500 });
    } catch (err) {
      mgListLoading.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = 'Errore nel caricamento dei feedback.';
      console.error('[manage] errore caricamento:', err);
      return;
    }

    // S1.3: decifratura batch dei campi FENC1: — una sola IPC per tutta la lista.
    // Se l'utente non è admin (o il modulo non è disponibile) i valori restano
    // invariati (graceful fallback: la dashboard non si rompe, mostra il ciphertext).
    if (isAdmin && allFeedbacks.length > 0) {
      try {
        const r = await sendToMain({ type: 'feedback_decrypt_fields', list: allFeedbacks });
        if (r && r.ok && Array.isArray(r.list)) allFeedbacks = r.list;
      } catch (_) { /* fallback: render con valori cifrati */ }
    }

    // Indice per mittente
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = fb.clientId || '__anon__';
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }

    renderList();
  }

  // ── Hook di test ────────────────────────────────────────────────────────
  // Solo per gli spec Playwright: inietta feedback e apre il dettaglio
  // esercitando il VERO codice di rendering, senza duplicarne la logica nel
  // test (vedi CLAUDE.md → "Test che servono davvero"). Inerte in produzione.
  window.__mgTest = {
    setData(fbs) {
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      // Reindicizza per mittente (il pannello laterale lo usa).
      allByClient = {};
      for (const fb of allFeedbacks) {
        const c = fb.clientId || '__anon__';
        (allByClient[c] || (allByClient[c] = [])).push(fb);
      }
      renderList();
    },
    setAdmin(v) { isAdmin = !!v; },
    setTab(tab) { selectTab(tab); },
    // DB3: imposta la "versione rilasciata" usata dal gate "Risolti" e rirende.
    setReleasedVersion(v) { releasedVersion = v || ''; renderList(); },
    openDetail,
  };

  // ── Sezione "Modelli di supporto" (DD1) ──────────────────────────────────
  // Slot → editor a segmenti (buildChain del modelChainEditor).
  // Caricato pigro: viene inizializzato la prima volta che l'utente clicca la tab.
  const SM_SLOTS = ['sanitizer', 'judge1', 'judge2', 'judge3', 'judgeDynamic', 'judgeRedTeam', 'judgePriority'];
  // Etichette amichevoli per slot (i giudici del panel L2 sono "Giudice 1/2/3"
  // + "Giudice dinamico"; l'id grezzo non va mai mostrato all'utente). L'HTML
  // ha già le <label> statiche; questa mappa è la sorgente di verità se in
  // futuro le label venissero generate dal JS.
  const SM_SLOT_LABELS = {
    sanitizer:     'Sanitizer feedback',
    judge1:        'Giudice 1',
    judge2:        'Giudice 2',
    judge3:        'Giudice 3',
    judgeDynamic:  'Giudice dinamico',
    judgeRedTeam:  'Giudice red-team',
    judgePriority: 'Giudice priorità',
  };
  let smChains = {};        // slot → { getValue }
  let smLoaded  = false;    // true dopo il primo caricamento riuscito
  let smLoading = false;    // guard anti-doppio-caricamento

  const mgSmLoading = document.getElementById('mgSmLoading');
  const mgSmDenied  = document.getElementById('mgSmDenied');
  const mgSmEditor  = document.getElementById('mgSmEditor');
  const mgSmSaveBtn = document.getElementById('mgSmSaveBtn');
  const mgSmStatus  = document.getElementById('mgSmStatus');
  const mgSmKeyInput     = document.getElementById('mgSmKeyOpenrouter');
  const mgSmKeyState     = document.getElementById('mgSmKeyOpenrouterState');
  const mgSmRegistryList = document.getElementById('mgSmRegistryList');
  const mgSmRegistryAdd  = document.getElementById('mgSmRegistryAdd');

  // Popola la <datalist id="nicknames-list"> (l'id letto da SN_MODEL_CHAIN) coi
  // nickname che i giudici possono usare: quelli definiti nel registro giudici
  // (righe correnti) uniti ai predefiniti condivisi, così i selettori per-giudice
  // li propongono. Va richiamata dopo ogni modifica al registro.
  function populateSmNicknames() {
    const dl = document.getElementById('nicknames-list');
    if (!dl) return;
    dl.innerHTML = '';
    const seen = new Set();
    const addNick = (nick, label) => {
      const name = String(nick || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      const opt = document.createElement('option');
      opt.value = name;
      if (label) opt.label = label;
      dl.appendChild(opt);
    };
    // 1. Registro dedicato ai giudici (priorità: compaiono per primi).
    const judgeReg = collectJudgeRegistry();
    for (const nick of Object.keys(judgeReg)) addNick(nick, judgeReg[nick].label);
    // 2. Registro condiviso predefinito (fallback comodo: flash, haiku, …).
    const shared = (window.SN_CONST && window.SN_CONST.DEFAULT_MODEL_REGISTRY) || {};
    for (const nick of Object.keys(shared)) addNick(nick, (shared[nick] || {}).label);
  }

  // ── Registro modelli dei giudici (nickname → modello OpenRouter) ───────────
  // Una riga = nickname + stringa modello OpenRouter + rimuovi. Provider implicito
  // OpenRouter (il backend dei giudici è OpenRouter-only).
  function makeRegistryRow(nick, entry) {
    const e = entry || {};
    const row = document.createElement('div');
    row.className = 'sn-model-row mg-sm-reg-row';
    row.dataset.label = (e.label || '');

    const nickIn = document.createElement('input');
    nickIn.type = 'text';
    nickIn.className = 'sn-model-nick';
    nickIn.placeholder = 'nickname (es. giudice-veloce)';
    nickIn.value = nick || '';

    const modelIn = document.createElement('input');
    modelIn.type = 'text';
    modelIn.className = 'sn-model-id';
    modelIn.setAttribute('autocomplete', 'off');
    modelIn.placeholder = 'modello OpenRouter (es. deepseek/deepseek-v4-pro)';
    modelIn.value = e.model || '';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sn-btn sn-btn-secondary';
    del.textContent = 'Rimuovi';
    del.addEventListener('click', () => { row.remove(); populateSmNicknames(); });

    // Aggiornare un nickname ridisegna i suggerimenti dei selettori.
    nickIn.addEventListener('input', () => populateSmNicknames());

    row.appendChild(nickIn);
    row.appendChild(modelIn);
    row.appendChild(del);
    return row;
  }

  function renderJudgeRegistry(registry) {
    if (!mgSmRegistryList) return;
    mgSmRegistryList.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sn-model-row sn-model-row-head mg-sm-reg-row';
    ['Nickname', 'Modello OpenRouter', ''].forEach((label) => {
      const c = document.createElement('div'); c.textContent = label; head.appendChild(c);
    });
    mgSmRegistryList.appendChild(head);

    const entries = Object.entries(registry || {});
    if (!entries.length) {
      mgSmRegistryList.appendChild(makeRegistryRow('', {}));
    } else {
      for (const [nick, e] of entries) mgSmRegistryList.appendChild(makeRegistryRow(nick, e));
    }
  }

  function collectJudgeRegistry() {
    const out = {};
    if (!mgSmRegistryList) return out;
    for (const row of mgSmRegistryList.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')) {
      const nick = row.querySelector('.sn-model-nick').value.trim();
      const model = row.querySelector('.sn-model-id').value.trim();
      const label = (row.dataset.label || '').trim();
      if (!nick || !model) continue;
      if (out[nick]) continue;
      const entry = { provider: 'openrouter', model };
      if (label) entry.label = label;
      out[nick] = entry;
    }
    return out;
  }

  // Rende gli editor a segmenti per tutti gli slot, usando SN_MODEL_CHAIN.buildChain.
  // Ogni chain è attaccata al div #mgSmChain-<slot>.
  function renderSmSlots(models) {
    const ModelChain = window.SN_MODEL_CHAIN;
    if (!ModelChain) return;
    smChains = {};
    for (const slot of SM_SLOTS) {
      const host = document.getElementById(`mgSmChain-${slot}`);
      if (!host) continue;
      // Allinea la <label> dello slot all'etichetta amichevole (la mappa è la
      // sorgente di verità: HTML e JS non possono divergere).
      const slotEl = host.closest('.mg-sm-slot');
      const labelEl = slotEl && slotEl.querySelector('label');
      if (labelEl && SM_SLOT_LABELS[slot]) labelEl.textContent = SM_SLOT_LABELS[slot];
      host.innerHTML = '';
      // Nessun validatore di azione (questi slot non corrispondono a un'azione
      // in SN_CONST.ACTIONS): accettiamo qualunque nickname. Il validatore è
      // opzionale in buildChain — basta non passarlo.
      const chain = ModelChain.buildChain(models[slot] || '', null, {});
      host.appendChild(chain.el);
      smChains[slot] = chain;
    }
  }

  function setSmStatus(text, kind) {
    mgSmStatus.textContent = text || '';
    mgSmStatus.className = 'mg-sm-status' + (kind ? ` mg-${kind}` : '');
  }

  // Mostra "configurata/non configurata" accanto al campo chiave (la chiave vera
  // non lascia mai il main: dal GET arriva solo il booleano).
  function applyJudgeKeyState(models) {
    if (!mgSmKeyState) return;
    const present = !!(models && models.openrouterKeyPresent);
    mgSmKeyState.textContent = present ? '(configurata)' : '(non configurata)';
  }

  async function loadSupportModels() {
    if (smLoading) return;
    smLoading = true;
    mgSmLoading.hidden = false;
    mgSmDenied.hidden  = true;
    mgSmEditor.hidden  = true;

    try {
      const r = await sendToMain({ type: 'support_models_get' });
      if (!r || r.ok === false) {
        mgSmLoading.hidden = true;
        mgSmDenied.hidden  = false;
        return;
      }
      applyJudgeKeyState(r.models || {});
      renderJudgeRegistry((r.models || {}).judgeRegistry || {});
      populateSmNicknames();
      renderSmSlots(r.models || {});
      mgSmLoading.hidden = true;
      mgSmEditor.hidden  = false;
      smLoaded = true;
    } catch (e) {
      mgSmLoading.hidden = true;
      mgSmDenied.hidden  = false;
      console.error('[manage] errore caricamento modelli di supporto:', e);
    } finally {
      smLoading = false;
    }
  }

  async function saveSupportModels() {
    if (!smLoaded) return;
    const models = {};
    for (const slot of SM_SLOTS) {
      models[slot] = smChains[slot] ? smChains[slot].getValue() : '';
    }
    const judgeRegistry = collectJudgeRegistry();
    const openrouterKey = mgSmKeyInput ? mgSmKeyInput.value.trim() : '';
    mgSmSaveBtn.disabled = true;
    setSmStatus('Salvataggio…', '');
    try {
      const r = await sendToMain({ type: 'support_models_update', models, judgeRegistry, openrouterKey });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'aggiornamento rifiutato');
      // Ricarica i valori salvati (confirma round-trip Firestore).
      if (mgSmKeyInput) mgSmKeyInput.value = ''; // non riteniamo la chiave in pagina
      applyJudgeKeyState(r.models || {});
      renderJudgeRegistry((r.models || {}).judgeRegistry || judgeRegistry);
      populateSmNicknames();
      renderSmSlots(r.models || models);
      setSmStatus('Salvato.', 'ok');
    } catch (e) {
      setSmStatus(e.message || 'Errore nel salvataggio', 'err');
    } finally {
      mgSmSaveBtn.disabled = false;
      clearTimeout(saveSupportModels._t);
      saveSupportModels._t = setTimeout(() => setSmStatus('', ''), 4000);
    }
  }

  if (mgSmSaveBtn) mgSmSaveBtn.addEventListener('click', saveSupportModels);
  if (mgSmRegistryAdd) mgSmRegistryAdd.addEventListener('click', () => {
    if (mgSmRegistryList) mgSmRegistryList.appendChild(makeRegistryRow('', {}));
  });

  // Caricamento pigro: avviene la prima volta che l'utente seleziona la tab
  // "Modelli di supporto". La funzione selectTab già esiste e gestisce il
  // pannello; qui interceptiamo il click sulla tab models.
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn || btn.dataset.tab !== 'models') return;
    if (!smLoaded && !smLoading) loadSupportModels();
  });

  // Esponi per gli spec Playwright (hook di test).
  window.__mgTest.loadSupportModels = loadSupportModels;
  window.__mgTest.getSmChains = () => smChains;
  window.__mgTest.getSmSlots = () => SM_SLOTS;

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    await refreshAuth();
    applyAutoModeGate();
    await loadAutoMode();
    await loadData();
  }

  init();

})();
