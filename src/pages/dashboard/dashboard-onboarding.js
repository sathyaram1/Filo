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
  let makeBubble = null;
  let stepTrace = null;
  let goHome = null;
  let goThread = null;
  let resetHistory = null;
  let pushHistory = null;
  let segnaFermato = null;
  let isSending = null;
  let giaAschermo = null;
  let beginSending = null;
  let runTurnAndContinue = null;
  let nienteInCorso = null;
  let chatInCorso = null;
  let allApertura = null;
  let soloRisposteSenzaCrediti = null;
  let setSuggestions = null;
  let loadDashboard = null;
  let rispondi = null;

  // Lo stato lo tiene il main (una chiave sola): all'apertura chiediamo se
  // l'intervista è aperta e, se sì, ricomponiamo la conversazione com'era.
  // Niente flag scritto qui: il segno "già accolto" lo scrive la CHIUSURA.
  let onboardingActive = false;

  // Rifatta o ripresa, l'intervista sta solo nelle pagine che l'hanno chiesta (Preferenze, «Riprendiamola»): le altre,
  // ricaricate o aperte da un collegamento, restano il filo dell'utente (#1297). Il segno sta nell'indirizzo.
  const SEGNO = 'accoglienza';
  function paginaDellIntervista() {
    if (onboardingActive) return true;
    try { return new URLSearchParams(global.location.search).has(SEGNO); } catch (_) { return false; }
  }
  function segnaPagina(si) {
    try {
      const u = new URL(global.location.href);
      if (u.searchParams.has(SEGNO) === si) return;
      if (si) u.searchParams.set(SEGNO, '1');
      else u.searchParams.delete(SEGNO);
      global.history.replaceState(global.history.state, '', u.href);
    } catch (_) {}
  }

  async function fetchOnboarding() {
    try {
      const fuori = !paginaDellIntervista();
      const r = await send({ type: MSG.FILO_GET_ONBOARDING, ...(fuori ? { fuori: true } : {}) });
      // `ready: false` = nessun modello disponibile ancora (niente accesso,
      // niente chiave): l'intervista aspetta e la home spiega come attivare
      // Filo, invece di accoglierlo con una chat che non può rispondere.
      if (!r?.ok || !r.onboarding || !r.ready) return null;
      if (r.onboarding.done) return null;
      if (r.onboarding.rifatta && fuori) return null;
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
    // I segni dei cambi chiesti durante l'intervista sopravvivono al ridisegno (#867).
    const Cambi = global.SN_DASH_CAMBI;
    const segni = Cambi ? Cambi.fotografa(bubblesEl) : [];
    bubblesEl.innerHTML = '';
    // Lo stato viaggia con l'azzeramento: la home lo usa per legare TUTTA
    // l'intervista a una sola chat in archivio (#525), anche quando si svolge
    // su più aperture della scheda.
    resetHistory(state);
    if (thread.length > 1 && Onb?.RESUME_NOTE) bubblesEl.appendChild(stepTrace(Onb.RESUME_NOTE));
    for (const m of thread) {
      const role = m.role === 'filo' ? 'filo' : 'user';
      pushHistory({ role, text: m.text });
      const bolla = makeBubble({ role, text: m.text, markdown: role === 'filo' });
      bubblesEl.appendChild(bolla);
      const scelta = role === 'filo' && m.autonomia ? sceltaAutonomia()
        : (role === 'filo' && m.contatori ? sceltaContatori() : null);
      if (scelta) {
        const wrap = document.createElement('div');
        wrap.className = 'dash-bubble-actions';
        wrap.appendChild(scelta);
        bolla.appendChild(wrap);
      }
    }
    const ultimo = thread[thread.length - 1];
    if (state.fermato && ultimo && ultimo.role !== 'filo' && segnaFermato) segnaFermato();
    if (Cambi && segni.length) Cambi.rimetti(bubblesEl, segni);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // Apre (o riprende) l'intervista. Se l'ultimo messaggio è dell'utente (ha
  // risposto e ha chiuso la finestra prima della risposta), il turno riparte da
  // solo: non deve riscrivere niente.
  async function openOnboarding(state) {
    onboardingActive = true;
    hideOnboardingNotice(); // l'intervista è di nuovo qui: la riga non serve più
    segnaPagina(!!state.rifatta);
    if (allApertura) allApertura();
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
    if (!state) return;
    // Qui l'intervista non è a schermo: la riga segue l'intervista com'è adesso, anche tolta o letta altrove.
    if (!onboardingActive) { if (!closingShownAt) aggiornaRiga(state); return; }
    if (state.done) return;
    if (isSending()) return;
    // L'annuncio del turno appena finito QUI arriva anche dopo la risposta: ridisegnare la stessa conversazione
    // butterebbe via il blocco di attività e i bottoni delle azioni.
    if (giaAschermo && giaAschermo(state)) return;
    renderOnboardingThread(state);
  }

  // ── La scelta dell'autonomia (#1188) ──────────────────────────────────────
  // Filo la mostra sotto la sua domanda, il livello lo sceglie l'utente con le regole di Preferenze (alzarlo vuole
  // «conferma»). Finché la domanda è in sospeso il clic è anche la risposta, e la conversazione va avanti.
  async function livelloSalvato() {
    try {
      const s = await global.SN_STORAGE.getSettings();
      return (s && s.autonomia && s.autonomia.livello) || '';
    } catch (_) { return ''; }
  }

  function mostraFrase(box, id) {
    const A = global.SN_AUTONOMIA;
    const frase = box.querySelector('.dash-autonomia-frase');
    if (frase) frase.textContent = A.infoLivello(id || box.dataset.livello).frase;
  }

  function segnaLivello(box, livello) {
    box.dataset.livello = livello;
    for (const b of box.querySelectorAll('.dash-autonomia-livello')) {
      const scelto = b.dataset.livello === livello;
      b.classList.toggle('scelto', scelto);
      b.setAttribute('aria-pressed', scelto ? 'true' : 'false');
    }
    if (!box.matches(':hover') && !box.contains(document.activeElement)) mostraFrase(box);
  }

  function aggiornaSceltaAutonomia(livello) {
    const A = global.SN_AUTONOMIA;
    if (!A) return;
    for (const box of document.querySelectorAll('.dash-autonomia-scelta')) segnaLivello(box, A.livelloAttivo(livello));
  }

  // Solo se è ancora la domanda in sospeso: dopo un messaggio dell'utente il clic cambia il livello e basta.
  function rispondiConScelta(box, livello) {
    if (!onboardingActive || isSending() || box.dataset.risposto === '1' || !rispondi) return;
    const dopo = [...bubblesEl.querySelectorAll('.dash-bubble-user')]
      .some((u) => box.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (dopo) return;
    if (rispondi(`Scelgo ${global.SN_AUTONOMIA.infoLivello(livello).nome}.`)) box.dataset.risposto = '1';
  }

  async function scegliLivello(box, nuovo) {
    const A = global.SN_AUTONOMIA;
    if (box.dataset.occupato === '1') return;
    box.dataset.occupato = '1';
    try {
      const attuale = A.livelloAttivo((await livelloSalvato()) || box.dataset.livello);
      const serve = A.richiestaCambioLivello(attuale, nuovo);
      if (serve === 'no') return;
      if (serve === 'conferma') {
        const Ui = global.SN_CONFIRM_UI;
        if (!Ui || !(await Ui.confirmTyped(A.confermaAlzata(nuovo)))) return;
      }
      if (nuovo !== attuale) {
        const r = await send({ type: MSG.UPDATE_SETTINGS, settings: { autonomia: { livello: nuovo } } });
        if (!r || r.ok === false) return;
      }
      aggiornaSceltaAutonomia(nuovo);
      rispondiConScelta(box, nuovo);
    } catch (_) {
    } finally {
      delete box.dataset.occupato;
    }
  }

  function sceltaAutonomia(livello) {
    const A = global.SN_AUTONOMIA;
    if (!A) return null;
    const box = document.createElement('div');
    box.className = 'dash-autonomia-scelta';
    const gruppo = document.createElement('div');
    gruppo.className = 'dash-autonomia-livelli';
    gruppo.setAttribute('role', 'group');
    gruppo.setAttribute('aria-label', 'Quanto Filo fa da solo');
    const livelli = A.livelliSelezionabili();
    livelli.forEach((l, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dash-autonomia-livello';
      b.dataset.livello = l.id;
      const tacche = document.createElement('span');
      tacche.className = 'dash-autonomia-tacche';
      tacche.setAttribute('aria-hidden', 'true');
      for (let j = 0; j < livelli.length; j++) {
        const t = document.createElement('span');
        t.className = `dash-autonomia-tacca${j <= i ? ' piena' : ''}`;
        tacche.appendChild(t);
      }
      const nome = document.createElement('span');
      nome.textContent = l.nome;
      b.append(tacche, nome);
      b.addEventListener('click', () => { scegliLivello(box, l.id); });
      b.addEventListener('mouseenter', () => mostraFrase(box, l.id));
      b.addEventListener('focus', () => mostraFrase(box, l.id));
      b.addEventListener('mouseleave', () => mostraFrase(box));
      b.addEventListener('blur', () => mostraFrase(box));
      gruppo.appendChild(b);
    });
    // Il posto della frase misura già la più lunga: se cambiasse altezza al passaggio del cursore, la chat in fondo
    // salterebbe, il pulsante scivolerebbe via da sotto il cursore e il clic andrebbe a vuoto.
    const posto = document.createElement('div');
    posto.className = 'dash-autonomia-frase-posto';
    for (const l of livelli) {
      const misura = document.createElement('span');
      misura.className = 'dash-autonomia-frase-misura';
      misura.setAttribute('aria-hidden', 'true');
      misura.textContent = A.infoLivello(l.id).frase;
      posto.appendChild(misura);
    }
    const frase = document.createElement('div');
    frase.className = 'dash-autonomia-frase';
    frase.setAttribute('aria-live', 'polite');
    posto.appendChild(frase);
    box.append(gruppo, posto);
    segnaLivello(box, A.livelloAttivo(livello));
    // Quello dell'azione può essere di qualche istante fa: vale quello salvato.
    livelloSalvato().then((lv) => { if (lv) segnaLivello(box, A.livelloAttivo(lv)); });
    return box;
  }

  // ── La scelta dei contatori anonimi (#1461) ───────────────────────────────
  // Sì o No sotto la domanda di Filo, come l'autonomia: scrive l'interruttore delle Preferenze e, se la domanda è
  // ancora in sospeso, diventa la risposta. Il No spegne e butta quello che c'era: non parte niente, nemmeno questa.
  async function contatoriSalvati() {
    try {
      const s = await global.SN_STORAGE.getSettings();
      return !(s && s.contatori && s.contatori.attivi === false);
    } catch (_) { return true; }
  }

  function segnaContatori(box, attivi) {
    box.dataset.attivi = attivi ? '1' : '0';
    for (const b of box.querySelectorAll('.dash-contatori-voce')) {
      const scelto = (b.dataset.attivi === '1') === attivi;
      b.classList.toggle('scelto', scelto);
      b.setAttribute('aria-pressed', scelto ? 'true' : 'false');
    }
  }

  function aggiornaSceltaContatori(attivi) {
    for (const box of document.querySelectorAll('.dash-contatori-scelta')) segnaContatori(box, attivi !== false);
  }

  async function scegliContatori(box, attivi) {
    if (box.dataset.occupato === '1') return;
    box.dataset.occupato = '1';
    try {
      const r = await send({ type: MSG.UPDATE_SETTINGS, settings: { contatori: { attivi } } });
      if (!r || r.ok === false) return;
      aggiornaSceltaContatori(attivi);
      if (!onboardingActive || isSending() || box.dataset.risposto === '1' || !rispondi) return;
      const dopo = [...bubblesEl.querySelectorAll('.dash-bubble-user')]
        .some((u) => box.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (dopo) return;
      if (rispondi(attivi ? 'Sì, manda i numeri.' : 'No, non mandare niente.')) box.dataset.risposto = '1';
    } catch (_) {
    } finally {
      delete box.dataset.occupato;
    }
  }

  function sceltaContatori(attivi) {
    const box = document.createElement('div');
    box.className = 'dash-contatori-scelta';
    const gruppo = document.createElement('div');
    gruppo.className = 'dash-contatori-voci';
    gruppo.setAttribute('role', 'group');
    gruppo.setAttribute('aria-label', 'Filo manda numeri senza contenuto per migliorare');
    for (const [si, nome, titolo] of [
      [true, 'Sì', 'Manda i contatori anonimi: solo numeri, mai testi'],
      [false, 'No', 'Non mandare niente'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dash-autonomia-livello dash-contatori-voce';
      b.dataset.attivi = si ? '1' : '0';
      b.textContent = nome;
      b.title = titolo;
      b.addEventListener('click', () => { scegliContatori(box, si); });
      gruppo.appendChild(b);
    }
    box.appendChild(gruppo);
    segnaContatori(box, attivi !== false);
    // Quello dell'azione può essere di qualche istante fa: vale quello salvato.
    contatoriSalvati().then((a) => segnaContatori(box, a));
    return box;
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
  // Una home preparata nascosta (#1128) non prende la ripresa del turno rimasto a metà: la chiede arrivando davanti.
  async function riprendiAllaComparsa() {
    if (!onboardingActive || isSending()) return;
    const state = await fetchOnboarding();
    const thread = (state && state.thread) || [];
    const last = thread[thread.length - 1];
    if (!state || !state.resume || !onboardingActive || isSending() || !last || last.role !== 'user') return;
    beginSending();
    await runTurnAndContinue({ userMessage: last.text });
  }

  async function maybeOpenOnboardingLater() {
    if (onboardingActive || isSending() || !nienteDaInterrompere()) return;
    const state = await fetchOnboarding();
    if (!state || onboardingActive || isSending() || !nienteDaInterrompere()) return;
    await openOnboarding(state);
  }

  // Una chat in cui Filo ha solo risposto «servono i crediti» non è una conversazione in corso: chi ha scritto
  // prima di averli deve vedere Filo presentarsi, non la stessa risposta ferma.
  function nienteDaInterrompere() {
    if (nienteInCorso && nienteInCorso()) return true;
    return Boolean(soloRisposteSenzaCrediti && soloRisposteSenzaCrediti());
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

  // L'annuncio arriva a tutte le schede, ma torna alla home solo quella che mostrava l'intervista: nelle altre c'è la
  // conversazione dell'utente, e rilanciare l'accoglienza non la tocca (#1297).
  function onboardingDone(msg) {
    if (!onboardingActive && !closingShownAt) {
      refreshOnboardingNotice().catch(() => {});
      return;
    }
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
    segnaPagina(false);
    // Il filo si rilegge da capo: l'intervista ne è il primo tratto, e il primo messaggio di Filo sta in coda (#869).
    goHome();
    setSuggestions(Array.isArray(msg?.suggestions) ? msg.suggestions : []);
    // I suggerimenti nati con quel messaggio; se non sono arrivati (chiave assente, provider giù) quelli di sempre.
    if (!msg?.suggestions?.length) loadDashboard().catch(() => {});
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
    aggiornaRiga(st);
  }

  // 'chiusa': finita prima della fine. 'aperta': rifatta e lasciata a metà in un'altra scheda, che magari non c'è più;
  // da qui si riprende come una chiusa.
  function aggiornaRiga(st) {
    if (onboardingActive || !st) { hideOnboardingNotice(); return; }
    const risposto = Array.isArray(st.thread) && st.thread.some((m) => m && m.role === 'user');
    if (st.done && st.notice === 'early') showOnboardingNotice('chiusa');
    else if (!st.done && st.rifatta && risposto) showOnboardingNotice('aperta');
    else hideOnboardingNotice();
  }

  function hideOnboardingNotice() {
    const box = $('onbNotice');
    if (!box) return;
    box.innerHTML = '';
    box.hidden = true;
    delete box.dataset.tipo;
  }

  function showOnboardingNotice(tipo = 'chiusa') {
    const box = $('onbNotice');
    if (!box || (!box.hidden && box.dataset.tipo === tipo)) return; // già a schermo: non la ricostruiamo
    box.innerHTML = '';
    box.dataset.tipo = tipo;
    const text = document.createElement('span');
    text.className = 'dash-onb-notice-text';
    text.textContent = tipo === 'aperta' ? 'La presentazione è rimasta a metà.' : 'Abbiamo chiuso la presentazione a metà.';
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.id = 'onbNoticeRedo';
    redo.textContent = 'Riprendiamola';
    redo.title = 'Riapre l’intervista da dove l’avevamo lasciata. Per rifarla da capo c’è Preferenze.';
    redo.addEventListener('click', riprendiQui);
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

  // Su un'intervista rimasta aperta «No, va bene così» la chiude, come «Salta l'accoglienza» nella sua scheda.
  async function dismissOnboardingNotice() {
    const box = $('onbNotice');
    const aperta = !!box && box.dataset.tipo === 'aperta';
    hideOnboardingNotice();
    try {
      await send(aperta ? { type: MSG.FILO_CLOSE_ONBOARDING, senzaRiga: true } : { type: MSG.FILO_ONBOARDING_NOTICE_SEEN });
    } catch (_) {}
  }

  // Riprenderla da qui, nella scheda che l'utente ha davanti: la stessa intervista, dalla domanda rimasta in sospeso e
  // con quello che Filo ha già imparato (#1297). Da capo la si rifà da Preferenze. Una scheda con una conversazione
  // sua la tiene: l'intervista riparte in una scheda nuova, come da Preferenze, e il turno in sospeso lo prende lei.
  async function riprendiQui() {
    hideOnboardingNotice();
    const altrove = !!(chatInCorso && chatInCorso());
    try {
      const r = await send({ type: MSG.FILO_RESTART_ONBOARDING, riprendi: true, ...(altrove ? { altrove: true } : {}) });
      if (!r?.ok || !r.onboarding || r.onboarding.done) return;
      if (altrove) await send({ type: MSG.OPEN_URL, url: `filo://newtab/?${SEGNO}=1` });
      else await openOnboarding({ ...r.onboarding, resume: !!r.resume });
    } catch (_) {}
  }

  function init(deps) {
    $ = deps.$;
    send = deps.send;
    bubblesEl = deps.bubblesEl;
    threadView = deps.threadView;
    inputEl = deps.inputEl;
    makeBubble = deps.makeBubble;
    stepTrace = deps.stepTrace;
    goHome = deps.goHome;
    goThread = deps.goThread;
    resetHistory = deps.resetHistory;
    pushHistory = deps.pushHistory;
    segnaFermato = deps.segnaFermato || null;
    isSending = deps.isSending;
    giaAschermo = deps.giaAschermo || null;
    beginSending = deps.beginSending;
    runTurnAndContinue = deps.runTurnAndContinue;
    nienteInCorso = deps.nienteInCorso;
    chatInCorso = deps.chatInCorso || null;
    allApertura = deps.allApertura;
    soloRisposteSenzaCrediti = deps.soloRisposteSenzaCrediti;
    setSuggestions = deps.setSuggestions;
    loadDashboard = deps.loadDashboard;
    rispondi = deps.rispondi || null;
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
    riprendiAllaComparsa,
    refreshOnboardingNotice,
    hideOnboardingNotice,
    makeSkipOnboardingBtn,
    sceltaAutonomia,
    aggiornaSceltaAutonomia,
    sceltaContatori,
    aggiornaSceltaContatori,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
