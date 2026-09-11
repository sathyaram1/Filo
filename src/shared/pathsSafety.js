// I percorsi condivisi (`paths`) sono l'unico contenuto di Filo scritto da un
// utente e LETTO nel prompt di un altro: chi li avvelena non colpisce sé stesso
// ma chi visiterà quel dominio. Qui sta il trattamento, dalle due parti:
//
//   • in SCRITTURA — `sanitizeSubmission()` è la pulizia deterministica che
//     decide cosa può entrare nella raccolta: forma del dominio, una riga sola
//     di intento, selettori redatti e tagliati, azioni note, tetto ai passi.
//     La applica il client PRIMA di inviare e la RIAPPLICA il server prima di
//     scrivere (le regole Firestore non lasciano più scrivere nessun client:
//     vedi firestore.rules → match /paths). Sta qui, in `src/shared/`, perché
//     è il posto da cui il backend di sicurezza incorpora i moduli condivisi al
//     deploy: una copia a mano dall'altra parte divergerebbe in silenzio.
//
//   • in LETTURA — `formatKnownPathsForPrompt()` impacchetta i percorsi fra due
//     marcature e li ripulisce di nuovo. La seconda pulizia non è un doppione:
//     nella raccolta restano i documenti scritti quando chiunque poteva
//     scriverli, e un percorso inviato in buona fede può comunque contenere il
//     testo di una pagina ostile. Il prompt (`SN_CONST.PROMPTS.helpContext`)
//     dichiara quel blocco contenuto esterno, e il promemoria finale lo cita
//     insieme a pagina, outline e llms.txt.

(function (global) {
  'use strict';

  // Limiti di forma. Stessi numeri dei vincoli in firestore.rules: se cambiano
  // qui vanno cambiati là (e viceversa), o una scrittura del server passerebbe
  // un controllo e non l'altro.
  const MAX_STEPS = 30;
  const MAX_SELECTOR_LEN = 500;
  const MAX_INTENT_LEN = 200;
  const MAX_DOMAIN_LEN = 253;
  const MAX_URL_LEN = 2000;
  const MAX_UA_LEN = 500;

  // Quanto spazio del prompt possono occupare in tutto i percorsi noti.
  const KNOWN_PATHS_BUDGET_CHARS = 20 * 1024;

  // Le due righe che delimitano il blocco nel messaggio di sistema. Il testo
  // dei percorsi non può contenerle (vedi `neutralizzaMarcature`): senza questa
  // precauzione basterebbe un intento che scrive la riga di chiusura per far
  // credere al modello che quello che segue non è più contenuto esterno.
  const FENCE_START = '<<<PERCORSI_CONDIVISI>>>';
  const FENCE_END = '<<<FINE_PERCORSI_CONDIVISI>>>';

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const LONG_NUM_RE = /\b\d{6,}\b/g;
  const AZIONI = ['click', 'fill', 'reveal', 'hover'];

  // Un dominio è un hostname: lettere, cifre, punti e trattini. Niente spazi,
  // niente a capo, niente slash — cioè niente frasi travestite da dominio.
  const DOMINIO_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  // Toglie tutto ciò che, dentro un testo che finirà nel prompt, servirebbe
  // solo a fingere di essere la struttura del prompt: caratteri di controllo,
  // a capo (ogni campo è una riga sola), sequenze di < o > che imiterebbero le
  // marcature, e il nome delle marcature stesse.
  function neutralizzaMarcature(testo) {
    return String(testo == null ? '' : testo)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/[\r\n\u2028\u2029]+/g, ' ')
      .replace(/<{2,}/g, '<')
      .replace(/>{2,}/g, '>')
      .replace(/PERCORSI_CONDIVISI/gi, 'percorsi-condivisi');
  }

  // I selettori prodotti dall'LLM possono contenere stringhe sensibili (es.
  // [aria-label="Profilo di mario.rossi@x.it"]): le redaction sostituiscono i
  // pattern sensibili con placeholder generici, così il selettore resta
  // leggibile per chi lo consuma ma non porta dati identificabili.
  function redactSelector(selector) {
    if (typeof selector !== 'string' || !selector) return '';
    let s = selector.replace(EMAIL_RE, '[EMAIL]').replace(LONG_NUM_RE, '[NUMERO]');
    s = neutralizzaMarcature(s).trim();
    if (s.length > MAX_SELECTOR_LEN) s = s.slice(0, MAX_SELECTOR_LEN);
    return s;
  }

  function sanitizeSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) return [];
    const out = [];
    for (const s of rawSteps) {
      if (!s || typeof s !== 'object') continue;
      const action = AZIONI.includes(s.action) ? s.action : 'click';
      const selector = redactSelector(s.selector);
      if (!selector) continue;
      out.push({ selector, action, retracted: !!s.retracted });
      if (out.length >= MAX_STEPS) break;
    }
    return out;
  }

  // L'intento è UNA riga: la produce un LLM e la rilegge un altro LLM dentro il
  // prompt di un'altra persona. Togliamo il wrapping markdown, teniamo la prima
  // riga, tagliamo a MAX_INTENT_LEN.
  function sanitizeIntent(text) {
    if (typeof text !== 'string') return '';
    let s = neutralizzaMarcature(text).trim();
    if (!s) return '';
    s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
    s = s.replace(/^[*_]+|[*_]+$/g, '').trim();
    if (s.length > MAX_INTENT_LEN) s = s.slice(0, MAX_INTENT_LEN);
    return s.trim();
  }

  function parseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try { return new URL(rawUrl); } catch (_) { return null; }
  }

  function domainOf(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    // hostname senza porta. Non strippiamo "www." per restare letterali: chi
    // consuma può fare il matching come preferisce.
    return (u.hostname || '').toLowerCase().slice(0, MAX_DOMAIN_LEN);
  }

  // Per il matching futuro vogliamo URL "stabili": teniamo il path (no query,
  // no hash) perché query e fragment di solito contengono parametri specifici
  // dell'utente o stato di UI; il path invece identifica la sezione del sito.
  function normalizedPath(rawUrl) {
    const u = parseUrl(rawUrl);
    if (!u) return '';
    let path = u.pathname || '/';
    if (path.length > MAX_URL_LEN) path = path.slice(0, MAX_URL_LEN);
    return path;
  }

  function sanitizeDomain(raw) {
    const d = String(raw || '').trim().toLowerCase().slice(0, MAX_DOMAIN_LEN);
    return DOMINIO_RE.test(d) ? d : '';
  }

  function sanitizeInitialUrl(raw) {
    // Accetta sia un URL intero (lo riduce al path) sia un path già normalizzato.
    const s = String(raw || '').trim();
    if (!s) return '/';
    if (/^https?:\/\//i.test(s)) return normalizedPath(s) || '/';
    const ripulito = neutralizzaMarcature(s).trim().replace(/\s+/g, '');
    if (!ripulito.startsWith('/')) return '/';
    return ripulito.slice(0, MAX_URL_LEN);
  }

  // LA pulizia: quella che il client applica prima di inviare e che il server
  // RIAPPLICA prima di scrivere. Ritorna { ok, doc } oppure { ok:false, reason }.
  // `clientId` non entra nel documento: la raccolta è leggibile da chiunque e un
  // identificativo stabile lì dentro legherebbe fra loro le navigazioni di una
  // stessa installazione. Serve al server come identità per i limiti di
  // frequenza, e viaggia accanto al documento, non dentro.
  function sanitizeSubmission(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload vuoto' };

    const domain = sanitizeDomain(raw.domain);
    if (!domain) return { ok: false, reason: 'dominio non valido' };

    const intent = sanitizeIntent(raw.intent);
    if (!intent) return { ok: false, reason: 'intento vuoto' };

    const steps = sanitizeSteps(raw.steps);
    if (!steps.length) return { ok: false, reason: 'nessuno step utile dopo la pulizia' };

    const userAgent = neutralizzaMarcature(raw.userAgent).trim().slice(0, MAX_UA_LEN);

    return {
      ok: true,
      doc: {
        domain,
        initialUrl: sanitizeInitialUrl(raw.initialUrl),
        intent,
        steps,
        success: !!raw.success,
        userAgent,
        clientId: '',
      },
    };
  }

  // ─────────────────────────── lato lettura ────────────────────────────────

  function clusterKey(p) {
    const init = (p && p.initialUrl) || '';
    const steps = Array.isArray(p && p.steps) ? p.steps : [];
    const sig = steps.map((s) => `${(s && s.action) || 'click'}|${(s && s.selector) || ''}`).join(',');
    return init + '::' + sig;
  }

  // Impacchetta i percorsi per il messaggio di sistema dell'agente Aiuto.
  // Ritorna '' se non c'è niente da mostrare — così il prompt non apre un
  // blocco vuoto. Ogni campo ripassa dalla pulizia: i documenti già nella
  // raccolta possono essere nati quando scriverli non richiedeva niente.
  function formatKnownPathsForPrompt(rawPaths) {
    if (!Array.isArray(rawPaths) || !rawPaths.length) return '';
    const seen = new Set();
    const dedup = [];
    for (const p of rawPaths) {
      if (!p || typeof p !== 'object') continue;
      const k = clusterKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(p);
    }
    const blocchi = [];
    let chars = 0;
    for (const p of dedup) {
      const steps = sanitizeSteps(p.steps);
      // Un percorso senza passi non insegna niente: sarebbe solo una frase di
      // ignoto autore dentro il prompt di qualcun altro.
      if (!steps.length) continue;
      const intent = sanitizeIntent(p.intent) || '(intento ignoto)';
      const init = sanitizeInitialUrl(p.initialUrl);
      const header = `## "${intent}" (da ${init})`;
      const stepLines = steps.map((s, i) =>
        `  ${i + 1}. ${s.action} su ${s.selector}${s.retracted ? ' [poi corretto]' : ''}`);
      const block = [header, ...stepLines].join('\n');
      if (chars + block.length + 2 > KNOWN_PATHS_BUDGET_CHARS) break;
      blocchi.push(block);
      chars += block.length + 2;
    }
    if (!blocchi.length) return '';
    return `${FENCE_START}\n${blocchi.join('\n\n')}\n${FENCE_END}`;
  }

  global.SN_PATHS_SAFETY = {
    sanitizeSubmission,
    formatKnownPathsForPrompt,
    FENCE_START,
    FENCE_END,
    LIMITI: { MAX_STEPS, MAX_SELECTOR_LEN, MAX_INTENT_LEN, MAX_DOMAIN_LEN, MAX_URL_LEN, MAX_UA_LEN, KNOWN_PATHS_BUDGET_CHARS },
    // Esposti per i test e per chi riusa i singoli pezzi.
    _internal: {
      neutralizzaMarcature, redactSelector, sanitizeSteps, sanitizeIntent,
      domainOf, normalizedPath, sanitizeDomain, sanitizeInitialUrl, clusterKey,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
