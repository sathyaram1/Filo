// La cache V8 del codice del processo principale (#2118): si accende prima dei require pesanti e si scrive su disco ad
// avvio finito, perché un'uscita con app.exit o process.exit non la scrive. Leggera: si carica prima di accenderla.
// NODE_DISABLE_COMPILE_CACHE=1 la spegne. Prove: tests/unit/cacheCodice.test.mjs, tests/cache-codice.spec.mjs.

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

// Accanto alle sottocartelle del motore: il percorso dell'app per cui vale la cache.
const SEGNO = 'percorso-app.txt';

let accesa = false;
let cartella = '';

// Node indicizza la cache sul percorso del file: un'app che a ogni avvio gira da una cartella nuova (AppImage montata
// in /tmp, app spostata da Gatekeeper su Mac) non la riprende mai, e la cartella crescerebbe di MB a ogni apertura.
function percorsoCheCambia(appPath, env) {
  if (env.APPIMAGE) return true;
  return /[\\/]AppTranslocation[\\/]/.test(appPath || '');
}

function accendi(app, env = process.env) {
  try {
    if (typeof Module.enableCompileCache !== 'function' || env.NODE_DISABLE_COMPILE_CACHE) return false;
    // Fuori dalla cartella dei dati di Chromium («Code Cache» è quella delle pagine), e tenuta da «Cancella tutto».
    cartella = path.join(app.getPath('userData'), 'codice-compilato');
    const appPath = app.getAppPath();
    if (percorsoCheCambia(appPath, env)) {
      fs.rmSync(cartella, { recursive: true, force: true });
      return false;
    }
    // Scritta per un'altra cartella dell'app, la cache non verrebbe più letta: si riparte vuoti invece di accumulare.
    let prima = null;
    try { prima = fs.readFileSync(path.join(cartella, SEGNO), 'utf8'); } catch (_) {}
    if (prima !== appPath) {
      fs.rmSync(cartella, { recursive: true, force: true });
      fs.mkdirSync(cartella, { recursive: true });
      fs.writeFileSync(path.join(cartella, SEGNO), appPath);
    }
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
      if (nome !== path.basename(attuale) && nome !== SEGNO) fs.rmSync(path.join(radice, nome), { recursive: true, force: true });
    }
  } catch (_) {}
}

module.exports = { accendi, scrivi, accesa: () => accesa, percorsoCheCambia };
