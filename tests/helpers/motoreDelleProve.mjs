// Le prove girano sull'Electron che il progetto chiede (package-lock.json)? Un motore rimasto da un'installazione
// vecchia fa rossi che sembrano del codice (#1141.5): il globalSetup si ferma prima. Unit: motoreDelleProve.test.mjs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (f) => { try { return readFileSync(f, 'utf8'); } catch (_) { return null; } };
const versione = (v) => String(v ?? '').trim().replace(/^v/, '') || null;

/** La versione di Electron fissata nel lock, o null. PURA. */
export function electronDelLock(testoLock) {
  try { return versione(JSON.parse(testoLock)?.packages?.['node_modules/electron']?.version); } catch (_) { return null; }
}

/**
 * `{ ok, motivo }`. `binario` è null finché Electron non l'ha scaricato (da Electron 42 succede al primo avvio, e
 * scarica quello del pacchetto). `scelto`: il binario l'ha indicato chi lancia (ELECTRON_OVERRIDE_DIST_PATH). PURA.
 */
export function verdettoMotore({ atteso, pacchetto, binario, scelto = false }) {
  const diverso = atteso && [binario, pacchetto].find((v) => v && v !== atteso);
  if (!diverso) return { ok: true, motivo: '' };
  if (scelto) return { ok: false, motivo: `ELECTRON_OVERRIDE_DIST_PATH: le prove girano su Electron ${diverso} invece di ${atteso}, per scelta di chi le lancia.` };
  return {
    ok: false,
    motivo: `Le prove girerebbero su Electron ${diverso}, ma il progetto chiede ${atteso} (package-lock.json): i loro rossi`
      + ' non direbbero niente del codice. Rimetti il motore giusto con `npm ci && node scripts/ensure-electron.mjs` e rilancia.',
  };
}

/** Il motore che userebbe una corsa lanciata da `radice` (la cartella di playwright.config.js). */
export function motoreDelleProve({ radice = RADICE, env = process.env } = {}) {
  const atteso = electronDelLock(leggi(join(radice, 'package-lock.json')));
  let cartella = null;
  try { cartella = dirname(createRequire(join(radice, 'package.json')).resolve('electron/package.json')); } catch (_) {}
  const override = String(env.ELECTRON_OVERRIDE_DIST_PATH || '').trim();
  let pacchetto = null;
  if (cartella && !override) {
    try { pacchetto = versione(JSON.parse(leggi(join(cartella, 'package.json'))).version); } catch (_) {}
  }
  const dist = override || (cartella ? join(cartella, 'dist') : '');
  const binario = dist ? versione(leggi(join(dist, 'version'))) : null;
  return { atteso, pacchetto, binario, ...verdettoMotore({ atteso, pacchetto, binario, scelto: !!override }) };
}
