// L'Electron che una corsa di Playwright lancerebbe, confrontato con quello del lockfile: un binario rimasto a un'altra
// major fa rossi che sembrano del codice (#1123.5: `clipboard.read()` sulla 33). Non scarica e non lancia finestre.
// Regole: tests/unit/electronDellaCorsa.test.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const majorDi = (v) => {
  const m = /^v?(\d+)\.\d+\.\d+/.exec(String(v || '').trim());
  return m ? Number(m[1]) : null;
};

export function electronDichiarato(radice) {
  try {
    const v = JSON.parse(readFileSync(join(radice, 'package-lock.json'), 'utf8')).packages?.['node_modules/electron']?.version;
    return majorDi(v) === null ? null : v;
  } catch (_) { return null; }
}

/** Lo stesso file che darebbe `require('electron')`, senza il suo download; null se il binario non c'è ancora. */
export function binarioElectron(radice, env = process.env) {
  const pacchetto = join(radice, 'node_modules', 'electron');
  let nome = null;
  try { nome = readFileSync(join(pacchetto, 'path.txt'), 'utf8'); } catch (_) {}
  const altrove = env.ELECTRON_OVERRIDE_DIST_PATH;
  const file = altrove ? join(altrove, nome || 'electron') : (nome ? join(pacchetto, 'dist', nome) : null);
  return file && existsSync(file) ? file : null;
}

/** La versione che il binario dice di sé; null se non risponde come un Electron. */
export function versioneDelBinario(file) {
  try {
    const r = spawnSync(file, ['-p', 'process.versions.electron'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    const v = String(r.stdout || '').trim();
    return majorDi(v) === null ? null : v;
  } catch (_) { return null; }
}

/** PURA. Major diversa: errore. Stessa major, versione diversa: avviso. Un dato che manca non ferma niente. */
export function confrontaElectron({ dichiarata, inUso, altrove = '' }) {
  const a = majorDi(dichiarata);
  const b = majorDi(inUso);
  if (a === null || b === null || dichiarata === inUso) return {};
  const rimedio = altrove
    ? `ELECTRON_OVERRIDE_DIST_PATH punta a ${altrove}: toglilo, o puntalo a un Electron ${dichiarata}`
    : 'allinea i pacchetti con `npm ci`, poi `node scripts/ensure-electron.mjs`';
  if (a !== b) {
    return {
      errore: `Questa corsa lancerebbe Electron ${inUso}, ma il repo dichiara ${dichiarata} (package-lock.json): `
        + `i rossi sarebbero dell'ambiente, non del codice. Nessuna prova è partita; ${rimedio}.`,
    };
  }
  return { avviso: `Electron ${inUso} al posto del ${dichiarata} del lockfile: la corsa parte, ma ${rimedio}.` };
}

export function controllaElectronDellaCorsa(radice, env = process.env) {
  const dichiarata = electronDichiarato(radice);
  const file = dichiarata && binarioElectron(radice, env);
  if (!file) return {};
  return confrontaElectron({ dichiarata, inUso: versioneDelBinario(file), altrove: env.ELECTRON_OVERRIDE_DIST_PATH || '' });
}
