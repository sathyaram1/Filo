// Lancia uno script con Node senza i file dei comandi di Actions: nella corsa Unit sulla fusione installazione e binario
// di Electron eseguono codice del ramo, che non deve cambiare ambiente, PATH o uscite dei passi che scrivono l'esito
// (#2558). Gira dagli strumenti di main. Sentinella: tests/unit/comandiDiActions.test.mjs.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { senzaComandiDiActions } from './lib/comandi-di-actions.mjs';

/** → il codice d'uscita dello script lanciato. */
export function lancia(argomenti, { env = process.env } = {}) {
  if (!argomenti.length) {
    console.error('senza-comandi-di-actions: manca lo script da lanciare');
    return 2;
  }
  const r = spawnSync(process.execPath, argomenti, { stdio: 'inherit', env: senzaComandiDiActions(env) });
  if (r.error) {
    console.error(`senza-comandi-di-actions: ${argomenti[0]} non è partito (${r.error.message})`);
    return 1;
  }
  return r.status === null ? 1 : r.status;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = lancia(process.argv.slice(2));
