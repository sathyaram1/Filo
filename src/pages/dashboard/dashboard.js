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
  const { STORAGE_KEYS } = self.SN_CONST;

  // Messaggio di benvenuto mostrato UNA sola volta, la prima volta che l'utente
  // apre Filo dopo averlo scaricato (feedback alpha). Compare come una bolla di
  // Filo, "come appena inviato da lui", così l'utente può rispondere subito
  // raccontandosi e Filo si configura nel tempo.
  const WELCOME_MESSAGE =
    'Ciao, sono Filo. Se mi racconti brevemente chi sei e come usi di solito ' +
    'il computer mi configuro io. Altrimenti imparerò nel tempo.\n' +
    'Qualsiasi dubbio tu abbia chiedimi pure, conosco abbastanza bene come ' +
    'funziono. Ricorda che puoi sempre cliccare il tasto destro se vuoi fare ' +
    'qualcosa con quello che stai guardando.';

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

  // ===== Suoneria timer =====
  // Singleton AudioContext + oscillatori per la suoneria del timer.
  // Non usiamo file audio per non dover committare binari; generiamo
  // sequenze di beep via WebAudio. La suoneria parte quando il primo
  // timer passa in stato `ringing` e si ferma quando non ce ne sono più.
  let _alarmCtx = null;
  let _alarmPlaying = false;
  let _alarmLoopTimeout = null;
  let _timerRingTone = 'default'; // suoneria attiva (ID stringa)

  // Catalogo suonerie: ogni voce è un array di note [ [freq, durMs], … ]
  // seguite da un gap prima del loop successivo.
  const RINGTONES = {
    default: {
      label: 'Standard',
      notes: [[880, 150], [0, 80], [880, 150], [0, 80], [880, 150], [0, 400]],
    },
    gentle: {
      label: 'Delicata',
      notes: [[523, 200], [0, 100], [659, 200], [0, 100], [784, 300], [0, 600]],
    },
    urgent: {
      label: 'Urgente',
      notes: [[1047, 80], [0, 50], [1047, 80], [0, 50], [1047, 80], [0, 50],
               [1047, 80], [0, 50], [1047, 80], [0, 300]],
    },
    chime: {
      label: 'Carillon',
      notes: [[1046, 120], [0, 60], [1318, 120], [0, 60], [1568, 120], [0, 60],
               [2093, 200], [0, 700]],
    },
  };

  function _getAlarmCtx() {
    if (!_alarmCtx) _alarmCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _alarmCtx;
  }

  // Suona UNA sequenza di note (non in loop). Ritorna una Promise che si
  // risolve quando la sequenza è finita. Usata sia per la suoneria in loop
  // sia per l'anteprima nelle opzioni (ma lì non in loop).
  function _playSequence(toneId) {
    const tone = RINGTONES[toneId] || RINGTONES.default;
    const ctx = _getAlarmCtx();
    // Risveglia il contesto se sospeso (politica autoplay browser).
    const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return resume.then(() => {
      return new Promise((resolve) => {
        let t = ctx.currentTime;
        for (const [freq, durMs] of tone.notes) {
          if (freq > 0) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000 - 0.01);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + durMs / 1000);
          }
          t += durMs / 1000;
        }
        // Risolvi al termine dell'ultima nota + gap.
        setTimeout(resolve, Math.max(0, (t - ctx.currentTime) * 1000));
      });
    });
  }

  // Avvia la suoneria in loop continuo. Idempotente: se già suona, non fa nulla.
  function startAlarm() {
    if (_alarmPlaying) return;
    _alarmPlaying = true;
    async function loop() {
      if (!_alarmPlaying) return;
      try { await _playSequence(_timerRingTone); } catch (_) {}
      if (_alarmPlaying) _alarmLoopTimeout = setTimeout(loop, 0);
    }
    loop();
  }

  // Ferma la suoneria. Idempotente.
  function stopAlarm() {
    _alarmPlaying = false;
    clearTimeout(_alarmLoopTimeout);
    _alarmLoopTimeout = null;
  }

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
    autoGrowInput();
    inputEl.focus();
  }

  function goThread() {
    body.dataset.state = 'thread';
    homeView.hidden = true;
    threadView.hidden = false;
  }

  // Vero solo alla PRIMISSIMA apertura dell'app (flag su storage non ancora
  // impostato). Letto in init() prima di caricare la dashboard.
  async function isFirstRun() {
    try {
      return !(await self.SN_STORAGE?.getRaw?.(STORAGE_KEYS.FILO_WELCOMED, false));
    } catch (_) { return false; }
  }

  // Alla primissima apertura mostra il messaggio di benvenuto di Filo come suo
  // commento centrale nella home ("come appena inviato da lui"): l'utente lo
  // legge e può rispondere subito dalla barra qui sotto, così Filo si configura.
  // Resta in stato home (niente thread) per non rompere il resto della dashboard.
  function showWelcomeMessage() {
    homeMessageEl.classList.remove('dash-home-msg-loading');
    homeMessageEl.id = 'homeMessage';
    homeMessageEl.dataset.welcome = '1';
    homeMessageEl.textContent = WELCOME_MESSAGE;
    applyHomeMessageVisibility();
    inputEl.focus();
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

  async function onSuggestionClick(s) {
    const a = s.action;
    if (!a) return;
    const type = String(a.type || '').toUpperCase();
    if (type === 'PULISCI_TAB') {
      // §6 — suggerimento di pulizia dalla home: STESSA conferma del bottone chat.
      // Popup Filo (SN_CONFIRM_UI), non il window.confirm nativo del browser
      // (PATTERNS.md: niente default del browser). Fallback al nativo solo se il
      // modulo non è caricato.
      const text = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.';
      const ok = window.SN_CONFIRM_UI
        ? await window.SN_CONFIRM_UI.confirm({ title: 'Riordino delle schede', text, okLabel: 'Procedi' })
        : window.confirm(`${text} Procedo?`);
      if (!ok) return;
      send({ type: MSG.RUN_TAB_TRIAGE });
      return;
    }
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
      if (t.ringing) {
        liveEl.appendChild(renderRingingCard(t));
      } else if (t.kind === 'alarm') {
        // #322 — la sveglia mostra l'ORARIO programmato, non un countdown
        // mm:ss (un conto alla rovescia di ore sarebbe illeggibile). La × la
        // rimuove, come per i timer.
        liveEl.appendChild(renderLiveCard({
          kind: 'process',
          text: `⏰ Sveglia ${fmtAlarmTime(t.endsAt)}${t.label ? `\n${t.label}` : ''}`,
          onDismiss: () => send({ type: MSG.FILO_DELETE_TIMER, id: t.id }).then(refreshLive),
        }));
      } else {
        // Timer in pausa: il countdown è congelato, `endsAt` non è più
        // affidabile (il "now" avanza mentre il timer è fermo) → usa il tempo
        // rimanente salvato al momento della pausa.
        const remaining = (t.paused && Number.isFinite(t.remainingMs))
          ? Math.max(0, Math.round(t.remainingMs / 1000))
          : Math.max(0, Math.round((new Date(t.endsAt).getTime() - Date.now()) / 1000));
        // #323 — countdown "da orologio": M:SS sotto l'ora, H:MM:SS oltre, così
        // un timer di 2 ore mostra "2:00:00" e non "120:00".
        const clock = (self.SN_TIME ? self.SN_TIME.fmtCountdown(remaining)
          : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
        const txt = `${t.label}\n${clock}${t.paused ? ' (in pausa)' : ''}`;
        liveEl.appendChild(renderLiveCard({
          kind: 'process',
          text: txt,
          paused: !!t.paused,
          onToggle: () => send({
            type: t.paused ? MSG.FILO_RESUME_TIMER : MSG.FILO_PAUSE_TIMER,
            id: t.id,
          }).then(refreshLive),
          onDismiss: () => send({ type: MSG.FILO_DELETE_TIMER, id: t.id }).then(refreshLive),
        }));
      }
    }

    // Gestione suoneria: parte se c'è almeno un timer ringing, si ferma altrimenti.
    const hasRinging = timers.some((t) => t.ringing);
    if (hasRinging) {
      startAlarm();
    } else {
      stopAlarm();
    }

    // Stato osservabile per i test Playwright (non dipende dall'audio che in
    // headless non suona): data-ringing="1" sul contenitore live.
    liveEl.dataset.ringing = hasRinging ? '1' : '0';

    // Ticker per i timer: aggiorna il rendering ogni secondo SOLO se ci sono
    // timer attivi (compresi i ringing — un timer ringing non è in pausa
    // quindi !t.paused è già true, ma includiamo t.ringing esplicitamente
    // per robustezza nel caso futura variazione della logica di pausa).
    const hasActiveTimer = timers.some((t) => !t.paused || t.ringing);
    if (hasActiveTimer && !liveTickHandle) {
      liveTickHandle = setInterval(refreshLive, 1000);
    } else if (!hasActiveTimer && liveTickHandle) {
      clearInterval(liveTickHandle);
      liveTickHandle = null;
    }
  }

  // Orario "umano" di una sveglia: HH:MM, con l'indicazione del giorno solo se
  // non è oggi (#322).
  function fmtAlarmTime(iso) {
    const d = new Date(iso);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return hhmm;
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (d.toDateString() === tomorrow.toDateString()) return `${hhmm} di domani`;
    return `${hhmm} del ${d.getDate()}/${d.getMonth() + 1}`;
  }

  // Card speciale per un timer/sveglia che sta suonando: bordo animato + "Ferma".
  function renderRingingCard(t) {
    const div = document.createElement('div');
    div.className = 'dash-live-card';
    div.dataset.kind = 'process';
    div.dataset.ringing = '1';

    const textEl = document.createElement('div');
    textEl.className = 'dash-live-text';
    textEl.textContent = t.kind === 'alarm'
      ? `⏰ Sveglia${t.label ? ` — ${t.label}` : ''}`
      : `⏰ ${t.label} — scaduto`;
    div.appendChild(textEl);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'dash-live-stop';
    stopBtn.type = 'button';
    stopBtn.textContent = 'Ferma';
    stopBtn.addEventListener('click', () => {
      send({ type: MSG.FILO_STOP_TIMER_ALARM, id: t.id }).then(refreshLive);
    });
    div.appendChild(stopBtn);

    // Pulsante × per dismissione rapida (stessa azione di "Ferma").
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'dash-live-dismiss';
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('aria-label', 'Ferma');
    dismissBtn.textContent = '\xD7';
    dismissBtn.addEventListener('click', () => {
      send({ type: MSG.FILO_STOP_TIMER_ALARM, id: t.id }).then(refreshLive);
    });
    div.appendChild(dismissBtn);

    return div;
  }

  function renderLiveCard({ kind, text, paused, onToggle, onDismiss }) {
    const div = document.createElement('div');
    div.className = 'dash-live-card';
    div.dataset.kind = kind;
    const t = document.createElement('div');
    t.className = 'dash-live-text';
    t.textContent = text;
    div.appendChild(t);
    // Pausa/ripresa: solo per i countdown (chi passa onToggle). Il pulsante sta
    // accanto alla × e cambia icona/etichetta in base allo stato.
    if (onToggle) {
      const pb = document.createElement('button');
      pb.className = 'dash-live-pause';
      pb.type = 'button';
      pb.setAttribute('aria-label', paused ? 'Riprendi' : 'Pausa');
      pb.title = paused ? 'Riprendi' : 'Pausa';
      pb.textContent = paused ? '▶' : '⏸';
      pb.addEventListener('click', onToggle);
      div.appendChild(pb);
    }
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
  function makeBubble({ role, text, pending = false, markdown = false }) {
    const div = document.createElement('div');
    div.className = `dash-bubble dash-bubble-${role === 'user' ? 'user' : 'filo'}`;
    if (pending) div.classList.add('dash-bubble-pending');
    // #162 — testo vuoto (Filo ha solo eseguito un'azione, es. aperto un link):
    // niente nodo di testo, la bolla conterrà solo i chip d'azione. Marchiamo
    // la bolla così il CSS può stringere i margini quando è "solo azioni".
    if (text) setBubbleText(div, text, markdown);
    else div.classList.add('dash-bubble-actions-only');
    return div;
  }

  // #418 — scrive il testo in una bolla. Per le risposte di Filo (markdown=true)
  // rende la formattazione leggera condivisa (grassetto, corsivo, codice,
  // elenchi, LINK). Per tutto il resto (testo utente, righe di sistema) resta
  // testo letterale. I link aperti sono già filtrati da SN_MARKDOWN: nessuno
  // punta alle pagine interne dell'app.
  function setBubbleText(el, text, markdown) {
    if (markdown && text && self.SN_MARKDOWN) {
      el.innerHTML = self.SN_MARKDOWN.render(text);
      el.classList.add('dash-bubble-md');
    } else {
      el.textContent = text || '';
    }
  }

  // Un solo listener delegato: i link renderizzati da Filo aprono una NUOVA
  // SCHEDA (come qualsiasi altro link) invece di navigare via la pagina interna.
  bubblesEl.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a.filo-md-link');
    if (!a || !bubblesEl.contains(a)) return;
    const url = a.getAttribute('href');
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: MSG.OPEN_URL, url });
  });

  // Indicatore "sta pensando": 3 righe di reasoning che scorrono verso l'alto e
  // svaniscono man mano che salgono (la riga in cima è quasi trasparente, quella
  // in basso è piena). Restano sempre al massimo 3 righe visibili.
  // Quando il modello fornisce il RAGIONAMENTO VERO in streaming (vedi
  // pushReasoning più sotto), nelle righe scorre quel testo; finché non arriva
  // (o per i modelli che non ragionano) si mostrano queste frasi indicative —
  // abbastanza varie da non sembrare uno spinner statico.
  // Stesso pattern della sidebar (src/content/sidebar.js).
  const THINKING_PHRASES = [
    'Leggo la tua richiesta…',
    'Analizzo il contesto…',
    'Consulto la memoria…',
    'Controllo schede e cronologia…',
    'Valuto il prossimo passo…',
    'Capisco cosa ti serve…',
    'Cerco le informazioni giuste…',
    'Compongo la risposta…',
    'Riconosco i pattern noti…',
    'Verifico i dettagli…',
    'Scelgo l’azione migliore…',
    'Metto in ordine le idee…',
  ];

  function appendThinking() {
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble dash-bubble-filo dash-thinking';
    const lines = [];
    for (let i = 0; i < 3; i++) {
      const ln = document.createElement('div');
      ln.className = 'dash-thinking-line';
      ln.dataset.slot = String(i); // 0=top fading out, 1=mid, 2=bottom fresh
      wrap.appendChild(ln);
      lines.push(ln);
    }
    bubblesEl.appendChild(wrap);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    // Pool casuale senza ripetizioni ravvicinate
    const pool = THINKING_PHRASES.slice();
    const recent = [];
    function nextPhrase() {
      const candidates = pool.filter((p) => !recent.includes(p));
      const src = candidates.length ? candidates : pool;
      const phrase = src[Math.floor(Math.random() * src.length)];
      recent.push(phrase);
      if (recent.length > 4) recent.shift();
      return phrase;
    }

    lines[0].textContent = nextPhrase();
    lines[1].textContent = nextPhrase();
    lines[2].textContent = nextPhrase();

    let stopped = false;
    // Mostra le ultime 3 righe di un elenco di segmenti, animando l'ingresso di
    // quella in basso. Usato sia dalle frasi indicative sia dal reasoning vero.
    const renderLines = (a, b, c) => {
      if (lines[2].textContent === c) return; // niente cambi → niente flicker
      lines[0].textContent = a || '';
      lines[1].textContent = b || '';
      lines[2].textContent = c || '';
      lines[2].classList.remove('dash-thinking-enter');
      void lines[2].offsetWidth;
      lines[2].classList.add('dash-thinking-enter');
    };
    const tick = () => {
      if (stopped || !wrap.isConnected) return;
      // Shift verso l'alto: top esce, mid → top, bottom → mid, nuovo → bottom
      renderLines(lines[1].textContent, lines[2].textContent, nextPhrase());
    };
    const interval = setInterval(tick, 900);
    lines[2].classList.add('dash-thinking-enter');

    // ── Reasoning VERO ─────────────────────────────────────────────────────
    // Quando arriva il ragionamento reale del modello (stream di testo), si
    // smette di animare le frasi indicative e si scorrono le righe vere: si
    // spezza il testo in segmenti (a fine frase / a capo) e si tengono visibili
    // gli ultimi 3, l'ultimo "in scrittura" finché non si chiude.
    let realMode = false;
    let buf = '';
    const segments = [];
    const splitSegments = (text) => {
      // Divide su a-capo o terminatori di frase, mantenendo segmenti non vuoti.
      return text
        .split(/(?<=[.!?…])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    };
    const renderReasoning = () => {
      const done = splitSegments(buf);
      // La coda senza terminatore è il segmento "in scrittura": tienilo come
      // ultima riga così l'utente vede il testo comparire in diretta.
      const all = done.slice();
      const lastChunk = buf.split(/\n+/).pop().trim();
      const matchedTail = done.length && buf.trimEnd().endsWith(done[done.length - 1]) && /[.!?…]\s*$/.test(buf);
      if (lastChunk && (!done.length || !matchedTail)) {
        if (!all.length || all[all.length - 1] !== lastChunk) all.push(lastChunk);
      }
      const n = all.length;
      renderLines(all[n - 3], all[n - 2], all[n - 1]);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };

    return {
      el: wrap,
      // Riceve un chunk di reasoning vero dal modello.
      pushReasoning(text) {
        if (stopped || !text) return;
        if (!realMode) { realMode = true; clearInterval(interval); }
        buf += text;
        renderReasoning();
      },
      remove() { stopped = true; clearInterval(interval); wrap.remove(); },
    };
  }

  function renderActions(container, actions, { onAck, autoConfirm = false } = {}) {
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
    // #159/#183 — le modifiche alle impostazioni di livello 2 NON sono chip
    // inerti da cliccare: il popup di conferma (che spiega cosa Filo sta per
    // fare e i rischi) si apre DA SOLO. Se nella stessa risposta ci sono più
    // impostazioni sensibili, i popup si aprono UNO ALLA VOLTA — niente
    // stacking di modali: aspettiamo che l'utente chiuda l'uno prima di aprire
    // il successivo. Le azioni distruttive (livello 3) o esterne (feedback)
    // restano a click esplicito (non marcate data-auto-confirm).
    if (autoConfirm) {
      const autos = Array.from(wrap.querySelectorAll('[data-auto-confirm="1"]'));
      if (autos.length) {
        setTimeout(async () => {
          for (const auto of autos) {
            try { await auto._runConfirm?.(); } catch (_) {}
          }
        }, 0);
      }
    }
  }

  // #146.4 — bottone di raffinamento estetico. Filo ha già applicato un valore
  // ragionevole al token (IMPOSTA_ESTETICA, livello 1); questo bottone apre il
  // box (color picker / slider, secondo il tipo del token) per scegliere il
  // valore esatto, con anteprima live e persistenza. La logica del box vive nel
  // modulo condiviso SN_AESTHETIC_REFINER; qui colleghiamo solo le dipendenze
  // (applica live = pageBootstrap; persisti = UPDATE_SETTINGS debounced).
  function buildAestheticRefiner(a) {
    const R = window.SN_AESTHETIC_REFINER;
    const Tokens = window.SN_THEME_TOKENS;
    if (!R || !Tokens) return null;
    let persistTimer = null;
    const persist = (overrides) => {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        send({ type: MSG.UPDATE_SETTINGS, settings: { themeTokens: overrides } });
      }, 200);
    };
    const applyLive = (overrides) => {
      try { window.SN_PAGE_BOOTSTRAP.applyThemeTokens(overrides); } catch (_) {}
    };
    const resolveTheme = () => (document.documentElement.dataset.snTheme === 'dark' ? 'dark' : 'light');
    // Risolve le dipendenze al click, leggendo gli override più freschi dallo
    // storage (Filo potrebbe averne cambiati altri nel frattempo).
    const resolve = async () => {
      let overrides = {};
      try {
        const settings = await self.SN_STORAGE.getSettings();
        overrides = { ...(settings.themeTokens || {}) };
      } catch (_) {}
      return { Tokens, theme: resolveTheme(), overrides, applyLive, persist, doc: document };
    };
    return R.buildButton(a, { Tokens, resolve });
  }

  // Esito di un comando da terminale mostrato in chat (#146.6): la riga di
  // comando + stdout/stderr in monospazio, con note per uscita/timeout/
  // troncamento, o l'avviso "modalità terminale disattivata".
  function renderCommandResult(out) {
    const wrap = document.createElement('div');
    wrap.className = 'dash-cmd-result';
    if (!out) return wrap;
    if (out.blocked === 'disabled') {
      wrap.classList.add('dash-cmd-blocked');
      wrap.textContent = 'Modalità terminale disattivata: attivala nelle impostazioni perché Filo possa eseguire comandi.';
      return wrap;
    }
    if (out.blocked === 'empty') {
      wrap.classList.add('dash-cmd-blocked');
      wrap.textContent = 'Comando vuoto.';
      return wrap;
    }
    const cmdLine = document.createElement('div');
    cmdLine.className = 'dash-cmd-line';
    cmdLine.textContent = `$ ${out.command || ''}`;
    wrap.appendChild(cmdLine);
    const body = (out.stdout || '') + (out.stderr ? (out.stdout ? '\n' : '') + out.stderr : '');
    if (body.trim()) {
      const pre = document.createElement('pre');
      pre.className = 'dash-cmd-output';
      if (out.stderr && !out.stdout) pre.classList.add('dash-cmd-output-err');
      pre.textContent = body;
      wrap.appendChild(pre);
    } else {
      // Comando senza output (tipicamente un `cd`): non lasciare una scatola
      // vuota e invisibile — mostra SEMPRE una risposta. Per i cambi di
      // cartella diciamo dove sei finito ("sei in <percorso>"); per gli altri
      // comandi muti un neutro "(nessun output)".
      const empty = document.createElement('pre');
      empty.className = 'dash-cmd-output dash-cmd-output-empty';
      const isCd = /^\s*(cd|chdir)\b/i.test(out.command || '');
      empty.textContent = (isCd && out.cwd) ? `sei in ${out.cwd}` : '(nessun output)';
      wrap.appendChild(empty);
    }
    const notes = [];
    if (typeof out.code === 'number' && out.code !== 0) notes.push(`uscita ${out.code}`);
    if (out.timedOut) notes.push('interrotto per timeout');
    if (out.truncated) notes.push('output troncato');
    if (notes.length) {
      const note = document.createElement('div');
      note.className = 'dash-cmd-note';
      note.textContent = notes.join(' · ');
      wrap.appendChild(note);
    }
    return wrap;
  }

  // #376 — traccia di un PASSO INTERMEDIO (cerco sul web, leggo un file,
  // verifico cosa so fare). Racconta cosa sta facendo Filo, ma non è un bottone:
  // niente pill né bordo, così l'unica cosa cliccabile nella conversazione resta
  // il risultato vero (il link aperto). Prima queste tracce avevano la stessa
  // forma dei bottoni e l'utente ne contava due per una singola azione.
  function stepTrace(text) {
    const el = document.createElement('div');
    el.className = 'dash-action-step';
    el.textContent = String(text || '').trim();
    return el;
  }

  function renderActionButton(a, { onAck } = {}) {
    const type = String(a.type || '').toUpperCase();
    // Azione sospesa in attesa di conferma (#146.2): il main non l'ha eseguita
    // (livello 2 o 3) e ha allegato spiegazione + livello. Il bottone apre il
    // popup OK/Annulla (2) o il box "digita conferma" (3); solo dopo il sì
    // dell'utente l'azione parte davvero via MSG.FILO_CONFIRM_ACTION.
    // PULISCI_TAB e CANCELLA_ARCHIVIO non passano di qui: hanno la loro UI.
    if (a._confirm && a._confirm.level >= 2) {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      // Per i comandi (#146.6) l'etichetta è il comando stesso, conciso; la
      // spiegazione completa resta nel popup di conferma (a._confirm.text).
      const cmdText = String(a.comando || a.command || a.cmd || '').trim();
      const isCmd = type === 'ESEGUI_COMANDO';
      const short = cmdText.length > 60 ? `${cmdText.slice(0, 57)}…` : cmdText;
      // Il testo completo (cosa fa + rischi, #183) vive nel popup. Sul bottone —
      // che resta solo come ripiego se l'utente annulla — basta la prima riga.
      const fullText = String(a._confirm.text || '');
      // I due punti finali annunciano il testo che segue nel popup ("…a tuo
      // nome:"): sul bottone, dove quel testo non c'è, restano appesi nel vuoto.
      const shortLabel = (fullText.split('\n')[0] || 'Esegui').replace(/\s*:\s*$/, '');
      btn.textContent = isCmd ? `▶ ${short}` : shortLabel;
      // #159/#414 — le azioni di livello 2 che Filo PROPONE da sé aprono il
      // popup di conferma da sole: marchiamo il bottone perché renderActions lo
      // possa aprire automaticamente. Oltre alle impostazioni (preferenza/
      // estetica) c'è la segnalazione agli sviluppatori: è Filo a proporla dopo
      // aver ammesso una mancanza, quindi lasciarla come chip da cliccare
      // aggiungeva un passaggio in più prima ancora di poter leggere cosa
      // partirebbe a nome dell'utente. Il popup non invia nulla: mostra il testo
      // e aspetta l'OK, esattamente come nella sidebar (che già fa così).
      // Le azioni distruttive (livello 3) e i comandi restano a click esplicito.
      const AUTO_CONFIRM_TYPES = ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'INVIA_FEEDBACK'];
      if (AUTO_CONFIRM_TYPES.includes(type) && a._confirm.level === 2) {
        btn.dataset.autoConfirm = '1';
      }
      // La conferma (popup + esecuzione) è una funzione a sé, così renderActions
      // può aprirla DA SOLA — anche in sequenza quando ci sono più azioni di
      // livello 2 nella stessa risposta (#183) — oltre che al click manuale.
      // Ritorna una Promise che si risolve quando il popup è chiuso, perché
      // l'auto-apertura sequenziale possa attendere l'una prima della successiva.
      async function runConfirm() {
        if (btn.disabled) return;
        const Ui = window.SN_CONFIRM_UI;
        const opts = { title: 'Filo chiede conferma', text: a._confirm.text || '' };
        const ok = Ui
          ? await (a._confirm.level >= 3 ? Ui.confirmTyped(opts) : Ui.confirm(opts))
          : window.confirm(opts.text); // fallback se il modulo non è caricato
        if (!ok) return;
        btn.disabled = true;
        const r = await send({ type: MSG.FILO_CONFIRM_ACTION, action: a });
        // #146.6 — comando confermato (livello 2/3): mostra l'output in chat.
        if (isCmd) {
          btn.textContent = (r && r.executed) ? `✓ ${short}` : `✗ ${short}`;
          if (r && r.output) btn.after(renderCommandResult(r.output));
          if (r && r.output) applyCommandCwd([{ _output: r.output }]);
          return;
        }
        btn.textContent = (r && r.executed) ? `✓ ${shortLabel}` : '✗ Non eseguita';
        // #146.4 — modifica estetica illeggibile (livello 2): confermata ed
        // applicata, offriamo subito il box per correggere il valore.
        if (r && r.executed && type === 'IMPOSTA_ESTETICA') {
          const refiner = buildAestheticRefiner(a);
          if (refiner) btn.after(refiner);
        }
      }
      btn._runConfirm = runConfirm;
      btn.addEventListener('click', runConfirm);
      return btn;
    }
    if (type === 'ESEGUI_COMANDO') {
      // Livello 1 (sola lettura) già eseguito dal main, oppure esito bloccato
      // (terminale spento): mostriamo direttamente il risultato in chat.
      return renderCommandResult(a._output);
    }
    if (type === 'IMPOSTA_ESTETICA') {
      // Livello 1 (caso normale): Filo l'ha già applicata server-side. Mostriamo
      // direttamente il bottone di raffinamento.
      return buildAestheticRefiner(a);
    }
    if (type === 'NAVIGA') {
      // #162 — il link è già stato aperto direttamente dal main (executeFiloAction
      // apre la scheda). Questo chip resta come riferimento per RIAPRIRLO, ma deve
      // SEMPRE avere un'etichetta leggibile: il favicon da solo, senza testo, era
      // il bottone "misterioso" del feedback. Mostriamo favicon + nome del sito.
      let label = String(a.label || a.etichetta || '').trim();
      if (!label) {
        try { label = new URL(a.url).hostname.replace(/^www\./, ''); } catch (_) { label = a.url || 'Apri'; }
      }
      // #376 — aperto in SECONDO PIANO: la scheda esiste già e sta suonando
      // dietro. Il chip allora non è più "riapri" ma "portami lì": attiva
      // QUELLA scheda invece di aprirne un doppione sullo stesso indirizzo.
      const bgTabId = (a._output && a._output.background && a._output.tabId) || '';
      const btn = document.createElement(bgTabId ? 'button' : 'a');
      if (bgTabId) {
        btn.type = 'button';
        btn.dataset.bgTab = bgTabId;
        btn.title = `Vai alla scheda — ${label} è aperta in secondo piano`;
        btn.addEventListener('click', async () => {
          const r = await send({ type: MSG.FOCUS_TAB, id: bgTabId });
          // Se quella scheda nel frattempo è stata chiusa, il riferimento deve
          // comunque funzionare: riapre il link invece di non fare nulla.
          if (!r || !r.ok) send({ type: MSG.OPEN_URL, url: a.url || '' });
        });
      } else {
        btn.href = a.url || '#';
        btn.target = '_blank';
        btn.rel = 'noopener';
        btn.title = `Riapri ${label}`;
      }
      btn.className = 'dash-action-btn dash-action-link-chip';
      const favUrl = faviconUrl(a.url);
      if (favUrl) {
        const img = document.createElement('img');
        img.className = 'dash-action-favicon';
        img.src = favUrl;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.remove();
        btn.appendChild(img);
      }
      btn.appendChild(document.createTextNode(bgTabId ? `▸ ${label}` : `↗ ${label}`));
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
      // #323 — durata umana fedele all'intento: "30 sec", "2 h", "1 h 30 min".
      // Niente arrotondamento ai minuti (un timer di 30 secondi non è "0 min").
      const dur = (self.SN_TIME ? self.SN_TIME.fmtDurationLabel(sec)
        : `${Math.round(sec / 60)} min`);
      btn.textContent = `⏱ ${a.label || a.etichetta || 'Timer'} · ${dur}`;
      return btn;
    }
    if (type === 'SALVA_APPUNTO') {
      // Ora che gli appunti vivono SOLO nei file dell'editor, la conferma non
      // può restare un chip inerte: sarebbe un vicolo cieco (l'utente sa che
      // Filo ha scritto, ma non ha da dove andare a leggere). Il chip resta la
      // ricevuta dell'azione — già eseguita — e in più apre l'editor, cioè il
      // posto dove l'appunto è finito.
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.dataset.action = 'openNotes';
      btn.textContent = '✎ Salvato';
      btn.title = 'Apri l’editor';
      btn.addEventListener('click', () => send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }));
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
      // Traccia del passo intermedio: rende trasparente che Filo sta cercando sul
      // web (#368). La ricerca è già partita nel main e i risultati rientrano nel
      // turno successivo (auto-continue), dove compare la risposta con i link
      // REALI. NON è un bottone: prima aveva la forma di una pill e l'utente si
      // ritrovava "due bottoni" per una cosa sola (#376).
      return stepTrace(`🔎 Cerco sul web: ${a.query || ''}`.trim());
    }
    if (type === 'CAPACITA_DETTAGLIO') {
      // Traccia del passo intermedio: Filo sta consultando il proprio manifesto
      // delle capacità (#F2) prima di rispondere.
      return stepTrace('📖 Verifico cosa so fare');
    }
    if (type === 'LEGGI_FILE') {
      // Traccia del passo intermedio: Filo apre un file dell'editor per leggerlo
      // per intero (#379.5). Il contenuto rientra nel turno successivo
      // (auto-continue), dove compare la risposta.
      const title = (a._output && a._output.title) || '';
      return stepTrace(title ? `📄 Leggo: ${title}` : '📄 Leggo un file');
    }
    if (type === 'LEGGI_TRASPARENZA') {
      // Traccia del passo intermedio: Filo rilegge le scelte dell'owner messe
      // per iscritto prima di rispondere sul perché di un modello o di un dato.
      return stepTrace('📄 Rileggo la pagina di trasparenza');
    }
    if (type === 'EVENTO_CALENDARIO') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      btn.textContent = `📅 ${a.title || a.titolo || ''}`;
      return btn;
    }
    if (type === 'PULISCI_TAB') {
      // Bottone di conferma: la pulizia parte SOLO al click (con conferma),
      // mai automaticamente (spec §2.1).
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      btn.textContent = '🧹 Riordina e archivia le schede';
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        // Livello 2 (#146.2): popup Filo che spiega la modifica, non il
        // window.confirm nativo (PATTERNS.md: niente default del browser).
        const text = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
          + 'Le schede archiviate restano riapribili da “Tab archiviate”.';
        const ok = window.SN_CONFIRM_UI
          ? await window.SN_CONFIRM_UI.confirm({ title: 'Riordino delle schede', text, okLabel: 'Procedi' })
          : window.confirm(`${text} Procedo?`);
        if (!ok) return;
        btn.disabled = true;
        btn.textContent = '🧹 Riordino in corso…';
        const r = await send({ type: MSG.RUN_TAB_TRIAGE });
        const n = (r && r.archived) || 0;
        btn.textContent = n > 0
          ? `✓ Archiviate ${n} ${n === 1 ? 'scheda' : 'schede'}`
          : '✓ Nessuna scheda da archiviare';
      });
      return btn;
    }
    if (type === 'CANCELLA_ARCHIVIO') {
      return renderDeleteArchivePanel(a.query || a.testo || '');
    }
    return null;
  }

  // §5 — pannello di cancellazione retroattiva: cerca le schede pertinenti nella
  // cronologia e le elimina DEFINITIVAMENTE dopo conferma esplicita.
  function renderDeleteArchivePanel(query) {
    const panel = document.createElement('div');
    panel.className = 'dash-delete-panel';
    const note = document.createElement('div');
    note.className = 'dash-delete-note';
    note.textContent = `Cerco nell’archivio: “${query}”…`;
    panel.appendChild(note);

    (async () => {
      const r = await send({ type: MSG.SEARCH_ARCHIVED_TABS, query });
      const results = (r && Array.isArray(r.results)) ? r.results.slice(0, 20) : null;
      if (!results || !results.length) {
        note.textContent = results
          ? `Nessuna scheda archiviata corrisponde a “${query}”.`
          : 'Ricerca non disponibile (manca la chiave per la ricerca semantica).';
        return;
      }
      note.textContent = `Trovate ${results.length} schede pertinenti a “${query}”. Verranno eliminate DEFINITIVAMENTE:`;
      const ul = document.createElement('ul');
      ul.className = 'dash-delete-list';
      for (const it of results) {
        const li = document.createElement('li');
        li.textContent = it.title || it.url || '(senza titolo)';
        li.title = it.url || '';
        ul.appendChild(li);
      }
      panel.appendChild(ul);

      const del = document.createElement('button');
      del.className = 'dash-action-btn dash-action-btn-danger';
      del.type = 'button';
      del.textContent = `🗑 Elimina definitivamente ${results.length} ${results.length === 1 ? 'scheda' : 'schede'}`;
      del.addEventListener('click', async () => {
        if (del.disabled) return;
        // Livello 3 (#146.2): eliminazione irreversibile → l'utente deve
        // digitare espressamente "conferma".
        const text = `Eliminare definitivamente ${results.length} ${results.length === 1 ? 'scheda' : 'schede'} dall’archivio.`;
        const ok = window.SN_CONFIRM_UI
          ? await window.SN_CONFIRM_UI.confirmTyped({ title: 'Eliminazione definitiva', text, okLabel: 'Elimina' })
          : window.confirm(`${text} L’operazione non è reversibile.`);
        if (!ok) return;
        del.disabled = true;
        del.textContent = 'Elimino…';
        const res = await send({ type: MSG.DELETE_ARCHIVED_TABS, ids: results.map((x) => x.id) });
        const removed = (res && res.removed) || 0;
        del.remove();
        ul.remove();
        note.textContent = `✓ Eliminate definitivamente ${removed} ${removed === 1 ? 'scheda' : 'schede'}.`;
      });
      panel.appendChild(del);
    })();

    return panel;
  }

  // ===== Invio messaggio =====
  // Quanti passi autonomi Filo può fare di fila prima di restituire comunque la
  // parola all'utente: rete di sicurezza contro loop o costi che esplodono.
  const MAX_AUTO_STEPS = 8;
  // Nudge interno (mai mostrato come bolla) che fa proseguire Filo dopo un
  // comando: vede l'output appena prodotto e continua col passo successivo,
  // oppure — se ha finito — risponde senza eseguire altri comandi.
  const AUTO_CONTINUE_PROMPT =
    'Prosegui col prossimo passo usando l’output del comando qui sopra. ' +
    'Se hai completato il compito, rispondi all’utente senza eseguire altri comandi.';
  // Nudge interno dopo un CAPACITA_DETTAGLIO: ora l'agente ha i dettagli esatti
  // delle capacità qui sopra e deve rispondere all'utente (non chiederne altri).
  const AUTO_CONTINUE_CAPABILITY =
    'Ora hai i dettagli delle capacità di Filo qui sopra. Rispondi all’utente: ' +
    'se la capacità esiste spiega con parole tue cosa fa e come si usa; se NON ' +
    'esiste, dillo con onestà senza inventare. Non emettere altre azioni CAPACITA_DETTAGLIO.';
  // Nudge interno dopo una CERCA_WEB: ora l'agente ha i risultati REALI qui
  // sopra (titolo, URL, snippet) e deve rispondere all'utente. Se deve aprire un
  // risultato usa NAVIGA con l'URL ESATTO tra i risultati, mai inventato (#368).
  const AUTO_CONTINUE_WEB =
    'Ora hai i risultati della ricerca web qui sopra (titolo, URL, snippet reali). ' +
    'Rispondi all’utente usando questi risultati: se ha chiesto di aprire qualcosa, ' +
    'emetti NAVIGA con l’URL ESATTO preso dai risultati (non inventarne uno); ' +
    'altrimenti riporta i link pertinenti nel testo. Se i risultati non contengono ' +
    'ciò che serve, dillo con onestà. Non emettere un’altra CERCA_WEB per la stessa richiesta.';
  // Nudge interno dopo un LEGGI_FILE (#379.5): ora l'agente ha il testo completo
  // del file qui sopra e deve rispondere all'utente usandolo, senza richiederlo
  // di nuovo.
  const AUTO_CONTINUE_FILE =
    'Ora hai il contenuto completo del file qui sopra. Rispondi all’utente usando ' +
    'quel testo. Non emettere un’altra LEGGI_FILE per lo stesso file.';
  // Nudge interno dopo una LEGGI_TRASPARENZA: l'agente ha davanti le scelte
  // dell'owner messe per iscritto e deve rispondere ATTENENDOSI a quelle. È il
  // punto in cui è più tentato di ricostruire a memoria una posizione etica che
  // nel documento è scritta in modo preciso: qui la memoria sbaglia e il testo no.
  const AUTO_CONTINUE_TRANSPARENCY =
    'Ora hai il testo del documento di trasparenza qui sopra. Rispondi all’utente ' +
    'attenendoti a quello che c’è scritto, senza aggiungere motivazioni tue: se il ' +
    'documento non risponde alla domanda, dillo e indica quale sezione ci va vicino. ' +
    'Non emettere un’altra LEGGI_TRASPARENZA per lo stesso documento.';

  function isType(a, t) {
    return a && String(a.type || '').toUpperCase() === t;
  }
  // Nudge giusto per il passo automatico successivo, in base a cosa ha appena
  // fatto Filo: un lookup di capacità chiede una risposta, un comando chiede di
  // proseguire la sequenza.
  function autoContinueNudge(actions) {
    const cmd = Array.isArray(actions) && actions.some((a) => isType(a, 'ESEGUI_COMANDO') && a._output && !a._output.blocked);
    if (!cmd && Array.isArray(actions) && actions.some((a) => isType(a, 'CAPACITA_DETTAGLIO') && a._output)) {
      return AUTO_CONTINUE_CAPABILITY;
    }
    if (!cmd && Array.isArray(actions) && actions.some((a) => isType(a, 'CERCA_WEB') && a._output)) {
      return AUTO_CONTINUE_WEB;
    }
    if (!cmd && Array.isArray(actions) && actions.some((a) => isType(a, 'LEGGI_FILE') && a._output)) {
      return AUTO_CONTINUE_FILE;
    }
    if (!cmd && Array.isArray(actions) && actions.some((a) => isType(a, 'LEGGI_TRASPARENZA') && a._output)) {
      return AUTO_CONTINUE_TRANSPARENCY;
    }
    return AUTO_CONTINUE_PROMPT;
  }

  // Filo deve proseguire da solo quando ha appena ESEGUITO un comando da
  // terminale (output reale tornato) e NON c'è nulla in attesa di conferma. Un
  // comando rischioso (livello 2/3) resta con `_confirm` e mette in pausa il
  // loop: compare il popup e la parola torna all'utente, come da spec.
  function shouldAutoContinue(actions) {
    if (!Array.isArray(actions) || !actions.length) return false;
    if (actions.some((a) => a && a._confirm)) return false;
    // Comando eseguito (output reale) → prosegui la sequenza; lookup di capacità
    // (#F2) → prosegui per rispondere all'utente coi dettagli appena ottenuti.
    return actions.some((a) =>
      (isType(a, 'ESEGUI_COMANDO') && a._output && !a._output.blocked)
      || (isType(a, 'CAPACITA_DETTAGLIO') && a._output)
      || (isType(a, 'CERCA_WEB') && a._output)
      || (isType(a, 'LEGGI_FILE') && a._output)
      || (isType(a, 'LEGGI_TRASPARENZA') && a._output));
  }

  // Un singolo turno del modello: bolla "sta pensando" + reasoning live, invio
  // FILO_CHAT, render della bolla di Filo con le sue azioni e registrazione del
  // turno nello storico. Ritorna la risposta grezza per decidere se proseguire.
  // `internal: true` per i turni di prosecuzione automatica: il "messaggio
  // utente" è un nudge scritto da noi, non una richiesta reale. Il main lo usa
  // per non trattarlo come parole dell'utente (#360: una segnalazione proposta
  // da Filo non deve citare un nudge interno).
  async function runFiloTurn({ userMessage, images = [], internal = false }) {
    // Bolla Filo "sta pensando": 3 righe di reasoning che scorrono e svaniscono.
    const pending = appendThinking();
    // Canale per il reasoning VERO in diretta: apriamo una sottoscrizione
    // filtrata per reqId e la passiamo al main, che ci pusha i thought summary
    // del modello mentre genera. Se il modello non ragiona, non arriva nulla e
    // restano le frasi indicative.
    const reasoningReqId = `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let offReasoning = null;
    if (window.filo?.onReasoning) {
      offReasoning = window.filo.onReasoning((data) => {
        if (data && data.reqId === reasoningReqId && data.text) pending.pushReasoning(data.text);
      });
    }
    // #420 — RISPOSTA in diretta: la bolla di Filo si riempie mentre il modello
    // scrive, invece di comparire tutta insieme a fine turno. Il main estrae il
    // campo "text" dal JSON di risposta e ci pusha i delta (o un reset dopo un
    // fallback provider). La bolla NON si crea finché non arriva il PRIMO
    // carattere: una risposta di sola azione (apri un link, testo vuoto) non
    // lascia una bolla vuota che poi si riempie. Quando il testo inizia,
    // l'indicatore di ragionamento si ritira: i due non si accavallano.
    let streamBubble = null;
    let streamedText = '';
    const followBottomIfNear = () => {
      const nearBottom = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 48;
      if (nearBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };
    let offAnswer = null;
    if (window.filo?.onAnswer) {
      offAnswer = window.filo.onAnswer((data) => {
        if (!data || data.reqId !== reasoningReqId) return;
        if (data.reset) {
          // Fallback provider a metà: butta ciò che era già a schermo, non accodare.
          streamedText = '';
          if (streamBubble) streamBubble.textContent = '';
          return;
        }
        if (!data.delta) return;
        if (!streamBubble) {
          pending.remove(); // il ragionamento lascia il posto alla risposta
          streamBubble = document.createElement('div');
          streamBubble.className = 'dash-bubble dash-bubble-filo dash-bubble-streaming';
          bubblesEl.appendChild(streamBubble);
        }
        streamedText += data.delta;
        streamBubble.textContent = streamedText;
        followBottomIfNear();
      });
    }
    const msg = {
      type: MSG.FILO_CHAT,
      userMessage,
      threadHistory: threadHistory.slice(0, -1),
      reasoningReqId,
      internal,
    };
    if (images.length) {
      msg.image = images[0]; // retrocompatibilità (provider mono-immagine)
      msg.images = images;
    }
    const r = await send(msg);

    if (offReasoning) { try { offReasoning(); } catch (_) {} }
    if (offAnswer) { try { offAnswer(); } catch (_) {} }
    pending.remove();
    if (!r?.ok) {
      // Un turno fallito non deve lasciare a schermo il testo parziale di un
      // tentativo andato male: scartiamo la bolla in streaming e mostriamo l'errore.
      if (streamBubble) { streamBubble.remove(); streamBubble = null; }
      const err = makeBubble({ role: 'filo', text: r?.error || 'Errore.' });
      // #360 — la bolla d'errore dice "riprova": darglielo da fare a mano
      // (riscrivere la domanda) è attrito inutile. Il tasto rimanda LO STESSO
      // messaggio, come il "Riprova" della pagina d'errore di una scheda.
      const row = document.createElement('div');
      row.className = 'dash-bubble-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'dash-action-btn dash-action-btn-primary';
      retry.textContent = '↻ Riprova';
      retry.title = 'Rimanda lo stesso messaggio';
      retry.addEventListener('click', () => retryTurn(err, { userMessage, images, internal }));
      row.appendChild(retry);
      err.appendChild(row);
      bubblesEl.appendChild(err);
    } else {
      // La risposta finale (r.text) è autorevole: riconcilia la bolla in
      // streaming con essa (recupera l'eventuale coda non ancora emessa). Se non
      // c'è testo ma ci sono azioni, la bolla in streaming non esiste (non è mai
      // arrivato un delta) e cadiamo nel ramo "solo azioni" come prima.
      let filoBubble;
      if (streamBubble) {
        streamBubble.classList.remove('dash-bubble-streaming');
        if (r.text) {
          // #418 — a fine turno il testo grezzo dello streaming diventa la
          // risposta formattata (grassetto, corsivo, elenchi, link cliccabili).
          setBubbleText(streamBubble, r.text, true);
          filoBubble = streamBubble;
        } else {
          // Il testo si è svuotato (es. reset non recuperato): niente bolla vuota.
          streamBubble.remove();
          filoBubble = makeBubble({ role: 'filo', text: '' });
          bubblesEl.appendChild(filoBubble);
        }
      } else {
        filoBubble = makeBubble({ role: 'filo', text: r.text || '', markdown: true });
        bubblesEl.appendChild(filoBubble);
      }
      // #159 — risposta fresca: le impostazioni a livello 2 aprono il loro popup
      // di conferma da sole (autoConfirm). Solo qui (nuova risposta), mai in
      // replay storico.
      renderActions(filoBubble, r.actions || [], { onAck: goHome, autoConfirm: true });
      threadHistory.push({ role: 'filo', text: r.text || '', actions: r.actions || [] });
      applyCommandCwd(r.actions);
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    return r;
  }

  async function submitMessage(text) {
    if ((!text && pendingImages.length === 0) || sending) return;
    sending = true;
    sendBtn.disabled = true;
    const imagesToSend = pendingImages.slice();
    clearImagePreviews();
    // Svuota subito la textarea: la bolla utente è già visibile, niente attesa.
    inputEl.value = '';
    autoGrowInput();
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

    await runTurnAndContinue({ userMessage: text || 'Descrivi questa immagine.', images: imagesToSend });
  }

  // Un turno + la sua eventuale prosecuzione autonoma, e il rilascio della barra
  // di invio. Condiviso tra il primo invio e il "Riprova" della bolla d'errore:
  // riprovare deve comportarsi ESATTAMENTE come inviare.
  async function runTurnAndContinue(args) {
    let r = await runFiloTurn(args);

    // Esecuzione autonoma in sequenza: finché Filo ha appena eseguito un comando
    // (e non c'è una conferma in sospeso), gli rimostriamo l'output e lo
    // lasciamo proseguire da solo — un comando, il suo output, il successivo —
    // senza che l'utente debba rilanciarlo. Si ferma quando Filo risponde senza
    // più comandi (compito finito) o quando un'azione rischiosa apre il popup.
    let steps = 0;
    while (r?.ok && shouldAutoContinue(r.actions) && steps < MAX_AUTO_STEPS) {
      steps += 1;
      // Il nudge entra nello storico come turno utente "silenzioso" (niente
      // bolla): dà al modello il contesto per il passo successivo. Il testo
      // dipende da cosa Filo ha appena fatto (comando vs lookup di capacità).
      const nudge = autoContinueNudge(r.actions);
      threadHistory.push({ role: 'user', text: nudge });
      r = await runFiloTurn({ userMessage: nudge, internal: true });
    }

    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();

    // Aggiorna live (potrebbe esserci un timer/sveglia appena creato).
    refreshLive().catch(() => {});
    return r;
  }

  // #360 — "Riprova" dalla bolla d'errore: rimanda lo stesso messaggio senza
  // farlo riscrivere. La bolla d'errore sparisce (il tentativo è ricominciato) e
  // lo storico è già a posto: un turno fallito non ci ha lasciato niente dentro.
  async function retryTurn(errBubble, args) {
    if (sending) return;
    sending = true;
    sendBtn.disabled = true;
    try { errBubble.remove(); } catch (_) {}
    await runTurnAndContinue(args);
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

  // Vero se l'account loggato è l'owner (admin): abilita i comandi /users e
  // /gift in /help. Il gate forte resta nel main (auth.isAdmin) + Firestore rules.
  let isOwner = false;

  const SLASH_COMMANDS = {
    '/home': () => { goHome(); },
    '/clear': () => { goHome(); },
    '/clear all': () => { send({ type: MSG.CLOSE_ALL_TABS }); },
    '/kill': () => { send({ type: MSG.QUIT_APP }); },
    '/newtab': () => { send({ type: MSG.OPEN_URL, url: 'filo://newtab/' }); },
    '/models': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/modelli': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/sicurezza': () => { send({ type: MSG.OPEN_URL, url: 'filo://security/security.html' }); },
    '/preferenze': () => { send({ type: MSG.OPEN_URL, url: 'filo://preferences/preferences.html' }); },
    '/editor': () => { send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }); },
    '/feedback': () => { send({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' }); },
    '/incognito': () => { send({ type: MSG.OPEN_INCOGNITO }); },
    '/pulisci': () => { runTabCleanup(); },
    '/pulizia': () => { runTabCleanup(); },
    '/riordina': () => { runTabReorder(); },
    '/set': (text) => { handleSetCommand(text); },
    '/users': () => { handleUsersCommand(); },
    '/gift': (text) => { handleGiftCommand(text); },
    '/help': () => {
      if (body.dataset.state !== 'thread') goThread();
      const lines = [
        '/home, /clear — ricarica la dashboard',
        '/clear all — chiudi tutte le schede',
        '/kill — chiudi Filo',
        '/newtab — apri una nuova scheda',
        '/models, /modelli — impostazioni modelli',
        '/sicurezza — impostazioni sicurezza',
        '/preferenze — preferenze',
        '/editor — apri l\'editor',
        '/feedback — apri i feedback',
        '/incognito — apri una finestra in incognito',
        '/pulisci, /pulizia — riordina e archivia le schede non più utili',
        '/riordina — riordina le schede per colore (nessuna viene chiusa)',
        '/set timer 5:00 — avvia un timer (anche /set timer 8 = 8 minuti)',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      if (isOwner) {
        lines.push(
          '/users — elenca gli utenti registrati (proprietario)',
          '/gift NUMERO EMAIL — regala crediti a un utente (proprietario)',
        );
      }
      const bubble = makeBubble({ role: 'filo', text: lines.join('\n') });
      bubblesEl.appendChild(bubble);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    },
  };

  // "/users": elenca le email degli utenti registrati. Riservato al proprietario
  // (il main rifiuta i non-admin con un messaggio chiaro).
  async function handleUsersCommand() {
    showFiloLine('Recupero gli utenti registrati…');
    const r = await send({ type: MSG.OWNER_LIST_USERS });
    if (!r || r.ok === false) { showFiloLine(r?.error || 'Non sono riuscito a recuperare gli utenti.'); return; }
    const users = Array.isArray(r.users) ? r.users : [];
    if (!users.length) { showFiloLine('Nessun utente registrato.'); return; }
    const lines = users.map((u) => `• ${u.email}${u.name ? ` (${u.name})` : ''} — ${u.balance} crediti`);
    showFiloLine(`Utenti registrati (${users.length}):\n${lines.join('\n')}`);
  }

  // "/gift NUMERO EMAIL": regala crediti a un utente. Riservato al proprietario.
  async function handleGiftCommand(text) {
    const m = /^\/gift\s+(\S+)\s+(\S+)\s*$/i.exec(String(text || '').trim());
    if (!m) { showFiloLine('Uso: /gift NUMERO EMAIL — es. /gift 2000 mario@esempio.com'); return; }
    const amount = Number(m[1]);
    const email = m[2];
    if (!Number.isInteger(amount) || amount <= 0) {
      showFiloLine(`"${m[1]}" non è un numero di crediti valido. Usa un intero positivo.`);
      return;
    }
    showFiloLine(`Regalo ${amount} crediti a ${email}…`);
    const r = await send({ type: MSG.OWNER_GIFT_CREDITS, amount, email });
    if (!r || r.ok === false) { showFiloLine(r?.error || 'Operazione non riuscita.'); return; }
    showFiloLine(`✓ Regalati ${r.amount} crediti a ${r.email}. Nuovo saldo del destinatario: ${r.balance}.`);
  }

  // Mostra una riga di risposta da Filo nel thread (usata dai comandi che
  // hanno bisogno di dire qualcosa: es. l'uso corretto di /set timer).
  function showFiloLine(text) {
    if (body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({ role: 'filo', text });
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // "/pulisci" (o "/pulizia"): avvia il riordino/archiviazione delle schede non
  // più utili, con la STESSA conferma del bottone "🧹 Riordina e archivia le
  // schede" (mai automatico, spec §2.1). Riusa il popup Filo SN_CONFIRM_UI.
  async function runTabCleanup() {
    const text = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
      + 'Le schede archiviate restano riapribili da “Tab archiviate”.';
    const ok = window.SN_CONFIRM_UI
      ? await window.SN_CONFIRM_UI.confirm({ title: 'Riordino delle schede', text, okLabel: 'Procedi' })
      : window.confirm(`${text} Procedo?`);
    if (!ok) return;
    showFiloLine('🧹 Riordino in corso…');
    const r = await send({ type: MSG.RUN_TAB_TRIAGE });
    const n = (r && r.archived) || 0;
    showFiloLine(n > 0
      ? `✓ Archiviate ${n} ${n === 1 ? 'scheda' : 'schede'}.`
      : '✓ Nessuna scheda da archiviare.');
  }

  // "/riordina": riordina la striscia delle schede per colore, esattamente come
  // succede alla riapertura di Filo, ma SENZA chiudere/archiviare nulla (a
  // differenza di /pulisci). Immediato: è deterministico e non tocca i contenuti,
  // quindi niente popup di conferma — l'utente può sempre rifarlo o riaprire una
  // scheda. Diamo comunque un feedback esplicito (spec: ogni azione ha un esito).
  async function runTabReorder() {
    const r = await send({ type: MSG.REORDER_TABS });
    showFiloLine(r && r.reordered
      ? '✓ Schede riordinate per colore.'
      : '✓ Le schede erano già in ordine.');
  }

  // Converte l'argomento di "/set timer" in secondi.
  //   "5:00" → 5 minuti 0 secondi → 300 ; "8" → 8 minuti → 480.
  // Ritorna null se non è una durata valida.
  function parseTimerArg(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2) return null;
      // Ogni parte deve essere un intero esplicito: "5:", ":30" o "5: 30" non
      // sono durate valide (Number('') === 0 le farebbe passare in silenzio).
      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
      const mm = Number(parts[0]);
      const ss = Number(parts[1]);
      if (ss > 59) return null;
      const total = mm * 60 + ss;
      return total > 0 ? total : null;
    }
    if (!/^\d+$/.test(s)) return null;
    const mins = Number(s);
    return mins > 0 ? mins * 60 : null;
  }

  // "/set timer 5:00" oppure "/set timer 8" → avvia un timer.
  function handleSetCommand(text) {
    const m = /^\/set\s+timer\s+(.+)$/i.exec(String(text || '').trim());
    if (!m) {
      showFiloLine('Uso: /set timer 5:00 oppure /set timer 8 (minuti).');
      return;
    }
    const seconds = parseTimerArg(m[1]);
    if (seconds == null) {
      showFiloLine(`Non ho capito la durata "${m[1].trim()}". Prova /set timer 5:00 o /set timer 8.`);
      return;
    }
    send({ type: MSG.FILO_ADD_TIMER, label: 'Timer', seconds }).then((r) => {
      if (r && r.ok !== false) {
        goHome();
        refreshLive();
      } else {
        showFiloLine('Non sono riuscito ad avviare il timer.');
      }
    });
  }

  // Riconosce un singolo token "tipo sito" (es. google.com, github.com/x,
  // http://localhost:3000, localhost:3000, 127.0.0.1:8080, 192.168.1.1). DEVE
  // essere preciso: un comando di shell come `/git log v1.2` o `/cat file.txt`
  // NON è un sito. La logica (e la simmetria con la vecchia barra indirizzi della
  // shell) vive in src/shared/urlNav.js (#398): qui togliamo la "/" e chiediamo
  // a SN_URL_NAV.looksLikeAddress — così indirizzi locali e IP sono riconosciuti
  // come lo erano dalla barra, invece di finire all'LLM.
  function isSiteToken(text) {
    return !!(self.SN_URL_NAV && self.SN_URL_NAV.looksLikeAddress(text.slice(1)));
  }

  // Estrae l'host da un token "/sito" (toglie "/", lo schema e l'eventuale
  // path/porta), per la verifica DNS.
  function siteHostOf(text) {
    const raw = text.slice(1).replace(/^https?:\/\//i, '');
    return (raw.split(/[/:?#]/)[0] || '').toLowerCase();
  }

  // Cache "il comando shell esiste?" (token → bool), per non rifare lo spawn
  // di controllo a ogni tasto. Il risultato non dipende dalla cwd per i comandi
  // su PATH; per i casi limite (script relativi) la piccola imprecisione è ok.
  const shellCmdCache = new Map();
  let whichTimer = null;

  // Cache "il dominio /sito.tld esiste?" (host → bool). Evita di rifare il
  // lookup DNS a ogni tasto; popolata sia dalla verifica live sia da quella
  // sull'invio. Un host non in cache = ancora da verificare (resta arancione).
  const siteResolveCache = new Map();
  let siteResolveTimer = null;

  // Classifica l'input corrente per l'evidenziazione live:
  //   'filo'    → comando interno di Filo (o navigazione a sito) → arancione
  //   'shell'   → comando shell esistente (modalità terminale) → azzurro
  //   'unknown' → inizia con "/" ma non è un comando riconosciuto → rosso
  //   'pending' → modalità terminale, esistenza del comando ancora da verificare
  //   'none'    → testo normale (va all'LLM)
  function classifyInput(value) {
    const t = value.trim();
    if (!t.startsWith('/')) return 'none';
    const firstToken = t.split(/\s+/)[0];
    if (SLASH_COMMANDS[t] || SLASH_COMMANDS[firstToken]) return 'filo';
    if (isSiteToken(t)) {
      // Sito: arancione di default; rosso SOLO se abbiamo già verificato che il
      // dominio non esiste (niente flicker mentre il lookup è in volo).
      const host = siteHostOf(t);
      if (host && siteResolveCache.get(host) === false) return 'unknown';
      return 'filo';
    }
    if (terminalMode) {
      // In terminale "/x" è un comando shell: azzurro se esiste, rosso se no.
      const cmd = firstToken.slice(1);
      if (!cmd) return 'none';
      if (shellCmdCache.has(cmd)) return shellCmdCache.get(cmd) ? 'shell' : 'unknown';
      return 'pending'; // verifica in corso (vedi scheduleShellWhich)
    }
    // Modalità normale: un "/comando" che non è interno né un sito non verrà
    // riconosciuto (finirebbe all'LLM come testo). Lo segnaliamo in rosso —
    // MA non mentre l'utente sta ancora digitando un prefisso che potrebbe
    // diventare un comando valido (es. "/he" → "/help"): in quel caso restiamo
    // neutri così il rosso non lampeggia a ogni tasto.
    const hasSpace = /\s/.test(t);
    if (!hasSpace && isCommandPrefix(firstToken)) return 'none';
    return 'unknown';
  }

  // Vero se `token` (es. "/he") è il prefisso non vuoto di un comando Filo noto
  // (es. "/help"), ma non è ancora il comando completo.
  function isCommandPrefix(token) {
    if (!token || token === '/') return false;
    return Object.keys(SLASH_COMMANDS).some(
      (cmd) => cmd !== token && cmd.startsWith(token)
    );
  }

  // Verifica (con debounce) se il primo token è un comando shell esistente e
  // poi ricolora. Debounce così il controllo parte solo quando l'utente si
  // ferma: digitando di getto "/git" i prefissi non vengono mai controllati e
  // il rosso non lampeggia.
  function scheduleShellWhich(value) {
    clearTimeout(whichTimer);
    whichTimer = setTimeout(async () => {
      const firstToken = value.trim().split(/\s+/)[0];
      const cmd = firstToken.slice(1);
      if (!cmd || shellCmdCache.has(cmd)) { updateInputClass(); return; }
      let exists = false;
      try {
        const r = await window.filo?.shellWhich?.({ command: cmd, shell: terminalShell, cwd: currentCwd });
        exists = !!(r && r.exists);
      } catch (_) { exists = false; }
      shellCmdCache.set(cmd, exists);
      updateInputClass(); // ricolora sullo stato attuale dell'input
    }, 250);
  }

  // Verifica (immediata) se l'host di un "/sito.tld" risolve, e popola la cache.
  // Usata sull'invio: in caso di dubbio (rete giù, errore) torna true così non
  // blocca mai una navigazione legittima.
  async function ensureSiteResolved(host) {
    if (!host) return true;
    if (siteResolveCache.has(host)) return siteResolveCache.get(host);
    let resolves = true;
    try {
      const r = await window.filo?.siteResolves?.({ host });
      resolves = !(r && r.resolves === false);
    } catch (_) { resolves = true; }
    siteResolveCache.set(host, resolves);
    return resolves;
  }

  // Come sopra ma con debounce, per la verifica live mentre si scrive: parte
  // solo quando l'utente si ferma, poi ricolora (rosso se il dominio non esiste).
  function scheduleSiteResolve(host) {
    clearTimeout(siteResolveTimer);
    siteResolveTimer = setTimeout(async () => {
      if (!host || siteResolveCache.has(host)) { updateInputClass(); return; }
      await ensureSiteResolved(host);
      updateInputClass();
    }, 250);
  }

  function updateInputClass() {
    const kind = classifyInput(inputEl.value);
    // 'pending' (terminale, esistenza del comando ancora da verificare) viene
    // mostrato GIÀ in rosso: aggiungere caratteri a un "/comando" non deve far
    // lampeggiare il colore tornando a neutro a ogni tasto mentre il controllo
    // è in corso. Quando il check risolve, il comando diventa azzurro (esiste)
    // o resta rosso (non esiste), senza flicker intermedi.
    const showUnknown = kind === 'unknown' || kind === 'pending';
    inputEl.classList.toggle('is-cmd-filo', kind === 'filo');
    inputEl.classList.toggle('is-cmd-shell', kind === 'shell');
    inputEl.classList.toggle('is-cmd-unknown', showUnknown);
    // In attesa del controllo "esiste?": rosso (vedi sopra) e avvia il check.
    if (kind === 'pending') scheduleShellWhich(inputEl.value);
    // Sito (arancione) non ancora verificato: avvia il lookup DNS (debounce)
    // così, se il dominio non esiste, l'input diventa rosso.
    const t = inputEl.value.trim();
    if (kind === 'filo' && t.startsWith('/') && isSiteToken(t)) {
      const host = siteHostOf(t);
      if (host && !siteResolveCache.has(host)) scheduleSiteResolve(host);
    }
  }

  function handleSlashCommand(text) {
    if (!text.startsWith('/')) return false;
    const firstToken = text.split(/\s+/)[0];
    // 1) Comandi interni di Filo: vincono SEMPRE, anche in modalità terminale.
    const handler = SLASH_COMMANDS[text] || SLASH_COMMANDS[firstToken];
    if (handler) { handler(text); inputEl.value = ''; autoGrowInput(); updateInputClass(); return true; }
    // 2) Navigazione diretta a un sito: solo se è un singolo token "tipo sito".
    //    L'URL (e lo schema: http per i server locali/IP privati, https per i
    //    domini pubblici) lo compone la stessa logica della vecchia barra
    //    indirizzi — SN_URL_NAV.normalizeUrl (#398) — così "/localhost:3000" o
    //    "/192.168.1.1" si aprono davvero invece di partire su un https vuoto.
    if (isSiteToken(text)) {
      const raw = text.slice(1);
      const url = (self.SN_URL_NAV && self.SN_URL_NAV.normalizeUrl(raw))
        || (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      send({ type: MSG.OPEN_URL, url });
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      return true;
    }
    // 3) Modalità terminale: tutto il resto con `/` viene eseguito dalla shell
    //    (non passa mai all'LLM).
    if (terminalMode) {
      runShellCommand(text.slice(1).trim());
      inputEl.value = '';
      autoGrowInput();
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

  // Aggiorna la cartella corrente e la RENDE PERSISTENTE tra le sessioni (#259):
  // riaprendo Filo si riparte da qui, non dalla home. Un solo punto di verità per
  // ogni cambio di `cwd`, così barra mostrata, cartella reale e valore salvato
  // restano allineati.
  function setCwd(cwd) {
    if (!cwd || cwd === currentCwd) return;
    currentCwd = cwd;
    updateDirLine();
    applyTerminalMode();
    try { self.SN_STORAGE?.setRaw?.(STORAGE_KEYS.FILO_TERMINAL_CWD, cwd); } catch (_) {}
  }

  // L'assistente ha eseguito uno o più comandi: se l'ultimo ha cambiato cartella
  // (un `cd`, ora persistente), il main ce la riporta in _output.cwd. Aggiorniamo
  // la barra del percorso così "percorso mostrato" e cartella reale coincidono.
  function applyCommandCwd(actions) {
    if (!Array.isArray(actions)) return;
    let cwd = '';
    for (const a of actions) {
      const out = a && a._output;
      if (out && out.cwd) cwd = out.cwd;
    }
    if (cwd) setCwd(cwd);
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
    // Ripristina l'ultima cartella in cui era il terminale (#259): riaprendo Filo
    // non si torna alla home. Se non c'è nulla di salvato (primo avvio) si parte
    // dalla home come prima. Se la cartella salvata non esiste più, il main la
    // riporta alla home al primo comando (shell.js valida la cwd) e il valore si
    // auto-corregge.
    try {
      const saved = await self.SN_STORAGE?.getRaw?.(STORAGE_KEYS.FILO_TERMINAL_CWD, '');
      if (saved && typeof saved === 'string') currentCwd = saved;
    } catch (_) {}
    if (!currentCwd) {
      try {
        const r = await window.filo?.shellHome?.();
        if (r?.cwd) currentCwd = r.cwd;
      } catch (_) {}
    }
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

    // Stato di stile ANSI per QUESTA bolla (attraversa i chunk: un colore
    // aperto in un chunk resta valido nei successivi finché non c'è un reset).
    const ansi = { tail: '', fg: null, bg: null, bold: false, dim: false, underline: false };
    const applySgr = (params) => {
      const codes = (params === '' ? '0' : params).split(';').map((x) => parseInt(x || '0', 10) || 0);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { ansi.fg = ansi.bg = null; ansi.bold = ansi.dim = ansi.underline = false; }
        else if (c === 1) ansi.bold = true;
        else if (c === 2) ansi.dim = true;
        else if (c === 4) ansi.underline = true;
        else if (c === 22) { ansi.bold = false; ansi.dim = false; }
        else if (c === 24) ansi.underline = false;
        else if (c === 39) ansi.fg = null;
        else if (c === 49) ansi.bg = null;
        else if (c >= 30 && c <= 37) ansi.fg = ANSI_BASE[c - 30];
        else if (c >= 90 && c <= 97) ansi.fg = ANSI_BASE[c - 90 + 8];
        else if (c >= 40 && c <= 47) ansi.bg = ANSI_BASE[c - 40];
        else if (c >= 100 && c <= 107) ansi.bg = ANSI_BASE[c - 100 + 8];
        else if (c === 38 || c === 48) {
          const tgt = c === 38 ? 'fg' : 'bg';
          if (codes[i + 1] === 5) { ansi[tgt] = xterm256(codes[i + 2] || 0); i += 2; }
          else if (codes[i + 1] === 2) { ansi[tgt] = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4; }
        }
      }
    };
    const styledSpan = (text, isErr) => {
      const node = document.createElement('span');
      if (isErr) node.className = 'dash-term-err';
      if (ansi.fg) node.style.color = ansi.fg;
      if (ansi.bg) node.style.background = ansi.bg;
      if (ansi.bold) node.style.fontWeight = '700';
      if (ansi.dim) node.style.opacity = '0.7';
      if (ansi.underline) node.style.textDecoration = 'underline';
      node.textContent = text;
      return node;
    };

    const appendOut = (chunk, isErr) => {
      const data = ansi.tail + chunk;
      ansi.tail = '';
      let i = 0, plain = '';
      const flushPlain = () => { if (plain) { pre.appendChild(styledSpan(plain, isErr)); plain = ''; } };
      while (i < data.length) {
        const esc = data.indexOf('\x1b', i);
        if (esc === -1) { plain += data.slice(i); break; }
        plain += data.slice(i, esc);
        const seq = parseEscape(data, esc);
        if (seq === null) { ansi.tail = data.slice(esc); break; } // troncata: rimanda
        if (seq.sgr !== null) { flushPlain(); applySgr(seq.sgr); }
        i = seq.end;
      }
      flushPlain();
      const atBottom = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 40;
      if (atBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };

    let finished = false;
    const finish = (label) => {
      if (finished) return;
      finished = true;
      // Se il focus era sui controlli che sto per rimuovere (es. campo stdin),
      // riportalo nella barra principale invece di perderlo nel vuoto.
      const focusWasInControls = controls.contains(document.activeElement);
      controls.remove();
      if (focusWasInControls) inputEl.focus();
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
        if (cwd) setCwd(cwd);
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
    // Il cursore resta nella barra principale così l'utente può digitare subito
    // il comando successivo senza ricliccare. Il campo "Invio testo al comando…"
    // qui sopra resta cliccabile per i comandi interattivi che chiedono stdin.
    inputEl.focus();
  }

  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text && pendingImages.length === 0) return;
    // "/dominio.tld": non navigare verso un sito inesistente (porterebbe a una
    // pagina bianca). Verifica il DNS (await se non già in cache) e, se il
    // dominio non esiste, non fare nulla: l'input resta rosso a segnalarlo.
    if (text.startsWith('/') && isSiteToken(text)) {
      const host = siteHostOf(text);
      const resolves = host ? await ensureSiteResolved(host) : true;
      if (resolves === false) { updateInputClass(); return; }
    }
    if (handleSlashCommand(text)) return;
    submitMessage(text);
  });

  // Invio = manda il messaggio; Shift+Invio = a capo. Il campo è una textarea
  // (non più un <input>), quindi Invio di suo andrebbe a capo: lo intercettiamo.
  // `isComposing` evita di mandare a metà di una composizione IME.
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event('submit'));
    }
  });

  // La textarea parte a una riga e cresce mentre si va a capo (fino al max-height
  // del CSS, poi scrolla). Va richiamata anche quando svuotiamo il campo da codice.
  function autoGrowInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  // Evidenziazione live mentre si scrive: arancione = comando Filo (o sito),
  // azzurro = comando shell (solo in modalità terminale).
  inputEl.addEventListener('input', () => { updateInputClass(); autoGrowInput(); });

  // ===== Bridge cambio stato live dal background =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.FILO_DASHBOARD_UPDATED) {
      // #155 — il ricalcolo in background della home è pronto: aggiorna
      // messaggio + suggerimenti senza rifare la chiamata all'LLM.
      if (showHomeMessage) {
        homeMessageEl.classList.remove('dash-home-msg-loading');
        homeMessageEl.textContent = msg.message || 'Filo è in ascolto.';
      }
      suggestions = Array.isArray(msg.suggestions) ? msg.suggestions : [];
      renderSuggestions();
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
      // Aggiorna suoneria in live se l'utente la cambia dalle opzioni.
      if (msg.settings && msg.settings.timerRingtone && RINGTONES[msg.settings.timerRingtone]) {
        _timerRingTone = msg.settings.timerRingtone;
      }
    } else if (msg?.type === MSG.AUTH_CHANGED) {
      // Login/logout fatto altrove (es. dal menu profilo): aggiorna l'avatar.
      isOwner = !!(msg.signedIn && msg.isAdmin);
      applyAccountProfile(msg.signedIn ? msg.profile : null);
    } else if (msg?.type === MSG.GIFT_NOTICE) {
      // L'owner ci ha regalato dei crediti (#210.4): avviso una volta sola.
      const n = Math.round(Number(msg.amount) || 0);
      if (n > 0 && window.SN_CONFIRM_UI?.notify) {
        window.SN_CONFIRM_UI.notify({
          title: 'Crediti in regalo 🎁',
          text: `Ti sono stati regalati ${n} crediti! Sono già sul tuo saldo.`,
          okLabel: 'Evviva!',
        });
      }
    }
  });


  // ===== Bootstrap =====
  // ===== Controlli del browser dentro la home (in alto a destra) =====
  // Le icone home/impostazioni/app/profilo (un tempo nella barra in alto, ora
  // rimossa) vivono qui. Ogni click aziona il comando REALE della shell via
  // MSG.SHELL_ACTION: il main lo inoltra alla shell, che clicca il bottone
  // corrispondente e apre il suo menu nativo (Impostazioni, App, Account) in
  // alto a destra, oppure naviga (Home). Nessuna logica di menu duplicata qui.
  let accountCtrlBtn = null; // riferimento all'icona profilo (mostra l'avatar)

  function renderControls() {
    const host = $('dashControls');
    if (!host) return;
    const ICONS = self.SN_ICONS || {};
    const items = [
      // Red-team: apre direttamente la pagina interna (è solo una navigazione,
      // non un menu nativo). Tenuto per primo (più a sinistra) e in rosso (vedi
      // dashboard.css) perché è il canale sicurezza, distinto dai controlli del
      // browser. Spec §2: punto d'accesso in alto a destra nella home.
      { command: 'redteam', icon: 'redteam', label: 'Red-team', url: 'filo://redteam/redteam.html' },
      { command: 'home', icon: 'home', label: 'Home' },
      // Cronologia: la pagina principale è quella delle schede visitate/chiuse
      // (raggruppate per giorno), non il log delle azioni AI (raggiungibile da lì
      // come "Cronologia AI"). Apre direttamente la pagina interna (non passa
      // dalla shell come gli altri, che ancorano un menu nativo) — è solo una
      // navigazione. Risponde al feedback "metti la cronologia in alto a destra".
      { command: 'history', icon: 'history', label: 'Cronologia', url: 'filo://archive/archive.html' },
      // Gli appunti non hanno più un pannello separato: Filo li scrive nei file
      // dell'editor (icona Editor, che ora usa proprio l'SVG degli appunti).
      { command: 'settings', icon: 'options', label: 'Impostazioni' },
      { command: 'apps', icon: 'apps', label: 'App' },
      { command: 'account', icon: 'user', label: 'Profilo' },
    ];
    host.replaceChildren();
    accountCtrlBtn = null;
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dash-ctrl';
      btn.dataset.command = it.command;
      btn.setAttribute('aria-label', it.label);
      btn.title = it.label;
      const svg = typeof ICONS[it.icon] === 'function' ? ICONS[it.icon](18) : '';
      btn.innerHTML = svg || it.label.charAt(0);
      btn.addEventListener('click', () => {
        if (typeof it.action === 'function') it.action();
        else if (it.url) send({ type: MSG.OPEN_URL, url: it.url });
        else send({ type: MSG.SHELL_ACTION, command: it.command });
      });
      host.appendChild(btn);
      if (it.command === 'account') accountCtrlBtn = btn;
    }
    refreshAccountControl();
  }

  // L'icona profilo mostra la foto Google quando sei loggato (come faceva la
  // vecchia barra in alto), con fallback all'icona utente se la foto non carica
  // o se sei sloggato. Lo stato auth vive nel main: lo interroghiamo e ci
  // iscriviamo a `auth_changed` per aggiornarla dal vivo a login/logout.
  function applyAccountProfile(profile) {
    if (!accountCtrlBtn) return;
    const ICONS = self.SN_ICONS || {};
    const userIcon = typeof ICONS.user === 'function' ? ICONS.user(18) : '';
    if (profile && profile.picture) {
      const name = profile.name || (profile.email || '').split('@')[0] || 'Account';
      const img = document.createElement('img');
      img.className = 'account-avatar';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      // Se la foto Google non carica (CSP/rete) ripieghiamo sull'icona utente.
      img.onerror = () => { accountCtrlBtn.innerHTML = userIcon; };
      img.src = profile.picture;
      accountCtrlBtn.replaceChildren(img);
      accountCtrlBtn.classList.add('signed-in');
      accountCtrlBtn.title = profile.email ? `${name} — ${profile.email}` : name;
      accountCtrlBtn.setAttribute('aria-label', `Account: ${name}`);
    } else {
      accountCtrlBtn.innerHTML = userIcon;
      accountCtrlBtn.classList.remove('signed-in');
      accountCtrlBtn.title = profile ? 'Profilo' : 'Accedi';
      accountCtrlBtn.setAttribute('aria-label', profile ? 'Profilo' : 'Accedi');
    }
  }

  async function refreshAccountControl() {
    try {
      const r = await send({ type: MSG.AUTH_STATUS });
      isOwner = !!(r && r.signedIn && r.isAdmin);
      applyAccountProfile(r && r.signedIn ? r.profile : null);
    } catch (_) {
      isOwner = false;
      applyAccountProfile(null);
    }
  }

  // ===== Recap aggiornamento (C4) =====
  // Popup all'avvio dopo un update: il main (che ha sia app.getVersion() sia le
  // note curate in src/shared/patchNotes.js) calcola quali versioni l'utente ha
  // saltato dall'ultima volta. Se ce ne sono, mostriamo un recap con le novità
  // in alto, le correzioni in basso e un pulsante per condividerlo/copiarlo.
  // Ritorna true se ha mostrato il popup (e chiamerà onClose alla chiusura),
  // false altrimenti — così l'avvio può incatenare il ringraziamento feedback
  // (C5) DOPO il recap, senza sovrapporre due popup.
  async function maybeShowUpdateRecap(onClose) {
    let recap;
    try { recap = await send({ type: MSG.GET_UPDATE_RECAP }); } catch (_) { return false; }
    if (!recap || !recap.ok) return false;
    // Nessuna versione vista prima (il main l'ha appena marcata: primo avvio) o
    // nessuna nota da mostrare → niente popup.
    if (!recap.lastSeen || !Array.isArray(recap.notes) || !recap.notes.length) return false;
    renderUpdateRecap(recap, onClose);
    return true;
  }

  // Testo del recap per la condivisione/copia.
  function buildRecapText({ lastSeen, current, features, fixes }) {
    const lines = [`Filo ${lastSeen} → ${current}`];
    if (features.length) { lines.push('', 'Novità:'); for (const f of features) lines.push(`• ${f}`); }
    if (fixes.length) { lines.push('', 'Correzioni:'); for (const f of fixes) lines.push(`• ${f}`); }
    return lines.join('\n');
  }

  function flashCopied(btn) {
    const span = btn.querySelector('span');
    if (!span) return;
    const prev = span.dataset.label || span.textContent;
    span.dataset.label = prev;
    span.textContent = 'Copiato!';
    btn.classList.add('is-copied');
    setTimeout(() => { span.textContent = prev; btn.classList.remove('is-copied'); }, 1600);
  }

  async function shareRecap(btn, data) {
    const text = buildRecapText(data);
    // Su desktop navigator.share di solito non esiste: ripieghiamo sulla copia.
    try {
      if (navigator.share) { await navigator.share({ title: 'Novità di Filo', text }); return; }
    } catch (_) { /* l'utente ha annullato la share nativa: copia comunque */ }
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(btn);
      return;
    } catch (_) { /* fallback estremo sotto */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      flashCopied(btn);
    } catch (_) {}
  }

  function renderUpdateRecap({ lastSeen, current, notes }, onClose) {
    // Aggrega le voci di tutte le versioni saltate (notes è già ordinato dalla
    // più recente): tutte le novità in un blocco, tutte le correzioni nell'altro.
    const features = [];
    const fixes = [];
    for (const n of notes) {
      for (const f of (n.features || [])) features.push(f);
      for (const f of (n.fixes || [])) fixes.push(f);
    }

    const overlay = document.createElement('div');
    overlay.className = 'dash-recap-overlay';
    overlay.id = 'recapOverlay';
    const box = document.createElement('div');
    box.className = 'dash-recap-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Novità di Filo');
    overlay.appendChild(box);

    let settled = false;
    function close() {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      // Salva la versione corrente come "vista": il recap non riapparirà fino al
      // prossimo update.
      send({ type: MSG.MARK_UPDATE_SEEN });
      if (typeof onClose === 'function') { try { onClose(); } catch (_) {} }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    // Header: "vecchia → nuova".
    const header = document.createElement('div');
    header.className = 'dash-recap-header';
    const title = document.createElement('div');
    title.className = 'dash-recap-title';
    title.textContent = 'Filo si è aggiornato';
    const ver = document.createElement('div');
    ver.className = 'dash-recap-ver';
    ver.id = 'recapVer';
    const oldV = document.createElement('span'); oldV.className = 'dash-recap-old'; oldV.textContent = lastSeen;
    const arrow = document.createElement('span'); arrow.className = 'dash-recap-arrow'; arrow.textContent = '→';
    const newV = document.createElement('span'); newV.className = 'dash-recap-new'; newV.textContent = current;
    ver.append(oldV, arrow, newV);
    header.append(title, ver);
    box.appendChild(header);

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'dash-recap-x';
    xBtn.setAttribute('aria-label', 'Chiudi');
    xBtn.innerHTML = self.SN_ICONS?.close?.(16) || '✕';
    xBtn.addEventListener('click', close);
    box.appendChild(xBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'dash-recap-body';
    box.appendChild(bodyEl);

    function section(label, items, kind) {
      if (!items.length) return;
      const sec = document.createElement('div');
      sec.className = `dash-recap-section dash-recap-${kind}`;
      sec.dataset.kind = kind;
      const h = document.createElement('div');
      h.className = 'dash-recap-section-title';
      h.textContent = label;
      sec.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'dash-recap-list';
      for (const it of items) {
        const li = document.createElement('li');
        li.textContent = it;
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      bodyEl.appendChild(sec);
    }
    // Novità in alto, correzioni in basso (come da spec).
    section('Novità', features, 'features');
    section('Correzioni', fixes, 'fixes');

    const footer = document.createElement('div');
    footer.className = 'dash-recap-footer';
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'dash-recap-btn dash-recap-share';
    shareBtn.id = 'recapShare';
    const shareIcon = self.SN_ICONS?.share?.(15) || '';
    shareBtn.innerHTML = `${shareIcon}<span>Condividi</span>`;
    shareBtn.addEventListener('click', () => shareRecap(shareBtn, { lastSeen, current, features, fixes }));
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'dash-recap-btn dash-recap-done';
    doneBtn.textContent = 'Fatto';
    doneBtn.addEventListener('click', close);
    footer.append(shareBtn, doneBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);
    doneBtn.focus();
  }

  // ===== Ringraziamento feedback risolto (C5) =====
  // All'avvio chiediamo al main se qualche feedback INVIATO DA QUESTO UTENTE è
  // passato a "risolto" da quando non guardava. Per ognuno il main ha già
  // accreditato la ricompensa per priorità (50/100/200/300, una volta sola) e
  // ci ritorna il testo da mostrare. Qui ringraziamo, spieghiamo cosa è cambiato
  // (testo non tecnico preso dalle note) e animiamo i crediti verso il profilo.
  async function maybeShowFeedbackRewards() {
    let res;
    try { res = await send({ type: MSG.GET_FEEDBACK_REWARDS }); } catch (_) { return; }
    if (!res || !res.ok || !Array.isArray(res.rewards) || !res.rewards.length) return;
    renderFeedbackRewards(res.rewards, res.totalCredits || 0);
  }

  // Anima alcune "monete credito" dorate dal centro dello schermo verso l'icona
  // profilo (accountCtrlBtn). Riusa lo spirito di C3 ma vive nella home, dove
  // l'icona account è un elemento DOM reale: puntiamo al suo centro. Decorativa,
  // best-effort, rispetta prefers-reduced-motion.
  function flyCreditsToAccount(amount) {
    try {
      const reduce = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (reduce) return;
      const n = Math.max(1, Math.round(Number(amount) || 0));
      const target = (accountCtrlBtn && accountCtrlBtn.getBoundingClientRect()) || null;
      const tx = target ? target.left + target.width / 2 : Math.max(24, window.innerWidth - 26);
      const ty = target ? target.top + target.height / 2 : 26;
      const ox = window.innerWidth / 2;
      const oy = window.innerHeight / 2;
      const GOLD = '#e0a93f';

      const layer = document.createElement('div');
      layer.className = 'dash-credit-fly';
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        pointerEvents: 'none', overflow: 'hidden',
      });
      document.body.appendChild(layer);

      const coinSvg = (self.SN_ICONS?.credits?.(22)) || '●';
      const count = Math.min(9, Math.max(5, Math.round(n / 40) + 4));
      let maxEnd = 1000;
      for (let i = 0; i < count; i++) {
        const c = document.createElement('div');
        c.innerHTML = coinSvg;
        Object.assign(c.style, {
          position: 'fixed', left: '0', top: '0', width: '22px', height: '22px',
          color: GOLD, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
          willChange: 'transform, opacity',
        });
        layer.appendChild(c);
        const sx = ox + (Math.random() - 0.5) * 120;
        const sy = oy + (Math.random() - 0.5) * 80;
        const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 80;
        const my = Math.min(sy, ty) - 50 - Math.random() * 50;
        const delay = i * 45;
        const dur = 700 + i * 50 + Math.random() * 140;
        maxEnd = Math.max(maxEnd, delay + dur);
        try {
          c.animate([
            { transform: `translate(${sx}px,${sy}px) scale(.6)`, opacity: 0 },
            { transform: `translate(${mx}px,${my}px) scale(1.05)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${tx}px,${ty}px) scale(.45)`, opacity: 0 },
          ], { duration: dur, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
        } catch (_) {}
      }
      setTimeout(() => { try { layer.remove(); } catch (_) {} }, maxEnd + 200);
    } catch (_) {}
  }

  function renderFeedbackRewards(rewards, totalCredits) {
    const overlay = document.createElement('div');
    overlay.className = 'dash-recap-overlay dash-thanks-overlay';
    overlay.id = 'thanksOverlay';
    const box = document.createElement('div');
    box.className = 'dash-recap-box dash-thanks-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Feedback risolto');
    overlay.appendChild(box);

    let settled = false;
    function close() {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    // Header: ringraziamento + totale crediti guadagnati.
    const header = document.createElement('div');
    header.className = 'dash-recap-header dash-thanks-header';
    const title = document.createElement('div');
    title.className = 'dash-recap-title';
    title.textContent = rewards.length > 1
      ? 'Grazie! I tuoi feedback sono stati risolti'
      : 'Grazie! Il tuo feedback è stato risolto';
    header.appendChild(title);
    if (totalCredits > 0) {
      const badge = document.createElement('div');
      badge.className = 'dash-thanks-total';
      const coin = self.SN_ICONS?.credits?.(18) || '';
      badge.innerHTML = `${coin}<span>+${totalCredits} crediti</span>`;
      header.appendChild(badge);
    }
    box.appendChild(header);

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'dash-recap-x';
    xBtn.setAttribute('aria-label', 'Chiudi');
    xBtn.innerHTML = self.SN_ICONS?.close?.(16) || '✕';
    xBtn.addEventListener('click', close);
    box.appendChild(xBtn);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'dash-recap-body dash-thanks-body';
    box.appendChild(bodyEl);

    for (const r of rewards) {
      const item = document.createElement('div');
      item.className = 'dash-thanks-item';

      const head = document.createElement('div');
      head.className = 'dash-thanks-item-head';
      const name = document.createElement('div');
      name.className = 'dash-thanks-item-title';
      const numTxt = r.num ? `#${r.num} ` : '';
      name.textContent = `${numTxt}${r.name || 'Feedback risolto'}`;
      head.appendChild(name);
      if (Number(r.credits) > 0) {
        const cr = document.createElement('div');
        cr.className = 'dash-thanks-item-credits';
        const coin = self.SN_ICONS?.credits?.(14) || '';
        cr.innerHTML = `${coin}<span>+${r.credits}</span>`;
        head.appendChild(cr);
      }
      item.appendChild(head);

      const expl = document.createElement('div');
      expl.className = 'dash-thanks-item-body';
      expl.textContent = (r.explanation && String(r.explanation).trim())
        || 'È stato sistemato: provalo e dicci com’è andata.';
      item.appendChild(expl);

      bodyEl.appendChild(item);
    }

    const footer = document.createElement('div');
    footer.className = 'dash-recap-footer';
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'dash-recap-btn dash-recap-done';
    doneBtn.textContent = 'Fantastico!';
    doneBtn.addEventListener('click', close);
    footer.append(doneBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);
    doneBtn.focus();
    // Anima i crediti verso il profilo dopo un attimo (il box è già su schermo).
    setTimeout(() => flyCreditsToAccount(totalCredits), 250);
  }

  (async function init() {
    renderControls();
    await applySavedTheme();
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      showHomeMessage = settings?.showHomeMessage !== false;
      terminalMode = !!settings?.terminal?.enabled;
      terminalShell = settings?.terminal?.shell || 'powershell';
      // Suoneria timer: legge la preferenza; se non impostata o non valida usa 'default'.
      const saved = settings?.timerRingtone;
      if (saved && RINGTONES[saved]) _timerRingTone = saved;
    } catch (_) {}
    applyHomeMessageVisibility();
    if (terminalMode) await initCwd();
    applyTerminalMode();
    // Primissima apertura? In tal caso il benvenuto di Filo prende il posto del
    // commento generato (che senza storico sarebbe comunque generico).
    const firstRun = await isFirstRun();
    if (firstRun) {
      try { await self.SN_STORAGE?.setRaw?.(STORAGE_KEYS.FILO_WELCOMED, true); } catch (_) {}
    }
    // Carico in parallelo dashboard cache e live state per non sequenziare.
    await Promise.all([
      firstRun ? Promise.resolve() : loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
    ]);
    if (firstRun) showWelcomeMessage();
    // Popup all'avvio, in sequenza per non sovrapporsi: prima il recap
    // aggiornamento (solo se c'è una versione precedente vista e note nuove),
    // POI il ringraziamento per i feedback risolti (C5). Se il recap non compare,
    // il ringraziamento parte subito.
    (async () => {
      try {
        const shown = await maybeShowUpdateRecap(() => maybeShowFeedbackRewards());
        if (!shown) await maybeShowFeedbackRewards();
      } catch (_) {}
    })();
  })();

  // Hook per i test Playwright (stesso pattern di __filoEditorFormat
  // nell'editor): permette di renderizzare azioni come farebbe una bolla di
  // chat senza dover pilotare l'LLM.
  window.__filoDashActions = { renderActions, applyCommandCwd, getCwd: () => currentCwd };
})();
