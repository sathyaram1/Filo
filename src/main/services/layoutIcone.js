// La disposizione delle icone della barra laterale letta e scritta da UN posto: barre, chat e annulli ci
// passano, e ogni scrittura si mette in fila dietro la precedente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');

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

async function leggiEMigra() {
  const out = await storage.get([CHIAVE]);
  const r = D().migra(out && out[CHIAVE]);
  // Riscrivere il salvato nella forma nuova non l'ha scelto nessuno: non è un cambio (ESCLUSIONI.migrazione).
  if (r.scrivi) await require('./registroCambi').con({ via: 'migrazione' }, () => storage.set({ [CHIAVE]: r.layout }));
  return r.layout;
}

function leggi({ incognito = false } = {}) {
  return inFila(incognito, leggiEMigra);
}

// `calcola(prima)` → la disposizione da scrivere, o null per non toccare niente.
async function cambia(calcola, { incognito = false } = {}) {
  const layout = await inFila(incognito, async () => {
    const prima = await leggiEMigra();
    const dopo = calcola(prima);
    if (!dopo || !D().valida(dopo)) return null;
    await storage.set({ [CHIAVE]: dopo });
    return dopo;
  });
  if (layout) annuncia(layout, { incognito });
  return layout;
}

function posa(drop, { incognito = false } = {}) {
  return cambia((prima) => D().applicaPosa(prima, drop || {}), { incognito });
}

// Alle barre di tutte le finestre dello stesso tipo: una aperta altrove con la disposizione vecchia, al primo
// trascinamento, la riscriverebbe.
function annuncia(layout, { incognito = false } = {}) {
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || !!win._filoIncognito !== !!incognito) continue;
    try { tabs.barra?.disposizione(layout); } catch (_) {}
  }
}

module.exports = { leggi, posa, cambia, annuncia, CHIAVE };
// Per gli spec: la stessa porta che usano barra e chat.
globalThis.SN_LAYOUT_ICONE = module.exports;
