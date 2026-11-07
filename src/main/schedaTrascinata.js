// Una scheda portata fuori dalla fila (#2084): il main sa quale vista sta sotto il puntatore (l'Aiuto nello strato sopra
// un sito, o la pagina della scheda davanti) e le passa la scheda coi punti di quella pagina. Nessuna finestra nuova.
// Il ricevitore è uno solo, src/shared/schedaTrascinata.js; la scheda la descrive il main, mai chi la chiede.

'use strict';

const ultima = new WeakMap(); // finestra → webContents che ha ricevuto l'ultimo passaggio
const vivo = (wc) => !!wc && !wc.isDestroyed();
const dentro = (b, x, y) => !!b && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;

function descrivi(tab) {
  const icona = typeof tab.favicon === 'string' ? tab.favicon : '';
  return { id: String(tab.id), titolo: String(tab.title || ''), url: String(tab.url || ''), icona };
}

// x, y nella finestra (px della barra per il suo zoom) → la vista sotto e i punti nella sua pagina.
function vistaSotto(win, x, y) {
  const tm = win._filoTabs;
  const tab = tm && tm.tabs.find((t) => t.id === tm.activeId);
  const wc = tab && tab.view && tab.view.webContents;
  if (!vivo(wc)) return null;
  const nellaPagina = (destWc, b) => {
    const z = destWc.getZoomFactor() || 1;
    return { wc: destWc, x: (x - b.x) / z, y: (y - b.y) / z };
  };
  const s = tm.riquadri && tm.riquadri.strati && tm.riquadri.strati.get(wc);
  if (s && s.visibile && s.aiuto && vivo(s.vista.webContents)) {
    let cornice = null;
    try { cornice = s.cornice.getBounds(); } catch (_) {}
    if (dentro(cornice, x, y)) return nellaPagina(s.vista.webContents, s.perIlVuoto.getBounds());
  }
  let b = null;
  try { b = tab.view.getBounds(); } catch (_) {}
  return dentro(b, x, y) ? nellaPagina(wc, b) : null;
}

function manda(wc, dati) {
  const tipo = globalThis.SN_MSG?.MSG?.SCHEDA_TRASCINATA || 'scheda_trascinata';
  try { wc.mainFrame.send('filo:broadcast', { type: tipo, ...dati }); } catch (_) {}
}

// dati: { fase: sopra|lascia|esci, id, x, y } dalla barra; `zoom` è quello della barra.
function riceve(win, dati, zoom = 1) {
  if (!win || win.isDestroyed() || !win._filoTabs || !dati) return;
  const fase = ['sopra', 'lascia', 'esci'].includes(dati.fase) ? dati.fase : '';
  const tab = win._filoTabs.tabs.find((t) => t.id === String(dati.id || ''));
  const prima = ultima.get(win);
  const x = Number(dati.x) * zoom;
  const y = Number(dati.y) * zoom;
  const sotto = fase && fase !== 'esci' && tab && Number.isFinite(x) && Number.isFinite(y) ? vistaSotto(win, x, y) : null;
  // Chi aveva la luce e non sta più sotto la spegne.
  if (prima && (!sotto || sotto.wc !== prima) && vivo(prima)) manda(prima, { fase: 'esci' });
  ultima.delete(win);
  if (!sotto || !tab) return;
  const scheda = descrivi(tab);
  manda(sotto.wc, { fase, x: Math.round(sotto.x), y: Math.round(sotto.y), scheda });
  if (fase === 'sopra') ultima.set(win, sotto.wc);
}

module.exports = { riceve, vistaSotto, descrivi };
