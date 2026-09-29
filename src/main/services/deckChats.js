// Magazzino della chat per mazzo (DECK-BUILDER-SPEC.md §3.2): STORAGE_KEYS.DECK_CHATS su chrome.storage.local.
// Cosa si conserva e come si applica una modifica lo decide SN_DECK_CHAT; qui solo lettura/scrittura, in fila
// (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md), e i turni ancora attesi.

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;
  const Chat = global.SN_DECK_CHAT;

  let coda = Promise.resolve();
  function inCoda(fn) {
    const risultato = coda.then(fn, fn);
    coda = risultato.then(() => {}, () => {});
    return risultato;
  }

  async function readAll() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.DECK_CHATS);
    const map = r[STORAGE_KEYS.DECK_CHATS];
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  // Turni che una pagina viva sta aspettando. Solo in memoria: dopo un riavvio nessuno aspetta più niente. Una
  // pagina ricaricata, chiusa o andata altrove non completerà mai il suo turno: lo si chiude qui e si avvisa.
  const live = new Map(); // turno → togli gli ascoltatori

  function endTurn(turn) {
    const stop = live.get(turn);
    if (!stop) return false;
    live.delete(turn);
    stop();
    return true;
  }

  function watchTurn(turn, wc, onAbandon) {
    if (!turn || live.has(turn)) return;
    const abandon = () => { if (endTurn(turn) && onAbandon) onAbandon(); };
    // Un cambio di hash (#/deck/…) è la stessa pagina che continua ad aspettare: conta solo un documento nuovo.
    const onNav = (e, _url, isInPlace, isMainFrame) => {
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (main && !same) abandon();
    };
    let stop = () => {};
    if (wc && typeof wc.on === 'function') {
      try { wc.on('did-start-navigation', onNav); wc.once('destroyed', abandon); } catch (_) {}
      stop = () => {
        try { wc.removeListener('did-start-navigation', onNav); wc.removeListener('destroyed', abandon); } catch (_) {}
      };
    }
    live.set(turn, stop);
  }

  function isLive(turn) { return live.has(turn); }

  async function get(deckId) {
    const all = await readAll();
    const entry = all[deckId];
    return Chat.forReading(entry && entry.messages, isLive);
  }

  // Il controllo che il mazzo esista sta DENTRO la fila: una risposta che arriva dopo l'eliminazione del mazzo
  // non deve far rinascere la sua chat (dropDeck è in fila dopo di lei, o lei trova il mazzo già sparito).
  // Il turno nuovo è atteso da subito, prima della scrittura: chi rilegge all'avviso lo trova «sta pensando».
  function edit(deckId, change, { wc, onAbandon } = {}) {
    const c = change && typeof change === 'object' ? change : {};
    if (c.op === 'append') {
      for (const m of Chat.cleanChat(c.messages)) if (m.pending) watchTurn(m.turn, wc, onAbandon);
    }
    return inCoda(async () => {
      try {
        const deck = await global.SN_DECK_STORE.get(deckId);
        if (!deck) return { ok: false, error: 'not_found' };
        const all = await readAll();
        const entry = all[deckId];
        const r = Chat.applyEdit(entry && entry.messages, c);
        if (r.error === 'too_many') return { ok: false, error: 'too_many', max: Chat.MAX_MESSAGES };
        if (r.error) return { ok: false, error: r.error };
        if (r.list.length) all[deckId] = { messages: r.list, updatedAt: Date.now() };
        else if (all[deckId]) delete all[deckId];
        else return { ok: true };
        await chrome.storage.local.set({ [STORAGE_KEYS.DECK_CHATS]: all });
        return { ok: true };
      } finally {
        // Completato o ritirato, il turno non è più atteso: DOPO la scrittura, così nessuno lo legge interrotto.
        if ((c.op === 'fill' || c.op === 'drop') && c.turn) endTurn(String(c.turn));
      }
    });
  }

  function dropDeck(deckId) {
    return inCoda(async () => {
      const all = await readAll();
      if (!all[deckId]) return;
      delete all[deckId];
      await chrome.storage.local.set({ [STORAGE_KEYS.DECK_CHATS]: all });
    });
  }

  global.SN_DECK_CHATS_SVC = { get, edit, dropDeck, isLive };
})(typeof globalThis !== 'undefined' ? globalThis : self);
