// Handler di dominio: l'agente Filo — chat, dashboard generata, memoria,
// note, timer e notifiche.

module.exports = function register(on, ctx) {
  const {
    MSG, winOf, broadcastLiveUpdate, handleFiloChat, handleFiloGenerateDashboard,
    executeFiloAction, maybeRunCompactor, compitiRecenti, apriFileLocale, compitoPrecedenteDi,
    saveOnboarding, finishOnboarding, claimOnboardingResume,
  } = ctx;
  const FiloMem = globalThis.SN_FILO_MEMORY;
  const FiloState = globalThis.SN_FILO_STATE;
  const Onboarding = globalThis.SN_ONBOARDING;

  // I messaggi che leggono o riscrivono la memoria dell'utente non sono roba da
  // pagine web: il canale `filo:message` è uno solo e ci arrivano anche i
  // content script dei siti visitati (vedi
  // patterns/nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md).
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.FILO_CHAT, async (msg, sender, origin) => {
    try {
      // `compitoRipreso` (#533) tiene in vita il perimetro appena allargato
      // dall'utente: senza, il sì morirebbe col turno in cui l'ha dato.
      // `compitoPrecedente` è il messaggio prima della stessa conversazione: se
      // quello aveva letto roba scritta da altri, questo non riparte a mani
      // libere. Il nome di un compito è una chiave che apre dei permessi:
      // lo accettiamo solo dalle pagine interne, mai da un sito.
      const fidato = isFilo(origin) || !!sender?.isShell;
      const r = await handleFiloChat({
        userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images,
        reasoningReqId: msg.reasoningReqId, internal: !!msg.internal,
        compitoRipreso: fidato ? (msg.compito || null) : null,
        compitoPrecedente: fidato ? (msg.compitoPrecedente || null) : null,
        sender,
      });
      return { ok: true, ...r };
    } catch (e) {
      // #360 — la chat non è un log: se il turno fallisce (rete assente, provider
      // KO, chiave rifiutata) l'utente deve leggere COSA non ha funzionato e cosa
      // fare, non il messaggio grezzo dell'eccezione ("fetch failed"). Il
      // dettaglio tecnico resta qui nei log del main. Senza questo catch l'errore
      // arrivava al gestore IPC generico, che rimanda `e.message` così com'è.
      console.error('[Filo] turno di chat fallito', e);
      const CE = globalThis.SN_CHAT_ERRORS;
      const error = CE ? CE.sentence(e) : 'Qualcosa è andato storto. Riprova.';
      // Le azioni già eseguite prima del guasto: la chat le tiene nello
      // storico, così il tentativo successivo sa cosa era già stato fatto.
      const actions = Array.isArray(e && e.filoActions) ? e.filoActions : [];
      // #533 (quinto giro di verifica) — insieme alle azioni torna il nome
      // della richiesta che si è interrotta: quello che aveva letto resta
      // nella conversazione, e il messaggio dopo deve poterlo ereditare invece
      // di ripartire come se non fosse successo niente.
      const compito = (e && e.filoCompito) || null;
      // Lo status HTTP del provider e se è un rifiuto della CHIAVE (#629: un
      // 403 di moderazione non lo è): la scheda ci mette accanto la strada
      // per la pagina Crediti solo quando è lì che si sistema.
      const W = globalThis.SN_WALLET;
      const keyRefused = Boolean(W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(e));
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN', status: Number(e && e.status) || 0, keyRefused, actions, compito };
    }
  });

  // L'utente ha confermato dal client (popup livello 2 / "conferma" digitata
  // livello 3) un'azione rimasta in sospeso: la eseguiamo ora. Il livello
  // viene RICLASSIFICATO qui dentro (executeFiloAction consulta il registro
  // anche con confirmed:true): un client compromesso non può far eseguire
  // un'azione fuori registro.
  on(MSG.FILO_CONFIRM_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { confirmed: true, sender });
    return { ok: true, ...r };
  });

  // Primo dispatch (non confermato) di una singola azione di Filo richiesta
  // dall'agente "Aiuto" (la sidebar on-page). Passa per lo STESSO
  // executeFiloAction della chat dashboard: stesso registro dei livelli, stesse
  // conferme. Se l'azione è di livello ≥ 2 torna needsConfirm + describe e NON
  // viene eseguita finché la sidebar non rimanda la conferma (FILO_CONFIRM_ACTION).
  // Le azioni fuori registro vengono rifiutate dal dispatch, esattamente come
  // per la chat: la sidebar non è un canale privilegiato.
  on(MSG.FILO_RUN_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { sender });
    return { ok: true, ...r };
  });

  // #533 — il registro dei perimetri è una superficie che racconta cosa Filo
  // poteva fare: da una pagina web non si legge, come tutto ciò che ha potere.
  on(MSG.FILO_GET_COMPITI, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return { ok: true, compiti: await compitiRecenti() };
  });

  // #533 (sesto giro di verifica) — apre davvero il file del bottone «apri il
  // file». Il percorso lo ricontrolla il main con la stessa regola con cui l'ha
  // accettato: un indirizzo web, un percorso di rete o uno schema qualunque non
  // sono un file del computer, e da una pagina web questo messaggio non arriva.
  on(MSG.FILO_OPEN_FILE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const v = apriFileLocale(msg && msg.percorso);
    if (!v.ok) return { ok: false, error: 'Non è un file del tuo computer.' };
    try {
      const { shell } = require('electron');
      const r = await shell.openPath(v.percorso);
      if (r) return { ok: false, error: r };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'apertura fallita' };
    }
  });

  // #533 (settimo giro di verifica) — un collegamento dentro una risposta di
  // Filo. La scritta e l'indirizzo li sceglie il modello, che può aver letto la
  // pagina di qualcun altro: passa dal motore come «apri una pagina», col
  // compito di quella risposta. Di una risposta che il motore non ricorda più
  // non si può dire che non avesse letto niente: `compitoPrecedenteDi`
  // risponde col caso peggiore, e allora si chiede.
  // #533 (ottavo giro di verifica) — lo stesso testo di Filo lo mostrano anche
  // il riquadro «Spiega», la risposta del tasto destro e l'assistente Aiuto,
  // che vivono DENTRO una pagina web: lì il clic apriva l'indirizzo da solo.
  // Da una pagina il collegamento non può nominare una richiesta: il compito è
  // quello di quella pagina, che ha già letto, e lo ricava il dispatch.
  on(MSG.FILO_OPEN_LINK, async (msg, sender, origin) => {
    const url = String((msg && msg.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'non è un indirizzo web' };
    const daPagina = !isFilo(origin) && !sender?.isShell;
    // Senza un nome di richiesta non si sa cosa quella risposta avesse letto:
    // `compitoPrecedenteDi` risponde col caso peggiore, e si chiede.
    const compito = daPagina
      ? null
      : await compitoPrecedenteDi(String((msg && msg.compito) || 'collegamento-senza-richiesta'));
    // Il tasto centrale vuol dire «aprilo dietro, io resto qui»: passa dal
    // motore come ogni altra apertura, ma conserva il gesto (#533, nono giro).
    const azione = { type: 'NAVIGA', url, ...(msg && msg.sfondo ? { background: true } : {}) };
    const r = await executeFiloAction(azione, { sender, compito, daClic: true, confirmed: !!(msg && msg.conferma) });
    if (r && r.needsConfirm) return { ok: true, chiede: true, testo: r.describe || '' };
    return { ok: !!(r && r.executed) };
  });

  on(MSG.FILO_GET_STATE, async () => {
    const { state, stateText } = await FiloState.assemble();
    return { ok: true, state, stateText };
  });

  on(MSG.FILO_GENERATE_DASHBOARD, async (msg, sender) => {
    // Numero di schede web aperte → l'agente può suggerire una pulizia (§6).
    let openTabsCount = 0;
    try {
      const win = winOf(sender);
      if (win && win._filoTabs) {
        openTabsCount = win._filoTabs.tabs.filter(
          (t) => !t.isInternal && /^https?:\/\//i.test(t.url || ''),
        ).length;
      }
    } catch (_) {}
    const r = await handleFiloGenerateDashboard({ force: !!msg.force, openTabsCount });
    return { ok: true, ...r };
  });

  on(MSG.FILO_GET_MEMORY, async () => ({ ok: true, memory: await FiloMem.getMemory() }));

  // Compattazione FORZATA: porta subito il buffer delle lezioni dentro
  // PROFILO/PREFERENZE senza aspettare la soglia. Prima non esisteva alcun modo
  // di chiederla — la chiusura dell'intervista di benvenuto (#524) ne aveva
  // bisogno, e serve a chiunque voglia "fissa adesso quello che hai imparato".
  on(MSG.FILO_COMPACT_MEMORY, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const compacted = await maybeRunCompactor();
    return { ok: true, compacted: !!compacted, memory: await FiloMem.getMemory() };
  });

  // ── Micro-intervista di benvenuto (#524) ─────────────────────────────────
  //
  // La dashboard chiede lo stato all'apertura: se l'intervista è aperta e non è
  // ancora cominciata, la apriamo QUI mettendo da parte il primo messaggio (il
  // testo fisso). Così la conversazione esiste da subito e la ripresa dopo una
  // chiusura a metà legge sempre lo stesso posto. Il segno "già accolto" NON si
  // scrive adesso: si scrive alla fine.
  on(MSG.FILO_GET_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: true, onboarding: { done: true, ticked: [], thread: [] }, ready: false };
    // Senza un modello a disposizione (nessun accesso, nessuna chiave) Filo non
    // può sostenere una conversazione: l'intervista resta in attesa e la home
    // mostra come attivare Filo. Aprirla comunque significherebbe accogliere
    // l'utente con una bolla d'errore. Appena c'è la chiave, parte da sola.
    const settings = await ctx.getEffectiveSettings();
    const ready = !!(settings.apiKeys?.[settings.provider]);
    let state = await FiloMem.getOnboarding();
    // `peek`: chi legge soltanto (Preferenze, per rileggere le interviste
    // conservate) non deve aprire niente né prenotare la ripresa di un turno.
    if (msg?.peek) return { ok: true, onboarding: state, ready, resume: false };
    if (!ready) return { ok: true, onboarding: state, ready: false };
    if (!state.done && !state.thread.length) {
      state = await saveOnboarding(
        Onboarding.appendTurn(state, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
      );
    }
    // Un turno rimasto a metà riparte da solo — ma UNA scheda sola lo riprende.
    // Chi apre una seconda scheda nuova mentre la prima aspetta la risposta
    // riceve `resume: false`: vede la conversazione e si aggiorna con
    // FILO_ONBOARDING_UPDATED, invece di rilanciare lo stesso messaggio.
    const resume = Onboarding.hasPendingTurn(state) && claimOnboardingResume();
    return {
      ok: true,
      ready: true,
      onboarding: state,
      resume,
      welcome: Onboarding.WELCOME_MESSAGE,
      resumeNote: Onboarding.RESUME_NOTE,
    };
  });

  // Rilancio dell'intervista dalle Preferenze, anche dopo settimane: si
  // riparte dal benvenuto, con l'elenco di nuovo tutto da spuntare. Quella di
  // prima finisce nell'archivio (`past`) — rifarla non è cancellarla.
  on(MSG.FILO_RESTART_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const prev = await FiloMem.getOnboarding();
    const state = await saveOnboarding(
      Onboarding.appendTurn(Onboarding.restart(prev), { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
    );
    return { ok: true, onboarding: state };
  });

  // «Salta l'accoglienza»: la via d'uscita che NON passa dal modello. È il
  // gemello della parola di stop, per chi non la ricorda o si trova davanti a
  // una bolla d'errore — senza, chi apre Filo la prima volta senza rete resta
  // chiuso dentro l'intervista con il solo pulsante "Riprova". Chiude,
  // compatta quel poco che ha imparato e manda l'utente alla home.
  on(MSG.FILO_CLOSE_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    if (cur.done) return { ok: true, onboarding: cur, already: true };
    const bye = Onboarding.CLOSING_MESSAGE;
    const state = await saveOnboarding(
      Onboarding.close(Onboarding.appendTurn(cur, { role: 'filo', text: bye })),
    );
    // Niente agente-lezioni: qui non c'è un turno da cui estrarre nulla, ma
    // quello che l'utente aveva già raccontato va comunque messo in memoria.
    finishOnboarding({ lessons: false });
    return { ok: true, onboarding: state, closing: bye };
  });

  // La riga che la home mostra dopo un'accoglienza chiusa a metà è stata letta.
  // Il congedo in chat dura quanto ci mette la home ad arrivare — a volte un
  // istante — e senza quella riga chi non fa in tempo a leggerlo non ha modo di
  // sapere perché Filo ha smesso di presentarsi, né che si può rifare.
  on(MSG.FILO_ONBOARDING_NOTICE_SEEN, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    return { ok: true, onboarding: await saveOnboarding(Onboarding.dismissNotice(cur)) };
  });

  // Gli appunti non hanno più un archivio proprio (né quindi handler CRUD): sono
  // file dell'editor, ci scrive l'azione SALVA_APPUNTO e si leggono/modificano
  // aprendo l'editor come qualsiasi altro documento.

  on(MSG.FILO_GET_TIMERS, async () => ({ ok: true, timers: await FiloMem.gcTimers() }));

  on(MSG.FILO_ADD_TIMER, async (msg) => {
    const t = await FiloMem.addTimer({ label: msg.label, seconds: msg.seconds });
    if (t) broadcastLiveUpdate();
    return { ok: true, timer: t };
  });

  on(MSG.FILO_DELETE_TIMER, async (msg) => {
    const list = await FiloMem.deleteTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  });

  on(MSG.FILO_PAUSE_TIMER, async (msg) => {
    const list = await FiloMem.pauseTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  });

  on(MSG.FILO_RESUME_TIMER, async (msg) => {
    const list = await FiloMem.resumeTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  });

  on(MSG.FILO_STOP_TIMER_ALARM, async (msg) => {
    const list = await FiloMem.stopTimerAlarm(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  });

  on(MSG.FILO_GET_NOTIFICATIONS, async () => ({ ok: true, notifications: await FiloMem.listNotifications() }));

  on(MSG.FILO_DISMISS_NOTIFICATION, async (msg) => {
    const list = await FiloMem.dismissNotification(msg.id, { acted: !!msg.acted });
    broadcastLiveUpdate();
    return { ok: true, notifications: list.filter((n) => !n.dismissed) };
  });

  // F4 — Annulla un auto-feedback appena inviato (undo dal toast).
  // Marca il feedback come `ignored` via updateStatus. Usa l'ID token admin se
  // disponibile (l'utente è loggato come owner); se non loggato l'undo non può
  // scrivere su Firestore (le rules richiedono admin per update) — non è un errore
  // fatale: l'auto-feedback rimane in stato `new` ma finisce solo nell'Agente tab.
  on(MSG.CANCEL_AUTO_FEEDBACK, async (msg) => {
    const id = String(msg && msg.id || '').trim();
    if (!id) return { ok: false, error: 'id mancante' };
    const FB = globalThis.SN_FEEDBACK;
    if (!FB || typeof FB.updateStatus !== 'function') return { ok: false, error: 'FB non disponibile' };
    try {
      const auth = require('../../auth/google-auth');
      const idToken = await auth.getIdToken().catch(() => null);
      await FB.updateStatus(id, { status: 'ignored', notes: 'Annullato dall\'utente (undo toast F4)' }, { idToken: idToken || undefined });
      return { ok: true };
    } catch (e) {
      console.warn('[F4] cancel auto-feedback fallito:', e?.message || e);
      // Non un errore fatale: il feedback rimane ma non interferisce con il triage.
      return { ok: false, error: e?.message || String(e) };
    }
  });
};
