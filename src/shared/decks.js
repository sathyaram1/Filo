// Modello dati dei mazzi Commander (deck builder, DECK-BUILDER-SPEC.md §13.1).
// SOLO logica pura (creazione, patch, invarianti): niente storage, niente
// Electron — la persistenza vive in src/main/services/deckStore.js. Così il
// modello è unit-testabile in millisecondi (tests/unit/decks.test.mjs).
//
// Invariante centrale: `versione` incrementa a OGNI modifica del mazzo — è la
// chiave di invalidazione dei pareri LLM (§6.2): parere cacheato per
// (carta, versione mazzo), marcato stantio quando la versione avanza.

(function (global) {
  'use strict';

  const RAGGRUPPAMENTI = ['tipo', 'tag', 'cmc', 'colore'];

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function nowIso() { return new Date().toISOString(); }

  // Nuovo mazzo vuoto. Il commander è un PARAMETRO del mazzo (§8.4), non una
  // carta dell'elenco: qui è lo scryfall_id (vuoto finché non impostato).
  // `commanderMeta` è la cache di presentazione (nome, colori identity, art
  // crop) scritta quando il commander viene impostato/risolto via Scryfall
  // (task 2): la libreria la usa senza rifare lookup a ogni render.
  function newDeck({ nome } = {}) {
    const t = nowIso();
    return {
      id: uuid(),
      nome: String(nome || '').trim() || 'Nuovo mazzo',
      commander: '',
      commanderMeta: null,
      carte: [],
      raggruppamento: 'tipo',
      budget: null,
      versione: 1,
      created_at: t,
      updated_at: t,
    };
  }

  // Riporta un oggetto letto dallo storage a un mazzo valido (campi mancanti
  // riempiti, tipi corretti). Ritorna null se non è recuperabile (manca l'id).
  function sanitizeDeck(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const carte = Array.isArray(raw.carte) ? raw.carte : [];
    return {
      id: String(raw.id),
      nome: String(raw.nome || '').trim() || 'Mazzo senza nome',
      commander: String(raw.commander || ''),
      commanderMeta: (raw.commanderMeta && typeof raw.commanderMeta === 'object') ? raw.commanderMeta : null,
      carte: carte
        .filter((c) => c && c.scryfall_id)
        .map((c) => ({
          scryfall_id: String(c.scryfall_id),
          qty: Math.max(1, Number(c.qty) || 1),
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
          ...(c.gruppo_override ? { gruppo_override: String(c.gruppo_override) } : {}),
        })),
      raggruppamento: RAGGRUPPAMENTI.includes(raw.raggruppamento) ? raw.raggruppamento : 'tipo',
      budget: (raw.budget === null || raw.budget === undefined || raw.budget === '') ? null : Math.max(0, Number(raw.budget) || 0),
      versione: Math.max(1, Number(raw.versione) || 1),
      created_at: raw.created_at || nowIso(),
      updated_at: raw.updated_at || nowIso(),
    };
  }

  // Ogni edit passa da qui: nuova copia con versione+1 e updated_at fresco.
  function touch(deck) {
    return { ...deck, versione: (Number(deck.versione) || 1) + 1, updated_at: nowIso() };
  }

  // Aggiunge una carta (default qty 1 — singleton salvo basics, che il chiamante
  // segnala con qty espliciti). Se la carta è già presente NON duplica: ritorna
  // { deck, added:false } col mazzo invariato (versione ferma: nessun edit reale).
  function addCard(deck, scryfallId, { qty = 1, tags = [] } = {}) {
    const id = String(scryfallId || '').trim();
    if (!id) return { deck, added: false };
    if (deck.carte.some((c) => c.scryfall_id === id)) return { deck, added: false };
    const next = touch({
      ...deck,
      carte: [...deck.carte, { scryfall_id: id, qty: Math.max(1, Number(qty) || 1), tags: tags.map(String) }],
    });
    return { deck: next, added: true };
  }

  function removeCard(deck, scryfallId) {
    const id = String(scryfallId || '').trim();
    const carte = deck.carte.filter((c) => c.scryfall_id !== id);
    if (carte.length === deck.carte.length) return { deck, removed: false };
    return { deck: touch({ ...deck, carte }), removed: true };
  }

  function renameDeck(deck, nome) {
    const n = String(nome || '').trim();
    if (!n || n === deck.nome) return deck;
    return touch({ ...deck, nome: n });
  }

  function setCommander(deck, scryfallId, meta = null) {
    const id = String(scryfallId || '').trim();
    return touch({ ...deck, commander: id, commanderMeta: meta || null });
  }

  function setBudget(deck, budget) {
    const b = (budget === null || budget === undefined || budget === '') ? null : Math.max(0, Number(budget) || 0);
    return touch({ ...deck, budget: b });
  }

  // Totale carte del mazzo (somma qty): il conteggio /100 della libreria e
  // delle statistiche.
  function deckCount(deck) {
    return deck.carte.reduce((n, c) => n + (Number(c.qty) || 1), 0);
  }

  // Copia per "duplica": nuovo id, nome " (copia)", versione ripartita da 1
  // (i pareri cacheati del mazzo origine non valgono per la copia).
  function duplicateDeck(deck) {
    const t = nowIso();
    return {
      ...deck,
      id: uuid(),
      nome: `${deck.nome} (copia)`,
      carte: deck.carte.map((c) => ({ ...c, tags: [...c.tags] })),
      versione: 1,
      created_at: t,
      updated_at: t,
    };
  }

  // Ordine della libreria: ultima modifica in cima.
  function sortForLibrary(decks) {
    return [...decks].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  global.SN_DECKS = {
    RAGGRUPPAMENTI,
    newDeck,
    sanitizeDeck,
    touch,
    addCard,
    removeCard,
    renameDeck,
    setCommander,
    setBudget,
    deckCount,
    duplicateDeck,
    sortForLibrary,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
