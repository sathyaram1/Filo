// Dashboard Filo (new tab). Controller UI.
//
// Stati visibili:
//   - "home"   → messaggio centrale proattivo + suggerimenti pieni
//   - "thread" → conversazione in corso (bolle). Colonna sx collassa a icone.
//
// Ogni nuova query dalla home apre un nuovo thread (vedi spec sezione 2.1).
// Niente persistenza cross-tab del thread: ad ogni nuovo new-tab si riparte
// dalla home. Il "raw log" tiene memoria delle interazioni lato background.

(function () {
  'use strict';

  const { MSG } = self.SN_MSG;

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const homeMessageEl = $('homeMessage');
  const homeView = $('homeView');
  const threadView = $('threadView');
  const bubblesEl = $('bubbles');
  const suggestionsEl = $('suggestions');
  const expandBtn = $('expandBtn');
  const liveEl = $('live');
  const inputForm = $('inputForm');
  const inputEl = $('input');
  const sendBtn = $('sendBtn');
  const dashDir = $('dashDir');

  // ===== Stato locale =====
  let suggestions = [];
  let showHomeMessage = true; // commento centrale (disattivabile da Preferenze)
  let expanded = false;
  let threadHistory = []; // [{role: 'user'|'filo', text, actions?}]
  let sending = false;
  let liveTickHandle = null;
  let pendingImages = []; // dataUrl delle immagini incollate (multiple)

  // ===== Modalità terminale =====
  let terminalMode = false;          // attivabile da Preferenze
  let terminalShell = 'powershell';  // 'powershell' | 'cmd' | 'bash'
  let currentCwd = '';               // directory mostrata nella riga grigia

  // ===== Helpers messaggi =====
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'no response' }));
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // Applica il tema salvato (sovrascrive il "best effort" di pageBootstrap).
  async function applySavedTheme() {
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      if (!settings) return;
      window.SN_PAGE_THEME = settings.theme || 'system';
      let theme = settings.theme || 'system';
      if (theme === 'system') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.dataset.snTheme = theme;
    } catch (_) {}
  }

  // ===== Stato UI =====
  function goHome() {
    body.dataset.state = 'home';
    homeView.hidden = false;
    threadView.hidden = true;
    threadHistory = [];
    bubblesEl.innerHTML = '';
    inputEl.value = '';
    inputEl.focus();
  }

  function goThread() {
    body.dataset.state = 'thread';
    homeView.hidden = true;
    threadView.hidden = false;
  }


  // ===== Suggerimenti (colonna sinistra) =====
  function iconLabel(icon) {
    const map = {
      gmail: 'M', calendar: 'C', editor: 'E', file: 'F',
      link: '↗', note: '✎', web: '🌐',
    };
    return map[icon] || (icon ? icon[0].toUpperCase() : '·');
  }

  // Favicon di un sito a partire dall'URL. Usa il servizio Google s2 —
  // gratis, niente API key, regge i casi mancanti restituendo un'icona
  // grigia generica. Ritorna '' per URL non http(s) (es. file://, mailto:).
  function faviconUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
    } catch (_) { return ''; }
  }

  function renderSuggestions() {
    // Default visibili: importance >= 3, max 5. Espanso: max 12.
    const sorted = [...suggestions].sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const visible = expanded
      ? sorted.slice(0, 12)
      : sorted.filter((s) => (s.importance || 0) >= 3).slice(0, 5);
    suggestionsEl.innerHTML = '';
    for (const s of visible) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dash-suggestion';
      btn.title = s.text || '';
      const icon = document.createElement('span');
      icon.className = 'dash-sug-icon';
      icon.dataset.icon = s.icon || '';
      // Per le azioni NAVIGA mostriamo la favicon del sito al posto della
      // letterina generica: più riconoscibile a colpo d'occhio. Se la favicon
      // non carica (404/rete) torniamo all'iniziale.
      const navUrl = (String(s.action?.type || '').toUpperCase() === 'NAVIGA') ? s.action?.url : '';
      const favUrl = faviconUrl(navUrl);
      if (favUrl) {
        const img = document.createElement('img');
        img.className = 'dash-sug-favicon';
        img.src = favUrl;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { img.remove(); icon.textContent = iconLabel(s.icon); };
        icon.appendChild(img);
      } else {
        icon.textContent = iconLabel(s.icon);
      }
      const text = document.createElement('span');
      text.className = 'dash-sug-text';
      text.textContent = s.text || '';
      btn.appendChild(icon);
      btn.appendChild(text);
      btn.addEventListener('click', () => onSuggestionClick(s));
      li.appendChild(btn);
      suggestionsEl.appendChild(li);
    }
    // Espandibile solo se ci sono più di 5 elementi e qualcuno è sotto soglia 3.
    const moreAvailable = sorted.length > visible.length;
    expandBtn.hidden = !moreAvailable;
    expandBtn.querySelector('span').textContent = expanded ? 'Mostra meno' : 'Mostra tutti';
  }
  expandBtn.addEventListener('click', () => {
    expanded = !expanded;
    renderSuggestions();
  });

  function onSuggestionClick(s) {
    const a = s.action;
    if (!a) return;
    const type = String(a.type || '').toUpperCase();
    if (type === 'NAVIGA' && a.url) {
      chrome.tabs.create({ url: a.url });
    } else if (type === 'APRI_FILE' && (a.path || a.url)) {
      const url = a.url || a.path;
      if (/^https?:|^chrome-extension:|^chrome:/.test(url)) chrome.tabs.create({ url });
    } else if (type === 'CHAT' && a.prompt) {
      // Trigger interno: prepopola la chat con il prompt.
      inputEl.value = a.prompt;
      inputForm.dispatchEvent(new Event('submit'));
    } else {
      // Fallback: trasforma la voce in messaggio chat.
      inputEl.value = s.text || '';
      inputForm.dispatchEvent(new Event('submit'));
    }
  }

  // ===== Colonna destra (live) =====
  async function refreshLive() {
    const [timersR, notiR] = await Promise.all([
      send({ type: MSG.FILO_GET_TIMERS }),
      send({ type: MSG.FILO_GET_NOTIFICATIONS }),
    ]);
    const timers = (timersR?.ok && timersR.timers) || [];
    const notifications = (notiR?.ok && notiR.notifications) || [];
    liveEl.innerHTML = '';
    // Notifiche per prime (avvisi), poi timer (processi).
    for (const n of notifications) {
      liveEl.appendChild(renderLiveCard({
        kind: n.kind === 'alert' ? 'alert' : (n.kind || 'info'),
        text: n.text,
        onDismiss: () => send({ type: MSG.FILO_DISMISS_NOTIFICATION, id: n.id }).then(refreshLive),
      }));
    }
    for (const t of timers) {
      const remaining = Math.max(0, Math.round((new Date(t.endsAt).getTime() - Date.now()) / 1000));
      const mm = Math.floor(remaining / 60);
      const ss = remaining % 60;
      const txt = `${t.label}\n${mm}:${String(ss).padStart(2, '0')}${t.paused ? ' (in pausa)' : ''}`;
      liveEl.appendChild(renderLiveCard({
        kind: 'process',
        text: txt,
        onDismiss: () => send({ type: MSG.FILO_DELETE_TIMER, id: t.id }).then(refreshLive),
      }));
    }
    // Ticker per i timer: aggiorna il rendering ogni secondo SOLO se ci sono
    // timer attivi non in pausa. Evita lavoro inutile su dashboard vuote.
    const hasActiveTimer = timers.some((t) => !t.paused);
    if (hasActiveTimer && !liveTickHandle) {
      liveTickHandle = setInterval(refreshLive, 1000);
    } else if (!hasActiveTimer && liveTickHandle) {
      clearInterval(liveTickHandle);
      liveTickHandle = null;
    }
  }

  function renderLiveCard({ kind, text, onDismiss }) {
    const div = document.createElement('div');
    div.className = 'dash-live-card';
    div.dataset.kind = kind;
    const t = document.createElement('div');
    t.className = 'dash-live-text';
    t.textContent = text;
    div.appendChild(t);
    if (onDismiss) {
      const btn = document.createElement('button');
      btn.className = 'dash-live-dismiss';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Rimuovi');
      btn.textContent = '×';
      btn.addEventListener('click', onDismiss);
      div.appendChild(btn);
    }
    return div;
  }

  // Mostra/nasconde il commento centrale di Filo (Preferenze → "Commento nella
  // home"). I suggerimenti nella colonna sinistra restano comunque visibili.
  function applyHomeMessageVisibility() {
    homeMessageEl.hidden = !showHomeMessage;
  }

  // ===== Generazione dashboard (messaggio centro + suggerimenti) =====
  async function loadDashboard({ force = false } = {}) {
    if (showHomeMessage) {
      homeMessageEl.classList.add('dash-home-msg-loading');
      homeMessageEl.textContent = '…';
    }
    const r = await send({ type: MSG.FILO_GENERATE_DASHBOARD, force });
    if (!r?.ok) {
      homeMessageEl.classList.remove('dash-home-msg-loading');
      homeMessageEl.textContent = 'Filo è in ascolto.';
      suggestions = [];
      renderSuggestions();
      return;
    }
    homeMessageEl.classList.remove('dash-home-msg-loading');
    homeMessageEl.textContent = r.message || 'Filo è in ascolto.';
    suggestions = Array.isArray(r.suggestions) ? r.suggestions : [];
    renderSuggestions();
  }

  // ===== Bolle conversazione =====
  function makeBubble({ role, text, pending = false }) {
    const div = document.createElement('div');
    div.className = `dash-bubble dash-bubble-${role === 'user' ? 'user' : 'filo'}`;
    if (pending) div.classList.add('dash-bubble-pending');
    div.textContent = text;
    return div;
  }

  function renderActions(container, actions, { onAck } = {}) {
    if (!actions || !actions.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble-actions';
    let hasAck = false;
    for (const a of actions) {
      const btn = renderActionButton(a, { onAck });
      if (btn) wrap.appendChild(btn);
      if ((String(a.type || '').toUpperCase() === 'TIMER') || (String(a.type || '').toUpperCase() === 'SALVA_APPUNTO') || (String(a.type || '').toUpperCase() === 'SVEGLIA')) {
        hasAck = true;
      }
    }
    // Per i comandi (TIMER/SVEGLIA/SALVA_APPUNTO) le azioni sono già eseguite
    // server-side: aggiungiamo un tasto ✓ che torna alla dashboard (spec).
    if (hasAck && onAck) {
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'dash-action-btn dash-action-btn-primary';
      ok.textContent = '✓';
      ok.title = 'Chiudi e torna alla dashboard';
      ok.addEventListener('click', onAck);
      wrap.appendChild(ok);
    }
    container.appendChild(wrap);
  }

  function renderActionButton(a, { onAck } = {}) {
    const type = String(a.type || '').toUpperCase();
    if (type === 'NAVIGA') {
      const btn = document.createElement('a');
      btn.href = a.url || '#';
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.title = a.label || a.url || 'Apri';
      const favUrl = faviconUrl(a.url);
      if (favUrl) {
        btn.className = 'dash-action-link';
        const img = document.createElement('img');
        img.className = 'dash-action-favicon';
        img.src = favUrl;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
          btn.className = 'dash-action-btn dash-action-btn-primary';
          img.remove();
          btn.textContent = a.label || 'Apri';
        };
        btn.appendChild(img);
      } else {
        btn.className = 'dash-action-btn dash-action-btn-primary';
        btn.textContent = a.label || 'Apri';
      }
      return btn;
    }
    if (type === 'APRI_FILE') {
      const btn = document.createElement('a');
      btn.className = 'dash-action-btn';
      btn.href = a.path || '#';
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.textContent = a.label || (a.path || 'File');
      return btn;
    }
    if (type === 'TIMER') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      const sec = Number(a.seconds || a.secondi || 0);
      const mins = Math.round(sec / 60);
      btn.textContent = `⏱ ${a.label || a.etichetta || 'Timer'} · ${mins} min`;
      return btn;
    }
    if (type === 'SALVA_APPUNTO') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `✎ Salvato`;
      return btn;
    }
    if (type === 'SVEGLIA') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `⏰ ${a.time || a.orario || ''} ${a.label || ''}`.trim();
      return btn;
    }
    if (type === 'CERCA_WEB') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `🔎 ${a.query}`;
      return btn;
    }
    if (type === 'EVENTO_CALENDARIO') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `📅 ${a.title || a.titolo || ''}`;
      return btn;
    }
    return null;
  }

  // ===== Invio messaggio =====
  async function submitMessage(text) {
    if ((!text && pendingImages.length === 0) || sending) return;
    sending = true;
    sendBtn.disabled = true;
    const imagesToSend = pendingImages.slice();
    clearImagePreviews();
    // Svuota subito la textarea: la bolla utente è già visibile, niente attesa.
    inputEl.value = '';
    // Prima query dalla home → entra in stato thread.
    if (body.dataset.state !== 'thread') goThread();

    // Bolla utente
    threadHistory.push({ role: 'user', text: text || '(immagine)' });
    const userBubble = makeBubble({ role: 'user', text: text || '' });
    // Mostra TUTTE le immagini inviate nella bolla, ognuna ingrandibile al click.
    imagesToSend.forEach((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      img.className = 'dash-bubble-img';
      attachImageLightbox(img, src);
      userBubble.insertBefore(img, userBubble.childNodes[i] || null);
    });
    bubblesEl.appendChild(userBubble);

    // Bolla Filo pending
    const pending = makeBubble({ role: 'filo', text: 'Filo sta pensando…', pending: true });
    bubblesEl.appendChild(pending);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    const msg = {
      type: MSG.FILO_CHAT,
      userMessage: text || 'Descrivi questa immagine.',
      threadHistory: threadHistory.slice(0, -1),
    };
    if (imagesToSend.length) {
      msg.image = imagesToSend[0]; // retrocompatibilità (provider mono-immagine)
      msg.images = imagesToSend;
    }
    const r = await send(msg);

    pending.remove();
    if (!r?.ok) {
      const err = makeBubble({ role: 'filo', text: r?.error || 'Errore.' });
      bubblesEl.appendChild(err);
    } else {
      const filoBubble = makeBubble({ role: 'filo', text: r.text || '' });
      bubblesEl.appendChild(filoBubble);
      renderActions(filoBubble, r.actions || [], { onAck: goHome });
      threadHistory.push({ role: 'filo', text: r.text || '', actions: r.actions || [] });
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();

    // Aggiorna live (potrebbe esserci un timer/sveglia appena creato).
    refreshLive().catch(() => {});
  }

  // ===== Image paste / drop (multi-immagine) =====
  const imgPreviewsEl = $('imgPreviews');

  function renderImagePreviews() {
    imgPreviewsEl.innerHTML = '';
    imgPreviewsEl.hidden = pendingImages.length === 0;
    pendingImages.forEach((dataUrl, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'dash-img-preview';
      // Retrocompatibilità: la prima anteprima conserva l'id storico #imgPreview
      // (usato dall'implementazione mono-immagine precedente e dai test esistenti).
      if (idx === 0) wrap.id = 'imgPreview';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Immagine incollata';
      attachImageLightbox(img, dataUrl);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'dash-img-remove';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Rimuovi immagine');
      rm.addEventListener('click', () => {
        pendingImages.splice(idx, 1);
        renderImagePreviews();
      });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      imgPreviewsEl.appendChild(wrap);
    });
  }
  function addPendingImage(dataUrl) {
    pendingImages.push(dataUrl);
    renderImagePreviews();
  }
  function clearImagePreviews() {
    pendingImages = [];
    renderImagePreviews();
  }
  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => addPendingImage(reader.result);
    reader.readAsDataURL(file);
  }
  inputForm.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    // Incolla TUTTE le immagini presenti negli appunti (non solo la prima).
    let found = false;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        found = true;
        handleImageFile(item.getAsFile());
      }
    }
    if (found) e.preventDefault();
  });
  // Accetta immagini incollate da "Incolla → cronologia" del menu Filo
  // (Ctrl+V passa dal listener 'paste' qui sopra; il menu invece dispatcha
  // questo evento custom — vedi pasteHistoryEntry in content.js).
  inputForm.addEventListener('filo:paste-image', (e) => {
    if (e.detail?.blob) {
      e.preventDefault();
      handleImageFile(e.detail.blob);
    }
  });
  inputForm.addEventListener('dragover', (e) => { e.preventDefault(); });
  inputForm.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files) for (const f of files) handleImageFile(f);
  });

  // ===== Lightbox: click su un'immagine per ingrandirla =====
  let lightboxEl = null;
  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'dash-lightbox';
    lightboxEl.id = 'lightbox';
    const big = document.createElement('img');
    big.alt = '';
    lightboxEl.appendChild(big);
    lightboxEl.addEventListener('click', closeLightbox);
    document.body.appendChild(lightboxEl);
    return lightboxEl;
  }
  function openLightbox(src) {
    const el = ensureLightbox();
    el.querySelector('img').src = src;
    el.classList.add('open');
  }
  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('open');
    const img = lightboxEl.querySelector('img');
    if (img) img.removeAttribute('src');
  }
  function attachImageLightbox(img, src) {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(src);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxEl?.classList.contains('open')) {
      e.preventDefault();
      closeLightbox();
    }
  });

  const SLASH_COMMANDS = {
    '/home': () => { goHome(); },
    '/clear': () => { goHome(); },
    '/kill': () => { send({ type: MSG.QUIT_APP }); },
    '/newtab': () => { send({ type: MSG.OPEN_URL, url: 'filo://newtab/' }); },
    '/models': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/modelli': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/sicurezza': () => { send({ type: MSG.OPEN_URL, url: 'filo://security/security.html' }); },
    '/preferenze': () => { send({ type: MSG.OPEN_URL, url: 'filo://preferences/preferences.html' }); },
    '/editor': () => { send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }); },
    '/feedback': () => { send({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }); },
    '/help': () => {
      if (body.dataset.state !== 'thread') goThread();
      const lines = [
        '/home, /clear — ricarica la dashboard',
        '/kill — chiudi Filo',
        '/newtab — apri una nuova scheda',
        '/models, /modelli — impostazioni modelli',
        '/sicurezza — impostazioni sicurezza',
        '/preferenze — preferenze',
        '/editor — apri l\'editor',
        '/feedback — apri i feedback',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      const bubble = makeBubble({ role: 'filo', text: lines.join('\n') });
      bubblesEl.appendChild(bubble);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    },
  };

  // Riconosce un singolo token "tipo sito" (es. google.com, github.com/x,
  // http://localhost:3000). DEVE essere preciso: un comando di shell come
  // `/git log v1.2` o `/cat file.txt` contiene un punto ma NON è un sito.
  // Quindi: niente spazi, e o è un http(s):// esplicito o un dominio con TLD
  // alfabetico. Esclude i path locali (./x, .\x) che la shell deve eseguire.
  function isSiteToken(text) {
    const raw = text.slice(1);
    if (!raw || /\s/.test(raw)) return false;
    if (/^https?:\/\//i.test(raw)) return true;
    if (/^[.\\/~]/.test(raw)) return false; // ./script, .\script, ~/x, /usr
    // label.label(.label)* con almeno un TLD alfabetico (.com, .io, ...)
    return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(raw) && /\.[a-z]{2,}(:|\/|$)/i.test(raw);
  }

  // Classifica l'input corrente per l'evidenziazione live:
  //   'filo'  → comando interno di Filo (o navigazione a sito) → arancione
  //   'shell' → andrà eseguito dalla shell (solo in modalità terminale) → azzurro
  //   'none'  → testo normale (va all'LLM)
  function classifyInput(value) {
    const t = value.trim();
    if (!t.startsWith('/')) return 'none';
    const firstToken = t.split(/\s+/)[0];
    if (SLASH_COMMANDS[t] || SLASH_COMMANDS[firstToken]) return 'filo';
    if (isSiteToken(t)) return 'filo';
    if (terminalMode) return 'shell';
    return 'none';
  }

  function updateInputClass() {
    const kind = classifyInput(inputEl.value);
    inputEl.classList.toggle('is-cmd-filo', kind === 'filo');
    inputEl.classList.toggle('is-cmd-shell', kind === 'shell');
  }

  function handleSlashCommand(text) {
    if (!text.startsWith('/')) return false;
    const firstToken = text.split(/\s+/)[0];
    // 1) Comandi interni di Filo: vincono SEMPRE, anche in modalità terminale.
    const handler = SLASH_COMMANDS[text] || SLASH_COMMANDS[firstToken];
    if (handler) { handler(); inputEl.value = ''; updateInputClass(); return true; }
    // 2) Navigazione diretta a un sito: solo se è un singolo token "tipo sito".
    if (isSiteToken(text)) {
      const raw = text.slice(1);
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      send({ type: MSG.OPEN_URL, url });
      inputEl.value = '';
      updateInputClass();
      return true;
    }
    // 3) Modalità terminale: tutto il resto con `/` viene eseguito dalla shell
    //    (non passa mai all'LLM).
    if (terminalMode) {
      runShellCommand(text.slice(1).trim());
      inputEl.value = '';
      updateInputClass();
      return true;
    }
    // 4) Modalità normale, comando `/` sconosciuto: lascialo all'LLM (storico).
    return false;
  }

  // ===== Esecuzione comandi shell (modalità terminale) =====
  function updateDirLine() {
    dashDir.textContent = currentCwd || '';
  }

  function applyTerminalMode() {
    dashDir.hidden = !terminalMode || !currentCwd;
    inputEl.placeholder = terminalMode
      ? 'Chiedi qualsiasi cosa… o /comando per la shell'
      : 'Chiedi qualsiasi cosa…';
    updateInputClass();
  }

  async function initCwd() {
    if (currentCwd) return;
    try {
      const r = await window.filo?.shellHome?.();
      if (r?.cwd) currentCwd = r.cwd;
    } catch (_) {}
    updateDirLine();
  }

  // ===== Rendering colori ANSI (SGR) per l'output del terminale =====
  // Niente emulazione TUI: interpretiamo solo le sequenze di colore/stile
  // (ESC[…m) e SCARTIAMO il resto (movimenti cursore, OSC…), così i tool che
  // colorano (git, ls --color, eslint…) si vedono giusti senza che i codici
  // grezzi sporchino l'output. Le altre sequenze a schermo intero non servono.
  const ANSI_BASE = ['#1e1e1e', '#cc4136', '#4e9a06', '#c4a000', '#3465a4',
    '#a347ba', '#0e9aa7', '#d3d7cf', '#6e7170', '#ef5350', '#8ae234',
    '#e6d44e', '#5a9ee6', '#c77fd6', '#34e2e2', '#fafafa'];
  function xterm256(n) {
    if (n < 16) return ANSI_BASE[n];
    if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
    const k = n - 16, L = [0, 95, 135, 175, 215, 255];
    return `rgb(${L[Math.floor(k / 36) % 6]},${L[Math.floor(k / 6) % 6]},${L[k % 6]})`;
  }
  // Trova una sequenza ESC a partire da `pos` (dove s[pos] === ESC). Ritorna
  // { end, sgr } oppure null se la sequenza è troncata a fine chunk (da
  // ricomporre col chunk successivo).
  function parseEscape(s, pos) {
    if (pos + 1 >= s.length) return null;
    const c = s[pos + 1];
    if (c === '[') { // CSI
      let j = pos + 2;
      while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
      if (j >= s.length) return null;
      return { end: j + 1, sgr: s[j] === 'm' ? s.slice(pos + 2, j) : null };
    }
    if (c === ']') { // OSC: fino a BEL o ST (ESC \)
      let j = pos + 2;
      while (j < s.length) {
        if (s[j] === '\x07') return { end: j + 1, sgr: null };
        if (s[j] === '\x1b') { if (j + 1 >= s.length) return null; if (s[j + 1] === '\\') return { end: j + 2, sgr: null }; }
        j++;
      }
      return null;
    }
    return { end: pos + 2, sgr: null }; // sequenza a due byte (ESC c, ESC 7…)
  }

  function runShellCommand(command) {
    if (!command) return;
    if (body.dataset.state !== 'thread') goThread();

    // Bolla "comando" (stile utente) con il prompt digitato.
    const cmdBubble = makeBubble({ role: 'user', text: '' });
    cmdBubble.classList.add('dash-term-cmd');
    const promptLine = document.createElement('span');
    promptLine.className = 'dash-term-prompt';
    promptLine.textContent = '/ ';
    cmdBubble.appendChild(promptLine);
    cmdBubble.appendChild(document.createTextNode(command));
    bubblesEl.appendChild(cmdBubble);

    // Bolla output (monospace) con controlli.
    const out = document.createElement('div');
    out.className = 'dash-bubble dash-bubble-filo dash-term';
    const pre = document.createElement('pre');
    pre.className = 'dash-term-out';
    out.appendChild(pre);

    const controls = document.createElement('div');
    controls.className = 'dash-term-controls';
    const stdinInput = document.createElement('input');
    stdinInput.type = 'text';
    stdinInput.className = 'dash-term-stdin';
    stdinInput.placeholder = 'Invio testo al comando…';
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'dash-term-stop';
    stopBtn.textContent = 'Stop';
    controls.appendChild(stdinInput);
    controls.appendChild(stopBtn);
    out.appendChild(controls);
    bubblesEl.appendChild(out);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    const appendOut = (chunk, isErr) => {
      const node = document.createElement('span');
      if (isErr) node.className = 'dash-term-err';
      node.textContent = chunk;
      pre.appendChild(node);
      const atBottom = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 40;
      if (atBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };

    let finished = false;
    const finish = (label) => {
      if (finished) return;
      finished = true;
      controls.remove();
      if (label) {
        const tag = document.createElement('div');
        tag.className = 'dash-term-exit';
        tag.textContent = label;
        out.appendChild(tag);
      }
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };

    const handle = window.filo.shellExec({
      command,
      cwd: currentCwd,
      shell: terminalShell,
      onData: ({ chunk, stream }) => appendOut(chunk, stream === 'stderr'),
      onExit: ({ code, cwd }) => {
        if (cwd) { currentCwd = cwd; updateDirLine(); applyTerminalMode(); }
        finish(code === 0 ? null : `(uscita con codice ${code})`);
      },
      onError: ({ message }) => {
        appendOut(`\n${message || 'Errore di esecuzione.'}`, true);
        finish('(comando non avviato)');
      },
    });

    stopBtn.addEventListener('click', () => {
      handle.abort();
      finish('(interrotto)');
    });
    stdinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handle.sendInput(stdinInput.value + '\n');
        appendOut(stdinInput.value + '\n', false);
        stdinInput.value = '';
      }
    });
    stdinInput.focus();
  }

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text && pendingImages.length === 0) return;
    if (handleSlashCommand(text)) return;
    submitMessage(text);
  });

  // Evidenziazione live mentre si scrive: arancione = comando Filo (o sito),
  // azzurro = comando shell (solo in modalità terminale).
  inputEl.addEventListener('input', updateInputClass);

  // ===== Bridge cambio stato live dal background =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.SETTINGS_UPDATED) {
      applySavedTheme().catch(() => {});
      if (msg.settings && typeof msg.settings.showHomeMessage === 'boolean') {
        showHomeMessage = msg.settings.showHomeMessage;
        applyHomeMessageVisibility();
      }
      if (msg.settings && msg.settings.terminal) {
        const t = msg.settings.terminal;
        if (typeof t.enabled === 'boolean') terminalMode = t.enabled;
        if (t.shell) terminalShell = t.shell;
        if (terminalMode && !currentCwd) {
          initCwd().then(applyTerminalMode);
        } else {
          applyTerminalMode();
        }
      }
    }
  });

  // ===== Bootstrap =====
  (async function init() {
    await applySavedTheme();
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      showHomeMessage = settings?.showHomeMessage !== false;
      terminalMode = !!settings?.terminal?.enabled;
      terminalShell = settings?.terminal?.shell || 'powershell';
    } catch (_) {}
    applyHomeMessageVisibility();
    if (terminalMode) await initCwd();
    applyTerminalMode();
    // Carico in parallelo dashboard cache e live state per non sequenziare.
    await Promise.all([
      loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
    ]);
  })();
})();
