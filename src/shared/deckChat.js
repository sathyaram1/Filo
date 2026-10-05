// Chat del banco di lavoro di un mazzo (DECK-BUILDER-SPEC.md §3.2): cosa di una bolla si conserva e come si
// rilegge. Logica pura: l'I/O sta in src/main/services/deckChats.js. Prove: tests/unit/deckChat.test.mjs.

(function (global) {
  'use strict';

  // Tetto di sicurezza, non di uso: 2500 scambi su un mazzo solo. Oltre, si rifiuta il salvataggio e la pagina
  // lo dice; niente rotazione delle bolle vecchie (patterns/classificare-per-decidere-cosa-si-vede-mai-cosa-si-conserva.md).
  const MAX_MESSAGES = 5000;

  function str(v) { return typeof v === 'string' ? v : ''; }

  // Ordinamenti di una lista della chat; il primo è il default (§3.4), e non si salva.
  const SORTS = ['cmc', 'name', 'price'];

  function idList(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  }

  function qtyMap(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out = {};
    for (const [id, q] of Object.entries(v)) {
      const n = Math.floor(Number(q));
      if (id && n > 0) out[id] = n;
    }
    return Object.keys(out).length ? out : null;
  }

  function nameMap(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out = {};
    for (const [name, id] of Object.entries(v)) {
      if (name && typeof id === 'string' && id) out[name] = id;
    }
    return Object.keys(out).length ? out : null;
  }

  // Solo DATI: lo stato di vista (lista aperta, ragionamento aperto, «già aggiunte» che si ricava dal mazzo di
  // adesso) non si conserva, così alla riapertura le liste vecchie sono chiuse e l'ultima aperta (§3.3). Il turno
  // (`turn`) è l'identità di una risposta: chi la completa, la riprova o ne salva i nomi la ritrova da lì. Una
  // risposta in volo senza turno non ha nessuno che la aspetti: è interrotta.
  function cleanMessage(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.who === 'user') {
      const text = str(m.text);
      return text ? { who: 'user', text } : null;
    }
    if (m.who !== 'bot') return null;
    const out = { who: 'bot' };
    const turn = str(m.turn);
    if (turn) out.turn = turn;
    const reasoning = str(m.reasoning);
    if (reasoning) out.reasoning = reasoning;
    const names = nameMap(m.nameIds);
    if (names) out.nameIds = names;
    if (m.pending && turn) { out.pending = true; return out; }
    if (m.pending || m.interrupted) { out.interrupted = true; return out; }
    if (m.error) { out.error = str(m.error) || 'nessuna risposta'; return out; }
    const reply = str(m.reply);
    if (reply) out.reply = reply;
    // «Svuota la chat» chiesto a parole: la bolla tiene il suo tasto, così la richiesta sopravvive ad Annulla e ai cambi di mazzo.
    if (m.clearChat === true) out.clearChat = true;
    // Turno andato solo in parte: il tasto Riprova resta anche riaprendo la chat.
    if (m.retryable === true) out.retryable = true;
    const cardIds = idList(m.cardIds);
    if (cardIds.length) out.cardIds = cardIds;
    // Le righe che il giudice non ha potuto guardare restano segnate anche riaprendo la chat (#382).
    const unchecked = idList(m.uncheckedIds).filter((id) => cardIds.includes(id));
    if (unchecked.length) out.uncheckedIds = unchecked;
    const query = str(m.query);
    if (query) out.query = query;
    // Titolo e ordinamento della lista (#788) sono della lista come le sue carte: riaprendo la chat restano.
    const title = str(m.title).replace(/\s+/g, ' ').trim();
    if (title && cardIds.length) out.title = title;
    if (cardIds.length && SORTS.includes(m.sort) && m.sort !== SORTS[0]) out.sort = m.sort;
    const qty = qtyMap(m.importQty);
    if (qty) out.importQty = qty;
    const cmd = str(m.importCommanderId);
    if (cmd) out.importCommanderId = cmd;
    return out;
  }

  function cleanChat(list) {
    return Array.isArray(list) ? list.map(cleanMessage).filter(Boolean) : [];
  }

  function fits(list) {
    return (Array.isArray(list) ? list.length : 0) <= MAX_MESSAGES;
  }

  // Una risposta resta «sta pensando» solo finché la pagina che l'ha chiesta è ancora lì ad aspettarla (`isLive`,
  // lo sa il main); altrimenti si rilegge interrotta, col suo turno per «Riprova».
  function forReading(list, isLive) {
    return cleanChat(list).map((m) => {
      if (!m.pending || (typeof isLive === 'function' && isLive(m.turn))) return m;
      const { pending, ...rest } = m;
      return { ...rest, interrupted: true };
    });
  }

  function turnIndex(list, turn) {
    return turn ? list.findIndex((m) => m.who === 'bot' && m.turn === turn) : -1;
  }

  // Le schede non riscrivono mai la chat intera: ognuna manda la SUA modifica, applicata sulla chat salvata di
  // adesso. Così una scheda rimasta indietro (un'altra ha svuotato, o ha scritto nel frattempo) non riporta in
  // vita niente e non cancella il lavoro dell'altra. Risultato: { list } oppure { error }.
  function applyEdit(list, change) {
    const cur = cleanChat(list);
    const c = change && typeof change === 'object' ? change : {};
    if (c.op === 'append') {
      const next = cur.concat(cleanChat(c.messages));
      return fits(next) ? { list: next } : { error: 'too_many' };
    }
    if (c.op === 'fill') {
      const i = turnIndex(cur, str(c.turn));
      const m = cleanMessage({ ...(c.message || {}), who: 'bot', turn: str(c.turn), pending: false, interrupted: false });
      if (i < 0 || !m) return { error: 'gone' };
      if (!m.nameIds && cur[i].nameIds) m.nameIds = cur[i].nameIds;
      cur[i] = m;
      return { list: cur };
    }
    if (c.op === 'drop') {
      // Riprova: via la risposta fallita e la domanda che l'ha chiesta. Una bolla senza turno (salvata prima dei
      // turni) si riconosce dall'essere l'ultima, fallita, dopo la stessa domanda.
      const text = str(c.userText);
      let i = turnIndex(cur, str(c.turn));
      if (i < 0 && !c.turn) {
        const last = cur.length - 1;
        const m = cur[last];
        if (m && m.who === 'bot' && (m.error || m.interrupted || m.pending)) i = last;
      }
      if (i < 0) return { error: 'gone' };
      const from = i > 0 && cur[i - 1].who === 'user' && (!text || cur[i - 1].text === text) ? i - 1 : i;
      cur.splice(from, i - from + 1);
      return { list: cur };
    }
    if (c.op === 'sort') {
      const i = turnIndex(cur, str(c.turn));
      if (i < 0) return { error: 'gone' };
      if (!SORTS.includes(c.sort)) return { error: 'bad_sort' };
      const { sort, ...rest } = cur[i];
      cur[i] = cleanMessage({ ...rest, sort: c.sort });
      return { list: cur };
    }
    if (c.op === 'names') {
      const i = turnIndex(cur, str(c.turn));
      if (i < 0) return { error: 'gone' };
      const names = nameMap({ ...(cur[i].nameIds || {}), ...(nameMap(c.nameIds) || {}) });
      if (names) cur[i] = { ...cur[i], nameIds: names };
      return { list: cur };
    }
    return { error: 'bad_op' };
  }

  // Le carte di una lista nell'ordine scelto. Stabile: a pari valore resta l'ordine della ricerca; una carta senza
  // prezzo va in fondo, non in testa come se fosse gratis.
  function sortIds(ids, cardsById, sort) {
    const by = cardsById || {};
    const list = idList(ids);
    if (sort === 'name') {
      const name = (id) => str(by[id] && by[id].name) || id;
      return list.sort((a, b) => name(a).localeCompare(name(b), 'it', { sensitivity: 'base' }));
    }
    if (sort === 'price') {
      const price = (id) => {
        const p = by[id] && by[id].priceEur;
        return typeof p === 'number' && Number.isFinite(p) ? p : Infinity;
      };
      return list.sort((a, b) => (price(a) === price(b) ? 0 : price(a) - price(b)));
    }
    const cmc = (id) => Number(by[id] && by[id].cmc) || 0;
    return list.sort((a, b) => cmc(a) - cmc(b));
  }

  // La riga di sintesi di una lista: il numero e la frase del modello, o il ripiego. Mai la query (#788).
  // Il titolo si legge dopo il numero: il suo numero davanti si toglie, e la maiuscola di un titolo («Carte che…»)
  // scende, salvo una parola che non è tutta minuscola dopo l'iniziale o un nome di due parole maiuscole (Sol Ring).
  function listLabel(n, title) {
    const count = Math.max(0, Math.floor(Number(n)) || 0);
    let what = str(title).replace(/^\d+\s+(?=\S)/, '').trim();
    if (/^\p{Lu}\p{Ll}*(?=[\s,:;.!?]|$)/u.test(what) && !/^\S+\s+\p{Lu}/u.test(what)) {
      what = what.charAt(0).toLowerCase() + what.slice(1);
    }
    if (!what) return `${count} risultat${count === 1 ? 'o' : 'i'}`;
    return count === 1 ? `1 risultato: ${what}` : `${count} ${what}`;
  }

  // Lo storico per il modello: domande e risposte scritte, niente bolle d'errore o interrotte.
  function historyFor(msgs) {
    return (msgs || [])
      .filter((m) => m && ((m.who === 'user' && m.text) || (m.who === 'bot' && m.reply)))
      .map((m) => (m.who === 'user'
        ? { role: 'user', content: m.text }
        : { role: 'assistant', content: m.reply }));
  }

  // Le carte che la chat mostra o cita, dalla bolla più recente: è l'ordine in cui servono a chi guarda.
  function cardIdsOf(msgs) {
    const seen = new Set();
    const list = Array.isArray(msgs) ? msgs : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (!m || m.who !== 'bot') continue;
      for (const id of idList(m.cardIds)) seen.add(id);
      if (typeof m.importCommanderId === 'string' && m.importCommanderId) seen.add(m.importCommanderId);
      const names = nameMap(m.nameIds);
      if (names) for (const id of Object.values(names)) seen.add(id);
    }
    return [...seen];
  }

  global.SN_DECK_CHAT = {
    MAX_MESSAGES, SORTS, cleanMessage, cleanChat, fits, forReading, applyEdit, historyFor, cardIdsOf, sortIds, listLabel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
