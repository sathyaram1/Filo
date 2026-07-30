// Handler di dominio: client Scryfall per il deck builder (§13.2) + commander.
// La pagina non parla mai con Scryfall direttamente: passa da qui, così rate
// limit e cache sono condivisi fra tutte le superfici.

module.exports = function register(on, ctx) {
  const { MSG, handleAIRequest } = ctx;
  const Scry = globalThis.SN_SCRYFALL;
  const Decks = globalThis.SN_DECKS;
  const Store = globalThis.SN_DECK_STORE;
  const Q = globalThis.SN_SCRYFALL_Q;
  const IE = globalThis.SN_DECK_IMPORT_EXPORT;
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

  // Errore → frase per l'utente (#331): mai un codice HTTP nudo in chat.
  // La traduzione vive in `shared/chatErrors.js` (#360): è la STESSA per tutte
  // le chat di Filo — prima era solo qui e la chat della home mostrava ancora
  // "fetch failed" nudo. Qui passiamo solo l'archivio esterno che questa chat
  // interroga oltre al servizio AI, così un errore HTTP senza marcatore di
  // provider viene attribuito a lui.
  const SCRYFALL_SOURCE = 'Scryfall (l\'archivio delle carte)';
  function friendlyChatError(e) {
    const CE = globalThis.SN_CHAT_ERRORS;
    if (!CE) return 'qualcosa è andato storto. Riprova.';
    return CE.friendly(e, { dataSource: SCRYFALL_SOURCE });
  }

  on(MSG.DECKS_CHAT, async (msg, sender) => {
    // Ragionamento del modello (CoT, #331): accumulato qui e ritornato alla
    // pagina (che lo mostra in un blocco collassabile); se la pagina ha aperto
    // un canale live (reasoningReqId) ogni chunk viene anche inoltrato subito,
    // così si vede "pensare" in diretta. Dichiarato fuori dal try: anche un
    // turno fallito ritorna il ragionamento raccolto fin lì.
    let reasoning = '';
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

      // `let`, non `const`: se in questo stesso turno l'utente stabilisce il
      // commander (build-around, sotto), va ricalcolato PRIMA della ricerca, così
      // la query e il filtro duro restano nei colori del commander appena scelto.
      let identityColors = (deck.commanderMeta && Array.isArray(deck.commanderMeta.colors))
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

      // Canale del ragionamento: accumulo sempre (torna nella risposta) +
      // inoltro live alla scheda che ha chiesto il turno, se c'è un reqId.
      const wc = sender && sender.wc;
      const reasoningReqId = msg?.reasoningReqId ? String(msg.reasoningReqId) : '';
      const onReasoning = (t) => {
        reasoning += t;
        if (reasoningReqId && wc && !wc.isDestroyed?.()) {
          try { wc.send('filo:reasoning', { reqId: reasoningReqId, text: t }); } catch (_) {}
        }
      };

      const r = await handleAIRequest({
        action: ACTIONS.DECKS_CHAT,
        payload: { messages },
        origin: 'filo://decks',
        onReasoning,
      });
      const parsed = Q.parseAgentReply(r.text);

      let cardIds = [];
      let cards = {};
      let query = '';
      // Budget/reply/deck di uscita dichiarati qui (prima dell'import, sotto)
      // perché sia la ricerca sia l'import possono accodare testo alla reply.
      let reply = parsed.reply;
      let deckOut = null;

      // Imposta il commander AUTOMATICAMENTE (feedback #337). Quando l'utente
      // vuole costruire attorno a un commander preciso, o dichiara qual è il
      // commander di QUESTO mazzo (es. "facciamo un mazzo con Krenko", "il mio
      // commander è Atraxa"), l'agente torna "commander" SENZA una lista da
      // importare. Filo lo imposta subito e — se nello stesso turno c'è anche una
      // ricerca — la filtra sui colori del commander appena scelto: senza questo,
      // la ricerca partirebbe con "(nessun vincolo)" e proporrebbe carte fuori
      // colore, cioè l'esatto attrito segnalato. NON tocca un commander già
      // impostato (serve un'azione esplicita/dedicata, §8.4) e resta reversibile
      // ("Rimuovi commander", feedback #302). L'import di una lista incollata
      // (parsed.import) è il ramo SEPARATO più sotto, dove il commander è invece
      // un CANDIDATO da confermare insieme alle carte, mai scritto in automatico.
      let commanderJustSet = false;
      if (parsed.commanderName && !parsed.import.length && !deck.commander) {
        const found = await Scry.named(parsed.commanderName).catch(() => null);
        if (found) {
          const saved = await Store.put(Decks.setCommander(deck, found.id, {
            name: found.name, colors: found.colorIdentity, artCrop: found.artCrop,
          }));
          if (saved) {
            deckOut = saved;
            identityColors = (saved.commanderMeta && Array.isArray(saved.commanderMeta.colors))
              ? saved.commanderMeta.colors : identityColors;
            commanderJustSet = true;
            reply = [reply, `Ho impostato ${found.name} come commander: le ricerche ora restano nei suoi colori.`]
              .filter(Boolean).join('\n');
          }
        } else {
          reply = [reply, `Non ho trovato su Scryfall il commander «${parsed.commanderName}», quindi non l'ho impostato.`]
            .filter(Boolean).join('\n');
        }
      }
      if (parsed.query) {
        // Filtro identity AUTOMATICO (§4): lo aggiunge search/buildSearchQuery;
        // se l'utente/LLM ha già un vincolo id esplicito, quello vince.
        // La query la scrive il MODELLO e può essere sintatticamente invalida
        // (Scryfall risponde 400): non buttare l'intero turno (#331) — si
        // riprova UNA volta facendo correggere la query al modello stesso, e
        // se non ne esce si spiega il problema in chiaro nella reply.
        let sr = null;
        try {
          sr = await Scry.search(parsed.query, { identity: identityColors });
        } catch (e1) {
          const status = Number(e1 && e1.status);
          const detail = String((e1 && e1.details) || '');
          let explained = false;
          if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 429) {
            // Query rifiutata (sintassi): il modello la corregge o spiega.
            try {
              const retryMessages = [...messages,
                { role: 'assistant', content: r.text },
                { role: 'user', content:
                  `(Sistema) La ricerca Scryfall con la query «${parsed.query}» è stata rifiutata` +
                  `${detail ? ` con questo errore: ${detail}` : ' (sintassi non valida)'}. ` +
                  'Correggi la sintassi e rispondi di nuovo con il SOLO JSON {"reply": "...", "query": "<query corretta>"}. ' +
                  'Se la richiesta non è esprimibile in sintassi Scryfall, spiega il problema all\'utente in "reply" (in italiano, senza codici tecnici) e ometti "query".' },
              ];
              const r2 = await handleAIRequest({
                action: ACTIONS.DECKS_CHAT,
                payload: { messages: retryMessages },
                origin: 'filo://decks',
                onReasoning,
              });
              const p2 = Q.parseAgentReply(r2.text);
              // La reply del retry si accoda solo se aggiunge qualcosa (il
              // modello a volte ripete la stessa frase del primo tentativo).
              if (p2.reply && p2.reply !== parsed.reply) {
                reply = [reply, p2.reply].filter(Boolean).join('\n');
              }
              if (p2.query) {
                // Il modello ha riprovato: se anche questa fallisce si passa
                // alla spiegazione generica qui sotto.
                sr = await Scry.search(p2.query, { identity: identityColors });
              } else if (p2.reply) {
                // Niente query: il modello ha SPIEGATO il problema — è la
                // risposta per l'utente, il messaggio generico non serve.
                explained = true;
              }
            } catch (_) { sr = null; }
          }
          if (!sr && !explained) {
            reply = [reply,
              `Ho provato a cercare su Scryfall ma la ricerca non è andata a buon fine (la query «${parsed.query}» non è stata accettata${Number.isFinite(status) && (status >= 500 || status === 429) ? ' perché il servizio al momento non risponde' : ''}). Prova a riformulare la richiesta con parole diverse, o riprova tra poco.`,
            ].filter(Boolean).join('\n');
          }
        }
        if (sr) {
          cardIds = sr.cards.map((c) => c.id);
          for (const c of sr.cards) cards[c.id] = c;
          query = sr.query;
          // Filtro semantico (§4.1): la query era LARGA apposta (sinonimi, per
          // non perdere carte). Se il modello ha dato un "filter", un LLM
          // economico giudica carta-per-carta se rispetta l'intento, in batch,
          // con cache (carta, criterio). Best-effort: un errore o un filtro che
          // svuota TUTTO non deve lasciare l'utente a mani vuote → si ricade
          // sui risultati larghi.
          if (parsed.filter && cardIds.length) {
            try {
              const Opinions = globalThis.SN_DECK_OPINIONS_SVC;
              const fr = await Opinions.filterSearch({
                criterion: parsed.filter, cardIds, cards, handleAIRequest,
              });
              if (fr && Array.isArray(fr.keepIds) && fr.keepIds.length) {
                cardIds = fr.keepIds;
              }
            } catch (_) { /* filtro fallito: si tengono i risultati larghi */ }
          }
        }
      } else if (parsed.cards.length) {
        // Cross-mazzo: gli id vengono dal contesto (mai inventati) → risolti
        // dalla cache; quelli ignoti si scartano.
        cards = await Scry.cards(parsed.cards).catch(() => ({}));
        cardIds = parsed.cards.filter((id) => cards[id]);
      }

      // Invariante DURA di color identity (§4/§8.4): l'agente non deve MAI
      // proporre carte fuori dai colori del commander. Il filtro sulla QUERY
      // (buildSearchQuery, `id<=`) copre il caso normale, ma il modello può
      // scriversi un vincolo `id:` esplicito sbagliato (che quel filtro lascia
      // passare, per rispettare l'override manuale dell'utente) o pescare da un
      // altro mazzo carte fuori identità: qui si applica il filtro sui DATI
      // reali della carta (colorIdentity ⊆ colori commander), che nessuna
      // sintassi di query può aggirare. L'import via chat (lista incollata
      // dall'utente, più sotto) resta fuori: è una scelta esplicita dell'utente,
      // non una proposta dell'agente, e la riga di legalità la segnala comunque.
      let identityDropped = 0;
      if (identityColors && cardIds.length) {
        const kept = cardIds.filter((id) => {
          const c = cards[id];
          // Dato carta mancante: non scartare per un dubbio (meglio mostrarla).
          if (!c) return true;
          if (Q.withinIdentity(c.colorIdentity, identityColors)) return true;
          identityDropped += 1;
          return false;
        });
        cardIds = kept;
      }
      if (identityDropped > 0) {
        reply = [reply,
          `Ho escluso ${identityDropped} cart${identityDropped === 1 ? 'a' : 'e'} fuori dai colori del commander.`]
          .filter(Boolean).join('\n');
      }

      // Import via chat (§11.2): l'utente incolla una lista grezza, l'LLM la
      // interpreta (typo/italiano/formati strani) in nomi+quantità sopra —
      // qui il SISTEMA risolve ogni nome su Scryfall (fuzzy match, MAI si
      // fida di un id inventato dal modello) e propone la stessa CardList di
      // conferma della ricerca: l'aggiunta al mazzo resta un'azione esplicita
      // dell'utente (toggle riga o "Aggiungi tutte"), mai automatica.
      let importPending = null;
      // `commanderJustSet` esclude il commander già consumato sopra (build-around):
      // qui resta solo il commander-CANDIDATO dell'import di una lista incollata.
      const importCommanderName = commanderJustSet ? '' : parsed.commanderName;
      if (parsed.import.length || importCommanderName) {
        const qtyById = {};
        const notFound = [];
        for (const entry of parsed.import) {
          const found = await Scry.named(entry.name).catch(() => null);
          if (found) { cardIds.push(found.id); cards[found.id] = found; qtyById[found.id] = entry.qty; }
          else notFound.push(entry.name);
        }
        let commanderId = '';
        if (importCommanderName) {
          const found = await Scry.named(importCommanderName).catch(() => null);
          if (found) {
            commanderId = found.id;
            cardIds.unshift(found.id);
            cards[found.id] = found;
            qtyById[found.id] = 1;
          } else notFound.push(importCommanderName);
        }
        importPending = { qtyById, commanderId };
        const n = cardIds.length;
        reply = [reply, n ? `Ho riconosciuto ${n} cart${n === 1 ? 'a' : 'e'}: conferma qui sotto quali aggiungere.` : '',
          notFound.length ? `Non ho trovato su Scryfall: ${notFound.join(', ')}.` : '']
          .filter(Boolean).join('\n');
      }

      // Budget via chat (§9.2): l'LLM estrae il numero, il tetto lo applica IL
      // SISTEMA (mai fidarsi che il modello "abbia già fatto"). Il mazzo
      // aggiornato torna alla pagina, che rinfresca header e statistiche.
      if (parsed.hasBudget) {
        const saved = await Store.put(Decks.setBudget(deck, parsed.budget));
        if (saved) {
          deckOut = saved;
          reply = [reply, parsed.budget === null
            ? 'Budget rimosso.'
            // Formato italiano come il resto dei prezzi («40,50 €»).
            : `Budget impostato a ${String(parsed.budget).replace('.', ',')} €.`].filter(Boolean).join('\n');
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

      return {
        ok: true, reply, cardIds, cards, query,
        ...(reasoning ? { reasoning } : {}),
        ...(deckOut ? { deck: deckOut } : {}),
        ...(importPending ? { importPending } : {}),
      };
    } catch (e) {
      // Mai il codice grezzo in chat (#331): l'errore diventa una frase per
      // l'utente, e il ragionamento raccolto fin lì resta comunque visibile.
      // Il dettaglio tecnico resta nei log per la diagnosi.
      console.warn('[SN] decks chat fallita:', (e && e.message) || e);
      return {
        ok: false,
        error: friendlyChatError(e) || 'chat fallita',
        ...(reasoning ? { reasoning } : {}),
      };
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
      // scryfallId vuoto = RIMUOVI il commander (torna a "nessun commander").
      // È l'inverso di "imposta come commander": senza questo ramo un mazzo
      // resterebbe bloccato col commander impostato per sbaglio (feedback #302).
      const wantId = String(msg?.scryfallId || '').trim();
      if (!wantId) {
        const cleared = Decks.setCommander(deck, '', null);
        const saved = await Store.put(cleared);
        return saved ? { ok: true, deck: saved } : { ok: false, error: 'save_failed' };
      }
      const card = await Scry.card(wantId);
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

  // ── Import/Export testuale (§11), via switcher ─────────────────────────────
  // Parser RIGIDO e deterministico (IE = SN_DECK_IMPORT_EXPORT, logica pura,
  // MAI l'LLM — quello è il cammino della chat sopra). PREVIEW risolve ogni
  // nome via Scryfall fuzzy PRIMA di scrivere qualunque cosa: l'utente vede
  // cosa entrerà nel mazzo (e cosa non si è capito) e conferma con APPLY.
  on(MSG.DECKS_IMPORT_PREVIEW, async (msg) => {
    try {
      const deck = await Store.get(String(msg?.id || ''));
      if (!deck) return { ok: false, error: 'not_found' };
      const parsed = IE.parseDecklist(String(msg?.text || ''));

      const entries = [];
      for (const e of parsed.entries) {
        const card = await Scry.named(e.name).catch(() => null);
        entries.push({ name: e.name, qty: e.qty, card });
      }
      let commander = null;
      if (parsed.commanderName) {
        const card = await Scry.named(parsed.commanderName).catch(() => null);
        commander = { name: parsed.commanderName, card };
      }
      return { ok: true, entries, commander, dirtyLines: parsed.dirtyLines };
    } catch (e) {
      return { ok: false, error: e?.message || 'analisi fallita' };
    }
  });

  // Applica un import già confermato dall'utente (§11.1): merge delle carte
  // già risolte (mai un nome libero qui — solo scryfall_id già verificati
  // dalla preview) + commander opzionale, SOLO se il mazzo non ne ha già uno
  // (non sovrascrive mai una scelta esistente senza un'azione dedicata).
  on(MSG.DECKS_IMPORT_APPLY, async (msg) => {
    try {
      const deck = await Store.get(String(msg?.id || ''));
      if (!deck) return { ok: false, error: 'not_found' };
      const rawEntries = Array.isArray(msg?.entries) ? msg.entries : [];
      // Una qty <= 0 (o non numerica) significa "non includere": si scarta,
      // NON si forza a 1 (0 è falsy — il vecchio `Number(...) || 1` la
      // trasformava in una copia fantasma).
      const entries = rawEntries
        .map((e) => ({ scryfall_id: String((e && e.scryfallId) || ''), qty: Math.floor(Number(e && e.qty)) }))
        .filter((e) => e.scryfall_id && Number.isFinite(e.qty) && e.qty > 0);
      const { deck: merged, addedCount, updatedCount } = Decks.importCards(deck, entries);

      let next = merged;
      const commanderId = String(msg?.commanderId || '');
      if (commanderId && !deck.commander) {
        const card = await Scry.card(commanderId).catch(() => null);
        if (card) {
          next = Decks.setCommander(next, card.id, {
            name: card.name, colors: card.colorIdentity, artCrop: card.artCrop,
          });
        }
      }
      const saved = await Store.put(next);
      return saved ? { ok: true, deck: saved, addedCount, updatedCount } : { ok: false, error: 'save_failed' };
    } catch (e) {
      return { ok: false, error: e?.message || 'import fallito' };
    }
  });

  // Esporta il mazzo nello STESSO formato testuale dell'import (§11.1).
  on(MSG.DECKS_EXPORT, async (msg) => {
    try {
      const deck = await Store.get(String(msg?.id || ''));
      if (!deck) return { ok: false, error: 'not_found' };
      const known = await Scry.cards(deck.carte.map((c) => c.scryfall_id)).catch(() => ({}));
      const entries = deck.carte
        .map((c) => ({ name: (known[c.scryfall_id] && known[c.scryfall_id].name) || c.scryfall_id, qty: c.qty }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const commanderName = (deck.commanderMeta && deck.commanderMeta.name) || '';
      const text = IE.formatDecklist({ commanderName, entries });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e?.message || 'export fallito' };
    }
  });
};
