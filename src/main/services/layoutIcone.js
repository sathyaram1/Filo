// La disposizione delle icone globali (riga, «Altro…», barra laterale) letta e scritta da UN posto:
// menu delle schede e barra ci passano, e ogni scrittura si mette in fila dietro la precedente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');

const CHIAVE = 'sn_icon_layout';
const SEGNO_QR = 'sn_qr_in_primary_migrated';

// Una coda per contesto: l'incognito scrive nella sua memoria, e non aspetta le finestre normali.
const code = { normale: Promise.resolve(), incognito: Promise.resolve() };

const D = () => globalThis.SN_DISPOSIZIONE_ICONE;
const nelContesto = (incognito, fn) => (incognito ? storage.runIncognito(fn) : fn());

function inFila(incognito, lavoro) {
  const k = incognito ? 'incognito' : 'normale';
  const giro = code[k].then(() => nelContesto(incognito, lavoro));
  code[k] = giro.catch(() => {});
  return giro;
}

async function leggiEMigra() {
  const out = await storage.get([CHIAVE, SEGNO_QR]);
  const qrPromosso = !!(out && out[SEGNO_QR]);
  const r = D().migra(out && out[CHIAVE], { qrPromosso });
  if (r.scrivi) await storage.set({ [CHIAVE]: r.layout, [SEGNO_QR]: true });
  else if (!qrPromosso && r.segnaQr) await storage.set({ [SEGNO_QR]: true });
  return r.layout;
}

function leggi({ incognito = false } = {}) {
  return inFila(incognito, leggiEMigra);
}

async function posa(drop, { incognito = false } = {}) {
  const layout = await inFila(incognito, async () => {
    const prima = await leggiEMigra();
    const dopo = D().applicaPosa(prima, drop || {});
    if (!dopo) return null;
    await storage.set({ [CHIAVE]: dopo });
    return dopo;
  });
  if (layout) annuncia(layout, { incognito });
  return layout;
}

// A tutte le schede e le barre delle finestre dello stesso tipo: un menu già aperto altrove
// con la disposizione vecchia, al primo trascinamento, la riscriverebbe.
function annuncia(layout, { incognito = false } = {}) {
  const tipo = globalThis.SN_MSG?.MSG?.ICON_LAYOUT_CHANGED || 'icon_layout_changed';
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || !!win._filoIncognito !== !!incognito) continue;
    for (const t of tabs.tabs) {
      try { spingiAllaScheda(t.view.webContents, { type: tipo, layout }, { inVista: t.id === tabs.activeId }); } catch (_) {}
    }
    try { tabs.barra?.disposizione(layout); } catch (_) {}
  }
}

module.exports = { leggi, posa, annuncia, CHIAVE };
