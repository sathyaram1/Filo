// Blocco apertura siti in blacklist (#170.3).
//
// PERCHÉ ESISTE
//   L'ad-blocking (adblock.js) annulla le SINGOLE richieste verso domini di
//   ad/tracker, ma non impedisce di APRIRE la pagina top-level di un sito che
//   sta in blacklist. Questo modulo decide, a livello di navigazione top-level,
//   se l'apertura di un sito va bloccata del tutto.
//
//   Sorgenti della blacklist:
//   - le liste pubbliche già scaricate dall'ad-blocker (#170.2: StevenBlack +
//     EasyList), opzionali (useAdblockLists);
//   - una blacklist DEDICATA dell'utente (domini aggiunti a mano nelle
//     Preferenze).
//
//   ECCEZIONE (l'apertura è consentita anche se il sito è in blacklist):
//   la navigazione proviene da un MOTORE DI RICERCA (referrer Google/Bing/…):
//   l'utente l'ha cercato apposta, non lo intercettiamo.
//
//   NON è più un'eccezione l'apertura ORIGINATA DA FILO (#590). L'azione
//   NAVIGA è di livello 1: la propone il MODELLO, senza conferma, e una
//   pagina ostile che lo convince (prompt injection) aprirebbe qualunque
//   indirizzo della lista senza incontrare un controllo. "Lo apre Filo" non
//   è quindi una prova che l'abbia voluto l'utente. L'unico scavalco resta
//   quello che l'utente sceglie a mano: "Apri comunque" sulla notifica.
//
//   E QUEL SÌ SI RICORDA (#590, secondo giro). Prima valeva per la sola
//   richiesta che partiva in quell'istante, e bastava che il server
//   rispondesse "vai qui" (il salto da http a https, la barra iniziale che
//   porta alla home: quasi ogni sito vero) perché il rimbalzo trovasse un
//   controllo che del sì non sapeva niente e lo fermasse. L'utente si trovava
//   una scheda vuota e nessun altro modo di aprire il sito. Stessa cosa al
//   primo link cliccato dentro il sito, o a una ricarica. Il sì vale quindi
//   per tutta la sessione e per il nome di sito a cui l'utente l'ha dato,
//   sottodomini compresi: è la stessa unità che l'utente ha scritto in lista.
//   Si azzera quando l'utente cambia la lista (è così che si torna indietro) e
//   quando Filo si chiude. Darlo può solo una persona che clicca la notifica:
//   il modello non ha nessuna strada per arrivarci.
//
//   Quando invece blocca, il chiamante (tabs.js) mostra una notifica in basso a
//   destra (#170.1) col sito bloccato e l'opzione "Apri comunque".
//
// API: configureFromSettings, shouldBlockNavigation, isSearchEngineUrl,
//      isBlacklistedHost, canonicalHost, allowHost, isAllowedHost, revokeHost,
//      allowedHosts, setForTest, status.

require('../../shared/urlNav'); // #590 — la regola di cosa è un nome di sito valido, in un posto solo

let enabled = true;
let useAdblockLists = true;
let userBlacklist = new Set(); // domini extra inseriti dall'utente
// I sì dati a mano dall'utente su "Apri comunque", per questa sessione.
let allowedBySite = new Set();

// I MOTORI SI ELENCANO, NON SI DESCRIVONO (#590, decimo giro).
//
// Per quattro giri l'eccezione è stata concessa da una REGOLA SULLA FORMA del
// nome ("<motore> davanti al suffisso pubblico"), e ogni volta si è scoperto un
// modo di soddisfare quella forma senza essere il motore: il sito di chiunque
// con "searx" come prima label (giro 1), la pagina di chiunque ospitata sul
// motore vero (giro 3), la pagina che si riscrive l'indirizzo nel percorso dei
// risultati (giro 9). L'ultimo era il più semplice di tutti: la forma
// "<motore>.<estensione>" lascia libere tutte le estensioni, e searx.xyz,
// searx.top o searx.cheap sono nomi che chiunque registra in dieci minuti per
// pochi euro. Chi li ha si prende l'eccezione e la lista dei siti bloccati non
// vale più.
//
// La regola generale è la stessa del racconto di pattern del giro 9: quello che
// chiunque può PROCURARSI non è una prova. Un'eccezione a un divieto scritto
// dall'utente la può concedere solo un'IDENTITÀ — un nome preciso — non una
// somiglianza. Quindi qui c'è un elenco: i domini registrabili dei motori veri,
// scritti per esteso. Costa una tabella lunga e va aggiornata quando un motore
// cambia nome; in cambio non c'è nessuna forma da indovinare.
//
// Conseguenza dichiarata: un'istanza SearX ospitata su un nome proprio
// (il caso del self-hosting) non concede più l'eccezione, perché per il
// controllo è indistinguibile da un nome comprato apposta. Chi la usa e finisce
// su un sito che si era messo in lista lo vede fermato, con "Apri comunque"
// sulla notifica: una scelta in più su una strada rara, invece di una porta
// aperta a tutti.
//
// I sottodomini restano dentro (www.google.com, search.yahoo.com,
// lite.duckduckgo.com): il confronto è per suffisso, come per la lista dei
// siti bloccati. Restano fuori le civette (google.evil.com, searx.qualunque.com),
// perché lì il dominio registrabile è un altro.

// I domini di Google: uno per paese, tutti suoi.
const GOOGLE_SUFFIXES = [
  'com', 'ac', 'ad', 'ae', 'com.af', 'com.ag', 'com.ai', 'al', 'am', 'co.ao',
  'com.ar', 'as', 'at', 'com.au', 'az', 'ba', 'com.bd', 'be', 'bf', 'bg',
  'com.bh', 'bi', 'bj', 'com.bn', 'com.bo', 'com.br', 'bs', 'bt', 'co.bw',
  'by', 'com.bz', 'ca', 'cat', 'cd', 'cf', 'cg', 'ch', 'ci', 'co.ck', 'cl',
  'cm', 'cn', 'com.co', 'co.cr', 'com.cu', 'cv', 'com.cy', 'cz', 'de', 'dj',
  'dk', 'dm', 'com.do', 'dz', 'com.ec', 'ee', 'com.eg', 'es', 'com.et', 'fi',
  'com.fj', 'fm', 'fr', 'ga', 'ge', 'gg', 'com.gh', 'com.gi', 'gl', 'gm',
  'gp', 'gr', 'com.gt', 'gy', 'com.hk', 'hn', 'hr', 'ht', 'hu', 'co.id', 'ie',
  'co.il', 'im', 'co.in', 'iq', 'is', 'it', 'je', 'com.jm', 'jo', 'co.jp',
  'co.ke', 'com.kh', 'ki', 'kg', 'co.kr', 'com.kw', 'kz', 'la', 'com.lb',
  'li', 'lk', 'co.ls', 'lt', 'lu', 'lv', 'com.ly', 'co.ma', 'md', 'me', 'mg',
  'mk', 'ml', 'com.mm', 'mn', 'ms', 'com.mt', 'mu', 'mv', 'mw', 'com.mx',
  'com.my', 'co.mz', 'com.na', 'com.nf', 'com.ng', 'com.ni', 'ne', 'nl', 'no',
  'com.np', 'nr', 'nu', 'co.nz', 'com.om', 'com.pa', 'com.pe', 'com.pg',
  'com.ph', 'com.pk', 'pl', 'pn', 'com.pr', 'ps', 'pt', 'com.py', 'com.qa',
  'ro', 'rs', 'ru', 'rw', 'com.sa', 'com.sb', 'sc', 'se', 'com.sg', 'sh',
  'si', 'sk', 'com.sl', 'sm', 'sn', 'so', 'sr', 'st', 'com.sv', 'td', 'tg',
  'co.th', 'com.tj', 'tl', 'tm', 'tn', 'to', 'com.tr', 'tt', 'com.tw',
  'co.tz', 'com.ua', 'co.ug', 'co.uk', 'com.uy', 'co.uz', 'com.vc', 'co.ve',
  'vg', 'co.vi', 'com.vn', 'vu', 'ws', 'co.za', 'co.zm', 'co.zw',
];

// Motori di ricerca il cui referrer rende lecita l'apertura di un sito in
// blacklist. Domini registrabili, per esteso: il confronto è per suffisso,
// quindi i sottodomini di un motore vero (www., search., lite., es.) entrano
// da soli.
const SEARCH_ENGINE_DOMAINS = new Set([
  ...GOOGLE_SUFFIXES.map((s) => `google.${s}`),
  'bing.com',
  'duckduckgo.com',
  'ecosia.org',
  'startpage.com',
  'qwant.com',
  'baidu.com',
  'brave.com', // search.brave.com
  'kagi.com',
  'mojeek.com',
  'ask.com',
  'yahoo.com', // search.yahoo.com, es.search.yahoo.com, …
  'yahoo.co.jp',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.co.id',
  'yahoo.com.au',
  'yahoo.com.br',
  'yahoo.com.mx',
  'yahoo.ca',
  'yahoo.de',
  'yahoo.es',
  'yahoo.fr',
  'yahoo.it',
  'yandex.com',
  'yandex.ru',
  'yandex.by',
  'yandex.kz',
  'yandex.ua',
  'yandex.uz',
  'yandex.com.tr',
  'ya.ru',
  // Le istanze SearX pubbliche del progetto. Un'istanza su un nome proprio non
  // entra: vedi la nota in testa a questo blocco.
  'searx.be',
  'searx.info',
]);

// FORMA UNICA DI UN NOME DI HOST (#590). Lo stesso sito si scrive in più modi e
// la rete li risolve tutti uguali: la lista deve confrontarli tutti uguali, o
// basta un carattere di troppo per scavalcarla.
//   - minuscole: "EVIL.example" è "evil.example";
//   - PUNTO FINALE: "evil.example." è la forma ASSOLUTA del nome (la radice del
//     DNS scritta per esteso). Ogni browser apre la stessa pagina, ma senza
//     toglierlo il confronto con la lista falliva e il sito si apriva — su
//     tutte le strade insieme, perché tutte chiedono a questa funzione;
//   - ALFABETI NON LATINI: un indirizzo scritto in unicode viaggia sulla rete
//     nella forma punycode (xn--…), che è quella che arriva qui da `new URL`.
//     Una voce di lista scritta a mano in unicode va portata nella stessa
//     forma, altrimenti non combacia mai (e prima veniva pure scartata in
//     silenzio, perché l'unicode non passa il controllo di validità).
function canonicalHost(raw) {
  let h = String(raw || '').trim().toLowerCase();
  if (!h) return '';
  h = h.replace(/\.+$/, ''); // punto (o punti) finali: forma assoluta del nome
  if (!h) return '';
  // Punycode: lo fa l'URL parser, che è la stessa strada da cui arrivano gli
  // host da bloccare. Su un host che non parsa teniamo quello che avevamo.
  if (/[^\x00-\x7f]/.test(h)) {
    try {
      const p = new URL(`http://${h}`).hostname.toLowerCase();
      if (p) h = p.replace(/\.+$/, '');
    } catch (_) { /* host non parsabile: resta com'era */ }
  }
  return h;
}

// Normalizza un dominio inserito dall'utente: toglie schema, path, porta, www.
function normalizeDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, ''); // schema
  s = s.split('/')[0]; // path
  s = s.split('?')[0];
  s = s.split('#')[0];
  s = s.split(':')[0]; // porta
  s = s.replace(/^www\./, '');
  return canonicalHost(s);
}

// Un dominio è valido come voce di blacklist solo se ha un'estensione. Una voce
// come "facebook" o un indirizzo numerico non è mai un nome di sito reale,
// quindi non deve entrare nel Set (matcherebbe "facebook.com/com", non
// "facebook") dando falsa sicurezza. La regola vive in SN_URL_NAV perché la
// usa anche il campo delle Preferenze che avvisa sulle righe scartate: quando
// erano due copie, le Preferenze accettavano righe che qui venivano buttate.
function isValidDomain(host) {
  return globalThis.SN_URL_NAV.isListableDomain(host);
}

// Da lista grezza (settings) → Set di domini normalizzati E validi.
function toBlacklistSet(list) {
  return new Set(list.map(normalizeDomain).filter(isValidDomain));
}

// Match per suffisso di dominio: "a.b.example.com" matcha "example.com".
function matchesSuffix(host, set) {
  if (!host || !set || !set.size) return false;
  let h = host;
  while (h) {
    if (set.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

// Il nome di sito a cui vale la pena legare il sì dell'utente: la VOCE DI LISTA
// che ha fermato l'apertura, non l'host preciso di quel momento. Se l'utente ha
// scritto "esempio.com" e il blocco è scattato su "www.esempio.com", il sì vale
// per esempio.com: altrimenti il primo salto fra www e nome nudo (che fanno
// quasi tutti i siti) ricadrebbe nel blocco un istante dopo. Se a fermare sono
// state le liste pubbliche, non c'è una voce scritta dall'utente: vale l'host.
function blacklistEntryFor(host) {
  let h = host;
  while (h) {
    if (userBlacklist.has(h)) return h;
    const dot = h.indexOf('.');
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return host;
}

// L'utente ha cliccato "Apri comunque" su questo indirizzo: da qui in poi, per
// questa sessione, quel sito si apre. Ritorna il nome di sito registrato.
function allowHost(rawHost) {
  const host = canonicalHost(rawHost);
  if (!host) return '';
  const entry = blacklistEntryFor(host);
  allowedBySite.add(entry);
  return entry;
}

function isAllowedHost(rawHost) {
  const host = canonicalHost(rawHost);
  if (!host) return false;
  return matchesSuffix(host, allowedBySite);
}

// #590 (terzo giro) — si torna indietro. Un permesso che dura tutta la sessione
// e non si può togliere è mezzo permesso: chi clicca "Apri comunque" per
// guardare una pagina non sta dicendo "tieni quel sito aperto fino a stasera".
// Rimettere mano all'elenco dei siti bloccati li azzera tutti, ma è una strada
// che nessuno indovina e che colpisce anche i sì che si volevano tenere.
function revokeHost(rawHost) {
  const host = canonicalHost(rawHost);
  if (!host) return false;
  return allowedBySite.delete(host);
}

// I sì di questa sessione, per mostrarli. Un permesso che dura e non si vede da
// nessuna parte è mezzo permesso: il bottone sulla notifica vale finché quella
// notifica è a schermo, cioè pochi secondi, e dopo non resta niente (#590,
// quarto giro). Le Preferenze, dove l'utente la lista l'ha scritta, sono il
// posto dove andrebbe a cercarli.
function allowedHosts() {
  return [...allowedBySite].sort();
}

function isSearchEngineHost(host) {
  if (!host) return false;
  return matchesSuffix(host, SEARCH_ENGINE_DOMAINS);
}

// I PERCORSI DI RICERCA dei motori. Sul nome di un motore non ci sono solo i
// risultati: ci sono pagine che può pubblicare chiunque (i siti fatti con lo
// strumento per siti di Google, le pagine servite dai suoi script, i documenti
// condivisi). Il nome da solo quindi non basta, ed è la stessa forma del
// difetto che il #590 chiedeva di chiudere ancorando la regex: lì un sito di
// chiunque si spacciava per motore, qui una pagina di chiunque sta sul motore
// vero. L'eccezione deve valere per una pagina di RISULTATI.
//   /search          google, bing, ecosia, brave, kagi, mojeek, searx, yahoo
//   /search/         yandex
//   /sp/search       startpage (la domanda viaggia nel corpo, non nell'indirizzo)
//   /web             ask
//   /s               baidu
//   /html            la versione leggera di duckduckgo
// Nessuno di questi è un percorso su cui si possa pubblicare una pagina propria.
const SEARCH_PATHS = /^\/(?:search|sp\/search|web|s|html)\/?$/;

// Duckduckgo e qwant mettono i risultati sulla RADICE (`/?q=…`), che da sola è
// solo la pagina iniziale del motore. Lì l'eccezione la apre la domanda scritta
// nell'indirizzo, non il percorso: è anche quello che tiene fuori un referrer
// ridotto alla sola origine (`https://sito.esempio/`), che è la forma in cui
// quasi tutti i siti lo mandano fuori dal proprio dominio.
const SEARCH_PARAMS = ['q', 'p', 'text', 'wd', 'query', 'k'];

// La pagina da cui si parte è una pagina di RISULTATI di un motore di ricerca?
// (È l'unica eccezione alla lista dei siti bloccati che non passi dall'utente.)
function isSearchEngineUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!isSearchEngineHost(canonicalHost(u.hostname))) return false;
  if (SEARCH_PATHS.test(u.pathname)) return true;
  if (u.pathname !== '/') return false;
  return SEARCH_PARAMS.some((k) => {
    const v = u.searchParams.get(k);
    return !!(v && v.trim());
  });
}

// L'host è in blacklist? (blacklist dedicata dell'utente, oppure — se
// abilitato — le liste pubbliche dell'ad-blocker.)
//
// `soloListaUtente` (#590, sesto giro) ESCLUDE le liste pubbliche. Le due
// sorgenti sembrano una sola, ma servono a due cose diverse e si sono sempre
// comportate in due modi diversi:
//   - quello che l'utente SCRIVE è un divieto: quel sito non deve arrivargli
//     davanti, da nessuna strada, e quando viene fermato glielo si dice;
//   - le liste pubbliche di pubblicità e tracciatori sono una POTATURA, e la
//     fa già il filtro delle richieste, in silenzio, su ogni pagina. Non sono
//     posti dove l'utente voleva andare: sono pezzi che vengono tolti.
// Applicarle dove si PASSA (il rimbalzo del server) o dove ci si INCORPORA
// (un riquadro dentro una pagina) le trasforma in un divieto che non sono mai
// state: una pagina di giornale annunciava una notifica per ogni tracciatore,
// e un link che rimbalza su un contatore di clic non arrivava più all'articolo.
function isBlacklistedHost(rawHost, { soloListaUtente = false } = {}) {
  const host = canonicalHost(rawHost);
  if (!host) return false;
  if (matchesSuffix(host, userBlacklist)) return true;
  if (!soloListaUtente && useAdblockLists) {
    try {
      const ad = require('./adblock');
      if (ad && typeof ad.isBlockedHost === 'function' && ad.isBlockedHost(host)) return true;
    } catch (_) {}
  }
  return false;
}

// Decisione centrale. Ritorna { block, host, reason }.
//   targetUrl: dove si vuole andare.
//   fromUrl:   pagina di partenza / referrer (per l'eccezione "ricerca").
//   soloListaUtente: guarda SOLO i siti scritti dall'utente, non le liste
//              pubbliche di pubblicità e tracciatori (vedi isBlacklistedHost).
// CHI apre (utente, link, popup, modello) non cambia la decisione — vedi
// l'intestazione del file.
function shouldBlockNavigation(targetUrl, { fromUrl = '', soloListaUtente = false } = {}) {
  const res = { block: false, host: '', reason: '' };
  if (!enabled) return res;

  let u;
  try {
    u = new URL(targetUrl);
  } catch (_) {
    return res; // URL non valido: non interferiamo
  }
  // Solo navigazioni web top-level. filo://, about:, data:, chrome:, ecc. sono
  // sempre lecite (le pagine interne di Filo non si bloccano mai).
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return res;

  const host = canonicalHost(u.hostname);
  res.host = host;

  // L'utente ha già detto di sì a questo sito, a mano, in questa sessione.
  // Vale per ogni strada e per ogni passo che viene dopo: il rimbalzo del
  // server, il link cliccato dentro il sito, la ricarica, la scheda nuova.
  if (matchesSuffix(host, allowedBySite)) return res;

  // Unica eccezione — si arriva da una pagina di risultati di un motore di
  // ricerca: l'utente l'ha cercato apposta. Il solo NOME del motore non basta
  // (vedi SEARCH_PATHS): sui suoi indirizzi si pubblicano anche pagine di
  // chiunque, e una di quelle aprirebbe qualunque sito della lista da sola.
  if (fromUrl && isSearchEngineUrl(fromUrl)) return res;

  if (!isBlacklistedHost(host, { soloListaUtente })) return res;

  res.block = true;
  res.reason = matchesSuffix(host, userBlacklist) ? 'blacklist' : 'lists';
  return res;
}

function configureFromSettings(settings) {
  const sb = (settings && settings.security && settings.security.siteBlock) || {};
  enabled = sb.enabled !== false;
  useAdblockLists = sb.useAdblockLists !== false;
  const list = Array.isArray(sb.blacklist) ? sb.blacklist : [];
  const nuova = toBlacklistSet(list);
  // Cambiare la lista è il modo di TORNARE INDIETRO su un "Apri comunque": chi
  // ci ha ripensato rimette mano all'elenco e i sì di questa sessione cadono.
  // Solo se le voci cambiano davvero: queste impostazioni si riscrivono a ogni
  // salvataggio delle Preferenze, e azzerare a ogni giro renderebbe il sì
  // buono per pochi secondi.
  if (nuova.size !== userBlacklist.size || [...nuova].some((d) => !userBlacklist.has(d))) {
    allowedBySite = new Set();
  }
  userBlacklist = nuova;
}

// Per i test: imposta stato senza passare da settings.
function setForTest({ enabled: en, useAdblockLists: ual, blacklist, allowed } = {}) {
  if (en !== undefined) enabled = !!en;
  if (ual !== undefined) useAdblockLists = !!ual;
  if (Array.isArray(blacklist)) {
    userBlacklist = toBlacklistSet(blacklist);
    allowedBySite = new Set();
  }
  if (Array.isArray(allowed)) {
    allowedBySite = new Set(allowed.map(canonicalHost).filter(Boolean));
  }
}

function status() {
  return {
    enabled,
    useAdblockLists,
    blacklistSize: userBlacklist.size,
    allowedSize: allowedBySite.size,
  };
}

module.exports = {
  configureFromSettings,
  shouldBlockNavigation,
  isSearchEngineUrl,
  isBlacklistedHost,
  normalizeDomain,
  canonicalHost,
  allowHost,
  isAllowedHost,
  revokeHost,
  allowedHosts,
  setForTest,
  status,
};
