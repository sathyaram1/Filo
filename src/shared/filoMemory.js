// Persistenza del sistema di memoria di Filo.
//
// Tre livelli (vedi filo-architettura.md sezione 4):
//   - raw_log: storico completo di interazioni utente/Filo. Volume previsto
//     ~1MB/anno → niente retention policy stringente, basta un cap difensivo.
//   - lessons buffer: lezioni estratte dall'agente Creatore Lezioni, in attesa
//     di compattazione (svuotato dal Compattatore quando supera 3000 char).
//   - moduli: PROFILO, PREFERENZE, e N espansioni dinamiche. Sempre persistenti.
//
// In aggiunta gestiamo qui anche due store legati alla dashboard:
//   - timers: countdown attivi (azione TIMER).
//   - notifications: voci della colonna destra.
//
// Gli appunti NON stanno più qui: l'azione SALVA_APPUNTO li scrive nei file
// dell'editor (src/main/services/editorFiles.js), che è anche l'unico posto che
// conosce ancora il vecchio archivio, per svuotarlo una volta sola alla prima
// partenza dopo l'aggiornamento.
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

  // Tronca a `max` unità visibili senza spezzare un carattere a metà.
  // `String.slice` conta unità UTF-16: tagliare in mezzo a un'emoji (coppia
  // surrogata) lascerebbe un surrogato solitario, mostrato come glifo rotto in
  // un'etichetta di timer/sveglia. Contiamo per grafema (Intl.Segmenter, quando
  // c'è, tiene insieme anche emoji composte) con ripiego a code point.
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
  //
  // Non esistono più qui: gli appunti sono file dell'editor (ci scrive Filo
  // stesso), non un elenco a parte. Il vecchio archivio è già stato svuotato
  // dalla migrazione una-tantum in src/main/services/editorFiles.js — l'unico
  // punto rimasto che conosce quella chiave.

  // ===== Timer =====

  async function listTimers() {
    return getRaw(KEYS.FILO_TIMERS, []);
  }

  async function addTimer({ label, seconds }) {
    // Una durata non interpretabile o non positiva (0, negativa, NaN) NON crea un
    // timer: torniamo null e i chiamanti non lo trasmettono né lo segnano eseguito
    // (`if (t) broadcastLiveUpdate()`, `executed: !!entry`). Stessa filosofia di
    // addAlarm: meglio "non ho capito la durata" che programmare un timer fasullo.
    // (Prima un `Math.max(1, …)` forzava il minimo a 1s e rendeva questa guardia
    // irraggiungibile: un input malformato creava un timer di 1s che suonava subito.)
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

  // Mette in pausa un countdown: congela il tempo rimanente in `remainingMs` e
  // marca `paused: true`. Da quel momento `endsAt` non è più affidabile per il
  // rendering (il "now" avanza mentre il timer è fermo) — chi mostra un timer in
  // pausa DEVE usare `remainingMs`. Le sveglie (kind:'alarm') hanno un orario
  // assoluto: metterle in pausa non ha senso, quindi le ignoriamo. Un timer che
  // sta già suonando (`ringing`) o già in pausa resta invariato.
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

  // Riprende un timer in pausa: ricalcola `endsAt = adesso + remainingMs` così il
  // conto alla rovescia riparte esattamente da dove era stato fermato, e rimuove
  // il campo temporaneo. No-op su un timer non in pausa.
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

  // ===== Sveglie (#322) =====
  //
  // Una sveglia è un timer con scadenza ASSOLUTA: vive nella STESSA lista dei
  // timer (kind: 'alarm') così eredita gratis tutto il flusso già rodato —
  // gcTimers → ringing → suoneria + card "Ferma" nella dashboard. Prima
  // l'azione SVEGLIA creava solo una notifica statica che non suonava mai.

  // Converte l'orario richiesto in un timestamp assoluto (ms). Regole:
  //   - "HH:MM" / "H:MM" / "H" (anche col punto: "7.30"): la PROSSIMA
  //     occorrenza — oggi se ancora futura, altrimenti domani (chi chiede
  //     "sveglia alle 7" alle 23 intende domattina).
  //   - stringa ISO / data completa: quel momento esatto; se è già passato
  //     → null (non ha senso una sveglia nel passato).
  // Ritorna null se non interpretabile: meglio "non ho capito l'orario" che
  // fingere di aver programmato qualcosa.
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

  // ===== Ricorrenza settimanale delle sveglie =====
  //
  // Una sveglia può ripetersi nei giorni della settimana ("il lunedì e il
  // mercoledì"). Il dato canonico è un array di token brevi in `repeat`
  // (['lun','mer']) più l'orario in `atTime` ("07:55"): `endsAt` resta la
  // PROSSIMA occorrenza — così tutto il flusso esistente (gcTimers → ringing →
  // suoneria + notifica) continua a funzionare senza saperne nulla. Al suono la
  // sveglia NON si consuma: si ricalcola l'occorrenza successiva.

  const DOW_TOKENS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']; // indice = Date#getDay()
  const DOW_ORDER = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];  // ordine di lettura
  const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven'];
  const WEEKEND = ['sab', 'dom'];

  // Chiave di confronto: minuscolo, senza accenti, senza spazi/punteggiatura.
  // "fine settimana" → "finesettimana", "lunedì" → "lunedi".
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

  // Interpreta la ricorrenza chiesta e la riduce ai token canonici, ordinati da
  // lunedì a domenica. Accetta un array (['lun','mercoledì']), una stringa con
  // separatori ("lun, mer", "lunedì e mercoledì") o una scorciatoia ("feriali",
  // "weekend", "ogni giorno"). Quello che non si riconosce viene ignorato:
  // ritorna [] = sveglia a occorrenza singola (il comportamento di sempre).
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

  // Orario "puro" (ore/minuti locali) da "HH:MM", "H", "7.30" o da una data-ora
  // ISO. Serve per una sveglia ricorrente: il giorno lo decide la ricorrenza,
  // dell'input ci interessa solo l'ora.
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

  // Prossima occorrenza STRETTAMENTE futura di `clock` in uno dei `days`.
  // Guarda da oggi (i=0) a fra sette giorni compresi: così una sveglia del solo
  // lunedì chiesta lunedì dopo l'orario finisce al lunedì successivo, e una
  // chiesta prima dell'orario suona oggi.
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

  // Dicitura leggibile della ricorrenza: "ogni giorno", "feriali", "weekend"
  // oppure l'elenco dei giorni ("lun+mer"). Unica per stato dell'agente e
  // colonna destra: se cambia, cambia in un posto solo.
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

  // ===== Trovare "quale sveglia intende" =====
  //
  // L'utente non dice mai un id: dice "la sveglia della palestra", "quella
  // delle 7", "tutte le sveglie". Questa è la parte pura che, data la lista e
  // il riferimento, decide su quali entry agire. Ritorna sempre un array (vuoto
  // = non ho capito a cosa ti riferisci): chi la chiama non cancella nulla
  // quando è vuoto, invece di indovinare.

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

  // `ref`: { id?, label?, all?, kind? }. `kind` filtra 'alarm' (sveglie) o
  // 'timer' (countdown); assente = entrambi.
  function resolveTimerRefs(list, ref = {}) {
    const all = Array.isArray(list) ? list : [];
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
    // 4) riferimento all'ORARIO ("quella delle 7", "la sveglia delle 07:30").
    const hm = /(\d{1,2})(?:[:.](\d{2}))?/.exec(q);
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

  // Sposta una sveglia (nuovo orario e/o nuova ricorrenza) o rimette in moto un
  // countdown con una durata nuova. Ritorna { updated, list }: `updated` vuoto
  // significa "non ho capito quale, o il nuovo orario non è interpretabile" —
  // e allora non si tocca niente.
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
        // Ricorrenza: quella chiesta ora, se assente quella che la sveglia ha
        // già (spostare l'orario non deve far perdere "il lunedì e il mercoledì").
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

  // Pulizia: i timer scaduti (endsAt <= now) e non in pausa vengono marcati
  // `ringing: true` invece di essere eliminati, così la UI può far suonare la
  // suoneria e mostrare un controllo "Ferma". I timer in stato `ringing` restano
  // finché l'utente li ferma esplicitamente (via stopTimerAlarm) oppure fino
  // alla prossima apertura di Filo (in quel caso vengono rimossi silenziosamente
  // perché la suoneria non avrebbe senso senza la UI aperta).
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
        // Già marcato ringing: teniamolo in lista (l'utente non ha ancora
        // premuto Ferma). Non invalidiamo la cache ogni secondo.
        result.push(t);
      } else if (isRecurring(t)) {
        // Sveglia RICORRENTE: suona, ma non si consuma. Insieme a `ringing`
        // spostiamo già `endsAt` sull'occorrenza successiva, così il tick dopo
        // non la vede più scaduta e la settimana prossima suona di nuovo. Se
        // per qualche motivo la prossima non è calcolabile, si comporta come
        // una sveglia normale (suona una volta e la si ferma).
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
      // Invalida la cache della dashboard affinché eventuali suggerimenti
      // "il timer sta per suonare" vengano rigenerati.
      await setRaw(KEYS.FILO_DASHBOARD_CACHE, null);
    }
    return result;
  }

  // Silenzia un timer in stato ringing rimuovendolo dalla lista.
  // ECCEZIONE: una sveglia RICORRENTE non si cancella premendo "Ferma" — fermare
  // la sveglia di stamattina non vuol dire disdire quella di mercoledì. Resta in
  // lista, muta, già puntata sull'occorrenza successiva. Per toglierla davvero
  // c'è la × (deleteTimer), come per tutte le altre.
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
      // #155 — firma degli input con cui è stato generato questo messaggio:
      // serve a capire se la home andrebbe ricalcolata (input cambiati).
      signature: payload?.signature || '',
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
    // timer + sveglie (#322)
    listTimers, addTimer, addAlarm, resolveAlarmTime, deleteTimer, pauseTimer, resumeTimer, gcTimers, stopTimerAlarm,
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
