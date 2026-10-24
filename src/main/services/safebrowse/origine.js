// Da dove arriva una pagina, come lo legge il giudizio AI (solo il dominio, mai l'indirizzo intero). L'origine la
// registra la scheda a ogni navigazione (src/main/tabs/tabSafebrowse.js): { tipo: 'scritto'|'filo'|'link', da, gesto }.

'use strict';

const { normalize } = require('./normalize');

function dominio(url) {
  const n = normalize(url);
  return n && n.ok ? (n.registrableUnicode || n.registrable || n.host) : '';
}

function origineLink(origine, url) {
  if (!origine) return null;
  if (origine.tipo === 'scritto') return 'indirizzo scritto a mano';
  if (origine.tipo === 'filo') return 'pagina aperta da Filo';
  if (origine.tipo !== 'link') return null;
  const da = dominio(origine.da);
  if (!da) return null;
  const stesso = da === dominio(url);
  // Senza un clic è la pagina di prima che ha spostato la scheda: per chi giudica non è la stessa cosa.
  if (origine.gesto) return stesso ? 'link cliccato sullo stesso sito' : `link cliccato su un altro sito (${da})`;
  return stesso ? 'reindirizzamento automatico dallo stesso sito' : `reindirizzamento automatico da un altro sito (${da})`;
}

module.exports = { origineLink };
