// Dashboard di gestione di Filo (filo://manage/).
// Sezione "Revisione": mostra i feedback bloccati dal pipeline di sicurezza,
// con dettaglio a 3 colonne (lista / chat / pannello laterale variabile).
// Le altre sezioni sono segnaposto per ora.

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

  // Revisione — lista
  const mgListLoading = document.getElementById('mgListLoading');
  const mgList        = document.getElementById('mgList');
  const mgListEmpty   = document.getElementById('mgListEmpty');

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

  // Revisione — azioni (accetta/sblocca, owner-only)
  const mgActions       = document.getElementById('mgActions');
  const mgAcceptComment = document.getElementById('mgAcceptComment');
  const mgAcceptBtn     = document.getElementById('mgAcceptBtn');
  const mgActionMsg     = document.getElementById('mgActionMsg');

  // Lightbox
  const mgLightbox    = document.getElementById('mgLightbox');
  const mgLightboxImg = document.getElementById('mgLightboxImg');

  // ── Stato ─────────────────────────────────────────────────────────────────
  let isAdmin       = false;
  let allFeedbacks  = [];       // tutti i feedback caricati
  let blocked       = [];       // solo quelli con classifyBlock() != null
  let selectedId    = null;     // ID del feedback selezionato nel pannello centrale
  let allByClient   = {};       // clientId → array di feedback (per il pannello mittente)

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
  mgTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mg-tab');
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll('.mg-tab').forEach((t) => t.classList.remove('mg-tab--active'));
    btn.classList.add('mg-tab--active');
    document.querySelectorAll('.mg-panel').forEach((p) => p.classList.remove('mg-panel--active'));
    const panel = document.getElementById(`panel-${tab}`);
    if (panel) panel.classList.add('mg-panel--active');
  });

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
    // Svuota SEMPRE: se `blocked` torna vuoto (es. dopo uno sblocco) non deve
    // restare la card vecchia in un contenitore nascosto.
    mgList.innerHTML = '';

    if (blocked.length === 0) {
      mgList.hidden = true;
      mgListEmpty.hidden = false;
      return;
    }
    mgListEmpty.hidden = true;
    mgList.hidden = false;

    for (const fb of blocked) {
      const cl = MR.classifyBlock(fb);
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';

      const item = document.createElement('div');
      item.className = 'mg-item' + (fb._id === selectedId ? ' mg-item--selected' : '');
      item.dataset.id = fb._id;
      item.style.borderLeftColor = cl ? cl.color : 'transparent';
      item.innerHTML = `
        ${num ? `<span class="mg-item-num">#${esc(num)}</span>` : ''}
        <span class="mg-item-title">${esc(title)}</span>
        ${cl ? `<span class="mg-item-reason" style="color:${cl.color}">${esc(cl.label)}</span>` : ''}
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

    // Azioni di revisione: solo l'owner può sbloccare. Reset comment + messaggio.
    mgActions.hidden = !isAdmin;
    mgAcceptComment.value = '';
    setActionMsg('', '');

    // Chiudi pannello laterale
    closeSidebar();
  }

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

      // Aggiorna lo stato locale e rimuovi dalla colonna Bloccati (ottimistico).
      const fb = allFeedbacks.find((f) => f._id === id);
      if (fb) { fb.reviewDecision = 'accepted'; fb.reviewComment = comment; fb.status = 'todo'; }
      blocked = blocked.filter((f) => f._id !== id);
      renderList();

      // Il feedback non è più in revisione: torna allo stato vuoto del dettaglio.
      selectedId = null;
      mgDetail.hidden = true;
      mgDetailEmpty.hidden = false;
      mgActions.hidden = true;
      closeSidebar();
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
        dot.title = `Giudice ${judgeLetters[i]}: in attesa`;
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

  // Nome del giudice: il modello reale SOLO per l'owner (isAdmin); per gli altri
  // resta anonimizzato in "Giudice A/B/…". Il nome del modello compare solo se il
  // backend di sicurezza lo include nel verdetto (campo `model`); altrimenti si
  // ripiega sulla lettera anche per l'owner.
  function judgeName(v, letter) {
    const model = v && (v.model || v.judgeModel);
    return (isAdmin && model) ? String(model) : `Giudice ${letter}`;
  }

  // Click su un pallino giudice → apre QUEL giudice nel pannello destro:
  // nome (modello reale per l'owner), badge classe, reasoning completo.
  function openSidebarJudge(fb, i) {
    const verdicts = (fb.pipeline && fb.pipeline.verdicts) || [];
    const v = verdicts[i];
    if (!v) return;

    const letters = ['A', 'B', 'C', 'D'];
    const letter  = v.judge || letters[i] || String(i + 1);
    const name    = judgeName(v, letter);
    const cls     = v.class || '';
    const badgeClass = cls ? `mg-class-badge--${cls}` : '';

    const html = `
      <div class="mg-judge-detail">
        <span class="mg-class-badge ${badgeClass}">${esc(cls || '—')}</span>
        <div class="mg-reasoning">${
          v.reasoning ? esc(v.reasoning) : '<em>Nessun ragionamento disponibile.</em>'
        }</div>
      </div>
    `;
    openSidebar(name, html);
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

    try {
      allFeedbacks = await FB.list({ pageSize: 500 });
    } catch (err) {
      mgListLoading.hidden = true;
      mgListEmpty.hidden = false;
      mgListEmpty.textContent = 'Errore nel caricamento dei feedback.';
      console.error('[manage] errore caricamento:', err);
      return;
    }

    // Indice per mittente
    allByClient = {};
    for (const fb of allFeedbacks) {
      const c = fb.clientId || '__anon__';
      if (!allByClient[c]) allByClient[c] = [];
      allByClient[c].push(fb);
    }

    // Filtra + ordina i bloccati
    const withBlock = allFeedbacks.filter((fb) => MR.classifyBlock(fb) !== null);
    blocked = MR.sortReview(withBlock);

    renderList();
  }

  // ── Hook di test ────────────────────────────────────────────────────────
  // Solo per gli spec Playwright: inietta feedback e apre il dettaglio
  // esercitando il VERO codice di rendering, senza duplicarne la logica nel
  // test (vedi CLAUDE.md → "Test che servono davvero"). Inerte in produzione.
  window.__mgTest = {
    setData(fbs) {
      allFeedbacks = Array.isArray(fbs) ? fbs : [];
      blocked = MR.sortReview(allFeedbacks.filter((f) => MR.classifyBlock(f) !== null));
      renderList();
    },
    setAdmin(v) { isAdmin = !!v; },
    openDetail,
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    await refreshAuth();
    applyAutoModeGate();
    await loadAutoMode();
    await loadData();
  }

  init();

})();
