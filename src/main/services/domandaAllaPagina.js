// Il main chiede una cosa alla pagina di una scheda (zoom, traduzione) e ne aspetta la risposta: una strada sola (#504).
// Risponde solo il documento principale di quella scheda: un riquadro incorporato o un'altra pagina non parlano per lei.
// Senza risposta entro `attesaMs` torna null: la pagina non ha il preload di Filo, o non è ancora in piedi.
'use strict';

const { ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');

function chiediAllaPagina(wc, { canale, eco, dati = {}, attesaMs }) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return Promise.resolve(null);
  const rid = `${canale}-${randomUUID()}`;
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
    const scadenza = setTimeout(() => fine(null), attesaMs);
    ipcMain.on(eco, ascolta);
    try { wc.send(canale, { ...dati, rid }); } catch (_) { fine(null); }
  });
}

module.exports = { chiediAllaPagina };
