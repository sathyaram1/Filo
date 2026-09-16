// Pagina d'errore di rete (filo://error/): fonte unica per costruire e leggere il suo URL,
// tradurre il codice Chromium in un messaggio italiano e decidere quali fallimenti la
// meritano. La usano il main (tabs.js) e la pagina stessa.

(function (global) {
  'use strict';

  const ERROR_PAGE_URL = 'filo://error/error.html';

  // Codice speciale non-Chromium per il renderer morto (render-process-gone): non è un
  // errore di rete, ma la scheda resta bianca allo stesso modo.
  const CRASH_CODE = 'crash';

  // Schemi che il «Riprova» può ri-tentare. Mai altro: il bersaglio arriva dalla query
  // string e NON va navigato alla cieca (filo://error?url=javascript:… non deve eseguire nulla).
  function isRetriableTarget(url) {
    let proto = '';
    try { proto = new URL(String(url || '')).protocol.toLowerCase(); } catch (_) { return false; }
    return proto === 'http:' || proto === 'https:' || proto === 'filo:';
  }

  function isErrorPageUrl(url) {
    return String(url || '').startsWith(ERROR_PAGE_URL);
  }

  // `code`: codice errore Chromium (negativo) o CRASH_CODE; `desc`: la descrizione
  // simbolica (es. ERR_NAME_NOT_RESOLVED) o il motivo del crash.
  function buildUrl(targetUrl, code, desc) {
    const params = new URLSearchParams();
    params.set('url', String(targetUrl || ''));
    params.set('code', String(code == null ? '' : code));
    if (desc) params.set('desc', String(desc));
    return `${ERROR_PAGE_URL}?${params.toString()}`;
  }

  // `target` è null se assente o non ri-tentabile (schema non-web): mai restituire
  // bersagli non navigabili.
  function parse(url) {
    if (!isErrorPageUrl(url)) return null;
    let params;
    try { params = new URL(String(url)).searchParams; } catch (_) { return null; }
    const rawTarget = params.get('url') || '';
    return {
      target: isRetriableTarget(rawTarget) ? rawTarget : null,
      code: params.get('code') || '',
      desc: params.get('desc') || '',
    };
  }

  // Serve a tenere la scheda, per l'utente, sull'URL fallito (barra, sessione, ricarica),
  // come fanno gli altri browser.
  function targetOf(url) {
    const p = parse(url);
    return (p && p.target) || null;
  }

  // -3 (ERR_ABORTED) no: navigazione annullata (stop, redirect, _recreateView) non è un
  // errore da mostrare. La pagina d'errore stessa no, per non entrare in loop.
  // Solo main frame (lo passa il chiamante).
  function shouldShowErrorPage({ code, failedUrl, isMainFrame }) {
    if (isMainFrame === false) return false;
    const n = Number(code);
    if (!Number.isFinite(n) || n === 0 || n === -3) return false;
    const u = String(failedUrl || '');
    if (!u) return false;
    if (isErrorPageUrl(u)) return false;
    return isRetriableTarget(u);
  }

  // `offline: true` marca gli errori «sei senza rete»: la pagina si ri-tenta da sola
  // quando la connessione torna (evento `online`).
  const KNOWN = {
    '-105': { title: 'Impossibile trovare questo sito', hint: 'Controlla che l’indirizzo sia scritto correttamente: potrebbe esserci un refuso nel nome del sito.' }, // ERR_NAME_NOT_RESOLVED
    '-137': { title: 'Impossibile trovare questo sito', hint: 'La ricerca del nome del sito è fallita. Controlla l’indirizzo e la connessione.' }, // ERR_NAME_RESOLUTION_FAILED
    '-106': { title: 'Sei offline', hint: 'Controlla la connessione a Internet: la pagina si ricaricherà da sola appena torni in rete.', offline: true }, // ERR_INTERNET_DISCONNECTED
    '-102': { title: 'Il sito ha rifiutato la connessione', hint: 'Il server esiste ma non accetta la connessione: potrebbe essere spento o non ancora avviato.' }, // ERR_CONNECTION_REFUSED
    '-104': { title: 'Impossibile collegarsi al sito', hint: 'La connessione al server non è riuscita. Riprova tra qualche istante.' }, // ERR_CONNECTION_FAILED
    '-100': { title: 'La connessione si è interrotta', hint: 'Il collegamento con il sito si è chiuso prima che la pagina arrivasse. Riprova.' }, // ERR_CONNECTION_CLOSED
    '-101': { title: 'La connessione si è interrotta', hint: 'Il collegamento con il sito si è azzerato durante il caricamento. Riprova.' }, // ERR_CONNECTION_RESET
    '-109': { title: 'Sito non raggiungibile', hint: 'L’indirizzo del server non è raggiungibile dalla tua rete.' }, // ERR_ADDRESS_UNREACHABLE
    '-118': { title: 'Il sito non risponde', hint: 'Il server ci sta mettendo troppo a rispondere: potrebbe essere sovraccarico, oppure la tua connessione è lenta.' }, // ERR_CONNECTION_TIMED_OUT
    '-7':   { title: 'Il sito non risponde', hint: 'Il caricamento ha superato il tempo massimo. Riprova.' }, // ERR_TIMED_OUT
    '-21':  { title: 'La rete è cambiata', hint: 'La connessione è cambiata durante il caricamento (es. da Wi-Fi a cavo). Riprova.' }, // ERR_NETWORK_CHANGED
    '-130': { title: 'Il proxy non risponde', hint: 'La scheda passa da un proxy che non è raggiungibile. Riprova, o togli l’instradamento da un altro paese.' }, // ERR_PROXY_CONNECTION_FAILED
    '-111': { title: 'Impossibile raggiungere il sito', hint: 'La connessione attraverso il proxy non è riuscita: il sito potrebbe non esistere o non essere raggiungibile in questo momento.' }, // ERR_TUNNEL_CONNECTION_FAILED
    '-20':  { title: 'Pagina bloccata', hint: 'Il caricamento è stato bloccato da una protezione attiva (es. blocco contenuti).' }, // ERR_BLOCKED_BY_CLIENT
    '-501': { title: 'Connessione non sicura', hint: 'Il sito ha risposto in modo non sicuro e il caricamento è stato interrotto per proteggerti.' }, // ERR_INSECURE_RESPONSE
    '-324': { title: 'Il sito non ha risposto', hint: 'Il server ha chiuso la connessione senza inviare dati. Riprova.' }, // ERR_EMPTY_RESPONSE
  };

  const CRASH_INFO = {
    title: 'Questa scheda si è bloccata',
    hint: 'Qualcosa è andato storto mentre la pagina era aperta. Ricaricala per continuare.',
  };

  const DEFAULT_INFO = {
    title: 'Impossibile caricare la pagina',
    hint: 'Il caricamento non è riuscito. Controlla la connessione e riprova.',
  };

  // `desc` resta il dettaglio tecnico che la pagina mostra in piccolo.
  function describe(code, desc) {
    if (String(code) === CRASH_CODE) return { ...CRASH_INFO, offline: false };
    const known = KNOWN[String(code)];
    if (known) return { title: known.title, hint: known.hint, offline: !!known.offline };
    // Ripiego sulla descrizione simbolica quando il codice non è mappato ma la famiglia
    // si riconosce dal nome.
    const d = String(desc || '');
    if (/NAME_NOT_RESOLVED|NAME_RESOLUTION/.test(d)) return { ...KNOWN['-105'], offline: false };
    if (/INTERNET_DISCONNECTED/.test(d)) return { ...KNOWN['-106'] };
    if (/TIMED_OUT/.test(d)) return { ...KNOWN['-118'], offline: false };
    if (/CONNECTION_REFUSED/.test(d)) return { ...KNOWN['-102'], offline: false };
    return { ...DEFAULT_INFO, offline: false };
  }

  global.SN_NET_ERROR = {
    ERROR_PAGE_URL,
    CRASH_CODE,
    isErrorPageUrl,
    isRetriableTarget,
    buildUrl,
    parse,
    targetOf,
    shouldShowErrorPage,
    describe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
