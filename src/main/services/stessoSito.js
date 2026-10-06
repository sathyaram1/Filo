// La definizione unica di «stesso sito»: il dominio registrabile, piattaforme della sezione privata della PSL comprese
// (alice.github.io e bob.github.io sono due siti), un IP o localhost interi. Cookie e impronte passano da qui: un'altra
// lista di suffissi non si scrive, si estende safebrowse/psl.js. Sentinella: tests/unit/stessoSito.test.mjs.

'use strict';

const { normalize } = require('./safebrowse/normalize');
const { getDomainInfo, isIpAddress } = require('./safebrowse/psl');

// `url`: un indirizzo o un host nudo. null se non c'è un host (about:, data:).
function sitoDi(url) {
  try {
    const norm = normalize(url, { soloPsl: true });
    if (norm && norm.registrable) return norm.registrable;
  } catch (_) {}
  try { return new URL(url).hostname.toLowerCase() || null; } catch (_) { return null; }
}

function suffissoPubblico(d) {
  try { return !!(getDomainInfo(d, { soloPsl: true }) || {}).suffixOnly; } catch (_) { return false; }
}

const contiene = (voci, v) => (voci instanceof Set ? Set.prototype.has.call(voci, v)
  : Array.isArray(voci) && voci.some((d) => String(d || '').toLowerCase() === v));

// Una voce salvata quando il suo dominio contava come un sito solo (gov.it, com.co prima della lista pubblica intera)
// oggi è un suffisso pubblico: copre ancora i siti sotto di lei, se no la scelta dell'utente smette di valere in silenzio.
function copertura(sito, voci) {
  if (!sito) return null;
  if (contiene(voci, sito)) return sito;
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

module.exports = { sitoDi, voceSalvata, ElencoSiti };
