// Persistenza della memoria di Filo: raw_log, buffer delle lezioni, moduli persistenti.
// Qui stanno anche i timer e le notifiche della colonna destra; gli appunti no: sono file
// dell'editor.

(function (global) {
  'use strict';

  const KEYS = global.SN_CONST.STORAGE_KEYS;

  // Cap difensivo sul raw log per non saturare chrome.storage (~10MB totali).
  const RAW_LOG_CAP = 5000;
  // Sopra questa soglia in caratteri il Compattatore va eseguito (spec §4.2).
  const LESSONS_BUFFER_TRIGGER_CHARS = 3000;
  // Cap difensivo per le notifiche.
  const NOTIFICATIONS_CAP = 100;

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Tronca senza spezzare un carattere: `slice` conta unità UTF-16 e taglierebbe un'emoji
  // a metà, cioè un glifo rotto nell'etichetta di un timer. Ripiego a code point.
  function truncateSafe(str, max) {
    const s = String(str == null ? '' : str);
    let units;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        units = Array.from(seg.segment(s), (g) => g.segment);
      } else {
        units = Array.from(s);
      }
    } catch {
      units = Array.from(s);
    }
    if (units.length <= max) return s;
    return units.slice(0, max).join('');
  }

  async function getRaw(key, fallback) {
    const res = await chrome.storage.local.get(key);
    return res[key] === undefined ? fallback : res[key];
  }
  async function setRaw(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

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

  // Forma in storage: { PROFILO: "...", PREFERENZE: "...", <ESPANSIONE>: "..." }
  async function getMemory() {
    const mem = await getRaw(KEYS.FILO_MEMORY, null);
    if (mem && typeof mem === 'object') return mem;
    return { PROFILO: '', PREFERENZE: '' };
  }

  async function setMemory(memory) {
    await setRaw(KEYS.FILO_MEMORY, memory);
  }

  // Semantica patch: aggiorna alcuni moduli senza toccare gli altri.
  async function patchMemory(patch) {
    const cur = await getMemory();
    const next = { ...cur, ...patch };
    await setMemory(next);
    return next;
  }

  // Output del Compattatore: blocchi «NOME:\ncontenuto» separati da una riga vuota.
  // Tollerante: quello che precede il primo header si scarta.
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

  // Onboarding (#524): lo stato sta in UNA chiave e passa sempre da `SN_ONBOARDING.normalize`,
  // perché queste letture stanno sul cammino di apertura della home.

  function Onb() {
    return global.SN_ONBOARDING;
  }

  // Il segno «già accolto» è UNO: `done`, scritto quando l'intervista FINISCE.
  // FILO_WELCOMED resta solo come segnale di migrazione: chi era accolto non la rivede.
  async function getOnboarding() {
    const raw = await getRaw(KEYS.FILO_ONBOARDING, null);
    const O = Onb();
    if (raw == null) {
      const legacy = await getRaw(KEYS.FILO_WELCOMED, false);
      if (legacy) return O ? O.normalize({ done: true }) : { done: true, ticked: [], thread: [] };
    }
    return O ? O.normalize(raw) : (raw || { done: false, ticked: [], thread: [] });
  }

  async function setOnboarding(state) {
    const O = Onb();
    const next = O ? O.normalize(state) : state;
    await setRaw(KEYS.FILO_ONBOARDING, next);
    return next;
  }

  async function listTimers() {
    return getRaw(KEYS.FILO_TIMERS, []);
  }

  async function addTimer({ label, seconds }) {
    // Una durata non interpretabile o non positiva NON crea un timer: si torna null, mai un
    // minimo di un secondo che suona subito.
    const sec = Math.round(Number(seconds) || 0);
    if (sec <= 0) return null;
    const list = await listTimers();
    const entry = {
      id: uuid(),
      label: truncateSafe(String(label || 'Timer').trim(), 60),
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

  // In pausa il tempo si congela in `remainingMs` e `endsAt` non è più affidabile:
  // chi mostra un timer in pausa DEVE usare `remainingMs`. Le sveglie non si mettono in pausa.
  async function pauseTimer(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return list;
    const t = list[idx];
    if (t.paused || t.ringing || t.kind === 'alarm') return list;
    const remainingMs = Math.max(0, new Date(t.endsAt).getTime() - Date.now());
    list[idx] = { ...t, paused: true, remainingMs };
    await setRaw(KEYS.FILO_TIMERS, list);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return list;
  }

  // Riprende da `adesso + remainingMs`: il conto riparte da dov'era. No-op se non in pausa.
  async function resumeTimer(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return list;
    const t = list[idx];
    if (!t.paused) return list;
    const remainingMs = Number.isFinite(t.remainingMs)
      ? t.remainingMs
      : Math.max(0, new Date(t.endsAt).getTime() - Date.now());
    const next = { ...t, paused: false, endsAt: new Date(Date.now() + remainingMs).toISOString() };
    delete next.remainingMs;
    list[idx] = next;
    await setRaw(KEYS.FILO_TIMERS, list);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return list;
  }

  // Una sveglia (#322) è un timer con scadenza ASSOLUTA e vive nella STESSA lista,
  // così eredita gratis il flusso già rodato: gcTimers → ringing → suoneria.

  // «HH:MM» o «H»: la PROSSIMA occorrenza, oggi se futura, altrimenti domani.
  // Null se non interpretabile: meglio «non ho capito» che fingere di aver programmato.
  function resolveAlarmTime(raw, nowMs = Date.now()) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2] || 0);
      if (h > 23 || min > 59) return null;
      const d = new Date(nowMs);
      d.setHours(h, min, 0, 0);
      let t = d.getTime();
      if (t <= nowMs) t += 24 * 60 * 60 * 1000;
      return t;
    }
    const t = Date.parse(s);
    if (Number.isFinite(t) && t > nowMs) return t;
    return null;
  }

  // Il dato canonico è `repeat` più `atTime`; `endsAt` resta la PROSSIMA occorrenza,
  // così il flusso esistente funziona senza saperne nulla. Al suono non si consuma.

  const DOW_TOKENS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']; // indice = Date#getDay()
  const DOW_ORDER = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];  // ordine di lettura
  const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven'];
  const WEEKEND = ['sab', 'dom'];

  // Chiave di confronto: minuscolo, senza accenti, spazi e punteggiatura.
  function normKey(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  const DOW_ALIASES = {
    lun: 'lun', lu: 'lun', lunedi: 'lun', mon: 'lun', monday: 'lun',
    mar: 'mar', ma: 'mar', martedi: 'mar', tue: 'mar', tuesday: 'mar',
    mer: 'mer', me: 'mer', mercoledi: 'mer', wed: 'mer', wednesday: 'mer',
    gio: 'gio', gi: 'gio', giovedi: 'gio', thu: 'gio', thursday: 'gio',
    ven: 'ven', ve: 'ven', venerdi: 'ven', fri: 'ven', friday: 'ven',
    sab: 'sab', sa: 'sab', sabato: 'sab', sat: 'sab', saturday: 'sab',
    dom: 'dom', do: 'dom', domenica: 'dom', sun: 'dom', sunday: 'dom',
  };

  const DOW_GROUPS = {
    feriali: WEEKDAYS, giorniferiali: WEEKDAYS, lavorativi: WEEKDAYS,
    giornilavorativi: WEEKDAYS, infrasettimanale: WEEKDAYS, weekdays: WEEKDAYS,
    weekend: WEEKEND, finesettimana: WEEKEND, ilweekend: WEEKEND, festivi: WEEKEND,
    ognigiorno: DOW_ORDER, tuttiigiorni: DOW_ORDER, tuttiigiorno: DOW_ORDER,
    quotidiano: DOW_ORDER, quotidiana: DOW_ORDER, giornaliero: DOW_ORDER,
    giornaliera: DOW_ORDER, sempre: DOW_ORDER, daily: DOW_ORDER, everyday: DOW_ORDER,
    tuttiigg: DOW_ORDER,
  };

  // Accetta array, stringa con separatori o scorciatoie («feriali», «weekend»).
  // Quello che non si riconosce si ignora: [] = occorrenza singola, come sempre.
  function normalizeRepeat(raw) {
    const found = new Set();
    const eat = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) { value.forEach(eat); return; }
      const whole = normKey(value);
      if (!whole) return;
      if (DOW_GROUPS[whole]) { DOW_GROUPS[whole].forEach((d) => found.add(d)); return; }
      if (DOW_ALIASES[whole]) { found.add(DOW_ALIASES[whole]); return; }
      const pieces = String(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (pieces.length > 1) {
        for (const p of pieces) {
          const k = normKey(p);
          if (DOW_GROUPS[k]) DOW_GROUPS[k].forEach((d) => found.add(d));
          else if (DOW_ALIASES[k]) found.add(DOW_ALIASES[k]);
        }
      }
    };
    eat(raw);
    return DOW_ORDER.filter((d) => found.has(d));
  }

  // Per una sveglia ricorrente il giorno lo decide la ricorrenza: dell'input serve solo l'ora.
  function parseClock(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2] || 0);
      if (h > 23 || min > 59) return null;
      return { h, m: min };
    }
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    return { h: d.getHours(), m: d.getMinutes() };
  }

  function fmtClock(clock) {
    if (!clock) return '';
    return `${String(clock.h).padStart(2, '0')}:${String(clock.m).padStart(2, '0')}`;
  }

  // Occorrenza STRETTAMENTE futura, da oggi a fra sette giorni compresi:
  // la sveglia del solo lunedì, chiesta lunedì dopo l'orario, va al lunedì dopo.
  function nextRecurrence(clock, days, nowMs = Date.now()) {
    const wanted = normalizeRepeat(days);
    if (!clock || !wanted.length) return null;
    const set = new Set(wanted);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + i);
      d.setHours(clock.h, clock.m, 0, 0);
      const t = d.getTime();
      if (t <= nowMs) continue;
      if (set.has(DOW_TOKENS[d.getDay()])) return t;
    }
    return null;
  }

  function isRecurring(t) {
    return !!(t && t.kind === 'alarm' && Array.isArray(t.repeat) && t.repeat.length);
  }

  // Prossima occorrenza di una sveglia ricorrente già salvata.
  function nextAlarmOccurrence(t, nowMs = Date.now()) {
    if (!isRecurring(t)) return null;
    const clock = parseClock(t.atTime) || parseClock(t.endsAt);
    return nextRecurrence(clock, t.repeat, nowMs);
  }

  // Dicitura unica per lo stato dell'agente e la colonna destra: un posto solo.
  function formatRepeat(days) {
    const d = normalizeRepeat(days);
    if (!d.length) return '';
    if (d.length === 7) return 'ogni giorno';
    if (d.length === 5 && WEEKDAYS.every((x) => d.includes(x))) return 'feriali';
    if (d.length === 2 && WEEKEND.every((x) => d.includes(x))) return 'weekend';
    return d.join('+');
  }

  async function addAlarm({ label, time, repeat, nowMs }) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const days = normalizeRepeat(repeat);
    const clock = days.length ? parseClock(time) : null;
    const at = days.length ? nextRecurrence(clock, days, now) : resolveAlarmTime(time, now);
    if (!at) return null;
    const list = await listTimers();
    const entry = {
      id: uuid(),
      kind: 'alarm',
      label: truncateSafe(String(label || '').trim(), 60),
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(at).toISOString(),
      paused: false,
    };
    if (days.length) {
      entry.repeat = days;
      entry.atTime = fmtClock(clock);
    }
    list.unshift(entry);
    await setRaw(KEYS.FILO_TIMERS, list);
    return entry;
  }

  // L'utente non dice mai un id: dice «la sveglia della palestra», «quella delle 7», «tutte».
  // Array vuoto = «non ho capito»: chi chiama non cancella niente invece di indovinare.

  function normText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function alarmClockText(t) {
    const clock = parseClock(t.atTime) || parseClock(t.endsAt);
    return clock ? fmtClock(clock) : '';
  }

  // `kind` filtra 'alarm' o 'timer'; assente = entrambi.
  function resolveTimerRefs(list, ref = {}) {
    const all = Array.isArray(list) ? list : [];
    // Riferimento già risolto altrove: il main lo risolve prima del popup di conferma.
    if (Array.isArray(ref.ids)) {
      const set = new Set(ref.ids);
      return all.filter((t) => set.has(t.id));
    }
    if (ref.id) return all.filter((t) => t.id === ref.id);
    const kind = ref.kind === 'alarm' || ref.kind === 'timer' ? ref.kind : null;
    const pool = kind
      ? all.filter((t) => (t.kind === 'alarm' ? 'alarm' : 'timer') === kind)
      : all.slice();
    const q = normText(ref.label);
    if (ref.all && !q) return pool;
    if (!q) return [];

    // 1) etichetta identica.
    const exact = pool.filter((t) => normText(t.label) === q);
    if (exact.length) return exact;
    // 2) una contiene l'altra ("sveglia palestra" ↔ "palestra").
    const partial = pool.filter((t) => {
      const l = normText(t.label);
      return !!l && (l.includes(q) || q.includes(l));
    });
    if (partial.length) return partial;
    // 3) parole in comune (da 3 lettere in su: "le" e "la" non sono indizi).
    const words = q.split(' ').filter((w) => w.length >= 3);
    if (words.length) {
      const byWord = pool.filter((t) => {
        const l = normText(t.label);
        return !!l && words.some((w) => l.split(' ').includes(w));
      });
      if (byWord.length) return byWord;
    }
    // Sul testo GREZZO: normalizzando, «06:30» diventerebbe «06 30», cioè le 6 in punto.
    const hm = /(\d{1,2})(?:[:.](\d{2}))?/.exec(String(ref.label || ''));
    if (hm) {
      const want = fmtClock({ h: Number(hm[1]), m: Number(hm[2] || 0) });
      const byTime = pool.filter((t) => t.kind === 'alarm' && alarmClockText(t) === want);
      if (byTime.length) return byTime;
    }
    // 5) "tutte le sveglie di X" con X che non combacia: meglio niente che a caso.
    return ref.all ? pool : [];
  }

  // Cancella le entry indicate dal riferimento. Ritorna { removed, list }.
  async function removeTimersByRef(ref = {}) {
    const list = await listTimers();
    const targets = resolveTimerRefs(list, ref);
    if (!targets.length) return { removed: [], list };
    const ids = new Set(targets.map((t) => t.id));
    const kept = list.filter((t) => !ids.has(t.id));
    await setRaw(KEYS.FILO_TIMERS, kept);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return { removed: targets, list: kept };
  }

  // `updated` vuoto = non ho capito quale, o l'orario non è interpretabile:
  // in quel caso non si tocca niente.
  async function updateTimersByRef(ref = {}, { time, repeat, seconds, nowMs } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const list = await listTimers();
    const targets = resolveTimerRefs(list, ref);
    if (!targets.length) return { updated: [], list };
    const ids = new Set(targets.map((t) => t.id));
    const updated = [];
    const next = list.map((t) => {
      if (!ids.has(t.id)) return t;
      if (t.kind === 'alarm') {
        // Spostare l'orario non deve far perdere «il lunedì e il mercoledì».
        const asked = normalizeRepeat(repeat);
        const days = asked.length ? asked : normalizeRepeat(t.repeat);
        const clock = parseClock(time) || parseClock(t.atTime) || parseClock(t.endsAt);
        const at = days.length ? nextRecurrence(clock, days, now) : resolveAlarmTime(time, now);
        if (!at) return t;
        const e = { ...t, endsAt: new Date(at).toISOString(), paused: false };
        delete e.ringing;
        delete e.remainingMs;
        if (days.length) { e.repeat = days; e.atTime = fmtClock(clock); }
        else { delete e.repeat; delete e.atTime; }
        updated.push(e);
        return e;
      }
      const sec = Math.round(Number(seconds ?? time) || 0);
      if (sec <= 0) return t;
      const e = { ...t, endsAt: new Date(now + sec * 1000).toISOString(), paused: false };
      delete e.ringing;
      delete e.remainingMs;
      updated.push(e);
      return e;
    });
    if (!updated.length) return { updated: [], list };
    await setRaw(KEYS.FILO_TIMERS, next);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return { updated, list: next };
  }

  // I timer scaduti si marcano `ringing` invece di sparire, così la UI suona e mostra «Ferma».
  // Alla prossima apertura si tolgono in silenzio: senza UI la suoneria non avrebbe senso.
  async function gcTimers() {
    const list = await listTimers();
    const now = Date.now();
    let changed = false;
    const result = [];
    for (const t of list) {
      if (t.paused) { result.push(t); continue; }
      const expired = new Date(t.endsAt).getTime() <= now;
      if (!expired) { result.push(t); continue; }
      if (t.ringing) {
        // Già ringing: resta in lista, e la cache non si invalida ogni secondo.
        result.push(t);
      } else if (isRecurring(t)) {
        // Sveglia RICORRENTE: suona e non si consuma, `endsAt` va già all'occorrenza dopo.
        // Se non è calcolabile si comporta come una sveglia normale.
        const next = nextAlarmOccurrence(t, now);
        result.push(next ? { ...t, ringing: true, endsAt: new Date(next).toISOString() } : { ...t, ringing: true });
        changed = true;
      } else {
        // Prima volta che scade: passa a ringing e invalida la cache.
        result.push({ ...t, ringing: true });
        changed = true;
      }
    }
    if (changed) {
      await setRaw(KEYS.FILO_TIMERS, result);
      // I suggerimenti «il timer sta per suonare» vanno rigenerati.
      await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    }
    return result;
  }

  // ECCEZIONE: una sveglia RICORRENTE non si cancella con «Ferma» — fermare quella di
  // stamattina non disdice quella di mercoledì. Per toglierla davvero c'è la ×.
  async function stopTimerAlarm(id) {
    const list = await listTimers();
    const idx = list.findIndex((t) => t.id === id);
    if (idx >= 0 && isRecurring(list[idx])) {
      const t = list[idx];
      const now = Date.now();
      const next = new Date(t.endsAt).getTime() > now ? new Date(t.endsAt).getTime() : nextAlarmOccurrence(t, now);
      if (next) {
        const kept = list.slice();
        kept[idx] = { ...t, ringing: false, endsAt: new Date(next).toISOString() };
        await setRaw(KEYS.FILO_TIMERS, kept);
        await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
        return kept;
      }
    }
    const filtered = list.filter((t) => t.id !== id);
    await setRaw(KEYS.FILO_TIMERS, filtered);
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    return filtered;
  }

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

  async function getDashboardCache() {
    return getRaw(KEYS.FILO_DASHBOARD_CACHE, null);
  }

  async function setDashboardCache(payload) {
    await setRaw(KEYS.FILO_DASHBOARD_CACHE, {
      ts: new Date().toISOString(),
      message: payload?.message || '',
      suggestions: Array.isArray(payload?.suggestions) ? payload.suggestions : [],
      // Firma degli input del messaggio: dice se la home va ricalcolata (#155).
      signature: payload?.signature || '',
    });
  }

  // Le regole proxy per dominio (#152) vivono nella memoria a lungo termine, così la tab
  // nasce già instradata. La chiave è l'eTLD+1 calcolato dal chiamante, che ha la PSL.
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

  async function getSession() {
    const s = await getRaw(KEYS.FILO_SESSION, null);
    if (s && typeof s === 'object') return s;
    return { lastInteractionAt: null, sessionStartedAt: null, sessionCount: 0 };
  }

  async function setSession(session) {
    await setRaw(KEYS.FILO_SESSION, session);
  }

  // Reset dopo 30 minuti di inattività (spec §5.1).
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
    appendRaw, listRaw,
    getLessonsBuffer, appendLesson, lessonsBufferShouldCompact, clearLessonsBuffer,
    LESSONS_BUFFER_TRIGGER_CHARS,
    getMemory, setMemory, patchMemory, parseCompactorOutput, renderMemoryForPrompt,
    getOnboarding, setOnboarding,
    listTimers, addTimer, addAlarm, resolveAlarmTime, deleteTimer, pauseTimer, resumeTimer, gcTimers, stopTimerAlarm,
    normalizeRepeat, parseClock, nextRecurrence, nextAlarmOccurrence, formatRepeat, isRecurring,
    resolveTimerRefs, removeTimersByRef, updateTimersByRef,
    listNotifications, addNotification, dismissNotification,
    getDashboardCache, setDashboardCache,
    listProxyRules, setProxyRule, removeProxyRule, getProxyRule,
    getSession, setSession, touchSession,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
