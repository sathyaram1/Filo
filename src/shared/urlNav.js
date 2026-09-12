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

  // #590 — UN NOME DI SITO CHE SI PUÒ METTERE IN UNA LISTA (siti bloccati, siti
  // fidati). Deve avere un'estensione vera: "facebook" o un indirizzo numerico
  // non sono nomi di sito, e accettarli darebbe una falsa sicurezza (in lista
  // resterebbe una voce che non ferma niente).
  //
  // L'estensione può anche NON essere in caratteri latini. .рф, .中国, .テスト,
  // .укр e le altre esistono davvero e sul filo viaggiano nella forma punycode
  // "xn--…", che è quella che arriva qui da un URL già analizzato. La vecchia
  // regola pretendeva solo lettere latine, quindi un sito russo o giapponese non
  // si poteva mettere in lista per niente: la voce spariva e il sito si apriva.
  //
  // La regola sta qui, in un posto solo, perché la usano sia il controllo vero
  // (nel motore di Filo) sia il campo delle Preferenze che avvisa quando una
  // riga viene scartata. Quando divergevano, le Preferenze accettavano righe che
  // il controllo buttava via.
  const TLD_VALIDO = /^(?:[a-z]{2,}|xn--[a-z0-9]+(?:-[a-z0-9]+)*)$/i;
  function isListableDomain(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || !/^[a-z0-9.-]+$/.test(s)) return false;
    const parti = s.split('.');
    if (parti.length < 2) return false;
    if (parti.some((p) => !p)) return false; // punti doppi, o in testa/coda
    return TLD_VALIDO.test(parti[parti.length - 1]);
  }

  // #590 — IL NOME DI UN SITO COME LO SCRIVE CHI LO LEGGE. Un indirizzo in
  // cirillico, giapponese o cinese viaggia sulla rete nella forma punycode
  // ("сайт.рф" → "xn--80aswg.xn--p1ai"): è la forma giusta per confrontarlo con
  // una lista, ed è quella sbagliata da mettere sotto gli occhi di qualcuno.
  // Chi aveva scritto la sua voce in cirillico se la ritrovava in Preferenze
  // trasformata in una stringa che non somiglia a niente, e poteva cancellarla
  // credendola spazzatura. La conversione all'indietro non la sa fare né
  // `new URL` né `decodeURIComponent`: è l'algoritmo di RFC 3492, qui sotto.
  const P_BASE = 36;
  const P_TMIN = 1;
  const P_TMAX = 26;
  const P_SKEW = 38;
  const P_DAMP = 700;
  const P_BIAS0 = 72;
  const P_N0 = 128;
  const P_MAX = 0x7fffffff;

  function punyAdapt(delta, punti, prima) {
    let d = prima ? Math.floor(delta / P_DAMP) : delta >> 1;
    d += Math.floor(d / punti);
    let k = 0;
    while (d > ((P_BASE - P_TMIN) * P_TMAX) >> 1) {
      d = Math.floor(d / (P_BASE - P_TMIN));
      k += P_BASE;
    }
    return k + Math.floor(((P_BASE - P_TMIN + 1) * d) / (d + P_SKEW));
  }

  // Una sola etichetta, già senza il prefisso "xn--". Torna null se non è
  // punycode valido: chi chiama tiene allora la forma che aveva.
  function punyDecodeLabel(input) {
    const out = [];
    let n = P_N0;
    let i = 0;
    let bias = P_BIAS0;
    const delim = input.lastIndexOf('-');
    if (delim > 0) {
      for (let j = 0; j < delim; j++) {
        const c = input.charCodeAt(j);
        if (c > 0x7f) return null; // la parte "base" è ASCII per definizione
        out.push(c);
      }
    }
    let idx = delim > 0 ? delim + 1 : 0;
    if (idx >= input.length) return null;
    while (idx < input.length) {
      const oldi = i;
      let w = 1;
      for (let k = P_BASE; ; k += P_BASE) {
        if (idx >= input.length) return null;
        const c = input.charCodeAt(idx++);
        let cifra;
        if (c >= 0x30 && c <= 0x39) cifra = c - 0x30 + 26;
        else if (c >= 0x61 && c <= 0x7a) cifra = c - 0x61;
        else if (c >= 0x41 && c <= 0x5a) cifra = c - 0x41;
        else return null;
        if (cifra >= Math.floor((P_MAX - i) / w)) return null;
        i += cifra * w;
        const t = k <= bias ? P_TMIN : (k >= bias + P_TMAX ? P_TMAX : k - bias);
        if (cifra < t) break;
        if (w > Math.floor(P_MAX / (P_BASE - t))) return null;
        w *= P_BASE - t;
      }
      const lung = out.length + 1;
      bias = punyAdapt(i - oldi, lung, oldi === 0);
      if (Math.floor(i / lung) > P_MAX - n) return null;
      n += Math.floor(i / lung);
      i %= lung;
      if (n < 0x20 || (n >= 0x7f && n <= 0x9f) || n > 0x10ffff) return null;
      out.splice(i, 0, n);
      i++;
    }
    try {
      return String.fromCodePoint(...out);
    } catch (_) {
      return null;
    }
  }

  // Il nome di un sito nella forma da mostrare. Su un nome già leggibile (o su
  // qualcosa che non è punycode valido) non tocca niente.
  function hostLeggibile(raw) {
    const h = String(raw || '').trim();
    if (!h || !/(^|\.)xn--/i.test(h)) return h;
    return h.split('.').map((p) => {
      if (!/^xn--/i.test(p)) return p;
      const d = punyDecodeLabel(p.slice(4).toLowerCase());
      return d || p;
    }).join('.');
  }

  global.SN_URL_NAV = {
    isLocalHost, isLocalNetworkName, isIpv4, normalizeUrl, looksLikeAddress,
    canonicalizeFiloUrl, isShareableAddress, isListableDomain, hostLeggibile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
