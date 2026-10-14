// Chiude la WebContents di una scheda. Chiudere non dà alla pagina nessun evento: una pagina di Filo con caselle scritte
// e non ancora spedite (SN_CASELLE) viene avvisata che esce di vista e si chiude quando ha spedito, con un tetto (#666).
// Regole: patterns/un-testo-scritto-in-una-casella-si-salva-da-solo-o-lo-perdi.md.

// La vista è già tolta dalla finestra: una pagina che non risponde resta viva al più questo, senza che nessuno aspetti.
const TETTO_MS = 2000;

const inSospeso = new WeakSet();
// wc → funzioni da chiamare quando la pagina ha spedito (o al tetto), nell'ordine in cui sono arrivate.
const attese = new WeakMap();

function distrutta(wc) {
  try { return typeof wc.isDestroyed === 'function' && wc.isDestroyed(); } catch (_) { return true; }
}

function segna(wc, si) {
  if (!wc) return;
  if (si) { inSospeso.add(wc); return; }
  inSospeso.delete(wc);
  const a = attese.get(wc);
  if (a) a.fine();
}

// Avvisa la pagina che esce di vista; `dopo` gira quando dice «niente più», o al tetto. Una seconda richiesta per la
// stessa pagina si accoda alla prima: un secondo avviso farebbe ripartire le spedizioni.
function attendi(wc, dopo) {
  const gia = attese.get(wc);
  if (gia) { gia.dopo.push(dopo); return; }
  let timer = null;
  const a = {
    dopo: [dopo],
    fine() {
      clearTimeout(timer);
      attese.delete(wc);
      inSospeso.delete(wc);
      for (const fn of a.dopo) { try { fn(); } catch (_) {} }
    },
  };
  attese.set(wc, a);
  timer = setTimeout(a.fine, TETTO_MS);
  try { wc.setAudioMuted(true); } catch (_) {}
  try { wc.send('filo:broadcast', { type: 'tab_in_vista', inVista: false }); } catch (_) { a.fine(); }
}

function chiudi(wc) {
  if (!wc || distrutta(wc)) return;
  const chiudiOra = () => { try { if (!distrutta(wc)) wc.close(); } catch (_) {} };
  if (!inSospeso.has(wc) && !attese.has(wc)) { chiudiOra(); return; }
  attendi(wc, chiudiOra);
}

// Chiudere la finestra e uscire da Filo distruggono le schede senza passare da `chiudi`: chi le distrugge aspetta qui
// le pagine in sospeso, con lo stesso tetto. Null = nessuna da aspettare, si chiude subito.
function congedaSchede(tabManager) {
  let wcs = [];
  try { wcs = ((tabManager && tabManager.tabs) || []).map((t) => t && t.view && t.view.webContents); } catch (_) { return null; }
  const daAspettare = wcs.filter((wc) => wc && !distrutta(wc) && (inSospeso.has(wc) || attese.has(wc)));
  if (!daAspettare.length) return null;
  return Promise.all(daAspettare.map((wc) => new Promise((risolvi) => attendi(wc, risolvi))));
}

module.exports = { segna, chiudi, congedaSchede, TETTO_MS };
