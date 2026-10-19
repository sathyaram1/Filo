// «Stesso sito», una definizione sola per main e pagine: il dominio registrabile secondo la Public Suffix List intera
// (ICANN in pslIcann.js, privata in src/vendor/public-suffix-list), e se una voce è un suffisso pubblico o una
// piattaforma. Un'altra lista di suffissi non si scrive, si estende questa. Sentinella: tests/unit/stessoSito.test.mjs.

(function (global) {
  'use strict';

  // Nel main e nei test i dati li porta require; nelle pagine li carica prima un <script>.
  const ICANN = global.SN_PSL_ICANN || require('./pslIcann.js');
  const PRIVATA = global.SN_PSL_PRIVATA || require('../vendor/public-suffix-list/privata.js');

  // Regole a più etichette. Una a un'etichetta non serve: la regola implicita "*" fa di ogni TLD un suffisso.
  // Senza la lista intera, due negozi sotto .com.pg o due siti sotto chiyoda.tokyo.jp sarebbero un sito solo (#796).
  const NORMAL = new Set();
  const WILDCARD = new Set();
  const EXCEPTION = new Set();
  for (const riga of ICANN.trim().split('\n')) {
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
  for (const r of PRIVATA.rules) {
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
  // Così i secchi di Google Cloud Storage, <secchio>.storage.googleapis.com: per la PSL sarebbero tutti storage.googleapis.com.
  const GCS = /^(?:storage|commondatastorage)\.googleapis\.com$/;
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
  // Così la regione di Amazon (eu-west-1.amazonaws.com) non è un cliente: senza, s3.eu-west-1.amazonaws.com/<secchio>/…,
  // che consegna i secchi di tutti, avrebbe per sito la regione, e la regione si potrebbe proporre come sito preciso.
  const AWS_REGIONE = /^[a-z]{2}(?:-gov|-iso[a-z]?)?-[a-z]+-\d+\.amazonaws\.com$/;
  // Così Backblaze nella forma di S3, <secchio>.s3.<regione>.backblazeb2.com: senza, ogni secchio è backblazeb2.com.
  const B2_REGIONE = /^s3\.[a-z0-9-]+\.backblazeb2\.com$/;

  // Estrae l'eTLD+1 (dominio registrabile) e il public suffix da un hostname già ASCII, minuscolo e senza porta.
  // `soloPsl`: solo le piattaforme che il web separa (cookie); senza, anche quelle che separa solo il giudizio.
  // Ritorna { registrable, publicSuffix, sld, labels } oppure null per un host vuoto o con spazi.
  function getDomainInfo(host, { soloPsl = false } = {}) {
    if (!host || typeof host !== 'string') return null;
    host = host.replace(/\.$/, '').toLowerCase();
    if (!host || host.includes(' ')) return null;
    if (isIpAddress(host)) {
      return { registrable: host, publicSuffix: '', sld: host, labels: [host], isIp: true };
    }
    const labels = host.split('.');
    if (labels.length < 2) {
      // Singola etichetta (es. "localhost"): nessun dominio registrabile.
      return { registrable: host, publicSuffix: host, sld: host, labels, single: true };
    }

    // Dalla regola più specifica (più etichette) alla meno specifica.
    let suffixLabels = 0;
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
      const soloAvviso = !soloPsl && (PRIVATE_AVVISO.has(candidate) || COGNITO.test(candidate) || GCS.test(candidate)
        || AZURE_ZONA.test(candidate) || AWS_REGIONE.test(candidate) || B2_REGIONE.test(candidate));
      const psl = PRIVATE_PSL.has(candidate) && (soloPsl || !DEL_MARCHIO.has(candidate));
      if (i > 0 && (psl || S3.test(candidate) || soloAvviso)) {
        suffixLabels = labels.length - i;
        ospitato = true;
        break;
      }
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
    // Regola implicita "*": se nessuna regola combacia, il TLD è il public suffix.
    if (suffixLabels === 0) suffixLabels = 1;

    const regLabels = suffixLabels + 1;
    if (labels.length < regLabels) {
      // Il dominio è esattamente un public suffix (es. "co.uk" da solo).
      const ps = labels.join('.');
      return { registrable: ps, publicSuffix: ps, sld: '', labels, suffixOnly: true };
    }
    const registrable = labels.slice(labels.length - regLabels).join('.');
    const publicSuffix = labels.slice(labels.length - suffixLabels).join('.');
    const sld = labels[labels.length - regLabels];
    return { registrable, publicSuffix, sld, labels, ospitato };
  }

  function isIpAddress(host) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return host.split('.').every((n) => Number(n) <= 255);
    }
    const h = String(host).replace(/^\[|\]$/g, '');
    return h.includes(':') && /^[0-9a-f:]+$/i.test(h);
  }

  // L'host di un indirizzo o di un host nudo, in ASCII (münchen.de → xn--mnchen-3ya.de); '' se non ce n'è uno.
  function hostDi(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return '';
    let u = null;
    try { u = new URL(s); } catch (_) {
      try { u = new URL(`http://${s}`); } catch (__) { return ''; }
    }
    return String(u.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  }

  const opzioni = (opz) => ({ soloPsl: !(opz && opz.tutteLePiattaforme) });

  // Il sito di un indirizzo o di un host nudo: il dominio registrabile, un IP o localhost interi; null senza un host.
  // Di serie è il sito dei cookie (un blog su wordpress.com è wordpress.com); `tutteLePiattaforme` separa anche gli
  // ospiti delle piattaforme che il web non separa, per chi decide di fidarsi (programmi scaricati).
  function sitoDi(url, opz) {
    const host = hostDi(url);
    if (!host) return null;
    const info = getDomainInfo(host, opzioni(opz));
    return info ? info.registrable || null : null;
  }

  function stessoSito(a, b, opz) {
    const sito = sitoDi(a, opz);
    return !!sito && sitoDi(b, opz) === sito;
  }

  // Qui sotto nessun nome è il sito di qualcuno: sono gli indirizzi che servono i file di tutti per percorso
  // (release-assets.githubusercontent.com dà le release di ogni utente GitHub). Solo per il giudizio, mai per i cookie.
  const CONDIVISI = ['githubusercontent.com', 'googleusercontent.com', 'dropboxusercontent.com',
    'github-production-release-asset-2e65be.s3.amazonaws.com', 'bbuseruploads.s3.amazonaws.com'];
  // Questi lo sono da soli, non coi nomi sotto: storage.googleapis.com/<secchio>/… è di tutti, <secchio>.storage… è di uno.
  // Anche dentro un sito di un'azienda sola: Google Drive e gli allegati di Discord consegnano ciò che chiunque condivide.
  const CONDIVISI_HOST = new Set(['storage.googleapis.com', 'commondatastorage.googleapis.com',
    'storage-download.googleapis.com', 'firebasestorage.googleapis.com', 'www.googleapis.com',
    'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com', 'sites.google.com',
    'cdn.discordapp.com', 'media.discordapp.net']);
  // I file dei clienti di Backblaze, per numero di gruppo (f000…) o per regione nella forma di S3.
  const CONDIVISI_FORMA = /^(?:f\d+|s3\.[a-z0-9-]+)\.backblazeb2\.com$/;
  function condiviso(voce) {
    const host = hostDi(voce).replace(/\.+$/, '');
    return !!host && (CONDIVISI_HOST.has(host) || CONDIVISI_FORMA.test(host)
      || CONDIVISI.some((c) => host === c || host.endsWith(`.${c}`)));
  }

  // Una voce che non è il sito di nessuno: un suffisso pubblico (co.uk) o una piattaforma che ospita i siti di chiunque
  // (github.io), sotto cui ogni nome è di qualcun altro; per il giudizio anche un indirizzo che serve i file di tutti.
  function piattaforma(voce, opz) {
    const host = hostDi(voce).replace(/\.+$/, '');
    if (!host || isIpAddress(host)) return false;
    if (opz && opz.tutteLePiattaforme && condiviso(host)) return true;
    const sito = sitoDi(host, opz);
    return !!sito && sitoDi(`x.${host}`, opz) !== sito;
  }

  function suffissoPubblico(d) {
    try { return !!(getDomainInfo(d, { soloPsl: true }) || {}).suffixOnly; } catch (_) { return false; }
  }

  const contiene = (voci, v) => (voci instanceof Set ? Set.prototype.has.call(voci, v)
    : Array.isArray(voci) && voci.some((d) => String(d || '').toLowerCase() === v));

  // Il sito di una voce scritta a mano: webmail.libero.it vale per libero.it, il vaso di cookie è uno per sito.
  // null per una voce suffisso (gov.it): quella vale per i siti sotto di lei (vedi copertura).
  const sitiDelleVoci = new Map();
  function sitoDellaVoce(voce) {
    const v = String(voce || '').toLowerCase();
    if (!sitiDelleVoci.has(v)) {
      if (sitiDelleVoci.size > 5000) sitiDelleVoci.clear();
      sitiDelleVoci.set(v, v && !suffissoPubblico(v) ? sitoDi(v) : null);
    }
    return sitiDelleVoci.get(v);
  }
  const vociDi = (voci) => (voci instanceof Set ? Set.prototype.values.call(voci) : Array.isArray(voci) ? voci : []);

  // Un elenco di siti salvato come lo usa Filo: ogni voce al suo sito, senza doppioni; una voce che non ha un sito
  // (un suffisso salvato prima, una riga che non è un sito) resta com'è, perché copertura la trova ancora.
  function sitiDelleVociIn(voci) {
    const out = [];
    for (const x of vociDi(voci)) {
      if (typeof x !== 'string' || !x.trim()) continue;
      const v = sitoDellaVoce(x.trim()) || x.trim().toLowerCase();
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  // Una voce salvata quando il suo dominio contava come un sito solo (gov.it, com.co prima della lista pubblica intera)
  // oggi è un suffisso pubblico: copre ancora i siti sotto di lei, se no la scelta dell'utente smette di valere in silenzio.
  function copertura(sito, voci) {
    if (!sito) return null;
    if (contiene(voci, sito)) return sito;
    for (const d of vociDi(voci)) if (sitoDellaVoce(d) === sito) return d;
    if (isIpAddress(sito)) return null;
    const parti = sito.split('.');
    for (let i = 1; i < parti.length; i++) {
      const s = parti.slice(i).join('.');
      if (contiene(voci, s) && suffissoPubblico(s)) return s;
    }
    return null;
  }

  // La voce di un elenco salvato (fidati, banner, regole di paese…) che vale per `url`, o null. Un elenco di siti si
  // interroga da qui, non col confronto esatto sul sito.
  function voceSalvata(url, voci) {
    return copertura(sitoDi(url), voci);
  }

  // Un elenco di siti che risponde a has() come voceSalvata: per chi lo passa a regole che lo trattano come un Set.
  class ElencoSiti extends Set {
    has(sito) { return super.has(sito) || copertura(String(sito || '').toLowerCase(), this) !== null; }
  }

  const api = {
    getDomainInfo, isIpAddress, hostDi, sitoDi, stessoSito, piattaforma, condiviso, sitoDellaVoce, sitiDelleVociIn, voceSalvata,
    ElencoSiti, S3, PRIVATE_AVVISO, DEL_MARCHIO,
  };
  global.SN_STESSO_SITO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
