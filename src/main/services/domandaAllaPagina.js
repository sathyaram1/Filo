// Il main chiede una cosa alla pagina di una scheda (zoom, traduzione) e ne aspetta la risposta: una strada sola (#504).
// Risponde solo il documento principale di quella scheda: un riquadro incorporato o un'altra pagina non parlano per lei.
// Senza risposta entro `attesaMs` torna null: la pagina non ha il preload di Filo, o non è ancora in piedi.
'use strict';

const { randomUUID } = require('node:crypto');

const vivo = (wc) => !!wc && !(typeof wc.isDestroyed === 'function' && wc.isDestroyed());

// Prima che il sito risponda, il documento che riceverebbe la domanda è quello che sta per sparire: la si manda al nuovo.
function documentoArrivato(wc, tettoMs) {
  if (typeof wc.isWaitingForResponse !== 'function' || !wc.isWaitingForResponse()) return Promise.resolve();
  return new Promise((resolve) => {
    const EVENTI = ['did-navigate', 'did-fail-load', 'did-stop-loading', 'destroyed'];
    const fine = () => {
      clearTimeout(scadenza);
      for (const ev of EVENTI) { try { wc.removeListener(ev, fine); } catch (_) {} }
      resolve();
    };
    const scadenza = setTimeout(fine, tettoMs);
    for (const ev of EVENTI) wc.once(ev, fine);
  });
}

// `caricamentoMs`: su una pagina ancora in arrivo («apri … e traducilo») si aspetta fino a qui che il documento ci sia e
// che Filo ci si monti. `margineMs`: la pagina riceve in `entroMs` quanto può aspettare lei, e risponde prima di noi.
async function chiediAllaPagina(wc, { canale, eco, dati = {}, attesaMs, caricamentoMs = 0, margineMs = 0 }) {
  if (!vivo(wc)) return null;
  let budget = attesaMs;
  if (caricamentoMs > 0) {
    const inizio = Date.now();
    await documentoArrivato(wc, caricamentoMs);
    if (!vivo(wc)) return null;
    let carica = false;
    try { carica = wc.isLoadingMainFrame(); } catch (_) {}
    if (carica) budget = Math.max(attesaMs, caricamentoMs - (Date.now() - inizio));
  }
  const { ipcMain } = require('electron');
  const rid = `${canale}-${randomUUID()}`;
  const conEntro = margineMs > 0 ? { ...dati, entroMs: Math.max(0, budget - margineMs) } : dati;
  return new Promise((resolve) => {
    let chiuso = false;
    const fine = (v) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(scadenza);
      try { ipcMain.removeListener(eco, ascolta); } catch (_) {}
      resolve(v);
    };
    const ascolta = (e, msg) => {
      if (!msg || String(msg.rid || '') !== rid || e.sender !== wc) return;
      if (e.senderFrame && e.senderFrame !== wc.mainFrame) return;
      fine(msg);
    };
    const scadenza = setTimeout(() => fine(null), budget);
    ipcMain.on(eco, ascolta);
    try { wc.send(canale, { ...conEntro, rid }); } catch (_) { fine(null); }
  });
}

module.exports = { chiediAllaPagina };
