// Public Suffix List (sottoinsieme curato) + estrazione del dominio registrabile (eTLD+1).
// NON è la PSL completa: copre i TLD comuni e i ccSLD più diffusi; per i suffissi non elencati vale la regola implicita "*" (ogni etichetta è un suffisso valido), quindi l'eTLD+1 resta sempre calcolabile. Per casi più esotici basta aggiungere righe a SUFFIX_RULES.
// L'algoritmo segue publicsuffix.org: vince la regola che combacia col maggior numero di etichette (con wildcard `*` ed eccezioni `!`), e il registrabile è suffisso + 1 etichetta.

'use strict';

const NORMAL = new Set([
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'mobi', 'app', 'dev',
  'io', 'co', 'ai', 'me', 'tv', 'cc', 'xyz', 'online', 'site', 'shop', 'store',
  'tech', 'cloud', 'page', 'blog', 'live', 'news', 'email', 'wiki', 'fun',
  'gg', 'sh', 'ly', 'to', 'fm', 'ws', 'top', 'club', 'vip', 'pw', 'link',
  'it', 'de', 'fr', 'es', 'nl', 'be', 'at', 'ch', 'pt', 'ie', 'dk', 'se',
  'no', 'fi', 'pl', 'cz', 'sk', 'gr', 'ro', 'hu', 'ru', 'ua', 'tr', 'us',
  'ca', 'mx', 'ar', 'cl', 'pe', 'cn', 'jp', 'kr', 'in', 'au', 'nz', 'za',
  'br', 'eu', 'is', 'lt', 'lv', 'ee', 'si', 'hr', 'bg', 'rs', 'lu', 'li',
  'sg', 'hk', 'tw', 'th', 'my', 'id', 'ph', 'vn', 'il', 'ae', 'sa', 'ma',
  'gov', 'edu', 'mil', 'int',
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

// Wildcard: ogni etichetta sotto di essi è un suffisso pubblico (`*.ck` → `foo.ck`). Raro, incluso per correttezza.
const WILDCARD = new Set([
  'ck', 'jm', 'kw', 'mm', 'np',
]);

// Eccezioni alle wildcard (`!suffix`): rendono il suffisso un dominio registrabile invece che pubblico.
const EXCEPTION = new Set([
  'www.ck',
]);

// `host` dev'essere già in forma ascii/punycode minuscola e senza porta. Ritorna { registrable, publicSuffix, sld, labels } o null per input invalido (IP, vuoto, singola etichetta).
function getDomainInfo(host) {
  if (!host || typeof host !== 'string') return null;
  host = host.replace(/\.$/, '').toLowerCase();
  if (!host || host.includes(' ')) return null;
  if (isIpAddress(host)) {
    return { registrable: host, publicSuffix: '', sld: host, labels: [host], isIp: true };
  }
  const labels = host.split('.');
  if (labels.length < 2) {
    // Singola etichetta ("localhost"): nessun dominio registrabile.
    return { registrable: host, publicSuffix: host, sld: host, labels, single: true };
  }

  // Si cerca dalla regola più specifica (più etichette) alla meno specifica.
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
    // Wildcard: se la parte dopo la prima etichetta del candidato è una wildcard, allora candidate è un public suffix.
    const parent = labels.slice(i + 1).join('.');
    if (parent && WILDCARD.has(parent)) {
      suffixLabels = labels.length - i;
      break;
    }
  }
  // Regola implicita "*": se nessuna regola combacia, il public suffix è il TLD.
  if (suffixLabels === 0) suffixLabels = 1;

  const regLabels = suffixLabels + 1;
  if (labels.length < regLabels) {
    // Il dominio è esattamente un public suffix ("co.uk" da solo): nessun registrabile.
    const ps = labels.join('.');
    return { registrable: ps, publicSuffix: ps, sld: '', labels, suffixOnly: true };
  }
  const registrable = labels.slice(labels.length - regLabels).join('.');
  const publicSuffix = labels.slice(labels.length - suffixLabels).join('.');
  const sld = labels[labels.length - regLabels]; // etichetta "di brand"
  return { registrable, publicSuffix, sld, labels };
}

function isIpAddress(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((n) => Number(n) <= 255);
  }
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':') && /^[0-9a-f:]+$/i.test(h)) return true;
  return false;
}

module.exports = { getDomainInfo, isIpAddress };
