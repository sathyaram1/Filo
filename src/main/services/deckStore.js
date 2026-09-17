// Persistenza dei mazzi Commander (DECK-BUILDER-SPEC.md §13.1), storage solo locale.
// Qui SOLO lettura/scrittura: creazione, invarianti e versione in src/shared/decks.js.

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;
  const Decks = global.SN_DECKS;

  async function list() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.DECKS);
    const arr = res[STORAGE_KEYS.DECKS];
    if (!Array.isArray(arr)) return [];
    return arr.map((d) => Decks.sanitizeDeck(d)).filter(Boolean);
  }

  async function saveAll(decks) {
    await chrome.storage.local.set({ [STORAGE_KEYS.DECKS]: decks });
  }

  async function get(id) {
    const decks = await list();
    return decks.find((d) => d.id === id) || null;
  }

  async function create({ nome } = {}) {
    const decks = await list();
    const deck = Decks.newDeck({ nome });
    decks.push(deck);
    await saveAll(decks);
    return deck;
  }

  // Il chiamante ha già applicato le funzioni di modello, versione compresa.
  async function put(deck) {
    const clean = Decks.sanitizeDeck(deck);
    if (!clean) return null;
    const decks = await list();
    const i = decks.findIndex((d) => d.id === clean.id);
    if (i < 0) return null;
    decks[i] = clean;
    await saveAll(decks);
    return clean;
  }

  async function remove(id) {
    const decks = await list();
    const next = decks.filter((d) => d.id !== id);
    if (next.length === decks.length) return false;
    await saveAll(next);
    return true;
  }

  async function duplicate(id) {
    const decks = await list();
    const src = decks.find((d) => d.id === id);
    if (!src) return null;
    const copy = Decks.duplicateDeck(src);
    decks.push(copy);
    await saveAll(decks);
    return copy;
  }

  global.SN_DECK_STORE = { list, get, create, put, remove, duplicate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
