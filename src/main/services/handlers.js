// Handler centrale dei messaggi: handleMessage, il registro on()/handlerCtx, il preambolo di eseguiAzioneFilo.
// La routing IPC sta in src/main/ipc.js; i domini in handlers/ (elenco in handlers/index.js), le azioni in azioni/,
// il resto nei moduli che si caricano qui sotto.

const { BrowserWindow } = require('electron');
const Defaults = require('./defaultsStore');
const { fillMovedSlots } = require('./resolveSupportModel');
const { azioneAmmessaDa } = require('./impostazioniPerOrigine');
const { origineDi, daPaginaNonDiFilo } = require('./handlers/origine');
const SegretiLetti = require('./segretiLetti');
const Registro = require('./registroCambi');
const Compattazione = require('./compattazioneFilo');
const ConversazioniApp = require('./conversazioniApp');
const FiloParla = require('./filoParla');
const SempreAperte = require('./sempreAperte');
const ChiudiSchede = require('./chiudiSchede');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS } = SN_CONST;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const Costs = globalThis.SN_COSTS;
const SavedPages = globalThis.SN_SAVED_PAGES;
const FiloChats = globalThis.SN_FILO_CHATS;       // #525 — archivio delle chat con Filo
const ChatArchive = globalThis.SN_CHAT_ARCHIVE;   // #525 — titoli, tipi, ricerca (logica pura)
const FiloMem = globalThis.SN_FILO_MEMORY;
const FiloState = globalThis.SN_FILO_STATE;
const {
  broadcastLiveUpdate, broadcastToTabs, broadcastToFiloPages, ambitoDellaFinestra, annunciaCarteHome,
  annunciaBarraSiti, annunciaIconaScheda,
} = require('./broadcast');
const {
  Schermo, contaSe, filoWin, winOf, targetWebTab, nomeDellaScheda, refreshProxyRulesAllWindows,
} = require('./handlersComuni');
const {
  Gate, safeBrowsingKeyFor, withDefaults, getEffectiveSettings, modelForAction, buildAttemptChain, providerRouting,
  openWeightsBlockReason, AvvisiFuoriPolitica, applySettingsUpdate, resolveTheme,
} = require('./impostazioniEffettive');
const {
  getAssistantCwd, cartellaDelComando, displayCwd, pendingConfirmKey, recordPendingConfirm, consumePendingConfirm,
  daPaginaDiFilo, chiaveSchermo, bersagliMostrati, timerRefOf, describeTimerEntry, perimetroLettura, shellDeiComandi,
  segretiCustoditi, ricordaLettoDallAiuto, ricordaLettoInChat, testoDiAltriNelleAzioni, controllaUscita,
  rifiutoNonCompare, ricercaNelSito, SCHEMI_USCITA, sitoDaConfermare, contattabilePrimaDelClic,
  ricordaVerdettiArchiviati, apriDaFilo, primaVoltaDelTerminale, richiestaDiSistema, perSempreDetto, idDelCambio,
  preparaEliminazione, preparaRinomina,
} = require('./porteUscita');
const {
  compitoSenzaTestoDiAltri, ricordaSegnalazione, nuovaConversazioneAiuto, segnaLetturaAiuto, segnaTestoNellAiuto,
  segnaPaginaDiFiloNellAiuto, fileScaricato, decisioneAutonomia, decisioneAzionePagina, decisioneComandoAMano, fraseNo,
  ricercaSuAltroComputer, executeFiloAction, azioneNelFilo, azioneDellAiuto, segnaChatAiuto, chatAiutoDi,
  ingressiContati,
} = require('./autonomiaFonti');
const {
  voceChiusa, schedeNumerate, schedaPerNumero, schedaDaMostrare, schedaDaBloccare, bersaglioPausa, bersaglioAudio, apriPaginaSalvata, contoRestano,
} = require('./osservazioniPerModello');
const { handleAIRequest, handleStream, maybeRunCompactor, stimaSogliaCompattazione } = require('./chiamateModello');
const {
  runTabTriageDecision, affidaChat, dimenticaChat, cancellaChatPerSempre, nascondiChat, portaAllaChat,
  archiviaCongedoAccoglienza, closeAndTriageChat, sweepPendingChats, searchArchivedTabs, archivioDaCancellare,
} = require('./archivioChat');
const {
  saveOnboarding, ricominciaIntervista, ripristinaImpostazioni, anteprimaRipristino, finishOnboarding,
} = require('./intervista');
const { generaPerFiloParla, filoPuoParlare, handleFiloGenerateDashboard, contaHomeVista } = require('./homeDashboard');
const {
  claimOnboardingResume, releaseOnboardingResume, fermaFiloChat, seguitoFiloChat, handleFiloChat,
} = require('./turnoChat');

// Coi crediti un modello che i nomi non riconoscono si cerca nel catalogo del router (#830): lo stesso del listino.
SN_CONST.registraCaricatoreCatalogo(() => require('./costoModelli').listino());

// `contesto` = le azioni (con il loro `_output`) che il modello ha davanti in questo turno, turni passati
// compresi: dicono cosa il compito ha letto (#530) e servono all'anti-esfiltrazione di NAVIGA.
async function eseguiAzioneFilo(action, {
  confirmed = false, sender = null, contesto = null, provenienza = null, fontiLette = null, assistente = false, parole = '', avanzamento = null,
  chatId = null, richiesta = '', origine = 'chat', dentroPerimetro = true, chiesta = true, accoglienza = false, segnale = null, nascostiDellaChat = null,
  domanda = '', soloConferma = false, capRilettura = null, schedeViste = null, intervista = false, senzaRilettura = false,
} = {}) {
  if (!action || typeof action !== 'object') return { executed: false, kept: false };
  const type = String(action.type || '').toUpperCase();
  // Da un sito (anche via una chat aperta da lì) passano solo le azioni della
  // barra d'aiuto, confermate o no. `sender` assente = chiamata interna del main.
  if (sender && !azioneAmmessaDa(action, sender?.tab?.url || sender?.url || '')) {
    return { executed: false, kept: false, rejected: true, code: 'forbidden' };
  }

  // IMPOSTA_ESTETICA: il livello dipende dallo stato risultante, che solo il main conosce.
  // `_illegible` si inietta PRIMA del gate, mai dall'LLM (#146.4).
  if (type === 'IMPOSTA_ESTETICA') {
    try {
      const T = globalThis.SN_THEME_TOKENS;
      const token = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
      const valore = action.valore ?? action.value ?? action.val ?? action.colore;
      if (T && T.validate(token, valore)) {
        const settings = await Storage.getSettings();
        action._illegible = T.illegibleAfter(token, valore, settings.themeTokens || {}, resolveTheme(settings));
      }
    } catch (_) {}
  }

  // Un elenco di siti che resterebbe com'è (aggiungere un sito che c'è già, toglierne uno che non c'è)
  // non chiede conferma per poi non fare niente: lo si sa prima del gate, mai dall'LLM (#949).
  if (type === 'IMPOSTA_PREFERENZA') {
    delete action._invariato;
    // Il costo del modello scelto per una funzione (#819): lo scrive solo il main, qui sotto.
    delete action._costoModello;
    // Mai dal modello né da una conferma: lo scrive solo un turno dell'intervista di benvenuto (#592.2).
    delete action._accoglienza;
    try {
      const setter = global.SN_PREF.setterDellaChiave(action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza);
      if (accoglienza && !confirmed && !assistente && setter && setter.scrive.includes('agentStyle')
        && !testoDiAltriNelleAzioni(contesto)) action._accoglienza = true;
    } catch (_) {}
    // «Questo sito», «scheda: <titolo>» fra i siti delicati, quelli in anticipo (#1589) e quelli col menu proprio (#975): la chat vede i titoli
    // delle schede, non gli indirizzi (#1004).
    try {
      const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
      const setter = global.SN_PREF.setterDellaChiave(chiave);
      if (setter && (setter.scrive.includes('security.pagineDelicate.siti') || setter.scrive.includes('menuDelSito.siti')
        || setter.scrive.includes('security.privacy.sitiAnticipo')
        || setter.scrive.includes('blocklist') || setter.scrive.includes('security.safeBrowse.trustedSites')
        || setter.scrive.includes('security.cookies.bannerSites'))) {
        // Dall'Aiuto di un sito «questo sito» è lui, e le altre schede non si nominano (#843).
        const daSito = daPaginaNonDiFilo(sender);
        const { tm, tab } = daSito ? { tm: null, tab: { url: sender?.tab?.url || sender?.url } } : targetWebTab(sender);
        const schede = tm ? tm.tabs.filter((t) => !t.isInternal).map((t) => ({ url: t.url, title: t.title })) : [];
        const r = globalThis.SN_PAGINE_DELICATE.risolviSchede(
          action.valore ?? action.value ?? action.valoreNuovo ?? action.val,
          { schede, attiva: tab ? tab.url : '' },
        );
        if (r.rifiuto) return { executed: false, kept: false, output: { error: r.rifiuto, rifiuto: true } };
        action.valore = r.valore;
      }
    } catch (_) {}
    try {
      const built = global.SN_PREF.buildPreferencePartial(
        action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza,
        action.valore ?? action.value ?? action.valoreNuovo ?? action.val,
      );
      // Senza una chiave propria l'interruttore dei fornitori esclusi non ha effetto (#962): si dice, senza chiedere un OK.
      if (built && built.partial && built.partial.ownKeyAllProviders === true
        && !SN_CONST.hasOwnOpenrouterKey(await Storage.getSettings())) {
        return { executed: false, kept: false, output: { error: global.SN_PREF.SENZA_CHIAVE_PROPRIA, rifiuto: true } };
      }
      // Il modello di una funzione: si controlla prima della conferma, che non chieda un OK a un cambio che non parte.
      if (built && built.modelloFunzione) {
        const v = await require('./costoModelli').verificaCambio(built.modelloFunzione, { Defaults });
        if (v.rifiuto) return { executed: false, kept: false, output: { error: v.rifiuto, rifiuto: true, ...(v.perModello ? { perModello: v.perModello } : {}) } };
        if (v.costo) action._costoModello = v.costo;
      }
      if (built && built.elenco) {
        const r = global.SN_PREF.applicaElenco(built.elenco, await Storage.getSettings());
        if (r.invariato) action._invariato = r.invariato;
        // #947.3 — «togli» una cartella dove l'utente ha cercato una volta: non è nell'elenco, ma c'è da dimenticare.
        if (r.invariato && built.elenco.percorso === 'documenti.cartelle' && built.elenco.op === 'togli'
          && (await require('./documentiIndice').occasionaliFra(built.elenco.voci)).length) delete action._invariato;
        // #947 — una cartella dei documenti che non c'è non entra nell'elenco: si dice subito, senza chiedere un OK a vuoto.
        if (!r.invariato && built.elenco.percorso === 'documenti.cartelle' && built.elenco.op !== 'togli') {
          const mancanti = await require('./documentiIndice').cartelleMancanti(built.elenco.voci);
          if (mancanti.length) {
            action._invariato = `${mancanti.map((m) => `«${m}»`).join(', ')} non ${mancanti.length > 1 ? 'sono cartelle' : 'è una cartella'} `
              + 'di questo computer: controlla il percorso';
          }
        }
      }
    } catch (_) {}
  }
  // #1297 — quello che Filo impara su chi è l'utente nel benvenuto segue la regola dello stile (#592.2).
  if (type === 'SALVA_LEZIONE') {
    delete action._accoglienza;
    if (accoglienza && !confirmed && !assistente && !testoDiAltriNelleAzioni(contesto)) action._accoglienza = true;
  }

  // #845 — una pagina salvata si apre con l'indirizzo che ha in elenco, mai con uno scritto dal modello: lo mette qui il
  // main, e la porta delle uscite lo guarda come quello di NAVIGA. Un id che non c'è non chiede niente.
  if (type === 'APRI_SALVATA') {
    let voce = null;
    try { voce = (await SavedPages.list()).find((p) => p && p.id === String(action.id ?? '').trim()) || null; } catch (_) {}
    if (!voce) return { executed: false, kept: true, output: { aperta: false, trovata: false } };
    action.url = voce.url;
    action._titolo = voce.title || '';
    // I modelli piccoli a volte mandano "true" come stringa.
    action.tieni = action.tieni === true || /^(true|1|si|sì|yes)$/i.test(String(action.tieni ?? ''));
  }

  // #884 — una scheda chiusa si riapre con l'indirizzo dell'archivio, mai con uno scritto dal modello: il popup la nomina.
  // Senza id è l'ultima chiusa, la stessa di Ctrl+Shift+T (#2371).
  if (type === 'RIAPRI_SCHEDA' && String(action.id ?? '').trim()) {
    const v = await voceChiusa(action.id);
    if (!v.voce) return { executed: false, kept: true, output: { riaperta: false, trovata: false } };
    action._titolo = v.perModello.titolo;
  }
  // #1397 — cosa farà ripartire «rimettimi la musica»: il popup lo nomina, e l'esecuzione rifà la stessa scelta.
  if (type === 'RIPRENDI_AUDIO') {
    const tm = winOf(sender)?._filoTabs;
    const b = tm ? await bersaglioAudio(tm, action, schedeViste) : null;
    if (b && (b.tab || b.chiusa)) action._titolo = (await nomeDellaScheda())(b.tab || { url: b.chiusa.url, title: b.chiusa.titolo });
  }
  if (type === 'PAUSA_AUDIO' || type === 'MOSTRA_SCHEDA' || type === 'SALVA_PER_DOPO' || type === 'BLOCCA_SCHEDA' || type === 'SBLOCCA_SCHEDA') {
    const tm = winOf(sender)?._filoTabs;
    const b = !tm ? null : type === 'PAUSA_AUDIO' ? await bersaglioPausa(tm, action, schedeViste)
      : type === 'MOSTRA_SCHEDA' ? await schedaDaMostrare(tm, action, schedeViste)
      : type === 'BLOCCA_SCHEDA' || type === 'SBLOCCA_SCHEDA' ? await schedaDaBloccare(tm, action, schedeViste, sender)
        : action.scheda != null ? await schedaPerNumero(tm, action, schedeViste) : { tab: require('./handlersComuni').targetWebTab(sender).tab };
    const tabs = b ? (b.tabs || (b.tab ? [b.tab] : [])) : [];
    if (tabs.length) { const nome = await nomeDellaScheda(); action._titolo = tabs.map(nome).join(', '); }
  }

  // «Cerca X sul sito Y» (#553): l'indirizzo lo costruisce Filo, dall'elenco dei siti o dal modulo di ricerca della home.
  if ((type === 'NAVIGA' || type === 'LEGGI_PAGINA') && provenienza && !confirmed && !soloConferma) {
    const esito = await ricercaNelSito(action, { provenienza, contesto, parole, sender });
    if (esito) return esito;
  }

  // Un file del computer (#1905): si sa prima del gate se si apre, e col percorso non scritto dall'utente chiede il
  // suo OK. `_fileDelComputer` e `_fileNonScritto` li scrive solo questo punto, mai l'LLM.
  if (type === 'NAVIGA') {
    delete action._fileDelComputer;
    delete action._fileNonScritto;
    const indirizzo = globalThis.SN_ACTION_LEVELS.indirizzoDi(action);
    if (globalThis.SN_URL_NAV.fileDiQuestoComputer(indirizzo)) {
      const FileDelComputer = require('./fileDelComputer');
      const g = await FileDelComputer.giudica(indirizzo);
      // L'assistente sopra una pagina vive nel DOM del sito, che può scrivergli le parole e premergli i bottoni.
      if (assistente) return { executed: false, kept: true, output: { blocked: 'file', motivo: 'assistente', percorso: g.percorso } };
      if (!g.ok) return { executed: false, kept: true, output: { blocked: 'file', motivo: g.motivo, percorso: g.percorso } };
      action._fileDelComputer = g.percorso;
      if (!FileDelComputer.scrittoDallUtente(g.percorso, parole)) action._fileNonScritto = true;
    }
  }

  // Le uscite (elenco in src/shared/urlExfil.js, USCITE) passano dalla porta unica
  // PRIMA del gate: un segreto che esce si ferma a ogni livello, anche confermato. Il resto del
  // verdetto è l'anti-esfiltrazione di #587, che alza NAVIGA e CERCA_WEB a livello 2 con
  // `_exfil` (mai dall'LLM). Vedi src/shared/urlExfil.js.
  // La porta non lancia: un suo guasto arriva qui come blocco e l'azione non parte (#1505).
  const u = await controllaUscita(action, { sender, contesto, provenienza, parole, domanda });
  if (u.blocca) {
    const comando = type === 'ESEGUI_COMANDO' ? { command: String(action.comando ?? action.command ?? action.cmd ?? '').trim() } : {};
    return { executed: false, kept: false, output: { blocked: 'segreto', frase: u.frase, ...(u.regola === 'guasto' ? { guasto: true } : {}), ...comando } };
  }
  if (u.exfil) { action._exfil = true; action._exfilReason = u.reason; }
  if (u.nonCompare) {
    action._nonCompare = true;
    if (u.datiReason) action._exfilReason = u.datiReason;
    // Prima del pannello il rifiuto torna al modello (#553): se trova l'indirizzo in un risultato o in una pagina,
    // lo apre come copiato e l'utente non vede niente. Il pannello arriva se insiste. Un comando va dritto al pannello:
    // l'utente ce l'ha davanti intero, indirizzo compreso (#2293).
    if (!confirmed && !u.insiste && !soloConferma && type !== 'ESEGUI_COMANDO') {
      return { executed: false, kept: false, rejected: true, nonCompare: true, error: rifiutoNonCompare(type), output: { nonCompare: true, url: globalThis.SN_ACTION_LEVELS.indirizzoDi(action) } };
    }
  }

  // CANCELLA_SVEGLIA / MODIFICA_SVEGLIA: il livello dipende da QUANTE sveglie o
  // timer il riferimento dell'utente prende davvero — cosa che solo il main sa,
  // avendo la lista. Risolviamo il riferimento PRIMA del gate e iniettiamo
  // `_targets` (le voci in chiaro, per il popup) e `_targetIds` (su cui agire
  // dopo la conferma: all'OK valgono quelli mostrati, vedi bersagliMostrati).
  // Mai calcolati dall'LLM.
  if (type === 'CANCELLA_SVEGLIA' || type === 'MODIFICA_SVEGLIA') {
    try {
      const list = await FiloMem.listTimers();
      const visti = confirmed ? bersagliMostrati(sender, action) : null;
      const targets = visti && Array.isArray(visti.targetIds)
        ? list.filter((t) => visti.targetIds.includes(t.id))
        : FiloMem.resolveTimerRefs(list, timerRefOf(action));
      action._targets = targets.map(describeTimerEntry);
      action._targetIds = targets.map((t) => t.id);
    } catch (_) {}
  }

  // Le righe della memoria non arrivano a una pagina visitata: né nel popup che le mostra né lette dal modello.
  if ((type === 'DIMENTICA' || type === 'CORREGGI_MEMORIA' || type === 'LEGGI_MEMORIA') && daPaginaNonDiFilo(sender)) {
    return { executed: false, kept: false, rejected: true, error: 'la memoria si tocca solo dalle pagine di Filo' };
  }

  // DIMENTICA: le righe che la frase indica le trova il main, prima del gate,
  // così il popup mostra quelle che se ne andranno (#592).
  let righeDaDimenticare = [];
  if (type === 'DIMENTICA') {
    try {
      if (confirmed) {
        const visti = bersagliMostrati(sender, action);
        righeDaDimenticare = await FiloMem.linesWithText(visti && Array.isArray(visti.righe) ? visti.righe : []);
      } else {
        righeDaDimenticare = await FiloMem.findLines(action.testo ?? action.text ?? action.riga ?? '');
      }
    } catch (_) {}
    action._righe = righeDaDimenticare.map((r) => r.testo);
    action.per_sempre = perSempreDetto(action.per_sempre);
  }

  // #1295 — la conversazione la trova il main (l'id detto, o quella di adesso), prima del gate: il popup dice quale.
  if (type === 'TOGLI_CHAT' || type === 'RIMETTI_CHAT') {
    if (daPaginaNonDiFilo(sender)) {
      return { executed: false, kept: false, rejected: true, error: 'le conversazioni si toccano solo dalle pagine di Filo' };
    }
    const detto = String(action.id ?? action.chatId ?? '').trim();
    const id = detto || (type === 'TOGLI_CHAT' ? String(chatId || '') : '');
    let chat = null;
    try { chat = id ? await FiloChats.get(id) : null; } catch (_) { chat = null; }
    if (!chat || (type === 'RIMETTI_CHAT' && !chat.nascosta)) {
      return { executed: false, kept: false, output: { trovata: false, ...(chat ? { giaInVista: true } : {}) } };
    }
    action.id = chat.id;
    action._titolo = chat.title || ChatArchive.fallbackTitle(chat.messages);
    action._corrente = !!chatId && chat.id === chatId;
    if (type === 'TOGLI_CHAT') action.per_sempre = perSempreDetto(action.per_sempre);
  }

  // CORREGGI_MEMORIA (#872): la riga la trova il main come per DIMENTICA, e all'OK vale quella che il popup ha mostrato.
  let rigaDaCorreggere = null;
  if (type === 'CORREGGI_MEMORIA') {
    let trovate = [];
    try {
      if (confirmed) {
        const visti = bersagliMostrati(sender, action);
        trovate = await FiloMem.linesWithText(visti && Array.isArray(visti.righe) ? visti.righe : []);
      } else {
        trovate = (await FiloMem.findLines(action.testo ?? action.text ?? action.riga ?? ''))
          .filter((r) => r.via && typeof r.via.sempreAperta !== 'string');
      }
    } catch (_) {}
    action._righe = trovate.map((r) => r.testo);
    rigaDaCorreggere = trovate.length === 1 ? trovate[0] : null;
  }

  // «Metti Screenshot in cima alla barra»: l'icona detta col nome del menu diventa il suo id prima del registro, così
  // popup, esito e diario dicono quella giusta.
  if (type === 'SPOSTA_ICONA' && globalThis.SN_DISPOSIZIONE_ICONE) {
    const id = globalThis.SN_DISPOSIZIONE_ICONE.risolvi(action.icona ?? action.id, action.contesto);
    if (id) { action.icona = id; delete action.id; }
  }

  // «Tieni sempre aperto X» (#823): il sito lo risolve il main (detto, o la scheda web davanti), così il popup e
  // l'esito dicono quello che si salva o si toglie davvero.
  if (type === 'TIENI_APERTA' || type === 'NON_TENERE_APERTA') {
    const detto = String(action.dominio ?? action.domain ?? action.sito ?? '').trim();
    const davanti = detto ? '' : ((targetWebTab(sender).tab || {}).url || '');
    try {
      if (type === 'TIENI_APERTA') action._voce = SempreAperte.voceDa(detto || davanti, { daScheda: !detto });
      else action._voci = await SempreAperte.daTogliere(detto || davanti);
    } catch (_) {}
    action._detto = detto || davanti;
  }

  // CHIUDI_SCHEDE (#413): le schede le sceglie il main dai numeri che il modello aveva davanti, prima del gate, così il
  // popup le nomina; all'OK si chiudono quelle mostrate (bersagliMostrati). La scheda della chat solo se nominata.
  if (type === 'CHIUDI_SCHEDE') {
    const tm = winOf(sender)?._filoTabs;
    if (!tm) return { executed: false, kept: false, output: { error: 'nessuna finestra con schede' } };
    const chat = sender?.tab?.id ?? null;
    let scelta;
    // Dopo l'OK restano quelle che il popup lasciava fuori: senza, il modello non sa della bloccata o della bozza lasciate.
    let restanoMostrate = null;
    if (confirmed) {
      const visti = bersagliMostrati(sender, action);
      const ids = visti && Array.isArray(visti.targetIds) ? visti.targetIds : [];
      scelta = { chiudere: tm.tabs.filter((t) => ids.includes(t.id)), restano: [] };
      restanoMostrate = (visti && Array.isArray(visti.restano) ? visti.restano : []).slice(0, 100)
        .filter((x) => x && typeof x.perche === 'string')
        .map((x) => ({ nome: String(x.nome || '').slice(0, 300), perche: x.perche.slice(0, 20) }));
    } else {
      const viste = await schedeNumerate(winOf(sender), schedeViste);
      const motivo = await tm.motiviPerRestare();
      // Un sito nominato si chiude anche se è tenuto sempre aperto: l'ha detto l'utente; il testo non inviato resta.
      const resta = (tab, modo) => { const m = motivo(tab); return m === 'sempre' && modo !== 'tutte' ? '' : m; };
      scelta = ChiudiSchede.risolvi(action, { schede: tm.tabs, viste, numerate: FiloState.SCHEDE_NUMERATE_CHAT, chat, resta });
      if (scelta.errore) return { executed: false, kept: false, output: { error: scelta.errore } };
    }
    const nome = await nomeDellaScheda();
    action._targets = scelta.chiudere.map((t) => (t.id === chat ? 'questa scheda, con la conversazione' : nome(t)));
    action._targetIds = scelta.chiudere.map((t) => t.id);
    // Le bloccate qui ci sono solo se chieste per numero: alzano il costo (actionLevels) e la risposta lo dice (#2086).
    action._bloccate = scelta.chiudere.filter((t) => t.bloccata).length;
    action._restano = restanoMostrate || scelta.restano.map((x) => ({ nome: x.tab ? nome(x.tab) : `la numero ${x.numero}`, perche: x.perche }));
    action._inIncognito = !!tm.incognito;
    if (!scelta.chiudere.length) {
      const nessuna = scelta.restano.length ? '' : (scelta.sito && !scelta.tutte ? 'sito' : 'niente');
      return {
        executed: false, kept: false,
        output: { chiuse: 0, ...contoRestano(action._restano), ...(nessuna ? { nessuna } : {}) },
      };
    }
  }

  // CANCELLA_PAGINE (#866): periodo e numero di pagine li calcola il main, così il popup dice il conto vero.
  if (type === 'CANCELLA_PAGINE') {
    const sito = globalThis.SN_FILO_EVENTI.normaSito(action.sito ?? action.dominio ?? action.site ?? '');
    // Un sito senza periodo («cancella le pagine di YouTube») vuol dire tutte le sue pagine.
    const limiti = { ore: action.ore, giorni: action.giorni, da: action.da, a: action.a };
    const senzaLimiti = Object.values(limiti).every((v) => v == null || v === '');
    const nome = action.periodo || (sito && senzaLimiti ? 'tutto' : 'ultima_ora');
    action._periodo = globalThis.SN_FILO_EVENTI.periodo(nome, limiti);
    if (!action._periodo) {
      return { executed: false, kept: false, output: { errore: 'periodo non capito: usa ultima_ora, oggi, ieri, tutto, oppure ore, giorni, o da/a (istanti ISO o giorni AAAA-MM-GG)' } };
    }
    if (sito) { action._periodo.sito = sito; action._sito = sito; action._nomePeriodo = nome; }
    try { action._n = (await globalThis.SN_IL_FILO.pagine(action._periodo)).length; } catch (_) {}
  }

  // ── modalità terminale: gate hard, indipendente dal livello (#146.6) ──────
  // Con la modalità terminale spenta nelle impostazioni Filo non esegue ALCUN
  // comando. Controllo PRIMA del gate dei livelli: così un terminale spento
  // non fa nemmeno comparire il box "digita conferma" — l'utente vede subito
  // che è spento.
  if (type === 'ESEGUI_COMANDO') {
    const cmd = String(action.comando ?? action.command ?? action.cmd ?? '').trim();
    let s = {};
    try { s = await Storage.getSettings(); } catch (_) {}
    if (!s.terminal || !s.terminal.enabled) {
      return { executed: false, kept: true, output: { command: cmd, blocked: 'disabled' } };
    }
    // Cartella di lavoro per il popup di conferma. L'assistente la sposta da sé
    // (`cd` è livello 1: eseguito subito, senza chiedere niente, e valido per i
    // comandi successivi), quindi il solo testo del comando non dice DOVE il
    // comando andrà a scrivere. Calcolata qui dal main sulla cwd vera: mai
    // dall'LLM, e mai usata per decidere il livello. Il prefisso `_` la tiene
    // fuori dalla firma dell'azione (actionSignature), così RUN e CONFIRM
    // continuano a combaciare.
    // Se quella cartella nel frattempo è sparita, il comando girerà nella home:
    // il popup deve dire QUELLA, altrimenti promette una cartella e ne usa
    // un'altra (#551, quarto giro). Stessa domanda che si fa il comando quando
    // parte, fatta nello stesso posto.
    action._cwd = displayCwd(cartellaDelComando(getAssistantCwd(sender)));
    // Ripulita qui una volta, la stessa per popup, bottone e conferma (idempotente: la firma regge).
    const AL = globalThis.SN_ACTION_LEVELS;
    if (AL && AL.spiegazioneComando) action.spiegazione = AL.spiegazioneComando(action);
    // La frase che spiega il terminale va coi comandi in chat finché non è stata
    // mostrata (#892); la conferma è un secondo giro della stessa proposta.
    if (cmd && !confirmed && !assistente && await primaVoltaDelTerminale()) action._primaVolta = true;
  }

  // ── guardare lo schermo (#778): gate duro e scelta della finestra, prima del gate dei livelli ──────────
  // Spenta in Preferenze, Filo non elenca e non cattura niente. Il popup deve dire QUALE finestra: la sceglie
  // qui il main, dal nome che ha dato il modello; all'OK vale quella mostrata.
  if (type === 'VEDI_SCHERMO') {
    let s = {};
    try { s = await Storage.getSettings(); } catch (_) {}
    const mostrata = confirmed ? ((bersagliMostrati(sender, action) || {}).finestra || null) : null;
    const pre = await Schermo.prepara(action, { settings: s, chiave: chiaveSchermo(sender), mostrata });
    if (pre.esito) return pre.esito;
  }

  if (type === 'ESEGUI_COMANDO' || type === 'LEGGI_DOCUMENTO' || type === 'CERCA_DOCUMENTI') action._perimetro = perimetroLettura(sender);
  // #1499 — il costo misura la cartella che l'indice leggerà, risolta qui come la risolve lui (sopra quella arrivata col
  // modello). Una su un altro computer non si cerca: lo si dice subito, senza chiedere un OK che non porterebbe a niente.
  if (type === 'CERCA_DOCUMENTI') {
    delete action._cartella;
    let ch = null;
    try { ch = await require('./documentiIndice').cartellaChiesta(action.cartella); } catch (_) { ch = null; }
    if (ch) action._cartella = ch.serie ? '' : ch.percorso;
    if (ch && ch.rete) return { executed: false, kept: true, output: ricercaSuAltroComputer(action) };
  }
  // Il comando si giudica come lo legge la shell che lo eseguirà, e parte con quella stessa (#1072.1: cmd toglie i `^`).
  if (type === 'ESEGUI_COMANDO') action._perimetro.shell = await shellDeiComandi();

  // #950 — l'elenco vecchio → nuovo lo prepara il main leggendo i file, prima della conferma: il popup mostra
  // i nomi veri, e all'OK si rinomina quello che il popup ha mostrato (bersagliMostrati).
  if (type === 'RINOMINA_FILE' && !confirmed) {
    const prep = await preparaRinomina(action, sender, avanzamento);
    action._proposte = prep.proposte;
    action._saltati = prep.saltati;
    action._oltre = prep.oltre;
    action._daScaricati = prep.proposte.some((p) => fileScaricato(p && p.da));
    if (!prep.proposte.length) {
      const errore = prep.errore || (prep.saltati.length ? 'nessuno dei file si può rinominare' : 'nessun file da rinominare');
      return { executed: false, kept: false, output: { error: errore, saltati: prep.saltati } };
    }
  }

  // #1909 — il «per sempre» vale solo detto chiaro; gli elementi li trova il main, e all'OK valgono quelli mostrati.
  if (type === 'ELIMINA_FILE') {
    action.per_sempre = perSempreDetto(action.per_sempre);
    if (!confirmed) {
      const prep = await preparaEliminazione(action, sender);
      action._file = prep.file;
      action._saltati = prep.saltati;
      action._oltre = prep.oltre;
      if (!prep.file.length) {
        const errore = prep.errore || (prep.saltati.length ? 'nessuno di questi si può cancellare' : 'niente da cancellare');
        return { executed: false, kept: false, output: { error: errore, saltati: prep.saltati } };
      }
    }
  }

  // Il livello di un annullo è quello del cambio che rimette: lo legge il main dal registro, sempre,
  // sopra qualunque valore arrivato con l'azione.
  if (type === 'ANNULLA_CAMBIO') {
    const bersaglio = await Registro.livelloDi(idDelCambio(action));
    action._livelloCambio = bersaglio ? bersaglio.livello : 1;
    action._fraseCambio = bersaglio ? bersaglio.frase : '';
    action._fraseCambioParti = bersaglio && bersaglio.parti ? bersaglio.parti : null;
    action._allentaCambio = !bersaglio || bersaglio.allenta !== false;
    action._doveCambio = bersaglio && action._allentaCambio ? String(bersaglio.dove || '') : '';
  }

  // #874 — il livello di un comando del sistema lo decide la stessa lettura della richiesta che poi la esegue:
  // scritta qui sempre, sopra qualunque valore arrivato col modello.
  if (type === 'VOLUME' || type === 'BLUETOOTH' || type === 'WIFI') {
    const C = require('./comandiSistema');
    if (!confirmed) delete action._nomeTrovato;
    const q = C.normalizzaRichiesta(richiestaDiSistema(type, action));
    // Una richiesta che non partirebbe torna al modello subito, senza un popup che chiede di confermarla.
    if (q.errore) return { executed: false, kept: false, output: { ok: false, cosa: type.toLowerCase(), errore: 'richiesta', frase: q.errore } };
    let nome = q.nome || '';
    // Il dispositivo che la conferma ha nominato, fissato col suo indirizzo: lo scrive solo il main (#2394.1).
    let indirizzo = '';
    // Già com'è chiesto (la rete è quella, le cuffie sono staccate, la radio è spenta): niente da confermare.
    let gia = false;
    // Rete e dispositivo da confermare: il popup nomina quello che partirà, trovato prima di chiedere; all'OK parte
    // quello mostrato. Un nome che non ne trova uno solo torna al modello con l'elenco, senza una conferma a vuoto.
    if (nome && (type === 'WIFI' || q.collega === false || q.dimentica)) {
      if (confirmed) {
        const visti = bersagliMostrati(sender, action);
        if (visti && typeof visti.nome === 'string' && visti.nome) nome = visti.nome;
        if (visti && typeof visti.indirizzo === 'string') indirizzo = visti.indirizzo;
      } else {
        const trovato = await C.risolviNome(q);
        if (trovato.esito) return { executed: false, kept: false, output: trovato.esito };
        // Il nome vero l'ha scelto chi gestisce la rete o il dispositivo: entra nel compito come una lettura.
        if (trovato.nome && trovato.nome !== q.nome) action._nomeTrovato = true;
        if (trovato.nome) nome = trovato.nome;
        if (trovato.indirizzo) indirizzo = trovato.indirizzo;
        gia = trovato.gia === true;
      }
    } else if (!nome && q.acceso === false && !confirmed) {
      const letto = globalThis.SN_SISTEMA_MAIN && typeof globalThis.SN_SISTEMA_MAIN.stato === 'function' ? globalThis.SN_SISTEMA_MAIN.stato() : null;
      // Una radio letta prima di una pausa del lettore (`vecchio`) non è «già spenta»: si chiede la conferma (#2394).
      const vecchia = letto && Array.isArray(letto.vecchio) && letto.vecchio.includes(type === 'WIFI' ? 'wifi' : 'bluetooth');
      const radio = letto && !vecchia && (type === 'WIFI' ? letto.wifi : letto.bluetooth);
      gia = !!radio && radio.acceso === false;
    }
    action._richiestaSistema = { ...q, ...(nome ? { nome } : {}), ...(gia ? { gia: true } : {}) };
    // Il nome sta anche fuori, dove il recinto dei testi salvati lo trova (CAMPI_SALVATI in azioniPerModello.js).
    if (nome) action._nomeSistema = nome;
    else delete action._nomeSistema;
    if (type === 'BLUETOOTH' && nome && indirizzo) action._indirizzoSistema = indirizzo;
    else delete action._indirizzoSistema;
  }

  // #1039 — «aggiornati» riavvia Filo solo se una versione è già pronta: lo dice l'updater, mai il modello.
  if (type === 'INSTALLA_AGGIORNAMENTO') {
    let st = null;
    try { st = await require('../updater').statoAggiornamento(); } catch (_) {}
    action._riavvio = !!(st && st.riavvio);
    action._versione = action._riavvio ? st.versione : null;
    action._conBarra = action._riavvio && st.piattaforma === 'win32';
  }

  // #1619 — il ripristino pesa quanto quello che cambierebbe adesso: lo legge il main, sempre, sopra qualunque
  // valore arrivato col modello; all'OK si rilegge, e si conferma quello che poi si scrive.
  if (type === 'PULSANTE_PREFERENZE') {
    delete action._ripristino;
    const P = globalThis.SN_PULSANTI_PREFERENZE;
    if (P && P.pulsanteDi(action) === 'ripristina_tutto') action._ripristino = await anteprimaRipristino();
  }

  // ── chi decide se parte (#530) ─────────────────────────────────────────────
  // Il registro dà costo, campo, freno tolto e segreti (src/shared/actionLevels.js), mai l'LLM; la risposta
  // la dà SN_AUTONOMIA col livello scelto dall'utente e lo stato del compito. Fuori registro o senza costo:
  // non parte. `confirmed` salta solo la sospensione, il registro si rilegge anche alla conferma.
  const Levels = globalThis.SN_ACTION_LEVELS;
  let impostazioni = {};
  try { impostazioni = await Storage.getSettings(); } catch (_) {}
  // Alla conferma la richiesta non viaggia: valgono le parole dell'utente che la pagina rimanda, come per la porta delle uscite.
  const ing = Levels ? Levels.ingressi(action, { richiesta: richiesta || parole, impostazioni }) : null;
  if (!ing) {
    console.warn('[Filo] azione non registrata o senza costo, rifiutata:', type);
    return { executed: false, kept: false, rejected: true };
  }
  let decisione = decisioneAutonomia(ing, { sender, contesto, fontiLette, assistente, origine, dentroPerimetro: dentroPerimetro && ing.dentroPerimetro, chiesta, impostazioni });
  // L'indirizzo scritto dal modello si conferma con un OK (decisione su D-20): aprire o leggere una pagina si disfa,
  // e il riquadro da digitare direbbe il contrario. Così un comando che costerebbe meno di 3 senza l'indirizzo (#2293).
  if (action._nonCompare && decisione.digita
    && (type !== 'ESEGUI_COMANDO' || Levels.costoFor({ ...action, _nonCompare: false, _exfil: false }) < 3)) {
    decisione = { ...decisione, digita: false };
  }
  const perimetroDentro = dentroPerimetro && ing.dentroPerimetro;
  const contati = ingressiContati(ing, decisione, { origine, dentroPerimetro: perimetroDentro });
  if (decisione.risposta === 'no') {
    if (!soloConferma) contaSe('confermaDecisa', type, contati, 'negata');
    const no = fraseNo(ing, decisione, sender);
    return { executed: false, kept: false, no: true, error: no.perModello, output: { error: no.breve, rifiuto: true, no: true } };
  }
  // PULISCI_TAB e CANCELLA_ARCHIVIO lavorano in un pannello del client (bottone → RUN_TAB_TRIAGE / elenco
  // da eliminare) che ha solo la chat della home: niente sospensione qui, il pannello chiede come dice `domanda`
  // (sotto, nello switch). L'assistente sulla pagina usa il popup generico, e senza l'elenco davanti
  // una cancellazione definitiva non si propone (#825.3).
  if (type === 'CANCELLA_ARCHIVIO' && assistente) {
    return {
      executed: false,
      kept: false,
      output: { rifiuto: true, error: 'l\'elenco delle schede da eliminare si vede e si conferma dalla chat di Filo nella home' },
    };
  }
  const hasBespokeConfirm = (type === 'PULISCI_TAB' || type === 'CANCELLA_ARCHIVIO') && !assistente;
  const daChiedere = decisione.risposta !== 'si';
  // L'attesa della risposta dell'utente, la stessa per il popup generico e per i pannelli di riordino e archivio.
  const sospesa = () => {
    const describe = Levels.describe(action);
    const parti = Levels.describeParts(action);
    return {
      executed: false,
      kept: true,
      needsConfirm: decisione.digita ? 3 : 2,
      ...(decisione.risposta === 'propone' ? { proposta: true } : {}),
      describe: decisione.perche ? `${describe}\n\n${decisione.perche}` : describe,
      parti: decisione.perche ? [...parti, `\n\n${decisione.perche}`] : parti,
      // Il box da digitare dice «non è reversibile»: per una difesa abbassata non è vero.
      ...(decisione.digita && decisione.regola === 'difesa' ? { avviso: 'Abbassa una difesa di Filo.' } : {}),
    };
  };
  // Solo la domanda, per l'indirizzo che il modello ha lasciato dopo il rifiuto (#553): mai eseguita da qui.
  if (soloConferma && (!daChiedere || confirmed || hasBespokeConfirm)) return { executed: false, kept: false };
  if (daChiedere && !confirmed && !hasBespokeConfirm) {
    // Da qui in poi QUESTO mittente potrà confermare questa stessa azione
    // (difesa in profondità #250): registriamo il pending prima di sospendere.
    recordPendingConfirm(sender, action);
    contaSe('confermaChiesta', pendingConfirmKey(sender, action), type, contati);
    if (type === 'INVIA_FEEDBACK') ricordaSegnalazione(sender, action, compitoSenzaTestoDiAltri(sender, { contesto, fontiLette, assistente, impostazioni }));
    return sospesa();
  }
  // #250 — Un'azione che RICHIEDE conferma non può arrivare `confirmed` da una
  // pagina web esterna a meno che quel mittente non sia PRIMA passato per la
  // richiesta di conferma (RUN → popup → CONFIRM). Le pagine interne filo://
  // sono fidate per origine. Un FILO_CONFIRM_ACTION forgiato "a freddo" da fuori
  // non ha un pending corrispondente → rifiutato (l'azione non si esegue).
  if (daChiedere && confirmed && !hasBespokeConfirm) {
    if (!daPaginaDiFilo(sender) && !consumePendingConfirm(sender, action)) {
      console.warn('[Filo] FILO_CONFIRM_ACTION senza conferma legittima: rifiutata', type);
      return { executed: false, kept: false, rejected: true };
    }
    contaSe('confermaRisposta', pendingConfirmKey(sender, action), 'approvata', { tipo: type, info: contati });
  }
  if (!soloConferma && !confirmed) {
    if (!daChiedere) contaSe('confermaDecisa', type, contati, 'automatica');
    // Il pannello chiede lui: la risposta della persona arriva da lì (dashboard-attivita.js, `chiediSecondoRegola`).
    else if (hasBespokeConfirm) contaSe('confermaChiesta', `pannello:${type}`, type, contati);
  }

  try {
    const esegui = Object.hasOwn(AZIONI, type) ? AZIONI[type] : null;
    if (!esegui) return { executed: false, kept: false };
    return await esegui(action, {
      confirmed, sender, contesto, fontiLette, assistente, parole, avanzamento, chatId, segnale, nascostiDellaChat,
      domanda, capRilettura, schedeViste, intervista, type, righeDaDimenticare, rigaDaCorreggere, impostazioni,
      decisione, daChiedere, sospesa, senzaRilettura: senzaRilettura === true,
      // I segreti per cui l'utente ha appena scritto «conferma»: il riquadro lo diceva, e non si richiede (#2645).
      segretiConfermati: confirmed && daChiedere && decisione.digita && ing.segreto && Array.isArray(ing.segreti) ? ing.segreti : [],
});
  } catch (e) {
    console.warn('[Filo] action exec failed', type, e);
    return { executed: false, kept: false };
  }
}

// Le azioni di Filo per tipo: ogni gruppo in services/azioni/ esporta la sua tabella tipo -> funzione.
const AZIONI = Object.freeze(Object.assign(Object.create(null),
  require('./azioni/naviga'),
  require('./azioni/sveglie'),
  require('./azioni/memoria'),
  require('./azioni/file'),
  require('./azioni/proxy'),
  require('./azioni/impostazioni'),
  require('./azioni/sistema'),
  require('./azioni/immagini'),
));

async function maybeCategorizeAsync(savedEntry, pageInput) {
  const settings = await getEffectiveSettings();
  if (!settings.featureFlags?.categorize) return;
  if (await Costs.isOverLimit(settings.monthlyLimitEur)) return;
  if (!SN_CONST.canServeAction(settings, ACTIONS.CATEGORIZE)) return;
  await require('./categoriaSalvata').categorizza(savedEntry, pageInput, {
    settings,
    chiedi: ({ action, payload, origin }) => handleAIRequest({ action, payload, origin, intera: true }),
  });
}

// Registro degli handler per dominio: ogni modulo sotto handlers/ registra i suoi tipi e
// handleMessage fa lookup e fallback; le funzioni di supporto arrivano via ctx.

const registry = new Map();

function on(type, fn) {
  if (registry.has(type)) throw new Error(`[handlers] handler duplicato per "${type}"`);
  registry.set(type, conSegnoDelGesto(type, fn));
}

// Un tasto dell'interfaccia che fa quello che fa un'azione del catalogo lascia la stessa azione nel filo (#1561), da
// qui per tutti: quali sono lo dice src/shared/filoAccaduti.js (GESTI).
function conSegnoDelGesto(type, fn) {
  const A = globalThis.SN_FILO_ACCADUTI;
  if (!A || !A.GESTI || !Object.prototype.hasOwnProperty.call(A.GESTI, type)) return fn;
  return async (msg, ...resto) => {
    const res = await fn(msg, ...resto);
    segnoDelGesto(type, msg, res);
    return res;
  };
}
function segnoDelGesto(type, msg, res) {
  try {
    const g = globalThis.SN_FILO_ACCADUTI.gestoComeAzione(type, msg, res);
    if (g) azioneNelFilo(g.action, g.res, { via: 'interfaccia', chatId: '', incognito: require('../shim/storage').inIncognito() });
  } catch (_) {}
}

const handlerCtx = {
  MSG,
  stimaSogliaCompattazione,
  memoriaCambiata: () => FiloMem.viewForUser().then((v) => broadcastToFiloPages({ type: MSG.FILO_MEMORY_CHANGED, ...v })).catch(() => {}),
  winOf,
  filoWin,
  broadcastToTabs,
  broadcastToFiloPages,
  annunciaCarteHome,
  annunciaBarraSiti,
  ambitoDellaFinestra,
  broadcastLiveUpdate,
  getEffectiveSettings,
  fillMovedSlots,
  withDefaults,
  Defaults,
  isAdmin: () => {
    try { return require('../auth/google-auth').isAdmin(); } catch (_) { return false; }
  },
  applySettingsUpdate,
  wireSafebrowse,
  modelForAction,
  buildAttemptChain,
  providerRouting,
  openWeightsBlockReason,
  avvisiFuoriPolitica: AvvisiFuoriPolitica,
  modelGate: Gate,
  handleAIRequest,
  maybeCategorizeAsync,
  apriPaginaSalvata,
  searchArchivedTabs,
  archivioDaCancellare,
  handleFiloChat,
  fermaFiloChat,
  seguitoFiloChat,
  handleFiloGenerateDashboard,
  contaHomeVista,
  executeFiloAction,
  chiaveConferma: pendingConfirmKey,
  segretiCustoditi,
  controllaUscita,
  apriDaFilo,
  sitoDaConfermare,
  contattabilePrimaDelClic,
  SCHEMI_USCITA,
  ricordaLettoDallAiuto,
  ricordaLettoInChat,
  ricordaVerdettiArchiviati,
  decisioneAzionePagina,
  segnaLetturaAiuto,
  segnaTestoNellAiuto,
  segnaPaginaDiFiloNellAiuto,
  azioneDellAiuto,
  segnaChatAiuto,
  chatAiutoDi,
  fileScaricato,
  nuovaConversazioneAiuto,
  maybeRunCompactor,
  // Archivio delle chat (#525)
  closeAndTriageChat,
  sweepPendingChats,
  archiviaCongedoAccoglienza,
  dimenticaChat,
  portaAllaChat,
  affidaChat,
  nascondiChat,
  cancellaChatPerSempre,
  // Intervista di benvenuto (#524)
  saveOnboarding,
  finishOnboarding,
  claimOnboardingResume,
  releaseOnboardingResume,
  // I pulsanti delle Preferenze, uguali dalla pagina e dalla chat (#1619)
  ricominciaIntervista,
  ripristinaImpostazioni,
};

require('./handlers/index')(on, handlerCtx);

async function handleMessage(msg, sender = {}) {
  const origin = origineDi(sender);
  const fn = registry.get(msg.type);
  if (fn) return fn(msg, sender, origin);
  return { ok: false, error: `Tipo messaggio sconosciuto: ${msg.type}` };
}

Registro.collega({
  applicaImpostazioni: (parziale) => applySettingsUpdate(parziale),
  aggiornaVivo: () => broadcastLiveUpdate(),
  aggiornaRegoleProxy: () => refreshProxyRulesAllWindows(),
  // Lo zoom di un sito vale per la sua sessione: un annullo dell'incognito non tocca le finestre normali.
  zoomSu: async (host, percentuale) => {
    const incognito = require('../shim/storage').inIncognito();
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || typeof tm.zoomSulSito !== 'function' || !!w._filoIncognito !== incognito) continue;
      if (await tm.zoomSulSito(host, percentuale)) return true;
    }
    return false;
  },
  disposizioneIcone: (cambia, { mossa } = {}) => require('./layoutIcone').riscrivi(cambia, { incognito: require('../shim/storage').inIncognito(), mossa }),
  annuncia: (ids) => broadcastToFiloPages({ type: MSG.CAMBI_AGGIORNATI, ids }),
  // `evento`: il cambio su cui si è premuto «annulla», per i contatori dei ripensamenti (#1471).
  annullato: (ids, evento) => { contaSe('cambioAnnullato', ids); contaSe('cambioRitirato', evento); },
});
Registro.avvia();
// Gli altri accaduti del filo (#1561): i documenti dell'editor si osservano nel salvataggio, il sistema anche a home chiusa.
require('./accaduti').avvia();
try { require('./statoSistema').sorveglia(); } catch (_) {}

// Le righe delle conversazioni delle app (#974): la home le richiede, la Cronologia rilegge l'elenco; una tolta perché
// l'app l'ha cancellata la dice come le chat cancellate. Quanti giorni mostrarne: quelli che la chat ha davanti.
ConversazioniApp.collega({
  annuncia: (tolte) => {
    broadcastToFiloPages({ type: MSG.FILO_RIGHE_APP_CAMBIATE });
    if (Array.isArray(tolte) && tolte.length) for (const id of tolte) broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED, cancellata: id });
    else broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED });
  },
  tetti: async () => globalThis.SN_FILO_CONTESTO.tetti((await getEffectiveSettings()).contestoFilo, Defaults.get().contestoFilo),
});

// Pagine entrate, rititolate o tolte dal filo, da qualunque strada: le home aperte rifanno le righe delle pagine (#869).
globalThis.SN_IL_FILO.suPagine(() => broadcastToFiloPages({ type: MSG.FILO_PAGINE_CAMBIATE }));
// Una pagina tolta porta via subito anche le righe del diario nate da lei, come una conversazione cancellata.
globalThis.SN_IL_FILO.suPagine(({ incognito }) => {
  Compattazione.dimenticaPagine(incognito).catch((e) => console.warn('[Filo] diario della pagina cancellata:', e?.message || e));
});

// Filo parla per primo (#869): cosa genera il messaggio, quando può farlo, e a chi lo dice.
FiloParla.collega({
  genera: (o) => generaPerFiloParla(o),
  puoParlare: () => filoPuoParlare(),
  // Il messaggio sta nel filo di disco: una finestra incognito ha il suo, e non lo vede.
  annuncia: (m) => broadcastToTabs({ type: MSG.FILO_PARLA, ...m }, { soloNormali: true }),
});

// Configura il rilevatore di siti pericolosi (services/safebrowse) dalle
// impostazioni SALVATE (non quelle con i default già dentro): va richiamato al
// boot e a ogni UPDATE_SETTINGS. La chiave GSB invece si ricalcola a ogni
// verifica, perché accesso e uscita dell'admin la cambiano senza toccare
// le preferenze (#679.4). Feature spenta: resta solo l'analisi locale.
async function wireSafebrowse(settingsArg) {
  const SB = globalThis.SN_SAFEBROWSE;
  if (!SB || typeof SB.configure !== 'function') return;
  let settings = settingsArg;
  if (!settings) {
    try { settings = await Storage.getSettings(); } catch (_) { settings = {}; }
  }
  settings = settings || {};
  const sb = (settings.security && settings.security.safeBrowse) || {};
  // I siti fidati valgono anche col rilevatore spento: l'analisi locale resta, e l'elenco è dell'utente (#967).
  const fidati = SB.impostaFidati ? SB.impostaFidati(sb.trustedSites) : { aggiunti: [], tolti: [] };
  if (fidati.aggiunti.length || fidati.tolti.length) {
    for (const w of BrowserWindow.getAllWindows()) { try { w._filoTabs?._sbFidatiCambiati?.(fidati); } catch (_) {} }
  }
  if (sb.enabled === false) {
    SB.configure({ gsbKey: '', runLlm: null, enableSandbox: false, enableNetwork: false });
    return;
  }
  // Giudice LLM: riusa la catena di fallback dei provider con il modello
  // configurato per questa funzione (slot proprio, visibile nell'editor dei
  // modelli). Solo METADATI (mai contenuto pagina) passano da llm.judge.
  const runLlm = sb.llmJudge === false ? null
    : (messages) => Gate.text({ action: ACTIONS.SAFEBROWSE_JUDGE, messages });
  SB.configure({
    gsbKey: () => safeBrowsingKeyFor(settings),
    runLlm,
    enableSandbox: sb.sandbox !== false,
    enableNetwork: sb.networkSignals !== false,
  });
}

// Su globalThis per evitare il ciclo di require fra TabManager e handlers.js.
globalThis.SN_TAB_TRIAGE_DECIDE = runTabTriageDecision;

// Livello 2 del geo-block (§4): classificatore LLM con un modello economico e SOLI
// metadati minimali; il contenuto è input non fidato, l'hardening è nel suo prompt.
let geoClassifierCache = null;
// #760 — il riquadro di terzi rotto che le regole non riconoscono: un modello con la vista guarda solo il riquadro.
require('./riquadriRotti').usaModello((messages) => Gate.text({ action: ACTIONS.EMBED_COOKIE_CHECK, messages }));

globalThis.SN_GEO_CLASSIFY = async function geoClassify(input) {
  const Classifier = globalThis.SN_GEOBLOCK_CLASSIFIER;
  if (!Classifier) return { class: null, route: { proxy: false }, skipped: true };
  if (!geoClassifierCache) geoClassifierCache = Classifier.createCache();
  const complete = ({ messages, signal }) => Gate.text({ action: ACTIONS.GEOBLOCK_CLASSIFY, messages, signal });
  return Classifier.classify(input, { complete, cache: geoClassifierCache });
};

// Su globalThis per i test Playwright (app.evaluate non ha require): è il dispatch col gate.
globalThis.SN_EXECUTE_FILO_ACTION = executeFiloAction;
// #778 — le prove mettono un sistema finto sotto la cattura delle finestre (_perProve.usaSistema).
globalThis.SN_SCHERMO = Schermo;
globalThis.SN_SEGRETI_LETTI = SegretiLetti;
// Idem per la chat della home: i test ne ispezionano il prompt costruito (#158).
globalThis.SN_HANDLE_FILO_CHAT = handleFiloChat;
// #525 — chiusura + classificazione di una chat archiviata: gli spec devono
// poter chiudere una chat come fa la home, senza reinventare la sequenza.
globalThis.SN_CLOSE_FILO_CHAT = closeAndTriageChat;
globalThis.SN_SWEEP_FILO_CHATS = sweepPendingChats;
// Dispatch grezzo (msg, sender) per i test che verificano il gate d'origine sui
// canali privilegiati (storage/settings): permette di simulare un mittente con
// origine web e asserire che le chiavi API non trapelano. Vedi handlers/storage.js.
globalThis.SN_HANDLE_MESSAGE = handleMessage;
// Gli spec devono usare la funzione VERA: riscriverne una copia verificherebbe il test,
// e qui la cosa da verificare è proprio CHI riceve.
globalThis.SN_BROADCAST_FILO = broadcastToFiloPages;
// Il quaderno mostra le memorie che una compattazione ha proposto: si rilegge quando ne arrivano.
Compattazione.suCompattazione(({ inAttesa }) => { if (inAttesa) handlerCtx.memoriaCambiata(); });
// Le Preferenze mostrano la memoria riga per riga (#592): a ogni scrittura il
// main la rilegge una volta e la manda dentro l'avviso, alle sole pagine di Filo.
try {
  FiloMem.setOnMemoryChange(() => {
    FiloMem.viewForUser()
      .then((v) => broadcastToFiloPages({ type: MSG.FILO_MEMORY_CHANGED, ...v }))
      .catch(() => {});
  });
} catch (_) {}

module.exports = {
  handleMessage,
  handleStream,
  getEffectiveSettings,
  broadcastLiveUpdate,
  broadcastToTabs,
  broadcastToFiloPages,
  annunciaIconaScheda,
  handleAIRequest,
  maybeCategorizeAsync,
  wireSafebrowse,
  runTabTriageDecision,
  executeFiloAction,
  applySettingsUpdate,
  decisioneComandoAMano,
  contaSe,
  // L'avvio la chiama da qui (main.js): fuori da questo elenco il giro delle chat appese non partiva mai.
  sweepPendingChats,
  // I moduli nati da handlers.js li chiedono da qui alla chiamata.
  eseguiAzioneFilo,
};
