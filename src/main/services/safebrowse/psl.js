// Dominio registrabile (eTLD+1) di un host, secondo l'algoritmo di publicsuffix.org (regola più lunga, `*`, `!`).
// La Public Suffix List c'è intera: la sezione ICANN in pslIcann.js, la privata (le piattaforme che ospitano gli
// utenti) in src/vendor/public-suffix-list (`node scripts/aggiorna-psl.mjs`).

'use strict';

// Regole a più etichette. Una a un'etichetta non serve: la regola implicita "*" fa di ogni TLD un suffisso.
// Senza la lista intera, due negozi sotto .com.pg o due siti sotto chiyoda.tokyo.jp sarebbero un sito solo (#796).
const NORMAL = new Set();
const WILDCARD = new Set();
const EXCEPTION = new Set();
for (const riga of require('./pslIcann').trim().split('\n')) {
  const [tld, ...regole] = riga.trim().split(/\s+/);
  for (const r of regole) {
    if (r.startsWith('!')) EXCEPTION.add(`${r.slice(1)}.${tld}`);
    else if (r === '*') WILDCARD.add(tld);
    else if (r.startsWith('*.')) WILDCARD.add(`${r.slice(2)}.${tld}`);
    else NORMAL.add(`${r}.${tld}`);
  }
}

// Piattaforme dove ogni sottodominio è di un utente diverso: senza, `utente.github.io` diventa `github.io` («GitHub
// su .io») e un dominio in whitelist copre ogni pagina ospitata. L'host uguale alla piattaforma resta suo.
// Queste le separa già il web (sezione privata della PSL): valgono anche per i cookie della modalità privacy.
const PRIVATE_PSL = new Set();
const PRIVATE_WILDCARD = new Set();
const PRIVATE_EXCEPTION = new Set();
for (const r of require('../../../vendor/public-suffix-list/privata.json').rules) {
  if (r.startsWith('*.')) PRIVATE_WILDCARD.add(r.slice(2));
  else if (r.startsWith('!')) PRIVATE_EXCEPTION.add(r.slice(1));
  else PRIVATE_PSL.add(r);
}
// Nella PSL perché ogni sito tenga i suoi cookie, ma i siti sono tutti del marchio: per il giudizio restano il suo dominio.
const DEL_MARCHIO = new Set(['withgoogle.com', 'withyoutube.com']);
// Gli indirizzi di S3 per regione e da sito statico, uno per regione nella PSL: il secchio è il sito, non la regione.
const S3 = /^s3(?:[.-][a-z0-9-]+){0,3}\.amazonaws\.com$/;
// Così le pagine d'accesso di Cognito, <prefisso>.auth.<regione>.amazoncognito.com: il prefisso lo sceglie l'utente.
const COGNITO = /^auth(?:-fips)?\.[a-z0-9-]+\.amazoncognito\.com$/;
// Queste il web NON le separa (un login su wordpress.com vale sui blog): solo per il giudizio, mai per i cookie.
// Ci sta solo ciò che la PSL non ha (tests/unit/safebrowsePiattaforme.test.mjs).
const PRIVATE_AVVISO = new Set([
  'amazonaws.com', 'amazoncognito.com', 'googleusercontent.com', 'app.github.dev', 'sharepoint.com', 'wordpress.com',
  'medium.com', 'dropboxusercontent.com', 'glitch.me', 'neocities.org', 'weebly.com', 'weeblysite.com',
  'godaddysites.com', 'mystrikingly.com', 'jimdosite.com', 'jimdofree.com', 'mybluehost.me', 'zohosites.com',
  'odoo.com', 'webnode.page', 'webnode.com', 'webnode.it', 'mailchimpsites.com',
]);
// Azure mette una zona fra il cliente e il suffisso (<account>.z13.web.core.windows.net, <nome>.z01.azurefd.net,
// <vm>.<regione>.cloudapp.azure.com), che la PSL non descrive: per il giudizio la zona è della piattaforma. Senza, una
// macchina virtuale di chiunque passa per azure.com, che è in whitelist.
const AZURE_ZONA = /^(?:z\d+\.web\.core\.windows\.net|[a-z]\d+\.azurefd\.net|[a-z0-9-]+\.cloudapp\.azure\.com)$/;

// Estrae l'eTLD+1 (dominio registrabile) e il public suffix da un hostname.
// `host` deve già essere in forma ascii/punycode minuscola e senza porta.
// Ritorna { registrable, publicSuffix, sld, labels } oppure null per input
// invalido (IP, host vuoto, singola etichetta senza punto).
function getDomainInfo(host, { soloPsl = false } = {}) {
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
  let ospitato = false;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (EXCEPTION.has(candidate) || PRIVATE_EXCEPTION.has(candidate)) {
      // Eccezione: il public suffix è candidate MENO la prima etichetta.
      suffixLabels = labels.length - i - 1;
      ospitato = PRIVATE_EXCEPTION.has(candidate);
      break;
    }
    if (NORMAL.has(candidate)) {
      suffixLabels = labels.length - i;
      break;
    }
    const soloAvviso = !soloPsl && (PRIVATE_AVVISO.has(candidate) || COGNITO.test(candidate) || AZURE_ZONA.test(candidate));
    const psl = PRIVATE_PSL.has(candidate) && (soloPsl || !DEL_MARCHIO.has(candidate));
    if (i > 0 && (psl || S3.test(candidate) || soloAvviso)) {
      suffixLabels = labels.length - i;
      ospitato = true;
      break;
    }
    // Wildcard: se la parte DOPO la prima etichetta del candidato è una
    // wildcard, allora candidate è un public suffix.
    const parent = labels.slice(i + 1).join('.');
    // In `*.piattaforma` l'asterisco è il cliente: un host che è lui stesso quel suffisso resta suo.
    if (parent && PRIVATE_WILDCARD.has(parent)) {
      suffixLabels = labels.length - Math.max(i, 1);
      ospitato = true;
      break;
    }
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
  return { registrable, publicSuffix, sld, labels, ospitato };
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

module.exports = { getDomainInfo, isIpAddress, S3, PRIVATE_AVVISO, DEL_MARCHIO };
