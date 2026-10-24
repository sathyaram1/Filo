// La cronologia dell'Aiuto la manda la pagina: un'immagine allegata dall'utente (#1623) passa solo come data: di
// un'immagine, mai come indirizzo che il fornitore del modello andrebbe a prendere. Sentinella: tests/unit/allegatiChat.test.mjs.

'use strict';

const IMMAGINE_IN_LINEA = /^data:image\/[a-z0-9.+-]+;base64,/i;

const parteBuona = (p) => !!p && (p.type === 'text'
  || (p.type === 'image_url' && IMMAGINE_IN_LINEA.test(String((p.image_url && p.image_url.url) || ''))));

function storiaAiuto(storia) {
  if (!Array.isArray(storia)) return [];
  return storia.map((m) => (m && Array.isArray(m.content) ? { ...m, content: m.content.filter(parteBuona) } : m));
}

module.exports = { storiaAiuto, IMMAGINE_IN_LINEA };
