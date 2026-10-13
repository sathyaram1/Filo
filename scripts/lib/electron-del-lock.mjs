// L'Electron che partirebbe è quello che package-lock.json chiede? Un node_modules rimasto indietro fa girare le prove
// su un altro motore, e i rossi che ne escono sembrano del codice (#1141.4: Electron 33 sotto prove scritte per la 44).
// Chi lancia Electron per provare Filo chiede qui prima di partire; sentinella: tests/unit/electronDelLock.test.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f) => { try { return readFileSync(f, 'utf8'); } catch (_) { return null; } };
const senzaV = (s) => String(s || '').trim().replace(/^v/, '');

/**
 * Le tre versioni (lock, pacchetto installato, binario) e se combaciano. Quello che manca non si confronta: senza
 * binario lo scarica `require('electron')` al primo uso, senza pacchetto Playwright si ferma già da sé.
 */
export function electronDelLock(root, { env = process.env } = {}) {
  let lock = null;
  try { lock = JSON.parse(leggi(join(root, 'package-lock.json')) || 'null')?.packages?.['node_modules/electron']?.version || null; } catch (_) { /* lock illeggibile: niente da confrontare */ }
  const cartella = join(root, 'node_modules', 'electron');
  let pacchetto = null;
  try { pacchetto = JSON.parse(leggi(join(cartella, 'package.json')) || 'null')?.version || null; } catch (_) { /* idem */ }
  // ELECTRON_OVERRIDE_DIST_PATH sostituisce il binario del pacchetto: si confronta quello che partirà davvero.
  const dist = env.ELECTRON_OVERRIDE_DIST_PATH || join(cartella, 'dist');
  const binario = existsSync(join(dist, 'version')) ? senzaV(leggi(join(dist, 'version'))) || null : null;
  const esito = { ok: true, lock, pacchetto, binario, motivo: '' };
  if (!lock) return esito;
  const conseguenza = 'con un altro Electron le prove non dicono niente del codice.';
  if (pacchetto && pacchetto !== lock) {
    return {
      ...esito,
      ok: false,
      motivo: `node_modules ha Electron ${pacchetto} e package-lock.json chiede la ${lock}: i pacchetti sono rimasti a`
        + ' prima dell\'ultimo aggiornamento. Reinstallali (`npm ci`; nel contenitore delle routine poi'
        + ` \`node scripts/ensure-electron.mjs\`) e rilancia: ${conseguenza}`,
    };
  }
  if (binario && binario !== lock) {
    const dove = env.ELECTRON_OVERRIDE_DIST_PATH ? `ELECTRON_OVERRIDE_DIST_PATH (${dist})` : 'node_modules/electron/dist';
    return {
      ...esito,
      ok: false,
      motivo: `il binario in ${dove} è Electron ${binario} e package-lock.json chiede la ${lock}. Rimetti il binario`
        + ' giusto (nel contenitore delle routine `node scripts/ensure-electron.mjs`; altrove cancella'
        + ` node_modules/electron/dist e lo riscarica il primo avvio) e rilancia: ${conseguenza}`,
    };
  }
  return esito;
}

/** Ferma chi sta per lanciare Electron quando il motore non è quello del lock, col perché e il rimedio. */
export function richiediElectronDelLock(root, opzioni) {
  const e = electronDelLock(root, opzioni);
  if (!e.ok) throw new Error(`Electron non è quello del lock: ${e.motivo}`);
  return e;
}
