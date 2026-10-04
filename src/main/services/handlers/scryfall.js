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
  // Sei pagine di Scryfall per una ricerca che passa dal giudice: circa 20 lotti, meno di un centesimo col modello
  // economico. Una rete più larga di così la chat la dichiara col numero e chiede un vincolo in più.
  const JUDGE_MAX_CARDS = 1050;

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
      const cards = await Scry.cards(msg?.ids || [], { maxAgeMs, cacheOnly: !!msg?.cacheOnly });
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

  // Il modello che giudicherà le carte: i giudizi salvati valgono solo per lui. '' se non è configurato (il giudice
  // allora fallisce da sé, e lo dice).
  async function judgeModelNow() {
    try {
      const settings = await ctx.getEffectiveSettings();
      const chain = ctx.buildAttemptChain(settings, ctx.modelForAction(settings, ACTIONS.DECKS_SEARCH_FILTER), ACTIONS.DECKS_SEARCH_FILTER);
      return chain[0] ? `${chain[0].provider || ''}/${chain[0].model || ''}` : '';
    } catch (_) { return ''; }
  }

  // Quello che la richiesta dà per scontato e il giudice non vede altrove (#382): il commander del mazzo, le carte
  // del mazzo se il criterio lo richiama, e le richieste di prima quando il modello non ha scritto un criterio.
  async function judgeContext({ deck, criterion, previousAsks, deckNames }) {
    const out = [];
    const meta = deck && deck.commanderMeta;
    if (deck && deck.commander) {
      const c = (await Scry.cards([deck.commander]).catch(() => ({})))[deck.commander];
      const body = c
        ? [c.name, c.manaCost ? `costo ${c.manaCost}` : '', c.typeLine, c.oracleText ? `— ${c.oracleText.replace(/\n/g, ' ')}` : '']
          .filter(Boolean).join(' · ')
        : String((meta && meta.name) || '');
      if (body) out.push(`Il commander del mazzo è ${body}`);
    }
    // Stesso metro dei tag contestuali (§7): la lista entra solo se serve, perché ogni carta aggiunta la cambia.
    const asks = [criterion, ...previousAsks].join(' ');
    if (deckNames.length && !globalThis.SN_DECK_OPINIONS.isContextFreeTag(asks)) {
      out.push(`Carte già nel mazzo: ${deckNames.join(', ')}`);
    }
    if (previousAsks.length) {
      out.push(`Richieste precedenti dell'utente in questa chat, dalla più vecchia:\n${previousAsks.map((t) => `- «${t}»`).join('\n')}`);
    }
    return out.join('\n');
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
      // Stesso canale, fase della ricerca: la bolla in attesa dice cosa sta facendo Filo e a che punto è (#382).
      const onProgress = (progress) => {
        if (reasoningReqId && wc && !wc.isDestroyed?.()) {
          try { wc.send('filo:reasoning', { reqId: reasoningReqId, progress: { ...progress, reply } }); } catch (_) {}
        }
      };

      const r = await handleAIRequest({
        action: ACTIONS.DECKS_CHAT,
        payload: { messages },
        origin: 'filo://decks',
        onReasoning,
      });
      const parsed = Q.parseAgentReply(r.text);
      // Svuotare la chat è della pagina, con la sua conferma: qui niente ricerche né modifiche al mazzo. Il testo è
      // di Filo, non del modello: resta vero anche se la conferma non arriva (Annulla, mazzo lasciato) o se il
      // modello scrive di averla già svuotata.
      if (parsed.clearChat) {
        return {
          ok: true, reply: 'Svuoto la chat di questo mazzo? Il mazzo resta com\'è.', cardIds: [], cards: {}, query: '',
          clearChat: true, ...(reasoning ? { reasoning } : {}),
        };
      }

      let cardIds = [];
      let cards = {};
      let query = '';
      let uncheckedIds = [];
      // Il turno è andato solo in parte (ricerca non partita, carte non controllate) e la risposta dice di riprovare:
      // la bolla allora tiene il tasto Riprova, come una risposta in errore.
      let retryable = false;
      // Budget/reply/deck di uscita dichiarati qui (prima dell'import, sotto)
      // perché sia la ricerca sia l'import possono accodare testo alla reply.
      let reply = parsed.reply;
      let deckOut = null;

      // Commander a parole (#337, #789): su un mazzo senza commander basta il nome (build-around); uno già impostato
      // cambia solo col segnale esplicito di sostituzione, e il vecchio rientra nel mazzo. Va PRIMA della ricerca,
      // che così resta nei colori del commander appena scelto. Il commander di una lista incollata è l'import, sotto.
      if (parsed.commanderName && !parsed.import.length) {
        // Riletto adesso: mentre il modello rispondeva l'utente può aver cambiato il mazzo da un'altra strada.
        const base = (await Store.get(deck.id)) || deck;
        if (base.commander && !parsed.replaceCommander) {
          const same = String(parsed.commanderName).toLowerCase() === String((base.commanderMeta && base.commanderMeta.name) || '').toLowerCase();
          if (!same) {
            reply = [reply, `Il commander resta [[${base.commanderMeta && base.commanderMeta.name ? base.commanderMeta.name : parsed.commanderName}]]. Per cambiarlo chiedimi di sostituirlo, o usa «Imposta come commander» col tasto destro su una carta.`]
              .filter(Boolean).join('\n');
          }
        } else {
          const found = await Scry.named(parsed.commanderName).catch(() => null);
          if (!found) {
            reply = [reply, `Non ho trovato su Scryfall il commander «${parsed.commanderName}», quindi non l'ho ${base.commander ? 'cambiato' : 'impostato'}.`]
              .filter(Boolean).join('\n');
          } else if (found.id === base.commander) {
            reply = [reply, `[[${found.name}]] è già il commander di questo mazzo.`].filter(Boolean).join('\n');
          } else {
            const swap = Decks.replaceCommander(base, found.id, {
              name: found.name, colors: found.colorIdentity, artCrop: found.artCrop,
            });
            const saved = await Store.put(swap.deck);
            if (saved) {
              deckOut = saved;
              identityColors = (saved.commanderMeta && Array.isArray(saved.commanderMeta.colors))
                ? saved.commanderMeta.colors : identityColors;
              reply = [reply, swap.previousId
                ? `Ora il commander è [[${found.name}]] e le ricerche restano nei suoi colori. ${swap.previousName ? `[[${swap.previousName}]]` : 'Quello di prima'} torna nel mazzo come carta normale.`
                : `Ho impostato [[${found.name}]] come commander: le ricerche ora restano nei suoi colori.`]
                .filter(Boolean).join('\n');
            }
          }
        }
      }
      if (parsed.query) {
        // Il criterio del giudice segue la query che è partita davvero: quella corretta al secondo tentativo porta il suo.
        let criterion = parsed.filter;
        // Filtro identity AUTOMATICO (§4): lo aggiunge search/buildSearchQuery;
        // se l'utente/LLM ha già un vincolo id esplicito, quello vince.
        // La query la scrive il MODELLO e può essere sintatticamente invalida
        // (Scryfall risponde 400): non buttare l'intero turno (#331) — si
        // riprova UNA volta facendo correggere la query al modello stesso, e
        // se non ne esce si spiega il problema in chiaro nella reply.
        // Solo un messaggio tutto in sintassi è già la richiesta esatta, anche se il modello gli aggiunge un criterio;
        // ogni altra ricerca passa dal giudice (§4.1).
        const critOf = (c) => (Q.isPureSyntax(text) ? '' : (c || text));
        // Chi passa dal giudice segue le pagine di Scryfall fino al tetto: la query larga le riempie in fretta, e
        // fermarsi alla prima vedeva solo le 175 più economiche (#382). Oltre il tetto la chat lo dice.
        const runSearch = (q, c) => (critOf(c)
          ? Scry.search(q, { identity: identityColors, maxCards: JUDGE_MAX_CARDS, remember: false,
            onPage: ({ found, total }) => onProgress({ fase: 'cerco', done: found, total: Math.min(total, JUDGE_MAX_CARDS) }) })
          : Scry.search(q, { identity: identityColors }));
        let sr = null;
        try {
          sr = await runSearch(parsed.query, criterion);
        } catch (e1) {
          const status = Number(e1 && e1.status);
          const detail = String((e1 && e1.details) || '');
          let explained = false;
          if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 429) {
            // Query rifiutata (sintassi): il modello la corregge o spiega.
            try {
              // #593 (quarto giro di verifica) — IL MOTIVO DEL RIFIUTO LO
              // SCRIVE IL SERVIZIO REMOTO, E QUESTA RIGA È LA VOCE DI FILO.
              // Era l'ultimo punto in cui del testo arrivato da fuori entrava
              // in un prompt dentro una nota di sistema, cioè la forma che
              // questo lavoro ha tolto da tutte le altre parti. La riga di
              // Filo resta una frase di Filo (query compresa: quella la scrive
              // il modello, spesso ricopiando qualcosa che ha letto), e il
              // messaggio del servizio viaggia a parte, in una busta.
              const E = globalThis.SN_ESTERNO;
              const retryMessages = [...messages,
                { role: 'assistant', content: r.text },
                { role: 'user', content:
                  `(Sistema) La ricerca Scryfall con la query «${E.perCanaleSistema(parsed.query)}» è stata rifiutata` +
                  `${detail ? ' e il servizio ha spiegato perché qui sotto' : ' (sintassi non valida)'}. ` +
                  'Correggi la sintassi e rispondi di nuovo con il SOLO JSON {"reply": "...", "query": "<query corretta>"}. ' +
                  'Se la richiesta non è esprimibile in sintassi Scryfall, spiega il problema all\'utente in "reply" (in italiano, senza codici tecnici) e ometti "query".' +
                  (detail ? `\n\n${E.imbusta({ tipo: 'ESITO_SERVIZIO', testo: detail, conIntestazione: true, max: 2000 })}` : '') },
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
                criterion = p2.filter || criterion;
                sr = await runSearch(p2.query, criterion);
              } else if (p2.reply) {
                // Niente query: il modello ha SPIEGATO il problema — è la
                // risposta per l'utente, il messaggio generico non serve.
                explained = true;
              }
            } catch (_) { sr = null; }
          }
          if (!sr && !explained) {
            retryable = true;
            reply = [reply,
              `Ho provato a cercare su Scryfall ma la ricerca non è andata a buon fine (la query «${parsed.query}» non è stata accettata${Number.isFinite(status) && (status >= 500 || status === 429) ? ' perché il servizio al momento non risponde' : ''}). Prova a riformulare la richiesta con parole diverse, o riprova tra poco.`,
            ].filter(Boolean).join('\n');
          }
        }
        if (sr) {
          cardIds = sr.cards.map((c) => c.id);
          for (const c of sr.cards) cards[c.id] = c;
          query = sr.query;
          // Filtro semantico (§4.1): la query è LARGA apposta, e ogni carta che torna passa dal giudice (#382).
          // Senza criterio del modello vale la richiesta stessa.
          const crit = critOf(criterion);
          const found = cardIds.length;
          // Una pagina che non ha risposto non è un tetto: la bolla tiene Riprova, e la nota lo dice.
          if (sr.broken) retryable = true;
          if (!found) {
            reply = [reply, globalThis.SN_DECK_OPINIONS.searchEmptyNote({ identity: !!identityColors })].filter(Boolean).join('\n');
          } else if (crit) {
            onProgress({ fase: 'controllo', done: 0, total: found });
            let fr;
            try {
              const previousAsks = criterion ? [] : history.filter((m) => m.role === 'user').slice(-3)
                .map((m) => (m.content.length > 300 ? `${m.content.slice(0, 299)}…` : m.content));
              fr = await globalThis.SN_DECK_OPINIONS_SVC.filterSearch({
                criterion: crit, cardIds, cards, handleAIRequest,
                context: await judgeContext({
                  deck: deckOut || deck, criterion: crit, previousAsks,
                  deckNames: (deckOut || deck).carte.map((c) => known[c.scryfall_id] && known[c.scryfall_id].name).filter(Boolean),
                }),
                judgeModel: await judgeModelNow(),
                onProgress: ({ done, total }) => onProgress({ fase: 'controllo', done, total }),
              });
            } catch (e) {
              fr = { keepIds: cardIds, unverifiedIds: cardIds, error: e };
            }
            cardIds = fr.keepIds;
            // Segnate in lista solo se sono una parte: se non l'ha controllata nessuna, lo dice già la nota.
            if (fr.unverifiedIds.length < found) uncheckedIds = fr.unverifiedIds;
            if (fr.unverifiedIds.length) retryable = true;
            const note = globalThis.SN_DECK_OPINIONS.searchFilterNote({
              found, kept: fr.keepIds.length, unverified: fr.unverifiedIds.length, criterion: crit, total: sr.total,
              broken: !!sr.broken, why: fr.error ? (fr.error.userText || friendlyChatError(fr.error)) : '',
            });
            if (note) reply = [reply, note].filter(Boolean).join('\n');
            // In cache vanno le carte che si mostrano, non le centinaia della rete larga.
            Scry.remember(cardIds.map((id) => cards[id]).filter(Boolean)).catch(() => {});
            cards = Object.fromEntries(cardIds.filter((id) => cards[id]).map((id) => [id, cards[id]]));
          } else {
            const cap = globalThis.SN_DECK_OPINIONS.searchCapNote({ seen: found, total: sr.total, judged: false, broken: !!sr.broken });
            if (cap) reply = [reply, cap].filter(Boolean).join('\n');
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
      // Il commander senza lista l'ha già gestito il ramo sopra: qui resta solo il CANDIDATO di una lista incollata.
      const importCommanderName = parsed.import.length ? parsed.commanderName : '';
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
        // Il commander della lista non scavalca quello del mazzo (lo cambia solo un'azione dedicata), ma va detto:
        // come nell'import dal selettore, una scelta dell'utente non sparisce in silenzio.
        const onDeck = deckOut || deck;
        const keptName = onDeck.commanderMeta && onDeck.commanderMeta.name;
        const kept = commanderId && onDeck.commander && commanderId !== onDeck.commander
          ? `La lista indica [[${cards[commanderId].name}]] come commander, ma il mazzo ha già ${keptName ? `[[${keptName}]]` : 'il suo'}: resta quello. Per cambiarlo, tasto destro su [[${cards[commanderId].name}]] → «Imposta come commander».`
          : '';
        reply = [reply, n ? `Ho riconosciuto ${n} cart${n === 1 ? 'a' : 'e'}: conferma qui sotto quali aggiungere.` : '',
          kept,
          notFound.length ? `Non ho trovato su Scryfall: ${notFound.join(', ')}.` : '']
          .filter(Boolean).join('\n');
      }

      // Budget via chat (§9.2): l'LLM estrae il numero, il tetto lo applica IL
      // SISTEMA (mai fidarsi che il modello "abbia già fatto"). Il mazzo
      // aggiornato torna alla pagina, che rinfresca header e statistiche.
      if (parsed.hasBudget) {
        const saved = await Store.put(Decks.setBudget(deckOut || (await Store.get(deck.id)) || deck, parsed.budget));
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

      const unchecked = uncheckedIds.filter((id) => cardIds.includes(id));
      return {
        ok: true, reply, cardIds, cards, query,
        ...(unchecked.length ? { uncheckedIds: unchecked } : {}),
        ...(retryable ? { retryable: true } : {}),
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

  // Imposta, cambia o toglie (scryfallId vuoto, #302) il commander (§8.4) con la regola unica di
  // Decks.replaceCommander: `previous` dice alla pagina quale carta è rientrata nel mazzo. La legalità non blocca
  // qui: è una riga delle statistiche (§9.1).
  on(MSG.DECKS_SET_COMMANDER, async (msg) => {
    const deck = await Store.get(String(msg?.id || ''));
    if (!deck) return { ok: false, error: 'not_found' };
    try {
      const wantId = String(msg?.scryfallId || '').trim();
      let card = null;
      if (wantId) {
        card = await Scry.card(wantId);
        if (!card) return { ok: false, error: 'card_not_found' };
      }
      const swap = Decks.replaceCommander(deck, card ? card.id : '', card
        ? { name: card.name, colors: card.colorIdentity, artCrop: card.artCrop } : null);
      const saved = swap.deck === deck ? deck : await Store.put(swap.deck);
      if (!saved) return { ok: false, error: 'save_failed' };
      return {
        ok: true, deck: saved,
        ...(swap.previousId ? { previous: { id: swap.previousId, name: swap.previousName } } : {}),
      };
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
