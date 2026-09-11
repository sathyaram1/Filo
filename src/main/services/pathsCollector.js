// Raccolta percorsi della sidebar Aiuto: pipeline di sanitizzazione + save.
//
// Il client (sidebar) raccoglie una sessione raw (URL iniziale, sequenza di
// {selector, action, retracted}, messaggi raw dell'utente, esito 👍/👎) e la
// passa qui via MSG.SAVE_PATH. Tutto ciò che finisce nel DB pubblico passa
// prima per due LLM distinti per evitare leak di dati personali:
//
//   1. INTENT_GUESS   — vede SOLO i dati programmatici (dominio, URL, sequenza
//                       azioni con selettori sanitizzati). Produce una frase
//                       di intento "neutra".
//   2. INTENT_JUDGE   — vede l'intento proposto + i messaggi raw dell'utente.
//                       Risponde {ok: true|false}. Solo 1 bit esce da qui.
//
// Se il judge dice ok, il documento viene scritto su Firestore con success
// (true per 👍, false per 👎). I 👎 servono solo a noi per debug — non
// vengono mandati come contesto ad altri agenti.
//
// Cosa NON viene passato a Firestore (audit pre-alpha, #584): niente clientId,
// niente user agent. Non erano usati da chi legge i percorsi e bastavano a
// ricucire i percorsi della stessa persona su domini diversi. La funzione qui
// sotto non li accetta più nemmeno come argomento: così nessun chiamante può
// rimetterli dentro per distrazione.
//
// E NEMMENO L'ISTANTE (#584, secondo giro). Togliere il clientId non bastava:
// Firestore scrive da sé su ogni documento l'ora di creazione, al microsecondo,
// e la rimanda a chiunque legga. L'app non può né scriverla né toglierla. Due
// percorsi salvati su due domini diversi a meno di un secondo l'uno dall'altro
// sono della stessa persona nella stessa sessione: la chiave di join che il
// clientId aveva smesso di essere, la faceva l'orologio.
//
// Quindi un percorso non si scrive più quando succede. Entra in una coda sul
// disco con un'ora di uscita sorteggiata nelle ore successive, e la coda ne
// manda fuori UNO alla volta, a intervalli anch'essi sorteggiati. Due percorsi
// della stessa sessione escono a distanza di ore, in ordine qualsiasi, mescolati
// a quelli di chiunque altro; l'unica data dentro il documento è il giorno.
// Costa niente: nessuno aspetta questa scrittura, è telemetria che serve agli
// altri più tardi. Se l'app si chiude la coda resta sul disco e riparte al
// prossimo avvio (ma sempre uno alla volta: se l'app è stata chiusa una
// settimana, svuotare tutto insieme rimetterebbe in fila la sessione com'era).

(function (global) {
  'use strict';

  const { ACTIONS } = global.SN_CONST;
  const Paths = global.SN_PATHS;

  // ------------------------ Sanitizzazione selettori --------------------------
  //
  // I selettori prodotti dall'LLM possono contenere stringhe sensibili (es.
  // [aria-label="Profilo di mario.rossi@x.it"]). Le redaction sotto sostituiscono
  // i pattern sensibili con placeholder generici, in modo che il selettore
  // resti "leggibile" per l'LLM consumer ma non porti dati identificabili.
  //
  // Dopo la redaction lasciamo che il chiamante (sidebar) verifichi sul DOM se
  // il selettore redatto è ancora univoco; qui ci occupiamo solo della stringa.

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const LONG_NUM_RE = /\b\d{6,}\b/g;

  function redactSelector(selector) {
    if (typeof selector !== 'string' || !selector) return '';
    return selector
      .replace(EMAIL_RE, '[EMAIL]')
      .replace(LONG_NUM_RE, '[NUMERO]');
  }

  // Limiti difensivi per non far esplodere il documento Firestore.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_USER_MSG_LEN = 1000;
  const MAX_USER_MSGS = 20;

  function sanitizeSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) return [];
    const out = [];
    for (const s of rawSteps) {
      if (!s || typeof s !== 'object') continue;
      const action = (s.action === 'fill' || s.action === 'reveal' || s.action === 'hover')
        ? s.action : 'click';
      let selector = redactSelector(s.selector);
      if (!selector) continue;
      if (selector.length > MAX_SELECTOR_LEN) selector = selector.slice(0, MAX_SELECTOR_LEN);
      out.push({
        selector,
        action,
        retracted: !!s.retracted,
      });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  }

  function sanitizeUserMessages(raws) {
    if (!Array.isArray(raws)) return [];
    return raws
      .filter((m) => typeof m === 'string' && m.trim())
      .slice(0, MAX_USER_MSGS)
      .map((m) => m.length > MAX_USER_MSG_LEN ? m.slice(0, MAX_USER_MSG_LEN) : m);
  }

  // ------------------------ Normalizzazione URL --------------------------
  //
  // Per il matching futuro vogliamo URL "stabili": teniamo path (no query/hash)
  // perché query e fragment di solito contengono parametri specifici dell'utente
  // o stato di UI. Manteniamo invece il path completo perché spesso identifica
  // la sezione del sito (es. /account/orders).

  function parseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      return new URL(rawUrl);
    } catch (_) {
      return null;
    }
  }

  function domainOf(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    // hostname senza porta. Non strippiamo "www." per restare letterali:
    // chi consuma può fare il matching come preferisce.
    return (u.hostname || '').toLowerCase().slice(0, 253);
  }

  function normalizedPath(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    let path = u.pathname || '/';
    if (path.length > 2000) path = path.slice(0, 2000);
    return path;
  }

  // ------------------------ Estrazione output LLM --------------------------

  // L'intent-guess produce una sola riga di testo. Difese:
  // - tagliamo a 200 char,
  // - togliamo virgolette/backtick/asterischi,
  // - se vuoto o "intento non chiaro" → null.
  function cleanGuessedIntent(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim();
    if (!s) return null;
    // toglie eventuale wrapping markdown / quoting
    s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
    s = s.replace(/^[*_]+|[*_]+$/g, '').trim();
    // prendi solo la prima linea (alcuni modelli sbordano)
    s = s.split(/\r?\n/)[0].trim();
    if (s.length > 200) s = s.slice(0, 200);
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

  // ------------------------ La coda che stacca l'orologio --------------------
  //
  // Perché esista, vedi la testata. Qui i numeri e le regole:
  //
  // - RITARDO: un percorso esce fra mezz'ora e ventiquattr'ore dopo, sorteggiato
  //   per ciascuno a parte. Due percorsi della stessa sessione finiscono quasi
  //   sempre a ore di distanza, e l'ordine in cui escono non è quello in cui
  //   sono stati percorsi.
  // - UNO ALLA VOLTA: ogni giro manda fuori un solo percorso, anche se ne sono
  //   maturati dieci. Serve per il caso "app chiusa per una settimana", dove
  //   svuotare tutto insieme rimetterebbe i percorsi in fila nell'ordine della
  //   sessione, a millisecondi l'uno dall'altro: la ricucitura di prima.
  // - PAUSA fra un giro e l'altro: fra due e venti minuti, sorteggiata.
  // - Se la scrittura fallisce (niente rete) il percorso resta in coda e si
  //   riprova al giro dopo. Dopo trenta giorni si rinuncia: un percorso vecchio
  //   di un mese non serve più a nessuno.

  const CHIAVE_CODA = (global.SN_CONST && global.SN_CONST.STORAGE_KEYS
    && global.SN_CONST.STORAGE_KEYS.PATHS_OUTBOX) || 'pathsOutbox';

  const RITARDO_MIN_MS = 30 * 60 * 1000;          // mezz'ora
  const RITARDO_MAX_MS = 24 * 60 * 60 * 1000;     // un giorno
  const PAUSA_MIN_MS = 2 * 60 * 1000;             // due minuti
  const PAUSA_MAX_MS = 20 * 60 * 1000;            // venti minuti
  const MAX_IN_CODA = 100;
  const MAX_ETA_MS = 30 * 24 * 60 * 60 * 1000;    // un mese

  let coda = [];
  let caricata = false;
  let sto = false;      // un giro alla volta
  let auto = true;      // spegnibile nei test
  let timer = null;
  let sorteggio = Math.random;

  function sorteggia(min, max) {
    return Math.round(min + sorteggio() * (max - min));
  }

  function deposito() { return global.SN_STORAGE; }

  async function salva() {
    try { await deposito()?.setRaw?.(CHIAVE_CODA, coda); }
    catch (e) { console.warn('[Filo] coda percorsi: salvataggio fallito', e?.message || e); }
  }

  async function carica() {
    if (caricata) return;
    caricata = true;
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
    if (coda.length > MAX_IN_CODA) coda = coda.slice(-MAX_IN_CODA);
    await salva();
    pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return { id: voce.id };
  }

  // Un giro: butta via gli scaduti, manda fuori UN percorso maturo, ripianifica.
  // Torna il numero di percorsi rimasti in coda.
  async function flush({ now = Date.now() } = {}) {
    if (sto) return coda.length;
    sto = true;
    try {
      await carica();
      const prima = coda.length;
      coda = coda.filter((v) => now - v.accodatoIl <= MAX_ETA_MS);

      // Fra i maturi si sceglie A CASO, non il più vecchio: l'ordine di uscita
      // non deve rifare l'ordine della sessione.
      const maturi = coda.filter((v) => v.nonPrimaDi <= now);
      let scritto = false;
      if (maturi.length) {
        const voce = maturi[Math.min(maturi.length - 1, Math.floor(sorteggio() * maturi.length))];
        try {
          await Paths.submit({
            domain: voce.domain,
            initialUrl: voce.initialUrl,
            intent: voce.intent,
            steps: voce.steps,
            success: voce.success,
            now,
          });
          coda = coda.filter((v) => v.id !== voce.id);
          scritto = true;
        } catch (e) {
          console.warn('[Filo] coda percorsi: scrittura fallita, riprovo', e?.message || e);
        }
      }
      if (scritto || coda.length !== prima) await salva();
    } finally {
      sto = false;
    }
    if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    return coda.length;
  }

  function inCoda() { return coda.length; }

  // All'avvio: se sul disco è rimasto qualcosa, si riparte (con una pausa, non
  // subito: un lampo di scritture all'apertura sarebbe di nuovo un orario).
  function init() {
    carica().then(() => {
      if (coda.length) pianifica(sorteggia(PAUSA_MIN_MS, PAUSA_MAX_MS));
    }).catch(() => {});
  }

  // ------------------------ Orchestratore --------------------------
  //
  // Ritorna { saved: bool, reason: string }. Non lancia: i fallimenti sono
  // reportati come reason testuale così il chiamante può loggare senza che
  // l'utente veda errori (è una pipeline best-effort di telemetria).
  async function collectAndSave({ session, invokeAI }) {
    if (!session || typeof session !== 'object') {
      return { saved: false, reason: 'session vuota' };
    }
    const domain = domainOf(session.rawUrl);
    if (!domain) return { saved: false, reason: 'dominio non valido' };
    const initialUrl = normalizedPath(session.rawUrl);
    const sanitizedSteps = sanitizeSteps(session.rawSteps);
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

    // 2. judge: vede l'intento proposto + messaggi raw. Output: solo 1 bit.
    let ok = false;
    try {
      const r = await invokeAI({
        action: ACTIONS.HELP_INTENT_JUDGE,
        payload: { proposedIntent: guessedIntent, userMessages: rawUserMessages },
      });
      ok = parseJudgeOutput(r?.text);
    } catch (e) {
      return { saved: false, reason: `intent_judge fallito: ${e.message || e}` };
    }
    if (!ok) return { saved: false, reason: 'judge ha rifiutato l\'intento' };

    // 3. in coda. NON si scrive adesso: vedi la testata.
    try {
      const { id } = await accoda({
        domain,
        initialUrl,
        intent: guessedIntent,
        steps: sanitizedSteps,
        success: !!session.success,
      });
      return { saved: true, queued: true, id, intent: guessedIntent };
    } catch (e) {
      return { saved: false, reason: `coda percorsi fallita: ${e.message || e}` };
    }
  }

  global.SN_PATHS_COLLECTOR = {
    collectAndSave,
    flush,
    inCoda,
    // Esposti per test/debug e per riuso in altri moduli.
    _internal: {
      redactSelector, sanitizeSteps, sanitizeUserMessages, domainOf, normalizedPath,
      cleanGuessedIntent, parseJudgeOutput, accoda, sorteggia, RITARDO_MIN_MS, RITARDO_MAX_MS,
    },
    // ---- helper per i test (nessun effetto in produzione) ----
    _peek: () => coda.map((v) => ({ ...v })),
    _setAuto: (v) => { auto = !!v; if (!auto && timer) { clearTimeout(timer); timer = null; } },
    _setSorteggio: (fn) => { sorteggio = typeof fn === 'function' ? fn : Math.random; },
    _reset: () => {
      coda = []; caricata = false; sto = false; auto = true; sorteggio = Math.random;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
