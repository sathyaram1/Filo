// Raccolta percorsi dell'Aiuto: due LLM in fila, uno propone l'intento, l'altro vede anche
// quello che verrebbe pubblicato e risponde un bit — è l'unica cosa che ferma un nome di
// persona in un'etichetta. Chi passa entra in coda: lo manda il server ore dopo (#584).

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const Paths = global.SN_PATHS;
  const Safety = global.SN_PATHS_SAFETY;

  // Limiti difensivi sui messaggi raw: un prompt non deve poter esplodere, e un messaggio
  // a più righe aprirebbe nella domanda al giudice sezioni che sembrano parte della domanda.
  const MAX_USER_MSG_LEN = 1000;
  const MAX_USER_MSGS = 20;

  function unaRiga(testo, max) {
    return global.SN_CONST.unaRigaDiDati(testo, max);
  }

  function protocolloDi(rawUrl) {
    try { return new URL(String(rawUrl || '')).protocol; } catch (_) { return ''; }
  }

  function sanitizeUserMessages(raws) {
    if (!Array.isArray(raws)) return [];
    return raws
      .filter((m) => typeof m === 'string' && m.trim())
      .slice(0, MAX_USER_MSGS)
      .map((m) => unaRiga(m, MAX_USER_MSG_LEN))
      .filter(Boolean);
  }

  // Oltre alla pulizia condivisa si riconosce «intento non chiaro»: vuol dire non salvare.
  function cleanGuessedIntent(text) {
    const s = Safety._internal.sanitizeIntent(typeof text === 'string' ? text : '');
    if (!s) return null;
    if (/^intento non chiaro\.?$/i.test(s)) return null;
    return s;
  }

  function parseJudgeOutput(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return false;
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      return obj && obj.ok === true;
    } catch (_) {
      return false;
    }
  }

  // La coda che stacca l'orologio: ogni percorso esce fra mezz'ora e un giorno dopo, uno per
  // giro, con pausa sorteggiata. Invio fallito: resta in coda; dopo un mese si rinuncia.

  const CHIAVE_CODA = (global.SN_CONST && global.SN_CONST.STORAGE_KEYS
    && global.SN_CONST.STORAGE_KEYS.PATHS_OUTBOX) || 'pathsOutbox';

  const RITARDO_MIN_MS = 30 * 60 * 1000;
  const RITARDO_MAX_MS = 24 * 60 * 60 * 1000;
  const PAUSA_MIN_MS = 2 * 60 * 1000;
  const PAUSA_MAX_MS = 20 * 60 * 1000;
  // Quando la coda è piena a restare fuori è il percorso NUOVO, con un motivo nei log: quello
  // già in coda è stato accettato e ha aspettato ore; farlo sparire in silenzio era il guasto.
  const MAX_IN_CODA = 500;
  const MAX_ETA_MS = 30 * 24 * 60 * 60 * 1000;

  let coda = [];
  let caricamento = null;   // la lettura del disco, una sola per tutti
  let sto = false;          // un giro alla volta
  let auto = true;          // spegnibile nei test
  let timer = null;
  let sorteggio = Math.random;
  // Il token si chiede fresco all'invio: fra raccolta e partenza passano ore, e uno
  // scaduto è una richiesta senza mittente.
  let ottieniIdToken = async () => '';

  function sorteggia(min, max) {
    return Math.round(min + sorteggio() * (max - min));
  }

  function deposito() { return global.SN_STORAGE; }

  async function salva() {
    try { await deposito()?.setRaw?.(CHIAVE_CODA, coda); }
    catch (e) { console.warn('[Filo] coda percorsi: salvataggio fallito', e?.message || e); }
  }

  // Una sola lettura del disco, e chi arriva mentre è in corso ASPETTA QUELLA: con un «già
  // fatta?» chi accodava durante la lettura si vedeva passare sopra la coda, in silenzio.
  function carica() {
    if (caricamento) return caricamento;
    caricamento = leggiDaDisco();
    return caricamento;
  }

  async function leggiDaDisco() {
    try {
      const raw = await deposito()?.getRaw?.(CHIAVE_CODA, []);
      if (Array.isArray(raw)) {
        coda = raw
          .filter((v) => v && typeof v === 'object' && v.domain)
          .map((v) => ({
            id: String(v.id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            domain: String(v.domain),
            initialUrl: String(v.initialUrl || ''),
            intent: String(v.intent || ''),
            steps: Array.isArray(v.steps) ? v.steps : [],
            success: !!v.success,
            accodatoIl: Number(v.accodatoIl) || Date.now(),
            nonPrimaDi: Number(v.nonPrimaDi) || Date.now(),
          }));
      }
    } catch (e) {
      console.warn('[Filo] coda percorsi: lettura fallita', e?.message || e);
    }
  }

  function pianifica(fra) {
    if (!auto || timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, Math.max(0, fra | 0));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function accoda(percorso) {
    await carica();
    if (coda.length >= MAX_IN_CODA) {
      console.warn(`[Filo] coda percorsi: piena (${coda.length} in attesa), il percorso nuovo non entra`);
      return { id: '', piena: true };
    }
    const ora = Date.now();
    const voce = {
      id: `p_${ora}_${Math.random().toString(36).slice(2, 8)}`,
      domain: percorso.domain,
      initialUrl: percorso.initialUrl,
      intent: percorso.intent,
      steps: percorso.steps,
      success: !!percorso.success,
      accodatoIl: ora,
      nonPrimaDi: ora + sorteggia(RITARDO_MIN_MS, RITARDO_MAX_MS),
    };
    coda.push(voce);
    await salva();
    pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return { id: voce.id };
  }

  // Un giro: butta via gli scaduti, manda fuori UN percorso maturo, ripianifica.
  async function flush({ now = Date.now() } = {}) {
    if (sto) return coda.length;
    sto = true;
    try {
      await carica();
      const prima = coda.length;
      // La scadenza butta il percorso e lo DICE: se gli invii falliscono tutti la coda si svuota
      // solo così, e senza una riga nei log la raccolta si fermerebbe senza che nessuno lo sappia.
      const scaduti = coda.filter((v) => now - v.accodatoIl > MAX_ETA_MS);
      if (scaduti.length) {
        console.warn(`[Filo] coda percorsi: ${scaduti.length} percorso/i scaduto/i dopo trenta giorni senza riuscire a partire, buttati`);
      }
      coda = coda.filter((v) => now - v.accodatoIl <= MAX_ETA_MS);
      // Fra i maturi si sceglie A CASO: l'ordine di uscita non deve rifare quello della sessione.
      const maturi = coda.filter((v) => v.nonPrimaDi <= now);
      let inviato = false;
      if (maturi.length) {
        const voce = maturi[Math.min(maturi.length - 1, Math.floor(sorteggio() * maturi.length))];
        let idToken = '';
        try { idToken = (await ottieniIdToken()) || ''; } catch (_) { idToken = ''; }
        try {
          await Paths.submit({
            domain: voce.domain,
            initialUrl: voce.initialUrl,
            intent: voce.intent,
            steps: voce.steps,
            success: voce.success,
            idToken,
          });
          coda = coda.filter((v) => v.id !== voce.id);
          inviato = true;
        } catch (e) {
          console.warn('[Filo] coda percorsi: invio fallito, riprovo', e?.message || e);
        }
      }
      if (inviato || coda.length !== prima) await salva();
    } finally {
      sto = false;
    }
    if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return coda.length;
  }

  function inCoda() { return coda.length; }

  // All'avvio si riparte con una pausa: un lampo di invii all'apertura è di nuovo un orario.
  function init(opzioni) {
    if (opzioni && typeof opzioni.ottieniIdToken === 'function') {
      ottieniIdToken = opzioni.ottieniIdToken;
    }
    carica().then(() => {
      if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    }).catch(() => {});
  }

  // LA PORTA UNICA di «se rispondesse, partirebbe qualcosa?»: la fanno la raccolta e il
  // riquadro «Ha funzionato?», o il riquadro promette una condivisione che non avviene.
  async function raccoglibile(rawUrl) {
    const domain = Safety._internal.domainOf(rawUrl);
    if (!domain) return { ok: false, reason: 'dominio non valido' };
    if (!/^https?:$/i.test(protocolloDi(rawUrl)) || !Safety.sitoCondivisibile(domain)) {
      return { ok: false, reason: 'sito privato o locale: non si condivide' };
    }
    await carica();
    if (coda.length >= MAX_IN_CODA) return { ok: false, reason: 'coda dei percorsi piena' };
    return { ok: true };
  }

  // Non lancia: i fallimenti tornano come `reason` testuale, così il chiamante logga senza che
  // l'utente veda errori.
  async function collectAndSave({ session, invokeAI }) {
    if (!session || typeof session !== 'object') {
      return { saved: false, reason: 'session vuota' };
    }
    // Si scopre PRIMA dei due modelli: chiederglielo costerebbe due chiamate per un percorso da
    // buttare. È la stessa porta del riquadrino, o le due risposte divergono.
    const porta = await raccoglibile(session.rawUrl);
    if (!porta.ok) return { saved: false, reason: porta.reason };
    const domain = Safety._internal.domainOf(session.rawUrl);
    const initialUrl = Safety._internal.normalizedPath(session.rawUrl);
    const sanitizedSteps = Safety._internal.sanitizeSteps(session.rawSteps);
    if (!sanitizedSteps.length) return { saved: false, reason: 'nessuno step utile dopo sanitizzazione' };

    const rawUserMessages = sanitizeUserMessages(session.rawUserMessages);
    if (!rawUserMessages.length) return { saved: false, reason: 'nessun messaggio utente raw' };

    // 1. intent guess: vede SOLO dati programmatici già sanitizzati.
    let guessedIntent = null;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_GUESS,
        payload: { domain, initialUrl, steps: sanitizedSteps },
      });
      guessedIntent = cleanGuessedIntent(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_guess fallito: ${e.message || e}` };
    }
    if (!guessedIntent) return { saved: false, reason: 'intento non chiaro' };

    // 2. judge: intento proposto, messaggi raw e QUELLO CHE VERREBBE PUBBLICATO, già ripulito.
    // Output: un bit solo.
    let ok = false;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_JUDGE,
        payload: {
          proposedIntent: guessedIntent,
          userMessages: rawUserMessages,
          domain,
          initialUrl,
          steps: sanitizedSteps,
        },
      });
      ok = parseJudgeOutput(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_judge fallito: ${e.message || e}` };
    }
    if (!ok) return { saved: false, reason: 'judge ha rifiutato l\'intento' };

    // 3. in coda. NON si invia adesso: vedi la testata.
    try {
      const { id, piena } = await accoda({
        domain,
        initialUrl,
        intent: guessedIntent,
        steps: sanitizedSteps,
        success: !!session.success,
      });
      if (piena) return { saved: false, reason: 'coda dei percorsi piena' };
      return { saved: true, queued: true, id, intent: guessedIntent };
    } catch (e) {
      return { saved: false, reason: `coda percorsi fallita: ${e.message || e}` };
    }
  }

  global.SN_PATHS_COLLECTOR = {
    collectAndSave,
    raccoglibile,
    init,
    flush,
    inCoda,
    // La pulizia deterministica è quella condivisa col server: qui solo ri-esportata.
    _internal: {
      sanitizeUserMessages, cleanGuessedIntent, parseJudgeOutput,
      accoda, sorteggia, RITARDO_MIN_MS, RITARDO_MAX_MS, MAX_IN_CODA,
      redactSelector: Safety._internal.redactSelector,
      sanitizeSteps: Safety._internal.sanitizeSteps,
      domainOf: Safety._internal.domainOf,
      normalizedPath: Safety._internal.normalizedPath,
      redigiPercorso: Safety._internal.redigiPercorso,
    },
    // Helper per i test: nessun effetto in produzione.
    _peek: () => coda.map((v) => ({ ...v })),
    _setAuto: (v) => { auto = !!v; if (!auto && timer) { clearTimeout(timer); timer = null; } },
    _setSorteggio: (fn) => { sorteggio = typeof fn === 'function' ? fn : Math.random; },
    _setIdToken: (fn) => { ottieniIdToken = typeof fn === 'function' ? fn : async () => ''; },
    _reset: () => {
      coda = []; caricamento = null; sto = false; auto = true; sorteggio = Math.random;
      ottieniIdToken = async () => '';
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
