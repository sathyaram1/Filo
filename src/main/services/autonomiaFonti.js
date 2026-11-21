// Autonomia e fonti: chi ha chiesto un'azione, cosa ha letto la chat, la decisione su conferma o no, executeFiloAction.
// Libreria nata da handlers.js: le regole stanno in tests/unit/autonomia.test.mjs.

const Registro = require('./registroCambi');
const ContestoFilo = require('./contestoFilo');
const Compattazione = require('./compattazioneFilo');
const Storage = globalThis.SN_STORAGE;
const FiloChats = globalThis.SN_FILO_CHATS;       // #525 — archivio delle chat con Filo
const { contaSe, winOf } = require('./handlersComuni');
const {
  cartellaDelComando, displayCwd, pendingConfirmKey, perimetroLettura, segretiCustoditi,
} = require('./porteUscita');
// Questi vivono in moduli che caricano questo: si chiedono al momento della chiamata, non al caricamento.
const eseguiAzioneFilo = (...a) => require('./handlers').eseguiAzioneFilo(...a);

// Le fonti che il compito ha letto: la pagina su cui vive l'assistente e ciò che hanno portato le azioni
// già fatte, turni passati compresi. Le dichiara il registro, mai il modello (#530).
function fontiDelCompito(sender, contesto, fontiLette = null, assistente = false) {
  const fonti = Array.isArray(fontiLette) ? fontiLette.filter(Boolean) : [];
  if (assistente) fonti.push(...fontiDellAiuto(sender));
  const origine = String(sender?.tab?.url || sender?.url || '');
  if (daPaginaNonDiFilo(sender)) {
    let host = '';
    try { host = new URL(origine).hostname; } catch (_) {}
    fonti.push({ classe: 5, campo: 'web', chiave: `sito:${host}`, motivo: 'ho letto una pagina web' });
  }
  const Levels = globalThis.SN_ACTION_LEVELS;
  for (const a of Array.isArray(contesto) ? contesto : []) {
    const f = Levels && Levels.fonteDi(a);
    if (f) fonti.push(f);
  }
  return fonti;
}

// #953 — la segnalazione che Filo scrive e l'owner conferma è sua (fidata, senza giudici) solo se il compito non ha
// letto testo di altri: lo stato dei livelli di autonomia, mai più largo della classe 2; dall'Aiuto di un sito mai.
function compitoSenzaTestoDiAltri(sender, { contesto = null, fontiLette = null, assistente = false, impostazioni = null } = {}) {
  try {
    if (daPaginaNonDiFilo(sender)) return false;
    const A = globalThis.SN_AUTONOMIA;
    const aut = (impostazioni && impostazioni.autonomia) || {};
    const attivo = A.livelloAttivo(aut.livello);
    const livello = A.SOGLIA_PULITO[attivo] <= A.SOGLIA_PULITO.default ? attivo : 'default';
    const fonti = fontiDelCompito(sender, contesto, fontiLette, assistente);
    return A.stato({ fonti, livello, spostamenti: aut.fonti, manopole: aut.manopole }).stato === 'pulito';
  } catch (_) { return false; }
}
// L'OK arriva senza il contesto del turno: vale il segno preso quando la proposta è stata mostrata, legato al suo
// testo. Senza segno (scaduto, altra scheda, proposta mai vista) è contaminata.
const segnalazioniPulite = new Map(); // pendingConfirmKey → scade
const SEGNALAZIONE_PULITA_TTL = 24 * 60 * 60 * 1000;
function ricordaSegnalazione(sender, action, pulita) {
  const key = pendingConfirmKey(sender, action);
  segnalazioniPulite.delete(key);
  if (!pulita) return;
  const now = Date.now();
  for (const [k, scade] of segnalazioniPulite) if (scade <= now) segnalazioniPulite.delete(k);
  segnalazioniPulite.set(key, now + SEGNALAZIONE_PULITA_TTL);
}
function segnalazioneConfermataPulita(sender, action) {
  const key = pendingConfirmKey(sender, action);
  const scade = segnalazioniPulite.get(key);
  return !!scade && scade > Date.now();
}

// Ciò che una chat ha letto resta suo anche fuori dallo storico che la pagina rimanda a ogni turno (riaperta
// dall'archivio, oltre gli ultimi venti messaggi): lo tiene il main, per la sessione e nell'archivio (#530).
const fontiPerChat = new Map();   // chatId → fonti lette dalla chat
const fonteScaduta = (f, chatId) => Compattazione.fonteScaduta(f, ContestoFilo.diIncognito(chatId));
async function fontiDellaChat(chatId) {
  if (!chatId) return [];
  if (!fontiPerChat.has(chatId)) {
    let salvate = [];
    try { const c = FiloChats && await FiloChats.get(chatId); salvate = Array.isArray(c && c.fonti) ? c.fonti : []; } catch (_) {}
    try { await Compattazione.carica(); } catch (_) {}
    if (!fontiPerChat.has(chatId)) fontiPerChat.set(chatId, salvate.filter((f) => !fonteScaduta(f, chatId)));
  }
  return fontiPerChat.get(chatId);
}
// Il tratto si è chiuso: le fonti lette prima escono dalle copie in memoria, sul posto (chi le ha in mano vede lo stesso).
Compattazione.suCompattazione(({ incognito }) => {
  for (const [chatId, fonti] of fontiPerChat) {
    if (ContestoFilo.diIncognito(chatId) !== !!incognito) continue;
    for (let i = fonti.length - 1; i >= 0; i--) if (fonteScaduta(fonti[i], chatId)) fonti.splice(i, 1);
  }
});
async function segnaFonteLetta(chatId, fontiLette, action) {
  await segnaFonte(chatId, fontiLette, globalThis.SN_ACTION_LEVELS && globalThis.SN_ACTION_LEVELS.fonteDi(action));
}
async function segnaFonte(chatId, fontiLette, f) {
  if (!f || !Array.isArray(fontiLette)) return;
  const voce = { classe: f.classe, campo: f.campo || null, chiave: String(f.chiave || ''), motivo: String(f.motivo || ''), ts: new Date().toISOString() };
  if (fontiLette.some((x) => x && x.chiave === voce.chiave && x.classe === voce.classe)) return;
  fontiLette.push(voce);
  if (chatId && FiloChats && FiloChats.segnaFonti) {
    try { await FiloChats.segnaFonti(chatId, [voce]); } catch (e) { console.warn('[Filo] fonte della chat non archiviata:', e?.message || e); }
  }
}

// Ciò che l'Aiuto ha letto (#530) vale per la sua conversazione, come per la chat: il pannello che si apre ne
// comincia una nuova, e così una pagina nuova. Su una pagina di Filo l'indirizzo non sporca, la ricerca sì.
const fontiPerAiuto = new WeakMap();     // webContents → fonti lette dalla conversazione dell'Aiuto aperta lì
const aiutoAscoltato = new WeakSet();
function fontiDellAiuto(sender) {
  const wc = sender && sender.wc;
  return (wc && fontiPerAiuto.get(wc)) || [];
}
function nuovaConversazioneAiuto(sender) {
  const wc = sender && sender.wc;
  if (wc) { fontiPerAiuto.delete(wc); chatAiutoPer.delete(wc); lettureGettoniAiuto.delete(wc); }
}
function segnaLetturaAiuto(sender, action) {
  const wc = sender && sender.wc;
  segnaFonteAiuto(sender, wc && globalThis.SN_ACTION_LEVELS && globalThis.SN_ACTION_LEVELS.fonteDi(action));
}
// Un testo incollato o trascinato, o un'immagine, mandati nell'Aiuto: lettura come nella chat della home (#1840).
function segnaTestoNellAiuto(sender, { immagini = false } = {}) {
  segnaFonteAiuto(sender, immagini
    ? { classe: 5, campo: null, chiave: 'aiuto:immagine', motivo: 'ho guardato un\'immagine che hai incollato' }
    : { classe: 5, campo: null, chiave: 'aiuto:testo-di-altri', motivo: 'è entrato un testo che non hai scritto tu' });
}
// Una pagina di Filo che l'Aiuto legge vale lettura, salvo quelle che mostrano solo cose di Filo e tue: nomi di file,
// titoli e segnalazioni li scrivono altri, e una pagina nuova parte sporca finché non entra qui (#1840). Sicurezza no:
// mostra gli appunti copiati e i titoli delle pagine visitate.
const PAGINE_DI_FILO_SOLO_TUE = Object.freeze(['preferences', 'options', 'quaderno', 'editor', 'novita', 'credits', 'transparency', 'menu']);
function segnaPaginaDiFiloNellAiuto(sender) {
  const url = String(sender?.tab?.url || sender?.url || '');
  const m = /^filo:\/\/([^/?#]+)/i.exec(url);
  if (!m || PAGINE_DI_FILO_SOLO_TUE.includes(m[1].toLowerCase())) return;
  segnaFonteAiuto(sender, { classe: 5, campo: null, chiave: `aiuto:pagina-di-filo:${m[1].toLowerCase()}`, motivo: 'ho letto una pagina di Filo con nomi scritti da altri' });
}
function segnaFonteAiuto(sender, f) {
  const wc = sender && sender.wc;
  if (!wc || !f) return;
  if (!aiutoAscoltato.has(wc)) {
    aiutoAscoltato.add(wc);
    try { wc.on('did-navigate', () => fontiPerAiuto.delete(wc)); } catch (_) {}
  }
  const fonti = fontiPerAiuto.get(wc) || [];
  const voce = { classe: f.classe, campo: f.campo || null, chiave: String(f.chiave || ''), motivo: String(f.motivo || '') };
  if (!fonti.some((x) => x.chiave === voce.chiave && x.classe === voce.classe)) fonti.push(voce);
  fontiPerAiuto.set(wc, fonti);
}

// La classe peggiore che il compito ha letto quando Filo risponde: la risposta la porta nell'archivio, e chi la rilegge
// da un'altra conversazione la eredita (#1508). Gli spostamenti scelti dall'utente valgono come per lo stato.
async function classeLettaDelCompito(sender, { contesto = null, fontiLette = null } = {}) {
  try {
    const A = globalThis.SN_AUTONOMIA;
    let aut = {};
    try { aut = (await Storage.getSettings()).autonomia || {}; } catch (_) {}
    const fonti = fontiDelCompito(sender, contesto, fontiLette);
    return A.stato({ fonti, livello: A.livelloAttivo(aut.livello), spostamenti: aut.fonti, manopole: aut.manopole }).classe;
  } catch (_) { return null; }
}

// Un documento della cartella Download l'ha scritto qualcun altro: classe 5, non 4 (#530).
function fileScaricato(p) {
  if (!p) return false;
  try {
    const nodePath = require('node:path');
    const rel = nodePath.relative(nodePath.resolve(require('./downloads').downloadsDir()), nodePath.resolve(String(p)));
    return !!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
  } catch (_) { return false; }
}

// L'unico punto del main che chiede a SN_AUTONOMIA se un'azione parte (#530). Il guardiano di uscita non
// esiste ancora: i «sì» da costo 2 in su chiedono. `perche` è la frase del popup quando non è ovvio cosa fa chiedere.
// `chiesta` = l'azione viene dalla conversazione, non da una proposta che Filo fa da sé: senza, il costo 4 non parte.
function decisioneAutonomia(ing, { sender = null, contesto = null, fontiLette = null, assistente = false, origine = 'chat', dentroPerimetro = true, chiesta = true, impostazioni = null } = {}) {
  const A = globalThis.SN_AUTONOMIA;
  const aut = (impostazioni && impostazioni.autonomia) || {};
  const livello = A.livelloAttivo(aut.livello);
  const costoDi = (c) => A.costoReale({ costo: c, difesa: ing.difesa, campo: ing.campo, manopole: aut.manopole }) ?? 0;
  const costo = costoDi(ing.costo);
  const fonti = fontiDelCompito(sender, contesto, fontiLette, assistente);
  const statoPer = (c) => A.stato({ fonti: A.fontiPerCosto(fonti, c), livello, spostamenti: aut.fonti, manopole: aut.manopole });
  const st = statoPer(costo);
  const ingressi = {
    livello, stato: st.stato, costo: ing.costo, campo: ing.campo, manopole: aut.manopole,
    difesa: ing.difesa, chiesta: chiesta && ing.chiesta !== false, parola: !!ing.parola, origine, dentroPerimetro, guardiano: false,
  };
  const d = A.decideDettaglio(ingressi);
  let nuovaUguale = false;
  const diUnaNuova = d.risposta === 'no' && Array.isArray(contesto) ? LETTURE_DI_UNA_NUOVA.get(contesto) : null;
  if (diUnaNuova) {
    const stNuova = A.stato({ fonti: A.fontiPerCosto(fontiDelCompito(null, diUnaNuova), costo), livello, spostamenti: aut.fonti, manopole: aut.manopole });
    nuovaUguale = A.decide({ ...ingressi, stato: stNuova.stato }) === 'no';
  }
  let perche = '';
  if (d.risposta !== 'si' && d.risposta !== 'no') {
    // La lettura è il perché quando, a compito pulito e col guardiano, la risposta sarebbe più larga.
    const daPulito = st.stato === 'contaminato' ? A.decide({ ...ingressi, stato: 'pulito', guardiano: true }) : d.risposta;
    if (ing.segreto) perche = A.fraseSegreto(ing.segreto);
    else if (daPulito !== d.risposta) perche = A.frasePerche(st.fonte);
    // Una difesa abbassata vuole sempre la parola: il motivo lo dice già l'`avviso` del box, una volta sola.
    else if (d.regola === 'perimetro') perche = ing.perchePerimetro || 'Te lo chiedo perché non me l\'hai chiesto tu: è una mia proposta.';
  }
  return { ...d, livello, stato: st, perche, nuovaUguale, conCosto: (c) => A.decide({ ...ingressi, costo: c, stato: statoPer(costoDi(c)).stato }) };
}
// Il contesto di un turno della chat → le letture che avrebbe davanti una conversazione nuova (#1508).
const LETTURE_DI_UNA_NUOVA = new WeakMap();

// Le azioni che l'agente sulla pagina fa da sé nel content script (copia, cerca, condividi) dichiarano solo
// il costo: la risposta è la stessa del dispatch, con la pagina web come fonte letta.
async function decisioneAzionePagina({ costo, campo = 'web', sender = null } = {}) {
  const A = globalThis.SN_AUTONOMIA;
  if (!A.costoValido(costo)) return { risposta: 'no', digita: false, perche: '' };
  let impostazioni = {};
  try { impostazioni = await Storage.getSettings(); } catch (_) {}
  const ing = { costo, campo: A.campoValido(campo) ? campo : null, difesa: false };
  const d = decisioneAutonomia(ing, { sender, assistente: true, impostazioni });
  // I contatori (#1461): la risposta calcolata e, quando chiede, quello che sceglie la persona nel box della pagina.
  const contati = ingressiContati(ing, d, { origine: 'chat', dentroPerimetro: true });
  let conferma = '';
  if (d.risposta === 'si') contaSe('confermaDecisa', 'AZIONE_PAGINA', contati, 'automatica');
  else if (d.risposta === 'no') contaSe('confermaDecisa', 'AZIONE_PAGINA', contati, 'negata');
  else {
    conferma = `pagina:${require('node:crypto').randomBytes(8).toString('hex')}`;
    contaSe('confermaChiesta', conferma, 'AZIONE_PAGINA', contati);
  }
  return {
    risposta: d.risposta, digita: d.digita, perche: d.perche, ...(conferma ? { conferma } : {}),
    ...(d.risposta === 'no' ? { no: fraseNo(ing, d, sender).breve } : {}),
  };
}

// #892.1 — un comando scritto a mano nella home passa dagli stessi livelli di quelli di Filo, giudicato nella cartella
// e con la shell della sessione che lo eseguirà. L'ha scritto la persona: niente di letto sporca il compito.
// Una riga incollata o trascinata l'ha scritta qualcun altro (un sito che dice «scrivi questo in Filo», #892.1):
// vale come testo d'autore ignoto, e con Normale una cancellazione vuole la parola «conferma».
const FONTE_COMANDO_DA_FUORI = Object.freeze({ classe: 5, campo: null, chiave: 'comando:incollato', motivo: 'il comando l\'hai incollato o trascinato, non scritto tu' });

async function decisioneComandoAMano({ comando, cwd = '', shell = '', daFuori = false } = {}) {
  const Levels = globalThis.SN_ACTION_LEVELS;
  const cmd = String(comando || '').trim();
  let impostazioni = {};
  try { impostazioni = await Storage.getSettings(); } catch (_) {}
  const action = { type: 'ESEGUI_COMANDO', comando: cmd, _perimetro: Object.assign(perimetroLettura(null, cwd), { shell }) };
  // Battuto a mano, il comando sono parole dell'utente: un segreto dentro l'ha scritto lui. Incollato no (#1840).
  const ing = Levels ? Levels.ingressi(action, { impostazioni, richiesta: daFuori === true ? '' : cmd }) : null;
  if (!cmd || !ing) return { risposta: 'no', digita: false, no: 'Questo comando non lo lancio.' };
  let d = decisioneAutonomia(ing, { impostazioni, fontiLette: daFuori === true ? [FONTE_COMANDO_DA_FUORI] : null });
  // Il terminale della home è la strada «lo fai tu»: una riga incollata che cancella per sempre vuole la parola, non il
  // no che riceverebbe Filo dopo una lettura (#1909, #1840). Un segreto incollato resta un no (regola 'chiesta').
  if (daFuori === true && d.risposta === 'no' && d.regola === 'lettura') {
    d = { ...decisioneAutonomia(ing, { impostazioni, fontiLette: null }), perche: globalThis.SN_AUTONOMIA.frasePerche(FONTE_COMANDO_DA_FUORI) };
  }
  const contati = ingressiContati(ing, d, { origine: 'chat', dentroPerimetro: ing.dentroPerimetro });
  if (d.risposta === 'no') return { risposta: 'no', digita: false, no: fraseNo(ing, d, null).breve, contati };
  if (d.risposta === 'si') return { risposta: 'si', digita: false, contati };
  const C = globalThis.SN_CMD_CLASSIFY;
  // Chi incolla una riga da un sito non legge il comando: la domanda dice a parole cosa rischia, anche quando il
  // classificatore non ha un motivo di perimetro (il suo livello 3 è «cambia, cancella o non lo riconosco»).
  let motivo = '';
  try {
    const det = C && C.classifyDetail ? C.classifyDetail(cmd, action._perimetro) : null;
    motivo = (det && det.motivo) || (!det || det.level >= 3 ? 'questo comando può cancellare o cambiare dei file, oppure Filo non sa dire cosa fa.' : '');
  } catch (_) {}
  const dove = displayCwd(cartellaDelComando(cwd));
  const parti = [
    'Il comando che hai scritto, nel terminale:\n', { citazione: cmd, nuda: true },
    ...(dove ? ['\nCartella di lavoro:\n', { citazione: dove, nuda: true }] : []),
    ...(motivo ? [`\nPerché te lo chiedo: ${motivo}`] : []),
    ...(d.perche ? [`\n\n${d.perche}`] : []),
  ];
  return { risposta: d.risposta, digita: d.digita, parti, contati };
}

// Il testo di un «no» lo dà SN_AUTONOMIA.fraseNo: breve per il diario, intero per il modello, con la strada che resta.
function fraseNo(ing, decisione, sender) {
  return globalThis.SN_AUTONOMIA.fraseNo({
    regola: decisione.regola, segreto: ing.segreto, dove: ing.dove,
    fonte: decisione.stato && decisione.stato.fonte,
    daPagina: /^https?:/i.test(String(sender?.tab?.url || sender?.url || '')),
    nuovaUguale: !!decisione.nuovaUguale,
  });
}

// L'esito di una ricerca fra i documenti chiesta in una cartella di un altro computer (#1499): niente disco, si dice.
function ricercaSuAltroComputer(action) {
  const cosa = String(action.cosa ?? action.query ?? action.testo ?? action.q ?? '').trim();
  const cartella = String(action.cartella ?? '').trim();
  return { cercato: cosa, cartella, risultati: [], cartellaDiRete: cartella };
}

// #1615 — le voci del menu dell'account chieste a parole: le preme la shell della finestra, come un clic, così avvisi
// d'errore e stato del bottone sono quelli del menu. Chi è già dove chiede lo sa dall'esito, e niente si riapre.
const FRASE_ACCESSO = 'Aperta in una scheda la pagina d\'accesso di Google: l\'utente sceglie l\'account, poi la scheda si chiude da sola e torna dov\'era. Se Google non accetta l\'accesso dentro Filo, la pagina si apre nel browser del computer e Filo glielo dice.';
const FRASE_COLLEGA = 'Aperta in una scheda la pagina d\'accesso di Google con l\'email del suo account già scritta: entrando lì, YouTube, Gmail e Drive nelle schede si collegano.';
async function eseguiAccount(action, sender) {
  const cosa = globalThis.SN_ACTION_LEVELS.cosaAccount(action);
  if (!cosa) return { executed: false, kept: false, output: { error: 'operazione dell\'account non riconosciuta: si usa accedi, collega_google o esci' } };
  const win = winOf(sender);
  if (!win || win.isDestroyed()) return { executed: false, kept: false, output: { error: 'nessuna finestra di Filo aperta' } };
  const auth = require('../auth/google-auth');
  const dentro = auth.isSignedIn();
  let googleNelleSchede = false;
  if (dentro) { try { googleNelleSchede = await require('./accessoGoogle').collegatoNelleSchede(); } catch (_) {} }
  const premi = (voce) => { win.webContents.send('shell:menu-action', voce); };
  try {
    if (cosa === 'esci') {
      if (!dentro) return { executed: true, kept: false, output: { gia: 'fuori', frase: 'L\'utente non è dentro nessun account di Filo: non c\'era niente da cui uscire.' } };
      premi('auth-signout');
      // L'uscita la fa la shell: un «accedi» chiesto subito dopo deve già trovarla fatta.
      const scade = Date.now() + 3000;
      while (auth.isSignedIn() && Date.now() < scade) await new Promise((r) => setTimeout(r, 50));
      if (auth.isSignedIn()) return { executed: false, kept: false, output: { error: 'l\'uscita dall\'account non è riuscita' } };
      const google = googleNelleSchede ? ' Google nelle schede resta collegato: per uscire anche da lì si esce dalla pagina di Google.' : '';
      return { executed: true, kept: false, output: { voce: 'esci', frase: `Uscito dall'account di Filo.${google} Per rientrare può chiederlo in chat, o scegliere «Accedi con Google» nel menu dell'account.` } };
    }
    if (!dentro) {
      premi('auth-signin');
      const insieme = cosa === 'collega_google' ? ' Entrando in Filo con Google si collegano insieme anche YouTube, Gmail e Drive nelle schede.' : '';
      return { executed: true, kept: false, output: { voce: 'accedi', frase: `${FRASE_ACCESSO}${insieme}` } };
    }
    if (googleNelleSchede) {
      const frase = cosa === 'accedi'
        ? 'L\'utente è già dentro Filo col suo account Google, e YouTube, Gmail e Drive nelle schede sono collegati: non c\'era niente da fare.'
        : 'YouTube, Gmail e Drive nelle schede sono già collegati al suo account Google: non c\'era niente da fare.';
      return { executed: true, kept: false, output: { gia: cosa === 'accedi' ? 'dentro' : 'collegato', frase } };
    }
    // Dentro Filo ma fuori da Google nelle schede: chi chiede di entrare di solito l'ha visto da YouTube o Gmail scollegati.
    premi('collega-google');
    const prima = cosa === 'accedi' ? 'L\'utente era già dentro Filo, ma YouTube, Gmail e Drive nelle schede non erano collegati. ' : '';
    return { executed: true, kept: false, output: { voce: 'collega_google', frase: `${prima}${FRASE_COLLEGA}` } };
  } catch (_) {
    return { executed: false, kept: false, output: { error: 'il menu dell\'account non ha risposto' } };
  }
}

// Lo zoom chiesto in chat fra le strade dello zoom (#1468): il verso chiesto, o quello del numero rispetto a prima.
function contaZoomDallaChat(esito, verso, win) {
  const Z = globalThis.SN_CONTATORI_STRADE && globalThis.SN_CONTATORI_STRADE.ZOOM;
  if (!Z || !esito) return;
  let v = verso;
  if (!v && Number.isFinite(esito.percentuale)) {
    const prima = Number(esito.prima);
    if (Math.round(esito.percentuale) === 100) v = 'reset';
    else if (Number.isFinite(prima)) v = esito.percentuale > prima ? 'in' : esito.percentuale < prima ? 'out' : '';
  }
  if (Z[v] && dallaChat()) require('./contatoriStrade').misura('azione', Z[v], 'chat', { incognito: !!(win && win._filoIncognito) });
}
// Una pagina di Filo che la chat apre da sola (#1468): la strada della pagina, e quella dell'icona che apre la stessa.
// Prima dell'apertura, perché il tempo in vista parte quando la scheda arriva davanti.
function contaPaginaDallaChat(url, win) {
  const T = globalThis.SN_CONTATORI_STRADE;
  if (!T || !win || !/^filo:/i.test(String(url || '')) || !dallaChat()) return;
  const Strade = require('./contatoriStrade');
  const incognito = !!win._filoIncognito;
  Strade.misura('pagina', url, 'chat', { finestra: win._filoTabs, incognito });
  const azione = T.AZIONE_DELLA_PAGINA[T.paginaDi(url)];
  if (azione) Strade.misura('azione', azione, 'chat', { incognito });
}
// Un tasto della home che usa la porta dell'Aiuto (#1561) è un gesto dell'utente, non la chat.
function dallaChat() {
  const p = Registro.corrente();
  return !p || p.via !== 'interfaccia';
}

async function executeFiloAction(action, opzioni = {}) {
  const raccolti = [];
  // Chi è stato lo dice chi manda (#1561): un tasto della home che usa la porta dell'Aiuto resta un gesto dell'utente.
  const via = opzioni.via === 'interfaccia' ? 'interfaccia' : (opzioni.assistente ? 'assistente' : 'chat');
  // `chat`: quello che l'azione fa nascere nel filo (una ricerca) se ne va con la sua chat.
  const chat = typeof opzioni.chatId === 'string' && opzioni.chatId ? opzioni.chatId : '';
  // `segnoAzione`: la porta di volume, Wi-Fi e Bluetooth scrive l'azione da sé, come per i tasti della home.
  const segnoAzione = {};
  // Quello che l'Aiuto fa se ne va con la sua conversazione, come quello della chat con la sua.
  const chatNelFilo = chat || (typeof opzioni.chatNelFilo === 'string' && opzioni.chatNelFilo ? opzioni.chatNelFilo : '')
    || (via === 'assistente' ? chatAiutoDi(opzioni.sender) : '');
  // Il sito del file scaricato si chiede prima: rinominato, il file non ha più il percorso chiesto.
  let url = '';
  try { url = require('./accaduti').indirizzoDelFile(globalThis.SN_FILO_ACCADUTI.parametriAzione(action)); } catch (_) {}
  const res = await Registro.con({ via, raccolti, segnoAzione, ...(chatNelFilo ? { chat: chatNelFilo } : {}) }, () => eseguiAzioneFilo(action, opzioni));
  // Un «annulla» o Ctrl/Cmd+Z subito dopo disfa quest'azione: i contatori la ricordano coi suoi cambi (#1461).
  if (res && res.executed) contaSe('azioneDiFilo', String((action && action.type) || '').toUpperCase(), raccolti.map((v) => v.id));
  const finale = raccolti.length && res && typeof res === 'object' ? { ...res, cambi: raccolti } : res;
  // Nel registro il clic sulla conferma è dell'utente, e la proposta della segnalazione automatica non è
  // dell'assistente (#2371): `nelFilo` cambia solo chi la riga nomina, non la strada dell'azione.
  const viaNelFilo = opzioni.nelFilo === 'conferma' || opzioni.nelFilo === 'segnalazione' ? opzioni.nelFilo : via;
  if (!segnoAzione.scritta) azioneNelFilo(action, finale, { via: viaNelFilo, chatId: chatNelFilo, incognito: require('../shim/storage').inIncognito(), url });
  return finale;
}

// Ogni azione di Filo entra nel filo con parametri ed esito (#1561), da qui sola: chat, Aiuto e conferme passano da
// executeFiloAction; le porte dell'Aiuto che non ci passano (ricerca web, documenti, barra) chiamano azioneDellAiuto.
// Non ferma la risposta: il filo la scrive dopo.
function azioneNelFilo(action, res, { via, chatId, incognito, url }) {
  (async () => {
    const Levels = globalThis.SN_ACTION_LEVELS;
    let fatto = '';
    try {
      if (res && res.executed && Levels && Levels.describeDone) {
        fatto = String(Levels.describeDone({ ...action, _output: res.output }) || '').split('\n')[0].trim();
      }
    } catch (_) {}
    let segreti = [];
    try { segreti = await segretiCustoditi(); } catch (_) {}
    await require('./accaduti').azione(action, res, { via, chatId: typeof chatId === 'string' ? chatId : '', fatto, segreti, incognito, url });
  })().catch((e) => console.warn('[Filo] azione non entrata nel filo:', e?.message || e));
}

// `res` nella forma di executeFiloAction ({ executed, output, error }), come la stessa azione chiesta alla chat.
function azioneDellAiuto(action, res, sender) {
  azioneNelFilo(action, res, { via: 'assistente', chatId: chatAiutoDi(sender), incognito: require('../shim/storage').inIncognito() });
}

// La conversazione dell'Aiuto che una scheda ha aperta (#1561): la scrive il pannello col primo messaggio, e quello che
// l'Aiuto fa lì dentro (azioni, ricerche) porta la sua chat, così se ne va con lei. Una pagina nuova ne apre un'altra.
const chatAiutoPer = new WeakMap();
const chatAiutoAscoltata = new WeakSet();
function segnaChatAiuto(sender, id) {
  const wc = sender && sender.wc;
  if (!wc || typeof id !== 'string' || !id) return;
  if (!chatAiutoAscoltata.has(wc)) {
    chatAiutoAscoltata.add(wc);
    try { wc.on('did-navigate', () => chatAiutoPer.delete(wc)); } catch (_) {}
  }
  chatAiutoPer.set(wc, id);
}
function chatAiutoDi(sender) {
  const wc = sender && sender.wc;
  return (wc && chatAiutoPer.get(wc)) || '';
}

// I cinque ingressi della tabella dei permessi e la risposta calcolata, come li contano i contatori (#1461).
function ingressiContati(ing, decisione, { origine, dentroPerimetro }) {
  return {
    livello: decisione.livello, stato: decisione.stato && decisione.stato.stato, costo: ing.costo,
    perimetro: dentroPerimetro ? 'dentro' : 'fuori', origine, risposta: decisione.risposta,
  };
}
// L'Aiuto rimanda la sua cronologia a ogni turno: un messaggio con delle schede riporta la lettura fatta quando è
// partito, come la chat che la tiene col turno. Si rilegge solo se manca (conversazione nuova, Filo riaperto).
const lettureGettoniAiuto = new WeakMap(); // webContents → indirizzo → lettura

module.exports = {
  compitoSenzaTestoDiAltri,
  ricordaSegnalazione,
  segnalazioneConfermataPulita,
  fontiDellaChat,
  segnaFonteLetta,
  segnaFonte,
  nuovaConversazioneAiuto,
  segnaLetturaAiuto,
  segnaTestoNellAiuto,
  segnaPaginaDiFiloNellAiuto,
  classeLettaDelCompito,
  fileScaricato,
  decisioneAutonomia,
  LETTURE_DI_UNA_NUOVA,
  decisioneAzionePagina,
  decisioneComandoAMano,
  fraseNo,
  ricercaSuAltroComputer,
  eseguiAccount,
  contaZoomDallaChat,
  contaPaginaDallaChat,
  dallaChat,
  executeFiloAction,
  azioneNelFilo,
  azioneDellAiuto,
  segnaChatAiuto,
  chatAiutoDi,
  ingressiContati,
  lettureGettoniAiuto,
};
