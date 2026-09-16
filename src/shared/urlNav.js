// SORGENTE UNICA della navigazione «testo → indirizzo» (#398): la logica viveva solo in
// src/main/tabs.js e il campo «nuova scheda» ne aveva una copia più povera (pretendeva un
// TLD alfabetico) che mandava localhost, gli IP e i nomi locali all'LLM invece di aprirli.
// `looksLikeAddress` resta più severa di `normalizeUrl`: nel campo comando un `git log v1.2`
// o `python3.11` non è un indirizzo, mentre sulla barra l'ambiguità coi comandi non esiste.

(function (global) {
  'use strict';

  // #433 — suffissi delle reti domestiche (.local, home.arpa, internal, home/corp, lan,
  // intranet…): esistono SOLO dentro la rete di casa, li assegna il router o mDNS, e il
  // resolver pubblico dà ENOTFOUND anche col dispositivo acceso. Quindi valgono come
  // localhost: schema http e nessun controllo di esistenza. `box` è l'unica eccezione — è un
  // gTLD pubblico vero, ma fritz.box è l'indirizzo dei router FRITZ!Box e quello è il caso
  // reale; il prezzo è un sito .box pubblico aperto in http invece che https.
  const LOCAL_NET_TLDS = new Set([
    'local', 'lan', 'home', 'internal', 'intranet', 'private', 'box',
    'homenet', 'localdomain', 'corp',
  ]);

  // Un'etichetta sola senza punto («lan») NON è un nome di rete locale: è un token qualsiasi.
  function isLocalNetworkName(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || !h.includes('.')) return false;
    if (h === 'home.arpa' || h.endsWith('.home.arpa')) return true;
    return LOCAL_NET_TLDS.has(h.slice(h.lastIndexOf('.') + 1));
  }

  // Host che parlano quasi sempre in chiaro (server di sviluppo, router/IoT su IP privato,
  // dispositivi della rete di casa): per loro lo schema di default è http invece di https.
  // Accetta anche la forma IPv6 fra parentesi ([::1]).
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

  // Solo un vero IPv4 con ottetti in range conta come indirizzo: distingue 192.168.1.1 da
  // un dominio con «TLD» numerico o da un token qualsiasi coi punti.
  function isIpv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''));
    if (!m) return false;
    return m.slice(1, 5).every((o) => Number(o) <= 255);
  }

  // Schema esplicito → naviga com'è; indirizzo (dominio col punto, host locale noto,
  // host:porta) → http per i locali e https altrimenti; il resto → ricerca Google.
  // La parte «:porta» è il fix #233: prima ogni host:porta cadeva in ricerca.
  function normalizeUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return 'filo://newtab/';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('filo://')) return raw;

    // Uno spazio interno significa «non è un indirizzo» → ricerca.
    const hostPart = raw.split(/[/?#]/, 1)[0];
    const m = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i.exec(hostPart);
    if (m) {
      const host = m[1];
      const port = m[2] ? Number(m[2]) : null;
      const bracketed = host.startsWith('[');
      const hasDot = !bracketed && host.includes('.');
      const local = isLocalHost(host);
      const validPort = port === null || (port >= 1 && port <= 65535);
      // La porta esplicita è un segnale forte di indirizzo; fuori range (>65535) non è valida
      // e resta ricerca.
      if (validPort && (hasDot || local || port !== null)) {
        // http anche per gli host a etichetta singola (intranet/dev, che parlano in chiaro);
        // https per i domini pubblici e gli IP letterali.
        const scheme = (local || (!hasDot && !bracketed)) ? 'http://' : 'https://';
        return scheme + raw;
      }
    }
    return 'https://www.google.com/search?q=' + encodeURIComponent(raw);
  }

  // Stretta di proposito: deve distinguere un indirizzo da un comando shell. Niente spazi;
  // i path locali (./x, ~/x, /usr) li esegue la shell; un host a etichetta singola SENZA
  // porta (git, python3.11) resta un comando, non un indirizzo.
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

  // #437 — schemi che NON sono indirizzi: non puntano da nessuna parte fuori dal documento
  // in cui sono nati, quindi copiarli o condividerli dà una stringa che altrove non apre
  // niente. javascript:/vbscript: è codice, data: è il contenuto stesso, blob:/filesystem:
  // muoiono col documento, about: è uno stato interno del browser.
  const NON_ADDRESS_SCHEMES = new Set([
    'javascript:', 'vbscript:', 'data:', 'blob:', 'filesystem:', 'about:',
  ]);

  // Serve alle azioni «Copia URL»/«Condividi» (#437): la sorgente di un'immagine o di un
  // filmato può essere qualsiasi cosa il sito ci abbia messo. Gli href letti dal DOM sono
  // già assoluti, quindi ciò che qui non si lascia analizzare non era un indirizzo nemmeno
  // per la pagina che lo conteneva.
  function isShareableAddress(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    let proto = '';
    try { proto = new URL(s).protocol.toLowerCase(); } catch (_) { return false; }
    if (!proto) return false;
    return !NON_ADDRESS_SCHEMES.has(proto);
  }

  // #252 — indirizzo canonico di una pagina interna. Lo shim traduce `chrome.runtime.getURL`
  // in `filo://src/pages/<page>/<file>` mentre i menu usano la forma corta, ed entrambe sono
  // servite dal protocollo: la stessa pagina si apriva con due URL. Qui la forma legacy torna
  // a quella corta, così la deduplica delle schede può confrontarle. Query e hash restano.
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
