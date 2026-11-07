// La risposta a un messaggio preciso (#1620): il riferimento che il messaggio dell'utente si porta dietro e come lo si
// ritrova nel filo. Logica pura: il disegno sta in src/pages/dashboard/dashboard-rispondi.js, come lo legge il modello
// in src/shared/filoContesto.js (notaRisposta). Sentinella: tests/unit/rispostaA.test.mjs.

(function (global) {
  'use strict';

  // Il messaggio citato si salva come posto nel filo (chat e indice), mai come copia: cancellata la sua chat, una citazione
  // in un'altra non lo tiene in vita. Il testo si salva solo di una bolla che il filo non ha (un errore, un avviso).
  const ID_CHAT = /^[\w.:-]{1,80}$/;
  // La bolla ne mostra due righe; il modello di solito l'ha ancora davanti, e oltre il tetto ha l'ora per ritrovarla.
  const ANTEPRIMA = 400;
  const PER_IL_MODELLO = 1200;
  // Quanto della bolla la pagina manda per ritrovarne il posto quando non lo sa ancora: una risposta intera.
  const PER_CERCARE = 50000;

  const testoDi = (v) => String(v == null ? '' : v);
  const piano = (s) => testoDi(s).replace(/\s+/g, ' ').trim();

  function taglia(s, max) {
    const t = testoDi(s).trim();
    return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
  }

  // Quello che si salva col messaggio: `{ chat, i, ts }`, o `{ testo }` per una bolla che il filo non ha. Altro, niente.
  function riferimento(r) {
    if (!r || typeof r !== 'object') return null;
    const chat = typeof r.chat === 'string' && ID_CHAT.test(r.chat) ? r.chat : '';
    const i = Number.isInteger(r.i) && r.i >= 0 ? r.i : null;
    if (chat && i != null) {
      const ts = typeof r.ts === 'string' && Number.isFinite(Date.parse(r.ts)) ? r.ts : '';
      return { chat, i, ...(ts ? { ts } : {}) };
    }
    const testo = taglia(r.testo, PER_IL_MODELLO);
    return testo ? { testo } : null;
  }

  // Il posto nella chat della risposta citata: quello che la pagina conosce se il testo è ancora quello, se no l'ultima
  // risposta di Filo con lo stesso testo (la bolla appena scritta non ha ancora il suo posto). -1 se non c'è.
  function posto(chat, { i = null, testo = '' } = {}) {
    const msgs = chat && Array.isArray(chat.messages) ? chat.messages : [];
    const t = piano(testo);
    const valido = Number.isInteger(i) && i >= 0 && i < msgs.length && !!msgs[i];
    if (valido && (!t || piano(msgs[i].text) === t)) return i;
    if (t) {
      for (let k = msgs.length - 1; k >= 0; k--) {
        const m = msgs[k];
        if (m && m.role !== 'user' && piano(m.text) === t) return k;
      }
    }
    return valido ? i : -1;
  }

  // La citazione come la vede chi la legge: `trovaChat(id)` dà la chat dal filo. Una chat che il filo non ha più (tolta o
  // nascosta) lascia la citazione senza testo: `manca`.
  function risolvi(ref, trovaChat, { max = ANTEPRIMA } = {}) {
    const r = riferimento(ref);
    if (!r) return null;
    if (r.testo != null) return { role: 'filo', testo: taglia(r.testo, max) };
    let c = null;
    try { c = typeof trovaChat === 'function' ? trovaChat(r.chat) : null; } catch (_) { c = null; }
    const m = c && Array.isArray(c.messages) ? c.messages[r.i] : null;
    if (!m) return { ...r, manca: true };
    return {
      chat: r.chat, i: r.i, ts: typeof m.ts === 'string' ? m.ts : (r.ts || ''),
      role: m.role === 'user' ? 'user' : 'filo',
      testo: taglia(m.text, max),
      ...(typeof m.esterno === 'string' && m.esterno ? { esterno: m.esterno } : {}),
    };
  }

  // Quello che la pagina manda: il posto se lo sa, e il testo della bolla per ritrovarlo o per stare al suo posto.
  function daPagina(r) {
    if (!r || typeof r !== 'object') return null;
    const chat = typeof r.chat === 'string' && ID_CHAT.test(r.chat) ? r.chat : '';
    const i = Number.isInteger(r.i) && r.i >= 0 ? r.i : null;
    const testo = testoDi(r.testo).slice(0, PER_CERCARE);
    if (!chat && !testo.trim()) return null;
    return { ...(chat ? { chat } : {}), ...(i != null ? { i } : {}), testo };
  }

  global.SN_RISPOSTA_A = { ANTEPRIMA, PER_IL_MODELLO, PER_CERCARE, riferimento, posto, risolvi, daPagina, taglia };
})(typeof globalThis !== 'undefined' ? globalThis : self);
