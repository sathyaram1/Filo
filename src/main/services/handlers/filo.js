// Handler di dominio: l'agente Filo — chat, dashboard generata, memoria,
// note, timer e notifiche.

module.exports = function register(on, ctx) {
  const {
    MSG, winOf, broadcastLiveUpdate, handleFiloChat, fermaFiloChat, seguitoFiloChat, handleFiloGenerateDashboard, contaHomeVista,
    executeFiloAction, controllaUscita: portaUscite, apriDaFilo, SCHEMI_USCITA, ricordaLettoInChat, ricordaVerdettiArchiviati, maybeRunCompactor, closeAndTriageChat,
    archiviaCongedoAccoglienza, decisioneAzionePagina, segnaLetturaAiuto, nuovaConversazioneAiuto,
    saveOnboarding, finishOnboarding, claimOnboardingResume, chiaveConferma,
  } = ctx;
  // Ogni blocco della porta si conta fra le uscite fermate (#1474), qualunque porta arrivi da ctx.
  const controllaUscita = require('../contatoriSicurezza').contaUscite(portaUscite);
  const contatori = () => globalThis.SN_CONTATORI_MAIN || null;
  const { soloFilo: soloSuperficiDiFilo } = require('./origine');
  const { SN_CONST } = globalThis;
  const FiloMem = globalThis.SN_FILO_MEMORY;
  const FiloState = globalThis.SN_FILO_STATE;
  const Onboarding = globalThis.SN_ONBOARDING;
  const FiloChats = globalThis.SN_FILO_CHATS;
  const ChatArchive = globalThis.SN_CHAT_ARCHIVE;

  // Memoria dell'utente: non è roba da pagine web, e sul canale `filo:message` arrivano
  // anche i content script dei siti. Confine d'origine: vedi handlers/origine.js.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  // Chat, memoria, timer e notifiche li usano solo le pagine di Filo: la chat risponde con lo stato intero (#589.12).
  const soloFilo = (fn) => (msg, sender, origin) => (
    isFilo(origin) ? fn(msg, sender, origin) : { ok: false, code: 'forbidden', error: 'forbidden' });

  // Quello che l'utente ha scritto nella conversazione dell'assistente di pagina: un codice
  // scritto da lui può uscire (#810).
  const paroleDa = (msg) => (Array.isArray(msg && msg.parole) ? msg.parole : [])
    .filter((x) => typeof x === 'string').join('\n').slice(-200000);
  // L'ultima è la richiesta di adesso: i dati che porta possono uscire, quelli detti prima chiedono l'OK (#868.6).
  const domandaDa = (msg) => (Array.isArray(msg && msg.parole) ? msg.parole : []).filter((x) => typeof x === 'string').slice(-1).join('');

  // #525 — «l'elenco delle chat è cambiato». Lo ascolta la Cronologia aperta.
  const annunciaChat = () => {
    try { ctx.broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }); } catch (_) {}
  };

  // La risposta di un invoke può arrivare alla scheda prima degli ultimi eventi in diretta, che viaggiano su un'altra
  // coda: il segno di fine li segue, e la scheda chiude la diretta solo quando lo vede (#1321).
  const chiudiDiretta = (msg, sender) => {
    const wc = sender && sender.wc;
    if (!msg || !msg.reasoningReqId || !wc || (wc.isDestroyed && wc.isDestroyed())) return false;
    try { wc.send('filo:action', { reqId: msg.reasoningReqId, kind: 'fine' }); return true; } catch (_) { return false; }
  };
  on(MSG.FILO_CHAT, soloFilo(async (msg, sender) => {
    const r = await turnoDellaChat(msg, sender);
    return chiudiDiretta(msg, sender) ? { ...r, diretta: true } : r;
  }));
  async function turnoDellaChat(msg, sender) {
    let fineLavoro = () => {};
    try {
      // #525 — `chatId` è la targa della conversazione in corso: il main ci
      // scrive dentro il messaggio dell'utente e la risposta, turno per turno.
      const chatId = msg.chatId || null;
      fineLavoro = require('../lavoriInCorso').inizia({ tipo: 'risposta', chat: chatId, testo: msg.userMessage, wc: sender && sender.wc, ambito: ctx.ambitoDellaFinestra(sender && sender.win) });
      const r = await handleFiloChat({ userMessage: msg.userMessage, threadHistory: msg.threadHistory, image: msg.image, images: msg.images, reasoningReqId: msg.reasoningReqId, internal: !!msg.internal, daModello: !!msg.daModello, daFuori: msg.daFuori === true, chatId, rispostaA: msg.rispostaA || null, sender });
      return { ok: true, ...r };
    } catch (e) {
      // La chat non è un log: a turno fallito l'utente deve leggere cosa non ha funzionato, non il
      // messaggio grezzo dell'eccezione che il gestore IPC generico rimanderebbe.
      console.error('[Filo] turno di chat fallito', e);
      const CE = globalThis.SN_CHAT_ERRORS;
      const error = CE ? CE.sentence(e) : 'Qualcosa è andato storto. Riprova.';
      // Le azioni già eseguite restano nello storico: il tentativo dopo sa cosa era stato fatto.
      const actions = Array.isArray(e && e.filoActions) ? e.filoActions : [];
      // Lo status HTTP del provider e se è un rifiuto della CHIAVE (#629: un
      // 403 di moderazione non lo è): la scheda ci mette accanto la strada
      // per la pagina Crediti solo quando è lì che si sistema.
      const W = globalThis.SN_WALLET;
      const keyRefused = Boolean(W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(e));
      // Il tetto e il taglio decidono se accanto alla frase ci va il tasto per le Preferenze (#1097.3).
      const tetto = Number(e && e.maxTokens) > 0 ? { maxTokens: Number(e.maxTokens) } : {};
      const taglio = e && e.code === 'RISPOSTA_TAGLIATA' ? { finishReason: e.finishReason || null } : {};
      const crediti = e && e.reason === 'crediti' ? { reason: 'crediti' } : {};
      // La bolla d'errore la vede chi ha scritto: si conta il tipo, mai la frase (#1461).
      try {
        const tipo = globalThis.SN_CONTATORI && globalThis.SN_CONTATORI.tipoErroreVisto(e);
        if (tipo && contatori()) contatori().erroreVisto(`chat:${tipo}`);
      } catch (_) {}
      return { ok: false, error, code: (e && e.code) || 'UNKNOWN', status: Number(e && e.status) || 0, keyRefused, actions, ...tetto, ...taglio, ...crediti };
    } finally {
      fineLavoro();
    }
  }

  // Il quadrato al posto dell'invio (#578): ferma il turno di questa scheda, non quello di un'altra.
  on(MSG.FILO_CHAT_STOP, soloFilo(async (msg, sender) => ({ ok: true, fermato: await fermaFiloChat(msg && msg.reqId, sender && sender.wc) })));
  // Il seguito scritto mentre Filo lavora (#1296): entra nel turno di questa scheda, o lo manda lei a turno finito.
  on(MSG.FILO_CHAT_SEGUITO, soloFilo(async (msg, sender) => ({ ok: true, ...seguitoFiloChat(msg || {}, sender && sender.wc) })));

  // Il livello si riclassifica qui dentro anche con `confirmed`: un client compromesso non può
  // far eseguire un'azione fuori registro.
  on(MSG.FILO_CONFIRM_ACTION, async (msg, sender, origin) => {
    // La chat dice solo dove l'azione resta nel filo: da una pagina di Filo, mai da un sito.
    const chatId = isFilo(origin) && typeof msg.chatId === 'string' ? msg.chatId : '';
    const r = await executeFiloAction(msg.action, { confirmed: true, sender, assistente: msg.assistente === true, parole: paroleDa(msg), domanda: domandaDa(msg), chatNelFilo: chatId });
    if (r && r.output && msg.assistente === true) segnaLetturaAiuto(sender, { ...msg.action, _output: r.output });
    // Dopo l'OK il pulsante dice la cosa fatta, non quella proposta («Filo vuole…»): il testo lo dà il registro,
    // col risultato vero davanti (quante pagine cancellate, quante schede archiviate), come la riga del diario.
    const Levels = globalThis.SN_ACTION_LEVELS;
    const fatto = r && r.executed && Levels && Levels.describeDone
      ? String(Levels.describeDone({ ...msg.action, _output: r.output }) || '').split('\n')[0].trim() : '';
    return { ok: true, ...r, ...(fatto ? { fatto } : {}) };
  });

  // L'utente ha detto no a una conferma: l'azione non parte e non lo sa nessuno, se non i contatori (#1461).
  on(MSG.FILO_CONFIRM_RIFIUTATA, async (msg, sender) => {
    const action = msg && msg.action;
    if (!action || typeof action !== 'object' || !contatori()) return { ok: true, contata: false };
    return { ok: true, contata: Boolean(contatori().confermaRisposta(chiaveConferma(sender, action), 'rifiutata')) };
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
  on(MSG.FILO_RUN_ACTION, async (msg, sender, origin) => {
    // Lo usa anche la home per un tasto dell'utente (il riordino): lo dice lei, e solo da una pagina di Filo.
    const via = isFilo(origin) && msg.interfaccia === true ? 'interfaccia' : undefined;
    const r = await executeFiloAction(msg.action, { sender, assistente: true, via, parole: paroleDa(msg), domanda: domandaDa(msg) });
    if (r && r.output) segnaLetturaAiuto(sender, { ...msg.action, _output: r.output });
    return { ok: true, ...r };
  });

  // #965 — la scheda da cui parte un collegamento che Filo apre per lei: l'avviso di un sito da avviso compare lì, prima.
  const schedaDi = (tm, sender) => (tm && tm.tabs.find((t) => t.id === sender?.tab?.id && t.view && t.view.webContents === sender.wc)) || null;

  // Un indirizzo che un modello ha proposto in una pagina di Filo (un collegamento in una risposta, anche di posta, un
  // bottone, un suggerimento della home) si apre solo dopo la porta delle uscite (#810). La frase torna a chi ha cliccato.
  on(MSG.FILO_APRI_PROPOSTA, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const url = String((msg && msg.url) || '').trim();
    const web = /^https?:/i.test(url);
    if (!SCHEMI_USCITA.test(url) || (web && !/^https?:\/\//i.test(url))) return { ok: false, error: 'indirizzo non ammesso' };
    const win = winOf(sender);
    // Il clic sul collegamento vale per la pagina d'arrivo come un clic su un sito: si legge prima della porta, che può attendere.
    const origine = { tipo: 'filo', gesto: require('../permessiPagine').gestoDellUtente(sender?.wc) };
    const r = await apriDaFilo(url, {
      wc: sender?.wc, parole: paroleDa(msg), avvisa: false,
      apri: () => {
        const tm = win?._filoTabs;
        if (!tm) return;
        const apri = (segna) => { const id = tm.openTab(url, { origine }); if (segna) segna(tm.tabs.find((t) => t.id === id)); };
        const da = schedaDi(tm, sender);
        if (!(da && tm._sbPrimaDelClic(da, url, apri, { daFilo: true }))) apri();
      },
      chiedi: typeof msg.chiedi === 'string' ? msg.chiedi : '', confermato: msg.confermato === true, proposta: msg.proposta === true,
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
    const gesto = require('../permessiPagine').gestoDellUtente(sender?.wc);
    // Il menu del tasto destro su un collegamento della chat di Filo vale quanto il clic: senza verdetto chiede l'OK.
    const r = await apriDaFilo(url, {
      wc: sender?.wc, parole: paroleDa(msg), avvisa: avvisato, confermato: msg.confermato === true, proposta: avvisato && msg.proposta === true,
      apri: () => { if (tm) tm.apriDaCollegamento(url, { fromUrl: pagina, sfondo: !!(msg && msg.sfondo), daScheda: schedaDi(tm, sender), gesto }); },
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

  // Anche da una pagina web, di proposito: la sidebar vive lì. Risponde solo cosa farebbe Filo; l'azione la
  // esegue comunque il codice di Filo nel content script, quindi chi lo chiama non ottiene niente di più.
  on(MSG.FILO_DECIDI_PAGINA, async (msg, sender) => {
    const r = await decisioneAzionePagina({ costo: msg && msg.costo, campo: msg && msg.campo, sender });
    return { ok: true, ...r };
  });

  // Anche da una pagina web: toglie solo ciò che ha letto l'Aiuto di quella scheda, e lì la pagina sporca comunque.
  on(MSG.FILO_AIUTO_NUOVO, async (msg, sender) => {
    nuovaConversazioneAiuto(sender);
    return { ok: true };
  });

  // Lo stato porta schede aperte, notifiche e il messaggio della home con le pagine salvate: a un sito non si dà (#589.12).
  on(MSG.FILO_GET_STATE, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const { state, stateText } = await FiloState.assemble();
    return { ok: true, state, stateText };
  });

  // Il nome della rete e dei dispositivi dicono dove sei e cosa hai addosso: a un sito non si danno.
  on(MSG.SISTEMA_STATO, soloFilo(async (msg, sender) => {
    const Sistema = require('../statoSistema');
    const schede = sender && sender.win && sender.win._filoTabs;
    // Guarda chi può vederla: scheda attiva di una finestra né ridotta a icona né nascosta (la pagina resta «visible»).
    const davanti = !(schede && sender.tab) || schede.inVista(sender.tab.id);
    const segue = !(msg && msg.segue === false);
    // Chi sta scrivendo in chat sveglia il lettore per il turno che arriva, senza diventare una pagina che lo segue.
    // Una volta anche dopo una pausa lunga: il turno lo chiederebbe comunque, e lo aspetterebbe (#1097.1).
    if (msg && msg.perChat === true) {
      if (davanti) Sistema.richiedi({ unaVolta: true });
      return { ok: true, stato: Sistema.stato() };
    }
    Sistema.richiedi({ davanti, chi: sender && sender.wc, segue });
    // La pagina che ha visto cadere o tornare la rete non aspetta il giro: la lettura nuova arriva con l'annuncio.
    if (davanti && segue && msg && msg.subito === true) Sistema.leggiUnaVolta();
    return { ok: true, stato: Sistema.stato() };
  }));

  // #874 — i tasti della home comandano volume, Bluetooth e Wi-Fi dalla stessa porta dell'azione della chat. È un
  // gesto dell'utente su una superficie di Filo: non passa dai livelli, che servono a ciò che decide il modello.
  on(MSG.SISTEMA_COMANDA, require('./origine').soloFilo(async (msg) => {
    const Comandi = require('../comandiSistema');
    return require('../registroCambi').con({ via: 'interfaccia', dove: 'home' }, () => Comandi.comanda(msg && msg.richiesta));
  }));
  on(MSG.SISTEMA_APRI_IMPOSTAZIONI, require('./origine').soloFilo(async (msg) => {
    const uri = require('../comandiSistema').uriImpostazioni(String((msg && msg.chiave) || ''));
    if (!uri) return { ok: false, error: 'impostazione sconosciuta' };
    try {
      await require('electron').shell.openExternal(uri);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
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

  on(MSG.FILO_HOME_VISTA, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return { ok: await contaHomeVista() };
  });

  // Filo non ha un calendario suo: scrive l'evento in un .ics e lo passa al
  // programma dell'utente, che è la porta che ogni calendario sa aprire. Se il
  // sistema non lo apre torna il percorso, così il bottone non finisce nel nulla.
  on(MSG.CALENDAR_ADD, soloDaFilo(async (msg) => {
    const C = globalThis.SN_CALENDAR;
    const ev = C && C.normalize(msg && msg.evento);
    if (!ev) return { ok: false, error: 'evento incompleto' };
    const path = require('node:path');
    const fs = require('node:fs');
    const { app, shell } = require('electron');
    let file = '';
    try {
      const dir = path.join(app.getPath('temp'), 'filo-eventi');
      await fs.promises.mkdir(dir, { recursive: true });
      // Un evento consegnato al calendario di ieri non serve più a nessuno:
      // senza questa ripulita la cartella cresce a ogni uso e non la svuota nessuno.
      const limite = Date.now() - 24 * 60 * 60 * 1000;
      for (const nome of await fs.promises.readdir(dir)) {
        if (!nome.endsWith('.ics')) continue;
        const vecchio = path.join(dir, nome);
        try {
          const st = await fs.promises.stat(vecchio);
          if (st.mtimeMs < limite) await fs.promises.unlink(vecchio);
        } catch (_) {}
      }
      file = path.join(dir, `${Date.now().toString(36)}-${C.fileName(ev)}`);
      await fs.promises.writeFile(file, C.buildIcs(ev, { uid: `${C.uidPer(ev)}@filo` }), 'utf8');
    } catch (e) {
      return { ok: false, error: e?.message || 'file non scritto' };
    }
    let apertura = '';
    try { apertura = await shell.openPath(file); } catch (e) { apertura = e?.message || 'apertura non riuscita'; }
    return { ok: true, file, aperto: !apertura, error: apertura || '', quando: ev.quando, titolo: ev.titolo };
  }));

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
    const sempreAperta = msg && typeof msg.sempreAperta === 'string';
    if (!lezione && !riga && !sempreAperta) return { ok: false, error: 'bad_request' };
    if (sempreAperta) return { ok: true, tolta: await FiloMem.forgetLine({ sempreAperta: msg.sempreAperta }) };
    // La riga resta fra le nascoste del quaderno (#872): l'id serve al suo «Rimetti».
    const via = lezione ? { lezione: msg.lezione } : { modulo: msg.modulo, riga: msg.riga };
    const com = await FiloMem.descriviRiga(via);
    const id = await FiloMem.hideLine(via);
    // L'Annulla sotto «Mi ricorderò» della chat (#1467) dice da dove viene; di serie è il quaderno.
    if (id) contatori()?.memoriaCorretta(msg.da === 'chat' ? 'chat' : 'quaderno', 'togli', com);
    return { ok: true, tolta: !!id, id: id || null };
  });

  // ── Il quaderno delle memorie (#872) ─────────────────────────────────────
  // Ogni riga con la data in cui è nata e i punti del filo da cui viene: quelli che il filo non ha più (una chat
  // cancellata) restano fuori, e una riga senza nessuno si legge e si corregge lo stesso, senza collegamento.
  const IlFilo = () => globalThis.SN_IL_FILO;
  async function fontiNelFilo(ids) {
    const out = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      let d = null;
      try { d = await IlFilo().dove(id, { incognito: false }); } catch (_) {}
      if (d && d.tipo === 'messaggio') out.push({ id, ts: d.ts, chat: d.chat, i: d.i, role: d.role, app: d.app || null });
    }
    return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }
  const conFonti = async (r) => ({ ...r, fonti: await fontiNelFilo(r.fonti) });

  on(MSG.FILO_QUADERNO, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    const q = await FiloMem.quaderno();
    const moduli = [];
    for (const m of q.moduli) moduli.push({ nome: m.nome, righe: await Promise.all(m.righe.map(conFonti)) });
    return {
      ok: true, moduli, lezioni: await Promise.all(q.lezioni.map(conFonti)),
      sempreAperte: q.sempreAperte, nascoste: await Promise.all(q.nascoste.map(conFonti)),
    };
  });

  const viaValida = (via) => !!via && ((via.lezione && typeof via.lezione === 'object'
    && typeof via.lezione.ts === 'string' && typeof via.lezione.text === 'string')
    || (typeof via.modulo === 'string' && typeof via.riga === 'string'));

  // La correzione passa dagli stessi controlli di una lezione (tetto, caratteri che non si vedono): entra in ogni prompt.
  // Una riga corretta in niente è tolta, come col suo ×: resta fra le nascoste, e da lì si rimette.
  on(MSG.FILO_MEMORY_EDIT, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    if (!viaValida(msg && msg.via) || typeof msg.testo !== 'string') return { ok: false, error: 'bad_request' };
    const fonti = Array.isArray(msg.fonti) ? msg.fonti.filter((x) => typeof x === 'string') : [];
    const l = globalThis.SN_PREF.lezioneDaAzione({ testo: msg.testo.replace(/\s*[\r\n]+\s*/g, ' ') }, { cosa: 'la correzione' });
    if (l.rifiuto) return { ok: false, error: `${l.rifiuto[0].toUpperCase()}${l.rifiuto.slice(1)}. Accorciala per salvarla.`, rifiuto: true };
    const com = await FiloMem.descriviRiga(msg.via);
    if (!l.testo) {
      const id = await FiloMem.hideLine(msg.via, { fonti });
      if (id) contatori()?.memoriaCorretta('quaderno', 'togli', com);
      return { ok: true, tolta: !!id, id: id || null };
    }
    const corretta = await FiloMem.editLine(msg.via, l.testo, { fonti });
    if (corretta) contatori()?.memoriaCorretta('quaderno', 'correggi', com);
    return { ok: true, corretta, testo: l.testo };
  });

  on(MSG.FILO_MEMORY_RESTORE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    if (!msg || typeof msg.id !== 'string') return { ok: false, error: 'bad_request' };
    const com = await FiloMem.descriviNascosta(msg.id);
    const rimessa = await FiloMem.restoreHidden(msg.id);
    if (rimessa) contatori()?.memoriaCorretta('quaderno', 'ripristina', com);
    return { ok: true, rimessa };
  });

  on(MSG.FILO_MEMORY_FOREVER, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, code: 'forbidden', error: 'forbidden' };
    if (!msg || typeof msg.id !== 'string') return { ok: false, error: 'bad_request' };
    return { ok: true, cancellata: await FiloMem.forgetHiddenForever(msg.id) };
  });

  // Il salto al punto del filo: la home chiede dove sta un evento, e ci va. Dall'incognito il filo è quello in memoria.
  on(MSG.FILO_DOVE, soloFilo(async (msg) => {
    if (!msg || typeof msg.id !== 'string' || !msg.id) return { ok: false, error: 'bad_request' };
    return { ok: true, dove: await IlFilo().dove(msg.id) };
  }));

  // Compattazione forzata: porta il buffer delle lezioni in PROFILO/PREFERENZE senza aspettare
  // la soglia, per la chiusura dell'intervista e per «fissa adesso quello che hai imparato».
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
    // …e i verdetti dei suoi collegamenti (#1505): chi chiedeva l'OK lo chiede ancora, i giudicati si aprono.
    try { ricordaVerdettiArchiviati((chat && chat.messages) || []); } catch (_) {}
    let conFoto = chat;
    try { conFoto = global.SN_CONTESTO_FILO ? global.SN_CONTESTO_FILO.conFotoInMemoria(chat) : chat; } catch (_) {}
    return { ok: true, chat: conFoto };
  });

  // Chiusura di una chat. La risposta NON aspetta il classificatore: chi ha
  // appena premuto "nuova chat" non deve stare fermo mentre un modello legge
  // la conversazione di prima. Titolo e tipo arrivano in Cronologia poco dopo.
  on(MSG.FILO_CHAT_CLOSE, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const id = msg.id;
    if (!id) return { ok: false, error: 'id mancante' };
    // Come è finita, per i contatori (#1463): la dice la scheda, da un elenco chiuso.
    const via = ['home', 'chat_nuova', 'uscita'].includes(msg.via) ? msg.via : (msg.fine === true ? 'chat_nuova' : 'uscita');
    closeAndTriageChat(id, { fine: msg.fine === true, via })
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
    // #525 — la conversazione cancellata può essere ancora a schermo in
    // un'altra scheda. Se nessuno glielo dice, quella scheda continua a
    // scrivere sulla stessa targa e la chat RINASCE: stessa targa, i messaggi
    // di prima persi, e di nuovo in Cronologia. L'utente aveva chiesto il
    // contrario. La scheda che la sta vivendo se ne libera e il messaggio dopo
    // apre una conversazione nuova, con una targa sua.
    await ctx.cancellaChatPerSempre(msg.id);
    return { ok: true, chats: await FiloChats.listIndex() };
  });

  on(MSG.FILO_CHAT_NASCONDI, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    const chat = await ctx.nascondiChat(msg && msg.id, !(msg && msg.nascosta === false));
    return chat ? { ok: true, nascosta: !!chat.nascosta } : { ok: false, error: 'chat inesistente' };
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
    const ESTERNI = { comando: globalThis.SN_FILO_CONTESTO.ESTERNO_COMANDO, download: 'dal nome di un file scaricato' };
    const esterno = role === 'filo' && Object.hasOwn(ESTERNI, msg.esterno) ? ESTERNI[msg.esterno] : '';
    // I cambi di stato di un'azione confermata dopo il turno (#867): riaperta, la bolla ritrova il segno.
    const cambi = (Array.isArray(msg.cambi) ? msg.cambi : []).filter((c) => typeof c === 'string');
    // Una finestra guardata dopo l'OK (#778): ne resta il nome, che toStoredMessage accorcia.
    const guardate = role === 'filo' && actions.some((a) => a.type === 'VEDI_SCHERMO')
      ? (Array.isArray(msg.guardate) ? msg.guardate : []).filter((n) => typeof n === 'string') : [];
    // Una riga di Filo scritta dalla pagina non è passata dal giudizio dei collegamenti (#1505): riaperta, non ne ha.
    await FiloChats.append(id, {
      role, text, ...(actions.length ? { actions } : {}), ...(esterno ? { esterno } : {}), ...(cambi.length ? { cambi } : {}),
      ...(guardate.length ? { guardate } : {}), ...(role === 'filo' && msg.tardiva === true ? { tardiva: true } : {}),
      ...(role === 'filo' ? { senzaVerdetto: true } : {}),
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

  // #974 — le conversazioni delle altre app nel filo, come righe ripiegate. Da un sito parla solo l'Aiuto, e il sito
  // (soggetto, indirizzo da riaprire, recinto del riferimento) lo dice l'indirizzo di chi manda, mai il messaggio.
  on(MSG.FILO_CONVERSAZIONE_APP, async (msg, sender, origin) => {
    const app = String((msg && msg.app) || '');
    if (!globalThis.SN_FILO_APP.eApp(app)) return { ok: false, error: 'app sconosciuta' };
    let soggetto = msg.soggetto;
    let dove = '';
    let recinto = 'filo';
    if (isFilo(origin) || sender?.isShell) {
      const d = String(msg.dove || '');
      if (/^(?:filo|https?):\/\//i.test(d)) dove = d;
    } else {
      if (app !== 'aiuto') return { ok: false, code: 'forbidden', error: 'forbidden' };
      let u = null;
      try { u = new URL(String(origin)); } catch (_) {}
      if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) return { ok: false, code: 'forbidden', error: 'forbidden' };
      soggetto = u.hostname.replace(/^www\./, '');
      dove = u.href;
      recinto = u.hostname;
    }
    const rif = app === 'aiuto' ? `${recinto}|${String(msg.rif == null ? '' : msg.rif)}` : msg.rif;
    const chat = await globalThis.SN_CONVERSAZIONI_APP.annota({ app, rif, soggetto, dove, messaggi: msg.messaggi });
    if (chat && app === 'aiuto') ctx.segnaChatAiuto(sender, chat.id);
    return chat ? { ok: true, id: chat.id } : { ok: false, error: 'niente da scrivere' };
  });

  on(MSG.FILO_CONVERSAZIONE_APP_DIMENTICA, soloFilo(async (msg) => {
    const tolte = await globalThis.SN_CONVERSAZIONI_APP.dimentica({ app: msg.app, rif: msg.rif, prefisso: msg.prefisso });
    return { ok: true, tolte: tolte.length };
  }));

  on(MSG.FILO_CONVERSAZIONE_APP_RINOMINA, soloFilo(async (msg) => ({
    ok: true,
    rinominate: await globalThis.SN_CONVERSAZIONI_APP.rinomina({ app: msg.app, rif: msg.rif, prefisso: msg.prefisso, soggetto: msg.soggetto }),
  })));

  on(MSG.FILO_RIGHE_APP, soloFilo(async (msg) => (
    { ok: true, righe: await globalThis.SN_CONVERSAZIONI_APP.righe({ chat: msg.chat || null }) })));

  // #869 — la home come coda del filo: a pezzi, la ricerca, le pagine tolte. La prima apertura della giornata è una
  // cosa successa: Filo la saluta (una volta).
  const Coda = require('../codaFilo');
  const isoO = (x) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);
  on(MSG.FILO_CODA, soloFilo(async (msg) => {
    const r = await Coda.pezzo({ prima: isoO(msg.prima), fino: isoO(msg.fino), dopo: isoO(msg.dopo), quanti: Number(msg.quanti) || undefined });
    // Le frasi di Filo che la home disegna ritrovano i verdetti dei loro collegamenti, anche dopo un riavvio (#1505).
    try { ricordaVerdettiArchiviati((r.elementi || []).filter((e) => e && e.k === 'msg')); } catch (_) {}
    // L'incognito non saluta: il saluto sta nel filo di disco, che da lì non si vede.
    if (!msg.prima && !msg.fino && !msg.dopo && !require('../../shim/storage').inIncognito()) require('../filoParla').forseGiornata().catch(() => {});
    return { ok: true, ...r };
  }));
  on(MSG.FILO_CERCA, soloFilo(async (msg) => (msg && msg.nascoste === 'tutte'
    ? { ok: true, messaggi: [], pagine: [], nascoste: await Coda.nascoste() }
    : { ok: true, ...(await Coda.cerca(String((msg && msg.q) || '').slice(0, 500))) })));
  on(MSG.FILO_CODA_TOGLI_PAGINE, soloFilo(async (msg) => {
    const url = msg && typeof msg.url === 'string' ? msg.url : '';
    const tolte = url ? await Coda.togliIndirizzo(url) : await Coda.togliPagine(Array.isArray(msg && msg.ids) ? msg.ids : []);
    return { ok: true, tolte };
  }));

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
    // Senza un modello che la chat possa chiamare l'intervista resta in attesa
    // e la home dice cosa manca: accoglierlo con una bolla d'errore sarebbe
    // peggio. La domanda è «questa chiamata parte?», non «c'è una chiave
    // intestata al fornitore dichiarato»: quel campo può essere vecchio (#663).
    const settings = await ctx.getEffectiveSettings();
    const ready = SN_CONST.canServeAction(settings, SN_CONST.ACTIONS.FILO_CHAT);
    let state = await FiloMem.getOnboarding();
    // `peek`: chi legge soltanto (Preferenze, per rileggere le interviste
    // conservate) non deve aprire niente né prenotare la ripresa di un turno.
    // `fuori`: una pagina che l'intervista rifatta non l'ha chiesta; non la apre e non ne prenota il turno (#1297).
    if (msg?.peek || (msg?.fuori === true && state.rifatta)) return { ok: true, onboarding: state, ready, resume: false };
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
    // La home pronta per la scheda nuova (#1128) non la prende: nessuno la guarda, e la chiede quando arriva davanti.
    const resume = Onboarding.hasPendingTurn(state) && !sender?.riserva && claimOnboardingResume();
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
  // `riprendi` (#1297) è il «Riprendiamola» della home: la stessa intervista, da dove si era fermata. Se l'ultima parola
  // resta all'utente il turno riparte, preso da una scheda sola come all'apertura.
  on(MSG.FILO_RESTART_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const prev = await FiloMem.getOnboarding();
    const base = msg?.riprendi === true ? Onboarding.riprendi(prev) : Onboarding.restart(prev);
    // Rifatta da capo (#1473): «Riprendiamola» continua quella che c'era, e non è una riapertura.
    if (msg?.riprendi !== true) require('../contatoriHomePagina').misura('intervistaRiaperta');
    const state = await saveOnboarding(base.thread.length
      ? base
      : Onboarding.appendTurn(base, { role: 'filo', text: Onboarding.WELCOME_MESSAGE }));
    // `altrove`: la riprende una scheda nuova, che il turno in sospeso lo prenota da sé all'apertura.
    const resume = msg?.riprendi === true && msg?.altrove !== true && Onboarding.hasPendingTurn(state) && claimOnboardingResume();
    return { ok: true, onboarding: state, ...(msg?.riprendi === true ? { resume } : {}) };
  });

  on(MSG.FILO_ONBOARDING_TOGLI, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const { state, tolta } = Onboarding.togliConversazione(await FiloMem.getOnboarding(), msg?.chiave);
    return { ok: true, tolta, onboarding: tolta ? await saveOnboarding(state) : state };
  });

  // La via d'uscita che NON passa dal modello: senza, chi apre Filo la prima volta senza rete
  // resta chiuso nell'intervista col solo pulsante «Riprova».
  on(MSG.FILO_CLOSE_ONBOARDING, async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    if (!Onboarding) return { ok: false, error: 'onboarding non disponibile' };
    const cur = await FiloMem.getOnboarding();
    if (cur.done) return { ok: true, onboarding: cur, already: true };
    const bye = Onboarding.CLOSING_MESSAGE;
    const chiusa = Onboarding.close(Onboarding.appendTurn(cur, { role: 'filo', text: bye, congedo: true }));
    // `senzaRiga`: la chiude «No, va bene così» da una home, che non vuole la riga «abbiamo chiuso a metà» (#1297).
    const state = await saveOnboarding(msg?.senzaRiga === true ? Onboarding.dismissNotice(chiusa) : chiusa, { via: 'saltata' });
    // #525 — il congedo lo legge l'utente, quindi lo deve ritrovare rileggendo
    // l'intervista. La targa della chat la calcola il modulo dell'intervista,
    // lo stesso che usa la home per mandare i turni.
    await archiviaCongedoAccoglienza(Onboarding.chatId(cur), bye);
    // Niente agente-lezioni: qui non c'è un turno da cui estrarre nulla, ma
    // quello che l'utente aveva già raccontato va comunque messo in memoria.
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

  // Una scadenza la vedono tutte le finestre della stessa vista (le incognito
  // condividono l'overlay in RAM): se suonassero tutte sarebbero due copie dello
  // stesso motivo, sfasate fra loro. Suona la più anziana, e quando si chiude il
  // turno passa alla successiva; il pulsante che ferma resta invece in tutte.
  const suonaQui = (win) => {
    try {
      if (!win || win.isDestroyed()) return false;
      const pari = require('electron').BrowserWindow.getAllWindows().filter((w) => {
        try { return !w.isDestroyed() && w._filoTabs && !!w._filoIncognito === !!win._filoIncognito; } catch (_) { return false; }
      });
      if (!pari.length) return false;
      return pari.reduce((a, b) => (a.id <= b.id ? a : b)).id === win.id;
    } catch (_) { return true; }
  };

  on(MSG.FILO_GET_TIMERS, soloFilo(async (msg, sender) => ({
    ok: true, timers: await FiloMem.gcTimers(), suona: suonaQui(winOf(sender)),
  })));

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

  on(MSG.FILO_GET_NOTIFICATIONS, soloFilo(async () => ({
    ok: true, notifications: require('../../updater').conStatoAggiornamento(await FiloMem.listNotifications()),
  })));
  on(MSG.FILO_INSTALLA_AGGIORNAMENTO, soloFilo(async () => require('../../updater').installaAggiornamento()));

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

  // F4 — l'avviso della segnalazione automatica: mai da un sito, e solo per una partita da qui (#784.3, #784.6).
  const AttesaAutoFeedback = require('../autoFeedbackAttesa');
  on(MSG.CANCEL_AUTO_FEEDBACK, soloSuperficiDiFilo(async (msg) => {
    const r = await AttesaAutoFeedback.annulla(String(msg && msg.id || '').trim());
    // Ritirata davvero: la segnalazione automatica disfatta (#1473). Quella arrivata tardi resta fatta.
    if (r && r.ok) require('../contatoriHomePagina').misura('disfatto', 'segnalazione_automatica');
    return r;
  }));
  on(MSG.AUTO_FEEDBACK_PARTI, soloSuperficiDiFilo(async (msg) => (AttesaAutoFeedback.parti(String(msg && msg.id || '').trim())
    ? { ok: true } : { ok: false, error: 'non è una segnalazione partita da qui' })));
};
