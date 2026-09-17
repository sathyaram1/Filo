// Errore tecnico → frase per l'utente (#331, #360): una chat non è un log, «fetch failed»
// non dice niente a chi legge e il dettaglio resta nei log del main.
// friendly() è una proposizione da incastonare, sentence() una frase a sé. Logica pura.

(function (global) {
  'use strict';

  // Nessuna risposta HTTP è arrivata, quindi ritentare ha senso: un 400 tornerebbe uguale.
  // Due forme: «failed to fetch» nel renderer, «fetch failed» nel main. Stessa classifica.
  const TRANSIENT_NETWORK_RE =
    /fetch failed|failed to fetch|load failed|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed|timed out|timeout/i;

  function messageOf(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    // Il vero motivo sta spesso nella `cause`: «fetch failed» ← «ENOTFOUND».
    const own = String(e.message || '');
    const causeMsg = e.cause ? String(e.cause.message || e.cause.code || e.cause) : '';
    return causeMsg ? `${own} ${causeMsg}` : own;
  }

  function isTransientNetwork(e) {
    if (!e) return false;
    // Annullato da noi (cambio pagina, reinvio): non è un guasto, e ritentare sarebbe
    // sbagliato.
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return false;
    // Un errore con status HTTP è una RISPOSTA del server, non un guasto di rete:
    // ritentarlo alla cieca non serve.
    if (Number(e.status) > 0) return false;
    const code = String(e.code || (e.cause && e.cause.code) || '');
    if (code && TRANSIENT_NETWORK_RE.test(code)) return true;
    return TRANSIENT_NETWORK_RE.test(messageOf(e));
  }

  // Mai un codice HTTP nudo né un nome di endpoint. Gli errori con `code` applicativo portano
  // già un messaggio per l'utente, che dice dove si rimedia: passano invariati.
  function friendly(e, opts) {
    const o = opts || {};
    const raw = String((e && e.message) || (typeof e === 'string' ? e : ''));
    // FEEDBACK_READ_DENIED (#583): i feedback li legge solo chi li gestisce.
    // Non è un guasto e riprovare non serve.
    if (e && (e.code === 'NO_API_KEY' || e.code === 'LIMIT_REACHED'
      || e.code === 'NO_MODEL_FOR_ACTION' || e.code === 'FEEDBACK_READ_DENIED')) return raw;

    // Va PRIMA dell'analisi HTTP: qui non c'è nessuna risposta da interpretare.
    if (isTransientNetwork(e)) {
      return 'problema di rete: non sono riuscito a raggiungere il servizio. Controlla la connessione e riprova.';
    }

    // Errore del SERVIZIO AI, riconosciuto dal marcatore `err.provider` o, per quelli non
    // marcati, dalla forma del messaggio.
    const pm = /^(OpenRouter|Gemini)(?:\s+\S+)?\s+(\d{3})\b/.exec(raw);
    if ((e && e.provider) || pm) {
      const st = Number(e && e.status) || (pm ? Number(pm[2]) : 0);
      // Il router non ha trovato un host che accetti gli strumenti per quel modello, e la chat
      // della home non funziona senza: non è passeggero, è il modello da cambiare.
      if (/tool/i.test(raw) && (st === 404 || st === 400)) {
        return 'il modello scelto nelle Impostazioni non sa usare gli strumenti (cercare, leggere, impostare): la chat di Filo ne ha bisogno. Scegli un altro modello in Modelli predefiniti.';
      }
      if (st === 401 || st === 403) {
        return 'il servizio AI ha rifiutato la chiave API: controlla che sia giusta (e ancora valida) nelle Impostazioni.';
      }
      // 402 (#598): il tetto della chiave è esaurito, i crediti di Filo o il conto di chi ne usa
      // una sua. Non si ritenta: OpenRouter rifiuta finché il tetto non sale.
      if (st === 402) {
        return 'i crediti sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nelle Impostazioni. Se usi già una chiave tua, è il suo credito a essere esaurito.';
      }
      if (st === 429 || st >= 500) {
        return 'il servizio AI è momentaneamente sovraccarico o non disponibile. Riprova tra qualche minuto.';
      }
      return 'il servizio AI non è riuscito a rispondere: potrebbe esserci un problema con il modello scelto nelle Impostazioni. Riprova, o prova con un altro modello.';
    }

    // Errore HTTP nudo, senza marcatore di provider AI: se la chat interroga anche un archivio
    // esterno, quasi sempre è lui.
    const status = Number(e && e.status);
    if (Number.isFinite(status) && status > 0) {
      const src = String(o.dataSource || '').trim();
      if (src) {
        return status >= 500 || status === 429
          ? `${src} al momento non risponde. Riprova tra qualche minuto.`
          : `${src} ha rifiutato la ricerca. Riprova riformulando la richiesta con parole diverse.`;
      }
      return status >= 500 || status === 429
        ? 'il servizio non risponde al momento. Riprova tra qualche minuto.'
        : 'la richiesta non è stata accettata. Riprova riformulandola con parole diverse.';
    }

    // Ogni altro errore è tecnico e non aiuterebbe: frase generica in chat, dettaglio nei log.
    return 'qualcosa è andato storto. Riprova.';
  }

  function sentence(e, opts) {
    const s = friendly(e, opts);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  global.SN_CHAT_ERRORS = { friendly, sentence, isTransientNetwork };

})(typeof globalThis !== 'undefined' ? globalThis : self);
