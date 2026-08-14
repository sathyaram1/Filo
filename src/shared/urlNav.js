// SORGENTE UNICA della navigazione "testo → indirizzo" di Filo.
//
// Due domande, un solo posto:
//   1. `looksLikeAddress(raw)` — questo token è un INDIRIZZO da aprire, o un
//      testo/comando? Usata dal campo comando della dashboard (dopo la "/") per
//      colorare l'input e per decidere se navigare invece di mandare all'LLM.
//   2. `normalizeUrl(input)` — dato un indirizzo, qual è l'URL navigabile, con
//      lo schema giusto (http per i server locali/loopback e gli IP privati,
//      https per i domini pubblici)?
//
// PERCHÉ QUI (#398): la logica corretta viveva SOLO in src/main/tabs.js ed era
// raggiungibile solo dalla barra indirizzi della shell (oggi nascosta). Il campo
// "nuova scheda" aveva una copia PIÙ POVERA (pretendeva un TLD alfabetico) che
// scartava localhost, gli IP e i nomi locali: li mandava all'LLM invece di
// aprirli. Mettendo la logica in un modulo condiviso, dashboard e main usano la
// STESSA regola e la simmetria non può più divergere.
//
// La distinzione indirizzo-vs-comando DEVE restare stretta: nel campo "/" un
// `git log v1.2` o `python3.11` NON è un indirizzo. Per questo `looksLikeAddress`
// è più severa della sola condizione di `normalizeUrl` (che opera sulla barra
// indirizzi, dove l'ambiguità coi comandi shell non esiste).

(function (global) {
  'use strict';

  // #433 — SUFFISSI DELLE RETI DOMESTICHE. Nomi come nas.lan, raspberrypi.local
  // o stampante.home esistono SOLO dentro la rete di casa: li assegna il router
  // (o mDNS), non il DNS pubblico. Chiederli al resolver pubblico dà ENOTFOUND
  // anche quando il dispositivo è lì e risponde — per questo vanno trattati come
  // localhost e gli IP privati (schema http, niente controllo esistenza).
  //   • local            → mDNS/Bonjour (RFC 6762) — raspberrypi.local
  //   • home.arpa        → nome ufficiale delle reti domestiche (RFC 8375)
  //   • internal         → riservato da ICANN all'uso privato (2024)
  //   • home/corp        → richiesti come gTLD e RIFIUTATI da ICANN proprio
  //                        perché già usati ovunque nelle reti private
  //   • lan/intranet/…   → mai delegati, e assegnati di fatto dai router
  //   • box              → UNICA ECCEZIONE: è un gTLD pubblico davvero
  //                        esistente. Sta qui perché fritz.box è l'indirizzo
  //                        predefinito dei router FRITZ!Box (diffusissimi) e
  //                        quello è il caso reale; il prezzo è che un sito
  //                        pubblico .box si aprirebbe in http invece che https.
  const LOCAL_NET_TLDS = new Set([
    'local', 'lan', 'home', 'internal', 'intranet', 'private', 'box',
    'homenet', 'localdomain', 'corp',
  ]);

  // Vero se l'host è un nome della rete locale (vedi sopra). Un'etichetta sola
  // senza punto ("lan") NON lo è: è un token qualsiasi, non un indirizzo.
  function isLocalNetworkName(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || !h.includes('.')) return false;
    if (h === 'home.arpa' || h.endsWith('.home.arpa')) return true;
    return LOCAL_NET_TLDS.has(h.slice(h.lastIndexOf('.') + 1));
  }

  // Host che parlano quasi sempre in chiaro (server di sviluppo locali,
  // router/IoT su IP privato, dispositivi della rete di casa): loopback,
  // *.localhost, gli IP privati e i nomi con un suffisso di rete locale
  // (nas.lan, raspberrypi.local). Per questi lo schema di default è http://
  // invece di https://. Accetta anche la forma IPv6 tra parentesi ([::1]).
  function isLocalHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (isLocalNetworkName(h)) return true;
    if (h === '::1' || h.startsWith('::ffff:127.')) return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;       // loopback
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;         // privato /8
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;           // privato /16
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true; // privato /12
    return false;
  }

  // IPv4 dotted-quad con ottetti in range (0-255). Serve a distinguere un IP
  // letterale (127.0.0.1, 192.168.1.1) da un dominio con "TLD" numerico o da un
  // token qualsiasi con dei punti: solo un vero IPv4 conta come indirizzo.
  function isIpv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''));
    if (!m) return false;
    return m.slice(1, 5).every((o) => Number(o) <= 255);
  }

  // Trasforma input dell'utente in un URL navigabile:
  //   - se ha uno schema esplicito → naviga così com'è;
  //   - se sembra un indirizzo (dominio con punto, host locale noto, o host
  //     seguito da ":porta") → naviga, scegliendo http per gli host locali e
  //     https altrimenti;
  //   - altrimenti → ricerca Google.
  // La parte ":porta" è il motivo del fix #233: prima ogni "host:porta"
  // (localhost:3000, 127.0.0.1:8080, example.com:8443/admin) cadeva in ricerca.
  function normalizeUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return 'filo://newtab/';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('filo://')) return raw;

    // Isola la parte host[:porta] = tutto prima del primo separatore di path/query
    // (/, ?, #). Uno spazio interno significa "non è un indirizzo" → ricerca.
    const hostPart = raw.split(/[/?#]/, 1)[0];
    const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(hostPart);
    if (m) {
      const host = m[1];
      const port = m[2] ? Number(m[2]) : null;
      const bracketed = host.startsWith('[');
      const hasDot = !bracketed && host.includes('.');
      const local = isLocalHost(host);
      const validPort = port === null || (port >= 1 && port <= 65535);
      // Naviga se: dominio con punto, host locale noto, oppure host + ":porta"
      // (segnale forte che è un indirizzo, non una ricerca). Una porta fuori range
      // (>65535) non è un indirizzo valido → resta ricerca.
      if (validPort && (hasDot || local || port !== null)) {
        // http per gli host locali/loopback e per gli host a etichetta singola
        // (senza punto e non IPv6, tipicamente intranet/dev che parlano in
        // chiaro); https per i domini pubblici e gli IP letterali.
        const scheme = (local || (!hasDot && !bracketed)) ? 'http://' : 'https://';
        return scheme + raw;
      }
    }
    return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
  }

  // Il token digitato (SENZA la "/" iniziale) è un indirizzo da aprire?
  // Stretta di proposito: deve distinguere un indirizzo da un comando shell.
  //   - niente spazi;
  //   - path locali (./x, .\x, ~/x, /usr) → NO (li esegue la shell);
  //   - http(s):// esplicito → sì;
  //   - altrimenti host[:porta] con: porta esplicita valida (segnale forte),
  //     IPv6 letterale, localhost/*.localhost, IP privato, IPv4 letterale,
  //     oppure dominio con TLD alfabetico (regola storica).
  // Un host a etichetta singola SENZA porta (git, python3.11) NON è un indirizzo:
  // resta un comando/testo.
  function looksLikeAddress(raw) {
    const s = String(raw || '');
    if (!s || /\s/.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return true;
    if (/^[.\\/~]/.test(s)) return false; // ./script, .\script, ~/x, /usr
    const hostPart = s.split(/[/?#]/, 1)[0];
    const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(hostPart);
    if (!m) return false;
    const host = m[1];
    const port = m[2] ? Number(m[2]) : null;
    if (port !== null) return port >= 1 && port <= 65535; // host:porta valida
    if (host.startsWith('[')) return true;                // IPv6 letterale [::1]
    if (isLocalHost(host)) return true;                   // localhost / *.localhost / IP privato
    if (isIpv4(host)) return true;                        // IP pubblico letterale
    return /\.[a-z]{2,}$/i.test(host);                    // dominio con TLD alfabetico
  }

  // #437 — SCHEMI CHE NON SONO INDIRIZZI: non puntano da nessuna parte fuori
  // dal documento in cui sono nati, quindi copiarli o condividerli consegna
  // all'utente una stringa che altrove non apre niente.
  //   javascript:/vbscript: → è codice, non una destinazione;
  //   data:                 → è il contenuto stesso, scritto per esteso;
  //   blob:/filesystem:     → esistono solo dentro quel documento e muoiono con lui;
  //   about:                → uno stato interno del browser (about:blank).
  const NON_ADDRESS_SCHEMES = new Set([
    'javascript:', 'vbscript:', 'data:', 'blob:', 'filesystem:', 'about:',
  ]);

  // Questa stringa è un INDIRIZZO che ha senso mettere negli appunti, mandare a
  // qualcuno o riaprire altrove? Serve alle azioni "Copia URL"/"Condividi" del
  // menu contestuale (#437): la sorgente di un'immagine o di un filmato può
  // essere qualsiasi cosa il sito ci abbia messo — un frammento di codice, un
  // data: lungo un chilometro, o niente affatto un URL.
  // Nota: gli href/src letti dal DOM sono già risolti in forma assoluta, quindi
  // ciò che qui non si lascia analizzare non era un indirizzo nemmeno per la
  // pagina che lo conteneva.
  function isShareableAddress(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    let proto = '';
    try { proto = new URL(s).protocol.toLowerCase(); } catch (_) { return false; }
    if (!proto) return false;
    return !NON_ADDRESS_SCHEMES.has(proto);
  }

  // #252 — INDIRIZZO CANONICO di una pagina interna filo://.
  // Storicamente il codice portato dall'estensione apriva le pagine interne con
  // `chrome.runtime.getURL('src/pages/<page>/<file>')`, che lo shim traduce in
  // `filo://src/pages/<page>/<file>`; il menu App/Impostazioni invece usa la
  // forma corta `filo://<page>/<file>`. Due indirizzi DIVERSI per la STESSA
  // pagina (entrambi serviti dal protocollo — vedi il ramo host 'src' in
  // protocol.js): la stessa lista si apriva con due URL a seconda di dove
  // cliccavi. Qui riportiamo la forma legacy a quella corta, così esiste UN
  // solo indirizzo per pagina (e la deduplica delle schede può confrontarli).
  // Query e hash sono preservati (es. filo://home/home.html?highlight=…).
  function canonicalizeFiloUrl(input) {
    const raw = String(input || '');
    if (!raw.startsWith('filo://')) return raw;
    let u;
    try { u = new URL(raw); } catch (_) { return raw; }
    if (u.hostname === 'src') {
      const m = /^\/pages\/([^/]+)\/(.*)$/.exec(u.pathname);
      if (m) return `filo://${m[1]}/${m[2]}${u.search}${u.hash}`;
    }
    return raw;
  }

  global.SN_URL_NAV = {
    isLocalHost, isLocalNetworkName, isIpv4, normalizeUrl, looksLikeAddress,
    canonicalizeFiloUrl, isShareableAddress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
