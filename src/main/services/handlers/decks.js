// Handler di dominio: deck builder Commander (DECK-BUILDER-SPEC.md).
// CRUD dei mazzi su storage locale (deckStore). La logica di modello (versione
// che incrementa a ogni edit, invarianti) è in SN_DECKS: la pagina applica le
// funzioni di modello e manda qui il mazzo intero da persistere (DECKS_UPDATE).

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
    // Mazzo eliminato → via anche i suoi pareri cacheati (la cache tag resta:
    // è per carta, cross-mazzo). Best-effort: il delete non deve fallire per questo.
    if (removed) await Opinions.dropDeck(id).catch(() => {});
    return { ok: removed, ...(removed ? {} : { error: 'not_found' }) };
  });

  on(MSG.DECKS_DUPLICATE, async (msg) => {
    const copy = await Store.duplicate(String(msg?.id || ''));
    return copy ? { ok: true, deck: copy } : { ok: false, error: 'not_found' };
  });

  // ── Parere LLM carta-vs-mazzo (§6) ─────────────────────────────────────────
  // { deckId, cardIds, compute?, refresh? } →
  // { ok, opinions: { cardId → { text, versione, stale } } }.
  // compute=false: solo cache, MAI una chiamata LLM (per mostrare lo stato).
  // compute=true: calcola i mancanti/stantii in UN batch; refresh=true ricalcola
  // anche i freschi (il refresh on-demand di §6.2). Le carte possono anche NON
  // essere nel mazzo (candidati dai risultati di ricerca: il parere è proprio
  // "questa carta serve a questo mazzo?").
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
