// I punti che caricano nel deposito degli allegati: elenco unico per allegatiMaiInChiaro e
// storageRulesAllegati. Uno nuovo si aggiunge qui; se manca, la scansione lo trova.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const PUNTI_DI_CARICAMENTO = Object.freeze(['src/shared/feedback.js', 'tests/agent/feedback.mjs']);

// Il codice che gira, non le prove che fingono il deposito.
const CARTELLE = ['src', 'scripts', 'tests/agent'];
const SALTA = new Set(['node_modules', '.out', '.git']);

/** I file (relativi alla radice, con le barre normali) che aprono una POST verso il deposito. */
export function chiCaricaNelDeposito(root) {
  const trovati = [];
  const giro = (dir) => {
    let voci;
    try { voci = readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const v of voci) {
      if (SALTA.has(v.name)) continue;
      const p = join(dir, v.name);
      if (v.isDirectory()) giro(p);
      else if (/\.(c|m)?js$/.test(v.name) && readFileSync(p, 'utf8').includes('uploadType=media')) {
        trovati.push(relative(root, p).split(sep).join('/'));
      }
    }
  };
  for (const c of CARTELLE) giro(join(root, c));
  return trovati.sort();
}
