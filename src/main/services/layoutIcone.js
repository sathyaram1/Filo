// La disposizione delle icone globali (riga, «Altro…», barra laterale) letta e scritta da UN posto:
// menu delle schede e barra ci passano, e ogni scrittura si mette in fila dietro la precedente.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');
const { vistePerAnnunci } = require('../tabs/riservaNuovaScheda');

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
  const giro = inFila(incognito, leggiEMigra);
  giro.then((l) => contaDisposizione(l, incognito), () => {});
  return giro;
}

// Dove arriva un'icona trascinata, nei nomi dei contatori (#1471).
const DESTINAZIONE = Object.freeze({ bar: 'barra', primary: 'riga_menu', secondary: 'altro_menu' });

// `via`: 'trascina', 'rimessa_nel_menu' (tasto destro su un'icona della barra) o 'chat'. `origine`: chi l'ha
// trascinata, per i contatori ('icona_barra' o 'icona_menu'); niente se non è un trascinamento.
async function posa(drop, { incognito = false, via = 'trascina', origine = '' } = {}) {
  let da = '';
  const layout = await inFila(incognito, async () => {
    const prima = await leggiEMigra();
    const dopo = D().applicaPosa(prima, drop || {});
    if (!dopo) return null;
    da = D().ZONE.find((z) => Array.isArray(prima[z]) && prima[z].includes(drop.id)) || '';
    await storage.set({ [CHIAVE]: dopo });
    return dopo;
  });
  if (layout) {
    annuncia(layout, { incognito });
    contaPosa(drop, da, { incognito, via, origine });
    // Trascinata o chiesta alla chat, è la stessa azione nel filo (#1561).
    const parametri = { icona: drop.id, dove: drop.target, ...(drop.beforeId ? { prima_di: drop.beforeId } : {}) };
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

// A tutte le schede e le barre delle finestre dello stesso tipo: un menu già aperto altrove
// con la disposizione vecchia, al primo trascinamento, la riscriverebbe.
function annuncia(layout, { incognito = false } = {}) {
  contaDisposizione(layout, incognito);
  const tipo = globalThis.SN_MSG?.MSG?.ICON_LAYOUT_CHANGED || 'icon_layout_changed';
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || !!win._filoIncognito !== !!incognito) continue;
    for (const { wc, inVista } of vistePerAnnunci(tabs)) {
      try { spingiAllaScheda(wc, { type: tipo, layout }, { inVista }); } catch (_) {}
    }
    try { tabs.barra?.disposizione(layout); } catch (_) {}
  }
}

module.exports = { leggi, posa, annuncia, CHIAVE };
