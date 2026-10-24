// Le memorie del correttore che cambiano (dizionario, correzioni dell'utente, parole da non correggere da sé) spinte
// alle schede aperte (#1447): un content script non sente il magazzino, e una parola tolta nella pagina del correttore
// deve valere subito dove si scrive. Va solo quello che il content script usa: i conti a metà restano nel magazzino.

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');
const { vistePerAnnunci } = require('../tabs/riservaNuovaScheda');

const TIPO = 'correttore_memorie';

function ritaglia(changes) {
  if (!changes || typeof changes !== 'object') return null;
  const out = {};
  if (changes.sn_personal_dict) out.sn_personal_dict = changes.sn_personal_dict.newValue ?? [];
  if (changes.sn_autocorrect) out.sn_autocorrect = changes.sn_autocorrect.newValue ?? {};
  const imp = changes.sn_correttore_imparato;
  if (imp) {
    const dopo = Array.isArray(imp.newValue?.rifiutate) ? imp.newValue.rifiutate : [];
    const prima = Array.isArray(imp.oldValue?.rifiutate) ? imp.oldValue.rifiutate : [];
    if (JSON.stringify(dopo) !== JSON.stringify(prima)) out.rifiutate = dopo;
  }
  return Object.keys(out).length ? out : null;
}

// L'incognito scrive nella sua memoria e non manda eventi: le sue schede non ricevono i cambi di fuori.
function annuncia(memorie) {
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs || win._filoIncognito) continue;
    for (const { wc, inVista } of vistePerAnnunci(tabs)) {
      try { spingiAllaScheda(wc, { type: TIPO, memorie }, { inVista }); } catch (_) {}
    }
  }
}

let avviato = false;
function avvia() {
  if (avviato) return;
  avviato = true;
  storage.onChanged((changes) => {
    const memorie = ritaglia(changes);
    if (memorie) annuncia(memorie);
  });
}

module.exports = { avvia, ritaglia, TIPO };
