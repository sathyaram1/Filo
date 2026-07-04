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

  // Conteggio ristampe per nome (modulo "Prezzo e dati" del detail, §5.2).
  on(MSG.SCRYFALL_PRINTS, async (msg) => {
    try {
      const prints = await Scry.prints(msg?.name);
      return prints === null ? { ok: false, error: 'nome mancante' } : { ok: true, prints };
    } catch (e) {
      return { ok: false, error: e?.message || 'ristampe non disponibili' };
    }
  });

  // ── Chat unificata del Builder (§3-§4) ─────────────────────────────────────
  // Ricerca e chat sono lo stesso pannello: il messaggio dell'utente passa
  // dall'LLM che decide se è una ricerca (→ query Scryfall, eseguita QUI col
  // filtro identity automatico), una selezione cross-mazzo (→ scryfall_id presi
  // dal contesto degli altri mazzi) o solo conversazione (→ reply).

  // Riga compatta di contesto per il prompt: nome + tag (+ id dove serve
  // all'LLM per rispondere con scryfall_id reali, cioè negli ALTRI mazzi).
  function cardLine(entry, card, withId) {
    const name = (card && card.name) || entry.scryfall_id;
    const tags = (entry.tags && entry.tags.length) ? ` — tag: ${entry.tags.join(', ')}` : '';
    return withId ? `  - ${name} [id: ${entry.scryfall_id}]${tags}` : `  - ${name}${tags}`;
  }

  on(MSG.DECKS_CHAT, async (msg) => {
    try {
      const text = String(msg?.text || '').trim();
      if (!text) return { ok: false, error: 'empty' };
      const deckId = String(msg?.deckId || '');
      const deck = deckId ? await Store.get(deckId) : null;
      if (!deck) return { ok: false, error: 'not_found' };

      // Contesto: nomi/tag del mazzo corrente + degli altri mazzi (per le
      // query cross-mazzo, §4). I nomi arrivano dalla cache carte (le carte di
      // un mazzo sono già state risolte quando sono entrate).
      const all = await Store.list();
      const others = all.filter((d) => d.id !== deck.id);
      const allIds = [];
      for (const d of [deck, ...others]) for (const c of d.carte) allIds.push(c.scryfall_id);
      const known = await Scry.cards(allIds).catch(() => ({}));

      const identityColors = (deck.commanderMeta && Array.isArray(deck.commanderMeta.colors))
        ? deck.commanderMeta.colors : null;
      const sys = PROMPTS.decksChat({
        deckName: deck.nome,
        commanderName: deck.commanderMeta && deck.commanderMeta.name,
        identity: identityColors ? Q.identityCode(identityColors) : '',
        deckCards: deck.carte.map((c) => cardLine(c, known[c.scryfall_id], false)).join('\n'),
        otherDecks: others.map((d) => (
          `Mazzo "${d.nome}"${d.commanderMeta && d.commanderMeta.name ? ` (commander: ${d.commanderMeta.name})` : ''}:\n` +
          (d.carte.length ? d.carte.map((c) => cardLine(c, known[c.scryfall_id], true)).join('\n') : '  (vuoto)')
        )).join('\n'),
      });
      const history = Array.isArray(msg?.history)
        ? msg.history
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-12)
        : [];
      const messages = [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }];

      const r = await handleAIRequest({
        action: ACTIONS.DECKS_CHAT,
        payload: { messages },
        origin: 'filo://decks',
      });
      const parsed = Q.parseAgentReply(r.text);

      let cardIds = [];
      let cards = {};
      let query = '';
      if (parsed.query) {
        // Filtro identity AUTOMATICO (§4): lo aggiunge search/buildSearchQuery;
        // se l'utente/LLM ha già un vincolo id esplicito, quello vince.
        const sr = await Scry.search(parsed.query, { identity: identityColors });
        cardIds = sr.cards.map((c) => c.id);
        for (const c of sr.cards) cards[c.id] = c;
        query = sr.query;
      } else if (parsed.cards.length) {
        // Cross-mazzo: gli id vengono dal contesto (mai inventati) → risolti
        // dalla cache; quelli ignoti si scartano.
        cards = await Scry.cards(parsed.cards).catch(() => ({}));
        cardIds = parsed.cards.filter((id) => cards[id]);
      }

      // Budget via chat (§9.2): l'LLM estrae il numero, il tetto lo applica IL
      // SISTEMA (mai fidarsi che il modello "abbia già fatto"). Il mazzo
      // aggiornato torna alla pagina, che rinfresca header e statistiche.
      let reply = parsed.reply;
      let deckOut = null;
      if (parsed.hasBudget) {
        const saved = await Store.put(Decks.setBudget(deck, parsed.budget));
        if (saved) {
          deckOut = saved;
          reply = [reply, parsed.budget === null
            ? 'Budget rimosso.'
            : `Budget impostato a ${parsed.budget} €.`].filter(Boolean).join('\n');
        }
      }

      // Calcolatore di probabilità via chat (§9.3): la simulazione Monte Carlo
      // gira QUI, locale e gratis; il risultato si accoda alla reply.
      if (parsed.prob) {
        const Stats = globalThis.SN_DECK_STATS;
        const library = Stats.buildLibrary(deckOut || deck, known);
        const r2 = Stats.simulate({ library, want: parsed.prob.needs, turn: parsed.prob.turn });
        const pct = (r2.probability * 100).toFixed(1).replace('.', ',');
        const wantsTxt = parsed.prob.needs.map((w) => `${w.n} ${w.tag}`).join(' + ');
        reply = [reply, `Probabilità di avere ${wantsTxt} al turno ${parsed.prob.turn}: ≈ ${pct}% (${r2.iterations.toLocaleString('it-IT')} mani simulate).`]
          .filter(Boolean).join('\n');
      }

      // Auto-tag via chat (§7): "tagga il mazzo con ramp, draw, removal…".
      // I giudizi li fa IL SISTEMA (LLM economico in batch + cache carta/tag),
      // mai il modello della chat "a parole". Il mazzo aggiornato torna alla
      // pagina, che rinfresca elenco (gruppi per tag) e statistiche.
      if (parsed.tagWith.length) {
        const Opinions = globalThis.SN_DECK_OPINIONS_SVC;
        const base = deckOut || deck;
        const rt = await Opinions.autoTag({
          deck: base, cards: known, tags: parsed.tagWith, handleAIRequest,
        });
        if (rt.changed) {
          const saved = await Store.put(rt.deck);
          if (saved) deckOut = saved;
        }
        reply = [reply, rt.taggedCount
          ? `Ho taggato ${rt.taggedCount} cart${rt.taggedCount === 1 ? 'a' : 'e'} con: ${parsed.tagWith.join(', ')}. Raggruppa "per tag" per vederle divise.`
          : 'Nessuna carta del mazzo corrisponde ai tag richiesti.']
          .filter(Boolean).join('\n');
      }

      // Valutazione batch esplicita (§6.1): "valuta il mazzo" / "valuta questi
      // risultati". MAI in automatico: solo su richiesta. Calcola i pareri
      // mancanti/stantii in un colpo e li mette in cache (§6.2); la sintesi
      // complessiva va nella reply della chat.
      if (parsed.evaluate) {
        const Opinions = globalThis.SN_DECK_OPINIONS_SVC;
        const base = deckOut || deck;
        const targetIds = parsed.evaluate === 'results'
          ? (Array.isArray(msg?.lastResults) ? msg.lastResults.map(String).filter(Boolean) : [])
          : base.carte.map((c) => c.scryfall_id);
        if (!targetIds.length) {
          reply = [reply, parsed.evaluate === 'results'
            ? 'Non ho una lista di risultati recente da valutare.'
            : 'Il mazzo è vuoto: non c\'è ancora nulla da valutare.']
            .filter(Boolean).join('\n');
        } else {
          const targetCards = await Scry.cards(targetIds).catch(() => ({}));
          const re = await Opinions.computeOpinions({
            deck: base, cards: targetCards, cardIds: targetIds,
            mode: 'stale', wantSintesi: true, handleAIRequest,
          });
          const n = Object.keys(re.opinions).length;
          reply = [reply, re.sintesi,
            n ? `Parere pronto su ${n} cart${n === 1 ? 'a' : 'e'}: lo leggi passando il mouse su una carta, col modulo «Parere di Filo» attivo nel riquadro del dettaglio (tasto destro sul riquadro per sceglierlo).` : '']
            .filter(Boolean).join('\n');
        }
      }

      return { ok: true, reply, cardIds, cards, query, ...(deckOut ? { deck: deckOut } : {}) };
    } catch (e) {
      return { ok: false, error: e?.message || 'chat fallita' };
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
