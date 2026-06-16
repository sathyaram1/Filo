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

  function onSuggestionClick(s) {
    const a = s.action;
    if (!a) return;
    const type = String(a.type || '').toUpperCase();
    if (type === 'PULISCI_TAB') {
      // §6 — suggerimento di pulizia dalla home: stessa conferma del bottone chat.
      if (!window.confirm('Filo valuterà le schede aperte e archivierà quelle non più utili (restano in “Tab archiviate”). Procedo?')) return;
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
      } else {
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

  // Card speciale per un timer che sta suonando: bordo animato + pulsante "Ferma".
  function renderRingingCard(t) {
    const div = document.createElement('div');
    div.className = 'dash-live-card';
    div.dataset.kind = 'process';
    div.dataset.ringing = '1';

    const textEl = document.createElement('div');
    textEl.className = 'dash-live-text';
    textEl.textContent = `⏰ ${t.label} — scaduto`;
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
    // #162 — testo vuoto (Filo ha solo eseguito un'azione, es. aperto un link):
    // niente nodo di testo, la bolla conterrà solo i chip d'azione. Marchiamo
    // la bolla così il CSS può stringere i margini quando è "solo azioni".
    if (text) div.textContent = text;
    else div.classList.add('dash-bubble-actions-only');
    return div;
  }

  // Indicatore "sta pensando": 3 righe di reasoning che scorrono verso l'alto e
  // svaniscono man mano che salgono (la riga in cima è quasi trasparente, quella
  // in basso è piena). Restano sempre al massimo 3 righe visibili. Le frasi non
  // sono il reasoning vero (il provider non lo restituisce in streaming), ma una
  // prova di funzionamento — abbastanza varie da non sembrare uno spinner statico.
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
    const tick = () => {
      if (stopped || !wrap.isConnected) return;
      // Shift verso l'alto: top esce, mid → top, bottom → mid, nuovo → bottom
      lines[0].textContent = lines[1].textContent;
      lines[1].textContent = lines[2].textContent;
      lines[2].textContent = nextPhrase();
      // Re-trigger animazione di entrata della riga nuova
      lines[2].classList.remove('dash-thinking-enter');
      void lines[2].offsetWidth;
      lines[2].classList.add('dash-thinking-enter');
    };
    const interval = setInterval(tick, 900);
    lines[2].classList.add('dash-thinking-enter');

    return {
      el: wrap,
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
    // #159 — modifiche alle impostazioni: il popup di conferma si apre da SOLO,
    // invece di richiedere all'utente di cliccare prima il bottone. L'utente ha
    // chiesto che Filo "tenti di farlo in automatico, con un popup di conferma
    // aperto". Lo facciamo SOLO per le impostazioni (preferenza/estetica) a
    // livello 2 e SOLO se è l'unica azione della bolla: niente stacking di
    // modali, e le azioni distruttive (livello 3) o esterne (feedback) restano
    // a click esplicito.
    if (autoConfirm && actions.length === 1) {
      const auto = wrap.querySelector('[data-auto-confirm="1"]');
      if (auto) setTimeout(() => { try { auto.click(); } catch (_) {} }, 0);
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
      btn.textContent = isCmd ? `▶ ${short}` : (a._confirm.text || 'Esegui');
      // #159 — le modifiche alle impostazioni (preferenza/estetica) a livello 2
      // aprono il popup di conferma da sole: marchiamo il bottone perché
      // renderActions lo possa cliccare automaticamente. Le azioni esterne
      // (feedback) o distruttive (livello 3) NON sono marcate: restano a click.
      if ((type === 'IMPOSTA_PREFERENZA' || type === 'IMPOSTA_ESTETICA') && a._confirm.level === 2) {
        btn.dataset.autoConfirm = '1';
      }
      btn.addEventListener('click', async () => {
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
        btn.textContent = (r && r.executed) ? `✓ ${a._confirm.text}` : '✗ Non eseguita';
        // #146.4 — modifica estetica illeggibile (livello 2): confermata ed
        // applicata, offriamo subito il box per correggere il valore.
        if (r && r.executed && type === 'IMPOSTA_ESTETICA') {
          const refiner = buildAestheticRefiner(a);
          if (refiner) btn.after(refiner);
        }
      });
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
      const btn = document.createElement('a');
      btn.href = a.url || '#';
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.className = 'dash-action-btn dash-action-link-chip';
      btn.title = `Riapri ${label}`;
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
      btn.appendChild(document.createTextNode(`↗ ${label}`));
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

    // Bolla Filo "sta pensando": 3 righe di reasoning che scorrono e svaniscono.
    const pending = appendThinking();

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
      // #159 — risposta fresca: le impostazioni a livello 2 aprono il loro popup
      // di conferma da sole (autoConfirm). Solo qui (nuova risposta), mai in
      // replay storico.
      renderActions(filoBubble, r.actions || [], { onAck: goHome, autoConfirm: true });
      threadHistory.push({ role: 'filo', text: r.text || '', actions: r.actions || [] });
      applyCommandCwd(r.actions);
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
    '/set': (text) => { handleSetCommand(text); },
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
        '/set timer 5:00 — avvia un timer (anche /set timer 8 = 8 minuti)',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      const bubble = makeBubble({ role: 'filo', text: lines.join('\n') });
      bubblesEl.appendChild(bubble);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    },
  };

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

  // Converte l'argomento di "/set timer" in secondi.
  //   "5:00" → 5 minuti 0 secondi → 300 ; "8" → 8 minuti → 480.
  // Ritorna null se non è una durata valida.
  function parseTimerArg(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2) return null;
      const mm = Number(parts[0]);
      const ss = Number(parts[1]);
      if (!Number.isInteger(mm) || !Number.isInteger(ss)) return null;
      if (mm < 0 || ss < 0 || ss > 59) return null;
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
    if (isSiteToken(text)) {
      const raw = text.slice(1);
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
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
    if (cwd && cwd !== currentCwd) { currentCwd = cwd; updateDirLine(); applyTerminalMode(); }
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
      applyAccountProfile(msg.signedIn ? msg.profile : null);
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
      { command: 'home', icon: 'home', label: 'Home' },
      // Cronologia AI: apre direttamente la pagina interna (non passa dalla
      // shell come gli altri, che ancorano un menu nativo) — è solo una
      // navigazione. Risponde al feedback "metti la cronologia in alto a destra".
      { command: 'history', icon: 'history', label: 'Cronologia', url: 'filo://history/history.html' },
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
        if (it.url) send({ type: MSG.OPEN_URL, url: it.url });
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
      applyAccountProfile(r && r.signedIn ? r.profile : null);
    } catch (_) {
      applyAccountProfile(null);
    }
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
  })();

  // Hook per i test Playwright (stesso pattern di __filoEditorFormat
  // nell'editor): permette di renderizzare azioni come farebbe una bolla di
  // chat senza dover pilotare l'LLM.
  window.__filoDashActions = { renderActions, applyCommandCwd, getCwd: () => currentCwd };
})();
