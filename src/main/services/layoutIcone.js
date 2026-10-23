// La disposizione delle icone della barra laterale (barra e «Altro…») letta e scritta da UN posto: barra, chat e
// annullo ci passano, e ogni scrittura si mette in fila dietro la precedente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');
const Registro = require('./registroCambi');

const CHIAVE = 'sn_icon_layout';

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

// Riscrivere un salvato di prima nella forma di adesso non l'ha chiesto nessuno: non è un cambio (ESCLUSIONI.migrazione).
async function leggiEMigra() {
  const out = await storage.get(CHIAVE);
  const r = D().migra(out && out[CHIAVE]);
  if (r.scrivi) await Registro.con({ via: 'migrazione' }, () => storage.set({ [CHIAVE]: r.layout }));
  return r.layout;
}

function leggi({ incognito = false } = {}) {
  return inFila(incognito, leggiEMigra);
}

// `cambia(prima)` → la disposizione nuova, o null. `mossa` dice al registro dei cambi quale icona si è spostata.
async function riscrivi(cambia, { incognito = false, mossa = null } = {}) {
  const layout = await inFila(incognito, async () => {
    const prima = await leggiEMigra();
    const dopo = cambia(prima);
    if (!dopo || !D().valida(dopo)) return null;
    await Registro.conDettaglio(mossa ? { mossa } : {}, () => storage.set({ [CHIAVE]: dopo }));
    return dopo;
  });
  if (layout) annuncia(layout, { incognito });
  return layout;
}

function posa(drop, { incognito = false } = {}) {
  const d = drop || {};
  return riscrivi((prima) => D().applicaPosa(prima, d), { incognito, mossa: d.id || null });
}

// Alle barre delle finestre dello stesso tipo: una con la disposizione vecchia, al primo trascinamento, la riscriverebbe.
function annuncia(layout, { incognito = false } = {}) {
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || !!win._filoIncognito !== !!incognito) continue;
    try { tabs.barra?.disposizione(layout); } catch (_) {}
  }
}

module.exports = { leggi, posa, riscrivi, annuncia, CHIAVE };
globalThis.SN_LAYOUT_ICONE = module.exports;
