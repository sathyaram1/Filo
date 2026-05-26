// Dashboard interna: triage dei feedback alpha.
// Stato/note salvati su Firestore (via SN_FEEDBACK.updateStatus).

(function () {
  'use strict';

  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');
  const searchEl = document.getElementById('search');
  const refreshBtn = document.getElementById('refresh');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const tabsEl = document.getElementById('tabs');

  // 'inbox' = ricevuti (status: new); 'draft' = bozze (richiedono decisioni di
  // design); 'todo' = da risolvere; 'done' = risolti (in attesa di verifica);
  // 'verified' = verificati dall'utente.
  // I 'ignored' restano nascosti (raggiungibili solo riaprendoli via DB).
  let all = [];
  let currentTab = 'inbox';

  // Le issue trovate dagli agenti LLM arrivano con clientId "agent:<model>"
  // (vedi tests/agent/feedback.mjs): categoria dedicata, niente schema extra.
  function isAgent(f) {
    return typeof f.clientId === 'string' && f.clientId.startsWith('agent:');
  }
  // Decodifica i metadati codificati nei campi consentiti dalle rules.
  function agentMeta(f) {
    const model = (f.clientId || '').slice('agent:'.length) || '?';
    const parts = String(f.title || '').split('|');
    const severity = parts.length >= 3 ? parts[0].trim() : '';
    const area = parts.length >= 3 ? parts[1].trim() : '';
    const title = parts.length >= 3 ? parts.slice(2).join('|').trim() : (f.title || '');
    return { model, severity, area, title };
  }

  function statusOf(f) {
    const s = f.status || 'new';
    if (s === 'ignored') return 'ignored';
    if (s === 'done') return 'done';
    if (s === 'verified') return 'verified';
    // Le issue d'agente NON triagiate (status new) vivono nella loro categoria,
    // così non annegano i feedback degli utenti reali. Promuovendole a "todo"
    // entrano nel flusso normale (restano marcate come agente dai badge).
    if (isAgent(f) && s === 'new') return 'agent';
    if (s === 'new') return 'inbox';
    if (s === 'draft') return 'draft';
    if (s === 'todo') return 'todo';
    return 'inbox';
  }

  function fmtTs(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return String(ts); }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Filtra URL non sicuri (javascript:, data:, ecc.) prima di emetterli in href.
  // I feedback arrivano da utenti reali — se per qualsiasi motivo un URL
  // malevolo finisce in DB, evitiamo che diventi un vettore XSS al click.
  function safeHref(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (_) {}
    return '';
  }

  async function patch(id, payload, optimistic) {
    const item = all.find((f) => f._id === id);
    if (!item) return;
    const prev = { status: item.status, notes: item.notes };
    Object.assign(item, optimistic);
    applyFilter();
    try {
      await SN_FEEDBACK.updateStatus(id, payload);
    } catch (e) {
      Object.assign(item, prev);
      applyFilter();
      alert('Errore: ' + (e?.message || e));
    }
  }

  function actionsFor(f) {
    const tab = statusOf(f);
    if (tab === 'agent') {
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="todo">→ Da risolvere</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="done">✓ Risolto</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="ignored">Ignora</button>
      `;
    }
    if (tab === 'inbox') {
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="todo">→ Da risolvere</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="draft">→ Bozze</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="ignored">Ignora</button>
      `;
    }
    if (tab === 'draft') {
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="todo">→ Da risolvere</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="new">← Ricevuti</button>
      `;
    }
    if (tab === 'todo') {
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="done">✓ Risolto</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="draft">→ Bozze</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="new">← Ricevuti</button>
      `;
    }
    if (tab === 'done') {
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="verified">✓ Verificato</button>
        <button class="sn-btn sn-btn-secondary fb-reopen-start" data-id="${escapeHtml(f._id)}">Riapri</button>
      `;
    }
    if (tab === 'verified') {
      return `<button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="done">← Risolti</button>`;
    }
    return '';
  }

  function render(items) {
    countEl.textContent = items.length ? `${items.length} feedback` : '';
    if (!items.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.textContent = {
        inbox: 'Nessun feedback in arrivo.',
        agent: 'Nessuna issue trovata dagli agenti.',
        draft: 'Nessuna bozza in attesa di decisioni.',
        todo: 'Nessun feedback da risolvere.',
        done: 'Nessun feedback risolto.',
        verified: 'Nessun feedback verificato.',
      }[currentTab] || 'Nessun feedback.';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = items.map((f) => {
      const when = fmtTs(f.createdAt || f._createTime);
      const url = f.url || '';
      const safeUrl = safeHref(url);
      const ua = (f.userAgent || '').slice(0, 80);
      const cid = (f.clientId || '').slice(0, 12);
      const text = escapeHtml(f.text || '(senza testo)');
      const imgs = Array.isArray(f.images) ? f.images.filter((u) => typeof u === 'string' && u) : [];
      const imgsHtml = imgs.length
        ? `<div class="fb-imgs">${imgs.map((u) => `<img src="${escapeHtml(u)}" data-full="${escapeHtml(u)}" loading="lazy" alt="">`).join('')}</div>`
        : '';
      // Issue d'agente: badge col modello che l'ha trovata + severità/area + titolo.
      const agent = isAgent(f);
      const am = agent ? agentMeta(f) : null;
      const agentHtml = agent ? `
        <div class="fb-badges">
          <span class="fb-badge fb-badge--model" title="Modello che ha trovato l'errore">🤖 ${escapeHtml(am.model)}</span>
          ${am.severity ? `<span class="fb-badge fb-badge--${escapeHtml(am.severity)}">${escapeHtml(am.severity)}</span>` : ''}
          ${am.area ? `<span class="fb-badge">${escapeHtml(am.area)}</span>` : ''}
        </div>
        ${am.title ? `<div class="fb-title">${escapeHtml(am.title)}</div>` : ''}` : '';
      const notesEditable = currentTab === 'todo' || currentTab === 'draft' || currentTab === 'agent';
      const notesBlock = notesEditable
        ? `<label class="fb-notes-label">Note / decisioni di design:
             <textarea class="fb-notes" data-id="${escapeHtml(f._id)}" rows="3" placeholder="Dettagli aggiuntivi, vincoli, scelte di design…">${escapeHtml(f.notes || '')}</textarea>
           </label>`
        : (f.notes ? `<div class="fb-notes-readonly">${escapeHtml(f.notes)}</div>` : '');
      return `
        <article class="fb-card fb-card--${statusOf(f)}${agent ? ' fb-card--agent' : ''}">
          <div class="fb-meta">
            <span>${escapeHtml(when)}</span>
            ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(url).slice(0, 80)}</a>` : (url ? `<span title="${escapeHtml(url)}">${escapeHtml(url).slice(0, 80)}</span>` : '')}
            ${!agent && cid ? `<span>client: ${escapeHtml(cid)}</span>` : ''}
            ${!agent && ua ? `<span title="${escapeHtml(ua)}">UA</span>` : ''}
          </div>
          ${agentHtml}
          <div class="fb-text">${text}</div>
          ${imgsHtml}
          ${notesBlock}
          <div class="fb-actions">${actionsFor(f)}</div>
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('.fb-imgs img').forEach((img) => {
      img.addEventListener('error', () => {
        // Sostituisce il box vuoto con un placeholder testuale; senza, l'utente
        // vede una griglia di rettangoli rotti e non capisce.
        const ph = document.createElement('div');
        ph.className = 'fb-img-broken';
        ph.textContent = '(immagine non disponibile)';
        ph.title = img.dataset.full || '';
        img.replaceWith(ph);
      });
      img.addEventListener('click', () => {
        lightboxImg.src = img.dataset.full;
        lightbox.classList.add('open');
      });
    });

    listEl.querySelectorAll('.fb-act').forEach((b) => {
      b.addEventListener('click', () => {
        const to = b.dataset.to; // 'todo' | 'done' | 'new' | 'ignored'
        const id = b.dataset.id;
        const payload = { status: to };
        // Quando passo da inbox a "todo", porto con me eventuali note già digitate.
        const ta = listEl.querySelector(`.fb-notes[data-id="${id}"]`);
        if (ta) payload.notes = ta.value;
        patch(id, payload, { status: to, notes: payload.notes });
      });
    });

    // "Riapri" non cambia subito lo status: apre un form inline dove l'utente
    // può spiegare meglio cosa non funziona. La spiegazione viene appesa alle
    // note esistenti (con separatore + timestamp), così il commento del primo
    // agente che ha lavorato al feedback resta visibile anche dopo la riapertura.
    listEl.querySelectorAll('.fb-reopen-start').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const card = b.closest('.fb-card');
        const actionsDiv = card && card.querySelector('.fb-actions');
        if (!actionsDiv) return;
        actionsDiv.innerHTML = `
          <div class="fb-reopen-form">
            <label class="fb-notes-label">Cosa non va / cosa manca:
              <textarea class="fb-reopen-text" rows="3" placeholder="Spiega meglio il problema, allega contesto, indica passi per riprodurre…"></textarea>
            </label>
            <div class="fb-reopen-buttons">
              <button type="button" class="sn-btn sn-btn-secondary fb-reopen-cancel">Annulla</button>
              <button type="button" class="sn-btn fb-reopen-confirm">Conferma riapertura</button>
            </div>
          </div>
        `;
        const ta = actionsDiv.querySelector('.fb-reopen-text');
        ta.focus();
        // Esc annulla, Ctrl/Cmd+Enter conferma — più comodo che cliccare.
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            applyFilter();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            actionsDiv.querySelector('.fb-reopen-confirm').click();
          }
        });
        actionsDiv.querySelector('.fb-reopen-cancel').addEventListener('click', () => {
          applyFilter(); // ridisegna la card con le azioni originali
        });
        actionsDiv.querySelector('.fb-reopen-confirm').addEventListener('click', () => {
          const item = all.find((f) => f._id === id);
          const oldNotes = (item && item.notes) || '';
          const reason = ta.value.trim();
          let newNotes = oldNotes;
          if (reason) {
            const ts = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
            const block = `--- Riaperto il ${ts} ---\n${reason}`;
            newNotes = oldNotes ? `${oldNotes}\n\n${block}` : block;
          }
          patch(id, { status: 'new', notes: newNotes }, { status: 'new', notes: newNotes });
        });
      });
    });

    // Salvataggio note: debounce su blur.
    listEl.querySelectorAll('.fb-notes').forEach((ta) => {
      let timer;
      const flush = () => {
        const id = ta.dataset.id;
        const item = all.find((f) => f._id === id);
        if (!item || item.notes === ta.value) return;
        patch(id, { notes: ta.value }, { notes: ta.value });
      };
      ta.addEventListener('blur', flush);
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 1500);
      });
    });
  }

  function applyFilter() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const base = all.filter((f) => statusOf(f) === currentTab);
    const filtered = q
      ? base.filter((f) => [f.text, f.url, f.clientId, f.userAgent, f.notes].join(' ').toLowerCase().includes(q))
      : base;
    updateTabCounts();
    render(filtered);
  }

  function updateTabCounts() {
    const counts = { inbox: 0, agent: 0, draft: 0, todo: 0, done: 0, verified: 0 };
    for (const f of all) {
      const s = statusOf(f);
      if (s in counts) counts[s]++;
    }
    for (const [tab, n] of Object.entries(counts)) {
      const btn = tabsEl.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
      const label = { inbox: 'Ricevuti', agent: 'Agente', draft: 'Bozze', todo: 'Da risolvere', done: 'Risolti', verified: 'Verificati' }[tab];
      btn.textContent = `${label} (${n})`;
    }
  }

  async function load() {
    listEl.innerHTML = '<div class="fb-empty">Caricamento…</div>';
    emptyEl.hidden = true;
    try {
      all = await SN_FEEDBACK.list({ pageSize: 500 });
      applyFilter();
    } catch (e) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.textContent = 'Errore caricamento: ' + (e?.message || e);
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    tabsEl.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('fb-tab--active', b === btn);
    });
    applyFilter();
  });

  function closeLightbox() {
    if (!lightbox.classList.contains('open')) return;
    lightbox.classList.remove('open');
    // Sgancia la src così alla prossima apertura non si vede per un istante
    // l'immagine precedente mentre quella nuova carica.
    lightboxImg.removeAttribute('src');
  }
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('open')) {
      e.stopPropagation();
      closeLightbox();
    }
  });
  refreshBtn.addEventListener('click', load);
  searchEl.addEventListener('input', applyFilter);

  load();
})();
