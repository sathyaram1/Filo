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
  // #525 — la targa della chat in corso. Viaggia con ogni messaggio: è il main
  // a scrivere la conversazione su disco, turno per turno, così una chat
  // sopravvive anche se questa scheda muore a metà. Torna null quando la chat
  // si chiude (ritorno alla home, chat nuova), e il messaggio dopo ne apre una.
  let chatId = null;
  let sending = false;
  let liveTickHandle = null;
  let pendingImages = []; // dataUrl delle immagini incollate (multiple)

  // ===== Le parti della home =====
  //
  // Qui restano chat e turni, la home (messaggio centrale e suggerimenti), la
  // colonna live, i controlli in alto a destra, il recap e i premi. Il resto
  // vive accanto, in quattro moduli che si registrano su globalThis e ricevono
  // da qui le loro dipendenze:
  //
  //   SN_DASH_ATTIVITA    il blocco di attività, le righe del diario, i bottoni
  //   SN_DASH_ONBOARDING  la micro-intervista di benvenuto (#524)
  //   SN_DASH_COMANDI     i comandi con lo slash e la colorazione dell'input
  //   SN_DASH_TERMINALE   cartella corrente, colori ANSI, comandi di shell
  //
  // Lo stato che due parti condividono non si copia: si chiede a chi lo
  // possiede — la cartella del terminale al terminale, "sto inviando" a questo
  // file. Tre copie della stessa cosa sono tre modi di mostrarne una sbagliata.
  const Att = self.SN_DASH_ATTIVITA;
  const Accoglienza = self.SN_DASH_ONBOARDING;
  const Comandi = self.SN_DASH_COMANDI;
  const Term = self.SN_DASH_TERMINALE;

  Att.init({
    send,
    faviconUrl: (url) => faviconUrl(url),
    applyCommandCwd: (actions) => Term.applyCommandCwd(actions),
  });
  // #525 — una riga scritta in chat senza passare dal modello (la risposta a un
  // comando con lo slash, il comando di terminale e il suo esito) entra
  // nell'archivio come ogni altra battuta: l'utente l'ha letta dentro questa
  // conversazione, e rileggendola deve ritrovarla. Una sola strada per tutti:
  // due copie della stessa cosa sono due modi di farla divergere, ed è così che
  // il terminale era rimasto fuori.
  //
  // La riga appartiene alla conversazione in cui l'utente l'ha PROVOCATA, non a
  // quella aperta quando è pronta: chi la produce prende la targa (`chatDellaRiga`)
  // al momento del comando e la passa qui. Un comando lento più un ritorno alla
  // home la mettevano nella chat sbagliata, o in una chat nuova mai fatta.
  const archiviaRiga = (text, role, chat) => {
    // L'intervista di benvenuto ha una conversazione sua e un modo suo di
    // finire: le sue righe le archivia lei.
    if (Accoglienza.isActive()) return null;
    const id = chat || ensureChatId();
    try { send({ type: MSG.FILO_CHAT_NOTE, id, text, role }); } catch (_) {}
    return id;
  };
  const chatDellaRiga = () => (Accoglienza.isActive() ? null : ensureChatId());
  // Una riga di una conversazione che qui non è più a schermo si archivia e
  // basta: mostrarla riporterebbe l'utente dentro una chat che aveva chiuso.
  const inChatAperta = (chat) => !chat || chat === chatId;

  Term.init({
    dashDir,
    inputEl,
    bubblesEl,
    makeBubble: (o) => makeBubble(o),
    goThread: () => goThread(),
    updateInputClass: () => Comandi.updateInputClass(),
    archiviaRiga,
    chatDellaRiga,
  });
  Comandi.init({
    send,
    bubblesEl,
    inputEl,
    makeBubble: (o) => makeBubble(o),
    goHome: () => goHome(),
    goThread: () => goThread(),
    autoGrowInput: () => autoGrowInput(),
    refreshLive: () => refreshLive(),
    archiviaRiga,
    chatDellaRiga,
    inChatAperta,
    isTerminalMode: () => Term.isEnabled(),
    getShell: () => Term.getShell(),
    getCwd: () => Term.getCwd(),
    runShellCommand: (command, chat) => Term.runShellCommand(command, chat),
  });
  Accoglienza.init({
    $,
    send,
    bubblesEl,
    threadView,
    inputEl,
    homeMessageEl,
    makeBubble: (o) => makeBubble(o),
    stepTrace: (text) => Att.stepTrace(text),
    goHome: () => goHome(),
    goThread: () => goThread(),
    resetHistory: (onbState) => {
      threadHistory = [];
      // #525 — l'intervista è UNA conversazione: la sua targa la dà lo stato
      // dell'intervista, non il sorteggio di questo caricamento di pagina.
      if (onbState) chatId = chatIdOnboarding(onbState);
    },
    pushHistory: (m) => { threadHistory.push(m); },
    isSending: () => sending,
    beginSending: () => { sending = true; sendBtn.disabled = true; },
    runTurnAndContinue: (args) => runTurnAndContinue(args),
    isHomeMessageVisible: () => showHomeMessage,
    setSuggestions: (list) => { suggestions = list; renderSuggestions(); },
    loadDashboard: () => loadDashboard(),
  });
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

  // ===== Archivio delle chat (#525) =====
  //
  // La targa si crea al primo messaggio, non all'apertura della scheda: una
  // home aperta e mai usata non è una conversazione e non deve comparire in
  // Cronologia.
  function ensureChatId() {
    if (!chatId) {
      chatId = (self.crypto && self.crypto.randomUUID)
        ? self.crypto.randomUUID()
        : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }
    return chatId;
  }

  // L'intervista di benvenuto (#524) è UNA conversazione, anche se si svolge su
  // più aperture della scheda: chi la lascia a metà e riapre Filo domani
  // riprende da dov'era. La targa la calcola il modulo dell'intervista, perché
  // la calcola anche il main (che archivia la domanda di apertura e il
  // congedo) e i due devono dire la stessa cosa.
  function chatIdOnboarding(onbState) {
    return self.SN_ONBOARDING.chatId(onbState);
  }

  // Chiude la chat in corso: il main fissa la data di chiusura e fa partire la
  // classificazione (titolo breve + conversazione/comando). Non si aspetta la
  // risposta — chi è appena tornato alla home non deve stare fermo mentre un
  // modello legge la chat di prima.
  function closeCurrentChat() {
    if (!chatId) return;
    const id = chatId;
    chatId = null;
    try { send({ type: MSG.FILO_CHAT_CLOSE, id }); } catch (_) {}
  }

  // ===== Stato UI =====
  function goHome() {
    // Tornare alla home CHIUDE la chat: è il gesto che la finisce, insieme a
    // "chat nuova" e alla chiusura dell'app. Prima di svuotare le bolle,
    // perché da qui in poi la conversazione non esiste più in questa pagina.
    closeCurrentChat();
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

  // #525 — riapertura di una chat archiviata (filo://archive → clic su una
  // chat, oppure un link con ?chat=<id>). La conversazione torna per intero e
  // si continua a scrivere DENTRO la stessa chat: i messaggi nuovi si
  // accodano a quelli di prima, non aprono una chat gemella.
  //
  // Quello che NON torna sono i bottoni delle azioni: un'azione in attesa di
  // conferma non si può ri-offrire tre giorni dopo come se fosse di adesso.
  // Al loro posto resta la riga che racconta cosa Filo aveva fatto.
  function chatIdFromUrl() {
    try { return new URLSearchParams(self.location.search).get('chat') || null; }
    catch (_) { return null; }
  }

  async function reopenChat(id) {
    const r = await send({ type: MSG.FILO_CHAT_GET, id });
    const chat = r && r.ok && r.chat;
    if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return false;
    chatId = chat.id;
    threadHistory = [];
    bubblesEl.innerHTML = '';
    goThread();
    for (const m of chat.messages) {
      const isUser = m.role === 'user';
      const text = String(m.text || '');
      const types = Array.isArray(m.actions) ? m.actions : [];
      if (text.trim()) {
        bubblesEl.appendChild(makeBubble({ role: isUser ? 'user' : 'filo', text, markdown: !isUser }));
      }
      // Le immagini incollate non stanno nell'archivio (sono data URL da
      // centinaia di KB l'una), ma il loro NUMERO sì: va detto. Senza, chi
      // rilegge trova «cosa vedi in questo grafico?» riferito al nulla e non
      // capisce più di cosa si parlasse — un taglio silenzioso su quello che
      // aveva mandato lui.
      const quante = Number(m.images) || 0;
      if (quante > 0) {
        const nota = document.createElement('div');
        nota.className = 'dash-bubble-note';
        nota.dataset.replay = '1';
        nota.textContent = quante === 1
          ? '1 immagine, non conservata'
          : `${quante} immagini, non conservate`;
        bubblesEl.appendChild(nota);
      }
      if (!isUser && types.length) {
        const note = document.createElement('div');
        note.className = 'dash-bubble-note';
        note.dataset.replay = '1';
        note.textContent = Att.summarizeActivity(types, false);
        bubblesEl.appendChild(note);
      }
      threadHistory.push(isUser
        ? { role: 'user', text }
        : { role: 'filo', text, actions: types.map((t) => ({ type: t })) });
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    inputEl.focus();
    return true;
  }

  // ===== Suggerimenti (colonna sinistra) =====
  function iconLabel(icon) {
    const map = {
      gmail: 'M', calendar: 'C', editor: 'E', file: 'F',
      link: '↗', note: '✎', web: '🌐',
    };
    return map[icon] || (icon ? icon[0].toUpperCase() : '·');
  }

  // Il disegno vero quando l'insieme delle icone di Filo ce l'ha, la letterina
  // solo come ultimo ripiego: un suggerimento nato con una «C» accanto era il
  // primo elemento che un utente nuovo doveva cliccare (#663).
  function drawSugIcon(el, name) {
    const svg = typeof self.SN_ICONS?.[name] === 'function' ? self.SN_ICONS[name](20) : '';
    if (svg) el.innerHTML = svg;
    else el.textContent = iconLabel(name);
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
        img.onerror = () => { img.remove(); drawSugIcon(icon, s.icon); };
        icon.appendChild(img);
      } else {
        drawSugIcon(icon, s.icon);
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
          text: `⏰ Sveglia ${fmtAlarmWhen(t)}${t.label ? `\n${t.label}` : ''}`,
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

  // Quando suona una sveglia. Se si RIPETE, il giorno della prossima occorrenza
  // non è l'informazione utile ("07:55 di domani" per una sveglia del lunedì e
  // del mercoledì dice meno del vero): si mostrano l'orario e i giorni, con la
  // stessa dicitura che legge l'assistente ("feriali", "lun+mer").
  function fmtAlarmWhen(t) {
    const M = self.SN_FILO_MEMORY;
    const rep = (t.repeat && t.repeat.length && M && M.formatRepeat) ? M.formatRepeat(t.repeat) : '';
    if (!rep) return fmtAlarmTime(t.endsAt);
    const d = new Date(t.endsAt);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${hhmm} · ${rep}`;
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
    // Su una sveglia ricorrente diciamo anche i giorni: "Ferma" la zittisce ora
    // e la lascia in lista per la prossima volta, quindi va detto.
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

    // Pulsante × per dismissione rapida (stessa azione di "Ferma"). Sulle
    // sveglie RICORRENTI i due pulsanti non fanno più la stessa cosa: "Ferma"
    // zittisce quella di adesso e la lascia per la prossima volta, la × la
    // toglie del tutto — che è quello che la × fa su ogni altra card della
    // colonna, e senza questo ramo una sveglia ricorrente non si potrebbe
    // togliere proprio mentre suona.
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

  // È cambiato se Filo ha un modello da chiamare: prima l'accoglienza, che è
  // ciò che l'utente aspetta al primo avvio; se resta chiusa (già fatta, o
  // c'è una conversazione in corso) si rifà almeno il messaggio della home,
  // che altrimenti continua a spiegare un silenzio finito (#663).
  async function risvegliaHome() {
    await Accoglienza.maybeOpenOnboardingLater();
    if (Accoglienza.isActive() || document.body.dataset.state !== 'home') return;
    // Senza `force`: chi sa rispondere serve subito il saluto d'attesa e si
    // rifà il messaggio nel giro in background, invece di far aspettare
    // l'utente davanti a una chiamata al modello.
    await loadDashboard();
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

  // ===== Invio messaggio =====
  // Il ciclo «azione → esito → modello» vive nel main (tool calling nativo):
  // cerca, legge, imposta e risponde in un turno solo, e la scheda riceve
  // ragionamento, azioni e note mano a mano. Qui non ci sono più rilanci
  // automatici con messaggi di spinta: la scheda mostra quello che arriva.
  // Cosa dire in riga appena il modello NOMINA un'azione, prima ancora che
  // gli argomenti siano arrivati: l'attesa è attrito, e «Cerco sul web…» un
  // secondo prima vale più di un'etichetta precisa un secondo dopo.
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

  // Un singolo turno del modello: bolla "sta pensando" + reasoning live, invio
  // FILO_CHAT, render della bolla di Filo con le sue azioni e registrazione del
  // turno nello storico. Ritorna la risposta grezza per decidere se proseguire.
  // `internal: true` per i turni di prosecuzione automatica: il "messaggio
  // utente" è un nudge scritto da noi, non una richiesta reale. Il main lo usa
  // per non trattarlo come parole dell'utente (#360: una segnalazione proposta
  // da Filo non deve citare un nudge interno).
  // La conversazione da mandare al modello, senza il messaggio che parte ora.
  // Toglie l'ultima voce SOLO se è davvero quel messaggio: dopo un tentativo
  // interrotto in fondo c'è la traccia di cosa Filo aveva già fatto, e quella
  // deve arrivare al modello.
  function historyWithout(userMessage) {
    const h = threadHistory.slice();
    const last = h[h.length - 1];
    if (last && last.role === 'user' && last.text === userMessage) h.pop();
    return h;
  }

  async function runFiloTurn({ userMessage, images = [], internal = false, activity = null }) {
    // Blocco di attività della domanda (#521): lo crea e lo chiude chi guida
    // la sequenza dei turni (runTurnAndContinue); qui ci si scrive dentro.
    const pending = activity || Att.create(bubblesEl);
    const ownsActivity = !activity;
    // Canale per il reasoning VERO in diretta: apriamo una sottoscrizione
    // filtrata per reqId e la passiamo al main, che ci pusha i thought summary
    // del modello mentre genera. Se il modello non ragiona, non arriva nulla e
    // il blocco resta in attesa finché non parte il testo.
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
    // lascia una bolla vuota che poi si riempie. Quando il testo inizia, il
    // ragionamento si richiude da solo (resta apribile): i due non si accavallano.
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
    // Le AZIONI in diretta (tool calling nativo): il modello ne nomina una →
    // la riga in testa lo dice subito; il main la esegue → la riga vera entra
    // nel blocco con l'esito; un giro con azioni si chiude → il testo scritto
    // in quel giro era una nota di lavoro, non la risposta: finisce nel blocco
    // e la bolla riparte vuota per il giro dopo. Gli id delle chiamate già
    // raccontate qui non si ripetono a fine turno (renderActions).
    const shown = new Set();
    let offAction = null;
    if (window.filo?.onAction) {
      offAction = window.filo.onAction((data) => {
        if (!data || data.reqId !== reasoningReqId) return;
        if (data.kind === 'start') {
          pending.working(startLabelFor(data.type));
        } else if (data.kind === 'done') {
          const a = data.action;
          if (a && data.kept !== false && Att.tellActionInActivity(pending, a) && a._callId) shown.add(a._callId);
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
      // Tutta la conversazione TRANNE il messaggio che stiamo mandando adesso
      // (viaggia a parte, in `userMessage`). Non «l'ultima voce e basta»: dopo
      // un turno interrotto in fondo c'è quello che Filo aveva già fatto, e
      // buttarlo via faceva ripartire il «Riprova» senza saperlo.
      threadHistory: historyWithout(userMessage),
      reasoningReqId,
      internal,
      // #525 — la chat si archivia nel main, mentre la si fa.
      chatId: ensureChatId(),
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
      // Il ragionamento già arrivato resta leggibile anche sotto un errore:
      // aiuta a capire cosa stava tentando. Senza niente dentro, il blocco sparisce.
      pending.endTurn();
      if (ownsActivity) pending.finish();
      // Le azioni fatte PRIMA del guasto sono successe davvero: restano nello
      // storico, così un «Riprova» riparte sapendo che quel timer c'è già
      // invece di avviarne un secondo.
      if (Array.isArray(r?.actions) && r.actions.length) {
        threadHistory.push({ role: 'filo', text: '', actions: r.actions, interrotto: true });
      }
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
      // #598 — senza nessuna chiave «Riprova» non porta da nessuna parte: la
      // strada è la pagina Crediti, e sta qui sotto, non in un menu. Lo stesso
      // quando il servizio ha rifiutato la chiave (#629): è lì che si cambia.
      // Il main dice se è un rifiuto della chiave (un 403 di moderazione non
      // lo è: lì Crediti non c'entra); per le risposte senza quel campo vale
      // lo status.
      const W = window.SN_WALLET;
      const keyRefused = r && 'keyRefused' in r ? Boolean(r.keyRefused) : Boolean(W && W.isKeyRefusalStatus(r?.status));
      // Dove si rimedia lo dice chi conosce i codici, non un elenco di casi
      // scritto qui: un ostacolo nuovo restava col solo «Riprova», che finché
      // l'ostacolo c'è rimanda sempre la stessa risposta (#663).
      const CE = window.SN_CHAT_ERRORS;
      const pagina = keyRefused
        ? { dove: 'crediti', url: 'filo://credits/credits.html', label: 'Apri Crediti' }
        : (CE?.rimedioPagina ? CE.rimedioPagina(r?.code) : null);
      if (pagina) {
        const via = document.createElement('button');
        via.type = 'button';
        via.className = 'dash-action-btn';
        via.textContent = pagina.label;
        via.title = pagina.dove === 'opzioni'
          ? 'Scegli il modello per questa funzione'
          : (r?.code === 'NO_API_KEY' ? 'Riscatta il codice d\'invito' : 'Controlla o togli la chiave OpenRouter');
        via.addEventListener('click', () => chrome.tabs.create({ url: pagina.url }));
        row.appendChild(via);
      }
      // #524 — durante l'accoglienza il solo "Riprova" è un vicolo cieco: se il
      // modello non risponde (rete assente, provider giù, crediti finiti) alla
      // home non ci si arriva più. L'uscita sta qui, accanto, dove l'utente
      // guarda.
      if (Accoglienza.isActive()) row.appendChild(Accoglienza.makeSkipOnboardingBtn('Salta e vai alla home'));
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
        // Se il testo è la nota dell'ultimo giro con azioni (il giro finale era
        // muto), la nota esce dal blocco: la frase sta nella bolla e basta.
        if (r.text) pending.dropNote(r.text);
        filoBubble = makeBubble({ role: 'filo', text: r.text || '', markdown: true });
        bubblesEl.appendChild(filoBubble);
      }
      // #159 — risposta fresca: le impostazioni a livello 2 aprono il loro popup
      // di conferma da sole (autoConfirm). Solo qui (nuova risposta), mai in
      // replay storico.
      Att.renderActions(filoBubble, r.actions || [], { onAck: goHome, autoConfirm: true, activity: pending, shown });
      // Un turno di sole azioni raccontate nel blocco (un timer avviato, e
      // niente da dire) non lascia una bolla vuota sotto.
      if (!(r.text || '').trim() && !filoBubble.querySelector('.dash-bubble-actions') && !(filoBubble.textContent || '').trim()) {
        filoBubble.remove();
      }
      // #629 — la chiave OpenRouter dell'utente è stata rifiutata e ha
      // risposto la chiave personale (i crediti di Filo): una riga discreta
      // sotto la risposta, non un errore: la risposta è arrivata.
      if (r.keyFallback && window.SN_WALLET) {
        const note = document.createElement('div');
        note.className = 'dash-bubble-note';
        note.dataset.keyFallback = String(r.keyFallback.status || '');
        note.textContent = window.SN_WALLET.ownKeyFallbackLine(r.keyFallback.status);
        bubblesEl.appendChild(note);
      }
      // Il ragionamento del turno entra nello storico del thread insieme al
      // messaggio. Il testo resta con la conversazione; i blocchi strutturati
      // del fornitore (reasoningDetails) tornano al modello al turno dopo,
      // così riprende da dove aveva lasciato.
      const turn = pending.endTurn();
      if (ownsActivity) pending.finish();
      const entry = { role: 'filo', text: r.text || '', actions: r.actions || [] };
      if (turn.text) { entry.reasoning = turn.text; entry.reasoningMs = turn.ms; }
      if (Array.isArray(r.reasoningDetails) && r.reasoningDetails.length) entry.reasoningDetails = r.reasoningDetails;
      if (Array.isArray(r.notes) && r.notes.length) entry.notes = r.notes;
      threadHistory.push(entry);
      Term.applyCommandCwd(r.actions);
      // Chi guida la sequenza deve poter assorbire questa bolla nel blocco se
      // il turno non era l'ultimo.
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
    // Un blocco di attività per tutta la sequenza (#521): i turni automatici
    // sono passi dello stesso lavoro, non risposte diverse.
    const activity = Att.create(bubblesEl);
    // Un turno solo: la sequenza «azione → esito → modello» la guida il main,
    // e la scheda la racconta in diretta dentro il blocco (runFiloTurn).
    const r = await runFiloTurn({ ...args, activity });
    activity.finish({ failed: !r?.ok });

    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();

    // #524 — l'intervista di benvenuto si è appena chiusa: il main sta
    // compattando quello che ha imparato e generando la prima home. Lo diciamo
    // subito, la home arriva con FILO_ONBOARDING_DONE.
    if (r?.ok && r.onboardingClosed) Accoglienza.onboardingClosing();

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

  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text && pendingImages.length === 0) return;
    // "/dominio.tld": non navigare DI SLANCIO verso un sito inesistente
    // (porterebbe a una pagina bianca). Verifica il DNS (await se non già in
    // cache) e, se il dominio non esiste, dillo e offri di aprire lo stesso —
    // mai restare in silenzio (#433).
    if (text.startsWith('/') && Comandi.isSiteToken(text)) {
      const host = Comandi.siteHostOf(text);
      const resolves = host ? await Comandi.ensureSiteResolved(host) : true;
      if (resolves === false) { Comandi.updateInputClass(); Comandi.showUnresolvedSite(text, host); return; }
    }
    if (Comandi.handleSlashCommand(text)) return;
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
  inputEl.addEventListener('input', () => { Comandi.updateInputClass(); autoGrowInput(); });

  // ===== Bridge cambio stato live dal background =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.FILO_CHATS_UPDATED && msg.cancellata) {
      // #525 — qualcuno ha cancellato dalla Cronologia la conversazione che
      // sta ancora qui a schermo. Continuare a scriverci dentro la farebbe
      // rinascere con la stessa targa e i messaggi di prima persi: l'opposto
      // di quello che l'utente ha chiesto. Da qui in poi è una chat nuova — e
      // lo diciamo, perché una cosa cancellata altrove non deve succedere di
      // nascosto.
      if (msg.cancellata === chatId) {
        chatId = null;
        if (body.dataset.state === 'thread') {
          const nota = document.createElement('div');
          nota.className = 'dash-bubble-note';
          nota.textContent = 'Questa conversazione è stata cancellata dalla Cronologia. Quello che scrivi da adesso apre una chat nuova.';
          bubblesEl.appendChild(nota);
          bubblesEl.scrollTop = bubblesEl.scrollHeight;
        }
      }
    } else if (msg?.type === MSG.FILO_ONBOARDING_UPDATED) {
      // #524 — un'altra scheda ha fatto avanzare la stessa intervista: qui la
      // conversazione si riallinea invece di restare ferma a com'era.
      Accoglienza.onboardingUpdated(msg.onboarding);
    } else if (msg?.type === MSG.FILO_ONBOARDING_DONE) {
      // #524 — intervista finita: la chat lascia il posto alla prima home
      // personale, già costruita col profilo appena imparato.
      Accoglienza.onboardingDone(msg);
    } else if (msg?.type === MSG.FILO_DASHBOARD_UPDATED) {
      // #155 — il ricalcolo in background della home è pronto: aggiorna
      // messaggio + suggerimenti senza rifare la chiamata all'LLM.
      if (Accoglienza.isActive()) return; // l'intervista è ancora a schermo
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
      if (msg.settings && msg.settings.terminal) Term.applySettings(msg.settings.terminal);
      // Aggiorna suoneria in live se l'utente la cambia dalle opzioni.
      if (msg.settings && msg.settings.timerRingtone && RINGTONES[msg.settings.timerRingtone]) {
        _timerRingTone = msg.settings.timerRingtone;
      }
    } else if (msg?.type === MSG.AUTH_CHANGED) {
      // Login/logout fatto altrove (es. dal menu profilo): aggiorna l'avatar.
      Comandi.setOwner(msg.signedIn && msg.isAdmin);
      applyAccountProfile(msg.signedIn ? msg.profile : null);
      // #524 — l'accoglienza aspettava un modello: appena l'accesso lo rende
      // disponibile, Filo si presenta subito invece di rimandare alla prossima
      // scheda nuova.
      if (msg.signedIn) Accoglienza.maybeOpenOnboardingLater();
    } else if (msg?.type === MSG.CREDITS_CHANGED) {
      // Un invito riscattato da fuori (#651): il link aperto da un'altra
      // applicazione, o l'invito che aspettava questa installazione al primo
      // avvio. Il main lo spinge una volta sola.
      if (msg.walletNotice) inCodaPopup(() => showInviteWelcome(msg.walletNotice));
      // Con i crediti arriva anche il modo di rispondere: l'accoglienza che
      // aspettava parte adesso, come già fa all'accesso. Senza, chi entrava con
      // un invito la vedeva solo alla scheda dopo (#663).
      Accoglienza.maybeOpenOnboardingLater();
    } else if (msg?.type === MSG.FILO_READY_CHANGED) {
      // Adesso Filo ha (o non ha più) un modello da chiamare. La home aperta si
      // rifà da sé: chi aspettava la configurazione condivisa, che arriva dalla
      // rete dopo l'avvio, restava sul cartello «non posso rispondere» fino a
      // un ricaricamento (#663).
      risvegliaHome().catch(() => {});
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
      Comandi.setOwner(r && r.signedIn && r.isAdmin);
      applyAccountProfile(r && r.signedIn ? r.profile : null);
    } catch (_) {
      Comandi.setOwner(false);
      applyAccountProfile(null);
    }
  }

  // Le fusioni in attesa del via libera dell'owner NON compaiono più qui: la
  // decisione vive in cima ai Ricevuti della dashboard di gestione, insieme
  // alle altre cose che aspettano lui (scelta owner 2026-08-26).

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
  // Sei appena entrato con un invito (#651): il collegamento aperto da fuori,
  // o il primo avvio dopo aver scaricato Filo dalla pagina dell'invito. I
  // crediti arrivano senza che tu chieda niente, e mentre guardi la home: il
  // main spinge l'avviso appena il riscatto è andato, e la home lo racconta
  // una volta sola (il segno «già visto» lo tiene il main).
  // Lo stesso avviso non si racconta due volte: adesso arriva da due strade
  // (la spinta del main e la domanda all'apertura) e possono incrociarsi.
  let avvisoInvitoMostrato = '';
  async function showInviteWelcome(n) {
    if (!n || !n.text || !window.SN_CONFIRM_UI?.notify) return false;
    const firma = `${n.kind || ''}|${n.text}`;
    if (firma === avvisoInvitoMostrato) return false;
    avvisoInvitoMostrato = firma;
    try { await send({ type: MSG.WALLET_NOTICE_SEEN, where: 'home' }); } catch (_) {}
    const entrato = n.kind === 'entry';
    await window.SN_CONFIRM_UI.notify({
      title: entrato ? 'Benvenuto in Filo' : 'Il tuo invito',
      text: entrato ? `${n.text} Li trovi nella pagina Crediti, insieme ai tuoi inviti da dare.` : n.text,
      okLabel: entrato ? 'Evviva!' : 'Va bene',
    });
    return true;
  }

  // I popup dell'avvio si incatenano, mai sovrapposti: l'avviso dell'invito
  // arriva quando arriva (quattro secondi dopo l'avvio), e può cadere in mezzo
  // al recap di un aggiornamento.
  let codaPopup = Promise.resolve();
  function inCodaPopup(fn) {
    codaPopup = codaPopup.then(fn, fn);
    return codaPopup;
  }

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

  // #525 — la scheda sta per sparire (chiusura della scheda o dell'app): è una
  // chiusura di chat come le altre. Best-effort, perché a pagina che muore un
  // messaggio può non partire: la rete di sicurezza vera è il giro di riordino
  // all'avvio successivo (main.js → sweepPendingChats), che chiude e classifica
  // le chat rimaste appese.
  self.addEventListener('pagehide', () => {
    try {
      // Mentre l'intervista di benvenuto è in corso la scheda che sparisce non
      // chiude niente: l'intervista riprende dov'era alla prossima apertura, e
      // chiuderla qui vorrebbe dire pagare un titolo e un tipo a ogni
      // ricaricamento per una conversazione che non è finita.
      if (Accoglienza.isActive()) return;
      closeCurrentChat();
    } catch (_) {}
  });

  (async function init() {
    renderControls();
    await applySavedTheme();
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      showHomeMessage = settings?.showHomeMessage !== false;
      Term.setEnabled(!!settings?.terminal?.enabled);
      Term.setShell(settings?.terminal?.shell || 'powershell');
      // Suoneria timer: legge la preferenza; se non impostata o non valida usa 'default'.
      const saved = settings?.timerRingtone;
      if (saved && RINGTONES[saved]) _timerRingTone = saved;
    } catch (_) {}
    applyHomeMessageVisibility();
    if (Term.isEnabled()) await Term.initCwd();
    Term.applyTerminalMode();
    // #524 — intervista di benvenuto aperta (primo avvio, o ripresa a metà, o
    // rilanciata dalle Preferenze)? Allora la home non serve: quello che
    // l'utente deve vedere è la conversazione, dal punto in cui era rimasta. Il
    // segno "già accolto" NON si scrive qui — si scrive quando l'intervista
    // finisce, altrimenti chi chiude la finestra adesso non la rivede più.
    const onbState = await Accoglienza.fetchOnboarding();
    // #525 — una chat archiviata da riaprire (?chat=<id>). L'intervista di
    // benvenuto ha comunque la precedenza: è la PRIMA conversazione e va
    // finita, e durante l'intervista in archivio non c'è ancora niente.
    const reopenId = onbState ? null : chatIdFromUrl();
    // Carico in parallelo dashboard cache e live state per non sequenziare.
    await Promise.all([
      (onbState || reopenId) ? Promise.resolve() : loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
    ]);
    // Una chat che non c'è più (cancellata da un'altra scheda) non deve
    // lasciare una pagina vuota: si ricade sulla home normale.
    if (reopenId) {
      const opened = await reopenChat(reopenId).catch((e) => { console.warn('[Filo] riapertura chat', e); return false; });
      if (!opened) await loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e));
    }
    if (onbState) await Accoglienza.openOnboarding(onbState);
    // Nessuna intervista aperta: se l'ultima si era chiusa a metà, la home lo
    // dice — finché l'utente non risponde a quella riga.
    else Accoglienza.refreshOnboardingNotice().catch(() => {});
    // Popup all'avvio, in sequenza per non sovrapporsi: prima il recap
    // aggiornamento (solo se c'è una versione precedente vista e note nuove),
    // POI il ringraziamento per i feedback risolti (C5). Se il recap non compare,
    // il ringraziamento parte subito. Passano dalla stessa coda del benvenuto
    // di un invito (#651), che arriva quando arriva. Con l'intervista di
    // benvenuto a schermo (#524) non parte niente: un popup sopra l'accoglienza
    // è la prima cosa che l'utente vedrebbe di Filo.
    // Il benvenuto di un invito può essere arrivato PRIMA che questa pagina
    // fosse in ascolto: al primo avvio il riscatto si chiude in pochi secondi,
    // mentre la home si sta ancora aprendo, e la spinta del main non trova
    // nessuno. Chiederlo all'apertura non costa un giro dal server (l'avviso
    // è scritto in locale) e non dipende più da chi arriva prima.
    inCodaPopup(async () => {
      try {
        const r = await send({ type: MSG.WALLET_NOTICE_PENDING, where: 'home' });
        if (r && r.ok && r.notice) await showInviteWelcome(r.notice);
      } catch (_) {}
    });
    if (onbState) return;
    inCodaPopup(async () => {
      try {
        const shown = await maybeShowUpdateRecap(() => maybeShowFeedbackRewards());
        if (!shown) await maybeShowFeedbackRewards();
      } catch (_) {}
    });
  })();

  // Hook per i test Playwright (stesso pattern di __filoEditorFormat
  // nell'editor): permette di renderizzare azioni come farebbe una bolla di
  // chat senza dover pilotare l'LLM.
  window.__filoDashActions = {
    renderActions: Att.renderActions,
    applyCommandCwd: Term.applyCommandCwd,
    getCwd: Term.getCwd,
    refreshAccountControl,
  };
})();
