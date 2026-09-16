// Dashboard Filo (new tab). Controller UI: stato «home» (messaggio proattivo + suggerimenti) o
// «thread» (conversazione). Ogni query dalla home apre un nuovo thread (spec §2.1); niente
// persistenza cross-tab.

(function () {
  'use strict';

  const { MSG } = self.SN_MSG;
  const { STORAGE_KEYS } = self.SN_CONST;

  // #524 — il benvenuto è l'inizio di una conversazione vera: testi e stato della ripresa
  // stanno in src/shared/onboarding.js, qui solo la chat.
  const Onb = self.SN_ONBOARDING;

  // DOM
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

  // Stato locale
  let suggestions = [];
  let showHomeMessage = true; // commento centrale (disattivabile da Preferenze)
  let expanded = false;
  let threadHistory = []; // [{role: 'user'|'filo', text, actions?}]
  let sending = false;
  let liveTickHandle = null;
  let pendingImages = []; // dataUrl delle immagini incollate (multiple)

  // Modalità terminale
  let terminalMode = false;          // attivabile da Preferenze
  let terminalShell = 'powershell';  // 'powershell' | 'cmd' | 'bash'
  let currentCwd = '';               // directory mostrata nella riga grigia

  // Suoneria timer: AudioContext + oscillatori, niente file audio per non committare binari.
  // Parte al primo timer `ringing`, si ferma quando non ce ne sono più.
  let _alarmCtx = null;
  let _alarmPlaying = false;
  let _alarmLoopTimeout = null;
  let _timerRingTone = 'default'; // suoneria attiva (ID stringa)

  // Ogni voce è [ [freq, durMs], … ] più un gap prima del loop successivo.
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

  // Suona UNA sequenza (non in loop); la Promise si risolve a sequenza finita. Serve al loop e
  // all'anteprima nelle opzioni.
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
        setTimeout(resolve, Math.max(0, (t - ctx.currentTime) * 1000));
      });
    });
  }

  // Avvia la suoneria in loop. Idempotente.
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

  // Helpers messaggi
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

  // Stato UI
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

  // Micro-intervista di benvenuto (#524). Lo stato lo tiene il main: all'apertura si chiede se è
  // aperta e si ricompone la conversazione. Il segno «già accolto» lo scrive la CHIUSURA.
  let onboardingActive = false;

  async function fetchOnboarding() {
    try {
      const r = await send({ type: MSG.FILO_GET_ONBOARDING });
      // `ready: false` = nessun modello disponibile: l'intervista aspetta e la home spiega come
      // attivare Filo, invece di una chat che non può rispondere.
      if (!r?.ok || !r.onboarding || !r.ready) return null;
      if (r.onboarding.done) return null;
      // `resume` lo decide il main: di schede nuove se ne aprono due insieme, e il turno rimasto a
      // metà lo deve riprendere UNA sola.
      return { ...r.onboarding, resume: !!r.resume };
    } catch (_) { return null; }
  }

  // La conversazione salvata torna come bolle normali: per l'utente è una chat, non una
  // procedura.
  function renderOnboardingThread(state) {
    const thread = Array.isArray(state?.thread) ? state.thread : [];
    bubblesEl.innerHTML = '';
    threadHistory = [];
    if (thread.length > 1 && Onb?.RESUME_NOTE) bubblesEl.appendChild(stepTrace(Onb.RESUME_NOTE));
    for (const m of thread) {
      const role = m.role === 'filo' ? 'filo' : 'user';
      threadHistory.push({ role, text: m.text });
      bubblesEl.appendChild(makeBubble({ role, text: m.text, markdown: role === 'filo' }));
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // Se l'ultimo messaggio è dell'utente (ha risposto e chiuso prima della risposta), il turno
  // riparte da solo.
  async function openOnboarding(state) {
    onboardingActive = true;
    hideOnboardingNotice(); // l'intervista è di nuovo qui: la riga non serve più
    goThread();
    renderOnboardingThread(state);
    showSkipOnboarding();
    inputEl.focus();
    const last = (state.thread || [])[(state.thread || []).length - 1];
    if (state.resume && last && last.role === 'user' && !sending) {
      sending = true;
      sendBtn.disabled = true;
      await runTurnAndContinue({ userMessage: last.text });
    }
  }

  // Un'altra scheda ha fatto avanzare l'intervista: questa si riallinea. Mai mentre scriviamo
  // noi — le bolle in corso sono già la verità.
  function onboardingUpdated(state) {
    if (!state || state.done) return;
    // L'intervista non è a schermo ma altrove è di nuovo aperta: se questa home diceva «abbiamo
    // chiuso a metà», adesso mente.
    if (!onboardingActive) { hideOnboardingNotice(); return; }
    if (sending) return;
    renderOnboardingThread(state);
  }

  // La via d'uscita che non passa dal modello: il benvenuto promette «scrivi basta così» e la
  // parola la riconosce il main da sé; questo pulsante è il suo gemello visibile. Senza, chi apre
  // Filo la prima volta senza rete resta chiuso dentro l'accoglienza col solo «Riprova».
  function makeSkipOnboardingBtn(label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dash-skip-onboarding';
    b.textContent = label || 'Salta l’accoglienza';
    b.title = 'Chiudi l’intervista e vai alla home. Puoi rifarla da Preferenze.';
    b.addEventListener('click', skipOnboarding);
    return b;
  }

  function showSkipOnboarding() {
    if (!onboardingActive || $('skipOnboardingRow')) return;
    const row = document.createElement('div');
    row.className = 'dash-skip-row';
    row.id = 'skipOnboardingRow';
    const btn = makeSkipOnboardingBtn();
    btn.id = 'skipOnboarding';
    row.appendChild(btn);
    threadView.appendChild(row);
  }

  function hideSkipOnboarding() {
    const row = $('skipOnboardingRow');
    if (row) row.remove();
  }

  let skipping = false;
  let onboardingHomeFallback = null;
  async function skipOnboarding() {
    if (skipping) return;
    skipping = true;
    hideSkipOnboarding();
    try {
      const r = await send({ type: MSG.FILO_CLOSE_ONBOARDING });
      // Il congedo è un testo fisso: arriva anche col modello irraggiungibile.
      if (r?.closing) {
        bubblesEl.appendChild(makeBubble({ role: 'filo', text: r.closing, markdown: true }));
      }
      onboardingClosing();
    } catch (_) {
      onboardingDone(null);
    } finally {
      skipping = false;
    }
  }

  // L'intervista aspettava un modello e adesso c'è: la si apre solo se l'utente è ancora sulla
  // home — irrompere in una conversazione sarebbe peggio che aspettare.
  async function maybeOpenOnboardingLater() {
    if (onboardingActive || sending) return;
    if (body.dataset.state !== 'home') return;
    const state = await fetchOnboarding();
    if (!state || onboardingActive || sending || body.dataset.state !== 'home') return;
    await openOnboarding(state);
  }

  // L'ultimo atto non è un «fatto», è il risultato: la prima home costruita sul profilo appena
  // imparato. Finché non arriva, la chat dice cosa succede invece di restare muta.
  function onboardingClosing() {
    if (!onboardingActive) return;
    onboardingActive = false;
    closingShownAt = Date.now();
    hideSkipOnboarding();
    bubblesEl.appendChild(stepTrace('Preparo la tua home…'));
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    // La home personale è l'ultimo atto dell'accoglienza ma non la sua condizione: se non arriva
    // l'utente ci va lo stesso.
    clearTimeout(onboardingHomeFallback);
    onboardingHomeFallback = setTimeout(() => {
      if (body.dataset.state === 'thread' && !sending) onboardingDone(null);
    }, 8000);
  }

  // Il congedo è l'ultima cosa che l'utente legge, e la home lo cancella: quando arriva nello
  // stesso istante non lo legge nessuno. Gli si lascia il tempo di essere letto; se la home ci
  // mette di più, non si aspetta.
  const CLOSING_DWELL_MS = 2600;
  let closingShownAt = 0;
  let closingDwellTimer = null;

  function onboardingDone(msg) {
    onboardingActive = false;
    clearTimeout(onboardingHomeFallback);
    const atteso = closingShownAt ? Date.now() - closingShownAt : CLOSING_DWELL_MS;
    if (atteso < CLOSING_DWELL_MS) {
      if (closingDwellTimer) return; // il primo che arriva è quello buono
      closingDwellTimer = setTimeout(() => {
        closingDwellTimer = null;
        onboardingDoneNow(msg);
      }, CLOSING_DWELL_MS - atteso);
      return;
    }
    onboardingDoneNow(msg);
  }

  function onboardingDoneNow(msg) {
    onboardingActive = false;
    closingShownAt = 0;
    clearTimeout(onboardingHomeFallback);
    hideSkipOnboarding();
    goHome(); // svuota bolle e storico: l'intervista è finita
    if (showHomeMessage) {
      homeMessageEl.classList.remove('dash-home-msg-loading');
      homeMessageEl.textContent = msg?.message || 'Filo è in ascolto.';
    }
    suggestions = Array.isArray(msg?.suggestions) ? msg.suggestions : [];
    renderSuggestions();
    // La home appena generata È la risposta finale; se non è arrivata la si carica per la strada
    // normale.
    if (!msg?.message) loadDashboard().catch(() => {});
    // Chiusa prima della fine? Il congedo era in chat, e la chat è appena sparita: la riga qui
    // sotto è quello che ne resta.
    refreshOnboardingNotice().catch(() => {});
  }

  // Dopo un'accoglienza chiusa a metà. Il congedo spiega che l'intervista si rifà da Preferenze,
  // ma vive in chat e la chat sparisce appena la home è pronta; e il segno «già accolto» è
  // definitivo. Questa riga resta sulla home finché non la si toglie, e porta la strada per
  // tornarci.
  async function refreshOnboardingNotice() {
    let st = null;
    try {
      const r = await send({ type: MSG.FILO_GET_ONBOARDING, peek: true });
      st = r?.ok ? r.onboarding : null;
    } catch (_) { return; }
    if (st && st.done && st.notice === 'early') showOnboardingNotice();
    else hideOnboardingNotice();
  }

  function hideOnboardingNotice() {
    const box = $('onbNotice');
    if (!box) return;
    box.innerHTML = '';
    box.hidden = true;
  }

  function showOnboardingNotice() {
    const box = $('onbNotice');
    if (!box || !box.hidden) return; // già a schermo: non la ricostruiamo
    box.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'dash-onb-notice-text';
    text.textContent = 'Abbiamo chiuso la presentazione a metà.';
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.id = 'onbNoticeRedo';
    redo.textContent = 'Riprendiamola';
    redo.title = 'Riapre l’intervista di benvenuto qui, da capo. La trovi anche in Preferenze.';
    redo.addEventListener('click', restartOnboardingHere);
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.id = 'onbNoticeDismiss';
    ok.textContent = 'No, va bene così';
    ok.title = 'Toglie questa riga. L’intervista resta rifacibile da Preferenze.';
    ok.addEventListener('click', dismissOnboardingNotice);
    box.appendChild(text);
    box.appendChild(redo);
    box.appendChild(ok);
    box.hidden = false;
  }

  async function dismissOnboardingNotice() {
    hideOnboardingNotice();
    try { await send({ type: MSG.FILO_ONBOARDING_NOTICE_SEEN }); } catch (_) {}
  }

  // Rifarla da qui, senza mandare l'utente a cercare il pulsante in Preferenze.
  async function restartOnboardingHere() {
    hideOnboardingNotice();
    try {
      const r = await send({ type: MSG.FILO_RESTART_ONBOARDING });
      if (r?.ok && r.onboarding) await openOnboarding({ ...r.onboarding, resume: false });
    } catch (_) {}
  }


  // Suggerimenti (colonna sinistra)
  function iconLabel(icon) {
    const map = {
      gmail: 'M', calendar: 'C', editor: 'E', file: 'F',
      link: '↗', note: '✎', web: '🌐',
    };
    return map[icon] || (icon ? icon[0].toUpperCase() : '·');
  }

  // Favicon via il servizio Google s2 — gratis, niente API key, e un'icona grigia per i casi
  // mancanti. '' per URL non http(s).
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
      // Per le azioni NAVIGA la favicon al posto della letterina: più riconoscibile. Se non carica
      // si torna all'iniziale.
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
      // §6 — STESSA conferma del bottone chat: popup Filo (SN_CONFIRM_UI), non window.confirm
      // (PATTERNS.md). Al nativo solo se il modulo non è caricato.
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
      inputEl.value = a.prompt;
      inputForm.dispatchEvent(new Event('submit'));
    } else {
      inputEl.value = s.text || '';
      inputForm.dispatchEvent(new Event('submit'));
    }
  }

  // Colonna destra (live)
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
        // #322 — la sveglia mostra l'ORARIO programmato: un conto alla rovescia di ore sarebbe
        // illeggibile.
        liveEl.appendChild(renderLiveCard({
          kind: 'process',
          text: `⏰ Sveglia ${fmtAlarmWhen(t)}${t.label ? `\n${t.label}` : ''}`,
          onDismiss: () => send({ type: MSG.FILO_DELETE_TIMER, id: t.id }).then(refreshLive),
        }));
      } else {
        // Timer in pausa: `endsAt` non è più affidabile (il «now» avanza mentre il timer è fermo) →
        // si usa il tempo rimanente salvato alla pausa.
        const remaining = (t.paused && Number.isFinite(t.remainingMs))
          ? Math.max(0, Math.round(t.remainingMs / 1000))
          : Math.max(0, Math.round((new Date(t.endsAt).getTime() - Date.now()) / 1000));
        // #323 — countdown da orologio: M:SS sotto l'ora, H:MM:SS oltre, così due ore fanno
        // «2:00:00» e non «120:00».
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

    const hasRinging = timers.some((t) => t.ringing);
    if (hasRinging) {
      startAlarm();
    } else {
      stopAlarm();
    }

    // Stato osservabile per i test (in headless l'audio non suona): data-ringing sul contenitore.
    liveEl.dataset.ringing = hasRinging ? '1' : '0';

    // Ridisegna ogni secondo SOLO se ci sono timer attivi (i ringing inclusi esplicitamente, per
    // non dipendere dalla logica di pausa).
    const hasActiveTimer = timers.some((t) => !t.paused || t.ringing);
    if (hasActiveTimer && !liveTickHandle) {
      liveTickHandle = setInterval(refreshLive, 1000);
    } else if (!hasActiveTimer && liveTickHandle) {
      clearInterval(liveTickHandle);
      liveTickHandle = null;
    }
  }

  // Se la sveglia si RIPETE, il giorno della prossima occorrenza non è l'informazione utile
  // («07:55 di domani» per lunedì e mercoledì dice meno del vero): si mostrano orario e giorni,
  // con la dicitura che legge l'assistente.
  function fmtAlarmWhen(t) {
    const M = self.SN_FILO_MEMORY;
    const rep = (t.repeat && t.repeat.length && M && M.formatRepeat) ? M.formatRepeat(t.repeat) : '';
    if (!rep) return fmtAlarmTime(t.endsAt);
    const d = new Date(t.endsAt);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${hhmm} · ${rep}`;
  }

  // HH:MM, col giorno solo se non è oggi (#322).
  function fmtAlarmTime(iso) {
    const d = new Date(iso);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return hhmm;
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (d.toDateString() === tomorrow.toDateString()) return `${hhmm} di domani`;
    return `${hhmm} del ${d.getDate()}/${d.getMonth() + 1}`;
  }

  function renderRingingCard(t) {
    const div = document.createElement('div');
    div.className = 'dash-live-card';
    div.dataset.kind = 'process';
    div.dataset.ringing = '1';

    const textEl = document.createElement('div');
    textEl.className = 'dash-live-text';
    // Su una sveglia ricorrente «Ferma» la zittisce ora e la lascia per la prossima volta, quindi
    // va detto.
    const M = self.SN_FILO_MEMORY;
    const rep = (t.repeat && t.repeat.length && M && M.formatRepeat) ? M.formatRepeat(t.repeat) : '';
    textEl.textContent = t.kind === 'alarm'
      ? `⏰ Sveglia${t.label ? ` — ${t.label}` : ''}${rep ? ` · ${rep}` : ''}`
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

    // Sulle sveglie RICORRENTI × e «Ferma» non fanno la stessa cosa: «Ferma» zittisce quella di
    // adesso, la × la toglie del tutto, come su ogni altra card. Senza, una sveglia ricorrente non
    // si potrebbe togliere proprio mentre suona.
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'dash-live-dismiss';
    dismissBtn.type = 'button';
    dismissBtn.setAttribute('aria-label', rep ? 'Rimuovi la sveglia' : 'Ferma');
    if (rep) dismissBtn.title = 'Rimuovi la sveglia';
    dismissBtn.textContent = '\xD7';
    dismissBtn.addEventListener('click', () => {
      send({ type: rep ? MSG.FILO_DELETE_TIMER : MSG.FILO_STOP_TIMER_ALARM, id: t.id }).then(refreshLive);
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
    // Pausa/ripresa: solo per i countdown (chi passa onToggle).
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

  // Preferenze → «Commento nella home». I suggerimenti a sinistra restano visibili.
  function applyHomeMessageVisibility() {
    homeMessageEl.hidden = !showHomeMessage;
  }

  // Generazione dashboard (messaggio centro + suggerimenti)
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

  // Bolle conversazione
  function makeBubble({ role, text, pending = false, markdown = false }) {
    const div = document.createElement('div');
    div.className = `dash-bubble dash-bubble-${role === 'user' ? 'user' : 'filo'}`;
    if (pending) div.classList.add('dash-bubble-pending');
    // #162 — testo vuoto (Filo ha solo eseguito un'azione): niente nodo di testo, solo i chip, e
    // la bolla è marcata così il CSS stringe i margini.
    if (text) setBubbleText(div, text, markdown);
    else div.classList.add('dash-bubble-actions-only');
    return div;
  }

  // #418 — per le risposte di Filo rende la formattazione leggera condivisa; per tutto il resto
  // resta testo letterale. I link sono già filtrati da SN_MARKDOWN: nessuno punta alle pagine
  // interne.
  function setBubbleText(el, text, markdown) {
    if (markdown && text && self.SN_MARKDOWN) {
      el.innerHTML = self.SN_MARKDOWN.render(text);
      el.classList.add('dash-bubble-md');
    } else {
      el.textContent = text || '';
    }
  }

  // Un solo listener delegato: i link di Filo aprono una NUOVA SCHEDA invece di navigare via la
  // pagina interna.
  bubblesEl.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a.filo-md-link');
    if (!a || !bubblesEl.contains(a)) return;
    const url = a.getAttribute('href');
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: MSG.OPEN_URL, url });
  });

  // Blocco di attività della domanda (#521). UNO per messaggio dell'utente, sopra la risposta
  // finale: raccoglie tutto ciò che Filo fa prima di rispondere, anche su più turni automatici —
  // Filo non «ragiona e basta», agisce.
  // Chiuso di default, sempre: il 90% delle volte l'utente vuole che il lavoro sia invisibile. La
  // riga in testa dice cosa succede ADESSO e a lavoro finito diventa il riassunto; un click apre
  // la cronologia completa, nell'ordine in cui le cose sono avvenute. Niente frasi inventate.
  // Se alla fine non c'è niente da raccontare, il blocco si toglie da solo.
  function createActivity() {
    const wrap = document.createElement('div');
    wrap.className = 'dash-activity';
    wrap.dataset.phase = 'wait';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dash-activity-head';
    head.setAttribute('aria-expanded', 'false');
    head.title = 'Mostra cosa ha fatto Filo';
    const icon = document.createElement('span');
    icon.className = 'dash-activity-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'dash-activity-label';
    label.textContent = 'Aspetto la risposta…';
    head.append(icon, label);
    const body = document.createElement('div');
    body.className = 'dash-activity-body';
    body.hidden = true;
    wrap.append(head, body);
    bubblesEl.appendChild(wrap);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    const startedAt = Date.now();
    let phase = 'wait';
    let open = false;
    let items = 0;
    // Ragionamento del turno in corso (un blocco per turno nella cronologia).
    let reasoningEl = null;
    let turnReasoning = '';
    // Senza, il riassunto non può chiamarsi «Ragionamento».
    let sawReasoning = false;
    let turnStartedAt = 0;
    let lastTurn = { text: '', ms: 0 };
    // Quante voci c'erano quando è partito il testo del turno (vedi answerStarted).
    let turnMark = null;
    // Tipi delle azioni compiute, nell'ordine: da qui nasce il riassunto.
    const doneTypes = [];

    const followBody = () => {
      const near = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
      if (near) body.scrollTop = body.scrollHeight;
    };
    const followThread = () => {
      const near = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 48;
      if (near) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };
    const setOpen = (v) => {
      open = !!v;
      body.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.title = open ? 'Nascondi' : 'Mostra cosa ha fatto Filo';
      // Aperto a lavoro finito si legge dall'inizio; aperto mentre lavora si guarda l'ultima cosa.
      if (open) body.scrollTop = phase === 'done' ? 0 : body.scrollHeight;
      followThread();
    };
    head.addEventListener('click', () => setOpen(!open));
    const setPhase = (p, text) => {
      phase = p;
      wrap.dataset.phase = p;
      label.textContent = text;
    };
    const lastSentence = (t) => {
      const parts = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
      return parts[parts.length - 1] || '';
    };
    const append = (el) => {
      body.appendChild(el);
      items += 1;
      followBody();
      followThread();
    };
    // Chiude il blocco di ragionamento del turno e lo mette da parte per lo storico.
    const closeTurnReasoning = () => {
      if (!turnReasoning) return;
      lastTurn = { text: turnReasoning, ms: Date.now() - turnStartedAt };
      turnReasoning = '';
      reasoningEl = null;
    };

    return {
      el: wrap,
      // Un pezzo di ragionamento vero dal modello.
      pushReasoning(text) {
        if (phase === 'done' || !text) return;
        sawReasoning = true;
        if (!reasoningEl) {
          reasoningEl = document.createElement('div');
          reasoningEl.className = 'dash-activity-reasoning';
          turnStartedAt = Date.now();
          append(reasoningEl);
        }
        turnReasoning += text;
        reasoningEl.textContent = turnReasoning;
        setPhase('reason', `Sta ragionando · ${lastSentence(turnReasoning)}`);
        followBody();
        followThread();
      },
      // È partito il testo di una risposta: da qui le righe del turno vengono DOPO il testo, quindi
      // se quel testo entra in cronologia va messo qui, non in coda.
      answerStarted() {
        closeTurnReasoning();
        turnMark = body.childElementCount;
        if (phase !== 'done') setPhase('act', 'Scrivo la risposta…');
      },
      // Il modello ha nominato un'azione: la riga in testa lo dice subito, quella vera arriva con
      // l'esito.
      working(text) {
        if (phase === 'done' || !text) return;
        closeTurnReasoning();
        setPhase('act', text);
      },
      // Icona e due parole. `failed`: la riga resta ma il riassunto non la conta — «Ha avviato un
      // timer» su un timer non avviato è una bugia.
      addRow(type, rowIcon, text, failed = false) {
        closeTurnReasoning();
        if (!failed) doneTypes.push(String(type || '').toUpperCase());
        append(makeActivityRow(rowIcon, text));
        if (phase !== 'done') setPhase('act', text);
      },
      // Esito di un comando eseguito subito (livello 1): nella cronologia, non nella bolla.
      addCommand(out) {
        closeTurnReasoning();
        doneTypes.push('ESEGUI_COMANDO');
        const el = renderCommandResult(out);
        el.classList.add('dash-activity-cmd');
        append(el);
        if (phase !== 'done') setPhase('act', `Eseguito · ${(out && out.command) || 'comando'}`);
      },
      // La bolla di un turno che NON era l'ultimo entra nella cronologia come nota e sparisce: per
      // l'utente conta la risposta, non il commento a metà lavoro.
      absorbBubble(bubble) {
        if (!bubble || !bubble.isConnected) return;
        const text = (bubble.textContent || '').trim();
        bubble.remove();
        if (!text) return;
        const note = document.createElement('div');
        note.className = 'dash-activity-note';
        note.textContent = text;
        // Nell'ordine vero: il testo è stato scritto PRIMA delle azioni del turno.
        const at = (turnMark !== null && turnMark <= body.childElementCount) ? body.children[turnMark] || null : null;
        body.insertBefore(note, at);
        items += 1;
        turnMark = null;
        followBody();
        followThread();
      },
      // La nota che il main ha promosso a risposta non resta anche qui: una frase sola, non due.
      dropNote(text) {
        const t = String(text || '').trim();
        if (!t) return;
        const notes = body.querySelectorAll('.dash-activity-note');
        const last = notes[notes.length - 1];
        if (last && (last.textContent || '').trim() === t) { last.remove(); items -= 1; }
      },
      endTurn() {
        closeTurnReasoning();
        const t = lastTurn;
        lastTurn = { text: '', ms: 0 };
        return t;
      },
      // Fine del lavoro: la riga diventa il riassunto, e senza niente dentro il blocco non ha ragione
      // di restare. `failed`: il blocco resta (il ragionamento aiuta a capire cosa stava tentando) ma
      // lo dice, così dopo un «Riprova» non sembra un lavoro riuscito.
      finish({ failed = false } = {}) {
        closeTurnReasoning();
        if (!items) { wrap.remove(); setPhase('done', ''); return; }
        const summary = `${summarizeActivity(doneTypes, sawReasoning)} · ${fmtActivityDuration(Date.now() - startedAt)}`;
        setPhase('done', failed ? `Tentativo non riuscito · ${summary}` : summary);
        if (failed) wrap.dataset.failed = '1';
        head.title = open ? 'Nascondi' : 'Mostra cosa ha fatto Filo';
      },
      remove() { wrap.remove(); },
    };
  }

  // Le azioni nell'ordine in cui sono avvenute, coi doppioni contati. Senza azioni resta il solo
  // ragionamento.
  const ACTIVITY_VERBS = {
    CERCA_WEB: (n) => (n > 1 ? `cercato sul web ${n} volte` : 'cercato sul web'),
    LEGGI_DOCUMENTO: (n) => (n > 1 ? `letto ${n} documenti` : 'letto un documento'),
    LEGGI_FILE: (n) => (n > 1 ? `letto ${n} file` : 'letto un file'),
    LEGGI_TRASPARENZA: () => 'riletto la trasparenza',
    CAPACITA_DETTAGLIO: () => 'verificato cosa sa fare',
    TIMER: (n) => (n > 1 ? `avviato ${n} timer` : 'avviato un timer'),
    SVEGLIA: (n) => (n > 1 ? `impostato ${n} sveglie` : 'impostato una sveglia'),
    CANCELLA_SVEGLIA: () => 'cancellato una sveglia',
    MODIFICA_SVEGLIA: () => 'spostato una sveglia',
    EVENTO_CALENDARIO: (n) => (n > 1 ? `creato ${n} eventi` : 'creato un evento'),
    ESEGUI_COMANDO: (n) => (n > 1 ? `eseguito ${n} comandi` : 'eseguito un comando'),
    IMPOSTA_PREFERENZA: (n) => (n > 1 ? `cambiato ${n} impostazioni` : 'cambiato un\'impostazione'),
    IMPOSTA_ESTETICA: (n) => (n > 1 ? `cambiato ${n} dettagli dell'aspetto` : 'cambiato l\'aspetto'),
    SALVA_APPUNTO: (n) => (n > 1 ? `salvato ${n} appunti` : 'salvato un appunto'),
    SALVA_LEZIONE: (n) => (n > 1 ? `memorizzato ${n} cose` : 'memorizzato una cosa'),
    NAVIGA: (n) => (n > 1 ? `aperto ${n} pagine` : 'aperto una pagina'),
    ONBOARDING: () => 'proseguito con l\'accoglienza',
    PROXY_TAB: () => 'aperto la scheda da un altro paese',
    RIMUOVI_PROXY: () => 'riportato la scheda in Italia',
    RIMUOVI_PROXY_TUTTE: () => 'riportato le schede in Italia',
    REGOLA_PROXY_DOMINIO: () => 'salvato una regola sul paese',
    RIMUOVI_REGOLA_PROXY: () => 'tolto una regola sul paese',
    STILE_PAGINA: () => 'cambiato l\'aspetto della pagina',
    RIPRISTINA_STILE_PAGINA: () => 'rimesso la pagina com\'era',
    COMANDO_FINESTRA: () => 'azionato un comando della finestra',
    INVIA_FEEDBACK: () => 'preparato una segnalazione',
  };
  // `hasReasoning`: senza, un blocco con solo una frase intermedia non può intitolarsi
  // «Ragionamento».
  function summarizeActivity(types, hasReasoning = true) {
    const counts = new Map();
    for (const t of types) counts.set(t, (counts.get(t) || 0) + 1);
    const parts = [];
    for (const [t, n] of counts) {
      const fn = ACTIVITY_VERBS[t];
      if (fn) parts.push(fn(n));
    }
    if (!parts.length) return hasReasoning ? 'Ragionamento' : 'Come ha lavorato';
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
    return `Ha ${list}`;
  }
  function fmtActivityDuration(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    if (!m) return `${s} s`;
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  }

  // La stessa forma dentro il blocco e fra le azioni della bolla, per chi disegna una risposta
  // senza blocco. Tiene la classe della traccia (#376): non è un bottone e non deve sembrarlo.
  function makeActivityRow(rowIcon, text) {
    const el = document.createElement('div');
    el.className = 'dash-action-step dash-activity-row';
    const ic = document.createElement('span');
    ic.className = 'dash-activity-row-icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = rowIcon || '';
    const tx = document.createElement('span');
    tx.textContent = String(text || '').trim();
    el.append(ic, tx);
    return el;
  }

  // Le azioni che si raccontano con una riga invece che con un bottone: già eseguite dal main o
  // passi intermedi, cliccarle non farebbe niente (#376). Una sola tabella, così l'icona di
  // un'azione sta in un posto solo; ciò che è cliccabile resta un bottone sotto la risposta.
  // Il testo del modello va ripulito dai caratteri di controllo: un byte nullo nell'etichetta
  // finiva tale e quale nel diario.
  function pulito(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }
  const ACTIVITY_ROWS = {
    TIMER: (a) => {
      const sec = Number(a.seconds || a.secondi || 0);
      const dur = (self.SN_TIME ? self.SN_TIME.fmtDurationLabel(sec) : `${Math.round(sec / 60)} min`);
      const name = pulito(a.label || a.etichetta);
      return { icon: '⏱', text: `Timer avviato · ${name ? `${name} · ` : ''}${dur}` };
    },
    SVEGLIA: (a) => {
      const when = pulito(a.time || a.orario);
      const name = pulito(a.label || a.etichetta);
      return { icon: '⏰', text: `Sveglia impostata${when ? ` · ${when}` : ''}${name ? ` · ${name}` : ''}` };
    },
    // Se si può aggiungere una sveglia dalla chat, si deve vedere anche quando la si toglie.
    CANCELLA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.removed)) ? a._output.removed : [];
      return { icon: '⏰', text: `Cancellata · ${list.join(', ') || (a.etichetta || a.label || '')}` };
    },
    MODIFICA_SVEGLIA: (a) => {
      const list = (a._output && Array.isArray(a._output.updated)) ? a._output.updated : [];
      return { icon: '⏰', text: `Spostata · ${list.join(', ') || (a.etichetta || a.label || '')}` };
    },
    EVENTO_CALENDARIO: (a) => ({ icon: '📅', text: `Evento creato · ${a.title || a.titolo || ''}` }),
    // Impostazione applicata subito (livello 1, es. il tema): prima non lasciava traccia in chat,
    // come se non fosse successo niente.
    IMPOSTA_PREFERENZA: (a) => {
      const k = a.chiave || a.key || '';
      const v = a.valore ?? a.value;
      return { icon: '⚙', text: `Impostato · ${k}${v !== undefined && v !== '' ? ` = ${v}` : ''}` };
    },
    // La ricerca è già partita nel main; i risultati rientrano nel turno successivo (#368/#376).
    CERCA_WEB: (a) => ({ icon: '🔎', text: `Cerco sul web: ${a.query || ''}` }),
    CAPACITA_DETTAGLIO: () => ({ icon: '📖', text: 'Verifico cosa so fare' }),
    LEGGI_FILE: (a) => {
      const title = (a._output && a._output.title) || '';
      return { icon: '📄', text: title ? `Leggo: ${title}` : 'Leggo un file' };
    },
    LEGGI_DOCUMENTO: (a) => {
      const nome = (a._output && a._output.name) || '';
      return { icon: '📄', text: nome ? `Leggo il documento: ${nome}` : 'Leggo il documento' };
    },
    LEGGI_TRASPARENZA: () => ({ icon: '📄', text: 'Rileggo la pagina di trasparenza' }),
    // Le azioni che non lasciano niente da cliccare: prima sparivano del tutto, e l'utente non
    // sapeva dove fosse finito il suo appunto.
    SALVA_APPUNTO: (a) => {
      const dove = String(a.contesto || a.context || a.argomento || '').trim();
      return { icon: '📝', text: `Appunto salvato${dove ? ` · ${dove}` : ''}` };
    },
    SALVA_LEZIONE: (a) => {
      const t = String(a.testo || a.text || a.lezione || '').trim();
      return { icon: '🧠', text: `Memorizzato · ${t.length > 60 ? `${t.slice(0, 57)}…` : t}` };
    },
    ONBOARDING: (a) => {
      if (a && (a.fine ?? a.chiudi ?? a.done)) return { icon: '👋', text: 'Accoglienza conclusa' };
      const ids = Array.isArray(a && a.spunta) ? a.spunta : [];
      return { icon: '👋', text: `Accoglienza · ${ids.join(', ') || 'passo fatto'}` };
    },
    IMPOSTA_ESTETICA: (a) => {
      const tok = a.token || a.nome || a.name || a.chiave || a.elemento || '';
      const val = a.valore ?? a.value ?? a.val ?? a.colore;
      return { icon: '🎨', text: `Aspetto · ${tok}${val ? ` = ${val}` : ''}` };
    },
    PROXY_TAB: (a) => ({ icon: '🌍', text: `Scheda aperta da · ${String(a.country || a.paese || '').toUpperCase()}` }),
    RIMUOVI_PROXY: () => ({ icon: '🌍', text: 'Scheda riportata in Italia' }),
    RIMUOVI_PROXY_TUTTE: () => ({ icon: '🌍', text: 'Tutte le schede riportate in Italia' }),
    REGOLA_PROXY_DOMINIO: (a) => ({ icon: '🌍', text: `Regola · ${a.dominio || a.domain || a.sito || 'questo sito'} sempre da ${String(a.country || a.paese || '').toUpperCase()}` }),
    RIMUOVI_REGOLA_PROXY: (a) => ({ icon: '🌍', text: `Regola tolta · ${a.dominio || a.domain || a.sito || 'questo sito'}` }),
    STILE_PAGINA: (a) => {
      const d = String(a.descrizione || a.description || '').trim();
      return { icon: '🖌', text: `Aspetto della pagina · ${d || 'modificato'}` };
    },
    RIPRISTINA_STILE_PAGINA: () => ({ icon: '🖌', text: 'Aspetto della pagina ripristinato' }),
    COMANDO_FINESTRA: (a) => {
      const labels = {
        fullscreen: 'Schermo intero', minimize: 'Finestra ridotta a icona', home: 'Home aperta',
        settings: 'Impostazioni aperte', apps: 'Menu App aperto', account: 'Menu Account aperto',
      };
      const cmd = String(a.comando || a.command || a.cmd || '').toLowerCase();
      return { icon: '🪟', text: labels[cmd] || 'Comando della finestra' };
    },
  };
  // Che cosa NON è andato a buon fine, come lo direbbe l'utente: la riga resta, ma non promette
  // il contrario.
  const FAILED_LABELS = {
    TIMER: 'Timer non avviato', SVEGLIA: 'Sveglia non impostata',
    CANCELLA_SVEGLIA: 'Niente da cancellare', MODIFICA_SVEGLIA: 'Niente da spostare',
    SALVA_APPUNTO: 'Appunto non salvato', SALVA_LEZIONE: 'Non memorizzato',
    CERCA_WEB: 'Ricerca non riuscita', LEGGI_FILE: 'File non letto',
    LEGGI_DOCUMENTO: 'Documento non letto', LEGGI_TRASPARENZA: 'Documento non letto',
    CAPACITA_DETTAGLIO: 'Verifica non riuscita', NAVIGA: 'Link non aperto',
    IMPOSTA_PREFERENZA: 'Impostazione non applicata', IMPOSTA_ESTETICA: 'Aspetto non cambiato',
    STILE_PAGINA: 'Aspetto della pagina non cambiato', RIPRISTINA_STILE_PAGINA: 'Aspetto della pagina non ripristinato',
    PROXY_TAB: 'Scheda non instradata', RIMUOVI_PROXY: 'Proxy non tolto',
    RIMUOVI_PROXY_TUTTE: 'Proxy non tolti', REGOLA_PROXY_DOMINIO: 'Regola non salvata',
    RIMUOVI_REGOLA_PROXY: 'Regola non tolta', COMANDO_FINESTRA: 'Comando non eseguito',
    EVENTO_CALENDARIO: 'Evento non creato', ONBOARDING: 'Accoglienza non aggiornata',
  };
  function activityRowFor(a) {
    if (!a) return null;
    // In attesa di conferma: il bottone lo mostra la chat, ma nel diario resta la traccia che Filo
    // l'ha CHIESTO — o un turno di sola richiesta non lascerebbe nessun blocco, e alla conferma non
    // ci sarebbe dove scrivere.
    if (a._confirm) {
      // Due parole, non l'intera spiegazione: quella è nel popup, aperto davanti all'utente.
      let prima = String(a._confirm.text || '').split('\n')[0].replace(/\s*:\s*$/, '').trim();
      if (prima.length > 60) prima = `${prima.slice(0, 57)}…`;
      return { icon: '❔', text: `Conferma chiesta · ${prima || String(a.type || '').toLowerCase()}`, failed: true };
    }
    const type = String(a.type || '').toUpperCase();
    // Non riuscita: la riga lo DICE, invece di raccontare un successo che non c'è stato.
    if (a._executed === false) {
      const perche = motivoFallimento(a);
      return { icon: '⚠', text: `${FAILED_LABELS[type] || 'Azione non riuscita'}${perche ? ` · ${perche}` : ''}`, failed: true };
    }
    const fn = ACTIVITY_ROWS[type];
    if (fn) return fn(a);
    // Azione eseguita che la tabella non conosce: meglio una riga generica che il silenzio — il
    // diario deve dire tutto quello che Filo ha fatto.
    if (a._traccia) return { icon: '•', text: type.toLowerCase().replace(/_/g, ' ') };
    return null;
  }
  // La ragione del fallimento, quando il main la conosce.
  function motivoFallimento(a) {
    const o = a && a._output;
    if (!o) return '';
    if (o.blocked === 'scheme') return 'indirizzo non ammesso';
    if (o.restyle === 'no-page') return 'nessuna pagina web aperta';
    if (o.found === false) return 'non trovato';
    if (o.ok === false && o.detail) return String(o.detail);
    if (o.error) return String(o.error);
    return '';
  }

  // True se l'azione è stata raccontata così (e quindi non è un bottone). Serve in diretta e a
  // fine turno, per le azioni arrivate senza evento.
  function tellActionInActivity(activity, a) {
    if (!activity || !a) return false;
    // Comando già eseguito (livello 1): il suo esito è un passo del lavoro, va nella cronologia e
    // non sotto la risposta. Se è stato bloccato resta in vista: è un problema.
    if (isType(a, 'ESEGUI_COMANDO') && !a._confirm && a._output && !a._output.blocked) {
      activity.addCommand(a._output);
      return true;
    }
    const row = activityRowFor(a);
    if (row) { activity.addRow(a.type, row.icon, row.text, !!row.failed); return true; }
    return false;
  }

  // Le azioni che hanno SIA una riga nel diario SIA un bottone che porta altrove: l'appunto
  // salvato (la riga dice cosa ha scritto, il bottone apre l'editor) e la tinta esatta. Per tutte
  // le altre vale l'aut-aut: o si racconta o si clicca. Aggiungerne una qui è obbligatorio quando
  // le si dà una riga, o la riga si mangia il bottone e la funzione sparisce.
  const ROW_AND_BUTTON = ['SALVA_APPUNTO', 'IMPOSTA_ESTETICA'];

  // `shown`: gli id già raccontati in diretta; a fine turno non si ripetono.
  function renderActions(container, actions, { onAck, autoConfirm = false, activity = null, shown = null } = {}) {
    if (!actions || !actions.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'dash-bubble-actions';
    let hasAck = false;
    for (const a of actions) {
      const told = a && a._callId && shown && shown.has(a._callId);
      // `anche` = riga nel diario E bottone in chat. Oltre all'appunto vale per tutto ciò che
      // aspetta una conferma: la riga dice che Filo l'ha chiesta, il bottone è come si risponde.
      const anche = a._confirm
        || (ROW_AND_BUTTON.includes(String(a.type || '').toUpperCase()) && a._executed !== false);
      if (activity) {
        if (told) {
          // Già in cronologia; resta solo l'eventuale bottone (link, conferma).
          if (!anche && (activityRowFor(a) || (isType(a, 'ESEGUI_COMANDO') && !a._confirm && a._output && !a._output.blocked))) continue;
        } else if (tellActionInActivity(activity, a) && !anche) {
          continue;
        }
      } else {
        const row = activityRowFor(a);
        if (row) {
          wrap.appendChild(makeActivityRow(row.icon, row.text));
          if (!anche) continue;
        }
      }
      // Un'azione senza niente da cliccare (`_traccia`) o non riuscita non diventa MAI un bottone: un
      // chip che al click non fa niente è un vicolo cieco, e la sua riga sta già nel diario. Un'azione
      // IN ATTESA DI CONFERMA non è «fallita»: il suo bottone è tutto il punto.
      if (!a._confirm && ((a._traccia && !anche) || a._executed === false)) continue;
      const btn = renderActionButton(a, { onAck, activity });
      if (btn) wrap.appendChild(btn);
      if (String(a.type || '').toUpperCase() === 'SALVA_APPUNTO') hasAck = true;
    }
    if (!wrap.childElementCount && !(hasAck && onAck)) return;
    // Per l'appunto salvato un tasto ✓ che torna alla dashboard. Timer e sveglie non lo hanno
    // più: la loro riga dice già tutto.
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
    // #159/#183 — le impostazioni di livello 2 non sono chip inerti: il popup di conferma si apre DA
    // SOLO, e con più impostazioni sensibili nella stessa risposta si aprono UNO ALLA VOLTA (niente
    // stacking di modali). Livello 3 e azioni esterne restano a click esplicito.
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

  // #146.4 — Filo ha già applicato un valore ragionevole al token (livello 1); questo bottone
  // apre il box per scegliere il valore esatto. La logica sta in SN_AESTHETIC_REFINER.
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
    // Risolve le dipendenze al click, sugli override più freschi: Filo può averne cambiati altri
    // nel frattempo.
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

  // Esito di un comando da terminale (#146.6): riga di comando + stdout/stderr in monospazio,
  // con note per uscita, timeout e troncamento.
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
      // Comando senza output (tipicamente un `cd`): mai una scatola vuota e invisibile — per i cambi
      // di cartella si dice dove si è finiti, per gli altri un neutro «(nessun output)».
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

  // #376 — traccia di un PASSO INTERMEDIO: racconta cosa fa Filo ma non è un bottone, così
  // l'unica cosa cliccabile resta il risultato vero. Prima avevano la stessa forma dei bottoni e
  // l'utente ne contava due per una sola azione.
  function stepTrace(text) {
    const el = document.createElement('div');
    el.className = 'dash-action-step';
    el.textContent = String(text || '').trim();
    return el;
  }

  function renderActionButton(a, { onAck, activity = null } = {}) {
    const type = String(a.type || '').toUpperCase();
    // Azione sospesa in attesa di conferma (#146.2): il main non l'ha eseguita e ha allegato
    // spiegazione + livello. Il bottone apre il popup OK/Annulla (2) o il box «digita conferma» (3);
    // solo dopo il sì parte davvero. PULISCI_TAB e CANCELLA_ARCHIVIO hanno la loro UI.
    if (a._confirm && a._confirm.level >= 2) {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      // Per i comandi l'etichetta è il comando stesso; la spiegazione resta nel popup.
      const cmdText = String(a.comando || a.command || a.cmd || '').trim();
      const isCmd = type === 'ESEGUI_COMANDO';
      const short = cmdText.length > 60 ? `${cmdText.slice(0, 57)}…` : cmdText;
      // Il testo completo (cosa fa + rischi, #183) vive nel popup: sul bottone, che resta solo come
      // ripiego se l'utente annulla, basta la prima riga.
      const fullText = String(a._confirm.text || '');
      // I due punti finali annunciano il testo che segue nel popup: sul bottone resterebbero appesi
      // nel vuoto.
      const shortLabel = (fullText.split('\n')[0] || 'Esegui').replace(/\s*:\s*$/, '');
      btn.textContent = isCmd ? `▶ ${short}` : shortLabel;
      // #159/#414 — le azioni di livello 2 che Filo PROPONE da sé aprono il popup da sole. Oltre alle
      // impostazioni c'è la segnalazione agli sviluppatori: lasciarla come chip aggiungeva un passaggio
      // prima ancora di poter leggere cosa partirebbe a nome dell'utente. Il popup non invia nulla:
      // mostra il testo e aspetta l'OK.
      const AUTO_CONFIRM_TYPES = ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'INVIA_FEEDBACK'];
      if (AUTO_CONFIRM_TYPES.includes(type) && a._confirm.level === 2) {
        btn.dataset.autoConfirm = '1';
      }
      // La conferma (popup + esecuzione) è una funzione a sé, così renderActions può aprirla DA SOLA,
      // anche in sequenza (#183). Ritorna una Promise che si risolve alla chiusura del popup, perché
      // l'auto-apertura possa attendere l'una prima dell'altra.
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
        // L'utente ha detto sì: da qui l'azione è FATTA. Lo deve sapere il diario e lo deve sapere il
        // MODELLO al turno dopo — l'oggetto è lo stesso che sta nello storico, quindi basta segnarlo qui.
        // Senza, a «l'hai attivato?» il modello poteva solo tirare a indovinare.
        if (r && r.executed) {
          a._confirmed = true;
          a._executed = true;
          delete a._confirm;
          if (r.output) a._output = r.output;
          const row = activityRowFor(a);
          if (activity && row) activity.addRow(a.type, row.icon, row.text, !!row.failed);
        }
        // #146.6 — comando confermato (livello 2/3): mostra l'output in chat.
        if (isCmd) {
          btn.textContent = (r && r.executed) ? `✓ ${short}` : `✗ ${short}`;
          if (r && r.output) btn.after(renderCommandResult(r.output));
          if (r && r.output) applyCommandCwd([{ _output: r.output }]);
          return;
        }
        btn.textContent = (r && r.executed) ? `✓ ${shortLabel}` : '✗ Non eseguita';
        // #146.4 — modifica estetica illeggibile confermata: si offre subito il box per correggere.
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
      // Livello 1 già eseguito dal main, o esito bloccato: il risultato va in chat.
      return renderCommandResult(a._output);
    }
    if (type === 'IMPOSTA_ESTETICA') {
      // Livello 1 normale: già applicata server-side, si mostra il bottone di raffinamento.
      return buildAestheticRefiner(a);
    }
    if (type === 'NAVIGA') {
      // #162 — il link l'ha già aperto il main. Il chip resta come riferimento per RIAPRIRLO, ma con
      // un'etichetta leggibile: il favicon da solo era il bottone «misterioso».
      let label = String(a.label || a.etichetta || '').trim();
      if (!label) {
        try { label = new URL(a.url).hostname.replace(/^www\./, ''); } catch (_) { label = a.url || 'Apri'; }
      }
      // #376 — aperto in SECONDO PIANO: la scheda esiste già, quindi il chip non è «riapri» ma
      // «portami lì» — attiva QUELLA invece di aprire un doppione.
      const bgTabId = (a._output && a._output.background && a._output.tabId) || '';
      const btn = document.createElement(bgTabId ? 'button' : 'a');
      if (bgTabId) {
        btn.type = 'button';
        btn.dataset.bgTab = bgTabId;
        btn.title = `Vai alla scheda — ${label} è aperta in secondo piano`;
        btn.addEventListener('click', async () => {
          const r = await send({ type: MSG.FOCUS_TAB, id: bgTabId });
          // Se quella scheda è stata chiusa nel frattempo il riferimento deve comunque funzionare:
          // riapre il link invece di non fare nulla.
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
      const filePath = a.percorso || a.path || '';
      btn.href = filePath || '#';
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.textContent = a.etichetta || a.label || (filePath || 'File');
      return btn;
    }
    if (type === 'TIMER') {
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn';
      btn.type = 'button';
      btn.disabled = true;
      const sec = Number(a.seconds || a.secondi || 0);
      // #323 — durata fedele all'intento: «30 sec», «2 h», «1 h 30 min». Niente arrotondamento ai
      // minuti: un timer di 30 secondi non è «0 min».
      const dur = (self.SN_TIME ? self.SN_TIME.fmtDurationLabel(sec)
        : `${Math.round(sec / 60)} min`);
      btn.textContent = `⏱ ${a.label || a.etichetta || 'Timer'} · ${dur}`;
      return btn;
    }
    if (type === 'SALVA_APPUNTO') {
      // Gli appunti vivono SOLO nei file dell'editor, quindi la conferma non può essere un chip
      // inerte: resta la ricevuta dell'azione e in più apre l'editor, dove l'appunto è finito.
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
      // Traccia del passo intermedio (#368): la ricerca è già partita nel main e i risultati rientrano
      // nel turno successivo, coi link REALI. NON è un bottone: prima aveva la forma di una pill e
      // l'utente contava «due bottoni» per una cosa sola (#376).
      return stepTrace(`🔎 Cerco sul web: ${a.query || ''}`.trim());
    }
    if (type === 'CAPACITA_DETTAGLIO') {
      // Passo intermedio: Filo consulta il proprio manifesto delle capacità (#F2).
      return stepTrace('📖 Verifico cosa so fare');
    }
    if (type === 'LEGGI_FILE') {
      // Passo intermedio: Filo legge un file dell'editor (#379.5); il contenuto rientra nel turno
      // successivo.
      const title = (a._output && a._output.title) || '';
      return stepTrace(title ? `📄 Leggo: ${title}` : '📄 Leggo un file');
    }
    if (type === 'LEGGI_DOCUMENTO') {
      // Passo intermedio: Filo apre un documento dal disco; il contenuto rientra nel turno dopo.
      const nome = (a._output && a._output.name) || '';
      return stepTrace(nome ? `📄 Leggo il documento: ${nome}` : '📄 Leggo il documento');
    }
    if (type === 'LEGGI_TRASPARENZA') {
      // Passo intermedio: Filo rilegge le scelte dell'owner messe per iscritto prima di rispondere
      // sul perché di un modello o di un dato.
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
      // La pulizia parte SOLO al click, con conferma, mai automaticamente (spec §2.1).
      const btn = document.createElement('button');
      btn.className = 'dash-action-btn dash-action-btn-primary';
      btn.type = 'button';
      btn.textContent = '🧹 Riordina e archivia le schede';
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        // Livello 2 (#146.2): popup Filo che spiega la modifica, non il window.confirm nativo
        // (PATTERNS.md).
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

  // §5 — cancellazione retroattiva: cerca le schede pertinenti e le elimina DEFINITIVAMENTE
  // dopo conferma esplicita.
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
        // Livello 3 (#146.2): eliminazione irreversibile → l'utente deve digitare «conferma».
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

  // Invio messaggio. Il ciclo «azione → esito → modello» vive nel main (tool calling nativo):
  // cerca, legge, imposta e risponde in un turno solo, e la scheda riceve ragionamento, azioni e
  // note mano a mano. Niente più rilanci automatici.
  function isType(a, t) {
    return a && String(a.type || '').toUpperCase() === t;
  }
  // Cosa dire in riga appena il modello NOMINA un'azione, prima degli argomenti: l'attesa è
  // attrito, e «Cerco sul web…» un secondo prima vale più di un'etichetta precisa un secondo dopo.
  const START_LABELS = {
    CERCA_WEB: 'Cerco sul web…',
    LEGGI_FILE: 'Leggo un file…',
    LEGGI_DOCUMENTO: 'Leggo il documento…',
    LEGGI_TRASPARENZA: 'Rileggo la pagina di trasparenza…',
    CAPACITA_DETTAGLIO: 'Verifico cosa so fare…',
    ESEGUI_COMANDO: 'Eseguo un comando…',
    TIMER: 'Avvio un timer…',
    SVEGLIA: 'Imposto una sveglia…',
    CANCELLA_SVEGLIA: 'Tolgo una sveglia…',
    MODIFICA_SVEGLIA: 'Sposto una sveglia…',
    NAVIGA: 'Apro una pagina…',
    SALVA_APPUNTO: 'Salvo un appunto…',
    IMPOSTA_PREFERENZA: 'Cambio un\'impostazione…',
    IMPOSTA_ESTETICA: 'Cambio l\'aspetto…',
    INVIA_FEEDBACK: 'Preparo una segnalazione…',
  };
  function startLabelFor(type) {
    return START_LABELS[String(type || '').toUpperCase()] || 'Eseguo un\'azione…';
  }

  // Un singolo turno del modello: bolla «sta pensando» + reasoning live, FILO_CHAT, render della
  // bolla di Filo e registrazione nello storico. Ritorna la risposta grezza.
  // `internal: true` per i turni di prosecuzione automatica: il «messaggio utente» è un nudge
  // scritto da noi, e il main non deve trattarlo come parole dell'utente (#360).
  // La conversazione mandata al modello toglie l'ultima voce SOLO se è davvero il messaggio che
  // parte ora: dopo un tentativo interrotto in fondo c'è la traccia di cosa Filo aveva già fatto.
  function historyWithout(userMessage) {
    const h = threadHistory.slice();
    const last = h[h.length - 1];
    if (last && last.role === 'user' && last.text === userMessage) h.pop();
    return h;
  }

  async function runFiloTurn({ userMessage, images = [], internal = false, activity = null }) {
    // Il blocco di attività (#521) lo crea e lo chiude runTurnAndContinue; qui ci si scrive dentro.
    const pending = activity || createActivity();
    const ownsActivity = !activity;
    // Reasoning VERO in diretta: sottoscrizione filtrata per reqId che il main usa per pushare i
    // thought summary. Se il modello non ragiona non arriva nulla.
    const reasoningReqId = `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let offReasoning = null;
    if (window.filo?.onReasoning) {
      offReasoning = window.filo.onReasoning((data) => {
        if (data && data.reqId === reasoningReqId && data.text) pending.pushReasoning(data.text);
      });
    }
    // #420 — RISPOSTA in diretta: la bolla si riempie mentre il modello scrive, e NON si crea finché
    // non arriva il PRIMO carattere — una risposta di sola azione non lascia una bolla vuota. Quando
    // il testo inizia il ragionamento si richiude da solo: i due non si accavallano.
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
          pending.answerStarted(); // il ragionamento si richiude, la risposta comincia
          streamBubble = document.createElement('div');
          streamBubble.className = 'dash-bubble dash-bubble-filo dash-bubble-streaming';
          bubblesEl.appendChild(streamBubble);
        }
        streamedText += data.delta;
        streamBubble.textContent = streamedText;
        followBottomIfNear();
      });
    }
    // Le AZIONI in diretta (tool calling nativo): il modello ne nomina una → la riga in testa lo
    // dice subito; il main la esegue → la riga vera entra nel blocco con l'esito; un giro con azioni
    // si chiude → il testo di quel giro era una nota di lavoro, non la risposta, e la bolla riparte
    // vuota. Gli id già raccontati qui non si ripetono a fine turno.
    const shown = new Set();
    let offAction = null;
    if (window.filo?.onAction) {
      offAction = window.filo.onAction((data) => {
        if (!data || data.reqId !== reasoningReqId) return;
        if (data.kind === 'start') {
          pending.working(startLabelFor(data.type));
        } else if (data.kind === 'done') {
          const a = data.action;
          if (a && data.kept !== false && tellActionInActivity(pending, a) && a._callId) shown.add(a._callId);
        } else if (data.kind === 'round') {
          if (streamBubble) {
            if (!streamBubble.querySelector('.dash-bubble-actions')) pending.absorbBubble(streamBubble);
            streamBubble = null;
          }
          streamedText = '';
        }
      });
    }
    const msg = {
      type: MSG.FILO_CHAT,
      userMessage,
      // Tutta la conversazione TRANNE il messaggio che parte adesso. Non «l'ultima voce e basta»:
      // dopo un turno interrotto in fondo c'è quello che Filo aveva già fatto, e buttarlo faceva
      // ripartire il «Riprova» senza saperlo.
      threadHistory: historyWithout(userMessage),
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
    if (offAction) { try { offAction(); } catch (_) {} }
    if (!r?.ok) {
      // Il ragionamento già arrivato resta leggibile anche sotto un errore: aiuta a capire cosa
      // stava tentando. Senza niente dentro, il blocco sparisce.
      pending.endTurn();
      if (ownsActivity) pending.finish();
      // Le azioni fatte PRIMA del guasto sono successe davvero: restano nello storico, così un
      // «Riprova» riparte sapendo che quel timer c'è già.
      if (Array.isArray(r?.actions) && r.actions.length) {
        threadHistory.push({ role: 'filo', text: '', actions: r.actions, interrotto: true });
      }
      // Un turno fallito non deve lasciare a schermo il testo parziale di un tentativo andato male.
      if (streamBubble) { streamBubble.remove(); streamBubble = null; }
      const err = makeBubble({ role: 'filo', text: r?.error || 'Errore.' });
      // #360 — la bolla d'errore dice «riprova»: farlo riscrivere a mano è attrito inutile, il tasto
      // rimanda LO STESSO messaggio.
      const row = document.createElement('div');
      row.className = 'dash-bubble-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'dash-action-btn dash-action-btn-primary';
      retry.textContent = '↻ Riprova';
      retry.title = 'Rimanda lo stesso messaggio';
      retry.addEventListener('click', () => retryTurn(err, { userMessage, images, internal }));
      row.appendChild(retry);
      // #598 — senza nessuna chiave «Riprova» non porta da nessuna parte: la strada è la pagina
      // Crediti, e sta qui sotto, non in un menu.
      if (r?.code === 'NO_API_KEY') {
        const credits = document.createElement('button');
        credits.type = 'button';
        credits.className = 'dash-action-btn';
        credits.textContent = 'Apri Crediti';
        credits.title = 'Riscatta il codice d\'invito';
        credits.addEventListener('click', () => chrome.tabs.create({ url: 'filo://credits/credits.html' }));
        row.appendChild(credits);
      }
      // #524 — durante l'accoglienza il solo «Riprova» è un vicolo cieco: se il modello non
      // risponde, alla home non ci si arriva più. L'uscita sta qui accanto.
      if (onboardingActive) row.appendChild(makeSkipOnboardingBtn('Salta e vai alla home'));
      err.appendChild(row);
      bubblesEl.appendChild(err);
    } else {
      // La risposta finale (r.text) è autorevole: riconcilia la bolla in streaming. Senza testo ma
      // con azioni la bolla non esiste e si cade nel ramo «solo azioni».
      let filoBubble;
      if (streamBubble) {
        streamBubble.classList.remove('dash-bubble-streaming');
        if (r.text) {
          // #418 — a fine turno il testo grezzo dello streaming diventa la risposta formattata.
          setBubbleText(streamBubble, r.text, true);
          filoBubble = streamBubble;
        } else {
          // Il testo si è svuotato (es. reset non recuperato): niente bolla vuota.
          streamBubble.remove();
          filoBubble = makeBubble({ role: 'filo', text: '' });
          bubblesEl.appendChild(filoBubble);
        }
      } else {
        // Se il testo è la nota dell'ultimo giro con azioni (giro finale muto), la nota esce dal
        // blocco: la frase sta nella bolla e basta.
        if (r.text) pending.dropNote(r.text);
        filoBubble = makeBubble({ role: 'filo', text: r.text || '', markdown: true });
        bubblesEl.appendChild(filoBubble);
      }
      // #159 — risposta fresca: le impostazioni di livello 2 aprono il popup da sole. Mai in replay.
      renderActions(filoBubble, r.actions || [], { onAck: goHome, autoConfirm: true, activity: pending, shown });
      // Un turno di sole azioni raccontate nel blocco non lascia una bolla vuota sotto.
      if (!(r.text || '').trim() && !filoBubble.querySelector('.dash-bubble-actions') && !(filoBubble.textContent || '').trim()) {
        filoBubble.remove();
      }
      // Il ragionamento del turno entra nello storico col messaggio. I blocchi strutturati del
      // fornitore tornano al modello al turno dopo, così riprende da dove aveva lasciato.
      const turn = pending.endTurn();
      if (ownsActivity) pending.finish();
      const entry = { role: 'filo', text: r.text || '', actions: r.actions || [] };
      if (turn.text) { entry.reasoning = turn.text; entry.reasoningMs = turn.ms; }
      if (Array.isArray(r.reasoningDetails) && r.reasoningDetails.length) entry.reasoningDetails = r.reasoningDetails;
      if (Array.isArray(r.notes) && r.notes.length) entry.notes = r.notes;
      threadHistory.push(entry);
      applyCommandCwd(r.actions);
      // Chi guida la sequenza deve poter assorbire questa bolla nel blocco se il turno non era
      // l'ultimo.
      r._bubble = filoBubble;
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

  // Condiviso fra il primo invio e il «Riprova»: riprovare deve comportarsi come inviare.
  async function runTurnAndContinue(args) {
    // Un blocco per tutta la sequenza (#521): i turni automatici sono passi dello stesso lavoro,
    // non risposte diverse.
    const activity = createActivity();
    // Un turno solo: la sequenza «azione → esito → modello» la guida il main, e la scheda la
    // racconta in diretta nel blocco.
    const r = await runFiloTurn({ ...args, activity });
    activity.finish({ failed: !r?.ok });

    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();

    // #524 — l'intervista si è chiusa: il main compatta quello che ha imparato e genera la prima
    // home. Lo si dice subito; la home arriva con FILO_ONBOARDING_DONE.
    if (r?.ok && r.onboardingClosed) onboardingClosing();

    // Aggiorna live (potrebbe esserci un timer/sveglia appena creato).
    refreshLive().catch(() => {});
    return r;
  }

  // #360 — «Riprova»: rimanda lo stesso messaggio senza farlo riscrivere. La bolla d'errore
  // sparisce e lo storico è già a posto: un turno fallito non ci ha lasciato niente.
  async function retryTurn(errBubble, args) {
    if (sending) return;
    sending = true;
    sendBtn.disabled = true;
    try { errBubble.remove(); } catch (_) {}
    await runTurnAndContinue(args);
  }

  // Image paste / drop (multi-immagine)
  const imgPreviewsEl = $('imgPreviews');

  function renderImagePreviews() {
    imgPreviewsEl.innerHTML = '';
    imgPreviewsEl.hidden = pendingImages.length === 0;
    pendingImages.forEach((dataUrl, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'dash-img-preview';
      // Retrocompatibilità: la prima anteprima conserva l'id storico #imgPreview (usato dai test).
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
  // Immagini da «Incolla → cronologia» del menu Filo: Ctrl+V passa dal listener 'paste' qui
  // sopra, il menu dispatcha invece questo evento custom.
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

  // Lightbox: click su un'immagine per ingrandirla
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

  // Owner (admin): abilita /users e /gift in /help. Il gate forte resta nel main e nelle rules.
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
    // #583 — apre la POSTA delle segnalazioni, che legge solo chi le gestisce: a chiunque altro
    // darebbe una pagina vuota. Chi vuole MANDARE un feedback lo fa dal tasto destro o da Filo.
    '/feedback': () => {
      if (!isOwner) {
        showFiloLine('I feedback li vede chi li gestisce. Per mandarne uno: tasto destro → «Invia feedback», oppure scrivimi cosa non va e lo scrivo io.');
        return;
      }
      send({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' });
    },
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
        '/incognito — apri una finestra in incognito',
        '/pulisci, /pulizia — riordina e archivia le schede non più utili',
        '/riordina — riordina le schede per colore (nessuna viene chiusa)',
        '/set timer 5:00 — avvia un timer (anche /set timer 8 = 8 minuti)',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      if (isOwner) {
        lines.push(
          '/feedback — apri la posta delle segnalazioni (proprietario)',
          '/users — elenca gli utenti registrati (proprietario)',
          '/gift NUMERO EMAIL — regala crediti a un utente (proprietario)',
        );
      }
      const bubble = makeBubble({ role: 'filo', text: lines.join('\n') });
      bubblesEl.appendChild(bubble);
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    },
  };

  // «/users»: le email degli utenti. Riservato al proprietario (il main rifiuta gli altri con un
  // messaggio chiaro).
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

  // Una riga di risposta da Filo, per i comandi che hanno bisogno di dire qualcosa.
  function showFiloLine(text) {
    if (body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({ role: 'filo', text });
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // «/pulisci»: la STESSA conferma del bottone «Riordina e archivia le schede» (mai automatico,
  // spec §2.1), col popup Filo.
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

  // «/riordina»: riordina la striscia delle schede per colore, come alla riapertura di Filo, ma
  // SENZA chiudere o archiviare nulla. Immediato: è deterministico e non tocca i contenuti, quindi
  // niente popup — ma un feedback esplicito sì.
  async function runTabReorder() {
    const r = await send({ type: MSG.REORDER_TABS });
    showFiloLine(r && r.reordered
      ? '✓ Schede riordinate per colore.'
      : '✓ Le schede erano già in ordine.');
  }

  // «5:00» → 300 ; «8» → 8 minuti → 480. Null se non è una durata valida.
  function parseTimerArg(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2) return null;
      // Ogni parte dev'essere un intero esplicito: «5:», «:30» o «5: 30» non sono durate valide
      // (Number('') === 0 le farebbe passare in silenzio).
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

  // Riconosce un singolo token «tipo sito». DEVE essere preciso: `/git log v1.2` NON è un sito.
  // La logica (e la simmetria con la vecchia barra indirizzi) sta in src/shared/urlNav.js (#398),
  // così indirizzi locali e IP non finiscono all'LLM.
  function isSiteToken(text) {
    return !!(self.SN_URL_NAV && self.SN_URL_NAV.looksLikeAddress(text.slice(1)));
  }

  // Estrae l'host da un token «/sito» per la verifica DNS.
  function siteHostOf(text) {
    const raw = text.slice(1).replace(/^https?:\/\//i, '');
    return (raw.split(/[/:?#]/)[0] || '').toLowerCase();
  }

  // Lo schema (http per server locali e IP privati, https per i domini pubblici) lo sceglie la
  // stessa logica della barra indirizzi — #398.
  function siteUrlOf(text) {
    const raw = text.slice(1);
    return (self.SN_URL_NAV && self.SN_URL_NAV.normalizeUrl(raw))
      || (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  }

  // Cache «il comando shell esiste?», per non rifare lo spawn di controllo a ogni tasto. Per gli
  // script relativi la piccola imprecisione è ok.
  const shellCmdCache = new Map();
  let whichTimer = null;

  // Cache «il dominio esiste?», per non rifare il lookup a ogni tasto. Un host non in cache =
  // ancora da verificare (resta arancione).
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
      // Sito: arancione di default; rosso SOLO se il dominio è già stato verificato inesistente
      // (niente flicker mentre il lookup è in volo).
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
    // Modalità normale: un «/comando» che non è interno né un sito finirebbe all'LLM come testo, e
    // lo si segnala in rosso — ma non mentre si digita un prefisso che potrebbe diventare valido
    // («/he» → «/help»), o il rosso lampeggerebbe.
    const hasSpace = /\s/.test(t);
    if (!hasSpace && isCommandPrefix(firstToken)) return 'none';
    return 'unknown';
  }

  // Vero se `token` è il prefisso non vuoto di un comando Filo noto ma non ancora il comando.
  function isCommandPrefix(token) {
    if (!token || token === '/') return false;
    return Object.keys(SLASH_COMMANDS).some(
      (cmd) => cmd !== token && cmd.startsWith(token)
    );
  }

  // Debounce così il controllo parte quando l'utente si ferma: digitando di getto «/git» i
  // prefissi non vengono controllati e il rosso non lampeggia.
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

  // Usata sull'invio: in caso di dubbio (rete giù, errore) torna true, così non blocca mai una
  // navigazione legittima.
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

  // #433 — Enter su «/sito» il cui host il DNS non conosce. Prima non succedeva NULLA: nessuna
  // scheda, nessun messaggio, indistinguibile da un tasto Invio rotto. Il controllo può sbagliarsi
  // (VPN, rete aziendale), quindi Filo lo dice e lascia comunque aprire con un clic. Il testo resta
  // nel campo: se era un typo si corregge senza riscriverlo.
  let unresolvedLine = null; // { el, host } dell'ultimo avviso ancora non agito
  function showUnresolvedSite(text, host) {
    // Un secondo invio dello STESSO indirizzo non impila avvisi identici. Uno su un indirizzo
    // diverso, o già agito, resta: è roba successa, non rumore.
    if (unresolvedLine && unresolvedLine.host === host) {
      unresolvedLine.el.remove();
      unresolvedLine = null;
    }
    if (body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({
      role: 'filo',
      // Una riga sola: il bottone qui sotto dice già l'altra metà. Spiegare a parole cosa fa un
      // bottone è la spiegazione della UI dentro la UI.
      text: `Non trovo “${host}” — controlla se c’è un errore di battitura.`,
    });
    const row = document.createElement('div');
    row.className = 'dash-bubble-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn dash-action-btn-primary';
    btn.textContent = '↗ Apri comunque';
    btn.title = `Apri ${host} senza il controllo`;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      if (unresolvedLine && unresolvedLine.el === bubble) unresolvedLine = null;
      // L'utente ha deciso: da qui quell'host non viene più messo in dubbio.
      siteResolveCache.set(host, true);
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text) });
      if (inputEl.value.trim() === text) { inputEl.value = ''; autoGrowInput(); }
      updateInputClass();
    });
    row.appendChild(btn);
    bubble.appendChild(row);
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    unresolvedLine = { el: bubble, host };
  }

  // Come sopra ma con debounce, per la verifica live mentre si scrive.
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
    // 'pending' si mostra GIÀ in rosso: aggiungere caratteri a un «/comando» non deve far
    // lampeggiare il colore mentre il controllo è in corso.
    const showUnknown = kind === 'unknown' || kind === 'pending';
    inputEl.classList.toggle('is-cmd-filo', kind === 'filo');
    inputEl.classList.toggle('is-cmd-shell', kind === 'shell');
    inputEl.classList.toggle('is-cmd-unknown', showUnknown);
    // In attesa del controllo "esiste?": rosso (vedi sopra) e avvia il check.
    if (kind === 'pending') scheduleShellWhich(inputEl.value);
    // Sito arancione non ancora verificato: avvia il lookup (debounce) così, se il dominio non
    // esiste, l'input diventa rosso.
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
    // 2) Navigazione diretta a un sito: solo se è un singolo token «tipo sito». L'URL e lo schema
    // li compone SN_URL_NAV.normalizeUrl (#398), così «/localhost:3000» si apre davvero invece
    // di partire su un https vuoto.
    if (isSiteToken(text)) {
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text) });
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      return true;
    }
    // 3) Modalità terminale: tutto il resto con `/` lo esegue la shell, mai l'LLM.
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

  // Esecuzione comandi shell (modalità terminale)
  function updateDirLine() {
    dashDir.textContent = currentCwd || '';
  }

  // Aggiorna la cartella corrente e la RENDE PERSISTENTE (#259). Un solo punto di verità per
  // ogni cambio di `cwd`, così barra, cartella reale e valore salvato restano allineati.
  function setCwd(cwd) {
    if (!cwd || cwd === currentCwd) return;
    currentCwd = cwd;
    updateDirLine();
    applyTerminalMode();
    try { self.SN_STORAGE?.setRaw?.(STORAGE_KEYS.FILO_TERMINAL_CWD, cwd); } catch (_) {}
  }

  // Se l'ultimo comando ha cambiato cartella il main la riporta in _output.cwd: si aggiorna la
  // barra, così percorso mostrato e cartella reale coincidono.
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
    // Ripristina l'ultima cartella del terminale (#259). Se non esiste più, il main la riporta
    // alla home al primo comando e il valore si auto-corregge.
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

  // Colori ANSI (SGR) per l'output del terminale. Niente emulazione TUI: si interpretano solo le
  // sequenze di colore/stile e si SCARTA il resto, così i tool che colorano si vedono giusti senza
  // che i codici grezzi sporchino l'output.
  const ANSI_BASE = ['#1e1e1e', '#cc4136', '#4e9a06', '#c4a000', '#3465a4',
    '#a347ba', '#0e9aa7', '#d3d7cf', '#6e7170', '#ef5350', '#8ae234',
    '#e6d44e', '#5a9ee6', '#c77fd6', '#34e2e2', '#fafafa'];
  function xterm256(n) {
    if (n < 16) return ANSI_BASE[n];
    if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
    const k = n - 16, L = [0, 95, 135, 175, 215, 255];
    return `rgb(${L[Math.floor(k / 36) % 6]},${L[Math.floor(k / 6) % 6]},${L[k % 6]})`;
  }
  // Null se la sequenza è troncata a fine chunk (da ricomporre col chunk successivo).
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

    const cmdBubble = makeBubble({ role: 'user', text: '' });
    cmdBubble.classList.add('dash-term-cmd');
    const promptLine = document.createElement('span');
    promptLine.className = 'dash-term-prompt';
    promptLine.textContent = '/ ';
    cmdBubble.appendChild(promptLine);
    cmdBubble.appendChild(document.createTextNode(command));
    bubblesEl.appendChild(cmdBubble);

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

    // Lo stato ANSI attraversa i chunk: un colore aperto resta valido nei successivi finché non
    // c'è un reset.
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
      // Se il focus era sui controlli che sto per rimuovere (es. campo stdin), riportalo nella barra
      // principale invece di perderlo nel vuoto.
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
    // Il cursore resta nella barra principale così si digita subito il comando dopo. Il campo
    // stdin qui sopra resta cliccabile per i comandi interattivi.
    inputEl.focus();
  }

  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text && pendingImages.length === 0) return;
    // «/dominio.tld»: non navigare di slancio verso un sito inesistente. Si verifica il DNS e, se
    // non esiste, lo si dice offrendo di aprire lo stesso — mai in silenzio (#433).
    if (text.startsWith('/') && isSiteToken(text)) {
      const host = siteHostOf(text);
      const resolves = host ? await ensureSiteResolved(host) : true;
      if (resolves === false) { updateInputClass(); showUnresolvedSite(text, host); return; }
    }
    if (handleSlashCommand(text)) return;
    submitMessage(text);
  });

  // Invio manda, Shift+Invio va a capo: il campo è una textarea, quindi Invio di suo andrebbe a
  // capo. `isComposing` evita di mandare a metà di una composizione IME.
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event('submit'));
    }
  });

  // La textarea parte a una riga e cresce (fino al max-height del CSS). Va richiamata anche
  // quando si svuota il campo da codice.
  function autoGrowInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  // Arancione = comando Filo o sito, azzurro = comando shell (solo in modalità terminale).
  inputEl.addEventListener('input', () => { updateInputClass(); autoGrowInput(); });

  // Bridge cambio stato live dal background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.FILO_ONBOARDING_UPDATED) {
      // #524 — un'altra scheda ha fatto avanzare la stessa intervista: qui la conversazione si
      // riallinea invece di restare ferma.
      onboardingUpdated(msg.onboarding);
    } else if (msg?.type === MSG.FILO_ONBOARDING_DONE) {
      // #524 — intervista finita: la chat lascia il posto alla prima home personale.
      onboardingDone(msg);
    } else if (msg?.type === MSG.FILO_DASHBOARD_UPDATED) {
      // #155 — il ricalcolo in background è pronto: aggiorna messaggio e suggerimenti senza rifare
      // la chiamata all'LLM.
      if (onboardingActive) return; // l'intervista è ancora a schermo
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
      // #524 — l'accoglienza aspettava un modello: appena l'accesso lo rende disponibile Filo si
      // presenta subito, invece di rimandare alla prossima scheda.
      if (msg.signedIn) maybeOpenOnboardingLater();
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


  // Bootstrap — controlli del browser dentro la home. Ogni click aziona il comando REALE della
  // shell via MSG.SHELL_ACTION: il main lo inoltra e la shell apre il suo menu nativo. Nessuna
  // logica di menu duplicata qui.
  let accountCtrlBtn = null; // riferimento all'icona profilo (mostra l'avatar)

  function renderControls() {
    const host = $('dashControls');
    if (!host) return;
    const ICONS = self.SN_ICONS || {};
    const items = [
      // Red-team: per primo e in rosso perché è il canale sicurezza, distinto dai controlli del
      // browser (spec §2).
      { command: 'redteam', icon: 'redteam', label: 'Red-team', url: 'filo://redteam/redteam.html' },
      { command: 'home', icon: 'home', label: 'Home' },
      // Cronologia: la pagina principale è quella delle schede visitate/chiuse, non il log delle
      // azioni AI (raggiungibile da lì).
      { command: 'history', icon: 'history', label: 'Cronologia', url: 'filo://archive/archive.html' },
      // Gli appunti non hanno più un pannello separato: Filo li scrive nei file dell'editor.
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

  // L'icona profilo mostra la foto Google quando sei loggato, con fallback all'icona utente. Lo
  // stato auth vive nel main: ci si iscrive a `auth_changed` per aggiornarla dal vivo.
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

  // Le fusioni in attesa dell'owner NON compaiono più qui: la decisione vive in cima ai Ricevuti
  // della dashboard di gestione (scelta owner).

  // Recap aggiornamento (C4). Popup all'avvio dopo un update: il main calcola quali versioni
  // l'utente ha saltato, qui si mostrano novità e correzioni. Ritorna true se ha mostrato il popup
  // (e chiamerà onClose), così l'avvio può incatenare il ringraziamento feedback DOPO.
  async function maybeShowUpdateRecap(onClose) {
    let recap;
    try { recap = await send({ type: MSG.GET_UPDATE_RECAP }); } catch (_) { return false; }
    if (!recap || !recap.ok) return false;
    // Nessuna versione vista prima (primo avvio) o nessuna nota da mostrare → niente popup.
    if (!recap.lastSeen || !Array.isArray(recap.notes) || !recap.notes.length) return false;
    renderUpdateRecap(recap, onClose);
    return true;
  }

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
    // notes è già ordinato dalla più recente: novità in un blocco, correzioni nell'altro.
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
      // Salva la versione corrente come «vista»: il recap non riapparirà fino al prossimo update.
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

  // Ringraziamento feedback risolto (C5). All'avvio si chiede al main se un feedback di questo
  // utente è passato a «risolto»; la ricompensa per priorità è già accreditata una volta sola. Qui
  // si ringrazia, si spiega cosa è cambiato e si animano i crediti verso il profilo.
  async function maybeShowFeedbackRewards() {
    let res;
    try { res = await send({ type: MSG.GET_FEEDBACK_REWARDS }); } catch (_) { return; }
    if (!res || !res.ok || !Array.isArray(res.rewards) || !res.rewards.length) return;
    renderFeedbackRewards(res.rewards, res.totalCredits || 0);
  }

  // Anima monete dorate dal centro verso l'icona profilo, che nella home è un elemento DOM
  // reale. Decorativa, best-effort, rispetta prefers-reduced-motion.
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
    // #524 — intervista aperta (primo avvio, ripresa a metà, o rilanciata dalle Preferenze)? Allora
    // si mostra la conversazione dal punto in cui era rimasta. Il segno «già accolto» NON si scrive
    // qui, o chi chiude la finestra adesso non la rivede più.
    const onbState = await fetchOnboarding();
    // Carico in parallelo dashboard cache e live state per non sequenziare.
    await Promise.all([
      onbState ? Promise.resolve() : loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
    ]);
    if (onbState) await openOnboarding(onbState);
    // Nessuna intervista aperta: se l'ultima si era chiusa a metà, la home lo dice finché l'utente
    // non risponde a quella riga.
    else refreshOnboardingNotice().catch(() => {});
    // Popup all'avvio, in sequenza per non sovrapporsi: prima il recap aggiornamento, poi il
    // ringraziamento per i feedback risolti. Con l'intervista di benvenuto a schermo non parte
    // niente: sarebbe la prima cosa che l'utente vede di Filo.
    if (onbState) return;
    (async () => {
      try {
        const shown = await maybeShowUpdateRecap(() => maybeShowFeedbackRewards());
        if (!shown) await maybeShowFeedbackRewards();
      } catch (_) {}
    })();
  })();

  // Hook per i test Playwright: rende azioni come farebbe una bolla di chat, senza l'LLM.
  window.__filoDashActions = {
    renderActions,
    applyCommandCwd,
    getCwd: () => currentCwd,
    refreshAccountControl,
  };
})();
