// Chiude la WebContents di una scheda. Chiudere non dà alla pagina nessun evento: una pagina di Filo con caselle scritte
// e non ancora spedite (SN_CASELLE) viene avvisata che esce di vista e si chiude quando ha spedito, con un tetto (#666).
// Regole: patterns/un-testo-scritto-in-una-casella-si-salva-da-solo-o-lo-perdi.md.

// La vista è già tolta dalla finestra: una pagina che non risponde resta viva al più questo, senza che nessuno aspetti.
const TETTO_MS = 2000;

const inSospeso = new WeakSet();
const attese = new WeakMap();

function segna(wc, si) {
  if (!wc) return;
  if (si) { inSospeso.add(wc); return; }
  inSospeso.delete(wc);
  const fine = attese.get(wc);
  if (fine) fine();
}

function chiudi(wc) {
  if (!wc) return;
  try { if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return; } catch (_) {}
  if (attese.has(wc)) return;
  if (!inSospeso.has(wc)) { try { wc.close(); } catch (_) {} return; }
  let timer = null;
  const fine = () => {
    clearTimeout(timer);
    attese.delete(wc);
    inSospeso.delete(wc);
    try { if (!wc.isDestroyed()) wc.close(); } catch (_) {}
  };
  attese.set(wc, fine);
  timer = setTimeout(fine, TETTO_MS);
  try { wc.setAudioMuted(true); } catch (_) {}
  try { wc.send('filo:broadcast', { type: 'tab_in_vista', inVista: false }); } catch (_) { fine(); }
}

module.exports = { segna, chiudi, TETTO_MS };
