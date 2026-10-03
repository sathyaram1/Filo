// Handler di dominio: l'agente Filo — chat, dashboard generata, memoria,
// note, timer e notifiche.

module.exports = function register(on, ctx) {
  const {
    MSG, winOf, broadcastLiveUpdate, handleFiloChat, handleFiloGenerateDashboard,
    executeFiloAction, controllaUscita, apriDaFilo, SCHEMI_USCITA, ricordaLettoInChat, maybeRunCompactor, closeAndTriageChat,
    archiviaCongedoAccoglienza,
    saveOnboarding, finishOnboarding, claimOnboardingResume,
  } = ctx;
  const FiloMem = globalThis.SN_FILO_MEMORY;
  const FiloState = globalThis.SN_FILO_STATE;
  const Onboarding = globalThis.SN_ONBOARDING;
  const FiloChats = globalThis.SN_FILO_CHATS;
  const ChatArchive = globalThis.SN_CHAT_ARCHIVE;

  // I messaggi che leggono o riscrivono la memoria dell'utente non sono roba da
  // pagine web: il canale `filo:message` è uno solo e ci arrivano anche i
  // content script dei siti visitati (vedi
  // patterns/nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md).
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // Chat, memoria, timer e notifiche li usano solo le pagine di Filo: la chat risponde con lo stato intero (#589.12).
  const soloFilo = (fn) => (msg, sender, origin) => (
    isFilo(origin) ? fn(msg, sender, origin) : { ok: false, code: 'forbidden', error: 'forbidden' });

  // Quello che l'utente ha scritto nella conversazione dell'assistente di pagina: un codice
  // scritto da lui può uscire (#810).
  const paroleDa = (msg) => (Array.isArray(msg && msg.parole) ? msg.parole : [])
    .filter((x) => typeof x === 'string').join('\n').slice(-200000);

  // #525 — «l'elenco delle chat è cambiato». Lo ascolta la Cronologia aperta.
  const annunciaChat = () => {
    try { ctx.broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }); } catch (_) {}
  };

  on(MSG.FILO_CHAT, soloFilo(async (msg, sender) => {
    let fineLavoro = () => {};
    try {
      // #525 — `chatId` è la targa della conversazione in corso: il main ci
      // scrive dentro il messaggio dell'utente e la risposta, turno per turno.
      const chatId = msg.chatId || null;
      fineLavoro = require('../lavoriInCorso').inizia({ tipo: 'risposta', chat: chatId, testo: msg.userMessage, wc: sender && sender.wc, ambito: ctx.ambitoDellaFinestra(sender && sender.win) });
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images, reasoningReqId: msg.reasoningReqId, internal: !!msg.internal, daModello: !!msg.daModello, chatId, sender });
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
      // Lo status HTTP del provider e se è un rifiuto della CHIAVE (#629: un
      // 403 di moderazione non lo è): la scheda ci mette accanto la strada
      // per la pagina Crediti solo quando è lì che si sistema.
      const W = globalThis.SN_WALLET;
      const keyRefused = Boolean(W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(e));
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN', status: Number(e && e.status) || 0, keyRefused, actions };
    } finally {
      fineLavoro();
    }
  }));

  // L'utente ha confermato dal client (popup livello 2 / "conferma" digitata
  // livello 3) un'azione rimasta in sospeso: la eseguiamo ora. Il livello
  // viene RICLASSIFICATO qui dentro (executeFiloAction consulta il registro
  // anche con confirmed:true): un client compromesso non può far eseguire
  // un'azione fuori registro.
  on(MSG.FILO_CONFIRM_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { confirmed: true, sender, assistente: msg.assistente === true, parole: paroleDa(msg) });
    return { ok: true, ...r };
  });

  // #867 — il segno sulla bolla chiede come stanno i suoi cambi, e il suo «annulla» li rimette com'erano.
  const Registro = require('../registroCambi');
  const { soloFilo: soloDaFilo } = require('./origine');
  on(MSG.CAMBI_LEGGI, soloDaFilo(async (msg) => {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String);
    return { ok: true, eventi: await Registro.leggi(ids) };
  }));
  on(MSG.CAMBI_ANNULLA, soloDaFilo(async (msg) => {
    const id = String((msg && msg.id) || '').trim();
    if (!id) return { ok: false, error: 'manca il cambio' };
    const r = await Registro.annulla(id, Registro.corrente() || { via: 'interfaccia' });
    return r.ok ? { ok: true, id: r.id, eventi: r.eventi, saltati: r.saltati } : { ok: false, error: r.motivo };
  }));

  // Primo dispatch (non confermato) di una singola azione di Filo richiesta
  // dall'agente "Aiuto" (la sidebar on-page). Passa per lo STESSO
  // executeFiloAction della chat dashboard: stesso registro dei livelli, stesse
  // conferme. Se l'azione è di livello ≥ 2 torna needsConfirm + describe e NON
  // viene eseguita finché la sidebar non rimanda la conferma (FILO_CONFIRM_ACTION).
  // Le azioni fuori registro vengono rifiutate dal dispatch, esattamente come
  // per la chat: la sidebar non è un canale privilegiato.
  on(MSG.FILO_RUN_ACTION, async (msg, sender) => {
    const r = await executeFiloAction(msg.action, { sender, assistente: true, parole: paroleDa(msg) });
    return { ok: true, ...r };
  });

  // Un indirizzo che un modello ha proposto in una pagina di Filo (un collegamento in una risposta, anche di posta, un
  // bottone, un suggerimento della home) si apre solo dopo la porta delle uscite (#810). La frase torna a chi ha cliccato.
  on(MSG.FILO_APRI_PROPOSTA, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const url = String((msg && msg.url) || '').trim();
    const web = /^https?:/i.test(url);
    if (!SCHEMI_USCITA.test(url) || (web && !/^https?:\/\//i.test(url))) return { ok: false, error: 'indirizzo non ammesso' };
    const win = winOf(sender);
    const r = await apriDaFilo(url, {
      wc: sender?.wc, parole: paroleDa(msg), avvisa: false, apri: () => { if (win?._filoTabs) win._filoTabs.openTab(url); },
    });
    return { ok: true, ...r };
  });

  // Dentro una pagina web un window.open dei content script non si distingue da quelli della pagina: i collegamenti
  // che un modello scrive lì (assistente di pagina, Spiega, richiesta rapida) li apre il main, dopo la porta (#810).
  on(MSG.APRI_COLLEGAMENTO_FILO, async (msg, sender, origin) => {
    const url = String((msg && msg.url) || '').trim();
    if (!SCHEMI_USCITA.test(url) || (/^https?:/i.test(url) && !/^https?:\/\//i.test(url))) return { ok: false, error: 'indirizzo non ammesso' };
    const tm = winOf(sender)?._filoTabs;
    const avvisato = isFilo(origin);
    let pagina = '';
    try { pagina = sender?.wc ? String(sender.wc.getURL() || '') : ''; } catch (_) {}
    const r = await apriDaFilo(url, {
      wc: sender?.wc, parole: paroleDa(msg), avvisa: avvisato,
      apri: () => { if (tm) tm.apriDaCollegamento(url, { fromUrl: pagina, sfondo: !!(msg && msg.sfondo) }); },
    });
    return { ok: true, ...r, avvisato };
  });

  // Il testo che l'assistente di pagina propone per un campo della pagina esce verso il sito: passa dalla porta
  // delle uscite prima di comparire (#810). Torna solo il verdetto e la frase, mai il segreto.
  on(MSG.CONTROLLA_CAMPO, async (msg, sender) => {
    const testo = String((msg && msg.testo) || '');
    if (!testo.trim()) return { ok: true, blocca: false };
    const u = await controllaUscita({ type: 'CAMPO_PAGINA', testo }, { sender, parole: paroleDa(msg) });
    return { ok: true, blocca: !!u.blocca, frase: u.blocca ? u.frase : '' };
  });

  // Lo stato porta schede aperte, notifiche e il messaggio della home con le pagine salvate: a un sito non si dà (#589.12).
  on(MSG.FILO_GET_STATE, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const { state, stateText } = await FiloState.assemble();
    return { ok: true, state, stateText };
  });

  // Il nome della rete e dei dispositivi dicono dove sei e cosa hai addosso: a un sito non si danno.
  on(MSG.SISTEMA_STATO, soloFilo(async (msg) => {
    const Sistema = require('../statoSistema');
    Sistema.richiedi();
    // La pagina che ha visto cadere o tornare la rete non aspetta il giro: la lettura nuova arriva con l'annuncio.
    if (msg && msg.subito === true) Sistema.leggiAdesso();
    return { ok: true, stato: Sistema.stato() };
  }));

  on(MSG.FILO_GENERATE_DASHBOARD, async (msg, sender, origin) => {
    // Il messaggio della home mette in fila le pagine salvate: a un sito non si dà, come il loro elenco (#589.12).
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
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

  on(MSG.FILO_GET_MEMORY, soloFilo(async () => ({ ok: true, memory: await FiloMem.getMemory() })));

  // Rileggere e togliere una riga di memoria alla volta (#592): è il posto dove
  // l'utente controlla quello che entra in ogni conversazione. Leggere o
  // riscrivere la memoria non è roba di una pagina visitata.
  on(MSG.FILO_MEMORY_VIEW, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return { ok: true, ...(await FiloMem.viewForUser()) };
  });

  on(MSG.FILO_MEMORY_FORGET, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const lezione = msg && msg.lezione && typeof msg.lezione === 'object';
    const riga = msg && typeof msg.modulo === 'string' && typeof msg.riga === 'string';
    if (!lezione && !riga) return { ok: false, error: 'bad_request' };
    return { ok: true, tolta: await FiloMem.forgetLine(msg) };
  });

  // Compattazione FORZATA: porta subito il buffer delle lezioni dentro
  // PROFILO/PREFERENZE senza aspettare la soglia. Prima non esisteva alcun modo
  // di chiederla — la chiusura dell'intervista di benvenuto (#524) ne aveva
  // bisogno, e serve a chiunque voglia "fissa adesso quello che hai imparato".
  on(MSG.FILO_COMPACT_MEMORY, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const compacted = await maybeRunCompactor();
    return { ok: true, compacted: !!compacted, memory: await FiloMem.getMemory() };
  });

  // ── Archivio delle chat con Filo (#525) ──────────────────────────────────
  //
  // Le conversazioni dell'utente sono private come la memoria: solo pagine
  // filo://, mai i content script dei siti visitati (vedi
  // patterns/nuovo-tipo-di-messaggio-decidi-subito-se-le-pagine-web.md).
  on(MSG.FILO_CHATS_LIST, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return { ok: true, chats: await FiloChats.listIndex() };
  });

  on(MSG.FILO_CHAT_GET, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const chat = await FiloChats.get(msg.id);
    // Riaperta (anche dopo un riavvio), la chat torna a dire cosa aveva letto da fuori prima di ogni clic (#810).
    try { ricordaLettoInChat([], (chat && chat.messages) || []); } catch (_) {}
    return { ok: true, chat };
  });

  // Chiusura di una chat. La risposta NON aspetta il classificatore: chi ha
  // appena premuto "nuova chat" non deve stare fermo mentre un modello legge
  // la conversazione di prima. Titolo e tipo arrivano in Cronologia poco dopo.
  on(MSG.FILO_CHAT_CLOSE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const id = msg.id;
    if (!id) return { ok: false, error: 'id mancante' };
    closeAndTriageChat(id)
      // La Cronologia può essere aperta in un'altra scheda mentre qui si
      // finisce di chattare: l'annuncio la fa riallineare da sola, invece di
      // lasciarla ferma a com'era e far credere che la chat non si sia
      // salvata. Parte a classificazione finita, così la riga arriva già col
      // titolo e col tipo giusti.
      .then(() => annunciaChat())
      .catch((e) => console.warn('[Filo] chiusura chat:', e?.message || e));
    return { ok: true };
  });

  on(MSG.FILO_CHAT_DELETE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    await FiloChats.remove(msg.id);
    // #525 — la conversazione cancellata può essere ancora a schermo in
    // un'altra scheda. Se nessuno glielo dice, quella scheda continua a
    // scrivere sulla stessa targa e la chat RINASCE: stessa targa, i messaggi
    // di prima persi, e di nuovo in Cronologia. L'utente aveva chiesto il
    // contrario. La scheda che la sta vivendo se ne libera e il messaggio dopo
    // apre una conversazione nuova, con una targa sua.
    ctx.dimenticaChat(msg.id);
    try { ctx.broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED, cancellata: msg.id }); } catch (_) {}
    return { ok: true, chats: await FiloChats.listIndex() };
  });

  // #525 — una riga che Filo ha scritto in chat senza passare da un modello
  // (la risposta a un comando con lo slash). Fino a ieri restava solo sullo
  // schermo: riaprendo la chat dall'archivio quella riga non c'era più, e la
  // conversazione si rileggeva con un buco in mezzo.
  on(MSG.FILO_CHAT_NOTE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const id = msg.id;
    const text = String(msg.text || '');
    // Un'azione confermata dopo il turno (bottone, pannello): la riga senza testo che la racconta.
    const actions = (Array.isArray(msg.actions) ? msg.actions : [])
      .filter((t) => typeof t === 'string' && /^[A-Z_]{2,40}$/.test(t)).slice(0, 20).map((type) => ({ type }));
    if (!id || (!text.trim() && !actions.length)) return { ok: false, error: 'niente da archiviare' };
    // La scheda che scrive questa riga sta vivendo la chat: quando sparisce,
    // la chat è finita — come per un turno normale.
    if (sender && sender.wc) ctx.affidaChat(id, sender.wc);
    const role = msg.role === 'user' ? 'user' : 'filo';
    // L'esito di un comando lanciato a mano l'ha scritto il comando: riaperta, la chat lo tratta da letto (#810).
    // Così il nome di un file scaricato, che sceglie il sito, quando una carta della home lo porta nel filo (#870).
    const ESTERNI = { comando: "dall'output di un comando", download: 'dal nome di un file scaricato' };
    const esterno = role === 'filo' && Object.hasOwn(ESTERNI, msg.esterno) ? ESTERNI[msg.esterno] : '';
    // I cambi di stato di un'azione confermata dopo il turno (#867): riaperta, la bolla ritrova il segno.
    const cambi = (Array.isArray(msg.cambi) ? msg.cambi : []).filter((c) => typeof c === 'string');
    await FiloChats.append(id, {
      role, text, ...(actions.length ? { actions } : {}), ...(esterno ? { esterno } : {}), ...(cambi.length ? { cambi } : {}),
    });
    return { ok: true };
  });

  // #525 — titolo e tipo scelti a mano dall'utente (menu del tasto destro in
  // Cronologia). Da qui in poi il classificatore non li riscrive più.
  on(MSG.FILO_CHAT_UPDATE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!msg.id) return { ok: false, error: 'id mancante' };
    const chat = await FiloChats.setUserTriage(msg.id, { title: msg.title, kind: msg.kind });
    if (!chat) return { ok: false, error: 'chat inesistente' };
    // Le altre schede che hanno la Cronologia aperta vedono il nome nuovo.
    try { ctx.broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }); } catch (_) {}
    return { ok: true, chats: await FiloChats.listIndex() };
  });

  // #525 — la conversazione che l'utente ha cliccato in Cronologia è ancora
  // aperta in una scheda: lo portiamo lì. Aprirne una seconda copia significa
  // due schede sulla stessa chat che non si vedono fra loro.
  on(MSG.FILO_CHAT_FOCUS, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return { ok: true, portato: ctx.portaAllaChat(msg.id) };
  });

  on(MSG.FILO_CHATS_SEARCH, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const all = await FiloChats.list();
    // Una frase intera ("discussione sulla coscienza") non deve dare zero
    // risultati quando la chat c'è: se pretendere tutte le parole non trova
    // niente, la ricerca si allarga alle parole che distinguono e lo DICE
    // (`termini`), così la pagina può scrivere con che cosa ha trovato.
    const { results, termini, allargata } = ChatArchive.searchWide(all, msg.query, {
      kind: msg.kind || null,
      onlyVisible: !!msg.onlyVisible,
      limit: Number(msg.limit) || 0,
    });
    // L'estratto diventa il frammento attorno a ciò che si cercava: è quello
    // che spiega perché la chat è nel risultato.
    const q = termini.join(' ');
    const chats = results.map((c) => {
      const entry = ChatArchive.toIndexEntry(c);
      if (entry && q) entry.excerpt = ChatArchive.snippetFor(c, q);
      return entry;
    }).filter(Boolean);
    return { ok: true, chats, termini, allargata };
  });

  // #866 — le pagine visitate del filo: quante sono in un periodo, e cancellarle (pagina Sicurezza).
  const periodoDa = (msg) => globalThis.SN_FILO_EVENTI.periodo(msg && msg.periodo);
  on(MSG.FILO_PAGINE_CONTA, soloFilo(async (msg) => {
    const periodo = periodoDa(msg);
    if (!periodo) return { ok: false, error: 'periodo sconosciuto' };
    return { ok: true, n: (await globalThis.SN_IL_FILO.pagine(periodo)).length };
  }));

  on(MSG.FILO_PAGINE_CANCELLA, soloFilo(async (msg) => {
    const periodo = periodoDa(msg);
    if (!periodo) return { ok: false, error: 'periodo sconosciuto' };
    return { ok: true, n: await globalThis.SN_IL_FILO.cancellaPagine(periodo) };
  }));

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
    // #525 — il congedo lo legge l'utente, quindi lo deve ritrovare rileggendo
    // l'intervista. La targa della chat la calcola il modulo dell'intervista,
    // lo stesso che usa la home per mandare i turni.
    await archiviaCongedoAccoglienza(Onboarding.chatId(cur), bye);
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

  on(MSG.FILO_GET_TIMERS, soloFilo(async () => ({ ok: true, timers: await FiloMem.gcTimers() })));

  on(MSG.FILO_ADD_TIMER, soloFilo(async (msg) => {
    const t = await FiloMem.addTimer({ label: msg.label, seconds: msg.seconds });
    if (t) broadcastLiveUpdate();
    return { ok: true, timer: t };
  }));

  on(MSG.FILO_DELETE_TIMER, soloFilo(async (msg) => {
    const list = await FiloMem.deleteTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  }));

  on(MSG.FILO_PAUSE_TIMER, soloFilo(async (msg) => {
    const list = await FiloMem.pauseTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  }));

  on(MSG.FILO_RESUME_TIMER, soloFilo(async (msg) => {
    const list = await FiloMem.resumeTimer(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  }));

  on(MSG.FILO_STOP_TIMER_ALARM, soloFilo(async (msg) => {
    const list = await FiloMem.stopTimerAlarm(msg.id);
    broadcastLiveUpdate();
    return { ok: true, timers: list };
  }));

  on(MSG.FILO_GET_NOTIFICATIONS, soloFilo(async () => ({ ok: true, notifications: await FiloMem.listNotifications() })));

  on(MSG.FILO_DISMISS_NOTIFICATION, soloFilo(async (msg) => {
    const list = await FiloMem.dismissNotification(msg.id, { acted: !!msg.acted });
    broadcastLiveUpdate();
    return { ok: true, notifications: list.filter((n) => !n.dismissed) };
  }));

  // #870 — le carte della home. La stessa mossa arriva dalla chat (azione CARTA_HOME) e passa dallo stesso posto.
  on(MSG.CARTE_HOME_GET, soloFilo(async () => ({ ok: true, layout: await require('../carteHome').leggi() })));
  on(MSG.CARTE_HOME_MODIFICA, soloFilo(async (msg, sender) => {
    const esito = await require('../carteHome').modifica(msg && msg.mossa);
    if (esito.errore) return { ok: false, error: esito.errore, layout: esito.layout };
    if (esito.cambiato) ctx.annunciaCarteHome(esito.layout, sender);
    return { ok: true, layout: esito.layout };
  }));
  on(MSG.LAVORI_IN_CORSO, soloFilo(async (msg, sender) => ({
    ok: true, lavori: require('../lavoriInCorso').elenco(ctx.ambitoDellaFinestra(sender && sender.win)),
  })));
  on(MSG.EDITOR_RECENTI, soloFilo(async () => require('../editorFiles').recenti()));

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
