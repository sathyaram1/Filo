// Handler di dominio: deck builder Commander (DECK-BUILDER-SPEC.md).
// CRUD dei mazzi su storage locale (deckStore). La logica di modello (versione
// che incrementa a ogni edit, invarianti) è in SN_DECKS: la pagina applica le
// funzioni di modello e manda qui il mazzo intero da persistere (DECKS_UPDATE).

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const Store = globalThis.SN_DECK_STORE;

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
    const removed = await Store.remove(String(msg?.id || ''));
    return { ok: removed, ...(removed ? {} : { error: 'not_found' }) };
  });

  on(MSG.DECKS_DUPLICATE, async (msg) => {
    const copy = await Store.duplicate(String(msg?.id || ''));
    return copy ? { ok: true, deck: copy } : { ok: false, error: 'not_found' };
  });
};
