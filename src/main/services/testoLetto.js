// Il testo che Filo ha LETTO per il modello (schede dell'utente, documenti,
// uscita dei comandi), tenuto solo per riconoscerlo se riparte dentro un
// indirizzo. Non è memoria dell'utente, non si salva su disco, muore con l'app.

'use strict';

// Tanto quanto un modello si tiene davanti: venti letture piene stanno sotto
// questo tetto, e oltre non serve perché il testo più vecchio dal contesto è
// già uscito.
const MAX_CHARS = 400 * 1000;

let pezzi = []; // { da, testo } — `da` è il sito da cui quel testo viene
let totale = 0;

/** Solo lettere e cifre minuscole: il confronto avviene su questa forma. */
function normalizza(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Il sito di un indirizzo, senza `www.`. PURA. Torna '' se non è un indirizzo. */
function sito(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}

function ricorda(testo, da = '') {
  const t = normalizza(testo);
  if (!t) return;
  pezzi.push({ da: sito(da), testo: t });
  totale += t.length;
  while (totale > MAX_CHARS && pezzi.length > 1) { totale -= pezzi.shift().testo.length; }
}

/**
 * Il testo letto che NON viene dal sito `verso`.
 *
 * Riportare a un sito le parole di quel sito non è portare fuori niente: il
 * titolo di un articolo sta anche dentro il suo indirizzo, e senza questo la
 * lettura del pezzo collegato chiedeva conferma come un'esfiltrazione (#553).
 */
function letto(verso = '') {
  const escluso = sito(verso);
  const utili = escluso ? pezzi.filter((p) => p.da !== escluso) : pezzi;
  return utili.map((p) => p.testo).join('');
}

function azzera() {
  pezzi = [];
  totale = 0;
}

module.exports = { ricorda, letto, azzera, MAX_CHARS };
