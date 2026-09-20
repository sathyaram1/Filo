// #525 — persistenza delle chat con Filo.
//
// «Ogni chat si salva per intero sul disco dell'utente, sempre, in locale.
// Niente si butta in automatico.» Questo file è l'unico posto che scrive
// l'archivio; la logica pura (titoli, tipi, ricerca) sta in
// src/shared/chatArchive.js.
//
// Due scelte che vale la pena sapere:
//
//  • **Si scrive turno per turno, non alla chiusura.** Una chat salvata solo
//    quando la si chiude è una chat persa ogni volta che l'app muore a metà
//    discussione — cioè proprio nel caso in cui il salvataggio serviva. Ogni
//    messaggio (dell'utente e di Filo) finisce su disco appena esiste.
//  • **Passa da chrome.storage.local**, come l'archivio delle schede. Non è
//    un dettaglio di comodità: è lì che vive la garanzia dell'incognito (vedi
//    src/main/shim/storage.js, allowlist fail-closed). Scrivendo file per
//    conto nostro, una chat fatta in una finestra incognito resterebbe su
//    disco.
//
// Niente cap sul numero di chat: il cap È la cancellazione automatica che il
// feedback esclude. Una chat pesa qualche KB; la pulizia in blocco, se mai
// servirà, la chiederà l'utente.

(function (global) {
  'use strict';

  const KEY = global.SN_CONST.STORAGE_KEYS.FILO_CHATS;
  const CA = () => global.SN_CHAT_ARCHIVE;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function list() {
    try {
      const res = await chrome.storage.local.get(KEY);
      const arr = res[KEY];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  async function save(items) {
    await chrome.storage.local.set({ [KEY]: items });
  }

  async function get(id) {
    if (!id) return null;
    const items = await list();
    return items.find((c) => c && c.id === id) || null;
  }

  // L'elenco per la pagina Cronologia: senza i messaggi. Un utente con anni di
  // chat alle spalle spedirebbe megabyte via IPC ad ogni apertura della pagina
  // per mostrare una lista di titoli.
  async function listIndex() {
    const items = await list();
    return items.map((c) => CA().toIndexEntry(c)).filter(Boolean);
  }

  // Apre una chat nuova. `id` lo decide il chiamante (la dashboard) così il
  // primo messaggio arriva già con la sua targa e non serve un giro in più.
  async function open({ id, onboarding = false, startedAt = null } = {}) {
    const chatId = id || uuid();
    const items = await list();
    const existing = items.find((c) => c && c.id === chatId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const entry = {
      id: chatId,
      startedAt: startedAt || now,
      updatedAt: now,
      closedAt: null,
      title: '',
      kind: null,
      onboarding: !!onboarding,
      messages: [],
    };
    items.unshift(entry);
    await save(items);
    return entry;
  }

  // Aggiunge messaggi a una chat, creandola se non c'è ancora (la dashboard
  // manda il suo id col primo messaggio: non serve aprirla prima).
  // `meta` può portare { onboarding: true } per marcare l'intervista.
  async function append(id, turns, meta) {
    const chatId = id || uuid();
    const list0 = Array.isArray(turns) ? turns : [turns];
    const msgs = list0.map((t) => CA().toStoredMessage(t)).filter(Boolean);
    if (!msgs.length) return null;
    const items = await list();
    let idx = items.findIndex((c) => c && c.id === chatId);
    if (idx < 0) {
      const now = new Date().toISOString();
      items.unshift({
        id: chatId,
        startedAt: msgs[0].ts || now,
        updatedAt: now,
        closedAt: null,
        title: '',
        kind: null,
        onboarding: !!(meta && meta.onboarding),
        messages: [],
      });
      idx = 0;
    }
    const chat = items[idx];
    chat.messages = (Array.isArray(chat.messages) ? chat.messages : []).concat(msgs);
    chat.updatedAt = msgs[msgs.length - 1].ts || new Date().toISOString();
    // Riaprire una chat chiusa e continuare a scrivere la rimette in vita: non
    // resta «chiusa ieri» con dentro un messaggio di oggi. La riclassificazione
    // avverrà alla prossima chiusura.
    chat.closedAt = null;
    // L'intervista di benvenuto è SEMPRE una conversazione: lo dice il
    // feedback, e non dipende da come è andata. Il marchio si può solo
    // accendere (un turno normale dopo l'intervista non la declassa).
    if (meta && meta.onboarding) chat.onboarding = true;
    // La chat più mossa torna in testa: l'elenco è per recenza.
    if (idx > 0) { items.splice(idx, 1); items.unshift(chat); }
    await save(items);
    return chat;
  }

  // Chiude una chat: fissa la data di chiusura. Titolo e tipo li scrive
  // `classify` subito dopo, e possono arrivare con qualche secondo di ritardo
  // (una chiamata al modello): la chat esiste già, intera, da prima.
  // Ritorna la chat chiusa, o null se non c'è niente da chiudere (chat
  // inesistente o senza nemmeno un messaggio — una home aperta e mai usata non
  // è una conversazione).
  async function close(id) {
    if (!id) return null;
    const items = await list();
    const idx = items.findIndex((c) => c && c.id === id);
    if (idx < 0) return null;
    const chat = items[idx];
    if (!Array.isArray(chat.messages) || !chat.messages.length) {
      // Chat vuota: si toglie del tutto invece di restare un guscio senza
      // titolo in cronologia.
      items.splice(idx, 1);
      await save(items);
      return null;
    }
    if (!chat.closedAt) {
      chat.closedAt = new Date().toISOString();
      await save(items);
    }
    return chat;
  }

  // Scrive titolo e tipo (li calcola chi ha il modello: handlers.js).
  async function setTriage(id, { title, kind } = {}) {
    if (!id) return null;
    const items = await list();
    const idx = items.findIndex((c) => c && c.id === id);
    if (idx < 0) return null;
    const chat = items[idx];
    if (title) chat.title = CA().clampTitle(title);
    // L'intervista di benvenuto resta una conversazione qualunque cosa dica il
    // modello.
    chat.kind = chat.onboarding ? CA().KIND_TALK : CA().normalizeKind(kind);
    await save(items);
    return chat;
  }

  async function remove(id) {
    const items = await list();
    const filtered = items.filter((c) => c && c.id !== id);
    await save(filtered);
    return filtered;
  }

  // Le chat rimaste aperte perché l'app è stata chiusa di colpo. Alla partenza
  // successiva vanno chiuse e classificate: senza questo giro resterebbero
  // senza titolo e senza tipo per sempre, ed è il caso più comune di tutti
  // (chiudere Filo È il modo normale di finire una chat).
  async function listDangling() {
    const items = await list();
    return items.filter((c) => c && !c.closedAt && Array.isArray(c.messages) && c.messages.length);
  }

  // Le chat chiuse ma senza tipo: la classificazione non è riuscita (niente
  // chiave, limite di spesa, rete assente). Si ritenta alla partenza dopo.
  // Restano intanto visibili fra le conversazioni.
  async function listUntriaged() {
    const items = await list();
    return items.filter((c) => c && c.closedAt && !c.kind);
  }

  async function clear() {
    await save([]);
    return [];
  }

  global.SN_FILO_CHATS = {
    list, listIndex, get, open, append, close, setTriage,
    remove, listDangling, listUntriaged, clear, uuid,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
