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
//   SN_CHAT_ERRORS.fromResponse(res, fallback)
//     → la risposta d'errore dell'IPC ({ error, code, status }) ricomposta in un
//       Error che le due funzioni qui sopra sanno leggere.
//
//   SN_CHAT_ERRORS.isTransientNetwork(err) → bool
//     Vero per i guasti di rete PASSEGGERI (connessione caduta, DNS, timeout,
//     socket chiusa): quelli per cui vale la pena riprovare da soli.
//
//   SN_CHAT_ERRORS.rimedio(code) → 'crediti' | 'opzioni' | ''
//     La pagina dove l'utente può togliere l'ostacolo, per chi affianca un
//     collegamento al «Riprova» (che su questi codici non porta da nessuna
//     parte finché non si cambia qualcosa).
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

  // I codici il cui messaggio è GIÀ scritto per l'utente e dice dove si
  // rimedia: passano invariati. La lista sta qui una volta sola e una
  // sentinella la confronta con gli errori che il main solleva, perché un
  // codice nuovo dimenticato qui diventa «qualcosa è andato storto» (#663).
  const CODICI_GIA_SCRITTI = [
    'NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL',
    'FEEDBACK_READ_DENIED',
  ];

  // Dove si rimedia, per chi mostra l'errore: «Riprova» da solo, su questi
  // codici, è un vicolo cieco (la risposta sarà identica finché non si cambia
  // qualcosa), quindi accanto ci va il collegamento al posto giusto.
  const RIMEDIO = {
    NO_API_KEY: 'crediti',
    NO_MODEL_FOR_ACTION: 'opzioni',
    NO_OPEN_WEIGHTS_MODEL: 'opzioni',
    LIMIT_REACHED: 'opzioni',
  };
  function rimedio(code) { return RIMEDIO[String(code || '')] || ''; }

  // La pagina che toglie l'ostacolo, già pronta da mostrare. Sta qui e non in
  // ogni superficie perché una frase che nomina una pagina e non ci porta è
  // muta per chi la legge da un sito qualunque (#663).
  const RIMEDIO_PAGINE = {
    crediti: { url: 'filo://credits/credits.html', label: 'Apri Crediti' },
    opzioni: { url: 'filo://options/options.html', label: 'Apri Opzioni' },
  };
  function rimedioPagina(code) {
    const dove = rimedio(code);
    return dove ? { dove, ...RIMEDIO_PAGINE[dove] } : null;
  }

  // Chi mostra un errore venuto dall'IPC lo ricompone da qui: un `new Error`
  // a mano perde il codice, e la frase già scritta torna generica (#663).
  function fromResponse(res, fallbackMessage) {
    const e = new Error(String((res && res.error) || fallbackMessage || ''));
    if (res && res.code && res.code !== 'UNKNOWN') e.code = res.code;
    if (res && Number(res.status) > 0) e.status = Number(res.status);
    if (res && res.provider) e.provider = res.provider;
    // La frase che il main ha già scritto sapendo quale chiave ha pagato e
    // quanti crediti arrivano domani: vale più di qualsiasi ricostruzione.
    if (res && typeof res.userMessage === 'string' && res.userMessage) e.userMessage = res.userMessage;
    return e;
  }

  // Errore → proposizione per l'utente. Mai un codice HTTP nudo, mai un nome di
  // endpoint.
  function friendly(e, opts) {
    const o = opts || {};
    const raw = String((e && e.message) || (typeof e === 'string' ? e : ''));
    if (e && CODICI_GIA_SCRITTI.includes(e.code)) return raw;

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
      // Chiave rifiutata (#629): se c'era un portafoglio, il ripiego sui
      // crediti di Filo è già scattato prima di arrivare qui; se l'errore
      // arriva in chat, di portafoglio non ce n'è, e la strada è la pagina
      // Crediti (dove la chiave si mette, si vede e si toglie).
      // Un 403 di moderazione non è la chiave: è il testo della richiesta,
      // che il modello scelto fa passare da una moderazione (secondo giro di
      // verifica del ramo: dava la colpa alla chiave, che era a posto).
      const W = globalThis.SN_WALLET;
      if (st === 403 && W && W.isModerationBlock(raw)) {
        return 'OpenRouter ha bloccato questa richiesta per la moderazione dei contenuti (la tua chiave è a posto): cambia il testo, o scegli un modello senza moderazione in Modelli predefiniti.';
      }
      if (st === 401 || st === 403) {
        return 'il servizio AI ha rifiutato la tua chiave API: controlla che sia giusta (e ancora valida) nella pagina Crediti.';
      }
      // 402 (#598): il tetto della chiave è esaurito. Con la chiave personale
      // di Filo sono i crediti finiti; con una chiave propria è il conto
      // OpenRouter dell'utente. Non si ritenta: OpenRouter rifiuta finché il
      // tetto non sale (i crediti del giorno dopo, o una ricarica).
      // Chi tiene le chiavi (nel main) sa quale chiave è stata rifiutata, se
      // c'era un portafoglio e quanti crediti arrivano domani, e lascia la
      // frase già scritta sull'errore (userMessage). Senza, si ragiona con
      // quello che l'errore porta: la chiave con cui si era partiti e se il
      // ripiego sulla personale c'è stato e ha fallito (#629).
      if (st === 402) {
        if (e && typeof e.userMessage === 'string' && e.userMessage) return e.userMessage;
        const src = e && e.keySource;
        const fb = e && e.keyFallback;
        if (fb && fb.failed) {
          return 'OpenRouter ha rifiutato la tua chiave (il suo credito è finito) e anche i crediti di Filo sono finiti: ricarica il tuo conto OpenRouter, oppure aspetta i crediti di domani.';
        }
        if (src === 'own') {
          return 'la tua chiave OpenRouter non ha più credito: ricarica il tuo conto OpenRouter, oppure riscatta un invito nella pagina Crediti per usare i crediti di Filo.';
        }
        if (src === 'personal') {
          return 'i crediti di Filo sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nella pagina Crediti.';
        }
        return 'i crediti sono finiti: puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nella pagina Crediti. Se usi già una chiave tua, è il suo credito a essere esaurito.';
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

  global.SN_CHAT_ERRORS = { friendly, sentence, fromResponse, isTransientNetwork, rimedio, CODICI_GIA_SCRITTI };

})(typeof globalThis !== 'undefined' ? globalThis : self);
