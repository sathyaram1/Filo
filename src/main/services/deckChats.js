// Magazzino della chat per mazzo (DECK-BUILDER-SPEC.md §3.2): STORAGE_KEYS.DECK_CHATS su chrome.storage.local.
// Cosa si conserva lo decide SN_DECK_CHAT; qui solo lettura/scrittura, in fila
// (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).

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

  async function get(deckId) {
    const all = await readAll();
    const entry = all[deckId];
    return Chat.cleanChat(entry && entry.messages);
  }

  // Il controllo che il mazzo esista sta DENTRO la fila: una risposta che arriva dopo l'eliminazione del mazzo
  // non deve far rinascere la sua chat (dropDeck è in fila dopo di lei, o lei trova il mazzo già sparito).
  function save(deckId, messages) {
    return inCoda(async () => {
      const deck = await global.SN_DECK_STORE.get(deckId);
      if (!deck) return { ok: false, error: 'not_found' };
      const clean = Chat.cleanChat(messages);
      if (!Chat.fits(clean)) return { ok: false, error: 'too_many', max: Chat.MAX_MESSAGES };
      const all = await readAll();
      if (clean.length) all[deckId] = { messages: clean, updatedAt: Date.now() };
      else if (all[deckId]) delete all[deckId];
      else return { ok: true };
      await chrome.storage.local.set({ [STORAGE_KEYS.DECK_CHATS]: all });
      return { ok: true };
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

  global.SN_DECK_CHATS_SVC = { get, save, dropDeck };
})(typeof globalThis !== 'undefined' ? globalThis : self);
