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

  // ===== Stato locale =====
  let suggestions = [];
  let expanded = false;
  let threadHistory = []; // [{role: 'user'|'filo', text, actions?}]
  let sending = false;
  let liveTickHandle = null;
  let pendingImage = null; // dataUrl dell'immagine incollata

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

  // ===== Generazione dashboard (messaggio centro + suggerimenti) =====
  async function loadDashboard({ force = false } = {}) {
    homeMessageEl.classList.add('dash-home-msg-loading');
    homeMessageEl.textContent = '…';
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
    if ((!text && !pendingImage) || sending) return;
    sending = true;
    sendBtn.disabled = true;
    const imageToSend = pendingImage;
    removeImagePreview();
    // Prima query dalla home → entra in stato thread.
    if (body.dataset.state !== 'thread') goThread();

    // Bolla utente
    threadHistory.push({ role: 'user', text: text || '(immagine)' });
    const userBubble = makeBubble({ role: 'user', text: text || '' });
    if (imageToSend) {
      const img = document.createElement('img');
      img.src = imageToSend;
      img.className = 'dash-bubble-img';
      userBubble.insertBefore(img, userBubble.firstChild);
    }
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
    if (imageToSend) msg.image = imageToSend;
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

    inputEl.value = '';
    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();

    // Aggiorna live (potrebbe esserci un timer/sveglia appena creato).
    refreshLive().catch(() => {});
  }

  // ===== Image paste / drop =====
  function showImagePreview(dataUrl) {
    removeImagePreview();
    pendingImage = dataUrl;
    const wrap = document.createElement('div');
    wrap.className = 'dash-img-preview';
    wrap.id = 'imgPreview';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Immagine incollata';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dash-img-remove';
    rm.textContent = '×';
    rm.setAttribute('aria-label', 'Rimuovi immagine');
    rm.addEventListener('click', removeImagePreview);
    wrap.appendChild(img);
    wrap.appendChild(rm);
    inputForm.insertBefore(wrap, inputEl);
  }
  function removeImagePreview() {
    pendingImage = null;
    const el = document.getElementById('imgPreview');
    if (el) el.remove();
  }
  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => showImagePreview(reader.result);
    reader.readAsDataURL(file);
  }
  inputForm.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        handleImageFile(item.getAsFile());
        return;
      }
    }
  });
  // TEMP DISABLED for regression check
  inputForm.addEventListener('dragover', (e) => { e.preventDefault(); });
  inputForm.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  const SLASH_COMMANDS = {
    '/home': () => { goHome(); },
    '/clear': () => { goHome(); },
    '/kill': () => { send({ type: MSG.QUIT_APP }); },
    '/newtab': () => { send({ type: MSG.OPEN_URL, url: 'filo://newtab/' }); },
    '/models': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/modelli': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/help': () => {
      if (body.dataset.state !== 'thread') goThread();
      const lines = [
        '/home, /clear — ricarica la dashboard',
        '/kill — chiudi Filo',
        '/newtab — apri una nuova scheda',
        '/models, /modelli — impostazioni modelli',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      const bubble = makeBubble({ role: 'filo', text: lines.join('\n') });
      bubblesEl.appendChild(bubble);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    },
  };

  function handleSlashCommand(text) {
    if (!text.startsWith('/')) return false;
    const handler = SLASH_COMMANDS[text];
    if (handler) { handler(); inputEl.value = ''; return true; }
    const raw = text.slice(1);
    if (raw.includes('.') || raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = raw.match(/^https?:\/\//) ? raw : `https://${raw}`;
      send({ type: MSG.OPEN_URL, url });
      inputEl.value = '';
      return true;
    }
    return false;
  }

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text && !pendingImage) return;
    if (handleSlashCommand(text)) return;
    submitMessage(text);
  });

  // ===== Bridge cambio stato live dal background =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.SETTINGS_UPDATED) {
      applySavedTheme().catch(() => {});
    }
  });

  // ===== Bootstrap =====
  (async function init() {
    await applySavedTheme();
    // Carico in parallelo dashboard cache e live state per non sequenziare.
    await Promise.all([
      loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
    ]);
  })();
})();
