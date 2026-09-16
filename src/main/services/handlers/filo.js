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

  // I messaggi che leggono o riscrivono la memoria dell'utente non sono roba da pagine web: il canale `filo:message` è uno solo e ci arrivano anche i content script dei siti visitati (vedi patterns/nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md).
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.FILO_CHAT, async (msg, sender) => {
    try {
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images, reasoningReqId: msg.reasoningReqId, internal: !!msg.internal, sender });
      return { ok: true, ...r };
    } catch (e) {
      // #360 — la chat non è un log: se il turno fallisce l'utente deve leggere COSA non ha funzionato e cosa fare, non il messaggio grezzo dell'eccezione. Senza questo catch l'errore arriva al gestore IPC generico, che rimanda `e.message` così com'è.
      console.error('[Filo] turno di chat fallito', e);
      const CE = globalThis.SN_CHAT_ERRORS;
      const error = CE ? CE.sentence(e) : 'Qualcosa è andato storto. Riprova.';
      // Le azioni già eseguite prima del guasto restano nello storico della chat, così il tentativo successivo sa cosa era già stato fatto.
      const actions = Array.isArray(e && e.filoActions) ? e.filoActions : [];
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN', actions };
    }
  });

  // Esecuzione di un'azione che l'utente ha confermato dal client. Il livello viene RICLASSIFICATO qui dentro (executeFiloAction consulta il registro anche con confirmed:true): un client compromesso non può far eseguire un'azione fuori registro.
  on(MSG.FILO_CONFIRM_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { confirmed: true, sender });
    return { ok: true, ...r };
  });

  // Primo dispatch di un'azione chiesta dall'agente "Aiuto": passa per lo STESSO executeFiloAction della chat — stesso registro dei livelli, stesse conferme, e le azioni fuori registro sono rifiutate. La sidebar non è un canale privilegiato.
  on(MSG.FILO_RUN_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { sender });
    return { ok: true, ...r };
  });

  on(MSG.FILO_GET_STATE, async () => {
    const { state, stateText } = await FiloState.assemble();
    return { ok: true, state, stateText };
  });

  on(MSG.FILO_GENERATE_DASHBOARD, async (msg, sender) => {
    // Numero di schede web aperte: l'agente può suggerire una pulizia (§6).
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

  // Compattazione FORZATA: porta subito il buffer delle lezioni dentro PROFILO/PREFERENZE senza aspettare la soglia. Serve alla chiusura dell'intervista di benvenuto (#524) e a chiunque voglia "fissa adesso quello che hai imparato".
  on(MSG.FILO_COMPACT_MEMORY, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const compacted = await maybeRunCompactor();
    return { ok: true, compacted: !!compacted, memory: await FiloMem.getMemory() };
  });

  // Micro-intervista di benvenuto (#524): se è aperta e non è ancora cominciata la si apre QUI, mettendo da parte il primo messaggio, così la conversazione esiste da subito e la ripresa dopo una chiusura a metà legge sempre lo stesso posto. Il segno "già accolto" si scrive alla fine, non adesso.
  on(MSG.FILO_GET_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: true, onboarding: { done: true, ticked: [], thread: [] }, ready: false };
    // Senza un modello a disposizione Filo non può sostenere una conversazione: l'intervista resta in attesa e la home mostra come attivarlo, invece di accogliere l'utente con una bolla d'errore. Appena c'è la chiave parte da sola.
    const settings = await ctx.getEffectiveSettings();
    const ready = !!(settings.apiKeys?.[settings.provider]);
    let state = await FiloMem.getOnboarding();
    // `peek`: chi legge soltanto (Preferenze, per rileggere le interviste conservate) non deve aprire niente né prenotare la ripresa di un turno.
    if (msg?.peek) return { ok: true, onboarding: state, ready, resume: false };
    if (!ready) return { ok: true, onboarding: state, ready: false };
    if (!state.done && !state.thread.length) {
      state = await saveOnboarding(
        Onboarding.appendTurn(state, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
      );
    }
    // Un turno rimasto a metà riparte da solo, ma lo riprende UNA scheda sola: chi ne apre una seconda riceve `resume: false`, vede la conversazione e si aggiorna con FILO_ONBOARDING_UPDATED invece di rilanciare lo stesso messaggio.
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

  // Rilancio dell'intervista dalle Preferenze: si riparte dal benvenuto con l'elenco di nuovo tutto da spuntare, e quella di prima finisce in archivio — rifarla non è cancellarla.
  on(MSG.FILO_RESTART_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const prev = await FiloMem.getOnboarding();
    const state = await saveOnboarding(
      Onboarding.appendTurn(Onboarding.restart(prev), { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
    );
    return { ok: true, onboarding: state };
  });

  // «Salta l'accoglienza»: la via d'uscita che NON passa dal modello, gemella della parola di stop. Senza, chi apre Filo la prima volta senza rete resta chiuso dentro l'intervista col solo pulsante "Riprova".
  on(MSG.FILO_CLOSE_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    if (cur.done) return { ok: true, onboarding: cur, already: true };
    const bye = Onboarding.CLOSING_MESSAGE;
    const state = await saveOnboarding(
      Onboarding.close(Onboarding.appendTurn(cur, { role: 'filo', text: bye })),
    );
    // Niente agente-lezioni: qui non c'è un turno da cui estrarre nulla, ma quello che l'utente aveva già raccontato va comunque messo in memoria.
    finishOnboarding({ lessons: false });
    return { ok: true, onboarding: state, closing: bye };
  });

  // Il congedo in chat dura quanto ci mette la home ad arrivare, a volte un istante: senza questa riga chi non fa in tempo a leggerlo non sa perché Filo ha smesso di presentarsi, né che si può rifare.
  on(MSG.FILO_ONBOARDING_NOTICE_SEEN, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    return { ok: true, onboarding: await saveOnboarding(Onboarding.dismissNotice(cur)) };
  });

  // Gli appunti non hanno più un archivio proprio (né handler CRUD): sono file dell'editor, ci scrive l'azione SALVA_APPUNTO e si leggono o modificano aprendo l'editor.

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

  // F4 — annulla un auto-feedback appena inviato (undo dal toast), marcandolo `ignored`. Se l'utente non è loggato l'undo non può scrivere su Firestore (le regole vogliono admin): non è fatale, il feedback resta `new` e finisce solo nella tab Agente.
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
