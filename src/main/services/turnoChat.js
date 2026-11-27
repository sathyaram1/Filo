// Il turno della chat con Filo: handleFiloChat, i turni in corso e i seguiti, la ripresa dell'intervista.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const Defaults = require('./defaultsStore');
const PageRead = require('./pageRead');
const SegretiLetti = require('./segretiLetti');
const ContatoriServizio = require('./contatoriServizio');
const GiroAzioni = require('./giroAzioni');
const ContestoFilo = require('./contestoFilo');
const Compattazione = require('./compattazioneFilo');
const RicordiFilo = require('./ricordiFilo');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const { MSG } = SN_MSG;
const { TURNO_MUTO } = require('./contatori');
const FiloChats = globalThis.SN_FILO_CHATS;       // #525 — archivio delle chat con Filo
const ChatArchive = globalThis.SN_CHAT_ARCHIVE;   // #525 — titoli, tipi, ricerca (logica pura)
const RispostaA = globalThis.SN_RISPOSTA_A;        // #1620 — la risposta di Filo che un messaggio cita
const Fx = globalThis.SN_FX;
const Calc = globalThis.SN_CALC;
const FiloMem = globalThis.SN_FILO_MEMORY;
const FiloState = globalThis.SN_FILO_STATE;
const Onboarding = globalThis.SN_ONBOARDING;
const { cancelliAperti, broadcastToTabs } = require('./broadcast');
const { Schermo, unUsoContato, contaSe, winOf } = require('./handlersComuni');
const { getEffectiveSettings, modelForAction, buildAttemptChain } = require('./impostazioniEffettive');
const { chiaveSchermo, ricordaLettoInChat, testoDiAltriNelleAzioni, linkCheChiedonoOk } = require('./porteUscita');
const {
  fontiDellaChat, segnaFonteLetta, segnaFonte, classeLettaDelCompito, LETTURE_DI_UNA_NUOVA, executeFiloAction,
} = require('./autonomiaFonti');
const {
  esitoNonDisponibile, RISPOSTA_PROXY_NON_DISPONIBILE, SOLLECITO_DOPO_RIFIUTO, giroDiSoliBottoni, RISPOSTA_FRA_LE_NOTE,
  unisciTesti, ARGOMENTI_TAGLIATI, soloLetture, fraseSenzaRisposta, rilettura, lettureDeiGettoni, notaDeiGettoni,
  observationsForPrompt, interruptedActionsForPrompt, LEGACY_CONTINUE_NUDGE, toolResultText, maybeProposeFeedbackAction,
  maybeAutoFeedback, editorFileSummariesList,
} = require('./osservazioniPerModello');
const {
  noteProvenienzaImmagini, ricordaOrigineInChat, origineGiaLettaInChat, buildMessages, handleAIRequest,
  memoriaPerModello, lezioniAutomaticheConsentite, maybeRunLessonAgent, compattaDaFermo, parteFissaChat, baseDellaChat,
} = require('./chiamateModello');
const {
  archiviaDomanda, appendToChatArchive, citazioneDelMessaggio, affidaChat, archiviaAperturaAccoglienza,
  archiviaCongedoAccoglienza, closeAndTriageChat,
} = require('./archivioChat');
const { saveOnboarding, contaScelteIntervista, finishOnboarding } = require('./intervista');

// Un turno rimasto a metà riparte da solo, ma con due schede nuove ripartirebbe due volte:
// chi arriva primo prende la ripresa. In memoria: se il processo muore, muore con lui.
const ONB_RESUME_CLAIM_MS = 120000;
let onbResumeClaimedAt = 0;
// Un turno dell'intervista già in volo tiene la ripresa anche se nessuna scheda l'ha prenotata: una scheda nuova
// aperta mentre Filo risponde rimandava lo stesso messaggio, e la risposta arrivava due volte (#1219).
let onbTurniInVolo = 0;
function claimOnboardingResume() {
  if (onbTurniInVolo > 0) return false;
  const now = Date.now();
  if (onbResumeClaimedAt && now - onbResumeClaimedAt < ONB_RESUME_CLAIM_MS) return false;
  onbResumeClaimedAt = now;
  return true;
}
function releaseOnboardingResume() { onbResumeClaimedAt = 0; }

// I turni di chat in corso, per chi li vuole fermare o aggiungere un seguito (#578, #1296): reqId → turno. Solo in
// memoria. Un turno si registra appena il messaggio arriva, prima di preparare la richiesta, e `chiuso` vuol dire che ha
// già la sua risposta: da lì uno stop non scrive più niente.
const turniInCorso = new Map();
// Uno stop arrivato prima che il turno si registri vale lo stesso: lo si tiene da parte e il turno lo trova quando si
// registra. Scadono, per i turni che non arrivano mai.
const stopPrimaDelTurno = new Map();
const STOP_PRIMA_TTL_MS = 10 * 60 * 1000;
function registraTurno(reqId, wc) {
  const turno = { wcId: wc && wc.id, ctrl: new AbortController(), fermato: false, chiuso: false, accoglienza: false, seguiti: [], letti: new Set() };
  if (!reqId) return turno;
  turniInCorso.set(String(reqId), turno);
  const prima = stopPrimaDelTurno.get(String(reqId));
  stopPrimaDelTurno.delete(String(reqId));
  if (prima && prima.wcId === turno.wcId) turno.fermato = true;
  return turno;
}
function togliTurno(reqId, turno) {
  if (reqId && turniInCorso.get(String(reqId)) === turno) turniInCorso.delete(String(reqId));
}
// L'accoglienza riparte da sola su un messaggio dell'utente senza risposta: lo stop si scrive quando si preme, non
// quando l'azione fermata finisce, o una pagina ricaricata in quei secondi rifà il turno (#1296).
async function segnaStopAccoglienza(turno) {
  const stato = await FiloMem.getOnboarding();
  if (turno.chiuso) return;
  await saveOnboarding(Onboarding.segnaFermato(stato));
}
// Fermato dall'utente (#578): la chiamata in volo si interrompe e nessuna azione nuova parte; quelle già partite
// finiscono e restano raccontate. Una risposta già finita invece arriva: fermare riguarda il lavoro che resta.
async function fermaFiloChat(reqId, wc) {
  if (!reqId) return false;
  const t = turniInCorso.get(String(reqId));
  if (!t) {
    const ora = Date.now();
    for (const [k, v] of stopPrimaDelTurno) if (ora - v.at > STOP_PRIMA_TTL_MS) stopPrimaDelTurno.delete(k);
    stopPrimaDelTurno.set(String(reqId), { wcId: wc && wc.id, at: ora });
    return true;
  }
  // Ferma solo la scheda che l'ha avviato: un'altra pagina di Filo non tocca il lavoro di questa.
  if (t.wcId !== (wc && wc.id)) return false;
  t.fermato = true;
  try { t.ctrl.abort(); } catch (_) {}
  if (t.accoglienza && !t.chiuso) {
    try { await segnaStopAccoglienza(t); } catch (e) { console.warn('[Filo] stop dell\'accoglienza non scritto', e?.message || e); }
  }
  return true;
}
// Un seguito scritto mentre il turno lavora (#1296) entra al suo passo dopo; se il turno non ne ha, lo manda la scheda a
// turno finito. Lo prende solo il turno della scheda che lo scrive, non fermato, non chiuso, non dell'accoglienza (lei
// tiene la conversazione nel suo stato, e il seguito la aspetta). `togli`: ritirato prima che il modello lo legga.
function seguitoFiloChat({ reqId, id, testo, togli = false, serba = null, orfani = false, pagina = '' } = {}, wc) {
  if (orfani) return { seguiti: seguitiOrfani(wc, String(pagina || '')) };
  const chiave = String(id || '');
  if (serba) return { serbato: serbaSeguito(chiave, serba, wc) };
  if (togli) ritiraSerbato(chiave, wc);
  const t = reqId ? turniInCorso.get(String(reqId)) : null;
  if (!t || t.wcId !== (wc && wc.id) || !chiave) return { accolto: false, tolto: !!togli };
  if (togli) {
    const i = t.seguiti.findIndex((s) => s.id === chiave);
    if (i >= 0) t.seguiti.splice(i, 1);
    return t.letti.has(chiave) ? { letto: true, tolto: false } : { tolto: true };
  }
  const parole = String(testo || '').trim();
  if (!parole || t.fermato || t.chiuso || t.accoglienza || t.letti.has(chiave)) return { accolto: false };
  if (!t.seguiti.some((s) => s.id === chiave)) t.seguiti.push({ id: chiave, testo: parole });
  return { accolto: true };
}

// I seguiti in attesa, interi (#1296.1): sembrano già mandati, quindi non si perdono con la pagina. Una pagina
// ricaricata nella stessa scheda riprende quelli della pagina di prima; a scheda chiusa, finiti i suoi turni, restano
// nella conversazione come messaggi dell'utente. Solo in memoria: id → { wcId, pagina, chatId, composizione }.
const seguitiSerbati = new Map();
const turniDellaScheda = new Map();   // wcId → turni in volo
const schedeSparite = new Set();      // wcId delle schede chiuse che aspettano la fine dei loro turni
const schedeSeguite = new WeakSet();
const idScheda = (wc) => { try { return wc && !wc.isDestroyed() ? wc.id : null; } catch (_) { return null; } };
function serbaSeguito(id, serba, wc) {
  const wcId = idScheda(wc);
  const c = serba && serba.composizione;
  if (!id || wcId == null || !c || typeof c !== 'object') return false;
  const testi = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string') : []);
  const composizione = {
    text: String(c.text || ''),
    rispostaA: c.rispostaA && typeof c.rispostaA === 'object' ? c.rispostaA : null,
    scritto: String(c.scritto || ''),
    immagini: testi(c.immagini).filter((d) => d.startsWith('data:image/')),
    file: (Array.isArray(c.file) ? c.file : []).filter((f) => f && typeof f.percorso === 'string' && f.percorso)
      .map((f) => ({ percorso: f.percorso, nome: String(f.nome || '') })),
    percorsi: (Array.isArray(c.percorsi) ? c.percorsi : []).filter((x) => Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === 'string')),
    incollato: c.incollato === true,
    daFuori: c.daFuori === true,
    citata: c.citata && typeof c.citata === 'object' ? c.citata : null,
  };
  seguitiSerbati.set(id, { wcId, pagina: String(serba.pagina || ''), chatId: serba.chatId ? String(serba.chatId) : null, composizione });
  if (!schedeSeguite.has(wc)) {
    schedeSeguite.add(wc);
    try { wc.once('destroyed', () => schedaSparita(wcId)); } catch (_) {}
  }
  return true;
}
function ritiraSerbato(id, wc) {
  const s = id ? seguitiSerbati.get(id) : null;
  if (s && s.wcId === idScheda(wc)) seguitiSerbati.delete(id);
}
// Quelli lasciati da un'altra pagina della stessa scheda: tolti anche dai turni che li aspettano, o arriverebbero due volte.
function seguitiOrfani(wc, pagina) {
  const wcId = idScheda(wc);
  if (wcId == null) return [];
  const presi = [];
  for (const [id, s] of seguitiSerbati) {
    if (s.wcId !== wcId || s.pagina === pagina) continue;
    seguitiSerbati.delete(id);
    for (const t of turniInCorso.values()) {
      if (t.wcId !== wcId) continue;
      const i = t.seguiti.findIndex((x) => x.id === id);
      if (i >= 0) t.seguiti.splice(i, 1);
    }
    presi.push(s.composizione);
  }
  return presi;
}
function schedaSparita(wcId) {
  if (turniDellaScheda.get(wcId)) schedeSparite.add(wcId);
  else lasciaNellaConversazione(wcId).catch((e) => console.warn('[Filo] seguiti della scheda chiusa:', e?.message || e));
}
async function lasciaNellaConversazione(wcId) {
  let scritti = 0;
  for (const [id, s] of [...seguitiSerbati]) {
    if (s.wcId !== wcId) continue;
    seguitiSerbati.delete(id);
    const c = s.composizione;
    if (!s.chatId || !c.text) continue;
    const citazione = await citazioneDelMessaggio(c.rispostaA, s.chatId);
    if ((await archiviaDomanda(s.chatId, { testo: c.text, immagini: c.immagini, ref: citazione.ref })).archiviata) scritti += 1;
  }
  if (scritti) { try { broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }); } catch (_) {} }
}
function turnoDellaScheda(wcId, delta) {
  if (wcId == null) return;
  const n = (turniDellaScheda.get(wcId) || 0) + delta;
  if (n > 0) { turniDellaScheda.set(wcId, n); return; }
  turniDellaScheda.delete(wcId);
  if (schedeSparite.delete(wcId)) lasciaNellaConversazione(wcId).catch((e) => console.warn('[Filo] seguiti della scheda chiusa:', e?.message || e));
}
const NOTA_SEGUITO ='[L\'utente ha scritto questo mentre lavoravi alla sua richiesta di prima.]';

// I documenti trovati con CERCA_DOCUMENTI che la risposta nomina, come azioni APRI_FILE da aggiungere. Nessuna se il
// modello ne ha già mostrato uno: la scelta è sua. Al massimo tre, nell'ordine in cui la risposta li nomina.
// Nominato vuol dire il nome del file come parola a sé, non una parola comune che ci coincide («ricevuta» per
// ricevuta.pdf: senza estensione vale solo un nome che non è una parola, come scan_00231), e non scartato («non X»).
const NEGA_FILE = /(?<![\p{L}])(?:non|né|nè|ne'|not|anziché|anziche|invece di|piuttosto che)(?![\p{L}])[^.;:!?\n,(]{0,12}$/iu;
function posizioneDelNome(testo, nome) {
  for (let i = testo.indexOf(nome); i >= 0; i = testo.indexOf(nome, i + 1)) {
    const prima = i > 0 ? testo[i - 1] : '';
    const dopo = testo[i + nome.length] || '';
    if (/[\p{L}\p{N}_]/u.test(prima) || /[\p{L}\p{N}_]/u.test(dopo)) continue;
    const clausola = testo.slice(Math.max(0, i - 60), i).split(/[.;:!?\n,(]/).pop();
    if (NEGA_FILE.test(clausola)) continue;
    return i;
  }
  return -1;
}
function fileNominatiDallaRisposta(textReply, azioni) {
  const testo = String(textReply || '').toLowerCase();
  const lista = Array.isArray(azioni) ? azioni : [];
  if (!testo || lista.some((x) => x && String(x.type || '').toUpperCase() === 'APRI_FILE')) return [];
  const trovati = [];
  for (const x of lista) {
    if (!x || String(x.type || '').toUpperCase() !== 'CERCA_DOCUMENTI' || !x._output) continue;
    for (const r of Array.isArray(x._output.risultati) ? x._output.risultati : []) {
      if (!r || !r.percorso || trovati.some((o) => o.r.percorso === r.percorso)) continue;
      const nome = String(r.nome || '').toLowerCase();
      const senzaEstensione = nome.replace(/\.[^.]+$/, '');
      let i = nome.length >= 3 ? posizioneDelNome(testo, nome) : -1;
      if (i < 0 && senzaEstensione.length >= 5 && /[^\p{L}\s]/u.test(senzaEstensione)) i = posizioneDelNome(testo, senzaEstensione);
      if (i >= 0) trovati.push({ r, i });
    }
  }
  return trovati.sort((a, b) => a.i - b.i).slice(0, 3)
    .map(({ r }, k) => ({ type: 'APRI_FILE', percorso: r.percorso, etichetta: r.nome, _callId: `trovato_${k}` }));
}

// #845 — le pagine trovate con CERCA_SALVATE che la risposta nomina diventano bottoni sotto la risposta, nell'ordine in
// cui le nomina (`_output.nominate`). Nominata vuol dire il titolo, un suo pezzo di almeno due parole fra « - », « | » o
// «: », l'indirizzo o una parola lunga del titolo che le altre trovate non hanno (i modelli accorciano e raccontano);
// non scartata («non X»), né già aperta. Una sola trovata, e una risposta che non dice di no: è lei.
function nomiDellaSalvata(p, piano) {
  const titolo = piano(p.title);
  const nomi = titolo.length >= 4 ? [titolo] : [];
  for (const pezzo of titolo.split(/\s[-–—|·:]\s|:\s/)) {
    const t = pezzo.trim();
    if (t !== titolo && t.length >= 8 && t.includes(' ')) nomi.push(t);
  }
  const indirizzo = piano(String(p.url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
  if (indirizzo.length >= 6) nomi.push(indirizzo);
  return nomi;
}
// Parole che una risposta sulle pagine salvate dice comunque («salvata il 3 ottobre», «eccola»): non nominano nessuna.
const PAROLE_DELLA_RISPOSTA = new Set([
  'salvata', 'salvato', 'salvate', 'salvati', 'pagina', 'pagine', 'trovata', 'trovato', 'trovate', 'trovati', 'aperta',
  'aperto', 'aperte', 'ricerca', 'eccola', 'eccole', 'eccolo', 'gennaio', 'febbraio', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre', 'lunedi', 'martedi', 'mercoledi', 'giovedi',
  'venerdi', 'sabato', 'domenica',
]);
const NEGA_RISPOSTA = /(?<![\p{L}])(?:non|nessun[aeo]?|niente|nulla)(?![\p{L}])/iu;
function paroleSoloSue(p, pagine, cercate, piano) {
  const parole = (s) => piano(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const altre = new Set(pagine.filter((q) => q !== p).flatMap((q) => parole(q.title)));
  return ChatArchive.terminiCheDistinguono(parole(p.title)).filter((w) => w.length >= 6 && !/^\d+$/.test(w)
    && !PAROLE_DELLA_RISPOSTA.has(w) && !altre.has(w) && !cercate.some((c) => w.startsWith(c)));
}
function segnaSalvateNominate(textReply, azioni) {
  const piano = (s) => ChatArchive.normalizeForSearch(String(s || '')).replace(/[«»"“”‘’*_`]/g, ' ').replace(/\s+/g, ' ').trim();
  const testo = piano(textReply);
  const lista = Array.isArray(azioni) ? azioni : [];
  const aperte = new Set(lista.filter((x) => x && String(x.type || '').toUpperCase() === 'APRI_SALVATA' && x._output && x._output.aperta)
    .map((x) => x._output.id));
  // Due ricerche nello stesso turno possono trovare la stessa pagina: il bottone è uno.
  const giaMostrate = new Set();
  for (const x of lista) {
    if (!x || String(x.type || '').toUpperCase() !== 'CERCA_SALVATE' || !x._output || !Array.isArray(x._output.pagine)) continue;
    const trovate = [];
    const pagine = x._output.pagine.filter((p) => p && p.id);
    const cercate = (Array.isArray(x._output.cercatoCon) ? x._output.cercatoCon : String(x._output.cercato || '').split(/\s+/))
      .map((w) => piano(w).replace(/[aeiou]$/, '')).filter((w) => w.length >= 3);
    for (const p of pagine) {
      if (aperte.has(p.id) || giaMostrate.has(p.id)) continue;
      let i = -1;
      const nomi = testo ? [...nomiDellaSalvata(p, piano), ...paroleSoloSue(p, pagine, cercate, piano)] : [];
      for (const nome of nomi) {
        const k = posizioneDelNome(testo, nome);
        if (k >= 0 && (i < 0 || k < i)) i = k;
      }
      if (i >= 0) { trovate.push({ id: p.id, i }); giaMostrate.add(p.id); }
    }
    // Una pagina sola trovata con tutte le parole, e una risposta che la racconta senza nominarla né dire di no: è lei.
    const sola = pagine.length === 1 && !x._output.allargata ? pagine[0] : null;
    if (!trovate.length && sola && testo && !aperte.has(sola.id) && !giaMostrate.has(sola.id) && !NEGA_RISPOSTA.test(testo)) {
      trovate.push({ id: sola.id, i: 0 });
      giaMostrate.add(sola.id);
    }
    x._output.nominate = trovate.sort((a, b) => a.i - b.i).map((t) => t.id);
  }
}

// `daModello`: il messaggio l'ha scritto un modello (un suggerimento della home), anche se parte dalla casella dell'utente.
// #868 — quanto si aspettano i pezzi vecchi del filo: oltre, il turno parte senza (l'attesa è attrito).
const ATTESA_RICORDI_MS = 2500;
// Il tetto in token che il modello della chat ha retto dopo un rifiuto per finestra troppo piccola, per modello.
const finestreDeiModelli = new Map();
// La finestra che il rifiuto di un fornitore ha detto, per modello della chat: misura le riletture dei turni dopo (#868.7).
const finestreNote = new Map();
// Quanto una rilettura aspetta il listino di OpenRouter (con le finestre dei modelli) se non è ancora arrivato.
const ATTESA_LISTINO_MS = 2000;
// I modelli della chat che hanno rifiutato le immagini dei turni passati: da lì in avanti ricevono la nota (#1166).
const modelliSenzaFoto = new Set();
function entroIl(p, ms, ripiego) {
  let timer = null;
  return Promise.race([p, new Promise((ok) => { timer = setTimeout(() => ok(ripiego), ms); })])
    .finally(() => clearTimeout(timer));
}

async function handleFiloChat(richiesta) {
  const reqId = richiesta && richiesta.reasoningReqId;
  // I contatori del turno (#1463): l'esito lo scrive il turno quando lo sa; un turno senza esito (il congedo
  // dell'intervista, che non chiama il modello) non si conta.
  const conto = contaSe('turnoChat', ACTIONS.FILO_CHAT) || TURNO_MUTO;
  const volo = { accoglienza: false, turno: registraTurno(reqId, richiesta && richiesta.sender && richiesta.sender.wc), conto, esito: '' };
  const scheda = idScheda(richiesta && richiesta.sender && richiesta.sender.wc);
  turnoDellaScheda(scheda, 1);
  try {
    // Un messaggio è un uso solo per le stime di costo, anche con più giri di strumenti (#819).
    const Costi = global.SN_COSTS;
    const turno = () => turnoFiloChat(richiesta, volo);
    return await unUsoContato(ACTIONS.FILO_CHAT, () => (Costi && Costi.unUso ? Costi.unUso(ACTIONS.FILO_CHAT, turno) : turno()));
  } catch (e) {
    volo.esito = 'errore';
    throw e;
  } finally {
    try { conto.fine(volo.esito); } catch (_) {}
    if (volo.accoglienza) onbTurniInVolo -= 1;
    togliTurno(reqId, volo.turno);
    turnoDellaScheda(scheda, -1);
  }
}

async function turnoFiloChat({ userMessage, threadHistory, image, images, reasoningReqId = null, internal = false, dopoOk = null, daModello = false, daFuori = false, chatId = null, rispostaA = null, schede = null, sender = null }, volo) {
  const inizioTurno = Date.now();
  // #2085 — le schede lasciate nel campo: valgono solo quelle il cui gettone è ancora nel testo.
  const gettoni = internal || !globalThis.SN_SCHEDE_IN_CHAT ? []
    : globalThis.SN_SCHEDE_IN_CHAT.allinea(String(userMessage || ''), schede).filter(Boolean);
  const lettiDaiGettoni = gettoni.length ? lettureDeiGettoni(gettoni, sender) : Promise.resolve([]);
  Compattazione.programmaFermo(null);
  // Un messaggio vero dell'utente è una richiesta nuova: le finestre guardate prima tornano a chiedere (#778).
  if (!internal) Schermo.nuovoTurno(chiaveSchermo(sender));
  await FiloMem.touchSession();
  // #524 — l'intervista di benvenuto si legge PRIMA di qualsiasi altra cosa,
  // perché la parola di stop deve funzionare anche quando il resto non
  // funziona: nessuna chiamata al modello, nessuna rete. Vedi
  // `SN_ONBOARDING.isExitRequest`.
  let onbBefore = Onboarding ? await FiloMem.getOnboarding() : { done: true };
  // L'intervista comincia col benvenuto di Filo: un messaggio scritto prima (senza crediti) non ne è una risposta, e
  // metterlo nella conversazione la faceva ripartire da lì, senza che Filo si presentasse mai.
  // Il turno è dell'intervista solo se arriva dalla sua conversazione: rifatta con altre chat aperte, quello che si
  // scrive lì resta di quelle chat, «stop» compreso (#1297).
  const onbActive = !!(Onboarding && !onbBefore.done && onbBefore.thread.length > 0)
    && (!chatId || chatId === Onboarding.chatId(onbBefore));
  if (onbActive) { volo.accoglienza = true; onbTurniInVolo += 1; }
  const imageList = (Array.isArray(images) && images.length) ? images : (image ? [image] : []);

  // #525 — la chat si scrive su disco ADESSO, non alla chiusura: se l'app
  // muore a metà discussione, la discussione c'è lo stesso. I turni interni
  // (i nudge di prosecuzione automatica) non sono parole dell'utente e non
  // entrano nell'archivio, come non entrano nell'intervista. Durante
  // l'intervista di benvenuto, prima del primo messaggio dell'utente va
  // archiviata la domanda con cui Filo l'ha aperta: è per questo che il
  // salvataggio sta qui sotto e non in cima, dove lo stato dell'intervista
  // non si era ancora letto.
  // Gli eventi del filo con cui questo turno ci entra: le lezioni che ne nascono li ricordano come fonti (#872).
  const fontiTurno = [];
  const citazione = internal ? { ref: null, citata: null } : await citazioneDelMessaggio(rispostaA, chatId);
  if (chatId && !internal) {
    // Da adesso questa chat è di questa scheda: quando la scheda sparisce, la
    // chat è finita (vedi `affidaChat`). L'intervista di benvenuto fa
    // eccezione, come già fa la pagina: chiusa a metà non è finita, riprende
    // dov'era alla prossima apertura, e classificarla adesso vorrebbe dire
    // pagare un titolo a ogni ricaricamento per una conversazione in corso.
    if (sender && sender.wc && !onbActive) affidaChat(chatId, sender.wc);
    if (onbActive) await archiviaAperturaAccoglienza(chatId, onbBefore);
    const { archiviata, domanda } = await archiviaDomanda(chatId, {
      testo: userMessage, immagini: imageList, daModello, ref: citazione.ref, schede: gettoni,
    }, { onboarding: onbActive });
    const eidDomanda = domanda && domanda.role === 'user' && archiviata.eids ? archiviata.eids[archiviata.eids.length - 1] : '';
    if (eidDomanda) fontiTurno.push(eidDomanda);
  }
  // La conversazione dell'intervista viene tenuta da parte mano a mano: è così
  // che chi chiude la finestra a metà la ritrova dov'era. I turni interni (i
  // nudge di prosecuzione automatica) non sono parole dell'utente e non entrano;
  // lo stesso messaggio ripetuto di fila non è un turno nuovo (appendTurn).
  // Il messaggio porta testo che l'utente non ha scritto lui: incollato o trascinato (lo dice la scheda), un'immagine,
  // il suggerimento di un modello.
  const messaggioDaFuori = !internal && (daFuori === true || daModello === true
    || (Array.isArray(images) && images.length > 0) || !!image);
  if (onbActive && !internal && String(userMessage || '').trim()) {
    onbBefore = await saveOnboarding(
      Onboarding.appendTurn(onbBefore, { role: 'user', text: String(userMessage), ...(messaggioDaFuori ? { daFuori: true } : {}) }),
    );
  }
  // «Riprendi» toglie il segno dello stop: da qui il turno è di nuovo in corso, e se la scheda muore riparte come gli altri.
  if (onbActive && internal && onbBefore && onbBefore.fermato) onbBefore = await saveOnboarding(Onboarding.togliFermato(onbBefore));
  // Da qui lo stop si scrive nell'intervista quando si preme; uno arrivato mentre il messaggio entrava si scrive adesso.
  const turno = volo.turno;
  const conto = volo.conto || TURNO_MUTO;
  if (onbActive) {
    turno.accoglienza = true;
    if (turno.fermato) onbBefore = await saveOnboarding(Onboarding.segnaFermato(onbBefore));
  }
  if (onbActive && !internal && Onboarding.isExitRequest(onbBefore, userMessage)) {
    turno.chiuso = true;
    // «basta così» chiude qui, senza chiedere niente a nessuno. Il congedo è un
    // testo fisso — l'unica risposta che si può garantire anche senza modello.
    // Un «no grazie» invece NON passa di qui: rifiuta la proposta che Filo ha
    // appena fatto, e a quella risponde il modello (vedi `isExitRequest`).
    const bye = Onboarding.CLOSING_MESSAGE;
    const closed = Onboarding.close(Onboarding.appendTurn(onbBefore, { role: 'filo', text: bye, congedo: true }));
    await saveOnboarding(closed, { via: 'uscita' });
    // Il congedo è l'ultima cosa che l'utente legge dell'accoglienza: finisce
    // in archivio come ogni altra battuta. Questo turno esce di qui e non
    // passa dal salvataggio della risposta più in basso.
    await archiviaCongedoAccoglienza(chatId, bye);
    releaseOnboardingResume();
    // Le lezioni di fine intervista passano dalla stessa regola di quelle di ogni turno, come la chiusura normale (#1312.2).
    const lessons = !Onboarding.haTestoDiAltri(closed)
      && await lezioniAutomaticheConsentite({ sender, fontiLette: chatId ? await fontiDellaChat(chatId) : [] });
    finishOnboarding({ userMessage, filoReply: bye, stateText: '', lessons });
    return { text: bye, actions: [], onboardingClosed: true };
  }

  // I cambi partono subito, in parallelo al resto del contesto: una volta al
  // giorno vanno presi in rete, e non devono sommarsi all'attesa (#724.1).
  const cambiP = Fx.get().then((fx) => Fx.formatForPrompt(fx)).catch(() => '');
  const cleanHistory = Array.isArray(threadHistory) ? threadHistory.slice(-20) : [];
  // #868 — il modello ha davanti il filo, non la sola scheda: gli ultimi giorni di conversazioni di ogni scheda, con
  // le ore, entro i due tetti. Quello che la scheda ha e il filo no (un turno interrotto, una ripresa) viene dopo.
  // Se il filo non si legge, si risponde con la conversazione della scheda come prima.
  let filo = null;
  let tettiChat = null;
  let settingsChat = null;
  let modelloChat = '';
  // Il primo modello della catena e il tetto della risposta: con la finestra del modello misurano una rilettura (#868.7).
  let modelloPrimo = '';
  let tettoRispostaChat = 0;
  let fotoNelTratto = true;
  // Oltre il listino anche dopo la compattazione, gli esiti dei turni passati escono e restano fuori per il turno.
  let senzaEsitiVecchi = false;
  const componiFilo = (tetti) => ContestoFilo.componi({
    chatId, userMessage: internal ? null : String(userMessage || ''), storia: threadHistory, tetti, osserva: observationsForPrompt,
    immagini: fotoNelTratto && !modelliSenzaFoto.has(modelloChat), senzaEsiti: senzaEsitiVecchi,
  });
  try {
    settingsChat = await getEffectiveSettings();
    tettiChat = globalThis.SN_FILO_CONTESTO.tetti(settingsChat.contestoFilo, Defaults.get().contestoFilo);
    try { modelloChat = String(modelForAction(settingsChat, ACTIONS.FILO_CHAT) || ''); } catch (_) {}
    try {
      const primo = SN_CONST.parseModelRefs(modelloChat)[0];
      const voce = primo ? globalThis.SN_STIMA_COSTO.voceDi(primo, settingsChat.modelRegistry || {}) : null;
      modelloPrimo = voce ? voce.model : '';
      const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;
      tettoRispostaChat = (LR && LR.perAzione(ACTIONS.FILO_CHAT, settingsChat.lunghezzaRisposte, Defaults.get().lunghezzaRisposte)) || 0;
    } catch (_) {}
    const finestra = finestreDeiModelli.get(modelloChat);
    if (finestra != null && finestra < tettiChat.token) {
      tettiChat = { ...tettiChat, token: finestra };
      contaSe('adattamento', ACTIONS.FILO_CHAT, modelloPrimo, 'finestra_piccola');
    }
    // Il tetto vale per la richiesta intera: il tratto lascia il posto alla parte fissa (#2473.1).
    try { tettiChat = { ...tettiChat, fissi: baseDellaChat(require('../shim/storage').inIncognito()) }; } catch (_) {}
    filo = await componiFilo(tettiChat);
  } catch (e) { console.warn('[Filo] tratto del filo non letto, rispondo con la sola scheda:', e?.message || e); }
  const codaScheda = filo && chatId ? filo.coda : cleanHistory;
  const vistiDalFilo = filo ? filo.visti : [];
  // La parte della conversazione di questa scheda che il modello non ha davanti: la ricerca la trova (#868).
  const nascostiDi = (f) => {
    if (!f || !chatId) return [];
    const davanti = new Set(f.visti.map((m) => globalThis.SN_FILO_CONTESTO.chiave(m)));
    return f.tutti.filter((m) => m.chat === chatId && !davanti.has(globalThis.SN_FILO_CONTESTO.chiave(m)));
  };
  let nascostiDellaChat = nascostiDi(filo);
  // I pezzi vecchi si cercano mentre si prepara il resto (memorie, stato, file): arrivano in coda, prima della domanda.
  // Quelli che il modello ha già davanti, ripescati da un turno prima o riletti per intero, non tornano (#868.1).
  const ricordiP = filo && !internal && !onbActive && RicordiFilo
    ? RicordiFilo.cerca(String(userMessage || ''), {
      vecchi: filo.vecchi,
      davanti: filo.visti,
      esiti: [...filo.azioni, ...codaScheda.flatMap((m) => (m && Array.isArray(m.actions) ? m.actions : []))],
    }).catch(() => [])
    : Promise.resolve([]);
  // #592.2 — nell'intervista di benvenuto lo stile proposto si imposta senza riquadro finché nella conversazione non
  // è entrato testo di altri; quello letto dalle azioni lo guarda executeFiloAction.
  const accoglienza = onbActive && !messaggioDaFuori && !Onboarding.haTestoDiAltri(onbBefore)
    && ![...cleanHistory, ...vistiDalFilo, ...codaScheda].some((m) => m && (m.daFuori === true || m.daModello === true || (typeof m.esterno === 'string' && !!m.esterno)));
  // #2536 — nell'intervista rifatta conta solo quello che l'utente dice lì: la memoria che il modello vedeva la citava,
  // gliela attribuiva o la ricopiava nel profilo, anche col divieto scritto. Fuori dall'intervista torna intera.
  // La frase che dice al modello che la memoria c'è ma è fuori vale solo con questa decisione (payloadBase).
  const memoriaNascosta = onbActive && onbBefore.rifatta === true;
  const { profilo, preferenze, espansioni, lezioni } = memoriaNascosta ? {} : await memoriaPerModello();
  // Nel benvenuto delle schede aperte arriva solo il sito: un titolo scritto da una pagina non detta lo stile (#1297).
  const { state: statoDelTurno, stateText, sezioniChat: sezioniDelTurno, attese: attesePrimaDelModello } = await FiloState.assemble({
    creditiFreschi: true, soloSiti: onbActive, finestra: winOf(sender)?.id ?? null, schedaChat: sender?.tab?.id ?? null,
  });
  // I numeri delle schede che il modello vede valgono per tutto il turno: CHIUDI_SCHEDE li legge da qui (#413).
  const schedeViste = ((statoDelTurno && statoDelTurno.tabs) || []).map((t) => t.id);
  // #379.5 — i file dell'editor entrano nel contesto come RIASSUNTI (uno per
  // file), non come testo integrale: economico e sempre presente. Filo, se serve,
  // chiede il contenuto completo di un file con l'azione LEGGI_FILE.
  const fileList = await editorFileSummariesList();
  let fileSummaries = '';
  try { fileSummaries = globalThis.SN_EDITOR_SUMMARY ? globalThis.SN_EDITOR_SUMMARY.renderForPrompt(fileList) : ''; } catch (_) {}
  // Finché l'intervista è aperta il prompt riceve l'elenco di ciò che resta da scoprire.
  // Per l'utente resta una chat normale: nessuna schermata a passi, nessun modulo.
  const onboardingText = onbActive ? Onboarding.renderChecklistForPrompt(onbBefore) : '';
  // Re-immissione dell'output dei comandi nel contesto del modello: l'output di
  // un ESEGUI_COMANDO eseguito in un turno precedente viene accodato al
  // messaggio dell'assistente, così nei turni successivi il modello SA davvero
  // cosa ha prodotto il comando (prima lo vedeva solo l'utente, e l'assistente
  // rispondeva "non ho ancora l'output").
  const threadMessages = [];
  // Le azioni il cui esito il modello ha davanti, da qualunque scheda e giorno: decidono se un NAVIGA di questo
  // turno può portare fuori dati (#587).
  const azioniViste = filo ? [...filo.azioni] : [];
  const lettureGettoni = await lettiDaiGettoni;
  azioniViste.push(...lettureGettoni);
  const FCx = globalThis.SN_FILO_CONTESTO;
  for (const m of codaScheda) {
    if (m && Array.isArray(m.actions)) azioniViste.push(...m.actions);
    const fuori = FCx.letturaDaFuori(m);
    if (fuori) azioniViste.push(fuori);
  }
  // Le risposte di altre conversazioni davanti al modello portano quello che avevano letto, anche dopo un riavvio (#1508).
  const dalTratto = FCx.trattoComeAzione(vistiDalFilo, { chatCorrente: chatId });
  if (dalTratto) azioniViste.push(dalTratto);
  // Il testo di altri nei blocchi davanti ai messaggi (pagine visitate, nomi di dispositivi, timer), senza un'azione (#2293).
  const dalPreambolo = globalThis.SN_URL_EXFIL.testoDeiSitiComeAzione((filo && filo.daFuori) || []);
  if (dalPreambolo) azioniViste.push(dalPreambolo);
  // Quello che una conversazione nuova avrebbe davanti, compresa questa: decide se il «no» può consigliarla.
  const tuttoIlTratto = FCx.trattoComeAzione(vistiDalFilo, { chatCorrente: null });
  LETTURE_DI_UNA_NUOVA.set(azioniViste, [...(filo ? filo.perUnaNuova || [] : []), ...(tuttoIlTratto ? [tuttoIlTratto] : [])]);
  // Le parole dell'utente che il modello ha davanti: un codice che ha scritto lui può uscire (#810). Un turno
  // interno non è sua voce, nemmeno il testo di un suggerimento della home: lo scrive un modello. Né la riga di una
  // conversazione di un'altra app, che scrive Filo, né quello che l'utente ha scritto nell'Aiuto sopra un sito (#1508).
  let paroleUtente = [...vistiDalFilo, ...codaScheda].filter((m) => m && m.role !== 'filo' && !m.daModello && !m.riga && !m.daPagina).map((m) => String(m.text || ''))
    .concat(internal || daModello ? [] : [String(userMessage || '')]).join('\n');
  // Gli indirizzi che il modello ha davanti, per la regola dell'indirizzo scritto (#553, src/main/services/pageRead.js).
  const provenienza = PageRead.contestoChat();
  PageRead.annotaLink(provenienza, paroleUtente);
  for (const a of azioniViste) PageRead.annotaAzione(provenienza, a);
  // Quello che la chat ha davanti e non ha scritto l'utente entra nel registro dei segreti letti (#810). Anche
  // le frasi di Filo: riaperta dalla Cronologia, la chat non ha più l'esito che aveva portato il codice.
  ricordaLettoInChat(azioniViste, [...vistiDalFilo, ...codaScheda]);
  const fontiLette = chatId ? await fontiDellaChat(chatId) : [];
  for (const a of azioniViste) await segnaFonteLetta(chatId, fontiLette, a);
  // Nel benvenuto il testo di altri (incollato, trascinato, da un sito) sporca il compito: lo stile torna al riquadro (#592.2).
  if (onbActive && !accoglienza) {
    await segnaFonte(chatId, fontiLette, { classe: 5, campo: null, chiave: 'benvenuto:testo-di-altri', motivo: 'è entrato un testo che non hai scritto tu' });
  }
  // Un'immagine incollata o trascinata in chat l'ha fatta qualcun altro: guardarla è una lettura (#1312).
  if (imageList.length && !internal) {
    await segnaFonte(chatId, fontiLette, { classe: 5, campo: null, chiave: 'chat:immagine', motivo: 'ho guardato un\'immagine che hai incollato' });
  } else if (!internal && (daFuori === true || daModello === true)) {
    // Così un testo incollato o trascinato nel campo, o un suggerimento scritto da un modello: la strada B lo conta (#1840).
    await segnaFonte(chatId, fontiLette, daFuori === true
      ? { classe: 5, campo: null, chiave: 'chat:testo-di-altri', motivo: 'è entrato in chat un testo che non hai scritto tu' }
      : { classe: 5, campo: null, chiave: 'chat:suggerimento', motivo: 'hai mandato un suggerimento scritto da un modello' });
  }
  // Cosa ha scritto l'utente nel compito: le coordinate bancarie che ci stanno dentro le ha chieste lui (#530).
  // Il compito è la conversazione di questa scheda come la vede il modello: nel filo, più la coda.
  const conversazioneScheda = filo && chatId ? [...vistiDalFilo.filter((m) => m && m.chat === chatId), ...codaScheda] : codaScheda;
  let richiesta = [...conversazioneScheda.filter((m) => m && m.role !== 'filo').map((m) => String(m.text || '')), String(userMessage || '')].join('\n');
  // Le parole di adesso: un indirizzo può portarle fuori, quelle dette prima no senza un OK (#868.6). Un turno che riprende
  // rifà l'ultima richiesta della scheda; il testo di un suggerimento l'ha scritto un modello.
  const ultimaDellaScheda = conversazioneScheda.filter((m) => m && m.role !== 'filo' && !m.daModello).pop();
  let domandaDiAdesso = daModello ? '' : internal ? String((ultimaDellaScheda && ultimaDellaScheda.text) || '') : String(userMessage || '');
  for (const m of codaScheda) {
    const role = m.role === 'filo' ? 'assistant' : 'user';
    const fuori = FCx.letturaDaFuori(m);
    let content = fuori ? '' : String(m.text || '');
    // Le immagini della scheda non viaggiano con la sua storia: il modello deve sapere che c'erano (#1166). Non la
    // domanda che si riprova dopo un turno interrotto: le sue immagini arrivano con lei, qui sotto.
    const riprovata = imageList.length && String(m.text || '') === String(userMessage || '');
    const quanteFoto = role === 'user' && !riprovata ? FCx.numeroImmagini(m) : 0;
    if (quanteFoto) content = `${content}\n${FCx.notaImmagini(quanteFoto)}`;
    // Le risposte citate, come la pagina le ha davanti: qui arrivano solo i messaggi che il filo non ha (#1620, #2346).
    const citateQui = role === 'user' && m.rispostaA && RispostaA ? RispostaA.daPaginaTutte(m.rispostaA) : [];
    const lette = citateQui.map((c) => {
      const passo = c.a != null ? c.testo.slice(c.da, c.a) : '';
      return { role: c.role === 'user' ? 'user' : 'filo', testo: RispostaA.taglia(passo || c.testo, RispostaA.PER_IL_MODELLO), ...(passo || c.passo ? { passo: true } : {}), ...(c.pos ? { pos: c.pos } : {}) };
    }).filter((c) => c.testo);
    if (lette.length) content = FCx.conCitazioni(content, lette);
    const msg = { role, content };
    if (role === 'assistant') {
      const parts = [];
      // Turno interrotto da un guasto: ciò che era già stato fatto è stato fatto davvero, o al
      // «Riprova» il modello rifarebbe il timer appena messo.
      if (m.interrotto) {
        const fatte = interruptedActionsForPrompt(m.actions, { fermato: !!m.fermato });
        if (fatte) parts.push(fatte);
      }
      const obs = observationsForPrompt(fuori ? [...(Array.isArray(m.actions) ? m.actions : []), fuori] : m.actions);
      if (obs) parts.push(obs);
      // Com'è andata (#1294): dall'archivio se la storia viene da lì, se no le proposte ancora ferme sulla conferma, che
      // gli esiti da leggere non dicono (#1130.2).
      const ES = globalThis.SN_ESITO;
      const voci = Array.isArray(m.esiti) && m.esiti.length ? m.esiti
        : ES.vociArchivio((Array.isArray(m.actions) ? m.actions : []).filter((a) => a && a._confirm));
      const storia = m.confermaDopo ? '' : ES.perModello(ES.daRaccontare(voci, !!obs));
      if (storia) parts.push(storia);
      const extra = parts.join('\n\n');
      if (extra) msg.content = content ? `${content}\n\n${extra}` : extra;
      // Il ragionamento del turno passato torna al modello così com'era
      // arrivato (blocchi strutturati del fornitore): riprende da dove aveva
      // lasciato invece di ripensare tutto. Il fornitore lo reinserisce per i
      // modelli che lo sanno usare e lo ignora per gli altri; verso Claude solo
      // col prefisso con cui è nato (providers/ragionamentoRimandato.js).
      if (Array.isArray(m.reasoningDetails) && m.reasoningDetails.length) msg.reasoning_details = m.reasoningDetails;
    }
    // Un turno senza niente da dire non va al modello (#1294).
    if (!String(msg.content || '').trim()) continue;
    threadMessages.push(msg);
  }
  const indiceDomanda = threadMessages.length;
  const giaLetta = origineGiaLettaInChat(chatId);
  // #1373 — la ripresa dopo l'OK porta com'è andata, come il risultato di uno strumento: il registro lo scrive, non la scheda.
  const esitoDopoOk = dopoOk ? globalThis.SN_ESITO.perModello(globalThis.SN_ESITO.vociArchivio(dopoOk)) : '';
  const domandaConCitazione = [FCx.conCitazioni(String(userMessage || ''), citazione.citata), esitoDopoOk].filter(Boolean).join('\n');
  const gettoniLetti = notaDeiGettoni(lettureGettoni);
  // Le note di questo turno sulla domanda: tornano con lei nei turni dopo (src/main/services/contestoFilo.js).
  let origineImmagini = '';
  if (imageList.length) {
    const parts = [];
    if (domandaConCitazione) parts.push({ type: 'text', text: domandaConCitazione });
    if (gettoniLetti) parts.push({ type: 'text', text: gettoniLetti });
    for (const im of imageList) parts.push({ type: 'image_url', image_url: { url: im } });
    // #711 — «questa foto è fatta con l'AI?» deve avere in chat la stessa
    // risposta del tasto destro, quindi il controllo si fa SEMPRE: capire
    // dall'intento quando serve sarebbe una promessa affidata al modello.
    const origine = await noteProvenienzaImmagini(imageList);
    origineImmagini = origine || '';
    if (origine) parts.push({ type: 'text', text: origine });
    if (giaLetta) parts.push({ type: 'text', text: giaLetta });
    threadMessages.push({ role: 'user', content: parts });
    ricordaOrigineInChat(chatId, origine);
  } else {
    threadMessages.push({ role: 'user', content: [domandaConCitazione, gettoniLetti, giaLetta].filter(Boolean).join('\n\n') });
  }

  // Reasoning in diretta: se il client ha aperto un canale, i thought summary arrivano alla
  // scheda mano a mano. Se il modello non ne dà, restano le frasi indicative.
  const wc = sender?.wc || null;
  const canPush = reasoningReqId && wc && !wc.isDestroyed?.();
  const push = (channel, payload) => {
    if (!canPush) return;
    try { wc.send(channel, { reqId: reasoningReqId, ...payload }); } catch (_) {}
  };
  const onReasoning = canPush ? (text) => push('filo:reasoning', { text }) : null;
  // La risposta scorre in diretta: alla scheda arrivano i delta, o il reset dopo un ripiego.
  const onText = canPush ? (payload) => push('filo:answer', payload) : null;
  // Il nome dell'azione arriva prima degli argomenti: la scheda dice subito «Cerco sul web…».
  const onToolCall = canPush
    ? (c) => push('filo:action', { kind: 'start', type: String(c.name || '').toUpperCase(), callId: c.id || '' })
    : null;

  // Indice COMPATTO delle capacità, sempre in contesto: l'agente sa SE Filo fa una cosa
  // e chiede il dettaglio on-demand con CAPACITA_DETTAGLIO (F2).
  const Caps = globalThis.SN_CAPABILITIES;
  const capacita = Caps ? Caps.renderIndexForPrompt(cancelliAperti()) : '';
  const Tools = globalThis.SN_ACTION_TOOLS;
  // Gli stessi per ogni utente, sistema e ruolo: stanno in testa alla richiesta, e un byte diverso rompe la cache da lì.
  const tools = Tools ? Tools.definitions() : null;
  const cambi = await cambiP;
  // SPEC-CONTESTO § La richiesta: il CONTESTO dell'utente si fotografa e resta com'era fino al prossimo taglio del
  // tratto; quello che cambia dopo arriva nella domanda. Il sistema lo sa solo il main process (la pagina non ha
  // `process`): senza, il modello indovina Windows e su un Mac propone PowerShell e percorsi `C:\`.
  let nomeModello = modelloPrimo || modelloChat;
  try {
    const ch = buildAttemptChain(settingsChat || await getEffectiveSettings(), modelloChat, ACTIONS.FILO_CHAT);
    if (ch[0] && ch[0].model) nomeModello = ch[0].model;
  } catch (_) {}
  const TV = globalThis.SN_TRATTO_VIVO;
  const incognitoTurno = require('../shim/storage').inIncognito();
  // Il diario del filo compattato (SPEC-CONTESTO § Tre livelli) sta nel CONTESTO, dopo la memoria.
  const sezioniCon = async () => {
    let diario = '';
    try { diario = await Compattazione.sezione(incognitoTurno); } catch (e) { console.warn('[Filo] diario del filo non letto:', e?.message || e); }
    return TV.sezioniUtente({
      sistema: process.platform, capacita, stile: (settingsChat && settingsChat.agentStyle) || '', modelName: nomeModello,
      profilo, preferenze, espansioni, lezioni, statoSezioni: sezioniDelTurno, cambi, files: fileSummaries, filesList: fileList, filo: diario,
    });
  };
  let sezioniUtente = await sezioniCon();
  // Quando la parte dell'utente è partita l'ultima volta: oltre la durata della cache, a tratto grande, si compatta.
  const fotoPrima = ContestoFilo.ultimaFotografia(incognitoTurno);
  let fotografia = null;
  if (filo) {
    fotografia = ContestoFilo.fotografa({
      incognito: incognitoTurno, sezioni: sezioniUtente, ancora: filo.ancora, durata: tettiChat && tettiChat.cache,
      segna: !!filo.haDomanda && !internal,
    });
    // Una fotografia nuova toglie dai messaggi passati le sezioni cambiate di quella prima: ora le ha il CONTESTO.
    if (fotografia.epoca !== filo.epoca) {
      try {
        filo = await componiFilo(tettiChat);
        nascostiDellaChat = nascostiDi(filo);
      } catch (e) { console.warn('[Filo] tratto non ricomposto dopo la fotografia:', e?.message || e); }
    }
  }
  // Il testo di altri che il CONTESTO mostra, una fonte per sezione, anche di una fotografia di prima (#2293, #2305).
  const dalleSchede = globalThis.SN_URL_EXFIL.testoDeiSitiComeAzione(fotografia
    ? fotografia.daFuori : TV.unisciDaFuori(...sezioniUtente.map((s) => (s && s.daFuori) || [])));
  if (dalleSchede) {
    azioniViste.push(dalleSchede);
    ricordaLettoInChat([dalleSchede]);
  }
  const payloadBase = {
    // Non entra nel prompt (la domanda sta in threadMessages): è la domanda come l'ha scritta l'utente, per la Cronologia AI.
    userMessage: String(userMessage || ''),
    parteUtente: fotografia ? fotografia.testo : TV.parteUtente(sezioniUtente, { ts: new Date().toISOString() }),
    onboarding: onboardingText,
    onboardingTurns: onbActive ? Onboarding.userTurns(onbBefore) : 0,
    onboardingMax: Onboarding ? Onboarding.MAX_EXCHANGES : 0,
    onboardingRifatta: onbActive && onbBefore.rifatta === true,
    memoriaNascosta,
    ...(filo ? { filoTratto: filo.messaggi, indiceDomanda, chatCorrente: chatId, chatNuova: filo.nuova } : {}),
  };
  // SPEC-CONTESTO § La compattazione: prima di ogni richiesta, anche a metà di un giro di strumenti. Oltre la soglia (o
  // fermo oltre la durata della cache, a tratto grande) il pezzo più vecchio del tratto diventa righe delle ore e la parte
  // dell'utente si rifotografa; oltre il listino, dopo, escono gli esiti dei turni passati; se non basta la richiesta parte
  // e la Cronologia AI lo segna. Il testo dell'utente non si taglia.
  const LC = globalThis.SN_FILO_COMPATTAZIONE;
  let compattazioniNelTurno = 0;
  let ultimaStima = 0;
  let limitiDelTurno = null;
  const ricomponi = async () => {
    filo = await componiFilo(tettiChat);
    sezioniUtente = await sezioniCon();
    fotografia = ContestoFilo.fotografa({
      incognito: incognitoTurno, sezioni: sezioniUtente, ancora: filo.ancora, durata: tettiChat && tettiChat.cache,
      segna: !!filo.haDomanda && !internal,
    });
    if (fotografia.epoca !== filo.epoca) filo = await componiFilo(tettiChat);
    payloadBase.parteUtente = fotografia.testo;
    payloadBase.filoTratto = filo.messaggi;
    nascostiDellaChat = nascostiDi(filo);
  };
  const stimaRichiesta = async () => {
    const FC = globalThis.SN_FILO_CONTESTO;
    try { return Math.ceil((await caratteriRichiesta()) / FC.CARATTERI_PER_TOKEN); } catch (_) { return 0; }
  };
  const compattaSeServe = async (round) => {
    if (!filo || !tettiChat) return;
    let token = await stimaRichiesta();
    // Dopo un riavvio non c'è una richiesta precedente in memoria: la pausa si misura dall'ultimo messaggio del filo.
    const ultimoUso = round !== 1 ? null : (fotoPrima ? fotoPrima.usata : LC.ultimaAttivita(filo.tutti, { chat: chatId }));
    // La parte della richiesta che non è tratto né domanda (strumenti, parte fissa, CONTESTO), misurata al primo giro, e
    // il peso dei turni: la soglia vera, il grezzo che resta e l'anticipo vengono da lì (SN_FILO_COMPATTAZIONE.limiti).
    // Il tratto «grande» si misura come lo misura il timer da fermo: le due strade decidono sullo stesso numero.
    if (round === 1) {
      try {
        const fissi = parteFissaChat(tools, payloadBase.parteUtente);
        Compattazione.segnaBase(incognitoTurno, fissi);
        // Una parte fissa più grossa di quella prevista stringe il tratto subito: il tetto vale per la richiesta intera.
        tettiChat = { ...tettiChat, fissi };
        if (filo.token > globalThis.SN_FILO_CONTESTO.tettoDelTratto(tettiChat.token, fissi)) {
          await ricomponi();
          token = await stimaRichiesta();
        }
      } catch (e) { console.warn('[Filo] parte fissa non misurata:', e?.message || e); }
      try { limitiDelTurno = await Compattazione.limiti(incognitoTurno, { tetti: tettiChat }); } catch (_) { limitiDelTurno = null; }
    }
    const l = limitiDelTurno || {};
    const motivo = LC.motivo({
      token, soglia: tettiChat.soglia, base: l.base, turno: l.turno, tokenTratto: ultimoUso != null ? l.tokenTratto || 0 : 0,
      ultimoUso, cacheMs: ContestoFilo.durataMs(tettiChat.cache),
    });
    if (motivo && compattazioniNelTurno < 2) {
      compattazioniNelTurno++;
      let r = null;
      try { r = await Compattazione.compatta({ incognito: incognitoTurno, motivo, tetti: tettiChat }); } catch (e) { console.warn('[Filo] compattazione:', e?.message || e); }
      if (r && r.fatto) {
        try { await ricomponi(); } catch (e) { console.warn('[Filo] tratto non ricomposto dopo la compattazione:', e?.message || e); }
        token = await stimaRichiesta();
      }
    }
    if (token > LC.LISTINO && !senzaEsitiVecchi) {
      senzaEsitiVecchi = true;
      try { await ricomponi(); } catch (e) { console.warn('[Filo] tratto non ricomposto senza esiti:', e?.message || e); }
      token = await stimaRichiesta();
    }
    ultimaStima = token;
    if (token > LC.LISTINO) {
      payloadBase.oltreListino = token;
      console.warn(`[Filo] richiesta della chat oltre il listino anche dopo la compattazione: circa ${token} token`);
    } else delete payloadBase.oltreListino;
  };

  // IL GIRO: il modello chiama le azioni, il main le esegue e gli rimanda gli esiti, finché
  // risponde senza chiamare: quello è il testo. Il tetto ai giri è la rete contro i loop.
  const MAX_ROUNDS = 12;
  const rawActions = [];
  // Le letture delle schede lasciate nel messaggio restano col turno: nei turni dopo il modello le ritrova come le sue.
  const renderedActions = [...lettureGettoni];
  // Gli indirizzi scritti dal modello e rifiutati, che il modello non ha poi trovato altrove (#553): a fine turno
  // restano sotto la risposta come bottone da confermare, senza popup.
  const lasciati = new Map();
  const notes = [];
  // I testi dei giri di soli bottoni, in ordine: aprono la risposta (#1167). Una nota scritta prima dell'ultimo di
  // loro non diventa risposta a giro finale muto.
  const risposta = [];
  let noteAllaRisposta = 0;
  // Quante note erano già scritte all'ultimo «non disponibile»: quelle lo
  // davano per fatto, una nota successiva è scritta sapendolo (#771).
  let noteAlRifiuto = -1;
  let sollecitato = false;
  let r = null;
  let textReply = '';
  let reasoningDetails = [];
  let costEur = 0;
  // Un giro qualunque del turno servito dalla chiave personale dopo il rifiuto
  // della propria (#629): la scheda lo dice una volta, sotto la risposta.
  let keyFallback = null;
  // Resta vero solo se il modello ha chiamato azioni fino al tetto senza mai
  // rispondere: allora l'utente deve saperlo, non ricevere l'ultima nota di
  // lavoro spacciata per risposta.
  let exhausted = true;
  // I giri con azioni: i «passi» della frase che dice che Filo si è fermato senza risposta.
  let passi = 0;
  // I seguiti (#1296) entrano prima di ogni chiamata al modello, dopo gli esiti del passo prima: sono parole
  // dell'utente come la domanda, e lo sanno le uscite (#810, #530, #868.6), l'archivio e la scheda.
  const seguitiLetti = [];
  const testiDeiSeguiti = [];
  // Le chiavi nel filo dei seguiti: il turno li rimanda dentro il suo giro, e il tratto non li ripete.
  const seguitiNelFilo = [];
  const leggiSeguiti = async () => {
    for (const s of turno.seguiti.splice(0)) {
      turno.letti.add(s.id);
      seguitiSerbati.delete(s.id);
      seguitiLetti.push(s.id);
      testiDeiSeguiti.push(s.testo);
      threadMessages.push({ role: 'user', content: `${s.testo}\n\n${NOTA_SEGUITO}` });
      paroleUtente = `${paroleUtente}\n${s.testo}`;
      richiesta = `${richiesta}\n${s.testo}`;
      domandaDiAdesso = domandaDiAdesso ? `${domandaDiAdesso}\n${s.testo}` : s.testo;
      push('filo:action', { kind: 'seguito', id: s.id });
      if (!chatId) continue;
      try {
        const dopo = await appendToChatArchive(chatId, { role: 'user', text: s.testo, seguito: true });
        const eid = dopo && Array.isArray(dopo.eids) ? dopo.eids[dopo.eids.length - 1] : '';
        if (eid) fontiTurno.push(eid);
        const ultimo = dopo && Array.isArray(dopo.messages) ? dopo.messages[dopo.messages.length - 1] : null;
        if (ultimo && ultimo.role === 'user') seguitiNelFilo.push(`${chatId}|${ultimo.ts}`);
      } catch (e) { console.warn('[Filo] seguito non archiviato', e?.message || e); }
    }
  };
  // I pezzi vecchi ripescati entrano nella domanda, e il blocco di attività lo dice come una ricerca (#868).
  const ricordi = await entroIl(ricordiP, ATTESA_RICORDI_MS, []);
  if (ricordi.length) {
    const a = globalThis.SN_FILO_CONTESTO.ricordoComeAzione(ricordi);
    if (onToolCall) onToolCall({ name: a.type, id: a._callId });
    push('filo:action', { kind: 'done', action: a, kept: true, executed: true });
    renderedActions.push(a);
    azioniViste.push(a);
    ricordaLettoInChat([a]);
    await segnaFonteLetta(chatId, fontiLette, a);
  }
  // La domanda come la rende il tratto dei turni dopo (SPEC-CONTESTO: il tratto cresce solo in coda): le sezioni del
  // CONTESTO cambiate, i ricordi e le note sulle immagini si fissano qui, nel messaggio dell'utente; l'intervista vale
  // solo per questo turno.
  if (filo && filo.haDomanda && !internal) {
    const resa = filo.domanda({
      stato: fotografia ? fotografia.cambiate : '', epoca: fotografia ? fotografia.epoca : filo.epoca,
      onboarding: onbActive ? PROMPTS.filoChatOnboarding({ onboarding: onboardingText, onboardingTurns: payloadBase.onboardingTurns, onboardingMax: payloadBase.onboardingMax, onboardingRifatta: payloadBase.onboardingRifatta, memoriaNascosta: payloadBase.memoriaNascosta }) : '',
      ricordi, dopo: [origineImmagini, gettoniLetti, giaLetta], immagini: imageList,
    });
    if (resa) threadMessages[indiceDomanda] = resa;
  } else if (ricordi.length && threadMessages[indiceDomanda]) {
    // Una domanda che il filo non ha (senza chat): i ricordi le stanno in testa lo stesso.
    const d = threadMessages[indiceDomanda];
    const r = globalThis.SN_FILO_CONTESTO.rendiRicordi(ricordi);
    threadMessages[indiceDomanda] = typeof d.content === 'string'
      ? { ...d, content: `${r}\n\n${d.content}` }
      : { ...d, content: [{ type: 'text', text: r }, ...d.content] };
  }
  // #868.7 — la finestra del modello che risponde: quella detta da un rifiuto, o quella del listino di OpenRouter (il
  // modello che ha servito il giro, poi il primo della catena). Null se non si sa: vale il tetto in token.
  const finestraNota = async () => {
    const detta = finestreNote.get(modelloChat);
    if (detta) return detta;
    try {
      const Listino = require('./costoModelli');
      await entroIl(Listino.listino(), ATTESA_LISTINO_MS, null);
      return Listino.finestra(r && r.model) || Listino.finestra(modelloPrimo) || null;
    } catch (_) { return null; }
  };
  // Una rilettura di questo turno sta nella finestra insieme a tutto quello che la richiesta porta già.
  const capRilettura = async () => {
    const FC = globalThis.SN_FILO_CONTESTO;
    const tetto = tettiChat ? tettiChat.token : FC.TETTI_DI_SERIE.token;
    const finestra = await finestraNota();
    if (!finestra) return FC.capRilettura({ tetto });
    let caratteri = 0;
    try { caratteri = await caratteriRichiesta(); } catch (_) { caratteri = caratteriStrumenti(); }
    return FC.capRilettura({ tetto, finestra, occupati: Math.ceil(caratteri / FC.CARATTERI_PER_TOKEN), risposta: tettoRispostaChat });
  };
  // Le riletture di questo turno fra i messaggi per il modello: { x, i (posto in threadMessages), giro, coda }.
  const riletture = [];
  const lunghezzaDi = (y) => String((threadMessages[y.i] && threadMessages[y.i].content) || '').length;
  // Un rifiuto per finestra arrivato con una rilettura lunga davanti: la rilettura si accorcia quanto dice il rifiuto
  // (senza misure, a metà) e si rilegge da capo, nello stesso giro. Stringere il tratto non basterebbe.
  const stringiRiletture = async (rifiuto, caratteri) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    const lunghe = riletture.filter((y) => lunghezzaDi(y) > FC.RILETTURA_MIN);
    const totale = lunghe.reduce((n, y) => n + lunghezzaDi(y), 0);
    let fuori = 0;
    try { fuori = tools ? JSON.stringify(tools).length : 0; } catch (_) {}
    const resta = lunghe.length
      ? FC.rilettureDopoRifiuto({ ...rifiuto, caratteri, caratteriRiletture: totale, n: lunghe.length, risposta: tettoRispostaChat, fuori })
      : null;
    if (resta == null || resta >= totale) return false;
    let stretta = false;
    for (const y of lunghe) {
      const o = y.x.res.output;
      const cap = Math.max(FC.RILETTURA_MIN, Math.floor(String(o.transcript || '').length * (resta / totale)));
      let chat = null;
      try { chat = await FiloChats.get(o.chatRead); } catch (_) {}
      if (!chat) continue;
      const nuova = rilettura(chat, { da: y.x.action.da, cap });
      if (nuova.transcript.length >= String(o.transcript || '').length) continue;
      delete o.intera;
      Object.assign(o, nuova);
      threadMessages[y.i] = Tools.toolMessage(y.x.action._callId, `${toolResultText(y.x, y.giro)}${y.coda}`);
      stretta = true;
    }
    return stretta;
  };
  // #1596 — le pagine lette in questo turno fra i messaggi per il modello: { x, i, giro, coda, round, ordine }. Quando
  // insieme non stanno nella finestra restano le ultime chieste (nell'ordine delle chiamate), le altre si accorciano o
  // lasciano titolo e indirizzo, e la risposta lo dice.
  const pagineLette = [];
  const pagineVive = () => pagineLette.filter((p) => p.x.res.output.tenuti !== 0)
    .sort((a, b) => b.round - a.round || a.ordine - b.ordine);
  const caratteriStrumenti = () => { try { return tools ? JSON.stringify(tools).length : 0; } catch (_) { return 0; } };
  // Il peso della richiesta di adesso, messaggi e strumenti: la sola misura di soglia, riletture e finestra.
  const caratteriRichiesta = async () => globalThis.SN_FILO_CONTESTO.caratteriDi(await buildMessages(ACTIONS.FILO_CHAT, { ...payloadBase, threadMessages })) + caratteriStrumenti();
  // `tutte`: i caratteri delle pagine ancora davanti al modello; `altre`: quanto si libera togliendo tutte meno l'ultima
  // chiesta, che ha il posto anche a costo di stringere la conversazione (rileggere una pagina tolta deve riuscire).
  const misuraPagine = () => {
    const vive = pagineVive();
    const tutte = vive.reduce((n, p) => n + lunghezzaDi(p), 0);
    const altre = vive.length > 1 ? tutte - lunghezzaDi(vive[0]) - globalThis.SN_FILO_CONTESTO.PESO_RIMANDO * (vive.length - 1) : 0;
    return { tutte, altre: Math.max(0, altre) };
  };
  const lasciaFuoriPagine = (eccesso) => {
    const vive = pagineVive();
    const tenere = globalThis.SN_FILO_CONTESTO.pagineDaTenere(vive.map(lunghezzaDi), eccesso);
    let stretta = false;
    vive.forEach((p, k) => {
      const prima = lunghezzaDi(p);
      if (tenere[k] >= prima) return;
      const o = p.x.res.output;
      const visibile = Number.isFinite(o.tenuti) ? o.tenuti : String(o.testo || '').length;
      const resta = tenere[k] ? visibile - (prima - tenere[k]) : 0;
      // Sotto il minimo un pezzo di pagina non serve al modello: resta il rimando.
      o.tenuti = resta >= globalThis.SN_FILO_CONTESTO.PAGINA_MIN / 2 ? resta : 0;
      threadMessages[p.i] = Tools.toolMessage(p.x.action._callId, `${toolResultText(p.x, p.giro)}${p.coda}`);
      stretta = true;
    });
    return stretta;
  };
  // Con la finestra nota le pagine si accorciano prima di mandare: niente rifiuto da aspettare. Solo quando basta
  // togliere le altre; se no decide il rifiuto, che stringe prima la conversazione.
  const pagineNellaFinestra = async () => {
    const { altre } = misuraPagine();
    if (!altre) return;
    const finestra = await finestraNota();
    if (!finestra) return;
    const FC = globalThis.SN_FILO_CONTESTO;
    let caratteri = 0;
    try { caratteri = await caratteriRichiesta(); } catch (_) { return; }
    const eccesso = FC.eccessoNellaFinestra({ finestra, caratteri, risposta: tettoRispostaChat, margine: FC.MARGINE_PAGINE });
    if (eccesso > 0 && eccesso <= altre) lasciaFuoriPagine(eccesso);
  };
  // Le pagine rimaste fuori a fine turno, per la frase sotto la risposta: non quelle rilette poi per intero.
  const pagineLasciate = () => {
    const chiave = (o) => `${o.url || o.pageRead || ''}|${Number(o.da) || 0}`;
    const intere = new Set(pagineLette.filter((p) => !Number.isFinite(p.x.res.output.tenuti)).map((p) => chiave(p.x.res.output)));
    return pagineLette.map((p) => p.x.res.output)
      .filter((o) => Number.isFinite(o.tenuti) && !intere.has(chiave(o)))
      .map((o) => ({ url: o.url || o.pageRead || '', parziale: o.tenuti > 0 }));
  };
  // Il modello della chat rifiuta una richiesta più lunga della sua finestra: il tratto si stringe quanto dice il
  // rifiuto e si rifà lo stesso giro. Il tetto che ha funzionato vale per i turni dopo con quel modello.
  let strette = 0;
  let stretteRiletture = 0;
  let finestraDaRicordare = null;
  const stringiTratto = async (rifiuto, caratteri, caratteriTratto) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    const perTratto = FC.tettoDopoRifiuto({ ...rifiuto, caratteri, caratteriTratto });
    const fissi = tettiChat.fissi || 0;
    if (perTratto == null || perTratto >= FC.tettoDelTratto(tettiChat.token, fissi)) return false;
    // Il rifiuto misura il solo tratto; il tetto, che vale per la richiesta intera, ci rimette la parte fissa.
    const token = perTratto + fissi;
    strette++;
    tettiChat = { ...tettiChat, token };
    try { filo = await componiFilo(tettiChat); } catch (_) { return false; }
    payloadBase.filoTratto = filo.messaggi;
    nascostiDellaChat = nascostiDi(filo);
    // Si ricorda solo quando a sforare era il tratto: un messaggio enorme o una rilettura lunga di questo turno non
    // devono lasciare un tratto minuscolo ai turni dopo.
    if (caratteriTratto >= caratteri - caratteriTratto) finestraDaRicordare = token;
    return true;
  };
  const stringiDopoRifiuto = async (e) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    // Un rifiuto dato dal tetto della risposta non si cura stringendo la conversazione, salvo `stringibile`: lì
    // accorciare il tratto basta e non chiede niente all'utente.
    const rifiuto = e?.code !== 'TETTO_RISPOSTA' || e?.stringibile ? FC.troppoLungo(e) : null;
    if (!rifiuto) return false;
    if (rifiuto.max) finestreNote.set(modelloChat, rifiuto.max);
    let inviati = [];
    try { inviati = await buildMessages(ACTIONS.FILO_CHAT, { ...payloadBase, threadMessages }); } catch (_) {}
    const caratteri = FC.caratteriDi(inviati);
    const conTratto = !!(filo && tettiChat && Array.isArray(payloadBase.filoTratto)) && strette < 3;
    const caratteriTratto = conTratto ? FC.caratteriDi(payloadBase.filoTratto) : 0;
    const conRiletture = riletture.length > 0 && stretteRiletture < 3;
    const caratteriRiletture = riletture.reduce((n, y) => n + lunghezzaDi(y), 0);
    // #1596 — le pagine del turno sono arrivate dopo una richiesta che ci stava: se togliere quelle oltre l'ultima chiesta
    // basta, si tolgono loro e la conversazione resta. Senza misure si dimezzano. Per ultima si accorcia anche quella.
    const pagine = misuraPagine();
    const eccesso = pagine.tutte ? FC.eccessoDopoRifiuto({ ...rifiuto, caratteri: caratteri + caratteriStrumenti(), risposta: tettoRispostaChat }) : null;
    if (pagine.altre && (eccesso == null || eccesso <= pagine.altre)
      && lasciaFuoriPagine(eccesso ?? Math.min(Math.ceil(pagine.tutte / 2), pagine.altre))) return true;
    const accorciaPagine = () => pagine.tutte > 0 && lasciaFuoriPagine(eccesso ?? Math.ceil(pagine.tutte / 2));
    // Si stringe prima la parte più grossa; se non si stringe più, l'altra.
    const prima = conRiletture && caratteriRiletture >= caratteriTratto ? 'riletture' : 'tratto';
    for (const parte of prima === 'riletture' ? ['riletture', 'tratto'] : ['tratto', 'riletture']) {
      if (parte === 'riletture' && conRiletture && await stringiRiletture(rifiuto, caratteri)) { stretteRiletture++; return true; }
      if (parte === 'tratto' && conTratto && await stringiTratto(rifiuto, caratteri, caratteriTratto)) return true;
    }
    return accorciaPagine();
  };
  // Un modello che non prende immagini (o non tante) rifiutava anche le domande senza: quelle dei turni passati
  // lasciano il posto alla nota e lo stesso giro riparte. Vale per i turni dopo con quel modello (#1166).
  const senzaFotoDopoRifiuto = async (e) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    if (!filo || !fotoNelTratto || !FC.rifiutaImmagini(e)) return false;
    const conFoto = (payloadBase.filoTratto || []).some((m) => Array.isArray(m && m.content) && m.content.some((p) => p && p.type === 'image_url'));
    if (!conFoto) return false;
    fotoNelTratto = false;
    modelliSenzaFoto.add(modelloChat);
    try { filo = await componiFilo(tettiChat); } catch (_) { return false; }
    payloadBase.filoTratto = filo.messaggi;
    nascostiDellaChat = nascostiDi(filo);
    return true;
  };
  // Turno finito prima del suo ultimo giro (fermato, o un guasto): nell'archivio restano le azioni successe davvero e la
  // parte di risposta già scritta coi bottoni, come nella bolla. Riaperta, la chat racconta lo stesso.
  const archiviaGiaFatto = async () => {
    const successe = renderedActions.filter(globalThis.SN_ESITO.successa);
    // Anche la parte già scritta porta le sue fonti e immagini controllate, mai i marcatori grezzi (#2383, #2272).
    const citate = globalThis.SN_IMMAGINI_RISPOSTA.controllaConFonti(unisciTesti(risposta), renderedActions);
    const giaScritta = citate.text;
    if (!chatId || (!successe.length && !giaScritta && !citate.immagini.length)) return;
    const cambi = successe.flatMap((x) => (x && Array.isArray(x._cambi) ? x._cambi.map((c) => c.id) : []));
    const classeLetta = await classeLettaDelCompito(sender, { contesto: azioniViste, fontiLette });
    // La parte già scritta non è passata dal giudizio dei collegamenti: riaperta, i suoi chiedono l'OK (#1505).
    const dopo = await appendToChatArchive(chatId, {
      role: 'filo', text: giaScritta, actions: successe, esiti: renderedActions, classeLetta, senzaVerdetto: true, ...(cambi.length ? { cambi } : {}),
      ...(citate.fonti.length ? { fonti: citate.fonti } : {}),
      ...(citate.immagini.length ? { immagini: citate.immagini } : {}),
    }, { onboarding: onbActive });
    const ultimo = dopo && Array.isArray(dopo.messages) ? dopo.messages[dopo.messages.length - 1] : null;
    if (ultimo && ultimo.role === 'filo') ContestoFilo.ricordaEsiti(chatId, ultimo.ts, { azioni: successe });
  };
  let fermato = false;
  // Il turno com'è andato, da rimandare uguale ai turni dopo (contestoFilo.ricordaGiro): l'ultimo giro che chiude da sé
  // non entra fra i messaggi, e il formato vecchio non è un giro di strumenti.
  let giroChiusura = null;
  let giroReplicabile = true;
  // La risposta si è fermata al tetto di lunghezza (#1097.3): lo si dice, e «Continua» la riprende.
  let interrotta = false;
  // Il tetto ha tagliato i dati di un'azione: la risposta lo dice con la sua frase, che il modello rilegge (#1302).
  let azioneTagliata = false;
  // Il primo giro che risponde porta nella cronologia anche l'attesa prima del modello: chi aspetta la vive (#1097.1).
  let tempiPrima = { preparazioneMs: Date.now() - inizioTurno, ...(attesePrimaDelModello || {}) };
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (turno.fermato) { fermato = true; break; }
      if (turno.seguiti.length) await leggiSeguiti();
      await compattaSeServe(round);
      if (pagineLette.length) await pagineNellaFinestra();
      // La scheda scrive la riga del ripiego sotto la risposta: niente avviso in più (#662).
      const giro = () => handleAIRequest({
        action: ACTIONS.FILO_CHAT,
        payload: { ...payloadBase, threadMessages },
        origin: 'filo:chat', conSeguito: true,
        onReasoning, onText, onToolCall, tools, signal: turno.ctrl.signal, tempiPrima,
      });
      const KW = global.SN_WALLET_MAIN;
      try {
        r = await (KW && KW.conRipiegoDetto ? KW.conRipiegoDetto(giro) : giro());
      } catch (e) {
        if (turno.fermato) { fermato = true; break; }
        if (await senzaFotoDopoRifiuto(e)) { conto.recupero('senza_foto'); round--; continue; }
        if (await stringiDopoRifiuto(e)) {
          contaSe('adattamento', ACTIONS.FILO_CHAT, (e && e.model) || modelloPrimo, 'contesto_stretto');
          conto.recupero('contesto_stretto');
          round--;
          continue;
        }
        // #1596 — più niente da accorciare: la frase dice cosa può fare l'utente, non «cambia modello».
        if (e && e.code !== 'TETTO_RISPOSTA' && globalThis.SN_FILO_CONTESTO.troppoLungo(e)) {
          try { e.code = 'CONTESTO_PIENO'; } catch (_) {}
        }
        throw e;
      }
      conto.giro();
      tempiPrima = null;
      if (finestraDaRicordare != null) { finestreDeiModelli.set(modelloChat, finestraDaRicordare); finestraDaRicordare = null; }
      if (r && r.keyFallback) keyFallback = r.keyFallback;
      costEur += Number(r.costEur) || 0;
      let text = String(r.text || '');
      // Un id a ogni chiamata anche se il fornitore non lo manda: la risposta allo strumento deve
      // citare LO STESSO id, e la scheda ci riconosce l'azione già raccontata in diretta.
      const toolCalls = (Array.isArray(r.toolCalls) ? r.toolCalls : [])
        .map((c, i) => ({ ...c, id: String(c.id || '') || `call_${round}_${i}` }));
      let actions = Tools ? Tools.toolCallsToActions(toolCalls) : [];
      // Il tetto ha tagliato gli argomenti di un'azione: il modello lo sa, e il turno si ferma con «Continua» invece di
      // rifare la stessa azione troppo lunga a ogni giro.
      const tagliataInAzione = globalThis.SN_CHAT_ERRORS.troncata(r.finishReason) && actions.some((a) => a._argsError);
      if (tagliataInAzione) for (const a of actions) if (a._argsError) a._argsError = ARGOMENTI_TAGLIATI;
      // Tolleranza per il formato vecchio (JSON nel testo): le azioni passano
      // comunque dal registro invece di finire in chat come JSON grezzo.
      const legacy = (!actions.length && Tools) ? Tools.legacyEnvelope(text) : null;
      if (legacy) {
        conto.recupero('formato_vecchio');
        text = legacy.text;
        // Un id anche a queste: la scheda le riconosce a fine turno senza ripetere la riga.
        actions = legacy.actions.map((a, i) => ({
          ...a, type: String(a.type || '').toUpperCase(), _callId: a._callId || `json_${round}_${i}`,
        }));
      }
      // I conti li fa Filo: il marker diventa il numero QUI, prima di archivio,
      // cronologia del modello e voce, che altrimenti leggerebbero «[[calc: …]]».
      if (Calc) text = Calc.resolveCalcMarkers(text);
      if (!actions.length) {
        // Muto, e l'ultima frase scritta precede un «non disponibile»: la risposta la riscrive il
        // modello sapendolo, una volta, perché quella frase poteva rispondere anche ad altro (#771).
        if (!text.trim() && !sollecitato && round < MAX_ROUNDS && noteAlRifiuto >= 0 && notes.length <= noteAlRifiuto) {
          sollecitato = true;
          conto.recupero('sollecito');
          threadMessages.push({ role: 'user', content: SOLLECITO_DOPO_RIFIUTO });
          continue;
        }
        textReply = text;
        reasoningDetails = r.reasoningDetails || [];
        exhausted = false;
        interrotta = globalThis.SN_CHAT_ERRORS.troncata(r.finishReason) ? r.finishReason : false;
        break;
      }
      if (turno.fermato) { fermato = true; break; }
      passi += 1;
      conto.azioni(actions.length);
      const roundRendered = [];
      const results = [];
      // Aperture di pagina e letture di fila partono insieme; il resto in ordine (regole in giroAzioni.js).
      const avvia = (a, { contesto, fonti }) => (a._argsError
        ? Promise.resolve({ executed: false, kept: false, rejected: true, error: a._argsError })
        : executeFiloAction(a, {
          sender, contesto, provenienza, parole: paroleUtente, domanda: domandaDiAdesso, chatId, fontiLette: fonti, richiesta, accoglienza, intervista: onbActive, nascostiDellaChat, capRilettura, schedeViste,
          // Le azioni lunghe dicono a che punto sono: la riga d'attesa le conta.
          avanzamento: canPush ? (fatti, totali, dettaglio) => push('filo:action', {
            kind: 'progress', type: String(a.type || '').toUpperCase(), callId: a._callId || '', fatti, totali,
            ...(dettaglio ? { dettaglio: String(dettaglio) } : {}),
          }) : null,
          segnale: turno.ctrl.signal,
        }));
      const dopo = async (a, res) => {
        rawActions.push(a);
        conto.strumento(a.type, globalThis.SN_CONTATORI.esitoStrumento({ argomenti: a._argsError, tagliati: a._argsError === ARGOMENTI_TAGLIATI }, res));
        // Fermata (#810): l'archivio la salva come tale.
        if (res.output && res.output.blocked === 'segreto') a._output = res.output;
        // Contengono la home con il nome utente: servono solo al gate, non alla chat.
        delete a._perimetro;
        delete a._cartella;
        const rendered = { ...a };
        delete rendered._argsError;
        // Azione sospesa in attesa di conferma (#146.2): il client renderizza il
        // bottone che apre il popup/box e poi manda MSG.FILO_CONFIRM_ACTION.
        if (res.needsConfirm) rendered._confirm = { level: res.needsConfirm, text: res.describe || '', parti: res.parti, ...(res.avviso ? { avviso: res.avviso } : {}) };
        if (res.domanda) rendered._domanda = res.domanda;
        if (res.domanda && res.perche) rendered._perche = res.perche;
        // Output di un comando eseguito subito (livello 1) o esito bloccato
        // (terminale spento): il client lo mostra in chat (#146.6).
        if (res.output) rendered._output = res.output;
        // I cambi di stato che l'azione ha lasciato: il segno sulla bolla dell'utente (#867).
        if (Array.isArray(res.cambi) && res.cambi.length) rendered._cambi = res.cambi;
        // L'esito viaggia con l'azione: il diario del lavoro deve poter dire
        // «fatto» o «non riuscito», non solo «l'ha chiamata».
        rendered._executed = !!res.executed;
        // `kept: false` = niente da cliccare in chat, ma nel diario ci va: se Filo fa una cosa
        // l'utente deve vederlo. Un'azione rifiutata dal registro invece non è successa.
        if (!res.rejected) {
          if (!res.kept) rendered._traccia = true;
          renderedActions.push(rendered);
          roundRendered.push(rendered);
        }
        // Un indirizzo rifiutato prima di partire torna al modello, che lo cerca: nel diario non c'è niente da dire (#553).
        if (!res.nonCompare && !res.senzaModulo) push('filo:action', { kind: 'done', action: rendered, kept: !res.rejected, executed: !!res.executed });
        PageRead.annotaAzione(provenienza, rendered);
        const tipoUscita = String(a.type || '').toUpperCase();
        if (tipoUscita === 'NAVIGA' || tipoUscita === 'LEGGI_PAGINA' || tipoUscita === 'TRASCRIVI_MEDIA') {
          const dove = globalThis.SN_ACTION_LEVELS.indirizzoDi(a);
          if (res.nonCompare) lasciati.set(dove, a);
          else if (res.executed) lasciati.clear();
          else if (res.needsConfirm) lasciati.delete(dove);
        }
        results.push({ action: a, res, rendered });
        azioniViste.push(rendered);
        ricordaLettoInChat([rendered]);
        await segnaFonteLetta(chatId, fontiLette, rendered);
      };
      const partite = await GiroAzioni.eseguiGiro(actions, {
        contesto: azioniViste, fonti: fontiLette, avvia, dopo, fermo: () => turno.fermato,
        apertura: (a) => !!a && !a._argsError && String(a.type || '').toUpperCase() === 'NAVIGA',
        lettura: (a) => !!a && !a._argsError && globalThis.SN_ACTION_LEVELS.diSolaLettura(a.type),
      });
      if (partite.fermato) { fermato = true; break; }
      // Un comando secco riuscito o fermo sulla conferma parla da sé (#1130): niente secondo giro. Solo al primo giro con
      // azioni: dopo una lettura il modello ha ancora da dire cosa ha trovato. L'intervista finisce ogni turno con una battuta.
      // Un seguito già scritto (#1296) va letto al passo dopo, insieme all'esito: il turno resta uno. Anche quello letto
      // prima della prima chiamata (un turno lento a partire, #2173): il comando secco non gli risponde.
      const chiude = passi === 1 && !onbActive && !turno.seguiti.length && !seguitiLetti.length
        && GiroAzioni.chiudeIlTurno(results, {
          testo: text, messaggio: internal ? '' : userMessage, daLeggere: (x) => !!observationsForPrompt([x.rendered]),
        });
      // Il testo scritto in un giro con azioni è una nota di lavoro («cerco il
      // meteo…»), non la risposta: la scheda lo sposta nel blocco di attività.
      // Quello di un giro di soli bottoni, o dell'ultimo, invece resta nella bolla.
      const diRisposta = !!text.trim() && (chiude || giroDiSoliBottoni(results));
      const fraLeNote = !!text.trim() && !diRisposta;
      if (diRisposta) {
        risposta.push(text.trim());
        noteAllaRisposta = notes.length;
        // Scritto dopo aver letto ogni esito: un «non disponibile» precedente non lo smentisce più.
        noteAlRifiuto = -1;
      } else if (text.trim()) notes.push(text.trim());
      if (roundRendered.some(esitoNonDisponibile)) noteAlRifiuto = notes.length;
      push('filo:action', { kind: 'round', text, ...(diRisposta ? { risposta: true } : {}) });
      textReply = diRisposta ? '' : text;
      reasoningDetails = r.reasoningDetails || [];
      if (legacy) giroReplicabile = false;
      if (chiude) {
        giroChiusura = [
          Tools.assistantMessage({ text, toolCalls, reasoningDetails: r.reasoningDetails }),
          ...results.map((x) => Tools.toolMessage(x.action._callId, toolResultText(x, { risposta: diRisposta }))),
        ];
        exhausted = false;
        interrotta = globalThis.SN_CHAT_ERRORS.troncata(r.finishReason) ? r.finishReason : false;
        break;
      }
      if (legacy) {
        // Formato vecchio: si prosegue solo se un esito deve tornare e niente attende conferma.
        const obs = observationsForPrompt(roundRendered);
        if (!obs || roundRendered.some((x) => x._confirm)) { exhausted = false; break; }
        threadMessages.push({ role: 'assistant', content: r.text });
        threadMessages.push({ role: 'user', content: `${obs}\n\n${LEGACY_CONTINUE_NUDGE}${fraLeNote ? `\n\n${RISPOSTA_FRA_LE_NOTE}` : ''}` });
        continue;
      }
      threadMessages.push(Tools.assistantMessage({ text, toolCalls, reasoningDetails: r.reasoningDetails }));
      results.forEach((x, i) => {
        const giro = { risposta: diRisposta };
        const coda = fraLeNote && i === results.length - 1 ? ` ${RISPOSTA_FRA_LE_NOTE}` : '';
        threadMessages.push(Tools.toolMessage(x.action._callId, `${toolResultText(x, giro)}${coda}`));
        const o = x.res && x.res.output;
        if (o && o.chatRead && o.found && typeof o.transcript === 'string') riletture.push({ x, i: threadMessages.length - 1, giro, coda });
        if (o && 'pageRead' in o && o.ok && o.testo && String(x.action.type || '').toUpperCase() === 'LEGGI_PAGINA') {
          pagineLette.push({ x, i: threadMessages.length - 1, giro, coda, round, ordine: i });
        }
      });
      if (tagliataInAzione) { exhausted = false; interrotta = r.finishReason; azioneTagliata = true; break; }
    }
  } catch (e) {
    // Turno fallito: la prenotazione della ripresa si rilascia subito, o nessuna scheda potrà
    // riprendere il turno rimasto a metà finché non scade.
    if (onbActive && !internal) releaseOnboardingResume();
    // Le azioni eseguite prima del guasto sono SUCCESSE davvero: viaggiano con l'errore, così
    // un «Riprova» riparte sapendo cosa era già stato fatto invece di rifarlo.
    try { e.filoActions = renderedActions; } catch (_) {}
    // La risposta scritta coi bottoni era già arrivata: un giro dopo che fallisce non la toglie dalla chat (#1167).
    if (unisciTesti(risposta)) {
      try { await archiviaGiaFatto(); } catch (err) { console.warn('[Filo] archivio della risposta prima del guasto:', err?.message || err); }
    }
    throw e;
  } finally {
    turno.chiuso = !fermato;
    togliTurno(reasoningReqId, turno);
  }
  const azioniNelGiro = renderedActions.length;
  if (!fermato && lasciati.size) {
    for (const a of lasciati.values()) {
      let res = null;
      try {
        res = await executeFiloAction(a, {
          sender, contesto: azioniViste, provenienza, parole: paroleUtente, domanda: domandaDiAdesso, chatId, fontiLette, richiesta, soloConferma: true,
        });
      } catch (_) { res = null; }
      if (!res || !res.needsConfirm) continue;
      const rendered = { ...a };
      delete rendered._argsError;
      rendered._confirm = { level: res.needsConfirm, text: res.describe || '', parti: res.parti, ...(res.avviso ? { avviso: res.avviso } : {}) };
      if (res.domanda) rendered._domanda = res.domanda;
      rendered._executed = false;
      renderedActions.push(rendered);
      push('filo:action', { kind: 'done', action: rendered, kept: true, executed: false });
    }
  }
  if (fermato) {
    // Già scritto al clic (segnaStopAccoglienza); riscritto qui per uno stop che il turno ha visto da sé.
    if (onbActive) await saveOnboarding(Onboarding.segnaFermato(await FiloMem.getOnboarding()));
    if (onbActive && !internal) releaseOnboardingResume();
    await archiviaGiaFatto();
    volo.esito = 'fermato';
    return {
      text: '', actions: renderedActions, stopped: true, notes, reasoningDetails: [], costEur,
      model: r && r.model, provider: r && r.provider, seguitiLetti,
    };
  }
  // #162 — quando Filo vuole solo ESEGUIRE qualcosa (es. aprire un link) non
  // deve scrivere testo di riempimento: il "(vuoto)" che compariva era un
  // placeholder confuso ("hai scritto tu vuoto o è stato prodotto da filo?").
  // Il fallback "(vuoto)" resta SOLO per la risposta davvero vuota (niente
  // testo E niente azioni), che sarebbe altrimenti una bolla muta.
  // La nota che diventa risposta: la scheda la toglie dal blocco, dove l'aveva già messa.
  let notaRisposta = '';
  // La scheda mette «Continua» sotto la frase: si riprende da qui, senza riscrivere la domanda.
  let senzaRisposta = null;
  // Muto dopo sole letture: una frase di lavoro che diventa la bolla («cerco ancora…») non è una risposta (#557).
  const mutoDopoLetture = !exhausted && !interrotta && !String(textReply || '').trim() && rawActions.length > 0 && soloLetture(renderedActions);
  let nonDisponibile = false;
  if (exhausted) {
    senzaRisposta = { passi, motivo: 'tetto_giri' };
    textReply = unisciTesti([...risposta, textReply, fraseSenzaRisposta(passi)]);
  } else if (!String(textReply || '').trim() && noteAlRifiuto >= 0 && notes.length <= noteAlRifiuto) {
    nonDisponibile = true;
    // Muto anche sollecitato: prima cosa non si può, poi la frase com'era, dichiarata scritta
    // prima di saperlo. Toglierla perdeva le risposte ad altro che conteneva (#771).
    const prima = notes.length > noteAllaRisposta ? notes.pop() : '';
    if (prima) notaRisposta = prima;
    textReply = unisciTesti([...risposta, prima
      ? `${RISPOSTA_PROXY_NON_DISPONIBILE}\n\nPrima di saperlo avevo scritto: «${prima}»`
      : RISPOSTA_PROXY_NON_DISPONIBILE]);
  } else if (!String(textReply || '').trim() && notes.length > noteAllaRisposta) {
    // Ultimo giro muto dopo un giro con azioni: la frase scritta insieme alle
    // azioni («Ti metto la sveglia alle 7, buonanotte!») era la risposta, non
    // una nota di lavoro. Lasciarla nel blocco chiuso voleva dire un turno
    // senza nessuna bolla. Torna alla scheda come testo, e non più come nota.
    notaRisposta = notes.pop();
    textReply = unisciTesti([...risposta, notaRisposta]);
  } else {
    // L'avviso chiede al modello di riscrivere la risposta finita fra le note, ma non lo garantisce (#1921.1).
    const sepolta = interrotta ? '' : GiroAzioni.rispostaFraLeNote(notes.slice(noteAllaRisposta), textReply);
    if (sepolta) {
      notaRisposta = sepolta;
      notes.splice(notes.lastIndexOf(sepolta), 1);
    }
    textReply = unisciTesti([...risposta, sepolta, textReply]);
  }
  if (mutoDopoLetture) {
    senzaRisposta = { passi, motivo: 'muto_dopo_letture' };
    textReply = unisciTesti([textReply, fraseSenzaRisposta(passi)]);
  }
  // Il seguito di una risposta fermata dentro un blocco di codice lo riapre, o si leggerebbe come testo (#1302).
  if (internal && String(userMessage || '') === globalThis.SN_CHAT_ERRORS.CHIEDI_SEGUITO_HOME && textReply) {
    const prima = (Array.isArray(threadHistory) ? threadHistory : []).filter((m) => m && m.role !== 'user').pop();
    if (prima) textReply = globalThis.SN_CHAT_ERRORS.seguitoNelRecinto(String(prima.text || ''), textReply);
  }
  if (interrotta && !senzaRisposta) {
    senzaRisposta = { passi, interrotta: true, motivo: 'tagliato' };
    const CE = globalThis.SN_CHAT_ERRORS;
    textReply = unisciTesti([CE.chiudiRecinto(textReply), azioneTagliata ? CE.FRASE_AZIONE_TAGLIATA : CE.rispostaInterrotta(interrotta)]);
  }
  // #1596 — le pagine lette e rimaste fuori dalla finestra: lo sa l'utente, e lo sa il modello ai turni dopo.
  textReply = unisciTesti([textReply, globalThis.SN_FILO_CONTESTO.frasePagineLasciate(pagineLasciate())]);
  // #1373 — dopo l'OK il modello riprende sempre: a lavoro finito non ha niente da aggiungere, e il silenzio è la risposta.
  const mutoDopoOk = dopoOk && !String(textReply || '').trim() && !rawActions.length;
  // #2383 — i marcatori di fonte si controllano qui, prima che la risposta si salvi o si mostri: resta l'etichetta solo
  // per un indirizzo letto in questo turno, con la frase cercata nella pagina intera.
  // #2272 — lo stesso per le immagini: restano solo quelle trovate o create in questo turno, al posto del marcatore.
  const Immagini = globalThis.SN_IMMAGINI_RISPOSTA;
  const Fonti = { nascondi: (t) => Immagini.nascondi(globalThis.SN_FONTI_CITATE.nascondi(t)) };
  const citate = Immagini.controllaConFonti(textReply, renderedActions);
  const fonti = citate.fonti;
  const immagini = citate.immagini;
  textReply = citate.text || (rawActions.length || mutoDopoOk ? '' : '(vuoto)');
  if (notaRisposta) notaRisposta = Fonti.nascondi(notaRisposta).trim();
  // L'esito che la persona ha davanti (#1463): lo stesso «Continua» che la scheda mette sotto, o la frase che lo sostituisce.
  const esitoTurno = senzaRisposta ? senzaRisposta.motivo : nonDisponibile ? 'non_disponibile' : textReply === '(vuoto)' ? 'vuoto' : 'risposta';
  // #360 — Filo ha ammesso una mancanza e non ha proposto niente: la proposta di
  // segnalazione entra tra le azioni di QUESTO turno, così l'utente la trova già
  // scritta nella stessa bolla invece di doverla chiedere.
  let proposal = internal
    ? null // turno di prosecuzione automatica: il "messaggio utente" è un nudge nostro
    : maybeProposeFeedbackAction({ textReply, rawActions, userMessage, threadHistory: cleanHistory });
  if (proposal && proposal._unaVolta) {
    let versione = '';
    try { versione = require('electron').app.getVersion(); } catch (_) {}
    if (!(await require('./autoFeedbackInviati').prenota(versione, proposal._unaVolta))) proposal = null;
  }
  if (proposal) {
    // La proposta è un'uscita come le altre: passa dalla porta con quello che la chat ha letto (#810).
    // Se la risposta citata porta un segreto letto da fuori, la proposta parte senza citarla.
    // La segnalazione la propone Filo, non l'ha chiesta l'utente: è fuori dal perimetro del compito (#530).
    const conContesto = { sender, contesto: azioniViste, parole: paroleUtente, fontiLette, richiesta, dentroPerimetro: false, chiesta: false, nelFilo: 'segnalazione' };
    let res = await executeFiloAction(proposal, conContesto);
    if (res.output && res.output.blocked === 'segreto') {
      proposal = maybeProposeFeedbackAction({ textReply, rawActions, userMessage, threadHistory: cleanHistory, citaRisposta: false });
      res = proposal ? await executeFiloAction(proposal, conContesto) : { kept: false };
      if (res.output && res.output.blocked === 'segreto') { proposal = null; res = { kept: false }; }
    }
    if (res.kept) {
      const rendered = res.needsConfirm
        ? { ...proposal, _confirm: { level: res.needsConfirm, text: res.describe || '', parti: res.parti, ...(res.avviso ? { avviso: res.avviso } : {}) } }
        : { ...proposal };
      if (res.output) rendered._output = res.output;
      renderedActions.push(rendered);
      conto.recupero('proposta_segnalazione');
      ContatoriServizio.misura('proposta', 'mostrata');
    }
  }
  // #947 — il documento che la risposta nomina ha il suo bottone anche se il modello non l'ha mostrato con APRI_FILE:
  // «eccolo» senza niente da cliccare è una promessa che dipende dal modello.
  for (const a of fileNominatiDallaRisposta(textReply, renderedActions)) {
    const res = await executeFiloAction(a, { sender, contesto: azioniViste, parole: paroleUtente, fontiLette, richiesta });
    if (res && res.kept && res.executed && !res.needsConfirm) {
      renderedActions.push({ ...a, _executed: true, ...(res.output ? { _output: res.output } : {}) });
      conto.recupero('file_aggiunto');
    }
  }
  segnaSalvateNominate(textReply, renderedActions);
  // I segreti letti da fuori che la risposta ripete, con la loro fonte: restano con la frase (#810).
  let lettiRisposta = [];
  try { lettiRisposta = globalThis.SN_URL_EXFIL.lettiNelTesto(textReply, SegretiLetti.tutti()); } catch (_) {}
  // I collegamenti della risposta che il modello non avrebbe potuto aprire senza un OK lo chiedono anche al clic (#868.6).
  let linkDaConfermare = [];
  // Senza giudizio i collegamenti della frase restano senza verdetto anche riaperta: al clic chiedono l'OK (#1505).
  let senzaVerdetto = false;
  try {
    linkDaConfermare = await linkCheChiedonoOk(textReply, {
      sender, contesto: azioniViste, provenienza, fontiLette, parole: paroleUtente, domanda: domandaDiAdesso, richiesta,
      indirizzi: [...renderedActions.flatMap((a) => (a ? [a.url, a.percorso, a.path, a.link, a.href] : [])), ...fonti.map((f) => f.url)],
    });
  } catch (e) {
    senzaVerdetto = true;
    console.warn('[Filo] collegamenti della risposta non controllati', e?.message || e);
  }
  // #525 — la risposta di Filo raggiunge l'archivio insieme al messaggio che
  // l'ha provocata. `onbActive` marca la chat dell'intervista di benvenuto:
  // quella è SEMPRE una conversazione, qualunque cosa dica il classificatore.
  // Una ripresa dopo l'OK chiusa muta non lascia niente nella conversazione (#1373).
  if (chatId && !mutoDopoOk) {
    // `actions`: ciò che è successo, più le azioni fermate (#810). `esiti`: com'è andata ognuna, anche la fallita e quella
    // ferma sulla conferma (#1294, #1130.2). Una conferma data dopo la aggiunge la scheda (FILO_CHAT_NOTE).
    const successe = renderedActions.filter(globalThis.SN_ESITO.successa);
    const cambi = renderedActions.flatMap((x) => (x && Array.isArray(x._cambi) ? x._cambi.map((c) => c.id) : []));
    const classeLetta = await classeLettaDelCompito(sender, { contesto: azioniViste, fontiLette });
    const dopo = await appendToChatArchive(
      chatId,
      {
        role: 'filo', text: textReply, actions: successe, esiti: renderedActions, classeLetta,
        ...(lettiRisposta.length ? { letti: lettiRisposta } : {}),
        ...(linkDaConfermare.length ? { linkDaConfermare } : {}),
        ...(senzaVerdetto ? { senzaVerdetto } : {}),
        ...(cambi.length ? { cambi } : {}),
        ...(fonti.length ? { fonti } : {}),
        ...(immagini.length ? { immagini } : {}),
      },
      { onboarding: onbActive },
    );
    // Gli esiti di questo turno restano davanti al modello anche dalle altre schede, finché il messaggio è recente.
    const risposta = dopo && Array.isArray(dopo.messages) ? dopo.messages[dopo.messages.length - 1] : null;
    if (risposta && risposta.role === 'filo') ContestoFilo.ricordaEsiti(chatId, risposta.ts, { azioni: renderedActions, reasoningDetails });
    // I turni passati non si riscrivono (SPEC-CONTESTO § La richiesta): il giro torna com'era, e con lui il ragionamento.
    if (risposta && risposta.role === 'filo' && !internal && giroReplicabile && filo && filo.haDomanda) {
      const dopoIlGiro = observationsForPrompt(renderedActions.slice(azioniNelGiro));
      ContestoFilo.ricordaGiro(chatId, risposta.ts, {
        messaggi: [...threadMessages.slice(indiceDomanda + 1), ...(giroChiusura || [])],
        testo: dopoIlGiro ? `${textReply}\n\n${dopoIlGiro}` : textReply,
        reasoningDetails: giroChiusura ? [] : reasoningDetails,
        azioni: renderedActions,
        seguiti: seguitiNelFilo,
      });
    }
    if (!internal && filo) {
      compattaDaFermo(incognitoTurno, tettiChat);
      // L'anticipo si misura col turno appena finito dentro il tratto: la stessa regola della soglia e del taglio.
      if (tettiChat) {
        const stima = ultimaStima;
        Compattazione.limiti(incognitoTurno, { tetti: tettiChat })
          .then((l) => (stima > l.anticipo ? Compattazione.compatta({ incognito: incognitoTurno, motivo: 'anticipo', tetti: tettiChat }) : null))
          .catch((e) => console.warn('[Filo] compattazione in anticipo:', e?.message || e));
      }
    }
    const eidRisposta = risposta && risposta.role === 'filo' && dopo.eids ? dopo.eids[dopo.eids.length - 1] : '';
    if (eidRisposta) fontiTurno.push(eidRisposta);
    // La chat può essere finita mentre Filo stava ancora rispondendo: l'utente
    // ha chiesto qualcosa ed è tornato alla home (o ha chiuso la scheda) prima
    // di leggere. La risposta si salva lo stesso, ma poi la chat va RICHIUSA,
    // altrimenti resta «in corso» col titolo di mezza conversazione e Filo non
    // la ritrova più quando gli si chiede di riprenderla.
    if (dopo && dopo.closedAt) {
      closeAndTriageChat(chatId, { via: 'risposta_tardiva' })
        .then(() => { try { broadcastToTabs({ type: MSG.FILO_CHATS_UPDATED }); } catch (_) {} })
        .catch((e) => console.warn('[Filo] richiusura chat dopo la risposta:', e?.message || e));
    }
  }
  // #524 — chiusura dell'intervista di benvenuto: la sequenza sta in
  // `finishOnboarding`. Se invece l'intervista prosegue, il turno di Filo viene
  // messo da parte per la ripresa.
  let onboardingClosed = false;
  let intervistaLetta = false;
  if (onbActive) {
    let after = await FiloMem.getOnboarding();
    intervistaLetta = Onboarding.haTestoDiAltri(after);
    if (textReply && textReply !== '(vuoto)') {
      after = Onboarding.appendTurn(after, {
        role: 'filo', text: textReply,
        ...(testoDiAltriNelleAzioni(renderedActions) ? { daFuori: true } : {}),
        ...(renderedActions.some((x) => x && x._output && x._output.sceltaAutonomia) ? { autonomia: true } : {}),
        ...(renderedActions.some((x) => x && x._output && x._output.sceltaContatori) ? { contatori: true } : {}),
        ...(renderedActions.some((x) => x && x._output && x._output.sceltaPrivacy) ? { privacy: true } : {}),
      });
    }
    const tetto = !after.done && Onboarding.shouldForceClose(after);
    if (tetto) after = Onboarding.close(after);
    await saveOnboarding(after, { via: tetto ? 'tetto' : '' });
    await contaScelteIntervista();
    onboardingClosed = !!after.done;
    if (!internal) releaseOnboardingResume();
  }
  // Il creatore di lezioni vede lo scambio e non il filo: gli ultimi messaggi gli arrivano con lo stato (#868).
  let statoLezioni = stateText;
  try {
    if (filo) statoLezioni = `${stateText}\n\n${FiloState.testoConversazioni(FiloState.conversazioniRecenti(filo.tutti))}`;
  } catch (_) {}
  if (onboardingClosed) {
    // Le lezioni di fine intervista passano dalla stessa regola di quelle di ogni turno (#1312.2).
    const lessons = !intervistaLetta && await lezioniAutomaticheConsentite({ sender, contesto: azioniViste, fontiLette });
    finishOnboarding({ userMessage, filoReply: textReply, stateText: statoLezioni, fonti: fontiTurno, lessons });
  } else if (!mutoDopoOk) {
    // I seguiti letti sono parte della domanda a cui la risposta risponde.
    const domandaIntera = [String(userMessage || ''), ...testiDeiSeguiti].filter(Boolean).join('\n');
    lezioniAutomaticheConsentite({ sender, contesto: azioniViste, fontiLette })
      .then((ok) => (ok ? maybeRunLessonAgent({ userMessage: domandaIntera, filoReply: textReply, stateText: statoLezioni, fonti: fontiTurno }) : null))
      .catch(() => {});
  }
  // F4 — Feedback autonomo: fire-and-forget, non blocca la risposta all'utente.
  // Se in questo turno abbiamo già proposto la segnalazione all'utente (#360),
  // quella anonima non parte: una sola segnalazione per lo stesso buco. Nemmeno dopo
  // un'azione fermata perché portava fuori un segreto (#810): il «non ho potuto» è voluto.
  const fermata = renderedActions.some((x) => x && x._output && x._output.blocked === 'segreto');
  if (!fermata) maybeAutoFeedback({ textReply, rawActions, userMessage, sender, proposed: !!proposal, chatId }).catch(() => {});
  volo.esito = esitoTurno;
  return {
    text: textReply, actions: renderedActions, model: r.model, provider: r.provider, costEur,
    // Note di lavoro e ragionamento strutturato dell'ultimo giro: la scheda li tiene con la
    // conversazione, e il ragionamento torna al modello al turno dopo.
    notes: notes.map((n) => Fonti.nascondi(n).trim()).filter(Boolean), reasoningDetails,
    ...(notaRisposta ? { notaRisposta } : {}),
    ...(fonti.length ? { fonti } : {}),
    ...(immagini.length ? { immagini } : {}),
    ...(senzaRisposta ? { senzaRisposta } : {}),
    ...(lettiRisposta.length ? { letti: lettiRisposta } : {}),
    ...(linkDaConfermare.length ? { linkDaConfermare } : {}),
    ...(keyFallback ? { keyFallback } : {}),
    // Il client lo usa per dire subito che sta preparando la home invece di
    // lasciare la chat muta finché non arriva FILO_ONBOARDING_DONE.
    ...(onboardingClosed ? { onboardingClosed: true } : {}),
    seguitiLetti,
  };
}

module.exports = {
  claimOnboardingResume,
  releaseOnboardingResume,
  fermaFiloChat,
  seguitoFiloChat,
  finestreDeiModelli,
  handleFiloChat,
};
