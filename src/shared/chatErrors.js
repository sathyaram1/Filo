// Errore tecnico → frase per l'utente, in chat (#331, #360).
//
// PERCHÉ ESISTE
//   Una chat non è un log. Quando una chiamata fallisce, il messaggio grezzo
//   dell'eccezione ("fetch failed", "OpenRouter 400: …", "ETIMEDOUT") non dice
//   NIENTE all'utente: gli va mostrata una frase che spiega cosa non ha
//   funzionato e cosa può fare, mentre il dettaglio tecnico resta nei log del
//   main. La logica era nata dentro la chat dei mazzi (#331) e la chat della
//   home continuava a mostrare "fetch failed" nudo (#360): ora vive qui, una
//   sola volta, per tutte le chat.
//
// API
//   SN_CHAT_ERRORS.friendly(err, { dataSource })
//     → stringa pronta da mostrare in chat.
//   `dataSource` è il nome (per l'utente) dell'archivio esterno che quella chat
//   interroga oltre al servizio AI, es. { dataSource: 'Scryfall (l\'archivio
//   delle carte)' }. Serve per attribuire correttamente un errore HTTP "nudo"
//   (senza marcatore di provider AI). Se la chat non interroga nient'altro,
//   ometti l'opzione: l'errore diventa una frase generica.
//
//   SN_CHAT_ERRORS.isTransientNetwork(err) → bool
//     Vero per i guasti di rete PASSEGGERI (connessione caduta, DNS, timeout,
//     socket chiusa): quelli per cui vale la pena riprovare da soli.
//
// Logica PURA: niente I/O, niente Electron → unit-testabile.

(function (global) {
  'use strict';

  // Guasti di rete passeggeri: nessuna risposta HTTP è mai arrivata, quindi
  // ritentare la stessa chiamata ha senso (a differenza di un 400, che
  // ritornerebbe identico).
  const TRANSIENT_NETWORK_RE =
    /fetch failed|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|ETIMEOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed|terminated|timed? ?out|timeout/i;

  function messageOf(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    // Un errore di rete di undici/Node porta spesso il vero motivo nella
    // `cause` ("fetch failed" ← "ENOTFOUND"): guardiamo anche lì.
    const own = String(e.message || '');
    const causeMsg = e.cause ? String(e.cause.message || e.cause.code || e.cause) : '';
    return causeMsg ? `${own} ${causeMsg}` : own;
  }

  function isTransientNetwork(e) {
    if (!e) return false;
    // Un errore con status HTTP è una RISPOSTA del server: non è un guasto di
    // rete, ritentarlo alla cieca non serve.
    if (Number(e.status) > 0) return false;
    const code = String(e.code || (e.cause && e.cause.code) || '');
    if (code && TRANSIENT_NETWORK_RE.test(code)) return true;
    if (e.name === 'AbortError') return false; // annullato da noi: mai ritentare
    return TRANSIENT_NETWORK_RE.test(messageOf(e));
  }

  // Errore → frase per l'utente. Mai un codice HTTP nudo, mai un nome di
  // endpoint: gli errori con `code` applicativo (NO_API_KEY, LIMIT_REACHED)
  // portano già un messaggio i18n scritto per l'utente e passano invariati.
  function friendly(e, opts) {
    const o = opts || {};
    const raw = String((e && e.message) || (typeof e === 'string' ? e : ''));
    if (e && (e.code === 'NO_API_KEY' || e.code === 'LIMIT_REACHED')) return raw;

    // Guasto di rete: la prima cosa da controllare è la connessione. Va PRIMA
    // dell'analisi HTTP perché qui non c'è nessuna risposta da interpretare.
    if (isTransientNetwork(e)) {
      return 'Problema di rete: non sono riuscito a raggiungere il servizio. Controlla la connessione e riprova.';
    }

    // Errore del SERVIZIO AI (il modello): riconosciuto dal marcatore
    // strutturato che i provider attaccano ai loro errori HTTP (err.provider)
    // o — rete di sicurezza per errori non marcati — dalla forma del messaggio
    // ("OpenRouter 400: …", "Gemini 503: …").
    const pm = /^(OpenRouter|Gemini)(?:\s+\S+)?\s+(\d{3})\b/.exec(raw);
    if ((e && e.provider) || pm) {
      const st = Number(e && e.status) || (pm ? Number(pm[2]) : 0);
      if (st === 401 || st === 403) {
        return 'il servizio AI ha rifiutato la chiave API: controlla che sia giusta (e ancora valida) nelle Impostazioni.';
      }
      if (st === 429 || st >= 500) {
        return 'il servizio AI è momentaneamente sovraccarico o non disponibile. Riprova tra qualche minuto.';
      }
      return 'il servizio AI non è riuscito a rispondere: potrebbe esserci un problema con il modello scelto nelle Impostazioni. Riprova, o prova con un altro modello.';
    }

    // Errore HTTP "nudo" (nessun marcatore di provider AI): se la chat
    // interroga anche un archivio esterno, è (quasi sempre) lui.
    const status = Number(e && e.status);
    if (Number.isFinite(status) && status > 0) {
      const src = String(o.dataSource || '').trim();
      if (src) {
        return status >= 500 || status === 429
          ? `${src} al momento non risponde. Riprova tra qualche minuto.`
          : `${src} ha rifiutato la ricerca. Riprova riformulando la richiesta con parole diverse.`;
      }
      return status >= 500 || status === 429
        ? 'Il servizio non risponde al momento. Riprova tra qualche minuto.'
        : 'La richiesta non è stata accettata. Riprova riformulandola con parole diverse.';
    }

    // Qualsiasi altro errore è tecnico e non aiuterebbe l'utente: frase
    // generica in chat, dettaglio nei log.
    return 'Qualcosa è andato storto. Riprova.';
  }

  global.SN_CHAT_ERRORS = { friendly, isTransientNetwork };

})(typeof globalThis !== 'undefined' ? globalThis : self);
