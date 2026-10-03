// Il filo (#866): la forma degli eventi e la loro piegatura in chat e pagine visitate. Logica pura, niente disco:
// legge e scrive solo src/main/services/ilFilo.js. Regole: patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md,
// sentinella tests/unit/filoEventi.test.mjs.

(function (global) {
  'use strict';

  const VERSIONE = 1;
  const TIPI = Object.freeze({
    CHAT_APERTA: 'chat.aperta',
    MESSAGGIO: 'messaggio',
    CHAT_CHIUSA: 'chat.chiusa',
    CHAT_TITOLO: 'chat.titolo',
    NAVIGAZIONE: 'navigazione',
    CANCELLAZIONE: 'cancellazione',
  });
  const AUTORI = Object.freeze(['utente', 'filo', 'automazione']);
  const ORA_MS = 60 * 60 * 1000;
  const PERIODI = Object.freeze(['ultima_ora', 'oggi', 'tutto']);

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  const isoValida = (s) => typeof s === 'string' && s.length >= 20 && !Number.isNaN(Date.parse(s));
  const stringa = (s) => typeof s === 'string' && s.length > 0;

  // Un tipo sconosciuto è valido: lo scriverà una versione più nuova (le azioni, un altro dispositivo) e chi non lo
  // capisce lo conserva senza piegarlo, invece di buttarlo alla prima riscrittura.
  function valido(ev) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
    if (ev.v !== VERSIONE || !stringa(ev.id) || !isoValida(ev.ts) || !stringa(ev.dispositivo)) return false;
    if (!AUTORI.includes(ev.autore) || !stringa(ev.tipo)) return false;
    switch (ev.tipo) {
      case TIPI.CHAT_APERTA:
      case TIPI.CHAT_CHIUSA:
      case TIPI.CHAT_TITOLO:
        return stringa(ev.chat);
      case TIPI.MESSAGGIO:
        return stringa(ev.chat) && !!ev.msg && typeof ev.msg === 'object' && typeof ev.msg.text === 'string'
          && (ev.msg.role === 'user' || ev.msg.role === 'filo');
      case TIPI.NAVIGAZIONE:
        return stringa(ev.url) && typeof ev.titolo === 'string';
      case TIPI.CANCELLAZIONE:
        if (ev.chat != null) return stringa(ev.chat);
        return !!ev.pagine && typeof ev.pagine === 'object'
          && (ev.pagine.da == null || isoValida(ev.pagine.da)) && (ev.pagine.a == null || isoValida(ev.pagine.a));
      default:
        return true;
    }
  }

  // Un'ora in un'altra forma (numero, data senza millisecondi) si normalizza: un evento non si perde per l'orologio.
  function normaTs(ts) {
    if (ts == null || ts === '') return new Date().toISOString();
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  }

  // L'ordine dei campi è fisso: due dispositivi che scrivono lo stesso evento producono la stessa riga.
  function crea(tipo, campi, { id, ts, dispositivo, autore } = {}) {
    const ev = {
      v: VERSIONE,
      id: id || uuid(),
      ts: isoValida(ts) ? ts : normaTs(ts),
      dispositivo: String(dispositivo || ''),
      autore: AUTORI.includes(autore) ? autore : 'utente',
      tipo,
    };
    for (const k of Object.keys(campi || {})) {
      if (campi[k] !== undefined && !(k in ev)) ev[k] = campi[k];
    }
    return ev;
  }

  // JSON.stringify scappa ogni a capo dentro le stringhe: una riga è sempre un evento intero.
  function riga(ev) {
    return JSON.stringify(ev) + '\n';
  }

  // Una riga rotta (scrittura interrotta da un guasto di corrente) si salta e si conta, non ferma la lettura.
  function analizza(testo) {
    const eventi = [];
    let scartate = 0;
    for (const r of String(testo || '').split('\n')) {
      if (!r.trim()) continue;
      try {
        const ev = JSON.parse(r);
        if (valido(ev)) eventi.push(ev); else scartate++;
      } catch (_) { scartate++; }
    }
    return { eventi, scartate };
  }

  function nuovoStato() {
    return { chat: new Map(), pagine: new Map(), ids: new Set(), pos: 0 };
  }

  function nelPeriodo(ts, pagine) {
    const t = Date.parse(ts);
    if (pagine.da != null && t < Date.parse(pagine.da)) return false;
    if (pagine.a != null && t > Date.parse(pagine.a)) return false;
    return true;
  }

  function chatNuova(id, ts) {
    return {
      id, startedAt: ts, updatedAt: ts, closedAt: null, title: '', kind: null, onboarding: false, messages: [], _pos: 0,
    };
  }

  // Piega un evento nello stato. Un id già visto non conta due volte: è la regola che rende ripetibili import e
  // sincronizzazione. Ritorna quante cose una cancellazione ha tolto (zero per gli altri eventi).
  function applica(stato, ev) {
    if (!valido(ev) || stato.ids.has(ev.id)) return { nuovo: false, tolti: 0 };
    stato.ids.add(ev.id);
    stato.pos += 1;
    let c = ev.chat != null ? stato.chat.get(ev.chat) : null;
    switch (ev.tipo) {
      case TIPI.CHAT_APERTA:
        if (!c) { c = chatNuova(ev.chat, ev.ts); c._pos = stato.pos; stato.chat.set(ev.chat, c); }
        if (ev.onboarding) c.onboarding = true;
        break;
      case TIPI.MESSAGGIO: {
        if (!c) { c = chatNuova(ev.chat, ev.ts); stato.chat.set(ev.chat, c); }
        c.messages.push({ ...ev.msg, ts: ev.ts });
        c.updatedAt = ev.ts;
        c._pos = stato.pos;
        // Riapre solo l'utente: una risposta arrivata a chat chiusa è la coda di quella di prima.
        if (ev.msg.role === 'user') c.closedAt = null;
        if (ev.onboarding) c.onboarding = true;
        break;
      }
      case TIPI.CHAT_CHIUSA:
        if (c && !c.closedAt) c.closedAt = ev.ts;
        break;
      case TIPI.CHAT_TITOLO:
        if (!c) break;
        if (typeof ev.title === 'string') c.title = ev.title;
        if (ev.kind !== undefined) c.kind = ev.kind;
        if (ev.titleByUser) c.titleByUser = true;
        if (ev.kindByUser) c.kindByUser = true;
        if (Number.isFinite(ev.triagedCount)) c.triagedCount = ev.triagedCount;
        break;
      case TIPI.NAVIGAZIONE:
        stato.pagine.set(ev.id, {
          id: ev.id, ts: ev.ts, url: ev.url, titolo: ev.titolo, scheda: ev.scheda ?? null, dispositivo: ev.dispositivo,
        });
        break;
      case TIPI.CANCELLAZIONE: {
        let tolti = 0;
        if (ev.chat != null) {
          if (stato.chat.delete(ev.chat)) tolti = 1;
        } else {
          for (const [id, p] of stato.pagine) {
            if (nelPeriodo(p.ts, ev.pagine)) { stato.pagine.delete(id); tolti++; }
          }
        }
        return { nuovo: true, tolti };
      }
      default:
        break;
    }
    return { nuovo: true, tolti: 0 };
  }

  // Cosa resta su disco dopo le cancellazioni: ogni evento che una cancellazione SUCCESSIVA copre se ne va, tutto il
  // resto resta identico e nello stesso ordine. Le cancellazioni restano: un altro dispositivo dovrà saperle.
  function compatta(eventi) {
    const chatCancellate = new Set();
    const periodi = [];
    const tenuti = [];
    for (let i = eventi.length - 1; i >= 0; i--) {
      const ev = eventi[i];
      if (ev.tipo === TIPI.CANCELLAZIONE) {
        if (ev.chat != null) chatCancellate.add(ev.chat); else periodi.push(ev.pagine);
        tenuti.push(ev);
        continue;
      }
      if (ev.chat != null && chatCancellate.has(ev.chat)) continue;
      if (ev.tipo === TIPI.NAVIGAZIONE && periodi.some((p) => nelPeriodo(ev.ts, p))) continue;
      tenuti.push(ev);
    }
    return tenuti.reverse();
  }

  // Le chat sono dal più recente: per ora dell'ultimo messaggio, poi per posizione nel filo.
  function elencoChat(stato) {
    return [...stato.chat.values()].sort((a, b) => {
      const d = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return d || (b._pos - a._pos);
    });
  }

  function copiaChat(c) {
    if (!c) return null;
    const out = { ...c, messages: c.messages.map((m) => ({ ...m })) };
    delete out._pos;
    return out;
  }

  // Le chat salvate prima del filo diventano segmenti: per ogni chat i suoi eventi uno dopo l'altro, la meno
  // recente per prima, così l'ordine dell'elenco resta quello di prima. Ogni campo si conserva com'era.
  function daChatSalvate(chats, { dispositivo } = {}) {
    const eventi = [];
    const lista = (Array.isArray(chats) ? chats : []).filter((c) => c && stringa(c.id));
    const ora = new Date().toISOString();
    for (const c of lista.slice().reverse()) {
      const messaggi = Array.isArray(c.messages) ? c.messages.filter((m) => m && typeof m === 'object') : [];
      const inizio = isoValida(c.startedAt) ? c.startedAt
        : (messaggi[0] && isoValida(messaggi[0].ts) ? messaggi[0].ts : (isoValida(c.updatedAt) ? c.updatedAt : ora));
      eventi.push(crea(TIPI.CHAT_APERTA, { chat: c.id, onboarding: c.onboarding ? true : undefined },
        { ts: inizio, dispositivo, autore: 'utente' }));
      let ultimo = inizio;
      for (const m of messaggi) {
        const role = m.role === 'user' ? 'user' : 'filo';
        const msg = { ...m, role, text: String(m.text == null ? '' : m.text) };
        delete msg.ts;
        const ts = isoValida(m.ts) ? m.ts : ultimo;
        ultimo = ts;
        eventi.push(crea(TIPI.MESSAGGIO, { chat: c.id, msg }, { ts, dispositivo, autore: role === 'user' ? 'utente' : 'filo' }));
      }
      if (c.closedAt) {
        eventi.push(crea(TIPI.CHAT_CHIUSA, { chat: c.id }, {
          ts: isoValida(c.closedAt) ? c.closedAt : ultimo, dispositivo, autore: 'utente',
        }));
      }
      if (c.title || c.kind != null || c.titleByUser || c.kindByUser || c.triagedCount != null) {
        eventi.push(crea(TIPI.CHAT_TITOLO, {
          chat: c.id,
          title: typeof c.title === 'string' ? c.title : '',
          kind: c.kind ?? null,
          titleByUser: c.titleByUser ? true : undefined,
          kindByUser: c.kindByUser ? true : undefined,
          triagedCount: Number.isFinite(c.triagedCount) ? c.triagedCount : undefined,
        }, { ts: isoValida(c.closedAt) ? c.closedAt : ultimo, dispositivo, autore: c.titleByUser || c.kindByUser ? 'utente' : 'filo' }));
      }
    }
    return eventi;
  }

  // «Ultima ora», «oggi», «tutto», o le ultime N ore: il periodo che una cancellazione di pagine copre.
  function periodo(nome, { ore, ora } = {}) {
    const adesso = ora instanceof Date ? ora : new Date();
    const n = Number(ore);
    if (Number.isFinite(n) && n > 0) return { da: new Date(adesso.getTime() - n * ORA_MS).toISOString(), a: adesso.toISOString() };
    const p = String(nome || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (p === 'tutto' || p === 'tutte' || p === 'sempre') return { da: null, a: null };
    if (p === 'oggi') {
      const mezzanotte = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate());
      return { da: mezzanotte.toISOString(), a: adesso.toISOString() };
    }
    if (p === 'ultima_ora' || p === 'ora') return { da: new Date(adesso.getTime() - ORA_MS).toISOString(), a: adesso.toISOString() };
    return null;
  }

  function pagineNelPeriodo(stato, pagine) {
    if (!pagine) return [];
    return [...stato.pagine.values()].filter((p) => nelPeriodo(p.ts, pagine));
  }

  global.SN_FILO_EVENTI = {
    VERSIONE, TIPI, AUTORI, PERIODI,
    uuid, valido, crea, riga, analizza, nuovoStato, applica, compatta, elencoChat, copiaChat,
    daChatSalvate, periodo, pagineNelPeriodo, nelPeriodo,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
