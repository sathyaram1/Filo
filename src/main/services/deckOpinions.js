// Pareri LLM e auto-tag del deck builder (DECK-BUILDER-SPEC.md §6-§7) —
// parte I/O, main process. La logica pura (staleness, parsing, piano di
// tagging con cache) è in SN_DECK_OPINIONS (src/shared/deckOpinions.js).
//
// Cache (§6.2, §13.3):
//   - pareri:   STORAGE_KEYS.DECK_OPINIONS  { deckId → { cardId → { text, versione, at } } }
//               un parere per (carta, mazzo); si SOSTITUISCE al ricalcolo, non
//               si cancella quando diventa stantio (resta visibile marcato).
//   - tag:      STORAGE_KEYS.DECK_TAG_CACHE { cardId → { tag → bool } }
//               SOLO tag context-free: permanente e condivisa fra i mazzi.
//
// Economia (§6.3): mai chiamate spontanee — si calcola solo ciò che il
// chiamante chiede (hover col modulo attivo, aggiunta al mazzo, batch
// esplicito). Il batch è UNA chiamata LLM per tutte le carte richieste.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, ACTIONS, PROMPTS } = global.SN_CONST;
  const P = global.SN_DECK_OPINIONS;
  const Q = global.SN_SCRYFALL_Q;

  // Tetto di carte per batch: un mazzo Commander è ≤100; oltre è un errore del
  // chiamante, non un caso d'uso.
  const MAX_BATCH = 120;

  async function readOpinions() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.DECK_OPINIONS);
    const map = r[STORAGE_KEYS.DECK_OPINIONS];
    return map && typeof map === 'object' ? map : {};
  }

  async function readTagCache() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.DECK_TAG_CACHE);
    const map = r[STORAGE_KEYS.DECK_TAG_CACHE];
    return map && typeof map === 'object' ? map : {};
  }

  async function readSearchCache() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.DECK_SEARCH_CACHE);
    const map = r[STORAGE_KEYS.DECK_SEARCH_CACHE];
    return map && typeof map === 'object' ? map : {};
  }

  function withStale(entry, deck) {
    return { text: entry.text, versione: entry.versione, stale: P.isStale(entry, deck) };
  }

  // Pareri già in cache per gli id dati (mai LLM). { cardId → {text, versione, stale} }.
  async function getOpinions(deck, cardIds) {
    const all = await readOpinions();
    const byDeck = all[deck.id] || {};
    const out = {};
    for (const id of cardIds) if (byDeck[id]) out[id] = withStale(byDeck[id], deck);
    return out;
  }

  // Riga di contesto per il prompt: la carta come la vede l'LLM.
  function cardPromptLine(card) {
    const parts = [
      `- [id: ${card.id}] ${card.name}`,
      card.manaCost ? `costo ${card.manaCost}` : '',
      card.typeLine,
      card.oracleText ? `— ${card.oracleText.replace(/\n/g, ' ')}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function deckListForPrompt(deck, cards) {
    return deck.carte.map((c) => {
      const name = (cards[c.scryfall_id] && cards[c.scryfall_id].name) || c.scryfall_id;
      const tags = c.tags && c.tags.length ? ` — tag: ${c.tags.join(', ')}` : '';
      return `  - ${name}${tags}`;
    }).join('\n');
  }

  // Calcola (o ricalcola) i pareri per gli id dati. UNA chiamata LLM per i
  // soli id da (ri)fare secondo `mode`:
  //   'missing' (default) — solo i pareri ASSENTI: uno stantio resta com'è,
  //                         visibile e marcato (§6.2: refresh mai automatico);
  //   'stale'             — assenti + stantii (il "batch completo su
  //                         richiesta": "valuta il mazzo");
  //   'force'             — tutti (refresh esplicito della singola carta).
  // Ritorna { opinions: { cardId → {text, versione, stale} }, sintesi, computed }.
  async function computeOpinions({ deck, cards, cardIds, mode = 'missing', wantSintesi = false, handleAIRequest }) {
    const ids = [...new Set((cardIds || []).map(String).filter((id) => cards[id]))].slice(0, MAX_BATCH);
    const all = await readOpinions();
    const byDeck = all[deck.id] || {};
    const need = ids.filter((id) => {
      const e = byDeck[id];
      if (!e) return true;
      if (mode === 'force') return true;
      if (mode === 'stale') return P.isStale(e, deck);
      return false;
    });
    let sintesi = '';
    if (need.length) {
      const identity = deck.commanderMeta && Array.isArray(deck.commanderMeta.colors)
        ? Q.identityCode(deck.commanderMeta.colors) : '';
      const sys = PROMPTS.decksOpinion({
        deckName: deck.nome,
        commanderName: deck.commanderMeta && deck.commanderMeta.name,
        identity,
        deckList: deckListForPrompt(deck, cards),
        cards: need.map((id) => cardPromptLine(cards[id])).join('\n'),
        wantSintesi,
      });
      const r = await handleAIRequest({
        action: ACTIONS.DECKS_OPINION,
        payload: { messages: [{ role: 'user', content: sys }] },
        origin: 'filo://decks',
      });
      const parsed = P.parseOpinionBatch(r.text);
      sintesi = parsed.sintesi;
      const t = Date.now();
      for (const [id, text] of Object.entries(parsed.opinions)) {
        if (!need.includes(id)) continue; // mai id inventati dall'LLM
        byDeck[id] = { text, versione: deck.versione, at: t };
      }
      all[deck.id] = byDeck;
      await chrome.storage.local.set({ [STORAGE_KEYS.DECK_OPINIONS]: all });
    }
    const out = {};
    for (const id of ids) if (byDeck[id]) out[id] = withStale(byDeck[id], deck);
    return { opinions: out, sintesi, computed: need.length };
  }

  // Il mazzo è stato eliminato: via anche i suoi pareri (la cache tag resta:
  // è per carta, cross-mazzo).
  async function dropDeck(deckId) {
    const all = await readOpinions();
    if (!all[deckId]) return;
    delete all[deckId];
    await chrome.storage.local.set({ [STORAGE_KEYS.DECK_OPINIONS]: all });
  }

  // Auto-tag (§7): giudica carta-per-tag col modello economico, riusando la
  // cache (carta, tag) per i tag context-free. Ritorna il mazzo con i tag
  // applicati (NON salvato: il chiamante persiste) + conteggi per la reply.
  async function autoTag({ deck, cards, tags, handleAIRequest }) {
    const norm = (tags || []).map(P.normTag).filter(Boolean);
    if (!norm.length || !deck.carte.length) {
      return { deck, changed: false, taggedCount: 0, judgedCount: 0, fromCacheCount: 0 };
    }
    const cardIds = deck.carte.map((c) => c.scryfall_id).filter((id) => cards[id]);
    const tagCache = await readTagCache();
    const plan = P.planTagJudgments({ cardIds, tags: norm, tagCache });

    let judged = {};
    if (plan.judgeIds.length) {
      const sys = PROMPTS.decksAutoTag({
        deckName: deck.nome,
        commanderName: deck.commanderMeta && deck.commanderMeta.name,
        tags: norm.join(', '),
        cards: plan.judgeIds.map((id) => cardPromptLine(cards[id])).join('\n'),
      });
      const r = await handleAIRequest({
        action: ACTIONS.DECKS_AUTOTAG,
        payload: { messages: [{ role: 'user', content: sys }] },
        origin: 'filo://decks',
      });
      const raw = P.parseTagBatch(r.text);
      // Solo id davvero richiesti e solo tag davvero richiesti.
      for (const [id, ts] of Object.entries(raw)) {
        if (!plan.judgeIds.includes(id)) continue;
        judged[id] = ts.filter((t) => norm.includes(t));
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.DECK_TAG_CACHE]: P.updateTagCache(tagCache, norm, judged),
      });
    }

    const membership = { ...plan.membershipFromCache, ...judged };
    const applied = P.applyTagMembership(deck, norm, membership);
    return {
      deck: applied.deck,
      changed: applied.changed,
      taggedCount: applied.taggedCount,
      judgedCount: plan.judgeIds.length,
      fromCacheCount: Object.keys(plan.membershipFromCache).length,
    };
  }

  // Filtro semantico dei risultati di ricerca (§4.1): dato l'ordine dei
  // candidati (già filtrati per colore da Scryfall) e un criterio in
  // linguaggio naturale, tiene solo le carte che lo rispettano. UNA sola
  // chiamata LLM per i soli id NON ancora in cache per quel criterio; il
  // giudizio (carta, criterio) → bool è cacheato permanentemente cross-ricerca.
  // `cards` è la mappa id → card (per il testo Oracle nel prompt).
  // Ritorna { keepIds, judgedCount, fromCacheCount }: keepIds preserva l'ordine
  // dei candidati. Se il criterio è vuoto, non filtra (tiene tutto).
  async function filterSearch({ criterion, cardIds, cards, handleAIRequest }) {
    const ids = (cardIds || []).map(String).filter((id) => cards && cards[id]);
    const crit = P.normCriterion(criterion);
    if (!crit || !ids.length) return { keepIds: ids, judgedCount: 0, fromCacheCount: 0 };

    const cache = await readSearchCache();
    const plan = P.planSearchFilter({ cardIds: ids, criterion: crit, searchCache: cache });

    let judged = {};
    let keptFresh = new Set();
    if (plan.judgeIds.length) {
      const toJudge = plan.judgeIds.slice(0, MAX_BATCH);
      const sys = PROMPTS.decksSearchFilter({
        criterion,
        cards: toJudge.map((id) => cardPromptLine(cards[id])).join('\n'),
      });
      const r = await handleAIRequest({
        action: ACTIONS.DECKS_SEARCH_FILTER,
        payload: { messages: [{ role: 'user', content: sys }] },
        origin: 'filo://decks',
      });
      keptFresh = P.parseSearchKeep(r.text, toJudge);
      for (const id of toJudge) judged[id] = keptFresh.has(id);
      await chrome.storage.local.set({
        [STORAGE_KEYS.DECK_SEARCH_CACHE]: P.updateSearchCache(cache, crit, judged),
      });
    }

    const keepSet = new Set([...plan.keepFromCache, ...Object.keys(judged).filter((id) => judged[id])]);
    // Preserva l'ordine originale dei candidati.
    const keepIds = ids.filter((id) => keepSet.has(id));
    return {
      keepIds,
      judgedCount: plan.judgeIds.length,
      fromCacheCount: plan.keepFromCache.length + (ids.length - plan.judgeIds.length - plan.keepFromCache.length),
    };
  }

  global.SN_DECK_OPINIONS_SVC = { getOpinions, computeOpinions, autoTag, dropDeck, filterSearch };
})(typeof globalThis !== 'undefined' ? globalThis : self);
