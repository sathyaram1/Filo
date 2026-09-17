// Handler di dominio: l'agente Filo — chat, dashboard generata, memoria,
// note, timer e notifiche.

module.exports = function register(on, ctx) {
  const {
    MSG, winOf, broadcastLiveUpdate, handleFiloChat, handleFiloGenerateDashboard,
    executeFiloAction, maybeRunCompactor,
    saveOnboarding, finishOnboarding, claimOnboardingResume,
  } = ctx;
  const FiloMem = globalThis.SN_FILO_MEMORY;
  const FiloState = globalThis.SN_FILO_STATE;
  const Onboarding = globalThis.SN_ONBOARDING;

  // Memoria dell'utente: non è roba da pagine web, e sul canale `filo:message` arrivano
  // anche i content script dei siti. Confine d'origine: vedi handlers/origine.js.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.FILO_CHAT, async (msg, sender) => {
    try {
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images, reasoningReqId: msg.reasoningReqId, internal: !!msg.internal, sender });
      return { ok: true, ...r };
    } catch (e) {
      // La chat non è un log: a turno fallito l'utente deve leggere cosa non ha funzionato, non il
      // messaggio grezzo dell'eccezione che il gestore IPC generico rimanderebbe.
      console.error('[Filo] turno di chat fallito', e);
      const CE = globalThis.SN_CHAT_ERRORS;
      const error = CE ? CE.sentence(e) : 'Qualcosa è andato storto. Riprova.';
      // Le azioni già eseguite restano nello storico: il tentativo dopo sa cosa era stato fatto.
      const actions = Array.isArray(e && e.filoActions) ? e.filoActions : [];
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN', actions };
    }
  });

  // Il livello si riclassifica qui dentro anche con `confirmed`: un client compromesso non può
  // far eseguire un'azione fuori registro.
  on(MSG.FILO_CONFIRM_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { confirmed: true, sender });
    return { ok: true, ...r };
  });

  // Passa dallo STESSO executeFiloAction della chat: stesso registro, stesse conferme. La
  // sidebar non è un canale privilegiato.
  on(MSG.FILO_RUN_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { sender });
    return { ok: true, ...r };
  });

  on(MSG.FILO_GET_STATE, async () => {
    const { state, stateText } = await FiloState.assemble();
    return { ok: true, state, stateText };
  });

  on(MSG.FILO_GENERATE_DASHBOARD, async (msg, sender) => {
    // Serve all'agente per suggerire una pulizia delle schede.
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

  // Compattazione forzata: porta il buffer delle lezioni in PROFILO/PREFERENZE senza aspettare
  // la soglia, per la chiusura dell'intervista e per «fissa adesso quello che hai imparato».
  on(MSG.FILO_COMPACT_MEMORY, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const compacted = await maybeRunCompactor();
    return { ok: true, compacted: !!compacted, memory: await FiloMem.getMemory() };
  });

  // L'intervista si apre QUI mettendo da parte il primo messaggio: la conversazione esiste
  // da subito e la ripresa legge sempre lo stesso posto. Il segno «accolto» arriva alla fine.
  on(MSG.FILO_GET_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: true, onboarding: { done: true, ticked: [], thread: [] }, ready: false };
    // Senza un modello Filo non conversa: l'intervista attende e la home mostra come attivarlo,
    // invece di accogliere l'utente con una bolla d'errore. Appena c'è la chiave parte da sola.
    const settings = await ctx.getEffectiveSettings();
    const ready = !!(settings.apiKeys?.[settings.provider]);
    let state = await FiloMem.getOnboarding();
    // `peek`: chi legge soltanto non deve aprire niente né prenotare la ripresa di un turno.
    if (msg?.peek) return { ok: true, onboarding: state, ready, resume: false };
    if (!ready) return { ok: true, onboarding: state, ready: false };
    if (!state.done && !state.thread.length) {
      state = await saveOnboarding(
        Onboarding.appendTurn(state, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
      );
    }
    // Un turno a metà lo riprende UNA scheda sola: le altre ricevono `resume:false` e si
    // aggiornano dall'annuncio, invece di rilanciare lo stesso messaggio.
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

  // Rifare l'intervista non è cancellarla: si riparte dal benvenuto con l'elenco da spuntare,
  // e quella di prima finisce in archivio.
  on(MSG.FILO_RESTART_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const prev = await FiloMem.getOnboarding();
    const state = await saveOnboarding(
      Onboarding.appendTurn(Onboarding.restart(prev), { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
    );
    return { ok: true, onboarding: state };
  });

  // La via d'uscita che NON passa dal modello: senza, chi apre Filo la prima volta senza rete
  // resta chiuso nell'intervista col solo pulsante «Riprova».
  on(MSG.FILO_CLOSE_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    if (cur.done) return { ok: true, onboarding: cur, already: true };
    const bye = Onboarding.CLOSING_MESSAGE;
    const state = await saveOnboarding(
      Onboarding.close(Onboarding.appendTurn(cur, { role: 'filo', text: bye })),
    );
    // Niente agente-lezioni: non c'è un turno da cui estrarre, ma quanto l'utente ha già
    // raccontato va in memoria lo stesso.
    finishOnboarding({ lessons: false });
    return { ok: true, onboarding: state, closing: bye };
  });

  // Il congedo in chat dura quanto ci mette la home ad arrivare: senza questa riga chi non fa
  // in tempo a leggerlo non sa perché Filo ha smesso, né che si può rifare.
  on(MSG.FILO_ONBOARDING_NOTICE_SEEN, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    return { ok: true, onboarding: await saveOnboarding(Onboarding.dismissNotice(cur)) };
  });

  // Gli appunti sono file dell'editor: ci scrive l'azione SALVA_APPUNTO, si leggono da lì.

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

  // Undo di un auto-feedback: senza login non si può scrivere su Firestore (le regole vogliono
  // admin), e non è fatale — il feedback resta `new` e finisce solo nella tab Agente.
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
      // Non è un errore fatale: il feedback rimane ma non interferisce col triage.
      return { ok: false, error: e?.message || String(e) };
    }
  });
};
