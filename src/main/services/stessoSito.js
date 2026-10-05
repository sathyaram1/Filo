// La definizione unica di «stesso sito»: il dominio registrabile, piattaforme della sezione privata della PSL comprese
// (alice.github.io e bob.github.io sono due siti), un IP o localhost interi. Cookie e impronte passano da qui: un'altra
// lista di suffissi non si scrive, si estende safebrowse/psl.js. Sentinella: tests/unit/stessoSito.test.mjs.

'use strict';

const { normalize } = require('./safebrowse/normalize');

// `url`: un indirizzo o un host nudo. null se non c'è un host (about:, data:).
function sitoDi(url) {
  try {
    const norm = normalize(url, { soloPsl: true });
    if (norm && norm.registrable) return norm.registrable;
  } catch (_) {}
  try { return new URL(url).hostname.toLowerCase() || null; } catch (_) { return null; }
}

module.exports = { sitoDi };
