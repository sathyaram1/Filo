// Handler di dominio: l'agente Filo — chat, dashboard generata, memoria,
// note, timer e notifiche.

module.exports = function register(on, ctx) {
  const {
    MSG, winOf, broadcastLiveUpdate, handleFiloChat, handleFiloGenerateDashboard,
    executeFiloAction, maybeRunCompactor,
  } = ctx;
  const FiloMem = globalThis.SN_FILO_MEMORY;
  const FiloState = globalThis.SN_FILO_STATE;
  const Onboarding = globalThis.SN_ONBOARDING;

  // I messaggi che leggono o riscrivono la memoria dell'utente non sono roba da
  // pagine web: il canale `filo:message` è uno solo e ci arrivano anche i
  // content script dei siti visitati (PATTERNS.md → "Nuovo tipo di messaggio").
  const isFilo = (origin) => String(origin || '').startsWith('filo://');

  on(MSG.FILO_CHAT, async (msg, sender) => {
    try {
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images, reasoningReqId: msg.reasoningReqId, internal: !!msg.internal, sender });
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
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN' };
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
    const ready = !!(settings.apiKeys?.[settings.provider] || settings.apiKeys?.gemini);
    let state = await FiloMem.getOnboarding();
    if (!ready) return { ok: true, onboarding: state, ready: false };
    if (!state.done && !state.thread.length) {
      state = await FiloMem.setOnboarding(
        Onboarding.appendTurn(state, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
      );
    }
    return {
      ok: true,
      onboarding: state,
      welcome: Onboarding.WELCOME_MESSAGE,
      resumeNote: Onboarding.RESUME_NOTE,
    };
  });

  // Rilancio dell'intervista dalle Preferenze, anche dopo settimane: si
  // riparte dal benvenuto, con l'elenco di nuovo tutto da spuntare.
  on(MSG.FILO_RESTART_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const state = await FiloMem.setOnboarding(
      Onboarding.appendTurn(Onboarding.restart(), { role: 'filo', text: Onboarding.WELCOME_MESSAGE }),
    );
    return { ok: true, onboarding: state };
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
