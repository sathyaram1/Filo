// Segnali deterministici locali, sincroni, dal solo dominio normalizzato.
// Quelli che vengono dal CONTENUTO della pagina arrivano via `ctx` e sono solo RINFORZO.
// Impersonazione strict (omoglifi o typo puro) basta per «pericoloso»; broad dà «sospetto».

'use strict';

const { BRANDS } = require('./brands');
const { skeleton } = require('./confusables');

// Damerau-Levenshtein: la trasposizione di due adiacenti conta 1, così «amzaon» dista 1 da
// «amazon».
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

// Brand corti: distanza 1 e solo da 5 lettere in su (evita «wise»↔«wine»); brand lunghi fino
// a 2.
function typoThreshold(tokenLen) {
  if (tokenLen < 5) return 0;     // troppo corto: il typo è indistinguibile dal caso
  if (tokenLen >= 8) return 2;
  return 1;
}

// Migliore corrispondenza fra i brand noti: { strict, broad }, ciascuno null o un oggetto.
function matchBrands(norm) {
  // Confronti SEMPRE sulla forma Unicode decodificata: un dominio in punycode va confrontato
  // per quello che mostra.
  const sld = (norm.sldUnicode || norm.sld || '').toLowerCase();
  const sldSkel = skeleton(sld);
  const uLabels = (norm.hostUnicode || norm.host || '').split('.');
  const regLabelCount = norm.registrable ? norm.registrable.split('.').length : 1;
  const subLabels = uLabels.slice(0, Math.max(0, uLabels.length - regLabelCount));

  let strict = null;
  let broad = null;

  for (const brand of BRANDS) {
    // Non flaggare mai i domini legittimi del brand stesso.
    if (brand.domains.includes(norm.registrable)) return { strict: null, broad: null };
    const token = brand.token;
    const tokenSkel = skeleton(token);

    if (!strict && sld !== token && sldSkel && sldSkel === tokenSkel) {
      strict = { brand, reason: 'confusable', sld };
      continue;
    }
    if (!strict && sld !== token) {
      const th = typoThreshold(token.length);
      if (th > 0 && Math.abs(sld.length - token.length) <= th) {
        const dist = osaDistance(sld, token);
        if (dist > 0 && dist <= th) { strict = { brand, reason: 'typo', sld, distance: dist }; continue; }
      }
    }

    if (!broad && sld === token) { broad = { brand, reason: 'exact_other_tld', sld }; continue; }
    if (!broad && sld.length > token.length && (sld.includes(token) || sldSkel.includes(tokenSkel))) {
      broad = { brand, reason: 'combosquat', sld }; continue;
    }
    if (!broad && subLabels.length) {
      for (const lbl of subLabels) {
        if (lbl === token || skeleton(lbl) === tokenSkel) { broad = { brand, reason: 'subdomain', sld: lbl }; break; }
      }
    }
  }
  // Strict prevale: se c'è strict si ignora il broad dello stesso giro.
  return { strict, broad: strict ? null : broad };
}

// Doppia estensione eseguibile (fattura.pdf.exe): indizio forte di download ingannevole.
const DOUBLE_EXT = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|pptx?|txt|csv|zip|rar|mp[34]|avi|html?)\.(exe|scr|bat|cmd|com|pif|vbs|vbe|js|jar|msi|apk|dmg|ps1|hta|cpl)(\?|#|$)/i;

// `ctx`: indizi opzionali, mai unica base — { hasPassword, hasPayment, mixedContent,
// autoDownload, linkOrigin, urlPath }.
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

  const path = ctx.urlPath || '';
  if (path && DOUBLE_EXT.test(path)) out.push({ kind: 'double_extension' });

  // Indizi di pagina: solo rinforzo.
  if (ctx.hasPassword) out.push({ kind: 'sensitive_input', field: 'password' });
  else if (ctx.hasPayment) out.push({ kind: 'sensitive_input', field: 'payment' });
  if (ctx.mixedContent) out.push({ kind: 'mixed_content' });
  if (ctx.autoDownload) out.push({ kind: 'auto_download' });

  return out;
}

module.exports = { localSignals, matchBrands, osaDistance };
