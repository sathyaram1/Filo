// Handler di dominio: client Scryfall per il deck builder (§13.2) + commander.
// La pagina non parla mai con Scryfall direttamente: passa da qui, così rate
// limit e cache sono condivisi fra tutte le superfici.

module.exports = function register(on, ctx) {
  const { MSG, handleAIRequest } = ctx;
  const Scry = globalThis.SN_SCRYFALL;
  const Decks = globalThis.SN_DECKS;
  const Store = globalThis.SN_DECK_STORE;
  const Q = globalThis.SN_SCRYFALL_Q;
  const { ACTIONS, PROMPTS } = globalThis.SN_CONST;

  // Identity del mazzo per il filtro automatico (§4): dai colori del
  // commander. Senza commander nessun vincolo (si cerca in tutto Scryfall).
  async function identityOf(deckId) {
    if (!deckId) return null;
    const deck = await Store.get(String(deckId));
    const colors = deck && deck.commanderMeta && deck.commanderMeta.colors;
    return Array.isArray(colors) ? colors : null;
  }

  on(MSG.SCRYFALL_SEARCH, async (msg) => {
    try {
      const identity = await identityOf(msg?.deckId);
      const r = await Scry.search(String(msg?.query || ''), { identity });
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e?.message || 'ricerca fallita' };
    }
  });

  on(MSG.SCRYFALL_NAMED, async (msg) => {
    try {
      const card = await Scry.named(msg?.name);
      return card ? { ok: true, card } : { ok: false, error: 'not_found' };
    } catch (e) {
      return { ok: false, error: e?.message || 'lookup fallito' };
    }
  });

  on(MSG.SCRYFALL_CARDS, async (msg) => {
    try {
      const maxAgeMs = msg?.freshPrices ? Scry.PRICE_TTL_MS : Infinity;
      const cards = await Scry.cards(msg?.ids || [], { maxAgeMs });
      return { ok: true, cards };
    } catch (e) {
      return { ok: false, error: e?.message || 'fetch carte fallito' };
    }
  });

  on(MSG.SCRYFALL_SYMBOLS, async () => {
    try {
      return { ok: true, symbols: await Scry.symbols() };
    } catch (e) {
      return { ok: false, error: e?.message || 'symbology non disponibile' };
    }
  });

  // Imposta il commander (§8.4): risolve la carta, scrive id + meta di
  // presentazione (nome, color identity, art crop) e incrementa la versione.
  // La legalità (banned/non leggendaria) NON blocca qui: è una riga delle
  // statistiche (§9.1), non un divieto d'inserimento.
  on(MSG.DECKS_SET_COMMANDER, async (msg) => {
    const deck = await Store.get(String(msg?.id || ''));
    if (!deck) return { ok: false, error: 'not_found' };
    try {
      const card = await Scry.card(String(msg?.scryfallId || ''));
      if (!card) return { ok: false, error: 'card_not_found' };
      const next = Decks.setCommander(deck, card.id, {
        name: card.name,
        colors: card.colorIdentity,
        artCrop: card.artCrop,
      });
      const saved = await Store.put(next);
      return saved ? { ok: true, deck: saved } : { ok: false, error: 'save_failed' };
    } catch (e) {
      return { ok: false, error: e?.message || 'set commander fallito' };
    }
  });
};
