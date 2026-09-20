// Il testo che Filo ha LETTO per il modello (pagine, documenti, uscita dei
// comandi), tenuto solo per riconoscerlo se riparte dentro un indirizzo.
// Non è memoria dell'utente, non si salva su disco, muore con l'app.

'use strict';

// Tanto quanto un modello si tiene davanti: venti letture piene stanno sotto
// questo tetto, e oltre non serve perché il testo più vecchio dal contesto è
// già uscito.
const MAX_CHARS = 400 * 1000;

let corpus = '';

/** Solo lettere e cifre minuscole: il confronto avviene su questa forma. */
function normalizza(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ricorda(testo) {
  const t = normalizza(testo);
  if (!t) return;
  corpus += t;
  if (corpus.length > MAX_CHARS) corpus = corpus.slice(corpus.length - MAX_CHARS);
}

function letto() {
  return corpus;
}

function azzera() {
  corpus = '';
}

module.exports = { ricorda, letto, azzera, MAX_CHARS };
