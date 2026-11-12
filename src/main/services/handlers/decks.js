// Deck builder Commander: CRUD dei mazzi su storage locale.
// La logica di modello (versione, invarianti) sta in SN_DECKS: qui arriva il mazzo intero.

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

  // Una carta chiesta e tornata senza parere porta il perché: la pagina lo mostra e non la richiede da sola, che
  // coi crediti finiti o un modello che salta la carta era una raffica di chiamate (#1344.1).
  const SENZA_DATI = { error: 'non ho i dati della carta: Scryfall, l\'archivio delle carte, non ha risposto. Riprova tra poco.' };
  const senzaParere = () => ({
    error: `il modello ha risposto senza il parere di questa carta. Riprova, o scegli un altro modello per «Mazzi — parere su una carta» ${globalThis.SN_CHAT_ERRORS.DOVE_ALTRO_MODELLO}.`,
    code: 'ALTRO_MODELLO',
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
      const mancanti = {};
      for (const id of ids) if (!r.opinions[id]) mancanti[id] = cards[id] ? senzaParere() : SENZA_DATI;
      return { ok: true, opinions: r.opinions, ...(Object.keys(mancanti).length ? { mancanti } : {}) };
    } catch (e) {
      // La frase per chi legge, e quello che serve alla pagina per il tasto della pagina dove si rimedia (#663).
      const CE = globalThis.SN_CHAT_ERRORS;
      const W = globalThis.SN_WALLET;
      return {
        ok: false,
        error: (CE ? CE.friendly(e) : '') || 'parere non disponibile',
        ...(e && e.code ? { code: e.code } : {}),
        ...(W && W.keyRefusalOf && W.keyRefusalOf(e) ? { keyRefused: true } : {}),
        ...(e && e.reason === 'crediti' ? { reason: 'crediti' } : {}),
        ...(e && Number(e.maxTokens) > 0 ? { maxTokens: Number(e.maxTokens) } : {}),
        ...(e && e.finishReason ? { finishReason: e.finishReason } : {}),
      };
    }
  });
};
