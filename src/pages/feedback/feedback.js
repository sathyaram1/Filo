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
  const adminBanner = document.getElementById('adminBanner');
  const adminBannerText = document.getElementById('adminBannerText');
  const adminSignInBtn = document.getElementById('adminSignIn');

  // Gestione feedback (sposta di stato, priorità, note) è riservata agli
  // amministratori: senza account autorizzato la pagina resta in sola lettura.
  // La garanzia forte è server-side (Firestore rules): qui è solo il gate UX,
  // e ogni scrittura passa comunque dal main process che rifiuta i non-admin.
  let isAdmin = false;

  // Invia un messaggio al main process. Su pagine filo:// è sempre presente.
  function sendToMain(msg) {
    if (window.filo?.message) return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // 'inbox' = ricevuti (status: new); 'draft' = bozze (richiedono decisioni di
  // design); 'todo' = da risolvere; 'clarify' = bloccati su ambiguità/info
  // mancanti (le routine cloud li spostano qui quando non possono procedere);
  // 'done' = risolti (in attesa di verifica); 'verified' = verificati dall'utente.
  // I 'ignored' restano nascosti (raggiungibili solo riaprendoli via DB).
  let all = [];
  let currentTab = 'inbox';

  // Ritrovamenti automatici → categoria "Agente". Due fonti:
  //   - agente esploratore LLM: clientId "agent:<model>" (vedi tests/agent/feedback.mjs);
  //   - audit proattivo di una routine cloud: clientId "routine:<slug>" e status
  //     `new` (l'audit deposita i ritrovamenti come `new`). I sub-feedback di una
  //     routine portano lo stesso prefisso ma nascono `todo`/`clarify`: NON sono
  //     ritrovamenti d'agente, quindi qui si escludono col vincolo su status.
  function isAgent(f) {
    const c = String(f.clientId || '');
    if (c.startsWith('agent:')) return true;
    if (c.startsWith('routine:') && (f.status || 'new') === 'new') return true;
    return false;
  }
  // Origine del feedback (per la colorazione di card/bolle). Delega alla logica
  // condivisa così dashboard e main usano la stessa classificazione.
  function originOf(f) {
    const c = String(f.clientId || '');
    if (window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.originOf) return SN_FEEDBACK_THREAD.originOf(c);
    if (c.startsWith('owner:')) return 'owner';
    if (c.startsWith('agent:')) return 'agent';
    if (c.startsWith('routine:')) return 'routine';
    return 'user';
  }
  // Decodifica i metadati del ritrovamento per il badge. L'agente esploratore
  // codifica "severità|area|titolo" nel campo `title`; l'audit di una routine no
  // (il titolo breve sta in `name`), quindi lo trattiamo a parte.
  function agentMeta(f) {
    const c = String(f.clientId || '');
    if (c.startsWith('routine:')) {
      const slug = c.slice('routine:'.length) || 'routine';
      return { source: 'routine', model: slug, severity: '', area: '', title: String(f.name || '').trim() };
    }
    const model = c.slice('agent:'.length) || '?';
    const parts = String(f.title || '').split('|');
    const severity = parts.length >= 3 ? parts[0].trim() : '';
    const area = parts.length >= 3 ? parts[1].trim() : '';
    const title = parts.length >= 3 ? parts.slice(2).join('|').trim() : (f.title || '');
    return { source: 'agent', model, severity, area, title };
  }

  // Priorità 1-3 (0 = nessuna). Più pallini pieni = priorità più alta: le
  // routine di Claude affrontano prima i feedback con priorità maggiore.
  function priorityOf(f) {
    const p = Math.round(Number(f.priority) || 0);
    return p >= 1 && p <= 3 ? p : 0;
  }

  function priorityDotsHtml(f) {
    const p = priorityOf(f);
    // Non-admin: pallini decorativi (sola lettura), nessun click.
    const dots = [1, 2, 3].map((n) => {
      const on = n <= p ? ' fb-dot--on' : '';
      if (!isAdmin) {
        return `<span class="fb-dot fb-dot--readonly${on}" aria-label="Priorità ${n}"></span>`;
      }
      return `<button type="button" class="fb-dot${on}" data-id="${escapeHtml(f._id)}" data-n="${n}" title="Priorità ${n}${p === n ? ' (clic per azzerare)' : ''}" aria-label="Priorità ${n}"></button>`;
    }).join('');
    return `<div class="fb-priority" title="Priorità: ${p || '—'}">${dots}</div>`;
  }

  // Badge "in lavorazione": una routine cloud ha preso in carico il feedback
  // (semaforo in scripts/claim-feedback.mjs, specchiato su Firestore dall'applier).
  // Mostrato solo finché il claim non è scaduto; '' / scaduto = libero.
  function claimBadgeHtml(f) {
    const exp = Date.parse(f.claimExpiresAt || '');
    if (!Number.isFinite(exp) || exp <= Date.now()) return '';
    const who = String(f.claimedBy || '').slice(0, 40);
    const title = `Una routine ci sta lavorando${who ? ` (${who})` : ''} — scade ${fmtTs(f.claimExpiresAt)}`;
    return `<span class="fb-claim" title="${escapeHtml(title)}">🔧 in lavorazione</span>`;
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
    if (s === 'clarify') return 'clarify';
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

  // ── Allegati nei commenti (#190.3) ─────────────────────────────────────────
  // L'admin può incollare/trascinare/allegare immagini e file MENTRE commenta un
  // feedback (note di triage, risposta nei Chiarimenti, riapertura). Gli allegati
  // sono ANCORATI al singolo turno: vivono come righe-marcatore dentro `notes`
  // (vedi SN_FEEDBACK_THREAD), così non serve cambiare lo schema Firestore né le
  // regole. L'upload va diretto a Storage (path feedback/* è pubblico).
  const ATTACH_MAX_IMAGES = 5;
  const ATTACH_MAX_FILES = 5;
  const ATTACH_MAX_BYTES = 4 * 1024 * 1024;
  const ATTACH_ACCEPT = 'image/*,application/pdf,application/json,text/*,.pdf,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml';

  const FILE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s);
  }

  // Griglia di immagini (riusata da segnalazione e turni della conversazione).
  function imagesGridHtml(urls) {
    const imgs = (urls || []).filter((u) => typeof u === 'string' && u);
    if (!imgs.length) return '';
    return `<div class="fb-imgs">${imgs.map((u) => `<img src="${escapeHtml(u)}" data-full="${escapeHtml(u)}" loading="lazy" alt="">`).join('')}</div>`;
  }

  // Lista di allegati non-immagine come link scaricabili (nome originale).
  function filesListHtml(files) {
    const fs = (files || []).filter((x) => x && typeof x.url === 'string' && x.url);
    if (!fs.length) return '';
    return `<div class="fb-files">${fs.map((x) => `<a class="fb-file" href="${escapeHtml(safeHref(x.url) || '#')}" target="_blank" rel="noopener" download="${escapeHtml(x.name || '')}">${FILE_SVG}<span class="fb-file-name">${escapeHtml(x.name || 'allegato')}</span></a>`).join('')}</div>`;
  }

  function humanSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Crea un compositore di allegati legato a una textarea. Inserisce in `mount`
  // un pulsante "Allega" + le thumbnail; intercetta incolla/trascina sulla
  // textarea. Ogni file viene caricato SUBITO su Storage (così le note salvano
  // solo l'URL). onChange() è chiamato dopo ogni aggiunta/rimozione — chi vuole
  // persistenza immediata (note editabili) lo usa per fare patch.
  // Ritorna { getAttachments } che torna la lista corrente { kind, url, name, type }.
  function makeAttachComposer({ textarea, mount, initial, onChange }) {
    if (!textarea || !mount) return { getAttachments: () => [] };
    const attachments = Array.isArray(initial) ? initial.slice() : [];

    const thumbs = document.createElement('div');
    thumbs.className = 'fb-attach-thumbs';
    const bar = document.createElement('div');
    bar.className = 'fb-attach-bar';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sn-btn sn-btn-secondary fb-attach-btn';
    btn.textContent = '+ Allega';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = ATTACH_ACCEPT;
    fileInput.hidden = true;
    const status = document.createElement('div');
    status.className = 'fb-attach-status';
    status.setAttribute('aria-live', 'polite');
    bar.appendChild(btn);
    bar.appendChild(fileInput);
    bar.appendChild(status);
    mount.appendChild(thumbs);
    mount.appendChild(bar);

    let uploading = 0;
    const setStatus = (m) => { status.textContent = m || ''; };
    function counts() {
      let imgs = 0, files = 0;
      for (const a of attachments) (a.kind === 'img' ? imgs++ : files++);
      return { imgs, files };
    }

    function renderThumbs() {
      thumbs.innerHTML = '';
      attachments.forEach((a, i) => {
        if (a.kind === 'img') {
          const wrap = document.createElement('div');
          wrap.className = 'fb-attach-thumb';
          const im = document.createElement('img');
          im.src = a.url; im.alt = '';
          im.title = 'Clic per ingrandire';
          im.addEventListener('click', () => { lightboxImg.src = a.url; lightbox.classList.add('open'); });
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'fb-attach-x'; x.textContent = '×';
          x.setAttribute('aria-label', 'Rimuovi');
          x.addEventListener('click', () => { attachments.splice(i, 1); renderThumbs(); if (typeof onChange === 'function') onChange(); });
          wrap.appendChild(im); wrap.appendChild(x);
          thumbs.appendChild(wrap);
        } else {
          const chip = document.createElement('div');
          chip.className = 'fb-attach-chip';
          chip.title = a.name || 'allegato';
          const ic = document.createElement('span');
          ic.className = 'fb-attach-ic';
          ic.innerHTML = FILE_SVG;
          const nm = document.createElement('span');
          nm.className = 'fb-attach-name';
          nm.textContent = a.name || 'allegato';
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'fb-attach-x'; x.textContent = '×';
          x.setAttribute('aria-label', 'Rimuovi');
          x.addEventListener('click', () => { attachments.splice(i, 1); renderThumbs(); if (typeof onChange === 'function') onChange(); });
          chip.appendChild(ic); chip.appendChild(nm); chip.appendChild(x);
          thumbs.appendChild(chip);
        }
      });
    }

    async function addFile(file) {
      if (!file) return;
      const isImg = (file.type || '').startsWith('image/');
      const c = counts();
      if (isImg && c.imgs >= ATTACH_MAX_IMAGES) { setStatus(`Massimo ${ATTACH_MAX_IMAGES} immagini.`); return; }
      if (!isImg && c.files >= ATTACH_MAX_FILES) { setStatus(`Massimo ${ATTACH_MAX_FILES} file.`); return; }
      if (file.size > ATTACH_MAX_BYTES) { setStatus(`«${file.name || 'file'}» troppo grande (max 4 MB).`); return; }
      if (!window.SN_FEEDBACK?.uploadAttachment) { setStatus('Upload non disponibile.'); return; }
      uploading++; btn.disabled = true; setStatus('Caricamento…');
      try {
        const att = await SN_FEEDBACK.uploadAttachment(file, file.name);
        attachments.push(att);
        renderThumbs();
        setStatus('');
        if (typeof onChange === 'function') onChange();
      } catch (e) {
        setStatus('Caricamento non riuscito: ' + (e?.message || e));
      } finally {
        uploading = Math.max(0, uploading - 1);
        if (uploading === 0) btn.disabled = false;
      }
    }

    btn.addEventListener('click', () => { try { fileInput.click(); } catch (_) {} });
    fileInput.addEventListener('change', async () => {
      const picked = Array.from(fileInput.files || []);
      for (const f of picked) await addFile(f);
      fileInput.value = '';
    });
    // Incolla (Ctrl+V): cattura SOLO i file dagli appunti (le immagini), lascia
    // passare il testo normale.
    textarea.addEventListener('paste', async (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const blobs = [];
      for (const it of items) {
        if (it.kind === 'file') { const b = it.getAsFile(); if (b) blobs.push(b); }
      }
      if (blobs.length) { e.preventDefault(); for (const b of blobs) await addFile(b); }
    });
    ['dragenter', 'dragover'].forEach((ev) => textarea.addEventListener(ev, (e) => { e.preventDefault(); textarea.classList.add('fb-drop-hover'); }));
    ['dragleave', 'drop'].forEach((ev) => textarea.addEventListener(ev, (e) => { textarea.classList.remove('fb-drop-hover'); }));
    textarea.addEventListener('drop', async (e) => {
      const dropped = e.dataTransfer && e.dataTransfer.files;
      if (!dropped || !dropped.length) return;
      e.preventDefault();
      for (const f of dropped) await addFile(f);
    });

    renderThumbs();
    return { getAttachments: () => attachments.slice() };
  }

  // Valore da salvare per una textarea di note editabili: testo + allegati del
  // compositore ri-incorporati come righe-marcatore (vedi composeNotes).
  function notesValueOf(ta) {
    if (!ta) return '';
    const atts = ta._attachComposer ? ta._attachComposer.getAttachments() : [];
    if (window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.composeNotes) {
      return SN_FEEDBACK_THREAD.composeNotes(ta.value, atts);
    }
    return ta.value;
  }

  async function patch(id, payload, optimistic) {
    if (!isAdmin) {
      alert('Operazione riservata agli amministratori: accedi con un account autorizzato.');
      return;
    }
    const item = all.find((f) => f._id === id);
    if (!item) return;
    const prev = { status: item.status, notes: item.notes, priority: item.priority };
    Object.assign(item, optimistic);
    applyFilter();
    try {
      // Instradata dal main process, che allega il Firebase ID token come
      // Bearer e rifiuta se l'utente loggato non è admin (i token non sono mai
      // esposti alle pagine — vedi SECURITY.md §3).
      const r = await sendToMain({ type: 'feedback_update', id, ...payload });
      if (!r || r.ok === false) throw new Error(r?.error || 'aggiornamento rifiutato');
    } catch (e) {
      Object.assign(item, prev);
      applyFilter();
      alert('Errore: ' + (e?.message || e));
    }
  }

  function actionsFor(f) {
    // Non-admin: niente pulsanti d'azione (sola lettura).
    if (!isAdmin) return '';
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
    if (tab === 'clarify') {
      // L'utente legge le domande di Filo (bolle) e risponde col composer
      // "Invia risposta" (che riporta il feedback in "Da risolvere"); in
      // alternativa lo sposta a mano in Bozze (scelta di design) o lo ignora.
      return `
        <button class="sn-btn fb-act" data-id="${escapeHtml(f._id)}" data-to="todo">→ Da risolvere</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="draft">→ Bozze</button>
        <button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="ignored">Ignora</button>
      `;
    }
    if (tab === 'verified') {
      return `<button class="sn-btn sn-btn-secondary fb-act" data-id="${escapeHtml(f._id)}" data-to="done">← Risolti</button>`;
    }
    return '';
  }

  // Cattura il campo (textarea/input) attualmente a fuoco dentro la lista, se
  // identificabile da data-id, così da poterlo riselezionare dopo un re-render.
  // Senza questo, salvare le note (patch → applyFilter → render rigenera tutto
  // l'innerHTML) faceva perdere fuoco e cursore: l'utente smetteva di scrivere
  // per un attimo e la casella si "deselezionava" da sola.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !listEl.contains(el)) return null;
    const id = el.dataset && el.dataset.id;
    if (!id) return null;
    // Distingue le textarea con stesso data-id (es. note) dalla classe.
    const cls = el.classList && el.classList.contains('fb-notes') ? 'fb-notes' : null;
    if (!cls) return null;
    return {
      cls,
      id,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
      scrollTop: el.scrollTop || 0,
    };
  }

  function restoreFocus(snap) {
    if (!snap) return;
    const sel = `.${snap.cls}[data-id="${(window.CSS && CSS.escape) ? CSS.escape(snap.id) : snap.id}"]`;
    const el = listEl.querySelector(sel);
    if (!el) return;
    el.focus();
    if (snap.start != null && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(snap.start, snap.end ?? snap.start); } catch (_) {}
    }
    el.scrollTop = snap.scrollTop;
  }

  function render(items) {
    const focusSnap = captureFocus();
    countEl.textContent = items.length ? `${items.length} feedback` : '';
    if (!items.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.textContent = {
        inbox: 'Nessun feedback in arrivo.',
        agent: 'Nessun ritrovamento automatico (agente esploratore o audit delle routine).',
        draft: 'Nessuna bozza in attesa di decisioni.',
        todo: 'Nessun feedback da risolvere.',
        clarify: 'Nessun feedback in attesa di chiarimenti.',
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
      // Allegati della SEGNALAZIONE originale: vivono nei campi piatti images/files.
      const imgsHtml = imagesGridHtml(Array.isArray(f.images) ? f.images : []);
      const filesHtml = filesListHtml(Array.isArray(f.files) ? f.files : []);
      const origin = originOf(f);
      // Numero progressivo (#22, #22.1 per i sub creati dalle routine).
      const num = SN_FEEDBACK.formatNum(f.seq, f.subSeq);
      const numHtml = num ? `<span class="fb-num">#${escapeHtml(num)}</span>` : '';
      // Ritrovamento automatico (tab "Agente"): badge che distingue la fonte —
      // 🤖 <modello> per l'agente esploratore LLM, 🔧 audit · <slug> per le
      // routine cloud — + severità/area (solo agente) + titolo col numero.
      const agent = isAgent(f);
      const am = agent ? agentMeta(f) : null;
      const isRoutineFind = am && am.source === 'routine';
      const agentIcon = isRoutineFind ? '🔧' : '🤖';
      const agentLabel = am ? (isRoutineFind ? `audit · ${am.model}` : am.model) : '';
      const agentBadgeTitle = isRoutineFind ? 'Audit automatico di una routine cloud' : "Modello che ha trovato l'errore";
      const agentTitleHtml = am && (am.title || num)
        ? `<div class="fb-title">${numHtml}${numHtml && am.title ? ' ' : ''}${escapeHtml(am.title)}</div>` : '';
      const agentHtml = agent ? `
        <div class="fb-badges">
          <span class="fb-badge fb-badge--model" title="${escapeHtml(agentBadgeTitle)}">${agentIcon} ${escapeHtml(agentLabel)}</span>
          ${am.severity ? `<span class="fb-badge fb-badge--${escapeHtml(am.severity)}">${escapeHtml(am.severity)}</span>` : ''}
          ${am.area ? `<span class="fb-badge">${escapeHtml(am.area)}</span>` : ''}
        </div>
        ${agentTitleHtml}` : '';
      // Titolo breve (#22 + nome generato dall'LLM all'invio) per i feedback
      // non-agente; le issue d'agente hanno già il loro titolo in agentHtml.
      const titleHtml = !agent && (num || f.name)
        ? `<div class="fb-title">${numHtml}${numHtml && f.name ? ' ' : ''}${escapeHtml(f.name || '')}</div>`
        : '';
      // Conversazione a turni (#108): segnalazione + risposte di Filo + risposte
      // dell'utente in BOLLE diverse, in ordine cronologico, invece di un unico
      // blocco. Gli allegati vivono nella bolla della segnalazione.
      const turns = window.SN_FEEDBACK_THREAD ? SN_FEEDBACK_THREAD.parse(f) : [];
      const convoTurns = turns.filter((t) => t.kind !== 'report');
      const reportRole = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.isFromModel(f.clientId) ? 'model' : 'user';
      const reportWho = reportRole === 'model' ? 'Agente' : 'Segnalazione';
      // Note editabili (textarea) dove l'admin sta lavorando: ricevuti/todo/
      // bozze/agente. "Ricevuti" è incluso così si può COMMENTARE un feedback
      // appena arrivato e poi spostarlo in "Da risolvere" (il commento viaggia
      // col cambio di stato — vedi il gestore .fb-act). Altrove (risolti/
      // verificati/chiarimenti) le note di Filo restano bolle di sola lettura —
      // se mostrassi anche la textarea, lo stesso testo comparirebbe due volte.
      const notesEditable = isAdmin && (currentTab === 'inbox' || currentTab === 'todo' || currentTab === 'draft' || currentTab === 'agent');
      const clarifyReply = isAdmin && currentTab === 'clarify';
      const showConvo = !notesEditable;
      const reportBubble = `
        <div class="fb-bubble fb-bubble--report fb-bubble--${reportRole} fb-bubble--origin-${origin}">
          <div class="fb-bubble-head"><span class="fb-bubble-who">${reportWho}</span></div>
          <div class="fb-bubble-body">${text}</div>
          ${imgsHtml}
          ${filesHtml}
        </div>`;
      const convoHtml = showConvo
        ? convoTurns.map((t) => {
            const who = t.kind === 'note' ? 'Filo' : 'Tu';
            const tsLabel = t.ts ? `<span>${escapeHtml(String(t.ts))}</span>` : '';
            // Allegati ANCORATI a questo turno (#190.3): immagini + file separati.
            const atts = Array.isArray(t.attachments) ? t.attachments : [];
            const tImgs = atts.filter((a) => a && a.kind === 'img').map((a) => a.url);
            const tFiles = atts.filter((a) => a && a.kind === 'file');
            const bodyHtml = t.body ? `<div class="fb-bubble-body">${escapeHtml(t.body)}</div>` : '';
            return `
              <div class="fb-bubble fb-bubble--${t.role}">
                <div class="fb-bubble-head"><span class="fb-bubble-who">${who}</span>${tsLabel}</div>
                ${bodyHtml}
                ${imagesGridHtml(tImgs)}
                ${filesListHtml(tFiles)}
              </div>`;
          }).join('')
        : '';
      const threadHtml = `<div class="fb-thread">${reportBubble}${convoHtml}</div>`;
      // Su "Ricevuti" la casella è un COMMENTO al volo (poi sposti in "Da
      // risolvere"); altrove è la nota di triage/decisioni di design.
      const notesLabelText = currentTab === 'inbox' ? 'Commento:' : 'Note / decisioni di design:';
      const notesPlaceholder = currentTab === 'inbox'
        ? 'Aggiungi un commento… (verrà conservato quando sposti il feedback in "Da risolvere")'
        : 'Dettagli aggiuntivi, vincoli, scelte di design…';
      // La textarea mostra la PROSA pulita (senza le righe-marcatore degli
      // allegati): quelle vivono come thumbnail nel compositore qui sotto.
      const notesStripped = window.SN_FEEDBACK_THREAD && SN_FEEDBACK_THREAD.stripAttachments
        ? SN_FEEDBACK_THREAD.stripAttachments(f.notes)
        : { text: String(f.notes || ''), attachments: [] };
      const notesBlock = notesEditable
        ? `<label class="fb-notes-label">${notesLabelText}
             <textarea class="fb-notes" data-id="${escapeHtml(f._id)}" rows="3" placeholder="${escapeHtml(notesPlaceholder)}">${escapeHtml(notesStripped.text || '')}</textarea>
           </label>
           <div class="fb-attach-mount" data-id="${escapeHtml(f._id)}" data-kind="notes"></div>`
        : '';
      // Tab Chiarimenti: rispondi alle domande di Filo come un turno di chat. La
      // risposta si APPENDE allo storico (conserva la domanda) e il feedback
      // torna "Da risolvere" perché una routine (o tu) lo riprenda.
      const replyBlock = clarifyReply
        ? `<div class="fb-reply">
             <label class="fb-notes-label">La tua risposta:
               <textarea class="fb-reply-text" data-id="${escapeHtml(f._id)}" rows="3" placeholder="Rispondi alle domande di Filo qui sopra…"></textarea>
             </label>
             <div class="fb-reply-buttons">
               <button type="button" class="sn-btn fb-reply-send" data-id="${escapeHtml(f._id)}">Invia risposta</button>
             </div>
           </div>`
        : '';
      return `
        <article class="fb-card fb-card--${statusOf(f)} fb-card--origin-${origin}${agent ? ' fb-card--agent' : ''}">
          <div class="fb-meta">
            <span>${escapeHtml(when)}</span>
            ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(url).slice(0, 80)}</a>` : (url ? `<span title="${escapeHtml(url)}">${escapeHtml(url).slice(0, 80)}</span>` : '')}
            ${!agent && cid ? `<span>client: ${escapeHtml(cid)}</span>` : ''}
            ${!agent && ua ? `<span title="${escapeHtml(ua)}">UA</span>` : ''}
            ${claimBadgeHtml(f)}
            ${priorityDotsHtml(f)}
          </div>
          ${agentHtml}${titleHtml}
          ${threadHtml}
          ${notesBlock}
          ${replyBlock}
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

    // Composer "Invia risposta" del tab Chiarimenti: appende la risposta
    // dell'utente come turno (conservando la domanda di Filo nello storico) e
    // rimette il feedback in "Da risolvere" perché una routine lo riprenda.
    listEl.querySelectorAll('.fb-reply-send').forEach((btn) => {
      const id = btn.dataset.id;
      const card = btn.closest('.fb-card');
      const ta = card && card.querySelector('.fb-reply-text');
      const send = () => {
        const reply = ta ? ta.value.trim() : '';
        if (!reply) { if (ta) ta.focus(); return; }
        const item = all.find((f) => f._id === id);
        const oldNotes = (item && item.notes) || '';
        const newNotes = window.SN_FEEDBACK_THREAD
          ? SN_FEEDBACK_THREAD.appendUserTurn(oldNotes, reply)
          : (oldNotes ? `${oldNotes}\n\n${reply}` : reply);
        patch(id, { status: 'todo', notes: newNotes }, { status: 'todo', notes: newNotes });
      };
      btn.addEventListener('click', send);
      // Ctrl/Cmd+Enter invia (come negli altri composer di Filo).
      if (ta) ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      });
    });

    // Pallini priorità: clic sul pallino N imposta priorità = N; ri-clic sul
    // pallino già attivo (== priorità corrente) la azzera.
    listEl.querySelectorAll('.fb-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const id = dot.dataset.id;
        const n = Number(dot.dataset.n);
        const item = all.find((f) => f._id === id);
        const cur = item ? priorityOf(item) : 0;
        const next = cur === n ? 0 : n;
        patch(id, { priority: next }, { priority: next });
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

    // Riseleziona la casella che aveva il fuoco prima del re-render (vedi
    // captureFocus): salvare le note non deve più "deselezionare" il campo.
    restoreFocus(focusSnap);
  }

  function applyFilter() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const base = all.filter((f) => statusOf(f) === currentTab);
    const filtered = q
      ? base.filter((f) => {
          const num = SN_FEEDBACK.formatNum(f.seq, f.subSeq);
          return [f.text, f.url, f.clientId, f.userAgent, f.notes, f.name, num ? `#${num}` : '']
            .join(' ').toLowerCase().includes(q);
        })
      : base;
    if (currentTab === 'done') {
      // Tab "Risolti": ordina per numero (#1, #2, … #22.1, #22.2). I feedback
      // senza numero (seq assente) finiscono in coda. Confronto numerico su
      // seq e poi subSeq, così #22.2 viene dopo #22.10? No: numerico, quindi
      // #22.2 < #22.10 — l'ordine "umano" atteso per i sub-feedback.
      const numKey = (f) => {
        const seq = Number(f.seq);
        const sub = Number(f.subSeq);
        return {
          seq: Number.isFinite(seq) ? seq : Infinity,
          sub: Number.isFinite(sub) ? sub : 0,
        };
      };
      filtered.sort((a, b) => {
        const ka = numKey(a);
        const kb = numKey(b);
        return ka.seq - kb.seq || ka.sub - kb.sub;
      });
    } else {
      // Priorità più alta in cima. `all` è già ordinato per data DESC e il sort
      // di JS è stabile, quindi a parità di priorità restano i più recenti prima.
      filtered.sort((a, b) => priorityOf(b) - priorityOf(a));
    }
    updateTabCounts();
    render(filtered);
  }

  function updateTabCounts() {
    const counts = { inbox: 0, agent: 0, draft: 0, todo: 0, clarify: 0, done: 0, verified: 0 };
    for (const f of all) {
      const s = statusOf(f);
      if (s in counts) counts[s]++;
    }
    for (const [tab, n] of Object.entries(counts)) {
      const btn = tabsEl.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
      const label = { inbox: 'Ricevuti', agent: 'Agente', draft: 'Bozze', todo: 'Da risolvere', clarify: 'Chiarimenti', done: 'Risolti', verified: 'Verificati' }[tab];
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

  // ── Stato admin ──────────────────────────────────────────────────────────
  function renderAuthState(profile) {
    if (adminBanner) adminBanner.hidden = isAdmin;
    if (!isAdmin && adminBannerText) {
      // Distingui "non loggato" da "loggato ma non admin": il secondo non può
      // diventare admin cliccando Accedi, quindi nascondiamo il pulsante.
      if (profile?.email) {
        adminBannerText.textContent = `Sei in sola lettura: l'account ${profile.email} non è un amministratore.`;
        if (adminSignInBtn) adminSignInBtn.hidden = true;
      } else {
        adminBannerText.textContent = 'Sei in sola lettura. Accedi con un account amministratore per gestire i feedback (spostare di stato, priorità, note).';
        if (adminSignInBtn) adminSignInBtn.hidden = false;
      }
    }
  }

  async function refreshAuth() {
    try {
      const r = await sendToMain({ type: 'auth_status' });
      isAdmin = Boolean(r?.isAdmin);
      renderAuthState(r?.profile);
    } catch (_) {
      isAdmin = false;
      renderAuthState(null);
    }
  }

  if (adminSignInBtn) {
    adminSignInBtn.addEventListener('click', async () => {
      adminSignInBtn.disabled = true;
      try {
        const r = await sendToMain({ type: 'auth_signin' });
        isAdmin = Boolean(r?.isAdmin);
        renderAuthState(r?.profile);
        applyFilter(); // ridisegna con/senza controlli admin
        if (r?.ok === false) alert('Accesso non riuscito: ' + (r.error || 'errore sconosciuto'));
      } catch (e) {
        alert('Accesso non riuscito: ' + (e?.message || e));
      } finally {
        adminSignInBtn.disabled = false;
      }
    });
  }

  // Reagisci al login/logout fatto altrove (es. dal pulsante account della shell).
  if (window.filo?.onBroadcast) {
    window.filo.onBroadcast((m) => {
      if (m?.type === 'auth_changed') {
        isAdmin = Boolean(m.isAdmin);
        renderAuthState(m.profile);
        applyFilter();
      }
    });
  }

  // Carica prima lo stato admin, poi i feedback: così il primo render già
  // mostra (o nasconde) i controlli di gestione in modo coerente.
  refreshAuth().finally(load);
})();
