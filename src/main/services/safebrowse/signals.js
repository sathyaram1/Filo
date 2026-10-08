// Stage 3: segnali deterministici locali (sincroni, istantanei).
//
// Calcola, dal solo dominio normalizzato (+ opzionali indizi di pagina), i
// segnali su cui poggia il giudizio. I segnali nel CONTENUTO della pagina
// (password, modulo in chiaro) sono solo RINFORZO: arrivano dal chiamante via
// `ctx` e non sono mai l'unica base di un avviso ad alta gravità.
//
// Tipi di impersonazione (vedi spec):
//   strict    — confusable (omoglifi UTS-39) o typo di una lettera su un brand lungo.
//               Da solo basta per "Pericoloso".
//   weak_typo — typo su un brand corto, o di due lettere su uno lungo: da solo vale "Sospetto".
//   broad     — combosquat (brand + altre parole), nome esatto su suffisso non
//               ufficiale, o brand come sottodominio con eTLD+1 altro. → "Sospetto".

'use strict';

const { BRANDS } = require('./brands');
const { skeleton } = require('./confusables');

// Distanza di Damerau-Levenshtein (OSA): conta sostituzione/inserzione/
// cancellazione = 1 e la trasposizione di due adiacenti = 1 (così "amzaon" dista
// 1 da "amazon", non 2 come nella Levenshtein semplice).
function osaDistance(a, b) {
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d = [];
  for (let i = 0; i <= al; i++) { d[i] = new Array(bl + 1).fill(0); d[i][0] = i; }
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

// Soglia di typo accettata per la lunghezza del brand. Brand corti → solo
// distanza 1 e solo se lunghi almeno 5 (evita "wise"↔"wine"). Brand lunghi →
// fino a 2.
function typoThreshold(tokenLen) {
  if (tokenLen < 5) return 0;     // troppo corto: il typo è indistinguibile dal caso
  if (tokenLen >= 8) return 2;
  return 1;
}

// #728 — il typo da solo blocca solo a una lettera da un brand lungo: sotto, o a due
// lettere, è quasi sempre una parola comune (team/steam, email/gmail, telegraph/telegram)
// e avvisa, bloccando solo con un secondo segnale.
const TYPO_BLOCCO_MIN_LEN = 8;

// «rn» e «vv» a occhio sono «m» e «w»: sono una lettera sola anche per il blocco (instagrarn, rnicrosoft).
function typoBloccante(sld, token, dist) {
  if (token.length < TYPO_BLOCCO_MIN_LEN) return false;
  return dist === 1 || osaDistance(sld.replace(/rn/g, 'm').replace(/vv/g, 'w'), token) <= 1;
}

// Cerca la migliore corrispondenza di impersonazione fra i brand noti.
// Ritorna { strict, weak, broad } dove ciascuno è null o { brand, reason, ... }.
function matchBrands(norm) {
  // Confronti SEMPRE sulla forma Unicode decodificata (un dominio camuffato in
  // punycode, es. xn--80ak6aa92e, va confrontato per ciò che mostra: "аррӏе").
  const sld = (norm.sldUnicode || norm.sld || '').toLowerCase();
  const sldSkel = skeleton(sld);
  const uLabels = (norm.hostUnicode || norm.host || '').split('.');
  const regLabelCount = norm.registrable ? norm.registrable.split('.').length : 1;
  const subLabels = uLabels.slice(0, Math.max(0, uLabels.length - regLabelCount));

  let strict = null;
  let weak = null;
  let broad = null;

  for (const brand of BRANDS) {
    // Non flaggare mai i domini legittimi del brand stesso.
    if (brand.domains.includes(norm.registrable)) return { strict: null, weak: null, broad: null };
    const token = brand.token;
    const tokenSkel = skeleton(token);

    // ── STRICT: confusable (stesso scheletro, stringa diversa) ──────────
    if (!strict && sld !== token && sldSkel && sldSkel === tokenSkel) {
      strict = { brand, reason: 'confusable', sld };
      continue;
    }
    // ── TYPO puro (bassa distanza di edit sulla label) ──────────────────
    // Non sul nome di un sito ospitato: lì è una parola scelta dall'utente (email.github.io, team.netlify.app).
    if (!strict && sld !== token && !norm.ospitato) {
      const th = typoThreshold(token.length);
      if (th > 0 && Math.abs(sld.length - token.length) <= th) {
        const dist = osaDistance(sld, token);
        if (dist > 0 && dist <= th) {
          const hit = { brand, reason: 'typo', sld, distance: dist };
          if (typoBloccante(sld, token, dist)) strict = hit;
          else if (!weak) weak = hit;
          continue;
        }
      }
    }

    // ── BROAD: nome esatto su suffisso non ufficiale ────────────────────
    if (!broad && sld === token) { broad = { brand, reason: 'exact_other_tld', sld }; continue; }
    // ── BROAD: combosquat (token come sottostringa insieme ad altro) ────
    if (!broad && sld.length > token.length && (sld.includes(token) || sldSkel.includes(tokenSkel))) {
      broad = { brand, reason: 'combosquat', sld }; continue;
    }
    // ── BROAD: brand come sottodominio mentre l'eTLD+1 è altro ───────────
    if (!broad && subLabels.length) {
      for (const lbl of subLabels) {
        if (lbl === token || skeleton(lbl) === tokenSkel) { broad = { brand, reason: 'subdomain', sld: lbl }; break; }
      }
    }
  }
  // Il segnale più forte prevale: gli altri dello stesso giro si ignorano.
  return { strict, weak: strict ? null : weak, broad: (strict || weak) ? null : broad };
}

// Un programma con il nome di un documento (fattura.pdf.exe): conta l'ultima estensione, decisa dalla stessa lista che
// mette la domanda sugli scaricamenti (#588), e quella prima deve essere di un file che si apre per leggerlo.
const ESE = globalThis.SN_ESEGUIBILI || (require('../../../shared/eseguibili.js'), globalThis.SN_ESEGUIBILI);
// Le estensioni dei file che si aprono per guardarli (documenti, immagini, audio, video, archivi): un elenco largo, perché
// il travestimento usa quella che ispira fiducia; i pezzi di versione (setup.2.1.exe, x64) non ci sono.
const DOCUMENTO = new Set((
  'pdf doc docx docm dot dotx xls xlsx xlsm xlsb ppt pptx pptm pps ppsx odt ods odp odg rtf txt csv tsv md xml json ' +
  'htm html xps oxps epub mobi pages numbers key eml msg ics vcf ' +
  'jpg jpeg jpe png gif bmp tif tiff webp heic heif avif svg ico psd raw cr2 nef ' +
  'mp3 wav flac aac ogg oga m4a wma opus aif aiff mid midi ' +
  'mp4 m4v mkv avi mov wmv flv webm mpg mpeg 3gp vob m2ts srt ' +
  'zip rar 7z tar gz tgz bz2 xz'
).split(' '));

function doppiaEstensione(nome) {
  const pulito = ESE.nomeVisibile(nome).replace(/[.\s\u00a0]+$/, '');
  if (!ESE.eEseguibile(pulito)) return false;
  // Spazi e punti in più prima dell'estensione vera (fattura.pdf      .exe, fattura.pdf..exe) non la nascondono qui.
  const parti = pulito.split('.').map((p) => p.replace(/[\s\u00a0]+/g, ''));
  const prima = parti.slice(0, -1).filter(Boolean);
  return prima.length >= 2 && DOCUMENTO.has(prima[prima.length - 1].toLowerCase());
}

function ultimoPezzo(percorso) {
  let p = String(percorso || '');
  try { p = decodeURIComponent(p); } catch (_) {}
  return p.split('/').pop() || '';
}

// Calcola i segnali deterministici locali. `norm` = output di normalize(). `ctx` = indizi della pagina e della scheda:
// { hasPassword, hasPayment, insecureForm, autoDownload (nome del programma partito da solo), downloadName (un file
// che la pagina ha fatto scaricare), urlPath }.
function localSignals(norm, ctx = {}) {
  const out = [];
  if (!norm || !norm.ok) return out;

  if (!norm.isIp && !norm.single && !norm.suffixOnly) {
    const { strict, weak, broad } = matchBrands(norm);
    if (strict) out.push({ kind: 'strict_impersonation', ...strict });
    else if (weak) out.push({ kind: 'weak_typo', ...weak });
    else if (broad) out.push({ kind: 'broad_impersonation', ...broad });
  }

  // Trasporto non sicuro (rinforzo). Gli IP locali/loopback non contano.
  if (!norm.secure && norm.protocol === 'http') {
    out.push({ kind: 'insecure_transport' });
  }

  const nell = ultimoPezzo(ctx.urlPath);
  if (doppiaEstensione(nell)) out.push({ kind: 'double_extension', name: nell, where: 'url' });
  else {
    const scaricato = [ctx.downloadName, ctx.autoDownload].find((n) => typeof n === 'string' && doppiaEstensione(n));
    if (scaricato) out.push({ kind: 'double_extension', name: scaricato, where: 'download' });
  }
  if (ctx.autoDownload) out.push({ kind: 'auto_download', name: typeof ctx.autoDownload === 'string' ? ctx.autoDownload : '' });

  // Indizi di pagina (solo rinforzo).
  if (ctx.hasPassword) out.push({ kind: 'sensitive_input', field: 'password' });
  else if (ctx.hasPayment) out.push({ kind: 'sensitive_input', field: 'payment' });
  if (ctx.insecureForm) out.push({ kind: 'insecure_form' });

  return out;
}

module.exports = { localSignals, matchBrands, osaDistance, doppiaEstensione };
