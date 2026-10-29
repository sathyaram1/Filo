// SORGENTE UNICA della navigazione «testo → indirizzo» (#398).
// `looksLikeAddress` resta più severa di `normalizeUrl`: nel campo comando `git log v1.2`
// non è un indirizzo, mentre sulla barra l'ambiguità coi comandi non esiste.

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
  //   • ip               → mai delegato: è dove rispondono i router Speedport
  //                        di Telekom (speedport.ip).
  const LOCAL_NET_TLDS = new Set([
    'local', 'lan', 'home', 'internal', 'intranet', 'private', 'box',
    'homenet', 'localdomain', 'corp', 'ip',
  ]);

  // Un'etichetta sola senza punto («lan») NON è un nome di rete locale: è un token qualsiasi.
  function isLocalNetworkName(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || !h.includes('.')) return false;
    if (h === 'home.arpa' || h.endsWith('.home.arpa')) return true;
    return LOCAL_NET_TLDS.has(h.slice(h.lastIndexOf('.') + 1));
  }

  // Host che parlano quasi sempre in chiaro (dev, router/IoT su IP privato, rete di casa):
  // per loro lo schema di default è http. Accetta anche la forma IPv6 fra parentesi ([::1]).
  function isLocalHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (isLocalNetworkName(h)) return true;
    if (h === '::1' || h.startsWith('::ffff:127.')) return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;       // loopback
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;         // privato /8
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;           // privato /16
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true; // privato /12
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;           // link-local
    if (h.includes(':') && /^(f[cd]|fe[89ab])[0-9a-f]*:/.test(h)) return true; // IPv6 privato e link-local
    return false;
  }

  // La rete di casa dei lavori che Filo fa da solo (#591): un nome conta per dove ha risposto la pagina (tplinkwifi.net
  // intercettato dal router, un NAS per nome), e per la sua forma solo finché non lo si sa. Lo annota noteHostAddress.
  const answeredFrom = new Map();

  // Un indirizzo della rete di casa: privato, link-local, CGNAT (Tailscale). Il loopback no: per nome è la macchina
  // stessa, cioè sviluppo locale, e localhost o 127.x restano di casa per la loro forma.
  function isLanAddress(ip) {
    const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d)/, '');
    if (!a || /^127\./.test(a) || a === '::1') return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(a)) return true;
    return (isIpv4(a) || a.includes(':')) && isLocalHost(a);
  }

  const hostKey = (host) => String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  function noteHostAddress(host, ip) {
    const h = hostKey(host);
    if (!h || !ip) return;
    answeredFrom.set(h, isLanAddress(ip));
    // Tetto largo e senza perdita di sicurezza: un nome dimenticato torna a valere per la sua forma.
    if (answeredFrom.size > 5000) answeredFrom.delete(answeredFrom.keys().next().value);
  }

  // Una pagina arrivata da un proxy ha risposto dal proxy: il suo indirizzo non dice niente, e il nome torna alla sua forma.
  function forgetHostAddress(host) {
    answeredFrom.delete(hostKey(host));
  }

  // Mentre si accerta se l'indirizzo che ha risposto conta (proxy o no), chi deve decidere se far uscire la pagina aspetta.
  const pendingFrom = new Map();
  function noteHostPending(host, until) {
    const h = hostKey(host);
    if (!h) return Promise.resolve();
    const p = Promise.resolve(until).catch(() => {}).then(() => { if (pendingFrom.get(h) === p) pendingFrom.delete(h); });
    pendingFrom.set(h, p);
    return p;
  }
  function homeNetworkPending(host) {
    return pendingFrom.get(hostKey(host)) || null;
  }

  function isHomeNetworkHost(host) {
    const h = hostKey(host);
    if (!h) return false;
    if (!h.includes('.') && !h.includes(':')) return true; // un nome senza punto su internet non esiste
    if (/^localhost$|\.localhost$|^127\.|^::1$/.test(h)) return true;
    if (answeredFrom.has(h)) return answeredFrom.get(h);
    // .box è un dominio pubblico vero: fritz.box è di casa perché risponde da casa, non per come si scrive.
    return isLocalHost(h) && !h.endsWith('.box');
  }

  function isHomeNetworkUrl(url) {
    try { return isHomeNetworkHost(new URL(String(url)).hostname); } catch (_) { return false; }
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
  // Indirizzi completi anche senza «//» (#482): diventati ricerca, la posta finiva su Google invece che al programma di
  // posta, e un data:/javascript: sfuggiva all'avviso di chi lo ferma. Un altro «parola:» resta testo («ricetta: pasta»).
  const SCHEMI_SENZA_BARRE = /^(?:mailto|tel|sms|data|javascript|file):/i;

  // Un percorso del computer scritto com'è (\\nas\cartella, C:\…, /home/…, ~/…) è un file, non una ricerca (#482 giro 2):
  // diventato ricerca, il percorso finiva su Google invece di essere fermato e detto come ogni file. Le radici sono
  // quelle dove sta un file dell'utente, anche la chiavetta di Linux sotto /run/media (#1318); «/wiki/Roma» resta testo.
  const RADICI_DEL_COMPUTER = /^\/(?:home|Users|tmp|private|var|etc|opt|mnt|media|run|Volumes|Network|root|srv|usr|bin|sbin|lib|lib64|boot|dev|proc|sys|snap|nix|net|afs|cygdrive|sdcard|storage|Library|Applications|System)(?:\/|$)/;
  // Fuori da quelle radici (un secondo disco montato in /data) vale la forma: tre pezzi, o due col nome di un file.
  const PERCORSO_PER_FORMA = /^\/[^/\s][^/]*(?:\/[^/\s][^/]*){2,}\/?$|^\/[^/\s][^/]*\/[^/\s][^/]*\.[a-z0-9]{1,8}$/i;
  const pezzi = (s) => s.replace(/\\/g, '/').split('/').map((p) => encodeURIComponent(p)).join('/');
  function percorsoDelComputer(raw) {
    let m = /^\\\\([^\\/\s?#]+)(?:[\\/](.*))?$/.exec(raw);
    if (m) return `file://${m[1]}/${pezzi(m[2] || '')}`;
    m = /^([a-z]):[\\/](.*)$/i.exec(raw);
    if (m) return `file:///${m[1]}:/${pezzi(m[2])}`;
    if (RADICI_DEL_COMPUTER.test(raw) || PERCORSO_PER_FORMA.test(raw)) return `file://${pezzi(raw)}`;
    if (/^~(?:[\\/]|$)/.test(raw)) return `file:///${pezzi(raw)}`;
    return null;
  }

  // Le coppie con cui un percorso arriva incartato: «Copia come percorso» di Windows, il Markdown di un modello, le
  // virgolette tipografiche di un testo incollato.
  const INCARTI = [['"', '"'], ['\'', '\''], ['`', '`'], ['«', '»'], ['“', '”'], ['‘', '’'], ['„', '“'], ['<', '>']];
  const incartato = (t) => INCARTI.some(([a, b]) => t.length > a.length + b.length && t.startsWith(a) && t.endsWith(b));
  function senzaIncarti(s) {
    let t = String(s == null ? '' : s).trim();
    // Il punto fuori dalle virgolette, come lo scrive un modello in una frase, non è del percorso.
    const senzaPunto = t.replace(/[.,;:!?]+$/, '');
    if (senzaPunto !== t && incartato(senzaPunto)) t = senzaPunto;
    for (let giro = 0; giro < 4; giro++) {
      const c = INCARTI.find(([a, b]) => t.length > a.length + b.length && t.startsWith(a) && t.endsWith(b));
      if (!c) break;
      t = t.slice(c[0].length, t.length - c[1].length).trim();
    }
    return t;
  }

  function percorsoDiFile(indirizzo) {
    let u;
    try { u = new URL(indirizzo); } catch (_) { return indirizzo; }
    if (u.protocol !== 'file:') return indirizzo;
    let p = u.pathname;
    try { p = decodeURIComponent(p); } catch (_) {}
    // file:///C:/x arriva come «/C:/x», e normalizeUrl scrive ~/x come file:///~/x.
    if (/^\/(?:[a-z]:|~(?:\/|$))/i.test(p)) p = p.slice(1);
    return u.hostname && u.hostname !== 'localhost' ? `\\\\${u.hostname}${p.replace(/\//g, '\\')}` : p;
  }

  // Il percorso nudo, comunque sia stato incollato: fra virgolette o apici inversi, come indirizzo file://, col prefisso
  // \\?\ dei percorsi lunghi di Windows. Una funzione sola per la barra e per la lettura dei documenti (#1318).
  function pulisciPercorso(input) {
    let s = senzaIncarti(input);
    if (/^file:/i.test(s)) s = percorsoDiFile(s);
    return s.replace(/^\\\\[?.]\\UNC\\/i, '\\\\').replace(/^\\\\[?.]\\(?=[a-z]:)/i, '');
  }

  function normalizeUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return 'filo://newtab/';
    // Un file:// fra virgolette resta l'indirizzo che è; un percorso incartato è il file che c'è dentro.
    const nudo = senzaIncarti(raw);
    if (/^file:/i.test(nudo)) return nudo;
    const file = percorsoDelComputer(pulisciPercorso(nudo));
    if (file) return file;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('filo://') || SCHEMI_SENZA_BARRE.test(raw)) return raw;

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
    return RICERCA + encodeURIComponent(raw);
  }
  const RICERCA = 'https://www.google.com/search?q=';

  // Quello che l'assistente chiede di aprire non diventa mai una ricerca (per cercare ha la sua azione, #1318 giro 1):
  // un indirizzo di posta senza «mailto:» va al programma di posta, il resto è '' e l'assistente lo sa.
  // Una lettura sola per l'apertura e per il bottone in chat (#1318 giro 2 e 3): un percorso o un nome di file è un file
  // anche dove la barra vedrebbe un sito («./conto.pdf», «conto.pdf»), mai un sito inventato dato per aperto.
  const POSTA_NUDA = /^[^\s@<>()"'`,;:\\/]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  function indirizzoChiesto(input) {
    const s = String(input == null ? '' : input).trim();
    if (schemaVero(s)) return s;
    if (sembraPercorso(s)) {
      const file = normalizeUrl(s);
      return /^file:/i.test(file) ? file : '';
    }
    const url = normalizeUrl(s);
    if (url !== RICERCA + encodeURIComponent(s)) return url;
    const posta = senzaIncarti(s);
    return POSTA_NUDA.test(posta) ? `mailto:${posta}` : '';
  }
  // Un nome di file da solo: estensioni di documenti, che non sono domini che si visitano. Fuori quelle che sono anche
  // siti veri (obsidian.md, bun.sh, docs.rs).
  const NOME_DI_FILE = /^[^/\\:?#@<>"|*]+\.(?:pdf|docx?|docm|xlsx?|xlsm|pptx?|od[tspg]|rtf|txt|csv|tsv|json|xml|ya?ml|ini|log|jpe?g|png|gif|webp|heic|bmp|tiff?|svg|psd|mp3|wav|flac|m4a|ogg|mp4|mov|avi|mkv|webm|zip|rar|7z|tar|gz|exe|msi|dmg|apk|iso|epub)$/i;
  // Ha la forma di un percorso anche dove Filo non sa dove porta: relativo, con una variabile, con le barre di Windows,
  // o un nome di file da solo.
  function sembraPercorso(input) {
    const s = pulisciPercorso(input);
    return /\\/.test(s) || /^(?:\.{1,2}[\\/]|[/~]|%[^%\s]+%|\$[a-z_]+)/i.test(s) || NOME_DI_FILE.test(s);
  }

  // Quello che diventa un indirizzo scritto da un modello o dall'interfaccia di Filo: con uno schema vero si carica com'è,
  // il resto come lo legge la barra. «localhost:3000» e «nas.lan:5000» sembrano uno schema ma sono host e porta, e un
  // percorso fra virgolette è un file: presi per schemi venivano fermati come indirizzi ignoti (#1318).
  const HOST_E_PORTA = /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i;
  function schemaVero(s) {
    return /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z]:[\\/]/i.test(s) && !HOST_E_PORTA.test(s);
  }
  function indirizzoDaCaricare(input) {
    const s = String(input == null ? '' : input).trim();
    return schemaVero(s) ? s : normalizeUrl(s);
  }

  // Stretta di proposito: deve distinguere un indirizzo da un comando shell. Niente spazi,
  // i path locali li esegue la shell, e un host a etichetta singola senza porta è un comando.
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

  // #437 — schemi che NON sono indirizzi: non puntano fuori dal documento in cui sono nati,
  // quindi copiarli dà una stringa che altrove non apre niente.
  const NON_ADDRESS_SCHEMES = new Set([
    'javascript:', 'vbscript:', 'data:', 'blob:', 'filesystem:', 'about:',
  ]);

  // Serve a «Copia URL» e «Condividi» (#437): la sorgente di un'immagine può essere qualsiasi
  // cosa. Gli href del DOM sono assoluti: ciò che qui non si analizza non era un indirizzo.
  function isShareableAddress(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    let proto = '';
    try { proto = new URL(s).protocol.toLowerCase(); } catch (_) { return false; }
    if (!proto) return false;
    return !NON_ADDRESS_SCHEMES.has(proto);
  }

  // #252 — indirizzo canonico di una pagina interna: la forma lunga e quella corta sono
  // servite entrambe, e la stessa pagina si apriva con due URL. Query e hash restano.
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
    isLocalHost, isHomeNetworkUrl, isHomeNetworkHost, isLanAddress, noteHostAddress, forgetHostAddress,
    noteHostPending, homeNetworkPending, isLocalNetworkName, isIpv4,
    normalizeUrl, indirizzoDaCaricare, indirizzoChiesto, sembraPercorso, pulisciPercorso, looksLikeAddress, canonicalizeFiloUrl, isShareableAddress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
