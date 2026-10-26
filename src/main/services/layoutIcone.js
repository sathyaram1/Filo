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
  const giro = inFila(incognito, leggiEMigra);
  giro.then((l) => contaDisposizione(l, incognito), () => {});
  return giro;
}

// Dove arriva un'icona trascinata, nei nomi dei contatori (#1471).
const DESTINAZIONE = Object.freeze({ bar: 'barra', secondary: 'altro_menu' });

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

// `via`: 'trascina', 'rimessa_nel_menu' (tasto destro su un'icona della barra) o 'chat'. `origine`: chi l'ha
// trascinata, per i contatori ('icona_barra' o 'icona_menu'); niente se non è un trascinamento.
async function posa(drop, { incognito = false, via = 'trascina', origine = '' } = {}) {
  const d = drop || {};
  let da = '';
  const layout = await riscrivi((prima) => {
    da = D().ZONE.find((z) => Array.isArray(prima[z]) && prima[z].includes(d.id)) || '';
    return D().applicaPosa(prima, d);
  }, { incognito, mossa: d.id || null });
  if (layout) {
    contaPosa(d, da, { incognito, via, origine });
    // Trascinata o chiesta alla chat, è la stessa azione nel filo (#1561).
    const parametri = { icona: d.id, dove: d.target, ...(d.beforeId ? { prima_di: d.beforeId } : {}) };
    try { require('./accaduti').azioneFatta('SPOSTA_ICONA', parametri, { eseguita: true }, { incognito }); } catch (_) {}
  }
  return layout;
}

function contaPosa({ id, target }, da, { incognito, via, origine }) {
  const K = globalThis.SN_CONTATORI_MAIN;
  if (!K) return;
  try {
    if (da) K.gesto('icona_spostata', { icona: id, da, a: target, via }, { incognito });
    if (origine) K.gesto('trascinamento', { da: origine, a: DESTINAZIONE[target], esito: 'posato' }, { incognito });
  } catch (_) {}
}

// Solo quella delle finestre normali: l'incognito non si conta.
function contaDisposizione(layout, incognito) {
  if (incognito || !layout) return;
  try { globalThis.SN_CONTATORI_MAIN?.disposizioneIcone?.(layout); } catch (_) {}
}

// Alle barre delle finestre dello stesso tipo: una con la disposizione vecchia, al primo trascinamento, la riscriverebbe.
function annuncia(layout, { incognito = false } = {}) {
  contaDisposizione(layout, incognito);
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || !!win._filoIncognito !== !!incognito) continue;
    try { tabs.barra?.disposizione(layout); } catch (_) {}
  }
}

module.exports = { leggi, posa, riscrivi, annuncia, CHIAVE };
globalThis.SN_LAYOUT_ICONE = module.exports;
