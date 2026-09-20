// Micro-intervista di benvenuto (#524): la prima conversazione con Filo, la
// via d'uscita che non passa dal modello, e la riga che resta sulla home
// quando l'accoglienza si è chiusa a metà.
//
// Il benvenuto non è un cartello: è l'inizio di una conversazione vera. Il
// testo del primo messaggio, l'elenco delle cose da scoprire e da dire e lo
// stato della ripresa vivono in src/shared/onboarding.js; qui c'è solo la chat
// che l'utente vede.
//
// Forma del modulo: IIFE che si registra su globalThis e NON tocca il DOM al
// caricamento — solo dentro `init`.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  const Onb = global.SN_ONBOARDING;

  // Dipendenze dalla pagina, riempite da init().
  let $ = null;
  let send = null;
  let bubblesEl = null;
  let threadView = null;
  let inputEl = null;
  let homeMessageEl = null;
  let makeBubble = null;
  let stepTrace = null;
  let goHome = null;
  let goThread = null;
  let resetHistory = null;
  let pushHistory = null;
  let isSending = null;
  let beginSending = null;
  let runTurnAndContinue = null;
  let isHomeMessageVisible = null;
  let setSuggestions = null;
  let loadDashboard = null;

  // Lo stato lo tiene il main (una chiave sola): all'apertura chiediamo se
  // l'intervista è aperta e, se sì, ricomponiamo la conversazione com'era.
  // Niente flag scritto qui: il segno "già accolto" lo scrive la CHIUSURA.
  let onboardingActive = false;

  async function fetchOnboarding() {
    try {
      const r = await send({ type: MSG.FILO_GET_ONBOARDING });
      // `ready: false` = nessun modello disponibile ancora (niente accesso,
      // niente chiave): l'intervista aspetta e la home spiega come attivare
      // Filo, invece di accoglierlo con una chat che non può rispondere.
      if (!r?.ok || !r.onboarding || !r.ready) return null;
      if (r.onboarding.done) return null;
      // `resume` lo decide il main: di schede nuove se ne aprono due insieme, e
      // il turno rimasto a metà lo deve riprendere UNA sola.
      return { ...r.onboarding, resume: !!r.resume };
    } catch (_) { return null; }
  }

  // La conversazione salvata torna a schermo come bolle normali — per l'utente
  // è una chat, non una procedura guidata. Usata sia all'apertura sia quando
  // un'altra scheda fa avanzare la stessa intervista.
  function renderOnboardingThread(state) {
    const thread = Array.isArray(state?.thread) ? state.thread : [];
    bubblesEl.innerHTML = '';
    // Lo stato viaggia con l'azzeramento: la home lo usa per legare TUTTA
    // l'intervista a una sola chat in archivio (#525), anche quando si svolge
    // su più aperture della scheda.
    resetHistory(state);
    if (thread.length > 1 && Onb?.RESUME_NOTE) bubblesEl.appendChild(stepTrace(Onb.RESUME_NOTE));
    for (const m of thread) {
      const role = m.role === 'filo' ? 'filo' : 'user';
      pushHistory({ role, text: m.text });
      bubblesEl.appendChild(makeBubble({ role, text: m.text, markdown: role === 'filo' }));
    }
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // Apre (o riprende) l'intervista. Se l'ultimo messaggio è dell'utente (ha
  // risposto e ha chiuso la finestra prima della risposta), il turno riparte da
  // solo: non deve riscrivere niente.
  async function openOnboarding(state) {
    onboardingActive = true;
    hideOnboardingNotice(); // l'intervista è di nuovo qui: la riga non serve più
    goThread();
    renderOnboardingThread(state);
    showSkipOnboarding();
    inputEl.focus();
    const last = (state.thread || [])[(state.thread || []).length - 1];
    if (state.resume && last && last.role === 'user' && !isSending()) {
      beginSending();
      await runTurnAndContinue({ userMessage: last.text });
    }
  }

  // Un'altra scheda ha fatto avanzare l'intervista: questa si riallinea, invece
  // di restare ferma alla conversazione com'era quando l'ha letta. Mai mentre
  // stiamo scrivendo noi — le bolle in corso sono già la verità.
  function onboardingUpdated(state) {
    if (!state || state.done) return;
    // Qui l'intervista non è a schermo, ma da qualche parte è di nuovo aperta:
    // se questa home mostrava la riga «abbiamo chiuso a metà», adesso mente.
    if (!onboardingActive) { hideOnboardingNotice(); return; }
    if (isSending()) return;
    renderOnboardingThread(state);
  }

  // ── La via d'uscita che non passa dal modello ─────────────────────────────
  //
  // Il benvenuto promette «scrivi "basta così" e chiudiamo»: la parola la
  // riconosce il main da sé, senza chiamare nessuno. Questo pulsante è il suo
  // gemello visibile, per chi la frase non la ricorda o si trova davanti a una
  // bolla d'errore. Senza, chi apre Filo la prima volta senza rete resta chiuso
  // dentro l'accoglienza con il solo "Riprova" davanti.
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

  // L'intervista era in attesa di un modello (nessun accesso, nessuna chiave) e
  // adesso c'è: la apriamo, ma solo se l'utente è ancora sulla home e non sta
  // già facendo altro — irrompere in una conversazione in corso sarebbe peggio
  // che aspettare la prossima scheda.
  async function maybeOpenOnboardingLater() {
    if (onboardingActive || isSending()) return;
    if (document.body.dataset.state !== 'home') return;
    const state = await fetchOnboarding();
    if (!state || onboardingActive || isSending() || document.body.dataset.state !== 'home') return;
    await openOnboarding(state);
  }

  // Chiusura: l'ultimo atto non è un "fatto", è il risultato — la prima home
  // costruita sul profilo appena imparato. Finché non arriva, la chat dice cosa
  // sta succedendo invece di restare muta.
  function onboardingClosing() {
    if (!onboardingActive) return;
    onboardingActive = false;
    closingShownAt = Date.now();
    hideSkipOnboarding();
    bubblesEl.appendChild(stepTrace('Preparo la tua home…'));
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    // La home personale è l'ultimo atto dell'accoglienza, ma non può esserne la
    // condizione: se non arriva (nessun modello, provider giù) l'utente va alla
    // home lo stesso invece di restare davanti a una chat chiusa.
    clearTimeout(onboardingHomeFallback);
    onboardingHomeFallback = setTimeout(() => {
      if (document.body.dataset.state === 'thread' && !isSending()) onboardingDone(null);
    }, 8000);
  }

  // Il congedo («chiudo qui, la rifacciamo quando vuoi») è l'ultima cosa che
  // l'utente legge dell'accoglienza, e la home lo cancella: quando la home
  // arriva nello stesso istante — col modello giù è così — non lo legge
  // nessuno. Gli lasciamo il tempo di essere letto; se la home ci mette di suo
  // più di così, non si aspetta niente.
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
    if (isHomeMessageVisible()) {
      homeMessageEl.classList.remove('dash-home-msg-loading');
      homeMessageEl.textContent = msg?.message || 'Filo è in ascolto.';
    }
    setSuggestions(Array.isArray(msg?.suggestions) ? msg.suggestions : []);
    // La home appena generata È la risposta finale. Se non è arrivata (chiave
    // assente, provider giù) la si carica per la strada normale.
    if (!msg?.message) loadDashboard().catch(() => {});
    // Chiusa prima della fine? Il congedo era in chat, e la chat è appena
    // sparita: la riga qui sotto è quello che ne resta.
    refreshOnboardingNotice().catch(() => {});
  }

  // ── Dopo un'accoglienza chiusa a metà ─────────────────────────────────────
  //
  // Il congedo spiega che l'intervista si rifà da Preferenze, ma vive in chat e
  // la chat sparisce appena la home è pronta — a volte in un istante. E il segno
  // «già accolto» è definitivo: chi non fa in tempo a leggerlo non ha modo di
  // capire perché Filo ha smesso di presentarsi. Questa riga resta sulla home
  // finché non la si toglie, e porta con sé la strada per tornarci.
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

  // Rifarla da qui: la stessa cosa del pulsante in Preferenze, ma senza mandare
  // l'utente a cercarlo — l'intervista riparte nella scheda che ha davanti.
  async function restartOnboardingHere() {
    hideOnboardingNotice();
    try {
      const r = await send({ type: MSG.FILO_RESTART_ONBOARDING });
      if (r?.ok && r.onboarding) await openOnboarding({ ...r.onboarding, resume: false });
    } catch (_) {}
  }

  function init(deps) {
    $ = deps.$;
    send = deps.send;
    bubblesEl = deps.bubblesEl;
    threadView = deps.threadView;
    inputEl = deps.inputEl;
    homeMessageEl = deps.homeMessageEl;
    makeBubble = deps.makeBubble;
    stepTrace = deps.stepTrace;
    goHome = deps.goHome;
    goThread = deps.goThread;
    resetHistory = deps.resetHistory;
    pushHistory = deps.pushHistory;
    isSending = deps.isSending;
    beginSending = deps.beginSending;
    runTurnAndContinue = deps.runTurnAndContinue;
    isHomeMessageVisible = deps.isHomeMessageVisible;
    setSuggestions = deps.setSuggestions;
    loadDashboard = deps.loadDashboard;
  }

  global.SN_DASH_ONBOARDING = {
    init,
    isActive: () => onboardingActive,
    fetchOnboarding,
    openOnboarding,
    onboardingUpdated,
    onboardingClosing,
    onboardingDone,
    maybeOpenOnboardingLater,
    refreshOnboardingNotice,
    hideOnboardingNotice,
    makeSkipOnboardingBtn,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
