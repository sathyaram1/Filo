// Il contesto della chat letto dal filo (#868): gli ultimi giorni di conversazioni di tutte le schede, gli esiti
// delle letture recenti e il punto d'inizio che si tiene fra un turno e l'altro. Logica pura in
// src/shared/filoContesto.js; i pezzi vecchi li ripesca src/main/services/ricordiFilo.js.

'use strict';

const FC = () => globalThis.SN_FILO_CONTESTO;
const F = () => globalThis.SN_IL_FILO;

// Gli esiti delle azioni (pagine e documenti letti, comandi, ricerche) restano in memoria, mai su disco: entrano nel
// contesto finché il loro messaggio è fra gli ultimi venti del filo, in qualunque scheda (#553.2, #587).
const MAX_ESITI = 300;
const esiti = new Map();

function ricordaEsiti(chat, ts, { azioni, reasoningDetails } = {}) {
  if (!chat || !ts) return;
  const lista = (Array.isArray(azioni) ? azioni : []).filter((a) => a && a.type);
  const rd = Array.isArray(reasoningDetails) && reasoningDetails.length ? reasoningDetails : null;
  if (!lista.length && !rd) return;
  const k = `${chat}|${ts}`;
  esiti.delete(k);
  esiti.set(k, { azioni: lista, ...(rd ? { reasoningDetails: rd } : {}) });
  while (esiti.size > MAX_ESITI) esiti.delete(esiti.keys().next().value);
}

function dimentica(chat) {
  if (!chat) { esiti.clear(); return; }
  for (const k of [...esiti.keys()]) if (k.startsWith(`${chat}|`)) esiti.delete(k);
}

// Tutto il filo in messaggi, in ordine di tempo. A parità d'ora decide la conversazione: lo stesso ordine a ogni turno.
async function messaggiDelFilo(opts) {
  const chats = await F().chats(opts);
  const out = [];
  for (const c of chats) {
    (c.messages || []).forEach((m, i) => {
      if (!m) return;
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
  if (!chatId) return lista;
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
  const ultimo = chatMsgs[chatMsgs.length - 1] || null;
  const coda = [];
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i];
    if (!m) continue;
    if (ultimo && stesso(m, ultimo) && !m.interrotto) break;
    if (!ultimo && !m.interrotto && !m.interno) continue;
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
    if (Array.isArray(m.actions) && m.actions.some((a) => a && a._output)) out.set(FC().chiave(chatMsgs[k]), { azioni: m.actions });
    j = k - 1;
  }
  return out;
}

const ancore = { normale: null, incognito: null };

// `osserva(azioni)` scrive gli esiti per il modello (handlers.js). Ritorna il tratto da mandare e quello che serve alle
// uscite: le azioni il cui esito arriva al modello, i messaggi che porta (letti, voce dell'utente), i più vecchi.
async function componi({ chatId = null, userMessage = '', storia = [], incognito = false, tetti, osserva, ora = Date.now() } = {}) {
  const tutti = senzaDomanda(await messaggiDelFilo({ incognito }), chatId, userMessage);
  const chatMsgs = chatId ? tutti.filter((m) => m.chat === chatId) : [];
  const dallaScheda = esitiDellaScheda(storia, chatMsgs);
  const lato = incognito ? 'incognito' : 'normale';
  const f = FC().finestra(tutti, {
    ora,
    giorni: tetti.giorni,
    token: tetti.token,
    ancora: ancore[lato],
    chatCorrente: chatId,
    esiti: (m) => dallaScheda.get(FC().chiave(m)) || esiti.get(FC().chiave(m)) || null,
    osserva,
  });
  ancore[lato] = f.ancora;
  // Il ragionamento dell'ultimo turno torna al modello solo sull'ultima risposta di questa scheda: più indietro
  // cambierebbe a ogni turno un messaggio già in cache.
  const ultimaFilo = f.visti.length ? f.visti.length - 1 : -1;
  if (ultimaFilo >= 0) {
    const m = f.visti[ultimaFilo];
    const e = m.role === 'filo' && m.chat === chatId ? esiti.get(FC().chiave(m)) : null;
    if (e && e.reasoningDetails) f.messaggi[ultimaFilo] = { ...f.messaggi[ultimaFilo], reasoning_details: e.reasoningDetails };
  }
  return {
    messaggi: f.messaggi,
    visti: f.visti,
    azioni: f.azioni,
    vecchi: f.vecchi,
    coda: codaDellaScheda(storia, chatMsgs),
    nuova: !chatMsgs.length,
    tutti,
    token: f.token,
  };
}

function azzeraAncore() {
  ancore.normale = null;
  ancore.incognito = null;
}

module.exports = { ricordaEsiti, dimentica, messaggiDelFilo, componi, senzaDomanda, codaDellaScheda, esitiDellaScheda, azzeraAncore };
globalThis.SN_CONTESTO_FILO = module.exports;
