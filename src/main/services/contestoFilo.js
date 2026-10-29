// Il contesto della chat letto dal filo (#868): gli ultimi giorni di conversazioni di tutte le schede, gli esiti
// delle letture recenti e il punto d'inizio che si tiene fra un turno e l'altro. Logica pura in
// src/shared/filoContesto.js; i pezzi vecchi li ripesca src/main/services/ricordiFilo.js.

'use strict';

const FC = () => globalThis.SN_FILO_CONTESTO;
const F = () => globalThis.SN_IL_FILO;
const TV = () => {
  if (!globalThis.SN_TRATTO_VIVO) require('../../shared/filoTrattoVivo.js');
  return globalThis.SN_TRATTO_VIVO;
};

// Gli esiti delle azioni (pagine e documenti letti, comandi, ricerche) restano in memoria, mai su disco: quanto
// entrano nel contesto lo decide la finestra (src/shared/filoContesto.js, #553.2, #587). Le copie se ne vanno quando il
// loro messaggio esce dal tratto (`pota`); il tetto è solo una rete, lontana da ogni tratto vero (#1562).
const MAX_ESITI = 20000;
const esiti = new Map();

function ricordaEsiti(chat, ts, { azioni, reasoningDetails } = {}) {
  if (!chat || !ts) return;
  const lista = (Array.isArray(azioni) ? azioni : []).filter((a) => a && a.type);
  const rd = Array.isArray(reasoningDetails) && reasoningDetails.length ? reasoningDetails : null;
  if (!lista.length && !rd) return;
  if (require('../shim/storage').inIncognito()) chatIncognito.add(chat);
  const k = `${chat}|${ts}`;
  esiti.delete(k);
  esiti.set(k, { azioni: lista, ...(rd ? { reasoningDetails: rd } : {}) });
  while (esiti.size > MAX_ESITI) esiti.delete(esiti.keys().next().value);
}

// Le immagini mandate in chat, come gli esiti: in memoria, mai su disco, finché possono ancora tornare al modello
// (#1166). Il tetto in caratteri tiene il main lontano da un consumo esagerato; quelle tolte lasciano la nota.
const MAX_CARATTERI_FOTO = 128 * 1024 * 1024;
const foto = new Map();
let caratteriFoto = 0;
const pesoFoto = (urls) => urls.reduce((n, u) => n + u.length, 0);

function togliFoto(k) {
  const urls = foto.get(k);
  if (!urls) return;
  caratteriFoto -= pesoFoto(urls);
  foto.delete(k);
}

// Le chat dell'incognito: alla chiusura della sua ultima finestra le loro copie in memoria se ne vanno con lui.
const chatIncognito = new Set();
function dimenticaIncognito() {
  for (const c of chatIncognito) dimentica(c);
  chatIncognito.clear();
  fotografie.incognito = null;
}

function ricordaImmagini(chat, ts, immagini) {
  if (!chat || !ts) return;
  const urls = (Array.isArray(immagini) ? immagini : []).filter((u) => typeof u === 'string' && /^data:image\//i.test(u));
  if (!urls.length) return;
  if (require('../shim/storage').inIncognito()) chatIncognito.add(chat);
  const k = `${chat}|${ts}`;
  togliFoto(k);
  foto.set(k, urls);
  caratteriFoto += pesoFoto(urls);
  while (caratteriFoto > MAX_CARATTERI_FOTO && foto.size > 1) togliFoto(foto.keys().next().value);
}

// Un messaggio uscito dal tratto non torna più davanti al modello: le sue immagini non servono più.
function potaFoto(vecchi) {
  if (!foto.size) return;
  for (const m of vecchi) togliFoto(FC().chiave(m));
}

// Le copie dei messaggi usciti dal tratto (non ripresi): ognuno pota le chat del suo lato, l'incognito le sue.
function pota(vecchi, visti, incognito) {
  const davanti = new Set(visti.map((m) => FC().chiave(m)));
  for (const m of vecchi) {
    if (chatIncognito.has(m.chat) !== incognito) continue;
    const k = FC().chiave(m);
    if (davanti.has(k)) continue;
    esiti.delete(k);
    giri.delete(k);
    preamboli.delete(k);
  }
}

// ── Il tratto vivo (SPEC-CONTESTO fase 3): in memoria, mai su disco ─────────
// Quello che Filo scrive in testa a un messaggio dell'utente, per messaggio: le cose successe prima (fisse dalla prima
// volta, rifatte solo se una è stata cancellata), le sezioni cambiate dalla fotografia (valgono per la sua epoca), le
// note del turno (ricordi, intervista) e quelle dopo il testo. Un messaggio passato si rimanda così com'era.
const MAX_PREAMBOLI = 2 * MAX_ESITI;
const preamboli = new Map();
function memoDi(k) {
  let m = preamboli.get(k);
  if (!m) {
    m = {};
    preamboli.set(k, m);
    while (preamboli.size > MAX_PREAMBOLI) preamboli.delete(preamboli.keys().next().value);
  }
  return m;
}

// Il turno di una risposta com'è andato (giri di strumenti, esiti, seguiti), per rimandarlo uguale ai turni dopo.
const giri = new Map();
function ricordaGiro(chat, ts, { messaggi, testo, reasoningDetails, azioni, seguiti } = {}) {
  if (!chat || !ts || !Array.isArray(messaggi)) return;
  if (require('../shim/storage').inIncognito()) chatIncognito.add(chat);
  const k = `${chat}|${ts}`;
  giri.delete(k);
  giri.set(k, {
    messaggi, testo: String(testo == null ? '' : testo), reasoningDetails: Array.isArray(reasoningDetails) ? reasoningDetails : [],
    azioni: Array.isArray(azioni) ? azioni : [], seguiti: Array.isArray(seguiti) ? seguiti.filter(Boolean) : [],
  });
  while (giri.size > MAX_ESITI) giri.delete(giri.keys().next().value);
}

// La fotografia del CONTESTO dell'utente, una per lato: si rifà quando il tratto riparte (un taglio nuovo), quando la cache
// è comunque fredda (fermo da più della sua durata), o quando un cambio non si può dire con un'aggiunta.
const fotografie = { normale: null, incognito: null };
const DURATE_MS = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 };
const epocaDi = (lato) => (fotografie[lato] ? fotografie[lato].epoca : 0);
// Il tratto riparte quando il suo inizio si sposta, anche per una conversazione ripresa che entra davanti: il primo
// messaggio di un tratto vuoto non sposta niente.
const riprese = (a) => (a && Array.isArray(a.riprese) ? a.riprese.join('|') : '');
const stessaAncora = (prima, ora) => !prima || (!!ora && prima.ts === ora.ts && prima.giorni === ora.giorni && prima.token === ora.token
  && riprese(prima) === riprese(ora));

// `segna: false`: la richiesta non ha un messaggio dell'utente che porti i cambi ai turni dopo (un «Continua», un turno
// interno): restano da dire al prossimo messaggio, o si perderebbero (#1562).
function fotografa({ incognito = false, sezioni, ancora = null, durata = '1h', ora = Date.now(), segna = true } = {}) {
  const lato = incognito ? 'incognito' : 'normale';
  const f = fotografie[lato];
  const fresca = f && ora - f.usata <= (DURATE_MS[durata] || DURATE_MS['1h']) && stessaAncora(f.ancora, ancora);
  if (fresca) {
    const d = TV().confronta(f.viste, sezioni);
    if (!d.rifai) {
      if (segna) f.viste = d.viste;
      f.usata = ora;
      f.ancora = f.ancora || ancora;
      return { testo: f.testo, epoca: f.epoca, cambiate: TV().rendiCambiate(d.cambiate), nuova: false };
    }
  }
  const nuova = {
    epoca: (f ? f.epoca : 0) + 1,
    testo: TV().parteUtente(sezioni, { ts: new Date(ora).toISOString() }),
    viste: TV().confronta(new Map(), sezioni).viste,
    ancora,
    usata: ora,
  };
  fotografie[lato] = nuova;
  return { testo: nuova.testo, epoca: nuova.epoca, cambiate: '', nuova: true };
}

// La chat riaperta mostra le foto che il modello ha ancora davanti: quello che vede lui, l'utente lo deve vedere.
function conFotoInMemoria(chat) {
  if (!chat || !Array.isArray(chat.messages) || !foto.size) return chat;
  const messages = chat.messages.map((m) => {
    const urls = m && m.role === 'user' && Number(m.images) > 0 ? foto.get(`${chat.id}|${m.ts}`) : null;
    return urls ? { ...m, fotoInMemoria: urls.slice() } : m;
  });
  return { ...chat, messages };
}

function dimentica(chat) {
  if (!chat) {
    esiti.clear();
    foto.clear();
    caratteriFoto = 0;
    preamboli.clear();
    giri.clear();
    fotografie.normale = null;
    fotografie.incognito = null;
    return;
  }
  for (const mappa of [esiti, preamboli, giri]) for (const k of [...mappa.keys()]) if (k.startsWith(`${chat}|`)) mappa.delete(k);
  for (const k of [...foto.keys()]) if (k.startsWith(`${chat}|`)) togliFoto(k);
}

// Tutto il filo in messaggi, in ordine di tempo. A parità d'ora decide la conversazione: lo stesso ordine a ogni turno.
async function messaggiDelFilo(opts) {
  return messaggiDi(await F().chats(opts));
}

function messaggiDi(chats) {
  const out = [];
  const perId = new Map(chats.filter((c) => c && c.id).map((c) => [c.id, c]));
  const R = globalThis.SN_RISPOSTA_A;
  const citata = (m) => (m.rispostaA && R ? R.risolvi(m.rispostaA, (id) => perId.get(id), { max: R.PER_IL_MODELLO }) : null);
  for (const c of chats) {
    // Una conversazione dell'Editor, dei Mazzi o dell'Aiuto (#974) entra come una riga all'ora in cui è cominciata:
    // lo scambio si rilegge con CERCA_CHAT. Non è voce dell'utente né di Filo, e i ricordi non la ripescano.
    if (c.app) {
      const A = globalThis.SN_FILO_APP;
      const t = A && A.eApp(c.app) && (c.messages || []).length ? A.inizio(c) : NaN;
      if (Number.isFinite(t)) {
        out.push({
          chat: c.id, titolo: c.title || '', role: 'user', riga: true, text: A.testoPerModello(c),
          ts: new Date(t).toISOString(), actions: [], _i: 0,
        });
      }
      continue;
    }
    (c.messages || []).forEach((m, i) => {
      if (!m) return;
      // Già risolta, anche per un archivio di prima del campo: chi rilegge non ha più le fonti della chat (#1508).
      const classe = FC().classeDelMessaggio(m, c.fonti);
      out.push({
        chat: c.id,
        titolo: c.title || '',
        role: m.role === 'user' ? 'user' : 'filo',
        text: String(m.text == null ? '' : m.text),
        ts: m.ts,
        actions: Array.isArray(m.actions) ? m.actions : [],
        ...(Array.isArray(m.letti) ? { letti: m.letti } : {}),
        ...(typeof m.esterno === 'string' ? { esterno: m.esterno } : {}),
        ...(m.daModello ? { daModello: true } : {}),
        ...(classe > 1 ? { classeLetta: classe } : {}),
        ...(Number(m.images) > 0 ? { images: Number(m.images) } : {}),
        ...(m.role === 'user' && m.rispostaA ? { rispostaA: citata(m) } : {}),
        ...(m.role === 'user' && m.seguito ? { seguito: true } : {}),
        _i: i,
      });
    });
  }
  out.sort((a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || (a.chat < b.chat ? -1 : a.chat > b.chat ? 1 : a._i - b._i));
  return out;
}

const vuotoDiImmagine = (t) => {
  const s = String(t == null ? '' : t).trim();
  return s === '(immagine)' ? '' : s;
};
const stesso = (a, b) => a && b && (a.role === 'user' ? 'user' : 'filo') === (b.role === 'user' ? 'user' : 'filo')
  && vuotoDiImmagine(a.text) === vuotoDiImmagine(b.text);

// La domanda di adesso è già nel filo (la chat si scrive prima di rispondere): va in fondo, dopo il contesto, non nel tratto.
function senzaDomanda(lista, chatId, userMessage) {
  if (!chatId || userMessage == null) return lista;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (lista[i].chat !== chatId) continue;
    if (lista[i].role === 'user' && vuotoDiImmagine(lista[i].text) === vuotoDiImmagine(userMessage)) return [...lista.slice(0, i), ...lista.slice(i + 1)];
    return lista;
  }
  return lista;
}

// Quello che la scheda ha e il filo no: un turno interrotto da un guasto o fermato, una ripresa. Sta in fondo, dopo
// l'ultimo messaggio che il filo conosce.
function codaDellaScheda(storia, chatMsgs) {
  const h = (Array.isArray(storia) ? storia : []).slice(-20);
  const recenti = chatMsgs.slice(-20);
  const coda = [];
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i];
    if (!m) continue;
    if (!m.interrotto && recenti.some((x) => stesso(m, x))) break;
    if (!recenti.length && !m.interrotto && !m.interno) continue;
    coda.unshift(m);
  }
  return coda;
}

// Gli esiti che la scheda ha visto coi suoi occhi (una conferma data dopo il turno) valgono più della copia in memoria.
function esitiDellaScheda(storia, chatMsgs) {
  const out = new Map();
  const h = (Array.isArray(storia) ? storia : []).slice(-FC().MESSAGGI_CON_ESITI);
  let j = chatMsgs.length - 1;
  for (let i = h.length - 1; i >= 0 && j >= 0; i--) {
    const m = h[i];
    if (!m || m.role !== 'filo' || m.interrotto) continue;
    let k = j;
    while (k >= 0 && !stesso(m, chatMsgs[k])) k--;
    if (k < 0) continue;
    // Un sì dato nel popup è un esito anche senza `_output` (una lezione fissata non ne ha): senza, il modello non sapeva
    // che l'utente aveva confermato (#1396).
    const conEsiti = Array.isArray(m.actions) && m.actions.some((a) => a && (a._output || a._confirmed));
    const rd = Array.isArray(m.reasoningDetails) && m.reasoningDetails.length ? m.reasoningDetails : null;
    if (conEsiti || rd) out.set(FC().chiave(chatMsgs[k]), { azioni: conEsiti ? m.actions : [], ...(rd ? { reasoningDetails: rd } : {}) });
    j = k - 1;
  }
  return out;
}

// Le pagine che il filo ha ancora, lette solo se un esito davanti al modello ne porta: una visita cancellata dalla
// Sicurezza o una scheda chiusa tolta dall'archivio non tornano dalla ricerca che le aveva trovate (#868.1).
const conPagine = (azioni) => (Array.isArray(azioni) ? azioni : [])
  .some((a) => a && a._output && Array.isArray(a._output.pagine) && a._output.pagine.length);
async function pagineCheCiSono(incognito) {
  const urls = new Set();
  const siti = new Set();
  const chiave = (u) => String(u || '').replace(/#.*$/, '');
  const sito = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  const segna = (u) => { if (!u) return; urls.add(chiave(u)); const s = sito(u); if (s) siti.add(s); };
  for (const v of await F().pagine(null, { incognito })) segna(v && v.url);
  const A = globalThis.SN_ARCHIVED_TABS;
  if (A && typeof A.list === 'function') for (const it of await A.list()) segna(it && it.url);
  // Di una pagina delicata il risultato porta solo il sito: c'è finché il filo ha ancora una pagina di quel sito.
  return (p) => (p && p.delicata ? siti.has(sito(p.url)) : urls.has(chiave(p && p.url)));
}

const ancore = { normale: null, incognito: null };

// Le cose successe nel filo da `da`: gli accaduti e i cambi (un cambio ritoccato conta all'ora dell'ultimo ritocco).
async function eventiDa(da, incognito) {
  const leggi = async (fn) => { try { return (await fn()) || []; } catch (_) { return []; } };
  const [acc, cambi] = await Promise.all([
    leggi(() => F().accaduti({ da }, { incognito })),
    leggi(() => F().cambi({ incognito })),
  ]);
  const t0 = Date.parse(da);
  const dalCambio = (c) => ({ tipo: 'cambio', id: c.id, ts: c.agg || c.ts, cambio: c });
  return [...acc, ...cambi.filter((c) => c && c.id && !(Date.parse(c.agg || c.ts) <= t0)).map(dalCambio)];
}

// La domanda di adesso nella lista del filo (la chat si scrive prima di rispondere): l'ultimo messaggio della sua chat.
function domandaNelFilo(lista, chatId, userMessage) {
  if (!chatId || userMessage == null) return null;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (lista[i].chat !== chatId) continue;
    return lista[i].role === 'user' && vuotoDiImmagine(lista[i].text) === vuotoDiImmagine(userMessage) ? lista[i] : null;
  }
  return null;
}

// `osserva(azioni)` scrive gli esiti per il modello (handlers.js). Ritorna il tratto da mandare e quello che serve alle
// uscite: le azioni il cui esito arriva al modello, i messaggi che porta (letti, voce dell'utente), i più vecchi.
// `immagini: false`: il modello ha rifiutato le immagini dei turni passati, al loro posto resta la nota.
// `domanda(...)`: la domanda di adesso resa come la renderà il tratto dei turni dopo, con le note di questo turno.
async function componi({ chatId = null, userMessage = '', storia = [], incognito = null, tetti, osserva, ora = Date.now(), immagini = true } = {}) {
  // Deciso alla richiesta, come fa il filo: dall'incognito si legge il filo in memoria, mai quello sul disco.
  if (incognito == null) incognito = require('../shim/storage').inIncognito();
  const lato = incognito ? 'incognito' : 'normale';
  const chats = await F().chats({ incognito });
  const conDomanda = messaggiDi(chats);
  const tutti = senzaDomanda(conDomanda, chatId, userMessage);
  const laDomanda = domandaNelFilo(conDomanda, chatId, userMessage);
  const chatMsgs = chatId ? tutti.filter((m) => m.chat === chatId) : [];
  const dallaScheda = esitiDellaScheda(storia, chatMsgs);
  // Quello che è stato cancellato esce anche dalle copie, dal messaggio dopo e in ogni scheda (#868.1). Senza la lista
  // delle pagine non si rischia: le pagine trovate prima restano fuori.
  const ci = new Set(chats.map((c) => c && c.id));
  const codaGrezza = codaDellaScheda(storia, chatMsgs);
  const candidati = [...esiti.values(), ...dallaScheda.values(), ...giri.values()].flatMap((e) => (e && e.azioni) || [])
    .concat(codaGrezza.flatMap((m) => (Array.isArray(m.actions) ? m.actions : [])));
  let pagina = null;
  if (conPagine(candidati)) {
    try { pagina = await pagineCheCiSono(incognito); } catch (_) { pagina = () => false; }
  }
  const vivi = { chat: (id) => ci.has(id), pagina };
  const senzaTolti = (azioni) => FC().senzaCancellati(azioni, vivi);
  // Dal taglio dei giorni, non dall'inizio scelto del tratto: le cose successe prima del suo primo messaggio sono sue.
  const daEventi = new Date(FC().taglio(ora, tetti.giorni)).toISOString();
  const eventi = await eventiDa(daEventi, incognito);
  let tolte = 0;
  try { tolte = await F().cancellazioni({ incognito }); } catch (_) { tolte = 0; }
  const perMessaggio = TV().eventiPerMessaggi(conDomanda, eventi, { da: daEventi, chiave: FC().chiave });
  const epoca = epocaDi(lato);
  // Le cose successe si scrivono la prima volta e restano quelle: un evento arrivato in ritardo non riscrive un messaggio
  // già mandato. Si rifanno dopo una cancellazione, perché ciò che è cancellato dalle copie deve uscire.
  const eventiDi = (m) => {
    const k = FC().chiave(m);
    const memo = memoDi(k);
    if (!memo.eventi || memo.eventi.tolte !== tolte) {
      memo.eventi = { ...TV().rendiEventi(perMessaggio.get(k) || [], { rif: m.ts }), tolte };
    }
    return memo;
  };
  // I ricordi ripescati per un turno restano nella sua domanda, tranne le conversazioni cancellate dopo (#868.1).
  // L'intervista solo nel suo turno: rimandata, le sue istruzioni dirigerebbero ogni chat dopo (#1297).
  const turnoDi = (memo, intervista = '') => [
    intervista,
    Array.isArray(memo.ricordi) && memo.ricordi.length ? FC().rendiRicordi(memo.ricordi.filter((r) => r && r.tratto && vivi.chat(r.tratto.chat))) : '',
  ].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
  const preambolo = (m) => {
    if (m.riga || m.seguito) return '';
    const memo = eventiDi(m);
    return TV().preambolo({
      eventi: memo.eventi.testo,
      stato: memo.stato && memo.stato.epoca === epoca ? memo.stato.testo : '',
      turno: turnoDi(memo),
    });
  };
  const note = (m) => {
    const memo = preamboli.get(FC().chiave(m));
    return memo && Array.isArray(memo.dopo) ? memo.dopo : null;
  };
  // Un turno con dentro qualcosa che non c'è più torna come risposta sola, dove gli esiti si ripuliscono. Anche uno
  // confermato dopo dalla scheda (un sì nel popup): il suo esito vero lo porta la risposta sola (#1396).
  const valido = (g) => !!g && senzaTolti(g.azioni) === g.azioni;
  const confermataDopo = (k) => {
    const s = dallaScheda.get(k);
    return !!s && s.azioni.some((a) => a && a._confirmed);
  };
  const giroDi = (m) => {
    const k = FC().chiave(m);
    const g = giri.get(k);
    return valido(g) && !confermataDopo(k) ? g : null;
  };
  const seguitiNeiGiri = new Set();
  for (const [k, g] of giri) if (g.seguiti.length && valido(g) && !confermataDopo(k)) for (const x of g.seguiti) seguitiNeiGiri.add(x);
  // La riga di una conversazione di un'altra app sta all'ora d'inizio e cambia mentre l'app continua (messaggi, nome del
  // documento): resta com'era fino alla prossima fotografia, o riscriverebbe il tratto da lì.
  const nelTratto = tutti.map((m) => {
    if (!m.riga) return m;
    const memo = memoDi(FC().chiave(m));
    if (!memo.riga || memo.riga.epoca !== epoca) memo.riga = { epoca, testo: m.text };
    return memo.riga.testo === m.text ? m : { ...m, text: memo.riga.testo };
  });
  const f = FC().finestra(nelTratto, {
    ora,
    giorni: tetti.giorni,
    token: tetti.token,
    ancora: ancore[lato],
    chatCorrente: chatId,
    esiti: (m) => {
      const k = FC().chiave(m);
      const s = dallaScheda.get(k);
      const e = esiti.get(k) || null;
      if (!s) return e && { ...e, azioni: senzaTolti(e.azioni) };
      return { azioni: senzaTolti(s.azioni.length ? s.azioni : ((e && e.azioni) || [])), reasoningDetails: (e && e.reasoningDetails) || s.reasoningDetails };
    },
    osserva,
    immagini: immagini ? (m) => foto.get(FC().chiave(m)) || null : null,
    preambolo,
    note,
    giro: giroDi,
    salta: (m) => m.role === 'user' && seguitiNeiGiri.has(FC().chiave(m)),
    // La domanda parte intera nel suo turno: nei turni dopo torna intera finché la fotografia è la stessa.
    intero: (m) => {
      const memo = preamboli.get(FC().chiave(m));
      return !!memo && memo.intero === epoca;
    },
  });
  ancore[lato] = f.ancora;
  potaFoto(f.vecchi);
  pota(f.vecchi, f.visti, incognito);
  // La domanda come la vedrà il tratto dei turni dopo: le sezioni cambiate (per questa epoca), le note del turno e
  // quelle dopo il testo si fissano qui. Senza la domanda nel filo (un turno interno, una chat senza id) resta null.
  const domanda = ({ stato = '', epoca: ep = epoca, onboarding = '', ricordi = null, dopo = null, immagini: urls = null } = {}) => {
    if (!laDomanda) return null;
    const memo = eventiDi(laDomanda);
    // Rimandata con «Riprova», la domanda tiene i cambi del primo invio: il CONTESTO li dà già per detti (#1562).
    const prima = memo.stato && memo.stato.epoca === ep ? memo.stato.testo : '';
    memo.stato = prima || stato ? { epoca: ep, testo: [prima, stato].filter(Boolean).join('\n\n') } : null;
    stato = memo.stato ? memo.stato.testo : '';
    memo.ricordi = Array.isArray(ricordi) && ricordi.length ? ricordi : null;
    memo.dopo = Array.isArray(dopo) ? dopo.filter(Boolean) : null;
    memo.intero = ep;
    const pre = TV().preambolo({ eventi: memo.eventi.testo, stato: stato || '', turno: turnoDi(memo, { intervista: true }) });
    const fotoQui = foto.get(FC().chiave(laDomanda)) || (Array.isArray(urls) && urls.length ? urls : null);
    return FC().rendiMessaggio(laDomanda, f.ultimo, { tetto: tetti.token, foto: fotoQui, preambolo: pre, dopo: memo.dopo, intero: true });
  };
  return {
    messaggi: f.messaggi,
    visti: f.visti,
    azioni: f.azioni,
    perUnaNuova: senzaTolti(f.perUnaNuova),
    vecchi: f.vecchi,
    coda: codaGrezza.map((m) => {
      const azioni = Array.isArray(m.actions) ? senzaTolti(m.actions) : m.actions;
      return azioni === m.actions ? m : { ...m, actions: azioni };
    }),
    nuova: !chatMsgs.length,
    tutti,
    token: f.token,
    ancora: f.ancora,
    epoca,
    domanda,
    haDomanda: !!laDomanda,
  };
}

function azzeraAncore() {
  ancore.normale = null;
  ancore.incognito = null;
  fotografie.normale = null;
  fotografie.incognito = null;
}

module.exports = { ricordaEsiti, ricordaImmagini, ricordaGiro, fotografa, conFotoInMemoria, dimentica, dimenticaIncognito, messaggiDelFilo, messaggiDi, componi, senzaDomanda, codaDellaScheda, esitiDellaScheda, azzeraAncore };
globalThis.SN_CONTESTO_FILO = module.exports;
