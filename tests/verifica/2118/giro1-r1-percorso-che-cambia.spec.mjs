// #2118 giro 1, rilievo 1: Filo aperto da un percorso che cambia a ogni avvio (l'AppImage di Linux si monta ogni volta in
// una cartella nuova) non riprende mai la cache del codice, e la cartella dei dati cresce di qualche MB a ogni apertura.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARTELLA = 'codice-compilato';

// Una copia di Filo in una cartella col nome che l'AppImage dà al suo punto di montaggio.
function montaggio(base, n) {
  const dir = join(base, `.mount_Filo${n}abc`);
  mkdirSync(dir, { recursive: true });
  for (const d of ['src', 'assets', 'generato']) {
    if (existsSync(join(APP_ROOT, d))) cpSync(join(APP_ROOT, d), join(dir, d), { recursive: true });
  }
  cpSync(join(APP_ROOT, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(APP_ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}

async function apri(dir, userData) {
  const p = spawn(ELECTRON, [...argomentiScala, '.'], {
    cwd: dir,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', NODE_DEBUG_NATIVE: 'COMPILE_CACHE', APPIMAGE: join(dir, '..', 'Filo.AppImage') },
  });
  let log = '';
  p.stderr.on('data', (d) => { log += d; });
  const uscito = new Promise((ok) => p.on('exit', ok));
  // Il tempo dell'avvio e della scrittura della cache, che parte cinque secondi dopo la prima scheda.
  const t0 = Date.now();
  while (Date.now() - t0 < 40_000 && !/writing cache for CommonJS [^\n]*services[\\/]loader\.js[^\n]*success/.test(log)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 2000));
  if (process.platform === 'win32') { try { p.kill('SIGKILL'); } catch (_) {} }
  else { try { process.kill(-p.pid, 'SIGKILL'); } catch (_) { try { p.kill('SIGKILL'); } catch (_) {} } }
  await uscito;
  return log;
}

const quanti = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).length : 0);

test('r1 da un percorso che cambia a ogni avvio la cache del codice non cresce a ogni apertura', async () => {
  test.setTimeout(240_000);
  const base = cartellaTemporanea('filo-appimage-');
  const userData = join(base, 'dati');
  mkdirSync(userData, { recursive: true });
  try {
    await apri(montaggio(base, 1), userData);
    const dopoPrimo = quanti(join(userData, CARTELLA));
    await apri(montaggio(base, 2), userData);
    await apri(montaggio(base, 3), userData);
    const dopoTerzo = quanti(join(userData, CARTELLA));
    expect(dopoTerzo, `cartella della cache: ${dopoPrimo} file dopo la prima apertura, ${dopoTerzo} dopo la terza`).toBeLessThanOrEqual(dopoPrimo);
  } finally {
    togliCartella(base);
  }
});
