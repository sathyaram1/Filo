// Le chat con Filo (#525) lette e scritte come segmenti del filo (#866): qui le regole della chat, il disco lo tocca
// solo src/main/services/ilFilo.js. Logica pura di titoli, tipi e ricerca: src/shared/chatArchive.js.
// Niente cap sul numero di chat: il cap È la cancellazione automatica che il #525 esclude.

(function (global) {
  'use strict';

  const CA = () => global.SN_CHAT_ARCHIVE;
  const F = () => global.SN_IL_FILO;
  const T = () => global.SN_FILO_EVENTI.TIPI;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const list = () => F().chats();
  const get = (id) => (id ? F().chat(id) : Promise.resolve(null));

  // Per la Cronologia: senza i messaggi, che con anni di chat sarebbero megabyte a ogni apertura della pagina.
  async function listIndex() {
    return (await list()).map((c) => CA().toIndexEntry(c)).filter(Boolean);
  }

  // «Riprova» dopo un turno fallito rimanda la STESSA domanda: senza questo controllo resterebbe scritta due volte.
  // Scatta solo se l'ultimo messaggio è dell'utente ed è identico: dopo una risposta la ripetizione è voluta.
  function senzaRiprova(prima, msgs) {
    const ultimo = prima[prima.length - 1];
    const primo = msgs[0];
    if (!ultimo || !primo) return msgs;
    if (ultimo.role !== 'user' || primo.role !== 'user') return msgs;
    if (String(ultimo.text || '') !== String(primo.text || '')) return msgs;
    return msgs.slice(1);
  }

  function open({ id, onboarding = false, startedAt = null } = {}) {
    const chatId = id || uuid();
    return F().transazione(async (t) => {
      const c = t.chat(chatId);
      if (c) return global.SN_FILO_EVENTI.copiaChat(c);
      await t.scrivi([t.evento(T().CHAT_APERTA, { chat: chatId, onboarding: onboarding ? true : undefined },
        { autore: 'utente', ts: startedAt || undefined })]);
      return global.SN_FILO_EVENTI.copiaChat(t.chat(chatId));
    });
  }

  // Ogni messaggio è un evento del filo, su disco appena esiste. `meta.onboarding` marca l'intervista di benvenuto.
  function append(id, turns, meta) {
    const chatId = id || uuid();
    const list0 = Array.isArray(turns) ? turns : [turns];
    const msgs = list0.map((tt) => CA().toStoredMessage(tt)).filter(Boolean);
    if (!msgs.length) return Promise.resolve(null);
    return F().transazione(async (t) => {
      const c = t.chat(chatId);
      const daAggiungere = senzaRiprova(c ? c.messages : [], msgs);
      const eventi = daAggiungere.map((m) => {
        const { ts, ...msg } = m;
        return t.evento(T().MESSAGGIO, {
          chat: chatId, msg, onboarding: meta && meta.onboarding ? true : undefined,
        }, { autore: m.role === 'user' ? 'utente' : 'filo', ts });
      });
      if (eventi.length) await t.scrivi(eventi);
      return global.SN_FILO_EVENTI.copiaChat(t.chat(chatId));
    });
  }

  // Ritorna la chat chiusa, o null se non c'è niente da chiudere: una home aperta e mai usata non è una conversazione.
  function close(id) {
    if (!id) return Promise.resolve(null);
    return F().transazione(async (t) => {
      const c = t.chat(id);
      if (!c) return null;
      if (!c.messages.length) {
        await t.scrivi([t.evento(T().CANCELLAZIONE, { chat: id }, { autore: 'utente' })]);
        return null;
      }
      if (!c.closedAt) await t.scrivi([t.evento(T().CHAT_CHIUSA, { chat: id }, { autore: 'utente' })]);
      return global.SN_FILO_EVENTI.copiaChat(t.chat(id));
    });
  }

  function scriviTitolo(t, c, campi, autore) {
    return t.scrivi([t.evento(T().CHAT_TITOLO, {
      chat: c.id,
      title: campi.title,
      kind: campi.kind,
      titleByUser: campi.titleByUser ? true : undefined,
      kindByUser: campi.kindByUser ? true : undefined,
      triagedCount: c.messages.length,
    }, { autore })]);
  }

  // Titolo e tipo scelti DALL'UTENTE vincono e non vengono più riscritti dal classificatore.
  function setUserTriage(id, { title, kind } = {}) {
    if (!id) return Promise.resolve(null);
    return F().transazione(async (t) => {
      const c = t.chat(id);
      if (!c) return null;
      const campi = { title: c.title, kind: c.kind, titleByUser: !!c.titleByUser, kindByUser: !!c.kindByUser };
      if (title != null) {
        const pulito = String(title).replace(/\s+/g, ' ').trim();
        if (pulito) { campi.title = CA().clampTitle(pulito); campi.titleByUser = true; }
      }
      if (kind != null) { campi.kind = CA().normalizeKind(kind); campi.kindByUser = true; }
      await scriviTitolo(t, c, campi, 'utente');
      return global.SN_FILO_EVENTI.copiaChat(t.chat(id));
    });
  }

  // Titolo e tipo del classificatore (li calcola chi ha il modello: handlers.js).
  function setTriage(id, { title, kind } = {}) {
    if (!id) return Promise.resolve(null);
    return F().transazione(async (t) => {
      const c = t.chat(id);
      if (!c) return null;
      const campi = { title: c.title, kind: c.kind };
      if (title && !c.titleByUser) campi.title = CA().clampTitle(title);
      if (c.kindByUser) {
        // L'utente ha già detto dove va questa chat: il modello non lo smentisce.
      } else if (c.onboarding) {
        // L'intervista di benvenuto resta una conversazione qualunque cosa dica il modello.
        campi.kind = CA().KIND_TALK;
      } else if (kind == null) {
        // Classificatore senza risposta: il tipo resta IGNOTO (si riprova alla partenza dopo), non «conversazione».
        campi.kind = null;
      } else {
        campi.kind = CA().normalizeKind(kind);
      }
      await scriviTitolo(t, c, campi, 'filo');
      return global.SN_FILO_EVENTI.copiaChat(t.chat(id));
    });
  }

  // Va (ri)classificata se non lo è mai stata o se da allora la conversazione è andata avanti: un «comando»
  // diventato discussione resterebbe nascosto sotto il filtro.
  function needsTriage(chat) {
    if (!chat) return true;
    if (chat.titleByUser && chat.kindByUser) return false;
    if (!chat.kind || !chat.title) return true;
    const n = Array.isArray(chat.messages) ? chat.messages.length : 0;
    return Number(chat.triagedCount) !== n;
  }

  // Cancellare è un evento in coda, e il contenuto della chat sparisce anche dal file.
  async function remove(id) {
    if (id) {
      await F().transazione(async (t) => {
        if (t.chat(id)) await t.scrivi([t.evento(T().CANCELLAZIONE, { chat: id }, { autore: 'utente' })]);
      });
    }
    return list();
  }

  // Le chat rimaste aperte perché l'app è stata chiusa di colpo: alla partenza dopo si chiudono e si classificano.
  async function listDangling() {
    return (await list()).filter((c) => !c.closedAt && c.messages.length);
  }

  // Le chat chiuse ancora senza titolo e tipo (classificazione non riuscita, o conversazione andata avanti).
  async function listUntriaged() {
    return (await list()).filter((c) => c.closedAt && needsTriage(c));
  }

  async function clear() {
    const ids = (await list()).map((c) => c.id);
    if (ids.length) {
      await F().transazione((t) => t.scrivi(ids.map((id) => t.evento(T().CANCELLAZIONE, { chat: id }, { autore: 'utente' }))));
    }
    return [];
  }

  global.SN_FILO_CHATS = {
    list, listIndex, get, needsTriage, listDangling, listUntriaged, uuid, open, append, close, setTriage, setUserTriage,
    remove, clear,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
