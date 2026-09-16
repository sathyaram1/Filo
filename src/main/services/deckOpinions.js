// Pareri LLM e auto-tag del deck builder (DECK-BUILDER-SPEC.md §6-§7), parte I/O; la logica pura (staleness, parsing, piano di tagging) è in SN_DECK_OPINIONS.
// Un parere per (carta, mazzo): si SOSTITUISCE al ricalcolo e non si cancella quando diventa stantio (resta visibile marcato). La cache tag è per carta, permanente e condivisa fra i mazzi: solo tag context-free.
// Economia (§6.3): mai chiamate spontanee, si calcola solo ciò che il chiamante chiede, e il batch è UNA chiamata LLM per tutte le carte.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, ACTIONS, PROMPTS } = global.SN_CONST;
  const P = global.SN_DECK_OPINIONS;
  const Q = global.SN_SCRYFALL_Q;

  // Un mazzo Commander è ≤100 carte: oltre il tetto è un errore del chiamante, non un caso d'uso.
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

  // Solo cache, mai LLM.
  async function getOpinions(deck, cardIds) {
    const all = await readOpinions();
    const byDeck = all[deck.id] || {};
    const out = {};
    for (const id of cardIds) if (byDeck[id]) out[id] = withStale(byDeck[id], deck);
    return out;
  }

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

  // mode: 'missing' (default) solo i pareri ASSENTI — uno stantio resta com'è, §6.2: il refresh non è mai automatico; 'stale' assenti + stantii ("valuta il mazzo"); 'force' tutti (refresh esplicito di una carta).
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

  // Mazzo eliminato: via anche i suoi pareri. La cache tag resta, è per carta e cross-mazzo.
  async function dropDeck(deckId) {
    const all = await readOpinions();
    if (!all[deckId]) return;
    delete all[deckId];
    await chrome.storage.local.set({ [STORAGE_KEYS.DECK_OPINIONS]: all });
  }

  // Auto-tag (§7): riusa la cache (carta, tag) per i tag context-free e ritorna il mazzo coi tag applicati ma NON salvato — persiste il chiamante.
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

  // Filtro semantico dei risultati di ricerca (§4.1): UNA chiamata LLM per i soli id non ancora in cache per quel criterio, e il giudizio (carta, criterio) resta cacheato cross-ricerca.
  // Criterio vuoto: non filtra, tiene tutto.
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
    // keepIds preserva l'ordine originale dei candidati.
    const keepIds = ids.filter((id) => keepSet.has(id));
    return {
      keepIds,
      judgedCount: plan.judgeIds.length,
      fromCacheCount: plan.keepFromCache.length + (ids.length - plan.judgeIds.length - plan.keepFromCache.length),
    };
  }

  global.SN_DECK_OPINIONS_SVC = { getOpinions, computeOpinions, autoTag, dropDeck, filterSearch };
})(typeof globalThis !== 'undefined' ? globalThis : self);
