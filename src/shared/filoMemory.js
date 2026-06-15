// Persistenza del sistema di memoria di Filo.
//
// Tre livelli (vedi filo-architettura.md sezione 4):
//   - raw_log: storico completo di interazioni utente/Filo. Volume previsto
//     ~1MB/anno → niente retention policy stringente, basta un cap difensivo.
//   - lessons buffer: lezioni estratte dall'agente Creatore Lezioni, in attesa
//     di compattazione (svuotato dal Compattatore quando supera 3000 char).
//   - moduli: PROFILO, PREFERENZE, e N espansioni dinamiche. Sempre persistenti.
//
// In aggiunta gestiamo qui anche tre store legati alla dashboard:
//   - notes: appunti salvati dall'agente (azione SALVA_APPUNTO).
//   - timers: countdown attivi (azione TIMER).
//   - notifications: voci della colonna destra.
//
// Caricato nel service worker via importScripts e nelle pagine via <script>.

(function (global) {
  'use strict';

  const KEYS = global.SN_CONST.STORAGE_KEYS;

  // Limite difensivo sul raw log per non saturare chrome.storage (~10MB totali).
  // 5000 entry ≈ pochi MB con messaggi corti.
  const RAW_LOG_CAP = 5000;
  // Quando il buffer di lezioni supera questa soglia in caratteri, il
  // Compattatore va eseguito (vedi spec sezione 4.2).
  const LESSONS_BUFFER_TRIGGER_CHARS = 3000;
  // Cap difensivo per notifiche/note/timer.
  const NOTES_CAP = 500;
  const NOTIFICATIONS_CAP = 100;

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function getRaw(key, fallback) {
    const res = await chrome.storage.local.get(key);
    return res[key] === undefined ? fallback : res[key];
  }
  async function setRaw(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  // ===== Raw log =====

  async function appendRaw(entry) {
    const list = await getRaw(KEYS.FILO_RAW_LOG, []);
    list.unshift({
      ts: entry.ts || new Date().toISOString(),
      type: entry.type || 'unknown', // 'chat_user', 'chat_filo', 'dismiss', 'click', ...
      summary: entry.summary || '',
      extra: entry.extra || null,
    });
    if (list.length > RAW_LOG_CAP) list.length = RAW_LOG_CAP;
    await setRaw(KEYS.FILO_RAW_LOG, list);
    return list[0];
  }

  async function listRaw({ since, limit = 100 } = {}) {
    const list = await getRaw(KEYS.FILO_RAW_LOG, []);
    let out = list;
    if (since) {
      const cutoff = new Date(since).getTime();
      out = out.filter((e) => new Date(e.ts).getTime() >= cutoff);
    }
    return out.slice(0, limit);
  }

  // ===== Lessons buffer =====

  async function getLessonsBuffer() {
    return getRaw(KEYS.FILO_LESSONS_BUFFER, []);
  }

  async function appendLesson(lesson) {
    const buf = await getLessonsBuffer();
    buf.push({ ts: new Date().toISOString(), text: String(lesson || '').trim() });
    await setRaw(KEYS.FILO_LESSONS_BUFFER, buf);
    return buf;
  }

  async function lessonsBufferShouldCompact() {
    const buf = await getLessonsBuffer();
    const totalChars = buf.reduce((acc, l) => acc + (l.text?.length || 0), 0);
    return totalChars >= LESSONS_BUFFER_TRIGGER_CHARS;
  }

  async function clearLessonsBuffer() {
    await setRaw(KEYS.FILO_LESSONS_BUFFER, []);
  }

  // ===== Moduli =====

  // Forma in storage: { PROFILO: "...", PREFERENZE: "...", <ESPANSIONE>: "..." }
  async function getMemory() {
    const mem = await getRaw(KEYS.FILO_MEMORY, null);
    if (mem && typeof mem === 'object') return mem;
    return { PROFILO: '', PREFERENZE: '' };
  }

  async function setMemory(memory) {
    await setRaw(KEYS.FILO_MEMORY, memory);
  }

  // Aggiorna alcuni moduli senza toccare gli altri (semantica patch).
  async function patchMemory(patch) {
    const cur = await getMemory();
    const next = { ...cur, ...patch };
    await setMemory(next);
    return next;
  }

  // Parsing dell'output del Compattatore: blocchi "NOME:\ncontenuto multilinea"
  // separati da una riga vuota. Tollerante: il primo elemento prima del primo
  // header viene scartato.
  function parseCompactorOutput(text) {
    if (!text) return {};
    const trimmed = String(text).trim();
    if (trimmed === 'NESSUNA MODIFICA') return {};
    const lines = trimmed.split(/\r?\n/);
    const out = {};
    let currentName = null;
    let buffer = [];
    const flush = () => {
      if (currentName) {
        out[currentName] = buffer.join('\n').trim();
      }
      buffer = [];
    };
    const headerRe = /^([A-Z][A-Z0-9_]{1,40}):\s*$/;
    for (const line of lines) {
      const m = line.match(headerRe);
      if (m) {
        flush();
        currentName = m[1];
        continue;
      }
      if (currentName) buffer.push(line);
    }
    flush();
    return out;
  }

  // Rendering dei moduli memoria per inserirli nei prompt.
  function renderMemoryForPrompt(memory) {
    if (!memory || typeof memory !== 'object') return { profilo: '', preferenze: '', espansioni: '' };
    const profilo = memory.PROFILO || '';
    const preferenze = memory.PREFERENZE || '';
    const others = Object.entries(memory)
      .filter(([k]) => k !== 'PROFILO' && k !== 'PREFERENZE')
      .filter(([_, v]) => v && String(v).trim().length);
    let espansioni = '';
    if (others.length) {
      espansioni = 'ESPANSIONI:\n' + others.map(([k, v]) => `${k}:\n${v}`).join('\n\n');
    }
    return { profilo, preferenze, espansioni };
  }

  // ===== Notes / appunti =====

  async function listNotes() {
    return getRaw(KEYS.FILO_NOTES, []);
  }

  async function addNote({ text, context }) {
    if (!text || !String(text).trim()) return null;
    const list = await listNotes();
    const entry = {
      id: uuid(),
      ts: new Date().toISOString(),
      text: String(text).trim(),
      context: String(context || '').trim(),
    };
    list.unshift(entry);
    if (list.length > NOTES_CAP) list.length = NOTES_CAP;
    await setRaw(KEYS.FILO_NOTES, list);
    return entry;
  }

  async function deleteNote(id) {
    const list = await listNotes();
    const filtered = list.filter((n) => n.id !== id);
    await setRaw(KEYS.FILO_NOTES, filtered);
    return filtered;
  }

  // ===== Timer =====

  async function listTimers() {
    return getRaw(KEYS.FILO_TIMERS, []);
  }

  async function addTimer({ label, seconds }) {
    const sec = Math.max(1, Math.round(Number(seconds) || 0));
    if (sec <= 0) return null;
    const list = await listTimers();
    const entry = {
      id: uuid(),
      label: String(label || 'Timer').trim().slice(0, 60),
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + sec * 1000).toISOString(),
      paused: false,
    };
    list.unshift(entry);
    await setRaw(KEYS.FILO_TIMERS, list);
    return entry;
  }

  async function deleteTimer(id) {
    const list = await listTimers();
    const filtered = list.filter((t) => t.id !== id);
    await setRaw(KEYS.FILO_TIMERS, filtered);
    return filtered;
  }

  // Pulizia: rimuove tutti i timer scaduti (endsAt <= now) e non in pausa.
  //
  // Storia: in passato lasciavamo un margine di 5 minuti per far "lampeggiare"
  // i timer a 0:00 nella UI prima di sparire. Ma quando Filo viene chiuso
  // mentre un timer è in corso e riaperto dopo la scadenza, non c'è stato
  // nessun rendering né notifica: lasciare quel timer in lista significa
  // farlo comparire come "processo attivo" / suggerimento ("Il timer sta per
  // suonare") in modo permanente (bug riportato da alpha tester 2026-05).
  // Meglio cancellarli silenziosamente: se il timer è scaduto in background
  // l'utente lo scopre comunque dal raw_log o dalle notifiche, non da una
  // card stantia.
  async function gcTimers() {
    const list = await listTimers();
    const now = Date.now();
    const filtered = list.filter((t) => {
      if (t.paused) return true;
      return new Date(t.endsAt).getTime() > now;
    });
    if (filtered.length !== list.length) {
      await setRaw(KEYS.FILO_TIMERS, filtered);
      // Invalida la cache della dashboard: se il messaggio centro o un
      // suggerimento parlava del timer ora scaduto, ri-generiamo per non
      // continuare a mostrare "Il timer sta per suonare" stantio.
      await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    }
    return filtered;
  }

  // ===== Notifications =====

  async function listNotifications({ includeDismissed = false } = {}) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    return includeDismissed ? list : list.filter((n) => !n.dismissed);
  }

  async function addNotification({ kind, text, action, color }) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    const entry = {
      id: uuid(),
      ts: new Date().toISOString(),
      kind: kind || 'info', // 'alert' | 'process' | 'background' | 'info'
      text: String(text || ''),
      action: action || null,
      color: color || null, // override del colore della barra laterale
      dismissed: false,
    };
    list.unshift(entry);
    if (list.length > NOTIFICATIONS_CAP) list.length = NOTIFICATIONS_CAP;
    await setRaw(KEYS.FILO_NOTIFICATIONS, list);
    return entry;
  }

  async function dismissNotification(id, { acted = false } = {}) {
    const list = await getRaw(KEYS.FILO_NOTIFICATIONS, []);
    const idx = list.findIndex((n) => n.id === id);
    if (idx >= 0) {
      list[idx].dismissed = true;
      list[idx].dismissedAt = new Date().toISOString();
      list[idx].acted = !!acted;
      await setRaw(KEYS.FILO_NOTIFICATIONS, list);
    }
    return list;
  }

  // ===== Dashboard cache =====

  async function getDashboardCache() {
    return getRaw(KEYS.FILO_DASHBOARD_CACHE, null);
  }

  async function setDashboardCache(payload) {
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, {
      ts: new Date().toISOString(),
      message: payload?.message || '',
      suggestions: Array.isArray(payload?.suggestions) ? payload.suggestions : [],
    });
  }

  // ===== Proxy: regole persistenti per dominio (#152) =====
  //
  // "questo sito sempre dagli USA" → la regola vive qui (memoria a lungo
  // termine di Filo, stessa persistenza di profilo/preferenze: storage.local
  // → storage.json), quindi SOPRAVVIVE al riavvio. Alla navigazione verso il
  // dominio la tab nasce già instradata (TabManager._maybeApplyDomainRule).
  // La chiave è il dominio registrabile (eTLD+1) calcolato dal chiamante (che
  // ha l'estrazione PSL); qui solo una normalizzazione difensiva.
  function normProxyDomain(domain) {
    return String(domain || '').trim().toLowerCase().replace(/^www\./, '');
  }

  async function listProxyRules() {
    const r = await getRaw(KEYS.FILO_PROXY_RULES, {});
    return r && typeof r === 'object' ? r : {};
  }

  async function setProxyRule(domain, { country, tier } = {}) {
    const dom = normProxyDomain(domain);
    const code = String(country || '').trim().toLowerCase();
    if (!dom || !/^[a-z]{2}$/.test(code)) return null;
    const rules = await listProxyRules();
    rules[dom] = { country: code, tier: tier || null, ts: new Date().toISOString() };
    await setRaw(KEYS.FILO_PROXY_RULES, rules);
    return rules[dom];
  }

  async function removeProxyRule(domain) {
    const dom = normProxyDomain(domain);
    const rules = await listProxyRules();
    if (dom in rules) {
      delete rules[dom];
      await setRaw(KEYS.FILO_PROXY_RULES, rules);
    }
    return rules;
  }

  async function getProxyRule(domain) {
    const rules = await listProxyRules();
    return rules[normProxyDomain(domain)] || null;
  }

  // ===== Session =====

  async function getSession() {
    const s = await getRaw(KEYS.FILO_SESSION, null);
    if (s && typeof s === 'object') return s;
    return { lastInteractionAt: null, sessionStartedAt: null, sessionCount: 0 };
  }

  async function setSession(session) {
    await setRaw(KEYS.FILO_SESSION, session);
  }

  // Aggiorna la sessione registrando una nuova interazione. Reset dopo 30 min
  // di inattività (vedi spec sezione 5.1).
  async function touchSession() {
    const s = await getSession();
    const now = new Date();
    const last = s.lastInteractionAt ? new Date(s.lastInteractionAt).getTime() : 0;
    const idleMin = (now.getTime() - last) / 60000;
    if (!s.sessionStartedAt || idleMin > 30) {
      s.sessionStartedAt = now.toISOString();
      s.sessionCount = 0;
    }
    s.lastInteractionAt = now.toISOString();
    s.sessionCount = (s.sessionCount || 0) + 1;
    await setSession(s);
    return s;
  }

  global.SN_FILO_MEMORY = {
    // raw log
    appendRaw, listRaw,
    // lessons
    getLessonsBuffer, appendLesson, lessonsBufferShouldCompact, clearLessonsBuffer,
    LESSONS_BUFFER_TRIGGER_CHARS,
    // moduli
    getMemory, setMemory, patchMemory, parseCompactorOutput, renderMemoryForPrompt,
    // notes
    listNotes, addNote, deleteNote,
    // timer
    listTimers, addTimer, deleteTimer, gcTimers,
    // notifications
    listNotifications, addNotification, dismissNotification,
    // dashboard cache
    getDashboardCache, setDashboardCache,
    // proxy: regole persistenti per dominio (#152)
    listProxyRules, setProxyRule, removeProxyRule, getProxyRule,
    // session
    getSession, setSession, touchSession,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
