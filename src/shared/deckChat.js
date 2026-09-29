// Chat del banco di lavoro di un mazzo (DECK-BUILDER-SPEC.md §3.2): cosa di una bolla si conserva e come si
// rilegge. Logica pura: l'I/O sta in src/main/services/deckChats.js. Prove: tests/unit/deckChat.test.mjs.

(function (global) {
  'use strict';

  // Tetto di sicurezza, non di uso: 2500 scambi su un mazzo solo. Oltre, si rifiuta il salvataggio e la pagina
  // lo dice; niente rotazione delle bolle vecchie (patterns/classificare-per-decidere-cosa-si-vede-mai-cosa-si-conserva.md).
  const MAX_MESSAGES = 5000;

  function str(v) { return typeof v === 'string' ? v : ''; }

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

  // Solo DATI: lo stato di vista (lista aperta, ragionamento aperto) non si conserva, così alla riapertura le
  // liste vecchie sono chiuse e l'ultima aperta (§3.3). Una risposta ancora in volo si rilegge come interrotta:
  // chi la aspettava non c'è più.
  function cleanMessage(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.who === 'user') {
      const text = str(m.text);
      return text ? { who: 'user', text } : null;
    }
    if (m.who !== 'bot') return null;
    const out = { who: 'bot' };
    const reasoning = str(m.reasoning);
    if (reasoning) out.reasoning = reasoning;
    const names = nameMap(m.nameIds);
    if (names) out.nameIds = names;
    if (m.pending || m.interrupted) { out.interrupted = true; return out; }
    if (m.error) { out.error = str(m.error) || 'nessuna risposta'; return out; }
    const reply = str(m.reply);
    if (reply) out.reply = reply;
    const cardIds = idList(m.cardIds);
    if (cardIds.length) out.cardIds = cardIds;
    const query = str(m.query);
    if (query) out.query = query;
    const qty = qtyMap(m.importQty);
    if (qty) out.importQty = qty;
    const cmd = str(m.importCommanderId);
    if (cmd) out.importCommanderId = cmd;
    if (m.imported === true) out.imported = true;
    return out;
  }

  function cleanChat(list) {
    return Array.isArray(list) ? list.map(cleanMessage).filter(Boolean) : [];
  }

  function fits(list) {
    return (Array.isArray(list) ? list.length : 0) <= MAX_MESSAGES;
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

  global.SN_DECK_CHAT = { MAX_MESSAGES, cleanMessage, cleanChat, fits, historyFor, cardIdsOf };
})(typeof globalThis !== 'undefined' ? globalThis : self);
