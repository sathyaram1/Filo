// Il confine fra i siti e le pagine di Filo (#1506): da una scheda del web o dalla finestrella di accesso nessuna
// navigazione arriva su un filo://, tranne la home nuda. PURA, senza electron: la chiamano tabs.js e gli handler
// che aprono schede su richiesta di una pagina. Prova: tests/unit/navigazioneVersoFilo.test.mjs.

function letto(url) {
  try { return new URL(String(url || '')); } catch (_) { return null; }
}

// Senza parametri: la home legge `?chat` ed `?evento`, e da un sito non si scelgono.
function homeNuda(u) {
  return u.hostname.toLowerCase() === 'newtab' && (u.pathname === '' || u.pathname === '/') && !u.search && !u.hash;
}

/** Vero se la navigazione va fermata: porta su una pagina di Filo e non parte da una vista di Filo. */
// La finestrella non diventa mai una vista di Filo: lì la home girerebbe senza i suoi servizi, e si ferma anche lei.
function navigazioneVersoFilo(url, { interna = false, finestrella = false } = {}) {
  const u = letto(url);
  if (!u || u.protocol !== 'filo:' || interna) return false;
  return finestrella || !homeNuda(u);
}

// «Gestisci i siti bloccati» della pagina «Sito bloccato» (src/pages/error/error.html): l'unica pagina di Filo che una
// scheda del web apre, e solo se la pagina l'ha messa il main (lo controlla tabs.js).
function paginaDeiBloccati(url) {
  const u = letto(url);
  return Boolean(u && u.protocol === 'filo:' && u.hostname.toLowerCase() === 'security'
    && /^\/(security\.html)?$/.test(u.pathname) && !u.search && !u.hash);
}

module.exports = { navigazioneVersoFilo, paginaDeiBloccati };
