// Public Suffix List (sottoinsieme curato) + estrazione del dominio
// registrabile (eTLD+1).
//
// NON è la PSL completa (~9000 voci): è un sottoinsieme che copre i TLD comuni
// e i ccSLD più diffusi (co.uk, com.au, com.br, ...). Per i suffissi non
// elencati ricadiamo sulla regola implicita "*" del PSL (ogni etichetta è un
// suffisso valido), quindi l'eTLD+1 resta sempre calcolabile e ragionevole.
// Quando serviranno casi più esotici, basta aggiungere righe a SUFFIX_RULES.
//
// L'algoritmo segue publicsuffix.org: cerca la regola che combacia con il
// maggior numero di etichette (con gestione di wildcard `*` ed eccezioni `!`),
// poi il dominio registrabile è "suffisso + 1 etichetta".

'use strict';

// Regole "normali" (la maggioranza). Una riga per suffisso pubblico.
const NORMAL = new Set([
  // gTLD generici più comuni
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'mobi', 'app', 'dev',
  'io', 'co', 'ai', 'me', 'tv', 'cc', 'xyz', 'online', 'site', 'shop', 'store',
  'tech', 'cloud', 'page', 'blog', 'live', 'news', 'email', 'wiki', 'fun',
  'gg', 'sh', 'ly', 'to', 'fm', 'ws', 'top', 'club', 'vip', 'pw', 'link',
  // ccTLD a una etichetta
  'it', 'de', 'fr', 'es', 'nl', 'be', 'at', 'ch', 'pt', 'ie', 'dk', 'se',
  'no', 'fi', 'pl', 'cz', 'sk', 'gr', 'ro', 'hu', 'ru', 'ua', 'tr', 'us',
  'ca', 'mx', 'ar', 'cl', 'pe', 'cn', 'jp', 'kr', 'in', 'au', 'nz', 'za',
  'br', 'eu', 'is', 'lt', 'lv', 'ee', 'si', 'hr', 'bg', 'rs', 'lu', 'li',
  'sg', 'hk', 'tw', 'th', 'my', 'id', 'ph', 'vn', 'il', 'ae', 'sa', 'ma',
  'gov', 'edu', 'mil', 'int',
  // ccSLD multi-etichetta diffusi
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'gov.uk', 'ac.uk', 'nhs.uk', 'police.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'gr.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'gov.in', 'ac.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'gen.tr',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk', 'idv.hk',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw',
  'co.id', 'or.id', 'web.id', 'go.id', 'ac.id', 'sch.id',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
  'co.th', 'in.th', 'go.th', 'ac.th', 'or.th',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn',
  'co.il', 'org.il', 'net.il', 'gov.il', 'ac.il', 'muni.il',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'edu.sa',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua',
  'com.ru', 'net.ru', 'org.ru', 'gov.ru', 'edu.ru',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl',
  'com.es', 'org.es', 'gob.es', 'edu.es',
  'com.pt', 'gov.pt', 'edu.pt',
  'co.at', 'or.at', 'gv.at', 'ac.at',
]);

// Suffissi serviti come "wildcard": ogni etichetta sotto di essi è un suffisso
// pubblico (es. `*.ck` → `foo.ck` è suffisso). Raro, ma incluso per correttezza.
const WILDCARD = new Set([
  'ck', 'jm', 'kw', 'mm', 'np',
]);

// Eccezioni alle wildcard (regola `!suffix`): rendono il suffisso un dominio
// registrabile invece che pubblico (es. `!www.ck`).
const EXCEPTION = new Set([
  'www.ck',
]);

// Estrae l'eTLD+1 (dominio registrabile) e il public suffix da un hostname.
// `host` deve già essere in forma ascii/punycode minuscola e senza porta.
// Ritorna { registrable, publicSuffix, sld, labels } oppure null per input
// invalido (IP, host vuoto, singola etichetta senza punto).
function getDomainInfo(host) {
  if (!host || typeof host !== 'string') return null;
  host = host.replace(/\.$/, '').toLowerCase();
  if (!host || host.includes(' ')) return null;
  // Gli indirizzi IP non hanno eTLD+1.
  if (isIpAddress(host)) {
    return { registrable: host, publicSuffix: '', sld: host, labels: [host], isIp: true };
  }
  const labels = host.split('.');
  if (labels.length < 2) {
    // Singola etichetta (es. "localhost"): nessun dominio registrabile.
    return { registrable: host, publicSuffix: host, sld: host, labels, single: true };
  }

  // Cerca, dalla regola più specifica (più etichette) alla meno specifica.
  let suffixLabels = 0; // numero di etichette del public suffix scelto
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (EXCEPTION.has(candidate)) {
      // Eccezione: il public suffix è candidate MENO la prima etichetta.
      suffixLabels = labels.length - i - 1;
      break;
    }
    if (NORMAL.has(candidate)) {
      suffixLabels = labels.length - i;
      break;
    }
    // Wildcard: se la parte DOPO la prima etichetta del candidato è una
    // wildcard, allora candidate è un public suffix.
    const parent = labels.slice(i + 1).join('.');
    if (parent && WILDCARD.has(parent)) {
      suffixLabels = labels.length - i;
      break;
    }
  }
  // Regola implicita "*": se nessuna regola combacia, il TLD (ultima etichetta)
  // è il public suffix.
  if (suffixLabels === 0) suffixLabels = 1;

  // Il dominio registrabile = public suffix + 1 etichetta.
  const regLabels = suffixLabels + 1;
  if (labels.length < regLabels) {
    // Il dominio è esattamente un public suffix (es. "co.uk" da solo): nessun
    // dominio registrabile.
    const ps = labels.join('.');
    return { registrable: ps, publicSuffix: ps, sld: '', labels, suffixOnly: true };
  }
  const registrable = labels.slice(labels.length - regLabels).join('.');
  const publicSuffix = labels.slice(labels.length - suffixLabels).join('.');
  const sld = labels[labels.length - regLabels]; // etichetta "di brand"
  return { registrable, publicSuffix, sld, labels };
}

function isIpAddress(host) {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((n) => Number(n) <= 255);
  }
  // IPv6 (forma con due-punti, eventualmente fra parentesi)
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':') && /^[0-9a-f:]+$/i.test(h)) return true;
  return false;
}

// ─── Chi possiede il sito ────────────────────────────────────────────────────
// #591, terzo giro. Il dominio registrabile risponde a «chi ha comprato questo
// dominio». Per decidere quante verifiche costose un sito può far partire
// serve un'altra risposta: «chi scrive quello che c'è dentro». Sulle
// piattaforme dove ogni utente riceve un suo sotto-indirizzo gratuito le due
// risposte divergono: il dominio di sito-di-tizio.pages.dev è pages.dev, ma
// quel sito è di Tizio e quello accanto è di Caio, che non si conoscono.
// Contare insieme le verifiche di tutti i siti ospitati lì vuol dire che
// quattro sotto-indirizzi di chi attacca spengono il controllo per tutti gli
// altri, truffe comprese.
//
// L'elenco è per forza incompleto (ne nascono di nuove ogni mese): è la prima
// difesa, non l'unica. Chi conta le verifiche tiene anche un tetto complessivo,
// che vale per le piattaforme che qui non ci sono ancora.
const PIATTAFORME_MULTI_UTENTE = new Set([
  // pagine statiche e anteprime
  'pages.dev', 'workers.dev', 'r2.dev', 'trycloudflare.com',
  'github.io', 'gitlab.io', 'github.dev',
  'vercel.app', 'netlify.app', 'netlify.com', 'onrender.com', 'fly.dev',
  'deno.dev', 'surge.sh', 'herokuapp.com', 'azurewebsites.net',
  'appspot.com', 'web.app', 'firebaseapp.com', 'pythonanywhere.com',
  'repl.co', 'replit.app', 'codesandbox.io', 'stackblitz.io', 'glitch.me',
  '000webhostapp.com', 'neocities.org',
  // blog e costruttori di siti
  'blogspot.com', 'wordpress.com', 'tumblr.com', 'wixsite.com', 'weebly.com',
  'webflow.io', 'carrd.co', 'strikingly.com', 'jimdosite.com', 'notion.site',
  'framer.website', 'bubbleapps.io', 'softr.app', 'myshopify.com',
  'square.site', 'canva.site',
  // tunnel e indirizzi dinamici
  'ngrok.io', 'ngrok-free.app', 'loca.lt', 'serveo.net', 'duckdns.org',
]);

// Ritorna la stringa che identifica chi controlla il contenuto di `host`: il
// dominio registrabile, oppure il sotto-indirizzo quando il dominio
// registrabile è una piattaforma multi-utente. Per un indirizzo IP o un nome
// senza punti ritorna il nome stesso.
function proprietario(host) {
  const h = String(host == null ? '' : host).toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  const info = getDomainInfo(h);
  if (!info || !info.registrable) return h;
  const reg = info.registrable;
  if (!PIATTAFORME_MULTI_UTENTE.has(reg)) return reg;
  if (h === reg || !h.endsWith('.' + reg)) return reg;
  const davanti = h.slice(0, h.length - reg.length - 1).split('.');
  const ultima = davanti[davanti.length - 1];
  return ultima ? `${ultima}.${reg}` : reg;
}

module.exports = { getDomainInfo, isIpAddress, proprietario, PIATTAFORME_MULTI_UTENTE };
