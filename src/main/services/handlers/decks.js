// Deck builder Commander: CRUD dei mazzi su storage locale.
// La logica di modello (versione, invarianti) sta in SN_DECKS: qui arriva il mazzo intero.

module.exports = function register(on, ctx) {
  const { MSG, handleAIRequest } = ctx;
  const Store = globalThis.SN_DECK_STORE;
  const Opinions = globalThis.SN_DECK_OPINIONS_SVC;
  const Scry = globalThis.SN_SCRYFALL;

  on(MSG.DECKS_LIST, async () => {
    const decks = await Store.list();
    return { ok: true, decks };
  });

  on(MSG.DECKS_GET, async (msg) => {
    const deck = await Store.get(String(msg?.id || ''));
    return deck ? { ok: true, deck } : { ok: false, error: 'not_found' };
  });

  on(MSG.DECKS_CREATE, async (msg) => {
    const deck = await Store.create({ nome: msg?.nome });
    return { ok: true, deck };
  });

  on(MSG.DECKS_UPDATE, async (msg) => {
    const saved = await Store.put(msg?.deck);
    return saved ? { ok: true, deck: saved } : { ok: false, error: 'not_found' };
  });

  on(MSG.DECKS_DELETE, async (msg) => {
    const id = String(msg?.id || '');
    const removed = await Store.remove(id);
    // Via i pareri del mazzo, non la cache dei tag (è per carta). Best-effort: il delete non
    // deve fallire per questo.
    if (removed) await Opinions.dropDeck(id).catch(() => {});
    return { ok: removed, ...(removed ? {} : { error: 'not_found' }) };
  });

  on(MSG.DECKS_DUPLICATE, async (msg) => {
    const copy = await Store.duplicate(String(msg?.id || ''));
    return copy ? { ok: true, deck: copy } : { ok: false, error: 'not_found' };
  });

  // compute=false: solo cache, MAI una chiamata LLM; compute=true calcola i mancanti in un
  // batch; refresh=true rifà anche i freschi. Le carte possono non essere nel mazzo.
  on(MSG.DECKS_OPINION, async (msg) => {
    try {
      const deck = await Store.get(String(msg?.deckId || ''));
      if (!deck) return { ok: false, error: 'not_found' };
      const ids = [...new Set((Array.isArray(msg?.cardIds) ? msg.cardIds : [])
        .map(String).filter(Boolean))];
      if (!ids.length) return { ok: true, opinions: {} };
      if (!msg?.compute) {
        return { ok: true, opinions: await Opinions.getOpinions(deck, ids) };
      }
      const cards = await Scry.cards(ids).catch(() => ({}));
      const r = await Opinions.computeOpinions({
        deck, cards, cardIds: ids, mode: msg?.refresh ? 'force' : 'missing', handleAIRequest,
      });
      return { ok: true, opinions: r.opinions };
    } catch (e) {
      return { ok: false, error: e?.message || 'parere non disponibile' };
    }
  });
};
