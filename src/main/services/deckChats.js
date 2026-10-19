// Magazzino della chat per mazzo (DECK-BUILDER-SPEC.md §3.2): STORAGE_KEYS.DECK_CHATS su chrome.storage.local.
// Cosa si conserva e come si applica una modifica lo decide SN_DECK_CHAT; qui solo lettura/scrittura, in fila
// (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md), e i turni ancora attesi.

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;
  const Chat = global.SN_DECK_CHAT;

  let coda = Promise.resolve();
  function inCoda(fn) {
    const risultato = coda.then(fn, fn);
    coda = risultato.then(() => {}, () => {});
    return risultato;
  }

  async function readAll() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.DECK_CHATS);
    const map = r[STORAGE_KEYS.DECK_CHATS];
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  // Turni che una pagina viva sta aspettando. Solo in memoria: dopo un riavvio nessuno aspetta più niente. Una
  // pagina ricaricata, chiusa o andata altrove non completerà mai il suo turno: lo si chiude qui e si avvisa.
  const live = new Map(); // turno → togli gli ascoltatori

  function endTurn(turn) {
    const stop = live.get(turn);
    if (!stop) return false;
    live.delete(turn);
    stop();
    return true;
  }

  // La pagina che aspetta se ne va (ricaricata, chiusa, altrove): `fn` una volta sola. Torna la funzione che smette
  // di guardare. Un cambio di hash (#/deck/…) è la stessa pagina che continua ad aspettare: conta solo un documento nuovo.
  function onLeave(wc, fn) {
    if (!wc || typeof wc.on !== 'function') return () => {};
    let stop = () => {};
    const leave = () => { stop(); fn(); };
    const onNav = (e, _url, isInPlace, isMainFrame) => {
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (main && !same) leave();
    };
    try { wc.on('did-start-navigation', onNav); wc.once('destroyed', leave); } catch (_) {}
    stop = () => {
      try { wc.removeListener('did-start-navigation', onNav); wc.removeListener('destroyed', leave); } catch (_) {}
    };
    return stop;
  }

  function watchTurn(turn, wc, onAbandon) {
    if (!turn || live.has(turn)) return;
    live.set(turn, onLeave(wc, () => { if (endTurn(turn) && onAbandon) onAbandon(); }));
  }

  function isLive(turn) { return live.has(turn); }

  async function get(deckId) {
    const all = await readAll();
    const entry = all[deckId];
    return Chat.forReading(entry && entry.messages, isLive);
  }

  // La chat del mazzo entra nel filo come riga ripiegata (#974): la annota chi la salva, così ogni strada che scrive
  // una domanda o completa una risposta (invio, Riprova, import a parole) ci passa. Errori e risposte a metà no.
  function testoRisposta(m) {
    const r = Chat.cleanMessage({ ...(m || {}), who: 'bot', pending: false });
    if (!r || r.error || r.stopped || r.interrupted) return '';
    const n = Array.isArray(r.cardIds) ? r.cardIds.length : 0;
    const lista = n ? `${r.title || 'Carte trovate'}: ${n} ${n === 1 ? 'carta' : 'carte'}` : '';
    return [r.reply || '', lista].filter(Boolean).join('\n');
  }
  async function nelFilo(deck, c) {
    const F = global.SN_CONVERSAZIONI_APP;
    if (!F || !deck) return;
    let messaggi = [];
    if (c.op === 'append') {
      messaggi = Chat.cleanChat(c.messages).filter((m) => m.who === 'user' && m.text).map((m) => ({ role: 'user', text: m.text }));
    } else if (c.op === 'fill') {
      const t = testoRisposta(c.message);
      if (t) messaggi = [{ role: 'filo', text: t }];
    }
    if (!messaggi.length) return;
    return F.annota({
      app: 'mazzi', rif: deck.id, soggetto: deck.nome, dove: `filo://decks/decks.html#/deck/${encodeURIComponent(deck.id)}`, messaggi,
    }).catch((e) => console.warn('[Filo] chat del mazzo nel filo:', e?.message || e));
  }

  // Il controllo che il mazzo esista sta DENTRO la fila: una risposta che arriva dopo l'eliminazione del mazzo
  // non deve far rinascere la sua chat (dropDeck è in fila dopo di lei, o lei trova il mazzo già sparito).
  // Il turno nuovo è atteso da subito, prima della scrittura: chi rilegge all'avviso lo trova «sta pensando».
  function edit(deckId, change, { wc, onAbandon } = {}) {
    const c = change && typeof change === 'object' ? change : {};
    if (c.op === 'append') {
      for (const m of Chat.cleanChat(c.messages)) if (m.pending) watchTurn(m.turn, wc, onAbandon);
    }
    return inCoda(async () => {
      try {
        const deck = await global.SN_DECK_STORE.get(deckId);
        if (!deck) return { ok: false, error: 'not_found' };
        const all = await readAll();
        const entry = all[deckId];
        const r = Chat.applyEdit(entry && entry.messages, c);
        if (r.error === 'too_many') return { ok: false, error: 'too_many', max: Chat.MAX_MESSAGES };
        if (r.error) return { ok: false, error: r.error };
        if (r.list.length) all[deckId] = { messages: r.list, updatedAt: Date.now() };
        else if (all[deckId]) delete all[deckId];
        else return { ok: true };
        await chrome.storage.local.set({ [STORAGE_KEYS.DECK_CHATS]: all });
        // Dentro la fila: uno svuotamento che arriva dopo trova la conversazione già nel filo, e la toglie.
        await nelFilo(deck, c);
        return { ok: true };
      } finally {
        // Completato o ritirato, il turno non è più atteso: DOPO la scrittura, così nessuno lo legge interrotto.
        if ((c.op === 'fill' || c.op === 'drop') && c.turn) endTurn(String(c.turn));
      }
    });
  }

  // Svuotata o col mazzo eliminato, la conversazione «sparisce per sempre»: anche dal filo (#974).
  function dropDeck(deckId) {
    return inCoda(async () => {
      const all = await readAll();
      if (all[deckId]) {
        delete all[deckId];
        await chrome.storage.local.set({ [STORAGE_KEYS.DECK_CHATS]: all });
      }
      try { await global.SN_CONVERSAZIONI_APP?.dimentica({ app: 'mazzi', rif: String(deckId) }); }
      catch (e) { console.warn('[Filo] chat del mazzo via dal filo:', e?.message || e); }
    });
  }

  global.SN_DECK_CHATS_SVC = { get, edit, dropDeck, isLive, onLeave };
})(typeof globalThis !== 'undefined' ? globalThis : self);
