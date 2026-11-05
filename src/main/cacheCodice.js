// La cache V8 del codice del processo principale (#2118): si accende prima dei require pesanti e si scrive su disco ad
// avvio finito, perché un'uscita con app.exit o process.exit non la scrive. Leggera: si carica prima di accenderla.
// NODE_DISABLE_COMPILE_CACHE=1 la spegne. Prova: tests/cache-codice.spec.mjs.

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

let accesa = false;
let cartella = '';

function accendi(app) {
  try {
    if (typeof Module.enableCompileCache !== 'function') return false;
    // Fuori dalla cartella dei dati di Chromium («Code Cache» è quella delle pagine), e tenuta da «Cancella tutto».
    cartella = path.join(app.getPath('userData'), 'codice-compilato');
    const r = Module.enableCompileCache(cartella);
    const S = Module.constants?.compileCacheStatus || {};
    accesa = !!r && (r.status === S.ENABLED || r.status === S.ALREADY_ENABLED);
  } catch (_) { accesa = false; }
  return accesa;
}

function scrivi() {
  if (!accesa) return;
  try { Module.flushCompileCache?.(); } catch (_) {}
  // Ogni versione del motore ha la sua sottocartella (qualche MB): quelle di prima di un aggiornamento non servono più.
  try {
    const attuale = Module.getCompileCacheDir?.();
    // Solo la nostra: con NODE_COMPILE_CACHE nell'ambiente la cache è di chi l'ha scelta.
    const radice = attuale ? path.dirname(attuale) : '';
    if (!cartella || path.resolve(radice) !== path.resolve(cartella)) return;
    for (const nome of fs.readdirSync(radice)) {
      if (nome !== path.basename(attuale)) fs.rmSync(path.join(radice, nome), { recursive: true, force: true });
    }
  } catch (_) {}
}

module.exports = { accendi, scrivi, accesa: () => accesa };
