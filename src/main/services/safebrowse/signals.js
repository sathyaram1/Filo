// Stage 3: segnali deterministici locali (sincroni, istantanei).
//
// Calcola, dal solo dominio normalizzato (+ opzionali indizi di pagina), i
// segnali su cui poggia il giudizio. I segnali nel CONTENUTO della pagina
// (password, contenuto misto) sono solo RINFORZO: arrivano dal chiamante via
// `ctx` e non sono mai l'unica base di un avviso ad alta gravità.
//
// Tipi di impersonazione (vedi spec):
//   strict  — confusable (omoglifi UTS-39) o typo puro sulla label di brand.
//             Da solo basta per "Pericoloso".
//   broad   — combosquat (brand + altre parole), nome esatto su suffisso non
//             ufficiale, brand come sottodominio con eTLD+1 altro, o typo su un
//             marchio `unaLetteraAvvisa`. → "Sospetto".

'use strict';

const { BRANDS, PAROLE, legitBrandOf } = require('./brands');
const { skeleton, skeletonCoppie } = require('./confusables');

const PAROLE_VERE = new Set(PAROLE);
const PAROLE_SKEL = PAROLE.map(skeleton);
// Sotto questa lunghezza un nome sta dentro troppe parole: conta solo in testa o in coda a un pezzo fra trattini.
const TOKEN_CORTO = 5;

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

// La label usa il nome del marchio fuori da una parola vera (infoposte sì, imposte no). Una parola vera non scavalca
// un trattino (poste-rimborso non è poster), il nome sì (p-a-y-p-a-l).
function usaIlMarchio(label, token) {
  const t = skeleton(token);
  if (!t) return false;
  const pezzi = label.split(/[^\p{L}\p{N}]+/u).map(skeleton).filter(Boolean);
  if (token.length < TOKEN_CORTO) {
    return pezzi.some((p) => p === t
      || (p.startsWith(t) && !dentroUnaParola(p, 0, t.length))
      || (p.endsWith(t) && !dentroUnaParola(p, p.length - t.length, t.length)));
  }
  const s = pezzi.join('');
  for (let i = s.indexOf(t); i !== -1; i = s.indexOf(t, i + 1)) {
    let inizio = 0;
    const pezzo = pezzi.find((p) => { const dentro = i >= inizio && i + t.length <= inizio + p.length; if (!dentro) inizio += p.length; return dentro; });
    if (!pezzo || !dentroUnaParola(pezzo, i - inizio, t.length)) return true;
  }
  return false;
}

function dentroUnaParola(s, i, n) {
  return PAROLE_SKEL.some((w) => {
    for (let j = s.indexOf(w); j !== -1 && j <= i; j = s.indexOf(w, j + 1)) {
      if (j + w.length >= i + n) return true;
    }
    return false;
  });
}

// Un indirizzo ufficiale intero davanti a un dominio altrui: posteitaliane.it.accesso.net, login-office-com.x.net.
function ufficialeNelSottodominio(subLabels, brand) {
  const punti = '.' + subLabels.join('.') + '.';
  const trattini = punti.replace(/-/g, '.');
  return brand.domains.some((d) => punti.includes('.' + d + '.')
    || (d.split('.')[0].length >= 4 && trattini.includes('.' + d + '.')));
}

// Cerca la migliore corrispondenza di impersonazione fra i brand noti.
// Ritorna { strict, broad } dove ciascuno è null o { brand, reason, ... }.
function matchBrands(norm) {
  // Confronti SEMPRE sulla forma Unicode decodificata (un dominio camuffato in
  // punycode, es. xn--80ak6aa92e, va confrontato per ciò che mostra: "аррӏе").
  const sld = (norm.sldUnicode || norm.sld || '').toLowerCase();
  const sldSkel = skeleton(sld);
  const sldCoppie = skeletonCoppie(sld);
  const uLabels = (norm.hostUnicode || norm.host || '').split('.');
  const regLabelCount = norm.registrable ? norm.registrable.split('.').length : 1;
  const subLabels = uLabels.slice(0, Math.max(0, uLabels.length - regLabelCount));
  // Il sito vero di un marchio non imita nessun altro marchio (paypal.poste.it non esiste, ma nemmeno il suo avviso).
  if (legitBrandOf(norm.host, norm.registrable)) return { strict: null, broad: null };

  let strict = null;
  let broad = null;

  for (const brand of BRANDS) {
    if (brand.gestori && brand.gestori.includes(norm.registrable)) continue;
    const token = brand.token;
    const tokenSkel = skeleton(token);

    // ── STRICT: confusable (stesso scheletro, stringa diversa) ──────────
    if (!strict && sld !== token && sldSkel && (sldSkel === tokenSkel || sldCoppie === tokenSkel)) {
      strict = { brand, reason: 'confusable', sld };
      continue;
    }
    // ── STRICT: typo puro (bassa distanza di edit sulla label) ──────────
    // Non sul nome di un sito ospitato (email.github.io) né su una parola vera (cloud.it, mail.com, post.ch).
    if (!strict && sld !== token && !norm.ospitato && !PAROLE_VERE.has(sld)) {
      const th = typoThreshold(token.length);
      if (th > 0 && Math.abs(sld.length - token.length) <= th) {
        const dist = osaDistance(sld, token);
        if (dist > 0 && dist <= th && brand.unaLetteraAvvisa) { if (!broad) broad = { brand, reason: 'typo', sld, distance: dist }; continue; }
        if (dist > 0 && dist <= th) { strict = { brand, reason: 'typo', sld, distance: dist }; continue; }
      }
    }

    // ── BROAD: nome esatto su suffisso non ufficiale ────────────────────
    // Una sigla di tre lettere è il nome di troppe cose (bnl.gov è un laboratorio).
    if (!broad && sld === token && token.length > 3) { broad = { brand, reason: 'exact_other_tld', sld }; continue; }
    // ── BROAD: combosquat (token come sottostringa insieme ad altro) ────
    if (!broad && sld.length > token.length && usaIlMarchio(sld, token)) {
      broad = { brand, reason: 'combosquat', sld }; continue;
    }
    // ── BROAD: brand nel sottodominio mentre l'eTLD+1 è altro ────────────
    // Da solo, fra trattini, attaccato ad altre parole o come indirizzo ufficiale intero (#725.8).
    if (!broad && subLabels.length) {
      const lbl = subLabels.find((l) => usaIlMarchio(l, token));
      if (lbl) { broad = { brand, reason: 'subdomain', sld: lbl }; continue; }
      if (ufficialeNelSottodominio(subLabels, brand)) { broad = { brand, reason: 'subdomain', sld: subLabels.join('.') }; continue; }
    }
  }
  // Strict prevale: se c'è strict, ignoriamo il broad dello stesso giro.
  return { strict, broad: strict ? null : broad };
}

// Doppia estensione eseguibile nell'URL (es. fattura.pdf.exe): forte indizio
// di download ingannevole.
const DOUBLE_EXT = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|pptx?|txt|csv|zip|rar|mp[34]|avi|html?)\.(exe|scr|bat|cmd|com|pif|vbs|vbe|js|jar|msi|apk|dmg|ps1|hta|cpl)(\?|#|$)/i;

// Calcola i segnali deterministici locali. `norm` = output di normalize().
// `ctx` = indizi opzionali (mai unica base): { hasPassword, hasPayment,
// mixedContent, autoDownload, linkOrigin, urlPath }.
function localSignals(norm, ctx = {}) {
  const out = [];
  if (!norm || !norm.ok) return out;

  if (!norm.isIp && !norm.single && !norm.suffixOnly) {
    const { strict, broad } = matchBrands(norm);
    if (strict) out.push({ kind: 'strict_impersonation', ...strict });
    else if (broad) out.push({ kind: 'broad_impersonation', ...broad });
  }

  // Trasporto non sicuro (rinforzo). Gli IP locali/loopback non contano.
  if (!norm.secure && norm.protocol === 'http') {
    out.push({ kind: 'insecure_transport' });
  }

  // Doppia estensione nell'URL.
  const path = ctx.urlPath || '';
  if (path && DOUBLE_EXT.test(path)) out.push({ kind: 'double_extension' });

  // Indizi di pagina (solo rinforzo).
  if (ctx.hasPassword) out.push({ kind: 'sensitive_input', field: 'password' });
  else if (ctx.hasPayment) out.push({ kind: 'sensitive_input', field: 'payment' });
  if (ctx.mixedContent) out.push({ kind: 'mixed_content' });
  if (ctx.autoDownload) out.push({ kind: 'auto_download' });

  return out;
}

module.exports = { localSignals, matchBrands, osaDistance };
