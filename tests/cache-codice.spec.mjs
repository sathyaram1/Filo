// #2118: il codice del processo principale compilato al primo avvio si ritrova al secondo, nella cartella dei dati.
// Filo si apre come lo apre chi lo usa (senza il debugger di Playwright, che cambia le opzioni del motore e quindi la
// cache), e il registro di Node dice quale file ha preso dalla cache. Logica: src/main/cacheCodice.js.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARTELLA = 'codice-compilato';

function avvia(userData) {
  const p = spawn(ELECTRON, [...argomentiScala, '.'], {
    cwd: APP_ROOT,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', NODE_DEBUG_NATIVE: 'COMPILE_CACHE' },
  });
  let log = '';
  p.stderr.on('data', (d) => { log += d; });
  const uscito = new Promise((ok) => p.on('exit', ok));
  return {
    log: () => log,
    async chiudi() {
      // Il gruppo intero: un renderer rimasto terrebbe aperta la pipe.
      if (process.platform === 'win32') { try { p.kill('SIGKILL'); } catch (_) {} }
      else { try { process.kill(-p.pid, 'SIGKILL'); } catch (_) { try { p.kill('SIGKILL'); } catch (_) {} } }
      await uscito;
    },
  };
}

const file = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).length : 0);
// Il registro scrive il percorso col separatore della piattaforma.
const delLoader = (cosa) => new RegExp(`${cosa === 'scritto' ? 'writing cache for CommonJS' : 'V8 code cache for CommonJS'} [^\\n]*services[\\\\/]loader\\.js[^\\n]*${cosa === 'scritto' ? 'success' : 'was accepted'}`);
const accettati = (log) => (log.match(/V8 code cache for CommonJS [^\n]* was accepted/g) || []).length;

test('al secondo avvio il codice del main arriva già compilato dalla cartella dei dati', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-cache-codice-');
  // Quella lasciata da una versione del motore di prima di un aggiornamento.
  const vecchia = join(userData, CARTELLA, 'v0.0.0-x64-vecchia-0');
  mkdirSync(vecchia, { recursive: true });
  writeFileSync(join(vecchia, 'de1a5a82'), 'x');
  let filo = null;
  try {
    filo = avvia(userData);
    // Non serve chiudere bene: la cache si scrive da sé poco dopo l'avvio, anche se Filo poi viene ucciso.
    await expect.poll(() => delLoader('scritto').test(filo.log()), { timeout: 90_000, message: 'il primo avvio non ha scritto la cache' }).toBe(true);
    await expect.poll(() => existsSync(vecchia), { message: 'la cache di un motore vecchio resta su disco' }).toBe(false);
    await filo.chiudi();
    filo = null;
    expect(file(join(userData, CARTELLA)), 'la cache sta nella cartella dei dati').toBeGreaterThan(50);

    filo = avvia(userData);
    await expect.poll(() => delLoader('preso').test(filo.log()), { timeout: 90_000, message: 'il secondo avvio ha ricompilato il loader' }).toBe(true);
    expect(accettati(filo.log()), 'i moduli caricati all’avvio vengono dalla cache').toBeGreaterThan(50);
  } finally {
    if (filo) await filo.chiudi();
    togliCartella(userData);
  }
});

test('con NODE_DISABLE_COMPILE_CACHE la cache resta spenta e Filo parte lo stesso', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-cache-spenta-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', NODE_DISABLE_COMPILE_CACHE: '1' },
  });
  try {
    await expect.poll(() => app.evaluate(() => globalThis.__filoAvvio?.pronti || null), { timeout: 60_000 }).not.toBeNull();
    const avvio = await app.evaluate(() => globalThis.__filoAvvio);
    expect(avvio.cacheCodice).toBe(false);
    expect(avvio.msModuli).toBeGreaterThan(0);
    expect(existsSync(join(userData, CARTELLA))).toBe(false);
  } finally {
    await chiudiApp(app);
    togliCartella(userData);
  }
});
