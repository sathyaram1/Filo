// La home: le carte di sinistra dalla chat, la dashboard generata, il messaggio con cui Filo parla per primo.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const { BrowserWindow } = require('electron');
const PageRead = require('./pageRead');
const VerdettiUscite = require('./verdettiUscite');
const ContestoFilo = require('./contestoFilo');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const { MSG } = SN_MSG;
const SavedPages = globalThis.SN_SAVED_PAGES;
const FiloMem = globalThis.SN_FILO_MEMORY;
const FiloState = globalThis.SN_FILO_STATE;
const Onboarding = globalThis.SN_ONBOARDING;
const DashboardRefresh = globalThis.SN_DASHBOARD_REFRESH;
const { broadcastLiveUpdate, broadcastToTabs, ambitoDellaFinestra, annunciaCarteHome } = require('./broadcast');
const { getEffectiveSettings } = require('./impostazioniEffettive');
const { controllaUscita, linkCheChiedonoOk } = require('./porteUscita');
const { editorFileSummariesList } = require('./osservazioniPerModello');
const { handleAIRequest, extractJson, lessonsBufferText } = require('./chiamateModello');

// Sole letture locali più la firma stabile: è la parte economica, quella che si può fare
// a ogni apertura di scheda (#155).
async function gatherDashboardInputs({ openTabsCount = 0 } = {}) {
  const settings = await getEffectiveSettings();
  const canServe = SN_CONST.canServeAction(settings, ACTIONS.FILO_DASHBOARD);
  const memory = await FiloMem.getMemory();
  const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(memory);
  const lezioni = await lessonsBufferText();
  // La home non ha il filo davanti come la chat: le servono gli ultimi messaggi, per i lavori da riprendere (#868).
  const conversazioni = await ContestoFilo.messaggiDelFilo().catch(() => []);
  const { stateText } = await FiloState.assemble({ sistema: false, conversazioni });
  // #379.5 — i "file" dell'editor (appunti inclusi: sono file come gli altri)
  // entrano nel contesto come riassunti, non come testo integrale. Sostituisce
  // la vecchia iniezione degli appunti dall'archivio (silo ormai vuoto dopo la
  // migrazione appunti→file dell'editor).
  const filesList = await editorFileSummariesList();
  const notiList = await FiloMem.listNotifications();
  const timersList = await FiloMem.listTimers();
  const saved = await SavedPages.list();

  // Si passa la FASCIA del giorno, non l'ora: il messaggio resta in cache per tutta la fascia
  // e «ore 10:07» diventerebbe stale; il giorno intero entra nella firma e la rigenera.
  const now = new Date();
  const h = now.getHours();
  const partOfDay = h < 6 ? 'notte' : h < 12 ? 'mattina' : h < 18 ? 'pomeriggio' : 'sera';
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const dayType = isWeekend ? 'weekend' : 'feriale';
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let dataLunga = '';
  try {
    dataLunga = now.toLocaleDateString('it-IT', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch (_) {
    // Fallback se l'ICU/locale non è disponibile: almeno il nome del giorno.
    const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    dataLunga = `${giorni[now.getDay()]} ${dateKey}`;
  }
  const momento = `${dataLunga}, ${partOfDay} (giorno ${isWeekend ? 'di weekend' : 'feriale'})`;

  const payload = {
    profilo, preferenze, espansioni, lezioni, stato: stateText,
    // Notifiche e file li può aver scritti un modello che leggeva una pagina: e
    // da qui escono messaggio e bottoni della home (#592.4).
    notifiche: notiList.length
      ? globalThis.SN_ESTERNO.imbusta({
        tipo: 'TESTO_SALVATO',
        conIntestazione: true,
        testo: notiList.map((n) => globalThis.SN_ESTERNO.neutralizza(`- [${n.ts}] ${n.kind}: ${n.text}`, { unaRiga: true })).join('\n'),
      })
      : '(nessuna)',
    appunti: globalThis.SN_EDITOR_SUMMARY.renderForPrompt(filesList) || '(nessuno)',
    // #593 (secondo giro di verifica) — il titolo di una pagina salvata lo
    // scrive il sito, non l'utente e non Filo: da qui escono il messaggio al
    // centro della nuova scheda e dei bottoni che aprono un indirizzo, quindi
    // un titolo che detta la frase o il bottone parla con la voce di Filo.
    // Stessa busta dei risultati di ricerca, stessa pulizia: una riga per
    // pagina, e la riga non la può forgiare chi scrive il titolo.
    salvati: saved.length
      ? globalThis.SN_ESTERNO.imbusta({
        tipo: 'DATI_PAGINA',
        conIntestazione: true,
        testo: saved.slice(0, 20)
          .map((p) => `- ${globalThis.SN_ESTERNO.neutralizza(p.title || p.url, { unaRiga: true })} (${globalThis.SN_ESTERNO.neutralizza(p.url, { unaRiga: true })})`)
          .join('\n'),
      })
      : '(nessuno)',
    tabAperte: openTabsCount,
    momento,
  };

  const signature = DashboardRefresh.computeSignature({
    profilo, preferenze, espansioni, lezioni,
    // La firma include id e riassunto di ogni file: la home si rigenera se uno cambia.
    noteIds: filesList.map((f) => `${f.id}:${f.summary}`),
    notificaIds: notiList.map((n) => n.id || n.text),
    salvatiUrls: saved.map((p) => p.url),
    timerIds: timersList.map((t) => `${t.id}:${t.label}:${t.paused ? 1 : 0}`),
    // Fascia, tipo di giorno e data nella firma: al cambio la home si rigenera col saluto
    // giusto, invece di restare stale a cavallo della mezzanotte.
    openTabsCount, partOfDay, dayType, dateKey,
  });

  // Le parole dell'utente che la home ha davanti: un suggerimento che le porta fuori chiede l'OK al clic (#868.6).
  const parole = conversazioni.filter((m) => m && m.role !== 'filo' && !m.daModello).map((m) => String(m.text || '')).join('\n');
  return { settings, canServe, payload, signature, saved, parole };
}

// Messaggio "senza chiave API": istantaneo, dalle pagine salvate. Niente LLM.
// ===== Le carte di sinistra della home dalla chat (#870) =====
// La chat vede la colonna come la home: stesse carte, stesso ordine (SN_CARTE_HOME.sinistra). Senza chiave la
// chat non risponde, quindi la carta dei Crediti qui non c'è. `chatId`: la conversazione che chiede.
async function carteSinistraPerChat(sender, chatId = null, { tolte = false } = {}) {
  const CH = globalThis.SN_CARTE_HOME;
  const ambito = ambitoDellaFinestra(sender && sender.win);
  let downloads = [];
  try { downloads = require('./downloads').list(ambito) || []; } catch (_) {}
  const [timers, notifiche, layout] = await Promise.all([
    FiloMem.gcTimers().catch(() => []),
    FiloMem.listNotifications().catch(() => []),
    require('./carteHome').leggi(),
  ]);
  const lavori = require('./lavoriInCorso').elenco(ambito);
  return (tolte ? CH.nascosteSinistra : CH.sinistra)({ timers, notifiche, downloads, lavori, chat: chatId }, layout);
}

// Dove stanno le carte di destra per il modello, senza quella di una funzione in pausa (#1592).
function descriviCarte(layout) {
  const CH = globalThis.SN_CARTE_HOME;
  const dove = CH.descrivi(layout);
  if (require('./inPausa').aperti().mazzi) return dove;
  const mazzi = CH.carta('mazzi').titolo;
  return { destra: dove.destra.filter((t) => t !== mazzi), altro: dove.altro.filter((t) => t !== mazzi) };
}

// null se il nome non è di una carta di sinistra tolta: allora decide il resto di CARTA_HOME.
async function rimettiSinistraDaChat({ action, sender, chatId }) {
  const CH = globalThis.SN_CARTE_HOME;
  const tolte = await carteSinistraPerChat(sender, chatId, { tolte: true });
  const trovate = CH.trovaSinistra(action.carta, tolte);
  if (!trovate.voci.length) return null;
  const elenco = (voci) => voci.map((v) => ({ carta: v.chiave, tipo: v.tipo, titolo: v.titolo }));
  if (trovate.voci.length > 1 && !trovate.perTipo) {
    return { executed: false, kept: false, output: { error: 'più carte tolte con quel nome: quale?', candidate: elenco(trovate.voci) } };
  }
  let ultimo = null;
  for (const v of trovate.voci) {
    const esito = await require('./carteHome').modifica({ tipo: 'mostra', chiave: v.chiave });
    if (esito.cambiato) ultimo = esito.layout;
  }
  if (ultimo) annunciaCarteHome(ultimo, sender);
  return { executed: true, kept: true, output: { rimesse: elenco(trovate.voci) } };
}

async function cartaSinistraDaChat({ tipo, verso, action, sx, trovate, sender }) {
  const CH = globalThis.SN_CARTE_HOME;
  const Carte = require('./carteHome');
  const elenco = (voci) => voci.map((v) => ({ carta: v.chiave, tipo: v.tipo, titolo: v.titolo }));
  const destra = descriviCarte(await Carte.leggi());
  const no = (error) => ({ executed: false, kept: false, output: { error, sinistra: elenco(sx), ...destra } });
  const voci = trovate.voci;
  if (!voci.length) return no('carta sconosciuta: scegli fra queste (carta = la chiave)');
  if (voci.length > 1 && !(trovate.perTipo && tipo === 'togli')) {
    return { executed: false, kept: false, output: { error: 'più carte con quel nome: quale?', candidate: elenco(voci) } };
  }
  if (tipo === 'aggiungi') return no('la carta è già nella home');
  if (tipo === 'togli') {
    if (voci.some((v) => v.tipo === 'timer' || v.tipo === 'sveglia')) {
      return no('un timer o una sveglia si tolgono con promemoria(cancella)');
    }
    let avvisi = 0;
    for (const v of voci) {
      if (v.tipo === 'avviso') { await FiloMem.dismissNotification(v.ref.id); avvisi++; }
      else {
        const esito = await Carte.modifica({ tipo: 'nascondi', chiave: v.chiave });
        if (esito.cambiato) annunciaCarteHome(esito.layout, sender);
      }
    }
    if (avvisi) broadcastLiveUpdate();
    return { executed: true, kept: true, output: { tolte: elenco(voci) } };
  }
  // sposta: la nuova posizione nell'ordine che l'utente vede, fra le carte che non stanno in cima per regola.
  const v = voci[0];
  const FISSA = 'sta in cima finché suona: non si sposta e non si scavalca';
  if (v.fissa) return no(`la carta «${v.titolo}» ${FISSA}`);
  const mobili = sx.filter((x) => !x.fissa);
  const ordine = mobili.map((x) => x.chiave).filter((k) => k !== v.chiave);
  const at = mobili.findIndex((x) => x.chiave === v.chiave);
  let dove;
  if (action.prima_di != null) {
    const rif = sx.find((x) => x.chiave === String(action.prima_di)) || CH.trovaSinistra(action.prima_di, sx).voci[0];
    if (!rif || rif.chiave === v.chiave) return no('la carta di riferimento non è a sinistra');
    if (rif.fissa) return no(`la carta «${rif.titolo}» ${FISSA}`);
    dove = ordine.indexOf(rif.chiave);
  } else if (verso === 'cima') dove = 0;
  else if (verso === 'fondo') dove = ordine.length;
  else if (verso === 'su') dove = Math.max(0, at - 1);
  else if (verso === 'giu') dove = Math.min(ordine.length, at + 1);
  else return no('verso sconosciuto');
  ordine.splice(dove, 0, v.chiave);
  const esito = await Carte.modifica({ tipo: 'ordina-sinistra', ordine, chiave: v.chiave });
  if (esito.errore) return no(esito.errore);
  if (esito.cambiato) annunciaCarteHome(esito.layout, sender);
  return { executed: true, kept: true, output: { spostata: v.titolo, sinistra: elenco(ordinaCome(sx, esito.layout)) } };
}

function ordinaCome(sx, layout) {
  const CH = globalThis.SN_CARTE_HOME;
  const per = (t) => sx.filter((x) => x.tipo === t).map((x) => x.ref);
  return CH.sinistra({
    timers: [...per('timer'), ...per('sveglia')], notifiche: per('avviso'), downloads: per('download'), lavori: per('lavoro'),
  }, layout);
}

// `daSalvate`: l'indirizzo l'ha salvato l'utente, non l'ha scritto un modello: la carta può chiedere l'icona al sito.
function savedSuggestions(saved) {
  return saved.slice(0, 5).map((p) => ({
    icon: 'link', text: p.title || p.url,
    action: { type: 'NAVIGA', url: p.url, label: p.title || p.url },
    importance: 2,
    daSalvate: true,
  }));
}

// Home senza AI: istantanea, dalle pagine salvate. Dice PERCHÉ Filo non parla,
// perché un'assenza muta faceva credere senza crediti chi li aveva (#663).
function buildNoKeyDashboard(settings, saved) {
  const suggestions = savedSuggestions(saved);
  const motivo = SN_CONST.whyCannotServe(settings, [ACTIONS.FILO_DASHBOARD, ACTIONS.FILO_CHAT]);
  const inOpzioni = (text) => ({
    icon: 'options', text,
    action: { type: 'NAVIGA', url: 'filo://options/options.html', label: 'Opzioni' },
    importance: 3,
  });
  // La prima cosa che un utente nuovo deve fare sta a un clic, non in un menu.
  suggestions.unshift(motivo === 'chiave'
    ? {
      carta: 'crediti',
      icon: 'credits', text: 'Apri Crediti e riscatta l\'invito',
      action: { type: 'NAVIGA', url: 'filo://credits/credits.html', label: 'Crediti' },
      importance: 3,
    }
    : inOpzioni(motivo === 'pesi-aperti'
      ? 'Apri Opzioni e rivedi «solo modelli a pesi aperti»'
      : 'Scegli un modello in Opzioni'));
  let message;
  if (motivo === 'chiave') {
    message = 'Per attivare Filo serve un codice d\'invito: riscattalo nella pagina Crediti e ricevi i crediti per usare i modelli. Se preferisci, lì puoi mettere una tua chiave OpenRouter.';
  } else if (motivo === 'pesi-aperti') {
    message = 'I modelli che hai scelto vanno bene, ma «solo modelli a pesi aperti» li esclude tutti e nessuno di loro ha un equivalente a pesi aperti. In Opzioni puoi spegnere l\'interruttore o scegliere altri modelli.';
  } else {
    message = 'I crediti ci sono, ma nessun modello configurato può rispondere: la configurazione dei modelli è vuota o cita modelli che non esistono più. Puoi sceglierne uno tu in Opzioni.';
  }
  // Il rimando alle pagine salvate solo se ce n'è almeno una: al primo avvio
  // non ce n'è nessuna, e indicava una lista vuota (#663).
  if (saved.length) message += ' Intanto, le tue pagine salvate sono qui.';
  return { message, suggestions };
}

// Genera il messaggio di Filo e i suggerimenti della home con l'LLM, e li mette in cache. È la parte COSTOSA: parte solo
// quando è successo qualcosa (src/main/services/filoParla.js) o quando l'utente chiede suggerimenti nuovi, mai
// all'apertura di una scheda (#869). `precedente`: il messaggio di Filo che questo sostituisce, se si fondono.
async function generateDashboardFromInputs(inputs, { precedente = null } = {}) {
  const cached = await FiloMem.getDashboardCache();
  const r = await handleAIRequest({
    action: ACTIONS.FILO_DASHBOARD,
    payload: { ...inputs.payload, ultimoMessaggio: precedente != null ? precedente : (cached?.message || '') },
    origin: 'filo:dashboard',
    intera: true,
  });
  const parsed = extractJson(r.text);
  let message = '';
  let suggestions = [];
  if (parsed && typeof parsed === 'object') {
    message = String(parsed.message || '').trim();
    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions
        .map((s) => ({
          icon: String(s.icon || 'link').toLowerCase(),
          text: String(s.text || '').trim(),
          action: s.action && typeof s.action === 'object' ? s.action : null,
          importance: Number(s.importance) || 2,
        }))
        .filter((s) => s.text);
    }
  }
  // Un suggerimento che porterebbe fuori un segreto perde l'azione e tiene la frase della porta (#810): al clic la home
  // deve dire cosa ha fermato. La porta guarda la home come un compito che ha letto testo di altri (#1505).
  const casa = contestoDellaHome(inputs);
  for (let i = 0; i < suggestions.length; i++) {
    const u = suggestions[i].action ? await controllaUscita(suggestions[i].action, casa) : null;
    if (u && u.blocca) {
      suggestions[i] = { ...suggestions[i], action: null, fermata: u.frase };
      continue;
    }
    // Un indirizzo con un dato dell'utente, o composto dal modello, chiede l'OK al clic; un controllo mancato pure.
    const a = suggestions[i].action;
    const url = a && /^(?:NAVIGA|APRI_FILE)$/i.test(String(a.type || '')) ? String(a.url || a.path || '') : '';
    if (!/^https?:/i.test(url)) continue;
    let chiede = [];
    try {
      chiede = await linkCheChiedonoOk('', { ...casa, sempre: true, indirizzi: [url] });
    } catch (_) { chiede = [{ motivo: VerdettiUscite.MOTIVI.guasto }]; }
    if (chiede.length) suggestions[i] = { ...suggestions[i], chiedeOk: chiede[0].motivo };
  }
  // I collegamenti del messaggio di Filo nella home hanno lo stesso giudizio dei suggerimenti.
  let linkDaConfermare = [];
  let senzaVerdetto = false;
  if (message) {
    try { linkDaConfermare = await linkCheChiedonoOk(message, { ...casa, sempre: true }); } catch (_) { senzaVerdetto = true; }
  }
  await FiloMem.setDashboardCache({ message: message || cached?.message || '', suggestions, signature: inputs.signature });
  return { message, suggestions, ts: new Date().toISOString(), ...(linkDaConfermare.length ? { linkDaConfermare } : {}), ...(senzaVerdetto ? { senzaVerdetto } : {}) };
}

// La home legge testo di altri (titoli di schede e di pagine salvate, notifiche, conversazioni, cose successe): per la
// porta è un compito contaminato (#1505). Un indirizzo che compare in schede, salvate o cronologia si apre; uno composto
// dal modello chiede l'OK, e un codice letto lì non esce. `parole` = quello che l'utente ha scritto, che può uscire.
function contestoDellaHome(inputs) {
  const p = (inputs && inputs.payload) || {};
  const letto = ['stato', 'notifiche', 'salvati', 'appunti', 'lezioni', 'eventi']
    .map((k) => (typeof p[k] === 'string' ? p[k] : '')).filter((t) => t.trim()).join('\n');
  const provenienza = PageRead.contestoChat();
  PageRead.annotaLink(provenienza, ((inputs && inputs.saved) || []).map((x) => x && x.url).filter(Boolean).join('\n'));
  return {
    contesto: [{ type: 'LETTURA_HOME', _output: { daFuori: [{ testo: letto || '(la home non ha letto niente)', fonte: 'da ciò che legge la home' }] } }],
    provenienza,
    parole: (inputs && inputs.parole) || '',
  };
}

function schedeWebAperte() {
  let n = 0;
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      const tabs = win && win._filoTabs && Array.isArray(win._filoTabs.tabs) ? win._filoTabs.tabs : [];
      n += tabs.filter((t) => !t.isInternal && /^https?:\/\//i.test(t.url || '')).length;
    }
  } catch (_) {}
  return n;
}

// Le cose successe come le legge il modello: i nomi (un file scaricato, un avviso, una sveglia messa da un modello) li
// scrivono altri, e restano imbustati come ogni testo salvato (#592.4).
const COSA_E_SUCCESSO = {
  timer: 'è suonato',
  download: 'mentre l\'utente non era davanti a Filo è finito il download di',
  avviso: 'è arrivato un avviso:',
  giornata: 'è l\'inizio della giornata: l\'utente apre Filo per la prima volta oggi',
  accoglienza: 'l\'utente ha appena finito di presentarsi a te: da qui comincia la vostra conversazione di tutti i giorni',
};
function testoEventi(eventi) {
  const E = globalThis.SN_ESTERNO;
  const righe = (Array.isArray(eventi) ? eventi : []).filter((e) => e && COSA_E_SUCCESSO[e.tipo])
    .map((e) => `- ${COSA_E_SUCCESSO[e.tipo]}${e.testo ? ` ${E.neutralizza(e.testo, { unaRiga: true })}` : ''}`);
  return righe.length ? E.imbusta({ tipo: 'TESTO_SALVATO', conIntestazione: true, testo: righe.join('\n') }) : '';
}

// Il turno di Filo nel filo (#869): messaggio e suggerimenti nascono dalla stessa chiamata.
async function generaPerFiloParla({ eventi, fondi, precedente }) {
  await FiloMem.gcTimers();
  const inputs = await gatherDashboardInputs({ openTabsCount: schedeWebAperte() });
  if (!inputs.canServe) return null;
  inputs.payload = { ...inputs.payload, eventi: testoEventi(eventi), fondi: !!fondi };
  const r = await generateDashboardFromInputs(inputs, { precedente: fondi ? precedente : null });
  broadcastToTabs({ type: MSG.FILO_DASHBOARD_UPDATED, suggestions: r.suggestions, ts: r.ts });
  return r;
}

async function filoPuoParlare() {
  const settings = await getEffectiveSettings();
  if (settings.showHomeMessage === false) return false;
  if (!SN_CONST.canServeAction(settings, ACTIONS.FILO_DASHBOARD)) return false;
  const onb = Onboarding ? await FiloMem.getOnboarding().catch(() => null) : null;
  return !onb || !!onb.done;
}

// La home chiede i suggerimenti aprendosi: quelli in cache, senza mai chiamare il modello (#869). Il modello parte solo
// con `force` («Aggiorna» sulla carta, la fine dell'accoglienza, i crediti arrivati). Senza un modello servibile, la
// frase che dice perché e la strada ai Crediti.
async function handleFiloGenerateDashboard({ force = false, openTabsCount = 0 } = {}) {
  await FiloMem.gcTimers();
  const settings = await getEffectiveSettings();
  if (!SN_CONST.canServeAction(settings, ACTIONS.FILO_DASHBOARD)) {
    const saved = await SavedPages.list();
    const payload = buildNoKeyDashboard(settings, saved);
    return { ...payload, senzaChiave: true, cached: false, ts: new Date().toISOString() };
  }
  if (force) {
    const inputs = await gatherDashboardInputs({ openTabsCount });
    const result = await generateDashboardFromInputs(inputs);
    return { suggestions: result.suggestions, cached: false, ts: result.ts };
  }
  const cached = await FiloMem.getDashboardCache();
  return { suggestions: (cached && !cached.senzaChiave && cached.suggestions) || [], cached: !!cached, ts: cached?.ts || null };
}

// Una home che la persona vede per la prima volta (#1467), con quello che mostra adesso: i suggerimenti scritti da un
// modello, o perché manca un modello per la home (la sua sola: la chat può averlo). Nessun modello chiamato.
async function contaHomeVista() {
  try {
    const settings = await getEffectiveSettings();
    let esito = '';
    if (!SN_CONST.canServeAction(settings, ACTIONS.FILO_DASHBOARD)) {
      esito = globalThis.SN_CONTATORI?.esitoHome(SN_CONST.whyCannotServe(settings, [ACTIONS.FILO_DASHBOARD])) || '';
    } else {
      const cached = await FiloMem.getDashboardCache();
      if (cached && !cached.senzaChiave && Array.isArray(cached.suggestions) && cached.suggestions.length) esito = 'generata';
    }
    return Boolean(esito && globalThis.SN_CONTATORI_MAIN?.attivita('home', { esito }));
  } catch (_) { return false; }
}

module.exports = {
  carteSinistraPerChat,
  descriviCarte,
  rimettiSinistraDaChat,
  cartaSinistraDaChat,
  generaPerFiloParla,
  filoPuoParlare,
  handleFiloGenerateDashboard,
  contaHomeVista,
};
