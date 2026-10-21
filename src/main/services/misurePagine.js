// Indirizzo e titolo di una pagina li sceglie il sito: dove si conservano (filo, archivio delle schede chiuse) si
// misurano qui, e chi taglia lo segna accanto (#1525). Tutto il resto (messaggi, numero di eventi) non ha misura.

'use strict';

const MISURA = Object.freeze({ url: 8192, titolo: 1024 });

// Il taglio non spezza una coppia surrogata (un'emoji nel titolo): resterebbe mezzo carattere illeggibile.
function taglia(testo, n) {
  const s = String(testo == null ? '' : testo);
  if (s.length <= n) return { testo: s, tagliato: false };
  const fine = /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n;
  return { testo: s.slice(0, fine), tagliato: true };
}

module.exports = { MISURA, taglia };
