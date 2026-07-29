// Outbox del feedback: invio "fire-and-forget" con ritentativo in background.
//
// PERCHÉ ESISTE (feedback #341)
//   Quando l'utente invia un feedback senza rete, il vecchio flusso restava
//   bloccato sul box con un errore ("Errore invio: timeout — controlla la rete")
//   e costringeva a ritentare a mano. L'attrito è negativo: alla pressione di
//   "Invia" il box deve sparire SUBITO e Filo deve farsi carico dell'invio,
//   ritentando da solo appena la connessione torna. L'utente non deve gestire
//   nulla — coerente con "il software deve poter essere usato male".
//
// COME
//   Il main tiene una piccola coda persistita (sopravvive al riavvio: un
//   feedback accodato offline e l'app chiusa parte al prossimo avvio). Ogni
//   voce viene ritentata con backoff crescente (max ~30s) finché l'invio riesce:
//   così "quando c'è connessione" significa "entro ~30s dal ritorno della rete".
//   L'invio è idempotente lato server (submissionId → dedup), quindi ritentare
//   la stessa voce non crea mai duplicati.
//
// DIPENDENZE (da globalThis, caricate prima dal loader)
//   SN_STORAGE   getRaw/setRaw per persistere la coda
//   SN_FEEDBACK  submit(payload) + fallbackName(text)
//   SN_CONST     STORAGE_KEYS.FEEDBACK_OUTBOX
//
// API
//   init({ prepare, onDone, log, backoffMin, backoffMax })  — una volta all'avvio
//   enqueue(payload) -> { id, queued:true }                 — accoda + prova subito
//   flush() -> Promise<boolean>                             — tenta tutta la coda una volta (true se svuotata)
//   size()                                                  — voci in coda

(function (global) {
  'use strict';

  function storage() { return global.SN_STORAGE; }
  function feedback() { return global.SN_FEEDBACK; }
  function key() {
    return (global.SN_CONST && global.SN_CONST.STORAGE_KEYS
      && global.SN_CONST.STORAGE_KEYS.FEEDBACK_OUTBOX) || 'feedbackOutbox';
  }

  const MAX_ITEMS = 50;                  // tetto difensivo alla coda
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // dopo 24h di soli fallimenti: rinuncia

  let queue = [];        // mirror in memoria del persistito
  let loaded = false;
  let flushing = false;
  let timer = null;
  let auto = true;       // scheduling automatico (disattivabile nei test)
  let prepareFn = null;  // async (payload) -> name (titolo generato al momento dell'invio)
  let onDoneFn = null;   // (item, result) -> void  (es. avvisare di allegati non caricati)
  let logFn = function () { try { console.log.apply(console, ['[feedback-outbox]'].concat([].slice.call(arguments))); } catch (_) {} };
  let backoffMin = 3000;
  let backoffMax = 30000;
  let backoff = backoffMin;

  function serialize(it) {
    return { id: it.id, payload: it.payload, name: it.name, prepared: !!it.prepared, queuedAt: it.queuedAt, attempts: it.attempts || 0 };
  }

  async function persist() {
    try { await storage()?.setRaw(key(), queue.map(serialize)); }
    catch (e) { logFn('persist fallito:', e?.message || e); }
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await storage()?.getRaw(key(), []);
      if (Array.isArray(raw)) {
        queue = raw
          .filter((x) => x && x.payload)
          .map((x) => ({
            id: x.id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            payload: x.payload,
            name: x.name || null,
            prepared: !!x.prepared,
            queuedAt: Number(x.queuedAt) || Date.now(),
            attempts: Number(x.attempts) || 0,
          }));
      }
    } catch (e) { logFn('load fallito:', e?.message || e); }
  }

  function init(opts) {
    opts = opts || {};
    if (typeof opts.prepare === 'function') prepareFn = opts.prepare;
    if (typeof opts.onDone === 'function') onDoneFn = opts.onDone;
    if (typeof opts.log === 'function') logFn = opts.log;
    if (Number.isFinite(opts.backoffMin)) { backoffMin = opts.backoffMin; backoff = opts.backoffMin; }
    if (Number.isFinite(opts.backoffMax)) backoffMax = opts.backoffMax;
    // Recupera i feedback accodati e non ancora inviati (es. app riavviata mentre
    // era offline) e prova subito a smaltirli.
    load().then(() => { if (queue.length) scheduleFlush(0); }).catch(() => {});
  }

  function scheduleFlush(delay) {
    if (!auto || timer) return;
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, Math.max(0, delay | 0));
    if (timer && typeof timer.unref === 'function') timer.unref(); // non tenere vivo il processo
  }

  async function enqueue(payload) {
    await load();
    const id = (payload && payload.submissionId)
      ? String(payload.submissionId)
      : `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Dedup su submissionId: due invii della stessa bozza non accodano due voci.
    if (!queue.some((it) => it.id === id)) {
      queue.push({ id, payload, name: null, prepared: false, queuedAt: Date.now(), attempts: 0 });
      if (queue.length > MAX_ITEMS) queue = queue.slice(-MAX_ITEMS);
      await persist();
    }
    scheduleFlush(0);
    return { id, queued: true };
  }

  function remove(id) { queue = queue.filter((it) => it.id !== id); }

  // Tenta di inviare TUTTA la coda una volta. Ritorna true se la coda è vuota
  // dopo il tentativo. Su fallimento (offline) le voci restano in coda e, se
  // `auto`, viene pianificato un nuovo tentativo con backoff crescente.
  async function flush() {
    if (flushing) return queue.length === 0;
    flushing = true;
    let anyFail = false;
    try {
      await load();
      for (const it of queue.slice()) {
        if (Date.now() - it.queuedAt > MAX_AGE_MS) {
          logFn('voce scaduta dopo troppi tentativi, rinuncio:', it.id);
          remove(it.id);
          continue;
        }
        const fb = feedback();
        if (!fb || typeof fb.submit !== 'function') { anyFail = true; break; }
        try {
          // Titolo breve generato al momento dell'invio (offline ripiega sul
          // fallback), calcolato UNA volta e riusato dai ritentativi.
          if (!it.prepared) {
            let name = '';
            if (prepareFn) {
              try { name = await prepareFn(it.payload); }
              catch (_) { name = (fb.fallbackName && fb.fallbackName(it.payload && it.payload.text)) || ''; }
            }
            it.name = name || '';
            it.prepared = true;
          }
          const payload = it.name ? Object.assign({}, it.payload, { name: it.name }) : it.payload;
          const result = await fb.submit(payload);
          remove(it.id);
          logFn('inviato:', it.id);
          try { onDoneFn && onDoneFn(it, result); } catch (_) {}
          backoff = backoffMin; // successo → azzera il backoff
        } catch (e) {
          it.attempts = (it.attempts || 0) + 1;
          anyFail = true;
          logFn('invio fallito (riprovo):', it.id, e?.message || e);
        }
      }
      await persist();
    } finally {
      flushing = false;
    }
    if (anyFail && queue.length) {
      const d = backoff;
      backoff = Math.min(backoffMax, Math.round(backoff * 1.7));
      scheduleFlush(d);
    }
    return queue.length === 0;
  }

  global.SN_FEEDBACK_OUTBOX = {
    init,
    enqueue,
    flush,
    size: () => queue.length,
    // ---- helper per i test (logica pura, nessun effetto in produzione) ----
    _peek: () => queue.map(serialize),
    _setAuto: (v) => { auto = !!v; if (!auto && timer) { clearTimeout(timer); timer = null; } },
    _reset: () => {
      queue = []; loaded = false; flushing = false; auto = true;
      prepareFn = null; onDoneFn = null; backoff = backoffMin;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
