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

  const crypto = require('node:crypto');

  const { STORAGE_KEYS, ACTIONS, PROMPTS } = global.SN_CONST;
  const P = global.SN_DECK_OPINIONS;
  const Q = global.SN_SCRYFALL_Q;

  // Tetto di carte per batch: un mazzo Commander è ≤100; oltre è un errore del
  // chiamante, non un caso d'uso.
  const MAX_BATCH = 120;
  // Candidati per chiamata del giudice: i lotti partono insieme, e uno corto risponde prima e sbaglia meno.
  const FILTER_BATCH = 50;
  const FILTER_PARALLEL = 8;
  const CONFIG_ERRORS = new Set(['NO_MODEL_FOR_ACTION', 'NO_API_KEY', 'LIMIT_REACHED']);
  // Un «troppe richieste» o un servizio sovraccarico si aspetta, con meno lotti insieme. Quando un lotto finisce
  // queste attese (15 s in tutto) il servizio è giù davvero, e gli altri non aspettano più.
  const BUSY_WAITS_MS = [1000, 2000, 4000, 8000];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Giudizi salvati: circa venti ricerche larghe. Oltre si perdono i più vecchi, e rifarne uno costa una chiamata
  // economica; senza tetto ogni ricerca lasciava decine di KB nel file di Filo, per sempre.
  const SEARCH_CACHE_MAX_PAIRS = 20000;
  const SEARCH_CACHE_PER_CARD = 30;

  const digest = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
  // I giudizi salvati valgono per le istruzioni, la forma della riga carta e il modello che li hanno prodotti:
  // cambiato uno dei tre, la cache scade da sé (patterns/una-cache-scade-con-la-richiesta-non-solo-con-l-orologio.md).
  const JUDGE_SAMPLE = { name: 'n', manaCost: '{1}', typeLine: 't', power: '1', toughness: '1', priceEur: 1, oracleText: 'o' };
  function judgeFingerprint(model) {
    return digest(`${PROMPTS.decksSearchFilter({ criterion: '', cards: '' })}\n${judgeCardBody(JUDGE_SAMPLE)}\n${model || ''}`).slice(0, 10);
  }
  // Il giudizio salvato è per la carta COM'ERA quando il giudice l'ha vista: cambiato il prezzo o il testo, si rifà.
  function judgedAs(card) {
    return `${card.id}@${digest(judgeCardBody(card)).slice(0, 8)}`;
  }
  function isBusy(e) {
    const m = /^(?:OpenRouter|Gemini)(?:\s+\S+)?\s+(\d{3})\b/.exec(String((e && e.message) || ''));
    const status = Number(e && e.status) || (m ? Number(m[1]) : 0);
    if (status === 429 || status >= 500) return true;
    const CE = global.SN_CHAT_ERRORS;
    return !!(CE && CE.isTransientNetwork(e));
  }

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
  function cardPromptBody(card) {
    return [
      card.name,
      card.manaCost ? `costo ${card.manaCost}` : '',
      card.typeLine,
      card.oracleText ? `— ${card.oracleText.replace(/\n/g, ' ')}` : '',
    ].filter(Boolean).join(' · ');
  }
  // La carta come la vede il giudice della ricerca (§4.1): anche i dati che un criterio può citare, forza e prezzo.
  function judgeCardBody(card) {
    const pt = card.power || card.toughness ? `forza/costituzione ${card.power || '?'}/${card.toughness || '?'}` : '';
    const price = Number.isFinite(card.priceEur) ? `prezzo ${card.priceEur.toFixed(2).replace('.', ',')} €` : 'prezzo sconosciuto';
    return [
      card.name,
      card.manaCost ? `costo ${card.manaCost}` : '',
      card.typeLine,
      pt,
      price,
      card.oracleText ? `— ${card.oracleText.replace(/\n/g, ' ')}` : '',
    ].filter(Boolean).join(' · ');
  }
  function cardPromptLine(card) {
    return `- [id: ${card.id}] ${cardPromptBody(card)}`;
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

  // Filtro semantico dei risultati (§4.1): OGNI candidato passa dal giudice, a lotti in parallelo, mai un taglio
  // silenzioso; chi non ha potuto guardare torna in `unverifiedIds`, visibile, con `error` per dire perché.
  // `context` (commander, messaggi di prima) cambia il giudizio, quindi entra nella chiave come il criterio;
  // `judgeModel` è il modello che giudicherà, e un altro modello non eredita i giudizi di questo.
  async function filterSearch({ criterion, context = '', judgeModel = '', cardIds, cards, handleAIRequest, onProgress = null }) {
    const ids = [...new Set((cardIds || []).map(String))].filter((id) => cards && cards[id]);
    const crit = P.normCriterion(criterion);
    if (!crit || !ids.length) return { keepIds: ids, unverifiedIds: [], judgedCount: 0, error: null };

    const fp = judgeFingerprint(judgeModel);
    const key = `${fp}|${digest(`${crit}\n${P.normCriterion(context)}`)}`;
    const cache = await readSearchCache();
    const asSeen = new Map(ids.map((id) => [judgedAs(cards[id]), id]));
    const plan = P.planSearchFilter({ cardIds: [...asSeen.keys()], criterion: key, searchCache: cache });
    plan.judgeIds = plan.judgeIds.map((s) => asSeen.get(s));
    plan.keepFromCache = plan.keepFromCache.map((s) => asSeen.get(s));

    const batches = [];
    for (let i = 0; i < plan.judgeIds.length; i += FILTER_BATCH) batches.push(plan.judgeIds.slice(i, i + FILTER_BATCH));
    let done = ids.length - plan.judgeIds.length;
    const progress = () => { if (onProgress) { try { onProgress({ done, total: ids.length }); } catch (_) {} } };
    progress();
    // Più pagine di risultati fanno decine di lotti: al più `limit` chiamate insieme, che si dimezza a ogni «troppe
    // richieste». Un lotto rifiutato così resta di chi l'ha preso e si rimanda dopo l'attesa comune.
    const results = new Array(batches.length);
    let next = 0;
    let limit = Math.min(FILTER_PARALLEL, batches.length);
    let pauseUntil = 0;
    let serviceDown = false;
    const judgeWithWaits = async (i) => {
      for (let wait = 0; ; wait += 1) {
        const pause = pauseUntil - Date.now();
        if (pause > 0) await sleep(pause);
        const r = await judgeBatch({ criterion, context, ids: batches[i], cards, handleAIRequest });
        if (!r.busy) return r;
        if (serviceDown || wait >= BUSY_WAITS_MS.length) { serviceDown = true; return r; }
        limit = Math.max(1, Math.ceil(limit / 2));
        pauseUntil = Math.max(pauseUntil, Date.now() + BUSY_WAITS_MS[wait]);
      }
    };
    const worker = async (w) => {
      while (w < limit && next < batches.length) {
        const i = next++;
        results[i] = await judgeWithWaits(i);
        done += batches[i].length;
        progress();
      }
    };
    await Promise.all(Array.from({ length: limit }, (_, w) => worker(w)));

    const judged = {};
    const unverified = new Set();
    let error = null;
    results.forEach((r, i) => {
      if (r.keep) for (const id of batches[i]) judged[id] = r.keep.has(id);
      else { for (const id of batches[i]) unverified.add(id); error = error || r.error; }
    });
    if (Object.keys(judged).length) {
      const judgedSeen = Object.fromEntries(Object.entries(judged).map(([id, v]) => [judgedAs(cards[id]), v]));
      // Riletta prima di scrivere: due ricerche in parallelo non si cancellano i giudizi a vicenda.
      await chrome.storage.local.set({
        [STORAGE_KEYS.DECK_SEARCH_CACHE]: P.updateSearchCache(await readSearchCache(), key, judgedSeen, {
          keepPrefix: `${fp}|`, maxPairs: SEARCH_CACHE_MAX_PAIRS, maxPerCard: SEARCH_CACHE_PER_CARD,
        }),
      });
    }

    const keepSet = new Set([...plan.keepFromCache, ...Object.keys(judged).filter((id) => judged[id]), ...unverified]);
    return {
      keepIds: ids.filter((id) => keepSet.has(id)),
      unverifiedIds: ids.filter((id) => unverified.has(id)),
      judgedCount: Object.keys(judged).length,
      error,
    };
  }

  // Un lotto al giudice. Una risposta illeggibile si richiede una volta (le risposte del giudice non passano dalla
  // cache delle risposte); un errore di configurazione (niente modello, chiave, tetto) non migliora riprovando, e un
  // servizio occupato torna `busy` a chi sa aspettare.
  async function judgeBatch({ criterion, context, ids, cards, handleAIRequest }) {
    const sys = PROMPTS.decksSearchFilter({
      criterion,
      context,
      cards: ids.map((id, i) => `${i + 1}. ${judgeCardBody(cards[id])}`).join('\n'),
    });
    let error = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const r = await handleAIRequest({
          action: ACTIONS.DECKS_SEARCH_FILTER,
          payload: { messages: [{ role: 'user', content: sys }] },
          origin: 'filo://decks',
        });
        const keep = P.parseSearchKeep(r && r.text, ids);
        if (keep) return { keep };
        error = Object.assign(new Error('risposta del filtro illeggibile'), {
          userText: 'il modello del filtro ha risposto in un formato che non so leggere. Riprova, o scegli un altro modello per «Mazzi — filtro dei risultati di ricerca» in Modelli predefiniti.',
        });
      } catch (e) {
        if (isBusy(e)) return { error: e, busy: true };
        error = e;
        if (e && CONFIG_ERRORS.has(e.code)) break;
      }
    }
    return { error };
  }

  global.SN_DECK_OPINIONS_SVC = { getOpinions, computeOpinions, autoTag, dropDeck, filterSearch };
})(typeof globalThis !== 'undefined' ? globalThis : self);
