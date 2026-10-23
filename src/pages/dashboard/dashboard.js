// Dashboard Filo (new tab): chat e turni. Il centro è la coda del filo (#869, dashboard-coda.js e dashboard-cerca.js):
// aprire una scheda o tornare alla home non apre né chiude una chat. Ai lati le carte (#870, dashboard-carte.js).
// Regole: patterns/la-home-e-la-coda-del-filo.md.

(function () {
  'use strict';

  const { MSG } = self.SN_MSG;

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const homeMessageEl = $('homeMessage');
  const threadView = $('threadView');
  const bubblesEl = $('bubbles');
  const accadeEl = $('accade');
  const inputForm = $('inputForm');
  const inputEl = $('input');
  const sendBtn = $('sendBtn');
  const stopBtn = $('stopBtn');
  const GLIFO_INVIO = sendBtn.innerHTML;
  const GLIFO_RIPRENDI = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  // Il messaggio con cui riparte un turno fermato: non è voce dell'utente, e il main lo sa (`internal`).
  const RIPRENDI = '[L\'utente ti ha chiesto di riprendere il lavoro da dove ti eri fermato.]';
  const DOPO_OK = '[L\'utente ha dato l\'OK qui sopra: riprendi la sua richiesta da lì e rispondigli.]';
  // Dopo un turno finito senza risposta (#557) i passi fatti bastano spesso già: rifarli rimetterebbe Filo nello stesso giro.
  const CONTINUA = '[L\'utente ti ha chiesto di continuare il lavoro che si era fermato senza una risposta. Gli esiti dei passi già fatti '
    + 'sono qui sopra: non rifarli, fai solo quelli che mancano e arriva alla risposta.]';
  // Una risposta fermata dal tetto di lunghezza (#1097.3) riprende dalla parola dove si è interrotta.
  const CONTINUA_RISPOSTA = '[L\'utente ti ha chiesto di continuare la tua ultima risposta, che si è interrotta perché era più lunga del '
    + 'tetto. Riprendi esattamente da dove si è fermata, senza ripetere quello che hai già scritto.]';
  const dashDir = $('dashDir');

  // Stato locale
  let suggestions = [];
  let threadHistory = []; // [{role: 'user'|'filo', text, actions?}]
  // #525 — la targa della chat in corso. Viaggia con ogni messaggio: è il main
  // a scrivere la conversazione su disco, turno per turno, così una chat
  // sopravvive anche se questa scheda muore a metà. Torna null quando la chat
  // si chiude (ritorno alla home, chat nuova), e il messaggio dopo ne apre una.
  let chatId = null;
  let sending = false;
  // L'utente ha scritto in questa scheda: da qui in poi c'è una conversazione da non interrompere (l'accoglienza aspetta).
  let scrittoQui = false;
  // Il turno che sta lavorando adesso (#578): il quadrato lo ferma. `ripresa`: l'ultimo turno è stato fermato e il
  // tasto d'invio offre di riprenderlo finché l'utente non scrive altro. `tasto`: il «Continua» nella bolla di un
  // turno finito senza risposta (#557), che se ne va quando l'offerta finisce.
  let turnoVivo = null;
  let ripresa = null;
  const chiudiRipresa = () => {
    if (ripresa && ripresa.tasto) {
      const riga = ripresa.tasto.parentElement;
      ripresa.tasto.remove();
      if (riga && !riga.childElementCount) riga.remove();
    }
    ripresa = null;
  };
  // I turni fermati la cui azione in volo non è ancora tornata dal main, per conversazione: il turno dopo della stessa
  // conversazione aspetta l'esito, così non rifà l'azione (#578); un'altra conversazione non c'entra (#1296).
  const chiusure = new Map();
  const chiusuraDi = (chat) => (chat ? chiusure.get(chat) || null : null);
  // I seguiti scritti mentre Filo lavora (#1296), in ordine: { id, c: la composizione, bolla, turno }. `turno`: affidato
  // al turno in corso, che lo legge al suo passo dopo; gli altri partono a turno finito.
  const seguiti = [];
  // Chi ferma lo fa di fretta e insiste (doppio clic, Invio ripetuto): per un attimo il secondo colpo trova ancora il
  // quadrato spento, non «riprendi».
  const PAUSA_RIPRESA = 700;
  let fermatoAlle = 0;
  const appenaFermato = () => Date.now() - fermatoAlle < PAUSA_RIPRESA;
  // Lo stesso al contrario (#1296): il quadrato compare sotto il dito che ha appena mandato o ripreso, e il secondo
  // clic di un doppio clic, o il secondo Invio, non ferma quello che è appena partito. Il «Ferma» del menu vale subito.
  // L'istante della comparsa sta sul tasto (`data-comparso`): lì lo leggono le prove, e il CSS lo accende in quel tempo.
  const PAUSA_QUADRATO = 500;
  const quadratoAppena = () => Date.now() - Number(stopBtn.dataset.comparso || 0) < PAUSA_QUADRATO;
  stopBtn.style.setProperty('--dash-pausa-quadrato', `${PAUSA_QUADRATO}ms`);
  let liveTickHandle = null;
  let pendingImages = []; // dataUrl delle immagini incollate (multiple)
  // #950 — file trascinati dal disco: { percorso, nome }. Il percorso parte col messaggio, come se l'utente
  // l'avesse incollato; le immagini arrivate dal disco ricordano il loro.
  let pendingFiles = [];
  // Nel campo è entrato testo incollato o trascinato: il main lo tratta come testo di altri (#592.2).
  let testoDaFuori = false;
  // Il testo del Ctrl+V nativo: l'evento `input` che segue non lo porta con sé (#968).
  let testoIncollato = null;
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
    iconaDelSito: (url) => iconaDelSito(url),
    applyCommandCwd: (actions) => Term.applyCommandCwd(actions),
    // Le parole dell'utente in questa chat viaggiano con l'OK: un codice scritto da lui può uscire (#810).
    paroleUtente: () => paroleUtente(),
    apriProposta: (url, vicino) => apriProposta(url, vicino),
    sceltaAutonomia: (a) => Accoglienza.sceltaAutonomia(a._output && a._output.livello),
    sceltaContatori: (a) => Accoglienza.sceltaContatori(!(a._output && a._output.attivi === false)),
    // #947 — «Metti nel messaggio» dal tasto destro di un file trovato: la stessa cosa del trascinarlo nel campo.
    allegaFile: (percorso) => { addPendingFile(percorso); inputEl.focus(); },
    archiviaAzione: (type, cambi, a) => {
      const id = chatDellaRiga();
      const ids = Array.isArray(cambi) ? cambi : [];
      // Di una finestra guardata resta il nome e basta (#778).
      const guardata = type === 'VEDI_SCHERMO' && a && a._output && typeof a._output.finestra === 'string' ? a._output.finestra : '';
      if (id) {
        try {
          send({ type: MSG.FILO_CHAT_NOTE, id, text: '', role: 'filo', actions: [type], ...(ids.length ? { cambi: ids } : {}), ...(guardata ? { guardate: [guardata] } : {}) })
            .then(() => Coda.allinea()).catch(() => {});
        } catch (_) {}
      }
    },
    // #778 — dopo l'OK a guardare una finestra la richiesta riprende da sola: un turno interno, come «Riprendi».
    prosegui: () => {
      if (sending) return;
      sending = true;
      aggiornaTasto();
      threadHistory.push({ role: 'user', text: DOPO_OK, interno: true });
      runTurnAndContinue({ userMessage: DOPO_OK, internal: true }).catch(() => {});
    },
  });
  // #867 — il segno sulla bolla dell'utente per i cambi di stato che il suo messaggio ha chiesto.
  const Cambi = self.SN_DASH_CAMBI;
  Cambi.init({ send });
  // Le conversazioni delle altre app, righe ripiegate del filo a schermo (#974).
  const Righe = self.SN_DASH_RIGHE;
  Righe.init({
    // Le righe stanno sempre nel filo al centro (#869).
    send, bubblesEl, homeEl: $('righeApp'), inThread: () => true, chatId: () => chatId,
  });
  // La coda del filo al centro (#869) e il campo per cercarci dentro.
  const Coda = self.SN_DASH_CODA;
  const lasciateConRighe = new Set();
  Coda.init({
    send,
    bubblesEl,
    rendiMessaggi: (lista, dove) => rendiMessaggi(lista, dove),
    setBubbleText: (el, t) => setBubbleText(el, t, true),
    righe: Righe,
    chatId: () => chatId,
    chatLasciata: (c) => lasciateConRighe.has(c),
    occupata: () => sending || Accoglienza.isActive(),
    conversa: () => body.dataset.state === 'thread',
  });
  const Cerca = self.SN_DASH_CERCA;
  Cerca.init({ send, coda: Coda, input: $('cercaFilo') });
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
    // Una chat che la scheda ha già lasciato: la riga è tardiva, e la bolla già a schermo è la sua (#1295).
    const tardiva = !!chat && chat !== chatId;
    if (tardiva) lasciateConRighe.add(chat);
    try {
      send({ type: MSG.FILO_CHAT_NOTE, id, text, role, ...(esterno ? { esterno } : {}), ...(tardiva ? { tardiva: true } : {}) })
        .then(() => Coda.allinea()).catch(() => {});
    } catch (_) {}
    return id;
  };
  const chatDellaRiga = () => (Accoglienza.isActive() ? null : ensureChatId());
  // Una riga di una conversazione che qui non è più a schermo si archivia e
  // basta: mostrarla riporterebbe l'utente dentro una chat che aveva chiuso.
  const inChatAperta = (chat) => !chat || chat === chatId;

  Sistema.init({ send, MSG, host: $('sistema'), ICONS: self.SN_ICONS, bozza: () => !!($('input')?.value || '').trim() });
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
    goHome: (o) => goHome(o),
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
    makeBubble: (o) => makeBubble(o),
    stepTrace: (text) => Att.stepTrace(text),
    // L'accoglienza ha ridisegnato il centro: finita, il filo si rilegge e lei ne è il primo tratto (#869).
    goHome: () => goHome({ ricarica: true }),
    goThread: () => goThread(),
    resetHistory: (onbState) => {
      threadHistory = [];
      chiudiRipresa();
      aggiornaTasto();
      // #525 — l'intervista è UNA conversazione: la sua targa la dà lo stato
      // dell'intervista, non il sorteggio di questo caricamento di pagina.
      if (onbState) chatId = chatIdOnboarding(onbState);
    },
    pushHistory: (m) => { threadHistory.push(m); },
    // Un turno dell'intervista fermato altrove (un'altra scheda, prima di ricaricare): come qui, la riga e «riprendi».
    segnaFermato: () => {
      threadHistory.push({ role: 'filo', text: '', actions: [], interrotto: true, fermato: true });
      const nota = document.createElement('div');
      nota.className = 'dash-bubble-note dash-bubble-fermato';
      nota.textContent = 'Fermato prima della risposta.';
      bubblesEl.appendChild(nota);
      ripresa = { nota, blocco: null };
      aggiornaTasto();
    },
    isSending: () => sending || chiusure.size > 0,
    // La conversazione dell'intervista è già quella a schermo: stessi messaggi, nello stesso ordine.
    giaAschermo: (state) => {
      const riga = (m) => `${m.role === 'filo' ? 'filo' : 'user'}\n${String(m.text || '').trim()}`;
      const loro = (Array.isArray(state && state.thread) ? state.thread : []).map(riga);
      const nostri = threadHistory.filter((m) => !m.interno && (m.role !== 'filo' || String(m.text || '').trim())).map(riga);
      // Un annuncio più vecchio di quello che è a schermo (l'intervista salvata a metà turno, consegnato dopo la
      // risposta) è già superato: ridisegnare butterebbe via le righe e i bottoni delle azioni (#592.2).
      // Un'intervista rifatta da capo ha un'altra targa: si ridisegna anche se comincia uguale, così la scheda rimasta
      // aperta su quella di prima si lega alla nuova e le sue risposte contano (#1297).
      if (chatIdOnboarding(state) !== chatId) return false;
      return loro.length <= nostri.length && loro.every((x, i) => x === nostri[i]);
    },
    beginSending: () => { sending = true; aggiornaTasto(); },
    runTurnAndContinue: (args) => runTurnAndContinue(args),
    // Niente da interrompere: in questa scheda l'utente non ha scritto e non ha davanti una conversazione (riaperta,
    // o continuata da un'altra scheda), che l'intervista cancellerebbe dallo schermo (#1297).
    nienteInCorso: () => !scrittoQui && !sending && body.dataset.state !== 'thread'
      && threadHistory.every((m) => m.spontaneo),
    // La scheda ha davanti una conversazione aperta: «Riprendiamola» non la sostituisce con l'intervista (#1297). La
    // home no: è il filo, che si rilegge intero quando l'intervista finisce.
    chatInCorso: () => sending || body.dataset.state === 'thread',
    // Filo può rispondere: la frase su perché non poteva se ne va, e coi suggerimenti la carta dei Crediti (#869: senza
    // modello chiamato, la home li rilegge e basta).
    allApertura: () => { mostraSenzaModello(''); loadDashboard().catch(() => {}); },
    // Solo le bolle: nel filo ci sono anche i segni dei giorni e le righe delle azioni (#869).
    soloRisposteSenzaCrediti: () => {
      const bolle = [...bubblesEl.querySelectorAll('.dash-bubble')];
      return bolle.some((b) => b.dataset.senzaCrediti === '1')
        && bolle.every((b) => b.dataset.senzaCrediti === '1' || b.classList.contains('dash-bubble-user'));
    },
    setSuggestions: (list) => { suggestions = list; renderSuggestions(); },
    loadDashboard: () => loadDashboard(),
    // Una bozza o un allegato in sospeso sono dell'utente: un clic su una scelta non li manda via con sé.
    rispondi: (testo) => {
      if (sending || inputEl.value.trim() || pendingImages.length || pendingFiles.length) return false;
      submitMessage(testo);
      return true;
    },
  });
  Carte.init({
    send,
    accadeEl,
    tieniEl: $('tieni'),
    altroEl: $('altro'),
    refreshLive: () => refreshLive(),
    onSuggestionClick: (s, vicino) => onSuggestionClick(s, vicino),
    aggiornaSuggerimenti: () => loadDashboard({ force: true }).catch(() => {}),
    iconaDelSito: (url, opz) => iconaDelSito(url, opz),
    apriNelFilo: (o) => apriNelFilo(o),
    scriviNelCampo: (t) => scriviNelCampo(t),
    // Il lavoro che si vede già al centro è quello che gira in questa scheda: la stessa conversazione, continuata in una
    // scheda nuova (#869), lì non lo mostra.
    chatCorrente: () => (sending ? chatId : null),
  });
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
  // `fine`: la chiude l'utente apposta, e le schede nuove non la continuano; una scheda che se ne va no.
  function closeCurrentChat({ fine = false } = {}) {
    if (!chatId) return;
    const id = chatId;
    chatId = null;
    try { send({ type: MSG.FILO_CHAT_CLOSE, id, fine: fine || undefined }); } catch (_) {}
  }

  // ===== Stato UI =====
  // Il centro è sempre il filo (#869): «home» vuol dire tornare in fondo, col campo pronto. `ricarica`: la vista è stata
  // ridisegnata da altri (l'accoglienza che finisce) e il filo si rilegge da capo.
  function goHome({ ricarica = false, nuova = false } = {}) {
    if (nuova && !ricarica) {
      closeCurrentChat({ fine: true });
      Term.nuovaChat(false);
      threadHistory = [];
      chiudiRipresa();
      aggiornaTasto();
    }
    if (ricarica) {
      Term.nuovaChat(false);
      chatId = null;
      threadHistory = [];
      bubblesEl.innerHTML = '';
      chiudiRipresa();
      aggiornaTasto();
      caricaFilo().catch((e) => console.warn('[Filo] coda del filo', e));
    } else {
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    }
    body.dataset.state = 'home';
    // Ridisegnata da altri (l'accoglienza che finisce) la vista cambia, la casella no: dentro può esserci un seguito
    // tornato lì perché il turno ha chiuso l'accoglienza (#1296), o quello che l'utente scriveva intanto.
    if (!ricarica) {
      inputEl.value = '';
      autoGrowInput();
    }
    inputEl.focus();
  }

  // I bottoni sotto una risposta che chiudono la conversazione (spunta dell'appunto, «Chiudi la conversazione»): tornare
  // alla home da solo non la chiude più (#869).
  function chiudiConversazione() { goHome({ nuova: true }); }

  // `thread`: in questa scheda c'è una conversazione in corso (un messaggio, l'accoglienza, una chat riaperta); `home`:
  // c'è solo il filo. Il centro è lo stesso.
  function goThread() {
    body.dataset.state = 'thread';
  }

  // La coda del filo all'apertura: la conversazione che una scheda nuova continua la riprende anche lo storico, così il
  // turno dopo è nella stessa chat (#869).
  async function caricaFilo() {
    const corrente = await Coda.carica();
    // Una conversazione presa solo dall'annuncio di Filo (arrivato prima della coda) si adotta lo stesso: lo storico che
    // il turno dopo manda deve avere anche i messaggi di prima.
    const soloAnnunci = chatId === corrente && threadHistory.every((m) => m.spontaneo);
    if (corrente && (!chatId || soloAnnunci) && !Accoglienza.isActive()) await adotta(corrente).catch(() => false);
    return corrente;
  }

  // #525 — riapertura di una chat archiviata (Cronologia, un link con ?chat=<id>, una carta della home): il filo va a
  // quel punto, e si continua a scrivere DENTRO la stessa chat. I bottoni delle azioni non tornano: un'azione in attesa
  // di conferma non si può ri-offrire tre giorni dopo come se fosse di adesso.
  function chatIdFromUrl() {
    try { return new URLSearchParams(self.location.search).get('chat') || null; }
    catch (_) { return null; }
  }

  // #872 — il quaderno delle memorie porta qui, al messaggio da cui una nota è nata (?evento=<id>): il filo ci va e lo
  // illumina, senza riprendere quella conversazione.
  function eventoFromUrl() {
    try { return new URLSearchParams(self.location.search).get('evento') || null; }
    catch (_) { return null; }
  }

  async function vaiAlEvento(id) {
    const r = await send({ type: MSG.FILO_DOVE, id });
    const d = r && r.ok ? r.dove : null;
    if (!d || d.tipo !== 'messaggio') return false;
    const trovato = await Coda.vaiA({ chat: d.chat, i: d.i, app: !!d.app, ts: d.ts });
    if (trovato) goThread();
    return trovato;
  }

  // Le bolle di una serie di messaggi del filo, com'erano: testo, immagini (quelle ancora in memoria), le righe delle
  // azioni e il segno dei cambi. `storia`, se c'è, riceve lo storico che il turno dopo manda al main.
  function rendiMessaggi(messaggi, dove, { storia = null } = {}) {
    let bollaUtente = null;
    for (const m of messaggi) {
      const nodi = [];
      const metti = (n) => { dove.appendChild(n); nodi.push(n); };
      const isUser = m.role === 'user';
      const text = String(m.text || '');
      const types = Array.isArray(m.actions) ? m.actions : [];
      // Finché Filo resta aperto le foto mandate stanno in memoria per il modello (#1166): tornano anche a schermo.
      const fotoViste = isUser && Array.isArray(m.fotoInMemoria) ? m.fotoInMemoria.filter((u) => typeof u === 'string' && /^data:image\//i.test(u)) : [];
      if (text.trim() || fotoViste.length) {
        const b = makeBubble({ role: isUser ? 'user' : 'filo', text, markdown: !isUser });
        if (m.spontaneo) b.dataset.spontaneo = '1';
        fotoViste.forEach((src, i) => {
          const img = document.createElement('img');
          img.src = src;
          img.className = 'dash-bubble-img';
          attachImageLightbox(img, src);
          b.insertBefore(img, b.childNodes[i] || null);
        });
        metti(b);
        if (isUser) bollaUtente = b;
      }
      // I cambi chiesti con quel messaggio ritrovano il loro segno, col loro stato di adesso.
      // In un frammento non ancora a schermo il segno aspetta: il suo stato lo legge solo da una bolla nella pagina.
      if (!isUser && Array.isArray(m.cambi) && m.cambi.length && bollaUtente) {
        const b = bollaUtente;
        const ids = m.cambi;
        if (dove.isConnected) Cambi.segna(b, ids); else queueMicrotask(() => Cambi.segna(b, ids));
      }
      // Le immagini incollate non stanno nell'archivio (sono data URL da centinaia di KB l'una), ma il loro NUMERO sì:
      // senza, chi rilegge trova «cosa vedi in questo grafico?» riferito al nulla.
      const quante = Number(m.images) || 0;
      const perse = Math.max(0, quante - fotoViste.length);
      if (perse > 0) {
        const nota = document.createElement('div');
        nota.className = 'dash-bubble-note';
        nota.dataset.replay = '1';
        const altre = fotoViste.length > 0;
        nota.textContent = perse === 1
          ? (altre ? 'un\'altra immagine, non conservata' : '1 immagine, non conservata')
          : `${perse} ${altre ? 'altre ' : ''}immagini, non conservate`;
        metti(nota);
      }
      if (!isUser && types.length) {
        const note = document.createElement('div');
        note.className = 'dash-bubble-note';
        note.dataset.replay = '1';
        note.textContent = Att.summarizeActivity(types, false);
        metti(note);
      }
      // #778 — di una finestra guardata l'archivio tiene il nome: l'immagine e quello che c'era non si conservano.
      const guardate = !isUser && Array.isArray(m.guardate) ? m.guardate.filter((n) => typeof n === 'string' && n.trim()) : [];
      for (const nome of guardate) {
        const nota = document.createElement('div');
        nota.className = 'dash-bubble-note';
        nota.dataset.replay = '1';
        nota.textContent = `Ho guardato «${nome}»: l'immagine non è conservata`;
        metti(nota);
      }
      if (m.altrove && nodi.length) {
        const nota = document.createElement('div');
        nota.className = `dash-altrove dash-altrove-${isUser ? 'user' : 'filo'}`;
        nota.textContent = 'da un altro dispositivo';
        metti(nota);
      }
      for (const n of nodi) {
        if (m.ts) n.dataset.ts = m.ts;
        if (m.chat) n.dataset.chat = m.chat;
      }
      if (m.key && nodi[0]) nodi[0].dataset.key = m.key;
      if (storia) storia.push(rigaDiStoria(m, { quante, guardate, types }));
    }
  }

  // Cosa veniva da fuori resta con la frase (#810): la porta delle uscite lo rilegge da qui.
  function rigaDiStoria(m, { quante, guardate, types }) {
    const text = String(m.text || '');
    if (m.role === 'user') {
      return { role: 'user', text, ...(quante > 0 ? { images: quante } : {}), ...(m.daModello ? { daModello: true } : {}) };
    }
    return {
      role: 'filo', text,
      ...(Array.isArray(m.letti) && m.letti.length ? { letti: m.letti } : {}),
      ...(Array.isArray(m.linkDaConfermare) && m.linkDaConfermare.length ? { linkDaConfermare: m.linkDaConfermare } : {}),
      ...(typeof m.esterno === 'string' && m.esterno ? { esterno: m.esterno } : {}),
      ...(m.spontaneo ? { spontaneo: true } : {}),
      actions: [...types.filter((t) => !(t === 'VEDI_SCHERMO' && guardate.length)).map((t) => ({ type: t })),
        ...guardate.map((nome) => ({ type: 'VEDI_SCHERMO', _output: { finestra: nome, nonConservata: true } }))],
    };
  }

  // La conversazione che da qui si continua: lo storico per il turno dopo, il terminale com'era. Le bolle le ha già la coda.
  async function adotta(id) {
    const r = await send({ type: MSG.FILO_CHAT_GET, id });
    const chat = r && r.ok && r.chat;
    if (!chat || chat.app || !Array.isArray(chat.messages) || !chat.messages.length) return false;
    chatId = chat.id;
    threadHistory = chat.messages.map((m) => rigaDiStoria(m, {
      quante: Number(m.images) || 0,
      guardate: m.role !== 'user' && Array.isArray(m.guardate) ? m.guardate.filter((n) => typeof n === 'string' && n.trim()) : [],
      types: Array.isArray(m.actions) ? m.actions : [],
    }));
    chiudiRipresa();
    aggiornaTasto();
    Term.nuovaChat(chat.messages.some((m) => (
      (m.role !== 'user' && Array.isArray(m.actions) && m.actions.includes('ESEGUI_COMANDO'))
      || (m.role === 'user' && /^\//.test(String(m.text || '').trim()) && Comandi.classifyInput(String(m.text)) !== 'filo')
    )));
    return true;
  }

  // Una conversazione riaperta: il filo va al suo punto e, se è della home e si vuole riprenderla (`riprendi`), da qui
  // si continua lei.
  async function reopenChat(id, { riprendi = true } = {}) {
    const r = await send({ type: MSG.FILO_CHAT_GET, id });
    const chat = r && r.ok && r.chat;
    if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return false;
    const trovata = await Coda.vaiA({ chat: chat.id, app: !!chat.app, ts: chat.messages[0].ts, i: 0 });
    if (trovata || riprendi) goThread();
    if (chat.app) {
      if (!trovata) await Righe.mostraSola(chat);
      inputEl.focus();
      return true;
    }
    if (!trovata && !riprendi) return false;
    if (riprendi && chatId !== chat.id) {
      if (chatId) closeCurrentChat();
      await adotta(chat.id);
    }
    inputEl.focus();
    return true;
  }

  // ===== «Apri nel filo» (#870) =====
  // Ogni carta è una conversazione: quella che l'ha fatta nascere, se c'è ancora, altrimenti una frase di Filo
  // in coda al filo a schermo (o in una conversazione nuova). La frase entra nello storico: il modello la vede.
  async function apriNelFilo({ chat = null, testo = '', esterno = '' } = {}) {
    if (Accoglienza.isActive()) return 'accoglienza';
    if (sending) return 'risponde';
    if (chat) {
      // Se un'altra scheda la sta vivendo (un turno che lavora lì), si va là; se no il filo va al suo punto, qui (#869).
      const r = await send({ type: MSG.FILO_CHAT_FOCUS, id: chat });
      if (r && r.portato) return true;
      if (chat === chatId) { goHome(); return true; }
      if (await reopenChat(chat, { riprendi: false }).catch(() => false)) return true;
    }
    if (!testo) return false;
    // La stessa carta aperta due volte non ripete la frase: è già l'ultima cosa che Filo ha detto qui.
    const ultimo = threadHistory[threadHistory.length - 1];
    if (ultimo && ultimo.role === 'filo' && ultimo.text === testo) { goHome(); return true; }
    const DA_FUORI = { download: 'dal nome di un file scaricato' };
    archiviaRiga(testo, 'filo', null, esterno);
    threadHistory.push({ role: 'filo', text: testo, actions: [], ...(DA_FUORI[esterno] ? { esterno: DA_FUORI[esterno] } : {}) });
    goThread();
    bubblesEl.appendChild(makeBubble({ role: 'filo', text: testo }));
    Coda.segnaGiorni();
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
  // Quello che l'utente ha scritto in questa chat: un codice scritto da lui può uscire (#810). Il testo di un
  // suggerimento della home no, l'ha scritto un modello.
  function paroleUtente() {
    return threadHistory.filter((m) => m && m.role !== 'filo' && !m.daModello).map((m) => String(m.text || ''));
  }

  // Un indirizzo web che un modello ha proposto qui si apre solo dal main, dopo la porta delle uscite, con
  // l'indirizzo che si apre davvero (#810). Se si ferma, la riga lo dice accanto a ciò che è stato cliccato.
  // Un collegamento che la risposta di Filo segnava da confermare chiede l'OK anche al clic (#868.6), riaperta compresa.
  const formaLink = (u) => { try { return new URL(String(u || '')).href; } catch (_) { return String(u || ''); } };
  function motivoDaConfermare(url) {
    const k = formaLink(url);
    for (const m of threadHistory) {
      for (const x of (m && Array.isArray(m.linkDaConfermare) ? m.linkDaConfermare : [])) {
        if (x && formaLink(x.url) === k) return String(x.motivo || 'da confermare');
      }
    }
    return '';
  }
  async function apriProposta(url, vicino = null, chiedi = '') {
    const proposta = self.SN_MARKDOWN ? self.SN_MARKDOWN.scrittoDaUnModello(vicino) : !!(vicino && vicino.closest && vicino.closest('[data-filo-verdetti]'));
    const msg = { type: MSG.FILO_APRI_PROPOSTA, url, parole: paroleUtente(), chiedi: chiedi || motivoDaConfermare(url), proposta };
    let r = null;
    try { r = await send(msg); } catch (_) {}
    if (r && r.conferma) {
      const Ui = window.SN_CONFIRM_UI;
      const ok = Ui ? await Ui.confirm({ title: 'Filo chiede conferma', text: String(r.conferma), parti: r.parti }) : window.confirm(String(r.conferma));
      if (!ok) return;
      try { r = await send({ ...msg, confermato: true }); } catch (_) { r = null; }
    }
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

  // L'icona di un sito la cerca il main, mai un servizio di terzi (#848). Si ricorda solo quella trovata:
  // un sito che non ha risposto si richiede al giro dopo, e lì decide il main quando riprovare.
  // `soloCopie`: l'indirizzo al clic chiede l'OK, quindi l'icona non contatta il sito prima (#848).
  const iconeSiti = new Map();
  function iconaDelSito(rawUrl, { soloCopie = false } = {}) {
    let host = '';
    try {
      const u = new URL(String(rawUrl || ''));
      if (u.protocol === 'http:' || u.protocol === 'https:') host = u.host.toLowerCase();
    } catch (_) {}
    if (!host) return Promise.resolve('');
    const chiave = `${soloCopie ? 'c' : 'r'}|${host}`;
    if (!iconeSiti.has(chiave)) {
      const dimentica = () => { iconeSiti.delete(chiave); return ''; };
      iconeSiti.set(chiave, send({ type: MSG.ICONA_SITO, url: String(rawUrl), soloCopie }).then((r) => {
        const dato = r && r.ok && typeof r.dato === 'string' && /^data:image\//.test(r.dato) ? r.dato : '';
        return dato || dimentica();
      }, dimentica));
    }
    return iconeSiti.get(chiave);
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
      // §6 — suggerimento di pulizia dalla home: stessa regola e stesso popup della chat (#530). L'esito si legge
      // sul suggerimento stesso: un riordino mai partito non deve somigliare a uno in cui non c'era niente da chiudere.
      const testo = vicino && vicino.querySelector('.dash-carta-voce-testo');
      const prima = testo ? testo.textContent : '';
      if (vicino) vicino.disabled = true;
      if (testo) testo.textContent = 'Riordino in corso…';
      const e = await Att.riordinaSchede();
      if (e.annullato) {
        if (testo) testo.textContent = prima;
        if (vicino) vicino.disabled = false;
        return;
      }
      if (testo) testo.textContent = `${e.ok ? '✓' : '✗'} ${e.testo}`;
      if (!e.ok && vicino) { vicino.disabled = false; vicino.title = `${e.motivo} Puoi riprovare.`; }
      return;
    }
    // Il suggerimento l'ha scritto un modello (#810): un indirizzo passa dalla porta delle uscite, e il suo testo va
    // in chat come suo, non come parole dell'utente né come comando con la barra.
    // Una pagina di Filo non è un'uscita: la porta delle uscite la rifiuterebbe e il clic non farebbe niente.
    if (type === 'NAVIGA' && /^filo:\/\//i.test(String(a.url || ''))) {
      send({ type: MSG.OPEN_URL, url: a.url });
    } else if (type === 'NAVIGA' && a.url) {
      apriProposta(a.url, vicino, s.chiedeOk || '');
    } else if (type === 'APRI_FILE' && (a.path || a.url)) {
      const url = a.url || a.path;
      if (/^https?:/.test(url)) apriProposta(url, vicino, s.chiedeOk || '');
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

    // Il conto alla rovescia si ridisegna ogni secondo solo finché c'è qualcosa che scorre o suona.
    const hasActiveTimer = timers.some((t) => !t.paused || t.ringing);
    if (hasActiveTimer && !liveTickHandle) {
      liveTickHandle = setInterval(refreshLive, 1000);
    } else if (!hasActiveTimer && liveTickHandle) {
      clearInterval(liveTickHandle);
      liveTickHandle = null;
    }
  }

  // ===== Suggerimenti, e la frase quando Filo non ha un modello =====
  // Aprendosi la home non chiama il modello (#869): i suggerimenti sono quelli dell'ultima volta che Filo ha scritto.
  // Senza un modello servibile la frase che dice perché, con la strada ai Crediti, sta in fondo al filo.
  function mostraSenzaModello(testo) {
    homeMessageEl.textContent = testo || '';
    homeMessageEl.hidden = !testo;
  }

  // Un ricalcolo spinto dal main mentre la richiesta è in volo è più nuovo della sua risposta, e uno arrivato
  // prima vale quanto la cache che la risposta servirebbe: i suggerimenti che ha portato restano («Aggiorna» no).
  let giroDashboard = 0;
  let spinteDashboard = 0;
  async function loadDashboard({ force = false } = {}) {
    const giro = ++giroDashboard;
    renderSuggestions({ pronti: false });
    const r = await send({ type: MSG.FILO_GENERATE_DASHBOARD, force });
    if (giro !== giroDashboard) return;
    mostraSenzaModello(r?.ok && r.senzaChiave ? r.message : '');
    if (!force && spinteDashboard) { renderSuggestions(); return; }
    suggestions = (r?.ok && Array.isArray(r.suggestions)) ? r.suggestions : [];
    renderSuggestions();
  }

  // Come loadDashboard, ma la home è già a schermo: niente passaggio dal vuoto, cambia solo se il main ha di meglio.
  async function aggiornaDashboardInSilenzio() {
    const giro = giroDashboard;
    const r = await send({ type: MSG.FILO_GENERATE_DASHBOARD });
    if (giro !== giroDashboard || !r?.ok) return;
    mostraSenzaModello(r.senzaChiave ? r.message : '');
    const nuovi = Array.isArray(r.suggestions) ? r.suggestions : [];
    if (JSON.stringify(nuovi) === JSON.stringify(suggestions)) return;
    suggestions = nuovi;
    renderSuggestions();
  }

  // È cambiato se Filo ha un modello da chiamare: prima l'accoglienza, che è ciò che l'utente aspetta al primo avvio;
  // se resta chiusa si rifà almeno la frase in fondo, che altrimenti continua a spiegare un silenzio finito (#663).
  async function risvegliaHome() {
    await Accoglienza.maybeOpenOnboardingLater();
    if (Accoglienza.isActive()) return;
    await loadDashboard();
  }

  // ===== Bolle conversazione =====
  function makeBubble({ role, text, pending = false, markdown = false }) {
    const div = document.createElement('div');
    div.className = `dash-bubble dash-bubble-${role === 'user' ? 'user' : 'filo'}`;
    // I collegamenti di una frase di Filo hanno il verdetto della porta: senza, il clic e il tasto destro chiedono l'OK (#1505).
    if (role !== 'user') div.dataset.filoVerdetti = '1';
    if (pending) div.classList.add('dash-bubble-pending');
    // L'ora la usa chi mette al loro posto nel tempo le righe delle altre app (dashboard-righe.js).
    div.dataset.ts = new Date().toISOString();
    // #162 — testo vuoto (Filo ha solo eseguito un'azione, es. aperto un link):
    // niente nodo di testo, la bolla conterrà solo i chip d'azione. Marchiamo
    // la bolla così il CSS può stringere i margini quando è "solo azioni".
    if (text) setBubbleText(div, text, markdown);
    else div.classList.add('dash-bubble-actions-only');
    return div;
  }

  // #418 — per le risposte di Filo la formattazione leggera condivisa, per il resto testo
  // letterale. I link sono già filtrati da SN_MARKDOWN: nessuno punta alle pagine interne.
  function setBubbleText(el, text, markdown) {
    if (markdown && text && self.SN_MARKDOWN) {
      el.innerHTML = self.SN_MARKDOWN.render(text);
      el.classList.add('dash-bubble-md');
      // La riga «interrotta» la scrive il main dentro la risposta: si legge come nota, non come parole del modello.
      const ultimo = el.lastElementChild;
      if (ultimo && self.SN_CHAT_ERRORS?.eFraseInterrotta?.(ultimo.textContent)) ultimo.classList.add('dash-bubble-interrotta');
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
    LEGGI_PAGINA: 'Leggo una pagina…',
    VEDI_SCHERMO: 'Guardo lo schermo…',
    CERCA_DOCUMENTI: 'Cerco fra i tuoi documenti…',
    CERCA_SALVATE: 'Cerco fra le pagine salvate…',
    APRI_SALVATA: 'Apro la pagina salvata…',
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
    INSTALLA_AGGIORNAMENTO: 'Cerco la versione nuova…',
    RIMEDIO_CREDITI: 'Guardo i crediti…',
  };
  function startLabelFor(type) {
    return START_LABELS[String(type || '').toUpperCase()] || 'Eseguo un\'azione…';
  }
  // Un'azione che lavora su più cose dice quante ne ha fatte: «3 di 40» al posto di un'attesa al buio, e quale.
  const PROGRESS_LABELS = { CERCA_DOCUMENTI: 'Leggo i documenti nuovi…' };
  function progressLabelFor(type, fatti, totali, dettaglio) {
    const base = PROGRESS_LABELS[String(type || '').toUpperCase()] || startLabelFor(type);
    const n = Number(totali);
    const conto = n > 1 ? `${base} ${Math.min(Number(fatti) || 0, n)} di ${n}` : base;
    const quale = String(dettaglio || '').trim();
    return quale ? `${conto} · ${quale.length > 60 ? `${quale.slice(0, 59)}…` : quale}` : conto;
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
  // La chat di adesso è stata nascosta o cancellata (da qui, a parole o altrove): la scheda non se ne porta dietro niente,
  // né la targa né la memoria dei messaggi, che al turno dopo tornerebbero al modello e nel registro delle richieste (#1295).
  function lasciaLaChat() {
    chatId = null;
    threadHistory = [];
  }

  function historyWithout(userMessage) {
    const h = threadHistory.slice();
    const last = h[h.length - 1];
    if (last && last.role === 'user' && last.text === userMessage) h.pop();
    return h;
  }

  async function runFiloTurn({ userMessage, images = [], internal = false, daModello = false, daFuori = false, activity = null }) {
    // Blocco di attività della domanda (#521): lo crea e lo chiude chi guida
    // la sequenza dei turni (runTurnAndContinue); qui ci si scrive dentro.
    const pending = activity || Att.create(bubblesEl);
    const ownsActivity = !activity;
    // Reasoning VERO in diretta: sottoscrizione filtrata per reqId che il main usa per pushare i
    // thought summary. Se il modello non ragiona non arriva nulla.
    const reasoningReqId = `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const turno = { reqId: reasoningReqId, fermato: false, attivita: pending };
    turno.fermata = new Promise((ok) => { turno.ferma = ok; });
    turnoVivo = turno;
    aggiornaTasto();
    let offReasoning = null;
    if (window.filo?.onReasoning) {
      offReasoning = window.filo.onReasoning((data) => {
        if (data && data.reqId === reasoningReqId && data.text) pending.pushReasoning(data.text);
      });
    }
    // #420 — la bolla si riempie mentre il modello scrive e NON nasce prima del primo carattere:
    // una risposta di sola azione non lascia una bolla vuota. Il ragionamento si richiude da sé.
    let streamBubble = null;
    let streamedText = '';
    // La risposta scritta nei giri di soli bottoni (#1167) resta in testa alla bolla: i giri dopo scrivono sotto.
    let rispostaPrima = '';
    let giroIniziato = false;
    const unisci = (...parti) => parti.map((t) => String(t || '').trim()).filter(Boolean).join('\n\n');
    const testoDelGiro = () => (globalThis.SN_CALC
      ? globalThis.SN_CALC.resolveCalcMarkers(streamedText, { streaming: true })
      : streamedText);
    const bollaDellaRisposta = () => {
      if (!streamBubble) {
        streamBubble = document.createElement('div');
        streamBubble.className = 'dash-bubble dash-bubble-filo dash-bubble-streaming';
        streamBubble.dataset.filoVerdetti = '1';
        bubblesEl.appendChild(streamBubble);
      }
      return streamBubble;
    };
    const followBottomIfNear = () => {
      const nearBottom = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 48;
      if (nearBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    };
    let offAnswer = null;
    if (window.filo?.onAnswer) {
      offAnswer = window.filo.onAnswer((data) => {
        if (!data || data.reqId !== reasoningReqId) return;
        if (data.reset) {
          // Fallback provider a metà: butta ciò che il giro aveva già messo a schermo, non accodare.
          streamedText = '';
          if (streamBubble) streamBubble.textContent = rispostaPrima;
          return;
        }
        if (!data.delta || turno.fermato) return;
        if (!giroIniziato) {
          giroIniziato = true;
          pending.answerStarted(); // il ragionamento si richiude, la risposta comincia
        }
        streamedText += data.delta;
        // Il marker del conto si vede già come numero mentre scorre: la
        // risposta finale lo avrà risolto nel main, e le due non devono differire.
        bollaDellaRisposta().textContent = rispostaPrima ? `${rispostaPrima}\n\n${testoDelGiro()}` : testoDelGiro();
        followBottomIfNear();
      });
    }
    // Azioni in diretta: il modello ne nomina una → la riga in testa lo dice; il main la esegue
    // → la riga vera con l'esito. Gli id già raccontati qui non si ripetono a fine turno.
    const shown = new Set();
    // Il testo di un giro di soli bottoni resta nella bolla; quello degli altri giri va nel blocco.
    const chiudiGiro = (data) => {
      if (data.risposta) {
        rispostaPrima = unisci(rispostaPrima, data.text || testoDelGiro());
        bollaDellaRisposta().textContent = rispostaPrima;
      } else if (streamBubble && rispostaPrima) {
        pending.aggiungiNota(testoDelGiro());
        streamBubble.textContent = rispostaPrima;
      } else if (streamBubble) {
        if (!streamBubble.querySelector('.dash-bubble-actions')) pending.absorbBubble(streamBubble);
        streamBubble = null;
      }
    };
    // La risposta del main può arrivare prima degli ultimi eventi in diretta (viaggiano su code diverse): la diretta si
    // chiude sul segno di fine, che il main manda dietro all'ultimo evento (#1321).
    let fineDellaDiretta = () => {};
    const direttaFinita = new Promise((ok) => { fineDellaDiretta = ok; });
    let offAction = null;
    if (window.filo?.onAction) {
      offAction = window.filo.onAction((data) => {
        if (!data || data.reqId !== reasoningReqId) return;
        if (data.kind === 'fine') {
          fineDellaDiretta();
        } else if (data.kind === 'start') {
          pending.working(startLabelFor(data.type), String(data.callId || ''));
        } else if (data.kind === 'progress') {
          pending.working(progressLabelFor(data.type, data.fatti, data.totali, data.dettaglio));
        } else if (data.kind === 'done') {
          const a = data.action;
          if (a && Array.isArray(a._cambi)) Cambi.segna(pending.el, a._cambi);
          if (a && data.kept !== false) {
            if (Att.tellActionInActivity(pending, a) && a._callId) shown.add(a._callId);
          } else if (a) {
            // Scartata dal registro: non è successa, ma il nodo che l'aspettava lo deve sapere.
            pending.azioneSenzaRiga(a, { scartata: true });
          }
        } else if (data.kind === 'round') {
          // Dopo lo stop la bolla è di apriTurnoFermato: il testo a metà resta dov'è.
          if (!turno.fermato) chiudiGiro(data);
          streamedText = '';
          giroIniziato = false;
          pending.fineGiro();
        } else if (data.kind === 'seguito') {
          seguitoLetto(String(data.id || ''));
        }
      });
    }
    // Un turno fermato può avere ancora un'azione in volo: il seguito della stessa conversazione parte quando è finita,
    // così ne conosce l'esito. Una conversazione nuova, o un'altra riaperta, non aspetta.
    while (chiusuraDi(chatId) && !turno.fermato) await Promise.race([chiusuraDi(chatId), turno.fermata]);
    const msg = {
      type: MSG.FILO_CHAT,
      userMessage,
      // Tutta la conversazione TRANNE il messaggio che parte adesso, non «l'ultima voce e basta»:
      // dopo un turno interrotto in fondo c'è quello che Filo aveva già fatto, e buttarlo si paga.
      threadHistory: historyWithout(userMessage),
      reasoningReqId,
      internal,
      ...(daModello ? { daModello: true } : {}),
      ...(daFuori ? { daFuori: true } : {}),
      // #525 — la chat si archivia nel main, mentre la si fa.
      chatId: ensureChatId(),
    };
    if (images.length) {
      msg.image = images[0]; // retrocompatibilità (provider mono-immagine)
      msg.images = images;
    }
    const inviato = turno.fermato
      ? Promise.resolve({ ok: true, stopped: true, actions: [] })
      : send(msg).then((r) => (r && r.diretta && offAction ? direttaFinita.then(() => r) : r));
    if (!turno.fermato) for (const s of seguiti) if (s.turno !== turno) affidaAlTurno(s, turno);
    const fineDiretta = (r) => {
      if (turnoVivo === turno) turnoVivo = null;
      // Il main dice quali seguiti ha letto anche a fine turno: vale se l'annuncio in diretta non è arrivato.
      for (const id of (Array.isArray(r?.seguitiLetti) ? r.seguitiLetti : [])) seguitoLetto(String(id));
      pending.fineDiretta();
      // Anche quelle arrivate senza evento in diretta (o con un guasto dopo): il segno non dipende dalla diretta.
      for (const a of (Array.isArray(r?.actions) ? r.actions : [])) {
        if (a && Array.isArray(a._cambi)) Cambi.segna(pending.el, a._cambi);
      }
      if (offReasoning) { try { offReasoning(); } catch (_) {} }
      if (offAnswer) { try { offAnswer(); } catch (_) {} }
      if (offAction) { try { offAction(); } catch (_) {} }
    };
    // Fermato: la chat torna dell'utente adesso, non quando l'azione in volo finisce. Il main la lascia finire e il
    // suo esito arriva nel blocco, che si chiude allora (patterns/il-filo-dell-attesa.md).
    const r = await Promise.race([inviato, turno.fermata]);
    if (turno.fermato) {
      const chiusa = apriTurnoFermato({ pending, streamBubble, streamedText: unisci(rispostaPrima, streamedText) });
      turno.voce = chiusa.entry;
      const chiusura = inviato.then((rr) => { fineDiretta(rr); chiudiTurnoFermato(rr, chiusa, { pending, shown }); });
      return { ok: true, stopped: true, actions: [], _notaFermato: chiusa.nota, _chiusura: chiusura, _chat: msg.chatId };
    }
    fineDiretta(r);
    if (!r?.ok) {
      // Il ragionamento già arrivato resta leggibile anche sotto un errore:
      // aiuta a capire cosa stava tentando. Senza niente dentro, il blocco sparisce.
      // La parte di risposta scritta coi bottoni era arrivata (#1167): resta nella bolla coi suoi bottoni, e l'errore
      // dice sotto che il lavoro dopo non è riuscito. Il testo a metà del giro fallito invece se ne va.
      if (rispostaPrima && streamBubble) {
        streamBubble.classList.remove('dash-bubble-streaming');
        setBubbleText(streamBubble, rispostaPrima, true);
        Att.renderActions(streamBubble, Array.isArray(r?.actions) ? r.actions : [], { onAck: chiudiConversazione, activity: pending, shown });
        streamBubble = null;
      }
      pending.endTurn();
      if (ownsActivity) pending.finish();
      // Le azioni fatte PRIMA del guasto sono successe davvero: restano nello
      // storico, così un «Riprova» riparte sapendo che quel timer c'è già
      // invece di avviarne un secondo.
      if (rispostaPrima || (Array.isArray(r?.actions) && r.actions.length)) {
        threadHistory.push({ role: 'filo', text: rispostaPrima, actions: Array.isArray(r?.actions) ? r.actions : [], interrotto: true });
      }
      // Un turno fallito non lascia a schermo il testo parziale del tentativo.
      if (streamBubble) { streamBubble.remove(); streamBubble = null; }
      // Chi non ha crediti scrive alla chat l'invito che ha ricevuto: lo riscatta lei, invece di mandarlo a ricopiarlo (#664).
      const invito = r?.code === 'NO_API_KEY' && !internal && !daModello ? await riscattaDallaChat(userMessage) : null;
      if (invito && invito.ok) {
        bubblesEl.appendChild(makeBubble({ role: 'filo', text: invito.message }));
        bubblesEl.scrollTop = bubblesEl.scrollHeight;
        return r;
      }
      const err = makeBubble({ role: 'filo', text: (invito && invito.message) || r?.error || 'Errore.' });
      // #360 — la bolla d'errore dice "riprova": darglielo da fare a mano
      // (riscrivere la domanda) è attrito inutile. Il tasto rimanda LO STESSO
      // messaggio, come il "Riprova" della pagina d'errore di una scheda.
      const row = document.createElement('div');
      row.className = 'dash-bubble-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'dash-action-btn';
      retry.textContent = '↻ Riprova';
      retry.title = 'Rimanda lo stesso messaggio';
      retry.addEventListener('click', () => retryTurn(err, { userMessage, images, internal }));
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
      const pagina = CE?.rimedioPagina ? CE.rimedioPagina({ code: r?.code, keyRefused, maxTokens: r?.maxTokens, finishReason: r?.finishReason, reason: r?.reason }) : null;
      // Il tasto in evidenza è quello che toglie l'ostacolo (#828.1): finché c'è, «Riprova» rimanda lo stesso messaggio
      // allo stesso muro, e resta accanto per dopo, quando l'ostacolo è tolto.
      if (pagina) {
        const via = document.createElement('button');
        via.type = 'button';
        via.className = 'dash-action-btn dash-action-btn-primary';
        via.textContent = pagina.label;
        via.title = r?.code === 'NO_API_KEY' ? 'Riscatta il codice d\'invito' : pagina.title;
        via.addEventListener('click', () => chrome.tabs.create({ url: pagina.url }));
        row.appendChild(via);
      } else {
        retry.classList.add('dash-action-btn-primary');
      }
      row.appendChild(retry);
      if (r?.code === 'NO_API_KEY') err.dataset.senzaCrediti = '1';
      // #524 — durante l'accoglienza il solo "Riprova" è un vicolo cieco: se il
      // modello non risponde (rete assente, provider giù, crediti finiti) alla
      // home non ci si arriva più. L'uscita sta qui, accanto, dove l'utente
      // guarda.
      if (Accoglienza.isActive()) row.appendChild(Accoglienza.makeSkipOnboardingBtn('Salta e vai alla home'));
      err.appendChild(row);
      bubblesEl.appendChild(err);
    } else {
      // La risposta finale (r.text) è autorevole: riconcilia la bolla in streaming. Senza testo ma
      // con azioni la bolla non esiste e si cade nel ramo «solo azioni».
      let filoBubble;
      // La nota che il main ha fatto diventare risposta esce dal blocco: la frase sta nella bolla e basta.
      if (r.notaRisposta) pending.dropNote(r.notaRisposta);
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
        // Il testo uguale all'ultima nota (formato vecchio) non resta anche nel blocco.
        if (r.text && !r.notaRisposta) pending.dropNote(r.text);
        filoBubble = makeBubble({ role: 'filo', text: r.text || '', markdown: true });
        bubblesEl.appendChild(filoBubble);
      }
      // #159 — risposta fresca: le impostazioni a livello 2 aprono il loro popup
      // di conferma da sole (autoConfirm). Solo qui (nuova risposta), mai in
      // replay storico.
      Att.renderActions(filoBubble, r.actions || [], { onAck: chiudiConversazione, autoConfirm: true, activity: pending, shown });
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
        send({ type: MSG.KEY_FALLBACK_SHOWN }).catch(() => {});
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
      if (Array.isArray(r.linkDaConfermare) && r.linkDaConfermare.length) entry.linkDaConfermare = r.linkDaConfermare;
      threadHistory.push(entry);
      Term.applyCommandCwd(r.actions);
      // Chi guida la sequenza deve poter assorbire questa bolla nel blocco se
      // il turno non era l'ultimo.
      r._bubble = filoBubble;
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    return r;
  }

  // L'esito del riscatto da dire in chat, o `null` se il messaggio non portava un invito: «non esiste» su una frase
  // qualsiasi («Cara Sara, come va?») vuol dire solo che non era un codice, e resta la risposta senza crediti.
  const NON_ERA_UN_INVITO = new Set(['invalid_code', 'bad_code', 'not_reachable', 'no_identity', 'internal']);
  async function riscattaDallaChat(testo) {
    const W = window.SN_WALLET;
    if (!W || !W.codesFromInput(testo).length) return null;
    let rr = null;
    try { rr = await send({ type: MSG.WALLET_REDEEM, code: testo }); } catch (_) { return null; }
    if (!rr || !rr.message || (!rr.ok && NON_ERA_UN_INVITO.has(rr.status))) return null;
    return rr;
  }

  // `daModello`: il testo viene da un suggerimento della home, non dalle dita dell'utente (#810).
  async function submitMessage(text, { daModello = false } = {}) {
    if ((!text && pendingImages.length === 0 && pendingFiles.length === 0) || sending) return;
    await inviaComposto(prendiComposizione(text), { daModello });
  }
  // Quello che parte col messaggio, preso dalla barra che si svuota. `scritto`, `file` e `percorsi` servono a
  // rimetterlo nella barra com'era (un seguito che non parte, #1296).
  function prendiComposizione(text) {
    const scritto = inputEl.value;
    const incollato = testoDaFuori;
    const immagini = pendingImages.slice();
    const file = pendingFiles.slice();
    const percorsi = new Map(immagini.filter((d) => percorsiImmagini.has(d)).map((d) => [d, percorsiImmagini.get(d)]));
    const daFuori = incollato || immagini.length > 0 || file.length > 0;
    testoDaFuori = false;
    const righeFile = [...file.map((f) => f.percorso), ...immagini.map((d) => percorsi.get(d))]
      .filter(Boolean).map((p) => `File: ${p}`);
    clearImagePreviews();
    if (righeFile.length) text = [text || (immagini.length ? 'Descrivi questa immagine.' : ''), ...righeFile].filter(Boolean).join('\n');
    // Svuota subito la textarea: la bolla utente è già visibile, niente attesa.
    inputEl.value = '';
    autoGrowInput();
    return { text: text || '', immagini, daFuori, scritto, incollato, file, percorsi };
  }
  function bollaUtente(c) {
    const userBubble = makeBubble({ role: 'user', text: c.text });
    // Mostra TUTTE le immagini inviate nella bolla, ognuna ingrandibile al click.
    c.immagini.forEach((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      img.className = 'dash-bubble-img';
      attachImageLightbox(img, src);
      userBubble.insertBefore(img, userBubble.childNodes[i] || null);
    });
    return userBubble;
  }
  // `bolla`: quella del seguito che era in attesa, che diventa la bolla del messaggio.
  async function inviaComposto(c, { daModello = false, bolla = null } = {}) {
    sending = true;
    scrittoQui = true;
    // Chi scrive altro dopo aver fermato non vuole più riprendere: l'offerta finisce qui.
    chiudiRipresa();
    aggiornaTasto();
    // Prima query dalla home → entra in stato thread.
    if (body.dataset.state !== 'thread') goThread();

    // Bolla utente. Nella storia lo stesso testo che parte: diverso, il main lo rimandava come un messaggio in più.
    const domanda = c.text || 'Descrivi questa immagine.';
    threadHistory.push({
      role: 'user', text: domanda,
      ...(c.immagini.length ? { images: c.immagini.length } : {}),
      ...(daModello ? { daModello: true } : {}), ...(c.daFuori ? { daFuori: true } : {}),
    });
    if (!bolla) bubblesEl.appendChild(bollaUtente(c));
    Coda.segnaGiorni();
    bubblesEl.scrollTop = bubblesEl.scrollHeight;

    await runTurnAndContinue({ userMessage: domanda, images: c.immagini, daModello, daFuori: c.daFuori });
  }

  // Condiviso fra il primo invio e il «Riprova»: riprovare deve comportarsi come inviare.
  async function runTurnAndContinue(args) {
    // Un blocco di attività per tutta la sequenza (#521): i turni automatici
    // sono passi dello stesso lavoro, non risposte diverse.
    const activity = Att.create(bubblesEl);
    // Un turno solo: la sequenza «azione → esito → modello» la guida il main,
    // e la scheda la racconta in diretta dentro il blocco (runFiloTurn).
    const r = await runFiloTurn({ ...args, activity });
    if (r && r._chiusura) {
      const propria = r._chiusura.catch(() => {}).then(() => { activity.finish(); refreshLive().catch(() => {}); });
      const chat = r._chat;
      const fine = Promise.all([chiusuraDi(chat), propria]).then(() => { if (chiusure.get(chat) === fine) chiusure.delete(chat); });
      chiusure.set(chat, fine);
    } else {
      activity.finish({ failed: !r?.ok });
    }

    sending = false;
    // Riprendere ha senso solo nella conversazione che è ancora a schermo.
    if (r?.ok && r.stopped && activity.el.isConnected) ripresa = { nota: r._notaFermato || null, blocco: activity.el };
    else if (r?.ok && r.senzaRisposta && r._bubble && r._bubble.isConnected) {
      offriContinua(r._bubble, activity.el, { interrotta: r.senzaRisposta.interrotta === true });
    }
    aggiornaTasto();
    inputEl.focus();

    // #524 — l'intervista di benvenuto si è appena chiusa: il main sta
    // compattando quello che ha imparato e generando la prima home. Lo diciamo
    // subito, la home arriva con FILO_ONBOARDING_DONE.
    if (r?.ok && r.onboardingClosed) Accoglienza.onboardingClosing();

    // Aggiorna live (potrebbe esserci un timer/sveglia appena creato).
    refreshLive().catch(() => {});
    // Le pagine che il turno ha aperto e i cambi fatti altrove entrano nel filo a schermo; i messaggi del turno ci sono già.
    Coda.allinea().catch(() => {});
    // Un turno fermato, fallito o che ha chiuso l'accoglienza non manda da solo i seguiti: tornano nella casella.
    if (seguiti.length) {
      if (r?.ok && !r.stopped && !r.onboardingClosed) partiSeguito().catch(() => {});
      else rimettiSeguiti().catch(() => {});
    }
    return r;
  }

  // #360 — «Riprova»: rimanda lo stesso messaggio senza farlo riscrivere. La bolla d'errore
  // sparisce e lo storico è già a posto: un turno fallito non ci ha lasciato niente.
  async function retryTurn(errBubble, args) {
    if (sending) return;
    sending = true;
    chiudiRipresa();
    aggiornaTasto();
    try { errBubble.remove(); } catch (_) {}
    await runTurnAndContinue(args);
  }

  // ===== Fermare e riprendere (#578) =====
  // Mentre Filo lavora il posto dell'invio lo prende un quadrato, e Invio da tastiera fa la stessa cosa. Fermato, lo
  // stesso posto offre di riprendere finché l'utente non scrive altro. Racconto: patterns/il-filo-dell-attesa.md.
  function aggiornaTasto() {
    const vuoto = !inputEl.value.trim() && !pendingImages.length && !pendingFiles.length;
    const quadrato = sending || (ripresa && vuoto && appenaFermato());
    const modo = ripresa && vuoto && !quadrato ? 'riprendi' : 'invia';
    if (sendBtn.dataset.modo !== modo) {
      sendBtn.dataset.modo = modo;
      sendBtn.innerHTML = modo === 'riprendi' ? GLIFO_RIPRENDI : GLIFO_INVIO;
      sendBtn.setAttribute('aria-label', modo === 'riprendi' ? 'Riprendi' : 'Invia');
      sendBtn.title = modo === 'riprendi' ? 'Riprendi da dove si era fermato' : '';
    }
    sendBtn.disabled = quadrato;
    sendBtn.hidden = quadrato;
    if (quadrato && stopBtn.hidden) stopBtn.dataset.comparso = String(Date.now());
    stopBtn.hidden = !quadrato;
    stopBtn.disabled = !turnoVivo || turnoVivo.fermato;
  }
  // Il filo si taglia SUBITO, senza aspettare il main: chi ferma ha visto qualcosa che non gli torna.
  function fermaTurno() {
    const t = turnoVivo;
    if (!t || t.fermato) return;
    t.fermato = true;
    fermatoAlle = Date.now();
    setTimeout(aggiornaTasto, PAUSA_RIPRESA + 20);
    t.attivita.taglia();
    t.ferma();
    aggiornaTasto();
    send({ type: MSG.FILO_CHAT_STOP, reqId: t.reqId }).catch(() => {});
  }
  stopBtn.addEventListener('click', () => { if (!quadratoAppena()) fermaTurno(); inputEl.focus(); });
  aggiornaTasto();
  // Il tasto destro sul blocco che lavora e sul tasto d'invio (letto da src/content/content.js): le stesse cose dei
  // tasti, negli stessi momenti. Su un blocco finito, srotolare e riavvolgere come col clic sul gomitolo.
  function vociAttesa(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const blocco = el && el.closest('.dash-activity');
    const tasto = el && el.closest('#stopBtn, #sendBtn');
    if (!blocco && !tasto) return [];
    const voci = [];
    const t = turnoVivo;
    if (t && !t.fermato && (tasto || t.attivita.el === blocco)) voci.push({ type: 'item', label: 'Ferma', onClick: () => fermaTurno() });
    if (ripresa && !sending && (tasto || ripresa.blocco === blocco)) voci.push({ type: 'item', label: 'Riprendi da dove si era fermato', onClick: () => riprendi() });
    const testa = blocco && blocco.querySelector('.dash-activity-head');
    if (testa && !testa.hidden && blocco.dataset.phase === 'done') {
      voci.push({ type: 'item', label: blocco.dataset.filo === 'gomitolo' ? 'Srotola' : 'Riavvolgi', onClick: () => testa.click() });
    }
    return voci;
  }
  self.SN_VOCI_PAGINA = Array.isArray(self.SN_VOCI_PAGINA) ? self.SN_VOCI_PAGINA : [];
  if (!self.SN_VOCI_PAGINA.includes(vociAttesa)) self.SN_VOCI_PAGINA.push(vociAttesa);
  // Riprendere non riesegue niente: le azioni già fatte stanno nello storico come tali, e il modello le vede.
  async function riprendi() {
    if (sending || !ripresa) return;
    const { nota } = ripresa;
    const testo = ripresa.messaggio || RIPRENDI;
    chiudiRipresa();
    sending = true;
    aggiornaTasto();
    if (nota && nota.isConnected) nota.remove();
    threadHistory.push({ role: 'user', text: testo, interno: true });
    await runTurnAndContinue({ userMessage: testo, internal: true });
  }
  // Un turno finito senza risposta (#557): la frase la scrive il main, qui il «Continua» sotto e lo stesso «riprendi»
  // di un turno fermato sul tasto d'invio e nel tasto destro del blocco.
  function offriContinua(bolla, blocco, { interrotta = false } = {}) {
    let riga = bolla.querySelector('.dash-bubble-actions');
    if (!riga) {
      riga = document.createElement('div');
      riga.className = 'dash-bubble-actions';
      bolla.appendChild(riga);
    }
    const tasto = document.createElement('button');
    tasto.type = 'button';
    tasto.className = 'dash-action-btn dash-action-btn-primary dash-continua';
    tasto.textContent = 'Continua';
    tasto.title = interrotta ? 'Continua la risposta da dove si è interrotta' : 'Riprendi da dove si era fermato';
    tasto.addEventListener('click', () => { riprendi(); inputEl.focus(); });
    riga.appendChild(tasto);
    ripresa = { nota: null, blocco, tasto, messaggio: interrotta ? CONTINUA_RISPOSTA : CONTINUA };
  }

  // ===== Il seguito scritto mentre Filo lavora (#1296) =====
  // Con qualcosa nella casella Invio vuol dire «manda», anche mentre Filo lavora: il lavoro continua, il seguito compare
  // subito in attesa e il turno lo legge al suo passo dopo; se non ne ha, parte appena il turno finisce. A casella vuota
  // Invio resta lo stop. Racconto: patterns/il-filo-dell-attesa.md.
  function accodaSeguito() {
    const c = prendiComposizione(inputEl.value.trim());
    const t = turnoVivo;
    const s = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, c, bolla: bollaUtente(c), turno: null };
    s.bolla.classList.add('dash-bubble-attesa');
    s.bolla.title = 'In attesa';
    scrittoQui = true;
    seguiti.push(s);
    bubblesEl.appendChild(s.bolla);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    riarmaQuadrato();
    affidaAlTurno(s, t);
  }
  // Mandare un seguito è un invio come il primo: la stessa pausa del quadrato, o il secondo Invio di un doppio colpo
  // trova la casella vuota e ferma il lavoro che il seguito doveva solo affiancare.
  function riarmaQuadrato() {
    stopBtn.dataset.comparso = String(Date.now());
    stopBtn.style.animation = 'none';
    void stopBtn.offsetWidth;
    stopBtn.style.animation = '';
  }
  // Nel turno entrano solo parole battute qui: un allegato, un testo incollato o un comando con la barra partono a turno
  // finito, dalla strada di sempre. L'accoglienza tiene la sua conversazione e il seguito la aspetta. Un seguito che il
  // turno di prima non ha preso lo offre anche il turno dopo, appena parte.
  function affidaAlTurno(s, t) {
    const { c } = s;
    if (!t || t.fermato || c.immagini.length || c.file.length || c.daFuori || c.text.startsWith('/') || Accoglienza.isActive()) return;
    s.turno = t;
    send({ type: MSG.FILO_CHAT_SEGUITO, reqId: t.reqId, id: s.id, testo: c.text })
      .then((r) => { if (!(r && r.accolto) && s.turno === t) s.turno = null; })
      .catch(() => { if (s.turno === t) s.turno = null; });
  }
  // Il turno l'ha letto: da qui è un messaggio come gli altri, nello storico prima della risposta che lo legge.
  function seguitoLetto(id) {
    const i = seguiti.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [s] = seguiti.splice(i, 1);
    s.bolla.classList.remove('dash-bubble-attesa');
    s.bolla.removeAttribute('title');
    const voce = { role: 'user', text: s.c.text };
    const k = s.turno && s.turno.voce ? threadHistory.indexOf(s.turno.voce) : -1;
    if (k >= 0) threadHistory.splice(k, 0, voce);
    else threadHistory.push(voce);
  }
  // A turno finito il primo seguito parte dalla strada di sempre; un comando con la barra fa la sua cosa e basta.
  async function partiSeguito() {
    const s = seguiti.shift();
    if (!s) return;
    s.bolla.classList.remove('dash-bubble-attesa');
    s.bolla.removeAttribute('title');
    let bolla = s.bolla.isConnected ? s.bolla : null;
    if (!s.c.immagini.length && !s.c.file.length && s.c.text.startsWith('/')) {
      if (bolla) bolla.remove();
      bolla = null;
      // Il comando svuota la casella: quello che l'utente sta scrivendo intanto resta suo.
      const bozza = inputEl.value;
      const fatto = await comandoLocale(s.c.text);
      if (bozza && !inputEl.value) { inputEl.value = bozza; autoGrowInput(); Comandi.updateInputClass(); }
      if (fatto) { if (seguiti.length && !sending) await partiSeguito(); return; }
    }
    await inviaComposto(s.c, { bolla });
  }
  // Un seguito che non parte torna nella casella com'era, prima di quello che l'utente sta scrivendo. Quello affidato al
  // turno si ritira dal main; se il modello l'ha già letto resta un messaggio della conversazione.
  async function rimettiSeguiti(lista = seguiti.slice()) {
    const tornati = [];
    for (const s of lista) {
      if (s.turno) {
        const r = await send({ type: MSG.FILO_CHAT_SEGUITO, reqId: s.turno.reqId, id: s.id, togli: true }).catch(() => null);
        if (r && r.letto) { seguitoLetto(s.id); continue; }
      }
      const i = seguiti.indexOf(s);
      if (i < 0) continue;
      seguiti.splice(i, 1);
      s.bolla.remove();
      tornati.push(s.c);
    }
    if (!tornati.length) return;
    const testi = tornati.map((c) => c.scritto.trim()).filter(Boolean);
    const bozza = inputEl.value.trim() ? [inputEl.value] : [];
    inputEl.value = [...testi, ...bozza].join('\n');
    if (tornati.some((c) => c.incollato)) testoDaFuori = true;
    for (const c of tornati) {
      for (const d of c.immagini) addPendingImage(d, c.percorsi.get(d));
      for (const f of c.file) addPendingFile(f.percorso);
    }
    autoGrowInput();
    Comandi.updateInputClass();
    aggiornaTasto();
    inputEl.focus();
  }
  // Un seguito in attesa resta in fondo: quello che il turno aggiunge intanto (la risposta, una riga) gli va sopra.
  new MutationObserver((mutazioni) => {
    if (!seguiti.length) return;
    const altro = mutazioni.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList.contains('dash-bubble-attesa')));
    if (!altro) return;
    for (const s of seguiti) if (s.bolla.parentNode === bubblesEl) bubblesEl.appendChild(s.bolla);
  }).observe(bubblesEl, { childList: true });
  // Il tasto destro sul seguito in attesa: riprenderlo prima che parta.
  function vociSeguito(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const bolla = el && el.closest('.dash-bubble-attesa');
    const s = bolla && seguiti.find((x) => x.bolla === bolla);
    return s ? [{ type: 'item', label: 'Rimetti nella casella', onClick: () => { rimettiSeguiti([s]).catch(() => {}); } }] : [];
  }
  if (!self.SN_VOCI_PAGINA.includes(vociSeguito)) self.SN_VOCI_PAGINA.push(vociSeguito);
  // Fermato, subito: lo storico ha la sua voce e al posto della risposta resta una riga che lo dice. Il posto delle
  // azioni ancora in volo è tenuto, prima della riga: un seguito scritto intanto finisce sotto, non in mezzo.
  function apriTurnoFermato({ pending, streamBubble, streamedText }) {
    const turn = pending.endTurn();
    const parziale = String(streamedText || '').trim();
    const entry = { role: 'filo', text: parziale, actions: [], interrotto: true, fermato: true };
    if (turn.text) { entry.reasoning = turn.text; entry.reasoningMs = turn.ms; }
    threadHistory.push(entry);
    let host = streamBubble;
    if (host) {
      host.classList.remove('dash-bubble-streaming');
      if (parziale) setBubbleText(host, parziale, true);
    } else {
      host = makeBubble({ role: 'filo', text: '' });
      host.hidden = true;
      bubblesEl.appendChild(host);
    }
    const nota = document.createElement('div');
    nota.className = 'dash-bubble-note dash-bubble-fermato';
    nota.textContent = parziale ? 'Fermato a metà della risposta.' : 'Fermato prima della risposta.';
    bubblesEl.appendChild(nota);
    return { entry, host, nota, parziale };
  }
  // Il main ha finito il turno fermato: le azioni fatte restano (righe e bottoni) e lo storico le sa.
  function chiudiTurnoFermato(r, { entry, host, nota, parziale }, { pending, shown }) {
    const azioni = Array.isArray(r?.actions) ? r.actions : [];
    entry.actions = azioni;
    // La risposta era già finita quando è arrivato lo stop: c'è, e lo schermo non dice il contrario.
    if (r?.ok && !r.stopped && String(r.text || '').trim()) {
      entry.text = r.text;
      delete entry.interrotto;
      delete entry.fermato;
      if (Array.isArray(r.notes) && r.notes.length) entry.notes = r.notes;
      host.hidden = false;
      setBubbleText(host, r.text, true);
      nota.remove();
      if (ripresa && ripresa.nota === nota) { ripresa = null; aggiornaTasto(); }
    }
    // Nessun popup di conferma che si apre da solo: l'utente ha appena detto di smettere.
    Att.renderActions(host, azioni, { onAck: chiudiConversazione, autoConfirm: false, activity: pending, shown });
    if (host.querySelector('.dash-bubble-actions')) host.hidden = false;
    else if (!parziale && host.hidden) host.remove();
    Term.applyCommandCwd(azioni);
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
    aggiornaTasto();
    imgPreviewsEl.innerHTML = '';
    imgPreviewsEl.hidden = pendingImages.length === 0 && pendingFiles.length === 0;
    pendingImages.forEach((dataUrl, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'dash-img-preview';
      // La prima anteprima conserva l'id #imgPreview: lo usano i test.
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
    testoIncollato = e.target === inputEl ? (e.clipboardData?.getData('text/plain') ?? null) : null;
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
  // Un file diventa un allegato; un testo trascinato (una voce della colonna destra, una frase da
  // un'altra scheda) entra nel campo dove sta il cursore. Il dragover qui sopra dice a Chromium che il
  // trascinamento lo gestisce la pagina, e allora il campo non inserisce più niente da sé.
  inputForm.addEventListener('drop', (e) => {
    e.preventDefault();
    // Un file trovato da Filo in chat, trascinato qui: entra come quelli trascinati dal disco.
    const daChat = e.dataTransfer?.getData('application/x-filo-file') || '';
    if (daChat) { addPendingFile(daChat); inputEl.focus(); return; }
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      for (const f of files) handleDroppedFile(f);
      return;
    }
    const testo = e.dataTransfer?.getData('text/plain') || '';
    if (!testo) return;
    testoDaFuori = true;
    const prima = inputEl.value.slice(0, inputEl.selectionStart);
    const dopo = inputEl.value.slice(inputEl.selectionEnd);
    const spazioDopo = dopo && !/^\s/.test(dopo) ? ' ' : '';
    const pezzo = `${prima && !/\s$/.test(prima) ? ' ' : ''}${testo}${spazioDopo}`;
    inputEl.setRangeText(pezzo, inputEl.selectionStart, inputEl.selectionEnd, 'end');
    inputEl.focus();
    autoGrowInput();
    Comandi.updateInputClass();
    Term.virgoletteSuInserito(testo, inputEl.selectionEnd - spazioDopo.length);
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

  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Mentre Filo lavora l'invio non ha tasto (c'è il quadrato): arriva qui solo dal microfono, e fa quello di Invio.
    if (sending) {
      if (inputEl.value.trim() || pendingImages.length || pendingFiles.length) accodaSeguito();
      return;
    }
    const text = inputEl.value.trim();
    // Il secondo colpo di chi ha appena fermato (clic o Invio) non riprende: il menu, scelta deliberata, sì.
    if (!text && pendingImages.length === 0 && pendingFiles.length === 0) { if (!appenaFermato()) riprendi(); return; }
    if (await comandoLocale(text)) return;
    submitMessage(text);
  });
  // Quello che la barra fa da sé, senza il modello: vero se l'ha fatto.
  async function comandoLocale(text) {
    // "/dominio.tld": non navigare DI SLANCIO verso un sito inesistente
    // (porterebbe a una pagina bianca). Verifica il DNS (await se non già in
    // cache) e, se il dominio non esiste, dillo e offri di aprire lo stesso —
    // mai restare in silenzio (#433).
    if (text.startsWith('/') && Comandi.isSiteToken(text)) {
      const host = Comandi.siteHostOf(text);
      const resolves = host ? await Comandi.ensureSiteResolved(host) : true;
      if (resolves === false) { Comandi.updateInputClass(); Comandi.showUnresolvedSite(text, host); return true; }
    }
    return Comandi.handleSlashCommand(text);
  }

  // Invio manda, Shift+Invio va a capo: il campo è una textarea, quindi Invio di suo andrebbe a
  // capo. `isComposing` evita di mandare a metà di una composizione IME.
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // Invio tenuto premuto è un colpo solo: la ripetizione non ferma e poi riprende, né rimanda.
      if (e.repeat) return;
      // Mentre Filo lavora, con qualcosa nella casella Invio manda un seguito (#1296); a casella vuota è il quadrato.
      if (sending) {
        if (inputEl.value.trim() || pendingImages.length || pendingFiles.length) accodaSeguito();
        else if (!quadratoAppena()) fermaTurno();
        return;
      }
      inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event('submit'));
    }
  });

  // La textarea parte a una riga e cresce (fino al max-height del CSS). Va richiamata anche
  // quando si svuota il campo da codice.
  function autoGrowInput() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  // Chi entra nel campo o ci scrive manderà presto un turno: il saldo dei crediti si rilegge adesso, così il turno
  // non lo aspetta (#1353). Il main non rilegge una lettura di meno di un minuto.
  let saldoChiestoAlle = 0;
  function preparaSaldo() {
    const adesso = Date.now();
    if (adesso - saldoChiestoAlle < 20 * 1000) return;
    saldoChiestoAlle = adesso;
    send({ type: MSG.WALLET_SALDO_PREPARA });
  }
  inputEl.addEventListener('focus', () => { Sistema.scrive({ entra: true }); preparaSaldo(); });

  // Evidenziazione live mentre si scrive: arancione = comando Filo (o sito),
  // azzurro = comando shell (solo in modalità terminale).
  inputEl.addEventListener('input', (e) => {
    if (!inputEl.value) testoDaFuori = false;
    else if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') testoDaFuori = true;
    Comandi.updateInputClass(); autoGrowInput(); Sistema.scrive(); preparaSaldo(); aggiornaTasto();
    // Ctrl+V porta il testo nell'evento `paste`, l'Incolla del menu di Filo in `data`.
    if (e.inputType === 'insertFromPaste') {
      const incollato = typeof e.data === 'string' ? e.data : testoIncollato;
      testoIncollato = null;
      Term.virgoletteSuInserito(incollato, inputEl.selectionEnd);
    }
  });

  // Il tasto microfono: si parla, e la richiesta parte come col tasto d'invio (o resta da correggere).
  // La scorciatoia vale in tutta la home, che è la sua chat. Mentre Filo lavora parte come seguito (#1296): non aspetta.
  window.SN_VOCE_CHAT?.collega({
    campo: inputEl, contenitore: inputForm, prima: sendBtn, ambito: document,
    invia: () => (inputForm.requestSubmit ? inputForm.requestSubmit() : inputForm.dispatchEvent(new Event('submit'))),
  });

  // ===== Bridge cambio stato live dal background =====
  // #818 — l'avviso prima che i crediti finiscano lo prende la home con una conversazione aperta, e arriva in fondo
  // alla conversazione, dopo la risposta che sta arrivando. Senza conversazione lo lascia alla notifica della finestra.
  // Un rimedio applicato altrove (pagina Crediti, o chiesto a parole) cambia anche i pulsanti sotto l'avviso in chat;
  // la frase dell'ultimo clic resta sotto il suo rimedio anche dopo il riallineamento.
  let rimediInChat = null;
  let esitoInChat = null;
  const opzRimediInChat = {
    invia: send, classeBottone: 'dash-action-btn',
    apriChiave: () => chrome.tabs.create({ url: 'filo://credits/credits.html#chiave' }),
    onEsito: (id, frase) => { esitoInChat = frase ? { id, frase } : null; },
  };
  async function riallineaRimediInChat() {
    if (!rimediInChat || !rimediInChat.isConnected) { rimediInChat = null; return; }
    let st = null;
    try { st = await send({ type: MSG.CREDITS_WARNING_STATE }); } catch (_) { st = null; }
    if (!st || !st.ok || !st.mostra || !st.avviso || !rimediInChat) return;
    // Senza la frase le soglie non dicono più niente e lo stato porta solo i rimedi applicati: gli altri in chat restano.
    if (!st.avviso.testo) {
      const applicati = new Map(st.avviso.rimedi.map((x) => [x.id, x]));
      const correnti = Array.from(rimediInChat.children).map((li) => li._rimedio).filter(Boolean);
      st.avviso = { rimedi: correnti.map((x) => applicati.get(x.id) || x) };
    }
    window.SN_CREDITI_AVVISO_UI.aggiorna(rimediInChat, { avviso: st.avviso, esito: esitoInChat, ...opzRimediInChat });
  }

  async function avvisoCrediti(id) {
    if (body.dataset.state !== 'thread' || inRiserva === true || Accoglienza.isActive()) return;
    let r = null;
    try { r = await send({ type: MSG.CREDITS_WARNING_CLAIM, id }); } catch (_) { r = null; }
    if (!r || !r.ok || !r.avviso) return;
    const chat = chatId;
    const fine = Date.now() + 10 * 60 * 1000;
    while (sending && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 250));
    // Nel filo va l'avviso intero, rimedi compresi: a una risposta a parole Filo sa cosa ha proposto.
    const perFilo = r.avviso.perFilo || r.avviso.testo;
    archiviaRiga(perFilo, 'filo', chat);
    // Tornata alla home mentre aspettava: la riga resta nella chat, e i rimedi nella pagina Crediti.
    if (!inChatAperta(chat) || body.dataset.state !== 'thread') return;
    const inFondo = bubblesEl.scrollHeight - bubblesEl.scrollTop - bubblesEl.clientHeight < 40;
    const bolla = makeBubble({ role: 'filo', text: r.avviso.testo });
    bolla.classList.add('dash-crediti-avviso');
    const elenco = window.SN_CREDITI_AVVISO_UI.elenco({ avviso: r.avviso, ...opzRimediInChat });
    bolla.appendChild(elenco);
    rimediInChat = elenco;
    esitoInChat = null;
    bubblesEl.appendChild(bolla);
    threadHistory.push({ role: 'filo', text: perFilo });
    if (inFondo) bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // Filo ha scritto di sua iniziativa (#869): il suo turno in fondo al filo, o al posto del suo messaggio di prima.
  function filoParla(msg) {
    if (Accoglienza.isActive()) return;
    const voce = { k: 'msg', key: `m:${msg.chat}:${msg.i}`, chat: msg.chat, role: 'filo', text: String(msg.testo || ''), ts: msg.ts, spontaneo: true };
    Coda.metti(voce);
    if (!chatId && !sending) chatId = msg.chat;
    if (msg.chat !== chatId) return;
    const ultimo = threadHistory[threadHistory.length - 1];
    // La conversazione adottata dal disco lo porta già, se l'ha letta dopo che il main l'ha scritto.
    if (ultimo && ultimo.role === 'filo' && ultimo.text === voce.text) return;
    if (msg.fuso && ultimo && ultimo.spontaneo) ultimo.text = voce.text;
    else threadHistory.push({ role: 'filo', text: voce.text, actions: [], spontaneo: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.CREDITS_WARNING && msg.id) {
      avvisoCrediti(String(msg.id)).catch(() => {});
    } else if (msg?.type === MSG.USCITA_FERMATA && msg.frase) {
      const vicino = ultimoTastoDestro && ultimoTastoDestro.isConnected ? ultimoTastoDestro : null;
      notaFermata(String(msg.frase), vicino);
    } else if (msg?.type === MSG.FILO_LIVE_UPDATED) {
      refreshLive().catch(() => {});
    } else if (msg?.type === MSG.SISTEMA_AGGIORNATO) {
      Sistema.aggiornato(msg.stato);
    } else if (msg?.type === MSG.FILO_PARLA && msg.chat) {
      filoParla(msg);
    } else if (msg?.type === MSG.FILO_CHATS_UPDATED && msg.rimessa) {
      Coda.rimettiChat(msg.rimessa).catch(() => {});
    } else if (msg?.type === MSG.FILO_CHATS_UPDATED && msg.nascosta) {
      // #1295 — nascosta da qui, da un'altra scheda o a parole: esce dalla vista, e se è quella in corso il messaggio dopo ne apre una nuova.
      Coda.nascostaAltrove(msg.nascosta);
      if (msg.nascosta === chatId) {
        lasciaLaChat();
        if (body.dataset.state === 'thread') {
          const nota = document.createElement('div');
          nota.className = 'dash-bubble-note';
          const riga = [...bubblesEl.querySelectorAll('.dash-nascosta')].some((n) => n.dataset.nascosta === msg.nascosta);
          nota.textContent = `Questa conversazione è nascosta: la rimetti ${riga ? 'da «Rimetti» qui sopra' : 'cercandola nel filo'}. Quello che scrivi da adesso apre una chat nuova.`;
          bubblesEl.appendChild(nota);
          bubblesEl.scrollTop = bubblesEl.scrollHeight;
        }
      }
    } else if (msg?.type === MSG.FILO_CHATS_UPDATED && msg.cancellata) {
      Coda.togliChat(msg.cancellata);
      // #525 — qualcuno ha tolto dal filo (un'altra scheda, la chat) la conversazione che
      // sta ancora qui a schermo. Continuare a scriverci dentro la farebbe
      // rinascere con la stessa targa e i messaggi di prima persi: l'opposto
      // di quello che l'utente ha chiesto. Da qui in poi è una chat nuova — e
      // lo diciamo, perché una cosa cancellata altrove non deve succedere di
      // nascosto.
      if (msg.cancellata === chatId) {
        lasciaLaChat();
        if (body.dataset.state === 'thread') {
          const nota = document.createElement('div');
          nota.className = 'dash-bubble-note';
          nota.textContent = 'Questa conversazione è stata tolta dal filo. Quello che scrivi da adesso apre una chat nuova.';
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
      // La frase arriva solo senza un modello (handlers/wallet.js): con un modello se ne va.
      mostraSenzaModello(msg.message || '');
      suggestions = Array.isArray(msg.suggestions) ? msg.suggestions : [];
      renderSuggestions();
      // La home si rifà da sola anche quando arriva un modello (invito, chiave propria): l'intervista
      // che lo aspettava parte qui, non alla prossima scheda.
      Accoglienza.maybeOpenOnboardingLater().catch(() => {});
    } else if (msg?.type === MSG.SETTINGS_UPDATED) {
      applySavedTheme().catch(() => {});
      if (msg.settings) Sistema.applicaImpostazioni(msg.settings);
      if (msg.settings && msg.settings.terminal) Term.applySettings(msg.settings.terminal);
      if (msg.settings && msg.settings.autonomia) Accoglienza.aggiornaSceltaAutonomia(msg.settings.autonomia.livello);
      if (msg.settings && msg.settings.contatori) Accoglienza.aggiornaSceltaContatori(msg.settings.contatori.attivi !== false);
    } else if (msg?.type === MSG.AUTH_CHANGED) {
      // Login/logout fatto altrove (es. dal menu profilo): aggiorna l'avatar.
      Comandi.setOwner(msg.signedIn && msg.isAdmin);
      applyAccountProfile(msg.signedIn ? msg.profile : null);
      // #524 — l'accoglienza aspettava un modello: appena l'accesso lo rende
      // disponibile, Filo si presenta subito invece di rimandare alla prossima
      // scheda nuova.
      if (msg.signedIn) Accoglienza.maybeOpenOnboardingLater();
    } else if (msg?.type === MSG.CREDITS_CHANGED) {
      if (msg.avvisoCrediti) riallineaRimediInChat().catch(() => {});
      // Un invito riscattato da fuori (#651): il link aperto da un'altra
      // applicazione, o l'invito che aspettava questa installazione al primo
      // avvio. La spinta arriva a tutte le home: lo racconta chi lo prende.
      inCodaPopup(chiediBenvenuto);
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
      // L'owner ci ha regalato dei crediti (#210.4): la spinta arriva a ogni home, lo racconta chi lo prende (#664).
      inCodaPopup(chiediRegalo);
    }
  });


  // ===== Bootstrap =====
  // ===== Profilo e impostazioni in alto a destra =====
  // Dove ogni app li mette (SPEC home). Red-team, Home, Cronologia e App stanno solo nella barra laterale (#871).
  // Ogni click aziona il comando REALE della shell via MSG.SHELL_ACTION, che apre il suo menu nativo.
  let accountCtrlBtn = null; // riferimento all'icona profilo (mostra l'avatar)

  function renderControls() {
    const host = $('dashControls');
    if (!host) return;
    const ICONS = self.SN_ICONS || {};
    const items = [
      { command: 'settings', icon: 'options', label: 'Impostazioni' },
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
        else {
          // Il menu della shell si apre sotto l'icona, ovunque la metta la colonna destra (#1491).
          const r = btn.getBoundingClientRect();
          send({ type: MSG.SHELL_ACTION, command: it.command, anchor: { x: r.left, y: r.bottom } });
        }
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
      Comandi.setOwner(r && r.signedIn && r.isAdmin);
    } catch (_) {
      Comandi.setOwner(false);
    }
  }

  // Le fusioni in attesa del via libera dell'owner NON compaiono qui: la
  // decisione vive in Gestione (scelta owner 2026-08-26), dove stanno le altre.

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
      text: entrato
        ? (n.invitesLocked === 'need_google'
          ? `${n.text} Li trovi nella pagina Crediti, dove colleghi Google per avere anche inviti da dare.`
          : (n.invitesLocked
            ? `${n.text} Li trovi nella pagina Crediti.`
            : `${n.text} Li trovi nella pagina Crediti, insieme ai tuoi inviti da dare.`))
        : n.text,
      okLabel: entrato ? 'Evviva!' : 'Va bene',
    });
    return true;
  }

  // Lo stesso avviso arriva da due strade (la spinta del main e la domanda
  // all'apertura) e a ogni home aperta: lo racconta una scheda sola (#664),
  // la prima che l'utente ha davanti. Una home dietro aspetta di tornare
  // visibile, poi lo chiede al main, che lo dà a una sola.
  // La home pronta per la scheda nuova (#1128) è caricata ma nessuno la guarda, e `document.hidden` in una scheda non
  // cambia mai: lo sa dal main, e quello che va fatto davanti all'utente aspetta che diventi una scheda. Le home che
  // sono già schede restano come prima.
  let inRiserva = null;
  const attesiConsegna = [];
  function nonPiuRiserva() {
    const era = inRiserva === true;
    inRiserva = false;
    for (const ok of attesiConsegna.splice(0)) ok();
    if (era) allaComparsa();
  }
  send({ type: MSG.TAB_IN_VISTA_GET }).then((r) => !!(r && r.riserva), () => false).then((si) => {
    if (inRiserva !== null) return;
    if (si) inRiserva = true;
    else nonPiuRiserva();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.TAB_IN_VISTA && msg.inVista && inRiserva !== false) nonPiuRiserva();
  });
  async function quandoVisibile() {
    if (inRiserva !== false) await new Promise((ok) => attesiConsegna.push(ok));
    if (document.visibilityState !== 'hidden') return;
    await new Promise((ok) => {
      const guarda = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', guarda);
        ok();
      };
      document.addEventListener('visibilitychange', guarda);
    });
  }
  async function chiediRegalo() {
    await quandoVisibile();
    let r = null;
    try { r = await send({ type: MSG.GIFT_NOTICE_CLAIM }); } catch (_) { r = null; }
    const n = Math.round(Number(r && r.amount) || 0);
    if (n <= 0 || !window.SN_CONFIRM_UI?.notify) return;
    await window.SN_CONFIRM_UI.notify({
      title: 'Crediti in regalo 🎁',
      text: `Ti sono stati regalati ${n} crediti! Sono già sul tuo saldo.`,
      okLabel: 'Evviva!',
    });
  }
  // Il conto OpenRouter che non regge i crediti vivi o il tetto (#820): l'owner lo sa all'avvio senza aprire la sua
  // pagina. Per chi non è owner il main risponde null senza chiedere niente al server.
  function finoAChiusura(id) {
    return new Promise((ok) => {
      if (!document.getElementById(id)) { ok(); return; }
      const obs = new MutationObserver(() => { if (!document.getElementById(id)) { obs.disconnect(); ok(); } });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }
  // Si scioglie quando questa home ha avuto risposta sull'allarme del conto: gli spec la aspettano prima di cambiare chi è owner.
  let fineAllarmeOwner = () => {};
  const allarmeOwnerChiesto = new Promise((ok) => { fineAllarmeOwner = ok; });
  async function chiediAllarmeOwner() {
    await quandoVisibile();
    // Recap e ringraziamento non tengono la coda fino alla chiusura: si aspetta che se ne vadano, mai sopra di loro.
    await ricompenseAvvio;
    await finoAChiusura('recapOverlay');
    await finoAChiusura('thanksOverlay');
    let r = null;
    try { r = await send({ type: MSG.WALLET_OWNER_ALARM_PENDING }); } catch (_) { r = null; }
    fineAllarmeOwner();
    const a = r && r.ok && r.alarm;
    if (!a || !window.SN_CONFIRM_UI?.confirm) return;
    const apri = await window.SN_CONFIRM_UI.confirm({
      title: a.title, text: a.text, okLabel: 'Apri Inviti e utenti', cancelLabel: 'Più tardi',
    });
    if (apri) send({ type: MSG.OPEN_URL, url: 'filo://manage/manage.html#utenti' });
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

  // Si scioglie quando questa home ha avuto risposta sulle ricompense dell'avvio, o ha deciso di non chiederle:
  // gli spec la aspettano invece di un tempo fisso (#1212).
  let fineRicompenseAvvio = () => {};
  const ricompenseAvvio = new Promise((ok) => { fineRicompenseAvvio = ok; });

  async function maybeShowFeedbackRewards() {
    try {
      let res;
      try { res = await send({ type: MSG.GET_FEEDBACK_REWARDS }); } catch (_) { return; }
      if (!res || !res.ok || !Array.isArray(res.rewards) || !res.rewards.length) return;
      renderFeedbackRewards(res.rewards, res.totalCredits || 0);
    } finally { fineRicompenseAvvio(); }
  }

  // Anima alcune "monete credito" dorate dal centro dello schermo verso l'icona
  // profilo in alto a destra. Decorativa, best-effort, rispetta prefers-reduced-motion.
  function flyCreditsToAccount(amount) {
    try {
      const reduce = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // Token `motion`: moltiplica le durate; a 0 il volo non parte, come col movimento ridotto del sistema.
      const k = self.SN_THEME_TOKENS ? self.SN_THEME_TOKENS.motionFactor(document) : 1;
      if (reduce || !k) return;
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
      let maxEnd = 1000 * k;
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
        const delay = i * 45 * k;
        const dur = (700 + i * 50 + Math.random() * 140) * k;
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
      testoDaFuori = true;
      autoGrowInput();
      inputEl.focus();
    }
  }

  // La home pronta (#1128) arriva davanti con quello che gli annunci le hanno portato: rilegge solo ciò che una home
  // nuova chiede aprendosi e che nessun annuncio porta.
  function allaComparsa() {
    richiestaDellAvviso(Accoglienza.isActive()).catch(() => {});
    if (Accoglienza.isActive()) Accoglienza.riprendiAllaComparsa().catch(() => {});
    else {
      aggiornaDashboardInSilenzio().catch(() => {});
      // Arrivata davanti è una home che si apre: l'ultimo messaggio in cima (#1487).
      Coda.allinea({ daAltrove: true }).catch(() => {}).then(() => Coda.daCapo());
    }
  }

  (async function init() {
    renderControls();
    await applySavedTheme();
    try {
      const settings = await self.SN_STORAGE?.getSettings?.();
      Sistema.applicaImpostazioni(settings);
      Term.setEnabled(!!settings?.terminal?.enabled);
      Term.setShell(settings?.terminal?.shell || 'powershell');
    } catch (_) {}
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
    const eventoId = onbState ? null : eventoFromUrl();
    // Suggerimenti, stato vivo e coda del filo insieme: niente di questo chiama il modello (#869).
    await Promise.all([
      onbState ? Promise.resolve() : loadDashboard().catch((e) => console.warn('[Filo] dashboard load', e)),
      refreshLive().catch((e) => console.warn('[Filo] live', e)),
      onbState ? Promise.resolve() : caricaFilo().catch((e) => console.warn('[Filo] coda del filo', e)),
    ]);
    // Una chat che non c'è più (cancellata da un'altra scheda) lascia il filo com'è.
    if (reopenId) await reopenChat(reopenId).catch((e) => { console.warn('[Filo] riapertura chat', e); return false; });
    if (eventoId) await vaiAlEvento(eventoId).catch((e) => { console.warn('[Filo] salto al punto del filo', e); return false; });
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
    if (onbState) { fineRicompenseAvvio(); return; }
    inCodaPopup(async () => {
      // Recap e ringraziamento non li prende la home pronta per la scheda nuova: si consumerebbero dove nessuno li guarda.
      await quandoVisibile();
      try {
        const shown = await maybeShowUpdateRecap(() => maybeShowFeedbackRewards());
        if (!shown) await maybeShowFeedbackRewards();
      } catch (_) {}
    });
    inCodaPopup(chiediAllarmeOwner);
  })();

  // Hook per i test Playwright: rende azioni come farebbe una bolla di chat, senza l'LLM.
  window.__filoDashActions = {
    renderActions: Att.renderActions,
    applyCommandCwd: Term.applyCommandCwd,
    getCwd: Term.getCwd,
    refreshAccountControl,
    ricompenseAvvio: () => ricompenseAvvio,
    allarmeOwnerChiesto: () => allarmeOwnerChiesto,
  };
})();
