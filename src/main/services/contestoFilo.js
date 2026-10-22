// Il contesto della chat letto dal filo (#868): gli ultimi giorni di conversazioni di tutte le schede, gli esiti
// delle letture recenti e il punto d'inizio che si tiene fra un turno e l'altro. Logica pura in
// src/shared/filoContesto.js; i pezzi vecchi li ripesca src/main/services/ricordiFilo.js.

'use strict';

const FC = () => globalThis.SN_FILO_CONTESTO;
const F = () => globalThis.SN_IL_FILO;

// Gli esiti delle azioni (pagine e documenti letti, comandi, ricerche) restano in memoria, mai su disco: quanto
// entrano nel contesto lo decide la finestra (src/shared/filoContesto.js, #553.2, #587).
const MAX_ESITI = 300;
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

// Un messaggio uscito dagli ultimi della sua chat non torna più fra quelli recenti: le sue immagini non servono più.
function potaFoto(tutti) {
  if (!foto.size) return;
  const contati = new Map();
  for (let i = tutti.length - 1; i >= 0; i--) {
    const m = tutti[i];
    const c = (contati.get(m.chat) || 0) + 1;
    contati.set(m.chat, c);
    if (c > FC().MESSAGGI_CON_ESITI) togliFoto(FC().chiave(m));
  }
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
    return;
  }
  for (const k of [...esiti.keys()]) if (k.startsWith(`${chat}|`)) esiti.delete(k);
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
        ...(Number(m.images) > 0 ? { images: Number(m.images) } : {}),
        ...(m.role === 'user' && m.rispostaA ? { rispostaA: citata(m) } : {}),
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

// `osserva(azioni)` scrive gli esiti per il modello (handlers.js). Ritorna il tratto da mandare e quello che serve alle
// uscite: le azioni il cui esito arriva al modello, i messaggi che porta (letti, voce dell'utente), i più vecchi.
// `immagini: false`: il modello ha rifiutato le immagini dei turni passati, al loro posto resta la nota.
async function componi({ chatId = null, userMessage = '', storia = [], incognito = null, tetti, osserva, ora = Date.now(), immagini = true } = {}) {
  // Deciso alla richiesta, come fa il filo: dall'incognito si legge il filo in memoria, mai quello sul disco.
  if (incognito == null) incognito = require('../shim/storage').inIncognito();
  const chats = await F().chats({ incognito });
  const tutti = senzaDomanda(messaggiDi(chats), chatId, userMessage);
  potaFoto(tutti);
  const chatMsgs = chatId ? tutti.filter((m) => m.chat === chatId) : [];
  const dallaScheda = esitiDellaScheda(storia, chatMsgs);
  const lato = incognito ? 'incognito' : 'normale';
  // Quello che è stato cancellato esce anche dalle copie, dal messaggio dopo e in ogni scheda (#868.1). Senza la lista
  // delle pagine non si rischia: le pagine trovate prima restano fuori.
  const ci = new Set(chats.map((c) => c && c.id));
  const codaGrezza = codaDellaScheda(storia, chatMsgs);
  const candidati = [...esiti.values(), ...dallaScheda.values()].flatMap((e) => (e && e.azioni) || [])
    .concat(codaGrezza.flatMap((m) => (Array.isArray(m.actions) ? m.actions : [])));
  let pagina = null;
  if (conPagine(candidati)) {
    try { pagina = await pagineCheCiSono(incognito); } catch (_) { pagina = () => false; }
  }
  const vivi = { chat: (id) => ci.has(id), pagina };
  const senzaTolti = (azioni) => FC().senzaCancellati(azioni, vivi);
  const f = FC().finestra(tutti, {
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
  });
  ancore[lato] = f.ancora;
  return {
    messaggi: f.messaggi,
    visti: f.visti,
    azioni: f.azioni,
    vecchi: f.vecchi,
    coda: codaGrezza.map((m) => {
      const azioni = Array.isArray(m.actions) ? senzaTolti(m.actions) : m.actions;
      return azioni === m.actions ? m : { ...m, actions: azioni };
    }),
    nuova: !chatMsgs.length,
    tutti,
    token: f.token,
  };
}

function azzeraAncore() {
  ancore.normale = null;
  ancore.incognito = null;
}

module.exports = { ricordaEsiti, ricordaImmagini, conFotoInMemoria, dimentica, dimenticaIncognito, messaggiDelFilo, messaggiDi, componi, senzaDomanda, codaDellaScheda, esitiDellaScheda, azzeraAncore };
globalThis.SN_CONTESTO_FILO = module.exports;
