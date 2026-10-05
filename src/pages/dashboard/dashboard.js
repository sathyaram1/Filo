// Dashboard Filo (new tab). Controller UI.
//
// Stati visibili:
//   - "home"   → messaggio centrale proattivo
//   - "thread" → conversazione in corso (bolle)
// Ai lati, in tutti e due gli stati, le carte (#870): le disegna dashboard-carte.js.
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
  const accadeEl = $('accade');
  const inputForm = $('inputForm');
  const inputEl = $('input');
  const sendBtn = $('sendBtn');
  const dashDir = $('dashDir');

  // ===== Stato locale =====
  let suggestions = [];
  let showHomeMessage = true; // commento centrale (disattivabile da Preferenze)
  let threadHistory = []; // [{role: 'user'|'filo', text, actions?}]
  // #525 — la targa della chat in corso. Viaggia con ogni messaggio: è il main
  // a scrivere la conversazione su disco, turno per turno, così una chat
  // sopravvive anche se questa scheda muore a metà. Torna null quando la chat
  // si chiude (ritorno alla home, chat nuova), e il messaggio dopo ne apre una.
  let chatId = null;
  let sending = false;
  let liveTickHandle = null;
  let pendingImages = []; // dataUrl delle immagini incollate (multiple)
  // #950 — file trascinati dal disco: { percorso, nome }. Il percorso parte col messaggio, come se l'utente
  // l'avesse incollato; le immagini arrivate dal disco ricordano il loro.
  let pendingFiles = [];
  const percorsiImmagini = new Map();

  // ===== Le parti della home =====
  //
  // Qui restano chat e turni, il messaggio centrale, timer e avvisi (con la
  // suoneria), i suggerimenti, i controlli in alto a destra, il recap e i premi.
  // Il resto vive accanto, in moduli che si registrano su globalThis e ricevono
  // da qui le loro dipendenze:
  //
  //   SN_DASH_ATTIVITA    il blocco di attività, le righe del diario, i bottoni
  //   SN_DASH_ONBOARDING  la micro-intervista di benvenuto (#524)
  //   SN_DASH_COMANDI     i comandi con lo slash e la colorazione dell'input
  //   SN_DASH_TERMINALE   cartella corrente, colori ANSI, comandi di shell
  //   SN_DASH_CARTE       le carte ai lati e «altro» (#870)
  //   SN_DASH_SISTEMA     ora, batteria, rete e Bluetooth in fondo alla colonna destra (#873)
  //
  // Lo stato che due parti condividono non si copia: si chiede a chi lo
  // possiede — la cartella del terminale al terminale, "sto inviando" a questo
  // file. Tre copie della stessa cosa sono tre modi di mostrarne una sbagliata.
  const Att = self.SN_DASH_ATTIVITA;
  const Accoglienza = self.SN_DASH_ONBOARDING;
  const Comandi = self.SN_DASH_COMANDI;
  const Term = self.SN_DASH_TERMINALE;
  const Carte = self.SN_DASH_CARTE;
  const Sistema = self.SN_DASH_SISTEMA;

  Att.init({
    send,
    faviconUrl: (url) => faviconUrl(url),
    applyCommandCwd: (actions) => Term.applyCommandCwd(actions),
    // Le parole dell'utente in questa chat viaggiano con l'OK: un codice scritto da lui può uscire (#810).
    paroleUtente: () => paroleUtente(),
    apriProposta: (url, vicino) => apriProposta(url, vicino),
    archiviaAzione: (type, cambi) => {
      const id = chatDellaRiga();
      const ids = Array.isArray(cambi) ? cambi : [];
      if (id) { try { send({ type: MSG.FILO_CHAT_NOTE, id, text: '', role: 'filo', actions: [type], ...(ids.length ? { cambi: ids } : {}) }); } catch (_) {} }
    },
  });
  // #867 — il segno sulla bolla dell'utente per i cambi di stato che il suo messaggio ha chiesto.
  const Cambi = self.SN_DASH_CAMBI;
  Cambi.init({ send });
  // #590 — una pagina aperta da Filo che si è spostata da sé su un sito bloccato dopo la risposta.
  if (window.filo?.onAperturaFermata) {
    window.filo.onAperturaFermata((data) => {
      const azioni = threadHistory.flatMap((m) => (m && Array.isArray(m.actions) ? m.actions : []));
      Att.aperturaFermata(azioni, data || {});
    });
  }
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
  const archiviaRiga = (text, role, chat, esterno) => {
    // L'intervista di benvenuto ha una conversazione sua e un modo suo di
    // finire: le sue righe le archivia lei.
    if (Accoglienza.isActive()) return null;
    const id = chat || ensureChatId();
    try { send({ type: MSG.FILO_CHAT_NOTE, id, text, role, ...(esterno ? { esterno } : {}) }); } catch (_) {}
    return id;
  };
  const chatDellaRiga = () => (Accoglienza.isActive() ? null : ensureChatId());
  // Una riga di una conversazione che qui non è più a schermo si archivia e
  // basta: mostrarla riporterebbe l'utente dentro una chat che aveva chiuso.
  const inChatAperta = (chat) => !chat || chat === chatId;

  Sistema.init({ send, MSG, host: $('sistema'), ICONS: self.SN_ICONS });
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
    soloRisposteSenzaCrediti: () => {
      const bolle = [...bubblesEl.children];
      return bolle.some((b) => b.dataset.senzaCrediti === '1')
        && bolle.every((b) => b.dataset.senzaCrediti === '1' || b.classList.contains('dash-bubble-user'));
    },
    setSuggestions: (list) => { suggestions = list; renderSuggestions(); },
    loadDashboard: () => loadDashboard(),
  });
  Carte.init({
    send,
    accadeEl,
    tieniEl: $('tieni'),
    altroEl: $('altro'),
    refreshLive: () => refreshLive(),
    onSuggestionClick: (s, vicino) => onSuggestionClick(s, vicino),
    aggiornaSuggerimenti: () => loadDashboard({ force: true }).catch(() => {}),
    faviconUrl: (url) => faviconUrl(url),
    apriNelFilo: (o) => apriNelFilo(o),
    scriviNelCampo: (t) => scriviNelCampo(t),
    chatCorrente: () => chatId,
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
    Term.nuovaChat(false);
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

  async function reopenChat(id, { chiudiPrima = false } = {}) {
    const r = await send({ type: MSG.FILO_CHAT_GET, id });
    const chat = r && r.ok && r.chat;
    if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return false;
    // Da una carta della home (#870): la conversazione a schermo si chiude come col ritorno alla home.
    if (chiudiPrima && chatId && chatId !== chat.id) { closeCurrentChat(); Term.nuovaChat(false); }
    chatId = chat.id;
    threadHistory = [];
    bubblesEl.innerHTML = '';
    goThread();
    let bollaUtente = null;
    for (const m of chat.messages) {
      const isUser = m.role === 'user';
      const text = String(m.text || '');
      const types = Array.isArray(m.actions) ? m.actions : [];
      if (text.trim()) {
        const b = makeBubble({ role: isUser ? 'user' : 'filo', text, markdown: !isUser });
        bubblesEl.appendChild(b);
        if (isUser) bollaUtente = b;
      }
      // I cambi chiesti con quel messaggio ritrovano il loro segno, col loro stato di adesso.
      if (!isUser && Array.isArray(m.cambi) && m.cambi.length && bollaUtente) Cambi.segna(bollaUtente, m.cambi);
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
      // Cosa veniva da fuori resta con la frase (#810): la porta delle uscite lo rilegge da qui.
      const fuori = isUser ? {} : {
        ...(Array.isArray(m.letti) && m.letti.length ? { letti: m.letti } : {}),
        ...(typeof m.esterno === 'string' && m.esterno ? { esterno: m.esterno } : {}),
      };
      threadHistory.push(isUser
        ? { role: 'user', text, ...(m.daModello ? { daModello: true } : {}) }
        : { role: 'filo', text, actions: types.map((t) => ({ type: t })), ...fuori });
    }
    Term.nuovaChat(chat.messages.some((m) => (
      (m.role !== 'user' && Array.isArray(m.actions) && m.actions.includes('ESEGUI_COMANDO'))
      || (m.role === 'user' && /^\//.test(String(m.text || '').trim()) && Comandi.classifyInput(String(m.text)) !== 'filo')
    )));
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    inputEl.focus();
    return true;
  }

  // ===== «Apri nel filo» (#870) =====
  // Ogni carta è una conversazione: quella che l'ha fatta nascere, se c'è ancora, altrimenti una frase di Filo
  // in coda al filo a schermo (o in una conversazione nuova). La frase entra nello storico: il modello la vede.
  async function apriNelFilo({ chat = null, testo = '', esterno = '' } = {}) {
    if (Accoglienza.isActive()) return 'accoglienza';
    if (sending) return 'risponde';
    if (chat && chat === chatId && body.dataset.state === 'thread') { inputEl.focus(); return true; }
    if (chat && chat !== chatId) {
      const r = await send({ type: MSG.FILO_CHAT_FOCUS, id: chat });
      if (r && r.portato) return true;
      if (await reopenChat(chat, { chiudiPrima: true }).catch(() => false)) return true;
    }
    if (!testo) return false;
    // La stessa carta aperta due volte non ripete la frase: è già l'ultima cosa che Filo ha detto qui.
    const ultimo = threadHistory[threadHistory.length - 1];
    if (body.dataset.state === 'thread' && ultimo && ultimo.role === 'filo' && ultimo.text === testo) {
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
      inputEl.focus();
      return true;
    }
    const DA_FUORI = { download: 'dal nome di un file scaricato' };
    archiviaRiga(testo, 'filo', null, esterno);
    threadHistory.push({ role: 'filo', text: testo, actions: [], ...(DA_FUORI[esterno] ? { esterno: DA_FUORI[esterno] } : {}) });
    goThread();
    bubblesEl.appendChild(makeBubble({ role: 'filo', text: testo }));
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    inputEl.focus();
    return true;
  }

  // Un'azione che si finisce a parole («Sposta la sveglia … alle »): il testo resta nel campo, il cursore in fondo.
  function scriviNelCampo(testo) {
    inputEl.value = testo;
    autoGrowInput();
    Comandi.updateInputClass();
    inputEl.focus();
    try { inputEl.setSelectionRange(testo.length, testo.length); } catch (_) {}
  }

  // ===== Suggerimenti =====
  // Favicon di un sito a partire dall'URL. Usa il servizio Google s2 —
  // gratis, niente API key, regge i casi mancanti restituendo un'icona
  // grigia generica. Ritorna '' per URL non http(s) (es. file://, mailto:).
  // Quello che l'utente ha scritto in questa chat: un codice scritto da lui può uscire (#810). Il testo di un
  // suggerimento della home no, l'ha scritto un modello.
  function paroleUtente() {
    return threadHistory.filter((m) => m && m.role !== 'filo' && !m.daModello).map((m) => String(m.text || ''));
  }

  // Un indirizzo web che un modello ha proposto qui si apre solo dal main, dopo la porta delle uscite, con
  // l'indirizzo che si apre davvero (#810). Se si ferma, la riga lo dice accanto a ciò che è stato cliccato.
  async function apriProposta(url, vicino = null) {
    let r = null;
    try { r = await send({ type: MSG.FILO_APRI_PROPOSTA, url, parole: paroleUtente() }); } catch (_) {}
    if (r && r.frase) notaFermata(r.frase, vicino);
  }
  function notaFermata(frase, vicino) {
    if (vicino && vicino.dataset.fermata) return;
    if (vicino) vicino.dataset.fermata = '1';
    const nota = document.createElement('div');
    nota.className = 'dash-bubble-note dash-fermata-clic';
    nota.textContent = `🔒 ${frase.charAt(0).toUpperCase()}${frase.slice(1)}`;
    const li = vicino && vicino.closest('li');
    const dopo = vicino && (vicino.closest('.dash-bubble-actions') || vicino.closest('.dash-bubble'));
    if (li) li.appendChild(nota);
    else if (dopo) dopo.insertAdjacentElement('afterend', nota);
    else bubblesEl.appendChild(nota);
  }
  // Ogni collegamento web o di posta della pagina (risposte, bottoni) passa da apriProposta, anche col tasto centrale.
  const apriDaCollegamento = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !/^(?:https?|mailto|tel|sms):/i.test(a.href)) return;
    e.preventDefault();
    e.stopPropagation();
    apriProposta(a.href, a);
  };
  document.addEventListener('click', apriDaCollegamento, true);
  document.addEventListener('auxclick', apriDaCollegamento, true);
  // Un'apertura chiesta dal menu del tasto destro la ferma il main: la riga va accanto al collegamento di quel menu.
  let ultimoTastoDestro = null;
  document.addEventListener('contextmenu', (e) => {
    ultimoTastoDestro = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  }, true);

  function faviconUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
    } catch (_) { return ''; }
  }

  // I suggerimenti sono UNA carta fra le altre (#870): li disegna la parte delle carte.
  function renderSuggestions({ pronti = true } = {}) {
    Carte.setSuggerimenti(suggestions, { pronti });
  }

  async function onSuggestionClick(s, vicino = null) {
    if (s.fermata) { notaFermata(String(s.fermata), vicino); return; }
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
    // Il suggerimento l'ha scritto un modello (#810): un indirizzo passa dalla porta delle uscite, e il suo testo va
    // in chat come suo, non come parole dell'utente né come comando con la barra.
    // Una pagina di Filo non è un'uscita: la porta delle uscite la rifiuterebbe e il clic non farebbe niente.
    if (type === 'NAVIGA' && /^filo:\/\//i.test(String(a.url || ''))) {
      send({ type: MSG.OPEN_URL, url: a.url });
    } else if (type === 'NAVIGA' && a.url) {
      apriProposta(a.url, vicino);
    } else if (type === 'APRI_FILE' && (a.path || a.url)) {
      const url = a.url || a.path;
      if (/^https?:/.test(url)) apriProposta(url, vicino);
    } else if (type === 'CHAT' && a.prompt) {
      submitMessage(String(a.prompt), { daModello: true });
    } else {
      submitMessage(String(s.text || ''), { daModello: true });
    }
  }

  // ===== Timer, sveglie e avvisi: carte a sinistra (#870) =====
  async function refreshLive() {
    const [timersR, notiR] = await Promise.all([
      send({ type: MSG.FILO_GET_TIMERS }),
      send({ type: MSG.FILO_GET_NOTIFICATIONS }),
    ]);
    const timers = (timersR?.ok && timersR.timers) || [];
    const notifications = (notiR?.ok && notiR.notifications) || [];
    Carte.setVive({ timers, notifiche: notifications });

    // La suoneria parte se c'è almeno un timer che suona e si ferma quando non ce ne sono più.
    const hasRinging = timers.some((t) => t.ringing);
    if (hasRinging) {
      startAlarm();
    } else {
      stopAlarm();
    }

    // Il conto alla rovescia si ridisegna ogni secondo solo finché c'è qualcosa che scorre o suona.
    const hasActiveTimer = timers.some((t) => !t.paused || t.ringing);
    if (hasActiveTimer && !liveTickHandle) {
      liveTickHandle = setInterval(refreshLive, 1000);
    } else if (!hasActiveTimer && liveTickHandle) {
      clearInterval(liveTickHandle);
      liveTickHandle = null;
    }
  }

  // Mostra/nasconde il commento centrale di Filo (Preferenze → "Commento nella
  // home"). I suggerimenti nella colonna sinistra restano comunque visibili.
  function applyHomeMessageVisibility() {
    homeMessageEl.hidden = !showHomeMessage;
  }

  // ===== Generazione dashboard (messaggio centro + suggerimenti) =====
  // Un ricalcolo spinto dal main mentre la richiesta è in volo è più nuovo della sua risposta, e uno arrivato
  // prima vale quanto la cache che la risposta servirebbe: i suggerimenti che ha portato restano («Aggiorna» no).
  let giroDashboard = 0;
  let spinteDashboard = 0;
  async function loadDashboard({ force = false } = {}) {
    const giro = ++giroDashboard;
    renderSuggestions({ pronti: false });
    if (showHomeMessage) {
      homeMessageEl.classList.add('dash-home-msg-loading');
      homeMessageEl.textContent = '…';
    }
    const r = await send({ type: MSG.FILO_GENERATE_DASHBOARD, force });
    if (giro !== giroDashboard) return;
    homeMessageEl.classList.remove('dash-home-msg-loading');
    homeMessageEl.textContent = (r?.ok && r.message) || 'Filo è in ascolto.';
    if (!force && spinteDashboard) { renderSuggestions(); return; }
    suggestions = (r?.ok && Array.isArray(r.suggestions)) ? r.suggestions : [];
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
    LEGGI_IMPOSTAZIONI: 'Leggo come sei impostato…',
    TOGLI_PERMESSO_SITO: 'Tolgo un permesso…',
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
    RINOMINA_FILE: 'Leggo i file per dar loro un nome…',
    CARTA_HOME: 'Sistemo le carte della home…',
    VOLUME: 'Cambio il volume…',
    BLUETOOTH: 'Chiedo al Bluetooth…',
    WIFI: 'Chiedo al Wi-Fi…',
  };
  function startLabelFor(type) {
    return START_LABELS[String(type || '').toUpperCase()] || 'Eseguo un\'azione…';
  }
  // Un'azione che lavora su più cose dice quante ne ha fatte: «3 di 40» al posto di un'attesa al buio.
  function progressLabelFor(type, fatti, totali) {
    const base = startLabelFor(type);
    const n = Number(totali);
    return n > 1 ? `${base} ${Math.min(Number(fatti) || 0, n)} di ${n}` : base;
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

  async function runFiloTurn({ userMessage, images = [], internal = false, daModello = false, activity = null }) {
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
        // Il marker del conto si vede già come numero mentre scorre: la
        // risposta finale lo avrà risolto nel main, e le due non devono differire.
        streamBubble.textContent = globalThis.SN_CALC
          ? globalThis.SN_CALC.resolveCalcMarkers(streamedText, { streaming: true })
          : streamedText;
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
        } else if (data.kind === 'progress') {
          pending.working(progressLabelFor(data.type, data.fatti, data.totali));
        } else if (data.kind === 'done') {
          const a = data.action;
          if (a && Array.isArray(a._cambi)) Cambi.segna(pending.el, a._cambi);
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
      ...(daModello ? { daModello: true } : {}),
      // #525 — la chat si archivia nel main, mentre la si fa.
      chatId: ensureChatId(),
    };
    if (images.length) {
      msg.image = images[0]; // retrocompatibilità (provider mono-immagine)
      msg.images = images;
    }
    const r = await send(msg);
    // Anche quelle arrivate senza evento in diretta (o con un guasto dopo): il segno non dipende dalla diretta.
    for (const a of (Array.isArray(r?.actions) ? r.actions : [])) {
      if (a && Array.isArray(a._cambi)) Cambi.segna(pending.el, a._cambi);
    }

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
      if (r?.code === 'NO_API_KEY' || keyRefused) {
        const credits = document.createElement('button');
        credits.type = 'button';
        credits.className = 'dash-action-btn';
        credits.textContent = 'Apri Crediti';
        credits.title = r?.code === 'NO_API_KEY' ? 'Riscatta il codice d\'invito' : 'Controlla o togli la chiave OpenRouter';
        credits.addEventListener('click', () => chrome.tabs.create({ url: 'filo://credits/credits.html' }));
        row.appendChild(credits);
      }
      if (r?.code === 'NO_API_KEY') err.dataset.senzaCrediti = '1';
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
      if (Array.isArray(r.letti) && r.letti.length) entry.letti = r.letti;
      threadHistory.push(entry);
      Term.applyCommandCwd(r.actions);
      // Chi guida la sequenza deve poter assorbire questa bolla nel blocco se
      // il turno non era l'ultimo.
      r._bubble = filoBubble;
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    return r;
  }

  // `daModello`: il testo viene da un suggerimento della home, non dalle dita dell'utente (#810).
  async function submitMessage(text, { daModello = false } = {}) {
    if ((!text && pendingImages.length === 0 && pendingFiles.length === 0) || sending) return;
    sending = true;
    sendBtn.disabled = true;
    const imagesToSend = pendingImages.slice();
    const righeFile = [...pendingFiles.map((f) => f.percorso), ...imagesToSend.map((d) => percorsiImmagini.get(d))]
      .filter(Boolean).map((p) => `File: ${p}`);
    clearImagePreviews();
    if (righeFile.length) text = [text || (imagesToSend.length ? 'Descrivi questa immagine.' : ''), ...righeFile].filter(Boolean).join('\n');
    // Svuota subito la textarea: la bolla utente è già visibile, niente attesa.
    inputEl.value = '';
    autoGrowInput();
    // Prima query dalla home → entra in stato thread.
    if (body.dataset.state !== 'thread') goThread();

    // Bolla utente
    threadHistory.push({ role: 'user', text: text || '(immagine)', ...(daModello ? { daModello: true } : {}) });
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

    await runTurnAndContinue({ userMessage: text || 'Descrivi questa immagine.', images: imagesToSend, daModello });
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

  const Rinomina = window.SN_RINOMINA_UI;
  const percorsoDelFile = (f) => {
    try { return (window.filo && window.filo.percorsoDelFile) ? window.filo.percorsoDelFile(f) : ''; } catch (_) { return ''; }
  };
  const nomeDaPercorso = (p) => String(p || '').split(/[\\/]/).pop() || String(p || '');
  // Il tasto destro su un file della barra di scrittura: il nome sensato prima di mandarlo, o toglierlo.
  function menuFileInArrivo(e, { percorso, togli, suRinominato }) {
    e.preventDefault();
    const ancora = e.currentTarget;
    const r = ancora.getBoundingClientRect();
    const x = e.type === 'contextmenu' && e.clientX ? e.clientX : r.left;
    const y = e.type === 'contextmenu' && e.clientY ? e.clientY : r.bottom;
    const nome = nomeDaPercorso(percorso);
    Promise.resolve(Rinomina ? Rinomina.disponibile() : false).then((disp) => {
      if (!Rinomina) return;
      const voci = [];
      if (disp && Rinomina.tipoSupportato(nome)) {
        voci.push([Rinomina.VOCE, () => Rinomina.apri({ ancora, percorso, nome, suRinominato, suRimesso: suRinominato })]);
      }
      if (Rinomina.nomeDiPrima(percorso)) {
        voci.push([Rinomina.VOCE_RIMETTI, () => Rinomina.rimetti({ ancora, percorso, suRimesso: suRinominato })]);
      }
      voci.push(['Togli dal messaggio', togli]);
      Rinomina.menu(x, y, voci, { ancora });
    });
  }
  function conMenuFile(el, opzioni) {
    el.addEventListener('contextmenu', (e) => menuFileInArrivo(e, opzioni()));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) menuFileInArrivo(e, opzioni());
    });
  }

  function renderImagePreviews() {
    imgPreviewsEl.innerHTML = '';
    imgPreviewsEl.hidden = pendingImages.length === 0 && pendingFiles.length === 0;
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
        percorsiImmagini.delete(dataUrl);
        renderImagePreviews();
      });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      if (percorsiImmagini.has(dataUrl)) {
        wrap.title = percorsiImmagini.get(dataUrl);
        conMenuFile(img, () => ({
          percorso: percorsiImmagini.get(dataUrl),
          togli: () => { pendingImages = pendingImages.filter((d) => d !== dataUrl); percorsiImmagini.delete(dataUrl); renderImagePreviews(); },
          suRinominato: (r) => { if (r && r.a) percorsiImmagini.set(dataUrl, r.a); renderImagePreviews(); },
        }));
      }
      imgPreviewsEl.appendChild(wrap);
    });
    for (const f of pendingFiles) {
      const chip = document.createElement('div');
      chip.className = 'dash-file-chip';
      chip.tabIndex = 0;
      chip.title = f.percorso;
      const nome = document.createElement('span');
      nome.className = 'dash-file-chip-nome';
      nome.textContent = f.nome;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'dash-img-remove dash-file-chip-togli';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Togli il file');
      rm.title = 'Togli';
      const togli = () => { pendingFiles = pendingFiles.filter((x) => x !== f); renderImagePreviews(); };
      rm.addEventListener('click', togli);
      conMenuFile(chip, () => ({
        percorso: f.percorso,
        togli,
        suRinominato: (r) => { if (r && r.a) { f.percorso = r.a; f.nome = r.nome || nomeDaPercorso(r.a); } renderImagePreviews(); },
      }));
      chip.append(nome, rm);
      imgPreviewsEl.appendChild(chip);
    }
  }
  function addPendingImage(dataUrl, percorso) {
    pendingImages.push(dataUrl);
    if (percorso) percorsiImmagini.set(dataUrl, percorso);
    renderImagePreviews();
  }
  function addPendingFile(percorso) {
    if (!percorso || pendingFiles.some((f) => f.percorso === percorso)) return;
    pendingFiles.push({ percorso, nome: nomeDaPercorso(percorso) });
    renderImagePreviews();
  }
  function clearImagePreviews() {
    pendingImages = [];
    pendingFiles = [];
    percorsiImmagini.clear();
    renderImagePreviews();
  }
  function handleImageFile(file, percorso = '') {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 4 * 1024 * 1024) { if (percorso) addPendingFile(percorso); return; }
    const reader = new FileReader();
    reader.onload = () => addPendingImage(reader.result, percorso);
    reader.readAsDataURL(file);
  }
  // Un file dal disco: le immagini si vedono (e il modello le guarda), gli altri entrano col loro percorso.
  function handleDroppedFile(file) {
    if (!file) return;
    const percorso = percorsoDelFile(file);
    if (file.type && file.type.startsWith('image/')) handleImageFile(file, percorso);
    else if (percorso) addPendingFile(percorso);
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
  // Un file diventa un allegato; un testo trascinato (una voce della colonna destra, una frase da
  // un'altra scheda) entra nel campo dove sta il cursore. Il dragover qui sopra dice a Chromium che il
  // trascinamento lo gestisce la pagina, e allora il campo non inserisce più niente da sé.
  inputForm.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      for (const f of files) handleDroppedFile(f);
      return;
    }
    const testo = e.dataTransfer?.getData('text/plain') || '';
    if (!testo) return;
    const prima = inputEl.value.slice(0, inputEl.selectionStart);
    const dopo = inputEl.value.slice(inputEl.selectionEnd);
    const pezzo = `${prima && !/\s$/.test(prima) ? ' ' : ''}${testo}${dopo && !/^\s/.test(dopo) ? ' ' : ''}`;
    inputEl.setRangeText(pezzo, inputEl.selectionStart, inputEl.selectionEnd, 'end');
    inputEl.focus();
    autoGrowInput();
    Comandi.updateInputClass();
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
    if (!text && pendingImages.length === 0 && pendingFiles.length === 0) return;
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
  inputEl.addEventListener('input', () => { Comandi.updateInputClass(); autoGrowInput(); Sistema.scrive(); });

  // Il tasto microfono: si parla, e la richiesta parte come col tasto d'invio (o resta da correggere).
  // La scorciatoia vale in tutta la home, che è la sua chat.
  window.SN_VOCE_CHAT?.collega({
    campo: inputEl, contenitore: inputForm, prima: sendBtn, ambito: document,
    invia: () => (inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event('submit'))),
    occupato: () => sending,
  });

  // ===== Bridge cambio stato live dal background =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.USCITA_FERMATA && msg.frase) {
      const vicino = ultimoTastoDestro && ultimoTastoDestro.isConnected ? ultimoTastoDestro : null;
      notaFermata(String(msg.frase), vicino);
    } else if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.SISTEMA_AGGIORNATO) {
      Sistema.aggiornato(msg.stato);
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
      giroDashboard++;
      spinteDashboard++;
      if (showHomeMessage) {
        homeMessageEl.classList.remove('dash-home-msg-loading');
        homeMessageEl.textContent = msg.message || 'Filo è in ascolto.';
      }
      suggestions = Array.isArray(msg.suggestions) ? msg.suggestions : [];
      renderSuggestions();
      // La home si rifà da sola anche quando arriva un modello (invito, chiave propria): l'intervista
      // che lo aspettava parte qui, non alla prossima scheda.
      Accoglienza.maybeOpenOnboardingLater().catch(() => {});
    } else if (msg?.type === MSG.SETTINGS_UPDATED) {
      applySavedTheme().catch(() => {});
      if (msg.settings) Sistema.applicaImpostazioni(msg.settings);
      if (msg.settings && typeof msg.settings.showHomeMessage === 'boolean') {
        showHomeMessage = msg.settings.showHomeMessage;
        applyHomeMessageVisibility();
      }
      if (msg.settings && msg.settings.terminal) Term.applySettings(msg.settings.terminal);
      // Aggiorna suoneria in live se l'utente la cambia dalle opzioni.
      if (msg.settings && msg.settings.timerRingtone && RINGTONES[msg.settings.timerRingtone]) {
        _timerRingTone = msg.settings.timerRingtone;
      }
    } else if (msg?.type === MSG.REDTEAM_VISIBILITY_CHANGED) {
      setRedteamVisibile(msg.visible);
    } else if (msg?.type === MSG.AUTH_CHANGED) {
      // Login/logout fatto altrove (es. dal menu profilo): aggiorna l'avatar.
      Comandi.setOwner(msg.signedIn && msg.isAdmin);
      // Entrare o uscire come owner apre o chiude il Red Team in pausa (#896).
      refreshRedteamVisibile();
      applyAccountProfile(msg.signedIn ? msg.profile : null);
      // #524 — l'accoglienza aspettava un modello: appena l'accesso lo rende
      // disponibile, Filo si presenta subito invece di rimandare alla prossima
      // scheda nuova.
      if (msg.signedIn) Accoglienza.maybeOpenOnboardingLater();
    } else if (msg?.type === MSG.CREDITS_CHANGED && msg.walletNotice) {
      // Un invito riscattato da fuori (#651): il link aperto da un'altra
      // applicazione, o l'invito che aspettava questa installazione al primo
      // avvio. La spinta arriva a tutte le home: lo racconta chi lo prende.
      inCodaPopup(chiediBenvenuto);
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

  // Il Red Team in pausa (#896) si mostra solo a chi lo vede: lo decide il main. Parte nascosto.
  let redteamVisibile = false;
  function setRedteamVisibile(v) {
    const nuovo = !!v;
    if (nuovo === redteamVisibile) return;
    redteamVisibile = nuovo;
    renderControls();
  }
  async function refreshRedteamVisibile() {
    try {
      const r = await send({ type: MSG.REDTEAM_VISIBILITY, attendi: true });
      setRedteamVisibile(r && r.ok && r.visible);
    } catch (_) { /* resta com'era */ }
  }

  function renderControls() {
    const host = $('dashControls');
    if (!host) return;
    const ICONS = self.SN_ICONS || {};
    const items = [
      // Red-team: apre direttamente la pagina interna (è solo una navigazione,
      // non un menu nativo). Tenuto per primo (più a sinistra) e in rosso (vedi
      // dashboard.css) perché è il canale sicurezza, distinto dai controlli del
      // browser. Spec §2: punto d'accesso in alto a destra nella home.
      redteamVisibile && { command: 'redteam', icon: 'redteam', label: 'Red-team', url: 'filo://redteam/redteam.html' },
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
    for (const it of items.filter(Boolean)) {
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
  async function showInviteWelcome(n) {
    if (!n || !n.text || !window.SN_CONFIRM_UI?.notify) return false;
    const entrato = n.kind === 'entry';
    await window.SN_CONFIRM_UI.notify({
      title: entrato ? 'Benvenuto in Filo' : 'Il tuo invito',
      text: entrato ? `${n.text} Li trovi nella pagina Crediti, insieme ai tuoi inviti da dare.` : n.text,
      okLabel: entrato ? 'Evviva!' : 'Va bene',
    });
    return true;
  }

  // Lo stesso avviso arriva da due strade (la spinta del main e la domanda
  // all'apertura) e a ogni home aperta: lo racconta una scheda sola (#664),
  // la prima che l'utente ha davanti. Una home dietro aspetta di tornare
  // visibile, poi lo chiede al main, che lo dà a una sola.
  function quandoVisibile() {
    if (document.visibilityState !== 'hidden') return Promise.resolve();
    return new Promise((ok) => {
      const guarda = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', guarda);
        ok();
      };
      document.addEventListener('visibilitychange', guarda);
    });
  }
  async function chiediBenvenuto() {
    await quandoVisibile();
    try {
      const r = await send({ type: MSG.WALLET_NOTICE_PENDING, where: 'home', claim: true });
      if (r && r.ok && r.notice) await showInviteWelcome(r.notice);
    } catch (_) {}
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
    const nessunaRisolta = rewards.every((r) => r.status === 'closed');
    box.setAttribute('aria-label', nessunaRisolta ? 'Feedback chiuso' : 'Feedback risolto');
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
    // Una segnalazione archiviata o doppia è chiusa, non risolta (#816).
    const tuttiRisolti = rewards.every((r) => r.status !== 'closed');
    title.textContent = rewards.length > 1
      ? (tuttiRisolti ? 'Grazie! I tuoi feedback sono stati risolti' : 'Grazie! I tuoi feedback sono stati chiusi')
      : (tuttiRisolti ? 'Grazie! Il tuo feedback è stato risolto' : 'Grazie! Il tuo feedback è stato chiuso');
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
        || (r.status === 'closed' ? 'L’abbiamo chiuso senza modifiche.' : 'È stato sistemato: provalo e dicci com’è andata.');
      item.appendChild(expl);

      bodyEl.appendChild(item);
    }

    const footer = document.createElement('div');
    footer.className = 'dash-recap-footer';
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'dash-recap-btn dash-recap-done';
    // Archiviate e doppioni soltanto: il congedo non festeggia.
    doneBtn.textContent = nessunaRisolta ? 'Va bene' : 'Fantastico!';
    doneBtn.addEventListener('click', close);
    footer.append(doneBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);
    doneBtn.focus();
    // Anima i crediti verso il profilo dopo un attimo (il box è già su schermo).
    // Senza una cifra non vola niente: nessun credito è arrivato.
    if (totalCredits > 0) setTimeout(() => flyCreditsToAccount(totalCredits), 250);
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

  // Aperta dal tasto destro sull'avviso di un sito pericoloso (#813.5): la domanda su quel sito parte da sola, il falso
  // allarme apre «Invia feedback» già scritto. Durante l'intervista di benvenuto la domanda resta scritta e la manda l'utente.
  async function richiestaDellAvviso(inAccoglienza) {
    const r = await send({ type: MSG.CASA_RICHIESTA });
    const q = r && r.ok && r.richiesta;
    if (!q || typeof q.testo !== 'string' || !q.testo) return;
    if (q.tipo === 'segnala') {
      const fine = Date.now() + 5000;
      while (!self.SN_FEEDBACK_UI && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 50));
      self.SN_FEEDBACK_UI?.open({ testo: q.testo });
    } else if (q.tipo === 'chiedi') {
      if (!inAccoglienza) { submitMessage(q.testo); return; }
      inputEl.value = q.testo;
      autoGrowInput();
      inputEl.focus();
    }
  }

  (async function init() {
    renderControls();
    refreshRedteamVisibile();
    await applySavedTheme();
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      showHomeMessage = settings?.showHomeMessage !== false;
      Sistema.applicaImpostazioni(settings);
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
    richiestaDellAvviso(!!onbState).catch((e) => console.warn('[Filo] richiesta dall\'avviso', e));
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
    inCodaPopup(chiediBenvenuto);
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
