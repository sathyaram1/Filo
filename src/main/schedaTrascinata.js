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

// Dove sta nella finestra la pagina di una scheda (`strato`: lo strato dei riquadri sopra di lei) e il suo zoom: l'unico
// conto fra px della pagina e px della finestra, per il rilascio e per la carta sopra un gettone.
function cornice(tm, tab, strato = false) {
  const wc = tab && tab.view && tab.view.webContents;
  if (!vivo(wc)) return null;
  try {
    if (strato) {
      const s = tm.riquadri && tm.riquadri.strati && tm.riquadri.strati.get(wc);
      if (!s || !vivo(s.vista.webContents)) return null;
      return { wc: s.vista.webContents, b: s.perIlVuoto.getBounds(), zoom: s.vista.webContents.getZoomFactor() || 1 };
    }
    return { wc, b: tab.view.getBounds(), zoom: wc.getZoomFactor() || 1 };
  } catch (_) { return null; }
}

// x, y nella finestra (px della barra per il suo zoom) → la vista sotto e i punti nella sua pagina.
function vistaSotto(win, x, y) {
  const tm = win._filoTabs;
  const tab = tm && tm.tabs.find((t) => t.id === tm.activeId);
  const wc = tab && tab.view && tab.view.webContents;
  if (!vivo(wc)) return null;
  const nellaPagina = (c) => (c ? { wc: c.wc, x: (x - c.b.x) / c.zoom, y: (y - c.b.y) / c.zoom } : null);
  const s = tm.riquadri && tm.riquadri.strati && tm.riquadri.strati.get(wc);
  if (s && s.visibile && s.aiuto && vivo(s.vista.webContents)) {
    let bordo = null;
    try { bordo = s.cornice.getBounds(); } catch (_) {}
    if (dentro(bordo, x, y)) return nellaPagina(cornice(tm, tab, true));
  }
  const c = cornice(tm, tab);
  return c && dentro(c.b, x, y) ? nellaPagina(c) : null;
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
  if (!sotto || !tab) { inCorso.delete(win); return; }
  const scheda = descrivi(tab);
  // Il rilascio può dover scendere in un riquadro del sito: la scheda resta pronta ancora un momento.
  inCorso.set(win, { scheda, wc: sotto.wc, fino: Date.now() + (fase === 'lascia' ? 3000 : 60000) });
  manda(sotto.wc, { fase, x: Math.round(sotto.x), y: Math.round(sotto.y), scheda: perFase(scheda, fase) });
  if (fase === 'sopra') ultima.set(win, sotto.wc);
}

// Ai passaggi, uno per fotogramma, l'icona non serve: viaggia solo col rilascio.
const perFase = (scheda, fase) => (fase === 'lascia' ? scheda : { ...scheda, icona: '' });
const inCorso = new WeakMap(); // finestra → { scheda, wc, fino }: il trascinamento in corso, per i riquadri dei siti

// Un frame della pagina sotto il puntatore dice che il punto cade in un suo riquadro incorporato (`dati.indice`,
// `dati.src`): il main gira la scheda a quel frame figlio, coi punti del suo contenuto. La scheda è quella del
// trascinamento in corso verso quella pagina: un frame non la sceglie e non la inventa.
function nelRiquadro(win, wc, frame, dati) {
  if (!win || !vivo(wc) || !frame || !dati) return false;
  const fase = ['sopra', 'lascia', 'esci'].includes(dati.fase) ? dati.fase : '';
  const st = inCorso.get(win);
  if (!fase || (fase !== 'esci' && (!st || st.wc !== wc || Date.now() > st.fino))) return false;
  const x = Number(dati.x);
  const y = Number(dati.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let figli = [];
  try { figli = frame.frames || []; } catch (_) { figli = []; }
  const perSrc = dati.src ? figli.filter((f) => { try { return f.url === dati.src; } catch (_) { return false; } }) : [];
  const figlio = perSrc.length === 1 ? perSrc[0] : figli[Number(dati.indice)];
  if (!figlio) return false;
  const tipo = globalThis.SN_MSG?.MSG?.SCHEDA_TRASCINATA || 'scheda_trascinata';
  const msg = fase === 'esci' ? { type: tipo, fase } : { type: tipo, fase, x: Math.round(x), y: Math.round(y), scheda: perFase(st.scheda, fase) };
  try { figlio.send('filo:broadcast', msg); } catch (_) { return false; }
  return true;
}

module.exports = { riceve, nelRiquadro, vistaSotto, descrivi, cornice };
