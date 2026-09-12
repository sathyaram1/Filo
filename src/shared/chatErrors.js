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
//     → PROPOSIZIONE con iniziale minuscola, pensata per essere incastonata in
//       una frase ("Non ha funzionato: <…>"), come fa la chat dei mazzi.
//   SN_CHAT_ERRORS.sentence(err, { dataSource })
//     → la stessa cosa come FRASE A SÉ (iniziale maiuscola), per chi mostra
//       l'errore da solo nella bolla, come la chat della home.
//
//   `dataSource` è il nome (per l'utente) dell'archivio esterno che quella chat
//   interroga oltre al servizio AI, es. { dataSource: 'Scryfall (l\'archivio
//   delle carte)' }. Serve per attribuire correttamente un errore HTTP "nudo"
//   (senza marcatore di provider AI). Se la chat non interroga nient'altro,
//   ometti l'opzione: l'errore diventa una frase generica.
//
//   SN_CHAT_ERRORS.actionFailure(output) → motivo breve del fallimento di
//     un'azione di Filo ('sito bloccato: x', 'indirizzo non valido', …), '' se
//     il motivo non si sa. Una sola volta per TUTTE le chat (#590).
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
  // Nota: "failed to fetch" (con TO) è la forma che lancia il `fetch` del
  // renderer Chromium quando non c'è rete (le pagine filo://). Il `fetch` di
  // Node/undici nel main dice invece "fetch failed": qui matchiamo entrambe, così
  // un guasto di rete è classificato come tale a prescindere dal processo.
  const TRANSIENT_NETWORK_RE =
    /fetch failed|failed to fetch|load failed|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed|timed out|timeout/i;

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
    // Annullato da noi (l'utente ha cambiato pagina, nuovo invio): non è un
    // guasto, e ritentare sarebbe sbagliato.
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return false;
    // Un errore con status HTTP è una RISPOSTA del server: non è un guasto di
    // rete, ritentarlo alla cieca non serve.
    if (Number(e.status) > 0) return false;
    const code = String(e.code || (e.cause && e.cause.code) || '');
    if (code && TRANSIENT_NETWORK_RE.test(code)) return true;
    return TRANSIENT_NETWORK_RE.test(messageOf(e));
  }

  // Errore → proposizione per l'utente. Mai un codice HTTP nudo, mai un nome di
  // endpoint: gli errori con `code` applicativo (NO_API_KEY, LIMIT_REACHED,
  // NO_MODEL_FOR_ACTION) portano già un messaggio i18n scritto per l'utente —
  // dicono anche dove si rimedia — e passano invariati.
  function friendly(e, opts) {
    const o = opts || {};
    const raw = String((e && e.message) || (typeof e === 'string' ? e : ''));
    if (e && (e.code === 'NO_API_KEY' || e.code === 'LIMIT_REACHED' || e.code === 'NO_MODEL_FOR_ACTION')) return raw;

    // Guasto di rete: la prima cosa da controllare è la connessione. Va PRIMA
    // dell'analisi HTTP perché qui non c'è nessuna risposta da interpretare.
    if (isTransientNetwork(e)) {
      return 'problema di rete: non sono riuscito a raggiungere il servizio. Controlla la connessione e riprova.';
    }

    // Errore del SERVIZIO AI (il modello): riconosciuto dal marcatore
    // strutturato che i provider attaccano ai loro errori HTTP (err.provider)
    // o — rete di sicurezza per errori non marcati — dalla forma del messaggio
    // ("OpenRouter 400: …", "Gemini 503: …").
    const pm = /^(OpenRouter|Gemini)(?:\s+\S+)?\s+(\d{3})\b/.exec(raw);
    if ((e && e.provider) || pm) {
      const st = Number(e && e.status) || (pm ? Number(pm[2]) : 0);
      // Il router non ha trovato un host che accetti gli strumenti (tool
      // calling) per il modello scelto: la chat della home non funziona senza.
      // Non è un guasto passeggero, è una scelta di modello da cambiare.
      if (/tool/i.test(raw) && (st === 404 || st === 400)) {
        return 'il modello scelto nelle Impostazioni non sa usare gli strumenti (cercare, leggere, impostare): la chat di Filo ne ha bisogno. Scegli un altro modello in Modelli predefiniti.';
      }
      if (st === 401 || st === 403) {
        return 'il servizio AI ha rifiutato la chiave API: controlla che sia giusta (e ancora valida) nelle Impostazioni.';
      }
      // 402 (#598): il tetto della chiave è esaurito. Con la chiave personale
      // di Filo sono i crediti finiti; con una chiave propria è il conto
      // OpenRouter dell'utente. Non si ritenta: OpenRouter rifiuta finché il
      // tetto non sale (i crediti del giorno dopo, o una ricarica).
      if (st === 402) {
        return 'i crediti sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nelle Impostazioni. Se usi già una chiave tua, è il suo credito a essere esaurito.';
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
        ? 'il servizio non risponde al momento. Riprova tra qualche minuto.'
        : 'la richiesta non è stata accettata. Riprova riformulandola con parole diverse.';
    }

    // Qualsiasi altro errore è tecnico e non aiuterebbe l'utente: frase
    // generica in chat, dettaglio nei log.
    return 'qualcosa è andato storto. Riprova.';
  }

  // Frase a sé stante: la proposizione con l'iniziale maiuscola. Per chi mostra
  // l'errore da solo nella bolla (chat della home) invece di incastonarlo.
  function sentence(e, opts) {
    const s = friendly(e, opts);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Perché un'azione di Filo NON è riuscita, in due o tre parole (#590).
  //
  // Il main sa già il motivo e lo manda insieme all'esito; a raccontarlo però
  // erano due chat diverse, e una sola ce la faceva: la chat della home diceva
  // "sito bloccato: <nome>", quella che si apre sopra una pagina qualsiasi
  // diceva solo "non riuscita". Due strade equivalenti che raccontano la stessa
  // cosa in modo diverso: il motivo si chiede qui, una volta sola.
  //
  // Torna '' quando il motivo non si sa: chi chiama mostra la sua frase
  // generica ("non riuscita") senza aggiungere niente.
  function actionFailure(output) {
    const o = output;
    if (!o || typeof o !== 'object') return '';
    if (o.blocked === 'scheme') return 'indirizzo non ammesso';
    // La lista dei siti bloccati ha fermato un'apertura. Dirlo, col sito: un
    // blocco muto sembra un guasto (#482).
    // Il nome del sito come l'utente lo scriverebbe (#590): un indirizzo in
    // cirillico o in giapponese viaggia come "xn--80aswg.xn--p1ai", e la
    // notifica in basso a destra lo chiama già col suo nome. Due posti che
    // nominano lo stesso sito nello stesso istante devono chiamarlo uguale.
    if (o.blocked === 'site') {
      if (!o.host) return 'sito bloccato';
      const NAV = globalThis.SN_URL_NAV;
      const nome = (NAV && NAV.hostLeggibile && NAV.hostLeggibile(o.host)) || o.host;
      return `sito bloccato: ${nome}`;
    }
    if (o.blocked === 'address') return 'indirizzo non valido';
    if (o.restyle === 'no-page') return 'nessuna pagina web aperta';
    if (o.found === false) return 'non trovato';
    if (o.ok === false && o.detail) return String(o.detail);
    if (o.error) return String(o.error);
    return '';
  }

  global.SN_CHAT_ERRORS = { friendly, sentence, isTransientNetwork, actionFailure };

})(typeof globalThis !== 'undefined' ? globalThis : self);
