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
//   init({ prepare, onDone, onGiveUp, onAttesaOwner, tokenOwner, log, backoffMin, backoffMax })  — una volta all'avvio
//     onGiveUp(item, motivo) torna `false` se l'avviso non è arrivato a
//     nessuno: quella voce resta in coda finché non si riesce a dirlo.
//     tokenOwner() -> idToken admin fresco o '' (#595): chiesto a ogni
//     spedizione di una voce dell'owner, MAI salvato nella coda.
//     onAttesaOwner(item) -> boolean: la voce dell'owner aspetta il suo accesso (#912: mai da anonima); `false` = non detto.
//   enqueue(payload, { dallOwner }) -> { id, queued:true }  — accoda + prova subito
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
  // (item, motivo) -> boolean  (#602: rinuncia definitiva, va DETTA; `false`
  // = non c'era nessuno a cui dirlo, la voce resta in coda e si riprova)
  let onGiveUpFn = null;
  let tokenOwnerFn = null;
  let onAttesaOwnerFn = null;
  let logFn = function () { try { console.log.apply(console, ['[feedback-outbox]'].concat([].slice.call(arguments))); } catch (_) {} };
  let backoffMin = 3000;
  let backoffMax = 30000;
  let backoff = backoffMin;

  function serialize(it) {
    return {
      id: it.id, payload: it.payload, name: it.name, prepared: !!it.prepared,
      queuedAt: it.queuedAt, attempts: it.attempts || 0, dallOwner: !!it.dallOwner,
      // #602 — una voce che aspetta solo di essere ANNUNCIATA (non partirà
      // mai): si persiste come le altre, così l'avviso sopravvive a un riavvio.
      rinuncia: !!it.rinuncia, motivoRinuncia: it.motivoRinuncia || '',
      attesaAccesso: !!it.attesaAccesso, avvisatoAccesso: !!it.avvisatoAccesso,
    };
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
            dallOwner: !!x.dallOwner,
            rinuncia: !!x.rinuncia,
            motivoRinuncia: x.motivoRinuncia || '',
            attesaAccesso: !!x.attesaAccesso,
            avvisatoAccesso: !!x.avvisatoAccesso,
          }));
      }
    } catch (e) { logFn('load fallito:', e?.message || e); }
  }

  function init(opts) {
    opts = opts || {};
    if (typeof opts.prepare === 'function') prepareFn = opts.prepare;
    if (typeof opts.onDone === 'function') onDoneFn = opts.onDone;
    if (typeof opts.onGiveUp === 'function') onGiveUpFn = opts.onGiveUp;
    if (typeof opts.tokenOwner === 'function') tokenOwnerFn = opts.tokenOwner;
    if (typeof opts.onAttesaOwner === 'function') onAttesaOwnerFn = opts.onAttesaOwner;
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

  async function enqueue(payload, opts) {
    await load();
    const id = (payload && payload.submissionId)
      ? String(payload.submissionId)
      : `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dallOwner = !!(opts && opts.dallOwner);
    // Dedup su submissionId: due invii della stessa bozza non accodano due voci.
    if (!queue.some((it) => it.id === id)) {
      queue.push({ id, payload, name: null, prepared: false, queuedAt: Date.now(), attempts: 0, dallOwner });
      if (queue.length > MAX_ITEMS) queue = queue.slice(-MAX_ITEMS);
      await persist();
    }
    scheduleFlush(0);
    return { id, queued: true };
  }

  function remove(id) { queue = queue.filter((it) => it.id !== id); }

  // #602 — DIRLO È PARTE DEL BUTTARE VIA.
  //
  // Una segnalazione che non si può cifrare non partirà mai, e chi l'ha mandata
  // ha già letto «inviato». L'unica cosa che le resta è l'avviso: finché quello
  // non è arrivato a qualcuno, la voce NON si toglie dalla coda (che è
  // persistita, quindi regge anche un riavvio). Prima l'avviso partiva una
  // volta sola, verso chi c'era in quel momento: all'avvio, o con Filo in
  // secondo piano, non lo vedeva nessuno e la segnalazione spariva in silenzio.
  //
  // Chi riceve l'avviso risponde `false` quando non c'era nessuno a cui dirlo.
  // Tutto il resto (nessun avvisatore, un valore qualunque, un'eccezione)
  // conta come detto: una coda che non si svuota più per un avvisatore rotto
  // sarebbe un guasto peggiore di quello che cura.
  function annunciaRinuncia(it) {
    if (!onGiveUpFn) return true;
    try { return onGiveUpFn(it, it.motivoRinuncia) !== false; }
    catch (_) { return true; }
  }

  // Detto una volta per voce; un avvisatore che risponde `false` (nessuno a cui dirlo) riprova al giro dopo.
  function attendiAccesso(it, motivo) {
    it.attesaAccesso = true;
    logFn('voce dell\'owner ferma finché torna il suo accesso:', it.id, motivo);
    if (it.avvisatoAccesso || !onAttesaOwnerFn) return;
    try { it.avvisatoAccesso = onAttesaOwnerFn(it) !== false; } catch (_) { it.avvisatoAccesso = true; }
  }

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
        // Voce già rinunciata: non si tenta più di spedirla e non scade, si
        // prova solo a dirlo. Detto, esce dalla coda.
        if (it.rinuncia) {
          if (annunciaRinuncia(it)) remove(it.id);
          else anyFail = true;
          continue;
        }
        // Una voce dell'owner che aspetta il suo accesso non scade: buttarla perderebbe il feedback, che parte appena torna.
        if (!it.attesaAccesso && Date.now() - it.queuedAt > MAX_AGE_MS) {
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
          let idToken = '';
          if (it.dallOwner) {
            try { idToken = (tokenOwnerFn && await tokenOwnerFn()) || ''; } catch (_) { idToken = ''; }
            if (!idToken) { attendiAccesso(it, 'nessun accesso valido'); anyFail = true; continue; }
          }
          // #912: la voce dell'owner parte con la prova o non parte; da anonima diventerebbe un utente che nessuno riprende.
          const result = idToken ? await fb.submit(payload, { idToken, soloAdmin: true }) : await fb.submit(payload);
          remove(it.id);
          logFn('inviato:', it.id);
          try { onDoneFn && onDoneFn(it, result); } catch (_) {}
          backoff = backoffMin; // successo → azzera il backoff
        } catch (e) {
          // #602 — una cifratura che non si può fare NON è la rete che manca.
          // Riprovare non cambia niente finché quella copia di Filo resta com'è,
          // e intanto chi ha mandato la segnalazione ha già letto «inviato»:
          // restava in coda un giorno intero e poi spariva senza una parola.
          // Qui si smette subito e glielo si dice.
          if (fb.isEncryptionError && fb.isEncryptionError(e)) {
            logFn('rinuncio, la cifratura non si può fare:', it.id, e?.message || e);
            it.rinuncia = true;
            it.motivoRinuncia = e?.message || String(e);
            if (annunciaRinuncia(it)) remove(it.id);
            else anyFail = true; // nessuno a cui dirlo: si riprova, non si butta
            continue;
          }
          if (it.dallOwner && e && e.accessoOwner) { attendiAccesso(it, e.message || 'token rifiutato'); anyFail = true; continue; }
          it.attesaAccesso = false;
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
      prepareFn = null; onDoneFn = null; onGiveUpFn = null; tokenOwnerFn = null; backoff = backoffMin;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
