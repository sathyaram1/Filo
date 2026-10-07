// Handler di dominio: deck builder Commander (DECK-BUILDER-SPEC.md).
// CRUD dei mazzi su storage locale (deckStore). La logica di modello (versione
// che incrementa a ogni edit, invarianti) è in SN_DECKS: la pagina applica le
// funzioni di modello e manda qui il mazzo intero da persistere (DECKS_UPDATE).

module.exports = function register(on, ctx) {
  const { MSG, handleAIRequest, broadcastToFiloPages } = ctx;
  const Store = globalThis.SN_DECK_STORE;
  const Opinions = globalThis.SN_DECK_OPINIONS_SVC;
  const Chats = globalThis.SN_DECK_CHATS_SVC;
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
    // Mazzo eliminato → via anche i suoi pareri cacheati e la sua chat (la cache tag resta:
    // è per carta, cross-mazzo). Best-effort: il delete non deve fallire per questo.
    if (removed) {
      await Opinions.dropDeck(id).catch(() => {});
      await Chats.dropDeck(id).catch(() => {});
    }
    return { ok: removed, ...(removed ? {} : { error: 'not_found' }) };
  });

  // ── Chat per mazzo (§3.2) ─────────────────────────────────────────────────
  // Solo le pagine filo:// (la chat la scrive la pagina dei mazzi); un sito non ha niente da leggere né da scrivere qui.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  const changed = (deckId, clientId) => broadcastToFiloPages({
    type: MSG.DECKS_CHAT_CHANGED, deckId, clientId: String(clientId || ''),
  });

  on(MSG.DECKS_CHAT_GET, async (msg, _sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    return { ok: true, messages: await Chats.get(String(msg?.deckId || '')) };
  });

  on(MSG.DECKS_CHAT_EDIT, async (msg, sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const deckId = String(msg?.deckId || '');
    const change = {
      op: String(msg?.op || ''), messages: msg?.messages, turn: msg?.turn, message: msg?.message,
      userText: msg?.userText, nameIds: msg?.nameIds, sort: msg?.sort,
    };
    // Pagina ricaricata o chiusa col turno ancora atteso: le altre schede rileggono e lo trovano interrotto.
    const r = await Chats.edit(deckId, change, { wc: sender && sender.wc, onAbandon: () => changed(deckId, '') });
    if (r.ok) changed(deckId, msg?.clientId);
    return r;
  });

  on(MSG.DECKS_CHAT_CLEAR, async (msg, _sender, origin) => {
    if (!isFilo(origin)) return { ok: false, error: 'forbidden' };
    const deckId = String(msg?.deckId || '');
    await Chats.dropDeck(deckId);
    changed(deckId, msg?.clientId);
    return { ok: true };
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
