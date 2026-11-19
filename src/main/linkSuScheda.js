// Un collegamento lasciato sulla fila delle schede (#2393), come in Chrome: su una scheda la porta lì, fra due schede o
// sul «+» ne apre una nuova in quel posto. Chi l'ha trascinato può essere una pagina qualunque: passano solo indirizzi
// del web. Il lato della barra sta in src/renderer/link-su-scheda.js.

'use strict';

// Il tetto di Chromium per un indirizzo: oltre, la navigazione fallirebbe comunque.
const MAX_URL = 2 * 1024 * 1024;

function indirizzoDelWeb(s) {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t || t.length > MAX_URL) return '';
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (_) { return ''; }
}

// dati: { url, id } per una scheda, { url, indice } per una nuova in quel posto (senza indice: in fondo).
// Torna l'id della scheda che mostra il collegamento, o null se non si è aperto niente.
function ricevi(tm, dati) {
  if (!tm || !dati || typeof dati !== 'object') return null;
  const url = indirizzoDelWeb(dati.url);
  if (!url) return null;
  if (dati.id != null) {
    const id = String(dati.id);
    if (!tm.tabs.some((t) => t.id === id)) return null;
    tm.navigate(id, url);
    tm.activate(id);
    return id;
  }
  const id = tm.openTab(url);
  const indice = Number(dati.indice);
  if (id && Number.isInteger(indice) && indice >= 0) tm.moveTab(id, indice, { trascinata: false });
  return id || null;
}

module.exports = { ricevi, indirizzoDelWeb, MAX_URL };
